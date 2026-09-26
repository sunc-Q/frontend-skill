package domain

import (
	"strings"
	"testing"
)

func TestCreateListingInputValidate(t *testing.T) {
	base := func(mut func(*CreateListingInput)) CreateListingInput {
		in := CreateListingInput{
			Code: "FS-2026-0001", Title: "富士 X-T30 机身带 27mm 镜头", Category: "photo",
			Seller: "xiaoyu", AskingCent: 420000, FloorCent: 360000, Condition: ConditionGood, Area: "徐汇·田林",
		}
		mut(&in)
		return in
	}
	cases := []struct {
		name     string
		in       CreateListingInput
		wantOK   bool
		wantKeys []string
	}{
		{"合法", base(func(*CreateListingInput) {}), true, nil},
		{"保底价 0 合法（愿意白送）", base(func(in *CreateListingInput) { in.FloorCent = 0 }), true, nil},
		{"编号过短", base(func(in *CreateListingInput) { in.Code = "FS" }), false, []string{"code"}},
		{"编号含注入字符（长度合规也要拒）", base(func(in *CreateListingInput) { in.Code = `FS";DROP--` }), false, []string{"code"}},
		{"编号含反斜杠", base(func(in *CreateListingInput) { in.Code = `FS-2026\0001` }), false, []string{"code"}},
		{"编号含空格", base(func(in *CreateListingInput) { in.Code = "FS 2026" }), false, []string{"code"}},
		{"编号非 UTF-8", base(func(in *CreateListingInput) { in.Code = "\xed\xa0\x80" }), false, []string{"code"}},
		{"标题过短", base(func(in *CreateListingInput) { in.Title = "镜头" }), false, []string{"title"}},
		{"标题超长", base(func(in *CreateListingInput) { in.Title = strings.Repeat("镜", 121) }), false, []string{"title"}},
		{"挂牌价为负", base(func(in *CreateListingInput) { in.AskingCent = -1 }), false, []string{"asking_cent"}},
		{"挂牌价越界", base(func(in *CreateListingInput) { in.AskingCent = 50_000_001 }), false, []string{"asking_cent"}},
		{"保底价高于挂牌价", base(func(in *CreateListingInput) { in.FloorCent = 420001 }), false, []string{"floor_cent"}},
		{"成色非法枚举", base(func(in *CreateListingInput) { in.Condition = "mint" }), false, []string{"condition"}},
		{"区域为空", base(func(in *CreateListingInput) { in.Area = "" }), false, []string{"area"}},
		{"多字段同时报错", base(func(in *CreateListingInput) {
			in.Code = "x"
			in.Title = ""
			in.AskingCent = 0
			in.Condition = ""
			in.Area = ""
		}), false, []string{"code", "title", "asking_cent", "condition", "area"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
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

func TestPlaceOfferInputValidate(t *testing.T) {
	base := func(mut func(*PlaceOfferInput)) PlaceOfferInput {
		in := PlaceOfferInput{Buyer: "ahuai_88", AmountCent: 398000, Message: "周末来自提可以吗"}
		mut(&in)
		return in
	}
	cases := []struct {
		name     string
		in       PlaceOfferInput
		wantOK   bool
		wantKeys []string
	}{
		{"合法", base(func(*PlaceOfferInput) {}), true, nil},
		{"无留言合法", base(func(in *PlaceOfferInput) { in.Message = "" }), true, nil},
		{"买家过短", base(func(in *PlaceOfferInput) { in.Buyer = "a" }), false, []string{"buyer"}},
		{"买家含注入字符", base(func(in *PlaceOfferInput) { in.Buyer = `a"--` }), false, []string{"buyer"}},
		{"买家含中文（按账号白名单拒绝）", base(func(in *PlaceOfferInput) { in.Buyer = "阿坏" }), false, []string{"buyer"}},
		{"出价低于 1 元", base(func(in *PlaceOfferInput) { in.AmountCent = 99 }), false, []string{"amount_cent"}},
		{"出价为负", base(func(in *PlaceOfferInput) { in.AmountCent = -5000 }), false, []string{"amount_cent"}},
		{"出价越界", base(func(in *PlaceOfferInput) { in.AmountCent = 50_000_001 }), false, []string{"amount_cent"}},
		{"留言超长", base(func(in *PlaceOfferInput) { in.Message = strings.Repeat("刀", 201) }), false, []string{"message"}},
		{"留言 200 字刚好合法", base(func(in *PlaceOfferInput) { in.Message = strings.Repeat("刀", 200) }), true, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v (errs=%v)", ok, tc.wantOK, errs)
			}
			for _, k := range tc.wantKeys {
				if _, has := errs[k]; !has {
					t.Errorf("缺少字段错误项 %q", k)
				}
			}
		})
	}
}

// 排序列与枚举的白名单测试：断言「进入 SQL 的列名一定带正确的表别名」，
// 别名指错会让所有分页 500（第 6 轮的教训），所以这里把别名本身钉死。
func TestQueryWhitelistMapsToRealAliases(t *testing.T) {
	listingCases := []struct{ key, want string }{
		{"posted", "l.posted_at"},
		{"asking", "l.asking_cent"},
		{"best", "l.best_offer_cent"},
		{"offers", "l.offer_count"},
		{"views", "l.views"},
		{"code", "l.code"},
		{"status", "l.status"},
		{"id", "l.id"},
	}
	for _, tc := range listingCases {
		q := ParseListQuery(map[string][]string{"sort": {tc.key}})
		if q.Sort != tc.want {
			t.Errorf("sort=%s 期望列 %q，实得 %q", tc.key, tc.want, q.Sort)
		}
	}
	offerCases := []struct{ key, want string }{
		{"placed", "o.placed_at"},
		{"amount", "o.amount_cent"},
		{"expires", "o.expires_at"},
		{"deal", "o.deal_no"},
		{"status", "o.status"},
		{"id", "o.id"},
	}
	for _, tc := range offerCases {
		q := ParseOfferQuery(map[string][]string{"sort": {tc.key}})
		if q.Sort != tc.want {
			t.Errorf("deal sort=%s 期望列 %q，实得 %q", tc.key, tc.want, q.Sort)
		}
	}
}

func TestParseListQueryClampsUntrustedInput(t *testing.T) {
	huge := strings.Repeat("x", 5000)
	defSort := "l.posted_at"
	cases := []struct {
		name   string
		values map[string][]string
		want   ListQuery
	}{
		{name: "默认值", values: map[string][]string{}, want: ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "page_size 超上限被夹紧", values: map[string][]string{"page_size": {"100000"}},
			want: ListQuery{Page: 1, PageSize: MaxPageSize, Sort: defSort, Dir: "desc"}},
		{name: "sort 不在白名单则回退默认列", values: map[string][]string{"sort": {"(SELECT 1)"}},
			want: ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "非法 status 被丢弃", values: map[string][]string{"status": {"available' OR '1'='1"}},
			want: ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "合法 status 保留", values: map[string][]string{"status": {"reserved"}},
			want: ListQuery{Status: ListingReserved, Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "超长搜索串按 rune 截断", values: map[string][]string{"q": {huge}},
			want: ListQuery{Search: strings.Repeat("x", MaxQueryRunes), Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "负数页码回退首页", values: map[string][]string{"page": {"-7"}},
			want: ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "dir 注入串保持默认", values: map[string][]string{"dir": {"; DELETE FROM listings"}},
			want: ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
		{name: "非法品类枚举不影响排序", values: map[string][]string{"category": {"photo; DROP TABLE offers"}},
			want: ListQuery{Page: 1, PageSize: DefaultPageSz, Sort: defSort, Dir: "desc"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseListQuery(tc.values)
			if got.Status != tc.want.Status || got.Page != tc.want.Page || got.PageSize != tc.want.PageSize ||
				got.Sort != tc.want.Sort || got.Dir != tc.want.Dir || got.Search != tc.want.Search {
				t.Fatalf("got %+v want %+v", got, tc.want)
			}
			allowed := false
			for _, col := range listingSortColumns {
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
			if got.PageSize < 1 || got.PageSize > MaxPageSize {
				t.Fatalf("PageSize 越界：%d", got.PageSize)
			}
		})
	}
	// 品类筛选带分号/空格时整体丢弃（长度合规也不行）
	q := ParseListQuery(map[string][]string{"category": {"pho'to"}})
	if q.Category != "" {
		t.Errorf("含引号的 category 应被丢弃，实得 %q", q.Category)
	}
	oq := ParseOfferQuery(map[string][]string{"status": {"pending) OR 1=1--"}})
	if oq.Status != "" {
		t.Errorf("含括号的 offer status 应被丢弃，实得 %q", oq.Status)
	}
}

func TestStatusEnums(t *testing.T) {
	for _, s := range []string{ListingAvailable, ListingReserved, ListingSold, ListingWithdrawn} {
		if !ValidListingStatus(s) {
			t.Errorf("%s 应为合法挂单状态", s)
		}
	}
	for _, s := range []string{OfferPending, OfferAccepted, OfferRejected, OfferOutbid, OfferExpired} {
		if !ValidOfferStatus(s) {
			t.Errorf("%s 应为合法出价状态", s)
		}
	}
	if ValidListingStatus("sold; DROP") || ValidOfferStatus("") || ValidCondition("mint") {
		t.Error("枚举校验放行非法值")
	}
}
