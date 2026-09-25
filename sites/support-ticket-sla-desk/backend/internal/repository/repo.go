package repository

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func (r *Repo) DB() *gorm.DB { return r.db }

// Harden 在首次写入后把库文件（含 WAL/SHM）压到 0600。
func (r *Repo) Harden(path string) { hardenFileMode(path) }

const rowSelect = `t.*, c.code AS customer_code, c.name AS customer_name, c.tier AS tier,
	c.contact_phone AS contact_phone_raw, a.code AS agent_code, a.name AS agent_name`

// ---- 基础字典 ----

func (r *Repo) Customers(ctx context.Context, activeOnly bool) ([]domain.Customer, error) {
	var out []domain.Customer
	q := r.db.WithContext(ctx).Order("tier asc, name asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	return out, q.Find(&out).Error
}

func (r *Repo) CustomerByCode(ctx context.Context, code string) (*domain.Customer, error) {
	var c domain.Customer
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.New("customer_not_found", "客户编号不存在", 404)
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repo) AgentByCode(ctx context.Context, code string) (*domain.Agent, error) {
	var a domain.Agent
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.New("agent_not_found", "工程师编号不存在", 404)
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repo) Policies(ctx context.Context) ([]domain.SlaPolicy, error) {
	var out []domain.SlaPolicy
	err := r.db.WithContext(ctx).
		Order("CASE tier WHEN 'platinum' THEN 0 WHEN 'gold' THEN 1 WHEN 'silver' THEN 2 ELSE 3 END, severity asc").
		Find(&out).Error
	return out, err
}

// Policy 取「等级 × 严重级」的当前时效合同。
func (r *Repo) Policy(ctx context.Context, tier, severity string) (*domain.SlaPolicy, error) {
	var p domain.SlaPolicy
	err := r.db.WithContext(ctx).Where("tier = ? AND severity = ?", tier, severity).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.New("policy_missing",
			fmt.Sprintf("缺少 %s × %s 的 SLA 策略，请先配置", tier, severity), 409)
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repo) UpsertPolicy(ctx context.Context, in domain.PolicyInput, actor string) (*domain.SlaPolicy, bool, error) {
	created := false
	var out domain.SlaPolicy
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var p domain.SlaPolicy
		err := tx.Where("tier = ? AND severity = ?", in.Tier, in.Severity).First(&p).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			p = domain.SlaPolicy{Tier: in.Tier, Severity: in.Severity}
			created = true
		} else if err != nil {
			return err
		}
		p.ResponseMin = in.ResponseMin
		p.ResolveMin = in.ResolveMin
		p.Description = domain.TierLabel(in.Tier) + " · " + in.Severity + " 级：" +
			domain.HumanBd(int64(in.ResolveMin))
		p.UpdatedBy = actor
		p.UpdatedAt = time.Now().UTC()
		if err := tx.Save(&p).Error; err != nil {
			return err
		}
		out = p
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &out, created, nil
}

// ---- 工单读 ----

type rawRow struct {
	domain.Ticket
	CustomerCode    string `gorm:"column:customer_code"`
	CustomerName    string `gorm:"column:customer_name"`
	Tier            string `gorm:"column:tier"`
	AgentCode       string `gorm:"column:agent_code"`
	AgentName       string `gorm:"column:agent_name"`
	ContactPhoneRaw string `gorm:"column:contact_phone_raw"`
}

// ListTickets 是队列表格的唯一读口。
//
// 「超时 / 即将超时」两个页签的判定依赖实时时间账（挂起中的到期点会顺延），
// SQL 里表达不出来，所以先按「必然漏不掉」的超集粗筛，再用与详情页同一个
// ComputeClock 在 Go 层精筛并分页 —— 这样 total 与实际行数永远一致。
func (r *Repo) ListTickets(ctx context.Context, q domain.ListQuery, now time.Time) ([]domain.TicketRow, int64, error) {
	narrow := q.Only == "breached" || q.Only == "at_risk"
	base := r.db.WithContext(ctx).Table("tickets AS t").
		Joins("JOIN customers c ON c.id = t.customer_id").
		Joins("LEFT JOIN agents a ON a.id = t.agent_id")

	if q.Status != "" {
		base = base.Where("t.status = ?", q.Status)
	}
	if q.Severity != "" {
		base = base.Where("t.severity = ?", q.Severity)
	}
	if q.Priority != "" {
		base = base.Where("t.priority = ?", q.Priority)
	}
	if q.Tier != "" {
		base = base.Where("c.tier = ?", q.Tier)
	}
	if q.Team != "" {
		base = base.Where("t.team = ?", q.Team)
	}
	if q.Agent != "" {
		base = base.Where("a.code = ?", q.Agent)
	}
	if q.Customer != "" {
		base = base.Where("c.code = ?", q.Customer)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(t.title LIKE ? ESCAPE '\\' OR t.code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')", like, like, like)
	}
	switch q.Only {
	case "open":
		base = base.Where("t.status IN ?", openStatuses())
	case "paused":
		base = base.Where("t.status = ?", domain.StPending)
	case "responding":
		base = base.Where("t.status IN ? AND t.first_response IS NULL", openStatuses())
	case "breached":
		base = base.Where("t.status IN ? AND t.resolve_due_at < ?", openStatuses(), now)
	case "at_risk":
		// 60 个工作分钟最多跨多少个挂钟天？含中秋+国庆连休也远小于 10 天，
		// 这里是「超集」而非「精筛」，精筛在 Go 层。
		base = base.Where("t.status IN ? AND t.resolve_due_at <= ?",
			openStatuses(), now.Add(10*24*time.Hour))
	}

	if narrow {
		var raw []rawRow
		if err := base.Select(rowSelect).Limit(2000).Scan(&raw).Error; err != nil {
			return nil, 0, err
		}
		rows := make([]domain.TicketRow, 0, len(raw))
		for i := range raw {
			row := enrich(&raw[i], now)
			if q.Only == "breached" && !row.Breached {
				continue
			}
			if q.Only == "at_risk" && !row.AtRisk {
				continue
			}
			rows = append(rows, *row)
		}
		sortRows(rows, domain.SortName(q.Sort), q.Dir)
		total := int64(len(rows))
		lo := q.Offset()
		if lo > len(rows) {
			lo = len(rows)
		}
		hi := lo + q.PageSize
		if hi > len(rows) {
			hi = len(rows)
		}
		return rows[lo:hi], total, nil
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var raw []rawRow
	err := base.Select(rowSelect).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", t.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&raw).Error
	if err != nil {
		return nil, 0, err
	}
	rows := make([]domain.TicketRow, 0, len(raw))
	for i := range raw {
		rows = append(rows, *enrich(&raw[i], now))
	}
	return rows, total, nil
}

func sortRows(rows []domain.TicketRow, key, dir string) {
	less := func(i, j int) bool {
		a, b := &rows[i], &rows[j]
		switch key {
		case "created":
			return a.CreatedAt.Before(b.CreatedAt)
		case "due":
			return a.DueAtLive < b.DueAtLive
		case "paused":
			return a.PausedBdLive < b.PausedBdLive
		case "resolveBd":
			return a.ResolveBd < b.ResolveBd
		case "customer":
			if a.CustomerName != b.CustomerName {
				return a.CustomerName < b.CustomerName
			}
			return a.Code < b.Code
		case "agent":
			if a.AgentName != b.AgentName {
				return a.AgentName < b.AgentName
			}
			return a.Code < b.Code
		default: // priority / severity / status / code 都是定长可字典序比较的枚举
			var av, bv string
			switch key {
			case "priority":
				av, bv = a.Priority, b.Priority
			case "severity":
				av, bv = a.Severity, b.Severity
			case "status":
				av, bv = a.Status, b.Status
			default:
				av, bv = a.Code, b.Code
			}
			if av != bv {
				return av < bv
			}
			return a.Code < b.Code
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if dir == "desc" {
			return !less(i, j) && less(j, i)
		}
		return less(i, j)
	})
}

// TicketByCode 读单只工单（不含时间线）。
func (r *Repo) TicketByCode(ctx context.Context, code string, now time.Time) (*domain.TicketRow, error) {
	var raw rawRow
	err := r.db.WithContext(ctx).Table("tickets AS t").
		Select(rowSelect).
		Joins("JOIN customers c ON c.id = t.customer_id").
		Joins("LEFT JOIN agents a ON a.id = t.agent_id").
		Where("t.code = ?", code).Scan(&raw).Error
	if err != nil {
		return nil, err
	}
	if raw.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return enrich(&raw, now), nil
}

func (r *Repo) TicketByID(ctx context.Context, id int64) (*domain.Ticket, error) {
	var t domain.Ticket
	err := r.db.WithContext(ctx).First(&t, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repo) Events(ctx context.Context, ticketID int64, limit int) ([]domain.TicketEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	var out []domain.TicketEvent
	err := r.db.WithContext(ctx).Where("ticket_id = ?", ticketID).
		Order("at asc, id asc").Limit(limit).Find(&out).Error
	return out, err
}

func (r *Repo) AllTickets(ctx context.Context, limit int) ([]rawRow, error) {
	if limit <= 0 || limit > 5000 {
		limit = 5000
	}
	var raw []rawRow
	err := r.db.WithContext(ctx).Table("tickets AS t").
		Select(rowSelect).
		Joins("JOIN customers c ON c.id = t.customer_id").
		Joins("LEFT JOIN agents a ON a.id = t.agent_id").
		Limit(limit).Order("t.created_at asc").Scan(&raw).Error
	return raw, err
}

func (r *Repo) AllAgents(ctx context.Context) ([]domain.Agent, error) {
	var out []domain.Agent
	return out, r.db.WithContext(ctx).Order("team asc, code asc").Find(&out).Error
}

func (r *Repo) AllEvents(ctx context.Context, limit int) ([]domain.TicketEvent, error) {
	if limit <= 0 || limit > 50000 {
		limit = 50000
	}
	var out []domain.TicketEvent
	err := r.db.WithContext(ctx).Order("at asc, id asc").Limit(limit).Find(&out).Error
	return out, err
}

func openStatuses() []string {
	return []string{domain.StNew, domain.StAssigned, domain.StWorking, domain.StPending}
}

func enrich(raw *rawRow, now time.Time) *domain.TicketRow {
	cs := domain.ComputeClock(&raw.Ticket, now)
	return &domain.TicketRow{
		Ticket:        raw.Ticket,
		CustomerCode:  raw.CustomerCode,
		CustomerName:  raw.CustomerName,
		Tier:          raw.Tier,
		AgentCode:     raw.AgentCode,
		AgentName:     raw.AgentName,
		MaskedPhone:   domain.MaskPhone(raw.ContactPhoneRaw),
		ElapsedBd:     cs.ElapsedBd,
		PausedBdLive:  cs.PausedBd,
		RemainingBd:   cs.RemainingBd,
		DueAtLive:     cs.Due.In(domain.FieldTZ).Format(time.RFC3339),
		Breached:      cs.Breached,
		AtRisk:        cs.AtRisk,
		ProgressPct:   cs.ProgressPct,
		Finished:      cs.Finished,
		ClockIdentity: cs.ClockIdentity,
	}
}

// ---- 工单写（全部在一个事务里完成）----

// CreateTicket 在事务内发号并落库。编号撞车的重试必须在同一闭包内：
// 单写者模型下用 r.db 去查会抢回自己被占住的那条连接（第 5 轮的坑）。
func (r *Repo) CreateTicket(ctx context.Context, t *domain.Ticket, ev domain.TicketEvent) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for attempt := 0; attempt < 8; attempt++ {
			var seq int64
			if err := tx.Model(&domain.Ticket{}).
				Where("created_at >= ? AND created_at < ?",
					startOfSequenceDay(t.CreatedAt), startOfSequenceDay(t.CreatedAt).Add(24*time.Hour)).
				Count(&seq).Error; err != nil {
				return err
			}
			t.Code = fmt.Sprintf("TK-%s-%04d", t.CreatedAt.In(domain.FieldTZ).Format("20060102"), seq+1+int64(attempt)*997)
			err := tx.Create(t).Error
			if err == nil {
				ev.TicketID = t.ID
				return tx.Create(&ev).Error
			}
			if !isUnique(err) {
				return err
			}
			// SQLite 报的是索引键的「表.列」而不是索引名，所以按列判型：
			// code 撞车是发号冲突（可重试），(customer_id,title) 撞车是重复提单（409）。
			msg := strings.ToLower(err.Error())
			if strings.Contains(msg, "customer_id") && strings.Contains(msg, "title") {
				return domain.New("duplicate_open_ticket",
					"该客户已有一张同名在办工单，请勿重复提单", 409)
			}
			t.ID = 0 // 撞号后必须清掉主键，否则下一次 Create 会走 UPDATE
		}
		return domain.New("code_exhausted", "工单编号发放冲突过多，请稍后重试", 409)
	})
}

func startOfSequenceDay(t time.Time) time.Time {
	l := t.In(domain.FieldTZ)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, domain.FieldTZ).UTC()
}

// ApplyTicketChange 把「改工单 + 追加事件」绑成一个事务。
// 闭包内一切读写都用 tx——这是单写者模型下的铁律。
func (r *Repo) ApplyTicketChange(ctx context.Context, code string,
	mutate func(tx *gorm.DB, t *domain.Ticket) error, events ...domain.TicketEvent) (*domain.Ticket, error) {
	var out domain.Ticket
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var t domain.Ticket
		if err := tx.Where("code = ?", code).First(&t).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if err := mutate(tx, &t); err != nil {
			return err
		}
		t.UpdatedAt = time.Now().UTC()
		if err := tx.Save(&t).Error; err != nil {
			return err
		}
		for i := range events {
			events[i].TicketID = t.ID
			if err := tx.Create(&events[i]).Error; err != nil {
				return err
			}
		}
		out = t
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func isUnique(err error) bool {
	if err == nil {
		return false
	}
	low := strings.ToLower(err.Error())
	return strings.Contains(low, "unique") || strings.Contains(low, "constraint")
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}
