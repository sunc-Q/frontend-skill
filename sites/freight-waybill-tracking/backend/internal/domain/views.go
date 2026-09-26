package domain

import (
	"strconv"
	"time"
)

// Stats 是看板唯一的聚合出口：所有口径在后端一次算完，前端不做二次计算。
type Stats struct {
	GeneratedAt time.Time `json:"generated_at"`
	Today       string    `json:"today"`
	TrendDays   int       `json:"trend_days"`
	Window      string    `json:"window"`

	TotalWaybills  int64 `json:"total_waybills"`
	BilledCount    int64 `json:"billed_count"`
	BookedToday    int64 `json:"booked_today"`
	InTransit      int64 `json:"in_transit"`
	ExceptionCount int64 `json:"exception_count"`
	Delivered      int64 `json:"delivered"`
	ReturnedCount  int64 `json:"returned"`
	EventCount     int64 `json:"event_count"`

	RevenueCents      int64 `json:"revenue_cents"`
	RevenueTodayCents int64 `json:"revenue_today_cents"`
	FreightCents      int64 `json:"freight_cents"`
	FuelCents         int64 `json:"fuel_cents"`
	InsuranceCents    int64 `json:"insurance_cents"`
	SurchargeCents    int64 `json:"surcharge_cents"`
	AvgTotalCents     int64 `json:"avg_total_cents"`
	TotalChargeableKg int64 `json:"total_chargeable_kg"`

	BulkyCount   int64   `json:"bulky_count"`
	BulkyPct     float64 `json:"bulky_pct"`
	InsuredCount int64   `json:"insured_count"`
	CappedCount  int64   `json:"surcharge_capped_count"`
	OnTimePct    float64 `json:"on_time_pct"`
	ExceptionPct float64 `json:"exception_pct"`

	ByStatus       []StatusCount `json:"by_status"`
	ByLane         []LaneRollup  `json:"by_lane"`
	Daily          []DailyPoint  `json:"daily"`
	IdentityOK     bool          `json:"identity_ok"`
	IdentityIssues []string      `json:"identity_issues"`
}

type StatusCount struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

// gorm 标签是给 Stats 的 Raw().Scan() 用的：SQL 别名是 snake_case 复数，
// 只靠 json 标签会漏配（曾把 revenue_cents 静默扫成 0）。
type LaneRollup struct {
	LaneID   int64  `gorm:"column:lane_id" json:"lane_id"`
	LaneCode string `gorm:"column:lane_code" json:"lane_code"`
	Route    string `gorm:"column:route" json:"route"`
	Tier     string `gorm:"column:tier" json:"tier"`
	Waybills int64  `gorm:"column:waybills" json:"waybills"`
	Revenue  int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
	CargoKg  int64  `gorm:"column:cargo_kg" json:"cargo_kg"`
}

type DailyPoint struct {
	Day     string `gorm:"column:day" json:"day"`
	Booked  int64  `gorm:"column:booked" json:"booked"`
	Revenue int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
}

// QuoteView 是试算接口的响应形状（含恒等式布尔位，前端直接展示）。
type QuoteView struct {
	LaneCode        string          `json:"lane_code"`
	Route           string          `json:"route"`
	Tier            string          `json:"tier"`
	PromiseDays     int             `json:"promise_days"`
	VolumetricGrams int64           `json:"volumetric_grams"`
	ChargeableGrams int64           `json:"chargeable_grams"`
	ContinueUnits   int64           `json:"continue_units"`
	FreightCents    int64           `json:"freight_cents"`
	FuelCents       int64           `json:"fuel_cents"`
	InsuranceCents  int64           `json:"insurance_cents"`
	SurchargeCents  int64           `json:"surcharge_cents"`
	TotalCents      int64           `json:"total_cents"`
	Items           []SurchargeItem `json:"items"`
	Capped          bool            `json:"capped"`
	IdentityOK      bool            `json:"identity_ok"`
	VolumetricRule  string          `json:"volumetric_rule"`
}

func (q *Quote) View(lane *Lane) *QuoteView {
	v := &QuoteView{
		VolumetricGrams: q.VolumetricGrams, ChargeableGrams: q.ChargeableGrams,
		ContinueUnits: q.ContinueUnits, FreightCents: q.FreightCents,
		FuelCents: q.FuelCents, InsuranceCents: q.InsuranceCents,
		SurchargeCents: q.SurchargeCents, TotalCents: q.TotalCents,
		Items: q.Items, Capped: q.Capped,
	}
	if v.Items == nil {
		v.Items = []SurchargeItem{}
	}
	v.IdentityOK = q.TotalCents == q.FreightCents+q.FuelCents+q.InsuranceCents+q.SurchargeCents
	if lane != nil {
		v.LaneCode = lane.Code
		v.Route = lane.Origin + " → " + lane.Destination
		v.Tier = lane.Tier
		v.PromiseDays = lane.PromiseDays
		v.VolumetricRule = "体积重 = 体积(cm³)×1000÷" + strconv.Itoa(lane.VolDivisor) + " 克，" +
			"计费重取 max(实际重, 体积重) 后向上进位到 500g"
	}
	return v
}
