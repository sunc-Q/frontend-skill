package repository

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"etk/internal/domain"
)

// seedAt 用「真实当前时刻」：种子里进行中场次的时间是相对 now 锚定的，
// 测试必须用同一个 now 去判定窗口，否则核销分支会随运行时刻漂移。
var seedAt = time.Now().UTC().Truncate(time.Second).Add(-90 * time.Minute)

const liveEventCode = "ETLIVE01"

func newTestRepo(t *testing.T) (*Repo, time.Time) {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), seedAt); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r, seedAt
}

func firstTicket(t *testing.T, r *Repo, eventCode, status string) domain.Ticket {
	t.Helper()
	var rows []domain.Ticket
	err := r.db.Where("event_id = (SELECT id FROM events WHERE code = ?) AND status = ?", eventCode, status).
		Order("id asc").Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		t.Fatalf("场次 %s 没有 status=%s 的票（err=%v）", eventCode, status, err)
	}
	return rows[0]
}

func firstOrder(t *testing.T, r *Repo, eventCode, status string) domain.Order {
	t.Helper()
	var rows []domain.Order
	err := r.db.Where("event_id = (SELECT id FROM events WHERE code = ?) AND status = ?", eventCode, status).
		Order("id asc").Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		t.Fatalf("场次 %s 没有 status=%s 的订单（err=%v）", eventCode, status, err)
	}
	return rows[0]
}

// forceVoid 手工把一张票置为作废，并同步回吐票档配额——只改票不改配额的话，
// 后面的 Σsold == valid+used 自检就成了测试自己造的假阳性。
func forceVoid(t *testing.T, r *Repo, tk domain.Ticket) {
	t.Helper()
	ctx := context.Background()
	if err := r.db.WithContext(ctx).Model(&domain.Ticket{}).Where("id = ?", tk.ID).
		Update("status", domain.TicketVoid).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if err := r.db.WithContext(ctx).Exec(`UPDATE ticket_types
		SET sold_quantity = sold_quantity - 1 WHERE id = ? AND sold_quantity > 0`, tk.TypeID).Error; err != nil {
		t.Fatalf("%v", err)
	}
}

func stats(t *testing.T, r *Repo, now time.Time) *domain.Stats {
	t.Helper()
	s, err := r.Stats(context.Background(), 14, now)
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	return s
}

// 种子必须自己先把口径走通：状态机每条边都有样本，四条对账式全绿。
func TestSeedSelfConsistency(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()
	s := stats(t, r, now)
	if !s.IdentityOK {
		t.Fatalf("种子自检失败：%v", s.IdentityIssues)
	}
	cases := []struct {
		name string
		sql  string
		want int64
		op   string
	}{
		{"四种场次状态齐备", `SELECT COUNT(DISTINCT status) FROM events`, 4, ">="},
		{"四种订单状态齐备", `SELECT COUNT(DISTINCT status) FROM orders`, 3, ">="},
		{"票券三态齐备", `SELECT COUNT(DISTINCT status) FROM tickets`, 3, "="},
		{"在售场次", `SELECT COUNT(*) FROM events WHERE status = 'on_sale'`, 3, ">="},
		{"已散场场次", `SELECT COUNT(*) FROM events WHERE status = 'closed'`, 1, ">="},
		{"取消场次整单退", `SELECT COUNT(*) FROM orders o JOIN events e ON e.id = o.event_id
			WHERE e.status = 'cancelled' AND o.status = 'refunded'`, 2, ">="},
		{"未支付作废单零票", `SELECT COUNT(*) FROM orders o WHERE o.status = 'cancelled'
			AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id)`, 1, ">="},
		{"已进场票有闸口", `SELECT COUNT(*) FROM tickets WHERE status = 'used' AND gate <> '' AND used_at IS NOT NULL`, -1, ">"},
		{"退票票面全作废", `SELECT COUNT(*) FROM orders o WHERE o.status = 'refunded'
			AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.status <> 'void')`, -1, ">"},
		{"早鸟立减真实发生", `SELECT COUNT(*) FROM orders WHERE discount_bps > 0`, 1, ">="},
		{"服务费不退", `SELECT COUNT(*) FROM orders WHERE status = 'refunded' AND retained_cent = fee_cent`, 1, ">="},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var n int64
			if err := r.db.WithContext(ctx).Raw(tc.sql).Scan(&n).Error; err != nil {
				t.Fatalf("%v", err)
			}
			switch tc.op {
			case ">=":
				if tc.want >= 0 && n < tc.want {
					t.Fatalf("计数 = %d, 期望 >= %d", n, tc.want)
				}
			case ">":
				if n <= 0 {
					t.Fatalf("计数 = %d, 期望 > 0", n)
				}
			case "=":
				if n != tc.want {
					t.Fatalf("计数 = %d, 期望 %d", n, tc.want)
				}
			}
		})
	}
	if s.TicketsIssued < 100 {
		t.Fatalf("种子票量太少：%d", s.TicketsIssued)
	}
	if len(s.ActiveNow) == 0 {
		t.Fatal("种子里必须有「此刻闸口正开」的场次，否则核销路径无从验证")
	}
}

// 时间口径：任何 used_at 都不得晚于 now，且落库文本不得混进非 UTC 偏移。
func TestSeedTimesNormalized(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()
	var late int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM tickets WHERE used_at > ?`, now).Scan(&late).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if late > 0 {
		t.Fatalf("%d 张票的检票时刻晚于当前时刻（种子会把场次推到未来）", late)
	}
	var futureIssued int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM tickets WHERE issued_at > ?`, now).Scan(&futureIssued).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if futureIssued > 0 {
		t.Fatalf("%d 张票的出票时刻在未来", futureIssued)
	}
	// 第 11 轮的雷：混进 +08:00 的文本会让 ORDER BY 退化成字符串排序。
	for _, col := range []struct{ table, field string }{
		{"orders", "created_at"}, {"orders", "paid_at"}, {"tickets", "issued_at"}, {"tickets", "used_at"},
		{"events", "doors_at"}, {"events", "start_at"},
	} {
		var mixed int64
		sql := `SELECT COUNT(*) FROM ` + col.table + ` WHERE ` + col.field + ` IS NOT NULL
			AND CAST(` + col.field + ` AS TEXT) LIKE '%+08:00%'`
		if err := r.db.WithContext(ctx).Raw(sql).Scan(&mixed).Error; err != nil {
			t.Fatalf("%s.%s: %v", col.table, col.field, err)
		}
		if mixed > 0 {
			t.Fatalf("%s.%s 有 %d 行带 +08:00 偏移，文本排序会失真", col.table, col.field, mixed)
		}
	}
	// 检票时刻必须落在该场次的窗口内（开门前 30 分钟起、开演后 240 分钟关闸）。
	var unparsable int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM tickets t JOIN events e ON e.id = t.event_id
		WHERE t.status = 'used' AND (julianday(t.used_at) IS NULL OR julianday(e.start_at) IS NULL
			OR julianday(e.doors_at) IS NULL)`).Scan(&unparsable).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if unparsable > 0 {
		t.Fatalf("%d 行的时间戳 SQLite 解析不了，窗口断言会变成自我证明", unparsable)
	}
	var outside int64
	err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM tickets t JOIN events e ON e.id = t.event_id
		WHERE t.status = 'used' AND (
			julianday(t.used_at) < julianday(e.doors_at, '-30 minutes') OR
			julianday(t.used_at) > julianday(e.start_at, '+240 minutes'))`).Scan(&outside).Error
	if err != nil {
		t.Fatalf("%v", err)
	}
	if outside > 0 {
		t.Fatalf("%d 条检票留痕落在场次窗口之外", outside)
	}
	var badGate int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM tickets t JOIN events e ON e.id = t.event_id
		WHERE t.status = 'used' AND t.gate <> '' AND instr(e.gates, t.gate) = 0`).Scan(&badGate).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if badGate > 0 {
		t.Fatalf("%d 条检票记录用了不属于本场的闸口", badGate)
	}
}

func TestSaleIssuesTicketsAndReservesQuota(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()
	row, err := r.EventRowByCode(ctx, "ET261001A", now)
	if err != nil {
		t.Fatalf("EventRowByCode: %v", err)
	}
	types, err := r.TypeRollupFor(ctx, row.ID, &row.Event, now)
	if err != nil {
		t.Fatalf("TypeRollupFor: %v", err)
	}
	var target domain.TicketType
	if err := r.db.Where("code = ?", types[0].TypeCode).First(&target).Error; err != nil {
		t.Fatalf("%v", err)
	}
	before := target.Sold
	in := domain.SaleInput{
		EventCode: "ET261001A", TypeCode: target.Code, Quantity: 3,
		Buyer: "qoder_test", Phone: "13800001234", Channel: domain.ChannelBox,
	}
	order, tickets, err := r.Sale(ctx, in, now)
	if err != nil {
		t.Fatalf("Sale: %v", err)
	}
	if int64(len(tickets)) != in.Quantity {
		t.Fatalf("出票 %d 张，期望 %d", len(tickets), in.Quantity)
	}
	if order.PayableCent != order.SubtotalCent+order.FeeCent {
		t.Fatalf("金额不配平：%+v", order)
	}
	if !VerifyOrderAmount(&order.Order) {
		t.Fatalf("拆分不配平：%+v", order.Order)
	}
	// 该场次在售且早鸟未过 → 必须真的立减。
	if target.EarlyBps > 0 && now.Before(row.PresaleEnd) {
		if order.DiscountBps != target.EarlyBps {
			t.Fatalf("早鸟立减没有生效：discount_bps = %d", order.DiscountBps)
		}
		if order.UnitCent >= target.UnitCent {
			t.Fatalf("现价 %d 不低于原价 %d", order.UnitCent, target.UnitCent)
		}
	} else if order.DiscountBps != 0 {
		t.Fatalf("早鸟已截止却仍立减：%d", order.DiscountBps)
	}
	var after int64
	if err := r.db.Raw(`SELECT sold_quantity FROM ticket_types WHERE code = ?`, target.Code).Scan(&after).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if after != before+in.Quantity {
		t.Fatalf("配额占用 %d → %d, 期望 +%d", before, after, in.Quantity)
	}
	// 座位标签必须互不重复，且对号入座票都有排号。
	seen := map[string]bool{}
	for _, tk := range tickets {
		if tk.Status != domain.TicketValid {
			t.Fatalf("新出的票状态是 %s", tk.Status)
		}
		if target.Seated && (tk.SeatRow == "" || tk.SeatNo == "") {
			t.Fatalf("对号入座票缺座位：%+v", tk)
		}
		key := tk.SeatZone + tk.SeatRow + tk.SeatNo
		if seen[key] {
			t.Fatalf("同单座位重复：%s", key)
		}
		seen[key] = true
	}
	s := stats(t, r, now)
	if !s.IdentityOK {
		t.Fatalf("出票后自检失败：%v", s.IdentityIssues)
	}
}

func TestSaleRejectsBoundaryAndState(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()

	var pausedCode, draftTypeCode, closedType string
	if err := r.db.Raw(`SELECT code FROM ticket_types WHERE status = 'paused' LIMIT 1`).Scan(&pausedCode).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if err := r.db.Raw(`SELECT tt.code FROM ticket_types tt JOIN events e ON e.id = tt.event_id
		WHERE e.status = 'draft' LIMIT 1`).Scan(&draftTypeCode).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if err := r.db.Raw(`SELECT tt.code FROM ticket_types tt JOIN events e ON e.id = tt.event_id
		WHERE e.status = 'closed' LIMIT 1`).Scan(&closedType).Error; err != nil {
		t.Fatalf("%v", err)
	}
	// 把进行中场次的一个票档改成「只剩 1 张余量」，用来验超卖拦截。
	// 收紧 quota 而不是伪造 sold_quantity，否则 Σsold 与票面数的对账式会被测试自己打破。
	nearFull := "TTLIVE011"
	if err := r.db.Exec(`UPDATE ticket_types SET quota = sold_quantity + 1 WHERE code = ?`, nearFull).Error; err != nil {
		t.Fatalf("%v", err)
	}

	cases := []struct {
		name     string
		in       domain.SaleInput
		wantCode string
	}{
		{"草稿场次", domain.SaleInput{EventCode: "ET261020A", TypeCode: draftTypeCode, Quantity: 1,
			Buyer: "tester_one", Phone: "13800001111", Channel: "web"}, "conflict"},
		{"已散场场次", domain.SaleInput{EventCode: "ET260920A", TypeCode: closedType, Quantity: 1,
			Buyer: "tester_two", Phone: "13800001111", Channel: "web"}, "conflict"},
		{"停售票档", domain.SaleInput{EventCode: liveEventCode, TypeCode: pausedCode, Quantity: 1,
			Buyer: "tester_three", Phone: "13800001111", Channel: "web"}, "conflict"},
		{"票档不属于该场次", domain.SaleInput{EventCode: liveEventCode, TypeCode: "TT260920A1", Quantity: 1,
			Buyer: "tester_four", Phone: "13800001111", Channel: "web"}, "conflict"},
		{"场次不存在", domain.SaleInput{EventCode: "ETNOPEXXX", TypeCode: "TTLIVE011", Quantity: 1,
			Buyer: "tester_five", Phone: "13800001111", Channel: "web"}, "not_found"},
		{"张数超过配额余量", domain.SaleInput{EventCode: liveEventCode, TypeCode: nearFull, Quantity: domain.OrderQtyMax,
			Buyer: "tester_six", Phone: "13800001111", Channel: "web"}, "sold_out"},
		{"张数超过单笔上限", domain.SaleInput{EventCode: liveEventCode, TypeCode: "TTLIVE011", Quantity: domain.OrderQtyMax + 1,
			Buyer: "tester_seven", Phone: "13800001111", Channel: "web"}, "invalid_request"},
		{"手机号位数不足", domain.SaleInput{EventCode: liveEventCode, TypeCode: "TTLIVE011", Quantity: 1,
			Buyer: "tester_eight", Phone: "1380000", Channel: "web"}, "invalid_request"},
		{"购票人超长 49 字", domain.SaleInput{EventCode: liveEventCode, TypeCode: "TTLIVE011", Quantity: 1,
			Buyer: strings.Repeat("买", 49), Phone: "13800001111", Channel: "web"}, "invalid_request"},
		{"渠道非法", domain.SaleInput{EventCode: liveEventCode, TypeCode: "TTLIVE011", Quantity: 1,
			Buyer: "tester_nine", Phone: "13800001111", Channel: "fax"}, "invalid_request"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if !ok {
				if tc.wantCode != "invalid_request" {
					t.Fatalf("校验意外拦下：%v", errs)
				}
				return
			}
			_, _, err := r.Sale(ctx, tc.in, now)
			ae, isApp := err.(*domain.AppError)
			if !isApp {
				t.Fatalf("err = %v, 期望 AppError", err)
			}
			if ae.Code != tc.wantCode {
				t.Fatalf("code = %s, 期望 %s", ae.Code, tc.wantCode)
			}
			if ae.HTTPCode < 400 {
				t.Fatalf("HTTP 码 = %d", ae.HTTPCode)
			}
		})
	}
	// 负向用例之后，配额绝不能被悄悄扣掉。
	var sold, quota int64
	if err := r.db.Raw(`SELECT COALESCE(SUM(sold_quantity),0) FROM ticket_types`).Scan(&sold).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if err := r.db.Raw(`SELECT COUNT(*) FROM tickets WHERE status IN ('valid','used')`).Scan(&quota).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if sold != quota {
		t.Fatalf("负向用例改了库存：Σsold=%d 而 live=%d", sold, quota)
	}
	// 注入串作为购票人姓名必须「按字面存下来」，既不报错也不改变语义。
	nasty := domain.SaleInput{EventCode: liveEventCode, TypeCode: "TTLIVE011", Quantity: 1,
		Buyer: `a" OR "1"="1`, Phone: "13800001111", Channel: "web"}
	o, _, err := r.Sale(ctx, nasty, now)
	if err != nil {
		t.Fatalf("含引号的购票人应被当普通文本接受: %v", err)
	}
	if o.Buyer != nasty.Buyer {
		t.Fatalf("购票人被改写了：%q", o.Buyer)
	}
	var stillThere int64
	if err := r.db.Raw(`SELECT COUNT(*) FROM orders`).Scan(&stillThere).Error; err != nil || stillThere == 0 {
		t.Fatalf("订单表疑似被动过：count=%d err=%v", stillThere, err)
	}
}

func TestCheckInLifecycle(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()

	live := firstTicket(t, r, liveEventCode, domain.TicketValid)
	var ev domain.Event
	if err := r.db.Where("code = ?", liveEventCode).First(&ev).Error; err != nil {
		t.Fatalf("%v", err)
	}
	gates := domain.GateList(ev.Gates)
	if len(gates) == 0 {
		t.Fatal("进行中场次没有闸口")
	}
	gate := gates[0]

	view, msg, err := r.CheckIn(ctx, live.Code, gate, now)
	if err != nil {
		t.Fatalf("核销失败：%v", err)
	}
	if view.Status != domain.TicketUsed || view.Gate != gate || view.UsedAt == nil {
		t.Fatalf("核销后状态不对：%+v", view)
	}
	if !strings.Contains(msg, gate) {
		t.Fatalf("回执文案缺闸口：%q", msg)
	}
	if view.PhoneMasked == "" || strings.Contains(strings.Join([]string{msg, view.SeatLabel}, "|"), "1380000") {
		t.Fatalf("回执泄露了完整手机号：%+v", view)
	}

	used := firstTicket(t, r, liveEventCode, domain.TicketUsed)
	if _, _, err := r.CheckIn(ctx, used.Code, gate, now); err == nil {
		t.Fatal("重复核销必须被拦下")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "already_used" {
		t.Fatalf("err = %v, 期望 already_used", err)
	}

	// 窗口开着的场次里，非法闸口必须被点名（闸口校验在票态之后）。
	other := firstTicket(t, r, liveEventCode, domain.TicketValid)
	if _, _, err := r.CheckIn(ctx, other.Code, "Z9", now); err == nil {
		t.Fatal("非法闸口必须被拦下")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "gate_unknown" {
		t.Fatalf("err = %v, 期望 gate_unknown", err)
	}

	// 散场场次的票：无论什么状态都不允许再检（窗口先于票态判定）。
	closedValid := firstTicket(t, r, "ET260920A", domain.TicketValid)
	if _, _, err := r.CheckIn(ctx, closedValid.Code, "A", now); err == nil {
		t.Fatal("已散场场次不应可核销")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "event_closed" {
		t.Fatalf("err = %v, 期望 event_closed", err)
	}

	// 未来场次：未到开门。
	future := firstTicket(t, r, "ET261001A", domain.TicketValid)
	if _, _, err := r.CheckIn(ctx, future.Code, "A", now); err == nil {
		t.Fatal("未到开门不应可核销")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "doors_not_open" {
		t.Fatalf("err = %v, 期望 doors_not_open", err)
	}

	if _, _, err := r.CheckIn(ctx, "TKNOTEXIST000", "A", now); err != domain.ErrNotFound {
		t.Fatalf("不存在的票应 404，得到 %v", err)
	}

	// 核销不改变任何金额与库存口径。
	s := stats(t, r, now)
	if !s.IdentityOK {
		t.Fatalf("核销后自检失败：%v", s.IdentityIssues)
	}
	if s.TicketsUsed < 1 {
		t.Fatal("检票数没有进 KPI")
	}
}

func TestRefundVoidsTicketsAndReleasesQuota(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()

	paid := firstOrder(t, r, "ET261001A", domain.OrderPaid)
	var ttID int64
	if err := r.db.Raw(`SELECT type_id FROM orders WHERE code = ?`, paid.Code).Scan(&ttID).Error; err != nil {
		t.Fatalf("%v", err)
	}
	var soldBefore int64
	if err := r.db.Model(&domain.TicketType{}).Where("id = ?", ttID).Pluck("sold_quantity", &soldBefore).Error; err != nil {
		t.Fatalf("%v", err)
	}
	view, refund, err := r.Refund(ctx, paid.Code, "行程变更，开演前退", now)
	if err != nil {
		t.Fatalf("Refund: %v", err)
	}
	if view.Status != domain.OrderRefunded {
		t.Fatalf("状态 = %s", view.Status)
	}
	if refund != paid.SubtotalCent {
		t.Fatalf("退款 %d, 期望票面小计 %d（服务费不退）", refund, paid.SubtotalCent)
	}
	if view.RefundedCent+view.RetainedCent != view.PayableCent {
		t.Fatalf("退款拆分不配平：%+v", view.Order)
	}
	if view.RetainedCent != paid.FeeCent {
		t.Fatalf("留存额 %d ≠ 服务费 %d", view.RetainedCent, paid.FeeCent)
	}
	var leftValid int64
	if err := r.db.Model(&domain.Ticket{}).Where("order_id = ? AND status <> ?", paid.ID, domain.TicketVoid).Count(&leftValid).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if leftValid != 0 {
		t.Fatalf("退票后仍有 %d 张在效票", leftValid)
	}
	// 判定顺序：窗口先于票态。这单的场次还没开门，所以闸口给的是 doors_not_open。
	var refundedTK string
	if err := r.db.Raw(`SELECT code FROM tickets WHERE order_id = ? ORDER BY id LIMIT 1`, paid.ID).
		Scan(&refundedTK).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if _, _, err := r.CheckIn(ctx, refundedTK, "A", now); err == nil {
		t.Fatal("已退票且未开门的场次不应可核销")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "doors_not_open" {
		t.Fatalf("err = %v, 期望 doors_not_open（窗口判定先于票态）", err)
	}
	var soldAfter int64
	if err := r.db.Model(&domain.TicketType{}).Where("id = ?", ttID).Pluck("sold_quantity", &soldAfter).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if soldAfter != soldBefore-paid.Quantity {
		t.Fatalf("配额未回吐：%d → %d, 期望 -%d", soldBefore, soldAfter, paid.Quantity)
	}
	// 作废票在开着的闸口前必须被点名。手工作废要同时回吐配额，否则是自己把
	// Σsold == valid+used 这条对账式打破，后面的自检就失去意义了。
	var ev domain.Event
	if err := r.db.Where("code = ?", liveEventCode).First(&ev).Error; err != nil {
		t.Fatalf("%v", err)
	}
	gates := domain.GateList(ev.Gates)
	if len(gates) == 0 {
		t.Fatal("进行中场次没有闸口")
	}
	gate := gates[0]
	var voidTK domain.Ticket
	if err := r.db.Where("event_id = (SELECT id FROM events WHERE code = ?) AND status = ?",
		liveEventCode, domain.TicketValid).Order("id asc").First(&voidTK).Error; err != nil {
		t.Fatalf("%v", err)
	}
	forceVoid(t, r, voidTK)
	if _, _, err := r.CheckIn(ctx, voidTK.Code, gate, now); err == nil {
		t.Fatal("已作废票必须挡在闸口外")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "ticket_void" {
		t.Fatalf("err = %v, 期望 ticket_void", err)
	}
	if _, _, err := r.Refund(ctx, paid.Code, "重复退", now); err == nil {
		t.Fatal("重复退票必须 409")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "already_refunded" {
		t.Fatalf("err = %v, 期望 already_refunded", err)
	}

	// 有人已进场的整单不许退（一票一入，退了就说不清谁在里面）。
	usedOrder := func() domain.Order {
		var rows []domain.Order
		err := r.db.Raw(`SELECT o.* FROM orders o JOIN tickets t ON t.order_id = o.id
			WHERE o.status = 'paid' AND t.status = 'used' LIMIT 1`).Find(&rows).Error
		if err != nil || len(rows) == 0 {
			t.Fatal("种子里要有「已进场且未退」的订单")
		}
		return rows[0]
	}()
	if _, _, err := r.Refund(ctx, usedOrder.Code, "想退", now); err == nil {
		t.Fatal("已进场订单退票必须被拦")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "partially_used" {
		t.Fatalf("err = %v, 期望 partially_used", err)
	}

	// 未支付作废单从未产生票，退票路径必须拒绝（不是 0 元退款）。
	cancelled := firstOrder(t, r, "ET261001A", domain.OrderCancelled)
	if _, _, err := r.Refund(ctx, cancelled.Code, "没付过", now); err == nil {
		t.Fatal("作废单退票必须被拦")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "order_cancelled" {
		t.Fatalf("err = %v, 期望 order_cancelled", err)
	}

	s := stats(t, r, now)
	if !s.IdentityOK {
		t.Fatalf("退票后自检失败：%v", s.IdentityIssues)
	}
	if s.RefundCent <= 0 || s.RetainedCent <= 0 {
		t.Fatalf("退款/留存口径为空：%+v", s)
	}
}

func TestEventStatusMachineAndCreate(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()
	in := domain.CreateEventInput{
		Code: "ET261231A", Title: "跨年音乐马拉松", Artist: "北岸爱乐", Category: "concert",
		Venue: "城市音乐厅 · 大厅", City: "上海", Gates: "A,B,VIP",
		DoorsAt: "2026-12-31T15:00:00Z", StartAt: "2026-12-31T16:00:00Z",
		PresaleEnd: "2026-12-20T23:59:59Z", RefundCutHours: 48, Note: "新建场次走完整状态机",
	}
	e, err := r.CreateEvent(ctx, in, now)
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	if e.Status != domain.EventDraft {
		t.Fatalf("新场次初始状态 = %s", e.Status)
	}
	if _, err := r.CreateEvent(ctx, in, now); err == nil {
		t.Fatal("重复编号必须 409")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "conflict" {
		t.Fatalf("err = %v", err)
	}
	steps := []struct {
		to     string
		wantOK bool
	}{
		{domain.EventClosed, false}, // 草稿不能直接散场
		{domain.EventOnSale, true},
		{domain.EventOnSale, false},
		{domain.EventClosed, true},
		{domain.EventCanceld, false}, // 散场是终态
	}
	for i, st := range steps {
		_, err := r.SetEventStatus(ctx, e.Code, st.to, now)
		ok := err == nil
		if ok != st.wantOK {
			t.Fatalf("第 %d 步 %s：err = %v, 期望 ok = %t", i+1, st.to, err, st.wantOK)
		}
	}
	var closedAt *time.Time
	if err := r.db.Raw(`SELECT closed_at FROM events WHERE code = ?`, e.Code).Scan(&closedAt).Error; err != nil {
		t.Fatalf("%v", err)
	}
	if closedAt == nil {
		t.Fatal("散场必须留下 closed_at 时刻")
	}
	if _, err := r.SetEventStatus(ctx, "ETNOPEXXX", domain.EventOnSale, now); err != domain.ErrNotFound {
		t.Fatalf("不存在的场次应 404，得到 %v", err)
	}
}

// 第 6 轮的教训：go test 全绿不代表接口可用——每个排序键都要真的执行一遍。
func TestEverySortKeyResolves(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()
	keys := func(m map[string]string) []string {
		out := make([]string, 0, len(m))
		for k := range m {
			out = append(out, k)
		}
		return out
	}
	for _, sort := range keys(map[string]string{
		"doors": "", "start": "", "code": "", "status": "", "sold": "", "gross": "", "used": "", "quota": "", "id": "",
	}) {
		for _, dir := range []string{"asc", "desc"} {
			q := domain.ParseEventQuery(map[string][]string{"sort": {sort}, "dir": {dir}})
			rows, total, err := r.ListEvents(ctx, q, now)
			if err != nil {
				t.Fatalf("events sort=%s dir=%s: %v", sort, dir, err)
			}
			if len(rows) == 0 || total == 0 {
				t.Fatalf("events sort=%s 取回空集", sort)
			}
		}
	}
	for _, sort := range keys(map[string]string{
		"created": "", "payable": "", "qty": "", "status": "", "code": "", "event": "", "id": "",
	}) {
		q := domain.ParseOrderQuery(map[string][]string{"sort": {sort}, "page_size": {"5"}})
		rows, _, err := r.ListOrders(ctx, q, now)
		if err != nil {
			t.Fatalf("orders sort=%s: %v", sort, err)
		}
		if len(rows) == 0 {
			t.Fatalf("orders sort=%s 取回空集", sort)
		}
	}
	for _, sort := range keys(map[string]string{
		"issued": "", "used": "", "code": "", "status": "", "seat": "", "event": "", "order": "", "id": "",
	}) {
		q := domain.ParseTicketQuery(map[string][]string{"sort": {sort}, "page_size": {"5"}})
		rows, _, err := r.ListTickets(ctx, q, now)
		if err != nil {
			t.Fatalf("tickets sort=%s: %v", sort, err)
		}
		if len(rows) == 0 {
			t.Fatalf("tickets sort=%s 取回空集", sort)
		}
	}
}

func TestSearchTreatsInjectionAsLiteral(t *testing.T) {
	r, now := newTestRepo(t)
	ctx := context.Background()
	// 注入串按字面量匹配：既不能报 500，也不能真的把表拖出来。
	for _, probe := range []string{`" OR "1"="1`, `'; DROP TABLE orders;--`, `100%'`, `a_b`, `%%`} {
		q := domain.ParseTicketQuery(map[string][]string{"q": {probe}, "page_size": {"5"}})
		rows, total, err := r.ListTickets(ctx, q, now)
		if err != nil {
			t.Fatalf("注入探针 %q: %v", probe, err)
		}
		if total != 0 || len(rows) != 0 {
			t.Fatalf("注入探针 %q 命中 %d 行", probe, total)
		}
	}
	var orders int64
	if err := r.db.Model(&domain.Order{}).Count(&orders).Error; err != nil || orders == 0 {
		t.Fatalf("订单表被动过：count=%d err=%v", orders, err)
	}
	// 真实编号能搜到，且返回的行里手机号一律脱敏。
	target := firstOrder(t, r, liveEventCode, domain.OrderPaid)
	q := domain.ParseOrderQuery(map[string][]string{"q": {target.Code}})
	rows, total, err := r.ListOrders(ctx, q, now)
	if err != nil || total != 1 || len(rows) != 1 {
		t.Fatalf("按订单号检索失败：total=%d err=%v", total, err)
	}
	if rows[0].PhoneMasked == "" {
		t.Fatalf("列表没有给出脱敏手机号：%+v", rows[0])
	}
	body := mustJSON(t, rows[0])
	if strings.Contains(body, target.Phone) || strings.Contains(body, `"phone"`) {
		t.Fatalf("列表 JSON 泄露手机号：%s", body)
	}
	if !strings.HasPrefix(rows[0].PhoneMasked, target.Phone[:3]) ||
		!strings.HasSuffix(rows[0].PhoneMasked, target.Phone[7:]) {
		t.Fatalf("脱敏值与真号对不上：%s / %s", rows[0].PhoneMasked, target.Phone)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}
