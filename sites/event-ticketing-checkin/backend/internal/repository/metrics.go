package repository

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	"etk/internal/domain"
)

// Stats 汇总一次看板的读数。恒等式全部在同一批查询里自检：
// 任何一条不过就往 identity_issues 里写一条人话，接口仍返回 200（口径异常不是请求错误）。
func (r *Repo) Stats(ctx context.Context, days int, now time.Time) (*domain.Stats, error) {
	db := r.db.WithContext(ctx)
	s := &domain.Stats{
		IdentityIssues: []string{},
		Daily:          []domain.DailyPoint{},
		ByChannel:      []domain.ChannelRollup{},
		ActiveNow:      []domain.EventRow{},
		GeneratedAt:    now,
		Window:         fmt.Sprintf("近 %d 天", days),
	}
	s.Today = now.Format("2006-01-02")

	type scalar struct {
		N     int64
		Cents int64
	}
	var evCount, onSale int64
	if err := db.Model(&domain.Event{}).Count(&evCount).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&domain.Event{}).Where("status = ?", domain.EventOnSale).Count(&onSale).Error; err != nil {
		return nil, err
	}
	s.EventsTotal, s.EventsOnSale = evCount, onSale

	var ord struct {
		Paid     int64
		Refunded int64
		Gross    int64
		Fee      int64
		Refund   int64
		Retained int64
	}
	if err := db.Raw(`SELECT
		COUNT(*) AS paid,
		SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
		COALESCE(SUM(payable_cent),0) AS gross,
		COALESCE(SUM(fee_cent),0) AS fee,
		COALESCE(SUM(refunded_cent),0) AS refund,
		COALESCE(SUM(retained_cent),0) AS retained
		FROM orders WHERE status IN ('paid','refunded')`).Scan(&ord).Error; err != nil {
		return nil, err
	}
	s.OrdersPaid, s.RefundCent, s.RetainedCent = ord.Paid, ord.Refund, ord.Retained
	s.GrossCent, s.FeeCent = ord.Gross, ord.Fee
	s.NetCent = ord.Gross - ord.Refund
	if ord.Paid > 0 {
		s.AvgOrderCent = ord.Gross / ord.Paid
	}
	var ordersAll int64
	if err := db.Model(&domain.Order{}).Count(&ordersAll).Error; err != nil {
		return nil, err
	}
	s.OrdersTotal = ordersAll

	var tk struct {
		Issued int64
		Valid  int64
		Used   int64
		VoidC  int64
	}
	if err := db.Raw(`SELECT COUNT(*) AS issued,
		SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) AS valid,
		SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used,
		SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void_c
		FROM tickets`).Scan(&tk).Error; err != nil {
		return nil, err
	}
	s.TicketsIssued, s.TicketsValid, s.TicketsUsed, s.TicketsVoid = tk.Issued, tk.Valid, tk.Used, tk.VoidC
	if tk.Used+tk.Valid > 0 {
		s.CheckinRateBp = tk.Used * domain.BasisPoint / (tk.Used + tk.Valid)
	}
	if ord.Paid > 0 {
		s.RefundRateBp = ord.Refunded * domain.BasisPoint / ord.Paid
	}

	var quota struct {
		Quota int64
		Sold  int64
	}
	if err := db.Raw(`SELECT COALESCE(SUM(quota),0) AS quota, COALESCE(SUM(sold_quantity),0) AS sold FROM ticket_types`).Scan(&quota).Error; err != nil {
		return nil, err
	}
	s.QuotaTotal, s.SoldTotal = quota.Quota, quota.Sold
	if quota.Quota > 0 {
		s.SellThroughBp = quota.Sold * domain.BasisPoint / quota.Quota
	}

	// 当天口径：按下单日期与检票日期分别聚合（都是 UTC 日）。
	var todayGross scalar
	if err := db.Raw(`SELECT COUNT(*) AS n, COALESCE(SUM(payable_cent),0) AS cents
		FROM orders WHERE status IN ('paid','refunded') AND date(created_at) = ?`, s.Today).Scan(&todayGross).Error; err != nil {
		return nil, err
	}
	s.TodayGrossCent = todayGross.Cents
	var todayCheckins int64
	if err := db.Raw(`SELECT COUNT(*) FROM tickets WHERE status = 'used' AND date(used_at) = ?`, s.Today).Scan(&todayCheckins).Error; err != nil {
		return nil, err
	}
	s.TodayCheckins = todayCheckins

	// 趋势：逐日补零，否则前端折线会在稀疏日跳变（第 9 轮踩过的口径）。
	type dayRow struct {
		Day     string
		Orders  int64
		Tickets int64
		Refunds int64
		Gross   int64
		Refund  int64
	}
	from := now.AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	var orderDays []dayRow
	if err := db.Raw(`SELECT date(created_at) AS day, COUNT(*) AS orders,
		COALESCE(SUM(payable_cent),0) AS gross,
		COALESCE(SUM(refunded_cent),0) AS refund,
		SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunds
		FROM orders WHERE date(created_at) >= ? GROUP BY date(created_at)`, from).Scan(&orderDays).Error; err != nil {
		return nil, err
	}
	var checkinDays []struct {
		Day string
		N   int64
	}
	if err := db.Raw(`SELECT date(used_at) AS day, COUNT(*) AS n FROM tickets
		WHERE status = 'used' AND date(used_at) >= ? GROUP BY date(used_at)`, from).Scan(&checkinDays).Error; err != nil {
		return nil, err
	}
	issueDays := map[string]int64{}
	var issueRows []struct {
		Day string
		N   int64
	}
	if err := db.Raw(`SELECT date(issued_at) AS day, COUNT(*) AS n FROM tickets
		WHERE date(issued_at) >= ? GROUP BY date(issued_at)`, from).Scan(&issueRows).Error; err != nil {
		return nil, err
	}
	for _, x := range issueRows {
		issueDays[x.Day] = x.N
	}
	ordersByDay := map[string]dayRow{}
	for _, d := range orderDays {
		ordersByDay[d.Day] = d
	}
	checkinsByDay := map[string]int64{}
	for _, d := range checkinDays {
		checkinsByDay[d.Day] = d.N
	}
	for i := 0; i < days; i++ {
		day := now.AddDate(0, 0, -(days - 1 - i)).Format("2006-01-02")
		o := ordersByDay[day]
		p := domain.DailyPoint{
			Day:        day,
			Orders:     o.Orders,
			Tickets:    issueDays[day],
			Refunds:    o.Refunds,
			GrossCent:  o.Gross,
			RefundCent: o.Refund,
			Checkins:   checkinsByDay[day],
		}
		s.Daily = append(s.Daily, p)
	}

	// 渠道口径：检票率分母只算仍然有效的票（作废票从未入场）。
	type chRow struct {
		Channel string
		Orders  int64
		Tickets int64
		Gross   int64
		Fee     int64
		Refund  int64
	}
	var chs []chRow
	if err := db.Raw(`SELECT o.channel, COUNT(DISTINCT o.id) AS orders,
		COALESCE(SUM(o.quantity),0) AS tickets,
		COALESCE(SUM(o.payable_cent),0) AS gross,
		COALESCE(SUM(o.fee_cent),0) AS fee,
		COALESCE(SUM(o.refunded_cent),0) AS refund
		FROM orders o WHERE o.status IN ('paid','refunded') GROUP BY o.channel ORDER BY gross DESC`).Scan(&chs).Error; err != nil {
		return nil, err
	}
	var chUsed []struct {
		Channel string
		N       int64
	}
	if err := db.Raw(`SELECT o.channel, COUNT(*) AS n FROM tickets t JOIN orders o ON o.id = t.order_id
		WHERE t.status = 'used' GROUP BY o.channel`).Scan(&chUsed).Error; err != nil {
		return nil, err
	}
	usedByCh := map[string]int64{}
	for _, c := range chUsed {
		usedByCh[c.Channel] = c.N
	}
	var liveByCh []struct {
		Channel string
		N       int64
	}
	if err := db.Raw(`SELECT o.channel, COUNT(*) AS n FROM tickets t JOIN orders o ON o.id = t.order_id
		WHERE t.status IN ('valid','used') GROUP BY o.channel`).Scan(&liveByCh).Error; err != nil {
		return nil, err
	}
	live := map[string]int64{}
	for _, c := range liveByCh {
		live[c.Channel] = c.N
	}
	for _, c := range chs {
		roll := domain.ChannelRollup{
			Channel: c.Channel, Orders: c.Orders, Tickets: c.Tickets,
			GrossCent: c.Gross, FeeCent: c.Fee, RefundCent: c.Refund,
		}
		if d := live[c.Channel]; d > 0 {
			roll.CheckinBp = usedByCh[c.Channel] * domain.BasisPoint / d
		}
		s.ByChannel = append(s.ByChannel, roll)
	}

	// 此刻开门迎客的场次（闸口在开合窗口内且仍有在效票可检）。
	var active []domain.EventRow
	if err := db.Raw("SELECT "+eventsSelect+" "+eventsSrc+" WHERE e.status = ? ORDER BY e.doors_at ASC LIMIT 6",
		domain.EventOnSale).Scan(&active).Error; err != nil {
		return nil, err
	}
	for i := range active {
		DecorateEvent(&active[i], now)
		if active[i].CheckinOpen {
			s.ActiveNow = append(s.ActiveNow, active[i])
		}
	}

	if err := r.identities(ctx, s); err != nil {
		return nil, err
	}
	s.IdentityOK = len(s.IdentityIssues) == 0
	if s.IdentityOK {
		s.IdentityNote = "四条对账式全部成立"
	} else {
		s.IdentityNote = fmt.Sprintf("%d 条对账式异常", len(s.IdentityIssues))
	}
	return s, nil
}

// identities 是对账式本体。每条都必须是「能被真实缺陷破坏」的式子，
// 而不是在退化输入上自我证明的恒等（第 12 轮的教训）。
func (r *Repo) identities(ctx context.Context, s *domain.Stats) error {
	db := r.db.WithContext(ctx)

	var sold, liveTickets int64
	if err := db.Raw(`SELECT COALESCE(SUM(sold_quantity),0) FROM ticket_types`).Scan(&sold).Error; err != nil {
		return err
	}
	if err := db.Raw(`SELECT COUNT(*) FROM tickets WHERE status IN ('valid','used')`).Scan(&liveTickets).Error; err != nil {
		return err
	}
	if sold != liveTickets {
		s.IdentityIssues = append(s.IdentityIssues,
			fmt.Sprintf("配额占用与票面不符：Σsold=%d 而 valid+used=%d", sold, liveTickets))
	}

	if s.TicketsValid+s.TicketsUsed+s.TicketsVoid != s.TicketsIssued {
		s.IdentityIssues = append(s.IdentityIssues,
			fmt.Sprintf("票券状态未覆盖全量：%d+%d+%d ≠ %d",
				s.TicketsValid, s.TicketsUsed, s.TicketsVoid, s.TicketsIssued))
	}

	var badAmounts int64
	if err := db.Raw(`SELECT COUNT(*) FROM orders
		WHERE payable_cent <> subtotal_cent + fee_cent
		   OR subtotal_cent <> unit_cent * quantity
		   OR fee_cent <> service_cent * quantity`).Scan(&badAmounts).Error; err != nil {
		return err
	}
	if badAmounts > 0 {
		s.IdentityIssues = append(s.IdentityIssues,
			fmt.Sprintf("%d 笔订单金额拆分不配平（实付 ≠ 票面 + 服务费）", badAmounts))
	}

	var refundSum, retainedSum, payableSum int64
	if err := db.Raw(`SELECT COALESCE(SUM(refunded_cent),0), COALESCE(SUM(retained_cent),0), COALESCE(SUM(payable_cent),0)
		FROM orders WHERE status = 'refunded'`).Row().Scan(&refundSum, &retainedSum, &payableSum); err != nil {
		return err
	}
	if refundSum+retainedSum != payableSum {
		s.IdentityIssues = append(s.IdentityIssues,
			fmt.Sprintf("退款拆分不配平：%d + %d ≠ %d", refundSum, retainedSum, payableSum))
	}

	var oversell, ticketMismatch int64
	if err := db.Raw(`SELECT COUNT(*) FROM ticket_types WHERE sold_quantity > quota`).Scan(&oversell).Error; err != nil {
		return err
	}
	if oversell > 0 {
		s.IdentityIssues = append(s.IdentityIssues, fmt.Sprintf("%d 个票档超卖", oversell))
	}
	if err := db.Raw(`SELECT COUNT(*) FROM orders o
		LEFT JOIN (SELECT order_id, COUNT(*) AS n FROM tickets GROUP BY order_id) t ON t.order_id = o.id
		WHERE o.status IN ('paid','refunded') AND COALESCE(t.n,0) <> o.quantity`).Scan(&ticketMismatch).Error; err != nil {
		return err
	}
	if ticketMismatch > 0 {
		s.IdentityIssues = append(s.IdentityIssues,
			fmt.Sprintf("%d 笔订单的票数与购买张数不符", ticketMismatch))
	}

	var badCheckins int64
	if err := db.Raw(`SELECT COUNT(*) FROM tickets
		WHERE status = 'used' AND (gate IS NULL OR gate = '' OR used_at IS NULL)`).Scan(&badCheckins).Error; err != nil {
		return err
	}
	if badCheckins > 0 {
		s.IdentityIssues = append(s.IdentityIssues,
			fmt.Sprintf("%d 张已入场票缺闸口或时刻留痕", badCheckins))
	}

	var leakedPhones int64
	if err := db.Raw(`SELECT COUNT(*) FROM orders WHERE phone <> '' AND LENGTH(phone) <> 11`).Scan(&leakedPhones).Error; err != nil {
		return err
	}
	if leakedPhones > 0 {
		s.IdentityIssues = append(s.IdentityIssues, fmt.Sprintf("%d 条手机号格式异常", leakedPhones))
	}
	return nil
}

// VerifyOrderAmount 给测试与冒烟复用：单笔订单的拆分是否配平。
func VerifyOrderAmount(o *domain.Order) bool {
	return o.PayableCent == o.SubtotalCent+o.FeeCent &&
		o.SubtotalCent == o.UnitCent*o.Quantity &&
		o.FeeCent == o.ServiceCent*o.Quantity
}

var _ = gorm.ErrRecordNotFound
