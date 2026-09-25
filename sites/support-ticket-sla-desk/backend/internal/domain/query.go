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

// ListQuery 已经把不可信输入收敛成安全值：Status/Severity/... 经过字典校验，
// Sort 是排序列名（只可能是 ticketSorts 的 value），Dir 只可能是 asc/desc。
type ListQuery struct {
	Status   string
	Severity string
	Priority string
	Tier     string
	Team     string
	Agent    string
	Customer string
	Search   string
	Sort     string
	Dir      string
	Only     string // open / breached / at_risk / paused
	Page     int
	PageSize int
}

// 排序白名单：拼进 SQL 的只有这些常量，绝不拼用户输入。
var ticketSorts = map[string]string{
	"created":   "t.created_at",
	"due":       "t.resolve_due_at",
	"priority":  "t.priority",
	"severity":  "t.severity",
	"status":    "t.status",
	"customer":  "c.name",
	"agent":     "a.name",
	"code":      "t.code",
	"paused":    "t.paused_bd",
	"resolveBd": "t.resolve_bd",
}

func ValidSort(s string) bool { _, ok := ticketSorts[s]; return ok }

// SortOptions/OnlyOptions 是给前端的下拉字典：顺序固定（表格默认值排在最前），
// 避免 Object.keys(map) 的随机顺序把界面每次刷新都重排。
var SortOptions = []string{"due", "created", "priority", "severity", "status", "customer", "agent", "code", "paused", "resolveBd"}
var OnlyOptions = []string{"", "open", "at_risk", "breached", "paused", "responding"}
var OnlyLabels = map[string]string{
	"": "全部", "open": "在办", "at_risk": "即将超时", "breached": "已超时",
	"paused": "停表中", "responding": "待首响",
}
var Priorities = []string{"P1", "P2", "P3", "P4"}

var onlyValues = map[string]bool{"open": true, "breached": true, "at_risk": true, "paused": true, "responding": true}

const atRiskBusinessMinutes = 60

// ParseListQuery 解析队列表格的全部查询参数。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: ticketSorts["due"], Dir: "asc"}
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	if s := pick("status"); ValidStatus(s) {
		q.Status = s
	}
	if s := pick("severity"); ValidSeverity(s) {
		q.Severity = s
	}
	if s := pick("priority"); s == "P1" || s == "P2" || s == "P3" || s == "P4" {
		q.Priority = s
	}
	if s := pick("tier"); ValidTier(s) {
		q.Tier = s
	}
	if s := pick("team"); s != "" && utf8.RuneCountInString(s) <= 24 {
		q.Team = s
	}
	if s := pick("agent"); codeSafe(s) {
		q.Agent = s
	}
	if s := pick("customer"); codeSafe(s) {
		q.Customer = s
	}
	if s := pick("only"); onlyValues[s] {
		q.Only = s
	}
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	if col, ok := ticketSorts[pick("sort")]; ok {
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

// AtRiskWindow 是「即将超时」的工作分钟阈值，接口回显它以免前端各写一份。
func AtRiskWindow() int { return atRiskBusinessMinutes }

// SortName 把排序列表达式反查回逻辑名，供 Go 层精筛后排序复用（两个页签共用一套键）。
func SortName(col string) string {
	for name, c := range ticketSorts {
		if c == col {
			return name
		}
	}
	return "due"
}
