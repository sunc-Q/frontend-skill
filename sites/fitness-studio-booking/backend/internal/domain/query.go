package domain

import (
	"strconv"
	"strings"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 64
	ScheduleHoriz = 14 // 课表最多向后看两周，防止 page_size*days 把库扫穿
)

type ListQuery struct {
	Category string
	Coach    string
	Level    string
	Status   string
	From     string // YYYY-MM-DD，空则后端用「今天」
	Days     int
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

// sortColumns 是唯一的排序白名单：拼进 SQL 的只可能是这里的值。
var sortColumns = map[string]string{
	"start_at":  "s.start_at",
	"class":     "c.name",
	"coach":     "c.coach",
	"booked":    "confirmed",
	"remaining": "remaining",
	"id":        "s.id",
	"room":      "s.room",
}

// ParseListQuery 把不可信 querystring 收敛成安全的查询参数。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: sortColumns["start_at"], Dir: "asc", Days: 7}
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
	if l := pick("level"); ValidLevel(l) {
		q.Level = l
	}
	if s := pick("status"); ValidSessionStatus(s) {
		q.Status = s
	}
	if co := pick("coach"); isCoachName(co) {
		q.Coach = co
	}
	if d := pick("date"); isDateOnly(d) {
		q.From = d
	}
	if n, err := strconv.Atoi(pick("days")); err == nil && n >= 1 {
		if n > ScheduleHoriz {
			n = ScheduleHoriz
		}
		q.Days = n
	}
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	if col, ok := sortColumns[pick("sort")]; ok {
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

// isCoachName 教练名是自由文本但会作为参数进 SQL：限制字符集与长度，
// 拒掉引号/分号/换行，让「即使参数化正确也别把垃圾写进日志」。
func isCoachName(s string) bool {
	if s == "" || len(s) > 32 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r >= 0x4e00 && r <= 0x9fff: // CJK 基本区
		default:
			return false
		}
	}
	return true
}

// isDateOnly 严格 YYYY-MM-DD（不校验月份是否真的存在，交给时间解析）。
func isDateOnly(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	for i, r := range s {
		if i == 4 || i == 7 {
			continue
		}
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func ValidSortKey(k string) bool {
	_, ok := sortColumns[k]
	return ok
}
