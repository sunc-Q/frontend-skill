package repository

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"bizsite/internal/domain"
)

// excludedRevenueStatus 是营收口径里剔除的状态：退回单不产生运费收入。
const excludedRevenueStatus = "status <> 'returned'"

// byLaneRow 只按 lane 分组聚合（一条 LEFT JOIN 对一行，不存在事件表放大）。
type byLaneRow struct {
	LaneID   int64  `gorm:"column:lane_id"`
	LaneCode string `gorm:"column:lane_code"`
	Route    string `gorm:"column:route"`
	Tier     string `gorm:"column:tier"`
	Waybills int64  `gorm:"column:waybills"`
	Revenue  int64  `gorm:"column:revenue_cents"`
	CargoKg  int64  `gorm:"column:cargo_kg"`
}

type dailyRow struct {
	Day     string `gorm:"column:day"`
	Booked  int64  `gorm:"column:booked"`
	Revenue int64  `gorm:"column:revenue_cents"`
}

type statusRow struct {
	K string `gorm:"column:k"`
	V int64  `gorm:"column:v"`
}

type identityRow struct {
	TotalMismatch   int64 `gorm:"column:total_mismatch"`
	ChargeMismatch  int64 `gorm:"column:charge_mismatch"`
	ChargeUnstepped int64 `gorm:"column:charge_unstepped"`
	VolMismatch     int64 `gorm:"column:vol_mismatch"`
	DeliverFlags    int64 `gorm:"column:deliver_flags"`
}

// Stats 汇总全部在本层一次算完，前端不做二次计算；
// 恒等式（total=运费+燃油+保价+附加、计费重=max 进位、分组之和==总量）实时自检并对外公布。
func (r *Repo) Stats(ctx context.Context, now time.Time, days int) (*domain.Stats, error) {
	if days < 7 {
		days = 7
	}
	if days > 30 {
		days = 30
	}
	db := r.db.WithContext(ctx)
	// 业务「今天」固定为 UTC+8 日历日（与 SQL 里的 date(booked_at,'+8 hours') 同口径）；
	// /health 的 UTC 时间不能拿来做日期断言，这是历史轮次踩过的双时钟坑。
	cst := now.UTC().Add(8 * time.Hour)
	s := &domain.Stats{GeneratedAt: now, Today: cst.Format("2006-01-02"), TrendDays: days}
	byStatus := map[string]int64{}

	var totals struct {
		N         int64 `gorm:"column:n"`
		Billed    int64 `gorm:"column:nb"`
		Freight   int64 `gorm:"column:f"`
		Fuel      int64 `gorm:"column:u"`
		Insurance int64 `gorm:"column:i"`
		Surcharge int64 `gorm:"column:s"`
		Revenue   int64 `gorm:"column:r"`
		ChargeG   int64 `gorm:"column:c"`
		Bulky     int64 `gorm:"column:b"`
		Capped    int64 `gorm:"column:p"`
		Declared  int64 `gorm:"column:d"`
	}
	if err := db.Raw(`SELECT COUNT(*) AS n,
		COALESCE(SUM(CASE WHEN ` + excludedRevenueStatus + ` THEN 1 ELSE 0 END),0) AS nb,
		COALESCE(SUM(freight_cents),0) AS f, COALESCE(SUM(fuel_cents),0) AS u,
		COALESCE(SUM(insurance_cents),0) AS i, COALESCE(SUM(surcharge_cents),0) AS s,
		COALESCE(SUM(CASE WHEN ` + excludedRevenueStatus + ` THEN total_cents ELSE 0 END),0) AS r,
		COALESCE(SUM(chargeable_grams),0) AS c,
		COALESCE(SUM(CASE WHEN volumetric_grams > weight_grams THEN 1 ELSE 0 END),0) AS b,
		COALESCE(SUM(CASE WHEN surcharge_capped THEN 1 ELSE 0 END),0) AS p,
		COALESCE(SUM(CASE WHEN declared_cents > 0 THEN 1 ELSE 0 END),0) AS d
		FROM waybills`).Scan(&totals).Error; err != nil {
		return nil, err
	}
	s.BilledCount = totals.Billed
	s.TotalWaybills = totals.N
	s.FreightCents = totals.Freight
	s.FuelCents = totals.Fuel
	s.InsuranceCents = totals.Insurance
	s.SurchargeCents = totals.Surcharge
	s.RevenueCents = totals.Revenue
	s.TotalChargeableKg = totals.ChargeG / 1000
	s.BulkyCount = totals.Bulky
	s.CappedCount = totals.Capped
	s.InsuredCount = totals.Declared
	if totals.N > 0 {
		s.BulkyPct = round1(float64(totals.Bulky) * 100 / float64(totals.N))
	}
	if totals.Billed > 0 {
		s.AvgTotalCents = domain.RoundHalfUpInt(totals.Revenue, totals.Billed)
	}

	var statuses []statusRow
	if err := db.Raw(`SELECT status AS k, COUNT(*) AS v FROM waybills GROUP BY status`).Scan(&statuses).Error; err != nil {
		return nil, err
	}
	s.ByStatus = []domain.StatusCount{}
	for _, st := range statuses {
		s.ByStatus = append(s.ByStatus, domain.StatusCount{Status: st.K, Count: st.V})
		byStatus[st.K] = st.V
	}
	s.InTransit = byStatus[domain.StPickedUp] + byStatus[domain.StInTransit] +
		byStatus[domain.StArrived] + byStatus[domain.StOutForDelivery] + byStatus[domain.StException]
	s.ExceptionCount = byStatus[domain.StException]
	s.Delivered = byStatus[domain.StDelivered]
	s.ReturnedCount = byStatus[domain.StReturned]

	// 今日新开单 + 今日营收（本地日历日口径）
	var today struct {
		N       int64 `gorm:"column:n"`
		Revenue int64 `gorm:"column:r"`
	}
	if err := db.Raw(`SELECT COUNT(*) AS n,
		COALESCE(SUM(CASE WHEN `+excludedRevenueStatus+` THEN total_cents ELSE 0 END),0) AS r
		FROM waybills WHERE date(booked_at, '+8 hours') = ?`, s.Today).
		Scan(&today).Error; err != nil {
		return nil, err
	}
	s.BookedToday = today.N
	s.RevenueTodayCents = today.Revenue

	// 准点率：已签收里 delivered_at <= promised_at 的占比
	var onTime struct {
		Delivered int64 `gorm:"column:n"`
		Early     int64 `gorm:"column:e"`
	}
	if err := db.Raw(`SELECT COUNT(*) AS n,
		COALESCE(SUM(CASE WHEN delivered_at IS NOT NULL AND delivered_at <= promised_at THEN 1 ELSE 0 END),0) AS e
		FROM waybills WHERE status = 'delivered'`).Scan(&onTime).Error; err != nil {
		return nil, err
	}
	if onTime.Delivered > 0 {
		s.OnTimePct = round1(float64(onTime.Early) * 100 / float64(onTime.Delivered))
	}
	if s.TotalWaybills > 0 {
		s.ExceptionPct = round1(float64(s.ExceptionCount) * 100 / float64(s.TotalWaybills))
	}

	// 轨迹事件总数（页面「扫描打卡」口径）
	if err := db.Raw(`SELECT COUNT(*) FROM scan_events`).Scan(&s.EventCount).Error; err != nil {
		return nil, err
	}

	// 线路汇总
	if err := db.Raw(`SELECT w.lane_id AS lane_id, l.code AS lane_code,
		l.origin || '→' || l.destination AS route, l.tier AS tier,
		COUNT(w.id) AS waybills,
		COALESCE(SUM(CASE WHEN ` + excludedRevenueStatus + ` THEN w.total_cents ELSE 0 END),0) AS revenue_cents,
		COALESCE(SUM(w.chargeable_grams),0) / 1000 AS cargo_kg
		FROM lanes l LEFT JOIN waybills w ON w.lane_id = l.id
		GROUP BY l.id, l.code, route, l.tier ORDER BY revenue_cents DESC, l.code`).
		Scan(&s.ByLane).Error; err != nil {
		return nil, err
	}

	// 近 N 天趋势：先查稠密数据，再在 Go 侧补齐稀疏日（否则断档日在图上消失）
	start := cst.AddDate(0, 0, -(days - 1))
	var dense []dailyRow
	if err := db.Raw(`SELECT date(booked_at, '+8 hours') AS day, COUNT(*) AS booked,
		COALESCE(SUM(CASE WHEN `+excludedRevenueStatus+` THEN total_cents ELSE 0 END),0) AS revenue_cents
		FROM waybills WHERE date(booked_at, '+8 hours') >= ?
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
			p.Booked, p.Revenue = d.Booked, d.Revenue
		}
		s.Daily = append(s.Daily, p)
	}

	s.Window = "全部历史口径 · 趋势窗口近 " + strconv.Itoa(days) + " 个自然日（营收剔除已退回单）"

	if err := r.checkIdentities(ctx, s); err != nil {
		return nil, err
	}
	return s, nil
}

// checkIdentities 把五条业务恒等式做成实时体检：任何一条破口都会进 Issues 并置 IdentityOK=false。
func (r *Repo) checkIdentities(ctx context.Context, s *domain.Stats) error {
	db := r.db.WithContext(ctx)
	var id identityRow
	// 运单 → 线路是多对一，JOIN 不会放大行数，这里用它取回抛比做体积重复算。
	if err := db.Raw(`SELECT
		COALESCE(SUM(CASE WHEN w.total_cents <> w.freight_cents + w.fuel_cents + w.insurance_cents + w.surcharge_cents THEN 1 ELSE 0 END),0) AS total_mismatch,
		COALESCE(SUM(CASE WHEN w.chargeable_grams < w.weight_grams OR w.chargeable_grams < w.volumetric_grams THEN 1 ELSE 0 END),0) AS charge_mismatch,
		COALESCE(SUM(CASE WHEN w.chargeable_grams % 500 <> 0 THEN 1 ELSE 0 END),0) AS charge_unstepped,
		COALESCE(SUM(CASE WHEN w.volumetric_grams <> (w.volume_cm3 * 1000 + l.vol_divisor - 1) / l.vol_divisor THEN 1 ELSE 0 END),0) AS vol_mismatch,
		COALESCE(SUM(CASE WHEN (w.status = 'delivered') <> (w.delivered_at IS NOT NULL) THEN 1 ELSE 0 END),0) AS deliver_flags
		FROM waybills w JOIN lanes l ON l.id = w.lane_id`).Scan(&id).Error; err != nil {
		return err
	}

	laneSum := int64(0)
	for _, l := range s.ByLane {
		laneSum += l.Waybills
	}
	revLaneSum := int64(0)
	for _, l := range s.ByLane {
		revLaneSum += l.Revenue
	}
	statusSum := int64(0)
	for _, st := range s.ByStatus {
		statusSum += st.Count
	}

	issues := []string{}
	add := func(cond bool, format string, args ...any) {
		if cond {
			issues = append(issues, fmt.Sprintf(format, args...))
		}
	}
	add(id.TotalMismatch > 0, "total=运费+燃油+保价+附加 破口 %d 单", id.TotalMismatch)
	add(id.ChargeMismatch > 0, "计费重低于实际重或体积重 %d 单", id.ChargeMismatch)
	add(id.ChargeUnstepped > 0, "计费重未进位到 500g 档 %d 单", id.ChargeUnstepped)
	add(id.VolMismatch > 0, "体积重与抛比复算不符 %d 单", id.VolMismatch)
	add(id.DeliverFlags > 0, "签收状态与签收时间不一致 %d 单", id.DeliverFlags)
	add(laneSum != s.TotalWaybills, "线路分组之和 %d ≠ 运单总数 %d", laneSum, s.TotalWaybills)
	add(statusSum != s.TotalWaybills, "状态分组之和 %d ≠ 运单总数 %d", statusSum, s.TotalWaybills)
	add(revLaneSum != s.RevenueCents, "线路营收之和 %d ≠ 营收总额 %d", revLaneSum, s.RevenueCents)
	add(s.RevenueCents > s.FreightCents+s.FuelCents+s.InsuranceCents+s.SurchargeCents,
		"营收超过全口径金额之和")
	s.IdentityIssues = issues
	s.IdentityOK = len(issues) == 0
	return nil
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
