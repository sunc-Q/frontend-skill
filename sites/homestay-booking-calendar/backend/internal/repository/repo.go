// Package repository 只管存取：SQL 在这里，业务判定在 domain/service。
package repository

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

// In 把同一个仓储绑定到事务句柄上：事务内所有读写都必须走它，
// 否则在 SetMaxOpenConns(1) + txlock(immediate) 下会去抢事务自己占住的唯一连接。
func (r *Repo) In(tx *gorm.DB) *Repo { return &Repo{db: tx} }

func (r *Repo) Transaction(ctx context.Context, fn func(tx *Repo) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return fn(r.In(tx)) })
}

// ---------- 基础读 ----------

func (r *Repo) LoadCalendar(ctx context.Context) (map[string]domain.RateDay, error) {
	var rows []domain.RateDay
	if err := r.db.WithContext(ctx).Order("date asc, scope asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	cal := make(map[string]domain.RateDay, len(rows))
	for _, x := range rows {
		cal[x.Scope+"|"+x.RefCode+"|"+x.Date] = x
	}
	return cal, nil
}

func (r *Repo) Properties(ctx context.Context) ([]domain.Property, error) {
	var rows []domain.Property
	err := r.db.WithContext(ctx).Order("code asc").Find(&rows).Error
	return rows, err
}

func (r *Repo) PropertyByCode(ctx context.Context, code string) (*domain.Property, error) {
	var p domain.Property
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repo) RoomByCode(ctx context.Context, code string) (*domain.RoomType, error) {
	var rt domain.RoomType
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&rt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

func (r *Repo) RoomsAll(ctx context.Context) ([]domain.RoomType, error) {
	var rows []domain.RoomType
	err := r.db.WithContext(ctx).Order("property_code asc, code asc").Find(&rows).Error
	return rows, err
}

// ---------- 房型列表（带聚合摘要） ----------

type roomScan struct {
	Code           string `gorm:"column:code"`
	PropertyCode   string `gorm:"column:property_code"`
	PropertyName   string `gorm:"column:property_name"`
	Name           string `gorm:"column:name"`
	Beds           string `gorm:"column:beds"`
	Capacity       int    `gorm:"column:capacity"`
	Units          int    `gorm:"column:units"`
	BasePriceCents int64  `gorm:"column:base_price_cents"`
	WeekendPct     int    `gorm:"column:weekend_pct"`
	HolidayPct     int    `gorm:"column:holiday_pct"`
	CleanFeeCents  int64  `gorm:"column:clean_fee_cents"`
	Breakfast      bool   `gorm:"column:breakfast"`
	Scene          string `gorm:"column:scene"`
	Amenities      string `gorm:"column:amenities"`
	Status         string `gorm:"column:status"`
	MinStayDefault int    `gorm:"column:min_stay_default"`
	Bookings       int    `gorm:"column:bookings"`
	NightsSold     int    `gorm:"column:nights_sold"`
	RevenueCents   int64  `gorm:"column:revenue_cents"`
}

const roomSelect = `rt.code, rt.property_code, p.name AS property_name, rt.name, rt.beds, rt.capacity, rt.units,
	rt.base_price_cents, rt.weekend_pct, rt.holiday_pct, rt.clean_fee_cents, rt.breakfast, rt.scene, rt.amenities,
	rt.status, rt.min_stay_default,
	COALESCE(agg.bookings, 0) AS bookings, COALESCE(agg.nights_sold, 0) AS nights_sold,
	COALESCE(agg.revenue_cents, 0) AS revenue_cents`

// roomAggJoin 先把明细按房型聚合成子查询再 LEFT JOIN：
// 把 SUM 与 COUNT 直接塞进多表 JOIN 会被行数放大（GMV 翻倍的经典成因）。
const roomAggJoin = `LEFT JOIN (
	SELECT b.room_code AS room_code,
	       COUNT(DISTINCT b.id) AS bookings,
	       SUM(bn.units) AS nights_sold,
	       SUM(bn.amount_cents) AS revenue_cents
	FROM bookings b
	JOIN booking_nights bn ON bn.booking_id = b.id
	WHERE b.status IN ('confirmed','checked_in','checked_out','no_show')
	GROUP BY b.room_code
) agg ON agg.room_code = rt.code`

func (r *Repo) Rooms(ctx context.Context, q domain.RoomQuery) ([]domain.RoomRow, int64, error) {
	base := r.db.WithContext(ctx).Table("room_types AS rt").
		Joins("JOIN properties p ON p.code = rt.property_code").Joins(roomAggJoin)
	if q.Property != "" {
		base = base.Where("rt.property_code = ?", q.Property)
	}
	if q.Status != "" {
		base = base.Where("rt.status = ?", q.Status)
	}
	if q.Breakfast != "" {
		base = base.Where("rt.breakfast = ?", q.Breakfast == "yes")
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []roomScan
	err := base.Select(roomSelect).
		Order(domain.RoomSortSQL(q.Sort) + " " + q.Dir + ", rt.id asc").
		Limit(q.PageSize).Offset(q.Offset()).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return mapRooms(rows), total, nil
}

func mapRooms(rows []roomScan) []domain.RoomRow {
	out := make([]domain.RoomRow, 0, len(rows))
	for _, x := range rows {
		out = append(out, domain.RoomRow{
			Code: x.Code, PropertyCode: x.PropertyCode, PropertyName: x.PropertyName, Name: x.Name,
			Beds: x.Beds, Capacity: x.Capacity, Units: x.Units, BasePriceCents: x.BasePriceCents,
			WeekendPct: x.WeekendPct, HolidayPct: x.HolidayPct, CleanFeeCents: x.CleanFeeCents,
			Breakfast: x.Breakfast, Scene: x.Scene, Amenities: x.Amenities, Status: x.Status,
			MinStayDefault: x.MinStayDefault, NightsSold: x.NightsSold, Bookings: x.Bookings,
			RevenueCents: x.RevenueCents, ADR: domain.SafeDiv(x.RevenueCents, int64(x.NightsSold)),
		})
	}
	return out
}

// ---------- 入住明细（房态） ----------

// LoadStays 读出与 [from, to) 有交集且状态在集合内的入住；逐夜展开交给 domain。
func (r *Repo) LoadStays(ctx context.Context, from, to string, statuses []string) ([]domain.Stay, error) {
	var rows []domain.Stay
	err := r.db.WithContext(ctx).Table("bookings").
		Select("code, room_code, check_in, check_out, units, status").
		Where("check_in < ? AND check_out > ?", to, from).
		Where("status IN ?", statuses).
		Order("room_code asc, check_in asc, id asc").
		Find(&rows).Error
	return rows, err
}

// ---------- 订单 ----------

type bookingScan struct {
	domain.Booking
	PropertyName string `gorm:"column:property_name"`
	RoomName     string `gorm:"column:room_name"`
}

func (r *Repo) Bookings(ctx context.Context, q domain.BookingQuery, today string) ([]domain.BookingRow, int64, error) {
	base := r.db.WithContext(ctx).Table("bookings AS b").
		Joins("JOIN properties p ON p.code = b.property_code").
		Joins("JOIN room_types rt ON rt.code = b.room_code")
	base = applyBookingFilters(base, q, today)
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []bookingScan
	err := base.Select("b.*, p.name AS property_name, rt.name AS room_name").
		Order(domain.BookingSortSQL(q.Sort) + " " + q.Dir + ", b.id asc").
		Limit(q.PageSize).Offset(q.Offset()).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	out := make([]domain.BookingRow, 0, len(rows))
	for i := range rows {
		b := rows[i].Booking
		out = append(out, b.Row(rows[i].PropertyName, rows[i].RoomName, today))
	}
	return out, total, nil
}

func applyBookingFilters(base *gorm.DB, q domain.BookingQuery, today string) *gorm.DB {
	if q.Status != "" {
		base = base.Where("b.status = ?", q.Status)
	}
	if q.Property != "" {
		base = base.Where("b.property_code = ?", q.Property)
	}
	if q.Room != "" {
		base = base.Where("b.room_code = ?", q.Room)
	}
	if q.Channel != "" {
		base = base.Where("b.channel = ?", q.Channel)
	}
	switch q.Horizon {
	case "arrivals":
		base = base.Where("b.check_in = ? AND b.status IN ?", today, domain.HoldStatuses)
	case "inhouse":
		base = base.Where("b.check_in <= ? AND b.check_out > ? AND b.status = ?", today, today, domain.StCheckedIn)
	case "departures":
		base = base.Where("b.check_out = ? AND b.status IN ?", today, []string{domain.StCheckedIn, domain.StConfirmed})
	case "upcoming":
		base = base.Where("b.check_in > ? AND b.status IN ?", today, domain.HoldStatuses)
	case "past":
		base = base.Where("b.check_out <= ?", today)
	}
	if q.Search != "" {
		like := domain.LikeEscaped(q.Search)
		base = base.Where("(b.code LIKE ? ESCAPE '\\' OR b.guest_name LIKE ? ESCAPE '\\' OR b.phone LIKE ? ESCAPE '\\')",
			like, like, like)
	}
	return base
}

func (r *Repo) BookingFull(ctx context.Context, code string) (*domain.Booking, string, string, error) {
	var row bookingScan
	err := r.db.WithContext(ctx).Table("bookings AS b").
		Select("b.*, p.name AS property_name, rt.name AS room_name").
		Joins("JOIN properties p ON p.code = b.property_code").
		Joins("JOIN room_types rt ON rt.code = b.room_code").
		Where("b.code = ?", code).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, "", "", domain.ErrNotFound
	}
	if err != nil {
		return nil, "", "", err
	}
	return &row.Booking, row.PropertyName, row.RoomName, nil
}

func (r *Repo) BookingByCode(ctx context.Context, code string) (*domain.Booking, error) {
	var b domain.Booking
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&b).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// NightsOf 读一份订单的逐夜拆价（金额恒等式的证据）。
func (r *Repo) NightsOf(ctx context.Context, bookingID uint) ([]domain.NightPrice, error) {
	var rows []domain.NightPrice
	err := r.db.WithContext(ctx).Table("booking_nights").
		Select("date, kind, label, price_cents, units, amount_cents").
		Where("booking_id = ?", bookingID).Order("date asc").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Weekday = domain.WeekdayCN(rows[i].Date)
	}
	return rows, nil
}

// ---------- 写 ----------

func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return errors.Is(err, gorm.ErrDuplicatedKey) ||
		contains(msg, "UNIQUE constraint") || contains(msg, "constraint failed")
}

func contains(s, sub string) bool { return len(s) >= len(sub) && indexOf(s, sub) >= 0 }

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func (r *Repo) CountBookingsOfDay(ctx context.Context, day string) (int64, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("bookings").Where("code LIKE ?", "HS"+day+"%").Count(&n).Error
	return n, err
}

func (r *Repo) InsertBooking(ctx context.Context, b *domain.Booking, nights []domain.BookingNight) error {
	if err := r.db.WithContext(ctx).Create(b).Error; err != nil {
		return err
	}
	for i := range nights {
		nights[i].BookingID = b.ID
		nights[i].BookingCode = b.Code
	}
	return r.db.WithContext(ctx).Create(&nights).Error
}

func (r *Repo) SaveBookingState(ctx context.Context, b *domain.Booking) error {
	return r.db.WithContext(ctx).Model(&domain.Booking{}).Where("id = ?", b.ID).
		Updates(map[string]any{
			"status": b.Status, "refund_cents": b.RefundCents, "note": b.Note, "updated_at": b.UpdatedAt,
		}).Error
}

// UpsertClosure 打开/关闭某房型某日的售卖：closed=false 时删掉覆盖行。
func (r *Repo) UpsertClosure(ctx context.Context, in domain.ClosureInput, room *domain.RoomType) error {
	var row domain.RateDay
	err := r.db.WithContext(ctx).
		Where("date = ? AND scope = ? AND ref_code = ?", in.Date, domain.ScopeRoom, room.Code).
		First(&row).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		if !in.Closed {
			return nil
		}
		return r.db.WithContext(ctx).Create(&domain.RateDay{
			Date: in.Date, Scope: domain.ScopeRoom, RefCode: room.Code, Kind: domain.KindClosed, Label: in.Label,
		}).Error
	case err != nil:
		return err
	}
	if !in.Closed {
		return r.db.WithContext(ctx).Delete(&domain.RateDay{}, row.ID).Error
	}
	return r.db.WithContext(ctx).Model(&domain.RateDay{}).Where("id = ?", row.ID).
		Updates(map[string]any{"kind": domain.KindClosed, "label": in.Label, "price_cents": 0}).Error
}

func (r *Repo) RoomStatusToggleTarget(ctx context.Context, code, status string) error {
	return r.db.WithContext(ctx).Model(&domain.RoomType{}).Where("code = ?", code).
		Update("status", status).Error
}
