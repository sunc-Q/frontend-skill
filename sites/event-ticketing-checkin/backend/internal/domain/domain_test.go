package domain

import (
	"strings"
	"testing"
	"time"
)

// 本文件覆盖「口径级」纯函数：计价、早鸟、核销窗口、退票资格、状态机、脱敏、查询收敛。
// 这些判定一旦漂移，页面上的金额与闸口状态就会与库里不一致，所以每条边都单独钉住。

func TestUnitAtAndTotals(t *testing.T) {
	cases := []struct {
		name    string
		base    int64
		service int64
		bps     int
		live    bool
		qty     int64
		want    Totals
	}{
		{"无早鸟", 48000, 600, 0, false, 2, Totals{UnitCent: 48000, Quantity: 2, SubtotalCent: 96000, FeeCent: 1200, PayableCent: 97200, DiscountBps: 0}},
		{"早鸟立减12%", 68000, 800, 1200, true, 3, Totals{UnitCent: 59840, Quantity: 3, SubtotalCent: 179520, FeeCent: 2400, PayableCent: 181920, DiscountBps: 1200}},
		{"截止后不再立减", 68000, 800, 1200, false, 1, Totals{UnitCent: 68000, Quantity: 1, SubtotalCent: 68000, FeeCent: 800, PayableCent: 68800, DiscountBps: 0}},
		{"零价工作票", 0, 0, 5000, true, 4, Totals{UnitCent: 0, Quantity: 4, SubtotalCent: 0, FeeCent: 0, PayableCent: 0, DiscountBps: 5000}},
		{"立减超过万分比按全额封", 10000, 300, 25000, true, 1, Totals{UnitCent: 0, Quantity: 1, SubtotalCent: 0, FeeCent: 300, PayableCent: 300, DiscountBps: 10000}},
		{"分位向下取整（让利只会少收，不会多收）", 9999, 500, 333, true, 1, Totals{UnitCent: 9666, Quantity: 1, SubtotalCent: 9666, FeeCent: 500, PayableCent: 10166, DiscountBps: 333}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := TotalsFor(tc.base, tc.service, tc.bps, tc.live, tc.qty)
			if got != tc.want {
				t.Fatalf("TotalsFor = %+v, 期望 %+v", got, tc.want)
			}
			// 恒等式：实付 = 票面小计 + 服务费小计。
			if got.PayableCent != got.SubtotalCent+got.FeeCent {
				t.Fatalf("金额不配平：%+v", got)
			}
			if got.SubtotalCent != got.UnitCent*got.Quantity {
				t.Fatalf("票面小计 ≠ 单价×张数：%+v", got)
			}
		})
	}
}

func TestEarlyDiscountBps(t *testing.T) {
	now := time.Date(2026, 9, 26, 10, 0, 0, 0, time.UTC)
	open := now.Add(-2 * time.Hour)
	cases := []struct {
		name       string
		earlyBps   int
		presaleEnd time.Time
		want       int
	}{
		{"截止未过按立减", 1200, now.Add(24 * time.Hour), 1200},
		{"刚过截止归零", 1200, now.Add(-time.Second), 0},
		{"恰好等于截止即归零", 1200, now, 0},
		{"票档不参与早鸟", 0, now.Add(time.Hour), 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tt := &TicketType{EarlyBps: tc.earlyBps}
			e := &Event{PresaleEnd: tc.presaleEnd, OnSaleAt: open}
			if got := EarlyDiscountBps(tt, e, now); got != tc.want {
				t.Fatalf("EarlyDiscountBps = %d, 期望 %d", got, tc.want)
			}
		})
	}
}

func TestWindowFor(t *testing.T) {
	doors := time.Date(2026, 9, 26, 19, 0, 0, 0, time.UTC)
	start := doors.Add(45 * time.Minute)
	cases := []struct {
		name      string
		status    string
		now       time.Time
		wantAllow bool
		wantCode  string
	}{
		{"开门前半小时起可入场", EventOnSale, doors.Add(-30 * time.Minute), true, "open"},
		{"再早一分钟还不行", EventOnSale, doors.Add(-31 * time.Minute), false, "doors_not_open"},
		{"开演中允许", EventOnSale, start.Add(time.Hour), true, "open"},
		{"宽限最后一分钟", EventOnSale, start.Add(240 * time.Minute), true, "open"},
		{"超过宽限关闸", EventOnSale, start.Add(241 * time.Minute), false, "gate_shut"},
		{"草稿未开票", EventDraft, doors, false, "not_on_sale"},
		{"已散场", EventClosed, doors, false, "event_closed"},
		{"已取消", EventCanceld, doors, false, "event_cancelled"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := WindowFor(tc.status, doors, start, tc.now)
			if v.Allowed != tc.wantAllow || v.Code != tc.wantCode {
				t.Fatalf("WindowFor = %+v, 期望 allowed=%t code=%s", v, tc.wantAllow, tc.wantCode)
			}
			if !v.Allowed && v.Message == "" {
				t.Fatal("拒绝必须有对外文案")
			}
		})
	}
}

func TestTicketVerdictAndGate(t *testing.T) {
	usedAt := time.Date(2026, 9, 26, 19, 5, 0, 0, time.UTC)
	open := CheckinVerdict{Allowed: true, Code: "open", Message: "可以检票入场"}
	cases := []struct {
		name     string
		ticket   Ticket
		window   CheckinVerdict
		wantCode string
		allow    bool
	}{
		{"在效票放行", Ticket{Status: TicketValid}, open, "open", true},
		{"重复核销拦截", Ticket{Status: TicketUsed, Gate: "A"}, open, "already_used", false},
		{"已退票拦截", Ticket{Status: TicketVoid}, open, "ticket_void", false},
		{"窗口不过时票态不再判断", Ticket{Status: TicketUsed}, CheckinVerdict{Code: "gate_shut"}, "gate_shut", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tk := tc.ticket
			v := TicketVerdict(&tk, tc.window)
			if v.Allowed != tc.allow || v.Code != tc.wantCode {
				t.Fatalf("TicketVerdict = %+v", v)
			}
		})
	}
	_ = usedAt

	gates := GateList("A, B,VIP")
	if len(gates) != 3 || gates[0] != "A" || gates[1] != "B" || gates[2] != "VIP" {
		t.Fatalf("GateList = %#v", gates)
	}
	gcases := []struct {
		name string
		gate string
		ok   bool
		code string
	}{
		{"精确命中", "VIP", true, "gate_ok"},
		{"大小写不敏感", "vip", true, "gate_ok"},
		{"带空格", " A ", true, "gate_ok"},
		{"缺闸口", "", false, "gate_required"},
		{"不存在的闸口", "C", false, "gate_unknown"},
	}
	for _, tc := range gcases {
		t.Run(tc.name, func(t *testing.T) {
			v := GateVerdict(gates, tc.gate)
			if v.Allowed != tc.ok || v.Code != tc.code {
				t.Fatalf("GateVerdict(%q) = %+v", tc.gate, v)
			}
		})
	}
}

func TestRefundVerdict(t *testing.T) {
	start := time.Date(2026, 10, 1, 20, 0, 0, 0, time.UTC)
	now := start.Add(-48 * time.Hour)
	e := &Event{Status: EventOnSale, StartAt: start, RefundCutH: 24}
	paid := &Order{
		Status: OrderPaid, Quantity: 3, UnitCent: 20000, ServiceCent: 600,
		SubtotalCent: 60000, FeeCent: 1800, PayableCent: 61800,
	}
	t.Run("正常整单退：退票面、留服务费", func(t *testing.T) {
		v, refund := RefundVerdict(paid, e, 0, 0, now)
		if !v.Allowed || v.Code != "refundable" {
			t.Fatalf("verdict = %+v", v)
		}
		if refund != 60000 {
			t.Fatalf("可退 = %d, 期望 60000（服务费不退）", refund)
		}
		if refund+(paid.PayableCent-refund) != paid.PayableCent {
			t.Fatal("退款拆分不配平")
		}
	})
	cases := []struct {
		name     string
		order    *Order
		used     int64
		void     int64
		now      time.Time
		cutoffH  int
		wantCode string
	}{
		{"已退票", &Order{Status: OrderRefunded}, 0, 3, now, 24, "already_refunded"},
		{"未支付作废单", &Order{Status: OrderCancelled}, 0, 0, now, 24, "order_cancelled"},
		{"有人已进场不许退", paid, 1, 0, now, 24, "partially_used"},
		{"已有作废记录", paid, 0, 1, now, 24, "partially_void"},
		{"过截止", paid, 0, 0, start.Add(-23 * time.Hour), 24, "past_cutoff"},
		{"恰好卡在截止此刻", paid, 0, 0, start.Add(-24 * time.Hour), 24, "past_cutoff"},
		{"非法截止值夹到最小 2 小时", paid, 0, 0, start.Add(-time.Hour), 0, "past_cutoff"},
		{"夹到最小后仍可退", paid, 0, 0, start.Add(-3 * time.Hour), 0, "refundable"},
		// 这两条成对出现才证明「上限夹到 72 小时」真的生效：
		// 若不夹（按 200 小时算），两条都会是 refundable。
		{"早于 72 小时上限仍可退", paid, 0, 0, start.Add(-80 * time.Hour), 200, "refundable"},
		{"夹到 72 小时后此刻不可退", paid, 0, 0, start.Add(-70 * time.Hour), 200, "past_cutoff"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev := &Event{Status: EventOnSale, StartAt: start, RefundCutH: tc.cutoffH}
			v, _ := RefundVerdict(tc.order, ev, tc.used, tc.void, tc.now)
			if v.Code != tc.wantCode {
				t.Fatalf("code = %s, 期望 %s（%+v）", v.Code, tc.wantCode, v)
			}
		})
	}
}

func TestNextEventStatus(t *testing.T) {
	edges := []struct {
		from, to string
		ok       bool
	}{
		{EventDraft, EventOnSale, true},
		{EventDraft, EventCanceld, true},
		{EventDraft, EventClosed, false},
		{EventDraft, EventDraft, false},
		{EventOnSale, EventClosed, true},
		{EventOnSale, EventCanceld, true},
		{EventOnSale, EventDraft, false},
		{EventClosed, EventOnSale, false},
		{EventCanceld, EventOnSale, false},
		{"bogus", EventOnSale, false},
	}
	for _, e := range edges {
		if got := NextEventStatus(e.from, e.to); got != e.ok {
			t.Fatalf("%s → %s = %t, 期望 %t", e.from, e.to, got, e.ok)
		}
	}
}

func TestSeatLabelAndMasks(t *testing.T) {
	cases := []struct {
		name   string
		zone   string
		seated bool
		seq    int64
		row    string
		no     string
	}{
		{"第一张坐一区一座", "池座", true, 1, "1", "1"},
		{"每排十二座换排", "池座", true, 13, "2", "1"},
		{"排内序号", "看台", true, 30, "3", "6"},
		{"站席不排座", "站席", false, 7, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			zone, row, no := SeatLabel(tc.zone, tc.seated, tc.seq, SeatsPerRow)
			if zone != tc.zone || row != tc.row || no != tc.no {
				t.Fatalf("SeatLabel = %q/%q/%q, 期望 %q/%q/%q", zone, row, no, tc.zone, tc.row, tc.no)
			}
		})
	}
	seated := Ticket{SeatZone: "池座", SeatRow: "2", SeatNo: "1"}
	if got := seated.SeatText(); got != "池座区 2排1号" {
		t.Fatalf("SeatText = %q", got)
	}
	stand := Ticket{SeatZone: "站席"}
	if got := stand.SeatText(); got != "自由入场" {
		t.Fatalf("站席 SeatText = %q", got)
	}
	mcases := []struct {
		in   string
		want string
	}{
		{"13800001111", "138****1111"},
		{"138 0000-1111", "138****1111"},
		{"123456", ""},
		{"", ""},
		{"1380000111", ""},
	}
	for _, tc := range mcases {
		if got := PhoneMasked(tc.in); got != tc.want {
			t.Fatalf("PhoneMasked(%q) = %q, 期望 %q", tc.in, got, tc.want)
		}
	}
	for _, tc := range []struct {
		in   string
		want bool
	}{
		{"13800001111", true},
		{"19912345678", true},
		{"1380000111a", false},
		{"138000011111", false},
		{"1380000111", false},
		{"23800001111", false}, // 首位不是 1：拨不通的号不能进台账
		{"12800001111", false}, // 次位不在 3-9 号段
		{"", false},
		{"138 0000 1111", false},
	} {
		if got := ValidPhone(tc.in); got != tc.want {
			t.Fatalf("ValidPhone(%q) = %t, 期望 %t", tc.in, got, tc.want)
		}
	}
}

func TestCodeAllowedRejectsInjection(t *testing.T) {
	bad := []string{`a" OR "1"="1`, `x'; DROP TABLE orders;--`, "票-01", "a b", "TK1\n", "a`b", `a\b`}
	for _, s := range bad {
		if CodeAllowed(s) {
			t.Fatalf("CodeAllowed(%q) 应为 false", s)
		}
	}
	for _, s := range []string{"ET260926-001", "TT261001A1", "GATE_A-1", "VIP"} {
		if !CodeAllowed(s) {
			t.Fatalf("CodeAllowed(%q) 应为 true", s)
		}
	}
}

func TestInputValidateBoundaries(t *testing.T) {
	base := CreateEventInput{
		Code: "ET261101A", Title: "冬日室内乐专场", Artist: "北岸弦乐四重奏", Category: "concert",
		Venue: "城市音乐厅 · 大厅", City: "上海", Gates: "A,B,VIP",
		DoorsAt: "2026-11-01T19:00:00Z", StartAt: "2026-11-01T19:30:00Z",
		PresaleEnd: "2026-10-20T23:59:59Z", RefundCutHours: 24,
	}
	if errs, ok := base.Validate(); !ok {
		t.Fatalf("合法输入被拒：%v", errs)
	}
	cases := []struct {
		name   string
		mutate func(*CreateEventInput)
		field  string
	}{
		{"编号过短", func(i *CreateEventInput) { i.Code = "ET1" }, "code"},
		{"编号含注入", func(i *CreateEventInput) { i.Code = `ET"OR"1` }, "code"},
		{"标题超长", func(i *CreateEventInput) { i.Title = strings.Repeat("声", 200) }, "title"},
		{"开演早于开门", func(i *CreateEventInput) { i.StartAt = "2026-11-01T18:00:00Z" }, "start_at"},
		{"时间格式非法", func(i *CreateEventInput) { i.DoorsAt = "2026/11/01 19:00" }, "doors_at"},
		{"类型非法", func(i *CreateEventInput) { i.Category = "opera" }, "category"},
		{"无闸口", func(i *CreateEventInput) { i.Gates = " , " }, "gates"},
		{"闸口含非法字符", func(i *CreateEventInput) { i.Gates = "A,B';" }, "gates"},
		{"退票窗口越界", func(i *CreateEventInput) { i.RefundCutHours = 200 }, "refund_cutoff_hours"},
		{"早鸟截止晚于开门", func(i *CreateEventInput) { i.PresaleEnd = "2026-11-01T19:10:00Z" }, "presale_end"},
		{"备注超长", func(i *CreateEventInput) { i.Note = strings.Repeat("说", 210) }, "note"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := base
			tc.mutate(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatalf("非法输入被放行（%s）", tc.field)
			}
			if _, hit := errs[tc.field]; !hit {
				t.Fatalf("错误字段 = %v, 期望含 %s", errs, tc.field)
			}
		})
	}

	sale := SaleInput{EventCode: "ET261101A", TypeCode: "TT261101A1", Quantity: 2, Buyer: "chen_wei", Phone: "13800001111", Channel: "web"}
	if errs, ok := sale.Validate(); !ok {
		t.Fatalf("合法出票被拒：%v", errs)
	}
	saleCases := []struct {
		name   string
		mutate func(*SaleInput)
		field  string
	}{
		{"张数为 0", func(i *SaleInput) { i.Quantity = 0 }, "quantity"},
		{"超过 6 张", func(i *SaleInput) { i.Quantity = OrderQtyMax + 1 }, "quantity"},
		{"手机号 10 位", func(i *SaleInput) { i.Phone = "1380000111" }, "phone"},
		{"手机号含符号", func(i *SaleInput) { i.Phone = "138-0000-1111" }, "phone"},
		{"渠道非法", func(i *SaleInput) { i.Channel = "telegram" }, "channel"},
		{"票档编号注入", func(i *SaleInput) { i.TypeCode = "TT'--" }, "type_code"},
		{"购票人过短", func(i *SaleInput) { i.Buyer = "c" }, "buyer"},
	}
	for _, tc := range saleCases {
		t.Run(tc.name, func(t *testing.T) {
			in := sale
			tc.mutate(&in)
			errs, ok := in.Validate()
			if ok || errs[tc.field] == "" {
				t.Fatalf("出票校验漏掉了 %s：%v", tc.field, errs)
			}
		})
	}

	if _, ok := (CheckinInput{Gate: "A; DROP"}).Validate(); ok {
		t.Fatal("非法闸口标识应被拒")
	}
	if _, ok := (CheckinInput{Gate: ""}).Validate(); ok {
		t.Fatal("缺闸口应被拒")
	}
	if errs, ok := (RefundInput{Reason: "改"}).Validate(); ok || errs["reason"] == "" {
		t.Fatalf("退票原因过短应被拒：%v", errs)
	}
	if _, ok := (RefundInput{Reason: "行程变更"}).Validate(); !ok {
		t.Fatal("合法退票原因被拒")
	}
}

func TestQueryParsingIsWhitelistAndClamped(t *testing.T) {
	values := func(kv ...string) map[string][]string {
		m := map[string][]string{}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i]] = []string{kv[i+1]}
		}
		return m
	}
	q := ParseEventQuery(values("sort", "gross; DROP TABLE orders", "dir", "ASC", "status", "bogus",
		"page", "-3", "page_size", "99999", "q", strings.Repeat("声", 200)))
	if q.SortCol != eventSortColumns["doors"] {
		t.Fatalf("非法排序键没有回落到默认列：%s", q.SortCol)
	}
	if q.Sort != "doors" {
		t.Fatalf("回显的排序键 = %q, 期望 doors", q.Sort)
	}
	if strings.Contains(q.Sort, ".") || strings.Contains(q.SortCol, ";") {
		t.Fatalf("排序字段形态异常：%s / %s", q.Sort, q.SortCol)
	}
	if q.Dir != "asc" {
		t.Fatalf("dir = %q", q.Dir)
	}
	if q.Status != "" {
		t.Fatalf("非法枚举没有丢弃：%q", q.Status)
	}
	if q.Page != 1 || q.PageSize != MaxPageSize {
		t.Fatalf("分页未夹紧：page=%d size=%d", q.Page, q.PageSize)
	}
	if len([]rune(q.Search)) != MaxQueryRunes {
		t.Fatalf("搜索串未截断：%d", len([]rune(q.Search)))
	}
	// 合法排序键必须逐个可用（第 6 轮的整页 500 就是这么漏掉的）。
	for k := range eventSortColumns {
		got := ParseEventQuery(values("sort", k))
		if got.SortCol != eventSortColumns[k] || got.Sort != k {
			t.Fatalf("events 排序键 %s 解析成了 %s / %s", k, got.Sort, got.SortCol)
		}
	}
	for k := range orderSortColumns {
		got := ParseOrderQuery(values("sort", k))
		if got.SortCol != orderSortColumns[k] || got.Sort != k {
			t.Fatalf("orders 排序键 %s 解析成了 %s / %s", k, got.Sort, got.SortCol)
		}
	}
	for k := range ticketSortColumns {
		got := ParseTicketQuery(values("sort", k))
		if got.SortCol != ticketSortColumns[k] || got.Sort != k {
			t.Fatalf("tickets 排序键 %s 解析成了 %s / %s", k, got.Sort, got.SortCol)
		}
	}
	o := ParseOrderQuery(values("event", `ET" OR 1=1`, "channel", "WEB"))
	if o.Event != "" {
		t.Fatalf("注入形 event 未丢弃：%q", o.Event)
	}
	if o.Channel != "web" {
		t.Fatalf("channel 未归一：%q", o.Channel)
	}
	if got := ParseDays(values("days", "9999")); got != 60 {
		t.Fatalf("days 未夹紧：%d", got)
	}
	if got := ParseDays(values("days", "abc")); got != 14 {
		t.Fatalf("days 默认值不对：%d", got)
	}
	if got := ParseDays(values()); got != 14 {
		t.Fatalf("缺省 days 应为 14，得到 %d", got)
	}
}
