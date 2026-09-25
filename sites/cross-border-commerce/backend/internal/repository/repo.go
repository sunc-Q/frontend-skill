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

const productSelect = `p.*, COALESCE(r.cnt,0) AS review_cnt, COALESCE(r.avg,0) AS rating_avg`

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

func (r *Repo) ListProducts(ctx context.Context, q domain.ListQuery) ([]domain.ProductRow, int64, error) {
	statsSub := r.db.Table("reviews").
		Select("product_id, COUNT(*) AS cnt, AVG(rating) AS avg").
		Group("product_id")

	base := r.db.WithContext(ctx).Table("products AS p").
		Joins("LEFT JOIN (?) AS r ON r.product_id = p.id", statsSub)

	if q.Category != "" {
		base = base.Where("p.category = ?", q.Category)
	}
	if q.InStock {
		base = base.Where("p.stock > 0")
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(p.name LIKE ? ESCAPE '\\' OR p.name_en LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')",
			like, like, like, like)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []domain.ProductRow
	err := base.Select(productSelect).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", p.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

func (r *Repo) ProductBySKU(ctx context.Context, sku string) (*domain.ProductRow, error) {
	statsSub := r.db.Table("reviews").
		Select("product_id, COUNT(*) AS cnt, AVG(rating) AS avg").
		Group("product_id")
	var row domain.ProductRow
	err := r.db.WithContext(ctx).Table("products AS p").
		Joins("LEFT JOIN (?) AS r ON r.product_id = p.id", statsSub).
		Select(productSelect).Where("p.sku = ?", sku).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

func (r *Repo) Reviews(ctx context.Context, productID int64, limit, offset int) ([]domain.Review, int64, error) {
	var total int64
	if err := r.db.WithContext(ctx).Where("product_id = ?", productID).
		Model(&domain.Review{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var out []domain.Review
	err := r.db.WithContext(ctx).Where("product_id = ?", productID).
		Order("posted_at desc, id desc").Limit(limit).Offset(offset).Find(&out).Error
	return out, total, err
}

// ReviewStats 返回平均分、条数与 1-5 星分布（dist[0] 为 1 星）。
func (r *Repo) ReviewStats(ctx context.Context, productID int64) (*domain.ReviewSummary, error) {
	s := &domain.ReviewSummary{Dist: []int64{0, 0, 0, 0, 0}}
	type kv struct {
		K int64 `gorm:"column:k"`
		V int64 `gorm:"column:v"`
	}
	var rows []kv
	if err := r.db.WithContext(ctx).Table("reviews").
		Select("rating AS k, COUNT(*) AS v").
		Where("product_id = ?", productID).Group("rating").Scan(&rows).Error; err != nil {
		return nil, err
	}
	var sum, cnt int64
	for _, x := range rows {
		if x.K >= 1 && x.K <= 5 {
			s.Dist[x.K-1] = x.V
			sum += x.K * x.V
			cnt += x.V
		}
	}
	s.Count = cnt
	if cnt > 0 {
		s.Avg = float64(sum) / float64(cnt)
	}
	return s, nil
}

func (r *Repo) CreateProduct(ctx context.Context, p *domain.Product) error {
	err := r.db.WithContext(ctx).Create(p).Error
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return domain.Wrap("conflict", "SKU 已存在", 409, err)
	}
	return err
}

// SetCartItem 在一个事务里按 SKU 覆盖数量（qty=0 即移出），并校验商品存在、在售与库存上限。
// 返回该 SKU 当前库存，供上层回显。
func (r *Repo) SetCartItem(ctx context.Context, sku string, qty int, now time.Time) (int, error) {
	var stock int
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var p domain.Product
		if e := tx.Where("sku = ?", sku).First(&p).Error; e != nil {
			if errors.Is(e, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return e
		}
		if qty == 0 {
			return tx.Where("product_id = ?", p.ID).Delete(&domain.CartItem{}).Error
		}
		if !p.Listed {
			return domain.New("invalid_state", "该商品已下架，无法加入购物车", 409)
		}
		if qty > p.Stock {
			return domain.Wrap("out_of_stock", "库存不足", 409, errors.New("qty>stock"))
		}
		var item domain.CartItem
		e := tx.Where("product_id = ?", p.ID).First(&item).Error
		if errors.Is(e, gorm.ErrRecordNotFound) {
			item = domain.CartItem{ProductID: p.ID, Qty: qty, AddedAt: now}
			if e := tx.Create(&item).Error; e != nil {
				return e
			}
		} else if e != nil {
			return e
		} else if e := tx.Model(&item).Update("qty", qty).Error; e != nil {
			return e
		}
		stock = p.Stock
		return nil
	})
	return stock, err
}

// Cart 读取整个购物车并回填商品快照字段。
func (r *Repo) Cart(ctx context.Context) ([]domain.CartLine, error) {
	var lines []domain.CartLine
	err := r.db.WithContext(ctx).Table("cart_items AS ci").
		Select("p.sku, p.name, ci.qty, p.price_cents, p.weight_g, p.stock, p.listed, p.price_cents * ci.qty AS line_cents").
		Joins("JOIN products p ON p.id = ci.product_id").
		Order("ci.id asc").Scan(&lines).Error
	return lines, err
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("products").Count(&n).Error
	return n > 0, err
}

type CatalogStats struct {
	Total        int64   `gorm:"column:total" json:"total"`
	Listed       int64   `gorm:"column:listed" json:"listed"`
	OutOfStock   int64   `gorm:"column:out_of_stock" json:"out_of_stock"`
	AvgRating    float64 `gorm:"column:avg_rating" json:"avg_rating"`
	Sold30Sum    int64   `gorm:"column:sold_30_sum" json:"sold_30_sum"`
	CatalogValue int64   `gorm:"column:catalog_value_cents" json:"catalog_value_cents"`
}

// Stats 为页面概览卡提供目录级口径（在售/缺货/均分/30 天销量/在售货值）。
func (r *Repo) Stats(ctx context.Context) (*CatalogStats, error) {
	var s CatalogStats
	db := r.db.WithContext(ctx)
	if err := db.Table("products").
		Select(`COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN listed THEN 1 ELSE 0 END),0) AS listed,
			COALESCE(SUM(CASE WHEN listed AND stock = 0 THEN 1 ELSE 0 END),0) AS out_of_stock,
			COALESCE(SUM(sold_30),0) AS sold_30_sum,
			COALESCE(SUM(CASE WHEN listed THEN price_cents * stock ELSE 0 END),0) AS catalog_value_cents`).
		Scan(&s).Error; err != nil {
		return nil, err
	}
	var avg *float64
	if err := db.Table("reviews").Where("rating BETWEEN 1 AND 5").
		Select("AVG(rating)").Scan(&avg).Error; err != nil {
		return nil, err
	}
	if avg != nil {
		s.AvgRating = *avg
	}
	return &s, nil
}
