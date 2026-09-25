package domain

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 64
)

type ListQuery struct {
	Status   string
	PlanCode string
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

var sortColumns = map[string]string{
	"mrr":      "s.mrr",
	"renew_at": "s.renew_at",
	"created":  "s.start_at",
	"seats":    "s.seats",
	"company":  "sub.company",
	"status":   "s.status",
	"id":       "s.id",
}

// ParseListQuery 把不可信 querystring 收敛成安全的查询参数：
// 排序字段走白名单映射（拼接进 SQL 的只可能是这里的值），分页有上限，搜索串截断。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: sortColumns["renew_at"], Dir: "asc"}
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
	if p := pick("plan"); utf8.RuneCountInString(p) <= 32 {
		q.PlanCode = p
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

func (q ListQuery) Offset() int { return (q.Page - 1) * q.PageSize }
