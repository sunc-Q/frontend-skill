package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

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

func (s *Service) Plans(ctx context.Context) ([]domain.Plan, error) {
	return s.repo.Plans(ctx, false)
}

func (s *Service) Metrics(ctx context.Context, months int) (*domain.Metrics, error) {
	return s.repo.Metrics(ctx, months)
}

func (s *Service) List(ctx context.Context, q domain.ListQuery) ([]domain.SubscriptionRow, int64, error) {
	return s.repo.ListSubscriptions(ctx, q)
}

func (s *Service) Detail(ctx context.Context, id int64) (*domain.SubscriptionRow, []domain.Payment, error) {
	row, err := s.repo.Subscription(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	pays, err := s.repo.Payments(ctx, id, 24)
	if err != nil {
		return nil, nil, err
	}
	return row, pays, nil
}

var codeAllowed = func(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-'
}

func (s *Service) CreatePlan(ctx context.Context, in domain.CreatePlanInput) (*domain.Plan, error) {
	in.Code = strings.TrimSpace(in.Code)
	in.Name = strings.TrimSpace(in.Name)
	if !utf8.ValidString(in.Code) || !utf8.ValidString(in.Name) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if strings.IndexFunc(in.Code, func(r rune) bool { return !codeAllowed(r) }) >= 0 {
		errs := map[string]string{"code": "套餐标识只允许字母、数字、下划线与连字符"}
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	p := &domain.Plan{
		Code: in.Code, Name: in.Name,
		PriceMonthly: in.PriceMonthly, PriceYearly: in.PriceYearly,
		SeatQuota: in.SeatQuota, Active: active, CreatedAt: s.now(),
	}
	if err := s.repo.CreatePlan(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// Renew 校验续费请求并把状态推进为 active；订阅不存在返回 404。
func (s *Service) Renew(ctx context.Context, subID int64, in domain.RenewInput) (*domain.SubscriptionRow, error) {
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	cur, err := s.repo.Subscription(ctx, subID)
	if err != nil {
		return nil, err
	}
	if cur.Status == domain.StatusTrialing {
		return nil, domain.New("invalid_state", "试用中的订阅请走转正接口，不能直接记续费", 409)
	}
	next, perr := time.Parse("2006-01-02", in.NextRenew)
	if perr != nil {
		return nil, domain.ErrInvalid
	}
	if next.Before(s.now().AddDate(0, 0, -1)) {
		errs := map[string]string{"next_renew": "续费日不能早于昨天"}
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	paidAt := cur.RenewAt
	if paidAt.IsZero() {
		paidAt = s.now()
	}
	if err := s.repo.RecordRenewal(ctx, subID, in.Amount, in.Period, next, paidAt); err != nil {
		return nil, err
	}
	return s.repo.Subscription(ctx, subID)
}
