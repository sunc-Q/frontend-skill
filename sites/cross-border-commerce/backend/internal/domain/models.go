package domain

import "time"

// ---- 跨境商品 ----

// Product 是出海店铺的一条在售商品。价格一律以「美分」整型存储（申报价值=成交价口径），
// 目的国币种与税费在读取时按固定汇率与税则折算，避免浮点误差。
type Product struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	SKU        string    `gorm:"uniqueIndex;size:32" json:"sku"`
	Name       string    `gorm:"size:160" json:"name"`
	NameEn     string    `gorm:"size:160" json:"name_en"`
	Category   string    `gorm:"size:32;index" json:"category"`
	Brand      string    `gorm:"size:48" json:"brand"`
	PriceCents int64     `json:"price_cents"`
	Stock      int       `json:"stock"`
	WeightG    int       `json:"weight_g"`
	HSCode     string    `gorm:"size:16" json:"hs_code"`
	Origin     string    `gorm:"size:32" json:"origin"`
	LeadMin    int       `gorm:"column:lead_min_days" json:"lead_min_days"`
	LeadMax    int       `gorm:"column:lead_max_days" json:"lead_max_days"`
	Sold30     int       `gorm:"column:sold_30" json:"sold_30"`
	Listed     bool      `gorm:"index" json:"listed"`
	Bullets    string    `gorm:"size:600" json:"bullets"`
	CreatedAt  time.Time `json:"created_at"`
}

// Review 是目的国买家留评。Verified 表示系统按已购记录回写（seed 中直接给定）。
type Review struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	ProductID int64     `gorm:"index" json:"product_id"`
	Author    string    `gorm:"size:48" json:"author"`
	Country   string    `gorm:"size:8" json:"country"`
	Rating    int       `json:"rating"`
	Body      string    `gorm:"size:400" json:"body"`
	Verified  bool      `json:"verified"`
	PostedAt  time.Time `json:"posted_at"`
}

// CartItem 是服务端购物车（演示为单店铺购物车，一行一个 SKU）。
type CartItem struct {
	ID        int64     `gorm:"primaryKey" json:"id"`
	ProductID int64     `gorm:"uniqueIndex" json:"product_id"`
	Qty       int       `json:"qty"`
	AddedAt   time.Time `json:"added_at"`
}

// ---- 目的国税则与物流价卡（静态口径，后端唯一事实源） ----

type Region struct {
	Code         string  `json:"code"`
	Name         string  `json:"name"`
	Currency     string  `json:"currency"`
	FXPerUSD     float64 `json:"fx_per_usd"` // 1 USD 折本币数量
	DutyPct      int     `json:"duty_pct"`   // 关税：申报价值 × 税率
	ShipFirst    int64   `json:"ship_first_cents"`
	ShipStepG    int     `json:"ship_step_g"`
	ShipStep     int64   `json:"ship_step_cents"`
	FreeShipFrom int64   `json:"free_ship_from_cents"` // 商品总额达到即免运费
}

var Regions = []Region{
	{Code: "US", Name: "美国", Currency: "USD", FXPerUSD: 1, DutyPct: 8, ShipFirst: 599, ShipStepG: 500, ShipStep: 150, FreeShipFrom: 9900},
	{Code: "DE", Name: "德国（欧盟）", Currency: "EUR", FXPerUSD: 0.92, DutyPct: 6, ShipFirst: 699, ShipStepG: 500, ShipStep: 180, FreeShipFrom: 12900},
	{Code: "JP", Name: "日本", Currency: "JPY", FXPerUSD: 148, DutyPct: 10, ShipFirst: 499, ShipStepG: 500, ShipStep: 120, FreeShipFrom: 8800},
	{Code: "AU", Name: "澳大利亚", Currency: "AUD", FXPerUSD: 1.52, DutyPct: 5, ShipFirst: 749, ShipStepG: 500, ShipStep: 200, FreeShipFrom: 11900},
	{Code: "AE", Name: "阿联酋", Currency: "AED", FXPerUSD: 3.67, DutyPct: 5, ShipFirst: 649, ShipStepG: 500, ShipStep: 170, FreeShipFrom: 9900},
}

func RegionByCode(code string) *Region {
	for i := range Regions {
		if Regions[i].Code == code {
			return &Regions[i]
		}
	}
	return nil
}

// FreightCents 首重 + 续重按 500g 向上取整的价卡口径。
func (rg *Region) FreightCents(totalWeightG int) int64 {
	if totalWeightG <= 0 {
		return 0
	}
	if totalWeightG <= rg.ShipStepG {
		return rg.ShipFirst
	}
	units := (totalWeightG - rg.ShipStepG + rg.ShipStepG - 1) / rg.ShipStepG
	return rg.ShipFirst + int64(units)*rg.ShipStep
}

var Categories = []string{"消费电子", "家居生活", "户外运动", "服饰配件", "美妆个护"}

func ValidCategory(c string) bool {
	for _, v := range Categories {
		if v == c {
			return true
		}
	}
	return false
}

// ---- 读取视图 ----

type ProductRow struct {
	Product
	RatingAvg float64 `gorm:"rating_avg" json:"rating_avg"`
	ReviewCnt int64   `gorm:"review_cnt" json:"review_cnt"`
}

type ReviewSummary struct {
	Avg   float64 `json:"avg"`
	Count int64   `json:"count"`
	Dist  []int64 `json:"dist"`
}

type CartLine struct {
	SKU        string `json:"sku"`
	Name       string `json:"name"`
	Qty        int    `json:"qty"`
	PriceCents int64  `json:"price_cents"`
	WeightG    int    `json:"weight_g"`
	Stock      int    `json:"stock"`
	Listed     bool   `json:"listed"`
	LineCents  int64  `json:"line_cents"`
}

type RegionTotal struct {
	Region
	GoodsCents   int64 `json:"goods_cents"`
	FreightCents int64 `json:"freight_cents"`
	DutyCents    int64 `json:"duty_cents"`
	TotalCents   int64 `json:"total_cents"`
	FreeShip     bool  `json:"free_ship"`
}

type CartView struct {
	Lines        []CartLine    `json:"lines"`
	ItemQty      int           `json:"item_qty"`
	TotalWeightG int           `json:"total_weight_g"`
	Region       string        `json:"region"`
	Totals       []RegionTotal `json:"totals"`
	ServedAt     string        `json:"served_at"`
}

// ---- 写入 DTO ----

type AddToCartInput struct {
	SKU string `json:"sku"`
	Qty int    `json:"qty"`
}

type CreateProductInput struct {
	SKU        string `json:"sku"`
	Name       string `json:"name"`
	NameEn     string `json:"name_en"`
	Category   string `json:"category"`
	Brand      string `json:"brand"`
	PriceCents int64  `json:"price_cents"`
	Stock      int    `json:"stock"`
	WeightG    int    `json:"weight_g"`
	HSCode     string `json:"hs_code"`
	Origin     string `json:"origin"`
	LeadMin    int    `json:"lead_min_days"`
	LeadMax    int    `json:"lead_max_days"`
}

func (in AddToCartInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.SKU) < 3 || len(in.SKU) > 32 || !skuSafeChars(in.SKU) {
		errs["sku"] = "SKU 需为 3-32 个字母/数字/连字符/下划线"
	}
	if in.Qty < 0 || in.Qty > 999 {
		errs["qty"] = "数量越界（0-999，0 表示移出购物车）"
	}
	return errs, len(errs) == 0
}

func skuSafeChars(s string) bool {
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return len(s) > 0
}

func (in CreateProductInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.SKU) < 3 || len(in.SKU) > 32 {
		errs["sku"] = "SKU 需为 3-32 个字符"
	}
	if l := len([]rune(in.Name)); l < 2 || l > 160 {
		errs["name"] = "商品名称需为 2-160 个字符"
	}
	if in.PriceCents < 1 || in.PriceCents > 100_000_00 {
		errs["price_cents"] = "售价越界（1-1000000 美分）"
	}
	if in.Stock < 0 || in.Stock > 1_000_000 {
		errs["stock"] = "库存越界（0-1000000）"
	}
	if in.WeightG < 1 || in.WeightG > 50_000 {
		errs["weight_g"] = "单件重量越界（1-50000 克）"
	}
	if !ValidCategory(in.Category) {
		errs["category"] = "类目必须在此列表：" + joinCats()
	}
	if l := len(in.HSCode); l < 6 || l > 13 || !digitsAndDots(in.HSCode) {
		errs["hs_code"] = "HS 编码需为 6-13 位数字（可含点）"
	}
	if in.LeadMin < 1 || in.LeadMax > 60 || in.LeadMin > in.LeadMax {
		errs["lead_min_days"] = "发货时效需满足 1 ≤ 最小 ≤ 最大 ≤ 60 天"
	}
	if in.LeadMax < in.LeadMin || in.LeadMax > 60 {
		errs["lead_max_days"] = "发货时效需满足 1 ≤ 最小 ≤ 最大 ≤ 60 天"
	}
	return errs, len(errs) == 0
}

func joinCats() string {
	out := ""
	for i, c := range Categories {
		if i > 0 {
			out += "、"
		}
		out += c
	}
	return out
}

func digitsAndDots(s string) bool {
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r == '.') {
			return false
		}
	}
	return len(s) > 0
}
