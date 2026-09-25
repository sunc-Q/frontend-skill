package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 生成一家川菜外卖门店 5 天营业窗口内的自洽数据：
// 26 道菜（含 3 道售罄）、5 个配送区域（含 1 个已停用）、约 120 笔订单及其明细。
// 金额/工时口径与 service 层完全一致（total = subtotal + fee，prep = Σ prep_min×⌈qty/2⌉），
// 使用固定随机种子，重复执行结果一致。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260925))
	now = now.UTC().Truncate(time.Minute)

	dishes := []domain.Dish{
		{Code: "HOT-011", Name: "麻婆豆腐", Category: "hot", PriceCents: 2800, PrepMin: 10, Spice: 2, Taste: "豆腐嫩滑 · 花椒麻香"},
		{Code: "HOT-012", Name: "水煮肉片", Category: "hot", PriceCents: 4800, PrepMin: 16, Spice: 3, Taste: "二荆条辣 · 肉片上浆"},
		{Code: "HOT-013", Name: "回锅肉", Category: "hot", PriceCents: 4200, PrepMin: 14, Spice: 1, Taste: "二刀肉 · 豆瓣香"},
		{Code: "HOT-014", Name: "宫保鸡丁", Category: "hot", PriceCents: 3600, PrepMin: 12, Spice: 1, Taste: "糊辣荔枝口"},
		{Code: "HOT-015", Name: "鱼香肉丝", Category: "hot", PriceCents: 3200, PrepMin: 11, Spice: 1, Taste: "酸甜咸鲜"},
		{Code: "HOT-016", Name: "干煸四季豆", Category: "hot", PriceCents: 2600, PrepMin: 9, Spice: 1, Taste: "小火干煸"},
		{Code: "HOT-017", Name: "辣子鸡丁", Category: "hot", PriceCents: 5200, PrepMin: 18, Spice: 3, Taste: "煳辣壳 · 炸鸡丁"},
		{Code: "HOT-018", Name: "夫妻肺片", Category: "hot", PriceCents: 5800, PrepMin: 8, Spice: 2, Taste: "红油淋拌"},
		{Code: "HOT-019", Name: "粉蒸牛肉", Category: "hot", PriceCents: 6200, PrepMin: 20, Spice: 1, Taste: "蒸足四十分钟"},
		{Code: "HOT-020", Name: "烧肥肠(当日售罄)", Category: "hot", PriceCents: 5600, PrepMin: 17, Spice: 2, Taste: "卤后再烧", Available: false},
		{Code: "CLD-021", Name: "口水鸡", Category: "cold", PriceCents: 3400, PrepMin: 6, Spice: 2, Taste: "藤椒红油"},
		{Code: "CLD-022", Name: "蒜泥白肉", Category: "cold", PriceCents: 3800, PrepMin: 7, Spice: 1, Taste: "薄切蒜泥"},
		{Code: "CLD-023", Name: "凉拌折耳根", Category: "cold", PriceCents: 1800, PrepMin: 4, Spice: 1, Taste: "云贵风味"},
		{Code: "CLD-024", Name: "红油耳片", Category: "cold", PriceCents: 2800, PrepMin: 5, Spice: 2, Taste: "冰镇脆爽"},
		{Code: "STP-031", Name: "蛋炒饭", Category: "staple", PriceCents: 1600, PrepMin: 7, Spice: 0, Taste: "隔夜米饭"},
		{Code: "STP-032", Name: "担担面", Category: "staple", PriceCents: 2200, PrepMin: 9, Spice: 2, Taste: "干挑小碗"},
		{Code: "STP-033", Name: "红糖糍粑", Category: "staple", PriceCents: 1900, PrepMin: 6, Spice: 0, Taste: "外酥里糯"},
		{Code: "STP-034", Name: "米饭", Category: "staple", PriceCents: 300, PrepMin: 5, Spice: 0, Taste: "五常稻花香"},
		{Code: "STP-035", Name: "酸菜肉丝面(厨房忙)", Category: "staple", PriceCents: 2400, PrepMin: 10, Spice: 1, Taste: "老坛酸菜", Available: false},
		{Code: "SPB-041", Name: "番茄煎蛋汤", Category: "soup", PriceCents: 1800, PrepMin: 8, Spice: 0, Taste: "现煎现煮"},
		{Code: "SPB-042", Name: "酸萝卜老鸭汤", Category: "soup", PriceCents: 4600, PrepMin: 12, Spice: 0, Taste: "老火吊汤"},
		{Code: "SPB-043", Name: "紫菜蛋花汤", Category: "soup", PriceCents: 1200, PrepMin: 5, Spice: 0, Taste: "清口"},
		{Code: "DST-051", Name: "冰粉", Category: "dessert", PriceCents: 1200, PrepMin: 3, Spice: 0, Taste: "手搓冰粉 · 红糖花生"},
		{Code: "DST-052", Name: "醪糟小汤圆", Category: "dessert", PriceCents: 1500, PrepMin: 5, Spice: 0, Taste: "微醺"},
		{Code: "DST-053", Name: "唯怡豆奶", Category: "dessert", PriceCents: 600, PrepMin: 1, Spice: 0, Taste: "解辣搭子"},
		{Code: "DST-054", Name: "山城啤酒(售罄)", Category: "dessert", PriceCents: 800, PrepMin: 1, Spice: 0, Taste: "冰镇", Available: false},
	}
	soldOut := map[string]bool{"HOT-020": true, "STP-035": true, "DST-054": true}
	for i := range dishes {
		dishes[i].Available = !soldOut[dishes[i].Code]
		dishes[i].CreatedAt = now.AddDate(0, -2, 0)
		if err := r.db.WithContext(ctx).Create(&dishes[i]).Error; err != nil {
			return fmt.Errorf("写入菜品失败: %w", err)
		}
	}
	dishByCode := map[string]*domain.Dish{}
	for i := range dishes {
		dishByCode[dishes[i].Code] = &dishes[i]
	}

	zones := []domain.Zone{
		{Code: "near", Name: "近域 · 3 公里内", DistanceKm: "0-3km", MinOrderCents: 2000, FeeCents: 0, EtaMin: 12, Active: true},
		{Code: "mid", Name: "中域 · 3-5 公里", DistanceKm: "3-5km", MinOrderCents: 2500, FeeCents: 300, EtaMin: 20, Active: true},
		{Code: "far", Name: "远域 · 5-8 公里", DistanceKm: "5-8km", MinOrderCents: 3500, FeeCents: 500, EtaMin: 30, Active: true},
		{Code: "outer", Name: "郊域 · 8-12 公里", DistanceKm: "8-12km", MinOrderCents: 4500, FeeCents: 800, EtaMin: 40, Active: true},
		{Code: "campus", Name: "园区专线（已停用）", DistanceKm: "1-2km", MinOrderCents: 1500, FeeCents: 100, EtaMin: 10, Active: false},
	}
	for i := range zones {
		if err := r.db.WithContext(ctx).Create(&zones[i]).Error; err != nil {
			return fmt.Errorf("写入配送区域失败: %w", err)
		}
	}
	activeZones := zones[:4]

	names := []string{"王晓晴", "李慕白", "张一凡", "陈默", "刘洪", "赵蓉", "孙悦", "周正", "吴桐", "郑小蝶",
		"冯唐", "褚岩", "卫兰", "蒋欣怡", "沈括", "韩磊", "杨梅", "朱颜", "秦岚", "许仙"}
	streets := []string{"锦绣路", "天府大道", "玉林西路", "科华北路", "人民南路", "双庆路", "万年场街", "光华大道"}
	complexes := []string{"花生唐小区", "天府上城", "梧桐里", "云栖湾", "锦华公寓", "长滩首部", "白鹭小区"}
	notes := []string{"", "", "", "不要葱", "微辣多花椒", "放门口勿敲门", "餐具一份", "汤和菜分开装", "", "尽快出餐"}

	hotCodes := []string{"HOT-011", "HOT-012", "HOT-013", "HOT-014", "HOT-015", "HOT-016", "HOT-017", "HOT-018", "HOT-019", "HOT-020"}
	coldCodes := []string{"CLD-021", "CLD-022", "CLD-023", "CLD-024"}
	stapleCodes := []string{"STP-031", "STP-032", "STP-033", "STP-034", "STP-035"}
	soupCodes := []string{"SPB-041", "SPB-042", "SPB-043"}
	dessertCodes := []string{"DST-051", "DST-052", "DST-053", "DST-054"}

	orderIdx := 0
	perDaySeq := map[string]int{}

	// dayOffset: 4=五天前 … 0=今天。历史日以 delivered 为主，今天覆盖在制全流程。
	plan := []struct {
		dayOffset int
		count     int
	}{{4, 18}, {3, 22}, {2, 26}, {1, 30}, {0, 26}}

	for _, day := range plan {
		dayStart := now.AddDate(0, 0, -day.dayOffset)
		dayKey := dayStart.Format("20060102")
		for i := 0; i < day.count; i++ {
			orderIdx++
			perDaySeq[dayKey]++
			placedAt := time.Date(dayStart.Year(), dayStart.Month(), dayStart.Day(),
				10+i%11, (i*13+orderIdx*7)%60, 0, 0, time.UTC)
			if placedAt.After(now) {
				placedAt = now.Add(-time.Duration(orderIdx%97+1) * time.Minute)
			}

			var status string
			if day.dayOffset == 0 {
				switch i % 9 {
				case 0:
					status = domain.OrderPlaced
				case 1:
					status = domain.OrderCooking
				case 2, 5:
					status = domain.OrderReady
				case 3:
					status = domain.OrderDelivering
				case 7:
					status = domain.OrderCancelled
				default:
					status = domain.OrderDelivered
				}
			} else if i%13 == 5 {
				status = domain.OrderCancelled
			} else {
				status = domain.OrderDelivered
			}

			zone := activeZones[orderIdx%2]
			if orderIdx%7 == 3 {
				zone = activeZones[2]
			}
			if orderIdx%11 == 7 {
				zone = activeZones[3]
			}

			nLines := 2 + rnd.Intn(3)
			codes := []string{hotCodes[rnd.Intn(len(hotCodes))]}
			pick := func(pool []string) string { return pool[rnd.Intn(len(pool))] }
			for len(codes) < nLines {
				c := pick([]string{pick(coldCodes), pick(stapleCodes), pick(soupCodes), pick(dessertCodes), pick(hotCodes)})
				dup := false
				for _, x := range codes {
					if x == c {
						dup = true
					}
				}
				if !dup {
					codes = append(codes, c)
				}
			}
			// 必带一份主食，凑够起送价
			hasStaple := false
			for _, c := range codes {
				if c[:3] == "STP" {
					hasStaple = true
				}
			}
			if !hasStaple {
				codes = append(codes, "STP-034")
			}

			var subtotal int64
			var prep int
			count := 0
			items := make([]domain.OrderItem, 0, len(codes))
			for _, c := range codes {
				d := dishByCode[c]
				qty := 1 + rnd.Intn(2)
				if d.Category == "staple" && d.Code == "STP-034" {
					qty = 1 + rnd.Intn(3)
				}
				line := d.PriceCents * int64(qty)
				subtotal += line
				prep += d.PrepMin * ((qty + 1) / 2)
				count += qty
				items = append(items, domain.OrderItem{
					DishCode: d.Code, DishName: d.Name, UnitPriceCents: d.PriceCents, Qty: qty, LineCents: line,
				})
			}
			for subtotal < zone.MinOrderCents {
				d := dishByCode["STP-034"]
				line := d.PriceCents * 2
				subtotal += line
				prep += d.PrepMin
				count += 2
				items = append(items, domain.OrderItem{
					DishCode: d.Code, DishName: d.Name, UnitPriceCents: d.PriceCents, Qty: 2, LineCents: line,
				})
			}

			o := domain.Order{
				OrderNo:          FormatOrderNo(placedAt, perDaySeq[dayKey]),
				Recipient:        names[orderIdx%len(names)],
				Phone:            fmt.Sprintf("138%08d", 10000000+orderIdx*37),
				ZoneCode:         zone.Code,
				Address:          fmt.Sprintf("%s%d号%s%d栋%d单元%d", streets[orderIdx%len(streets)], 88+orderIdx%200, complexes[orderIdx%len(complexes)], 1+orderIdx%9, 1+orderIdx%4, 100+orderIdx%1600),
				Note:             notes[orderIdx%len(notes)],
				Status:           status,
				ItemCount:        count,
				SubtotalCents:    subtotal,
				DeliveryFeeCents: zone.FeeCents,
				TotalCents:       subtotal + zone.FeeCents,
				PrepMinutes:      prep,
				PlacedAt:         placedAt,
				UpdatedAt:        placedAt.Add(time.Duration(20+prep) * time.Minute),
			}
			if err := r.db.WithContext(ctx).Create(&o).Error; err != nil {
				return fmt.Errorf("写入订单失败: %w", err)
			}
			for i := range items {
				items[i].OrderID = o.ID
			}
			if err := r.db.WithContext(ctx).Create(&items).Error; err != nil {
				return fmt.Errorf("写入订单明细失败: %w", err)
			}
		}
	}
	return nil
}
