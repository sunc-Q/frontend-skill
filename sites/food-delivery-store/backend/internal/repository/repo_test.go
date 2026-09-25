package repository

import (
	"context"
	"testing"
	"time"

	"bizsite/internal/domain"
)

func newTestRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	fixed := time.Date(2026, 9, 25, 13, 0, 0, 0, time.UTC)
	if err := r.Seed(context.Background(), fixed); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r
}

func TestSeedSelfConsistency(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	var orders []domain.Order
	if err := r.db.WithContext(ctx).Find(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if len(orders) != 122 {
		t.Fatalf("种子订单数 = %d，期望 122（确定性种子被改动？）", len(orders))
	}

	statusSeen := map[string]int{}
	for _, o := range orders {
		// 金额恒等式：实付 = 小计 + 配送费
		if o.TotalCents != o.SubtotalCents+o.DeliveryFeeCents {
			t.Fatalf("订单 %s 金额恒等式不成立: %d != %d + %d", o.OrderNo, o.TotalCents, o.SubtotalCents, o.DeliveryFeeCents)
		}
		statusSeen[o.Status]++
	}
	// 状态机分支覆盖：六种状态都必须有样本，否则看板/冒烟走不到分支
	for _, s := range []string{domain.OrderPlaced, domain.OrderCooking, domain.OrderReady,
		domain.OrderDelivering, domain.OrderDelivered, domain.OrderCancelled} {
		if statusSeen[s] == 0 {
			t.Errorf("种子未覆盖状态 %s", s)
		}
	}
}

func TestOrderItemsSumMatchesSubtotal(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	type row struct {
		ID       int64
		Subtotal int64 `gorm:"column:subtotal"`
		Sum      int64 `gorm:"column:sum"`
		Count    int64 `gorm:"column:cnt"`
	}
	var rows []row
	err := r.db.WithContext(ctx).Raw(`SELECT o.id, o.subtotal_cents AS subtotal,
		COALESCE(SUM(oi.line_cents),0) AS sum, COALESCE(SUM(oi.qty),0) AS cnt
		FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
		GROUP BY o.id, o.subtotal_cents`).Scan(&rows).Error
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range rows {
		if x.Subtotal != x.Sum {
			t.Fatalf("订单 %d 明细之和 %d != 小计 %d", x.ID, x.Sum, x.Subtotal)
		}
		if x.Count < 1 {
			t.Fatalf("订单 %d 没有任何明细", x.ID)
		}
	}
}

func TestAdvanceOrderStateFlow(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	var placed domain.Order
	if err := r.db.Where("status = ?", domain.OrderPlaced).First(&placed).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := r.AdvanceOrder(ctx, placed.ID, domain.OrderDelivered); err == nil {
		t.Fatal("placed → delivered 应被状态机拒绝")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.HTTPCode != 409 {
		t.Fatalf("期望 409，实际 %v", err)
	}
	row, err := r.AdvanceOrder(ctx, placed.ID, domain.OrderCooking)
	if err != nil {
		t.Fatalf("placed → cooking 失败: %v", err)
	}
	if row.Status != domain.OrderCooking {
		t.Fatalf("状态未推进: %s", row.Status)
	}
	_, err = r.AdvanceOrder(ctx, placed.ID, domain.OrderCooking)
	if ae, ok := err.(*domain.AppError); !ok || ae.Code != "already_in_state" {
		t.Fatalf("重复推进应报 already_in_state，实际 %v", err)
	}
	if _, err := r.AdvanceOrder(ctx, 999999, domain.OrderCooking); err != domain.ErrNotFound {
		t.Fatalf("不存在的订单应 404，实际 %v", err)
	}
}

func TestStatsIdentities(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	s, err := r.Stats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var sumStatus int64
	for _, v := range s.ByStatus {
		sumStatus += v
	}
	if sumStatus != s.OrdersTotal {
		t.Fatalf("状态计数之和 %d != 订单总数 %d", sumStatus, s.OrdersTotal)
	}
	var rawGMV int64
	if err := r.db.Raw(`SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE status != 'cancelled'`).Scan(&rawGMV).Error; err != nil {
		t.Fatal(err)
	}
	if rawGMV != s.GMVCents {
		t.Fatalf("stats GMV %d != SQL 直查 %d", s.GMVCents, rawGMV)
	}
	var catRev int64
	for _, c := range s.ByCategory {
		catRev += c.Revenue
	}
	var itemSum int64
	if err := r.db.Raw(`SELECT COALESCE(SUM(oi.line_cents),0) FROM order_items oi
		JOIN orders o ON o.id = oi.order_id WHERE o.status != 'cancelled'`).Scan(&itemSum).Error; err != nil {
		t.Fatal(err)
	}
	if catRev != itemSum {
		t.Fatalf("分类收入之和 %d != 明细合计 %d（JOIN 放大？）", catRev, itemSum)
	}
	if s.DishesTotal != 26 || s.DishesAvailable != 23 {
		t.Fatalf("菜品数异常: total=%d open=%d", s.DishesTotal, s.DishesAvailable)
	}
}

func TestPlaceOrderDuplicateOrderNo(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 25, 14, 30, 0, 0, time.UTC)
	mk := func() *PlaceOrderDraft {
		return &PlaceOrderDraft{
			Order: domain.Order{
				OrderNo: FormatOrderNo(now, 9999), Recipient: "测试", Phone: "13800000000",
				ZoneCode: "near", Address: "锦绣路 1 号", Status: domain.OrderPlaced,
				ItemCount: 1, SubtotalCents: 2800, DeliveryFeeCents: 0, TotalCents: 2800,
				PrepMinutes: 10, PlacedAt: now,
			},
			Items: []domain.OrderItem{{DishCode: "HOT-011", DishName: "麻婆豆腐", UnitPriceCents: 2800, Qty: 1, LineCents: 2800}},
		}
	}
	if err := r.PlaceOrder(ctx, mk(), now); err != nil {
		t.Fatalf("首次下单失败: %v", err)
	}
	d2 := mk()
	if err := r.PlaceOrder(ctx, d2, now); err != nil {
		t.Fatalf("订单号冲突应走重编号而不是失败: %v", err)
	}
	if d2.Order.OrderNo == FormatOrderNo(now, 9999) {
		t.Fatalf("冲突后订单号未被重新生成: %s", d2.Order.OrderNo)
	}
	stored, err := r.OrderByID(ctx, d2.Order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.TotalCents != stored.SubtotalCents+stored.DeliveryFeeCents {
		t.Fatal("重编号路径也必须保持金额恒等式")
	}
}
