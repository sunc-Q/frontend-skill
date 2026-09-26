package domain

import (
	"strings"
	"time"
	"unicode/utf8"
)

// ---- 计价配置 ----

const (
	TierExpress  = "express"
	TierStandard = "standard"
	TierEconomy  = "economy"

	// 计费重量向上进位到该克数（500g 一档，行业「不足半公斤按半公斤」）。
	ChargeStepGrams = 500
	// 保价：万分之三十（即 0.3%），最低 2 元。
	InsuranceBasisPoints = 30
	InsuranceMinCents    = 200
	// 附加费合计不得超过运费的该百分比，超出即截断并留痕。
	SurchargeCapPct = 80
	// 体积重 = 体积(cm³) × 1000 / 抛比，抛比按线路档位不同（快运抛得更狠）。
	DefaultVolDivisor = 8000
)

// Lane 干线：一个「起运城市 → 目的城市」的计价与时效单元。
type Lane struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	Code        string    `gorm:"uniqueIndex;size:24" json:"code"`
	Origin      string    `gorm:"size:32" json:"origin"`
	Destination string    `gorm:"size:32" json:"destination"`
	Tier        string    `gorm:"size:16;index" json:"tier"`
	DistanceKm  int       `json:"distance_km"`
	FirstKg     int       `json:"first_kg"`      // 首重（整公斤）
	FirstCents  int64     `json:"first_cents"`   // 首重价
	HalfKgCents int64     `json:"half_kg_cents"` // 续重每 500g 单价
	MinCents    int64     `json:"min_cents"`     // 单票最低运费
	FuelPct     int       `json:"fuel_pct"`      // 燃油附加费率（整数百分比）
	VolDivisor  int       `json:"vol_divisor"`   // 体积重抛比
	PromiseDays int       `json:"promise_days"`  // 承诺时效（自然日）
	RemoteArea  bool      `json:"remote_area"`   // 是否偏远目的区
	Active      bool      `gorm:"index" json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

// SurchargeRule 附加费规则：管理员可增删与启停，计价引擎按优先级逐条仲裁。
const (
	KindRemotePct   = "remote_pct"     // 偏远区：按运费百分比，有最低额
	KindHeavyPiece  = "heavy_piece"    // 单件超重：达到门槛整票收固定额
	KindFragileFlat = "fragile_flat"   // 易碎加固：整票固定额
	KindLongHaul    = "long_haul_flat" // 长途干线：里程达门槛整票固定额
)

type SurchargeRule struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	Code        string    `gorm:"uniqueIndex;size:24" json:"code"`
	Name        string    `gorm:"size:40" json:"name"`
	Kind        string    `gorm:"size:20;index" json:"kind"`
	ThresholdG  int64     `json:"threshold_g"`  // heavy_piece：单件克重门槛
	ThresholdKm int       `json:"threshold_km"` // long_haul：里程门槛
	RatePct     int       `json:"rate_pct"`     // remote_pct：运费百分比
	AmountCents int64     `json:"amount_cents"` // 固定额
	MinCents    int64     `json:"min_cents"`    // 百分比型最低额
	Priority    int       `json:"priority"`
	Active      bool      `gorm:"index" json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

// ---- 运单 ----

const (
	StBooked         = "booked"
	StPickedUp       = "picked_up"
	StInTransit      = "in_transit"
	StArrived        = "arrived"
	StOutForDelivery = "out_for_delivery"
	StDelivered      = "delivered"
	StException      = "exception"
	StReturned       = "returned"
)

// NextStatus 是唯一的状态跃迁表：接口层与测试都只认它，避免两处各写一套。
var NextStatus = map[string][]string{
	StBooked:         {StPickedUp, StException, StReturned},
	StPickedUp:       {StInTransit, StException, StReturned},
	StInTransit:      {StArrived, StException, StReturned},
	StArrived:        {StOutForDelivery, StException, StReturned},
	StOutForDelivery: {StDelivered, StException, StReturned},
	StException:      {StInTransit, StOutForDelivery, StReturned},
	StDelivered:      {},
	StReturned:       {},
}

func ValidStatus(s string) bool {
	_, ok := NextStatus[s]
	return ok
}

func CanAdvance(from, to string) bool {
	for _, n := range NextStatus[from] {
		if n == to {
			return true
		}
	}
	return false
}

var StatusLabel = map[string]string{
	StBooked:         "已下单",
	StPickedUp:       "已揽收",
	StInTransit:      "干线运输中",
	StArrived:        "已到达分拨",
	StOutForDelivery: "派送中",
	StDelivered:      "已签收",
	StException:      "异常挂起",
	StReturned:       "已退回",
}

// Waybill 运单：计价结果全部落库为快照（费率后续调整不回溯历史单）。
type Waybill struct {
	ID            int64  `gorm:"primaryKey" json:"id"`
	Code          string `gorm:"uniqueIndex;size:24" json:"code"`
	LaneID        int64  `gorm:"index" json:"lane_id"`
	Status        string `gorm:"size:20;index" json:"status"`
	ShipperName   string `gorm:"size:40" json:"shipper_name"`
	Phone         string `gorm:"size:16" json:"-"` // 绝不外发原文
	PieceCount    int    `json:"piece_count"`
	WeightGrams   int64  `json:"weight_grams"`
	VolumeCm3     int64  `json:"volume_cm3"`
	HeaviestG     int64  `json:"heaviest_piece_g"`
	DeclaredCents int64  `json:"declared_cents"`
	Fragile       bool   `json:"fragile"`
	RemoteArea    bool   `json:"remote_area"` // 下单时线路快照

	VolumetricGrams int64  `json:"volumetric_grams"`
	ChargeableGrams int64  `json:"chargeable_grams"`
	FreightCents    int64  `json:"freight_cents"`
	FuelCents       int64  `json:"fuel_cents"`
	InsuranceCents  int64  `json:"insurance_cents"`
	SurchargeCents  int64  `json:"surcharge_cents"`
	TotalCents      int64  `json:"total_cents"`
	SurchargeDetail string `gorm:"size:600" json:"-"` // JSON 明细，出口在视图里
	SurchargeCapped bool   `json:"surcharge_capped"`

	BookedAt    time.Time  `json:"booked_at"`
	PromisedAt  time.Time  `json:"promised_at"`
	DeliveredAt *time.Time `json:"delivered_at,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// ScanEvent 路由轨迹：状态跃迁与纯在途打卡共用同一张事件表。
type ScanEvent struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	WaybillID  int64     `gorm:"index" json:"waybill_id"`
	Seq        int       `json:"seq"`
	EventType  string    `gorm:"size:20" json:"event_type"`
	Node       string    `gorm:"size:40" json:"node"`
	Note       string    `gorm:"size:120" json:"note"`
	OccurredAt time.Time `json:"occurred_at"`
}

// ---- 读取视图 ----

type LaneRow struct {
	Lane
	Waybills int64 `gorm:"-" json:"waybills"`
	Revenue  int64 `gorm:"-" json:"revenue_cents"`
}

type WaybillRow struct {
	Waybill
	LaneCode       string          `gorm:"column:lane_code" json:"lane_code"`
	Origin         string          `gorm:"column:origin" json:"origin"`
	Destination    string          `gorm:"column:destination" json:"destination"`
	Tier           string          `gorm:"column:tier" json:"tier"`
	PromiseDays    int             `gorm:"column:promise_days" json:"promise_days"`
	PhoneMasked    string          `gorm:"-" json:"phone_masked"`
	SurchargeItems []SurchargeItem `gorm:"-" json:"surcharge_items"`
	LegCount       int             `gorm:"column:leg_count" json:"leg_count"`
}

type SurchargeItem struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Cents int64  `json:"cents"`
}

type WaybillDetail struct {
	WaybillRow
	Events []ScanEvent `json:"events"`
}

// ---- 计价引擎入参与结果（纯函数，无 DB 依赖） ----

type QuoteInput struct {
	Lane          *Lane
	Rules         []SurchargeRule
	WeightGrams   int64
	VolumeCm3     int64
	HeaviestG     int64
	DeclaredCents int64
	Fragile       bool
}

type Quote struct {
	VolumetricGrams int64
	ChargeableGrams int64
	FreightCents    int64
	FuelCents       int64
	InsuranceCents  int64
	SurchargeCents  int64
	TotalCents      int64
	Items           []SurchargeItem
	Capped          bool
	ContinueUnits   int64
}

// ---- 写入 DTO ----

type CreateWaybillInput struct {
	LaneCode      string `json:"lane_code"`
	ShipperName   string `json:"shipper_name"`
	Phone         string `json:"phone"`
	PieceCount    int    `json:"piece_count"`
	WeightGrams   int64  `json:"weight_grams"`
	VolumeCm3     int64  `json:"volume_cm3"`
	HeaviestG     int64  `json:"heaviest_piece_g"`
	DeclaredCents int64  `json:"declared_cents"`
	Fragile       bool   `json:"fragile"`
	Node          string `json:"node"`
}

type AdvanceInput struct {
	To   string `json:"to"`
	Node string `json:"node"`
	Note string `json:"note"`
}

type ExceptionInput struct {
	Node   string `json:"node"`
	Reason string `json:"reason"`
}

type CreateRuleInput struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	ThresholdG  int64  `json:"threshold_g"`
	ThresholdKm int    `json:"threshold_km"`
	RatePct     int    `json:"rate_pct"`
	AmountCents int64  `json:"amount_cents"`
	MinCents    int64  `json:"min_cents"`
	Priority    int    `json:"priority"`
}

func ValidKind(k string) bool {
	switch k {
	case KindRemotePct, KindHeavyPiece, KindFragileFlat, KindLongHaul:
		return true
	}
	return false
}

func ValidTier(t string) bool {
	switch t {
	case TierExpress, TierStandard, TierEconomy:
		return true
	}
	return false
}

// ---- 校验 ----

const (
	MaxNameRunes     = 40
	MaxNodeRunes     = 40
	MaxWeightGrams   = 2_000_000
	MaxVolumeCm3     = 20_000_000
	MaxDeclaredCents = 10_000_000
)

// CodeAllowed 只放行字母数字与 -_：注入串（含引号、分号、空格）在这里就被挡下。
func CodeAllowed(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return false
		}
	}
	return true
}

func MobileAllowed(s string) bool {
	if len(s) != 11 || s[0] != '1' || s[1] < '3' || s[1] > '9' {
		return false
	}
	for i := 2; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func MaskPhone(s string) string {
	if len(s) != 11 {
		return "未登记"
	}
	return s[:3] + "****" + s[7:]
}

func (in CreateWaybillInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.LaneCode) < 2 || len(in.LaneCode) > 24 || !CodeAllowed(in.LaneCode) {
		errs["lane_code"] = "线路标识需为 2-24 位字母、数字、- 或 _"
	}
	if n := utf8.RuneCountInString(in.ShipperName); n < 2 || n > MaxNameRunes {
		errs["shipper_name"] = "寄件人名称需为 2-40 个字符"
	}
	if !MobileAllowed(in.Phone) {
		errs["phone"] = "手机号需为 11 位有效大陆号码"
	}
	if in.PieceCount < 1 || in.PieceCount > 200 {
		errs["piece_count"] = "件数越界（1-200）"
	}
	if in.WeightGrams < 1 || in.WeightGrams > MaxWeightGrams {
		errs["weight_grams"] = "实际重量越界（1-2000000 克）"
	}
	if in.VolumeCm3 < 0 || in.VolumeCm3 > MaxVolumeCm3 {
		errs["volume_cm3"] = "体积越界（0-20000000 立方厘米）"
	}
	if in.HeaviestG < 1 || in.HeaviestG > MaxWeightGrams {
		errs["heaviest_piece_g"] = "最重单件越界（1-2000000 克）"
	} else if in.HeaviestG > in.WeightGrams {
		errs["heaviest_piece_g"] = "最重单件不得超过总实际重量"
	}
	if in.DeclaredCents < 0 || in.DeclaredCents > MaxDeclaredCents {
		errs["declared_cents"] = "声明价值越界（0-10000000 分）"
	}
	if n := utf8.RuneCountInString(in.Node); n != 0 && (n < 2 || n > MaxNodeRunes) {
		errs["node"] = "揽收网点需为 2-40 个字符"
	}
	return errs, len(errs) == 0
}

func (in AdvanceInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidStatus(in.To) {
		errs["to"] = "未知的目标状态"
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Node)); n < 2 || n > MaxNodeRunes {
		errs["node"] = "打卡网点需为 2-40 个字符"
	}
	if n := utf8.RuneCountInString(in.Note); n > 120 {
		errs["note"] = "备注不得超过 120 个字符"
	}
	return errs, len(errs) == 0
}

func (in ExceptionInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Node)); n < 2 || n > MaxNodeRunes {
		errs["node"] = "打卡网点需为 2-40 个字符"
	}
	if n := utf8.RuneCountInString(in.Reason); n < 2 || n > 120 {
		errs["reason"] = "异常原因需为 2-120 个字符"
	}
	return errs, len(errs) == 0
}

func (in CreateRuleInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Code) < 2 || len(in.Code) > 24 || !CodeAllowed(in.Code) {
		errs["code"] = "规则标识需为 2-24 位字母、数字、- 或 _"
	}
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > MaxNameRunes {
		errs["name"] = "规则名称需为 1-40 个字符"
	}
	if !ValidKind(in.Kind) {
		errs["kind"] = "kind 只能是 remote_pct / heavy_piece / fragile_flat / long_haul_flat"
	}
	if in.ThresholdG < 0 || in.ThresholdG > MaxWeightGrams {
		errs["threshold_g"] = "单件重量门槛越界（0-2000000 克）"
	}
	if in.ThresholdKm < 0 || in.ThresholdKm > 10_000 {
		errs["threshold_km"] = "里程门槛越界（0-10000 公里）"
	}
	if in.RatePct < 0 || in.RatePct > 100 {
		errs["rate_pct"] = "费率越界（0-100 百分比）"
	}
	if in.AmountCents < 0 || in.AmountCents > 500_000 {
		errs["amount_cents"] = "固定附加费越界（0-500000 分）"
	}
	if in.MinCents < 0 || in.MinCents > 500_000 {
		errs["min_cents"] = "最低附加费越界（0-500000 分）"
	}
	if in.Priority < 1 || in.Priority > 99 {
		errs["priority"] = "优先级越界（1-99）"
	}
	switch in.Kind {
	case KindRemotePct:
		if in.RatePct == 0 && in.MinCents == 0 {
			errs["rate_pct"] = "偏远区费率型规则必须给出费率或最低额"
		}
	case KindHeavyPiece:
		if in.ThresholdG < 10_000 {
			errs["threshold_g"] = "单件超重门槛不得低于 10000 克"
		}
		if in.AmountCents == 0 {
			errs["amount_cents"] = "单件超重规则必须给出固定附加额"
		}
	case KindFragileFlat:
		if in.AmountCents == 0 {
			errs["amount_cents"] = "易碎加固规则必须给出固定附加额"
		}
	case KindLongHaul:
		if in.ThresholdKm < 100 {
			errs["threshold_km"] = "长途干线门槛不得低于 100 公里"
		}
		if in.AmountCents == 0 {
			errs["amount_cents"] = "长途干线规则必须给出固定附加额"
		}
	}
	return errs, len(errs) == 0
}
