package domain

import (
	"strconv"
	"strings"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 64
)

type OrderListQuery struct {
	Status   string
	ZoneCode string
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

type MenuQuery struct {
	Category   string
	Search     string
	OnlyOpen   bool
	IncludeAll bool
	Sort       string
	Dir        string
	Page       int
	PageSize   int
}

var orderSortColumns = map[string]string{
	"placed": "o.placed_at",
	"total":  "o.total_cents",
	"items":  "o.item_count",
	"status": "o.status",
	"prep":   "o.prep_minutes",
	"id":     "o.id",
}

var menuSortColumns = map[string]string{
	"price": "d.price_cents",
	"prep":  "d.prep_min",
	"sold":  "sold_total",
	"name":  "d.name",
	"id":    "d.id",
	"spice": "d.spice",
	"code":  "d.code",
}

// ParseOrderListQuery 把不可信 querystring 收敛成安全查询参数：
// 排序走白名单映射，分页有上限，搜索串截断并转义 LIKE 通配符。
func ParseOrderListQuery(values map[string][]string) OrderListQuery {
	q := OrderListQuery{Page: 1, PageSize: DefaultPageSz, Sort: orderSortColumns["placed"], Dir: "desc"}
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	if s := pick("status"); s != "" && ValidStatus(s) {
		q.Status = s
	}
	if z := pick("zone"); ValidCode(z) && len(z) <= 16 {
		q.ZoneCode = z
	}
	q.Search = clampSearch(pick("q"))
	if col, ok := orderSortColumns[pick("sort")]; ok {
		q.Sort = col
	}
	q.Dir = dirOrDefault(pick("dir"))
	q.Page = clampPage(pick("page"))
	q.PageSize = clampPageSize(pick("page_size"))
	return q
}

func ParseMenuQuery(values map[string][]string) MenuQuery {
	q := MenuQuery{Page: 1, PageSize: 50, Sort: menuSortColumns["id"], Dir: "asc", IncludeAll: true}
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	if c := pick("category"); ValidCategory(c) {
		q.Category = c
	}
	q.Search = clampSearch(pick("q"))
	if pick("available") == "1" || strings.EqualFold(pick("available"), "true") {
		q.OnlyOpen = true
		q.IncludeAll = false
	}
	if col, ok := menuSortColumns[pick("sort")]; ok {
		q.Sort = col
	}
	q.Dir = dirOrDefault(pick("dir"))
	q.Page = clampPage(pick("page"))
	q.PageSize = clampPageSize(pick("page_size"))
	return q
}

func clampSearch(s string) string {
	if s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) > MaxQueryRunes {
		r = r[:MaxQueryRunes]
	}
	return string(r)
}

func dirOrDefault(d string) string {
	if strings.ToLower(d) == "asc" {
		return "asc"
	}
	return "desc"
}

func clampPage(v string) int {
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 1
	}
	if n > 100_000 {
		n = 100_000
	}
	return n
}

func clampPageSize(v string) int {
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return DefaultPageSz
	}
	if n > MaxPageSize {
		n = MaxPageSize
	}
	return n
}

func (q OrderListQuery) Offset() int { return (q.Page - 1) * q.PageSize }
func (q MenuQuery) Offset() int      { return (q.Page - 1) * q.PageSize }
