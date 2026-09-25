package domain

import "time"

// 价格一律以「分」整型存储；配送费、起送价、金额恒等式全部在后端判定，
// 接口层保证 total_cents = subtotal_cents + delivery_fee_cents 恒成立。

type Dish struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	Code       string    `gorm:"uniqueIndex;size:32" json:"code"`
	Name       string    `gorm:"size:64" json:"name"`
	Category   string    `gorm:"size:16;index" json:"category"`
	PriceCents int64     `json:"price_cents"`
	PrepMin    int       `gorm:"column:prep_min" json:"prep_min"`
	Spice      int       `gorm:"column:spice" json:"spice"`
	Available  bool      `gorm:"index" json:"available"`
	Taste      string    `gorm:"size:128" json:"taste"`
	CreatedAt  time.Time `json:"created_at"`
}

type Zone struct {
	ID            int64  `gorm:"primaryKey" json:"id"`
	Code          string `gorm:"uniqueIndex;size:16" json:"code"`
	Name          string `gorm:"size:32" json:"name"`
	DistanceKm    string `gorm:"column:distance_km;size:16" json:"distance_km"`
	MinOrderCents int64  `json:"min_order_cents"`
	FeeCents      int64  `gorm:"column:fee_cents" json:"fee_cents"`
	EtaMin        int    `gorm:"column:eta_min" json:"eta_min"`
	Active        bool   `gorm:"index" json:"active"`
}

const (
	OrderPlaced     = "placed"
	OrderCooking    = "cooking"
	OrderReady      = "ready"
	OrderDelivering = "delivering"
	OrderDelivered  = "delivered"
	OrderCancelled  = "cancelled"
)

type Order struct {
	ID               int64     `gorm:"primaryKey" json:"id"`
	OrderNo          string    `gorm:"uniqueIndex;size:32" json:"order_no"`
	Recipient        string    `gorm:"size:32" json:"recipient"`
	Phone            string    `gorm:"size:16" json:"-"`
	MaskedPhone      string    `gorm:"-" json:"masked_phone"`
	ZoneCode         string    `gorm:"index;size:16" json:"zone_code"`
	Address          string    `gorm:"size:128" json:"address"`
	Note             string    `gorm:"size:200" json:"note"`
	Status           string    `gorm:"size:16;index" json:"status"`
	ItemCount        int       `json:"item_count"`
	SubtotalCents    int64     `json:"subtotal_cents"`
	DeliveryFeeCents int64     `json:"delivery_fee_cents"`
	TotalCents       int64     `json:"total_cents"`
	PrepMinutes      int       `gorm:"column:prep_minutes" json:"prep_minutes"`
	EtaMinutes       int       `gorm:"-" json:"eta_minutes"`
	PlacedAt         time.Time `gorm:"index" json:"placed_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type OrderItem struct {
	ID             int64  `gorm:"primaryKey" json:"id"`
	OrderID        int64  `gorm:"index" json:"order_id"`
	DishCode       string `gorm:"index;size:32" json:"dish_code"`
	DishName       string `gorm:"size:64" json:"dish_name"`
	UnitPriceCents int64  `json:"unit_price_cents"`
	Qty            int    `json:"qty"`
	LineCents      int64  `json:"line_cents"`
}

// ---- 读取视图 ----

type OrderRow struct {
	Order
	ZoneName   string `json:"zone_name"`
	ZoneEtaMin int    `json:"-"`
}

// MenuRow：sold_total 只用于聚合回填，必须带显式 column 映射（GORM 扫描不吃 gorm:"-"）。
type MenuRow struct {
	Dish
	SoldTotal int64 `gorm:"column:sold_total" json:"sold_total"`
}

type CategoryRollup struct {
	Category string `json:"category"`
	Orders   int64  `json:"orders"`
	Revenue  int64  `json:"revenue"`
}

type DishRollup struct {
	DishCode string `json:"dish_code"`
	DishName string `json:"dish_name"`
	Category string `json:"category"`
	Qty      int64  `json:"qty"`
	Revenue  int64  `json:"revenue"`
}

type Stats struct {
	OrdersTotal     int64            `json:"orders_total"`
	TodayOrders     int64            `json:"today_orders"`
	GMVCents        int64            `json:"gmv_cents"`
	TodayGMVCents   int64            `json:"today_gmv_cents"`
	AvgOrderCents   int64            `json:"avg_order_cents"`
	AvgPrepMin      float64          `json:"avg_prep_min"`
	CancelRatePct   float64          `json:"cancel_rate_pct"`
	ByStatus        map[string]int64 `json:"by_status"`
	TopDishes       []DishRollup     `json:"top_dishes"`
	ByCategory      []CategoryRollup `json:"by_category"`
	DishesTotal     int64            `json:"dishes_total"`
	DishesAvailable int64            `json:"dishes_available"`
	GeneratedAt     time.Time        `json:"generated_at"`
	Window          string           `json:"window"`
}

// ---- 写入 DTO ----

type OrderItemInput struct {
	Code string `json:"code"`
	Qty  int    `json:"qty"`
}

type PlaceOrderInput struct {
	Recipient string           `json:"recipient"`
	Phone     string           `json:"phone"`
	ZoneCode  string           `json:"zone"`
	Address   string           `json:"address"`
	Note      string           `json:"note"`
	Items     []OrderItemInput `json:"items"`
}

type AdvanceStatusInput struct {
	To string `json:"to"`
}

type AvailabilityInput struct {
	Available *bool `json:"available"`
}

func (in PlaceOrderInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if n := runeLen(in.Recipient); n < 1 || n > 32 {
		errs["recipient"] = "收餐人姓名需为 1-32 个字符"
	}
	if !ValidPhone(in.Phone) {
		errs["phone"] = "手机号需为 1 开头的 11 位数字"
	}
	if !ValidCode(in.ZoneCode) {
		errs["zone"] = "配送区域标识只允许字母、数字、下划线与连字符（1-16 位）"
	}
	if n := runeLen(in.Address); n < 4 || n > 120 {
		errs["address"] = "收货地址需为 4-120 个字符"
	}
	if runeLen(in.Note) > 200 {
		errs["note"] = "备注不能超过 200 个字符"
	}
	if len(in.Items) < 1 || len(in.Items) > 8 {
		errs["items"] = "菜品行需为 1-8 行"
	} else {
		seen := map[string]bool{}
		for i, it := range in.Items {
			key := "items[" + itoa(i) + "]"
			if !ValidCode(it.Code) {
				errs[key+".code"] = "菜品编码只允许字母、数字、下划线与连字符（1-32 位）"
			}
			if seen[it.Code] {
				errs[key+".code"] = "同一菜品请在 qty 中合并数量"
			}
			seen[it.Code] = true
			if it.Qty < 1 || it.Qty > 20 {
				errs[key+".qty"] = "单个菜品数量需为 1-20"
			}
		}
	}
	return errs, len(errs) == 0
}

func ValidStatus(s string) bool {
	switch s {
	case OrderPlaced, OrderCooking, OrderReady, OrderDelivering, OrderDelivered, OrderCancelled:
		return true
	}
	return false
}

// nextStatus 是出餐状态机的唯一权威：不在表里的跳转一律 409。
var nextStatus = map[string]map[string]bool{
	OrderPlaced:     {OrderCooking: true, OrderCancelled: true},
	OrderCooking:    {OrderReady: true, OrderCancelled: true},
	OrderReady:      {OrderDelivering: true},
	OrderDelivering: {OrderDelivered: true},
	OrderDelivered:  {},
	OrderCancelled:  {},
}

func CanAdvance(from, to string) bool {
	return nextStatus[from][to]
}

func ValidPhone(p string) bool {
	if len(p) != 11 || p[0] != '1' {
		return false
	}
	for i := 0; i < len(p); i++ {
		if p[i] < '0' || p[i] > '9' {
			return false
		}
	}
	return true
}

func MaskPhone(p string) string {
	if len(p) != 11 {
		return "***********"
	}
	return p[:3] + "****" + p[7:]
}

func ValidCode(s string) bool {
	if len(s) < 1 || len(s) > 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-'
		if !ok {
			return false
		}
	}
	return true
}

var categoryLabels = map[string]bool{
	"hot": true, "cold": true, "staple": true, "soup": true, "dessert": true,
}

func ValidCategory(s string) bool { return categoryLabels[s] }

func runeLen(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
