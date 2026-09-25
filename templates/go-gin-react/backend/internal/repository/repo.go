package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func (r *Repo) Plans(ctx context.Context, activeOnly bool) ([]domain.Plan, error) {
	var out []domain.Plan
	q := r.db.WithContext(ctx).Order("price_monthly asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	if err := q.Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repo) PlanByCode(ctx context.Context, code string) (*domain.Plan, error) {
	var p domain.Plan
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repo) CreatePlan(ctx context.Context, p *domain.Plan) error {
	err := r.db.WithContext(ctx).Create(p).Error
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return domain.Wrap("conflict", "套餐标识已存在", 409, err)
	}
	return err
}

func (r *Repo) Subscription(ctx context.Context, id int64) (*domain.SubscriptionRow, error) {
	var row domain.SubscriptionRow
	err := r.db.WithContext(ctx).Table("subscriptions AS s").
		Select("s.*, sub.email, sub.company, p.code AS plan_code, p.name AS plan_name").
		Joins("JOIN subscribers sub ON sub.id = s.subscriber_id").
		Joins("JOIN plans p ON p.id = s.plan_id").
		Where("s.id = ?", id).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

func (r *Repo) Payments(ctx context.Context, subID int64, limit int) ([]domain.Payment, error) {
	var out []domain.Payment
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	err := r.db.WithContext(ctx).Where("subscription_id = ?", subID).
		Order("paid_at desc").Limit(limit).Find(&out).Error
	return out, err
}

func (r *Repo) ListSubscriptions(ctx context.Context, q domain.ListQuery) ([]domain.SubscriptionRow, int64, error) {
	base := r.db.WithContext(ctx).Table("subscriptions AS s").
		Joins("JOIN subscribers sub ON sub.id = s.subscriber_id").
		Joins("JOIN plans p ON p.id = s.plan_id")

	if q.Status != "" {
		base = base.Where("s.status = ?", q.Status)
	}
	if q.PlanCode != "" {
		base = base.Where("p.code = ?", q.PlanCode)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(sub.company LIKE ? ESCAPE '\\' OR sub.email LIKE ? ESCAPE '\\')", like, like)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []domain.SubscriptionRow
	err := base.Select("s.*, sub.email, sub.company, p.code AS plan_code, p.name AS plan_name").
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", s.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

// RecordRenewal 在一个事务里写支付流水并推进订阅状态。
func (r *Repo) RecordRenewal(ctx context.Context, subID int64, amount int64, period string, nextRenew time.Time, paidAt time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var s domain.Subscription
		if err := tx.First(&s, subID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if err := tx.Create(&domain.Payment{
			SubscriptionID: subID, Amount: amount, Period: period, PaidAt: paidAt,
		}).Error; err != nil {
			return err
		}
		updates := map[string]any{
			"status":          domain.StatusActive,
			"renew_at":        nextRenew,
			"last_payment_at": paidAt,
			"period":          period,
		}
		return tx.Model(&domain.Subscription{}).Where("id = ?", s.ID).Updates(updates).Error
	})
}
