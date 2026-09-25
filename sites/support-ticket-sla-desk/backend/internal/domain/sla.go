package domain

import (
	"sort"
	"strconv"
	"time"
)

// FieldTZ 是驻场服务团队统一使用的「现场时区」：东八区、无夏令时。
// 数据库里一律存 UTC，但 SLA 时效判定必须按现场挂钟的工作日历算，
// 所以引擎入口统一 .In(FieldTZ)，绝不用机器本地时区。
var FieldTZ = time.FixedZone("CST", FieldOffsetMin*60)

// FieldOffsetMin 是现场时区相对 UTC 的分钟偏移。写接口把它下发给前端，
// 让展示层做的是「UTC → 固定偏移」的确定性换算，而不是跟着看报表那台机器的时区走。
const FieldOffsetMin = 8 * 60

// 每日两个工作时段（分钟偏移，左闭右开）：09:00-12:00、13:00-18:00。
// 午休 12:00-13:00 不计时——这是 SLA 时效最容易吵起来的一段，必须显式建模。
var sessions = []struct{ from, to int }{
	{9 * 60, 12 * 60},
	{13 * 60, 18 * 60},
}

// MinutesPerDay 由工作窗口累加得出，而不是另写一份 480——两处口径迟早会漂移。
var MinutesPerDay = func() int {
	n := 0
	for _, s := range sessions {
		n += s.to - s.from
	}
	return n
}()

// 法定节假日（现场日期）：整天不计时。
var holidayDates = []string{
	"2026-09-25",                             // 中秋
	"2026-10-01", "2026-10-02", "2026-10-03", // 国庆
}

// 调休上班的周末：是休息日也照常计时。
var makeupDates = []string{
	"2026-09-27", // 周日调休上班
	"2026-10-10", // 周六调休上班
}

var holidaySet = toDateSet(holidayDates)
var makeupSet = toDateSet(makeupDates)

func toDateSet(ds []string) map[string]bool {
	m := make(map[string]bool, len(ds))
	for _, d := range ds {
		m[d] = true
	}
	return m
}

func dateKey(t time.Time) string { return t.In(FieldTZ).Format("2006-01-02") }

func dayStart(t time.Time) time.Time {
	l := t.In(FieldTZ)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, FieldTZ)
}

// IsWorkingDay 判定优先级：调休上班 > 法定节假日 > 周一至周五。
func IsWorkingDay(t time.Time) bool {
	k := dateKey(t)
	if makeupSet[k] {
		return true
	}
	if holidaySet[k] {
		return false
	}
	wd := t.In(FieldTZ).Weekday()
	return wd >= time.Monday && wd <= time.Friday
}

func DayReason(t time.Time) string { return dayReason(t) }

func DateKey(t time.Time) string { return dateKey(t) }

func StartOfDay(t time.Time) time.Time { return dayStart(t) }

func dayReason(t time.Time) string {
	k := dateKey(t)
	switch {
	case makeupSet[k] && holidaySet[k]:
		return "调休上班（覆盖节假日）"
	case makeupSet[k]:
		return "调休上班"
	case holidaySet[k]:
		return "法定节假日"
	case IsWorkingDay(t):
		return "标准工作日"
	default:
		return "周末休息"
	}
}

func daySessions(t time.Time) []struct{ from, to int } {
	if !IsWorkingDay(t) {
		return nil
	}
	return sessions
}

var weekdayCN = []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}

// NextSessionAt 返回 t 之后（含 t 当刻）下一个仍有余量的工作时段起点。
// 用于把「非工作时段创建/挂起」的工单正确推进到下一个计时窗口。
func NextSessionAt(t time.Time) time.Time {
	cur := t.In(FieldTZ)
	for i := 0; i < 800; i++ {
		d := dayStart(cur).AddDate(0, 0, i)
		for _, s := range daySessions(d) {
			start := d.Add(time.Duration(s.from) * time.Minute)
			end := d.Add(time.Duration(s.to) * time.Minute)
			if !end.After(cur) {
				continue // 整段已经过去
			}
			if start.Before(cur) {
				return cur // 正落在时段内
			}
			return start
		}
	}
	return cur
}

// BusinessMinutesBetween 统计 [from,to) 之间落在工作时段内的整分钟数。
// 输入按分钟对齐（种子与接口都保证 seconds=0），因此结果不含截断误差；
// 传入非对齐时刻时向下取整，方向稳定（不会把不足一分钟的尾巴算成 1）。
func BusinessMinutesBetween(from, to time.Time) int64 {
	if !to.After(from) {
		return 0
	}
	f, t := from.In(FieldTZ), to.In(FieldTZ)
	total := int64(0)
	d := dayStart(f)
	lastDay := dayStart(t)
	for ; !d.After(lastDay); d = d.AddDate(0, 0, 1) {
		for _, s := range daySessions(d) {
			a := d.Add(time.Duration(s.from) * time.Minute)
			b := d.Add(time.Duration(s.to) * time.Minute)
			if f.After(a) {
				a = f
			}
			if t.Before(b) {
				b = t
			}
			if b.After(a) {
				total += int64(b.Sub(a).Minutes())
			}
		}
	}
	return total
}

// AdvanceBusiness 从 start 起累计 target 个「工作分钟」后的时刻。
// 与 BusinessMinutesBetween 互逆，这个往返性质由测试逐条断言。
func AdvanceBusiness(start time.Time, target int64) time.Time {
	if target <= 0 {
		return start.UTC()
	}
	cur := NextSessionAt(start)
	used := int64(0)
	d := dayStart(cur)
	limit := d.AddDate(4, 0, 0)
	for ; !d.After(limit); d = d.AddDate(0, 0, 1) {
		for _, s := range daySessions(d) {
			segA := d.Add(time.Duration(s.from) * time.Minute)
			segB := d.Add(time.Duration(s.to) * time.Minute)
			if !segB.After(cur) {
				continue
			}
			a := segA
			if cur.After(a) {
				a = cur
			}
			avail := int64(segB.Sub(a).Minutes())
			if avail <= 0 {
				continue
			}
			if used+avail >= target {
				return a.Add(time.Duration(target-used) * time.Minute).UTC()
			}
			used += avail
			cur = segB
		}
	}
	return start.Add(time.Duration(target) * time.Minute).UTC()
}

// PauseSpan 是一段挂起区间（现场挂钟），用于从时间线复算停表分钟。
type PauseSpan struct {
	From time.Time
	To   time.Time
}

// BusinessMinutesOfSpans 把若干挂起区间折算成工作分钟（区间重叠时按并集计）。
func BusinessMinutesOfSpans(spans []PauseSpan) int64 {
	if len(spans) == 0 {
		return 0
	}
	type iv struct{ a, b time.Time }
	ivs := make([]iv, 0, len(spans))
	for _, s := range spans {
		if s.To.After(s.From) {
			ivs = append(ivs, iv{s.From, s.To})
		}
	}
	sort.Slice(ivs, func(i, j int) bool { return ivs[i].a.Before(ivs[j].a) })
	merged := make([]iv, 0, len(ivs))
	for _, cur := range ivs {
		if n := len(merged); n > 0 && !cur.a.After(merged[n-1].b) {
			if cur.b.After(merged[n-1].b) {
				merged[n-1].b = cur.b
			}
			continue
		}
		merged = append(merged, cur)
	}
	total := int64(0)
	for _, m := range merged {
		total += BusinessMinutesBetween(m.a, m.b)
	}
	return total
}

// ---- SLA 策略与优先级 ----

const (
	TierPlatinum = "platinum"
	TierGold     = "gold"
	TierSilver   = "silver"
	TierBronze   = "bronze"

	SevS1 = "S1"
	SevS2 = "S2"
	SevS3 = "S3"
	SevS4 = "S4"
)

var Tiers = []string{TierPlatinum, TierGold, TierSilver, TierBronze}
var Severities = []string{SevS1, SevS2, SevS3, SevS4}

func ValidTier(t string) bool {
	for _, v := range Tiers {
		if v == t {
			return true
		}
	}
	return false
}

func ValidSeverity(s string) bool {
	for _, v := range Severities {
		if v == s {
			return true
		}
	}
	return false
}

// DefaultPolicies 只是 16 条策略的种子来源；运行时一律读 sla_policies 表。
// 做成表是因为「合同改时效」是运营动作，不该发版。
func DefaultPolicies() []SlaPolicy {
	type row struct{ resp, resolve int }
	table := map[string]map[string]row{
		TierPlatinum: {SevS1: {15, 240}, SevS2: {30, 480}, SevS3: {60, 1440}, SevS4: {120, 2880}},
		TierGold:     {SevS1: {20, 300}, SevS2: {40, 600}, SevS3: {90, 1800}, SevS4: {180, 4320}},
		TierSilver:   {SevS1: {30, 480}, SevS2: {60, 960}, SevS3: {120, 2880}, SevS4: {240, 5760}},
		TierBronze:   {SevS1: {45, 720}, SevS2: {90, 1440}, SevS3: {180, 4320}, SevS4: {360, 8640}},
	}
	out := make([]SlaPolicy, 0, 16)
	for _, tier := range Tiers {
		for _, sev := range Severities {
			r := table[tier][sev]
			out = append(out, SlaPolicy{
				Tier: tier, Severity: sev,
				ResponseMin: r.resp, ResolveMin: r.resolve,
				Description: TierLabel(tier) + " · " + sev + " 级：" + humanBd(int64(r.resolve)),
			})
		}
	}
	return out
}

func TierLabel(t string) string {
	switch t {
	case TierPlatinum:
		return "铂金（7×24 驻场）"
	case TierGold:
		return "黄金（5×8+值班）"
	case TierSilver:
		return "白银（5×8）"
	default:
		return "青铜（次日响应）"
	}
}

// Prioritize 用「严重级 × 合同等级」压成 P1-P4：分越小越急。
// 显式打分而不是查表，方便表驱动测试覆盖 16 个组合。
func Prioritize(severity, tier string) string {
	sevIdx := map[string]int{SevS1: 0, SevS2: 1, SevS3: 2, SevS4: 3}[severity]
	tierRank := map[string]int{TierPlatinum: 0, TierGold: 1, TierSilver: 2, TierBronze: 3}[tier]
	score := sevIdx*4 + tierRank
	switch {
	case score <= 2:
		return "P1"
	case score <= 6:
		return "P2"
	case score <= 10:
		return "P3"
	default:
		return "P4"
	}
}

// humanBd 把「工作分钟」翻成人话，用于策略说明与前端提示。
func humanBd(minutes int64) string {
	h := minutes / 60
	m := minutes % 60
	if h == 0 {
		return itoa(m) + " 个工作分钟"
	}
	if m == 0 {
		return itoa(h) + " 个工作小时"
	}
	return itoa(h) + " 小时 " + itoa(m) + " 分（工作时段）"
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
