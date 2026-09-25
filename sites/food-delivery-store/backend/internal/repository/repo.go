package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

// ---- 菜单 ----

func (r *Repo) Menu(ctx context.Context, q domain.MenuQuery) ([]domain.MenuRow, int64, error) {
	db := r.db.WithContext(ctx)
	base := db.Table("dishes AS d").
		Select(`d.*, COALESCE((SELECT SUM(oi.qty) FROM order_items oi
			JOIN orders o ON o.id = oi.order_id
			WHERE oi.dish_code = d.code AND o.status != 'cancelled'),0) AS sold_total`)
	if q.Category != "" {
		base = base.Where("d.category = ?", q.Category)
	}
	if q.OnlyOpen {
		base = base.Where("d.available = ?", true)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(d.name LIKE ? ESCAPE '\\' OR d.code LIKE ? ESCAPE '\\' OR d.taste LIKE ? ESCAPE '\\')", like, like, like)
	}
	var total int64
	countSrc := db.WithContext(ctx).Table("dishes AS d")
	if q.Category != "" {
		countSrc = countSrc.Where("d.category = ?", q.Category)
	}
	if q.OnlyOpen {
		countSrc = countSrc.Where("d.available = ?", true)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		countSrc = countSrc.Where("(d.name LIKE ? ESCAPE '\\' OR d.code LIKE ? ESCAPE '\\' OR d.taste LIKE ? ESCAPE '\\')", like, like, like)
	}
	if err := countSrc.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.MenuRow
	err := base.Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", d.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).Scan(&rows).Error
	return rows, total, err
}

func (r *Repo) DishesByCodes(ctx context.Context, codes []string) ([]domain.Dish, error) {
	var out []domain.Dish
	err := r.db.WithContext(ctx).Where("code IN ?", codes).Find(&out).Error
	return out, err
}

func (r *Repo) DishByID(ctx context.Context, id int64) (*domain.Dish, error) {
	var d domain.Dish
	err := r.db.WithContext(ctx).First(&d, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *Repo) SetAvailability(ctx context.Context, id int64, available bool) (*domain.Dish, error) {
	d, err := r.DishByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Model(&domain.Dish{}).Where("id = ?", id).
		Update("available", available).Error; err != nil {
		return nil, err
	}
	d.Available = available
	return d, nil
}

// ---- 配送区域 ----

func (r *Repo) Zones(ctx context.Context, activeOnly bool) ([]domain.Zone, error) {
	var out []domain.Zone
	q := r.db.WithContext(ctx).Order("eta_min asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	err := q.Find(&out).Error
	return out, err
}

func (r *Repo) ZoneByCode(ctx context.Context, code string) (*domain.Zone, error) {
	var z domain.Zone
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&z).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &z, nil
}

// ---- 订单 ----

func (r *Repo) ListOrders(ctx context.Context, q domain.OrderListQuery) ([]domain.OrderRow, int64, error) {
	db := r.db.WithContext(ctx)
	apply := func(tx *gorm.DB) *gorm.DB {
		if q.Status != "" {
			tx = tx.Where("o.status = ?", q.Status)
		}
		if q.ZoneCode != "" {
			tx = tx.Where("o.zone_code = ?", q.ZoneCode)
		}
		if q.Search != "" {
			like := "%" + escapeLike(q.Search) + "%"
			tx = tx.Where("(o.recipient LIKE ? ESCAPE '\\' OR o.order_no LIKE ? ESCAPE '\\')", like, like)
		}
		return tx
	}
	countSrc := apply(db.Table("orders AS o"))
	var total int64
	if err := countSrc.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.OrderRow
	err := apply(db.Table("orders AS o").
		Select("o.*, z.name AS zone_name, z.eta_min AS zone_eta_min").
		Joins("JOIN zones z ON z.code = o.zone_code")).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", o.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).Scan(&rows).Error
	return rows, total, err
}

func (r *Repo) OrderByID(ctx context.Context, id int64) (*domain.OrderRow, error) {
	var row domain.OrderRow
	err := r.db.WithContext(ctx).Table("orders AS o").
		Select("o.*, z.name AS zone_name, z.eta_min AS zone_eta_min").
		Joins("JOIN zones z ON z.code = o.zone_code").
		Where("o.id = ?", id).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

func (r *Repo) OrderItems(ctx context.Context, orderID int64) ([]domain.OrderItem, error) {
	var out []domain.OrderItem
	err := r.db.WithContext(ctx).Where("order_id = ?", orderID).Order("id asc").Find(&out).Error
	return out, err
}

type PlaceOrderDraft struct {
	Order domain.Order
	Items []domain.OrderItem
}

// PlaceOrder 在单事务里查重订单号并写入订单 + 明细；金额恒等式在调用方（service）算好后传入。
// 注意：连接池只有 1 条连接，事务内的任何查询都必须走 tx，绝不能碰 r.db（否则自锁）。
func (r *Repo) PlaceOrder(ctx context.Context, draft *PlaceOrderDraft, placedAt time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		o := &draft.Order
		for attempt := 0; attempt < 5; attempt++ {
			err := tx.Create(o).Error
			if err == nil {
				break
			}
			if !strings.Contains(strings.ToLower(err.Error()), "unique") {
				return err
			}
			o.ID = 0
			var n int64
			prefix := "FD" + placedAt.Format("20060102") + "-%"
			if serr := tx.Model(&domain.Order{}).
				Where("order_no LIKE ? ESCAPE '\\'", prefix).Count(&n).Error; serr != nil {
				return serr
			}
			o.OrderNo = FormatOrderNo(placedAt, int(n)+attempt+1)
			if attempt == 4 {
				return domain.Wrap("conflict", "订单号生成冲突，请重试", 409, err)
			}
		}
		for i := range draft.Items {
			draft.Items[i].OrderID = o.ID
		}
		return tx.Create(&draft.Items).Error
	})
}

func FormatOrderNo(t time.Time, seq int) string {
	return fmt.Sprintf("FD%s-%04d", t.Format("20060102"), seq)
}

func (r *Repo) DailySeq(ctx context.Context, day time.Time) (int, error) {
	prefix := "FD" + day.Format("20060102") + "-"
	var n int64
	err := r.db.WithContext(ctx).Model(&domain.Order{}).
		Where("order_no LIKE ? ESCAPE '\\'", prefix+"%").Count(&n).Error
	return int(n), err
}

// AdvanceOrder 在事务内读当前状态并判定状态机，非法跳转 409。
func (r *Repo) AdvanceOrder(ctx context.Context, id int64, to string) (*domain.OrderRow, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var o domain.Order
		if err := tx.First(&o, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if o.Status == to {
			return domain.New("already_in_state", "订单已处于该状态", 409)
		}
		if !domain.CanAdvance(o.Status, to) {
			return domain.New("invalid_transition",
				fmt.Sprintf("不允许 %s → %s 的状态跳转", o.Status, to), 409)
		}
		return tx.Model(&domain.Order{}).Where("id = ?", id).
			Updates(map[string]any{"status": to, "updated_at": time.Now().UTC()}).Error
	})
	if err != nil {
		return nil, err
	}
	return r.OrderByID(ctx, id)
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("dishes").Count(&n).Error
	return n > 0, err
}
