package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

// courseSelect 是列表/详情共用的读取投影：JOIN 讲师、子查询统计章节数与占座数，
// effective_price / fill_ratio 两个别名只用于 ORDER BY（响应里的派生值由 service 用 Go 重算，
// 保证「价格 = 早鸟判断」与服务器时钟同一次观测）。
const courseSelect = `c.*, i.name AS instructor_name,
	COALESCE((SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = c.id),0) AS chapter_count,
	COALESCE((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('active','completed')),0) AS occupied,
	COALESCE((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'waitlist'),0) AS waitlisted,
	CASE WHEN c.early_deadline IS NOT NULL AND c.early_deadline > ? THEN c.early_price_cents ELSE c.price_cents END AS effective_price,
	CASE WHEN c.capacity > 0 THEN CAST((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status IN ('active','completed')) AS REAL) / c.capacity ELSE 0 END AS fill_ratio`

func (r *Repo) courseQuery(ctx context.Context, now time.Time) *gorm.DB {
	return r.db.WithContext(ctx).Table("courses AS c").
		Select(courseSelect, now.UTC()).
		Joins("JOIN instructors i ON i.id = c.instructor_id")
}

func (r *Repo) ListCourses(ctx context.Context, q domain.CourseListQuery, now time.Time) ([]domain.CourseRow, int64, error) {
	base := r.courseQuery(ctx, now)
	if q.Status != "" {
		base = base.Where("c.status = ?", q.Status)
	}
	if q.Domain != "" {
		base = base.Where("c.domain = ?", q.Domain)
	}
	if q.Level != "" {
		base = base.Where("c.level = ?", q.Level)
	}
	if q.EarlyOnly {
		base = base.Where("c.early_deadline IS NOT NULL AND c.early_deadline > ?", now.UTC())
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(c.title LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.summary LIKE ? ESCAPE '\\' OR i.name LIKE ? ESCAPE '\\')", like, like, like, like)
	}

	var total int64
	if err := r.db.WithContext(ctx).Table("courses AS c").
		Joins("JOIN instructors i ON i.id = c.instructor_id").
		Scopes(func(d *gorm.DB) *gorm.DB { return applyFilters(d, q, now) }).
		Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []domain.CourseRow
	err := base.Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", c.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

func applyFilters(d *gorm.DB, q domain.CourseListQuery, now time.Time) *gorm.DB {
	if q.Status != "" {
		d = d.Where("c.status = ?", q.Status)
	}
	if q.Domain != "" {
		d = d.Where("c.domain = ?", q.Domain)
	}
	if q.Level != "" {
		d = d.Where("c.level = ?", q.Level)
	}
	if q.EarlyOnly {
		d = d.Where("c.early_deadline IS NOT NULL AND c.early_deadline > ?", now.UTC())
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		d = d.Where("(c.title LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.summary LIKE ? ESCAPE '\\' OR i.name LIKE ? ESCAPE '\\')", like, like, like, like)
	}
	return d
}

func (r *Repo) CourseRowByCode(ctx context.Context, code string, now time.Time) (*domain.CourseRow, error) {
	var row domain.CourseRow
	err := r.courseQuery(ctx, now).Where("c.code = ?", code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

func (r *Repo) CourseByID(ctx context.Context, id int64) (*domain.Course, error) {
	var c domain.Course
	err := r.db.WithContext(ctx).First(&c, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repo) ListInstructors(ctx context.Context) ([]domain.InstructorRow, error) {
	var out []domain.InstructorRow
	err := r.db.WithContext(ctx).Table("instructors AS i").
		Select(`i.*,
			COALESCE((SELECT COUNT(*) FROM courses c WHERE c.instructor_id = i.id),0) AS course_count,
			COALESCE((SELECT COUNT(*) FROM courses c WHERE c.instructor_id = i.id AND c.status = 'published'),0) AS published_count,
			COALESCE((SELECT COUNT(DISTINCT e.phone) FROM courses c
				JOIN enrollments e ON e.course_id = c.id AND e.status IN ('active','completed')
				WHERE c.instructor_id = i.id),0) AS learner_count`).
		Order("course_count desc, i.id asc").Limit(100).
		Scan(&out).Error
	return out, err
}

func (r *Repo) InstructorByID(ctx context.Context, id int64) (*domain.Instructor, error) {
	var i domain.Instructor
	err := r.db.WithContext(ctx).First(&i, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &i, nil
}

func (r *Repo) ChaptersOf(ctx context.Context, courseID int64) ([]domain.Chapter, error) {
	var out []domain.Chapter
	err := r.db.WithContext(ctx).Where("course_id = ?", courseID).
		Order("seq asc").Limit(200).Find(&out).Error
	return out, err
}

func (r *Repo) EnrollmentsFor(ctx context.Context, courseID int64, limit int) ([]domain.EnrollmentRow, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	var raw []domain.Enrollment
	err := r.db.WithContext(ctx).Where("course_id = ?", courseID).
		Order("enrolled_at desc, id desc").Limit(limit).Find(&raw).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.EnrollmentRow, 0, len(raw))
	for _, e := range raw {
		out = append(out, toRow(&e))
	}
	return out, nil
}

func toRow(e *domain.Enrollment) domain.EnrollmentRow {
	return domain.EnrollmentRow{
		ID: e.ID, LearnerName: e.LearnerName, MaskedPhone: domain.MaskPhone(e.Phone),
		Status: e.Status, ProgressPct: e.ProgressPct,
		ListPrice: e.ListPrice, Discount: e.Discount, PaidCents: e.PaidCents,
		Source: e.Source, EnrolledAt: e.EnrolledAt,
	}
}

func (r *Repo) EnrollmentByID(ctx context.Context, id int64) (*domain.Enrollment, error) {
	var e domain.Enrollment
	err := r.db.WithContext(ctx).First(&e, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// PriorPaidCount 统计该手机号在其它课程已生效（active/completed）的报名数，
// service 用它决定老学员 95 折。
func (r *Repo) PriorPaidCount(ctx context.Context, phone string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.Enrollment{}).
		Where("phone = ? AND status IN ?", phone, []string{domain.EnrollActive, domain.EnrollCompleted}).
		Count(&n).Error
	return n, err
}

type EnrollCmd struct {
	CourseID  int64
	Name      string
	Phone     string
	Source    string
	ListPrice int64
	Discount  int64
	Now       time.Time
}

// Enroll 在一个事务里完成「课程在售 → 查重 → 判余位 → 定价落库」。
// 满座转候补（不收费）；(course_id, phone) 复合唯一索引兜底并发重复报名。
func (r *Repo) Enroll(ctx context.Context, in EnrollCmd) (*domain.Enrollment, error) {
	var created *domain.Enrollment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var c domain.Course
		if err := tx.First(&c, in.CourseID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if c.Status != domain.CoursePublished {
			return domain.New("not_open", "课程当前不在售", 409)
		}
		var dup int64
		if err := tx.Model(&domain.Enrollment{}).
			Where("course_id = ? AND phone = ?", c.ID, in.Phone).Count(&dup).Error; err != nil {
			return err
		}
		if dup > 0 {
			return domain.New("already_enrolled", "该手机号已报名此课程（含历史记录）", 409)
		}
		var occupied int64
		if err := tx.Model(&domain.Enrollment{}).
			Where("course_id = ? AND status IN ?", c.ID, []string{domain.EnrollActive, domain.EnrollCompleted}).
			Count(&occupied).Error; err != nil {
			return err
		}
		e := domain.Enrollment{
			CourseID: c.ID, LearnerName: in.Name, Phone: in.Phone, Source: in.Source,
			ListPrice: in.ListPrice, EnrolledAt: in.Now,
		}
		if occupied >= int64(c.Capacity) {
			e.Status = domain.EnrollWaitlist
			e.Discount = 0
			e.PaidCents = 0
		} else {
			e.Status = domain.EnrollActive
			e.Discount = in.Discount
			e.PaidCents = in.ListPrice - in.Discount
		}
		if err := tx.Create(&e).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return domain.New("already_enrolled", "该手机号已报名此课程（含历史记录）", 409)
			}
			return err
		}
		created = &e
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// AdvanceProgress 只推进在读（active）学员；到 100% 自动结课。其余状态一律 409。
func (r *Repo) AdvanceProgress(ctx context.Context, id int64, pct int, now time.Time) (*domain.Enrollment, error) {
	var updated *domain.Enrollment
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var e domain.Enrollment
		if err := tx.First(&e, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		switch e.Status {
		case domain.EnrollActive:
		case domain.EnrollWaitlist:
			return domain.New("invalid_state", "候补学员尚未缴费开课，不能记录学习进度", 409)
		case domain.EnrollCompleted:
			return domain.New("invalid_state", "该学员已结课，进度不再更新", 409)
		default:
			return domain.New("invalid_state", "已退课记录不能更新进度", 409)
		}
		e.ProgressPct = pct
		if pct >= 100 {
			e.Status = domain.EnrollCompleted
		}
		if err := tx.Model(&domain.Enrollment{}).Where("id = ?", e.ID).
			Updates(map[string]any{"progress_pct": e.ProgressPct, "status": e.Status}).Error; err != nil {
			return err
		}
		updated = &e
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// ChangeCourseStatus 实现上架状态机：draft→published（盖上架时间）、published→archived，
// 其余迁移（含原地不动）一律 409。
func (r *Repo) ChangeCourseStatus(ctx context.Context, code, to string, now time.Time) (*domain.Course, error) {
	var updated *domain.Course
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var c domain.Course
		if err := tx.Where("code = ?", code).First(&c).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		switch {
		case c.Status == domain.CourseDraft && to == domain.CoursePublished:
			c.Status = to
			c.PublishedAt = &now
		case c.Status == domain.CoursePublished && to == domain.CourseArchived:
			c.Status = to
		default:
			return domain.New("invalid_transition", "不允许的状态迁移："+c.Status+"→"+to, 409)
		}
		if err := tx.Model(&domain.Course{}).Where("id = ?", c.ID).
			Updates(map[string]any{"status": c.Status, "published_at": c.PublishedAt}).Error; err != nil {
			return err
		}
		updated = &c
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}
