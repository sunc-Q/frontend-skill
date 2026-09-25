package domain

import "time"

// 馆别口径：loan_days 为默认借期（自然日），fine_per_day 为逾期费（分/天），
// fine_cap 为单册逾期费封顶（分）。reference（参考工具书）仅限阅览、不外借。
const (
	CatGeneral   = "general"
	CatLarge     = "large_print"
	CatBoxed     = "boxed_set"
	CatReference = "reference"
)

type CatRule struct {
	LoanDays   int
	FinePerDay int64
	FineCap    int64
	RenewDays  int
}

var CatRules = map[string]CatRule{
	CatGeneral:   {LoanDays: 28, FinePerDay: 50, FineCap: 2000, RenewDays: 14},
	CatLarge:     {LoanDays: 42, FinePerDay: 30, FineCap: 1200, RenewDays: 21},
	CatBoxed:     {LoanDays: 14, FinePerDay: 100, FineCap: 4000, RenewDays: 7},
	CatReference: {LoanDays: 0, FinePerDay: 0, FineCap: 0, RenewDays: 0},
}

const (
	MemberStandard = "standard"
	MemberFamily   = "family"
	MemberStudent  = "student"

	MemberActive    = "active"
	MemberSuspended = "suspended"

	CopyAvailable = "available"
	CopyOnLoan    = "on_loan"
	CopyMissing   = "missing"
	CopyRetired   = "retired"

	LoanActive   = "active"
	LoanReturned = "returned"

	// FineGateCents：未缴逾期费超过该额度即停借（分）。
	FineGateCents = int64(3000)
	// MaxRenewals：同一册最多续借次数。
	MaxRenewals = 2
)

func MemberQuota(t string) int {
	switch t {
	case MemberFamily:
		return 12
	case MemberStudent:
		return 5
	default:
		return 8
	}
}

func ValidCategory(c string) bool {
	_, ok := CatRules[c]
	return ok
}

func ValidMemberType(t string) bool {
	switch t {
	case MemberStandard, MemberFamily, MemberStudent:
		return true
	}
	return false
}

func ValidMemberStatus(s string) bool {
	return s == MemberActive || s == MemberSuspended
}

// OverdueDays 计算从 due 到 ref 的整日逾期数（不足一天不计），ref 早于 due 记 0。
func OverdueDays(due, ref time.Time) int64 {
	d := due.UTC().Truncate(24 * time.Hour)
	r := ref.UTC().Truncate(24 * time.Hour)
	diff := r.Sub(d)
	if diff <= 0 {
		return 0
	}
	return int64(diff / (24 * time.Hour))
}

// FineFor 是逾期费的唯一算法：fine = min(逾期天数 × 每天费率, 单册封顶)。
// 归还结算、列表预估、stats 恒等式校验必须全部走这里。
func FineFor(overdueDays int64, category string) int64 {
	rule, ok := CatRules[category]
	if !ok || overdueDays <= 0 {
		return 0
	}
	f := overdueDays * rule.FinePerDay
	if f > rule.FineCap {
		f = rule.FineCap
	}
	return f
}

// ---- 实体 ----

type Item struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	Code      string    `gorm:"uniqueIndex;size:20" json:"code"`
	Title     string    `gorm:"size:128" json:"title"`
	Author    string    `gorm:"size:64" json:"author"`
	Publisher string    `gorm:"size:64" json:"publisher"`
	PubYear   int       `json:"pub_year"`
	Category  string    `gorm:"size:16;index" json:"category"`
	LoanDays  int       `json:"loan_days"`
	AddedAt   time.Time `json:"added_at"`
}

type Copy struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	ItemID     int64     `gorm:"index" json:"item_id"`
	Barcode    string    `gorm:"uniqueIndex;size:20" json:"barcode"`
	Location   string    `gorm:"size:20" json:"location"`
	Condition  string    `gorm:"size:16" json:"condition"`
	Status     string    `gorm:"size:16;index" json:"status"`
	AcquiredAt time.Time `json:"acquired_at"`
}

type Member struct {
	ID          int64      `gorm:"primaryKey" json:"id"`
	CardNo      string     `gorm:"uniqueIndex;size:16" json:"card_no"`
	Name        string     `gorm:"size:64" json:"name"`
	Phone       string     `gorm:"size:20" json:"-"`
	MemberType  string     `gorm:"size:16" json:"member_type"`
	Status      string     `gorm:"size:16;index" json:"status"`
	JoinedAt    time.Time  `json:"joined_at"`
	SuspendedAt *time.Time `json:"suspended_at,omitempty"`
}

type Loan struct {
	ID         int64      `gorm:"primaryKey" json:"id"`
	CopyID     int64      `gorm:"index" json:"copy_id"`
	MemberID   int64      `gorm:"index" json:"member_id"`
	Status     string     `gorm:"size:16;index" json:"status"`
	BorrowedAt time.Time  `json:"borrowed_at"`
	DueAt      time.Time  `gorm:"index" json:"due_at"`
	ReturnedAt *time.Time `json:"returned_at,omitempty"`
	RenewCount int        `json:"renew_count"`
	FineCents  int64      `json:"fine_cents"`
	FinePaid   bool       `json:"fine_paid"`
}

// ---- 读取视图 ----

type ItemRow struct {
	Item
	TotalCopies     int64 `gorm:"column:total_copies" json:"total_copies"`
	AvailableCopies int64 `gorm:"column:available_copies" json:"available_copies"`
	OnLoanCopies    int64 `gorm:"column:on_loan_copies" json:"on_loan_copies"`
}

type CopyRow struct {
	Copy
	ItemCode     string     `gorm:"column:item_code" json:"item_code"`
	ItemTitle    string     `gorm:"column:item_title" json:"item_title"`
	BorrowerCard string     `gorm:"column:borrower_card" json:"borrower_card,omitempty"`
	BorrowerName string     `gorm:"column:borrower_name" json:"borrower_name,omitempty"`
	DueAt        *time.Time `gorm:"column:due_at" json:"due_at,omitempty"`
}

type LoanRow struct {
	Loan
	MemberCard   string `gorm:"column:member_card" json:"member_card"`
	MemberName   string `gorm:"column:member_name" json:"member_name"`
	MemberType   string `gorm:"column:member_type" json:"member_type"`
	MemberStatus string `gorm:"column:member_status" json:"member_status"`
	PhoneMasked  string `gorm:"column:phone_masked" json:"phone_masked"`
	ItemCode     string `gorm:"column:item_code" json:"item_code"`
	ItemTitle    string `gorm:"column:item_title" json:"item_title"`
	ItemCategory string `gorm:"column:item_category" json:"item_category"`
	CopyBarcode  string `gorm:"column:copy_barcode" json:"copy_barcode"`
	CopyLocation string `gorm:"column:copy_location" json:"copy_location"`
	OverdueDays  int64  `gorm:"-" json:"overdue_days"`
	FineDue      int64  `gorm:"-" json:"fine_due"`
}

type MemberDetail struct {
	Member
	PhoneMasked     string `gorm:"-" json:"phone_masked"`
	Quota           int    `gorm:"-" json:"quota"`
	ActiveLoans     int64  `gorm:"-" json:"active_loans"`
	OverdueLoans    int64  `gorm:"-" json:"overdue_loans"`
	OutstandingFine int64  `gorm:"-" json:"outstanding_fine"`
}

type TrendPoint struct {
	Day    string `json:"day"`
	Borrow int64  `json:"borrow"`
	Return int64  `json:"returned"`
}

type CategoryRollup struct {
	Category    string `gorm:"column:category" json:"category"`
	Items       int64  `gorm:"column:items" json:"items"`
	Copies      int64  `gorm:"column:copies" json:"copies"`
	ActiveLoans int64  `gorm:"column:active_loans" json:"active_loans"`
}

type Stats struct {
	GeneratedAt      time.Time        `json:"generated_at"`
	Today            string           `json:"today"`
	TotalItems       int64            `json:"total_items"`
	TotalCopies      int64            `json:"total_copies"`
	AvailableCopies  int64            `json:"available_copies"`
	OnLoanCopies     int64            `json:"on_loan_copies"`
	ActiveLoans      int64            `json:"active_loans"`
	OverdueLoans     int64            `json:"overdue_loans"`
	ReturnedLoans    int64            `json:"returned_loans"`
	TotalMembers     int64            `json:"total_members"`
	ActiveMembers    int64            `json:"active_members"`
	SuspendedMembers int64            `json:"suspended_members"`
	OutstandingFine  int64            `json:"outstanding_fine"`
	CollectedFine    int64            `json:"collected_fine"`
	BorrowToday      int64            `json:"borrow_today"`
	ReturnToday      int64            `json:"return_today"`
	IdentityOK       bool             `json:"identity_ok"`
	IdentityIssues   []string         `json:"identity_issues"`
	Trend            []TrendPoint     `json:"trend"`
	ByCategory       []CategoryRollup `json:"by_category"`
	Window           string           `json:"window"`
}

// ---- 写入 DTO ----

type BorrowInput struct {
	Barcode string `json:"barcode"`
	CardNo  string `json:"card_no"`
}

type ReturnInput struct {
	Paid *bool `json:"paid"`
}

func (in BorrowInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Barcode) < 6 || len(in.Barcode) > 20 {
		errs["barcode"] = "条码长度需为 6-20 位"
	} else if !barcodeSafe(in.Barcode) {
		errs["barcode"] = "条码只允许字母、数字与连字符"
	}
	if len(in.CardNo) < 4 || len(in.CardNo) > 16 {
		errs["card_no"] = "借书证号长度需为 4-16 位"
	} else if !barcodeSafe(in.CardNo) {
		errs["card_no"] = "借书证号只允许字母、数字与连字符"
	}
	return errs, len(errs) == 0
}

func (in ReturnInput) PaidOrDefault() bool {
	if in.Paid == nil {
		return false
	}
	return *in.Paid
}

func barcodeSafe(s string) bool {
	for _, r := range s {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-'
		if !ok {
			return false
		}
	}
	return len(s) > 0
}
