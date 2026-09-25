package domain

import (
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 40
)

type ListQuery struct {
	Status   string
	Category string
	Stock    string
	Priority string
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

var orderSorts = map[string]string{
	"opened":   "w.opened_at",
	"promised": "w.promised_at",
	"updated":  "w.updated_at",
	"no":       "w.wo_no",
	"plate":    "w.plate_no",
	"status":   "w.status",
	"priority": "w.priority",
	"total":    "w.grand_total_cents",
	"tech":     "w.technician",
	"id":       "w.id",
}

var partSorts = map[string]string{
	"code":     "p.code",
	"name":     "p.name",
	"category": "p.category",
	"price":    "p.list_price_cents",
	"onhand":   "on_hand",
	"value":    "stock_value_cents",
	"lot":      "lot_count",
	"cost":     "avg_cost_cents",
	"id":       "p.id",
}

type sortMap map[string]string

func parseCommon(values map[string][]string, defaults sortMap, defaultKey string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defaults[defaultKey], Dir: "asc"}
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	if s := pick("status"); s != "" {
		q.Status = s
	}
	if c := pick("category"); utf8.RuneCountInString(c) <= 16 {
		q.Category = c
	}
	if st := pick("stock"); st != "" {
		q.Stock = st
	}
	if pr := pick("priority"); pr != "" {
		q.Priority = pr
	}
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	if col, ok := defaults[pick("sort")]; ok {
		q.Sort = col
	}
	if d := strings.ToLower(pick("dir")); d == "desc" {
		q.Dir = "desc"
	}
	if n, err := strconv.Atoi(pick("page")); err == nil && n > 0 {
		if n > 100_000 {
			n = 100_000
		}
		q.Page = n
	}
	if n, err := strconv.Atoi(pick("page_size")); err == nil && n > 0 {
		if n > MaxPageSize {
			n = MaxPageSize
		}
		q.PageSize = n
	}
	return q
}

// ParseOrderQuery 把不可信的 querystring 收敛成安全查询参数：
// 排序列只可能来自白名单值，分页有上限，搜索串按 rune 截断，非法枚举回落空值。
func ParseOrderQuery(values map[string][]string) ListQuery {
	q := parseCommon(values, orderSorts, "opened")
	if !ValidStatus(q.Status) && q.Status != "open" && q.Status != "all" {
		q.Status = ""
	}
	switch q.Priority {
	case PriorityNormal, PriorityUrgent, PriorityReturn:
	default:
		q.Priority = ""
	}
	// 工单列表不认类别/库存口径：一律清空，避免调用方把无意义条件当成过滤器。
	q.Category, q.Stock = "", ""
	return q
}

func ParsePartQuery(values map[string][]string) ListQuery {
	q := parseCommon(values, partSorts, "code")
	if !ValidCategory(q.Category) {
		q.Category = ""
	}
	switch q.Stock {
	case "low", "out", "ok", "all":
	default:
		q.Stock = ""
	}
	if q.Status != PartActive && q.Status != PartDiscontinued {
		q.Status = ""
	}
	q.Priority = ""
	return q
}

func (q ListQuery) Offset() int { return (q.Page - 1) * q.PageSize }

// ---- 视图结构体（列名与 JSON 口径不一致时必须显式 gorm:"column:..."）----

type OrderRow struct {
	ID              int64      `gorm:"column:id" json:"id"`
	WoNo            string     `gorm:"column:wo_no" json:"wo_no"`
	PlateNo         string     `gorm:"column:plate_no" json:"plate_no"`
	Model           string     `gorm:"column:model_name" json:"model"`
	CustomerName    string     `gorm:"column:customer_name" json:"customer_name"`
	PhoneMasked     string     `gorm:"column:customer_phone" json:"phone_masked"`
	MileageKm       int        `gorm:"column:mileage_km" json:"mileage_km"`
	Symptom         string     `gorm:"column:symptom" json:"symptom"`
	Status          string     `gorm:"column:status" json:"status"`
	Priority        string     `gorm:"column:priority" json:"priority"`
	Technician      string     `gorm:"column:technician" json:"technician"`
	OpenedAt        time.Time  `gorm:"column:opened_at" json:"opened_at"`
	PromisedAt      time.Time  `gorm:"column:promised_at" json:"promised_at"`
	SettledAt       *time.Time `gorm:"column:settled_at" json:"settled_at"`
	ClosedAt        *time.Time `gorm:"column:closed_at" json:"closed_at"`
	CancelReason    string     `gorm:"column:cancel_reason" json:"cancel_reason"`
	LaborTotalCents int64      `gorm:"column:labor_total_cents" json:"labor_total_cents"`
	PartsTotalCents int64      `gorm:"column:parts_total_cents" json:"parts_total_cents"`
	GrandTotalCents int64      `gorm:"column:grand_total_cents" json:"grand_total_cents"`
	LaborMinutes    int        `gorm:"column:labor_minutes" json:"labor_minutes"`
	PartQty         int        `gorm:"column:part_qty" json:"part_qty"`
	LineCount       int        `gorm:"column:line_count" json:"line_count"`
	PromiseOverdue  bool       `gorm:"-" json:"promise_overdue"`
	WaitMinutes     int64      `gorm:"-" json:"wait_minutes"`
	NextStatuses    []string   `gorm:"-" json:"next_statuses"`
}

type OrderLineRow struct {
	ID             int64     `gorm:"column:id" json:"id"`
	Kind           string    `gorm:"column:kind" json:"kind"`
	Operation      string    `gorm:"column:operation" json:"operation"`
	Grade          string    `gorm:"column:grade" json:"grade"`
	DurationMin    int       `gorm:"column:duration_min" json:"duration_min"`
	PartCode       string    `gorm:"column:part_code" json:"part_code"`
	PartName       string    `gorm:"column:part_name" json:"part_name"`
	Unit           string    `gorm:"column:unit" json:"unit"`
	Qty            int       `gorm:"column:qty" json:"qty"`
	UnitCostCents  int64     `gorm:"column:unit_cost_cents" json:"unit_cost_cents"`
	CostCents      int64     `gorm:"column:cost_cents" json:"cost_cents"`
	UnitPriceCents int64     `gorm:"column:unit_price_cents" json:"unit_price_cents"`
	AmountCents    int64     `gorm:"column:amount_cents" json:"amount_cents"`
	Note           string    `gorm:"column:note" json:"note"`
	CreatedAt      time.Time `gorm:"column:created_at" json:"created_at"`
}

type MoveRow struct {
	ID            int64     `gorm:"column:id" json:"id"`
	PartCode      string    `gorm:"column:part_code" json:"part_code"`
	LotNo         string    `gorm:"column:lot_no" json:"lot_no"`
	Kind          string    `gorm:"column:kind" json:"kind"`
	QtyDelta      int       `gorm:"column:qty_delta" json:"qty_delta"`
	UnitCostCents int64     `gorm:"column:unit_cost_cents" json:"unit_cost_cents"`
	WoNo          string    `gorm:"column:wo_no" json:"wo_no"`
	Note          string    `gorm:"column:note" json:"note"`
	OccurredAt    time.Time `gorm:"column:occurred_at" json:"occurred_at"`
}

type PartRow struct {
	ID              int64  `gorm:"column:id" json:"id"`
	Code            string `gorm:"column:code" json:"code"`
	Name            string `gorm:"column:name" json:"name"`
	Brand           string `gorm:"column:brand" json:"brand"`
	Category        string `gorm:"column:category" json:"category"`
	Unit            string `gorm:"column:unit" json:"unit"`
	ListPriceCents  int64  `gorm:"column:list_price_cents" json:"list_price_cents"`
	ReorderPoint    int    `gorm:"column:reorder_point" json:"reorder_point"`
	ShelfLocation   string `gorm:"column:shelf_location" json:"shelf_location"`
	Status          string `gorm:"column:status" json:"status"`
	OnHand          int    `gorm:"column:on_hand" json:"on_hand"`
	LotCount        int    `gorm:"column:lot_count" json:"lot_count"`
	AvgCostCents    int64  `gorm:"column:avg_cost_cents" json:"avg_cost_cents"`
	StockValueCents int64  `gorm:"column:stock_value_cents" json:"stock_value_cents"`
	Consumed30      int    `gorm:"column:consumed_30" json:"consumed_30d"`
	BelowReorder    bool   `gorm:"-" json:"below_reorder"`
	OldestLotAt     string `gorm:"column:oldest_lot_at" json:"oldest_lot_at"`
}

// ---- 统计口径 ----

type StatusBucket struct {
	Status       string `gorm:"column:status" json:"status"`
	Cnt          int    `gorm:"column:cnt" json:"count"`
	OpenMinutes  int64  `gorm:"column:open_minutes" json:"open_minutes"`
	RevenueCents int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
}

type CategoryBucket struct {
	Category   string `gorm:"column:category" json:"category"`
	Parts      int    `gorm:"column:parts" json:"parts"`
	OnHand     int    `gorm:"column:on_hand" json:"on_hand"`
	ValueCents int64  `gorm:"column:value_cents" json:"value_cents"`
	ShortParts int    `gorm:"column:short_parts" json:"short_parts"`
}

type TrendPoint struct {
	Day          string `gorm:"column:day" json:"day"`
	Opened       int    `gorm:"column:opened" json:"opened"`
	Settled      int    `gorm:"column:settled" json:"settled"`
	RevenueCents int64  `gorm:"column:revenue_cents" json:"revenue_cents"`
	IssuedQty    int    `gorm:"column:issued_qty" json:"issued_qty"`
}

type TopPart struct {
	Code        string `gorm:"column:code" json:"code"`
	Name        string `gorm:"column:name" json:"name"`
	Category    string `gorm:"column:category" json:"category"`
	Qty         int    `gorm:"column:qty" json:"qty"`
	CostCents   int64  `gorm:"column:cost_cents" json:"cost_cents"`
	AmountCents int64  `gorm:"column:amount_cents" json:"amount_cents"`
}

type StockIssue struct {
	PartCode string `gorm:"column:part_code" json:"part_code"`
	MovesSum int    `gorm:"column:moves_sum" json:"moves_sum"`
	LotsSum  int    `gorm:"column:lots_sum" json:"lots_sum"`
	Overflow int    `gorm:"column:overflow" json:"overflow"`
}

type Stats struct {
	GeneratedAt time.Time `json:"generated_at"`
	Today       string    `json:"today"`
	Window      string    `json:"window"`

	TotalOrders   int `json:"total_orders"`
	OpenOrders    int `json:"open_orders"`
	TodayOpened   int `json:"today_opened"`
	AwaitingParts int `json:"awaiting_parts"`
	PromiseLate   int `json:"promise_late"`
	SettledWait   int `json:"settled_wait"`

	RevenueCents     int64 `json:"revenue_cents"`
	LaborCents       int64 `json:"labor_cents"`
	PartsCents       int64 `json:"parts_cents"`
	PartsCostCents   int64 `json:"parts_cost_cents"`
	GrossMarginCents int64 `json:"gross_margin_cents"`
	OpenLaborMin     int64 `json:"open_labor_minutes"`
	StockValueCents  int64 `json:"stock_value_cents"`
	OnHandUnits      int   `json:"on_hand_units"`
	ActiveParts      int   `json:"active_parts"`
	LowStockParts    int   `json:"low_stock_parts"`
	TodayIssues      int   `gorm:"column:today_issues" json:"today_issues"`

	ByStatus    []StatusBucket   `json:"by_status"`
	ByCategory  []CategoryBucket `json:"by_category"`
	Trend       []TrendPoint     `json:"trend"`
	TopParts    []TopPart        `json:"top_parts"`
	StockIssues []StockIssue     `json:"stock_issues"`

	// 恒等式自检：账实相符（Σ流水 == Σ批次余量）与结算金额分解。
	StockInvariantOK   bool     `json:"stock_invariant_ok"`
	AmountInvariantOK  bool     `json:"amount_invariant_ok"`
	LotOverflow        int      `json:"lot_overflow"`
	CheckedOrders      int      `json:"checked_orders"`
	IdentityIssues     []string `json:"identity_issues"`
	IdentityViolations int      `json:"identity_violations"`
}
