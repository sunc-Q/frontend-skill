package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
)

func newTestRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := New(db).Seed(context.Background(), time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return New(db)
}

func TestSeedSelfConsistency(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	m, err := r.Metrics(ctx, 9)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	cases := []struct {
		name string
		got  any
		want any
	}{
		{"状态计数之和 == 订阅总数", m.ActiveSubs + m.TrialingSubs + m.PastDueSubs + m.CanceledSubs, int64(126)},
		{"订阅者数 == 订阅数（一对一 seed）", m.TotalSubscribers, m.ActiveSubs + m.TrialingSubs + m.PastDueSubs + m.CanceledSubs},
		{"ARR == MRR × 12", m.ARR, m.MRR * 12},
		{"MRR 为正", m.MRR > int64(0), true},
		{"流失率在 0-100", m.ChurnRatePct >= 0 && m.ChurnRatePct <= 100, true},
		{"试用转化率在 0-100", m.TrialConversion >= 0 && m.TrialConversion <= 100, true},
		{"月度桶数 == 9", len(m.Monthly), 9},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.want {
				t.Fatalf("got %v want %v", tc.got, tc.want)
			}
		})
	}

	var sumPlanMRR int64
	for _, p := range m.ByPlan {
		sumPlanMRR += p.MRR
	}
	if sumPlanMRR != m.MRR {
		t.Errorf("按套餐 MRR 之和 %d != 总 MRR %d", sumPlanMRR, m.MRR)
	}
	// 「按套餐订阅数」统计的是全部订阅（含试用），应与状态总数一致
	var sumPlanSubs int64
	for _, p := range m.ByPlan {
		sumPlanSubs += p.Subs
	}
	if sumPlanSubs != m.TotalSubscribers {
		t.Errorf("按套餐订阅数之和 %d != 订阅者总数 %d", sumPlanSubs, m.TotalSubscribers)
	}
	if m.Monthly[0].Month != "2026-01" || m.Monthly[8].Month != "2026-09" {
		t.Errorf("月度窗口错误：%v .. %v", m.Monthly[0].Month, m.Monthly[8].Month)
	}
}

func TestSeedIsIdempotentAndPaymentsReferenceExistingSubs(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	// 再跑一次 Seed 不应重复灌数据
	if err := r.Seed(ctx, time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("second Seed: %v", err)
	}
	var subs, pays, orphans int64
	if err := r.db.Table("subscriptions").Count(&subs).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("payments").Count(&pays).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.db.Table("payments").
		Where("subscription_id NOT IN (SELECT id FROM subscriptions)").Count(&orphans).Error; err != nil {
		t.Fatal(err)
	}
	if subs != 126 {
		t.Errorf("重复 Seed 后订阅数应为 126，实得 %d", subs)
	}
	if pays == 0 {
		t.Error("支付流水不应为空")
	}
	if orphans != 0 {
		t.Errorf("存在 %d 条孤儿支付流水", orphans)
	}
	// 支付金额必须与套餐/席位的定价口径一致：月付流水 = 月单价 × 席位
	var mismatch int64
	err := r.db.Table("payments p").Joins("JOIN subscriptions s ON s.id = p.subscription_id").
		Joins("JOIN plans pl ON pl.id = s.plan_id").
		Where("p.period = 'monthly' AND p.amount <> pl.price_monthly * s.seats").Count(&mismatch).Error
	if err != nil {
		t.Fatal(err)
	}
	if mismatch != 0 {
		t.Errorf("%d 条月付流水金额与定价口径不符", mismatch)
	}
}

func TestListSubscriptionsResistsInjectionAndBounds(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()

	all, total, err := r.ListSubscriptions(ctx, domain.ParseListQuery(map[string][]string{}))
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	if len(all) == 0 || total == 0 {
		t.Fatal("列表应返回数据")
	}

	cases := []struct {
		name       string
		values     map[string][]string
		wantTotal  int64
		check      func(*testing.T, []domain.SubscriptionRow, int64)
		wantErrNil bool
	}{
		{
			name:   "搜索串携带 SQL 片段只当普通文本",
			values: map[string][]string{"q": {"x' OR '1'='1"}},
			check: func(t *testing.T, rows []domain.SubscriptionRow, total int64) {
				t.Helper()
				if total != 0 || len(rows) != 0 {
					t.Fatalf("注入串竟匹配到 %d 条记录", total)
				}
			},
		},
		{
			name:   "UNION 探测",
			values: map[string][]string{"q": {"' UNION SELECT id,email,'x','y','z','w' FROM subscribers--"}},
			check: func(t *testing.T, rows []domain.SubscriptionRow, total int64) {
				t.Helper()
				if total != 0 {
					t.Fatalf("UNION 注入生效，返回 %d 条", total)
				}
			},
		},
		{
			name:   "LIKE 通配符被转义",
			values: map[string][]string{"q": {"%"}},
			check: func(t *testing.T, rows []domain.SubscriptionRow, total int64) {
				t.Helper()
				if total > 0 {
					t.Fatalf("孤立的 %% 应被转义为字面量，实得 %d 条", total)
				}
			},
		},
		{
			name:   "sort 注入被白名单替换后仍可排序",
			values: map[string][]string{"sort": {"s.mrr; DROP TABLE plans"}, "page_size": {"5"}},
			check: func(t *testing.T, rows []domain.SubscriptionRow, total int64) {
				t.Helper()
				if len(rows) != 5 {
					t.Fatalf("应返回 5 条，实得 %d", len(rows))
				}
			},
		},
		{
			name:   "page_size 上限生效",
			values: map[string][]string{"page_size": {"99999"}},
			check: func(t *testing.T, rows []domain.SubscriptionRow, total int64) {
				t.Helper()
				if len(rows) > domain.MaxPageSize {
					t.Fatalf("单次返回 %d 条，超过上限 %d", len(rows), domain.MaxPageSize)
				}
			},
		},
		{
			name:   "超长搜索串不报错",
			values: map[string][]string{"q": {strings.Repeat("名", 5000)}},
			check:  func(t *testing.T, rows []domain.SubscriptionRow, total int64) {},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, gotTotal, err := r.ListSubscriptions(ctx, domain.ParseListQuery(tc.values))
			if err != nil {
				t.Fatalf("ListSubscriptions 报错：%v", err)
			}
			tc.check(t, rows, gotTotal)
		})
	}

	// 表未被动过
	var still int64
	if err := r.db.Table("plans").Count(&still).Error; err != nil {
		t.Fatal(err)
	}
	if still == 0 {
		t.Error("plans 表疑似被删除或清空")
	}
}

func TestStatusFilterAndPaginationAreStable(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	q := domain.ParseListQuery(map[string][]string{"status": {domain.StatusActive}, "page_size": {"10"}, "sort": {"mrr"}, "dir": {"desc"}})
	rows, total, err := r.ListSubscriptions(ctx, q)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(rows)) > total {
		t.Fatalf("本页 %d 条超过总数 %d", len(rows), total)
	}
	for i := 1; i < len(rows); i++ {
		if rows[i-1].MRR < rows[i].MRR {
			t.Fatalf("降序排列失效：%d 在第 %d 位", rows[i].MRR, i)
		}
	}
	for _, row := range rows {
		if row.Status != domain.StatusActive {
			t.Fatalf("状态过滤泄漏：%s", row.Status)
		}
	}
}

func TestRecordRenewalTransaction(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	row, _, err := r.ListSubscriptions(ctx, domain.ParseListQuery(map[string][]string{
		"status": {domain.StatusPastDue}, "page_size": {"1"},
	}))
	if err != nil || len(row) == 0 {
		t.Fatalf("取欠款样本失败：%v", err)
	}
	target := row[0]
	before, err := r.Payments(ctx, target.ID, 50)
	if err != nil {
		t.Fatal(err)
	}
	next := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	if err := r.RecordRenewal(ctx, target.ID, 12345, domain.PeriodMonthly, next, time.Now().UTC()); err != nil {
		t.Fatalf("RecordRenewal: %v", err)
	}
	after, _ := r.Payments(ctx, target.ID, 50)
	if len(after) != len(before)+1 {
		t.Fatalf("流水应 +1：%d -> %d", len(before), len(after))
	}
	got, err := r.Subscription(ctx, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusActive {
		t.Errorf("续费后状态应为 active，实得 %s", got.Status)
	}
	if !got.RenewAt.Equal(next) {
		t.Errorf("续费日应为 %v，实得 %v", next, got.RenewAt)
	}
	if after[0].Amount != 12345 {
		t.Errorf("最新流水金额 %d != 12345（且不得被 seed 口径覆盖）", after[0].Amount)
	}

	// 不存在的订阅：返回 not_found，且不得写入流水
	cnt0, _ := r.Payments(ctx, 999999, 50)
	if err := r.RecordRenewal(ctx, 999999, 1, domain.PeriodMonthly, next, time.Now()); err == nil {
		t.Fatal("对不存在的订阅续费应报错")
	} else if ae, ok := err.(*domain.AppError); !ok || ae.Code != "not_found" {
		t.Fatalf("错误类型应为 not_found，实得 %v", err)
	}
	cnt1, _ := r.Payments(ctx, 999999, 50)
	if len(cnt0) != len(cnt1) || len(cnt1) != 0 {
		t.Errorf("失败事务不应留下流水：%d -> %d", len(cnt0), len(cnt1))
	}
}
