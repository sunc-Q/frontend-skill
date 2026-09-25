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

func (s *Service) Stats(ctx context.Context, span int) (*domain.Stats, error) {
	return s.repo.Stats(ctx, span, s.now())
}

// ScheduleFrom 把查询里的日期收敛成时间窗起点：非法或缺省一律落到「今天 00:00 UTC」。
func (s *Service) ScheduleFrom(q domain.ListQuery) time.Time {
	now := s.now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if q.From == "" {
		return today
	}
	parsed, err := time.Parse("2006-01-02", q.From)
	if err != nil {
		return today
	}
	return parsed.UTC()
}

func (s *Service) Schedule(ctx context.Context, q domain.ListQuery) ([]domain.SessionRow, int64, error) {
	rows, total, err := s.repo.ListSessions(ctx, q, s.ScheduleFrom(q))
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (s *Service) Detail(ctx context.Context, id int64) (*domain.SessionDetail, error) {
	row, err := s.repo.Session(ctx, id)
	if err != nil {
		return nil, err
	}
	roster, err := s.repo.Roster(ctx, id, 60)
	if err != nil {
		return nil, err
	}
	if roster == nil {
		roster = []domain.RosterEntry{}
	}
	return &domain.SessionDetail{Session: *row, Roster: roster}, nil
}

func (s *Service) Classes(ctx context.Context) ([]domain.Class, error) {
	return s.repo.Classes(ctx)
}

// Book 落一笔预约。source 缺省按「前台」记账，手机号会被规范化后再比对。
func (s *Service) Book(ctx context.Context, sessionID int64, in domain.CreateBookingInput) (*repository.BookResult, error) {
	in.Phone = strings.TrimSpace(in.Phone)
	if in.Source == "" {
		in.Source = "front_desk"
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if !utf8.ValidString(in.Phone) {
		return nil, domain.ErrInvalid
	}
	res, err := s.repo.CreateBooking(ctx, sessionID, in, s.now())
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (s *Service) CreateMember(ctx context.Context, in domain.CreateMemberInput) (*domain.Member, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Phone = strings.TrimSpace(in.Phone)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if !utf8.ValidString(in.Name) {
		return nil, domain.ErrInvalid
	}
	days := in.DaysValid
	if days == 0 {
		days = map[string]int{
			domain.CardTrial: 7, domain.CardTenSession: 180, domain.CardMonthly: 30,
			domain.CardQuarterly: 90, domain.CardAnnual: 365,
		}[in.CardType]
	}
	now := s.now()
	m := &domain.Member{
		Name: in.Name, Phone: in.Phone, CardType: in.CardType,
		Credits: in.Credits, JoinedAt: now,
		ExpiresAt: now.AddDate(0, 0, days), Active: true,
	}
	if err := s.repo.CreateMember(ctx, m); err != nil {
		return nil, err
	}
	return m, nil
}
