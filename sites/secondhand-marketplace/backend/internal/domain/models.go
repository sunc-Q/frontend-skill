package domain

import "time"

// 金额一律以「分」整型存储，避免浮点误差；展示层再格式化。
// 时间戳统一 UTC（SQLite 的 datetime 是文本，混时区会让 ORDER BY 退化成字符串排序）。

const (
	ListingAvailable = "available"
	ListingReserved  = "reserved"
	ListingSold      = "sold"
	ListingWithdrawn = "withdrawn"

	OfferPending  = "pending"
	OfferAccepted = "accepted"
	OfferRejected = "rejected"
	OfferOutbid   = "outbid"
	OfferExpired  = "expired"

	ConditionLikeNew = "like_new"
	ConditionGood    = "good"
	ConditionFair    = "fair"
	ConditionParts   = "parts"
)

type Category struct {
	ID     int64  `gorm:"primaryKey" json:"id"`
	Code   string `gorm:"uniqueIndex;size:32" json:"code"`
	NameZh string `gorm:"size:64" json:"name_zh"`
	Unit   string `gorm:"size:16" json:"unit"`
	// 行情参考价：该品类近 30 天成交的中位价（分），用于算「挂牌溢价指数」。
	RefCent  int64  `json:"ref_cent"`
	ItemKind string `gorm:"size:32" json:"item_kind"`
}

type Listing struct {
	ID         int64  `gorm:"primaryKey" json:"id"`
	Code       string `gorm:"uniqueIndex;size:24" json:"code"`
	Title      string `gorm:"size:120" json:"title"`
	CategoryID int64  `gorm:"index" json:"category_id"`
	Seller     string `gorm:"size:48" json:"seller"`
	AskingCent int64  `json:"asking_cent"`
	FloorCent  int64  `json:"floor_cent"`
	RefCent    int64  `json:"ref_cent"`
	Condition  string `gorm:"size:16;index" json:"condition"`
	Area       string `gorm:"size:32" json:"area"`
	Status     string `gorm:"size:16;index" json:"status"`
	Views      int    `json:"views"`
	// 当前在拍最高有效出价（分，不含成交）。落库是为了让排序走真实列而不是相关子查询。
	BestOfferCent int64      `gorm:"column:best_offer_cent;index" json:"best_offer_cent"`
	PostedAt      time.Time  `gorm:"index" json:"posted_at"`
	SoldAt        *time.Time `json:"sold_at,omitempty"`
}

type Offer struct {
	ID         int64      `gorm:"primaryKey" json:"id"`
	ListingID  int64      `gorm:"index" json:"listing_id"`
	DealNo     string     `gorm:"uniqueIndex;size:24" json:"deal_no"`
	Buyer      string     `gorm:"size:48" json:"buyer"`
	AmountCent int64      `json:"amount_cent"`
	Message    string     `gorm:"size:200" json:"message"`
	Status     string     `gorm:"size:16;index" json:"status"`
	PlacedAt   time.Time  `gorm:"index" json:"placed_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	DecidedAt  *time.Time `json:"decided_at,omitempty"`
}

// ---- 读取视图（列表接口用一次 JOIN/子查询取回展示字段） ----

type ListingRow struct {
	Listing
	CategoryCode  string `json:"category_code"`
	CategoryName  string `json:"category_name"`
	OfferCount    int64  `json:"offer_count"`
	PendingCount  int64  `json:"pending_count"`
	AskingRefPct  int    `json:"asking_ref_pct"`
	BestOverFloor bool   `json:"best_over_floor"`
}

type OfferView struct {
	Offer
	ListingCode   string `json:"listing_code"`
	Title         string `json:"title"`
	CategoryName  string `json:"category_name"`
	AskingCent    int64  `json:"asking_cent"`
	FloorCent     int64  `json:"floor_cent"`
	ListingStatus string `json:"listing_status"`
	IsBest        bool   `json:"is_best"`
	OverFloor     bool   `json:"over_floor"`
	// 同一挂单内按金额从高到低的顺位（1 起）。
	Rank int `gorm:"-" json:"rank"`
}

type DailyPoint struct {
	Day     string `json:"day"`
	Posted  int64  `json:"posted"`
	Offers  int64  `json:"offers"`
	Deals   int64  `json:"deals"`
	GmvCent int64  `json:"gmv_cent"`
}

type CategoryRollup struct {
	CategoryID   int64  `json:"category_id"`
	CategoryCode string `json:"category_code"`
	CategoryName string `json:"category_name"`
	RefCent      int64  `json:"ref_cent"`
	Listings     int64  `json:"listings"`
	Sold         int64  `json:"sold"`
	GmvCent      int64  `json:"gmv_cent"`
	AvgDealCent  int64  `json:"avg_deal_cent"`
	BestOffer    int64  `json:"best_offer_cent"`
}

type Metrics struct {
	Today           string           `json:"today"`
	ListingsTotal   int64            `json:"listings_total"`
	ListingActive   int64            `json:"listings_active"`
	Available       int64            `json:"available"`
	Reserved        int64            `json:"reserved"`
	Sold            int64            `json:"sold"`
	Withdrawn       int64            `json:"withdrawn"`
	OffersTotal     int64            `json:"offers_total"`
	OffersPending   int64            `json:"offers_pending"`
	Deals           int64            `json:"deals"`
	GmvCent         int64            `json:"gmv_cent"`
	AvgDealCent     int64            `json:"avg_deal_cent"`
	Gmv7Cent        int64            `json:"gmv_7d_cent"`
	Deals7          int64            `json:"deals_7d"`
	BestBidYieldPct int              `json:"best_bid_yield_pct"`
	ExpiredPending  int64            `json:"expired_pending_offers"`
	IdentityOK      bool             `json:"identity_ok"`
	IdentityNote    string           `json:"identity_note,omitempty"`
	Daily           []DailyPoint     `json:"daily"`
	ByCategory      []CategoryRollup `json:"by_category"`
	GeneratedAt     time.Time        `json:"generated_at"`
	Window          string           `json:"window"`
}

// ---- 写入 DTO ----

type CreateListingInput struct {
	Code       string `json:"code"`
	Title      string `json:"title"`
	Category   string `json:"category"`
	Seller     string `json:"seller"`
	AskingCent int64  `json:"asking_cent"`
	FloorCent  int64  `json:"floor_cent"`
	Condition  string `json:"condition"`
	Area       string `json:"area"`
}

type PlaceOfferInput struct {
	Buyer      string `json:"buyer"`
	AmountCent int64  `json:"amount_cent"`
	Message    string `json:"message"`
}

func ValidListingStatus(s string) bool {
	switch s {
	case ListingAvailable, ListingReserved, ListingSold, ListingWithdrawn:
		return true
	}
	return false
}

func ValidOfferStatus(s string) bool {
	switch s {
	case OfferPending, OfferAccepted, OfferRejected, OfferOutbid, OfferExpired:
		return true
	}
	return false
}

func ValidCondition(s string) bool {
	switch s {
	case ConditionLikeNew, ConditionGood, ConditionFair, ConditionParts:
		return true
	}
	return false
}

// codeAllowed：编号/账号类字段只接受 ASCII 字母数字与 -_，
// 长度合规但含 `"` `\` `;` 的串必须同样被拒（第 3 轮踩过的坑）。
func CodeAllowed(s string) bool {
	for _, r := range s {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-'
		if !ok {
			return false
		}
	}
	return true
}

func (in CreateListingInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Code) < 4 || len(in.Code) > 24 {
		errs["code"] = "挂单编号需为 4-24 个字符"
	} else if !CodeAllowed(in.Code) {
		errs["code"] = "挂单编号只允许字母、数字、下划线与连字符"
	}
	if n := len([]rune(in.Title)); n < 4 || n > 120 {
		errs["title"] = "标题需为 4-120 个字符"
	}
	if n := len([]rune(in.Seller)); n < 1 || n > 48 {
		errs["seller"] = "卖家昵称需为 1-48 个字符"
	}
	if in.AskingCent < 100 || in.AskingCent > 50_000_000 {
		errs["asking_cent"] = "挂牌价越界（100-50000000 分）"
	}
	if in.FloorCent < 0 || in.FloorCent > 50_000_000 {
		errs["floor_cent"] = "保底价越界（0-50000000 分）"
	} else if in.FloorCent > in.AskingCent {
		errs["floor_cent"] = "保底价不得高于挂牌价"
	}
	if !ValidCondition(in.Condition) {
		errs["condition"] = "成色只能是 like_new/good/fair/parts"
	}
	if n := len([]rune(in.Area)); n < 1 || n > 32 {
		errs["area"] = "自提区域需为 1-32 个字符"
	}
	if n := len([]rune(in.Category)); n < 1 || n > 32 {
		errs["category"] = "品类标识非法"
	}
	return errs, len(errs) == 0
}

func (in PlaceOfferInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := len([]rune(in.Buyer)); n < 2 || n > 48 {
		errs["buyer"] = "买家昵称需为 2-48 个字符"
	} else if !CodeAllowed(in.Buyer) {
		errs["buyer"] = "买家昵称只允许字母、数字、下划线与连字符"
	}
	if in.AmountCent < 100 || in.AmountCent > 50_000_000 {
		errs["amount_cent"] = "出价越界（100-50000000 分）"
	}
	if n := len([]rune(in.Message)); n > 200 {
		errs["message"] = "留言不超过 200 个字符"
	}
	return errs, len(errs) == 0
}
