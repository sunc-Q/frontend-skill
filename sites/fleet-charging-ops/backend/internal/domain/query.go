package domain

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	MaxPageSize   = 100
	DefaultPageSz = 20
	MaxQueryRunes = 40
)

type ListQuery struct {
	Status   string
	PileCode string
	Plate    string
	Dept     string
	OpenOnly bool
	Search   string
	Sort     string // 白名单落地的列名，只给 ORDER BY 用
	SortKey  string // 回显给前端的键名：内部列名不出接口
	Dir      string
	Page     int
	PageSize int
}

// sortColumns 是排序白名单：拼接进 SQL 的只可能是这里的值。
// 右侧的表别名必须与 ListSessions 的实际 FROM/JOIN 别名一致（s=charge_sessions, p=piles, v=vehicles），
// 引错别名会直接 no such column，所以每个键都被测试执行一遍。
var sortColumns = map[string]string{
	"code":     "s.code",
	"start":    "s.start_at",
	"end":      "s.end_at",
	"energy":   "s.actual_wh",
	"total":    "s.total_cents",
	"status":   "s.status",
	"pile":     "p.code",
	"plate":    "v.plate_no",
	"overstay": "s.overstay_min",
	"id":       "s.id",
}

func SortKeys() []string {
	out := make([]string, 0, len(sortColumns))
	for k := range sortColumns {
		out = append(out, k)
	}
	return out
}

// ParseListQuery 把不可信 querystring 收敛成安全查询参数：
// 非法 sort/status/pile/dept 一律回落到默认值而不是 400，分页有上限，搜索串截断。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: sortColumns["start"], SortKey: "start", Dir: "desc"}
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	if s := pick("status"); ValidSessionStatus(s) {
		q.Status = s
	}
	if s := pick("open"); s == "1" {
		q.OpenOnly = true
	}
	if c := pick("pile"); c != "" && utf8.RuneCountInString(c) <= 24 && CodeAllowed(c) {
		q.PileCode = c
	}
	if p := pick("plate"); PlateAllowed(p) {
		q.Plate = p
	}
	if d := pick("dept"); d != "" && utf8.RuneCountInString(d) <= 32 {
		q.Dept = d
	}
	if s := pick("q"); s != "" {
		r := []rune(s)
		if len(r) > MaxQueryRunes {
			r = r[:MaxQueryRunes]
		}
		q.Search = string(r)
	}
	if k := pick("sort"); sortColumns[k] != "" {
		q.Sort, q.SortKey = sortColumns[k], k
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

// ParseQuoteQuery 解析试算参数；返回错误即参数非法（400 由 handler 出）。
// 口径：从现在起 delay_min 分钟后开充，充 minutes 分钟、灌入 wh 瓦时。
type QuoteParams struct {
	PileCode string
	Wh       int64
	Minutes  int64
	DelayMin int64
	Overstay int
}

func ParseQuoteQuery(values map[string][]string) (QuoteParams, map[string]string, bool) {
	pick := func(key string) string {
		v := values[key]
		if len(v) == 0 {
			return ""
		}
		return strings.TrimSpace(v[0])
	}
	errs := map[string]string{}
	p := QuoteParams{PileCode: pick("pile")}
	if p.PileCode == "" || len(p.PileCode) > 24 || !CodeAllowed(p.PileCode) {
		errs["pile"] = "必须指定合法桩编号 pile"
	}
	num := func(key string, minV, maxV int64) int64 {
		raw := pick(key)
		if raw == "" {
			errs[key] = key + " 为必填整数"
			return 0
		}
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < minV || n > maxV {
			errs[key] = key + " 需为 " + strconv.FormatInt(minV, 10) + "-" + strconv.FormatInt(maxV, 10) + " 的整数"
			return 0
		}
		return n
	}
	optNum := func(key string, minV, maxV int64) int64 {
		if pick(key) == "" {
			return 0
		}
		return num(key, minV, maxV)
	}
	p.Wh = num("wh", MinWh, MaxWh)
	p.Minutes = num("minutes", 5, 1440)
	p.DelayMin = optNum("delay_min", 0, 10080)
	if o := pick("overstay_min"); o != "" {
		n, err := strconv.Atoi(o)
		if err != nil || n < 0 || n > MaxOverstayMin {
			errs["overstay_min"] = "超时占桩分钟越界（0-360）"
		} else {
			p.Overstay = n
		}
	}
	return p, errs, len(errs) == 0
}
