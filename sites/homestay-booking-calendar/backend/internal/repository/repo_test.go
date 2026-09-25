package repository

import (
	"context"
	"testing"
	"time"

	"bizsite/internal/domain"
)

// 种子必须"自己经得起查"：这里用直连 SQL 与全量重算两套口径核对，
// 任何一条不成立都说明 seed 绕过了 domain.BuildQuote，线上口径就会分叉。

var testNow = time.Date(2026, 9, 26, 10, 0, 0, 0, time.UTC)

func newTestRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), testNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r
}

// TestSeedMoneyIdentities 核对三条金额恒等式：
// Σ逐夜金额 == 房费小计、总额 == 小计+清洁费、实收 == 成交额+取消单总额−退款。
func TestSeedMoneyIdentities(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	var bs []domain.Booking
	if err := r.db.WithContext(ctx).Order("id asc").Find(&bs).Error; err != nil {
		t.Fatal(err)
	}
	if len(bs) < 180 {
		t.Fatalf("种子订单只有 %d 笔，覆盖不足", len(bs))
	}

	var nights []domain.BookingNight
	if err := r.db.WithContext(ctx).Find(&nights).Error; err != nil {
		t.Fatal(err)
	}
	sum := map[uint]int64{}
	for _, n := range nights {
		if n.AmountCents != n.PriceCents*int64(n.Units) {
			t.Fatalf("%s %s 单晚金额 %d != %d×%d", n.BookingCode, n.Date, n.AmountCents, n.PriceCents, n.Units)
		}
		sum[n.BookingID] += n.AmountCents
	}
	for _, b := range bs {
		if b.Status == domain.StPending || b.Status == domain.StCancelled {
			continue
		}
		if sum[b.ID] != b.NightSubtotalCents {
			t.Fatalf("%s Σ逐夜 %d != 房费小计 %d", b.Code, sum[b.ID], b.NightSubtotalCents)
		}
		if b.TotalCents != b.NightSubtotalCents+b.CleanFeeCents {
			t.Fatalf("%s 总额 %d != %d+%d", b.Code, b.TotalCents, b.NightSubtotalCents, b.CleanFeeCents)
		}
		if b.Nights != domain.DaysBetween(b.CheckIn, b.CheckOut) {
			t.Fatalf("%s 晚数 %d 与区间不符", b.Code, b.Nights)
		}
		if b.Nights > 0 && len(nights) > 0 && sum[b.ID] == 0 {
			t.Fatalf("%s 有 %d 晚却没有逐夜明细", b.Code, b.Nights)
		}
	}

	m, err := r.MoneyAgg(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if m.GMVCents+m.CancelGross-m.RefundCents != m.NetCents {
		t.Fatalf("净额恒等式不成立：%d+%d-%d != %d", m.GMVCents, m.CancelGross, m.RefundCents, m.NetCents)
	}
	nightSum, err := r.NightAmountSum(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if nightSum != m.NightSubtotal {
		t.Fatalf("逐夜汇总 %d != bookings 汇总 %d", nightSum, m.NightSubtotal)
	}
}

// TestSeedNeverOversells 逐房逐晚重算占用：任一晚的间数都不得超过物理库存。
func TestSeedNeverOversells(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	units, _, err := r.RoomUnits(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		RoomCode string `gorm:"column:room_code"`
		Date     string `gorm:"column:date"`
		Units    int    `gorm:"column:u"`
	}
	err = r.db.WithContext(ctx).Table("booking_nights bn").
		Select("b.room_code AS room_code, bn.date AS date, COALESCE(SUM(bn.units),0) AS u").
		Joins("JOIN bookings b ON b.id = bn.booking_id").
		Where("b.status IN ?", domain.HoldStatuses).
		Group("b.room_code, bn.date").Order("u desc").Find(&rows).Error
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("没有任何占用晚，种子不成立")
	}
	var worst []string
	for _, row := range rows {
		stock := units[row.RoomCode]
		if row.Units > stock {
			t.Fatalf("%s %s 超卖：%d 间 > 库存 %d", row.RoomCode, row.Date, row.Units, stock)
		}
		if row.Units == stock && len(worst) < 5 {
			worst = append(worst, row.RoomCode+" "+row.Date)
		}
	}
	if len(worst) == 0 {
		t.Fatal("种子必须造出至少一个满房晚，否则日历面板没有信息量")
	}
}

// TestSeedRespectsBufferAndClosure 核对排他规则：同房型相邻两单之间留出清洁缓冲，
// 且任何一晚都不得落在该房型的停售日上。
func TestSeedRespectsBufferAndClosure(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	holds, err := r.LoadStays(ctx, "2000-01-01", "2100-01-01", domain.HoldStatuses)
	if err != nil {
		t.Fatal(err)
	}
	byRoom := map[string][]domain.Stay{}
	for _, s := range holds {
		byRoom[s.RoomCode] = append(byRoom[s.RoomCode], s)
	}
	buf := map[string]int{}
	for _, p := range mustProps(t, r, ctx) {
		buf[p.Code] = p.CleanBufferDays
	}
	roomProp := map[string]string{}
	for _, rt := range mustRooms(t, r, ctx) {
		roomProp[rt.Code] = rt.PropertyCode
	}
	perPair := 0
	for _, list := range byRoom {
		for i := range list {
			for j := range list {
				if i == j {
					continue
				}
				a, b := list[i], list[j]
				if a.CheckOut > b.CheckIn {
					continue
				}
				perPair++
				gap := domain.DaysBetween(a.CheckOut, b.CheckIn)
				if want := buf[roomProp[b.RoomCode]]; gap < want {
					t.Fatalf("%s: %s 退房 %s 后 %d 天就入住 %s，缓冲需 %d 天",
						b.RoomCode, a.Code, a.CheckOut, gap, b.Code, want)
				}
			}
		}
	}
	if perPair < 50 {
		t.Fatalf("相邻对只有 %d 组，缓冲覆盖不足", perPair)
	}

	closed, err := r.LoadCalendar(ctx)
	if err != nil {
		t.Fatal(err)
	}
	roomOf := map[string]string{}
	for _, s := range holds {
		roomOf[s.Code] = s.RoomCode
	}
	var checked int
	for _, n := range mustNights(t, r, ctx) {
		room := roomOf[n.BookingCode]
		if room == "" {
			continue // 非占用状态（已取消/已离店）不做排他要求
		}
		for _, key := range []string{"room|" + room + "|" + n.Date, "property|" + roomProp[room] + "|" + n.Date, "global||" + n.Date} {
			if d, ok := closed[key]; ok && d.Kind == domain.KindClosed {
				t.Fatalf("%s(%s) 落在停售日 %s（%s）", n.BookingCode, room, n.Date, d.Label)
			}
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("没有可核对的占用晚")
	}
}

// TestSeedCoversEveryBusinessBranch 要求五类价格格子与六种订单状态都真的出现过：
// 少一类就意味着统计面板上会有一格永远是空的。
func TestSeedCoversEveryBusinessBranch(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	kinds := map[string]int{}
	for _, n := range mustNights(t, r, ctx) {
		kinds[n.Kind]++
	}
	for _, want := range []string{domain.KindWeekday, domain.KindWeekend, domain.KindHoliday, domain.KindPromo} {
		if kinds[want] == 0 {
			t.Fatalf("逐夜明细里没有 %s 类价格", want)
		}
	}
	states := map[string]int{}
	var bs []domain.Booking
	if err := r.db.WithContext(ctx).Find(&bs).Error; err != nil {
		t.Fatal(err)
	}
	for _, b := range bs {
		states[b.Status]++
	}
	for _, s := range []string{domain.StPending, domain.StConfirmed, domain.StCheckedIn,
		domain.StCheckedOut, domain.StCancelled, domain.StNoShow} {
		if states[s] == 0 {
			t.Fatalf("种子里没有 %s 状态的订单", s)
		}
	}
	var refunds int
	for _, b := range bs {
		if b.RefundCents > 0 {
			refunds++
		}
	}
	if refunds == 0 {
		t.Fatal("种子里没有一笔退款，退款阶梯等于没被测过")
	}
	if n, err := r.RateDayCount(ctx); err != nil || n == 0 {
		t.Fatalf("日历覆盖表为空: %v", err)
	}
}

func mustNights(t *testing.T, r *Repo, ctx context.Context) []domain.BookingNight {
	t.Helper()
	var out []domain.BookingNight
	if err := r.db.WithContext(ctx).Order("date asc").Find(&out).Error; err != nil {
		t.Fatal(err)
	}
	return out
}

func mustRooms(t *testing.T, r *Repo, ctx context.Context) []domain.RoomType {
	t.Helper()
	out, err := r.RoomsAll(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func mustProps(t *testing.T, r *Repo, ctx context.Context) []domain.Property {
	t.Helper()
	out, err := r.Properties(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
