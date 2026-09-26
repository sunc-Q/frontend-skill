package repository

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"bizsite/internal/domain"
)

// 营收口径：只有 completed 会话产生金额；aborted/faulted 不计费。
const billedWhere = "status = 'completed'"

type statusRow struct {
	K string `gorm:"column:k"`
	V int64  `gorm:"column:v"`
}

type identityRow struct {
	TotalMismatch  int64 `gorm:"column:total_mismatch"`
	EnergyMismatch int64 `gorm:"column:energy_mismatch"`
	SettledFlag    int64 `gorm:"column:settled_flag"`
	OpenOverlap    int64 `gorm:"column:open_overlap"`
}

// Stats 汇总全部在本层一次算完，前端不做二次计算；
// 恒等式（总额=电费+服务费+占用费、Σ分时拆分==实际电量、completed⇔已结算时间戳）
// 实时自检并对外公布。
func (r *Repo) Stats(ctx context.Context, now time.Time, days int) (*domain.Stats, error) {
	if days < 7 {
		days = 7
	}
	if days > 30 {
		days = 30
	}
	db := r.db.WithContext(ctx)
	// 业务「今天」固定为 UTC+8 日历日（与 SQL 里的 date(start_at,'+8 hours') 同口径）；
	// /health 的 UTC 时间不能拿来做日期断言，这是历史轮次踩过的双时钟坑。
	cst := now.UTC().Add(domain.BizOffsetHours * time.Hour)
	s := &domain.Stats{GeneratedAt: now, Today: cst.Format("2006-01-02"), TrendDays: days}
	byStatus := map[string]int64{}

	var totals struct {
		N        int64 `gorm:"column:n"`
		Billed   int64 `gorm:"column:nb"`
		Wh       int64 `gorm:"column:wh"`
		Elec     int64 `gorm:"column:e"`
		Service  int64 `gorm:"column:sv"`
		Overstay int64 `gorm:"column:o"`
		Revenue  int64 `gorm:"column:r"`
		Peak     int64 `gorm:"column:pk"`
		Flat     int64 `gorm:"column:fl"`
		Valley   int64 `gorm:"column:vl"`
		OstayN   int64 `gorm:"column:ostay_n"`
		DurSum   int64 `gorm:"column:du"`
	}
	if err := db.Raw(`SELECT COUNT(*) AS n,
		COALESCE(SUM(CASE WHEN ` + billedWhere + ` THEN 1 ELSE 0 END),0) AS nb,
		COALESCE(SUM(CASE WHEN ` + billedWhere + ` THEN actual_wh ELSE 0 END),0) AS wh,
		COALESCE(SUM(elec_cents),0) AS e, COALESCE(SUM(service_cents),0) AS sv,
		COALESCE(SUM(overstay_cents),0) AS o,
		COALESCE(SUM(CASE WHEN ` + billedWhere + ` THEN total_cents ELSE 0 END),0) AS r,
		COALESCE(SUM(seg_peak_wh),0) AS pk, COALESCE(SUM(seg_flat_wh),0) AS fl,
		COALESCE(SUM(seg_valley_wh),0) AS vl,
		COALESCE(SUM(CASE WHEN ` + billedWhere + ` AND overstay_min > 0 THEN 1 ELSE 0 END),0) AS ostay_n,
		COALESCE(SUM(CASE WHEN ` + billedWhere + `
			THEN CAST((julianday(end_at)-julianday(start_at))*1440 AS INTEGER) ELSE 0 END),0) AS du
		FROM charge_sessions`).Scan(&totals).Error; err != nil {
		return nil, err
	}
	s.TotalSessions = totals.N
	s.BilledCount = totals.Billed
	s.TotalKwh = totals.Wh / 1000
	s.ElecCents = totals.Elec
	s.ServiceCents = totals.Service
	s.OverstayCents = totals.Overstay
	s.RevenueCents = totals.Revenue
	s.PeakKwh = totals.Peak / 1000
	s.FlatKwh = totals.Flat / 1000
	s.ValleyKwh = totals.Valley / 1000
	if totals.Wh > 0 {
		s.PeakPct = round1(float64(totals.Peak) * 100 / float64(totals.Wh))
		s.ValleyPct = round1(float64(totals.Valley) * 100 / float64(totals.Wh))
		s.AvgPriceCents = domain.RoundHalfUpInt(totals.Revenue*1000, totals.Wh)
	}
	if totals.Billed > 0 {
		s.AvgDurMin = totals.DurSum / totals.Billed
		s.OverstayRatePct = round1(float64(totals.OstayN) * 100 / float64(totals.Billed))
	}

	var today struct {
		N   int64 `gorm:"column:n"`
		Wh  int64 `gorm:"column:wh"`
		Rev int64 `gorm:"column:r"`
	}
	if err := db.Raw(`SELECT COUNT(*) AS n,
		COALESCE(SUM(CASE WHEN `+billedWhere+` THEN actual_wh ELSE 0 END),0) AS wh,
		COALESCE(SUM(CASE WHEN `+billedWhere+` THEN total_cents ELSE 0 END),0) AS r
		FROM charge_sessions WHERE date(start_at, '+8 hours') = ?`, s.Today).
		Scan(&today).Error; err != nil {
		return nil, err
	}
	s.StartedToday = today.N
	s.KwhToday = today.Wh / 1000
	s.RevenueToday = today.Rev

	var statuses []statusRow
	if err := db.Raw(`SELECT status AS k, COUNT(*) AS v FROM charge_sessions GROUP BY status`).Scan(&statuses).Error; err != nil {
		return nil, err
	}
	s.ByStatus = []domain.StatusCount{}
	for _, st := range statuses {
		s.ByStatus = append(s.ByStatus, domain.StatusCount{Status: st.K, Count: st.V})
		byStatus[st.K] = st.V
	}
	s.ChargingNow = byStatus[domain.SessCharging]
	s.FaultedCount = byStatus[domain.SessFaulted]
	s.AbortedCount = byStatus[domain.SessAborted]
	s.CompletedCount = byStatus[domain.SessCompleted]

	var piles struct {
		Total  int64 `gorm:"column:n"`
		Online int64 `gorm:"column:o"`
	}
	if err := db.Raw(`SELECT COUNT(*) AS n,
		COALESCE(SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END),0) AS o FROM piles`).
		Scan(&piles).Error; err != nil {
		return nil, err
	}
	s.PileTotal = piles.Total
	s.PileOnlineN = piles.Online
	if piles.Total > 0 {
		s.PileOnlinePct = round1(float64(piles.Online) * 100 / float64(piles.Total))
	}
	if err := db.Raw(`SELECT COUNT(*) FROM vehicles WHERE active = 1`).Scan(&s.VehicleTotal).Error; err != nil {
		return nil, err
	}

	// 桩维度汇总：charge_sessions → piles 是多对一，JOIN 不放大行数。
	if err := db.Raw(`SELECT p.id AS pile_id, p.code AS pile_code, p.station AS station,
		COUNT(s.id) AS sessions,
		COALESCE(SUM(CASE WHEN s.` + billedWhere + ` THEN s.actual_wh ELSE 0 END),0)/1000 AS kwh,
		COALESCE(SUM(CASE WHEN s.` + billedWhere + ` THEN s.total_cents ELSE 0 END),0) AS revenue_cents,
		COALESCE(SUM(CASE WHEN s.status IN ('charging','faulted') THEN 1 ELSE 0 END),0) AS open_sessions
		FROM piles p LEFT JOIN charge_sessions s ON s.pile_id = p.id
		GROUP BY p.id, p.code, p.station ORDER BY revenue_cents DESC, p.code`).
		Scan(&s.ByPile).Error; err != nil {
		return nil, err
	}

	if err := db.Raw(`SELECT v.dept AS dept, COUNT(s.id) AS sessions,
		COALESCE(SUM(CASE WHEN s.` + billedWhere + ` THEN s.actual_wh ELSE 0 END),0)/1000 AS kwh,
		COALESCE(SUM(CASE WHEN s.` + billedWhere + ` THEN s.total_cents ELSE 0 END),0) AS revenue_cents
		FROM vehicles v LEFT JOIN charge_sessions s ON s.vehicle_id = v.id
		GROUP BY v.dept ORDER BY revenue_cents DESC, v.dept`).
		Scan(&s.ByDept).Error; err != nil {
		return nil, err
	}

	// 近 N 天趋势：先查稠密数据，再在 Go 侧补齐稀疏日（否则断档日在图上消失）
	start := cst.AddDate(0, 0, -(days - 1))
	type dailyRow struct {
		Day      string `gorm:"column:day"`
		Sessions int64  `gorm:"column:sessions"`
		Kwh      int64  `gorm:"column:kwh"`
		Revenue  int64  `gorm:"column:revenue_cents"`
	}
	var dense []dailyRow
	if err := db.Raw(`SELECT date(start_at, '+8 hours') AS day, COUNT(*) AS sessions,
		COALESCE(SUM(CASE WHEN `+billedWhere+` THEN actual_wh ELSE 0 END),0)/1000 AS kwh,
		COALESCE(SUM(CASE WHEN `+billedWhere+` THEN total_cents ELSE 0 END),0) AS revenue_cents
		FROM charge_sessions WHERE date(start_at, '+8 hours') >= ?
		GROUP BY day ORDER BY day`, start.Format("2006-01-02")).Scan(&dense).Error; err != nil {
		return nil, err
	}
	byDay := map[string]dailyRow{}
	for _, d := range dense {
		byDay[d.Day] = d
	}
	s.Daily = make([]domain.DailyPoint, 0, days)
	for i := 0; i < days; i++ {
		key := start.AddDate(0, 0, i).Format("2006-01-02")
		p := domain.DailyPoint{Day: key}
		if d, ok := byDay[key]; ok {
			p.Sessions, p.Kwh, p.Revenue = d.Sessions, d.Kwh, d.Revenue
		}
		s.Daily = append(s.Daily, p)
	}

	rules, err := r.Tariffs(ctx, true)
	if err != nil {
		return nil, err
	}
	s.RateBoard = domain.BuildRateBoard(rules)
	s.Window = "全部历史口径 · 趋势窗口近 " + strconv.Itoa(days) + " 个自然日（营收只计已结算会话）"

	if err := r.checkIdentities(ctx, s); err != nil {
		return nil, err
	}
	return s, nil
}

// checkIdentities 把业务恒等式做成实时体检：任何一条破口都会进 Issues 并置 IdentityOK=false。
func (r *Repo) checkIdentities(ctx context.Context, s *domain.Stats) error {
	db := r.db.WithContext(ctx)
	var id identityRow
	if err := db.Raw(`SELECT
		COALESCE(SUM(CASE WHEN total_cents <> elec_cents + service_cents + overstay_cents THEN 1 ELSE 0 END),0) AS total_mismatch,
		COALESCE(SUM(CASE WHEN status = 'completed' AND
			seg_peak_wh + seg_flat_wh + seg_valley_wh + seg_unpriced_wh <> actual_wh THEN 1 ELSE 0 END),0) AS energy_mismatch,
		COALESCE(SUM(CASE WHEN (status = 'completed') <> (end_at IS NOT NULL AND status <> 'aborted') THEN 1 ELSE 0 END),0) AS settled_flag,
		0 AS open_overlap
		FROM charge_sessions`).Scan(&id).Error; err != nil {
		return err
	}
	// 同一桩/同一车不得有两条未关闭会话（与部分唯一索引同源的双口径复核）。
	var openOverlap int64
	if err := db.Raw(`SELECT COALESCE(SUM(cnt-1),0) FROM (
		SELECT COUNT(*) AS cnt FROM charge_sessions
		WHERE status IN ('charging','faulted') GROUP BY pile_id HAVING COUNT(*) > 1)`).
		Scan(&openOverlap).Error; err != nil {
		return err
	}

	peakSum := int64(0)
	for _, p := range s.ByPile {
		peakSum += p.Sessions
	}
	statusSum := int64(0)
	for _, st := range s.ByStatus {
		statusSum += st.Count
	}
	deptSum := int64(0)
	for _, d := range s.ByDept {
		deptSum += d.Sessions
	}

	issues := []string{}
	add := func(cond bool, format string, args ...any) {
		if cond {
			issues = append(issues, fmt.Sprintf(format, args...))
		}
	}
	add(id.TotalMismatch > 0, "total=电费+服务费+占用费 破口 %d 单", id.TotalMismatch)
	add(id.EnergyMismatch > 0, "分时拆分之和≠实际电量 %d 单", id.EnergyMismatch)
	add(id.SettledFlag > 0, "结算状态与结算时间戳不一致 %d 单", id.SettledFlag)
	add(openOverlap > 0, "同一桩存在多条未关闭会话 %d 条", openOverlap)
	add(peakSum != s.TotalSessions, "桩分组会话之和 %d ≠ 会话总数 %d", peakSum, s.TotalSessions)
	add(deptSum != s.TotalSessions, "车队分组会话之和 %d ≠ 会话总数 %d", deptSum, s.TotalSessions)
	add(statusSum != s.TotalSessions, "状态分组之和 %d ≠ 会话总数 %d", statusSum, s.TotalSessions)
	add(s.RevenueCents > s.ElecCents+s.ServiceCents+s.OverstayCents, "营收超过全口径金额之和")
	add(s.PeakKwh+s.FlatKwh+s.ValleyKwh > s.TotalKwh, "峰+平+谷电量超过总电量")
	s.IdentityIssues = issues
	s.IdentityOK = len(issues) == 0
	return nil
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
