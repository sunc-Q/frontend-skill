package domain

import "time"

// Money 一律以「美分」整型存储，避免浮点误差；展示层再格式化。
type Plan struct {
	ID           int64     `gorm:"primaryKey" json:"id"`
	Code         string    `gorm:"uniqueIndex;size:32" json:"code"`
	Name         string    `gorm:"size:64" json:"name"`
	PriceMonthly int64     `json:"price_monthly"`
	PriceYearly  int64     `json:"price_yearly"`
	SeatQuota    int       `json:"seat_quota"`
	Active       bool      `gorm:"index" json:"active"`
	CreatedAt    time.Time `json:"created_at"`
}

type Subscriber struct {
	ID       int64     `gorm:"primaryKey" json:"id"`
	Email    string    `gorm:"uniqueIndex;size:254" json:"email"`
	Company  string    `gorm:"size:128" json:"company"`
	PlanID   int64     `gorm:"index" json:"plan_id"`
	Source   string    `gorm:"size:32" json:"source"`
	JoinedAt time.Time `json:"joined_at"`
}

const (
	StatusTrialing = "trialing"
	StatusActive   = "active"
	StatusPastDue  = "past_due"
	StatusCanceled = "canceled"

	PeriodMonthly = "monthly"
	PeriodYearly  = "yearly"
)

type Subscription struct {
	ID            int64      `gorm:"primaryKey" json:"id"`
	SubscriberID  int64      `gorm:"index" json:"subscriber_id"`
	PlanID        int64      `gorm:"index" json:"plan_id"`
	Period        string     `gorm:"size:16;index" json:"period"`
	Status        string     `gorm:"size:16;index" json:"status"`
	Seats         int        `json:"seats"`
	MRR           int64      `json:"mrr"`
	StartAt       time.Time  `json:"start_at"`
	RenewAt       time.Time  `gorm:"index" json:"renew_at"`
	CanceledAt    *time.Time `json:"canceled_at,omitempty"`
	LastPaymentAt *time.Time `json:"last_payment_at,omitempty"`
}

type Payment struct {
	ID             int64     `gorm:"primaryKey" json:"id"`
	SubscriptionID int64     `gorm:"index" json:"subscription_id"`
	Amount         int64     `json:"amount"`
	Period         string    `gorm:"size:16" json:"period"`
	PaidAt         time.Time `json:"paid_at"`
}

// ---- 读取视图（列表接口用 JOIN 一次取回展示字段） ----

type SubscriptionRow struct {
	Subscription
	Email      string `json:"email"`
	Company    string `json:"company"`
	PlanCode   string `json:"plan_code"`
	PlanName   string `json:"plan_name"`
	Subscriber int64  `gorm:"-" json:"-"`
}

type MonthlyPoint struct {
	Month         string `json:"month"`
	NewSubs       int64  `json:"new_subs"`
	Cancellations int64  `json:"cancellations"`
	MRRAdded      int64  `json:"mrr_added"`
	MRRLost       int64  `json:"mrr_lost"`
}

type Metrics struct {
	TotalSubscribers  int64          `json:"total_subscribers"`
	ActiveSubs        int64          `json:"active_subs"`
	TrialingSubs      int64          `json:"trialing_subs"`
	PastDueSubs       int64          `json:"past_due_subs"`
	CanceledSubs      int64          `json:"canceled_subs"`
	MRR               int64          `json:"mrr"`
	ARR               int64          `json:"arr"`
	ARPU              int64          `json:"arpu"`
	ChurnRatePct      float64        `json:"churn_rate_pct"`
	TrialConversion   float64        `json:"trial_conversion_pct"`
	Monthly           []MonthlyPoint `json:"monthly"`
	ByPlan            []PlanRollup   `json:"by_plan"`
	GeneratedAt       time.Time      `json:"generated_at"`
	WindowDescription string         `json:"window"`
}

type PlanRollup struct {
	PlanID   int64  `json:"plan_id"`
	PlanCode string `json:"plan_code"`
	PlanName string `json:"plan_name"`
	Subs     int64  `json:"subs"`
	MRR      int64  `json:"mrr"`
}

// ---- 写入 DTO ----

type CreatePlanInput struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	PriceMonthly int64  `json:"price_monthly"`
	PriceYearly  int64  `json:"price_yearly"`
	SeatQuota    int    `json:"seat_quota"`
	Active       *bool  `json:"active"`
}

type RenewInput struct {
	Amount    int64  `json:"amount"`
	Period    string `json:"period"`
	NextRenew string `json:"next_renew"`
}

func (in CreatePlanInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Code) < 2 || len(in.Code) > 32 {
		errs["code"] = "套餐标识需为 2-32 个字符"
	}
	if len(in.Name) == 0 || len(in.Name) > 64 {
		errs["name"] = "套餐名称需为 1-64 个字符"
	}
	if in.PriceMonthly < 0 || in.PriceMonthly > 5_000_000 {
		errs["price_monthly"] = "月付价格越界（0-50000000 分）"
	}
	if in.PriceYearly < 0 || in.PriceYearly > 60_000_000 {
		errs["price_yearly"] = "年付价格越界（0-600000000 分）"
	}
	if in.SeatQuota < 0 || in.SeatQuota > 100_000 {
		errs["seat_quota"] = "席位上限越界（0-100000）"
	}
	return errs, len(errs) == 0
}

func (in RenewInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if in.Amount <= 0 || in.Amount > 60_000_000 {
		errs["amount"] = "续费金额越界（1-600000000 分）"
	}
	if in.Period != PeriodMonthly && in.Period != PeriodYearly {
		errs["period"] = "period 只能是 monthly 或 yearly"
	}
	if _, err := time.Parse("2006-01-02", in.NextRenew); err != nil {
		errs["next_renew"] = "next_renew 需为 YYYY-MM-DD"
	}
	return errs, len(errs) == 0
}

func ValidStatus(s string) bool {
	switch s {
	case StatusTrialing, StatusActive, StatusPastDue, StatusCanceled:
		return true
	}
	return false
}
