package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"etk/internal/domain"
	"etk/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Second) }}
}

// WithClock 让测试可以钉住「此刻」，从而把核销窗口与退票截止写成表驱动用例。
func (s *Service) WithClock(f func() time.Time) { s.now = f }

func (s *Service) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	return s.repo.Stats(ctx, days, s.now())
}

func (s *Service) Events(ctx context.Context, q domain.EventQuery) ([]domain.EventRow, int64, error) {
	return s.repo.ListEvents(ctx, q, s.now())
}

// Detail 返回场次行 + 票档实时口径。票档要带现价，所以把场次本体一起传下去。
func (s *Service) Detail(ctx context.Context, code string) (*domain.EventRow, []domain.TypeRollup, error) {
	code, ok := normCode(code)
	if !ok {
		return nil, nil, domain.ErrNotFound
	}
	row, err := s.repo.EventRowByCode(ctx, code, s.now())
	if err != nil {
		return nil, nil, err
	}
	types, err := s.repo.TypeRollupFor(ctx, row.ID, &row.Event, s.now())
	if err != nil {
		return nil, nil, err
	}
	return row, types, nil
}

func (s *Service) Orders(ctx context.Context, q domain.OrderQuery) ([]domain.OrderView, int64, error) {
	if q.Event != "" {
		if _, err := s.repo.EventByCode(ctx, q.Event); err != nil {
			return nil, 0, err
		}
	}
	return s.repo.ListOrders(ctx, q, s.now())
}

func (s *Service) Tickets(ctx context.Context, q domain.TicketQuery) ([]domain.TicketView, int64, error) {
	return s.repo.ListTickets(ctx, q, s.now())
}

func (s *Service) TicketByCode(ctx context.Context, code string) (*domain.TicketView, error) {
	code, ok := normCode(code)
	if !ok {
		return nil, domain.ErrNotFound
	}
	return s.repo.TicketByCode(ctx, code, s.now())
}

// replacementFields：Go 的 JSON 解码器会把非法 UTF-8（裸 CESU-8 三字节）替换成 U+FFFD 后照常入库，
// 这里当脏输入按字段拒掉，不让乱码进台账。
func replacementFields(in map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range in {
		if strings.ContainsRune(v, utf8.RuneError) {
			out[k] = "含非法字符"
		}
	}
	return out
}

func normCode(s string) (string, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "" || len(s) > domain.MaxCodeLen || !domain.CodeAllowed(s) {
		return "", false
	}
	return s, true
}

func (s *Service) CreateEvent(ctx context.Context, in domain.CreateEventInput) (*domain.Event, error) {
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	in.Title = strings.TrimSpace(in.Title)
	in.Artist = strings.TrimSpace(in.Artist)
	in.Venue = strings.TrimSpace(in.Venue)
	in.City = strings.TrimSpace(in.City)
	in.Category = strings.ToLower(strings.TrimSpace(in.Category))
	in.Note = strings.TrimSpace(in.Note)
	if errs := replacementFields(map[string]string{
		"code": in.Code, "title": in.Title, "artist": in.Artist,
		"venue": in.Venue, "city": in.City, "note": in.Note,
	}); len(errs) > 0 {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.CreateEvent(ctx, in, s.now())
}

var eventStatusActions = map[string]string{
	"open":   domain.EventOnSale,
	"close":  domain.EventClosed,
	"cancel": domain.EventCanceld,
}

// SetStatus 把「动作」而不是「目标状态」作为接口契约：draft→on_sale 叫 open，
// 这样状态机只有一处解释（domain.NextEventStatus）。
func (s *Service) SetStatus(ctx context.Context, code, action string) (*domain.Event, string, error) {
	code, ok := normCode(code)
	if !ok {
		return nil, "", domain.ErrInvalid
	}
	to, known := eventStatusActions[strings.ToLower(strings.TrimSpace(action))]
	if !known {
		return nil, "", domain.New("invalid_request", "action 只能是 open / close / cancel", 400)
	}
	e, err := s.repo.SetEventStatus(ctx, code, to, s.now())
	if err != nil {
		return nil, "", err
	}
	msg := map[string]string{
		domain.EventOnSale:  "场次已开票",
		domain.EventClosed:  "场次已关闸散场",
		domain.EventCanceld: "场次已取消",
	}[to]
	return e, msg, nil
}

// Sale：出票并当场收款。校验后把全部业务判定交给事务内的仓储（配额/状态机/计价）。
func (s *Service) Sale(ctx context.Context, in domain.SaleInput) (*domain.OrderView, []domain.Ticket, error) {
	in.EventCode = strings.ToUpper(strings.TrimSpace(in.EventCode))
	in.TypeCode = strings.ToUpper(strings.TrimSpace(in.TypeCode))
	in.Buyer = strings.TrimSpace(in.Buyer)
	in.Phone = strings.TrimSpace(in.Phone)
	in.Channel = strings.ToLower(strings.TrimSpace(in.Channel))
	if errs, ok := in.Validate(); !ok {
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if errs := replacementFields(map[string]string{
		"event_code": in.EventCode, "type_code": in.TypeCode,
		"buyer": in.Buyer, "phone": in.Phone,
	}); len(errs) > 0 {
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if !domain.CodeAllowed(in.Buyer) {
		errs := map[string]string{"buyer": "购票人只允许字母、数字、下划线与连字符"}
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.Sale(ctx, in, s.now())
}

func (s *Service) CheckIn(ctx context.Context, ticketCode string, in domain.CheckinInput) (*domain.TicketView, string, error) {
	ticketCode, ok := normCode(ticketCode)
	if !ok {
		return nil, "", domain.ErrNotFound
	}
	in.Gate = strings.ToUpper(strings.TrimSpace(in.Gate))
	if errs, valid := in.Validate(); !valid {
		return nil, "", domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.CheckIn(ctx, ticketCode, in.Gate, s.now())
}

func (s *Service) Refund(ctx context.Context, orderCode string, in domain.RefundInput) (*domain.OrderView, int64, error) {
	orderCode, ok := normCode(orderCode)
	if !ok {
		return nil, 0, domain.ErrNotFound
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if errs, valid := in.Validate(); !valid {
		return nil, 0, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if errs := replacementFields(map[string]string{"reason": in.Reason}); len(errs) > 0 {
		return nil, 0, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.Refund(ctx, orderCode, in.Reason, s.now())
}
