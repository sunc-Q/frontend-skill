package repository

import (
	"context"

	"bizsite/internal/domain"
)

// 统计层的所有聚合都在这里，且一律走 booking_nights / bookings 的既有落库值——
// 绝不重算房价：价格口径只在 domain.BuildQuote 里存在一次。

const revenueIn = "'confirmed','checked_in','checked_out','no_show'"

// StatusAgg 按状态给出份数与金额。
type StatusAgg struct {
	Status string `gorm:"column:status"`
	N      int    `gorm:"column:n"`
	Total  int64  `gorm:"column:total"`
	Refund int64  `gorm:"column:refund"`
	Units  int    `gorm:"column:units"`
	Nights int    `gorm:"column:nights"`
}

func (r *Repo) StatusAgg(ctx context.Context) ([]StatusAgg, error) {
	var rows []StatusAgg
	err := r.db.WithContext(ctx).Table("bookings").
		Select(`status, COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total,
			COALESCE(SUM(refund_cents),0) AS refund, COALESCE(SUM(units),0) AS units,
			COALESCE(SUM(nights),0) AS nights`).
		Group("status").Order("status asc").Find(&rows).Error
	return rows, err
}

// ChannelAgg 是成交口径的渠道构成。
type ChannelAgg struct {
	Channel string `gorm:"column:channel"`
	N       int    `gorm:"column:n"`
	Total   int64  `gorm:"column:total"`
	Nights  int    `gorm:"column:nights"`
}

func (r *Repo) ChannelAgg(ctx context.Context) ([]ChannelAgg, error) {
	var rows []ChannelAgg
	err := r.db.WithContext(ctx).Table("bookings").
		Select(`channel, COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS total, COALESCE(SUM(nights),0) AS nights`).
		Where("status IN (" + revenueIn + ")").
		Group("channel").Order("total desc").Find(&rows).Error
	return rows, err
}

// PropertyAgg 是成交口径的门店对比（房晚与金额来自逐夜明细，避免 JOIN 放大）。
type PropertyAgg struct {
	PropertyCode string `gorm:"column:property_code"`
	N            int    `gorm:"column:n"`
	Units        int    `gorm:"column:units"`
	Amount       int64  `gorm:"column:amount"`
	Clean        int64  `gorm:"column:clean"`
}

func (r *Repo) PropertyAgg(ctx context.Context) ([]PropertyAgg, error) {
	var rows []PropertyAgg
	err := r.db.WithContext(ctx).Table(`(
		SELECT b.property_code AS property_code, b.id AS booking_id, b.channel AS channel,
		       bn.units AS units, bn.amount_cents AS amount_cents, b.clean_fee_cents AS clean_fee_cents
		FROM bookings b JOIN booking_nights bn ON bn.booking_id = b.id
		WHERE b.status IN (` + revenueIn + `)
	) src`).
		Select(`property_code, COUNT(DISTINCT booking_id) AS n, COALESCE(SUM(units),0) AS units,
			COALESCE(SUM(amount_cents),0) AS amount, 0 AS clean`).
		Group("property_code").Order("amount desc").Find(&rows).Error
	return rows, err
}

// NightWindow 是逐夜明细在 [from,to) 内的合计：已售房晚与房费收入。
type NightWindow struct {
	RoomNights int   `gorm:"column:room_nights"`
	Amount     int64 `gorm:"column:amount"`
	Bookings   int   `gorm:"column:bookings"`
}

func (r *Repo) NightWindow(ctx context.Context, from, to string) (NightWindow, error) {
	var out NightWindow
	err := r.db.WithContext(ctx).Table("booking_nights bn").
		Select(`COALESCE(SUM(bn.units),0) AS room_nights, COALESCE(SUM(bn.amount_cents),0) AS amount,
			COUNT(DISTINCT bn.booking_id) AS bookings`).
		Joins("JOIN bookings b ON b.id = bn.booking_id").
		Where("bn.date >= ? AND bn.date < ?", from, to).
		Where("b.status IN (" + revenueIn + ")").
		Scan(&out).Error
	return out, err
}

// DailyNights 是负载曲线：逐日的已售房晚与房费。
type DailyNights struct {
	Date       string `gorm:"column:date"`
	RoomNights int    `gorm:"column:room_nights"`
	Amount     int64  `gorm:"column:amount"`
}

func (r *Repo) DailyNights(ctx context.Context, from, to string) ([]DailyNights, error) {
	var rows []DailyNights
	err := r.db.WithContext(ctx).Table("booking_nights bn").
		Select("bn.date AS date, COALESCE(SUM(bn.units),0) AS room_nights, COALESCE(SUM(bn.amount_cents),0) AS amount").
		Joins("JOIN bookings b ON b.id = bn.booking_id").
		Where("bn.date >= ? AND bn.date < ?", from, to).
		Where("b.status IN (" + revenueIn + ")").
		Group("bn.date").Order("bn.date asc").Find(&rows).Error
	return rows, err
}

// KindMix 是价格构成的按类型汇总（平日/周末/节假日/特价各占多少房晚与金额）。
type KindMix struct {
	Kind       string `gorm:"column:kind"`
	RoomNights int    `gorm:"column:room_nights"`
	Amount     int64  `gorm:"column:amount"`
}

func (r *Repo) KindMix(ctx context.Context, from, to string) ([]KindMix, error) {
	var rows []KindMix
	err := r.db.WithContext(ctx).Table("booking_nights bn").
		Select("bn.kind AS kind, COALESCE(SUM(bn.units),0) AS room_nights, COALESCE(SUM(bn.amount_cents),0) AS amount").
		Joins("JOIN bookings b ON b.id = bn.booking_id").
		Where("bn.date >= ? AND bn.date < ?", from, to).
		Where("b.status IN (" + revenueIn + ")").
		Group("bn.kind").Order("amount desc").Find(&rows).Error
	return rows, err
}

// MoneyAgg 是金额三口径：成交额（营收状态）、取消退款（cancelled）、净额。
// MoneyAgg 是金额三口径。净额的可核对定义：
//
//	实收 = 成交额(营收状态) + 已取消单里不退的部分 − 已退款
//
// 已取消单的 total 不计入成交额（那是流失），但它扣掉退款后的余额确实是收进来的钱。
type MoneyAgg struct {
	GMVCents      int64 `gorm:"column:gmv"`
	CancelGross   int64 `gorm:"column:cancel_g"`
	RefundCents   int64 `gorm:"column:refund"`
	NetCents      int64 `gorm:"column:net"`
	PendingTotal  int64 `gorm:"column:pending_t"`
	NightSubtotal int64 `gorm:"column:night_sum"`
	CleanTotal    int64 `gorm:"column:clean"`
}

func (r *Repo) MoneyAgg(ctx context.Context) (MoneyAgg, error) {
	var out MoneyAgg
	err := r.db.WithContext(ctx).Table("bookings").
		Select(`COALESCE(SUM(CASE WHEN status IN (` + revenueIn + `) THEN total_cents ELSE 0 END),0) AS gmv,
			COALESCE(SUM(CASE WHEN status = 'cancelled' THEN total_cents ELSE 0 END),0) AS cancel_g,
			COALESCE(SUM(CASE WHEN status = 'cancelled' THEN refund_cents ELSE 0 END),0) AS refund,
			COALESCE(SUM(CASE WHEN status IN (` + revenueIn + `) OR status = 'cancelled' THEN total_cents - refund_cents ELSE 0 END),0) AS net,
			COALESCE(SUM(CASE WHEN status = 'pending' THEN total_cents ELSE 0 END),0) AS pending_t,
			COALESCE(SUM(CASE WHEN status IN (` + revenueIn + `) THEN night_subtotal_cents ELSE 0 END),0) AS night_sum,
			COALESCE(SUM(CASE WHEN status IN (` + revenueIn + `) THEN clean_fee_cents ELSE 0 END),0) AS clean`).
		Scan(&out).Error
	return out, err
}

// NightAmountSum 是逐夜明细的金额总和（营收状态），用于和 bookings.night_subtotal_cents 交叉核对。
func (r *Repo) NightAmountSum(ctx context.Context) (int64, error) {
	var v int64
	err := r.db.WithContext(ctx).Table("booking_nights bn").
		Select("COALESCE(SUM(bn.amount_cents),0)").
		Joins("JOIN bookings b ON b.id = bn.booking_id").
		Where("b.status IN (" + revenueIn + ")").Scan(&v).Error
	return v, err
}

// InHouseToday 返回今日在住的份数与间数。
func (r *Repo) InHouseToday(ctx context.Context, today string) (int, int, error) {
	var out struct {
		N     int `gorm:"column:n"`
		Units int `gorm:"column:u"`
	}
	err := r.db.WithContext(ctx).Table("bookings").
		Select("COUNT(*) AS n, COALESCE(SUM(units),0) AS u").
		Where("check_in <= ? AND check_out > ? AND status = ?", today, today, domain.StCheckedIn).
		Scan(&out).Error
	return out.N, out.Units, err
}

func (r *Repo) CountWhere(ctx context.Context, table string, where string, args ...any) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Table(table).Where(where, args...).Count(&n).Error
	return n, err
}

func (r *Repo) ActiveRoomCount(ctx context.Context) (int64, error) {
	return r.CountWhere(ctx, "room_types", "status = ?", domain.RoomActive)
}

func (r *Repo) UnitTotal(ctx context.Context, activeOnly bool) (int, error) {
	q := r.db.WithContext(ctx).Table("room_types").Select("COALESCE(SUM(units),0)")
	if activeOnly {
		q = q.Where("status = ?", domain.RoomActive)
	}
	var v int
	err := q.Scan(&v).Error
	return v, err
}

func (r *Repo) RateDayCount(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.RateDay{}).Count(&n).Error
	return n, err
}

// RoomUnits 把房型编码映射到库存间数，供负载曲线用。
func (r *Repo) RoomUnits(ctx context.Context) (map[string]int, map[string]string, error) {
	var rows []domain.RoomType
	if err := r.db.WithContext(ctx).Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	units := map[string]int{}
	prop := map[string]string{}
	for _, x := range rows {
		units[x.Code] = x.Units
		prop[x.Code] = x.PropertyCode
	}
	return units, prop, nil
}
