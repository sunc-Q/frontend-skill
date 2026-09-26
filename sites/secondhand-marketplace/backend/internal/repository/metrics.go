package repository

import (
	"context"
	"strconv"
	"time"

	"flea/internal/domain"
)

// Metrics 汇总口径全部来自 listings / offers 两张表，前端不做二次计算。
//
// 三条跨字段不变量（repo_test 逐条钉死，任一条被 JOIN 放大破坏就会红）：
//  1. Sold == Deals == COUNT(offers.status=accepted)
//  2. GmvCent == SUM(accepted.amount_cent) == SUM(by_category.gmv_cent)
//  3. SUM(by_category.listings) == ListingsTotal（挂单数不被成交放大的唯一哨兵）
//
// 另有一条「退化区间」哨兵：BestBidYieldPct 只在存在带有效 pending 出价的挂单时才非 0，
// 它对 expired 的 pending 出价免疫（口径 = 有效期未过），所以过期单灌进来了指标也不会虚高。
func (r *Repo) Metrics(ctx context.Context, days int) (*domain.Metrics, error) {
	if days < 3 {
		days = 7
	}
	if days > 30 {
		days = 30
	}
	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}

	now := time.Now().UTC()
	m := &domain.Metrics{GeneratedAt: now}

	type kv struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var statuses []kv
	if err := scan(&statuses, `SELECT status AS k, COUNT(*) AS v FROM listings GROUP BY status`); err != nil {
		return nil, err
	}
	for _, s := range statuses {
		switch s.K {
		case domain.ListingAvailable:
			m.Available = s.V
		case domain.ListingReserved:
			m.Reserved = s.V
		case domain.ListingSold:
			m.Sold = s.V
		case domain.ListingWithdrawn:
			m.Withdrawn = s.V
		}
	}
	m.ListingActive = m.Available + m.Reserved
	if err := scan(&m.ListingsTotal, `SELECT COUNT(*) FROM listings`); err != nil {
		return nil, err
	}

	var offerStats []kv
	if err := scan(&offerStats, `SELECT status AS k, COUNT(*) AS v FROM offers GROUP BY status`); err != nil {
		return nil, err
	}
	for _, s := range offerStats {
		switch s.K {
		case domain.OfferPending:
			m.OffersPending = s.V
		case domain.OfferAccepted:
			m.Deals = s.V
		}
	}
	if err := scan(&m.OffersTotal, `SELECT COUNT(*) FROM offers`); err != nil {
		return nil, err
	}
	// 过期但仍挂着 pending 的出价：页面上的「需要清理」信号，口径与 yield 互斥。
	if err := scan(&m.ExpiredPending,
		`SELECT COUNT(*) FROM offers WHERE status = 'pending' AND expires_at < ?`, now); err != nil {
		return nil, err
	}
	if err := scan(&m.OffersPending,
		`SELECT COUNT(*) FROM offers WHERE status = 'pending' AND expires_at >= ?`, now); err != nil {
		return nil, err
	}

	if err := scan(&m.GmvCent,
		`SELECT COALESCE(SUM(amount_cent),0) FROM offers WHERE status = 'accepted'`); err != nil {
		return nil, err
	}
	if m.Deals > 0 {
		m.AvgDealCent = divRound(m.GmvCent, m.Deals)
	}

	cut := now.Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))
	m.Today = now.Format("2006-01-02")
	m.Window = strconv.Itoa(days) + " 天"
	if err := scan(&m.Gmv7Cent,
		`SELECT COALESCE(SUM(amount_cent),0) FROM offers WHERE status = 'accepted' AND decided_at >= ?`, cut); err != nil {
		return nil, err
	}
	if err := scan(&m.Deals7,
		`SELECT COUNT(*) FROM offers WHERE status = 'accepted' AND decided_at >= ?`, cut); err != nil {
		return nil, err
	}

	var inFlight struct {
		WithOffer int64 `gorm:"column:w"`
		All       int64 `gorm:"column:a"`
	}
	if err := scan(&inFlight,
		`SELECT COALESCE(SUM(CASE WHEN best_offer_cent > 0 THEN 1 ELSE 0 END),0) AS w, COUNT(*) AS a
		 FROM listings WHERE status IN ('available','reserved')`); err != nil {
		return nil, err
	}
	if inFlight.All > 0 {
		m.BestBidYieldPct = int(round1(float64(inFlight.WithOffer) * 100 / float64(inFlight.All)))
	}

	if err := scan(&m.Daily, `
		SELECT b.day AS day,
		       COALESCE(p.n,0) AS posted,
		       COALESCE(o.n,0) AS offers,
		       COALESCE(d.n,0) AS deals,
		       COALESCE(d.amt,0) AS gmv_cent
		FROM (SELECT date(?) AS day
		      UNION ALL SELECT date(?, '+' || k || ' days') FROM (
		        WITH RECURSIVE t(k) AS (SELECT 1 UNION ALL SELECT k+1 FROM t WHERE k < ?) SELECT k FROM t
		      ) s) b
		LEFT JOIN (SELECT date(posted_at) AS day, COUNT(*) AS n FROM listings GROUP BY day) p ON p.day = b.day
		LEFT JOIN (SELECT date(placed_at) AS day, COUNT(*) AS n FROM offers GROUP BY day) o ON o.day = b.day
		LEFT JOIN (SELECT date(decided_at) AS day, COUNT(*) AS n, SUM(amount_cent) AS amt
		           FROM offers WHERE status = 'accepted' GROUP BY day) d ON d.day = b.day
		ORDER BY b.day`,
		cut, cut, days-1); err != nil {
		return nil, err
	}

	// 每个品类的聚合先各自成子查询再按 category_id 回接：
	// offers 与 listings 放进同一条 LEFT JOIN 会让成交额的被行数放大。
	if err := scan(&m.ByCategory, `
		SELECT c.id AS category_id, c.code AS category_code, c.name_zh AS category_name, c.ref_cent AS ref_cent,
		       COALESCE(l.n,0) AS listings, COALESCE(l.sold,0) AS sold,
		       COALESCE(g.amt,0) AS gmv_cent,
		       CAST(CASE WHEN COALESCE(g.n,0) > 0 THEN g.amt / g.n ELSE 0 END AS INTEGER) AS avg_deal_cent,
		       COALESCE(b.amt,0) AS best_offer_cent
		FROM categories c
		LEFT JOIN (SELECT category_id, COUNT(*) AS n,
		             SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold
		           FROM listings GROUP BY category_id) l ON l.category_id = c.id
		LEFT JOIN (SELECT li.category_id AS category_id, SUM(o.amount_cent) AS amt, COUNT(*) AS n
		           FROM offers o JOIN listings li ON li.id = o.listing_id
		           WHERE o.status = 'accepted' GROUP BY li.category_id) g ON g.category_id = c.id
		LEFT JOIN (SELECT li.category_id AS category_id, MAX(o.amount_cent) AS amt
		           FROM offers o JOIN listings li ON li.id = o.listing_id
		           WHERE o.status = 'pending' GROUP BY li.category_id) b ON b.category_id = c.id
		ORDER BY c.ref_cent DESC, c.id ASC`); err != nil {
		return nil, err
	}

	var sumCatListings, sumCatGmv int64
	for _, cb := range m.ByCategory {
		sumCatListings += cb.Listings
		sumCatGmv += cb.GmvCent
	}
	// 口径：一笔 accepted 出价 == 一条「已成交或已约定待交付」的挂单，所以
	// Deals == Sold + Reserved；成交额按 accepted 计，因此品类之和必须等于总额。
	m.IdentityOK = m.Sold+m.Reserved == m.Deals &&
		m.GmvCent == sumCatGmv && sumCatListings == m.ListingsTotal && m.GmvCent > 0
	if !m.IdentityOK {
		m.IdentityNote = "成交笔数与(已售出+待交付)不符，或品类汇总与总额不匹配（检查 JOIN 放大）"
	}
	return m, nil
}

func divRound(a, b int64) int64 {
	if b == 0 {
		return 0
	}
	return (a + b/2) / b
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}
