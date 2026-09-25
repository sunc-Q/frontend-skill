package domain

import (
	"strings"
	"time"
	"unicode"
)

// 场景：单座城市健身工作室（精品团课）的排课与预约看板。
// 价格一律以「分」整型存储，避免浮点误差；展示层再格式化。

const (
	CatStrength = "strength"
	CatCardio   = "cardio"
	CatYoga     = "yoga"
	CatCycling  = "cycling"
	CatBoxing   = "boxing"
	CatRecovery = "recovery"

	LevelJunior = "junior"
	LevelSenior = "senior"
	LevelMaster = "master"

	SessionOpen     = "open"
	SessionClosed   = "closed"
	SessionCanceled = "canceled"

	BookingConfirmed = "confirmed"
	BookingWaitlist  = "waitlist"
	BookingCanceled  = "canceled"
	BookingNoShow    = "no_show"

	CardTrial      = "trial"
	CardTenSession = "ten_session"
	CardMonthly    = "monthly"
	CardQuarterly  = "quarterly"
	CardAnnual     = "annual"
)

func ValidCategory(s string) bool {
	switch s {
	case CatStrength, CatCardio, CatYoga, CatCycling, CatBoxing, CatRecovery:
		return true
	}
	return false
}

func ValidLevel(s string) bool {
	return s == LevelJunior || s == LevelSenior || s == LevelMaster
}

func ValidSessionStatus(s string) bool {
	return s == SessionOpen || s == SessionClosed || s == SessionCanceled
}

// IsActiveBooking 计入占座：confirmed 与 waitlist 都算「这笔预约还活着」，
// 但只有 confirmed 占用硬容量，waitlist 是排队。
func IsActiveBooking(s string) bool {
	return s == BookingConfirmed || s == BookingWaitlist
}

func ValidCardType(s string) bool {
	switch s {
	case CardTrial, CardTenSession, CardMonthly, CardQuarterly, CardAnnual:
		return true
	}
	return false
}

type Class struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	Code        string    `gorm:"uniqueIndex;size:32" json:"code"`
	Name        string    `gorm:"size:64" json:"name"`
	Category    string    `gorm:"size:16;index" json:"category"`
	Coach       string    `gorm:"size:32" json:"coach"`
	CoachLevel  string    `gorm:"size:16;index" json:"coach_level"`
	DurationMin int       `json:"duration_min"`
	Intensity   int       `json:"intensity"`
	Capacity    int       `json:"capacity"`
	PriceCents  int64     `json:"price_cents"`
	Active      bool      `gorm:"index" json:"active"`
	CreatedAt   time.Time `json:"created_at"`
}

type Session struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	ClassID   int64     `gorm:"index" json:"class_id"`
	StartAt   time.Time `gorm:"index" json:"start_at"`
	Room      string    `gorm:"size:16" json:"room"`
	Status    string    `gorm:"size:16;index" json:"status"`
	Note      string    `gorm:"size:120" json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

type Member struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:32" json:"name"`
	Phone     string    `gorm:"uniqueIndex;size:20" json:"phone"`
	CardType  string    `gorm:"size:16;index" json:"card_type"`
	Credits   int       `json:"credits"`
	Visits    int       `json:"visits"`
	JoinedAt  time.Time `json:"joined_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Active    bool      `gorm:"index" json:"active"`
}

type Booking struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	SessionID int64     `gorm:"index" json:"session_id"`
	MemberID  int64     `gorm:"index" json:"member_id"`
	Status    string    `gorm:"size:16;index" json:"status"`
	Source    string    `gorm:"size:16" json:"source"`
	CreatedAt time.Time `json:"created_at"`
}

// ---- 读取视图 ----

// SessionRow 是课表接口的一行：课节 + 课程信息 + 实时占座计数。
type SessionRow struct {
	Session
	ClassCode   string `json:"class_code"`
	ClassName   string `json:"class_name"`
	Category    string `json:"category"`
	Coach       string `json:"coach"`
	CoachLevel  string `json:"coach_level"`
	DurationMin int    `json:"duration_min"`
	Intensity   int    `json:"intensity"`
	PriceCents  int64  `json:"price_cents"`
	Capacity    int    `json:"capacity"`
	Confirmed   int    `json:"confirmed"`
	Waitlist    int    `json:"waitlist"`
	Remaining   int    `json:"remaining"`
}

// OccupancyPct 满座率：confirmed / capacity，课程取消或空课时为 0。
func (r SessionRow) OccupancyPct() float64 {
	if r.Capacity <= 0 {
		return 0
	}
	p := float64(r.Confirmed) * 100 / float64(r.Capacity)
	if p > 100 {
		return 100
	}
	return p
}

type RosterEntry struct {
	BookingID int64     `json:"booking_id"`
	MemberID  int64     `json:"member_id"`
	Name      string    `json:"name"`
	Phone     string    `json:"phone"`
	CardType  string    `json:"card_type"`
	Credits   int       `json:"credits"`
	Status    string    `json:"status"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"created_at"`
}

type SessionDetail struct {
	Session SessionRow    `json:"session"`
	Roster  []RosterEntry `json:"roster"`
}

type DayRollup struct {
	Day       string `json:"day"`
	Sessions  int64  `json:"sessions"`
	Confirmed int64  `json:"confirmed"`
	Canceled  int64  `json:"canceled"`
	Seats     int64  `json:"seats"`
	Revenue   int64  `json:"revenue_cents"`
}

type CategoryRollup struct {
	Category  string  `json:"category"`
	Sessions  int64   `json:"sessions"`
	Confirmed int64   `json:"confirmed"`
	Seats     int64   `json:"seats"`
	Occupancy float64 `json:"occupancy_pct"`
}

type CoachRollup struct {
	Coach     string  `json:"coach"`
	Level     string  `json:"coach_level"`
	Sessions  int64   `json:"sessions"`
	Confirmed int64   `json:"confirmed"`
	Seats     int64   `json:"seats"`
	Occupancy float64 `json:"occupancy_pct"`
}

type Stats struct {
	Window        string           `json:"window"`
	GeneratedAt   time.Time        `json:"generated_at"`
	TotalSessions int64            `json:"total_sessions"`
	OpenSessions  int64            `json:"open_sessions"`
	SeatTotal     int64            `json:"seat_total"`
	TotalBookings int64            `json:"total_bookings"`
	Confirmed     int64            `json:"confirmed_bookings"`
	Waitlist      int64            `json:"waitlist_bookings"`
	Canceled      int64            `json:"canceled_bookings"`
	NoShow        int64            `json:"no_show_bookings"`
	Members       int64            `json:"members"`
	ActiveMembers int64            `json:"active_members"`
	OccupancyPct  float64          `json:"occupancy_pct"`
	NoShowRatePct float64          `json:"no_show_rate_pct"`
	RevenueCents  int64            `json:"revenue_cents"`
	AvgPerSession float64          `json:"avg_confirmed_per_session"`
	Days          []DayRollup      `json:"days"`
	ByCategory    []CategoryRollup `json:"by_category"`
	ByCoach       []CoachRollup    `json:"by_coach"`
	ByCard        []CardRollup     `json:"by_card"`
}

type CardRollup struct {
	CardType string `json:"card_type"`
	Members  int64  `json:"members"`
	Credits  int64  `json:"credits"`
}

// ---- 写入 DTO ----

type CreateBookingInput struct {
	MemberID      int64  `json:"member_id"`
	Phone         string `json:"phone"`
	Source        string `json:"source"`
	AllowWaitlist *bool  `json:"allow_waitlist"`
}

type CreateMemberInput struct {
	Name      string `json:"name"`
	Phone     string `json:"phone"`
	CardType  string `json:"card_type"`
	Credits   int    `json:"credits"`
	DaysValid int    `json:"days_valid"`
}

var bookingSources = map[string]bool{
	"app": true, "front_desk": true, "coach": true, "phone": true,
}

func (in CreateBookingInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if in.MemberID <= 0 && in.Phone == "" {
		errs["member_id"] = "必须给出 member_id 或已注册手机号"
	}
	if in.MemberID < 0 {
		errs["member_id"] = "member_id 不能为负"
	}
	if len(in.Phone) > 20 {
		errs["phone"] = "手机号最长 20 个字符"
	}
	if in.Source != "" && !bookingSources[in.Source] {
		errs["source"] = "source 只能是 app/front_desk/coach/phone"
	}
	return errs, len(errs) == 0
}

func (in CreateMemberInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := len([]rune(in.Name)); n < 1 || n > 16 {
		errs["name"] = "会员姓名需为 1-16 个字符"
	}
	if !phonePatternOK(in.Phone) {
		errs["phone"] = "手机号需为 7-20 位数字（可含 + 与连字符）"
	}
	if !ValidCardType(in.CardType) {
		errs["card_type"] = "卡种不合法"
	}
	if in.Credits < 0 || in.Credits > 500 {
		errs["credits"] = "次卡剩余次数越界（0-500）"
	}
	if in.DaysValid < 0 || in.DaysValid > 1_095 {
		errs["days_valid"] = "有效期越界（0-1095 天）"
	}
	return errs, len(errs) == 0
}

func ValidBookingSource(s string) bool { return bookingSources[s] }

// phonePatternOK 只接受 7-20 个字符、主体为数字（允许前导 + 与内部连字符/空格）。
// 目的是把「注入串、换行、超长垃圾」挡在写接口之外，不是校验真实号码格式。
func phonePatternOK(s string) bool {
	t := strings.ReplaceAll(strings.ReplaceAll(s, "-", ""), " ", "")
	if len(t) < 7 || len(t) > 20 {
		return false
	}
	digits := 0
	for i, r := range t {
		switch {
		case unicode.IsDigit(r):
			digits++
		case r == '+' && i == 0:
		default:
			return false
		}
	}
	return digits >= 7
}
