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
	Category string
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

var itemSorts = map[string]string{
	"code":      "i.code",
	"title":     "i.title",
	"author":    "i.author",
	"year":      "i.pub_year",
	"category":  "i.category",
	"added":     "i.added_at",
	"available": "available_copies",
	"total":     "total_copies",
	"id":        "i.id",
}

var loanSorts = map[string]string{
	"due":      "l.due_at",
	"borrowed": "l.borrowed_at",
	"returned": "l.returned_at",
	"member":   "m.name",
	"item":     "i.title",
	"barcode":  "c.barcode",
	"fine":     "l.fine_cents",
	"renew":    "l.renew_count",
	"status":   "l.status",
	"id":       "l.id",
}

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
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	col, ok := defaults[pick("sort")]
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

type sortMap map[string]string

// ParseItemQuery / ParseLoanQuery 把不可信 querystring 收敛成安全查询参数：
// 排序字段只可能来自白名单值，分页有上限，搜索串按 rune 截断。
func ParseItemQuery(values map[string][]string) ListQuery {
	q := parseCommon(values, itemSorts, "added")
	if q.Status != "available" && q.Status != "on_loan" && q.Status != "all" {
		q.Status = ""
	}
	if !ValidCategory(q.Category) {
		q.Category = ""
	}
	return q
}

func ParseLoanQuery(values map[string][]string) ListQuery {
	q := parseCommon(values, loanSorts, "due")
	switch q.Status {
	case LoanActive, LoanReturned, "overdue":
	default:
		q.Status = ""
	}
	if !ValidCategory(q.Category) {
		q.Category = ""
	}
	return q
}

func (q ListQuery) Offset() int { return (q.Page - 1) * q.PageSize }
