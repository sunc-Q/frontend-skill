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
	LaneCode string
	Tier     string
	Search   string
	Sort     string // 白名单落地的列名，只给 ORDER BY 用
	SortKey  string // 回显给前端的键名：内部列名不出接口
	Dir      string
	Page     int
	PageSize int
}

// sortColumns 是排序白名单：拼接进 SQL 的只可能是这里的值。
// 右侧的表别名必须与 ListWaybills 的实际 FROM/JOIN 别名一致（w=waybills, l=lanes），
// 引错别名会直接 no such column，所以每个键都被测试执行一遍。
var sortColumns = map[string]string{
	"code":       "w.code",
	"total":      "w.total_cents",
	"chargeable": "w.chargeable_grams",
	"weight":     "w.weight_grams",
	"booked":     "w.booked_at",
	"promised":   "w.promised_at",
	"status":     "w.status",
	"lane":       "l.code",
	"pieces":     "w.piece_count",
	"id":         "w.id",
}

func SortKeys() []string {
	out := make([]string, 0, len(sortColumns))
	for k := range sortColumns {
		out = append(out, k)
	}
	return out
}

// ParseListQuery 把不可信 querystring 收敛成安全查询参数：
// 非法 sort/status/tier 一律回落到默认值而不是 400，分页有上限，搜索串截断。
func ParseListQuery(values map[string][]string) ListQuery {
	q := ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: sortColumns["booked"], SortKey: "booked", Dir: "desc"}
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
	if c := pick("lane"); c != "" && utf8.RuneCountInString(c) <= 24 && CodeAllowed(c) {
		q.LaneCode = c
	}
	if t := pick("tier"); ValidTier(t) {
		q.Tier = t
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
type QuoteParams struct {
	LaneCode      string
	WeightGrams   int64
	VolumeCm3     int64
	HeaviestG     int64
	DeclaredCents int64
	Fragile       bool
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
	p := QuoteParams{LaneCode: pick("lane")}
	if p.LaneCode == "" || len(p.LaneCode) > 24 || !CodeAllowed(p.LaneCode) {
		errs["lane"] = "必须指定合法线路标识 lane"
	}
	num := func(key string, maxV int64) int64 {
		raw := pick(key)
		if raw == "" {
			return 0
		}
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 0 || n > maxV {
			errs[key] = key + " 需为 0-" + strconv.FormatInt(maxV, 10) + " 的整数"
			return 0
		}
		return n
	}
	p.WeightGrams = num("weight_g", MaxWeightGrams)
	p.VolumeCm3 = num("volume_cm3", MaxVolumeCm3)
	p.HeaviestG = num("heaviest_g", MaxWeightGrams)
	p.DeclaredCents = num("declared_cents", MaxDeclaredCents)
	p.Fragile = pick("fragile") == "1" || strings.EqualFold(pick("fragile"), "true")
	if p.WeightGrams < 1 {
		errs["weight_g"] = "实际重量至少 1 克"
	}
	if p.HeaviestG > p.WeightGrams {
		errs["heaviest_g"] = "最重单件不得超过总实际重量"
	}
	return p, errs, len(errs) == 0
}
