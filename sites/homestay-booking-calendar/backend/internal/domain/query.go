package domain

import (
	"strconv"
	"strings"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 32
)

// BookingQuery 是 /api/bookings 收敛后的参数。
type BookingQuery struct {
	Status   string
	Property string
	Channel  string
	Room     string
	Horizon  string // "" | "arrivals" | "inhouse" | "departures" | "upcoming"
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

// RoomQuery 是 /api/rooms 收敛后的参数。
type RoomQuery struct {
	Property  string
	Status    string
	Breakfast string
	Sort      string
	Dir       string
	Page      int
	PageSize  int
}

// 排序列白名单：值一律是「真实存在的列或已定义的 SELECT 别名」，
// 且每个键都必须被测试实际执行一次（上一轮 sc.score 的教训）。
var bookingSorts = map[string]string{
	"code":      "b.code",
	"check_in":  "b.check_in",
	"check_out": "b.check_out",
	"nights":    "b.nights",
	"units":     "b.units",
	"total":     "b.total_cents",
	"refund":    "b.refund_cents",
	"guest":     "b.guest_name",
	"status":    "b.status",
	"channel":   "b.channel",
	"room":      "b.room_code",
	"property":  "b.property_code",
	"created":   "b.created_at",
	"updated":   "b.updated_at",
	"id":        "b.id",
}

var roomSorts = map[string]string{
	// 值必须真实存在于列表查询里：要么是 room_types 的列，要么是 roomSelect 里定义的聚合别名。
	// occ/adr 是 Go 侧算出来的视图字段，写进 ORDER BY 就是上一轮 sc.score 那种整页 500。
	"code":     "rt.code",
	"name":     "rt.name",
	"units":    "rt.units",
	"price":    "rt.base_price_cents",
	"bookings": "bookings",
	"nights":   "nights_sold",
	"revenue":  "revenue_cents",
	"property": "rt.property_code",
	"id":       "rt.id",
}

func pickValue(values map[string][]string, key string) string {
	v := values[key]
	if len(v) == 0 {
		return ""
	}
	return strings.TrimSpace(v[0])
}

func clampPage(values map[string][]string, q *int, size *int) {
	if n, err := strconv.Atoi(pickValue(values, "page")); err == nil && n > 0 {
		if n > 100_000 {
			n = 100_000
		}
		*q = n
	}
	if n, err := strconv.Atoi(pickValue(values, "page_size")); err == nil && n > 0 {
		if n > MaxPageSize {
			n = MaxPageSize
		}
		*size = n
	}
}

func clampDir(raw string) string {
	if strings.ToLower(raw) == "asc" {
		return "asc"
	}
	return "desc"
}

func clampSearch(raw string) string {
	r := []rune(strings.TrimSpace(raw))
	if len(r) > MaxQueryRunes {
		r = r[:MaxQueryRunes]
	}
	return string(r)
}

func applySort(values map[string][]string, sorts map[string]string, def string, q *string, dir *string) {
	if col, ok := sorts[pickValue(values, "sort")]; ok {
		*q = col
	} else if pickValue(values, "sort") != "" {
		*q = sorts[def]
	}
	*dir = clampDir(pickValue(values, "dir"))
}

// ParseBookingQuery 把不可信 querystring 收敛成安全参数。
func ParseBookingQuery(values map[string][]string) BookingQuery {
	q := BookingQuery{Sort: bookingSorts["check_in"], Dir: "asc", Page: 1, PageSize: DefaultPageSz}
	if s := pickValue(values, "status"); ValidBookingStatus(s) {
		q.Status = s
	}
	if s := pickValue(values, "property"); isCode(s) {
		q.Property = s
	}
	if s := pickValue(values, "room"); isCode(s) {
		q.Room = s
	}
	if s := pickValue(values, "channel"); ValidChannel(s) {
		q.Channel = s
	}
	switch h := pickValue(values, "horizon"); h {
	case "arrivals", "inhouse", "departures", "upcoming", "past":
		q.Horizon = h
	}
	q.Search = clampSearch(pickValue(values, "q"))
	applySort(values, bookingSorts, "check_in", &q.Sort, &q.Dir)
	clampPage(values, &q.Page, &q.PageSize)
	return q
}

// ParseRoomQuery 同上，作用于房型列表。
func ParseRoomQuery(values map[string][]string) RoomQuery {
	q := RoomQuery{Sort: roomSorts["property"], Dir: "asc", Page: 1, PageSize: DefaultPageSz}
	if s := pickValue(values, "property"); isCode(s) {
		q.Property = s
	}
	if s := pickValue(values, "status"); ValidRoomStatus(s) {
		q.Status = s
	}
	switch pickValue(values, "breakfast") {
	case "yes", "no":
		q.Breakfast = pickValue(values, "breakfast")
	}
	applySort(values, roomSorts, "property", &q.Sort, &q.Dir)
	clampPage(values, &q.Page, &q.PageSize)
	return q
}

func (q BookingQuery) Offset() int { return (q.Page - 1) * q.PageSize }
func (q RoomQuery) Offset() int    { return (q.Page - 1) * q.PageSize }

// BookingSortSQL / RoomSortSQL 是 repository 侧的第二道白名单：
// 只有出现在映射值集合里的片段才允许拼进 ORDER BY，其余一律回落到默认列。
func BookingSortSQL(sort string) string { return allowedSort(sort, bookingSorts, "b.check_in") }
func RoomSortSQL(sort string) string    { return allowedSort(sort, roomSorts, "rt.property_code") }

func allowedSort(sort string, m map[string]string, fallback string) string {
	for _, v := range m {
		if v == sort {
			return v
		}
	}
	return fallback
}

// SortKey 返回去掉表别名后的列名，供 handler 回显「实际生效的排序字段」。
func sortBase(col string) string {
	if i := strings.LastIndex(col, "."); i >= 0 {
		return col[i+1:]
	}
	return col
}

func (q BookingQuery) SortKey() string { return sortBase(q.Sort) }
func (q RoomQuery) SortKey() string    { return sortBase(q.Sort) }

// SortAllowed 供 handler 回显「传入的非法排序键被收敛成了什么」。
func BookingSortAllowed(raw string) bool { _, ok := bookingSorts[raw]; return ok }
func RoomSortAllowed(raw string) bool    { _, ok := roomSorts[raw]; return ok }

// BookingSorts / RoomSorts 返回白名单副本，测试逐个断言值是真列名。
func BookingSorts() map[string]string { return copySorts(bookingSorts) }
func RoomSorts() map[string]string    { return copySorts(roomSorts) }

func copySorts(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// isCode 只放行字母数字与 -_，长度受限：查询参数直接进 WHERE 的绑定值，
// 但把注入串挡在门口比什么都干净。
func isCode(s string) bool {
	if len(s) == 0 || len(s) > 24 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_'
		if !ok {
			return false
		}
	}
	return true
}

// IsCode 导出版，供 handler 校验路径参数。
func IsCode(s string) bool { return isCode(s) }

// LikeEscaped 把用户输入变成 LIKE 的模式串：先转义 \ % _，再两头加 %。
func LikeEscaped(s string) string {
	t := s
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(t) + "%"
}
