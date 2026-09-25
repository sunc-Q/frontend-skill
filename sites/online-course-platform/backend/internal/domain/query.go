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

type CourseListQuery struct {
	Domain    string
	Level     string
	Status    string
	Search    string
	Sort      string
	Dir       string
	Page      int
	PageSize  int
	EarlyOnly bool
}

// 排序字段白名单：拼接进 SQL 的 ORDER BY 只可能是这里的值。
var courseSortColumns = map[string]string{
	"code":      "c.code",
	"title":     "c.title",
	"price":     "effective_price",
	"hours":     "c.hours",
	"capacity":  "c.capacity",
	"occupied":  "occupied",
	"fill":      "fill_ratio",
	"published": "c.published_at",
	"id":        "c.id",
}

var validLevels = map[string]bool{"入门": true, "进阶": true, "高级": true}

// ParseCourseListQuery 把不可信 querystring 收敛成安全查询参数：
// 缺省只看在售课程；分页有上限；搜索串截断并转义。
func ParseCourseListQuery(values map[string][]string) CourseListQuery {
	q := CourseListQuery{
		Status:   CoursePublished,
		Page:     1,
		PageSize: DefaultPageSz,
		Sort:     courseSortColumns["fill"],
		Dir:      "desc",
	}
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	if d := pick("domain"); d != "" && utf8.RuneCountInString(d) <= 24 {
		q.Domain = d
	}
	if l := pick("level"); validLevels[l] {
		q.Level = l
	}
	if s := pick("status"); ValidCourseStatus(s) {
		q.Status = s
	} else if s != "" {
		q.Status = CoursePublished
	}
	if pick("early") == "1" || strings.EqualFold(pick("early"), "true") {
		q.EarlyOnly = true
	}
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	col, ok := courseSortColumns[pick("sort")]
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

func (q CourseListQuery) Offset() int { return (q.Page - 1) * q.PageSize }
