package service

import (
	"context"
	"strings"
	"time"

	"autoshop/internal/domain"
	"autoshop/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// ListOrders 读列表并补三个「此刻为准」的派生字段：等待时长、是否超承诺、可推进状态。
func (s *Service) ListOrders(ctx context.Context, q domain.ListQuery) ([]domain.OrderRow, int64, error) {
	rows, total, err := s.repo.ListOrders(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	s.decorate(rows, s.now())
	return rows, total, nil
}

func (s *Service) OrderDetail(ctx context.Context, no string) (*domain.OrderRow, []domain.OrderLineRow, []domain.MoveRow, error) {
	no = strings.TrimSpace(no)
	if !domain.SafeCodeRe(no, 20) {
		return nil, nil, nil, domain.ErrNotFound
	}
	head, err := s.repo.OrderHead(ctx, no)
	if err != nil {
		return nil, nil, nil, err
	}
	lines, err := s.repo.LinesOfOrder(ctx, head.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	moves, err := s.repo.MovesOfOrder(ctx, no, 60)
	if err != nil {
		return nil, nil, nil, err
	}
	rows := []domain.OrderRow{*head}
	s.decorate(rows, s.now())
	head.WaitMinutes = rows[0].WaitMinutes
	head.PromiseOverdue = rows[0].PromiseOverdue
	head.NextStatuses = rows[0].NextStatuses
	return head, lines, moves, nil
}

func (s *Service) ListParts(ctx context.Context, q domain.ListQuery) ([]domain.PartRow, int64, error) {
	rows, total, err := s.repo.ListParts(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		rows[i].BelowReorder = rows[i].Status == domain.PartActive && rows[i].OnHand <= rows[i].ReorderPoint
	}
	return rows, total, nil
}

func (s *Service) PartDetail(ctx context.Context, code string) (*domain.PartRow, []domain.StockLot, []domain.MoveRow, error) {
	code = strings.TrimSpace(code)
	if !domain.SafeCodeRe(code, 16) {
		return nil, nil, nil, domain.ErrNotFound
	}
	row, err := s.repo.PartRowByCode(ctx, code)
	if err != nil {
		return nil, nil, nil, err
	}
	row.BelowReorder = row.Status == domain.PartActive && row.OnHand <= row.ReorderPoint
	lots, err := s.repo.LotsOfPart(ctx, code)
	if err != nil {
		return nil, nil, nil, err
	}
	moves, err := s.repo.MovesOfPart(ctx, code, 30)
	if err != nil {
		return nil, nil, nil, err
	}
	return row, lots, moves, nil
}

func (s *Service) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	return s.repo.Stats(ctx, days)
}

// CreateOrder 开单：字段校验 → 落库。手机号只在库里存在，出口一律脱敏。
func (s *Service) CreateOrder(ctx context.Context, in domain.CreateOrderInput) (*domain.OrderRow, error) {
	in.PlateNo = strings.TrimSpace(in.PlateNo)
	in.Model = strings.TrimSpace(in.Model)
	in.CustomerName = strings.TrimSpace(in.CustomerName)
	in.Technician = strings.TrimSpace(in.Technician)
	in.Symptom = strings.TrimSpace(in.Symptom)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	wo, err := s.repo.CreateOrder(ctx, in, s.now())
	if err != nil {
		return nil, err
	}
	return s.OrderDetailByWo(ctx, wo.WoNo)
}

// OrderDetailByWo 读单个工单头（列表视图口径）。
func (s *Service) OrderDetailByWo(ctx context.Context, no string) (*domain.OrderRow, error) {
	head, err := s.repo.OrderHead(ctx, no)
	if err != nil {
		return nil, err
	}
	rows := []domain.OrderRow{*head}
	s.decorate(rows, s.now())
	head.WaitMinutes = rows[0].WaitMinutes
	head.PromiseOverdue = rows[0].PromiseOverdue
	head.NextStatuses = rows[0].NextStatuses
	return head, nil
}

// Transition 推进状态机。业务门在 repository 的事务里判（那里才看得到明细行）。
func (s *Service) Transition(ctx context.Context, no string, in domain.TransitionInput) (*domain.OrderRow, error) {
	no = strings.TrimSpace(no)
	if !domain.SafeCodeRe(no, 20) {
		return nil, domain.ErrNotFound
	}
	in.To = strings.TrimSpace(in.To)
	if in.To == "" {
		return nil, domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"to": "目标状态必填"})
	}
	if !domain.ValidStatus(in.To) {
		return nil, domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"to": "目标状态不在状态机内"})
	}
	if in.Reason != "" && !domain.SafeText(in.Reason, 64) {
		return nil, domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"reason": "原因不超过 64 字，且不能含引号/尖括号等字符"})
	}
	wo, err := s.repo.OrderByNo(ctx, no)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.Transition(ctx, wo.ID, in.To, in.Reason, s.now()); err != nil {
		return nil, err
	}
	return s.OrderDetailByWo(ctx, no)
}

// AddLine 追加工时行或出库配件行。两道门：
//  1. 工单必须在可改明细的状态（质检之后账目锁定）；
//  2. 配件行必须由 FIFO 引擎真实出得了库，缺件整单回滚。
func (s *Service) AddLine(ctx context.Context, no string, in domain.AddLineInput) (*domain.OrderRow, *domain.OrderLineRow, error) {
	no = strings.TrimSpace(no)
	if !domain.SafeCodeRe(no, 20) {
		return nil, nil, domain.ErrNotFound
	}
	in.PartCode = strings.TrimSpace(in.PartCode)
	in.Operation = strings.TrimSpace(in.Operation)
	in.Note = strings.TrimSpace(in.Note)
	errs, ok := in.Validate()
	if !ok {
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	wo, err := s.repo.OrderByNo(ctx, no)
	if err != nil {
		return nil, nil, err
	}
	if !domain.LinesEditable(wo.Status) {
		return nil, nil, domain.New("lines_locked", "该工单已进入"+wo.Status+"，明细已锁定", 409)
	}
	switch in.Kind {
	case domain.LineLabor:
		line, err := s.repo.AddLaborLine(ctx, wo.ID, in, s.now())
		if err != nil {
			return nil, nil, err
		}
		head, err := s.OrderDetailByWo(ctx, no)
		return head, line, err
	case domain.LinePart:
		line, _, err := s.repo.IssuePart(ctx, wo.ID, in.PartCode, in.Qty, in.Note, s.now())
		if err != nil {
			return nil, nil, err
		}
		head, err := s.OrderDetailByWo(ctx, no)
		return head, line, err
	}
	return nil, nil, domain.ErrInvalid
}

// AddReceipt 入库建批次。配件必须存在且未停用。
func (s *Service) AddReceipt(ctx context.Context, in domain.ReceiptInput) (*domain.PartRow, *domain.StockLot, error) {
	in.PartCode = strings.TrimSpace(in.PartCode)
	in.LotNo = strings.TrimSpace(in.LotNo)
	in.Supplier = strings.TrimSpace(in.Supplier)
	errs, ok := in.Validate()
	if !ok {
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	p, err := s.repo.PartByCode(ctx, in.PartCode)
	if err != nil {
		return nil, nil, err
	}
	if p.Status != domain.PartActive {
		return nil, nil, domain.New("part_discontinued", "该配件已停用，不能入库", 409)
	}
	lot, err := s.repo.AddReceipt(ctx, in, s.now())
	if err != nil {
		return nil, nil, err
	}
	row, err := s.repo.PartRowByCode(ctx, in.PartCode)
	if err != nil {
		return nil, nil, err
	}
	row.BelowReorder = row.Status == domain.PartActive && row.OnHand <= row.ReorderPoint
	return row, lot, nil
}

// decorate 补算派生字段。等待时长按「开单至今」，已离场单不再计。
func (s *Service) decorate(rows []domain.OrderRow, now time.Time) {
	for i := range rows {
		r := &rows[i]
		if domain.IsOpen(r.Status) {
			wait := now.Sub(r.OpenedAt)
			if wait < 0 {
				wait = 0
			}
			r.WaitMinutes = int64(wait / time.Minute)
			r.PromiseOverdue = now.After(r.PromisedAt)
		} else {
			r.WaitMinutes = 0
			r.PromiseOverdue = false
		}
		r.NextStatuses = domain.NextStatuses(r.Status)
	}
}
