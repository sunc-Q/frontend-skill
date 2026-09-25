package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 生成一个自洽的跨境电商数据集：
// 18 个 SKU（5 类目，含 1 个下架、2 个零库存）、约 90 条目的国留评（星级分布与均分自洽）、
// 购物车预置 3 行。使用固定种子，重复执行结果一致。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260925))
	now = now.UTC().Truncate(24 * time.Hour)

	// sku, 中文名, 英文名, 类目, 品牌, 美分, 库存, 克, HS, 产地, 时效min, 时效max, 30天销量
	type seedP struct {
		sku, name, en, cat, brand string
		price, stock, weight      int
		hs, origin                string
		leadMin, leadMax, sold30  int
		listed                    bool
		bullets                   string
	}
	pool := []seedP{
		{"CB-EL-0001", "Active Max 降噪蓝牙耳机", "AuraPods Active Max TWS", "消费电子", "声谷 Shengu", 4599, 86, 120, "8518.30", "中国·东莞", 1, 3, 412, true, "混合降噪 42dB|38 小时综合续航|IPX5 防汗"},
		{"CB-EL-0002", "GaN 65W 四口氮化镓充电器", "FluxCharge GaN 65W 4-Port", "消费电子", "弗莱 Flux", 2399, 150, 130, "8504.40", "中国·深圳", 1, 3, 655, true, "PD3.1+QC5 双协议|折叠插脚|欧规/美规随箱"},
		{"CB-EL-0003", "磁吸无线充电板 15W", "MagDock 15W Wireless Pad", "消费电子", "弗莱 Flux", 1299, 220, 90, "8504.40", "中国·深圳", 1, 2, 880, true, "Qi2 磁吸对齐|静音风扇|兼容 12-15W"},
		{"CB-EL-0004", "8K 便携采集卡", "PixelCapture 8K HDMI Dongle", "消费电子", "影像派", 3299, 0, 60, "8543.70", "中国·杭州", 2, 4, 96, true, "4K60 输入/1080p240 直通|UVC 免驱|零延迟回环"},
		{"CB-HM-0011", "手冲咖啡套装（含电子秤）", "PourOver Brew Kit w/ Scale", "家居生活", "半山 BanShan", 5999, 45, 1650, "8215.50", "中国·景德镇", 2, 5, 233, true, "0.1g 精度计时秤|鹅颈细口壶|分享壶+滤杯"},
		{"CB-HM-0012", "香薰扩香石礼盒", "Aroma Stone Gift Set", "家居生活", "雾野 Misty", 1899, 120, 320, "3307.80", "中国·义乌", 1, 3, 501, true, "天然石膏基|6 支精油|礼盒装可直接寄售"},
		{"CB-HM-0013", "智能宠物喂食器 4L", "PetPal Smart Feeder 4L", "家居生活", "毛球博士", 8999, 32, 2100, "8436.99", "中国·宁波", 2, 5, 158, true, "APP 远程出粮|不锈钢食盆|双电源备份"},
		{"CB-HM-0014", "超声波助眠加湿器", "HushWave Ultrasonic Humidifier", "家居生活", "雾野 Misty", 3499, 78, 1350, "8419.89", "中国·佛山", 1, 4, 342, true, "<28dB 静音|12 小时续航|顶部加水"},
		{"CB-OU-0021", "折叠徒步登山杖（碳纤维）", "TrailFlex Carbon Trekking Poles", "户外运动", "岭行 Ridge", 7999, 26, 520, "6601.99", "中国·常州", 2, 5, 121, true, "T700 碳纤 165g/对|外锁三节|钨钢杖尖"},
		{"CB-OU-0022", "保温保冷硬壳冰箱 28L", "ColdVault Hard Cooler 28L", "户外运动", "极昼 Polarnight", 15999, 12, 6800, "9617.10", "中国·永康", 3, 7, 47, true, "滚塑外壳|保冷 72h|承压 500kg"},
		{"CB-OU-0023", "战术露营灯挂扣", "GlowClip Lantern Mount", "户外运动", "岭行 Ridge", 799, 460, 45, "3926.90", "中国·温州", 1, 2, 1204, true, "通用卡口|6061 铝合金|承重 3kg"},
		{"CB-OU-0024", "便携电动打气泵", "PulsePump Mini Inflator", "户外运动", "驰格 Gearsprint", 4299, 64, 480, "8414.80", "中国·台州", 1, 4, 288, true, "150PSI|预置球类气针|Type-C 充电"},
		{"CB-AP-0031", "钛钢真空电镀项链", "TiSteel PVD Necklace 316L", "服饰配件", "锚点 Anchor", 1599, 300, 35, "7117.19", "中国·广州", 1, 3, 764, true, "14K 真金电镀|不过敏不掉色|独立 OPP 袋"},
		{"CB-AP-0032", "偏光折叠太阳镜", "FoldSun Polarized Sunglasses", "服饰配件", "晴野 Solair", 2799, 140, 60, "9004.10", "中国·厦门", 1, 3, 455, true, "TAC 偏光片|UV400|尼龙镜架 18g"},
		{"CB-AP-0033", "美利奴羊毛运动袜 3 双装", "Merino Crew Socks 3-Pack", "服饰配件", "走峰 Trekwool", 2199, 180, 260, "6115.52", "越南·北宁", 2, 4, 390, true, "17.5 微米美利奴|足弓支撑|无骨缝合"},
		{"CB-AP-0034", "老钱风皮质卡包", "Heritage Leather Card Case", "服饰配件", "锚点 Anchor", 3299, 0, 85, "4202.31", "中国·温州", 2, 4, 96, false, "头层植鞣|手工缝线|RFID 屏蔽层"},
		{"CB-BT-0041", "视黄醇夜间修护精华", "Retinol Night Renewal Serum", "美妆个护", "本研 BenYan", 6499, 55, 110, "3304.99", "中国·广州", 1, 3, 268, true, "0.3% 包裹视黄醇|神经酰胺屏障|60 天装"},
		{"CB-BT-0042", "氨基酸洁面慕斯", "Amino Foam Cleanser", "美妆个护", "水曜 Shuuyou", 1699, 240, 240, "3401.30", "中国·湖州", 1, 3, 933, true, "APG+氨基酸双表活|pH5.5|泵头 200ml"},
	}
	created := now.AddDate(0, -3, 0)
	byCatSku := map[string]int64{}
	for _, sp := range pool {
		p := domain.Product{
			SKU: sp.sku, Name: sp.name, NameEn: sp.en, Category: sp.cat, Brand: sp.brand,
			PriceCents: int64(sp.price), Stock: sp.stock, WeightG: sp.weight,
			HSCode: sp.hs, Origin: sp.origin,
			LeadMin: sp.leadMin, LeadMax: sp.leadMax, Sold30: sp.sold30,
			Listed: sp.listed, Bullets: sp.bullets, CreatedAt: created,
		}
		if err := r.db.WithContext(ctx).Create(&p).Error; err != nil {
			return fmt.Errorf("写入商品失败: %w", err)
		}
		byCatSku[sp.sku] = p.ID
	}

	// 评价：每个在售 SKU 3-8 条；星级分布偏 4-5 星，个别 SKU 掺 1-2 星差评。
	authors := []string{"M. Chen", "Sofia R.", "Kenji T.", "Lukas B.", "Amira K.", "Noah W.",
		"Élodie P.", "Haruto S.", "Dana F.", "Diego M.", "杨小满", "Hannah G.", "Ravi N.", "Chloe D."}
	countries := []string{"US", "DE", "JP", "AU", "AE", "US", "DE", "JP"}
	goodBodies := []string{
		"包装很扎实，海运 9 天到，比预期快。做工对得起价格。",
		"第二次回购了，固件升级后连接更稳。客服响应在半天以内。",
		"质感在线，说明书有英文版，转卖上架很省事。",
		"实测和详情页描述一致，申报单据齐全，清关顺畅。",
		"性价比不错，唯一小问题是外箱略磕碰，产品无恙。",
	}
	badBodies := []string{
		"续航没有标称那么高，开降噪大概只有七成，介意的慎拍。",
		"充电器插脚有轻微划痕，怀疑是退换件，已联系售后。",
	}
	for sku, pid := range byCatSku {
		n := 3 + rnd.Intn(6)
		if sku == "CB-EL-0003" || sku == "CB-BT-0042" {
			n = 8
		}
		for i := 0; i < n; i++ {
			rating := 5
			switch r100 := rnd.Intn(100); {
			case r100 < 52:
				rating = 5
			case r100 < 78:
				rating = 4
			case r100 < 88:
				rating = 3
			case r100 < 95:
				rating = 2
			default:
				rating = 1
			}
			body := goodBodies[rnd.Intn(len(goodBodies))]
			if rating <= 2 {
				body = badBodies[rnd.Intn(len(badBodies))]
			}
			rv := domain.Review{
				ProductID: pid,
				Author:    authors[rnd.Intn(len(authors))],
				Country:   countries[rnd.Intn(len(countries))],
				Rating:    rating,
				Body:      body,
				Verified:  rnd.Intn(100) < 82,
				PostedAt:  now.AddDate(0, 0, -(1 + rnd.Intn(160))),
			}
			if err := r.db.WithContext(ctx).Create(&rv).Error; err != nil {
				return fmt.Errorf("写入评价失败: %w", err)
			}
		}
	}

	// 购物车：预置 3 行在售商品，口径与页面「凑单免运费」演示一致。
	cartPicks := []struct {
		sku string
		qty int
	}{{"CB-EL-0003", 2}, {"CB-HM-0012", 1}, {"CB-AP-0031", 3}}
	for i, cp := range cartPicks {
		item := domain.CartItem{ProductID: byCatSku[cp.sku], Qty: cp.qty, AddedAt: now.AddDate(0, 0, -i)}
		if err := r.db.WithContext(ctx).Create(&item).Error; err != nil {
			return fmt.Errorf("写入购物车失败: %w", err)
		}
	}
	return nil
}
