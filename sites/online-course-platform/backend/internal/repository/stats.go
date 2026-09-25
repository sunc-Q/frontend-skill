package repository

import (
	"context"
	"time"

	"bizsite/internal/domain"
)

// payingFilter：计入营收与占座口径的报名状态（active / completed）。
const payingFilter = "e.status IN ('active','completed')"

// Stats 汇总口径全部来自 courses / enrollments，前端不做二次计算。
// GMV 只累计已生效报名的实付金额；候补（未收费）与退课不计。
func (r *Repo) Stats(ctx context.Context, now time.Time) (*domain.Stats, error) {
	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}
	s := &domain.Stats{GeneratedAt: now.UTC()}

	if err := scan(&s.TotalCourses, `SELECT COUNT(*) FROM courses`); err != nil {
		return nil, err
	}
	if err := scan(&s.PublishedCourses, `SELECT COUNT(*) FROM courses WHERE status = 'published'`); err != nil {
		return nil, err
	}

	type kv struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var statuses []kv
	if err := scan(&statuses, `SELECT status AS k, COUNT(*) AS v FROM enrollments GROUP BY status`); err != nil {
		return nil, err
	}
	for _, st := range statuses {
		switch st.K {
		case domain.EnrollActive:
			s.ActiveLearners = st.V
		case domain.EnrollCompleted:
			s.CompletedCount = st.V
		case domain.EnrollWaitlist:
			s.WaitlistedCount = st.V
		case domain.EnrollDropped:
			s.DroppedCount = st.V
		}
	}
	s.PayingLearners = s.ActiveLearners + s.CompletedCount

	if err := scan(&s.GMVCents, `SELECT COALESCE(SUM(e.paid_cents),0) FROM enrollments e WHERE `+payingFilter); err != nil {
		return nil, err
	}
	if err := scan(&s.DiscountTotal, `SELECT COALESCE(SUM(e.discount),0) FROM enrollments e WHERE `+payingFilter); err != nil {
		return nil, err
	}
	var capAgg struct {
		Cap int64 `gorm:"column:cap"`
		Occ int64 `gorm:"column:occ"`
	}
	if err := scan(&capAgg, `SELECT COALESCE(SUM(c.capacity),0) AS cap,
		COALESCE(SUM((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND `+payingFilter+`)),0) AS occ
		FROM courses c WHERE c.status = 'published'`); err != nil {
		return nil, err
	}
	if capAgg.Cap > 0 {
		s.FillPct = pct(capAgg.Occ, capAgg.Cap)
	}
	if s.PayingLearners > 0 {
		s.CompletionRate = round1(float64(s.CompletedCount) * 100 / float64(s.PayingLearners))
	}

	// 先按课程预聚合再 JOIN，避免一对多 JOIN 把 SUM(c.capacity) 重复计数。
	if err := scan(&s.ByDomain, `SELECT c.domain AS domain,
		COUNT(*) AS courses, SUM(c.capacity) AS capacity,
		COALESCE(SUM(a.occupied),0) AS occupied,
		COALESCE(SUM(a.learners),0) AS learners,
		COALESCE(SUM(a.gmv),0) AS gmv_cents,
		SUM(CASE WHEN c.early_deadline IS NOT NULL AND c.early_deadline > ? THEN 1 ELSE 0 END) AS early_courses
		FROM courses c
		LEFT JOIN (
			SELECT e.course_id,
				SUM(CASE WHEN `+payingFilter+` THEN 1 ELSE 0 END) AS occupied,
				COUNT(DISTINCT CASE WHEN `+payingFilter+` THEN e.phone END) AS learners,
				SUM(CASE WHEN `+payingFilter+` THEN e.paid_cents ELSE 0 END) AS gmv
			FROM enrollments e GROUP BY e.course_id
		) a ON a.course_id = c.id
		WHERE c.status = 'published'
		GROUP BY c.domain ORDER BY gmv_cents DESC, c.domain ASC`, now.UTC()); err != nil {
		return nil, err
	}
	for i := range s.ByDomain {
		d := &s.ByDomain[i]
		d.FillPct = pct(d.Occupied, d.Capacity)
	}

	type mrow struct {
		Month     string `gorm:"column:bucket"`
		Enrolls   int64  `gorm:"column:enrolls"`
		Revenue   int64  `gorm:"column:revenue"`
		Completed int64  `gorm:"column:completed"`
	}
	var enrolls []mrow
	if err := scan(&enrolls, `SELECT strftime('%Y-%m', e.enrolled_at) AS bucket, COUNT(*) AS enrolls,
		COALESCE(SUM(CASE WHEN `+payingFilter+` THEN e.paid_cents ELSE 0 END),0) AS revenue
		FROM enrollments e WHERE e.status != 'dropped' GROUP BY bucket ORDER BY bucket`); err != nil {
		return nil, err
	}
	var done []mrow
	if err := scan(&done, `SELECT strftime('%Y-%m', e.enrolled_at) AS bucket, COUNT(*) AS completed
		FROM enrollments e WHERE e.status = 'completed' GROUP BY bucket ORDER BY bucket`); err != nil {
		return nil, err
	}
	doneBy := map[string]int64{}
	allMonths := map[string]bool{}
	for _, d := range done {
		doneBy[d.Month] = d.Completed
		allMonths[d.Month] = true
	}
	byMonth := map[string]mrow{}
	for _, a := range enrolls {
		byMonth[a.Month] = a
		allMonths[a.Month] = true
	}
	months := make([]string, 0, len(allMonths))
	for k := range allMonths {
		months = append(months, k)
	}
	sortStrings(months)
	for _, mo := range months {
		p := domain.MonthPoint{Month: mo, Completed: doneBy[mo]}
		if a, ok := byMonth[mo]; ok {
			p.Enrolls, p.Revenue = a.Enrolls, a.Revenue
		}
		s.Monthly = append(s.Monthly, p)
	}
	s.Window = "全量历史口径（GMV 只含已生效报名的实付）"
	return s, nil
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("courses").Count(&n).Error
	return n > 0, err
}

func pct(part, whole int64) int {
	if whole <= 0 {
		return 0
	}
	return int((part*100 + whole/2) / whole)
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
