package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"flea/internal/domain"
)

// seedAt 用「真实当前时刻往前一点」：Seed 必须把所有时间归一到 UTC 且不晚于 now，
// 这样测试才真正覆盖第 11 轮那两类时间坑（混偏移导致文本排序、清晨跑落入未来）。
var seedAt = time.Now().UTC().Add(-3 * time.Hour)

func newTestRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), seedAt); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r
}

// sandboxListing 造一条全新的、没有任何历史出价的在拍挂单，价差拉得足够宽。
// 状态机测试必须用干净的靶子：seed 里的挂单本来就带着 pending，
// 拿它们当靶子时「最优价回落/回写」的期望值会被历史出价污染（本轮第一版就踩了）。
func sandboxListing(t *testing.T, r *Repo, code string) domain.ListingRow {
	t.Helper()
	ctx := context.Background()
	cat, err := r.CategoryByCode(ctx, "photo")
	if err != nil {
		t.Fatalf("CategoryByCode: %v", err)
	}
	l := domain.Listing{
		Code: code, Title: "状态机靶子：一台旧相机", CategoryID: cat.ID, Seller: "tester",
		AskingCent: 300000, FloorCent: 200000, RefCent: cat.RefCent,
		Condition: domain.ConditionGood, Area: "徐汇·田林", Status: domain.ListingAvailable,
		PostedAt: time.Now().UTC().Truncate(time.Second).Add(-time.Hour),
	}
	if err := r.CreateListing(ctx, &l); err != nil {
		t.Fatalf("CreateListing: %v", err)
	}
	row, err := r.ListingRowByCode(ctx, code)
	if err != nil {
		t.Fatalf("ListingRowByCode: %v", err)
	}
	if row.OfferCount != 0 {
		t.Fatalf("靶子应有零出价：%+v", row)
	}
	return *row
}

func TestSeedSelfConsistency(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	m, err := r.Metrics(ctx, 14)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	cases := []struct {
		name string
		got  any
		want any
	}{
		{"挂单总数 == 48", m.ListingsTotal, int64(48)},
		{"四态之和 == 挂单总数", m.Available + m.Reserved + m.Sold + m.Withdrawn, m.ListingsTotal},
		{"在售 == 可出价 + 已约定", m.ListingActive, m.Available + m.Reserved},
		{"成交笔数 == 已售出 + 待交付", m.Deals, m.Sold + m.Reserved},
		{"成交额为正（不是退化 0 元）", m.GmvCent > 0, true},
		{"均价 × 成交数 ≈ 成交额", m.AvgDealCent*m.Deals >= m.GmvCent-1 && m.AvgDealCent*m.Deals <= m.GmvCent+1, true},
		{"品类挂单之和 == 总数", sumListings(m.ByCategory), m.ListingsTotal},
		{"品类成交之和 == 总成交额", sumGmv(m.ByCategory), m.GmvCent},
		{"日桶数量 == 窗口天数", len(m.Daily), 14},
		{"对账徽标为绿", m.IdentityOK, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Fatalf("got %v want %v", tc.got, tc.want)
			}
		})
	}

	// 「这一单收钱了吗」型边界：过期但仍 pending 的出价不得被回写成最优价。
	// FS-1004 是唯一只有 stale_pending 的在拍挂单，best_offer_cent 必须保持 0。
	row, err := r.ListingRowByCode(ctx, "FS-1004")
	if err != nil {
		t.Fatalf("FS-1004: %v", err)
	}
	if row.BestOfferCent != 0 {
		t.Errorf("过期出价被算进最优价：best=%d", row.BestOfferCent)
	}
	if row.PendingCount == 0 {
		t.Error("FS-1004 应保留一笔过期 pending 样本")
	}
	if m.ExpiredPending == 0 {
		t.Error("指标里应能看到过期 pending 的条数")
	}
	zero, err := r.ListingRowByCode(ctx, "FS-1003")
	if err != nil {
		t.Fatalf("FS-1003: %v", err)
	}
	if zero.OfferCount != 0 || zero.BestOfferCent != 0 {
		t.Errorf("零出价样本被污染：%+v", zero)
	}
	if m.BestBidYieldPct <= 0 || m.BestBidYieldPct > 100 {
		t.Errorf("有价率异常：%d", m.BestBidYieldPct)
	}
}

// 时间口径：库里不得出现带偏移的 datetime 文本，也不得有任何时刻晚于 seed 的 now。
func TestSeedTimelineNormalizedAndNeverInFuture(t *testing.T) {
	r := newTestRepo(t)
	db := r.db.WithContext(context.Background())
	cut := seedAt.UTC().Format("2006-01-02 15:04:05")
	// 用 SUBSTR 取前 19 位比较，而不是拿 cut 拼上 '+00:00'：
	// 落库文本带后缀（可能还带小数秒），直接和 19 位串比会让「恰好等于 now」那一行假报未来。
	cases := []struct{ name, sql string }{
		// 驱动把 UTC 时间写成 "...+00:00" 文本。危险的不是后缀本身，而是混着
		// +08:00 / Z 两种写法——那时 ORDER BY 会退化成字符串排序（第 11 轮）。
		{"挂单时间后缀不统一", `SELECT COUNT(*) FROM listings WHERE posted_at NOT LIKE '%+00:00'`},
		{"出价时间后缀不统一", `SELECT COUNT(*) FROM offers WHERE placed_at NOT LIKE '%+00:00'`},
		{"挂单时间长度不齐", `SELECT COUNT(*) FROM listings WHERE LENGTH(posted_at) <> (SELECT LENGTH(MAX(posted_at)) FROM listings)`},
		{"挂单在未来", `SELECT COUNT(*) FROM listings WHERE SUBSTR(posted_at,1,19) > '` + cut + `'`},
		{"出价在未来", `SELECT COUNT(*) FROM offers WHERE SUBSTR(placed_at,1,19) > '` + cut + `'`},
		{"判定在未来", `SELECT COUNT(*) FROM offers WHERE decided_at IS NOT NULL AND SUBSTR(decided_at,1,19) > '` + cut + `'`},
		{"金额非正的出价", `SELECT COUNT(*) FROM offers WHERE amount_cent <= 0`},
		{"有效期不晚于下单", `SELECT COUNT(*) FROM offers WHERE expires_at <= placed_at`},
		{"成交却无判定时间", `SELECT COUNT(*) FROM offers WHERE status = 'accepted' AND decided_at IS NULL`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var n int64
			if err := db.Raw(tc.sql).Scan(&n).Error; err != nil {
				t.Fatalf("query: %v", err)
			}
			if n != 0 {
				t.Fatalf("命中 %d 行，期望 0（%s）", n, tc.sql)
			}
		})
	}
	var latest time.Time
	if err := db.Raw(`SELECT posted_at FROM listings ORDER BY posted_at DESC LIMIT 1`).Scan(&latest).Error; err != nil {
		t.Fatalf("latest: %v", err)
	}
	rows, _, err := r.ListListings(context.Background(),
		domain.ParseListQuery(map[string][]string{"sort": {"posted"}, "dir": {"desc"}, "page_size": {"5"}}))
	if err != nil {
		t.Fatalf("ListListings: %v", err)
	}
	if len(rows) == 0 {
		t.Fatal("列表为空")
	}
	// SQL 侧文本排序取到的首行，必须与 Go 侧解码出的同一时刻一致：
	// 混了偏移量时 ORDER BY 会按字符串抢先，这里就会分叉（第 11 轮）。
	if got, want := rows[0].PostedAt.UTC().Format("2006-01-02 15:04:05"), latest.UTC().Format("2006-01-02 15:04:05"); got != want {
		t.Errorf("排序首行与 SQL 最大值不一致：%s vs %s", got, want)
	}
}

// 每个白名单排序列都真跑一遍：别名指错只有执行才能暴露（第 6 轮）。
func TestEverySortColumnExecutes(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	for _, key := range []string{"posted", "asking", "best", "offers", "views", "code", "status", "id"} {
		for _, dir := range []string{"asc", "desc"} {
			q := domain.ParseListQuery(map[string][]string{"sort": {key}, "dir": {dir}, "page_size": {"7"}})
			rows, total, err := r.ListListings(ctx, q)
			if err != nil {
				t.Fatalf("sort=%s dir=%s: %v", key, dir, err)
			}
			if total == 0 || len(rows) == 0 || len(rows) > 7 {
				t.Fatalf("sort=%s 结果异常：total=%d rows=%d", key, total, len(rows))
			}
			if rows[0].CategoryCode == "" || rows[0].CategoryName == "" {
				t.Fatalf("sort=%s：JOIN 视图缺品类字段", key)
			}
		}
	}
	for _, key := range []string{"placed", "amount", "expires", "deal", "status", "id"} {
		q := domain.ParseOfferQuery(map[string][]string{"sort": {key}, "page_size": {"9"}})
		rows, _, err := r.ListOffers(ctx, q)
		if err != nil {
			t.Fatalf("deal sort=%s: %v", key, err)
		}
		if len(rows) == 0 {
			t.Fatalf("deal sort=%s 无结果", key)
		}
	}
}

func TestInjectionAndBoundaryInputsAreHarmless(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	attacks := []string{
		`'; DROP TABLE offers; --`,
		`" OR 1=1 --`,
		`%_\`,
		`1' UNION SELECT code FROM listings--`,
		strings.Repeat("镜", 5000),
		"\xed\xa0\x80",
		"FS-1001; DELETE FROM listings",
	}
	for _, s := range attacks {
		q := domain.ParseListQuery(map[string][]string{"q": {s}, "status": {s}, "sort": {s}, "category": {s}})
		if _, _, err := r.ListListings(ctx, q); err != nil {
			t.Fatalf("列表被注入串打断（%q）：%v", s, err)
		}
		oq := domain.ParseOfferQuery(map[string][]string{"q": {s}, "status": {s}, "sort": {s}})
		if _, _, err := r.ListOffers(ctx, oq); err != nil {
			t.Fatalf("出价列表被注入串打断（%q）：%v", s, err)
		}
	}
	m, err := r.Metrics(ctx, 7)
	if err != nil || m.ListingsTotal != 48 || m.OffersTotal <= 0 {
		t.Fatalf("攻击后数据被破坏：%+v err=%v", m, err)
	}
	long := domain.ParseListQuery(map[string][]string{"q": {strings.Repeat("x", 400)}})
	rows, total, err := r.ListListings(ctx, long)
	if err != nil {
		t.Fatalf("long: %v", err)
	}
	if total != 0 || len(rows) != 0 {
		t.Errorf("超长搜索不应命中：%d", total)
	}
	huge := domain.ParseListQuery(map[string][]string{"page": {"999999"}, "page_size": {"100000"}})
	rows2, _, err := r.ListListings(ctx, huge)
	if err != nil {
		t.Fatalf("huge page: %v", err)
	}
	if len(rows2) != 0 {
		t.Errorf("深分页应返回空，实得 %d 行", len(rows2))
	}
}

func TestPlaceOfferStateMatrix(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()

	target := sandboxListing(t, r, "FS-9001")
	cases := []struct {
		name     string
		code     string
		buyer    string
		amount   int64
		wantCode string // "" = 期望成功
	}{
		{"低于保底价", target.Code, "tester_a", target.FloorCent - 100, "below_floor"},
		{"等于保底价可成交", target.Code, "tester_b", target.FloorCent, ""},
		{"高于挂牌价", target.Code, "tester_c", target.AskingCent + 100, "above_asking"},
		{"同一买家不加价改价", target.Code, "tester_b", target.FloorCent, "increment_too_small"},
		{"同一买家加价成功", target.Code, "tester_b", target.FloorCent + 2000, ""},
		{"已售出挂单", "FS-1008", "tester_d", 100000, "listing_sold"},
		{"已下架挂单", "FS-1010", "tester_d", 100000, "listing_withdrawn"},
		{"已约定挂单", "FS-1006", "tester_d", 100000, "listing_reserved"},
		{"挂单不存在", "FS-9999", "tester_d", 100000, "not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			off, err := r.PlaceOffer(ctx, tc.code, tc.buyer, tc.amount, "测试留言", now)
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("期望成功，实得 %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("期望 %s，实得成功 %+v", tc.wantCode, off)
			}
			if !strings.Contains(err.Error(), tc.wantCode) {
				t.Fatalf("期望 %s，实得 %v", tc.wantCode, err)
			}
		})
	}

	row, err := r.ListingRowByCode(ctx, target.Code)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if row.BestOfferCent != target.FloorCent+2000 {
		t.Errorf("最优价未回写：%d 期望 %d", row.BestOfferCent, target.FloorCent+2000)
	}
	offers, err := r.OffersForListing(ctx, row.ID)
	if err != nil {
		t.Fatalf("offers: %v", err)
	}
	var pending, outbid int
	var bestSeen int64 = -1
	for i := range offers {
		switch offers[i].Status {
		case domain.OfferPending:
			pending++
			if offers[i].IsBest {
				bestSeen = offers[i].AmountCent
			}
		case domain.OfferOutbid:
			outbid++
		}
	}
	if pending == 0 {
		t.Error("应至少留下一笔 pending")
	}
	if bestSeen != row.BestOfferCent {
		t.Errorf("is_best 与 listing 最优价口径分叉：%d vs %d", bestSeen, row.BestOfferCent)
	}
	if outbid == 0 {
		t.Error("被顶掉的旧出价未标记 outbid")
	}
	if n := countBest(offers); n > 1 {
		t.Errorf("is_best 出现 %d 笔", n)
	}
	seen := map[string]bool{}
	for _, o := range offers {
		if seen[o.DealNo] {
			t.Errorf("出价单号重复：%s", o.DealNo)
		}
		seen[o.DealNo] = true
	}
}

func TestAcceptAndRejectMachine(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	now := time.Now().UTC()

	tb := sandboxListing(t, r, "FS-9002")
	first, err := r.PlaceOffer(ctx, tb.Code, "buyer_one", tb.FloorCent, "第一笔", now)
	if err != nil {
		t.Fatalf("PlaceOffer 1: %v", err)
	}
	second, err := r.PlaceOffer(ctx, tb.Code, "buyer_two", tb.FloorCent+30000, "第二笔", now)
	if err != nil {
		t.Fatalf("PlaceOffer 2: %v", err)
	}
	if second.DealNo == first.DealNo {
		t.Fatalf("两笔出价单号相同：%s", first.DealNo)
	}
	l, err := r.AcceptOffer(ctx, tb.Code, second.DealNo, now)
	if err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if l.Status != domain.ListingReserved {
		t.Errorf("确认后状态=%s 期望 reserved", l.Status)
	}
	offers, _ := r.OffersForListing(ctx, l.ID)
	states := map[string]string{}
	for _, o := range offers {
		states[o.DealNo] = o.Status
	}
	if states[second.DealNo] != domain.OfferAccepted {
		t.Errorf("目标出价状态=%s", states[second.DealNo])
	}
	if states[first.DealNo] != domain.OfferOutbid {
		t.Errorf("另一笔 pending 未清理：%s", states[first.DealNo])
	}
	if _, err := r.AcceptOffer(ctx, tb.Code, second.DealNo, now); err == nil ||
		!strings.Contains(err.Error(), "already_accepted") {
		t.Errorf("重复确认应 already_accepted，实得 %v", err)
	}
	if _, err := r.AcceptOffer(ctx, tb.Code, first.DealNo, now); err == nil ||
		!strings.Contains(err.Error(), "offer_not_pending") {
		t.Errorf("确认非 pending 出价应 offer_not_pending，实得 %v", err)
	}

	// 过期 pending：确认时判定失效并落库为 expired
	staleRow, err := r.ListingRowByCode(ctx, "FS-1004")
	if err != nil {
		t.Fatalf("FS-1004: %v", err)
	}
	staleList, err := r.OffersForListing(ctx, staleRow.ID)
	if err != nil || len(staleList) == 0 {
		t.Fatalf("stale offers: %v", err)
	}
	staleDeal := ""
	for _, o := range staleList {
		if o.Status == domain.OfferPending && o.ExpiresAt.Before(now) {
			staleDeal = o.DealNo
		}
	}
	if staleDeal == "" {
		t.Fatal("找不到过期 pending 样本")
	}
	if _, err := r.AcceptOffer(ctx, "FS-1004", staleDeal, now.Add(10*time.Hour)); err == nil ||
		!strings.Contains(err.Error(), "offer_expired") {
		t.Errorf("确认过期出价应 offer_expired，实得 %v", err)
	}
	after, err := r.OfferByDeal(ctx, staleDeal)
	if err != nil {
		t.Fatalf("OfferByDeal: %v", err)
	}
	if after.Status != domain.OfferExpired {
		t.Errorf("过期单状态未落库：%s", after.Status)
	}

	// 拒绝一笔 pending：最优价回落到次高，挂单继续在拍。
	// 先高的那笔必须排在前面——低价不会把高价顶掉，反过来则会把低价标成 outbid，
	// 顺序错了就只剩一笔 pending，测不到「回落」。
	target := sandboxListing(t, r, "FS-9003")
	b, err := r.PlaceOffer(ctx, target.Code, "rej_b", target.FloorCent+4000, "B", now)
	if err != nil {
		t.Fatalf("place B: %v", err)
	}
	a, err := r.PlaceOffer(ctx, target.Code, "rej_a", target.FloorCent, "A", now)
	if err != nil {
		t.Fatalf("place A: %v", err)
	}
	if mid, err := r.ListingRowByCode(ctx, target.Code); err != nil || mid.BestOfferCent != b.AmountCent {
		t.Fatalf("低价出价不应压低最优价：%+v err=%v", mid, err)
	}
	if err := r.RejectOffer(ctx, target.Code, b.DealNo, now); err != nil {
		t.Fatalf("reject: %v", err)
	}
	after2, err := r.ListingRowByCode(ctx, target.Code)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if after2.Status != domain.ListingAvailable {
		t.Errorf("拒绝不应改变挂单状态：%s", after2.Status)
	}
	if after2.BestOfferCent != a.AmountCent {
		t.Errorf("拒绝后最优价未回落：%d 期望 %d", after2.BestOfferCent, a.AmountCent)
	}
	if err := r.RejectOffer(ctx, target.Code, b.DealNo, now); err == nil ||
		!strings.Contains(err.Error(), "offer_not_pending") {
		t.Errorf("重复拒绝应 409，实得 %v", err)
	}
}

func TestAcceptedUniquenessInvariants(t *testing.T) {
	r := newTestRepo(t)
	db := r.db.WithContext(context.Background())
	cases := []struct{ name, sql string }{
		{"一条挂单多笔成交", `SELECT COUNT(*) FROM (SELECT listing_id FROM offers WHERE status='accepted'
			GROUP BY listing_id HAVING COUNT(*)>1) x`},
		{"成交/约定挂单缺成交记录", `SELECT COUNT(*) FROM listings l WHERE l.status IN ('sold','reserved')
			AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.listing_id=l.id AND o.status='accepted')`},
		{"在拍挂单带成交记录", `SELECT COUNT(*) FROM listings l JOIN offers o ON o.listing_id=l.id
			WHERE l.status='available' AND o.status='accepted'`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var n int64
			if err := db.Raw(tc.sql).Scan(&n).Error; err != nil {
				t.Fatalf("query: %v", err)
			}
			if n != 0 {
				t.Fatalf("命中 %d 行：%s", n, tc.sql)
			}
		})
	}
}

func TestHardenKeepsDataReadable(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/app.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), seedAt); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if err := Harden(path); err != nil {
		t.Fatalf("Harden: %v", err)
	}
	var n int64
	if err := r.db.Raw("SELECT COUNT(*) FROM listings").Scan(&n).Error; err != nil || n != 48 {
		t.Fatalf("Harden 后数据不可读：%d err=%v", n, err)
	}
}

func sumListings(rows []domain.CategoryRollup) int64 {
	var n int64
	for _, r := range rows {
		n += r.Listings
	}
	return n
}

func sumGmv(rows []domain.CategoryRollup) int64 {
	var n int64
	for _, r := range rows {
		n += r.GmvCent
	}
	return n
}

func countBest(offers []domain.OfferView) int {
	n := 0
	for _, o := range offers {
		if o.IsBest {
			n++
		}
	}
	return n
}
