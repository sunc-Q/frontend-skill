package service

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
	"bizsite/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// NewAt 注入时钟：测试与复现脚本用固定时刻灌种子，读写两侧才是同一把表。
func NewAt(repo *repository.Repo, now func() time.Time) *Service {
	return &Service{repo: repo, now: now}
}

// Now 暴露当前时刻，供 handler 的 served_at 与测试的确定性时钟使用。
func (s *Service) Now() time.Time { return s.now() }

// ---- 读 ----

func (s *Service) List(ctx context.Context, q domain.ListQuery) ([]domain.TicketRow, int64, error) {
	return s.repo.ListTickets(ctx, q, s.now())
}

type Detail struct {
	Ticket    *domain.TicketRow      `json:"ticket"`
	Ledger    domain.SlaLedger       `json:"ledger"`
	Timeline  []domain.TimelineEntry `json:"timeline"`
	Responses domain.ResponseClock   `json:"response"`
}

func (s *Service) Detail(ctx context.Context, code string) (*Detail, error) {
	row, err := s.repo.TicketByCode(ctx, code, s.now())
	if err != nil {
		return nil, err
	}
	evs, err := s.repo.Events(ctx, row.ID, 200)
	if err != nil {
		return nil, err
	}
	now := s.now()
	spans := domain.PauseSpansFromEvents(evs, now)
	bd, met, pending := domain.ComputeResponseClock(&row.Ticket, now)
	return &Detail{
		Ticket:   row,
		Ledger:   domain.LedgerFor(&row.Ticket, spans, now),
		Timeline: buildTimeline(evs, &row.Ticket, now),
		Responses: domain.ResponseClock{
			BdMinutes: bd, Met: met, Pending: pending,
			TargetBd: row.ResponseTarget, DueAt: row.RespDueAt.In(domain.FieldTZ).Format(time.RFC3339),
			Human: domain.HumanBd(int64(row.ResponseTarget)),
		},
	}, nil
}

// buildTimeline 把事件流折成「每段停留多久、这段是否计入时效」。
// 相邻事件之间按工单当时所处状态判定是否停表，页面因此能逐段核对总账。
func buildTimeline(evs []domain.TicketEvent, t *domain.Ticket, now time.Time) []domain.TimelineEntry {
	out := make([]domain.TimelineEntry, 0, len(evs))
	for i, e := range evs {
		at := e.At
		next := now
		if i+1 < len(evs) {
			next = evs[i+1].At
		}
		counts := e.ToStatus != domain.StPending
		spanBd := int64(0)
		if next.After(at) {
			spanBd = domain.BusinessMinutesBetween(at, next)
		}
		wall := int64(0)
		if next.After(at) {
			wall = int64(next.Sub(at).Minutes())
		}
		out = append(out, domain.TimelineEntry{
			ID: e.ID, Kind: e.Kind, FromStatus: e.FromStatus, ToStatus: e.ToStatus,
			Actor: e.Actor, ActorRole: e.ActorRole, Note: e.Note,
			At:     at.In(domain.FieldTZ).Format(time.RFC3339),
			SpanBd: spanBd, SpanWall: wall, Counts: counts,
		})
	}
	if t.PausedSince != nil && len(out) > 0 {
		out[len(out)-1].Counts = false
	}
	return out
}

func (s *Service) Agents(ctx context.Context) ([]domain.Agent, error) {
	return s.repo.AllAgents(ctx)
}

func (s *Service) Customers(ctx context.Context) ([]domain.Customer, error) {
	return s.repo.Customers(ctx, false)
}

func (s *Service) Policies(ctx context.Context) ([]domain.SlaPolicy, error) {
	return s.repo.Policies(ctx)
}

func (s *Service) Stats(ctx context.Context) (*domain.Stats, error) {
	return s.repo.BuildStats(ctx, s.now())
}

// ---- 写 ----

// CreateTicket 落一张新单：等级 × 严重级决定时效，目标值与到期点在落库时快照，
// 之后合同改了也不回溯在办单。
func (s *Service) CreateTicket(ctx context.Context, in domain.CreateTicketInput, actor string) (*domain.TicketRow, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	in.Customer = strings.TrimSpace(in.Customer)
	in.Severity = strings.TrimSpace(in.Severity)
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if in.Category == "" {
		in.Category = "使用咨询"
	}
	if in.Channel == "" {
		in.Channel = "工单门户"
	}
	c, err := s.repo.CustomerByCode(ctx, in.Customer)
	if err != nil {
		return nil, err
	}
	if !c.Active {
		return nil, domain.New("customer_inactive", "该客户已停用，不能新建工单", 409)
	}
	pol, err := s.repo.Policy(ctx, c.Tier, in.Severity)
	if err != nil {
		return nil, err
	}
	var agent *domain.Agent
	if in.Agent != "" {
		a, err := s.repo.AgentByCode(ctx, in.Agent)
		if err != nil {
			return nil, err
		}
		if !a.Active {
			return nil, domain.New("agent_inactive", "该工程师已停用，无法派单", 409)
		}
		agent = a
	}

	created := s.now().Truncate(time.Minute)
	if actor == "" {
		actor = c.ContactName
	}
	t := &domain.Ticket{
		Title: in.Title, Description: in.Description,
		CustomerID: c.ID, Team: domain.TeamForCategory(in.Category),
		Category: in.Category, Channel: in.Channel,
		Severity: in.Severity, Priority: domain.Prioritize(in.Severity, c.Tier),
		Status: domain.StNew, CreatedAt: created, UpdatedAt: created,
		ResponseTarget: pol.ResponseMin, ResolveTarget: pol.ResolveMin,
		RespDueAt:    domain.AdvanceBusiness(created, int64(pol.ResponseMin)),
		ResolveDueAt: domain.AdvanceBusiness(created, int64(pol.ResolveMin)),
	}
	ev := domain.TicketEvent{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: actor, ActorRole: "客户",
		Note: "通过" + in.Channel + "提交", At: created,
	}
	if agent != nil {
		first := domain.AdvanceBusiness(created, 1)
		t.AgentID = &agent.ID
		t.Status = domain.StAssigned
		t.FirstResponse = &first
		t.ResponseBd = domain.BusinessMinutesBetween(created, first)
		met := t.ResponseBd <= int64(pol.ResponseMin)
		t.MetResponse = &met
		ev.ToStatus = domain.StAssigned
	}
	if err := s.repo.CreateTicket(ctx, t, ev); err != nil {
		return nil, err
	}
	return s.repo.TicketByCode(ctx, t.Code, s.now())
}

func (s *Service) ChangeStatus(ctx context.Context, code string, in domain.StatusInput, actor string) (*domain.TicketRow, error) {
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	to := in.Status
	_, err := s.repo.ApplyTicketChange(ctx, code, func(tx *gorm.DB, t *domain.Ticket) error {
		return applyStatus(tx, t, to, "", strings.TrimSpace(in.Note), actor, s.now())
	})
	if err != nil {
		return nil, err
	}
	return s.repo.TicketByCode(ctx, code, s.now())
}

func (s *Service) Pause(ctx context.Context, code string, in domain.PauseInput, actor string) (*domain.TicketRow, error) {
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	reason := strings.TrimSpace(in.Reason)
	_, err := s.repo.ApplyTicketChange(ctx, code, func(tx *gorm.DB, t *domain.Ticket) error {
		return applyStatus(tx, t, domain.StPending, reason, strings.TrimSpace(in.Note), actor, s.now())
	})
	if err != nil {
		return nil, err
	}
	return s.repo.TicketByCode(ctx, code, s.now())
}

// Resume 恢复到停表前的状态：从最近一条 paused 事件的 from_status 还原，
// 而不是硬写 in_progress —— 否则「已派单就被挂起」的单会凭空跳级。
func (s *Service) Resume(ctx context.Context, code, note, actor string) (*domain.TicketRow, error) {
	if n := len([]rune(note)); n > 200 {
		return nil, domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"note": "备注最长 200 个字符"})
	}
	var restore string
	t0, err := s.repo.TicketByCode(ctx, code, s.now())
	if err != nil {
		return nil, err
	}
	if t0.Status != domain.StPending {
		return nil, domain.New("not_paused", "该工单当前没有停表，无需恢复计时", 409)
	}
	evs, err := s.repo.Events(ctx, t0.ID, 200)
	if err != nil {
		return nil, err
	}
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].Kind == domain.EvPaused {
			restore = evs[i].FromStatus
			break
		}
	}
	if !domain.ValidStatus(restore) || restore == domain.StPending {
		restore = domain.StWorking
	}
	_, err = s.repo.ApplyTicketChange(ctx, code, func(tx *gorm.DB, t *domain.Ticket) error {
		return applyStatus(tx, t, restore, "", strings.TrimSpace(note), actor, s.now())
	})
	if err != nil {
		return nil, err
	}
	return s.repo.TicketByCode(ctx, code, s.now())
}

func (s *Service) Assign(ctx context.Context, code string, in domain.AssignInput, actor string) (*domain.TicketRow, error) {
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	a, err := s.repo.AgentByCode(ctx, in.Agent)
	if err != nil {
		return nil, err
	}
	if !a.Active {
		return nil, domain.New("agent_inactive", "该工程师已停用，无法派单", 409)
	}
	_, err = s.repo.ApplyTicketChange(ctx, code, func(tx *gorm.DB, t *domain.Ticket) error {
		if domain.IsTerminal(t.Status) {
			return domain.New("ticket_finished", "工单已结单，不能再派单", 409)
		}
		if t.AgentID != nil {
			var cur domain.Agent
			if err := tx.First(&cur, *t.AgentID).Error; err == nil && cur.Code == a.Code {
				return domain.New("same_agent", "工单已在该工程师名下", 409)
			}
			t.ReassignCount++
		}
		now := s.now().Truncate(time.Minute)
		from := t.Status // 事件的起点必须在改状态之前取，否则时间线会显示 new → new
		t.AgentID = &a.ID
		if t.Team == "" || t.Team != a.Team {
			t.Team = a.Team
		}
		note := strings.TrimSpace(in.Note)
		if note == "" {
			note = "派单给" + a.Name + "（" + a.Team + "）"
		}
		if t.FirstResponse == nil {
			first := now
			t.FirstResponse = &first
			t.ResponseBd = domain.BusinessMinutesBetween(t.CreatedAt, first)
			met := t.ResponseBd <= int64(t.ResponseTarget) && !first.After(t.RespDueAt)
			t.MetResponse = &met
			if t.Status == domain.StNew {
				t.Status = domain.StAssigned
			}
		}
		if err := tx.Save(t).Error; err != nil {
			return err
		}
		return tx.Create(&domain.TicketEvent{
			Kind: domain.EvAssigned, FromStatus: from, ToStatus: t.Status, Actor: actor,
			ActorRole: "值班主管", Note: note, At: now, TicketID: t.ID,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return s.repo.TicketByCode(ctx, code, s.now())
}

// applyStatus 是状态推进的唯一实现：状态机判定、停表开合、各时间戳与时效结算都在这里，
// handler 与统计层都不再补一套规则。闭包内一切读写必须用 tx（单写者模型）。
func applyStatus(tx *gorm.DB, t *domain.Ticket, to, reason, note, actor string, now time.Time) error {
	from := t.Status
	if err := domain.CanTransition(from, to); err != nil {
		return err
	}
	if domain.ReopenFrom(from, to) && t.ReopenCount >= domain.MaxReopen {
		return domain.New("reopen_limit", "同一工单最多重开 2 次，请另立新单", 409)
	}
	if to == domain.StAssigned && t.AgentID == nil {
		return domain.New("agent_required", "推进到「已派单」前必须先指定工程师", 409)
	}
	at := now.Truncate(time.Minute)
	if at.Before(t.CreatedAt) {
		at = t.CreatedAt
	}
	resumed := false
	if domain.IsPausedStatus(from) && !domain.IsPausedStatus(to) {
		if err := closePause(tx, t, at); err != nil {
			return err
		}
		resumed = true
	}
	kind := domain.EvStatus
	if resumed {
		// 离开停表态本身就是「恢复计时」这一跳，不再另写一条 status 事件，
		// 否则时间线上一次动作会出现两条几乎相同的记录。
		kind = domain.EvResumed
	}
	switch to {
	case domain.StPending:
		if reason == "" {
			return domain.Field("invalid_request", "参数校验未通过",
				map[string]string{"reason": "停表必须给出原因"})
		}
		t.PausedSince = &at
		t.PauseReason = reason
		kind = domain.EvPaused
	case domain.StResolved:
		t.ResolvedAt = &at
		cs := domain.ComputeClock(t, at)
		t.ResolveBd = cs.ElapsedBd
		met := cs.ElapsedBd <= int64(t.ResolveTarget)
		t.MetResolve = &met
	case domain.StClosed:
		t.ClosedAt = &at
	case domain.StCanceled:
		t.CanceledAt = &at
	}
	if t.FirstResponse == nil && (to == domain.StAssigned || to == domain.StWorking) {
		t.FirstResponse = &at
		t.ResponseBd = domain.BusinessMinutesBetween(t.CreatedAt, at)
		met := t.ResponseBd <= int64(t.ResponseTarget) && !at.After(t.RespDueAt)
		t.MetResponse = &met
	}
	if domain.ReopenFrom(from, to) {
		t.ReopenCount++
		t.ResolvedAt = nil
		t.MetResolve = nil
		t.ResolveBd = 0
	}
	t.Status = to
	if note == "" {
		note = domain.StatusLabel(from) + " → " + domain.StatusLabel(to)
	}
	if err := tx.Save(t).Error; err != nil {
		return err
	}
	return tx.Create(&domain.TicketEvent{
		Kind: kind, FromStatus: from, ToStatus: to, Actor: actor,
		ActorRole: "值班工程师", Note: note, At: at, TicketID: t.ID,
	}).Error
}

// closePause 把进行中的停表结算进 tickets.paused_bd。
// 它只结账、不写事件：对应的 resumed 事件由 applyStatus 用同一个 kind 分支写出来，
// 时间线复算（identity_timeline_ok）依赖 paused/resumed 成对出现，缺了它详情页就会亮红。
func closePause(tx *gorm.DB, t *domain.Ticket, at time.Time) error {
	if t.PausedSince == nil {
		return nil
	}
	if at.After(*t.PausedSince) {
		t.PausedBd += domain.BusinessMinutesBetween(*t.PausedSince, at)
	}
	t.PausedSince = nil
	t.PauseReason = ""
	return nil
}

func (s *Service) UpsertPolicy(ctx context.Context, in domain.PolicyInput, actor string) (*domain.SlaPolicy, bool, error) {
	if errs, ok := in.Validate(); !ok {
		return nil, false, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.UpsertPolicy(ctx, in, actor)
}
