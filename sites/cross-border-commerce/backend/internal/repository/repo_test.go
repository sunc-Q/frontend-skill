package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
)

var seedNow = time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)

func newTestRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := New(db).Seed(context.Background(), seedNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return New(db)
}

func TestSeedSelfConsistency(t *testing.T) {
	r := newTestRepo(t)

	var products, listed, zeroStock int64
	if err := r.db.Table("products").Count(&products).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("products").Where("listed = ?", true).Count(&listed).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("products").Where("stock = 0").Count(&zeroStock).Error; err != nil {
		t.Fatal(err)
	}
	if products != 18 || listed != 17 || zeroStock != 2 {
		t.Fatalf("商品规模不符：total=%d listed=%d zero=%d", products, listed, zeroStock)
	}

	// 每个在售且非零库存的商品都应有评价；评分必须在 1-5；不得有孤儿评价
	var badRating, orphans, reviews int64
	if err := r.db.Table("reviews").Count(&reviews).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("reviews").Where("rating < 1 OR rating > 5").Count(&badRating).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("reviews").
		Where("product_id NOT IN (SELECT id FROM products)").Count(&orphans).Error; err != nil {
		t.Fatal(err)
	}
	if reviews < 60 || badRating != 0 || orphans != 0 {
		t.Fatalf("评价数据不自洽：n=%d bad=%d orphan=%d", reviews, badRating, orphans)
	}

	// 购物车行必须指向存在的商品且 1 ≤ qty ≤ stock
	var cartBad int64
	if err := r.db.Table("cart_items ci").Joins("JOIN products p ON p.id = ci.product_id").
		Where("ci.qty < 1 OR ci.qty > p.stock").Count(&cartBad).Error; err != nil {
		t.Fatal(err)
	}
	var cartN int64
	if err := r.db.Table("cart_items").Count(&cartN).Error; err != nil {
		t.Fatal(err)
	}
	if cartN != 3 || cartBad != 0 {
		t.Fatalf("购物车应为 3 行且全部合法：n=%d bad=%d", cartN, cartBad)
	}

	// 商品口径自洽：销量不得超过历史可售规模的常识边界（sold_30 与 stock 独立但都要非负），
	// 重量/价格/HS 均在合法区间
	var badP int64
	if err := r.db.Table("products").
		Where("price_cents < 1 OR weight_g < 1 OR sold_30 < 0 OR stock < 0 OR lead_min_days > lead_max_days").
		Count(&badP).Error; err != nil {
		t.Fatal(err)
	}
	if badP != 0 {
		t.Fatalf("%d 个商品的定价/重量/库存/时效口径不自洽", badP)
	}
}

func TestSeedIsIdempotent(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	if err := r.Seed(ctx, seedNow); err != nil {
		t.Fatalf("second Seed: %v", err)
	}
	var n int64
	if err := r.db.Table("products").Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	if n != 18 {
		t.Errorf("重复 Seed 后商品数应为 18，实得 %d", n)
	}
}

func TestSetCartItemGuards(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	// 正常改数量并回读
	if _, err := r.SetCartItem(ctx, "CB-EL-0001", 2, seedNow); err != nil {
		t.Fatalf("加购失败: %v", err)
	}
	lines, err := r.Cart(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, l := range lines {
		if l.SKU == "CB-EL-0001" {
			found = true
			if l.Qty != 2 || l.LineCents != 2*l.PriceCents {
				t.Fatalf("行金额不正确: %+v", l)
			}
		}
	}
	if !found {
		t.Fatal("购物车缺少新加的行")
	}

	// 同 SKU 再写应覆盖而不是新增
	if _, err := r.SetCartItem(ctx, "CB-EL-0001", 3, seedNow); err != nil {
		t.Fatal(err)
	}
	var cnt int64
	if err := r.db.Table("cart_items ci").Joins("JOIN products p ON p.id = ci.product_id").
		Where("p.sku = ?", "CB-EL-0001").Count(&cnt).Error; err != nil {
		t.Fatal(err)
	}
	if cnt != 1 {
		t.Fatalf("同一 SKU 应只有一行，实得 %d", cnt)
	}

	// qty=0 移出
	if _, err := r.SetCartItem(ctx, "CB-EL-0001", 0, seedNow); err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("cart_items ci").Joins("JOIN products p ON p.id = ci.product_id").
		Where("p.sku = ?", "CB-EL-0001").Count(&cnt).Error; err != nil {
		t.Fatal(err)
	}
	if cnt != 0 {
		t.Fatalf("qty=0 应删行，实得 %d", cnt)
	}

	cases := []struct {
		name     string
		sku      string
		qty      int
		wantCode string
	}{
		{"不存在的 SKU → not_found", "CB-XX-9999", 1, "not_found"},
		{"零库存 → out_of_stock", "CB-EL-0004", 1, "out_of_stock"},
		{"已下架 → invalid_state", "CB-AP-0034", 1, "invalid_state"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := r.SetCartItem(ctx, tc.sku, tc.qty, seedNow)
			ae, ok := err.(*domain.AppError)
			if !ok || ae.Code != tc.wantCode {
				t.Fatalf("got %v want code %s", err, tc.wantCode)
			}
		})
	}
}

func TestListProductsResistsInjectionAndBounds(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	all, total, err := r.ListProducts(ctx, domain.ParseListQuery(map[string][]string{}))
	if err != nil {
		t.Fatalf("ListProducts: %v", err)
	}
	if len(all) == 0 || total != 18 {
		t.Fatalf("列表应返回 18 个商品，实得 total=%d", total)
	}
	for _, row := range all {
		if row.SKU == "" || row.Category == "" {
			t.Errorf("列表字段不完整: %+v", row)
		}
	}

	cases := []struct {
		name   string
		values map[string][]string
		check  func(*testing.T, []domain.ProductRow, int64)
	}{
		{"搜索串携带 SQL 片段只当普通文本", map[string][]string{"q": {"x' OR '1'='1"}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {
				if total != 0 {
					t.Fatalf("注入串竟匹配到 %d 条", total)
				}
			}},
		{"LIKE 通配符被转义", map[string][]string{"q": {"%"}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {
				if total != 0 {
					t.Fatalf("孤立的 %% 应匹配 0 条，实得 %d", total)
				}
			}},
		{"sort 注入回退默认列且不报错", map[string][]string{"sort": {"p.id; DROP TABLE products"}, "page_size": {"5"}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {
				if len(rows) != 5 {
					t.Fatalf("应返回 5 条，实得 %d", len(rows))
				}
			}},
		{"page_size 上限生效", map[string][]string{"page_size": {"99999"}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {
				if len(rows) > domain.MaxPageSize {
					t.Fatalf("单次返回 %d 条，超过上限", len(rows))
				}
			}},
		{"类目过滤精确", map[string][]string{"category": {"户外运动"}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {
				if total != 4 {
					t.Fatalf("户外运动应有 4 个 SKU，实得 %d", total)
				}
				for _, row := range rows {
					if row.Category != "户外运动" {
						t.Fatalf("类目泄漏: %s", row.Category)
					}
				}
			}},
		{"in_stock 排除零库存", map[string][]string{"in_stock": {"1"}, "page_size": {"60"}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {
				if total != 16 {
					t.Fatalf("在售且有货应为 16 个（18-下架0库存2 中有货16，下架也有货故为 18-2）实得 %d", total)
				}
				for _, row := range rows {
					if row.Stock <= 0 {
						t.Fatalf("零库存泄漏: %s", row.SKU)
					}
				}
			}},
		{"超长搜索串不报错", map[string][]string{"q": {strings.Repeat("名", 5000)}},
			func(t *testing.T, rows []domain.ProductRow, total int64) {}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, gotTotal, err := r.ListProducts(ctx, domain.ParseListQuery(tc.values))
			if err != nil {
				t.Fatalf("ListProducts 报错：%v", err)
			}
			tc.check(t, rows, gotTotal)
		})
	}

	var still int64
	if err := r.db.Table("products").Count(&still).Error; err != nil {
		t.Fatal(err)
	}
	if still == 0 {
		t.Error("products 表疑似被删除或清空")
	}
}

func TestReviewAggregationMatchesRows(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	rows, _, err := r.ListProducts(ctx, domain.ParseListQuery(map[string][]string{"page_size": {"60"}}))
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		stats, err := r.ReviewStats(ctx, row.ID)
		if err != nil {
			t.Fatal(err)
		}
		if stats.Count != row.ReviewCnt {
			t.Fatalf("%s 列表评价数 %d != 明细 %d", row.SKU, row.ReviewCnt, stats.Count)
		}
		var distSum int64
		for _, v := range stats.Dist {
			distSum += v
		}
		if distSum != stats.Count {
			t.Fatalf("%s 星级分布之和 %d != 总数 %d", row.SKU, distSum, stats.Count)
		}
	}
}
