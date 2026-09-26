package service

import (
	"context"
	"errors"
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

func (s *Service) Lanes(ctx context.Context, all bool) ([]domain.Lane, error) {
	return s.repo.Lanes(ctx, !all)
}

func (s *Service) Rules(ctx context.Context, all bool) ([]domain.SurchargeRule, error) {
	return s.repo.Rules(ctx, !all)
}

func (s *Service) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	st, err := s.repo.Stats(ctx, s.now(), days)
	if err != nil {
		return nil, err
	}
	if st.ByStatus == nil {
		st.ByStatus = []domain.StatusCount{}
	}
	if st.ByLane == nil {
		st.ByLane = []domain.LaneRollup{}
	}
	if st.Daily == nil {
		st.Daily = []domain.DailyPoint{}
	}
	if st.IdentityIssues == nil {
		st.IdentityIssues = []string{}
	}
	return st, nil
}

func (s *Service) Waybills(ctx context.Context, q domain.ListQuery) ([]domain.WaybillRow, int64, error) {
	return s.repo.ListWaybills(ctx, q)
}

func (s *Service) Waybill(ctx context.Context, code string) (*domain.WaybillDetail, error) {
	return s.repo.WaybillByCode(ctx, code)
}

// QuoteOf 报价试算：与下单共用同一个 domain.QuoteOf，绝不出现两套价。
func (s *Service) QuoteOf(ctx context.Context, p domain.QuoteParams) (*domain.QuoteView, error) {
	lane, err := s.repo.LaneByCode(ctx, p.LaneCode)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, domain.New("lane_not_found", "线路不存在", 404)
		}
		return nil, err
	}
	rules, err := s.repo.Rules(ctx, true)
	if err != nil {
		return nil, err
	}
	q := domain.QuoteOf(domain.QuoteInput{
		Lane: lane, Rules: domain.SortRulesActive(rules), WeightGrams: p.WeightGrams,
		VolumeCm3: p.VolumeCm3, HeaviestG: p.HeaviestG,
		DeclaredCents: p.DeclaredCents, Fragile: p.Fragile,
	})
	v := q.View(lane)
	if !v.IdentityOK {
		return nil, domain.New("pricing_broken", "计价恒等式校验未通过，已拒绝返回报价", 500)
	}
	return v, nil
}

func (s *Service) CreateWaybill(ctx context.Context, in domain.CreateWaybillInput) (*domain.WaybillDetail, error) {
	in.LaneCode = strings.TrimSpace(in.LaneCode)
	in.ShipperName = strings.TrimSpace(in.ShipperName)
	in.Phone = strings.TrimSpace(in.Phone)
	in.Node = strings.TrimSpace(in.Node)
	if !utf8.ValidString(in.ShipperName) || !utf8.ValidString(in.Node) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	lane, err := s.repo.LaneByCode(ctx, in.LaneCode)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, domain.New("lane_not_found", "线路不存在", 404)
		}
		return nil, err
	}
	if !lane.Active {
		return nil, domain.New("lane_offline", "该线路已停售，不能新下运单", 409)
	}
	rules, err := s.repo.Rules(ctx, true)
	if err != nil {
		return nil, err
	}
	q := domain.QuoteOf(domain.QuoteInput{
		Lane: lane, Rules: domain.SortRulesActive(rules), WeightGrams: in.WeightGrams,
		VolumeCm3: in.VolumeCm3, HeaviestG: in.HeaviestG,
		DeclaredCents: in.DeclaredCents, Fragile: in.Fragile,
	})
	if q.TotalCents != q.FreightCents+q.FuelCents+q.InsuranceCents+q.SurchargeCents {
		return nil, domain.New("pricing_broken", "计价恒等式校验未通过，已拒绝开单", 500)
	}
	node := in.Node
	if node == "" {
		node = lane.Origin + "马驹桥分拨中心"
	}
	return s.repo.CreateWaybill(ctx, in, q, lane, s.now(), node)
}

func (s *Service) Advance(ctx context.Context, code string, in domain.AdvanceInput) (*domain.WaybillDetail, error) {
	in.Node = strings.TrimSpace(in.Node)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	detail, err := s.repo.Advance(ctx, code, in.To, in.Node, strings.TrimSpace(in.Note), s.now())
	if err != nil {
		return nil, err
	}
	return detail, nil
}

func (s *Service) ReportException(ctx context.Context, code string, in domain.ExceptionInput) (*domain.WaybillDetail, error) {
	in.Node = strings.TrimSpace(in.Node)
	in.Reason = strings.TrimSpace(in.Reason)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	cur, err := s.repo.WaybillByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	if cur.Status == domain.StException {
		return nil, domain.New("already_exception", "该运单已处于异常挂起状态", 409)
	}
	if !domain.CanAdvance(cur.Status, domain.StException) {
		return nil, domain.New("invalid_transition", "已结案的运单不能再登记异常", 409)
	}
	return s.repo.Advance(ctx, code, domain.StException, in.Node, "异常："+in.Reason, s.now())
}

func (s *Service) CreateRule(ctx context.Context, in domain.CreateRuleInput) (*domain.SurchargeRule, error) {
	in.Code = strings.TrimSpace(in.Code)
	in.Name = strings.TrimSpace(in.Name)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	rule := &domain.SurchargeRule{
		Code: in.Code, Name: in.Name, Kind: in.Kind, ThresholdG: in.ThresholdG,
		ThresholdKm: in.ThresholdKm, RatePct: in.RatePct, AmountCents: in.AmountCents,
		MinCents: in.MinCents, Priority: in.Priority, Active: true, CreatedAt: s.now(),
	}
	if err := s.repo.CreateRule(ctx, rule); err != nil {
		return nil, err
	}
	return rule, nil
}

func (s *Service) ToggleRule(ctx context.Context, id int64) (*domain.SurchargeRule, error) {
	if id <= 0 {
		return nil, domain.ErrInvalid
	}
	return s.repo.ToggleRule(ctx, id)
}
