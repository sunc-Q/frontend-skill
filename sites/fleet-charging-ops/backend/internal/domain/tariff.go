package domain

import (
	"sort"
	"time"
)

// ComputeBill 是全网唯一的分时计价入口：结算落库、试算接口、种子灌数三处共用，
// 统计层绝不第二次算价，因此
//
//	总电费 = Σ分段电费、总额 = 电费 + 服务费 + 超时占用费、Σ分段瓦时 + 未定价瓦时 = 实际电量
//
// 是结构性恒等式。
//
// 口径（写死在此处，README 同段复述）：
//  1. 时间轴按「本地日（UTC+8）分钟边界 ∪ 规则窗口边界」切run，跨零点窗口天然支持；
//  2. 同一分钟多条规则命中时按 priority 升序、code 升序取第一条（调用侧已排序）；
//  3. 电量按各 run 时长占比分摊（整型瓦时，余数按「余数降序 → run 序号升序」补给，确定且和恒等）；
//  4. 分段电费 = round_half_up(该段瓦时 × 电价分 ÷ 1000)，服务费同理；
//  5. 未被任何启用规则覆盖的分钟记 unpriced：电量参与分摊、金额为零，Covered=false；
//  6. 超时占用费 = min(overstay_min, 360) × 8 分/分钟；
//  7. 总额 = 电费 + 服务费 + 超时占用费。
type BillInput struct {
	Start       time.Time
	End         time.Time
	ActualWh    int64
	OverstayMin int
	Rules       []TariffRule // 调用侧用 SortRulesActive 排好序
}

type Bill struct {
	Segments      []SegmentView
	PeakWh        int64
	FlatWh        int64
	ValleyWh      int64
	UnpricedWh    int64
	ElecCents     int64
	ServiceCents  int64
	OverstayCents int64
	OverstayMin   int // 已按上限截断后的实际计费分钟数
	TotalCents    int64
	Covered       bool
	UnpricedMin   int
}

// run 是计价引擎内部的一段同质窗口。
type run struct {
	start, end time.Time   // UTC 瞬刻
	rule       *TariffRule // nil = 未覆盖
}

func ComputeBill(in BillInput) *Bill {
	b := &Bill{Segments: []SegmentView{}, Covered: true}
	totalSecs := int64(in.End.Sub(in.Start).Seconds())
	if totalSecs <= 0 || in.ActualWh <= 0 {
		// 退化区间（同一分钟开充即结算）：没有窗口可拆，电量整笔落在「未定价」桶里，
		// 这样 Σ分段+未定价==实际 这条恒等式在零时长上依然成立，而不是假性破口。
		b.UnpricedWh = in.ActualWh
		b.Covered = in.ActualWh == 0
		return b
	}
	runs := splitRuns(in.Start, in.End, in.Rules)

	// 第一步：整型下限分摊，记录每个 run 的余数；第二步：按余数降序（同余按序号升序）
	// 把剩余瓦时逐个补上——保证 Σ分段瓦时 == ActualWh 恒等。
	wh := make([]int64, len(runs))
	rem := make([]int64, len(runs))
	assigned := int64(0)
	for i, r := range runs {
		secs := int64(r.end.Sub(r.start).Seconds())
		wh[i] = in.ActualWh * secs / totalSecs
		rem[i] = in.ActualWh * secs % totalSecs
		assigned += wh[i]
	}
	leftover := in.ActualWh - assigned
	order := make([]int, len(runs))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool { return rem[order[i]] > rem[order[j]] })
	for k := int64(0); k < leftover && k < int64(len(order)); k++ {
		wh[order[k]]++
	}

	for i, r := range runs {
		minutes := int(r.end.Sub(r.start).Seconds() / 60)
		if r.rule == nil {
			b.UnpricedWh += wh[i]
			b.UnpricedMin += minutes
			b.Covered = false
			continue
		}
		seg := SegmentView{
			Period: r.rule.Period, RuleCode: r.rule.Code, RuleName: r.rule.Name,
			StartAt: r.start, EndAt: r.end, Minutes: minutes, Wh: wh[i],
			ElecCents:    roundHalfUp(wh[i]*r.rule.ElecCents, 1000),
			ServiceCents: roundHalfUp(wh[i]*r.rule.ServiceCents, 1000),
		}
		b.Segments = append(b.Segments, seg)
		b.ElecCents += seg.ElecCents
		b.ServiceCents += seg.ServiceCents
		switch r.rule.Period {
		case PeriodPeak:
			b.PeakWh += wh[i]
		case PeriodFlat:
			b.FlatWh += wh[i]
		case PeriodValley:
			b.ValleyWh += wh[i]
		}
	}
	ost := in.OverstayMin
	if ost > MaxOverstayMin {
		ost = MaxOverstayMin
	}
	if ost < 0 {
		ost = 0
	}
	b.OverstayMin = ost
	b.OverstayCents = int64(ost) * OverstayCentsPerMin
	b.TotalCents = b.ElecCents + b.ServiceCents + b.OverstayCents
	return b
}

// IdentityOK 复算三条恒等式，结算与试算出口都要过这一关。
func (b *Bill) IdentityOK(actualWh int64) bool {
	sumWh := int64(0)
	sumElec, sumSvc := int64(0), int64(0)
	for _, s := range b.Segments {
		sumWh += s.Wh
		sumElec += s.ElecCents
		sumSvc += s.ServiceCents
	}
	return sumWh+b.UnpricedWh == actualWh &&
		b.PeakWh+b.FlatWh+b.ValleyWh+b.UnpricedWh == actualWh &&
		b.ElecCents == sumElec && b.ServiceCents == sumSvc &&
		b.TotalCents == b.ElecCents+b.ServiceCents+b.OverstayCents
}

// splitRuns 把 [start,end) 切成同质窗口：边界 = 本地日分钟边界 ∪ 规则窗口边界。
func splitRuns(start, end time.Time, rules []TariffRule) []run {
	var runs []run
	cur := start
	for cur.Before(end) {
		next := cur.Add(time.Minute)
		if next.After(end) {
			next = end
		}
		r := run{start: cur, end: next, rule: matchRule(cur, rules)}
		// 相邻同规则合并，避免每个分钟都出一段（分钟级窗口下也能保持一天最多几条）。
		if n := len(runs); n > 0 && runs[n-1].rule == r.rule && runs[n-1].end.Equal(r.start) {
			runs[n-1].end = r.end
		} else {
			runs = append(runs, r)
		}
		cur = next
	}
	return runs
}

// 边界策略：逐分钟推进 + 相邻同规则合并。规则窗口都是分钟粒度，本地日界也落在分钟上，
// 因此分钟步进天然覆盖「窗口边界 ∪ 日界」，无需单独枚举，代价是每会话最多约 480 次判定。

// matchRule 按 priority→code 顺序取第一条覆盖「该瞬刻（本地日分钟 + 星期）」的规则。
func matchRule(at time.Time, rules []TariffRule) *TariffRule {
	local := at.Add(BizOffsetHours * time.Hour)
	minute := local.Hour()*60 + local.Minute()
	weekday := local.Weekday()
	weekend := weekday == time.Saturday || weekday == time.Sunday
	for i := range rules {
		r := &rules[i]
		if !r.CoversDay(weekend) || !r.CoversLocalMinute(minute) {
			continue
		}
		return r
	}
	return nil
}

// SortRulesActive 把启用规则排成确定性顺序（优先级 → 标识）。
func SortRulesActive(rules []TariffRule) []TariffRule {
	out := make([]TariffRule, 0, len(rules))
	for _, r := range rules {
		if r.Active {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		return out[i].Code < out[j].Code
	})
	return out
}

func roundHalfUp(num, den int64) int64 {
	if den <= 0 {
		return 0
	}
	if num < 0 {
		return -roundHalfUp(-num, den)
	}
	return (num + den/2) / den
}

// RoundHalfUpInt 暴露给仓储层做均价等派生计算。
func RoundHalfUpInt(num, den int64) int64 { return roundHalfUp(num, den) }
