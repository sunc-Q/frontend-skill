package domain

import (
	"strconv"
	"strings"
)

const (
	MaxPageSize   = 60
	DefaultPageSz = 12
	MaxQueryRunes = 64
)

type ListQuery struct {
	Category string
	InStock  bool
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

var sortColumns = map[string]string{
	"price":   "p.price_cents",
	"rating":  "rating_avg",
	"sold":    "p.sold_30",
	"stock":   "p.stock",
	"name":    "p.name",
	"created": "p.created_at",
	"id":      "p.id",
}

// ParseListQuery 把不可信 querystring 收敛成安全的查询参数：
// 排序字段走白名单映射（拼接进 SQL 的只可能是这里的值），分页有上限，搜索串截断。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: sortColumns["sold"], Dir: "desc"}
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
	if pick("in_stock") == "1" || strings.EqualFold(pick("in_stock"), "true") {
		q.InStock = true
	}
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	col, ok := sortColumns[pick("sort")]
	if ok {
		q.Sort = col
	}
	if d := strings.ToLower(pick("dir")); d == "asc" {
		q.Dir = "asc"
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

func (q ListQuery) Offset() int { return (q.Page - 1) * q.PageSize }
