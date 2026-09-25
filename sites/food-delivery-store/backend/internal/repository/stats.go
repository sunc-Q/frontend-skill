package repository

import (
	"context"
	"time"

	"bizsite/internal/domain"
)

const liveOrderFilter = "status != 'cancelled'"

// Stats 汇总口径全部来自 orders / order_items 两张表（明细再关联 dishes），
// GMV 一律剔除 cancelled；分类单量用 COUNT(DISTINCT o.id) 防止 JOIN 放大。
func (r *Repo) Stats(ctx context.Context) (*domain.Stats, error) {
	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}
	s := &domain.Stats{
		ByStatus:    map[string]int64{},
		GeneratedAt: time.Now().UTC(),
		Window:      "全部历史（种子覆盖最近 5 天营业窗口），GMV 剔除已取消",
	}

	type kv struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var statuses []kv
	if err := scan(&statuses, `SELECT status AS k, COUNT(*) AS v FROM orders GROUP BY status`); err != nil {
		return nil, err
	}
	for _, row := range statuses {
		s.ByStatus[row.K] += row.V
		s.OrdersTotal += row.V
	}

	todayStart := time.Now().UTC().Truncate(24 * time.Hour)
	if err := scan(&s.TodayOrders, `SELECT COUNT(*) FROM orders WHERE placed_at >= ? AND `+liveOrderFilter, todayStart); err != nil {
		return nil, err
	}
	if err := scan(&s.TodayGMVCents, `SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE placed_at >= ? AND `+liveOrderFilter, todayStart); err != nil {
		return nil, err
	}
	var gmv struct {
		Sum  int64   `gorm:"column:sum"`
		N    int64   `gorm:"column:n"`
		AvgP float64 `gorm:"column:avgp"`
	}
	if err := scan(&gmv, `SELECT COALESCE(SUM(total_cents),0) AS sum, COUNT(*) AS n, COALESCE(AVG(prep_minutes),0) AS avgp FROM orders WHERE `+liveOrderFilter); err != nil {
		return nil, err
	}
	s.GMVCents = gmv.Sum
	if gmv.N > 0 {
		s.AvgOrderCents = int64(float64(gmv.Sum)/float64(gmv.N) + 0.5)
		s.AvgPrepMin = round1(gmv.AvgP)
	}
	if s.OrdersTotal > 0 {
		s.CancelRatePct = round1(float64(s.ByStatus[domain.OrderCancelled]) * 100 / float64(s.OrdersTotal))
	}

	if err := scan(&s.TopDishes, `SELECT oi.dish_code, oi.dish_name, MAX(d.category) AS category,
		COALESCE(SUM(oi.qty),0) AS qty, COALESCE(SUM(oi.line_cents),0) AS revenue
		FROM order_items oi
		JOIN orders o ON o.id = oi.order_id AND o.`+liveOrderFilter+`
		JOIN dishes d ON d.code = oi.dish_code
		GROUP BY oi.dish_code, oi.dish_name
		ORDER BY qty DESC, revenue DESC LIMIT 6`); err != nil {
		return nil, err
	}
	if err := scan(&s.ByCategory, `SELECT d.category,
		COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.line_cents),0) AS revenue
		FROM order_items oi
		JOIN orders o ON o.id = oi.order_id AND o.`+liveOrderFilter+`
		JOIN dishes d ON d.code = oi.dish_code
		GROUP BY d.category ORDER BY revenue DESC`); err != nil {
		return nil, err
	}

	var dishKv []kv
	if err := scan(&dishKv, `SELECT 'total' AS k, COUNT(*) AS v FROM dishes UNION ALL SELECT 'open' AS k, COUNT(*) AS v FROM dishes WHERE available = 1`); err != nil {
		return nil, err
	}
	for _, row := range dishKv {
		if row.K == "total" {
			s.DishesTotal = row.V
		} else {
			s.DishesAvailable = row.V
		}
	}
	if s.TopDishes == nil {
		s.TopDishes = []domain.DishRollup{}
	}
	if s.ByCategory == nil {
		s.ByCategory = []domain.CategoryRollup{}
	}
	return s, nil
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
