package repository

import (
	"context"
	"strconv"
	"time"

	"saassub/internal/domain"
)

const chargingFilter = "s.status IN ('active','past_due')"

// Metrics 汇总口径全部来自 subscriptions / payments 两张表，前端不做二次计算。
// MRR 只累计 active 与 past_due（trialing 计 0），因此「按套餐 MRR 之和 == 总 MRR」恒成立。
func (r *Repo) Metrics(ctx context.Context, months int) (*domain.Metrics, error) {
	if months < 3 {
		months = 3
	}
	if months > 18 {
		months = 18
	}
	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}

	m := &domain.Metrics{GeneratedAt: time.Now().UTC()}

	type kv struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var statuses []kv
	if err := scan(&statuses, `SELECT status AS k, COUNT(*) AS v FROM subscriptions GROUP BY status`); err != nil {
		return nil, err
	}
	for _, s := range statuses {
		switch s.K {
		case domain.StatusTrialing:
			m.TrialingSubs = s.V
		case domain.StatusActive:
			m.ActiveSubs = s.V
		case domain.StatusPastDue:
			m.PastDueSubs = s.V
		case domain.StatusCanceled:
			m.CanceledSubs = s.V
		}
	}

	if err := scan(&m.MRR, `SELECT COALESCE(SUM(s.mrr),0) FROM subscriptions s WHERE `+chargingFilter); err != nil {
		return nil, err
	}
	m.ARR = m.MRR * 12

	var charged struct {
		N   int64 `gorm:"column:n"`
		MRR int64 `gorm:"column:m"`
	}
	if err := scan(&charged, `SELECT COUNT(*) AS n, COALESCE(SUM(s.mrr),0) AS m FROM subscriptions s WHERE `+chargingFilter); err != nil {
		return nil, err
	}
	if charged.N > 0 {
		m.ARPU = divRound(charged.MRR, charged.N)
	}
	if ever := m.ActiveSubs + m.PastDueSubs + m.CanceledSubs; ever > 0 {
		m.ChurnRatePct = round1(float64(m.CanceledSubs) * 100 / float64(ever))
	}
	if started := m.ActiveSubs + m.PastDueSubs + m.CanceledSubs + m.TrialingSubs; started > 0 {
		m.TrialConversion = round1(float64(started-m.TrialingSubs) * 100 / float64(started))
	}

	if err := scan(&m.TotalSubscribers, `SELECT COUNT(*) FROM subscribers`); err != nil {
		return nil, err
	}

	type mp struct {
		Month    string `gorm:"column:bucket"`
		NewSubs  int64  `gorm:"column:new_subs"`
		MRRAdded int64  `gorm:"column:mrr_added"`
	}
	var added []mp
	if err := scan(&added, `SELECT strftime('%Y-%m', s.start_at) AS bucket,
		COUNT(*) AS new_subs, COALESCE(SUM(s.mrr),0) AS mrr_added
		FROM subscriptions s GROUP BY bucket ORDER BY bucket`); err != nil {
		return nil, err
	}
	type cp struct {
		Month   string `gorm:"column:bucket"`
		Canc    int64  `gorm:"column:canc"`
		MRRLost int64  `gorm:"column:mrr_lost"`
	}
	var lost []cp
	if err := scan(&lost, `SELECT strftime('%Y-%m', s.canceled_at) AS bucket,
		COUNT(*) AS canc, COALESCE(SUM(s.mrr),0) AS mrr_lost
		FROM subscriptions s WHERE s.canceled_at IS NOT NULL GROUP BY bucket ORDER BY bucket`); err != nil {
		return nil, err
	}

	lostBy := map[string]cp{}
	for _, l := range lost {
		lostBy[l.Month] = l
	}
	allMonths := map[string]bool{}
	for _, a := range added {
		allMonths[a.Month] = true
	}
	for k := range lostBy {
		allMonths[k] = true
	}
	monthsList := make([]string, 0, len(allMonths))
	for k := range allMonths {
		monthsList = append(monthsList, k)
	}
	sortStrings(monthsList)
	if len(monthsList) > months {
		monthsList = monthsList[len(monthsList)-months:]
	}
	addedBy := map[string]mp{}
	for _, a := range added {
		addedBy[a.Month] = a
	}
	for _, mo := range monthsList {
		p := domain.MonthlyPoint{Month: mo}
		if a, ok := addedBy[mo]; ok {
			p.NewSubs, p.MRRAdded = a.NewSubs, a.MRRAdded
		}
		if l, ok := lostBy[mo]; ok {
			p.Cancellations, p.MRRLost = l.Canc, l.MRRLost
		}
		m.Monthly = append(m.Monthly, p)
	}

	if err := scan(&m.ByPlan, `SELECT p.id AS plan_id, p.code AS plan_code, p.name AS plan_name,
		COUNT(s.id) AS subs, COALESCE(SUM(CASE WHEN `+chargingFilter+` THEN s.mrr ELSE 0 END),0) AS mrr
		FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id
		GROUP BY p.id, p.code, p.name ORDER BY p.price_monthly`); err != nil {
		return nil, err
	}
	m.WindowDescription = "最近 " + strconv.Itoa(months) + " 个自然月（含全部历史订阅的状态口径）"
	return m, nil
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("subscriptions").Count(&n).Error
	return n > 0, err
}

func divRound(a, b int64) int64 {
	if b == 0 {
		return 0
	}
	return int64(float64(a)/float64(b) + 0.5)
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
