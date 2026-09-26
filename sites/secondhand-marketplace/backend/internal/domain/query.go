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

// ListQuery 是 /api/listings 的查询参数。零值不可用，必须由 ParseListQuery 生成。
type ListQuery struct {
	Status    string
	Category  string
	Condition string
	Search    string
	Sort      string
	Dir       string
	Page      int
	PageSize  int
}

// OfferQuery 是 /api/deals 的查询参数。
type OfferQuery struct {
	Status   string
	Category string
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

// listingSortColumns：写进 ORDER BY 的只可能是这里的 value，绝不拼接用户输入。
// 别名 l=listing_rows 子查询 / o=offers，见 repository 层实际 SQL。
var listingSortColumns = map[string]string{
	"posted": "l.posted_at",
	"asking": "l.asking_cent",
	"best":   "l.best_offer_cent",
	"offers": "l.offer_count",
	"views":  "l.views",
	"code":   "l.code",
	"status": "l.status",
	"id":     "l.id",
}

var offerSortColumns = map[string]string{
	"placed":  "o.placed_at",
	"amount":  "o.amount_cent",
	"expires": "o.expires_at",
	"deal":    "o.deal_no",
	"status":  "o.status",
	"id":      "o.id",
}

func pick(values map[string][]string, key string) string {
	v := values[key]
	if len(v) == 0 {
		return ""
	}
	return strings.TrimSpace(v[0])
}

func clampPage(values map[string][]string, q *ListQuery) {
	if n, err := strconv.Atoi(pick(values, "page")); err == nil && n > 0 {
		if n > 100_000 {
			n = 100_000
		}
		q.Page = n
	}
	if n, err := strconv.Atoi(pick(values, "page_size")); err == nil && n > 0 {
		if n > MaxPageSize {
			n = MaxPageSize
		}
		q.PageSize = n
	}
}

func clampOfferPage(values map[string][]string, q *OfferQuery) {
	if n, err := strconv.Atoi(pick(values, "page")); err == nil && n > 0 {
		if n > 100_000 {
			n = 100_000
		}
		q.Page = n
	}
	if n, err := strconv.Atoi(pick(values, "page_size")); err == nil && n > 0 {
		if n > MaxPageSize {
			n = MaxPageSize
		}
		q.PageSize = n
	}
}

func truncSearch(s string) string {
	r := []rune(s)
	if len(r) > MaxQueryRunes {
		r = r[:MaxQueryRunes]
	}
	return string(r)
}

// ParseListQuery 把不可信 querystring 收敛成安全查询参数：
// 排序走白名单、分页有上限、搜索串按 rune 截断、枚举值不合法就退回默认。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: listingSortColumns["posted"], Dir: "desc"}
	if s := pick(values, "status"); ValidListingStatus(s) {
		q.Status = s
	}
	if c := pick(values, "category"); c != "" && utf8.RuneCountInString(c) <= 32 && CodeAllowed(c) {
		q.Category = c
	}
	if c := pick(values, "condition"); ValidCondition(c) {
		q.Condition = c
	}
	if s := pick(values, "q"); s != "" {
		q.Search = truncSearch(s)
	}
	if col, ok := listingSortColumns[pick(values, "sort")]; ok {
		q.Sort = col
	}
	if strings.EqualFold(pick(values, "dir"), "asc") {
		q.Dir = "asc"
	}
	clampPage(values, &q)
	return q
}

func ParseOfferQuery(values map[string][]string) OfferQuery {
	q := OfferQuery{Page: 1, PageSize: DefaultPageSz, Sort: offerSortColumns["placed"], Dir: "desc"}
	if s := pick(values, "status"); ValidOfferStatus(s) {
		q.Status = s
	}
	if c := pick(values, "category"); c != "" && utf8.RuneCountInString(c) <= 32 && CodeAllowed(c) {
		q.Category = c
	}
	if s := pick(values, "q"); s != "" {
		q.Search = truncSearch(s)
	}
	if col, ok := offerSortColumns[pick(values, "sort")]; ok {
		q.Sort = col
	}
	if strings.EqualFold(pick(values, "dir"), "asc") {
		q.Dir = "asc"
	}
	clampOfferPage(values, &q)
	return q
}

func (q ListQuery) Offset() int  { return (q.Page - 1) * q.PageSize }
func (q OfferQuery) Offset() int { return (q.Page - 1) * q.PageSize }
