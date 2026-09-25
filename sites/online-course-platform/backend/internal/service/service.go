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

// effectivePrice：早鸟截止按「截止日当天 23:59:59 UTC 前」生效，与 seed 共用同一口径。
func effectivePrice(c *domain.Course, at time.Time) (int64, bool) {
	if c.EarlyDeadline != nil && at.Before(c.EarlyDeadline.Add(24*time.Hour)) && c.EarlyPriceCents > 0 {
		return c.EarlyPriceCents, true
	}
	return c.PriceCents, false
}

func (s *Service) finishRow(r *domain.CourseRow, at time.Time) {
	price, early := effectivePrice(&r.Course, at)
	r.EffectivePrice = price
	r.EarlyNow = early
	r.SeatsLeft = r.Capacity - int(r.Occupied)
	if r.SeatsLeft < 0 {
		r.SeatsLeft = 0
	}
	if r.Capacity > 0 {
		p := int(r.Occupied) * 100 / r.Capacity
		if p > 100 {
			p = 100
		}
		r.FillPct = p
	}
}

func (s *Service) ListCourses(ctx context.Context, q domain.CourseListQuery) ([]domain.CourseRow, int64, error) {
	now := s.now()
	rows, total, err := s.repo.ListCourses(ctx, q, now)
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		s.finishRow(&rows[i], now)
	}
	return rows, total, nil
}

type CourseDetail struct {
	Course      *domain.CourseRow      `json:"course"`
	Instructor  *domain.Instructor     `json:"instructor"`
	Chapters    []domain.Chapter       `json:"chapters"`
	Enrollments []domain.EnrollmentRow `json:"recent_enrollments"`
}

func (s *Service) CourseDetailOf(ctx context.Context, code string) (*CourseDetail, error) {
	code = strings.TrimSpace(code)
	if code == "" || !domain.ValidCourseCode(code) {
		return nil, domain.ErrNotFound
	}
	now := s.now()
	row, err := s.repo.CourseRowByCode(ctx, code, now)
	if err != nil {
		return nil, err
	}
	s.finishRow(row, now)
	inst, err := s.repo.InstructorByID(ctx, row.InstructorID)
	if err != nil {
		return nil, err
	}
	chapters, err := s.repo.ChaptersOf(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	enrs, err := s.repo.EnrollmentsFor(ctx, row.ID, 12)
	if err != nil {
		return nil, err
	}
	return &CourseDetail{Course: row, Instructor: inst, Chapters: chapters, Enrollments: enrs}, nil
}

func (s *Service) Instructors(ctx context.Context) ([]domain.InstructorRow, error) {
	return s.repo.ListInstructors(ctx)
}

func (s *Service) Stats(ctx context.Context) (*domain.Stats, error) {
	return s.repo.Stats(ctx, s.now())
}

// Enroll 是老学员 95 折与容量判定的编排层：定价在此算好，
// 「课程在售 + 查重 + 余位」由 repository 在同一事务里兜底。
func (s *Service) Enroll(ctx context.Context, in domain.EnrollInput) (*domain.Enrollment, error) {
	in.CourseCode = strings.TrimSpace(in.CourseCode)
	in.Name = strings.TrimSpace(in.Name)
	in.Phone = strings.TrimSpace(in.Phone)
	in.Source = strings.TrimSpace(in.Source)
	if !utf8.ValidString(in.Name) || !utf8.ValidString(in.Phone) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	now := s.now()
	row, err := s.repo.CourseRowByCode(ctx, in.CourseCode, now)
	if err != nil {
		return nil, err
	}
	if row.Status != domain.CoursePublished {
		return nil, domain.New("not_open", "课程当前不在售", 409)
	}
	list, _ := effectivePrice(&row.Course, now)
	prior, err := s.repo.PriorPaidCount(ctx, in.Phone)
	if err != nil {
		return nil, err
	}
	discount := int64(0)
	if prior >= 3 {
		discount = list * 5 / 100
	}
	return s.repo.Enroll(ctx, repository.EnrollCmd{
		CourseID: row.ID, Name: in.Name, Phone: in.Phone, Source: in.Source,
		ListPrice: list, Discount: discount, Now: now,
	})
}

func (s *Service) Progress(ctx context.Context, id int64, in domain.ProgressInput) (*domain.Enrollment, error) {
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	return s.repo.AdvanceProgress(ctx, id, *in.ProgressPct, s.now())
}

func (s *Service) ChangeCourseStatus(ctx context.Context, code string, in domain.CourseStatusInput) (*domain.Course, error) {
	code = strings.TrimSpace(code)
	in.To = strings.TrimSpace(in.To)
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if !domain.ValidCourseCode(code) {
		return nil, domain.ErrInvalid
	}
	return s.repo.ChangeCourseStatus(ctx, code, in.To, s.now())
}
