package domain

import (
	"math"
	"sort"
	"strings"
	"time"
)

// ============================================================
// 业务口径全部集中在这里：配件类别规则、工时费率、工单状态机、
// FIFO 批次出库计划、结算金额分解与账实相符不变量。
// 种子灌数与线上写路径共用同一组函数，统计层绝不第二次算账。
// ============================================================

// ---- 配件类别 ----
const (
	CatEngine       = "engine"       // 发动机系统
	CatBrake        = "brake"        // 制动系统
	CatFilter       = "filter"       // 滤清系统
	CatElectrical   = "electrical"   // 电气
	CatSuspension   = "suspension"   // 悬挂转向
	CatConsumable   = "consumable"   // 油液耗材
	CatTransmission = "transmission" // 传动
)

type CatRule struct {
	// ShelfLifeDays：入库后建议周转天数，0 表示长期（结构件无保质期）。
	ShelfLifeDays int
	// Fragile：批次必须记有效期（油液/化学品）。
	Fragile bool
}

var CatRules = map[string]CatRule{
	CatEngine:       {ShelfLifeDays: 0, Fragile: false},
	CatBrake:        {ShelfLifeDays: 0, Fragile: false},
	CatFilter:       {ShelfLifeDays: 0, Fragile: false},
	CatElectrical:   {ShelfLifeDays: 0, Fragile: false},
	CatSuspension:   {ShelfLifeDays: 0, Fragile: false},
	CatConsumable:   {ShelfLifeDays: 540, Fragile: true},
	CatTransmission: {ShelfLifeDays: 0, Fragile: false},
}

func ValidCategory(c string) bool {
	_, ok := CatRules[c]
	return ok
}

// ---- 工时费率（分/小时），按技师等级 ----
const (
	GradeJunior = "junior"
	GradeMiddle = "middle"
	GradeMaster = "master"
)

var LaborRates = map[string]int64{
	GradeJunior: 18000, // ¥180/小时
	GradeMiddle: 26000, // ¥260/小时
	GradeMaster: 38000, // ¥380/小时
}

func ValidGrade(g string) bool {
	_, ok := LaborRates[g]
	return ok
}

// LaborAmount 是工时费的唯一算法：分钟 × 小时费率 / 60，四舍五入到分。
// 工单行、结算总额、毛利统计都必须走这里。
func LaborAmount(durationMin int, grade string) int64 {
	rate, ok := LaborRates[grade]
	if !ok || durationMin <= 0 {
		return 0
	}
	return roundHalfUp(float64(durationMin) * float64(rate) / 60)
}

func roundHalfUp(v float64) int64 {
	return int64(math.Floor(v + 0.5))
}

// ---- 工单状态机 ----
const (
	WOReceived      = "received"       // 接车
	WODiagnosed     = "diagnosed"      // 检测定项
	WOAwaitingParts = "awaiting_parts" // 待料
	WORepairing     = "repairing"      // 在修
	WOQc            = "qc"             // 完工质检
	WOSettled       = "settled"        // 已结算
	WOPickedUp      = "picked_up"      // 已提车（终态）
	WOCancelled     = "cancelled"      // 已作废（终态）
)

// woNext 是唯一合法跃迁表；不在表内的目标一律 409。
var woNext = map[string]map[string]bool{
	WOReceived:      {WODiagnosed: true, WOCancelled: true},
	WODiagnosed:     {WOAwaitingParts: true, WORepairing: true, WOQc: true, WOCancelled: true},
	WOAwaitingParts: {WORepairing: true, WOCancelled: true},
	WORepairing:     {WOQc: true, WOCancelled: true},
	WOQc:            {WOSettled: true},
	WOSettled:       {WOPickedUp: true},
	WOPickedUp:      {},
	WOCancelled:     {},
}

func ValidStatus(s string) bool {
	_, ok := woNext[s]
	return ok
}

// NextStatuses 返回从 from 出发可推进到的目标（供前端按钮与测试共用同一张表）。
func NextStatuses(from string) []string {
	out := make([]string, 0, 4)
	for n := range woNext[from] {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func CanTransition(from, to string) bool {
	return woNext[from][to]
}

// OpenStatuses 是「仍在厂内」的状态集合；已提车/已作废为离场态。
var OpenStatuses = []string{WOReceived, WODiagnosed, WOAwaitingParts, WORepairing, WOQc, WOSettled}

func IsOpen(s string) bool {
	for _, v := range OpenStatuses {
		if v == s {
			return true
		}
	}
	return false
}

// LinesEditable 规定明细行还能不能被改动：质检之后即锁定账目，
// 结算之后任何加行都会让已开票的总额对不上。
func LinesEditable(s string) bool {
	switch s {
	case WOReceived, WODiagnosed, WOAwaitingParts, WORepairing:
		return true
	default:
		return false
	}
}

// ReturnStock 规定作废时是否需要把已出库配件退回货架。
// 在厂内任何状态下出库的料都还没被收过钱，作废即退料；
// 结算之后不允许作废（状态机已挡），所以这里不需要区分。
func ReturnStock(s string) bool {
	return LinesEditable(s)
}

// ---- 明细行 ----
const (
	LineLabor = "labor"
	LinePart  = "part"
)

// ---- 库存流水 ----
const (
	MoveReceipt = "receipt" // 入库建批
	MoveIssue   = "issue"   // 工单出库
	MoveReturn  = "return"  // 工单作废退料
	MoveScrap   = "scrap"   // 报损
)

// ---- 实体 ----

type Part struct {
	ID             int64     `gorm:"primaryKey" json:"id"`
	Code           string    `gorm:"uniqueIndex;size:16" json:"code"`
	Name           string    `gorm:"size:64" json:"name"`
	Brand          string    `gorm:"size:32" json:"brand"`
	Category       string    `gorm:"size:16;index" json:"category"`
	Unit           string    `gorm:"size:8" json:"unit"`
	ListPriceCents int64     `json:"list_price_cents"`
	ReorderPoint   int       `json:"reorder_point"`
	ShelfLocation  string    `gorm:"size:16" json:"shelf_location"`
	Status         string    `gorm:"size:16;index" json:"status"`
	CreatedAt      time.Time `json:"created_at"`
}

const (
	PartActive       = "active"
	PartDiscontinued = "discontinued"
)

type StockLot struct {
	ID            int64      `gorm:"primaryKey" json:"id"`
	PartCode      string     `gorm:"size:16;index" json:"part_code"`
	LotNo         string     `gorm:"uniqueIndex;size:20" json:"lot_no"`
	QtyReceived   int        `json:"qty_received"`
	QtyRemaining  int        `json:"qty_remaining"`
	UnitCostCents int64      `json:"unit_cost_cents"`
	Supplier      string     `gorm:"size:48" json:"supplier"`
	ReceivedAt    time.Time  `gorm:"index" json:"received_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
}

type WorkOrder struct {
	ID              int64      `gorm:"primaryKey" json:"id"`
	WoNo            string     `gorm:"uniqueIndex;size:20" json:"wo_no"`
	PlateNo         string     `gorm:"size:12;index" json:"plate_no"`
	Model           string     `gorm:"size:48" json:"model"`
	CustomerName    string     `gorm:"size:32" json:"customer_name"`
	CustomerPhone   string     `gorm:"size:20" json:"-"`
	MileageKm       int        `json:"mileage_km"`
	Symptom         string     `gorm:"size:160" json:"symptom"`
	Status          string     `gorm:"size:16;index" json:"status"`
	Priority        string     `gorm:"size:8;index" json:"priority"`
	Technician      string     `gorm:"size:32" json:"technician"`
	OpenedAt        time.Time  `gorm:"index" json:"opened_at"`
	PromisedAt      time.Time  `json:"promised_at"`
	SettledAt       *time.Time `json:"settled_at"`
	ClosedAt        *time.Time `json:"closed_at"`
	CancelReason    string     `gorm:"size:64" json:"cancel_reason,omitempty"`
	LaborTotalCents int64      `json:"labor_total_cents"`
	PartsTotalCents int64      `json:"parts_total_cents"`
	GrandTotalCents int64      `json:"grand_total_cents"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

const (
	PriorityNormal = "normal"
	PriorityUrgent = "urgent"
	PriorityReturn = "warranty"
)

// PromiseHours 是承诺交车时长：加急 6 小时，保客回厂 12 小时，普通 30 小时。
func PromiseHours(priority string) int {
	switch priority {
	case PriorityUrgent:
		return 6
	case PriorityReturn:
		return 12
	default:
		return 30
	}
}

type WorkOrderLine struct {
	ID             int64     `gorm:"primaryKey" json:"id"`
	WorkOrderID    int64     `gorm:"index" json:"work_order_id"`
	Kind           string    `gorm:"size:8;index" json:"kind"`
	Operation      string    `gorm:"size:64" json:"operation,omitempty"`
	Grade          string    `gorm:"size:8" json:"grade,omitempty"`
	DurationMin    int       `json:"duration_min"`
	PartCode       string    `gorm:"size:16;index" json:"part_code,omitempty"`
	Qty            int       `json:"qty"`
	UnitCostCents  int64     `json:"unit_cost_cents"`
	CostCents      int64     `json:"cost_cents"`
	UnitPriceCents int64     `json:"unit_price_cents"`
	AmountCents    int64     `json:"amount_cents"`
	Note           string    `gorm:"size:64" json:"note,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type StockMove struct {
	ID            int64     `gorm:"primaryKey" json:"id"`
	PartCode      string    `gorm:"size:16;index" json:"part_code"`
	LotNo         string    `gorm:"size:20;index" json:"lot_no"`
	Kind          string    `gorm:"size:8;index" json:"kind"`
	QtyDelta      int       `json:"qty_delta"`
	UnitCostCents int64     `json:"unit_cost_cents"`
	WoNo          string    `gorm:"size:20;index" json:"wo_no,omitempty"`
	Note          string    `gorm:"size:64" json:"note,omitempty"`
	OccurredAt    time.Time `gorm:"index" json:"occurred_at"`
}

// ---- FIFO 出库计划：唯一的成本算法 ----

// IssueLot 是出库计划里「从某批次取多少件」的一步。
type IssueLot struct {
	LotNo         string
	Qty           int
	UnitCostCents int64
}

// PlanIssue 按先进先出（先按入库时间，再按批次号）从 lots 里凑出 qty 件，
// 返回逐批出库步骤与精确成本合计。件数不足时返回缺失量，调用方据此报错。
// 注意：它不修改入参，纯函数，种子与线上共用。
func PlanIssue(lots []StockLot, qty int) (steps []IssueLot, costCents int64, missing int) {
	if qty <= 0 {
		return nil, 0, qty
	}
	sorted := make([]StockLot, 0, len(lots))
	for _, l := range lots {
		if l.QtyRemaining > 0 {
			sorted = append(sorted, l)
		}
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		if !sorted[i].ReceivedAt.Equal(sorted[j].ReceivedAt) {
			return sorted[i].ReceivedAt.Before(sorted[j].ReceivedAt)
		}
		return sorted[i].LotNo < sorted[j].LotNo
	})
	need := qty
	for _, l := range sorted {
		if need <= 0 {
			break
		}
		take := l.QtyRemaining
		if take > need {
			take = need
		}
		steps = append(steps, IssueLot{LotNo: l.LotNo, Qty: take, UnitCostCents: l.UnitCostCents})
		costCents += int64(take) * l.UnitCostCents
		need -= take
	}
	return steps, costCents, need
}

// PriceLine 是配件行售价的唯一算法：数量 × 挂牌单价。
func PriceLine(listPriceCents int64, qty int) int64 {
	if qty <= 0 {
		return 0
	}
	return listPriceCents * int64(qty)
}

// UnitCost 把整行 FIFO 成本折算成展示用的单件成本（四舍五入）。
// 恒等式一律用整行 CostCents，不依赖这个取整值。
func UnitCost(costCents int64, qty int) int64 {
	if qty <= 0 {
		return 0
	}
	return roundHalfUp(float64(costCents) / float64(qty))
}

// SumLineTotals 是结算金额的唯一分解：工时合计、配件合计、总额。
func SumLineTotals(lines []WorkOrderLine) (labor, parts, grand int64) {
	for _, l := range lines {
		switch l.Kind {
		case LineLabor:
			labor += l.AmountCents
		case LinePart:
			parts += l.AmountCents
		}
	}
	return labor, parts, labor + parts
}

// IdentityIssues 检查一批已结算工单的金额恒等式：
// grand == labor + parts == Σ 明细行金额；配件行 amount == qty × 挂牌价。
type OrderAmount struct {
	WoNo            string
	Kind            string
	Status          string
	LaborTotalCents int64
	PartsTotalCents int64
	GrandTotalCents int64
	LineSumCents    int64
	ListPriceCents  int64
	Qty             int
}

func (a OrderAmount) violation(reason string) string {
	return a.WoNo + "：" + reason
}

// CheckIdentity 返回违反恒等式的说明列表（空表示全绿）。
// 由 repository 用 SQL 把「工单头快照金额 vs 明细行求和 vs 数量×挂牌价」拉平后交给它复核，
// 这样对外公布的 identity_ok 不是凭代码自信，而是每次 /api/stats 实测出来的。
func CheckIdentity(rows []OrderAmount) []string {
	issues := []string{}
	for _, r := range rows {
		switch r.Kind {
		case "order":
			if r.GrandTotalCents != r.LaborTotalCents+r.PartsTotalCents {
				issues = append(issues, r.violation("总额 != 工时 + 配件"))
			}
			if r.GrandTotalCents != r.LineSumCents {
				issues = append(issues, r.violation("总额 != Σ明细行金额"))
			}
		case "part_line":
			if want := PriceLine(r.ListPriceCents, r.Qty); want != r.GrandTotalCents {
				issues = append(issues, r.violation("行金额 != 数量 × 挂牌价"))
			}
		}
	}
	return issues
}

// ---- 输入与校验 ----

type CreateOrderInput struct {
	PlateNo      string `json:"plate_no"`
	Model        string `json:"model"`
	CustomerName string `json:"customer_name"`
	Phone        string `json:"phone"`
	MileageKm    int    `json:"mileage_km"`
	Symptom      string `json:"symptom"`
	Priority     string `json:"priority"`
	Technician   string `json:"technician"`
}

type TransitionInput struct {
	To     string `json:"to"`
	Reason string `json:"reason"`
}

type AddLineInput struct {
	Kind        string `json:"kind"`
	PartCode    string `json:"part_code"`
	Operation   string `json:"operation"`
	Grade       string `json:"grade"`
	DurationMin int    `json:"duration_min"`
	Qty         int    `json:"qty"`
	Note        string `json:"note"`
}

type ReceiptInput struct {
	PartCode      string `json:"part_code"`
	LotNo         string `json:"lot_no"`
	Qty           int    `json:"qty"`
	UnitCostCents int64  `json:"unit_cost_cents"`
	Supplier      string `json:"supplier"`
	ExpiresOn     string `json:"expires_on"`
}

// required 校验必填文本长度：先裁空白，纯空白的提交不能算填了。
func required(s string, max int) bool {
	return SafeText(s, max)
}

// SafeText 是「自由文本」的唯一校验：必填、限长，且不含引号/尖括号/反斜杠/分号
// 与控制字符。这些字符一旦进库，就会在列表、导出、工单打印里变成注入或畸形展示，
// 长度合规不代表内容安全。
func SafeText(s string, max int) bool {
	r := []rune(strings.TrimSpace(s))
	if len(r) == 0 || len(r) > max {
		return false
	}
	for _, c := range r {
		switch c {
		case '"', '\'', '`', '<', '>', ';', '\\', '&':
			return false
		}
		if c < 0x20 || c == 0x7f {
			return false
		}
	}
	return true
}

func (in CreateOrderInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !PlateOK(in.PlateNo) {
		errs["plate_no"] = "车牌必填，只允许汉字/字母/数字/点，且不超过 12 字"
	}
	if !required(in.Model, 48) {
		errs["model"] = "车型必填且不超过 48 字"
	}
	if !required(in.CustomerName, 32) {
		errs["customer_name"] = "客户姓名必填且不超过 32 字"
	}
	if !PhoneRe(in.Phone) {
		errs["phone"] = "手机号需为 11 位数字"
	}
	if in.MileageKm < 0 || in.MileageKm > 1_000_000 {
		errs["mileage_km"] = "里程需在 0 ~ 1000000 公里之间"
	}
	if !required(in.Symptom, 160) {
		errs["symptom"] = "故障描述必填且不超过 160 字"
	}
	if in.Priority == "" {
		in.Priority = PriorityNormal
	}
	if in.Priority != PriorityNormal && in.Priority != PriorityUrgent && in.Priority != PriorityReturn {
		errs["priority"] = "工单优先级只能是 normal/urgent/warranty"
	}
	if !required(in.Technician, 32) {
		errs["technician"] = "服务顾问必填且不超过 32 字"
	}
	return errs, len(errs) == 0
}

func (in AddLineInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	switch in.Kind {
	case LineLabor:
		if !required(in.Operation, 64) {
			errs["operation"] = "工时项目必填且不超过 64 字"
		}
		if !ValidGrade(in.Grade) {
			errs["grade"] = "技师等级只能是 junior/middle/master"
		}
		if in.DurationMin <= 0 || in.DurationMin > 1440 {
			errs["duration_min"] = "工时（分钟）需在 1 ~ 1440 之间"
		}
	case LinePart:
		if !SafeCodeRe(in.PartCode, 16) {
			errs["part_code"] = "配件编码只允许字母/数字/-/_，且不超过 16 位"
		}
		if in.Qty <= 0 || in.Qty > 999 {
			errs["qty"] = "出库数量需在 1 ~ 999 之间"
		}
	default:
		errs["kind"] = "行类型只能是 labor/part"
	}
	if in.Note != "" && !SafeText(in.Note, 64) {
		errs["note"] = "备注不超过 64 字，且不能含引号/尖括号等字符"
	}
	return errs, len(errs) == 0
}

func (in ReceiptInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !SafeCodeRe(in.PartCode, 16) {
		errs["part_code"] = "配件编码只允许字母/数字/-/_，且不超过 16 位"
	}
	if !SafeCodeRe(in.LotNo, 20) {
		errs["lot_no"] = "批次号只允许字母/数字/-/_，且不超过 20 位"
	}
	if in.Qty <= 0 || in.Qty > 100_000 {
		errs["qty"] = "入库数量需在 1 ~ 100000 之间"
	}
	if in.UnitCostCents <= 0 || in.UnitCostCents > 50_000_000 {
		errs["unit_cost_cents"] = "批次单位成本（分）需在 1 ~ 50000000 之间"
	}
	if !required(in.Supplier, 48) {
		errs["supplier"] = "供应商必填且不超过 48 字"
	}
	if in.ExpiresOn != "" {
		if _, err := time.Parse("2006-01-02", in.ExpiresOn); err != nil {
			errs["expires_on"] = "有效期需为 YYYY-MM-DD"
		}
	}
	return errs, len(errs) == 0
}

// SafeCodeRe 白名单校验 ASCII 标识符：字母、数字、下划线、连字符。
// 注入串（含引号、分号、空格）长度再合规也不能放行。
func SafeCodeRe(s string, max int) bool {
	if s == "" || len(s) > max {
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

// PlateOK 允许车牌里的汉字省份简称与圆点分隔，但拒绝引号/分号/空白等注入字符。
func PlateOK(s string) bool {
	r := []rune(strings.TrimSpace(s))
	if len(r) == 0 || len(r) > 12 {
		return false
	}
	for _, c := range r {
		switch {
		case c >= '0' && c <= '9', c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
		case c >= 0x4e00 && c <= 0x9fff:
		case c == '.' || c == '·':
		default:
			return false
		}
	}
	return true
}

func PhoneRe(s string) bool {
	if len(s) != 11 || s[0] != '1' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// Mask 是唯一的手机号脱敏出口：手机号字段本身 json:"-"，对外只有这里产出的串。
func Mask(s string) string {
	if !PhoneRe(s) {
		return "（号码无效）"
	}
	return s[:3] + "****" + s[len(s)-4:]
}

// OverduePromise 判断在办工单是否已超过承诺交车时间（离场态不计）。
func PromiseOverdue(status string, promised, now time.Time) bool {
	if !IsOpen(status) {
		return false
	}
	return now.After(promised)
}
