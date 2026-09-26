package service

import (
	"context"
	"errors"
	"fmt"
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

func (s *Service) Piles(ctx context.Context) ([]domain.PileRow, error) {
	return s.repo.Piles(ctx)
}

func (s *Service) Vehicles(ctx context.Context, all bool) ([]domain.VehicleRow, error) {
	return s.repo.Vehicles(ctx, !all)
}

func (s *Service) Tariffs(ctx context.Context, all bool) ([]domain.TariffRule, error) {
	return s.repo.Tariffs(ctx, !all)
}

// RateBoard 回显当前生效价目窗口：周末视图取下一个周六，工作日视图取明天。
func (s *Service) RateBoard(ctx context.Context) ([]domain.RateWindow, error) {
	rules, err := s.repo.Tariffs(ctx, true)
	if err != nil {
		return nil, err
	}
	return domain.BuildRateBoard(rules), nil
}

func (s *Service) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	st, err := s.repo.Stats(ctx, s.now(), days)
	if err != nil {
		return nil, err
	}
	if st.ByStatus == nil {
		st.ByStatus = []domain.StatusCount{}
	}
	if st.ByPile == nil {
		st.ByPile = []domain.PileRollup{}
	}
	if st.ByDept == nil {
		st.ByDept = []domain.DeptRollup{}
	}
	if st.Daily == nil {
		st.Daily = []domain.DailyPoint{}
	}
	if st.RateBoard == nil {
		st.RateBoard = []domain.RateWindow{}
	}
	if st.IdentityIssues == nil {
		st.IdentityIssues = []string{}
	}
	return st, nil
}

func (s *Service) Sessions(ctx context.Context, q domain.ListQuery) ([]domain.SessionRow, int64, error) {
	return s.repo.ListSessions(ctx, q)
}

func (s *Service) Session(ctx context.Context, code string) (*domain.SessionDetail, error) {
	return s.repo.SessionByCode(ctx, code)
}

// QuoteOf 试算：与结算共用同一个 domain.ComputeBill，绝不出现两套价。
func (s *Service) QuoteOf(ctx context.Context, p domain.QuoteParams) (*domain.QuoteView, error) {
	pile, err := s.repo.PileByCode(ctx, p.PileCode)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, domain.New("pile_not_found", "充电桩不存在", 404)
		}
		return nil, err
	}
	rules, err := s.repo.Tariffs(ctx, true)
	if err != nil {
		return nil, err
	}
	start := s.now().Add(time.Duration(p.DelayMin) * time.Minute).Truncate(time.Minute)
	end := start.Add(time.Duration(p.Minutes) * time.Minute)
	b := domain.ComputeBill(domain.BillInput{
		Start: start, End: end, ActualWh: p.Wh, OverstayMin: p.Overstay,
		Rules: domain.SortRulesActive(rules),
	})
	v := b.View(p.Wh, pile, p.Minutes)
	v.StartAt, v.EndAt = start, end
	if !v.IdentityOK {
		return nil, domain.New("pricing_broken", "计价恒等式校验未通过，已拒绝返回试算", 500)
	}
	return v, nil
}

func (s *Service) StartSession(ctx context.Context, in domain.StartSessionInput) (*domain.SessionDetail, error) {
	in.PileCode = strings.TrimSpace(in.PileCode)
	in.PlateNo = strings.TrimSpace(in.PlateNo)
	in.Note = strings.TrimSpace(in.Note)
	if !utf8.ValidString(in.Note) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.StartSession(ctx, in, s.now())
}

// Settle 结算落库：先复核功率上限（防录入超物理可能的电量），再进事务拆段计价。
func (s *Service) Settle(ctx context.Context, code string, in domain.SettleInput) (*domain.SessionDetail, error) {
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	cur, err := s.repo.SessionByCode(ctx, code)
	if err != nil {
		return nil, err
	}
	if !domain.CanAdvance(cur.Status, domain.SessCompleted) {
		return nil, domain.New("invalid_transition",
			fmt.Sprintf("「%s」状态的会话不能结算", cur.Status), 409)
	}
	elapsedSecs := int64(s.now().Sub(cur.StartAt).Seconds())
	if elapsedSecs < 60 {
		elapsedSecs = 60
	}
	// 物理上限：该桩满功率跑满已用时长 × 1.2 容差。超出即录入错误（如把 kWh 填成 Wh 再乘错）。
	powerCeilingWh := elapsedSecs * int64(cur.PowerKw) * 1000 / 3600
	if in.ActualWh*5 > powerCeilingWh*6 {
		return nil, domain.Field("invalid_request", "参数校验未通过", map[string]string{
			"actual_wh": fmt.Sprintf("实际电量超出该桩满功率 %.0f 分钟的理论上限，疑似录入错误", float64(elapsedSecs)/60),
		})
	}
	return s.repo.Settle(ctx, code, in, s.now())
}

func (s *Service) MarkFault(ctx context.Context, code string, in domain.FaultInput) (*domain.SessionDetail, error) {
	in.Reason = strings.TrimSpace(in.Reason)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.AdvanceTo(ctx, code, domain.SessFaulted, "故障："+in.Reason, s.now())
}

func (s *Service) Abort(ctx context.Context, code string, in domain.AbortInput) (*domain.SessionDetail, error) {
	in.Reason = strings.TrimSpace(in.Reason)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.Abort(ctx, code, "弃单："+in.Reason, s.now())
}

func (s *Service) CreateTariff(ctx context.Context, in domain.CreateTariffInput) (*domain.TariffRule, error) {
	in.Code = strings.TrimSpace(in.Code)
	in.Name = strings.TrimSpace(in.Name)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	rule := &domain.TariffRule{
		Code: in.Code, Name: in.Name, Period: in.Period, DayType: in.DayType,
		StartMin: in.StartMin, EndMin: in.EndMin,
		ElecCents: in.ElecCents, ServiceCents: in.ServiceCents,
		Priority: in.Priority, Active: true, CreatedAt: s.now(),
	}
	if err := s.repo.CreateTariff(ctx, rule); err != nil {
		return nil, err
	}
	return rule, nil
}

func (s *Service) ToggleTariff(ctx context.Context, id int64) (*domain.TariffRule, error) {
	if id <= 0 {
		return nil, domain.ErrInvalid
	}
	return s.repo.ToggleTariff(ctx, id)
}

func (s *Service) SetPileStatus(ctx context.Context, code string, in domain.PileStatusInput) (*domain.Pile, error) {
	in.Status = strings.TrimSpace(in.Status)
	in.Note = strings.TrimSpace(in.Note)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.SetPileStatus(ctx, code, in.Status, in.Note, s.now())
}
