// Package domain 放实体、口径与校验：这里不碰 HTTP，也不碰 SQL 驱动。
package domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// ---------- 日期工具：全程用 YYYY-MM-DD 字符串，避免时区把"住几晚"算错 ----------

const DateLayout = "2006-01-02"

var zeroTime time.Time

// ParseDate 宽松但严格到格式：只接受 YYYY-MM-DD，且必须能还原成同一串。
func ParseDate(s string) (time.Time, error) {
	t, err := time.Parse(DateLayout, strings.TrimSpace(s))
	if err != nil {
		return zeroTime, fmt.Errorf("日期需为 %s 形式", DateLayout)
	}
	return t, nil
}

// ValidDate 供校验分支使用。
func ValidDate(s string) bool {
	_, err := ParseDate(s)
	return err == nil
}

// MustDate 只用于确定性种子里的字面量，写错直接 panic（测试会立刻暴露）。
func MustDate(s string) time.Time {
	t, err := ParseDate(s)
	if err != nil {
		panic(err)
	}
	return t
}

// DateStr 把时间戳按本地日历日格式化。
func DateStr(t time.Time) string { return t.Format(DateLayout) }

// AddDays 在日历日维度加减，跳过夏令时导致的 23/25 小时问题。
func AddDays(s string, n int) string {
	t, err := ParseDate(s)
	if err != nil {
		return s
	}
	return t.AddDate(0, 0, n).Format(DateLayout)
}

// DaysBetween 返回 from→to 的自然日差；to<=from 时为负数，由调用方判定。
func DaysBetween(from, to string) int {
	a, err1 := ParseDate(from)
	b, err2 := ParseDate(to)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(b.Sub(a).Hours() / 24)
}

// EachNight 枚举 [checkin, checkout) 的每一晚——离店日不计夜，这是全系统唯一口径。
func EachNight(checkIn, checkOut string) []string {
	n := DaysBetween(checkIn, checkOut)
	if n <= 0 {
		return nil
	}
	out := make([]string, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, AddDays(checkIn, i))
	}
	return out
}

// WeekdayCN 给日历格子做显示。
func WeekdayCN(date string) string {
	t, err := ParseDate(date)
	if err != nil {
		return ""
	}
	return [...]string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}[int(t.Weekday())]
}

// IsWeekendNight 只有周五、周六两晚算周末（酒店业口径，不是周六周日）。
func IsWeekendNight(date string) bool {
	t, err := ParseDate(date)
	if err != nil {
		return false
	}
	wd := t.Weekday()
	return wd == time.Friday || wd == time.Saturday
}

// ---------- 枚举 ----------

const (
	RoomActive   = "active"
	RoomInactive = "inactive"
)

func ValidRoomStatus(s string) bool { return s == RoomActive || s == RoomInactive }

// 订单状态机：
//
//	pending ──▶ confirmed ──▶ checked_in ──▶ checked_out(终)
//	   │            │
//	   │            ├──▶ no_show(终)
//	   └──▶ cancelled(终) ◀──┘
//
// no_show 的库存释放与 cancelled 一致（当天没来就把房放出去），但营收口径保留。
const (
	StPending    = "pending"
	StConfirmed  = "confirmed"
	StCheckedIn  = "checked_in"
	StCheckedOut = "checked_out"
	StCancelled  = "cancelled"
	StNoShow     = "no_show"
)

var bookingNext = map[string][]string{
	StPending:    {StConfirmed, StCheckedIn, StCancelled},
	StConfirmed:  {StCheckedIn, StCheckedOut, StCancelled, StNoShow},
	StCheckedIn:  {StCheckedOut, StNoShow},
	StCheckedOut: nil,
	StCancelled:  nil,
	StNoShow:     nil,
}

func ValidBookingStatus(s string) bool {
	_, ok := bookingNext[s]
	return ok
}

// CanTransit 判定推进是否合法；from==to 也算非法（重复推进要 409）。
func CanTransit(from, to string) bool {
	for _, n := range bookingNext[from] {
		if n == to {
			return true
		}
	}
	return false
}

func BookingStatuses() []string {
	return []string{StPending, StConfirmed, StCheckedIn, StCheckedOut, StCancelled, StNoShow}
}

// HoldsRoom 判定一份订单是否仍占着库存。
func HoldsRoom(status string) bool {
	return status == StPending || status == StConfirmed || status == StCheckedIn
}

// CountsRevenue 判定一份订单是否计入营收。作废（cancelled）与未成交的 pending 不计，
// no_show 计营收但不占库存。
func CountsRevenue(status string) bool {
	return status == StConfirmed || status == StCheckedIn || status == StCheckedOut || status == StNoShow
}

// CountsNights 判定一份订单是否计入已售房晚（ADR/OCC 的分母分子）。口径与营收一致。
func CountsNights(status string) bool { return CountsRevenue(status) }

const (
	ChDirect   = "direct"
	ChCtrip    = "ota_ctrip"
	ChMeituan  = "ota_meituan"
	ChAirbnb   = "ota_airbnb"
	ChWalkIn   = "walk_in"
	ChReferrer = "referrer"
)

func ValidChannel(s string) bool {
	switch s {
	case ChDirect, ChCtrip, ChMeituan, ChAirbnb, ChWalkIn, ChReferrer:
		return true
	}
	return false
}

func Channels() []string {
	return []string{ChDirect, ChCtrip, ChMeituan, ChAirbnb, ChWalkIn, ChReferrer}
}

// ---------- 日历条目类型 ----------

const (
	KindWeekday = "weekday" // 平日基准价
	KindWeekend = "weekend" // 周五/周六晚加价
	KindHoliday = "holiday" // 节假日加价（来自日历表）
	KindPromo   = "promo"   // 人工改价（来自日历表）
	KindClosed  = "closed"  // 停售（包场/维修）
)

// ---------- 实体 ----------

// Property 是一家门店（院），承载入住/退房时间与清洁缓冲等整院政策。
type Property struct {
	ID              uint   `gorm:"primaryKey"`
	Code            string `gorm:"column:code;uniqueIndex;size:16"`
	Name            string `gorm:"column:name;size:64"`
	Region          string `gorm:"column:region;size:32"`
	Intro           string `gorm:"column:intro;size:255"`
	CheckInAt       string `gorm:"column:check_in_at;size:5"`
	CheckOutAt      string `gorm:"column:check_out_at;size:5"`
	CleanBufferDays int    `gorm:"column:clean_buffer_days"`
	MinStayWeekend  int    `gorm:"column:min_stay_weekend"`
	Rating          int    `gorm:"column:rating"` // 千分制评分，4850 = 4.85
}

func (Property) TableName() string { return "properties" }

// RoomType 是一个可售房型。Units 是物理库存间数，价格是"分"整型，倍率是百分数。
type RoomType struct {
	ID             uint   `gorm:"primaryKey"`
	Code           string `gorm:"column:code;uniqueIndex;size:24"`
	PropertyCode   string `gorm:"column:property_code;size:16;index"`
	Name           string `gorm:"column:name;size:64"`
	Beds           string `gorm:"column:beds;size:64"`
	Capacity       int    `gorm:"column:capacity"`
	Units          int    `gorm:"column:units"`
	BasePriceCents int64  `gorm:"column:base_price_cents"`
	WeekendPct     int    `gorm:"column:weekend_pct"`
	HolidayPct     int    `gorm:"column:holiday_pct"`
	CleanFeeCents  int64  `gorm:"column:clean_fee_cents"`
	Breakfast      bool   `gorm:"column:breakfast"`
	Scene          string `gorm:"column:scene;size:64"`
	Amenities      string `gorm:"column:amenities;size:255"`
	Status         string `gorm:"column:status;size:16;index"`
	MinStayDefault int    `gorm:"column:min_stay_default"`
	SortOrder      int    `gorm:"column:sort_order"`
}

func (RoomType) TableName() string { return "room_types" }

// RateDay 是逐日日历覆盖项：全局（节假日）/整院/单房型三种作用域。
// PriceCents>0 时改价（KindPromo/KindHoliday 的绝对价），KindClosed 表示该日停售。
type RateDay struct {
	ID         uint   `gorm:"primaryKey"`
	Date       string `gorm:"column:date;size:10;uniqueIndex:idx_rate_day"`
	Scope      string `gorm:"column:scope;size:16;uniqueIndex:idx_rate_day"` // global|property|room
	RefCode    string `gorm:"column:ref_code;size:24;uniqueIndex:idx_rate_day"`
	Kind       string `gorm:"column:kind;size:16"`
	HolidayPct int    `gorm:"column:holiday_pct"`
	PriceCents int64  `gorm:"column:price_cents"`
	Label      string `gorm:"column:label;size:64"`
}

func (RateDay) TableName() string { return "rate_days" }

// Booking 是一份预订：区间 [CheckIn, CheckOut) 占用 Units 间，金额三口径落库。
type Booking struct {
	ID                 uint      `gorm:"primaryKey"`
	Code               string    `gorm:"column:code;uniqueIndex;size:24"`
	RoomCode           string    `gorm:"column:room_code;size:24;index"`
	PropertyCode       string    `gorm:"column:property_code;size:16;index"`
	GuestName          string    `gorm:"column:guest_name;size:32"`
	Phone              string    `gorm:"column:phone;size:20;index" json:"-"`
	CheckIn            string    `gorm:"column:check_in;size:10;index"`
	CheckOut           string    `gorm:"column:check_out;size:10"`
	Units              int       `gorm:"column:units"`
	Guests             int       `gorm:"column:guests"`
	Channel            string    `gorm:"column:channel;size:16;index"`
	Status             string    `gorm:"column:status;size:16;index"`
	NightSubtotalCents int64     `gorm:"column:night_subtotal_cents"`
	CleanFeeCents      int64     `gorm:"column:clean_fee_cents"`
	TotalCents         int64     `gorm:"column:total_cents"`
	RefundCents        int64     `gorm:"column:refund_cents"`
	AvgNightPriceCents int64     `gorm:"column:avg_night_price_cents" json:"-"`
	Nights             int       `gorm:"column:nights"`
	Note               string    `gorm:"column:note;size:255"`
	CreatedAt          time.Time `gorm:"column:created_at"`
	UpdatedAt          time.Time `gorm:"column:updated_at"`
}

func (Booking) TableName() string { return "bookings" }

// BookingNight 是逐夜拆价留痕：它是 subtotal=Σamount 这条恒等式的证据，
// 也是 ADR/OCC/RevPAR 的唯一数据来源（统计层不再算第二次价）。
type BookingNight struct {
	ID          uint   `gorm:"primaryKey"`
	BookingID   uint   `gorm:"column:booking_id;index"`
	BookingCode string `gorm:"column:booking_code;size:24;index"`
	Date        string `gorm:"column:date;size:10;index"`
	Kind        string `gorm:"column:kind;size:16"`
	Label       string `gorm:"column:label;size:64"`
	PriceCents  int64  `gorm:"column:price_cents"`
	Units       int    `gorm:"column:units"`
	AmountCents int64  `gorm:"column:amount_cents"`
}

func (BookingNight) TableName() string { return "booking_nights" }

// ---------- 价格引擎（唯一一份：线上试算、下单、种子回放共用） ----------

// NightPrice 是某一晚对一个房型解析出的成交价。
type NightPrice struct {
	Date        string `json:"date"`
	Weekday     string `json:"weekday"`
	Kind        string `json:"kind"`
	Label       string `json:"label,omitempty"`
	PriceCents  int64  `json:"price_cents"`
	BaseCents   int64  `json:"base_cents"`
	AmountCents int64  `json:"amount_cents"`
	Units       int    `json:"units"`
}

// ResolveNight 按「单房型覆盖 → 整院覆盖 → 全局节假日 → 周末倍率 → 平日基准」五级优先级
// 给出某晚成交价。cal 的键是 scope|ref|date。
func ResolveNight(rt RoomType, date string, cal map[string]RateDay) NightPrice {
	np := NightPrice{Date: date, Weekday: WeekdayCN(date), Kind: KindWeekday, BaseCents: rt.BasePriceCents}
	for _, ov := range []RateDay{
		cal[ScopeRoom+"|"+rt.Code+"|"+date],
		cal[ScopeProperty+"|"+rt.PropertyCode+"|"+date],
		cal[ScopeGlobal+"||"+date],
	} {
		switch ov.Kind {
		case KindClosed:
			np.Kind = KindClosed
			np.Label = ov.Label
			return np
		case KindPromo:
			if ov.PriceCents > 0 {
				np.Kind = KindPromo
				np.PriceCents = ov.PriceCents
				np.Label = firstNonEmpty(ov.Label, "限时特价")
				return np
			}
		case KindHoliday:
			if np.Kind != KindHoliday {
				np.Kind = KindHoliday
				np.Label = ov.Label
				pct := ov.HolidayPct
				if pct == 0 {
					pct = rt.HolidayPct
				}
				np.PriceCents = applyPct(rt.BasePriceCents, pct)
			}
		}
	}
	if np.Kind == KindWeekday {
		if IsWeekendNight(date) {
			np.Kind = KindWeekend
			np.PriceCents = applyPct(rt.BasePriceCents, rt.WeekendPct)
		} else {
			np.PriceCents = rt.BasePriceCents
		}
	}
	return np
}

const (
	ScopeGlobal   = "global"
	ScopeProperty = "property"
	ScopeRoom     = "room"
)

// applyPct 把百分数加价作用到基准价上，并按 10 分取整（民宿报价的常见做法：不出现零头分）。
func applyPct(base int64, pct int) int64 {
	v := base + base*int64(pct)/100
	return v - v%10
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// ---------- 输入与校验 ----------

// BookingInput 是下单请求体。
type BookingInput struct {
	CheckIn   string `json:"check_in"`
	CheckOut  string `json:"check_out"`
	Units     int    `json:"units"`
	Guests    int    `json:"guests"`
	GuestName string `json:"guest_name"`
	Phone     string `json:"phone"`
	Channel   string `json:"channel"`
	Note      string `json:"note"`
}

const (
	MaxNights  = 30
	MaxUnits   = 8
	MaxNoteRun = 60
)

// Validate 逐项校验并回传字段级错误；长度合规不等于合法，手机号必须是纯数字。
func (in BookingInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidDate(in.CheckIn) {
		errs["check_in"] = "需为 YYYY-MM-DD"
	}
	if !ValidDate(in.CheckOut) {
		errs["check_out"] = "需为 YYYY-MM-DD"
	}
	if len(errs) == 0 {
		n := DaysBetween(in.CheckIn, in.CheckOut)
		if n <= 0 {
			errs["check_out"] = "必须晚于入住日"
		} else if n > MaxNights {
			errs["check_out"] = fmt.Sprintf("单次最长 %d 晚", MaxNights)
		}
	}
	if in.Units <= 0 {
		errs["units"] = "至少 1 间"
	} else if in.Units > MaxUnits {
		errs["units"] = fmt.Sprintf("单次最多 %d 间", MaxUnits)
	}
	if in.Guests <= 0 {
		errs["guests"] = "至少 1 位入住人"
	} else if in.Guests > MaxUnits*6 {
		errs["guests"] = "入住人数超出上限"
	}
	if r := utf8.RuneCountInString(strings.TrimSpace(in.GuestName)); r == 0 {
		errs["guest_name"] = "必填"
	} else if r > 20 {
		errs["guest_name"] = "最长 20 字"
	}
	if !ValidPhone(in.Phone) {
		errs["phone"] = "需为 11 位中国大陆手机号"
	}
	if in.Channel == "" {
		errs["channel"] = "必填"
	} else if !ValidChannel(in.Channel) {
		errs["channel"] = "渠道不在白名单内"
	}
	if r := utf8.RuneCountInString(in.Note); r > MaxNoteRun {
		errs["note"] = fmt.Sprintf("最长 %d 字", MaxNoteRun)
	}
	return errs, len(errs) == 0
}

// ValidPhone 只接受 1[3-9] 开头的 11 位数字：既挡住空号，也挡住把 SQL 片段塞进手机号的做法。
func ValidPhone(s string) bool {
	t := strings.TrimSpace(s)
	if len(t) != 11 || t[0] != '1' || t[1] < '3' || t[1] > '9' {
		return false
	}
	for i := 0; i < len(t); i++ {
		if t[i] < '0' || t[i] > '9' {
			return false
		}
	}
	return true
}

// MaskPhone 是唯一的手机号出口形态。
func MaskPhone(s string) string {
	t := strings.TrimSpace(s)
	if len(t) != 11 {
		return "***"
	}
	return t[:3] + "****" + t[7:]
}

// StatusInput 是状态推进请求体。
type StatusInput struct {
	To   string `json:"to"`
	Note string `json:"note"`
}

func (in StatusInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidBookingStatus(in.To) {
		errs["to"] = "目标状态不在状态机内"
	}
	if r := utf8.RuneCountInString(in.Note); r > MaxNoteRun {
		errs["note"] = fmt.Sprintf("最长 %d 字", MaxNoteRun)
	}
	return errs, len(errs) == 0
}

// ClosureInput 是停售开关请求体。
type ClosureInput struct {
	Date   string `json:"date"`
	Closed bool   `json:"closed"`
	Label  string `json:"label"`
}

func (in ClosureInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidDate(in.Date) {
		errs["date"] = "需为 YYYY-MM-DD"
	}
	if r := utf8.RuneCountInString(in.Label); r > 20 {
		errs["label"] = "最长 20 字"
	}
	return errs, len(errs) == 0
}

// ---------- 对外视图 ----------

// RoomRow 是房型卡片（含未来窗口摘要，不含逐日明细）。
type RoomRow struct {
	Code           string `json:"code"`
	PropertyCode   string `json:"property_code"`
	PropertyName   string `json:"property_name"`
	Name           string `json:"name"`
	Beds           string `json:"beds"`
	Capacity       int    `json:"capacity"`
	Units          int    `json:"units"`
	BasePriceCents int64  `json:"base_price_cents"`
	WeekendPct     int    `json:"weekend_pct"`
	HolidayPct     int    `json:"holiday_pct"`
	CleanFeeCents  int64  `json:"clean_fee_cents"`
	Breakfast      bool   `json:"breakfast"`
	Scene          string `json:"scene"`
	Amenities      string `json:"amenities"`
	Status         string `json:"status"`
	MinStayDefault int    `json:"min_stay_default"`
	NightsSold     int    `json:"nights_sold"`
	Bookings       int    `json:"bookings"`
	RevenueCents   int64  `json:"revenue_cents"`
	ADR            int64  `json:"adr_cents"`
	OccBpsWindow   int    `json:"occ_bps_window"` // 未来窗口占用率，万分比
	NextFreeFrom   string `json:"next_free_from,omitempty"`
}

// CalDay 是日历格：一天 × 一个房型的可售状态。
type CalDay struct {
	Date       string `json:"date"`
	Weekday    string `json:"weekday"`
	Kind       string `json:"kind"`
	Label      string `json:"label,omitempty"`
	PriceCents int64  `json:"price_cents"`
	Units      int    `json:"units"`
	Occupied   int    `json:"occupied"`
	Available  int    `json:"available"`
	Closed     bool   `json:"closed"`
	FillBps    int    `json:"fill_bps"`
}

// QuoteResult 是试算结果：逐夜拆价 + 三口径 + 冲突明细。
type QuoteResult struct {
	Room          RoomRow      `json:"room"`
	CheckIn       string       `json:"check_in"`
	CheckOut      string       `json:"check_out"`
	Nights        int          `json:"nights"`
	Units         int          `json:"units"`
	Guests        int          `json:"guests"`
	NightsDetail  []NightPrice `json:"nights_detail"`
	NightSubtotal int64        `json:"night_subtotal_cents"`
	CleanFeeCents int64        `json:"clean_fee_cents"`
	TotalCents    int64        `json:"total_cents"`
	AvgNightCents int64        `json:"avg_night_cents"`
	Blockers      []string     `json:"blockers"`
	WeekendNights int          `json:"weekend_nights"`
	HolidayNights int          `json:"holiday_nights"`
	MinStay       int          `json:"min_stay"`
	RoomNights    int          `json:"room_nights"`
	Ok            bool         `json:"ok"`
}

// BookingRow 是订单出口视图：手机号永远只以 masked_phone 出现。
type BookingRow struct {
	Code          string   `json:"code"`
	RoomCode      string   `json:"room_code"`
	RoomName      string   `json:"room_name"`
	PropertyCode  string   `json:"property_code"`
	PropertyName  string   `json:"property_name"`
	GuestName     string   `json:"guest_name"`
	MaskedPhone   string   `json:"masked_phone"`
	CheckIn       string   `json:"check_in"`
	CheckOut      string   `json:"check_out"`
	Nights        int      `json:"nights"`
	Units         int      `json:"units"`
	Guests        int      `json:"guests"`
	Channel       string   `json:"channel"`
	Status        string   `json:"status"`
	HoldsRoom     bool     `json:"holds_room"`
	Revenue       bool     `json:"counts_revenue"`
	NightSubtotal int64    `json:"night_subtotal_cents"`
	CleanFeeCents int64    `json:"clean_fee_cents"`
	TotalCents    int64    `json:"total_cents"`
	RefundCents   int64    `json:"refund_cents"`
	PaidCents     int64    `json:"paid_cents"`
	AvgNightCents int64    `json:"avg_night_cents"`
	Note          string   `json:"note,omitempty"`
	NextStatuses  []string `json:"next_statuses"`
	CreatedAt     string   `json:"created_at"`
	UpdatedAt     string   `json:"updated_at"`
	DaysToCheckIn int      `json:"days_to_check_in"`
}

func (b *Booking) Row(pname, rname string, today string) BookingRow {
	r := BookingRow{
		Code: b.Code, RoomCode: b.RoomCode, RoomName: rname,
		PropertyCode: b.PropertyCode, PropertyName: pname,
		GuestName: b.GuestName, MaskedPhone: MaskPhone(b.Phone),
		CheckIn: b.CheckIn, CheckOut: b.CheckOut, Nights: b.Nights,
		Units: b.Units, Guests: b.Guests, Channel: b.Channel, Status: b.Status,
		HoldsRoom: HoldsRoom(b.Status), Revenue: CountsRevenue(b.Status),
		NightSubtotal: b.NightSubtotalCents, CleanFeeCents: b.CleanFeeCents,
		TotalCents: b.TotalCents, RefundCents: b.RefundCents,
		PaidCents:     b.TotalCents - b.RefundCents,
		AvgNightCents: b.AvgNightPriceCents,
		Note:          b.Note,
		NextStatuses:  bookingNext[b.Status],
		DaysToCheckIn: DaysBetween(today, b.CheckIn),
	}
	if r.NextStatuses == nil {
		r.NextStatuses = []string{}
	}
	if !b.CreatedAt.IsZero() {
		r.CreatedAt = b.CreatedAt.Format(time.RFC3339)
	}
	if !b.UpdatedAt.IsZero() {
		r.UpdatedAt = b.UpdatedAt.Format(time.RFC3339)
	}
	return r
}

// PropertyRow 是门店卡片。
type PropertyRow struct {
	Code            string    `json:"code"`
	Name            string    `json:"name"`
	Region          string    `json:"region"`
	Intro           string    `json:"intro"`
	CheckInAt       string    `json:"check_in_at"`
	CheckOutAt      string    `json:"check_out_at"`
	CleanBufferDays int       `json:"clean_buffer_days"`
	MinStayWeekend  int       `json:"min_stay_weekend"`
	Rating          int       `json:"rating"`
	Rooms           []RoomRow `json:"rooms"`
	UnitTotal       int       `json:"unit_total"`
	NightsSold      int       `json:"nights_sold"`
	RevenueCents    int64     `json:"revenue_cents"`
	ADR             int64     `json:"adr_cents"`
	OccBpsWindow    int       `json:"occ_bps_window"`
}

// RefundFor 是取消退款阶梯：≥7 晚前全退、3~6 晚前退五成、更晚不退。
// 清洁费不退（已经派人打扫）。返回的 refund 一定 ≤ total-clean_fee。
func RefundFor(b *Booking, today string) (int64, string) {
	switch b.Status {
	case StCancelled, StNoShow, StCheckedOut, StCheckedIn:
		return b.RefundCents, "已离开可取消阶段"
	}
	d := DaysBetween(today, b.CheckIn)
	roomPart := b.TotalCents - b.CleanFeeCents
	switch {
	case b.Status == StPending:
		return roomPart, "未确认订单可全额取消房费"
	case d >= 7:
		return roomPart, "入住前 7 天以上，房费全额退回"
	case d >= 3:
		v := roomPart - roomPart%10
		return v / 2, "入住前 3~6 天，房费退五成"
	default:
		return 0, "入住前 3 天内取消，房费不退"
	}
}

// QuoteIdentity 供接口层自检：三口径必须自洽，否则宁可报错也不给出错的钱数。
func (q *QuoteResult) IdentityOK() bool {
	var sum int64
	for _, n := range q.NightsDetail {
		sum += n.AmountCents
	}
	return sum == q.NightSubtotal && q.TotalCents == q.NightSubtotal+q.CleanFeeCents
}

// DateRange 解析 ?from=&days= 并夹到 [1,90]，默认从今天起 28 天。
func DateRange(today, from string, days, defDays int) (string, int) {
	start := strings.TrimSpace(from)
	if !ValidDate(start) {
		start = today
	}
	if days <= 0 {
		days = defDays
	}
	if days > 90 {
		days = 90
	}
	if days < 1 {
		days = 1
	}
	return start, days
}
