package repository

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
)

var fixedNow = time.Date(2026, 9, 26, 6, 0, 0, 0, time.UTC) // 北京时间 14:00

// newSeededRepo 每个用例一套独立临时库，跑真实 SQLite（不 mock DB，
// 历史轮次的教训是 mock 过的仓储测不出真库的列名/别名/事务问题）。
func newSeededRepo(t *testing.T) (*Repo, context.Context) {
	t.Helper()
	path := t.TempDir() + "/app.db"
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	ctx := context.Background()
	if err := r.Seed(ctx, fixedNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if err := Harden(path); err != nil {
		t.Fatalf("Harden: %v", err)
	}
	return r, ctx
}

func TestSeedSelfConsistency(t *testing.T) {
	r, ctx := newSeededRepo(t)

	lanes, err := r.Lanes(ctx, false)
	if err != nil {
		t.Fatalf("Lanes: %v", err)
	}
	rules, err := r.Rules(ctx, false)
	if err != nil {
		t.Fatalf("Rules: %v", err)
	}
	st, err := r.Stats(ctx, fixedNow, 14)
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}

	cases := []struct {
		name string
		ok   bool
		info string
	}{
		{"线路已灌入", len(lanes) >= 8, fmt.Sprint(len(lanes))},
		{"存在停用线路（覆盖停售分支）", countTrue(lanes, func(l domain.Lane) bool { return !l.Active }) >= 1, ""},
		{"存在偏远线路（覆盖百分比附加）", countTrue(lanes, func(l domain.Lane) bool { return l.RemoteArea }) >= 1, ""},
		{"规则已灌入且含停用项", len(rules) >= 5 && countTrue(rules, func(x domain.SurchargeRule) bool { return !x.Active }) >= 1, fmt.Sprint(len(rules))},
		{"运单覆盖全部 8 个状态", len(st.ByStatus) == 8, fmt.Sprint(len(st.ByStatus))},
		{"种子量级合理", st.TotalWaybills >= 100, fmt.Sprint(st.TotalWaybills)},
		{"泡货确实存在（体积重压过实际重）", st.BulkyCount > 0, fmt.Sprint(st.BulkyCount)},
		{"附加费截断确实发生", st.CappedCount > 0, fmt.Sprint(st.CappedCount)},
		{"有保价单", st.InsuredCount > 0, fmt.Sprint(st.InsuredCount)},
		{"轨迹事件多于运单（链路成立）", st.EventCount > st.TotalWaybills, fmt.Sprintf("%d/%d", st.EventCount, st.TotalWaybills)},
		{"今日有开单（UTC+8 口径）", st.BookedToday > 0, fmt.Sprint(st.BookedToday)},
		{"种子恒等式全绿", st.IdentityOK, strings.Join(st.IdentityIssues, ";")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if !tc.ok {
				t.Errorf("种子自检失败：%s", tc.info)
			}
		})
	}

	// 「今日」必须按 UTC+8 日历日：2026-09-26 14:00 北京时间。
	if st.Today != "2026-09-26" {
		t.Errorf("Today = %s, 期望 2026-09-26（双时钟口径）", st.Today)
	}
	if len(st.Daily) != 14 {
		t.Errorf("Daily = %d 天, 期望补齐到 14", len(st.Daily))
	}
	if st.Daily[0].Day != "2026-09-13" || st.Daily[13].Day != "2026-09-26" {
		t.Errorf("趋势窗口首尾 = %s..%s", st.Daily[0].Day, st.Daily[13].Day)
	}
}

func countTrue[T any](xs []T, p func(T) bool) int {
	n := 0
	for _, x := range xs {
		if p(x) {
			n++
		}
	}
	return n
}

// TestEverySortKeyExecutes 排序白名单里每个键都要真跑一次 SQL：
// 表别名写错（w./l.）在这里就会炸出来，而不是等线上 500。
// TestSeedTimelineNeverInFuture 盯住两个只会在「清晨跑种子」时露头的坑：
// ① 今天的种子单排在 8~18 点，早于 8 点跑就会写出一堆未来时刻，
//
//	按下单时间倒序时真单会被压到历史单后面；
//
// ② 时间戳带本地偏移入库，SQLite 里是文本排序，+08:00 的行会排到 +00:00 之前。
func TestSeedTimelineNeverInFuture(t *testing.T) {
	r, _ := newSeededRepo(t)
	for _, tc := range []struct {
		table string
		col   string
	}{
		{"waybills", "booked_at"},
		{"waybills", "updated_at"},
		{"scan_events", "occurred_at"},
	} {
		var n int64
		if err := r.db.Table(tc.table).Where(tc.col+" > ?", fixedNow).Count(&n).Error; err != nil {
			t.Fatalf("%s.%s 计数失败: %v", tc.table, tc.col, err)
		}
		if n > 0 {
			t.Errorf("%s.%s 有 %d 行晚于种子时刻（未来时间占位）", tc.table, tc.col, n)
		}
		var notUTC int64
		if err := r.db.Table(tc.table).Where(tc.col+" NOT LIKE ?", "%+00:00").Count(&notUTC).Error; err != nil {
			t.Fatalf("%s.%s 时区检查失败: %v", tc.table, tc.col, err)
		}
		if notUTC > 0 {
			t.Errorf("%s.%s 有 %d 行不是 UTC 文本，SQLite 文本排序会错乱", tc.table, tc.col, notUTC)
		}
	}
}

func TestEverySortKeyExecutes(t *testing.T) {
	r, ctx := newSeededRepo(t)
	for _, key := range domain.SortKeys() {
		for _, dir := range []string{"asc", "desc"} {
			q := domain.ParseListQuery(map[string][]string{"sort": {key}, "dir": {dir}, "page_size": {"5"}})
			rows, _, err := r.ListWaybills(ctx, q)
			if err != nil {
				t.Fatalf("sort=%s dir=%s 执行失败: %v", key, dir, err)
			}
			if len(rows) == 0 {
				t.Errorf("sort=%s 返回空，白名单可能指向了不存在的列", key)
			}
			if q.Sort == "" {
				t.Errorf("sort=%s 未落到列名", key)
			}
			// 有序性：相邻行必须单调（同值容忍）。
			for i := 1; i < len(rows); i++ {
				a, b := orderValue(rows[i-1], key), orderValue(rows[i], key)
				if dir == "asc" && a > b || dir == "desc" && a < b {
					t.Fatalf("sort=%s dir=%s 在 %s/%s 处乱序", key, dir, rows[i-1].Code, rows[i].Code)
				}
			}
		}
	}
}

func orderValue(row domain.WaybillRow, key string) string {
	var raw any
	switch key {
	case "code":
		raw = row.Code
	case "total":
		raw = row.TotalCents
	case "chargeable":
		raw = row.ChargeableGrams
	case "weight":
		raw = row.WeightGrams
	case "booked":
		raw = row.BookedAt
	case "promised":
		raw = row.PromisedAt
	case "status":
		raw = row.Status
	case "lane":
		raw = row.LaneCode
	case "pieces":
		raw = row.PieceCount
	default:
		raw = row.ID
	}
	return fmt.Sprint(raw)
}

func TestListFiltersAndInjection(t *testing.T) {
	r, ctx := newSeededRepo(t)
	all, total, err := r.ListWaybills(ctx, domain.ParseListQuery(nil))
	if err != nil || len(all) == 0 {
		t.Fatalf("默认列表失败: %v %d", err, len(all))
	}
	if total < 100 {
		t.Fatalf("total = %d", total)
	}
	sample := all[0]

	cases := []struct {
		name   string
		params map[string][]string
		wantOK func(rows []domain.WaybillRow, total int64) bool
	}{
		{"状态过滤", map[string][]string{"status": {"delivered"}}, func(rows []domain.WaybillRow, _ int64) bool {
			return len(rows) > 0 && countTrue(rows, func(x domain.WaybillRow) bool { return x.Status == "delivered" }) == len(rows)
		}},
		{"线路过滤", map[string][]string{"lane": {sample.LaneCode}}, func(rows []domain.WaybillRow, _ int64) bool {
			return countTrue(rows, func(x domain.WaybillRow) bool { return x.LaneCode == sample.LaneCode }) == len(rows)
		}},
		{"档位过滤", map[string][]string{"tier": {"express"}}, func(rows []domain.WaybillRow, _ int64) bool {
			return countTrue(rows, func(x domain.WaybillRow) bool { return x.Tier == "express" }) == len(rows)
		}},
		// 注入串必须命中 0 条而不是绕过 WHERE；引号与通配符都已被 escape。
		{"LIKE 注入不放大结果", map[string][]string{"q": {"' OR '1'='1"}}, func(_ []domain.WaybillRow, tot int64) bool {
			return tot == 0
		}},
		{"通配符被转义", map[string][]string{"q": {"%"}}, func(_ []domain.WaybillRow, tot int64) bool {
			return tot == 0
		}},
		{"下划线被转义", map[string][]string{"q": {"_"}}, func(_ []domain.WaybillRow, tot int64) bool {
			return tot == 0
		}},
		{"按单号精确搜索命中", map[string][]string{"q": {sample.Code}}, func(rows []domain.WaybillRow, tot int64) bool {
			return tot == 1 && rows[0].Code == sample.Code
		}},
		// 非法枚举回落默认而不是报错；非法排序键必须被丢掉。
		{"非法状态静默回落", map[string][]string{"status": {"flying"}}, func(_ []domain.WaybillRow, tot int64) bool {
			return tot == total
		}},
		{"非法排序键被忽略", map[string][]string{"sort": {"total_cents; DROP TABLE waybills"}}, func(rows []domain.WaybillRow, _ int64) bool {
			return len(rows) > 0
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, tot, err := r.ListWaybills(ctx, domain.ParseListQuery(tc.params))
			if err != nil {
				t.Fatalf("%v", err)
			}
			if !tc.wantOK(rows, tot) {
				t.Errorf("过滤结果不符：返回 %d 行 / total %d", len(rows), tot)
			}
		})
	}

	// 分页硬上限：page_size 再大也只给 100。
	q := domain.ParseListQuery(map[string][]string{"page_size": {"99999"}})
	if q.PageSize != domain.MaxPageSize {
		t.Errorf("PageSize = %d, 期望被夹到 %d", q.PageSize, domain.MaxPageSize)
	}
	rows, _, err := r.ListWaybills(ctx, q)
	if err != nil || len(rows) > domain.MaxPageSize {
		t.Errorf("超限分页返回 %d 行", len(rows))
	}
	// 深翻页不得越权返回数据。
	rows, _, err = r.ListWaybills(ctx, domain.ParseListQuery(map[string][]string{"page": {"9999"}}))
	if err != nil || len(rows) != 0 {
		t.Errorf("越界页返回 %d 行, err %v", len(rows), err)
	}
}

// TestPhoneNeverLeaks 手机号在任何读取出口都只能是脱敏形态。
func TestPhoneNeverLeaks(t *testing.T) {
	r, ctx := newSeededRepo(t)
	rows, _, err := r.ListWaybills(ctx, domain.ParseListQuery(map[string][]string{"page_size": {"50"}}))
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Phone != "" {
			t.Fatalf("%s 列表出口带出原始手机号", row.Code)
		}
		if !strings.Contains(row.PhoneMasked, "****") && row.PhoneMasked != "未登记" {
			t.Fatalf("%s 脱敏形态异常：%s", row.Code, row.PhoneMasked)
		}
	}
	d, err := r.WaybillByCode(ctx, rows[0].Code)
	if err != nil {
		t.Fatal(err)
	}
	if d.Phone != "" {
		t.Errorf("详情出口带出原始手机号")
	}
}

func TestCreateAndAdvanceFlow(t *testing.T) {
	r, ctx := newSeededRepo(t)
	lane, err := r.LaneByCode(ctx, "BJ-SH")
	if err != nil {
		t.Fatal(err)
	}
	rules, err := r.Rules(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	in := domain.CreateWaybillInput{
		LaneCode: "BJ-SH", ShipperName: "回归测试发货", Phone: "13700002222",
		PieceCount: 2, WeightGrams: 5200, VolumeCm3: 48000, HeaviestG: 3000,
		DeclaredCents: 80000, Fragile: true,
	}
	q := domain.QuoteOf(domain.QuoteInput{Lane: lane, Rules: domain.SortRulesActive(rules),
		WeightGrams: in.WeightGrams, VolumeCm3: in.VolumeCm3, HeaviestG: in.HeaviestG,
		DeclaredCents: in.DeclaredCents, Fragile: in.Fragile})

	created, err := r.CreateWaybill(ctx, in, q, lane, fixedNow, "上海分拨中心")
	if err != nil {
		t.Fatalf("CreateWaybill: %v", err)
	}
	// 号段接续：种子已灌入的「今日」单数 +1，前缀必须是 UTC+8 业务日而不是 UTC 日。
	prefix := "FY" + businessDate(fixedNow) + "-"
	var already int64
	if err := r.DB().Model(&domain.Waybill{}).Where("code LIKE ? ESCAPE '\\'", prefix+"%").
		Count(&already).Error; err != nil {
		t.Fatal(err)
	}
	if created.Code != fmt.Sprintf("%s%04d", prefix, already) {
		t.Errorf("运单号 = %s, 期望接续在 %s 之后（共 %d 单）", created.Code, prefix, already)
	}
	if created.Status != domain.StBooked {
		t.Errorf("初始状态 = %s", created.Status)
	}
	if created.TotalCents != q.TotalCents {
		t.Errorf("落库总额 %d ≠ 引擎报价 %d", created.TotalCents, q.TotalCents)
	}
	if len(created.Events) != 1 || created.Events[0].Seq != 1 {
		t.Errorf("建单应只有 1 条 seq=1 事件，得到 %+v", created.Events)
	}
	if created.PromisedAt.Sub(created.BookedAt) != time.Duration(lane.PromiseDays)*24*time.Hour {
		t.Errorf("承诺时效未按时效天数落库")
	}
	if created.DeliveredAt != nil {
		t.Errorf("新建单不得有签收时间")
	}

	// 再建一单：日流水必须递增，且两单事件互不串线。
	second, err := r.CreateWaybill(ctx, in, q, lane, fixedNow, "上海分拨中心")
	if err != nil {
		t.Fatalf("第二单: %v", err)
	}
	if second.Code != nextAfter(created.Code) {
		t.Errorf("第二单号 = %s, 期望接续 %s", second.Code, nextAfter(created.Code))
	}

	steps := []struct {
		to      string
		wantSeq int
	}{
		{domain.StPickedUp, 2},
		{domain.StInTransit, 3},
		{domain.StArrived, 4},
		{domain.StOutForDelivery, 5},
		{domain.StDelivered, 6},
	}
	cur := created.Code
	for _, s := range steps {
		d, err := r.Advance(ctx, cur, s.to, "西安中转场", "回归推进", fixedNow.Add(time.Duration(s.wantSeq)*time.Minute))
		if err != nil {
			t.Fatalf("Advance(%s): %v", s.to, err)
		}
		if d.Status != s.to {
			t.Errorf("状态 = %s, 期望 %s", d.Status, s.to)
		}
		if len(d.Events) != s.wantSeq {
			t.Errorf("事件数 = %d, 期望 %d", len(d.Events), s.wantSeq)
		}
		if d.Events[0].Seq != s.wantSeq {
			t.Errorf("最新事件 seq = %d（详情按 seq 倒序），期望 %d", d.Events[0].Seq, s.wantSeq)
		}
		// 轨迹必须严格倒序且时间不回拨。
		for i := 1; i < len(d.Events); i++ {
			if d.Events[i-1].Seq <= d.Events[i].Seq {
				t.Fatalf("事件 seq 非单调：%+v", d.Events)
			}
			if d.Events[i-1].OccurredAt.Before(d.Events[i].OccurredAt) {
				t.Fatalf("事件时间回拨：%+v", d.Events)
			}
		}
		if s.to == domain.StDelivered && d.DeliveredAt == nil {
			t.Errorf("签收必须写 delivered_at")
		}
	}

	cases := []struct {
		name    string
		run     func() error
		wantErr string
	}{
		{"终态不可再推进", func() error {
			_, err := r.Advance(ctx, cur, domain.StException, "西安中转场", "已结案", fixedNow)
			return err
		}, "invalid_transition"},
		{"跳级被拒", func() error {
			_, err := r.Advance(ctx, second.Code, domain.StDelivered, "西安中转场", "跳级", fixedNow)
			return err
		}, "invalid_transition"},
		{"不存在的单号", func() error {
			_, err := r.Advance(ctx, "FY19700101-0001", domain.StPickedUp, "西安中转场", "不存在", fixedNow)
			return err
		}, "not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.run()
			if err == nil {
				t.Fatalf("应失败并返回 %s", tc.wantErr)
			}
			var ae *domain.AppError
			if !errors.As(err, &ae) {
				t.Fatalf("错误类型 %T，应为 *AppError", err)
			}
			if ae.Code != tc.wantErr {
				t.Errorf("错误码 = %s, 期望 %s", ae.Code, tc.wantErr)
			}
			if ae.HTTPCode < 400 {
				t.Errorf("HTTPCode = %d", ae.HTTPCode)
			}
		})
	}
}

func TestRuleCreateAndToggle(t *testing.T) {
	r, ctx := newSeededRepo(t)
	rule := &domain.SurchargeRule{Code: "night-pickup", Name: "夜间取件费", Kind: domain.KindFragileFlat, AmountCents: 600, Priority: 60, Active: true}
	if err := r.CreateRule(ctx, rule); err != nil {
		t.Fatalf("CreateRule: %v", err)
	}
	if rule.ID == 0 {
		t.Errorf("未回填主键")
	}
	dup := &domain.SurchargeRule{Code: "night-pickup", Name: "重复", Kind: domain.KindFragileFlat, AmountCents: 1, Priority: 61, Active: true}
	err := r.CreateRule(ctx, dup)
	var ae *domain.AppError
	if !errors.As(err, &ae) || ae.Code != "conflict" || ae.HTTPCode != 409 {
		t.Errorf("重复标识应 409 conflict，得到 %v", err)
	}

	before := mustActive(t, r, ctx, rule.ID)
	after, err := r.ToggleRule(ctx, rule.ID)
	if err != nil {
		t.Fatalf("ToggleRule: %v", err)
	}
	if after.Active == before {
		t.Errorf("启停未翻转")
	}
	// 停用后计价仲裁必须不再收取该费项。
	rules, err := r.Rules(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range rules {
		if x.ID == rule.ID {
			t.Errorf("activeOnly 查询仍返回停用规则")
		}
	}
	if _, err := r.ToggleRule(ctx, 999999); err == nil {
		t.Errorf("不存在的规则应报错")
	}
}

func mustActive(t *testing.T, r *Repo, ctx context.Context, id int64) bool {
	t.Helper()
	var rule domain.SurchargeRule
	if err := r.db.Where("id = ?", id).First(&rule).Error; err != nil {
		t.Fatal(err)
	}
	return rule.Active
}

func nextAfter(code string) string {
	i := strings.LastIndex(code, "-")
	n, err := strconv.Atoi(code[i+1:])
	if err != nil {
		return "<<" + code + ">>"
	}
	return fmt.Sprintf("%s-%04d", code[:i], n+1)
}

// TestStatsDayWindowClamp 窗口参数越界必须被夹住而不是报错。
func TestStatsDayWindowClamp(t *testing.T) {
	r, ctx := newSeededRepo(t)
	cases := []struct {
		days    int
		wantLen int
	}{
		{0, 7}, {3, 7}, {14, 14}, {999, 30},
	}
	for _, tc := range cases {
		s, err := r.Stats(ctx, fixedNow, tc.days)
		if err != nil {
			t.Fatalf("days=%d: %v", tc.days, err)
		}
		if len(s.Daily) != tc.wantLen || s.TrendDays != tc.wantLen {
			t.Errorf("days=%d → 窗口 %d 行/%d 天, 期望 %d", tc.days, len(s.Daily), s.TrendDays, tc.wantLen)
		}
	}
}
