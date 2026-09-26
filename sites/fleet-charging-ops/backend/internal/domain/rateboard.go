package domain

import "fmt"

// BuildRateBoard 把启用规则展开成「工作日 / 周末」两块全天窗口表：
// 逐分钟取仲裁胜者，相邻同规则合并——与 ComputeBill 用同一套仲裁口径，
// 保证价目表回显与真实结算永远不会出现两套窗口。
func BuildRateBoard(rules []TariffRule) []RateWindow {
	sorted := SortRulesActive(rules)
	out := []RateWindow{}
	for _, weekend := range []bool{false, true} {
		var cur *TariffRule
		var startMin int
		for m := 0; m <= 1440; m++ {
			var winner *TariffRule
			if m < 1440 {
				winner = matchMinute(m, weekend, sorted)
			}
			if winner != cur {
				if cur != nil {
					out = append(out, windowOf(*cur, startMin, m))
				}
				cur, startMin = winner, m
			}
		}
	}
	return out
}

func matchMinute(minute int, weekend bool, rules []TariffRule) *TariffRule {
	for i := range rules {
		r := &rules[i]
		if r.CoversDay(weekend) && r.CoversLocalMinute(minute) {
			return r
		}
	}
	return nil
}

func windowOf(r TariffRule, from, to int) RateWindow {
	return RateWindow{
		Period: r.Period, DayType: r.DayType,
		Window:       fmt.Sprintf("%02d:%02d-%02d:%02d", from/60, from%60, to/60, to%60),
		ElecCents:    r.ElecCents,
		ServiceCents: r.ServiceCents,
		RuleCode:     r.Code,
	}
}
