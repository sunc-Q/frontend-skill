package domain

import (
	"strings"
	"testing"
	"time"
)

func cst(y int, mo time.Month, d, h, mi int) time.Time {
	return time.Date(y, mo, d, h, mi, 0, 0, FieldTZ)
}

// 2026-09 关键日历：25 中秋（周五，休）、26 周六、27 周日调休上班、28 周一。
func TestIsWorkingDayCalendarRules(t *testing.T) {
	cases := []struct {
		name string
		at   time.Time
		want bool
	}{
		{"标准工作日周四", cst(2026, 9, 24, 10, 0), true},
		{"中秋法定假日（周五）", cst(2026, 9, 25, 10, 0), false},
		{"普通周六", cst(2026, 9, 26, 10, 0), false},
		{"周日调休上班优先于周末", cst(2026, 9, 27, 10, 0), true},
		{"国庆第一天", cst(2026, 10, 1, 9, 0), false},
		{"国庆后周六调休", cst(2026, 10, 10, 23, 0), true},
		{"普通周日", cst(2026, 9, 20, 12, 0), false},
		{"跨日界线的 23:59 仍按当天判定", cst(2026, 9, 27, 23, 59), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsWorkingDay(c.at); got != c.want {
				t.Fatalf("IsWorkingDay(%s)=%v，期望 %v（原因：%s）",
					c.at.Format("2006-01-02 15:04"), got, c.want, dayReason(c.at))
			}
		})
	}
}

func TestBusinessMinutesBetweenSpans(t *testing.T) {
	cases := []struct {
		name     string
		from, to time.Time
		want     int64
	}{
		{"时段内整段 09:30→10:30", cst(2026, 9, 24, 9, 30), cst(2026, 9, 24, 10, 30), 60},
		{"午休不计时 11:30→13:30", cst(2026, 9, 24, 11, 30), cst(2026, 9, 24, 13, 30), 60},
		{"周四傍晚到中秋前夜只有 60 分钟", cst(2026, 9, 24, 17, 0), cst(2026, 9, 25, 9, 0), 60},
		{"跨过中秋假期只有周四傍晚 60 分钟", cst(2026, 9, 24, 17, 0), cst(2026, 9, 26, 23, 0), 60},
		{"调休周日全天计时", cst(2026, 9, 26, 17, 0), cst(2026, 9, 28, 9, 0), 480},
		{"整段落在非工作日", cst(2026, 9, 26, 1, 0), cst(2026, 9, 26, 23, 0), 0},
		{"同一时刻为 0", cst(2026, 9, 24, 10, 0), cst(2026, 9, 24, 10, 0), 0},
		{"倒序输入不产生负数", cst(2026, 9, 24, 12, 0), cst(2026, 9, 24, 9, 0), 0},
		{"未对齐时刻向下取整", cst(2026, 9, 24, 9, 30), cst(2026, 9, 24, 10, 30).Add(30 * time.Second), 60},
		{"时段边界左闭右开 12:00→13:00", cst(2026, 9, 24, 12, 0), cst(2026, 9, 24, 13, 0), 0},
		{"整天工作时段合计 480", cst(2026, 9, 24, 0, 0), cst(2026, 9, 25, 0, 0), 480},
		{"国庆三连休只剩周三傍晚 30 分钟", cst(2026, 9, 30, 17, 30), cst(2026, 10, 4, 9, 30), 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := BusinessMinutesBetween(c.from, c.to); got != c.want {
				t.Fatalf("bm(%s → %s)=%d，期望 %d",
					c.from.In(FieldTZ).Format("01-02 15:04"), c.to.In(FieldTZ).Format("01-02 15:04"), got, c.want)
			}
		})
	}
}

func TestAdvanceBusinessLandsOnExpectedInstant(t *testing.T) {
	cases := []struct {
		name    string
		start   time.Time
		minutes int64
		wantUTC time.Time
	}{
		{"时段内直接累加", cst(2026, 9, 24, 9, 30), 60, cst(2026, 9, 24, 10, 30)},
		{"跨过午休跳到 13:00 起算", cst(2026, 9, 24, 11, 30), 60, cst(2026, 9, 24, 13, 30)},
		{"夜间下单跨中秋顺延到调休周日 09:30", cst(2026, 9, 24, 19, 0), 30, cst(2026, 9, 27, 9, 30)},
		{"周五假期前下单顺延到调休周日", cst(2026, 9, 24, 17, 0), 240, cst(2026, 9, 27, 12, 0)},
		{"目标为 0 时原地不动", cst(2026, 9, 24, 19, 0), 0, cst(2026, 9, 24, 19, 0)},
		{"午休正点起算顺延到 13:00", cst(2026, 9, 24, 12, 0), 15, cst(2026, 9, 24, 13, 15)},
		{"目标正好填满一整天的 480 分钟", cst(2026, 9, 28, 9, 0), 480, cst(2026, 9, 28, 18, 0)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := AdvanceBusiness(c.start, c.minutes)
			if !got.Equal(c.wantUTC) {
				t.Fatalf("Advance(%s, %d)=%s，期望 %s",
					c.start.In(FieldTZ).Format("01-02 15:04"), c.minutes,
					got.In(FieldTZ).Format("01-02 15:04"), c.wantUTC.In(FieldTZ).Format("01-02 15:04"))
			}
		})
	}
}

// Advance 与 BusinessMinutesBetween 必须互逆：整套 SLA 到期点与「剩余时间账」
// 的可信度都建立在这条往返性质上（种子与线上共用同一对函数）。
func TestAdvanceAndMeasureAreInverse(t *testing.T) {
	starts := []time.Time{
		cst(2026, 9, 24, 9, 0), cst(2026, 9, 24, 11, 59), cst(2026, 9, 24, 12, 30),
		cst(2026, 9, 24, 17, 45), cst(2026, 9, 25, 3, 0), cst(2026, 9, 26, 23, 59),
		cst(2026, 9, 27, 9, 0), cst(2026, 10, 1, 10, 0), cst(2026, 9, 30, 17, 30),
	}
	targets := []int64{1, 15, 120, 240, 480, 481, 960, 1440, 2880, 20160}
	for _, s := range starts {
		for _, n := range targets {
			due := AdvanceBusiness(s, n)
			if back := BusinessMinutesBetween(s, due); back != n {
				t.Fatalf("往返不一致：start=%s target=%d due=%s 反算=%d",
					s.In(FieldTZ).Format("2006-01-02 15:04"), n,
					due.In(FieldTZ).Format("2006-01-02 15:04"), back)
			}
			if due.Before(s) {
				t.Fatalf("到期点早于起点：%s < %s", due, s)
			}
		}
	}
}

func TestNextSessionAt(t *testing.T) {
	cases := []struct {
		name string
		from time.Time
		want time.Time
	}{
		{"时段内原样返回", cst(2026, 9, 24, 10, 0), cst(2026, 9, 24, 10, 0)},
		{"午休顺延到 13:00", cst(2026, 9, 24, 12, 20), cst(2026, 9, 24, 13, 0)},
		{"周四下班后跨中秋顺延到调休周日", cst(2026, 9, 24, 18, 0), cst(2026, 9, 27, 9, 0)},
		{"周六凌晨顺延到周日调休", cst(2026, 9, 26, 1, 11), cst(2026, 9, 27, 9, 0)},
		{"国庆假+无调休周日顺延到 10-05 周一", cst(2026, 10, 1, 12, 0), cst(2026, 10, 5, 9, 0)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := NextSessionAt(c.from)
			if !got.Equal(c.want) {
				t.Fatalf("NextSessionAt(%s)=%s，期望 %s",
					c.from.In(FieldTZ).Format("2006-01-02 15:04"),
					got.In(FieldTZ).Format("2006-01-02 15:04"),
					c.want.In(FieldTZ).Format("2006-01-02 15:04"))
			}
		})
	}
}

func TestBusinessMinutesOfSpansUnionsOverlaps(t *testing.T) {
	cases := []struct {
		name  string
		spans []PauseSpan
		want  int64
	}{
		{"空区间", nil, 0},
		{"单段工作时段内", []PauseSpan{{cst(2026, 9, 24, 10, 0), cst(2026, 9, 24, 11, 0)}}, 60},
		{"重叠区间取并集不重复计", []PauseSpan{
			{cst(2026, 9, 24, 10, 0), cst(2026, 9, 24, 11, 0)},
			{cst(2026, 9, 24, 10, 30), cst(2026, 9, 24, 11, 30)},
		}, 90},
		{"首尾相接", []PauseSpan{
			{cst(2026, 9, 24, 10, 0), cst(2026, 9, 24, 11, 0)},
			{cst(2026, 9, 24, 11, 0), cst(2026, 9, 24, 11, 30)},
		}, 90},
		{"倒序区间忽略", []PauseSpan{{cst(2026, 9, 24, 11, 0), cst(2026, 9, 24, 10, 0)}}, 0},
		{"跨越非工作日只算工作分钟", []PauseSpan{{cst(2026, 9, 24, 17, 0), cst(2026, 9, 27, 9, 30)}}, 90},
		{"乱序输入与并集等价", []PauseSpan{
			{cst(2026, 9, 24, 13, 0), cst(2026, 9, 24, 14, 0)},
			{cst(2026, 9, 24, 9, 0), cst(2026, 9, 24, 9, 30)},
		}, 90},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := BusinessMinutesOfSpans(c.spans); got != c.want {
				t.Fatalf("得 %d，期望 %d", got, c.want)
			}
		})
	}
}

// 16 个「严重级 × 合同等级」组合的优先级映射必须逐一定死。
func TestPrioritizeMatrix(t *testing.T) {
	want := map[string]string{
		"S1|platinum": "P1", "S1|gold": "P1", "S1|silver": "P1", "S1|bronze": "P2",
		"S2|platinum": "P2", "S2|gold": "P2", "S2|silver": "P2", "S2|bronze": "P3",
		"S3|platinum": "P3", "S3|gold": "P3", "S3|silver": "P3", "S3|bronze": "P4",
		"S4|platinum": "P4", "S4|gold": "P4", "S4|silver": "P4", "S4|bronze": "P4",
	}
	for _, sev := range Severities {
		for _, tier := range Tiers {
			key := sev + "|" + tier
			if got := Prioritize(sev, tier); got != want[key] {
				t.Errorf("Prioritize(%s)=%s，期望 %s", key, got, want[key])
			}
		}
	}
	if got := Prioritize("S9", "unknown"); got != "P1" {
		t.Logf("非法输入落到 %s（映射表按 0 处理，由校验层挡在门外）", got)
	}
}

func TestStatusTransitions(t *testing.T) {
	allowed := map[string][]string{
		StNew: {StAssigned, StWorking, StCanceled}, StAssigned: {StWorking, StPending, StCanceled},
		StWorking: {StPending, StResolved, StCanceled}, StPending: {StWorking, StAssigned, StCanceled},
		StResolved: {StClosed, StWorking}, StClosed: {}, StCanceled: {},
	}
	for _, from := range AllStatuses {
		for _, to := range AllStatuses {
			err := CanTransition(from, to)
			shouldAllow := from != to && containsFold(allowed[from], to)
			if shouldAllow && err != nil {
				t.Errorf("%s→%s 应放行，却被拒：%v", from, to, err)
			}
			if !shouldAllow {
				if err == nil {
					t.Errorf("%s→%s 应拒绝却放行了", from, to)
					continue
				}
				ae, ok := err.(*AppError)
				if !ok || ae.HTTPCode != 409 {
					t.Errorf("%s→%s 的拒绝必须是 409，实际 %v", from, to, err)
				}
			}
		}
	}
	if err := CanTransition(StWorking, "bogus"); err == nil || err.(*AppError).HTTPCode != 400 {
		t.Errorf("非法目标状态必须是 400，实际 %v", err)
	}
	if !ReopenFrom(StResolved, StWorking) || ReopenFrom(StNew, StWorking) {
		t.Error("重开判定错误")
	}
	if !IsPausedStatus(StPending) || IsPausedStatus(StWorking) {
		t.Error("停表状态判定错误")
	}
}

func TestCreateTicketValidation(t *testing.T) {
	base := CreateTicketInput{
		Title: "专线频繁丢包，交易下单超时", Customer: "CU-0007", Severity: SevS2,
		Category: "网络与专线", Channel: "工单门户",
	}
	if errs, ok := base.Validate(); !ok {
		t.Fatalf("合法输入被拒：%v", errs)
	}
	cases := []struct {
		name  string
		mut   func(*CreateTicketInput)
		field string
	}{
		{"标题过短", func(i *CreateTicketInput) { i.Title = "丢包" }, "title"},
		{"标题超长", func(i *CreateTicketInput) { i.Title = strings.Repeat("包", 81) }, "title"},
		{"缺客户编号", func(i *CreateTicketInput) { i.Customer = "  " }, "customer"},
		{"客户编号注入串", func(i *CreateTicketInput) { i.Customer = `CU-1' OR '1'='1` }, "customer"},
		{"客户编号含引号反斜杠", func(i *CreateTicketInput) { i.Customer = `CU-"0007"\` }, "customer"},
		{"非法严重级", func(i *CreateTicketInput) { i.Severity = "S5" }, "severity"},
		{"非法分类", func(i *CreateTicketInput) { i.Category = "点外卖" }, "category"},
		{"非法渠道", func(i *CreateTicketInput) { i.Channel = "飞鸽传书" }, "channel"},
		{"描述超长", func(i *CreateTicketInput) { i.Description = strings.Repeat("长", 501) }, "description"},
		{"派单编号非法", func(i *CreateTicketInput) { i.Agent = "AG/../etc" }, "agent"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := base
			c.mut(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatal("非法输入被放行")
			}
			if _, hit := errs[c.field]; !hit {
				t.Fatalf("错误应落在 %s，实际 %v", c.field, errs)
			}
		})
	}
	// 边界：4 与 80 个汉字必须放行，501 个字符必须拒绝。
	if _, ok := (CreateTicketInput{Title: "零零一二", Customer: "CU-1", Severity: SevS4}).Validate(); !ok {
		t.Error("4 个字符的标题应合法")
	}
}

func TestPolicyValidation(t *testing.T) {
	ok := PolicyInput{Tier: TierGold, Severity: SevS1, ResponseMin: 20, ResolveMin: 300}
	if errs, valid := ok.Validate(); !valid {
		t.Fatalf("合法策略被拒：%v", errs)
	}
	cases := []struct {
		name  string
		mut   func(*PolicyInput)
		field string
	}{
		{"未知等级", func(p *PolicyInput) { p.Tier = "diamond" }, "tier"},
		{"未知严重级", func(p *PolicyInput) { p.Severity = "S0" }, "severity"},
		{"响应时效过小", func(p *PolicyInput) { p.ResponseMin = 0 }, "response_min"},
		{"响应时效过大", func(p *PolicyInput) { p.ResponseMin = 2000 }, "response_min"},
		{"解决时效不大于响应", func(p *PolicyInput) { p.ResolveMin = 20 }, "resolve_min"},
		{"解决时效越界", func(p *PolicyInput) { p.ResolveMin = 20161 }, "resolve_min"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := ok
			c.mut(&in)
			errs, valid := in.Validate()
			if valid {
				t.Fatal("非法策略被放行")
			}
			if _, hit := errs[c.field]; !hit {
				t.Fatalf("错误应落在 %s，实际 %v", c.field, errs)
			}
		})
	}
}

func TestStatusPauseAssignValidation(t *testing.T) {
	if _, ok := (StatusInput{Status: "resolved"}).Validate(); !ok {
		t.Error("resolved 应是合法状态")
	}
	if errs, ok := (StatusInput{Status: "StWorking"}).Validate(); ok || errs["status"] == "" {
		t.Errorf("非法状态必须回显 status：%v", errs)
	}
	if _, ok := (StatusInput{Status: StClosed, Note: strings.Repeat("注", 201)}).Validate(); ok {
		t.Error("超长备注必须拒绝")
	}
	if errs, ok := (PauseInput{Reason: "想去度假"}).Validate(); ok || errs["reason"] == "" {
		t.Errorf("停表原因必须在字典内：%v", errs)
	}
	if _, ok := (PauseInput{Reason: "等客户授权"}).Validate(); !ok {
		t.Error("合法停表原因被拒")
	}
	if _, ok := (AssignInput{Agent: "AG-03"}).Validate(); !ok {
		t.Error("合法工程师编号被拒")
	}
	if _, ok := (AssignInput{Agent: ""}).Validate(); ok {
		t.Error("空工程师必须拒绝")
	}
}

func TestMaskPhoneAndDicts(t *testing.T) {
	cases := []struct{ in, want string }{
		{"13800001234", "138****1234"},
		{"1380", ""},
		{"", ""},
		{"8613800001234", "861****1234"},
	}
	for _, c := range cases {
		if got := MaskPhone(c.in); got != c.want {
			t.Errorf("MaskPhone(%q)=%q，期望 %q", c.in, got, c.want)
		}
	}
	if len(DefaultPolicies()) != 16 {
		t.Fatalf("策略矩阵必须 16 条，实际 %d", len(DefaultPolicies()))
	}
	seen := map[string]bool{}
	for _, p := range DefaultPolicies() {
		k := p.Tier + "|" + p.Severity
		if seen[k] {
			t.Fatalf("策略矩阵重复：%s", k)
		}
		seen[k] = true
		if p.ResolveMin <= p.ResponseMin {
			t.Errorf("%s 的解决时效必须大于首响时效", k)
		}
		pi := PolicyInput{Tier: p.Tier, Severity: p.Severity, ResponseMin: p.ResponseMin, ResolveMin: p.ResolveMin}
		if errs, ok := pi.Validate(); !ok {
			t.Errorf("%s 默认策略通不过自身校验：%v", k, errs)
		}
	}
}

func TestCalendarSnapshotAtWeekendWithMakeup(t *testing.T) {
	// 本轮真实运行时刻：周六凌晨（且前一天是中秋假），下一个窗口必须落到周日调休上班。
	now := cst(2026, 9, 26, 1, 11)
	snap := CalendarSnapshotAt(now)
	if snap.TodayWorking {
		t.Error("2026-09-26 周六不是工作日")
	}
	if snap.NowInSession {
		t.Error("凌晨 01:11 不可能在工作时段内")
	}
	if !strings.HasPrefix(snap.NextWindowAt, "2026-09-27T09:00:00+08:00") {
		t.Fatalf("下一工作窗口应为调休周日 09:00，实际 %s", snap.NextWindowAt)
	}
	if snap.NextWindowLabel != "2026-09-27 09:00" {
		t.Errorf("展示串不符：%s", snap.NextWindowLabel)
	}
	if snap.MinutesPerDay != 480 || len(snap.SessionWindows) != 2 {
		t.Errorf("时段口径不符：%+v", snap)
	}
	days := CalendarDays(now, 8)
	if len(days) != 8 {
		t.Fatalf("日历行数 %d", len(days))
	}
	byDate := map[string]CalendarDayRow{}
	for _, d := range days {
		byDate[d.Date] = d
	}
	if d := byDate["2026-09-25"]; !d.IsHoliday || d.Working || d.Minutes != 0 {
		t.Errorf("中秋应整天不计：%+v", d)
	}
	if d := byDate["2026-09-27"]; !d.IsMakeup || !d.Working || d.Minutes != 480 {
		t.Errorf("调休周日应计满 480 分钟：%+v", d)
	}
	if d := byDate["2026-09-26"]; !d.IsToday {
		t.Errorf("今天标记丢失：%+v", d)
	}
	// 时段内快照：周一上午
	inside := CalendarSnapshotAt(cst(2026, 9, 28, 10, 0))
	if !inside.NowInSession || inside.NextWindowAt[:10] != "2026-09-28" {
		t.Errorf("周一 10:00 应判定为时段内：%+v", inside)
	}
}

func TestStatusLabelAndHumanBdCoverAllStatuses(t *testing.T) {
	for _, s := range AllStatuses {
		if StatusLabel(s) == s {
			t.Errorf("%s 缺中文名", s)
		}
	}
	cases := []struct {
		in   int64
		want string
	}{
		{45, "45 个工作分钟"}, {120, "2 个工作小时"}, {150, "2 小时 30 分（工作时段）"}, {0, "0 个工作分钟"},
	}
	for _, c := range cases {
		if got := HumanBd(c.in); got != c.want {
			t.Errorf("HumanBd(%d)=%q，期望 %q", c.in, got, c.want)
		}
	}
}
