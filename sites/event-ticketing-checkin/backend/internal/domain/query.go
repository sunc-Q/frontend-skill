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
	MaxQueryRunes = 48
	MaxCodeLen    = 24
)

type EventQuery struct {
	Status   string
	Category string
	City     string
	Search   string
	Sort     string
	SortCol  string
	Dir      string
	Page     int
	PageSize int
}

type OrderQuery struct {
	Status   string
	Event    string
	Channel  string
	Search   string
	Sort     string
	SortCol  string
	Dir      string
	Page     int
	PageSize int
}

type TicketQuery struct {
	Status   string
	Event    string
	Type     string
	Search   string
	Sort     string
	SortCol  string
	Dir      string
	Page     int
	PageSize int
}

// 写进 ORDER BY 的只可能是下面 map 的 value，绝不拼接用户输入。
// 别名对应 repository 层 SQL：e=场次聚合子查询 / o=订单视图 / t=票券视图。
var eventSortColumns = map[string]string{
	"doors":  "e.doors_at",
	"start":  "e.start_at",
	"code":   "e.code",
	"status": "e.status",
	"sold":   "e.sold_total",
	"gross":  "e.gross_cent",
	"used":   "e.used_tickets",
	"quota":  "e.quota_total",
	"id":     "e.id",
}

var orderSortColumns = map[string]string{
	"created": "o.created_at",
	"payable": "o.payable_cent",
	"qty":     "o.quantity",
	"status":  "o.status",
	"code":    "o.code",
	"event":   "o.event_id",
	"id":      "o.id",
}

var ticketSortColumns = map[string]string{
	"issued": "t.issued_at",
	"used":   "t.used_at",
	"code":   "t.code",
	"status": "t.status",
	"seat":   "t.seat_zone",
	"event":  "t.event_id",
	"order":  "t.order_id",
	"id":     "t.id",
}

func pick(values map[string][]string, key string) string {
	v := values[key]
	if len(v) == 0 {
		return ""
	}
	return strings.TrimSpace(v[0])
}

func pageArgs(values map[string][]string) (int, int) {
	page, size := 1, DefaultPageSz
	if n, err := strconv.Atoi(pick(values, "page")); err == nil && n > 0 {
		if n > 100_000 {
			n = 100_000
		}
		page = n
	}
	if n, err := strconv.Atoi(pick(values, "page_size")); err == nil && n > 0 {
		if n > MaxPageSize {
			n = MaxPageSize
		}
		size = n
	}
	return page, size
}

func searchOf(values map[string][]string) string {
	s := pick(values, "q")
	if s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) > MaxQueryRunes {
		r = r[:MaxQueryRunes]
	}
	return string(r)
}

// sortDir 一次返回三样：回显给客户端的排序键、可进 ORDER BY 的列、方向。
// 列名绝不回显给客户端——那是内部实现细节。
func sortDir(values map[string][]string, sorts map[string]string, def string) (string, string, string) {
	key := pick(values, "sort")
	col, ok := sorts[key]
	if !ok {
		key = def
		col = sorts[def]
	}
	dir := "desc"
	if strings.EqualFold(pick(values, "dir"), "asc") {
		dir = "asc"
	}
	return key, col, dir
}

func safeCode(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "" || len(s) > MaxCodeLen || !CodeAllowed(s) {
		return ""
	}
	return s
}

// ParseEventQuery 把不可信 querystring 收敛成安全查询参数。
func ParseEventQuery(values map[string][]string) EventQuery {
	q := EventQuery{}
	q.Sort, q.SortCol, q.Dir = sortDir(values, eventSortColumns, "doors")
	q.Page, q.PageSize = pageArgs(values)
	if s := pick(values, "status"); ValidEventStatus(s) {
		q.Status = s
	}
	if c := pick(values, "category"); ValidCategory(c) {
		q.Category = c
	}
	if c := safeCode(pick(values, "city")); c != "" && utf8.RuneCountInString(c) <= 24 {
		q.City = c
	}
	q.Search = searchOf(values)
	return q
}

func ParseOrderQuery(values map[string][]string) OrderQuery {
	q := OrderQuery{}
	q.Sort, q.SortCol, q.Dir = sortDir(values, orderSortColumns, "created")
	q.Page, q.PageSize = pageArgs(values)
	if s := pick(values, "status"); ValidOrderStatus(s) {
		q.Status = s
	}
	if c := strings.ToLower(pick(values, "channel")); ValidChannel(c) {
		q.Channel = c
	}
	q.Event = safeCode(pick(values, "event"))
	q.Search = searchOf(values)
	return q
}

func ParseTicketQuery(values map[string][]string) TicketQuery {
	q := TicketQuery{}
	q.Sort, q.SortCol, q.Dir = sortDir(values, ticketSortColumns, "issued")
	q.Page, q.PageSize = pageArgs(values)
	if s := pick(values, "status"); ValidTicketStatus(s) {
		q.Status = s
	}
	q.Event = safeCode(pick(values, "event"))
	q.Type = safeCode(pick(values, "type"))
	q.Search = searchOf(values)
	return q
}

func (q EventQuery) Offset() int  { return (q.Page - 1) * q.PageSize }
func (q OrderQuery) Offset() int  { return (q.Page - 1) * q.PageSize }
func (q TicketQuery) Offset() int { return (q.Page - 1) * q.PageSize }

// ParseDays 把 ?days= 夹到 [1,60]，用于趋势窗口。
func ParseDays(values map[string][]string) int {
	n, err := strconv.Atoi(pick(values, "days"))
	if err != nil || n < 1 {
		return 14
	}
	if n > 60 {
		n = 60
	}
	return n
}

func (in CreateEventInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Code) < 6 || len(in.Code) > MaxCodeLen {
		errs["code"] = "场次编号需为 6-24 个字符"
	} else if !CodeAllowed(in.Code) {
		errs["code"] = "场次编号只允许字母、数字、下划线与连字符"
	}
	if n := len([]rune(in.Title)); n < 2 || n > 120 {
		errs["title"] = "演出名称需为 2-120 个字符"
	}
	if n := len([]rune(in.Artist)); n < 1 || n > 64 {
		errs["artist"] = "演出方需为 1-64 个字符"
	}
	if !ValidCategory(in.Category) {
		errs["category"] = "类型只能是 concert/theatre/livehouse/exhibition/family/esports"
	}
	if n := len([]rune(in.Venue)); n < 2 || n > 48 {
		errs["venue"] = "场馆需为 2-48 个字符"
	}
	if n := len([]rune(in.City)); n < 1 || n > 24 {
		errs["city"] = "城市需为 1-24 个字符"
	}
	gates := GateList(in.Gates)
	if len(gates) < 1 || len(gates) > 8 {
		errs["gates"] = "闸口需为 1-8 个，逗号分隔"
	} else {
		for _, g := range gates {
			if !CodeAllowed(g) || len(g) > 8 {
				errs["gates"] = "闸口标识只允许字母、数字与 -_"
				break
			}
		}
	}
	if in.RefundCutHours < RefundCutoffMinHours || in.RefundCutHours > RefundCutoffMaxHours {
		errs["refund_cutoff_hours"] = "退票截止需为开演前 2-72 小时"
	}
	if n := len([]rune(in.Note)); n > 200 {
		errs["note"] = "备注不超过 200 个字符"
	}
	doors, ok1 := parseTS(in.DoorsAt)
	start, ok2 := parseTS(in.StartAt)
	presale, ok3 := parseTS(in.PresaleEnd)
	if !ok1 {
		errs["doors_at"] = "开门时间需为 RFC3339 或 YYYY-MM-DDTHH:MM:SSZ"
	}
	if !ok2 {
		errs["start_at"] = "开演时间需为 RFC3339 或 YYYY-MM-DDTHH:MM:SSZ"
	}
	if !ok3 {
		errs["presale_end"] = "早鸟截止时间需为 RFC3339 或 YYYY-MM-DDTHH:MM:SSZ"
	}
	if ok1 && ok2 && !start.After(doors) {
		// 两个字段一起标：只点亮 start_at 的话，改 start_at 的人能把两个方向都填错。
		errs["start_at"] = "开演时间必须晚于开门时间"
		errs["doors_at"] = "开门时间必须早于开演时间"
	}
	if ok1 && ok3 && presale.After(doors) {
		errs["presale_end"] = "早鸟截止不得晚于开门时间"
	}
	return errs, len(errs) == 0
}

func parseTS(s string) (t time.Time, ok bool) {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 40 {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if v, err := time.Parse(layout, s); err == nil {
			return v.UTC(), true
		}
	}
	return time.Time{}, false
}

func (in SaleInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.EventCode) < 6 || len(in.EventCode) > MaxCodeLen || !CodeAllowed(in.EventCode) {
		errs["event_code"] = "场次编号非法"
	}
	if len(in.TypeCode) < 4 || len(in.TypeCode) > MaxCodeLen || !CodeAllowed(in.TypeCode) {
		errs["type_code"] = "票档编号非法"
	}
	if in.Quantity < OrderQtyMin || in.Quantity > OrderQtyMax {
		errs["quantity"] = "单笔购票需为 " + strconv.Itoa(OrderQtyMin) + "-" + strconv.Itoa(OrderQtyMax) + " 张"
	}
	if n := len([]rune(in.Buyer)); n < 2 || n > 48 {
		errs["buyer"] = "购票人需为 2-48 个字符"
	}
	if !ValidPhone(in.Phone) {
		errs["phone"] = "手机号需为 1 开头（次位 3-9）的 11 位数字"
	}
	if !ValidChannel(in.Channel) {
		errs["channel"] = "渠道只能是 web/box/partner/onsite"
	}
	return errs, len(errs) == 0
}

func (in CheckinInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	g := strings.TrimSpace(in.Gate)
	if g == "" || len(g) > 8 || !CodeAllowed(g) {
		errs["gate"] = "闸口标识需为 1-8 位字母数字"
	}
	return errs, len(errs) == 0
}

func (in RefundInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := len([]rune(in.Reason)); n < 2 || n > 120 {
		errs["reason"] = "退票原因需为 2-120 个字符"
	}
	return errs, len(errs) == 0
}
