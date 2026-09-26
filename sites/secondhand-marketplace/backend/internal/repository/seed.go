package repository

import (
	"context"
	"fmt"
	"time"

	"flea/internal/domain"
)

// offerSpec 描述一笔计划内出价的金额（相对挂牌价的百分比）与终态。
// kind: pending | accepted | rejected | outbid | stale_pending
// stale_pending = 「已过期但仍挂着 pending」，专门用来验过期单不会被算进最优出价。
type offerSpec struct {
	amountPct int
	kind      string
}

// placement 决定这笔出价落在哪个时刻（相对「现在」往前推）。
// pending 的回推量必须严格小于 TTL，否则 seed 出来的「在拍价」其实已经过期；
// 其余终态放在更早的历史里，decided_at 同样不晚于 now。
func (s offerSpec) placement(now time.Time, ttl time.Duration, k int) (time.Time, time.Time, *time.Time) {
	var placed, expires time.Time
	var decided *time.Time
	switch s.kind {
	case "pending":
		placed = now.Add(-time.Duration(40+k*180) * time.Minute)
		expires = placed.Add(ttl)
	case "stale_pending":
		placed = now.Add(-time.Duration(3*24+k) * time.Hour)
		expires = placed.Add(ttl)
	case "accepted":
		placed = now.Add(-time.Duration(6*24+k*9) * time.Hour)
		expires = placed.Add(ttl)
		d := placed.Add(2 * time.Hour)
		decided = &d
	case "rejected":
		placed = now.Add(-time.Duration(5*24+k*7) * time.Hour)
		expires = placed.Add(ttl)
		d := placed.Add(90 * time.Minute)
		decided = &d
	default: // outbid / expired
		placed = now.Add(-time.Duration(5*24+k*7) * time.Hour)
		expires = placed.Add(ttl)
	}
	return placed, expires, decided
}

// Seed 灌一个自洽的旧货市集数据集：
// 5 个品类的行情参考价、48 条挂单（available/reserved/sold/withdrawn 四态齐备）、
// 以及覆盖 pending/accepted/rejected/outbid/过期 pending 的出价流水。
//
// 时间口径两条硬规则（第 11 轮的坑）：
//  1. 全部时间戳归一到 UTC——SQLite 的 datetime 是文本，混 +08:00 会让 ORDER BY 退化成字符串排序；
//  2. 任何 seeded 时刻都不得晚于传入的 now——清晨运行时「今天」那档会整段落进未来。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	anchor := now.UTC().Truncate(time.Second)
	ttl := r.OfferTTL
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}

	cats := []domain.Category{
		{Code: "photo", NameZh: "摄影器材", Unit: "台", RefCent: 420000, ItemKind: "机身/镜头"},
		{Code: "audio", NameZh: "音响耳机", Unit: "副", RefCent: 148000, ItemKind: "耳机/功放"},
		{Code: "keyboard", NameZh: "机械键盘", Unit: "把", RefCent: 62000, ItemKind: "套件/整把"},
		{Code: "bike", NameZh: "自行车与配件", Unit: "辆", RefCent: 235000, ItemKind: "整车/轮组"},
		{Code: "book", NameZh: "旧书与杂志", Unit: "摞", RefCent: 8600, ItemKind: "成套/绝版"},
	}
	refByCode := map[string]int64{}
	catID := map[string]int64{}
	for i := range cats {
		if err := r.db.WithContext(ctx).Create(&cats[i]).Error; err != nil {
			return fmt.Errorf("写入品类失败: %w", err)
		}
		refByCode[cats[i].Code] = cats[i].RefCent
		catID[cats[i].Code] = cats[i].ID
	}

	sellers := []string{"阿澈", "dust_cat", "旧物研究员", "Lin7", "南锣闲人", "kkk_1998", "仓鼠滚轮", "半糖去冰",
		"Olive_0z", "跳蚤老周", "闲置仓库", "MomoMax"}
	buyers := []string{"ahuai_88", "vinyl_dog", "xiaoMa", "leroy9", "ganshui", "kit_042", "yoyo_2020", "banshan",
		"neo_tan", "shufang_jia", "pudge", "lantern_fish"}
	areas := []string{"徐汇·田林", "静安·曹家渡", "杨浦·控江路", "浦东·金桥", "长宁·武夷路",
		"虹口·四川北路", "闵行·莘庄", "宝山·共康", "黄浦·半淞园", "普陀·甘泉"}
	conds := []string{domain.ConditionLikeNew, domain.ConditionGood, domain.ConditionGood,
		domain.ConditionFair, domain.ConditionParts}
	titles := map[string][]string{
		"photo": {"富士 X-T30 机身 + 27mm F2.8", "佳能 EF 50mm F1.8 小痰盂", "尼康 D750 快门 2.1 万",
			"适马 35mm F1.4 ART 德版", "徕卡 Q2 国行带箱说", "理光 GR3 银黑改色", "宾得 K-3 II 双电池",
			"美能达 X700 胶片机改亮框", "曼富图 190 三脚架 + 云台", "神牛 V860II 引闪器一套"},
		"audio": {"索尼 WH-1000XM4 咖啡色", "森海 HD650 + 平衡线", "铁三角 ATH-M50x 二代",
			"马兰士 PM6007 功放", "歌德 SR325e 大耳", "Technics SL-1200 黑胶机", "漫步者 S1000MKII",
			"Bose QC25 头梁换新", "白韵 CD 机 + 功放一套", "JBL 305P 监听一对"},
		"keyboard": {"HHKB Pro 2 静电容 日版", "Leopold FC660M 茶轴", "filco 87 键 青轴 白",
			"宁芝 68 键 矮轴", "客制化 68 套件 铝合金", "燃风 GV100 全键无冲", "罗技 K380 双模",
			"Realforce 87U 白板", "达尔优 98 键 热插拔", "Keychron K6 矮轴 欧蓝"},
		"bike": {"大行 P8 折叠车 改装版", "捷安特 OCR3300 铝架", "崔克 MARLIN 5 山地",
			"Brompton S2L 三速", "公路车轮组 35mm 碳纤维", "凤凰 二八大杠 收藏级", "小牛 MQi2 电动车",
			"狼途 死飞 49 码", "鸟车 钛合金 定制", "迪卡侬 RC120 通勤"},
		"book": {"《人类群星闪耀时》精装三本", "旧地理杂志 1994-1998 全", "《计算机程序的构造和解释》",
			"汪曾祺文集 六册", "绝版推理小说 十二本打包", "《设计中的设计》原研哉", "旧地图册 + 旅行指南",
			"《万历十五年》黄仁宇", "摄影教程 杂志合订本", "童书绘本 二十册"},
	}

	// daySeq 让 deal_no 在「同日」内连续且唯一，与运行期 nextDealNo 的口径一致。
	daySeq := map[string]int{}
	dealNoFor := func(at time.Time) string {
		day := at.Format("060102")
		daySeq[day]++
		return fmt.Sprintf("FL-%s-%03d", day, daySeq[day])
	}

	type plan struct {
		status    string
		askingPct int // 相对行情参考价
		offers    []offerSpec
	}

	// 前 14 条手挑，逐条钉住一条业务分支；其余按公式铺量。
	plans := []plan{
		{domain.ListingAvailable, 96, []offerSpec{{93, "pending"}, {89, "pending"}, {85, "outbid"}}},
		{domain.ListingAvailable, 104, []offerSpec{{84, "pending"}}},      // 恰等于保底价（可成交边界）
		{domain.ListingAvailable, 100, nil},                               // 零出价
		{domain.ListingAvailable, 98, []offerSpec{{94, "stale_pending"}}}, // 过期 pending：不得计入最优
		{domain.ListingAvailable, 102, []offerSpec{{70, "rejected"}, {91, "pending"}}},
		{domain.ListingReserved, 95, []offerSpec{{92, "accepted"}, {88, "outbid"}, {84, "outbid"}}},
		{domain.ListingReserved, 110, []offerSpec{{78, "accepted"}}}, // 成交低于保底：卖家特批样本
		{domain.ListingSold, 97, []offerSpec{{94, "accepted"}, {90, "outbid"}}},
		{domain.ListingSold, 103, []offerSpec{{80, "rejected"}, {86, "outbid"}, {99, "accepted"}}},
		{domain.ListingWithdrawn, 108, nil},
		{domain.ListingWithdrawn, 101, []offerSpec{{95, "rejected"}}},
		{domain.ListingAvailable, 112, []offerSpec{{88, "rejected"}, {90, "rejected"}, {93, "pending"}}},
		{domain.ListingSold, 130, []offerSpec{{112, "outbid"}, {118, "accepted"}}}, // 溢价最高样本
		{domain.ListingAvailable, 90, []offerSpec{{70, "pending"}}},                // 低于保底的在拍价
	}

	const total = 48
	for i := 0; i < total; i++ {
		catCode := cats[i%len(cats)].Code
		titleList := titles[catCode]
		round := i / len(cats)
		title := titleList[round%len(titleList)]
		if round >= len(titleList) {
			title = fmt.Sprintf("%s（第 %d 件）", title, round/len(titleList)+1)
		}
		ref := refByCode[catCode]

		var p plan
		if i < len(plans) {
			p = plans[i]
		} else {
			p = plan{askingPct: 88 + (i*7)%34, status: domain.ListingAvailable}
			switch {
			case i%9 == 0:
				p.status = domain.ListingSold
			case i%11 == 0:
				p.status = domain.ListingReserved
			case i%17 == 0:
				p.status = domain.ListingWithdrawn
			}
			switch p.status {
			case domain.ListingSold:
				p.offers = []offerSpec{{92, "outbid"}, {96, "accepted"}}
			case domain.ListingReserved:
				p.offers = []offerSpec{{76, "rejected"}, {94, "accepted"}, {90, "outbid"}}
			case domain.ListingAvailable:
				n := i % 4
				for k := 0; k < n; k++ {
					kind := "pending"
					if k > 0 {
						kind = "outbid"
					}
					p.offers = append(p.offers, offerSpec{amountPct: 94 - k*6 - i%5, kind: kind})
				}
				if i%13 == 0 {
					p.offers = append(p.offers, offerSpec{amountPct: 82, kind: "stale_pending"})
				}
			}
		}

		asking := ref * int64(p.askingPct) / 100 / 100 * 100
		floor := asking * 84 / 100 / 100 * 100
		ageDays := (i * 5) % 26
		posted := anchor.Add(-time.Duration(ageDays)*24*time.Hour - time.Duration((i*37)%600)*time.Minute)
		if posted.After(anchor) {
			posted = anchor.Add(-time.Duration((i%6)+1) * time.Hour)
		}
		l := domain.Listing{
			Code:       fmt.Sprintf("FS-%04d", 1001+i),
			Title:      title,
			CategoryID: catID[catCode],
			Seller:     sellers[i%len(sellers)],
			AskingCent: asking,
			FloorCent:  floor,
			RefCent:    ref,
			Condition:  conds[i%len(conds)],
			Area:       areas[i%len(areas)],
			Status:     p.status,
			Views:      12 + (i*137)%860,
			PostedAt:   posted,
		}
		if err := r.db.WithContext(ctx).Create(&l).Error; err != nil {
			return fmt.Errorf("写入挂单失败: %w", err)
		}

		var best int64
		var acceptedAt time.Time
		for k, spec := range p.offers {
			amount := asking * int64(spec.amountPct) / 100 / 100 * 100
			if amount < 100 {
				amount = 100
			}
			placed, expires, decided := spec.placement(anchor, ttl, k)
			if placed.Before(posted) {
				placed = posted.Add(time.Duration(10+k*20) * time.Minute)
				expires = placed.Add(ttl)
			}
			if placed.After(anchor) {
				placed = anchor.Add(-time.Duration(2+k) * time.Hour)
				expires = placed.Add(ttl)
			}
			if decided != nil && decided.After(anchor) {
				d := anchor.Add(-time.Duration(1+k) * time.Hour)
				decided = &d
			}
			o := domain.Offer{
				ListingID:  l.ID,
				DealNo:     dealNoFor(placed),
				Buyer:      buyers[(i+k)%len(buyers)],
				AmountCent: amount,
				Message:    messageFor(spec.kind),
				PlacedAt:   placed,
				ExpiresAt:  expires,
				DecidedAt:  decided,
			}
			switch spec.kind {
			case "pending":
				o.Status = domain.OfferPending
				// 只有「有效期未过」的 pending 才回写最优出价——FS-1004 这条退化样本就靠它保持 0。
				if !expires.Before(anchor) && amount > best {
					best = amount
				}
			case "stale_pending":
				o.Status = domain.OfferPending
			case "accepted":
				o.Status = domain.OfferAccepted
				best = amount
				if decided != nil {
					acceptedAt = *decided
				}
			case "rejected":
				o.Status = domain.OfferRejected
			case "outbid":
				o.Status = domain.OfferOutbid
			default:
				o.Status = domain.OfferExpired
			}
			if err := r.db.WithContext(ctx).Create(&o).Error; err != nil {
				return fmt.Errorf("写入出价失败: %w", err)
			}
		}

		patch := map[string]any{"best_offer_cent": best}
		if p.status == domain.ListingSold && !acceptedAt.IsZero() {
			patch["sold_at"] = acceptedAt
		}
		if err := r.db.WithContext(ctx).Model(&domain.Listing{}).Where("id = ?", l.ID).
			Updates(patch).Error; err != nil {
			return fmt.Errorf("回写挂单出价失败: %w", err)
		}
	}
	return nil
}

func messageFor(kind string) string {
	switch kind {
	case "pending":
		return "诚心要，今天就能来自提"
	case "stale_pending":
		return "当时出差没接电话，应该过期了"
	case "accepted":
		return "可以，成交后放驿站"
	case "rejected":
		return "这个价有点低了"
	default:
		return "先挂着看看"
	}
}
