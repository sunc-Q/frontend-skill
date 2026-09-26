package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"flea/internal/domain"
)

type Repo struct {
	db *gorm.DB
	// MinIncrementCent：改价一次的加价阶梯（分）。
	MinIncrementCent int64
	// OfferTTL：出价的有效期，过期后在「确认成交」时被判定失效。
	OfferTTL time.Duration
}

func New(db *gorm.DB) *Repo {
	return &Repo{db: db, MinIncrementCent: 2000, OfferTTL: 24 * time.Hour}
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	if err := r.db.WithContext(ctx).Model(&domain.Listing{}).Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r *Repo) Categories(ctx context.Context) ([]domain.Category, error) {
	var out []domain.Category
	err := r.db.WithContext(ctx).Order("ref_cent desc").Find(&out).Error
	return out, err
}

func (r *Repo) CategoryByCode(ctx context.Context, code string) (*domain.Category, error) {
	var c domain.Category
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repo) CreateCategory(ctx context.Context, c *domain.Category) error {
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *Repo) ListingByCode(ctx context.Context, code string) (*domain.Listing, error) {
	var l domain.Listing
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&l).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// ListingCodeByID：出价单只带 listing_id，终审时要先还原成人类可读的挂单编号。
func (r *Repo) ListingCodeByID(ctx context.Context, id int64) (string, error) {
	var l domain.Listing
	if err := r.db.WithContext(ctx).Select("code").Where("id = ?", id).First(&l).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", domain.ErrNotFound
		}
		return "", err
	}
	return l.Code, nil
}

func (r *Repo) CreateListing(ctx context.Context, l *domain.Listing) error {
	err := r.db.WithContext(ctx).Create(l).Error
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return domain.Wrap("conflict", "挂单编号已存在", 409, err)
	}
	return err
}

// listingsSrc：出价聚合先按 listing_id 单独成子查询，再与 listings JOIN——
// 直接把 offers LEFT JOIN 进主表会把 listings 行数放大，views/成交口径全部翻倍。
// 常量自带 FROM，所有引用处都走 Raw SQL（不再有 GORM Table() 分支，避免两种语义混用）。
const listingsSrc = `FROM (
	SELECT l.*, c.code AS category_code, c.name_zh AS category_name, c.ref_cent AS category_ref,
	       COALESCE(a.offer_count,0) AS offer_count, COALESCE(a.pending_count,0) AS pending_count
	FROM listings l
	JOIN categories c ON c.id = l.category_id
	LEFT JOIN (
		SELECT listing_id, COUNT(*) AS offer_count,
		       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
		FROM offers GROUP BY listing_id
	) a ON a.listing_id = l.id
) AS l`

const listingsSelect = `l.*, CAST(l.asking_cent * 100 / CASE WHEN l.category_ref > 0 THEN l.category_ref ELSE 1 END AS INTEGER) AS asking_ref_pct,
	CASE WHEN l.best_offer_cent >= l.floor_cent THEN 1 ELSE 0 END AS best_over_floor`

func (r *Repo) ListListings(ctx context.Context, q domain.ListQuery) ([]domain.ListingRow, int64, error) {
	where := []string{}
	args := []any{}
	if q.Status != "" {
		where = append(where, "l.status = ?")
		args = append(args, q.Status)
	}
	if q.Category != "" {
		where = append(where, "l.category_code = ?")
		args = append(args, q.Category)
	}
	if q.Condition != "" {
		where = append(where, "l.condition = ?")
		args = append(args, q.Condition)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		where = append(where, `(l.title LIKE ? ESCAPE '\' OR l.code LIKE ? ESCAPE '\' OR l.seller LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	countSQL := "SELECT COUNT(*) " + listingsSrc + clause
	if err := r.db.WithContext(ctx).Raw(countSQL, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []domain.ListingRow
	listSQL := "SELECT " + listingsSelect + " " + listingsSrc + clause +
		" ORDER BY " + q.Sort + " " + strings.ToUpper(q.Dir) + ", l.id ASC LIMIT ? OFFSET ?"
	offsetArgs := append(append([]any{}, args...), q.PageSize, q.Offset())
	if err := r.db.WithContext(ctx).Raw(listSQL, offsetArgs...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *Repo) ListingRowByCode(ctx context.Context, code string) (*domain.ListingRow, error) {
	var rows []domain.ListingRow
	sql := "SELECT " + listingsSelect + " " + listingsSrc +
		" WHERE l.code = ? LIMIT 1"
	if err := r.db.WithContext(ctx).Raw(sql, code).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	return &rows[0], nil
}

// offersSrc：同样先开窗再回接，rank_no 只用于展示顺位。
const offersSrc = `FROM (
	SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.listing_id ORDER BY o.amount_cent DESC, o.placed_at ASC, o.id ASC) AS rank_no
	FROM offers o
) AS o
JOIN listings l ON l.id = o.listing_id
JOIN categories c ON c.id = l.category_id`

const offersSelect = `o.*, l.code AS listing_code, l.title, l.status AS listing_status,
	l.asking_cent, l.floor_cent, c.name_zh AS category_name,
	CASE WHEN o.amount_cent >= l.floor_cent THEN 1 ELSE 0 END AS over_floor`

func (r *Repo) ListOffers(ctx context.Context, q domain.OfferQuery) ([]domain.OfferView, int64, error) {
	where := []string{"o.status = 'pending'"}
	args := []any{}
	if q.Status != "" {
		where = []string{"o.status = ?"}
		args = append(args, q.Status)
	}
	if q.Category != "" {
		where = append(where, "c.code = ?")
		args = append(args, q.Category)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		where = append(where, `(o.buyer LIKE ? ESCAPE '\' OR l.title LIKE ? ESCAPE '\' OR o.deal_no LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like)
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int64
	if err := r.db.WithContext(ctx).Raw("SELECT COUNT(*) "+offersSrc+clause, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.OfferView
	listSQL := "SELECT " + offersSelect + " " + offersSrc + clause +
		" ORDER BY " + q.Sort + " " + strings.ToUpper(q.Dir) + ", o.id ASC LIMIT ? OFFSET ?"
	listArgs := append(append([]any{}, args...), q.PageSize, q.Offset())
	if err := r.db.WithContext(ctx).Raw(listSQL, listArgs...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	r.annotateOffers(ctx, rows)
	return rows, total, nil
}

// OffersForListing：单条挂单的全部出价（含已成交与已过期），按金额降序。
func (r *Repo) OffersForListing(ctx context.Context, listingID int64) ([]domain.OfferView, error) {
	var rows []domain.OfferView
	sql := "SELECT " + offersSelect + ", o.rank_no AS rank " + offersSrc +
		" WHERE o.listing_id = ? ORDER BY o.amount_cent DESC, o.placed_at ASC, o.id ASC"
	if err := r.db.WithContext(ctx).Raw(sql, listingID).Scan(&rows).Error; err != nil {
		return nil, err
	}
	r.annotateOffers(ctx, rows)
	return rows, nil
}

// annotateOffers 填 is_best / rank：顺位只对 pending 有意义，
// 且「最高」必须在排除过期单之后再判定，否则过期最高价会伪装成在拍最优。
func (r *Repo) annotateOffers(ctx context.Context, rows []domain.OfferView) {
	if len(rows) == 0 {
		return
	}
	now := time.Now().UTC()
	type bestKey struct {
		listingID int64
	}
	best := map[bestKey]int64{}
	seen := map[bestKey]int{}
	for i := range rows {
		ov := &rows[i]
		live := ov.Status == domain.OfferPending && !ov.ExpiresAt.Before(now)
		if !live {
			continue
		}
		k := bestKey{ov.ListingID}
		if _, ok := best[k]; !ok || ov.AmountCent > best[k] {
			best[k] = ov.AmountCent
		}
	}
	for i := range rows {
		ov := &rows[i]
		k := bestKey{ov.ListingID}
		if ov.Status == domain.OfferPending && !ov.ExpiresAt.Before(now) && ov.AmountCent == best[k] {
			ov.IsBest = true
			seen[k]++
			if seen[k] == 1 {
				ov.Rank = 1
			} else {
				ov.Rank = seen[k]
			}
		}
	}
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

// PlaceOffer 在一个事务里完成：状态机检查 → 保底价/加价阶梯 → 顶掉旧 pending → 回写最高出价。
// 单写者连接（SetMaxOpenConns(1) + txlock immediate）要求闭包内所有读写都走 tx，
// 用 r.db 会抢同一条已被事务独占的连接而死锁。
func (r *Repo) PlaceOffer(ctx context.Context, listingCode, buyer string, amount int64, message string, now time.Time) (*domain.Offer, error) {
	var created *domain.Offer
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var l domain.Listing
		if err := tx.Where("code = ?", listingCode).First(&l).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		switch l.Status {
		case domain.ListingWithdrawn:
			return domain.New("listing_withdrawn", "该挂单已下架，不接受出价", 409)
		case domain.ListingSold:
			return domain.New("listing_sold", "该挂单已售出", 409)
		case domain.ListingReserved:
			return domain.New("listing_reserved", "该挂单已被约定锁定，等待当面交付", 409)
		}
		if amount < l.FloorCent {
			return domain.New("below_floor", "出价低于卖家保底价", 409)
		}
		if amount > l.AskingCent {
			return domain.New("above_asking", "出价不高于挂牌价，请直接按挂牌价拍下", 409)
		}

		var mine []domain.Offer
		if err := tx.Where("listing_id = ? AND buyer = ? AND status = ?", l.ID, buyer, domain.OfferPending).
			Order("amount_cent desc").Find(&mine).Error; err != nil {
			return err
		}
		if len(mine) > 0 && mine[0].AmountCent >= amount {
			need := mine[0].AmountCent + r.MinIncrementCent
			return domain.New("increment_too_small",
				"你的这笔出价仍是当前最高，改价需至少加到 "+fmtCent(need), 409)
		}

		dealNo, derr := nextDealNo(ctx, tx, now)
		if derr != nil {
			return derr
		}
		if err := tx.Model(&domain.Offer{}).
			Where("listing_id = ? AND status = ? AND amount_cent < ?", l.ID, domain.OfferPending, amount).
			Update("status", domain.OfferOutbid).Error; err != nil {
			return err
		}
		// 同一买家若还有更高的 pending（理论上已被上一段拦住），一并清掉保持口径单一。
		if len(mine) > 0 {
			if err := tx.Model(&domain.Offer{}).Where("id IN ?", offerIDs(mine)).
				Update("status", domain.OfferOutbid).Error; err != nil {
				return err
			}
		}
		offer := &domain.Offer{
			ListingID: l.ID, DealNo: dealNo, Buyer: buyer, AmountCent: amount,
			Message: message, Status: domain.OfferPending, PlacedAt: now,
			ExpiresAt: now.Add(r.OfferTTL),
		}
		if err := tx.Create(offer).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return domain.Wrap("conflict", "出价单号冲突，请重试", 409, err)
			}
			return err
		}
		// 最优价一律按「当前全部有效 pending」重算，而不是直接写新出价：
		// 新单可能低于挂单上早已存在的更高 pending（按新单写会把最优价改小）。
		var newBest int64
		if err := tx.Model(&domain.Offer{}).
			Where("listing_id = ? AND status = ? AND expires_at >= ?", l.ID, domain.OfferPending, now).
			Select("COALESCE(MAX(amount_cent),0)").Scan(&newBest).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Listing{}).Where("id = ?", l.ID).
			UpdateColumn("best_offer_cent", newBest).Error; err != nil {
			return err
		}
		created = offer
		return nil
	})
	if err != nil {
		return nil, err
	}
	return created, nil
}

// AcceptOffer：确认成交 → 挂单转 reserved，同单其它 pending 一律按「过期优先、其次被顶」清理。
// 一笔挂单最多一条 accepted（再确认 409）。
func (r *Repo) AcceptOffer(ctx context.Context, listingCode, dealNo string, now time.Time) (*domain.Listing, error) {
	var out *domain.Listing
	// 发现出价已过期时要把 expired 落库后再报错：若在事务内 return error，
	// GORM 会连带回写这次状态修正，库里就留下一笔永远翻不了身的僵尸 pending。
	var expiredID int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var l domain.Listing
		if err := tx.Where("code = ?", listingCode).First(&l).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		var target domain.Offer
		if err := tx.Where("deal_no = ? AND listing_id = ?", dealNo, l.ID).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if target.Status == domain.OfferAccepted {
			return domain.New("already_accepted", "这笔出价已经确认过了", 409)
		}
		if target.Status != domain.OfferPending {
			return domain.New("offer_not_pending", "该出价已不是待确认状态", 409)
		}
		var acceptedCount int64
		if err := tx.Model(&domain.Offer{}).Where("listing_id = ? AND status = ?", l.ID, domain.OfferAccepted).
			Count(&acceptedCount).Error; err != nil {
			return err
		}
		if acceptedCount > 0 {
			return domain.New("already_accepted", "该挂单已有一笔成交确认", 409)
		}
		if l.Status == domain.ListingSold {
			return domain.New("listing_sold", "该挂单已售出", 409)
		}
		if l.Status == domain.ListingWithdrawn {
			return domain.New("listing_withdrawn", "该挂单已下架", 409)
		}
		if target.ExpiresAt.Before(now) {
			expiredID = target.ID
			return tx.Model(&domain.Offer{}).Where("id = ?", target.ID).
				Update("status", domain.OfferExpired).Error
		}
		if err := tx.Model(&domain.Offer{}).
			Where("listing_id = ? AND status = ? AND expires_at < ?", l.ID, domain.OfferPending, now).
			Update("status", domain.OfferExpired).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Offer{}).
			Where("listing_id = ? AND status = ? AND id <> ?", l.ID, domain.OfferPending, target.ID).
			Update("status", domain.OfferOutbid).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Offer{}).Where("id = ?", target.ID).Updates(map[string]any{
			"status": domain.OfferAccepted, "decided_at": now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Listing{}).Where("id = ?", l.ID).Updates(map[string]any{
			"status": domain.ListingReserved, "best_offer_cent": target.AmountCent,
		}).Error; err != nil {
			return err
		}
		var fresh domain.Listing
		if err := tx.First(&fresh, l.ID).Error; err != nil {
			return err
		}
		out = &fresh
		return nil
	})
	if err != nil {
		return nil, err
	}
	if expiredID != 0 {
		return nil, domain.New("offer_expired", "该出价已过期，请改确认仍在有效期内的出价", 409)
	}
	return out, nil
}

// RejectOffer：卖家拒绝一笔 pending 出价，并回写该单当前最高有效出价。
func (r *Repo) RejectOffer(ctx context.Context, listingCode, dealNo string, now time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var l domain.Listing
		if err := tx.Where("code = ?", listingCode).First(&l).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		var target domain.Offer
		if err := tx.Where("deal_no = ? AND listing_id = ?", dealNo, l.ID).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if target.Status != domain.OfferPending {
			return domain.New("offer_not_pending", "只能拒绝待确认的出价", 409)
		}
		if err := tx.Model(&domain.Offer{}).Where("id = ?", target.ID).Updates(map[string]any{
			"status": domain.OfferRejected, "decided_at": now,
		}).Error; err != nil {
			return err
		}
		var best int64
		if err := tx.Model(&domain.Offer{}).
			Where("listing_id = ? AND status = ? AND expires_at >= ?", l.ID, domain.OfferPending, now).
			Select("COALESCE(MAX(amount_cent),0)").Scan(&best).Error; err != nil {
			return err
		}
		return tx.Model(&domain.Listing{}).Where("id = ?", l.ID).
			UpdateColumn("best_offer_cent", best).Error
	})
}

// OfferByDeal 单读一条出价。is_best/rank 只在「同一挂单的全体出价」上才算得准，
// 所以这里复用 OffersForListing 而不是单行查询。
func (r *Repo) OfferByDeal(ctx context.Context, dealNo string) (*domain.OfferView, error) {
	var base domain.Offer
	if err := r.db.WithContext(ctx).Where("deal_no = ?", dealNo).First(&base).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	rows, err := r.OffersForListing(ctx, base.ListingID)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].DealNo == dealNo {
			return &rows[i], nil
		}
	}
	return nil, domain.ErrNotFound
}

// nextDealNo 在事务内生成 FL-<YYMMDD>-<当日序号>。
// 计数与插入必须同处一个事务闭包：单写者连接下任何回退到 r.db 的读写都会死锁。
func nextDealNo(ctx context.Context, tx *gorm.DB, now time.Time) (string, error) {
	prefix := "FL-" + now.Format("060102") + "-"
	for attempt := 0; attempt < 5; attempt++ {
		var used int64
		if err := tx.Model(&domain.Offer{}).Where("deal_no LIKE ?", prefix+"%").
			Select("COALESCE(COUNT(*),0)").Scan(&used).Error; err != nil {
			return "", err
		}
		code := fmt.Sprintf("%s%03d", prefix, used+int64(1+attempt))
		var dup int64
		if err := tx.Model(&domain.Offer{}).Where("deal_no = ?", code).
			Select("COALESCE(COUNT(*),0)").Scan(&dup).Error; err != nil {
			return "", err
		}
		if dup > 0 {
			continue
		}
		return code, nil
	}
	return "", domain.New("deal_no_exhausted", "当日出价单号已用尽，请稍后重试", 409)
}

func offerIDs(offers []domain.Offer) []int64 {
	out := make([]int64, 0, len(offers))
	for _, o := range offers {
		out = append(out, o.ID)
	}
	return out
}

func fmtCent(v int64) string {
	neg := ""
	if v < 0 {
		neg = "-"
		v = -v
	}
	return neg + itoa(v/100) + "." + pad2(v%100)
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}

func pad2(v int64) string {
	v %= 100
	if v < 10 {
		return "0" + itoa(v)
	}
	return itoa(v)
}
