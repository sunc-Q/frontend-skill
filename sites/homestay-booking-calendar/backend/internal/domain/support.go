package domain

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// HoldStatuses / RevenueStatuses 是两套互不覆盖的口径：
// 前者决定"房还在不在"，后者决定"钱算不算"。no_show 算钱但不占房。
var (
	HoldStatuses    = []string{StPending, StConfirmed, StCheckedIn}
	RevenueStatuses = []string{StConfirmed, StCheckedIn, StCheckedOut, StNoShow}
)

// MaxCodeRetry 是订单号发号在同一条事务内的重试上限（唯一冲突时用）。
const MaxCodeRetry = 5

func SafeDiv(a, b int64) int64 {
	if b <= 0 {
		return 0
	}
	return a / b
}

// Bps 把 part/whole 变成万分比，全零时分母返回 0 而不是 panic。
func Bps(part, whole int) int {
	if whole <= 0 {
		return 0
	}
	return int(int64(part) * 10000 / int64(whole))
}

// Yuan 是唯一的金额出口格式化：入参一律是"分"整型，杜绝浮点误差。
func Yuan(cents int64) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s¥%d.%02d", sign, cents/100, cents%100)
}

func Pct(bps int) string {
	return fmt.Sprintf("%.1f%%", float64(bps)/100)
}

func Trim(s string) string { return strings.TrimSpace(s) }

// RuneCount 供测试断言截断口径：长度限制按字符数而不是字节数，中文搜索串才不会越界。
func RuneCount(s string) int { return utf8.RuneCountInString(s) }
