package domain

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func utc(y int, mo time.Month, d, h, mi int) time.Time {
	return time.Date(y, mo, d, h, mi, 0, 0, time.UTC)
}

// 一套与种子同构的最小价目表：工作日六段（含跨零点低谷）+ 周末三段（含全天兜底）。
func testRules() []TariffRule {
	return SortRulesActive([]TariffRule{
		{Code: "wd-valley", Name: "工作日低谷", Period: PeriodValley, DayType: DayWeekday,
			StartMin: 1380, EndMin: 420, ElecCents: 35, ServiceCents: 10, Priority: 11, Active: true},
		{Code: "wd-peak-a", Name: "早高峰", Period: PeriodPeak, DayType: DayWeekday,
			StartMin: 480, EndMin: 660, ElecCents: 125, ServiceCents: 60, Priority: 12, Active: true},
		{Code: "wd-peak-b", Name: "晚高峰", Period: PeriodPeak, DayType: DayWeekday,
			StartMin: 1080, EndMin: 1260, ElecCents: 125, ServiceCents: 60, Priority: 13, Active: true},
		{Code: "wd-flat-a", Name: "晨间平段", Period: PeriodFlat, DayType: DayWeekday,
			StartMin: 420, EndMin: 480, ElecCents: 72, ServiceCents: 40, Priority: 14, Active: true},
		{Code: "wd-flat-b", Name: "午间平段", Period: PeriodFlat, DayType: DayWeekday,
			StartMin: 660, EndMin: 1080, ElecCents: 72, ServiceCents: 40, Priority: 15, Active: true},
		{Code: "wd-flat-c", Name: "夜间平段", Period: PeriodFlat, DayType: DayWeekday,
			StartMin: 1260, EndMin: 1380, ElecCents: 72, ServiceCents: 40, Priority: 16, Active: true},
		{Code: "we-valley", Name: "周末凌晨低谷", Period: PeriodValley, DayType: DayWeekend,
			StartMin: 0, EndMin: 420, ElecCents: 33, ServiceCents: 8, Priority: 21, Active: true},
		{Code: "we-peak", Name: "周末日间高峰", Period: PeriodPeak, DayType: DayWeekend,
			StartMin: 600, EndMin: 1200, ElecCents: 118, ServiceCents: 58, Priority: 22, Active: true},
		{Code: "we-flat-base", Name: "周末兜底平段", Period: PeriodFlat, DayType: DayWeekend,
			StartMin: 0, EndMin: 1440, ElecCents: 66, ServiceCents: 42, Priority: 90, Active: true},
		{Code: "off-deep", Name: "停用规则", Period: PeriodValley, DayType: DayAny,
			StartMin: 120, EndMin: 300, ElecCents: 22, ServiceCents: 5, Priority: 5, Active: false},
	})
}

func TestCoversLocalMinute(t *testing.T) {
	cases := []struct {
		name          string
		start, end, m int
		want          bool
	}{
		{"普通窗口内", 480, 660, 500, true},
		{"窗口起点闭", 480, 660, 480, true},
		{"窗口终点开", 480, 660, 660, false},
		{"跨零点-深夜", 1380, 420, 1400, true},
		{"跨零点-凌晨", 1380, 420, 100, true},
		{"跨零点-白天", 1380, 420, 600, false},
		{"全天窗口", 0, 1440, 1439, true},
		{"起止相同视为无效", 300, 300, 300, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := TariffRule{StartMin: tc.start, EndMin: tc.end}
			if got := r.CoversLocalMinute(tc.m); got != tc.want {
				t.Fatalf("CoversLocalMinute(%d) = %v, want %v", tc.m, got, tc.want)
			}
		})
	}
}

func TestComputeBillSegmentSplitAndIdentities(t *testing.T) {
	rules := testRules()
	// 2026-09-21 是周一。本地 20:00→23:00（UTC 12:00→15:00）应命中：
	// 晚高峰 20-21 点 + 夜间平段 21-23 点。
	cases := []struct {
		name               string
		start, end         time.Time
		wh                 int64
		wantSegs           int
		peak, flat, valley int64 // 期望的三档电量（允许 ±2Wh 的整型分摊漂移）
	}{
		{"晚峰+夜平", utc(2026, 9, 21, 12, 0), utc(2026, 9, 21, 15, 0), 60_000, 2, 20_000, 40_000, 0},
		{"跨零点（晚峰 18-21 → 夜平 21-23 → 低谷 23-07）", utc(2026, 9, 21, 10, 0), utc(2026, 9, 21, 23, 0), 130_000, 3, 30_000, 20_000, 80_000},
		{"周末白天命中周末高峰规则", utc(2026, 9, 26, 2, 0), utc(2026, 9, 26, 5, 0), 30_000, 1, 30_000, 0, 0},
		{"周五夜里跨入周六凌晨（日型切换）", utc(2026, 9, 25, 15, 30), utc(2026, 9, 25, 16, 30), 10_000, 2, 0, 0, 10_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := ComputeBill(BillInput{Start: tc.start, End: tc.end, ActualWh: tc.wh, Rules: rules})
			if len(b.Segments) != tc.wantSegs {
				t.Fatalf("分段数 = %d, want %d（%+v）", len(b.Segments), tc.wantSegs, b.Segments)
			}
			if !b.Covered {
				t.Fatalf("该窗口应被完整定价，UnpricedWh=%d", b.UnpricedWh)
			}
			if !b.IdentityOK(tc.wh) {
				t.Fatalf("恒等式破口: %+v", b)
			}
			approx := func(got int64, want int64) bool {
				d := got - want
				if d < 0 {
					d = -d
				}
				return d <= 2
			}
			if !approx(b.PeakWh, tc.peak) || !approx(b.FlatWh, tc.flat) || !approx(b.ValleyWh, tc.valley) {
				t.Fatalf("三档电量 = peak %d flat %d valley %d, want %d/%d/%d",
					b.PeakWh, b.FlatWh, b.ValleyWh, tc.peak, tc.flat, tc.valley)
			}
			sum := int64(0)
			for _, s := range b.Segments {
				sum += s.Wh
			}
			if sum != tc.wh {
				t.Fatalf("Σ分段瓦时 %d ≠ %d", sum, tc.wh)
			}
		})
	}
}

func TestComputeBillArbitrationAndUnpriced(t *testing.T) {
	// 两条规则同时命中本地 11:00-12:00（priority 小者胜），12:00-13:00 无人覆盖 → unpriced。
	rules := SortRulesActive([]TariffRule{
		{Code: "hi", Period: PeriodPeak, DayType: DayAny, StartMin: 660, EndMin: 720,
			ElecCents: 100, ServiceCents: 50, Priority: 1, Active: true},
		{Code: "lo", Period: PeriodFlat, DayType: DayAny, StartMin: 660, EndMin: 720,
			ElecCents: 50, ServiceCents: 10, Priority: 9, Active: true},
	})
	// 本地 11:00-13:00 = UTC 03:00-05:00（周一）。
	b := ComputeBill(BillInput{
		Start: utc(2026, 9, 21, 3, 0), End: utc(2026, 9, 21, 5, 0), ActualWh: 40_000, Rules: rules,
	})
	if b.Covered {
		t.Fatal("12:00 后无规则覆盖，Covered 应为 false")
	}
	if len(b.Segments) != 1 || b.Segments[0].RuleCode != "hi" {
		t.Fatalf("仲裁结果应只有 hi 胜出: %+v", b.Segments)
	}
	if b.UnpricedWh != 20_000 {
		t.Fatalf("未覆盖半段应摊 20000Wh, got %d", b.UnpricedWh)
	}
	if !b.IdentityOK(40_000) {
		t.Fatalf("含 unpriced 时恒等式仍须成立: %+v", b)
	}
	if b.TotalCents != b.Segments[0].ElecCents+b.Segments[0].ServiceCents {
		t.Fatal("总额必须等于分段金额之和")
	}
}

func TestComputeBillDegenerateWindows(t *testing.T) {
	rules := testRules()
	// 同一分钟开充即结算：没有窗口可拆，但恒等式必须照样成立。
	b := ComputeBill(BillInput{Start: utc(2026, 9, 21, 12, 0), End: utc(2026, 9, 21, 12, 0), ActualWh: 5_000, Rules: rules})
	if !b.IdentityOK(5_000) {
		t.Fatalf("零时长恒等式破口: %+v", b)
	}
	if len(b.Segments) != 0 || b.TotalCents != 0 || b.UnpricedWh != 5_000 {
		t.Fatalf("零时长应整笔落未定价: %+v", b)
	}
	// 零电量：不产生未定价桶，也不该报错。
	z := ComputeBill(BillInput{Start: utc(2026, 9, 21, 12, 0), End: utc(2026, 9, 21, 13, 0), Rules: rules})
	if !z.IdentityOK(0) || !z.Covered {
		t.Fatalf("零电量: %+v", z)
	}
	// 倒挂区间按零时长处理，绝不出现负分摊。
	neg := ComputeBill(BillInput{Start: utc(2026, 9, 21, 13, 0), End: utc(2026, 9, 21, 12, 0), ActualWh: 3_000, Rules: rules})
	if !neg.IdentityOK(3_000) {
		t.Fatalf("倒挂区间恒等式破口: %+v", neg)
	}
}

func TestComputeBillOverstay(t *testing.T) {
	rules := testRules()
	cases := []struct {
		name      string
		mins      int
		wantCents int64
		wantMin   int
	}{
		{"零超时", 0, 0, 0},
		{"常规 30 分钟", 30, 240, 30},
		{"恰好封顶", MaxOverstayMin, int64(MaxOverstayMin) * OverstayCentsPerMin, MaxOverstayMin},
		{"越界截断到封顶", MaxOverstayMin + 120, int64(MaxOverstayMin) * OverstayCentsPerMin, MaxOverstayMin},
		{"负数按零", -5, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b := ComputeBill(BillInput{
				Start: utc(2026, 9, 21, 12, 0), End: utc(2026, 9, 21, 13, 0),
				ActualWh: 10_000, OverstayMin: tc.mins, Rules: rules,
			})
			if b.OverstayCents != tc.wantCents || b.OverstayMin != tc.wantMin {
				t.Fatalf("占用费 = %d 分 / %d 分钟, want %d / %d", b.OverstayCents, b.OverstayMin, tc.wantCents, tc.wantMin)
			}
			if !b.IdentityOK(10_000) {
				t.Fatalf("恒等式破口: %+v", b)
			}
		})
	}
}

func TestSessionStatusMatrix(t *testing.T) {
	all := []string{SessCharging, SessCompleted, SessFaulted, SessAborted}
	want := map[string][]string{
		SessCharging:  {SessCompleted, SessFaulted},
		SessFaulted:   {SessCompleted, SessAborted},
		SessCompleted: {},
		SessAborted:   {},
	}
	for _, from := range all {
		for _, to := range all {
			got := CanAdvance(from, to)
			allowed := false
			for _, w := range want[from] {
				if w == to {
					allowed = true
				}
			}
			if got != allowed {
				t.Errorf("CanAdvance(%s,%s) = %v, want %v", from, to, got, allowed)
			}
		}
	}
}

func TestStartSessionValidate(t *testing.T) {
	cases := []struct {
		name    string
		in      StartSessionInput
		badKeys []string
	}{
		{"全部合法", StartSessionInput{PileCode: "DC-A01", PlateNo: "沪AD12345", PlannedWh: 40_000}, nil},
		{"桩号注入串", StartSessionInput{PileCode: "DC' OR 1=1--", PlateNo: "沪AD12345", PlannedWh: 40_000}, []string{"pile_code"}},
		{"车牌缺汉字头", StartSessionInput{PileCode: "DC-A01", PlateNo: "XA12345", PlannedWh: 40_000}, []string{"plate_no"}},
		{"车牌小写字母", StartSessionInput{PileCode: "DC-A01", PlateNo: "沪ad12345", PlannedWh: 40_000}, []string{"plate_no"}},
		{"计划电量为零", StartSessionInput{PileCode: "DC-A01", PlateNo: "沪AD12345", PlannedWh: 0}, []string{"planned_wh"}},
		{"计划电量超上限", StartSessionInput{PileCode: "DC-A01", PlateNo: "沪AD12345", PlannedWh: 700_000}, []string{"planned_wh"}},
		{"备注超长", StartSessionInput{PileCode: "DC-A01", PlateNo: "沪AD12345", PlannedWh: 40_000,
			Note: string(make([]rune, 121))}, []string{"note"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if len(tc.badKeys) == 0 {
				if !ok {
					t.Fatalf("应通过校验，实际 %v", errs)
				}
				return
			}
			if ok {
				t.Fatalf("应被拒绝，实际通过")
			}
			for _, k := range tc.badKeys {
				if _, has := errs[k]; !has {
					t.Errorf("错误集缺少键 %s（全部=%v）", k, errs)
				}
			}
		})
	}
}

func TestSettleAndTariffValidate(t *testing.T) {
	if _, ok := (SettleInput{ActualWh: 50, OverstayMin: 0}).Validate(); ok {
		t.Error("actual_wh 低于下限应被拒")
	}
	if _, ok := (SettleInput{ActualWh: 10_000, OverstayMin: 400}).Validate(); ok {
		t.Error("overstay 超上限应被拒")
	}
	if errs, ok := (CreateTariffInput{Code: "t-1", Name: "测试", Period: "superpeak",
		DayType: DayAny, StartMin: 100, EndMin: 100, ElecCents: 50, ServiceCents: 10, Priority: 5}).Validate(); ok {
		t.Error("非法 period 应被拒")
	} else if _, has := errs["period"]; !has {
		t.Errorf("错误集缺 period: %v", errs)
	}
	if errs, ok := (CreateTariffInput{Code: "t-1", Name: "测试", Period: PeriodPeak,
		DayType: "holiday", StartMin: 0, EndMin: 1440, ElecCents: 50, ServiceCents: 10, Priority: 5}).Validate(); ok {
		t.Error("非法 day_type 应被拒")
	} else if _, has := errs["day_type"]; !has {
		t.Errorf("错误集缺 day_type: %v", errs)
	}
	if _, ok := (CreateTariffInput{Code: "t-1", Name: "测试", Period: PeriodPeak,
		DayType: DayAny, StartMin: 0, EndMin: 1440, ElecCents: 50, ServiceCents: 10, Priority: 5}).Validate(); !ok {
		t.Error("全部合法却被拒")
	}
	if _, ok := (PileStatusInput{Status: "broken"}).Validate(); ok {
		t.Error("非法桩状态应被拒")
	}
}

func TestParseListQueryConvergence(t *testing.T) {
	q := ParseListQuery(map[string][]string{})
	if q.SortKey != "start" || q.Dir != "desc" || q.Page != 1 || q.PageSize != DefaultPageSz {
		t.Fatalf("默认值不符: %+v", q)
	}
	q = ParseListQuery(map[string][]string{
		"status":    {"'; DROP TABLE charge_sessions;--"},
		"sort":      {"total_cents"}, // 内部列名不是白名单键
		"dir":       {"SIDEWAYS"},
		"page":      {"-4"},
		"page_size": {"99999"},
		"pile":      {"DC' OR '1'='1"},
	})
	if q.Status != "" || q.SortKey != "start" || q.Dir != "desc" || q.Page != 1 {
		t.Fatalf("非法值应收敛而非生效: %+v", q)
	}
	if q.PageSize != MaxPageSize {
		t.Fatalf("page_size 应被钳到 %d, got %d", MaxPageSize, q.PageSize)
	}
	if q.PileCode != "" {
		t.Fatal("注入型 pile 参数应被丢弃")
	}
	long := make([]string, MaxQueryRunes+30)
	for i := range long {
		long[i] = "电"
	}
	q = ParseListQuery(map[string][]string{"q": {strings.Join(long, "")}})
	if len([]rune(q.Search)) != MaxQueryRunes {
		t.Fatalf("搜索串未截断: %d", len([]rune(q.Search)))
	}
}

func TestQuoteQueryValidate(t *testing.T) {
	if _, errs, ok := ParseQuoteQuery(map[string][]string{"pile": {"DC-A01"}, "wh": {"40000"}, "minutes": {"90"}}); !ok {
		t.Fatalf("合法试算被拒: %v", errs)
	}
	if _, errs, ok := ParseQuoteQuery(map[string][]string{"pile": {"DC-A01"}, "wh": {"40000"}, "minutes": {"2"}}); ok {
		t.Fatal("minutes<5 应被拒")
	} else if _, has := errs["minutes"]; !has {
		t.Errorf("错误集缺 minutes: %v", errs)
	}
	if _, _, ok := ParseQuoteQuery(map[string][]string{"wh": {"40000"}, "minutes": {"90"}}); ok {
		t.Fatal("缺 pile 应被拒")
	}
}

// 价目表必须与工作日的规则表逐分钟一致：两块板（工作日/周末）各自无空隙、
// 无重叠地铺满 0-1440，且每条规则的窗口时长之和 = 该规则在板上实际赢下的分钟数。
func TestBuildRateBoardCoversWholeDay(t *testing.T) {
	rules := testRules()
	board := BuildRateBoard(rules)

	type key struct{ dayType, code string }
	sum := map[key]int{}
	codes := map[string][][2]int{} // DayType -> [from,to)
	for _, w := range board {
		var fh, fm, th, tm int
		if n, err := fmt.Sscanf(w.Window, "%d:%d-%d:%d", &fh, &fm, &th, &tm); n != 4 || err != nil {
			t.Fatalf("窗口格式坏: %q", w.Window)
		}
		from, to := fh*60+fm, th*60+tm
		if to <= from {
			t.Fatalf("窗口倒挂: %q", w.Window)
		}
		sum[key{w.DayType, w.RuleCode}] += to - from
		codes[w.DayType] = append(codes[w.DayType], [2]int{from, to})
	}

	for _, dt := range []string{DayWeekday, DayWeekend} {
		spans := codes[dt]
		if len(spans) == 0 {
			t.Fatalf("%s 板为空", dt)
		}
		total := 0
		for i, s := range spans {
			if i > 0 && s[0] != spans[i-1][1] {
				t.Fatalf("%s 板在第 %d 段出现空隙/重叠: %d 接 %v", dt, i, spans[i-1][1], s)
			}
			total += s[1] - s[0]
		}
		if spans[0][0] != 0 || spans[len(spans)-1][1] != 1440 || total != 1440 {
			t.Fatalf("%s 板未铺满全天: first=%v last=%v total=%d", dt, spans[0], spans[len(spans)-1], total)
		}
	}

	// 逐分钟对照：板上每个分钟窗口的规则码必须等于 matchMinute 的胜者。
	sorted := SortRulesActive(rules)
	for _, dt := range []string{DayWeekday, DayWeekend} {
		weekend := dt == DayWeekend
		var cur *TariffRule
		var run int
		wins := map[string]int{}
		for m := 0; m < 1440; m++ {
			w := matchMinute(m, weekend, sorted)
			if w == nil {
				t.Fatalf("%s %02d:%02d 无人覆盖，种子规则表应有兜底", dt, m/60, m%60)
			}
			if cur != nil && w.Code != cur.Code {
				wins[cur.Code] += m - run
				run = m
			} else if cur == nil {
				run = m
			}
			cur = w
		}
		wins[cur.Code] += 1440 - run
		for code, mins := range wins {
			if got := sum[key{dt, code}]; got != mins {
				t.Errorf("%s/%s 板时长 %d != 逐分钟 %d", dt, code, got, mins)
			}
		}
	}
}
