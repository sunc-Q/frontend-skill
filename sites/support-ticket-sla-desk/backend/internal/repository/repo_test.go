package repository

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
)

// 固定时刻：2026-09-26 09:00（本地）。这天是周六、非调休、前一天是中秋法定节假日，
// 所以「今天零计时」本身就是对日历口径的检验；而上一批工单都落在真实工作时段里。
var fixedNow = time.Date(2026, 9, 26, 1, 0, 0, 0, time.UTC)

func newSeededRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/sla.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	ctx := context.Background()
	if err := r.Seed(ctx, fixedNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r
}

// TestSeedIdentityAuditClean 是全场景最关键的一条：种子灌完之后，
// 统计层用「详情页同一份算法」逐单复算，四条恒等式必须一单都不差。
func TestSeedIdentityAuditClean(t *testing.T) {
	r := newSeededRepo(t)
	st, err := r.BuildStats(context.Background(), fixedNow)
	if err != nil {
		t.Fatalf("BuildStats: %v", err)
	}
	if !st.Audit.ClockOK {
		t.Errorf("时效账违例 %d 单（工作分钟=停表+计时中 / 到期点反算=目标+停表）", st.Audit.ClockBad)
	}
	if st.Audit.TimelineBad != 0 {
		t.Errorf("时间线复算违例 %d 单（paused/resumed 事件与 paused_bd 不同步）", st.Audit.TimelineBad)
	}
	if st.Audit.WallSplitBad != 0 {
		t.Errorf("挂钟拆分违例 %d 单", st.Audit.WallSplitBad)
	}
	if st.Audit.ResponseBad != 0 {
		t.Errorf("首响结算违例 %d 单", st.Audit.ResponseBad)
	}
	if st.Audit.Checked < 300 {
		t.Errorf("样本过薄：只核对到 %d 单", st.Audit.Checked)
	}
	// 口径互斥性：在办 + 已解决/关单 + 取消 = 总数
	var finished, canceled int64
	for _, row := range st.ByStatus {
		switch row.Key {
		case domain.StResolved, domain.StClosed:
			finished += row.Total
		case domain.StCanceled:
			canceled += row.Total
		}
	}
	if st.Open+st.ResolvedTotal+canceled != st.Total {
		t.Errorf("状态分组不闭合：在办 %d + 完结 %d + 取消 %d != 总数 %d",
			st.Open, st.ResolvedTotal, canceled, st.Total)
	}
	if len(st.ByStatus) != len(domain.AllStatuses) {
		t.Errorf("7 个状态都要有样本，实际 %d 组", len(st.ByStatus))
	}
	if len(st.ByPriority) != 4 || len(st.ByTier) != 4 {
		t.Errorf("优先级/客户等级覆盖不全：%d / %d", len(st.ByPriority), len(st.ByTier))
	}
	if st.Breached == 0 || st.MetRatePct <= 0 || st.MetRatePct >= 100 {
		t.Errorf("达成率与超时样本必须同时存在：%d / %.1f", st.Breached, st.MetRatePct)
	}
	if st.PausedBdTotal <= 0 {
		t.Error("种子没有停表样本，停表分支未被覆盖")
	}
	if st.NowInSession {
		t.Error("2026-09-26 是周六且非调休，不该处于工作窗口")
	}
	if st.Calendar.NextWindowAt == "" {
		t.Error("日历快照缺少下一个工作窗口")
	}
	if len(st.Daily) != 14 {
		t.Errorf("近 14 天趋势应有 14 点，实际 %d", len(st.Daily))
	}
	if len(st.CalendarDays) != 16 {
		t.Errorf("日历条应输出 16 天，实际 %d", len(st.CalendarDays))
	}
	if len(st.Agents) == 0 {
		t.Error("工程师负载为空")
	}
}

// TestEverySortKeyAndOnlyTabWorks 是第 6 轮 500 事故的回归网：
// 白名单里存的是一段 SQL 片段，它引用的表别名必须由真实执行验证出来。
func TestEverySortKeyAndOnlyTabWorks(t *testing.T) {
	r := newSeededRepo(t)
	ctx := context.Background()
	cases := []struct {
		sort string
		dir  string
		only string
	}{
		{"", "", ""}, {"created", "asc", ""}, {"created", "desc", ""},
		{"due", "asc", ""}, {"due", "desc", ""}, {"priority", "asc", ""},
		{"severity", "desc", ""}, {"status", "asc", ""}, {"customer", "asc", ""},
		{"agent", "desc", ""}, {"code", "asc", ""}, {"paused", "desc", ""},
		{"resolveBd", "asc", ""},
		{"', (SELECT 1)--", "asc", ""}, {"'; DROP TABLE tickets;--", "asc", ""},
		{"due", "bogus", ""},
		{"due", "asc", "open"}, {"due", "asc", "breached"}, {"due", "asc", "at_risk"},
		{"due", "asc", "paused"}, {"created", "desc", "responding"},
		{"priority", "asc", "breached"}, {"paused", "desc", "paused"},
	}
	for i, c := range cases {
		v := map[string][]string{}
		if c.sort != "" {
			v["sort"] = []string{c.sort}
		}
		if c.dir != "" {
			v["dir"] = []string{c.dir}
		}
		if c.only != "" {
			v["only"] = []string{c.only}
		}
		v["page_size"] = []string{"7"}
		q := domain.ParseListQuery(v)
		rows, total, err := r.ListTickets(ctx, q, fixedNow)
		if err != nil {
			t.Fatalf("case %d %+v: %v", i, c, err)
		}
		if len(rows) > q.PageSize {
			t.Errorf("case %d：返回 %d 行超过 page_size %d", i, len(rows), q.PageSize)
		}
		if total < int64(len(rows)) {
			t.Errorf("case %d：total=%d 小于本页行数 %d", i, total, len(rows))
		}
		for _, row := range rows {
			if !row.ClockIdentity {
				t.Errorf("case %d：%s 时间账不自洽", i, row.Code)
			}
			switch c.only {
			case "breached":
				if !row.Breached {
					t.Errorf("case %d：超时页签混进未超时单 %s", i, row.Code)
				}
			case "at_risk":
				if !row.AtRisk {
					t.Errorf("case %d：即将超时页签混进 %s", i, row.Code)
				}
			case "paused":
				if row.Status != domain.StPending {
					t.Errorf("case %d：停表页签混进 %s", i, row.Code)
				}
			case "responding":
				if row.FirstResponse != nil {
					t.Errorf("case %d：待首响页签混进已响应单 %s", i, row.Code)
				}
			}
		}
	}
}

// TestOnlyTabTotalMatchesFullScan 保证「翻页翻完的行数」等于接口报的 total —— 超集粗筛 +
// Go 精筛的实现最容易在这里出错（total 用 SQL 数、行用 Go 筛）。
func TestOnlyTabTotalMatchesFullScan(t *testing.T) {
	r := newSeededRepo(t)
	ctx := context.Background()
	for _, only := range []string{"open", "breached", "at_risk", "paused", "responding", ""} {
		v := map[string][]string{"page_size": []string{"25"}}
		if only != "" {
			v["only"] = []string{only}
		}
		q := domain.ParseListQuery(v)
		var seen, total int64
		codes := map[string]bool{}
		for page := 1; page <= 60; page++ {
			q.Page = page
			rows, tot, err := r.ListTickets(ctx, q, fixedNow)
			if err != nil {
				t.Fatalf("only=%q page=%d: %v", only, page, err)
			}
			total = tot
			for _, row := range rows {
				if codes[row.Code] {
					t.Errorf("only=%q：%s 重复出现", only, row.Code)
				}
				codes[row.Code] = true
			}
			seen += int64(len(rows))
			if len(rows) < q.PageSize {
				break
			}
		}
		if seen != total {
			t.Errorf("only=%q：翻完得到 %d 行，接口报 total=%d", only, seen, total)
		}
	}
}

// TestSearchEscapesLike 保证 % 与 _ 被当字面量处理，而不是通配符。
func TestSearchEscapesLike(t *testing.T) {
	r := newSeededRepo(t)
	ctx := context.Background()
	q := domain.ParseListQuery(map[string][]string{"q": []string{"%"}})
	_, total, err := r.ListTickets(ctx, q, fixedNow)
	if err != nil {
		t.Fatalf("q=%% 查询失败: %v", err)
	}
	if total > 0 {
		t.Errorf("q=%% 应命中 0 行，实际 %d（转义失效）", total)
	}
	q = domain.ParseListQuery(map[string][]string{"q": []string{"'; DROP TABLE tickets;--"}})
	if _, total, err = r.ListTickets(ctx, q, fixedNow); err != nil {
		t.Fatalf("注入串应安全返回： %v", err)
	}
	if total != 0 {
		t.Errorf("注入串不应命中任何行，实际 %d", total)
	}
	raw, err := r.AllTickets(ctx, 5)
	if err != nil || len(raw) == 0 {
		t.Fatalf("工单表应仍然存在且有数据：%v", err)
	}
}

func TestCreateTicketSequenceAndDedupe(t *testing.T) {
	r := newSeededRepo(t)
	ctx := context.Background()
	customers, err := r.Customers(ctx, true)
	if err != nil || len(customers) == 0 {
		t.Fatalf("客户字典为空：%v", err)
	}
	c := customers[0]
	pol, err := r.Policy(ctx, c.Tier, "S2")
	if err != nil {
		t.Fatalf("Policy: %v", err)
	}
	newT := func(title string) *domain.Ticket {
		return &domain.Ticket{
			Title: title, Description: "测试建单", CustomerID: c.ID,
			Category: "应用故障", Channel: "工单门户", Team: domain.TeamForCategory("应用故障"),
			Severity: "S2", Priority: domain.Prioritize("S2", c.Tier), Status: domain.StNew,
			CreatedAt: fixedNow, UpdatedAt: fixedNow,
			ResponseTarget: pol.ResponseMin, ResolveTarget: pol.ResolveMin,
			RespDueAt:    domain.AdvanceBusiness(fixedNow, int64(pol.ResponseMin)),
			ResolveDueAt: domain.AdvanceBusiness(fixedNow, int64(pol.ResolveMin)),
		}
	}
	first := newT("同一客户同名在办单测试")
	if err := r.CreateTicket(ctx, first, domain.TicketEvent{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: "tester", At: fixedNow,
	}); err != nil {
		t.Fatalf("首单建单失败: %v", err)
	}
	if !strings.HasPrefix(first.Code, "TK-20260926-") {
		t.Errorf("编号前缀应含本地日期（周六）：%s", first.Code)
	}
	err = r.CreateTicket(ctx, newT("同一客户同名在办单测试"), domain.TicketEvent{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: "tester", At: fixedNow,
	})
	if err == nil || !strings.Contains(err.Error(), "duplicate_open_ticket") {
		t.Errorf("同名在办单应 409，实际 %v", err)
	}
	// 异名单必须能建，且同日编号连续不撞车。
	second := newT("同日第二单编号不撞车测试")
	if err := r.CreateTicket(ctx, second, domain.TicketEvent{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: "tester", At: fixedNow,
	}); err != nil {
		t.Fatalf("异名单建单失败: %v", err)
	}
	if second.Code == first.Code {
		t.Errorf("同日两单编号撞车：%s", second.Code)
	}
}

// TestNoRawPhoneLeaksInAnyJSONOut 把隐私边界做成可执行的：序列化每个对外视图，
// 断言明文手机号与字段名都不出现。
func TestNoRawPhoneLeaksInAnyJSONOut(t *testing.T) {
	r := newSeededRepo(t)
	ctx := context.Background()
	st, err := r.BuildStats(ctx, fixedNow)
	if err != nil {
		t.Fatalf("BuildStats: %v", err)
	}
	rows, _, err := r.ListTickets(ctx, domain.ParseListQuery(map[string][]string{
		"page_size": []string{"50"},
	}), fixedNow)
	if err != nil {
		t.Fatalf("ListTickets: %v", err)
	}
	customers, err := r.Customers(ctx, false)
	if err != nil || len(customers) == 0 {
		t.Fatalf("Customers: %v", err)
	}
	var blobs []string
	for _, v := range []any{st, rows, customers} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		blobs = append(blobs, string(b))
	}
	joined := strings.Join(blobs, "\n")
	for _, c := range customers {
		if c.ContactPhone == "" {
			continue
		}
		if strings.Contains(joined, c.ContactPhone) {
			t.Errorf("明文手机号 %s 出现在对外 JSON 里", c.ContactPhone)
		}
	}
	if strings.Contains(joined, "contact_phone\":") || strings.Contains(joined, "\"contact_phone") {
		t.Error("对外 JSON 里不应有 contact_phone 键")
	}
	if !strings.Contains(joined, "****") {
		t.Error("脱敏手机号 masked_phone 应出现在列表输出中")
	}
}
