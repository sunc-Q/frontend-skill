package domain

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 48
)

// AssessmentQuery 是 /api/assessments 的收敛后参数。
type AssessmentQuery struct {
	Status   string
	Subject  string
	Kind     string
	Search   string
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

// AttemptQuery 是 /api/assessments/:code/attempts 的收敛后参数。
type AttemptQuery struct {
	Status   string
	Channel  string
	Passed   string // "" | "yes" | "no"
	Sort     string
	Dir      string
	Page     int
	PageSize int
}

var assessmentSorts = map[string]string{
	"code":        "a.code",
	"title":       "a.title",
	"opens_at":    "a.opens_at",
	"closes_at":   "a.closes_at",
	"attempts":    "attempts",
	"passed":      "passed_count",
	"avg":         "avg_percent",
	"total_score": "total_score",
	"id":          "a.id",
}

var attemptSorts = map[string]string{
	// 名次来自排名子查询 sc，分数必须走原表 a：sc 只暴露 id/rank_no 两列，
	// 写成 sc.score 会让默认排序整页 500。
	"score":     "a.score",
	"elapsed":   "a.elapsed_sec",
	"started":   "a.started_at",
	"submitted": "a.submitted_at",
	"rank":      "sc.rank_no",
	"candidate": "a.candidate_name",
	"status":    "a.status",
	"id":        "a.id",
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
	if strings.ToLower(raw) == "desc" {
		return "desc"
	}
	return "asc"
}

// ParseAssessmentQuery 把不可信 querystring 收敛成安全参数：
// 排序键只能命中白名单，分页有上限，搜索串按 rune 截断。
func ParseAssessmentQuery(values map[string][]string) AssessmentQuery {
	q := AssessmentQuery{Sort: assessmentSorts["opens_at"], Dir: "desc", Page: 1, PageSize: DefaultPageSz}
	if s := pickValue(values, "status"); ValidAssessmentStatus(s) {
		q.Status = s
	}
	if s := pickValue(values, "subject"); s != "" && utf8.RuneCountInString(s) <= 32 {
		q.Subject = s
	}
	if k := pickValue(values, "kind"); k == KindPlacement || k == KindUnit || k == KindMock || k == KindCert {
		q.Kind = k
	}
	if s := pickValue(values, "q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	if col, ok := assessmentSorts[pickValue(values, "sort")]; ok {
		q.Sort = col
		if col == "attempts" || col == "passed_count" || col == "avg_percent" || col == "total_score" {
			q.Dir = "desc" // 统计列默认从多到少，避免第一页全是 0
		}
	}
	q.Dir = clampDir(q.Dir)
	if pickValue(values, "dir") != "" {
		q.Dir = clampDir(pickValue(values, "dir"))
	}
	clampPage(values, &q.Page, &q.PageSize)
	return q
}

// ParseAttemptQuery 同上，作用于名单接口。
func ParseAttemptQuery(values map[string][]string) AttemptQuery {
	q := AttemptQuery{Sort: attemptSorts["score"], Dir: "desc", Page: 1, PageSize: DefaultPageSz}
	if s := pickValue(values, "status"); ValidAttemptStatus(s) {
		q.Status = s
	}
	if c := pickValue(values, "channel"); c == "web" || c == "campus" || c == "partner" {
		q.Channel = c
	}
	switch p := pickValue(values, "passed"); p {
	case "yes", "no":
		q.Passed = p
	}
	if col, ok := attemptSorts[pickValue(values, "sort")]; ok {
		q.Sort = col
	}
	q.Dir = clampDir(pickValue(values, "dir"))
	clampPage(values, &q.Page, &q.PageSize)
	return q
}

func (q AssessmentQuery) Offset() int { return (q.Page - 1) * q.PageSize }
func (q AttemptQuery) Offset() int    { return (q.Page - 1) * q.PageSize }

// SortColumn 返回去掉表别名后的列名，供 handler 回显「实际生效的排序字段」。
func sortBase(col string) string {
	if i := strings.LastIndex(col, "."); i >= 0 {
		return col[i+1:]
	}
	return col
}

func (q AssessmentQuery) SortKey() string { return sortBase(q.Sort) }
func (q AttemptQuery) SortKey() string    { return sortBase(q.Sort) }
