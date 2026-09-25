package domain

import (
	"regexp"
	"time"
	"unicode/utf8"
)

// 金额一律以「分」整型存储（人民币），展示层再格式化。

type Instructor struct {
	ID       int64     `gorm:"primaryKey" json:"id"`
	Name     string    `gorm:"size:32" json:"name"`
	Title    string    `gorm:"size:32" json:"title"`
	Org      string    `gorm:"size:64" json:"org"`
	Bio      string    `gorm:"size:255" json:"bio"`
	JoinedAt time.Time `json:"joined_at"`
}

const (
	CourseDraft     = "draft"
	CoursePublished = "published"
	CourseArchived  = "archived"
)

type Course struct {
	ID              int64      `gorm:"primaryKey" json:"id"`
	Code            string     `gorm:"uniqueIndex;size:32" json:"code"`
	Title           string     `gorm:"size:96" json:"title"`
	Domain          string     `gorm:"size:24;index" json:"domain"`
	Level           string     `gorm:"size:12;index" json:"level"`
	InstructorID    int64      `gorm:"index" json:"instructor_id"`
	PriceCents      int64      `json:"price_cents"`
	EarlyPriceCents int64      `json:"early_price_cents"`
	EarlyDeadline   *time.Time `json:"early_deadline"`
	Capacity        int        `json:"capacity"`
	Hours           int        `json:"hours"`
	Status          string     `gorm:"size:16;index" json:"status"`
	Summary         string     `gorm:"size:255" json:"summary"`
	PublishedAt     *time.Time `json:"published_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type Chapter struct {
	ID          int64  `gorm:"primaryKey" json:"id"`
	CourseID    int64  `gorm:"index" json:"course_id"`
	Seq         int    `json:"seq"`
	Title       string `gorm:"size:96" json:"title"`
	DurationMin int    `json:"duration_min"`
	FreePreview bool   `json:"free_preview"`
}

const (
	EnrollActive    = "active"
	EnrollCompleted = "completed"
	EnrollWaitlist  = "waitlist"
	EnrollDropped   = "dropped"
)

// Enrollment 一名学员对一门课只有一条记录（course_id+phone 复合唯一），
// 退课后再次报名同样返回 409——记录是学员与课程之间的终身上籍凭证。
type Enrollment struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	CourseID    int64     `gorm:"uniqueIndex:idx_course_phone" json:"course_id"`
	Phone       string    `gorm:"uniqueIndex:idx_course_phone;size:11" json:"-"`
	LearnerName string    `gorm:"size:32" json:"learner_name"`
	Status      string    `gorm:"size:16;index" json:"status"`
	ProgressPct int       `json:"progress_pct"`
	ListPrice   int64     `json:"list_price"`
	Discount    int64     `json:"discount"`
	PaidCents   int64     `json:"paid_cents"`
	Source      string    `gorm:"size:16" json:"source"`
	EnrolledAt  time.Time `gorm:"index" json:"enrolled_at"`
}

// ---- 读取视图 ----

type CourseRow struct {
	Course
	InstructorName string `json:"instructor_name"`
	ChapterCount   int64  `json:"chapter_count"`
	Occupied       int64  `json:"occupied"`
	Waitlisted     int64  `json:"waitlisted"`
	// 以下派生字段由 service 依据当前时间计算，不从 SQL 取。
	EffectivePrice int64 `gorm:"-" json:"effective_price"`
	EarlyNow       bool  `gorm:"-" json:"early_now"`
	SeatsLeft      int   `gorm:"-" json:"seats_left"`
	FillPct        int   `gorm:"-" json:"fill_pct"`
}

type EnrollmentRow struct {
	ID          int64     `json:"id"`
	LearnerName string    `json:"learner_name"`
	MaskedPhone string    `json:"masked_phone"`
	Status      string    `json:"status"`
	ProgressPct int       `json:"progress_pct"`
	ListPrice   int64     `json:"list_price"`
	Discount    int64     `json:"discount"`
	PaidCents   int64     `json:"paid_cents"`
	Source      string    `json:"source"`
	EnrolledAt  time.Time `json:"enrolled_at"`
}

type InstructorRow struct {
	Instructor
	CourseCount    int64 `json:"course_count"`
	PublishedCount int64 `json:"published_count"`
	LearnerCount   int64 `json:"learner_count"`
}

type DomainRollup struct {
	Domain       string `json:"domain"`
	Courses      int64  `json:"courses"`
	Capacity     int64  `json:"capacity"`
	Occupied     int64  `json:"occupied"`
	Learners     int64  `json:"learners"`
	GMVCents     int64  `json:"gmv_cents"`
	FillPct      int    `json:"fill_pct"`
	EarlyCourses int64  `json:"early_courses"`
}

type MonthPoint struct {
	Month     string `json:"month"`
	Enrolls   int64  `json:"enrolls"`
	Revenue   int64  `json:"revenue"`
	Completed int64  `json:"completed"`
}

type Stats struct {
	PublishedCourses int64          `json:"published_courses"`
	TotalCourses     int64          `json:"total_courses"`
	PayingLearners   int64          `json:"paying_learners"`
	ActiveLearners   int64          `json:"active_learners"`
	CompletedCount   int64          `json:"completed_count"`
	WaitlistedCount  int64          `json:"waitlisted_count"`
	DroppedCount     int64          `json:"dropped_count"`
	GMVCents         int64          `json:"gmv_cents"`
	FillPct          int            `json:"fill_pct"`
	CompletionRate   float64        `json:"completion_rate_pct"`
	DiscountTotal    int64          `json:"discount_total"`
	ByDomain         []DomainRollup `json:"by_domain"`
	Monthly          []MonthPoint   `json:"monthly"`
	GeneratedAt      time.Time      `json:"generated_at"`
	Window           string         `json:"window"`
}

// ---- 写入 DTO ----

var (
	phoneRe = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
	codeRe  = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
)

var validSources = map[string]bool{
	"official": true, "referral": true, "campus": true, "ad": true,
}

type EnrollInput struct {
	CourseCode string `json:"course_code"`
	Name       string `json:"name"`
	Phone      string `json:"phone"`
	Source     string `json:"source"`
}

func (in EnrollInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !codeRe.MatchString(in.CourseCode) || len(in.CourseCode) < 2 || len(in.CourseCode) > 32 {
		errs["course_code"] = "课程标识需为 2-32 位字母、数字、- 或 _"
	}
	if n := utf8.RuneCountInString(in.Name); n < 2 || n > 32 {
		errs["name"] = "姓名需为 2-32 个字符"
	}
	if !phoneRe.MatchString(in.Phone) {
		errs["phone"] = "手机号需为 11 位大陆号码（1 开头，第二位 3-9）"
	}
	if !validSources[in.Source] {
		errs["source"] = "source 只能是 official / referral / campus / ad"
	}
	return errs, len(errs) == 0
}

type ProgressInput struct {
	ProgressPct *int `json:"progress_pct"`
}

func (in ProgressInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if in.ProgressPct == nil {
		errs["progress_pct"] = "progress_pct 必填"
	} else if *in.ProgressPct < 0 || *in.ProgressPct > 100 {
		errs["progress_pct"] = "progress_pct 需在 0-100 之间"
	}
	return errs, len(errs) == 0
}

type CourseStatusInput struct {
	To string `json:"to"`
}

func (in CourseStatusInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if in.To != CoursePublished && in.To != CourseArchived {
		errs["to"] = "to 只能是 published 或 archived"
	}
	return errs, len(errs) == 0
}

func ValidCourseStatus(s string) bool {
	return s == CourseDraft || s == CoursePublished || s == CourseArchived
}

func ValidCourseCode(code string) bool {
	return len(code) >= 2 && len(code) <= 32 && codeRe.MatchString(code)
}

// MaskPhone 对外展示手机号：只留前 3 位与后 4 位。
func MaskPhone(p string) string {
	r := []rune(p)
	if len(r) < 7 {
		return "****"
	}
	return string(r[:3]) + "****" + string(r[len(r)-4:])
}
