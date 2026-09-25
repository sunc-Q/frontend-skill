package domain

import (
	"strings"
	"testing"
)

func TestCreateProductInputValidate(t *testing.T) {
	base := func() CreateProductInput {
		return CreateProductInput{
			SKU: "CB-NEW-9001", Name: "测试商品", Category: "消费电子", Brand: "测试牌",
			PriceCents: 1999, Stock: 10, WeightG: 200, HSCode: "8517.62",
			Origin: "中国·深圳", LeadMin: 1, LeadMax: 3,
		}
	}
	cases := []struct {
		name     string
		mutate   func(in *CreateProductInput)
		wantOK   bool
		wantKeys []string
	}{
		{"合法", func(in *CreateProductInput) {}, true, nil},
		{"sku 过短", func(in *CreateProductInput) { in.SKU = "ab" }, false, []string{"sku"}},
		{"sku 过长", func(in *CreateProductInput) { in.SKU = strings.Repeat("c", 40) }, false, []string{"sku"}},
		{"名称单字", func(in *CreateProductInput) { in.Name = "灯" }, false, []string{"name"}},
		{"名称超长", func(in *CreateProductInput) { in.Name = strings.Repeat("灯", 161) }, false, []string{"name"}},
		{"价格为零", func(in *CreateProductInput) { in.PriceCents = 0 }, false, []string{"price_cents"}},
		{"价格为负", func(in *CreateProductInput) { in.PriceCents = -5 }, false, []string{"price_cents"}},
		{"价格越界", func(in *CreateProductInput) { in.PriceCents = 10_000_001 }, false, []string{"price_cents"}},
		{"库存为负", func(in *CreateProductInput) { in.Stock = -1 }, false, []string{"stock"}},
		{"重量过大", func(in *CreateProductInput) { in.WeightG = 50_001 }, false, []string{"weight_g"}},
		{"类目不在白名单", func(in *CreateProductInput) { in.Category = "军火" }, false, []string{"category"}},
		{"HS 含字母", func(in *CreateProductInput) { in.HSCode = "8517.6B" }, false, []string{"hs_code"}},
		{"HS 过短", func(in *CreateProductInput) { in.HSCode = "8517" }, false, []string{"hs_code"}},
		{"时效倒挂", func(in *CreateProductInput) { in.LeadMin = 5; in.LeadMax = 2 }, false,
			[]string{"lead_min_days", "lead_max_days"}},
		{"多字段同错", func(in *CreateProductInput) {
			in.SKU = "x"
			in.PriceCents = -1
			in.WeightG = 0
			in.Category = "特效药"
		}, false, []string{"sku", "price_cents", "weight_g", "category"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := base()
			tc.mutate(&in)
			errs, ok := in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v (errs=%v)", ok, tc.wantOK, errs)
			}
			for _, k := range tc.wantKeys {
				if _, has := errs[k]; !has {
					t.Errorf("缺少字段错误项 %q，实得 %v", k, errs)
				}
			}
			if ok && len(errs) != 0 {
				t.Errorf("校验通过时不应返回错误项：%v", errs)
			}
		})
	}
}

func TestAddToCartInputValidate(t *testing.T) {
	cases := []struct {
		name     string
		in       AddToCartInput
		wantOK   bool
		wantKeys []string
	}{
		{"合法加购", AddToCartInput{SKU: "CB-EL-0001", Qty: 3}, true, nil},
		{"qty=0 表示移出，合法", AddToCartInput{SKU: "CB-EL-0001", Qty: 0}, true, nil},
		{"负数量", AddToCartInput{SKU: "CB-EL-0001", Qty: -2}, false, []string{"qty"}},
		{"数量越界", AddToCartInput{SKU: "CB-EL-0001", Qty: 1000}, false, []string{"qty"}},
		{"sku 注入串（长度不足即拒）", AddToCartInput{SKU: "1' OR '1'='1", Qty: 1}, false, []string{"sku"}},
		{"sku 过短", AddToCartInput{SKU: "ab", Qty: 1}, false, []string{"sku"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v", ok, tc.wantOK)
			}
			for _, k := range tc.wantKeys {
				if _, has := errs[k]; !has {
					t.Errorf("缺少字段错误项 %q", k)
				}
			}
		})
	}
}

func TestParseListQueryClampsUntrustedInput(t *testing.T) {
	huge := strings.Repeat("x", 5000)
	defSort := sortColumns["sold"]
	cases := []struct {
		name   string
		values map[string][]string
		check  func(*testing.T, ListQuery)
	}{
		{"默认值", map[string][]string{}, func(t *testing.T, q ListQuery) {
			if q.Page != 1 || q.PageSize != DefaultPageSz || q.Sort != defSort || q.Dir != "desc" {
				t.Fatalf("%+v", q)
			}
		}},
		{"page_size 超上限被夹紧", map[string][]string{"page_size": {"100000"}}, func(t *testing.T, q ListQuery) {
			if q.PageSize != MaxPageSize {
				t.Fatalf("page_size=%d", q.PageSize)
			}
		}},
		{"sort 注入回退默认列", map[string][]string{"sort": {"(SELECT 1)"}}, func(t *testing.T, q ListQuery) {
			if q.Sort != defSort {
				t.Fatalf("sort=%q", q.Sort)
			}
		}},
		{"sort 白名单命中", map[string][]string{"sort": {"price"}, "dir": {"ASC"}}, func(t *testing.T, q ListQuery) {
			if q.Sort != "p.price_cents" || q.Dir != "asc" {
				t.Fatalf("%+v", q)
			}
		}},
		{"非法类目被丢弃", map[string][]string{"category": {"消费电子' OR 1=1--"}}, func(t *testing.T, q ListQuery) {
			if q.Category != "" {
				t.Fatalf("category=%q", q.Category)
			}
		}},
		{"合法类目保留", map[string][]string{"category": {"户外运动"}}, func(t *testing.T, q ListQuery) {
			if q.Category != "户外运动" {
				t.Fatalf("category=%q", q.Category)
			}
		}},
		{"超长搜索串截断", map[string][]string{"q": {huge}}, func(t *testing.T, q ListQuery) {
			if len([]rune(q.Search)) != MaxQueryRunes {
				t.Fatalf("search len=%d", len([]rune(q.Search)))
			}
		}},
		{"负页码回退首页", map[string][]string{"page": {"-7"}}, func(t *testing.T, q ListQuery) {
			if q.Page != 1 {
				t.Fatalf("page=%d", q.Page)
			}
		}},
		{"in_stock 识别 1", map[string][]string{"in_stock": {"1"}}, func(t *testing.T, q ListQuery) {
			if !q.InStock {
				t.Fatal("InStock 应为 true")
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := ParseListQuery(tc.values)
			tc.check(t, q)
			allowed := false
			for _, col := range sortColumns {
				if q.Sort == col {
					allowed = true
				}
			}
			if !allowed {
				t.Fatalf("Sort 逃逸白名单：%q", q.Sort)
			}
			if q.Dir != "asc" && q.Dir != "desc" {
				t.Fatalf("Dir 逃逸白名单：%q", q.Dir)
			}
		})
	}
}

func TestFreightCents(t *testing.T) {
	rg := RegionByCode("US") // 首重 500g=599，每 500g +150
	if rg == nil {
		t.Fatal("US 税则不存在")
	}
	cases := []struct {
		weightG int
		want    int64
	}{
		{0, 0},
		{1, 599},
		{500, 599},
		{501, 749},
		{1000, 749},
		{1001, 899},
		{2100, 1199},
	}
	for _, tc := range cases {
		if got := rg.FreightCents(tc.weightG); got != tc.want {
			t.Errorf("weight=%d got %d want %d", tc.weightG, got, tc.want)
		}
	}
	if RegionByCode("XX") != nil {
		t.Error("未知目的国应为 nil")
	}
}
