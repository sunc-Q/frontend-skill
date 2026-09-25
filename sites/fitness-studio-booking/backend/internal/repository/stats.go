package repository

import (
	"context"
	"strconv"
	"time"

	"bizsite/internal/domain"
)

// Stats 汇总口径全部在这一个查询层里定死，前端只做展示：
//   - 窗口 = 以「今天」为中心，前后各 span 天（span 限制 3..14）；
//   - 占座率 = 窗口内 confirmed 预约 ÷ 窗口内未取消课节的容量之和；
//   - 收入 = 已开课（start_at < now）的课节里 confirmed 人数 × 课程单价；
//   - 未到率 = 已开课课节里 no_show ÷（confirmed + no_show + canceled）。
func (r *Repo) Stats(ctx context.Context, span int, now time.Time) (*domain.Stats, error) {
	if span < 3 {
		span = 3
	}
	if span > 14 {
		span = 14
	}
	utc := now.UTC()
	day := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
	from := day.AddDate(0, 0, -(span - 1))
	until := day.AddDate(0, 0, span)

	st := &domain.Stats{GeneratedAt: utc}
	st.Window = "以今天为中心，前后各 " + strconv.Itoa(span) + " 天的课表与预约"

	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}

	var sess struct {
		Total int64 `gorm:"column:total"`
		Open  int64 `gorm:"column:open"`
		Seats int64 `gorm:"column:seats"`
	}
	if err := scan(&sess, `SELECT COUNT(*) AS total,
		SUM(CASE WHEN s.status = 'open' THEN 1 ELSE 0 END) AS open,
		COALESCE(SUM(CASE WHEN s.status <> 'canceled' THEN c.capacity ELSE 0 END), 0) AS seats
		FROM sessions s JOIN classes c ON c.id = s.class_id
		WHERE s.start_at >= ? AND s.start_at < ?`, from, until); err != nil {
		return nil, err
	}
	st.TotalSessions, st.OpenSessions, st.SeatTotal = sess.Total, sess.Open, sess.Seats

	type kv struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var bk []kv
	if err := scan(&bk, `SELECT b.status AS k, COUNT(*) AS v
		FROM bookings b JOIN sessions s ON s.id = b.session_id
		WHERE s.start_at >= ? AND s.start_at < ? GROUP BY b.status`, from, until); err != nil {
		return nil, err
	}
	for _, x := range bk {
		st.TotalBookings += x.V
		switch x.K {
		case domain.BookingConfirmed:
			st.Confirmed = x.V
		case domain.BookingWaitlist:
			st.Waitlist = x.V
		case domain.BookingCanceled:
			st.Canceled = x.V
		case domain.BookingNoShow:
			st.NoShow = x.V
		}
	}

	if st.SeatTotal > 0 {
		st.OccupancyPct = round1(float64(st.Confirmed) * 100 / float64(st.SeatTotal))
	}
	if st.TotalSessions > 0 {
		st.AvgPerSession = round1(float64(st.Confirmed) / float64(st.TotalSessions))
	}

	var hist struct {
		Confirmed int64 `gorm:"column:confirmed"`
		NoShow    int64 `gorm:"column:no_show"`
		Canceled  int64 `gorm:"column:canceled"`
		Revenue   int64 `gorm:"column:revenue"`
	}
	if err := scan(&hist, `SELECT
		COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed,
		COALESCE(SUM(CASE WHEN b.status = 'no_show' THEN 1 ELSE 0 END), 0) AS no_show,
		COALESCE(SUM(CASE WHEN b.status = 'canceled' THEN 1 ELSE 0 END), 0) AS canceled,
		COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN c.price_cents ELSE 0 END), 0) AS revenue
		FROM bookings b
		JOIN sessions s ON s.id = b.session_id
		JOIN classes c ON c.id = s.class_id
		WHERE s.start_at >= ? AND s.start_at < ?`, from, utc); err != nil {
		return nil, err
	}
	st.RevenueCents = hist.Revenue
	if ever := hist.Confirmed + hist.NoShow + hist.Canceled; ever > 0 {
		st.NoShowRatePct = round1(float64(hist.NoShow) * 100 / float64(ever))
	}

	var mem struct {
		Total  int64 `gorm:"column:total"`
		Active int64 `gorm:"column:active"`
	}
	if err := scan(&mem, `SELECT COUNT(*) AS total,
		COALESCE(SUM(CASE WHEN active = 1 AND expires_at >= ? THEN 1 ELSE 0 END), 0) AS active
		FROM members`, utc); err != nil {
		return nil, err
	}
	st.Members, st.ActiveMembers = mem.Total, mem.Active

	var err error
	st.Days, st.ByCategory, st.ByCoach, st.ByCard, err = r.rollups(ctx, from, until)
	if err != nil {
		return nil, err
	}
	return st, nil
}

const confirmedAgg = `LEFT JOIN (
	SELECT session_id,
		SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
		SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled
	FROM bookings GROUP BY session_id
) b ON b.session_id = s.id`

func (r *Repo) rollups(ctx context.Context, from, until time.Time) (
	[]domain.DayRollup, []domain.CategoryRollup, []domain.CoachRollup, []domain.CardRollup, error) {

	db := r.db.WithContext(ctx)

	var days []domain.DayRollup
	if err := db.Table("sessions AS s").
		Select(`strftime('%Y-%m-%d', s.start_at) AS day, COUNT(*) AS sessions,
			COALESCE(SUM(b.confirmed), 0) AS confirmed,
			COALESCE(SUM(b.canceled), 0) AS canceled,
			SUM(c.capacity) AS seats`).
		Joins("JOIN classes c ON c.id = s.class_id").
		Joins(confirmedAgg).
		Where("s.start_at >= ? AND s.start_at < ?", from, until).
		Group("day").Order("day").
		Scan(&days).Error; err != nil {
		return nil, nil, nil, nil, err
	}

	var cats []domain.CategoryRollup
	if err := db.Table("sessions AS s").
		Select(`c.category AS category, COUNT(*) AS sessions,
			COALESCE(SUM(b.confirmed), 0) AS confirmed, SUM(c.capacity) AS seats`).
		Joins("JOIN classes c ON c.id = s.class_id").
		Joins(confirmedAgg).
		Where("s.start_at >= ? AND s.start_at < ? AND s.status <> ?", from, until, domain.SessionCanceled).
		Group("c.category").Order("confirmed desc").
		Scan(&cats).Error; err != nil {
		return nil, nil, nil, nil, err
	}
	for i := range cats {
		if cats[i].Seats > 0 {
			cats[i].Occupancy = round1(float64(cats[i].Confirmed) * 100 / float64(cats[i].Seats))
		}
	}

	var coaches []domain.CoachRollup
	if err := db.Table("sessions AS s").
		Select(`c.coach AS coach, c.coach_level AS level, COUNT(*) AS sessions,
			COALESCE(SUM(b.confirmed), 0) AS confirmed, SUM(c.capacity) AS seats`).
		Joins("JOIN classes c ON c.id = s.class_id").
		Joins(confirmedAgg).
		Where("s.start_at >= ? AND s.start_at < ? AND s.status <> ?", from, until, domain.SessionCanceled).
		Group("c.coach, c.coach_level").Order("confirmed desc").
		Scan(&coaches).Error; err != nil {
		return nil, nil, nil, nil, err
	}
	for i := range coaches {
		if coaches[i].Seats > 0 {
			coaches[i].Occupancy = round1(float64(coaches[i].Confirmed) * 100 / float64(coaches[i].Seats))
		}
	}

	var cards []domain.CardRollup
	if err := db.Table("members").
		Select("card_type, COUNT(*) AS members, COALESCE(SUM(credits), 0) AS credits").
		Group("card_type").Order("members desc").
		Scan(&cards).Error; err != nil {
		return nil, nil, nil, nil, err
	}
	return days, cats, coaches, cards, nil
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
