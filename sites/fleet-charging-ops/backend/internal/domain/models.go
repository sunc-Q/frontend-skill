package domain

import (
	"strings"
	"time"
	"unicode/utf8"
)

// ---- 分时电价配置 ----

const (
	PeriodPeak   = "peak"   // 高峰
	PeriodFlat   = "flat"   // 平段
	PeriodValley = "valley" // 低谷

	DayAny     = "any"
	DayWeekday = "weekday"
	DayWeekend = "weekend"

	// 业务日历固定 UTC+8：分时窗口、周末判定、发号业务日都按它折算。
	BizOffsetHours = 8

	// 超时占用费：充满后继续占桩，按分钟计，整型分/分钟，封顶 MaxOverstayMin。
	OverstayCentsPerMin = 8
	MaxOverstayMin      = 360
)

// Pile 充电桩：站端资产。status 只有三态，运维台可切换（有在充会话时禁止切离在线）。
const (
	PileOnline      = "online"
	PileMaintenance = "maintenance"
	PileOffline     = "offline"
)

func ValidPileStatus(s string) bool {
	switch s {
	case PileOnline, PileMaintenance, PileOffline:
		return true
	}
	return false
}

const (
	PileTypeDC = "dc" // 直流快充
	PileTypeAC = "ac" // 交流慢充
)

type Pile struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	Code      string    `gorm:"uniqueIndex;size:24" json:"code"`
	Station   string    `gorm:"size:40" json:"station"`   // 场站
	Bay       string    `gorm:"size:24" json:"bay"`       // 车位号
	Type      string    `gorm:"size:8;index" json:"type"` // dc|ac
	PowerKw   int       `gorm:"column:power_kw" json:"power_kw"`
	Status    string    `gorm:"size:16;index" json:"status"`
	Note      string    `gorm:"size:80" json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

// Vehicle 车队车辆：绑定一张充电卡。司机手机号绝不外发原文。
type Vehicle struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	PlateNo    string    `gorm:"uniqueIndex;size:16;column:plate_no" json:"plate_no"`
	Model      string    `gorm:"size:40" json:"model"`
	Dept       string    `gorm:"size:32" json:"dept"` // 所属车队（干线/冷链/通勤…）
	BatteryKwh int       `gorm:"column:battery_kwh" json:"battery_kwh"`
	DriverName string    `gorm:"size:40" json:"driver_name"`
	Phone      string    `gorm:"size:16;column:driver_phone" json:"-"` // 只出掩码
	CardNo     string    `gorm:"uniqueIndex;size:20" json:"card_no"`
	Active     bool      `gorm:"index" json:"active"`
	CreatedAt  time.Time `json:"created_at"`
}

// TariffRule 分时电价规则：一条规则 = 「某类日期的一段窗口」的电量单价 + 服务费单价。
// 同分钟多规则命中时按 priority 小者优先（与窗口边界一起保证确定性）。
type TariffRule struct {
	ID           int64     `gorm:"primaryKey" json:"id"`
	Code         string    `gorm:"uniqueIndex;size:24" json:"code"`
	Name         string    `gorm:"size:40" json:"name"`
	Period       string    `gorm:"size:12;index" json:"period"`
	DayType      string    `gorm:"size:12;column:day_type" json:"day_type"` // any|weekday|weekend
	StartMin     int       `gorm:"column:start_min" json:"start_min"`       // 本地日 [start,end) 分钟
	EndMin       int       `gorm:"column:end_min" json:"end_min"`           // start>end 表示跨零点
	ElecCents    int64     `gorm:"column:elec_cents_per_kwh" json:"elec_cents_per_kwh"`
	ServiceCents int64     `gorm:"column:service_cents_per_kwh" json:"service_cents_per_kwh"`
	Priority     int       `gorm:"column:rule_priority" json:"priority"`
	Active       bool      `gorm:"index" json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

// CoversLocalMinute 判断规则是否覆盖「本地日内第 m 分钟」。
func (t TariffRule) CoversLocalMinute(m int) bool {
	if t.StartMin == t.EndMin {
		return false
	}
	if t.StartMin < t.EndMin {
		return m >= t.StartMin && m < t.EndMin
	}
	return m >= t.StartMin || m < t.EndMin // 跨零点窗口
}

func (t TariffRule) CoversDay(weekend bool) bool {
	switch t.DayType {
	case DayWeekend:
		return weekend
	case DayWeekday:
		return !weekend
	default:
		return true
	}
}

// ---- 充电会话 ----

const (
	SessCharging  = "charging"  // 在充
	SessCompleted = "completed" // 已结算
	SessFaulted   = "faulted"   // 故障挂起（未结算）
	SessAborted   = "aborted"   // 故障弃单（不计费，终态）
)

// SessionNext 是唯一的状态跃迁表：接口层与测试都只认它。
var SessionNext = map[string][]string{
	SessCharging:  {SessCompleted, SessFaulted},
	SessFaulted:   {SessCompleted, SessAborted},
	SessCompleted: {},
	SessAborted:   {},
}

func ValidSessionStatus(s string) bool {
	_, ok := SessionNext[s]
	return ok
}

func CanAdvance(from, to string) bool {
	for _, n := range SessionNext[from] {
		if n == to {
			return true
		}
	}
	return false
}

// IsOpen 表示该会话仍占用桩与车（在充或故障挂起）。
func IsOpen(status string) bool { return status == SessCharging || status == SessFaulted }

var StatusLabel = map[string]string{
	SessCharging:    "充电中",
	SessCompleted:   "已结算",
	SessFaulted:     "故障挂起",
	SessAborted:     "已弃单",
	PileOnline:      "在线",
	PileMaintenance: "检修",
	PileOffline:     "离线",
}

// ChargeSession 充电会话：结算后金额与分时拆分全部落库为快照，
// 之后电价表怎么改都不回溯历史单（与线上计价共用同一引擎）。
type ChargeSession struct {
	ID        int64  `gorm:"primaryKey" json:"id"`
	Code      string `gorm:"uniqueIndex;size:24" json:"code"`
	PileID    int64  `gorm:"index;column:pile_id" json:"pile_id"`
	VehicleID int64  `gorm:"index;column:vehicle_id" json:"vehicle_id"`
	Status    string `gorm:"size:16;index" json:"status"`

	StartAt   time.Time  `json:"start_at"`
	EndAt     *time.Time `json:"end_at,omitempty"`
	PlannedWh int64      `gorm:"column:planned_wh" json:"planned_wh"`
	ActualWh  int64      `gorm:"column:actual_wh" json:"actual_wh"`

	// 结算快照（金额全部由 ComputeBill 产出）
	ElecCents     int64  `gorm:"column:elec_cents" json:"elec_cents"`
	ServiceCents  int64  `gorm:"column:service_cents" json:"service_cents"`
	OverstayCents int64  `gorm:"column:overstay_cents" json:"overstay_cents"`
	TotalCents    int64  `gorm:"column:total_cents" json:"total_cents"`
	OverstayMin   int    `gorm:"column:overstay_min" json:"overstay_min"`
	SegPeakWh     int64  `gorm:"column:seg_peak_wh" json:"seg_peak_wh"`
	SegFlatWh     int64  `gorm:"column:seg_flat_wh" json:"seg_flat_wh"`
	SegValleyWh   int64  `gorm:"column:seg_valley_wh" json:"seg_valley_wh"`
	SegUnpricedWh int64  `gorm:"column:seg_unpriced_wh" json:"seg_unpriced_wh"`
	SegDetail     string `gorm:"size:2000;column:seg_detail" json:"-"` // JSON 明细，出口在视图
	Note          string `gorm:"size:120" json:"note"`

	UpdatedAt time.Time `json:"updated_at"`
}

// ---- 读取视图 ----

type PileRow struct {
	Pile
	OpenSessions int64 `gorm:"-" json:"open_sessions"` // 在充+故障挂起
	Sessions     int64 `gorm:"-" json:"sessions"`
	EnergyKwh    int64 `gorm:"-" json:"energy_kwh"`
}

type VehicleRow struct {
	Vehicle
	PhoneMasked string `gorm:"-" json:"phone_masked"`
	Sessions    int64  `gorm:"-" json:"sessions"`
	EnergyKwh   int64  `gorm:"-" json:"energy_kwh"`
}

type SessionRow struct {
	ChargeSession
	PileCode    string        `gorm:"column:pile_code" json:"pile_code"`
	Station     string        `gorm:"column:station" json:"station"`
	Bay         string        `gorm:"column:bay" json:"bay"`
	PowerKw     int           `gorm:"column:power_kw" json:"power_kw"`
	PlateNo     string        `gorm:"column:plate_no" json:"plate_no"`
	Dept        string        `gorm:"column:dept" json:"dept"`
	DriverName  string        `gorm:"column:driver_name" json:"driver_name"`
	PhoneMasked string        `gorm:"-" json:"phone_masked"`
	DurationMin int           `gorm:"-" json:"duration_min"`
	AvgPowerKw  int           `gorm:"-" json:"avg_power_kw"`
	Segments    []SegmentView `gorm:"-" json:"segments"`
	Covered     bool          `gorm:"-" json:"covered"`
}

type SessionDetail struct {
	SessionRow
	RateBoard []RateWindow `json:"rate_board"` // 结算当时生效的价目窗口（口径回显）
}

// SegmentView 是结算明细里的一行分时窗口拆分。
type SegmentView struct {
	Period       string    `json:"period"`
	RuleCode     string    `json:"rule_code"`
	RuleName     string    `json:"rule_name"`
	StartAt      time.Time `json:"start_at"`
	EndAt        time.Time `json:"end_at"`
	Minutes      int       `json:"minutes"`
	Wh           int64     `json:"wh"`
	ElecCents    int64     `json:"elec_cents"`
	ServiceCents int64     `json:"service_cents"`
}

// RateWindow 是价目表回显：告诉前端当前生效的分时窗口。
type RateWindow struct {
	Period       string `json:"period"`
	DayType      string `json:"day_type"`
	Window       string `json:"window"`
	ElecCents    int64  `json:"elec_cents_per_kwh"`
	ServiceCents int64  `json:"service_cents_per_kwh"`
	RuleCode     string `json:"rule_code"`
}

// ---- 写入 DTO ----

type StartSessionInput struct {
	PileCode  string `json:"pile_code"`
	PlateNo   string `json:"plate_no"`
	PlannedWh int64  `json:"planned_wh"`
	Note      string `json:"note"`
}

type SettleInput struct {
	ActualWh    int64 `json:"actual_wh"`
	OverstayMin int   `json:"overstay_min"`
	Faulted     bool  `json:"faulted_settled"` // 仅用于回显：从故障态补结算
}

type FaultInput struct {
	Reason string `json:"reason"`
}

type AbortInput struct {
	Reason string `json:"reason"`
}

type CreateTariffInput struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Period       string `json:"period"`
	DayType      string `json:"day_type"`
	StartMin     int    `json:"start_min"`
	EndMin       int    `json:"end_min"`
	ElecCents    int64  `json:"elec_cents_per_kwh"`
	ServiceCents int64  `json:"service_cents_per_kwh"`
	Priority     int    `json:"priority"`
}

type PileStatusInput struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

func ValidPeriod(p string) bool {
	switch p {
	case PeriodPeak, PeriodFlat, PeriodValley:
		return true
	}
	return false
}

func ValidDayType(d string) bool {
	switch d {
	case DayAny, DayWeekday, DayWeekend:
		return true
	}
	return false
}

// ---- 通用校验 ----

const (
	MaxNameRunes = 40
	MaxNoteRunes = 120
	MinWh        = 100     // 0.1 kWh 起，过滤误录
	MaxWh        = 600_000 // 600 kWh，大于任何单车电池
)

// CodeAllowed 只放行字母数字与 -_：注入串在这里就被挡下。
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

// PlateAllowed：首位汉字省份 + 1 位大写字母 + 5-6 位大写字母/数字（总长 7-8 字）。
func PlateAllowed(s string) bool {
	rs := []rune(s)
	if len(rs) < 7 || len(rs) > 8 {
		return false
	}
	if rs[0] < 0x4E00 || rs[0] > 0x9FFF {
		return false
	}
	if rs[1] < 'A' || rs[1] > 'Z' {
		return false
	}
	for _, r := range rs[2:] {
		if !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
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

func (in StartSessionInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.PileCode) < 2 || len(in.PileCode) > 24 || !CodeAllowed(in.PileCode) {
		errs["pile_code"] = "桩编号需为 2-24 位字母、数字、- 或 _"
	}
	if !PlateAllowed(in.PlateNo) {
		errs["plate_no"] = "车牌需为「汉字+大写字母+5-6 位大写字母/数字」"
	}
	if in.PlannedWh < MinWh || in.PlannedWh > MaxWh {
		errs["planned_wh"] = "计划电量越界（100-600000 瓦时）"
	}
	if n := utf8.RuneCountInString(in.Note); n > MaxNoteRunes {
		errs["note"] = "备注不得超过 120 个字符"
	}
	return errs, len(errs) == 0
}

func (in SettleInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if in.ActualWh < MinWh || in.ActualWh > MaxWh {
		errs["actual_wh"] = "实际电量越界（100-600000 瓦时）"
	}
	if in.OverstayMin < 0 || in.OverstayMin > MaxOverstayMin {
		errs["overstay_min"] = "超时占桩分钟越界（0-360）"
	}
	return errs, len(errs) == 0
}

func (in FaultInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Reason)); n < 2 || n > MaxNoteRunes {
		errs["reason"] = "故障原因需为 2-120 个字符"
	}
	return errs, len(errs) == 0
}

func (in AbortInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Reason)); n < 2 || n > MaxNoteRunes {
		errs["reason"] = "弃单原因需为 2-120 个字符"
	}
	return errs, len(errs) == 0
}

func (in CreateTariffInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Code) < 2 || len(in.Code) > 24 || !CodeAllowed(in.Code) {
		errs["code"] = "规则标识需为 2-24 位字母、数字、- 或 _"
	}
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > MaxNameRunes {
		errs["name"] = "规则名称需为 1-40 个字符"
	}
	if !ValidPeriod(in.Period) {
		errs["period"] = "period 只能是 peak / flat / valley"
	}
	if !ValidDayType(in.DayType) {
		errs["day_type"] = "day_type 只能是 any / weekday / weekend"
	}
	if in.StartMin < 0 || in.StartMin > 1439 {
		errs["start_min"] = "窗口起点越界（0-1439 分钟）"
	}
	if in.EndMin < 0 || in.EndMin > 1440 {
		errs["end_min"] = "窗口终点越界（0-1440 分钟）"
	}
	if in.StartMin == in.EndMin {
		errs["end_min"] = "窗口起止不能相同（全天请用 0-1440）"
	}
	if in.ElecCents < 1 || in.ElecCents > 500 {
		errs["elec_cents_per_kwh"] = "电价越界（1-500 分/千瓦时）"
	}
	if in.ServiceCents < 0 || in.ServiceCents > 300 {
		errs["service_cents_per_kwh"] = "服务费越界（0-300 分/千瓦时）"
	}
	if in.Priority < 1 || in.Priority > 99 {
		errs["priority"] = "优先级越界（1-99）"
	}
	return errs, len(errs) == 0
}

func (in PileStatusInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidPileStatus(in.Status) {
		errs["status"] = "status 只能是 online / maintenance / offline"
	}
	if n := utf8.RuneCountInString(in.Note); n > 80 {
		errs["note"] = "备注不得超过 80 个字符"
	}
	return errs, len(errs) == 0
}
