package domain_test

import (
	"strings"
	"testing"

	"bizsite/internal/domain"
)

const today = "2026-09-26" // 周六：与真实运行日无关，测试用的是注入的"今天"

// ---------- 日期 ----------

func TestDateHelpers(t *testing.T) {
	cases := []struct {
		name string
		got  any
		want any
	}{
		{"add-days-across-month", domain.AddDays("2026-01-31", 1), "2026-02-01"},
		{"add-days-negative", domain.AddDays("2026-03-01", -1), "2026-02-28"},
		{"leap-day", domain.AddDays("2028-02-28", 2), "2028-03-01"},
		{"days-between", domain.DaysBetween("2026-09-26", "2026-10-01"), 5},
		{"weekday-saturday", domain.WeekdayCN("2026-09-26"), "周六"},
		{"weekday-sunday", domain.WeekdayCN("2026-09-27"), "周日"},
		{"invalid-date-rejected", domain.ValidDate("2026-02-30"), false},
		{"slash-format-rejected", domain.ValidDate("2026/09/26"), false},
		{"weekend-friday", domain.IsWeekendNight("2026-09-25"), true},
		{"weekend-sunday", domain.IsWeekendNight("2026-09-27"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.got != c.want {
				t.Fatalf("got %v want %v", c.got, c.want)
			}
		})
	}
}

func TestEachNightExcludesCheckOut(t *testing.T) {
	nights := domain.EachNight("2026-09-26", "2026-09-29")
	want := []string{"2026-09-26", "2026-09-27", "2026-09-28"}
	if strings.Join(nights, ",") != strings.Join(want, ",") {
		t.Fatalf("逐夜口径错：离店日不计夜，got %v", nights)
	}
	if len(domain.EachNight("2026-09-26", "2026-09-26")) != 0 {
		t.Fatal("同日来回应是 0 晚")
	}
	if len(domain.EachNight("2026-09-27", "2026-09-26")) != 0 {
		t.Fatal("倒挂区间应是 0 晚")
	}
}

// ---------- 价格引擎 ----------

func testRoom() domain.RoomType {
	return domain.RoomType{Code: "T-DELUXE", PropertyCode: "T-A", Name: "测试房", Capacity: 2, Units: 2,
		BasePriceCents: 100000, WeekendPct: 25, HolidayPct: 60, CleanFeeCents: 12000,
		Status: domain.RoomActive, MinStayDefault: 1}
}

func testProp() domain.Property {
	return domain.Property{Code: "T-A", Name: "测试院", CleanBufferDays: 1, MinStayWeekend: 2}
}

func TestResolveNightPriority(t *testing.T) {
	rt, prop := testRoom(), testProp()
	cal := map[string]domain.RateDay{
		"global||2026-10-01":       {Date: "2026-10-01", Scope: "global", Kind: "holiday", HolidayPct: 50, Label: "国庆"},
		"property|T-A|2026-10-05":  {Date: "2026-10-05", Scope: "property", RefCode: "T-A", Kind: "closed", Label: "包场"},
		"room|T-DELUXE|2026-10-05": {Date: "2026-10-05", Scope: "room", RefCode: "T-DELUXE", Kind: "promo", PriceCents: 66000, Label: "特价"},
		"global||2026-10-10":       {Date: "2026-10-10", Scope: "global", Kind: "holiday", Label: "无倍率节假日"},
		"room|T-DELUXE|2026-10-11": {Date: "2026-10-11", Scope: "room", RefCode: "T-DELUXE", Kind: "closed", Label: "检修"},
	}
	cases := []struct {
		name      string
		date      string
		wantKind  string
		wantPrice int64
	}{
		{"平日基准价", "2026-10-08", domain.KindWeekday, 100000},
		{"周五走周末倍率", "2026-10-09", domain.KindWeekend, 125000},
		{"全局节假日覆盖周末", "2026-10-10", domain.KindHoliday, 160000}, // 无倍率时回落到房型 holiday_pct=60
		{"房型特价优先于整院停售", "2026-10-05", domain.KindPromo, 66000},
		{"房型停售优先于一切", "2026-10-11", domain.KindClosed, 0},
		{"国庆全局加价", "2026-10-01", domain.KindHoliday, 150000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			np := domain.ResolveNight(rt, c.date, cal)
			if np.Kind != c.wantKind {
				t.Fatalf("kind got %s want %s", np.Kind, c.wantKind)
			}
			if c.wantKind != domain.KindClosed && np.PriceCents != c.wantPrice {
				t.Fatalf("price got %d want %d", np.PriceCents, c.wantPrice)
			}
			if c.wantKind == domain.KindClosed && !strings.Contains(np.Label, "检修") && c.date == "2026-10-11" {
				t.Fatalf("停售要带原因，got %q", np.Label)
			}
		})
	}
	_ = prop
}

func TestApplyPctRoundsToTenCents(t *testing.T) {
	rt := testRoom()
	rt.BasePriceCents = 100037
	rt.WeekendPct = 25
	np := domain.ResolveNight(rt, "2026-10-09", map[string]domain.RateDay{})
	if np.PriceCents%10 != 0 {
		t.Fatalf("报价必须按 10 分取整，got %d", np.PriceCents)
	}
}

// ---------- 可订性判定：blockers 矩阵 ----------

func quoteWith(t *testing.T, stays []domain.Stay, checkIn, checkOut string, units, guests int, day string) *domain.QuoteResult {
	t.Helper()
	q := domain.BuildQuote(testRoom(), testProp(), map[string]domain.RateDay{},
		domain.QuoteInput{CheckIn: checkIn, CheckOut: checkOut, Units: units, Guests: guests}, day, stays)
	if q == nil {
		t.Fatal("nil quote")
	}
	return q
}

func TestBuildQuoteBlockers(t *testing.T) {
	closedCal := map[string]domain.RateDay{
		"room|T-DELUXE|2026-10-03": {Date: "2026-10-03", Scope: "room", RefCode: "T-DELUXE", Kind: "closed", Label: "检修"},
	}
	room, prop := testRoom(), testProp()
	q := domain.BuildQuote(room, prop, closedCal, domain.QuoteInput{
		CheckIn: "2026-10-02", CheckOut: "2026-10-04", Units: 1, Guests: 2}, "2026-10-01", nil)
	if q.Ok {
		t.Fatal("停售日必须被挡住")
	}
	if len(q.Blockers) != 1 || !strings.Contains(q.Blockers[0], "检修") {
		t.Fatalf("停售 blocker 要说清是哪天为什么，got %v", q.Blockers)
	}
	// 停售那一晚不计价，其余两晚照常出价（前台要能显示"改掉这一天就能订"）
	if len(q.NightsDetail) != 2 {
		t.Fatalf("逐夜明细应有 2 条可计价记录，got %d", len(q.NightsDetail))
	}

	cases := []struct {
		name     string
		stays    []domain.Stay
		checkIn  string
		checkOut string
		units    int
		guests   int
		day      string
		want     string
		wantOK   bool
	}{
		{"空档可订(平日单晚)", nil, "2026-10-06", "2026-10-07", 1, 2, "2026-10-01", "", true},
		{"超库存", []domain.Stay{{Code: "A1", RoomCode: "T-DELUXE", CheckIn: "2026-10-02", CheckOut: "2026-10-04", Units: 2}},
			"2026-10-02", "2026-10-03", 1, 2, "2026-10-01", "仅剩 0 间", false},
		{"退房日可复住(缓冲1天)", []domain.Stay{{Code: "A1", RoomCode: "T-DELUXE", CheckIn: "2026-10-03", CheckOut: "2026-10-04", Units: 2}},
			"2026-10-05", "2026-10-06", 2, 4, "2026-10-01", "", true},
		{"清洁缓冲不足", []domain.Stay{{Code: "A1", RoomCode: "T-DELUXE", CheckIn: "2026-10-01", CheckOut: "2026-10-02", Units: 2}},
			"2026-10-02", "2026-10-04", 2, 4, "2026-10-01", "退房，后需留 1 天清洁", false},
		{"缓冲也管后面", []domain.Stay{{Code: "A2", RoomCode: "T-DELUXE", CheckIn: "2026-10-05", CheckOut: "2026-10-06", Units: 1}},
			"2026-10-03", "2026-10-05", 1, 2, "2026-10-01", "中间不足 1 天清洁缓冲", false},
		{"别的房型不占库存", []domain.Stay{{Code: "A3", RoomCode: "T-OTHER", CheckIn: "2026-10-06", CheckOut: "2026-10-08", Units: 9}},
			"2026-10-06", "2026-10-07", 2, 4, "2026-10-01", "", true},
		{"超员", nil, "2026-10-02", "2026-10-03", 1, 5, "2026-10-01", "最多住 2 人", false},
		{"过去的入住日", nil, "2026-09-20", "2026-09-21", 1, 2, "2026-10-01", "不能早于今天", false},
		{"倒挂区间", nil, "2026-10-05", "2026-10-03", 1, 2, "2026-10-01", "必须晚于入住日", false},
		{"非法日期", nil, "2026-13-45", "2026-10-03", 1, 2, "2026-10-01", "YYYY-MM-DD", false},
		{"超长区间", nil, "2026-10-02", "2027-01-01", 1, 2, "2026-10-01", "最长 30 晚", false},
		{"周六入住需连住2晚", nil, "2026-10-03", "2026-10-04", 1, 2, "2026-10-01", "需连住 2 晚", false},
		{"周六入住连住2晚通过", nil, "2026-10-03", "2026-10-05", 1, 2, "2026-10-01", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := quoteWith(t, c.stays, c.checkIn, c.checkOut, c.units, c.guests, c.day)
			if got.Ok != c.wantOK {
				t.Fatalf("ok got %v want %v blockers=%v", got.Ok, c.wantOK, got.Blockers)
			}
			if c.want == "" {
				return
			}
			joined := strings.Join(got.Blockers, " | ")
			if !strings.Contains(joined, c.want) {
				t.Fatalf("blocker 缺关键词 %q，got %v", c.want, got.Blockers)
			}
		})
	}
}

func TestQuoteMoneyIdentity(t *testing.T) {
	q := quoteWith(t, nil, "2026-10-02", "2026-10-06", 2, 4, "2026-10-01")
	if !q.Ok {
		t.Fatalf("应可订，got %v", q.Blockers)
	}
	var sum int64
	for _, n := range q.NightsDetail {
		if n.AmountCents != n.PriceCents*int64(n.Units) {
			t.Fatalf("单晚金额错：%s %d != %d×%d", n.Date, n.AmountCents, n.PriceCents, n.Units)
		}
		sum += n.AmountCents
	}
	if sum != q.NightSubtotal {
		t.Fatalf("Σ逐夜 != 房费小计：%d != %d", sum, q.NightSubtotal)
	}
	if q.TotalCents != q.NightSubtotal+q.CleanFeeCents {
		t.Fatalf("总额 != 房费+清洁费")
	}
	if q.RoomNights != 8 || q.AvgNightCents != q.NightSubtotal/8 {
		t.Fatalf("ADR 口径错：room_nights=%d avg=%d", q.RoomNights, q.AvgNightCents)
	}
	// 2026-10-02/03/04 是周五六日：前两晚按周末倍率，周日回到平日
	kinds := map[string]string{}
	for _, n := range q.NightsDetail {
		kinds[n.Date] = n.Kind
	}
	if kinds["2026-10-02"] != domain.KindWeekend || kinds["2026-10-04"] != domain.KindWeekday {
		t.Fatalf("周末倍率的晚别判错：%v", kinds)
	}
}

func TestQuoteBlockersCollectAllNights(t *testing.T) {
	// 三晚里有两晚超库存：blockers 必须逐晚列出，而不是遇到第一个就返回
	stays := []domain.Stay{
		{Code: "A", RoomCode: "T-DELUXE", CheckIn: "2026-10-02", CheckOut: "2026-10-03", Units: 2},
		{Code: "B", RoomCode: "T-DELUXE", CheckIn: "2026-10-04", CheckOut: "2026-10-05", Units: 2},
	}
	q := quoteWith(t, stays, "2026-10-02", "2026-10-05", 1, 2, "2026-10-01")
	if q.Ok {
		t.Fatal("超库存应被挡")
	}
	if len(q.Blockers) != 2 {
		t.Fatalf("要逐晚给原因，got %v", q.Blockers)
	}
}

// ---------- 状态机 ----------

func TestBookingStateMachineMatrix(t *testing.T) {
	all := domain.BookingStatuses()
	want := map[string]map[string]bool{}
	for _, from := range all {
		want[from] = map[string]bool{}
		for _, to := range all {
			want[from][to] = false
		}
	}
	want[domain.StPending][domain.StConfirmed] = true
	want[domain.StPending][domain.StCheckedIn] = true
	want[domain.StPending][domain.StCancelled] = true
	want[domain.StConfirmed][domain.StCheckedIn] = true
	want[domain.StConfirmed][domain.StCheckedOut] = true
	want[domain.StConfirmed][domain.StCancelled] = true
	want[domain.StConfirmed][domain.StNoShow] = true
	want[domain.StCheckedIn][domain.StCheckedOut] = true
	want[domain.StCheckedIn][domain.StNoShow] = true
	for _, from := range all {
		for _, to := range all {
			if got := domain.CanTransit(from, to); got != want[from][to] {
				t.Errorf("CanTransit(%s,%s)=%v want %v", from, to, got, want[from][to])
			}
		}
	}
	if domain.ValidBookingStatus("drop table") {
		t.Fatal("非法状态必须被拒")
	}
}

func TestHoldAndRevenueStatusesAreDistinct(t *testing.T) {
	// no_show 计钱但不占房；pending 占房但不计钱——两套口径必须能同时表达
	if !domain.HoldsRoom(domain.StPending) || domain.CountsRevenue(domain.StPending) {
		t.Fatal("pending：占房不计数")
	}
	if domain.HoldsRoom(domain.StNoShow) || !domain.CountsRevenue(domain.StNoShow) {
		t.Fatal("no_show：计数不占房")
	}
	if domain.HoldsRoom(domain.StCheckedOut) || !domain.CountsRevenue(domain.StCheckedOut) {
		t.Fatal("checked_out：计数不占房")
	}
}

// ---------- 退款阶梯 ----------

func TestRefundLadder(t *testing.T) {
	base := func(status, checkIn string) *domain.Booking {
		return &domain.Booking{Status: status, CheckIn: checkIn, TotalCents: 100000, CleanFeeCents: 12000}
	}
	cases := []struct {
		name    string
		b       *domain.Booking
		today   string
		want    int64
		wantMsg string
	}{
		{"未确认全退", base(domain.StPending, "2026-10-20"), "2026-10-01", 88000, "全额"},
		{"7天前全退", base(domain.StConfirmed, "2026-10-08"), "2026-10-01", 88000, "全额"},
		{"6天前退五成", base(domain.StConfirmed, "2026-10-07"), "2026-10-01", 44000, "五成"},
		{"3天前退五成", base(domain.StConfirmed, "2026-10-04"), "2026-10-01", 44000, "五成"},
		{"2天前不退", base(domain.StConfirmed, "2026-10-03"), "2026-10-01", 0, "不退"},
		{"当天不退", base(domain.StConfirmed, "2026-10-01"), "2026-10-01", 0, "不退"},
		{"已入住不再退", base(domain.StCheckedIn, "2026-10-01"), "2026-10-01", 0, "已离开可取消阶段"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, msg := domain.RefundFor(c.b, c.today)
			if got != c.want {
				t.Fatalf("退款 got %d want %d", got, c.want)
			}
			if !strings.Contains(msg, c.wantMsg) {
				t.Fatalf("退款文案缺 %q，got %q", c.wantMsg, msg)
			}
			if got > c.b.TotalCents-c.b.CleanFeeCents {
				t.Fatal("退款不得超过房费本金")
			}
		})
	}
}

// ---------- 输入校验（字段矩阵）----------

func TestBookingInputValidation(t *testing.T) {
	good := func() domain.BookingInput {
		return domain.BookingInput{CheckIn: "2026-10-02", CheckOut: "2026-10-03", Units: 1, Guests: 2,
			GuestName: "张三", Phone: "13800001111", Channel: domain.ChDirect}
	}
	cases := []struct {
		name  string
		mut   func(*domain.BookingInput)
		field string
	}{
		{"缺入住日", func(i *domain.BookingInput) { i.CheckIn = "" }, "check_in"},
		{"入住日格式错", func(i *domain.BookingInput) { i.CheckIn = "2026/10/02" }, "check_in"},
		{"离店早于入住", func(i *domain.BookingInput) { i.CheckOut = "2026-10-01" }, "check_out"},
		{"间数为零", func(i *domain.BookingInput) { i.Units = 0 }, "units"},
		{"间数超上限", func(i *domain.BookingInput) { i.Units = 99 }, "units"},
		{"人数为零", func(i *domain.BookingInput) { i.Guests = 0 }, "guests"},
		{"姓名为空", func(i *domain.BookingInput) { i.GuestName = "   " }, "guest_name"},
		{"姓名超长", func(i *domain.BookingInput) { i.GuestName = strings.Repeat("客", 21) }, "guest_name"},
		{"手机号带引号注入", func(i *domain.BookingInput) { i.Phone = `138" OR 1=1--` }, "phone"},
		{"手机号位数不足", func(i *domain.BookingInput) { i.Phone = "1380000111" }, "phone"},
		{"手机号首位非法", func(i *domain.BookingInput) { i.Phone = "12800001111" }, "phone"},
		{"手机号带分号", func(i *domain.BookingInput) { i.Phone = "1380000111;" }, "phone"},
		{"渠道不在白名单", func(i *domain.BookingInput) { i.Channel = "wechat'--" }, "channel"},
		{"渠道缺失", func(i *domain.BookingInput) { i.Channel = "" }, "channel"},
		{"备注超长", func(i *domain.BookingInput) { i.Note = strings.Repeat("长", 61) }, "note"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := good()
			c.mut(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatalf("本该校验失败：%+v", in)
			}
			if _, hit := errs[c.field]; !hit {
				t.Fatalf("字段 %s 未回显错误，got %v", c.field, errs)
			}
		})
	}
	t.Run("合法输入通过", func(t *testing.T) {
		if errs, ok := good().Validate(); !ok {
			t.Fatalf("合法输入被拒：%v", errs)
		}
	})
}

func TestMaskPhone(t *testing.T) {
	cases := []struct{ in, want string }{
		{"13800001111", "138****1111"},
		{"138 0000 1111", "***"},
		{"", "***"},
		{"'; DROP", "***"},
	}
	for _, c := range cases {
		if got := domain.MaskPhone(c.in); got != c.want {
			t.Errorf("MaskPhone(%q)=%q want %q", c.in, got, c.want)
		}
	}
}

func TestStatusAndClosureInput(t *testing.T) {
	if _, ok := (domain.StatusInput{To: "checked_out"}).Validate(); !ok {
		t.Fatal("合法状态跳转目标应通过")
	}
	if errs, ok := (domain.StatusInput{To: "DROP TABLE"}).Validate(); ok {
		t.Fatal("非法状态目标必须被拒")
	} else if _, hit := errs["to"]; !hit {
		t.Fatalf("to 字段未回显：%v", errs)
	}
	if _, ok := (domain.ClosureInput{Date: "2026-10-01"}).Validate(); !ok {
		t.Fatal("合法停售日期应通过")
	}
	if errs, ok := (domain.ClosureInput{Date: "x", Label: strings.Repeat("包", 21)}).Validate(); ok {
		t.Fatal("非法日期/超长标签必须被拒")
	} else if len(errs) != 2 {
		t.Fatalf("两个字段都该回显，got %v", errs)
	}
}

// ---------- 查询收敛 ----------

func TestQueryConvergence(t *testing.T) {
	v := func(kv ...string) map[string][]string {
		m := map[string][]string{}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i]] = []string{kv[i+1]}
		}
		return m
	}
	bq := domain.ParseBookingQuery(v("page_size", "99999", "page", "-3", "sort", "b.id; DROP", "dir", "sideways", "status", "nope"))
	if bq.PageSize != domain.MaxPageSize {
		t.Fatalf("page_size 未钳制：%d", bq.PageSize)
	}
	if bq.Page != 1 {
		t.Fatalf("非法页码应收敛到 1：%d", bq.Page)
	}
	if bq.SortKey() != "check_in" {
		t.Fatalf("非法排序键应收敛到默认列：%s", bq.SortKey())
	}
	if bq.Dir != "desc" {
		t.Fatalf("dir 默认 desc：%s", bq.Dir)
	}
	if bq.Status != "" {
		t.Fatalf("非法状态过滤应被忽略：%s", bq.Status)
	}
	rq := domain.ParseRoomQuery(v("sort", "revenue", "dir", "asc", "breakfast", "yes", "property", "MH-LG"))
	if rq.SortKey() != "revenue_cents" || rq.Dir != "asc" || rq.Breakfast != "yes" || rq.Property != "MH-LG" {
		t.Fatalf("房型列表参数收敛错：%+v", rq)
	}
	if got := domain.ParseRoomQuery(v("property", "'; DROP TABLE room_types; --")).Property; got != "" {
		t.Fatalf("编码白名单没挡住注入：%q", got)
	}
	long := domain.ParseBookingQuery(v("q", strings.Repeat("客", 100)))
	if domain.RuneCount(long.Search) != domain.MaxQueryRunes {
		t.Fatalf("搜索串未按 rune 截断：%d", domain.RuneCount(long.Search))
	}
}

func TestLikeEscapedNeutralisesWildcards(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"张三", "%张三%"},
		{"50%", "%50\\%%"},
		{"a_b", "%a\\_b%"},
		{`a\b`, "%a\\\\b%"},
		{"", "%%"},
	}
	for _, c := range cases {
		if got := domain.LikeEscaped(c.in); got != c.want {
			t.Errorf("LikeEscaped(%q)=%q want %q", c.in, got, c.want)
		}
	}
}

func TestSortWhitelistValuesAreRealColumns(t *testing.T) {
	// 排序白名单的值会被原样拼进 ORDER BY：这里断言每个值都是"表别名.真实列"或查询别名，
	// 且不含空格/分号/括号——第 6 轮的 sc.score 教训（白名单里藏了个不存在的列 → 整页 500）。
	for name, m := range map[string]map[string]string{"booking": domain.BookingSorts(), "room": domain.RoomSorts()} {
		for key, col := range m {
			if strings.ContainsAny(col, " ;()'\"") {
				t.Fatalf("%s 排序键 %s 的值不是干净列名：%q", name, key, col)
			}
		}
	}
	for _, bad := range []string{"sc.score", "1; DROP TABLE bookings", ""} {
		if got := domain.BookingSortSQL(bad); got != "b.check_in" {
			t.Fatalf("BookingSortSQL(%q)=%q 应回落到默认列", bad, got)
		}
	}
	if got := domain.RoomSortSQL("rt.units"); got != "rt.units" {
		t.Fatalf("合法排序键被改写：%q", got)
	}
}

func TestDateRangeClamp(t *testing.T) {
	from, days := domain.DateRange(today, "2026-12-31", 999, 28)
	if from != "2026-12-31" || days != 90 {
		t.Fatalf("days 未钳到 90：%s %d", from, days)
	}
	from, days = domain.DateRange(today, "not-a-date", 0, 28)
	if from != today || days != 28 {
		t.Fatalf("非法 from 未回落默认：%s %d", from, days)
	}
}
