package domain

import (
	"strings"
	"testing"
)

func TestCreatePlanInputValidate(t *testing.T) {
	longCode := strings.Repeat("c", 40)
	cases := []struct {
		name     string
		in       CreatePlanInput
		wantOK   bool
		wantKeys []string
	}{
		{"合法", CreatePlanInput{Code: "scale", Name: "扩容版", PriceMonthly: 8900, PriceYearly: 89000, SeatQuota: 25}, true, nil},
		{"code 过短", CreatePlanInput{Code: "a", Name: "x", PriceMonthly: 1, SeatQuota: 1}, false, []string{"code"}},
		{"code 过长", CreatePlanInput{Code: longCode, Name: "x", PriceMonthly: 1, SeatQuota: 1}, false, []string{"code"}},
		{"name 为空", CreatePlanInput{Code: "ok", Name: "", PriceMonthly: 1, SeatQuota: 1}, false, []string{"name"}},
		{"月付为负", CreatePlanInput{Code: "ok", Name: "x", PriceMonthly: -1, SeatQuota: 1}, false, []string{"price_monthly"}},
		{"月付越界", CreatePlanInput{Code: "ok", Name: "x", PriceMonthly: 9_999_999_999, SeatQuota: 1}, false, []string{"price_monthly"}},
		{"席位越界", CreatePlanInput{Code: "ok", Name: "x", PriceMonthly: 1, SeatQuota: 100_001}, false, []string{"seat_quota"}},
		{"多字段同时报错", CreatePlanInput{Code: "", Name: "", PriceMonthly: -3, PriceYearly: -1, SeatQuota: -2}, false,
			[]string{"code", "name", "price_monthly", "price_yearly", "seat_quota"}},
		{"零价免费套餐合法", CreatePlanInput{Code: "free", Name: "免费版", PriceMonthly: 0, PriceYearly: 0, SeatQuota: 1}, true, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v (errs=%v)", ok, tc.wantOK, errs)
			}
			if !tc.wantOK {
				for _, k := range tc.wantKeys {
					if _, has := errs[k]; !has {
						t.Errorf("缺少字段错误项 %q，实得 %v", k, errs)
					}
				}
			}
			if ok && len(errs) != 0 {
				t.Errorf("校验通过时不应返回错误项：%v", errs)
			}
		})
	}
}

func TestRenewInputValidate(t *testing.T) {
	cases := []struct {
		name     string
		in       RenewInput
		wantOK   bool
		wantKeys []string
	}{
		{"合法月付", RenewInput{Amount: 3800, Period: PeriodMonthly, NextRenew: "2026-11-01"}, true, nil},
		{"合法年付", RenewInput{Amount: 38000, Period: PeriodYearly, NextRenew: "2027-11-01"}, true, nil},
		{"金额为零", RenewInput{Amount: 0, Period: PeriodMonthly, NextRenew: "2026-11-01"}, false, []string{"amount"}},
		{"金额为负", RenewInput{Amount: -1, Period: PeriodMonthly, NextRenew: "2026-11-01"}, false, []string{"amount"}},
		{"period 非法", RenewInput{Amount: 1, Period: "weekly", NextRenew: "2026-11-01"}, false, []string{"period"}},
		{"日期格式错", RenewInput{Amount: 1, Period: PeriodMonthly, NextRenew: "2026/11/01"}, false, []string{"next_renew"}},
		{"日期注入串", RenewInput{Amount: 1, Period: PeriodMonthly, NextRenew: "2026-11-01'; DROP TABLE payments;--"}, false, []string{"next_renew"}},
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
	hugeSort := strings.Repeat("x", 5000)
	cases := []struct {
		name   string
		values map[string][]string
		want   ListQuery
	}{
		{
			name:   "默认值",
			values: map[string][]string{},
			want:   ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "page_size 超上限被夹紧",
			values: map[string][]string{"page_size": {"100000"}},
			want:   ListQuery{Page: 1, PageSize: MaxPageSize, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "sort 不在白名单则回退默认列",
			values: map[string][]string{"sort": {"(SELECT 1)"}},
			want:   ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "sort 白名单命中映射为真实列",
			values: map[string][]string{"sort": {"mrr"}, "dir": {"DESC"}},
			want:   ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: "s.mrr", Dir: "desc"},
		},
		{
			name:   "非法 status 被丢弃",
			values: map[string][]string{"status": {"active' OR '1'='1"}},
			want:   ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "合法 status 保留",
			values: map[string][]string{"status": {"past_due"}},
			want:   ListQuery{Status: StatusPastDue, Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "超长搜索串被截断到 rune 上限",
			values: map[string][]string{"q": {hugeSort}},
			want:   ListQuery{Search: strings.Repeat("x", MaxQueryRunes), Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "负数页码回退首页",
			values: map[string][]string{"page": {"-7"}},
			want:   ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
		{
			name:   "dir 非 desc 时保持 asc",
			values: map[string][]string{"dir": {"; DELETE FROM plans"}},
			want:   ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: "s.renew_at", Dir: "asc"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseListQuery(tc.values)
			if got.Status != tc.want.Status || got.Page != tc.want.Page || got.PageSize != tc.want.PageSize ||
				got.Sort != tc.want.Sort || got.Dir != tc.want.Dir || got.Search != tc.want.Search {
				t.Fatalf("got %+v want %+v", got, tc.want)
			}
			// 任何情况下进入 SQL 的列名与方向都只能是白名单产物
			allowed := false
			for _, col := range sortColumns {
				if got.Sort == col {
					allowed = true
				}
			}
			if !allowed {
				t.Fatalf("Sort 逃逸白名单：%q", got.Sort)
			}
			if got.Dir != "asc" && got.Dir != "desc" {
				t.Fatalf("Dir 逃逸白名单：%q", got.Dir)
			}
		})
	}
}
