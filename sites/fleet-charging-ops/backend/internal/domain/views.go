package domain

import (
	"strconv"
	"time"
)

// Stats 是运营台唯一的聚合出口：所有口径在后端一次算完，前端不做二次计算。
type Stats struct {
	GeneratedAt time.Time `json:"generated_at"`
	Today       string    `json:"today"`
	TrendDays   int       `json:"trend_days"`
	Window      string    `json:"window"`

	TotalSessions  int64 `json:"total_sessions"`
	BilledCount    int64 `json:"billed_count"`
	StartedToday   int64 `json:"started_today"`
	ChargingNow    int64 `json:"charging_now"`
	FaultedCount   int64 `json:"faulted_count"`
	AbortedCount   int64 `json:"aborted_count"`
	CompletedCount int64 `json:"completed_count"`

	TotalKwh        int64   `json:"total_kwh"`
	RevenueCents    int64   `json:"revenue_cents"`
	ElecCents       int64   `json:"elec_cents"`
	ServiceCents    int64   `json:"service_cents"`
	OverstayCents   int64   `json:"overstay_cents"`
	KwhToday        int64   `json:"kwh_today"`
	RevenueToday    int64   `json:"revenue_today_cents"`
	AvgPriceCents   int64   `json:"avg_price_cents_per_kwh"` // 度电均价 = 营收 ÷ 总电量
	PeakKwh         int64   `json:"peak_kwh"`
	FlatKwh         int64   `json:"flat_kwh"`
	ValleyKwh       int64   `json:"valley_kwh"`
	PeakPct         float64 `json:"peak_pct"`
	ValleyPct       float64 `json:"valley_pct"`
	AvgDurMin       int64   `json:"avg_duration_min"`
	OverstayRatePct float64 `json:"overstay_rate_pct"` // 发生超时占桩的结算单占比

	PileTotal     int64   `json:"pile_total"`
	PileOnlineN   int64   `json:"pile_online"`
	PileOnlinePct float64 `json:"pile_online_pct"`
	VehicleTotal  int64   `json:"vehicle_total"`

	ByStatus       []StatusCount `json:"by_status"`
	ByPile         []PileRollup  `json:"by_pile"`
	ByDept         []DeptRollup  `json:"by_dept"`
	Daily          []DailyPoint  `json:"daily"`
	RateBoard      []RateWindow  `json:"rate_board"`
	IdentityOK     bool          `json:"identity_ok"`
	IdentityIssues []string      `json:"identity_issues"`
}

type StatusCount struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

// gorm 标签是给 Raw().Scan() 用的：SQL 别名对不上会静默扫成 0。
type PileRollup struct {
	PileID   int64  `gorm:"column:pile_id" json:"pile_id"`
	PileCode string `gorm:"column:pile_code" json:"pile_code"`
	Station  string `gorm:"column:station" json:"station"`
	Sessions int64  `gorm:"column:sessions" json:"sessions"`
	Kwh      int64  `gorm:"column:kwh" json:"kwh"`
	Revenue  int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
	OpenN    int64  `gorm:"column:open_sessions" json:"open_sessions"`
}

type DeptRollup struct {
	Dept     string `gorm:"column:dept" json:"dept"`
	Sessions int64  `gorm:"column:sessions" json:"sessions"`
	Kwh      int64  `gorm:"column:kwh" json:"kwh"`
	Revenue  int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
}

type DailyPoint struct {
	Day      string `gorm:"column:day" json:"day"`
	Sessions int64  `gorm:"column:sessions" json:"sessions"`
	Kwh      int64  `gorm:"column:kwh" json:"kwh"`
	Revenue  int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
}

// QuoteView 是试算接口的响应形状（含恒等式布尔位，前端直接展示）。
type QuoteView struct {
	PileCode      string        `json:"pile_code"`
	Station       string        `json:"station"`
	Bay           string        `json:"bay"`
	PowerKw       int           `json:"power_kw"`
	StartAt       time.Time     `json:"start_at"`
	EndAt         time.Time     `json:"end_at"`
	Minutes       int64         `json:"minutes"`
	Wh            int64         `json:"wh"`
	Segments      []SegmentView `json:"segments"`
	PeakWh        int64         `json:"peak_wh"`
	FlatWh        int64         `json:"flat_wh"`
	ValleyWh      int64         `json:"valley_wh"`
	UnpricedWh    int64         `json:"unpriced_wh"`
	UnpricedMin   int           `json:"unpriced_min"`
	ElecCents     int64         `json:"elec_cents"`
	ServiceCents  int64         `json:"service_cents"`
	OverstayCents int64         `json:"overstay_cents"`
	TotalCents    int64         `json:"total_cents"`
	AvgPriceCents int64         `json:"avg_price_cents_per_kwh"`
	Covered       bool          `json:"covered"`
	IdentityOK    bool          `json:"identity_ok"`
	TariffRule    string        `json:"tariff_rule"`
}

func (b *Bill) View(wh int64, pile *Pile, minutes int64) *QuoteView {
	v := &QuoteView{
		Segments: b.Segments, PeakWh: b.PeakWh, FlatWh: b.FlatWh,
		ValleyWh: b.ValleyWh, UnpricedWh: b.UnpricedWh, UnpricedMin: b.UnpricedMin,
		ElecCents: b.ElecCents, ServiceCents: b.ServiceCents,
		OverstayCents: b.OverstayCents, TotalCents: b.TotalCents,
		Covered: b.Covered, Wh: wh, Minutes: minutes,
	}
	if v.Segments == nil {
		v.Segments = []SegmentView{}
	}
	v.IdentityOK = b.IdentityOK(wh)
	if wh > 0 {
		v.AvgPriceCents = roundHalfUp(v.TotalCents*1000, wh)
	}
	if pile != nil {
		v.PileCode = pile.Code
		v.Station = pile.Station
		v.Bay = pile.Bay
		v.PowerKw = pile.PowerKw
	}
	v.TariffRule = "电量按时长占比分摊到分时窗口（电价+服务费均按度计整型分）；" +
		"超时占桩 " + strconv.Itoa(OverstayCentsPerMin) + " 分/分钟、封顶 " + strconv.Itoa(MaxOverstayMin) + " 分钟"
	return v
}
