package domain

import (
	"strconv"
	"strings"
	"time"
)

// 金额一律以「分」整型存储；时间一律 UTC（SQLite 的 datetime 是文本，
// 混用 +08:00 与 +00:00 会让 ORDER BY 退化成字符串排序）。

// 场次状态机：draft → on_sale → closed，非终态可 → cancelled。
// sold_out 刻意不作为存储状态：它完全由票档配额派生，存下来必然与票档漂移。
const (
	EventDraft   = "draft"
	EventOnSale  = "on_sale"
	EventClosed  = "closed"
	EventCanceld = "cancelled"
)

// 订单状态机：pending → paid → refunded；pending → cancelled。
const (
	OrderPending   = "pending"
	OrderPaid      = "paid"
	OrderRefunded  = "refunded"
	OrderCancelled = "cancelled"
)

// 票券状态机：valid → used（核销）｜valid → void（随单退票）。
// used 与 void 都是终态：已进场的票不允许退票，已退票的票不允许核销。
const (
	TicketValid = "valid"
	TicketUsed  = "used"
	TicketVoid  = "void"
)

const (
	TypeOpen   = "open"
	TypePaused = "paused"
)

// 销售渠道：网络 / 售票亭 / 合作方分销 / 现场补票。
const (
	ChannelWeb     = "web"
	ChannelBox     = "box"
	ChannelPartner = "partner"
	ChannelOnsite  = "onsite"
)

// 退票窗口口径：开演前 refund_cutoff_hours 之外可整单退，
// 且服务费一律不退（那是已经发生的技术与支付通道成本）。
const (
	RefundCutoffMinHours = 2
	RefundCutoffMaxHours = 72
	// 提前入场余量：开门前这段时间允许已购票观众进场（送站/安检查验）。
	CheckinPreDoorsMin = 30
	// 开演后的迟到宽限：超过即关闸，票留在 valid 但不再补检。
	CheckinGraceMin = 240
	// 单笔订单购票张数上下限（防黄牛批量锁座）。
	OrderQtyMin = 1
	OrderQtyMax = 6
	// 基点：万分比。10000 = 全额。
	BasisPoint = 10000
	// 对号入座票的每排座位数：出票时按票档累计序号排座。
	SeatsPerRow = 12
)

type Event struct {
	ID       int64  `gorm:"primaryKey" json:"id"`
	Code     string `gorm:"uniqueIndex;size:24" json:"code"`
	Title    string `gorm:"size:120" json:"title"`
	Artist   string `gorm:"size:64" json:"artist"`
	Category string `gorm:"size:16;index" json:"category"`
	Venue    string `gorm:"size:48" json:"venue"`
	City     string `gorm:"size:24" json:"city"`
	// Gates 是逗号分隔的闸口清单，核销时闸门必须命中其中之一。
	Gates    string    `gorm:"size:48" json:"gates"`
	DoorsAt  time.Time `json:"doors_at"`
	StartAt  time.Time `json:"start_at"`
	OnSaleAt time.Time `json:"on_sale_at"`
	// PresaleEnd 之后早鸟立减归零（按票档的 early_bps 判定）。
	PresaleEnd time.Time  `json:"presale_end"`
	Status     string     `gorm:"size:16;index" json:"status"`
	RefundCutH int        `gorm:"column:refund_cutoff_hours" json:"refund_cutoff_hours"`
	Note       string     `gorm:"size:200" json:"note"`
	CreatedAt  time.Time  `json:"created_at"`
	ClosedAt   *time.Time `json:"closed_at,omitempty"`
}

type TicketType struct {
	ID       int64  `gorm:"primaryKey" json:"id"`
	Code     string `gorm:"uniqueIndex;size:24" json:"code"`
	EventID  int64  `gorm:"index" json:"event_id"`
	Name     string `gorm:"size:40" json:"name"`
	Zone     string `gorm:"size:12" json:"zone"`
	UnitCent int64  `gorm:"column:unit_cent" json:"unit_cent"`
	// ServiceCent 按张计，退票时不退还。
	ServiceCent int64 `gorm:"column:service_cent" json:"service_cent"`
	// EarlyBps 为早鸟立减的万分比（0 表示不参与早鸟）。
	EarlyBps int   `gorm:"column:early_bps" json:"early_bps"`
	Quota    int64 `json:"quota"`
	Sold     int64 `gorm:"column:sold_quantity;index" json:"sold_quantity"`
	// Seated 为真时对号入座（出票时分配座位标签），否则为站席/自由入场。
	Seated bool   `gorm:"column:seated" json:"seated"`
	Status string `gorm:"size:16;index" json:"status"`
}

type Order struct {
	ID      int64  `gorm:"primaryKey" json:"id"`
	Code    string `gorm:"uniqueIndex;size:24" json:"code"`
	EventID int64  `gorm:"index" json:"event_id"`
	TypeID  int64  `gorm:"index" json:"type_id"`
	Buyer   string `gorm:"size:48" json:"buyer"`
	// 手机号绝不外发，只出 phone_masked（见 OrderView）。
	Phone          string     `gorm:"size:20" json:"-"`
	Channel        string     `gorm:"size:16;index" json:"channel"`
	Quantity       int64      `json:"quantity"`
	UnitCent       int64      `gorm:"column:unit_cent" json:"unit_cent"`
	ServiceCent    int64      `gorm:"column:service_cent" json:"service_cent"`
	DiscountBps    int        `gorm:"column:discount_bps" json:"discount_bps"`
	SubtotalCent   int64      `gorm:"column:subtotal_cent" json:"subtotal_cent"`
	FeeCent        int64      `gorm:"column:fee_cent" json:"fee_cent"`
	PayableCent    int64      `gorm:"column:payable_cent" json:"payable_cent"`
	RetainedCent   int64      `gorm:"column:retained_cent" json:"retained_cent"`
	RefundedCent   int64      `gorm:"column:refunded_cent" json:"refunded_cent"`
	Status         string     `gorm:"size:16;index" json:"status"`
	CreatedAt      time.Time  `json:"created_at"`
	PaidAt         *time.Time `json:"paid_at,omitempty"`
	RefundedAt     *time.Time `json:"refunded_at,omitempty"`
	RefundReason   string     `gorm:"size:120" json:"refund_reason,omitempty"`
	LastFourDigits string     `gorm:"column:last_four_digits;size:4" json:"last_four_digits,omitempty"`
}

type Ticket struct {
	ID       int64      `gorm:"primaryKey" json:"id"`
	Code     string     `gorm:"uniqueIndex;size:24" json:"code"`
	OrderID  int64      `gorm:"index" json:"order_id"`
	EventID  int64      `gorm:"index" json:"event_id"`
	TypeID   int64      `gorm:"index" json:"type_id"`
	Seq      int64      `json:"seq"`
	SeatZone string     `gorm:"size:12" json:"seat_zone"`
	SeatRow  string     `gorm:"size:8" json:"seat_row"`
	SeatNo   string     `gorm:"size:8" json:"seat_no"`
	Status   string     `gorm:"size:16;index" json:"status"`
	IssuedAt time.Time  `json:"issued_at"`
	UsedAt   *time.Time `json:"used_at,omitempty"`
	Gate     string     `gorm:"size:12" json:"gate,omitempty"`
}

// ---- 读取视图 ----

// EventRow 在场次本体之外带出票档聚合与核销进度（全部来自子查询，避免 JOIN 放大）。
type EventRow struct {
	Event
	TypeCount     int64  `json:"type_count"`
	QuotaTotal    int64  `json:"quota_total"`
	SoldTotal     int64  `json:"sold_total"`
	ValidTickets  int64  `json:"valid_tickets"`
	UsedTickets   int64  `json:"used_tickets"`
	VoidTickets   int64  `json:"void_tickets"`
	GrossCent     int64  `json:"gross_cent"`
	MinUnitCent   int64  `json:"min_unit_cent"`
	SellThroughBp int64  `json:"sell_through_bp"`
	EarlyLive     bool   `json:"early_live"`
	CheckinOpen   bool   `json:"checkin_open"`
	CheckinWhy    string `json:"checkin_why,omitempty"`
}

type OrderView struct {
	Order
	EventCode   string `json:"event_code"`
	EventTitle  string `json:"event_title"`
	TypeCode    string `json:"type_code"`
	TypeName    string `json:"type_name"`
	City        string `json:"city"`
	PhoneMasked string `json:"phone_masked"`
	TicketCount int64  `json:"ticket_count"`
	UsedCount   int64  `json:"used_count"`
	VoidCount   int64  `json:"void_count"`
	Refundable  bool   `json:"refundable"`
	RefundWhy   string `json:"refund_why,omitempty"`
}

type TicketView struct {
	Ticket
	SeatLabel   string    `json:"seat_label"`
	OrderCode   string    `json:"order_code"`
	EventCode   string    `json:"event_code"`
	EventTitle  string    `json:"event_title"`
	DoorsAt     time.Time `json:"doors_at"`
	StartAt     time.Time `json:"start_at"`
	EventStatus string    `json:"event_status"`
	TypeName    string    `json:"type_name"`
	ZoneName    string    `json:"zone_name"`
	GatesRaw    string    `gorm:"column:gates_raw" json:"-"`
	Gates       []string  `gorm:"-" json:"gates"`
	Buyer       string    `json:"buyer"`
	Phone       string    `gorm:"column:phone" json:"-"`
	PhoneMasked string    `json:"phone_masked"`
	UnitCent    int64     `json:"unit_cent"`
	ServiceCent int64     `json:"service_cent"`
	Checkinable bool      `json:"checkinable"`
	CheckinWhy  string    `json:"checkin_why,omitempty"`
}

type TypeRollup struct {
	TypeCode     string `json:"type_code"`
	TypeName     string `json:"type_name"`
	Zone         string `json:"zone"`
	UnitCent     int64  `json:"unit_cent"`
	ServiceCent  int64  `json:"service_cent"`
	EarlyBps     int    `json:"early_bps"`
	NowUnitCent  int64  `json:"now_unit_cent"`
	Quota        int64  `json:"quota"`
	Sold         int64  `json:"sold_quantity"`
	Remaining    int64  `json:"remaining"`
	ValidTickets int64  `json:"valid_tickets"`
	UsedTickets  int64  `json:"used_tickets"`
	VoidTickets  int64  `json:"void_tickets"`
	Status       string `json:"status"`
	Seated       bool   `json:"seated"`
}

type DailyPoint struct {
	Day        string `json:"day"`
	Orders     int64  `json:"orders"`
	Tickets    int64  `json:"tickets"`
	Refunds    int64  `json:"refunds"`
	GrossCent  int64  `json:"gross_cent"`
	RefundCent int64  `json:"refund_cent"`
	Checkins   int64  `json:"checkins"`
}

type ChannelRollup struct {
	Channel    string `json:"channel"`
	Orders     int64  `json:"orders"`
	Tickets    int64  `json:"tickets"`
	GrossCent  int64  `json:"gross_cent"`
	FeeCent    int64  `json:"fee_cent"`
	RefundCent int64  `json:"refund_cent"`
	CheckinBp  int64  `json:"checkin_bp"`
}

type Stats struct {
	Today          string          `json:"today"`
	EventsTotal    int64           `json:"events_total"`
	EventsOnSale   int64           `json:"events_on_sale"`
	OrdersTotal    int64           `json:"orders_total"`
	OrdersPaid     int64           `json:"orders_paid"`
	TicketsIssued  int64           `json:"tickets_issued"`
	TicketsValid   int64           `json:"tickets_valid"`
	TicketsUsed    int64           `json:"tickets_used"`
	TicketsVoid    int64           `json:"tickets_void"`
	GrossCent      int64           `json:"gross_cent"`
	FeeCent        int64           `json:"fee_cent"`
	NetCent        int64           `json:"net_cent"`
	RefundCent     int64           `json:"refund_cent"`
	RetainedCent   int64           `json:"retained_cent"`
	QuotaTotal     int64           `json:"quota_total"`
	SoldTotal      int64           `json:"sold_total"`
	SellThroughBp  int64           `json:"sell_through_bp"`
	CheckinRateBp  int64           `json:"checkin_rate_bp"`
	AvgOrderCent   int64           `json:"avg_order_cent"`
	TodayGrossCent int64           `json:"today_gross_cent"`
	TodayCheckins  int64           `json:"today_checkins"`
	RefundRateBp   int64           `json:"refund_rate_bp"`
	IdentityOK     bool            `json:"identity_ok"`
	IdentityIssues []string        `json:"identity_issues"`
	IdentityNote   string          `json:"identity_note"`
	Daily          []DailyPoint    `json:"daily"`
	ByChannel      []ChannelRollup `json:"by_channel"`
	ActiveNow      []EventRow      `json:"active_now"`
	GeneratedAt    time.Time       `json:"generated_at"`
	Window         string          `json:"window"`
}

// ---- 写入 DTO ----

type CreateEventInput struct {
	Code           string `json:"code"`
	Title          string `json:"title"`
	Artist         string `json:"artist"`
	Category       string `json:"category"`
	Venue          string `json:"venue"`
	City           string `json:"city"`
	Gates          string `json:"gates"`
	DoorsAt        string `json:"doors_at"`
	StartAt        string `json:"start_at"`
	PresaleEnd     string `json:"presale_end"`
	RefundCutHours int    `json:"refund_cutoff_hours"`
	Note           string `json:"note"`
}

type SaleInput struct {
	EventCode string `json:"event_code"`
	TypeCode  string `json:"type_code"`
	Quantity  int64  `json:"quantity"`
	Buyer     string `json:"buyer"`
	Phone     string `json:"phone"`
	Channel   string `json:"channel"`
}

type CheckinInput struct {
	Gate string `json:"gate"`
}

type RefundInput struct {
	Reason string `json:"reason"`
}

// ---- 校验与口径 ----

func ValidEventStatus(s string) bool {
	switch s {
	case EventDraft, EventOnSale, EventClosed, EventCanceld:
		return true
	}
	return false
}

func ValidOrderStatus(s string) bool {
	switch s {
	case OrderPending, OrderPaid, OrderRefunded, OrderCancelled:
		return true
	}
	return false
}

func ValidTicketStatus(s string) bool {
	switch s {
	case TicketValid, TicketUsed, TicketVoid:
		return true
	}
	return false
}

func ValidCategory(s string) bool {
	switch s {
	case "concert", "theatre", "livehouse", "exhibition", "family", "esports":
		return true
	}
	return false
}

func ValidChannel(s string) bool {
	switch s {
	case ChannelWeb, ChannelBox, ChannelPartner, ChannelOnsite:
		return true
	}
	return false
}

// CodeAllowed：编号/闸门类字段只接受 ASCII 字母数字与 -_。
func CodeAllowed(s string) bool {
	for _, r := range s {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-'
		if !ok {
			return false
		}
	}
	return true
}

// PhoneMasked 只保留前 3 后 4；库里存全号，对外一律脱敏。
func PhoneMasked(phone string) string {
	digits := make([]byte, 0, 11)
	for i := 0; i < len(phone); i++ {
		if c := phone[i]; c >= '0' && c <= '9' {
			digits = append(digits, c)
		}
	}
	// 只有 11 位才做掩码：位错的号码拼成 138****0111 会看起来像合法脱敏值。
	if len(digits) != 11 {
		return ""
	}
	return string(digits[:3]) + "****" + string(digits[len(digits)-4:])
}

// ValidPhone 只收 11 位、1 开头、次位 3-9 的国内手机号段。
// 只校验「11 位纯数字」的话，23800001111 这类根本拨不通的号也能建单入台账。
func ValidPhone(phone string) bool {
	if len(phone) != 11 {
		return false
	}
	if phone[0] != '1' || phone[1] < '3' || phone[1] > '9' {
		return false
	}
	for i := 2; i < len(phone); i++ {
		if c := phone[i]; c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// GateList 解析逗号分隔的闸口清单。
func GateList(s string) []string {
	out := []string{}
	start := 0
	for i := 0; i <= len(s); i++ {
		if i == len(s) || s[i] == ',' {
			g := trimSpace(s[start:i])
			if g != "" {
				out = append(out, g)
			}
			start = i + 1
		}
	}
	return out
}

func trimSpace(s string) string {
	i, j := 0, len(s)
	for i < j && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	for j > i && (s[j-1] == ' ' || s[j-1] == '\t') {
		j--
	}
	return s[i:j]
}

// ---- 纯函数：计价、核销窗口、退票资格、状态机 ----

// UnitAt 按万分比立减后的单张票面价（向下取整到分，票面让利只可能少收不会多收）。
func UnitAt(baseCent int64, discountBps int) int64 {
	if discountBps <= 0 {
		return baseCent
	}
	if discountBps > BasisPoint {
		discountBps = BasisPoint
	}
	return baseCent * int64(BasisPoint-discountBps) / BasisPoint
}

// Totals 是一次出票的全部金额口径：实付 = 票面小计 + 服务费小计。
// 早鸟立减只作用于票面，服务费按张原额收取（这是不退的那部分）。
type Totals struct {
	UnitCent     int64 `json:"unit_cent"`
	Quantity     int64 `json:"quantity"`
	SubtotalCent int64 `json:"subtotal_cent"`
	FeeCent      int64 `json:"fee_cent"`
	PayableCent  int64 `json:"payable_cent"`
	DiscountBps  int   `json:"discount_bps"`
}

func TotalsFor(baseCent, serviceCent int64, earlyBps int, earlyLive bool, qty int64) Totals {
	bps := 0
	if earlyLive && earlyBps > 0 {
		bps = earlyBps
		if bps > BasisPoint {
			bps = BasisPoint
		}
	}
	unit := UnitAt(baseCent, bps)
	return Totals{
		UnitCent:     unit,
		Quantity:     qty,
		SubtotalCent: unit * qty,
		FeeCent:      serviceCent * qty,
		PayableCent:  unit*qty + serviceCent*qty,
		DiscountBps:  bps,
	}
}

// EarlyDiscountBps 判定此刻是否还在早鸟窗口内。
func EarlyDiscountBps(t *TicketType, e *Event, now time.Time) int {
	if t == nil || e == nil || t.EarlyBps <= 0 {
		return 0
	}
	if !e.PresaleEnd.IsZero() && now.Before(e.PresaleEnd) {
		return t.EarlyBps
	}
	return 0
}

// CheckinVerdict 是核销窗口的唯一裁决。allowed 为假时 Code 一定是可枚举的机器码。
type CheckinVerdict struct {
	Allowed bool   `json:"allowed"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WindowFor 只看场次与此刻：闸口开合由场次时间决定，与单张票无关。
func WindowFor(status string, doorsAt, startAt time.Time, now time.Time) CheckinVerdict {
	switch status {
	case EventCanceld:
		return CheckinVerdict{Code: "event_cancelled", Message: "场次已取消，停止检票"}
	case EventDraft:
		return CheckinVerdict{Code: "not_on_sale", Message: "场次尚未开票"}
	case EventClosed:
		return CheckinVerdict{Code: "event_closed", Message: "场次已散场关闸"}
	}
	openFrom := doorsAt.Add(-time.Duration(CheckinPreDoorsMin) * time.Minute)
	deadline := startAt.Add(CheckinGraceMin * time.Minute)
	if now.Before(openFrom) {
		return CheckinVerdict{
			Code:    "doors_not_open",
			Message: "未到入场时间（开门前 " + itoa(CheckinPreDoorsMin) + " 分钟起可入场）",
		}
	}
	if now.After(deadline) {
		return CheckinVerdict{Code: "gate_shut", Message: "已过迟到宽限，闸口关闭"}
	}
	return CheckinVerdict{Allowed: true, Code: "open", Message: "可以检票入场"}
}

// TicketVerdict 在窗口之上叠加单张票的状态。
func TicketVerdict(t *Ticket, v CheckinVerdict) CheckinVerdict {
	if !v.Allowed {
		return v
	}
	switch t.Status {
	case TicketUsed:
		return CheckinVerdict{Code: "already_used", Message: "该票已于 " + t.Gate + " 闸口检过，一票一入"}
	case TicketVoid:
		return CheckinVerdict{Code: "ticket_void", Message: "该票已随单退票"}
	}
	return v
}

// GateVerdict 校验闸口是否属于本场次的开放闸门。
func GateVerdict(gates []string, gate string) CheckinVerdict {
	gate = trimSpace(gate)
	if gate == "" {
		return CheckinVerdict{Code: "gate_required", Message: "必须指明检票闸口"}
	}
	for _, g := range gates {
		if strings.EqualFold(g, gate) {
			return CheckinVerdict{Allowed: true, Code: "gate_ok", Message: "闸口有效"}
		}
	}
	return CheckinVerdict{Code: "gate_unknown", Message: "本场次没有这个闸口"}
}

// RefundVerdict 判定整单退票资格。服务费不退，所以退款额是票面小计。
func RefundVerdict(o *Order, e *Event, usedCount, voidCount int64, now time.Time) (CheckinVerdict, int64) {
	if o == nil || e == nil {
		return CheckinVerdict{Code: "not_found", Message: "订单或场次不存在"}, 0
	}
	switch o.Status {
	case OrderRefunded:
		return CheckinVerdict{Code: "already_refunded", Message: "该订单已退票"}, 0
	case OrderCancelled:
		return CheckinVerdict{Code: "order_cancelled", Message: "该订单未支付即已作废"}, 0
	}
	if usedCount > 0 {
		return CheckinVerdict{Code: "partially_used", Message: "已有票进场，不允许退票"}, 0
	}
	if voidCount > 0 {
		return CheckinVerdict{Code: "partially_void", Message: "该订单已有退票记录"}, 0
	}
	cutoff := e.StartAt.Add(-time.Duration(refundCutoffHours(e)) * time.Hour)
	if !now.Before(cutoff) {
		return CheckinVerdict{
			Code:    "past_cutoff",
			Message: "已过退票截止（开演前 " + itoa(refundCutoffHours(e)) + " 小时）",
		}, 0
	}
	// 退款额 = 票面小计；服务费留存。恒等式：refund + retained == payable。
	refund := o.SubtotalCent
	if voidCount > 0 {
		refund = o.SubtotalCent * (o.Quantity - voidCount) / o.Quantity
	}
	return CheckinVerdict{
		Allowed: true,
		Code:    "refundable",
		Message: "可整单退票，服务费 " + itoa64(o.FeeCent) + " 分留存",
	}, refund
}

func refundCutoffHours(e *Event) int {
	if e.RefundCutH < RefundCutoffMinHours {
		return RefundCutoffMinHours
	}
	if e.RefundCutH > RefundCutoffMaxHours {
		return RefundCutoffMaxHours
	}
	return e.RefundCutH
}

// NextEventStatus 是场次状态机的唯一跃迁表。
func NextEventStatus(from, to string) bool {
	switch from {
	case EventDraft:
		return to == EventOnSale || to == EventCanceld
	case EventOnSale:
		return to == EventClosed || to == EventCanceld
	}
	return false
}

// SeatLabel 生成「区-排-号」；站席返回空串。
func SeatLabel(zone string, seated bool, seq int64, rowSeats int64) (string, string, string) {
	if !seated {
		return trimSpace(zone), "", ""
	}
	if rowSeats < 1 {
		rowSeats = 1
	}
	idx := seq - 1
	row := idx / rowSeats
	seat := idx % rowSeats
	return trimSpace(zone), itoa(int(row) + 1), itoa(int(seat) + 1)
}

func (t *Ticket) SeatText() string {
	if t.SeatRow == "" || t.SeatNo == "" {
		return "自由入场"
	}
	return t.SeatZone + "区 " + t.SeatRow + "排" + t.SeatNo + "号"
}

func itoa(n int) string     { return strconv.Itoa(n) }
func itoa64(n int64) string { return strconv.FormatInt(n, 10) }
