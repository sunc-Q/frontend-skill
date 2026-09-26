package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 灌出一套自洽的干线货运数据集：
// 8 条在运营线路（含 2 条偏远、1 条停售）、5 条附加费规则（1 条停用）、
// 近 14 个自然日的运单与逐节点轨迹。计价一律走 domain.QuoteOf——与线上下单同一引擎。
// 固定随机源，重复执行结果一致。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	var n int64
	if err := r.db.WithContext(ctx).Table("waybills").Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}

	rnd := rand.New(rand.NewSource(20260926))
	// 落库时间一律 UTC：SQLite 里时间是带偏移的文本，混着 +08:00 与 +00:00 时
	// ORDER BY 变成按字符串排，「最新下单」会排到旧单后面。
	now = now.UTC()
	cstToday := now.Add(8 * time.Hour).Truncate(24 * time.Hour)
	// at 把「UTC+8 的日历日 + 时刻」换算成落库的 UTC 时间，避免双时钟口径漂移。
	at := func(dayOffset, hour, minute int) time.Time {
		return time.Date(cstToday.Year(), cstToday.Month(), cstToday.Day()+dayOffset,
			hour, minute, 0, 0, time.UTC).Add(-8 * time.Hour)
	}

	created := at(-60, 9, 0)
	lanes := []domain.Lane{
		{Code: "BJ-SH", Origin: "北京", Destination: "上海", Tier: domain.TierExpress, DistanceKm: 1318,
			FirstKg: 1, FirstCents: 1500, HalfKgCents: 260, MinCents: 1800, FuelPct: 8, VolDivisor: 6000, PromiseDays: 1},
		{Code: "BJ-XJ", Origin: "北京", Destination: "乌鲁木齐", Tier: domain.TierEconomy, DistanceKm: 2834,
			FirstKg: 1, FirstCents: 800, HalfKgCents: 95, MinCents: 1200, FuelPct: 12, VolDivisor: 12000, PromiseDays: 5, RemoteArea: true},
		{Code: "GZ-CD", Origin: "广州", Destination: "成都", Tier: domain.TierStandard, DistanceKm: 1680,
			FirstKg: 2, FirstCents: 1200, HalfKgCents: 150, MinCents: 1500, FuelPct: 10, VolDivisor: 8000, PromiseDays: 3},
		{Code: "SH-XA", Origin: "上海", Destination: "西安", Tier: domain.TierStandard, DistanceKm: 1460,
			FirstKg: 2, FirstCents: 1100, HalfKgCents: 140, MinCents: 1400, FuelPct: 9, VolDivisor: 8000, PromiseDays: 2},
		{Code: "SZ-KM", Origin: "深圳", Destination: "昆明", Tier: domain.TierStandard, DistanceKm: 1940,
			FirstKg: 2, FirstCents: 1150, HalfKgCents: 155, MinCents: 1450, FuelPct: 10, VolDivisor: 8000, PromiseDays: 3},
		{Code: "BJ-HB", Origin: "北京", Destination: "哈尔滨", Tier: domain.TierExpress, DistanceKm: 1240,
			FirstKg: 1, FirstCents: 1400, HalfKgCents: 230, MinCents: 1700, FuelPct: 8, VolDivisor: 6000, PromiseDays: 2},
		{Code: "HZ-LZ", Origin: "杭州", Destination: "兰州", Tier: domain.TierEconomy, DistanceKm: 1780,
			FirstKg: 3, FirstCents: 900, HalfKgCents: 88, MinCents: 1100, FuelPct: 13, VolDivisor: 12000, PromiseDays: 4, RemoteArea: true},
		{Code: "CD-XZ", Origin: "成都", Destination: "拉萨", Tier: domain.TierEconomy, DistanceKm: 2130,
			FirstKg: 3, FirstCents: 950, HalfKgCents: 105, MinCents: 1250, FuelPct: 15, VolDivisor: 12000, PromiseDays: 6, RemoteArea: true},
		{Code: "NB-XN", Origin: "宁波", Destination: "西宁", Tier: domain.TierEconomy, DistanceKm: 2050,
			FirstKg: 3, FirstCents: 880, HalfKgCents: 82, MinCents: 1050, FuelPct: 13, VolDivisor: 12000, PromiseDays: 5,
			RemoteArea: true, Active: false}, // 停售：只保留历史单，新单不可选
	}
	for i := range lanes {
		lanes[i].Active = true
		lanes[i].CreatedAt = created
		if lanes[i].Code == "NB-XN" {
			lanes[i].Active = false
		}
		if err := r.db.WithContext(ctx).Create(&lanes[i]).Error; err != nil {
			return fmt.Errorf("写入线路失败: %w", err)
		}
	}
	sellable := make([]domain.Lane, 0, len(lanes))
	for _, l := range lanes {
		if l.Active {
			sellable = append(sellable, l)
		}
	}

	rules := []domain.SurchargeRule{
		{Code: "remote-svc", Name: "偏远地区派送费", Kind: domain.KindRemotePct,
			RatePct: 15, MinCents: 800, Priority: 10, Active: true},
		{Code: "heavy-single", Name: "超重单件操作费", Kind: domain.KindHeavyPiece,
			ThresholdG: 30_000, AmountCents: 1500, Priority: 20, Active: true},
		{Code: "fragile-pack", Name: "易碎加固包装费", Kind: domain.KindFragileFlat,
			AmountCents: 1000, Priority: 30, Active: true},
		{Code: "long-haul", Name: "长途干线运营费", Kind: domain.KindLongHaul,
			ThresholdKm: 2000, AmountCents: 1200, Priority: 40, Active: true},
		{Code: "super-heavy", Name: "特重单件吊装费（已暂停）", Kind: domain.KindHeavyPiece,
			ThresholdG: 60_000, AmountCents: 6000, Priority: 50, Active: false},
	}
	for i := range rules {
		rules[i].CreatedAt = created
		if err := r.db.WithContext(ctx).Create(&rules[i]).Error; err != nil {
			return fmt.Errorf("写入附加费规则失败: %w", err)
		}
	}
	activeRules := domain.SortRulesActive(rules)

	// 件型配方：轻抛（体积重占优）、重货（实际重占优）、临界（两者接近）。
	kinds := []string{"bulky", "bulky", "dense", "dense", "dense", "mixed"}
	shipperPool := []string{"恒晟电子", "青禾食品", "北岸家具", "澜图服饰", "京鼎机械", "雾川传媒",
		"顶锐软件", "海图冷链", "星野医疗", "长风汽配", "云岫茶业", "沃野农资", "锦程百货", "听松文创"}
	citiesByLane := map[string][]string{}
	for _, l := range sellable {
		citiesByLane[l.Code] = []string{l.Origin + "马驹桥分拨中心", l.Origin + "顺义集散港", l.Origin + "开发区营业点"}
	}
	destNode := map[string]string{}
	for _, l := range lanes {
		destNode[l.Code] = l.Destination + "中转场"
	}

	// 每日新开单量：由远及近爬坡，今日仍在下单。
	perDay := []int{6, 7, 9, 8, 11, 10, 12, 13, 11, 14, 12, 15, 13, 9}
	seqByDay := map[int]int{}
	total := 0
	for di, count := range perDay {
		dayOffset := di - (len(perDay) - 1) // -13..0，0 为今天
		for i := 0; i < count; i++ {
			lane := sellable[(di*3+i*7)%len(sellable)]
			kind := kinds[(di+i)%len(kinds)]

			// 体积重==实际重的临界体积是 weight_g×vol_divisor/1000 cm³：
			// bulky 在其上乘 2~4 倍（按体积计费），dense 固定小体积，mixed 掷硬币决定。
			var weight, volume, heaviest, breakeven int64
			switch kind {
			case "bulky":
				weight = int64(600 + rnd.Intn(6000))
				breakeven = weight * int64(lane.VolDivisor) / 1000
				volume = breakeven * int64(2+rnd.Intn(3))
				heaviest = weight / int64(1+rnd.Intn(2))
			case "dense":
				weight = int64(8000 + rnd.Intn(70000))
				volume = int64(2000 + rnd.Intn(20000))
				heaviest = weight / int64(1+rnd.Intn(3))
			default:
				weight = int64(2000 + rnd.Intn(20000))
				breakeven = weight * int64(lane.VolDivisor) / 1000
				volume = breakeven * int64(2+rnd.Intn(3))
				if rnd.Intn(100) < 40 {
					volume = int64(2000 + rnd.Intn(int(breakeven)))
				}
				heaviest = weight / int64(1+rnd.Intn(4))
			}
			if heaviest < 1 {
				heaviest = 1
			}
			if heaviest > weight {
				heaviest = weight
			}
			pieces := 1 + rnd.Intn(6)
			if heaviest > weight {
				heaviest = weight
			}
			declared := int64(0)
			if rnd.Intn(100) < 34 {
				declared = int64(50000 + rnd.Intn(400000)) // 500~4500 元
			}
			fragile := rnd.Intn(100) < 14

			bookedAt := at(dayOffset, 8+rnd.Intn(11), rnd.Intn(60))
			// 清晨跑种子时「今天 8~18 点」整段都还在未来：未来时刻不能占位，
			// 否则按下单时间倒序的列表里新开的真单会排在历史单后面，统计口径也跟着失真。
			if dayOffset == 0 && bookedAt.After(now) {
				// cstToday 是把时钟拨到 UTC+8 后截断出来的「日界」，不是 UTC 瞬刻：
				// 减它得负数，所以要减 at(0,0,0)（真正的当日零点瞬刻）。
				window := int(now.Sub(at(0, 0, 0)).Minutes())
				if window < 1 {
					window = 1
				}
				bookedAt = now.Add(-time.Duration(rnd.Intn(window)) * time.Minute)
			}
			q := domain.QuoteOf(domain.QuoteInput{
				Lane: &lane, Rules: activeRules, WeightGrams: weight, VolumeCm3: volume,
				HeaviestG: heaviest, DeclaredCents: declared, Fragile: fragile,
			})

			status, _, deliveredLate := pickStatus(dayOffset, di, i, rnd)
			seqByDay[dayOffset]++
			code := fmt.Sprintf("FY%s-%04d", bookedAt.Add(8*time.Hour).Format("20060102"), seqByDay[dayOffset])

			w := &domain.Waybill{
				Code: code, LaneID: lane.ID, Status: status,
				ShipperName: shipperPool[(di*5+i*3)%len(shipperPool)],
				Phone:       fmt.Sprintf("138%08d", 10000000+total*137%90000000),
				PieceCount:  pieces, WeightGrams: weight, VolumeCm3: volume,
				HeaviestG: heaviest, DeclaredCents: declared, Fragile: fragile, RemoteArea: lane.RemoteArea,
				VolumetricGrams: q.VolumetricGrams, ChargeableGrams: q.ChargeableGrams,
				FreightCents: q.FreightCents, FuelCents: q.FuelCents,
				InsuranceCents: q.InsuranceCents, SurchargeCents: q.SurchargeCents,
				TotalCents: q.TotalCents, SurchargeDetail: encodeItems(q.Items),
				SurchargeCapped: q.Capped,
				BookedAt:        bookedAt, PromisedAt: bookedAt.AddDate(0, 0, lane.PromiseDays),
			}
			if status == domain.StDelivered {
				d := bookedAt.AddDate(0, 0, lane.PromiseDays)
				if deliveredLate {
					d = d.AddDate(0, 0, 1).Add(time.Duration(30+rnd.Intn(600)) * time.Minute)
				} else {
					d = d.Add(-time.Duration(60+rnd.Intn(700)) * time.Minute)
				}
				w.DeliveredAt = &d
			}
			// 轨迹先算再落库：buildTrack 会把越过「现在」的整条链按比例压回 now 之内，
			// 签收时间与更新时间都以压回后的最后一条轨迹为准，否则库里会出现「未来已签收」。
			events := buildTrack(w, &lane, status, citiesByLane[lane.Code], destNode[lane.Code], rnd, now)
			w.UpdatedAt = events[len(events)-1].OccurredAt
			if err := r.db.WithContext(ctx).Create(w).Error; err != nil {
				return fmt.Errorf("写入运单失败: %w", err)
			}
			total++

			for _, e := range events {
				e.WaybillID = w.ID
				if err := r.db.WithContext(ctx).Create(&e).Error; err != nil {
					return fmt.Errorf("写入轨迹失败: %w", err)
				}
			}
		}
	}
	// 库文件权限由调用方在种子灌完后统一压制（见 main.go），
	// 因为 -wal/-shm 只在首次写入后才存在。
	return nil
}

// pickStatus 决定一单当前停在哪一态，并给出应写的轨迹步数。
// 越早的单越接近终态：保证「在途五态 + 异常 + 退回 + 准点/超时签收」全覆盖。
func pickStatus(dayOffset, di, i int, rnd *rand.Rand) (status string, steps int, late bool) {
	switch {
	case dayOffset == 0:
		if i%3 == 0 {
			return domain.StBooked, 1, false
		}
		return domain.StPickedUp, 2, false
	case dayOffset == -1:
		switch i % 4 {
		case 0:
			return domain.StInTransit, 4, false
		case 1:
			return domain.StArrived, 5, false
		case 2:
			return domain.StOutForDelivery, 6, false
		default:
			return domain.StException, 4, false
		}
	case dayOffset == -2:
		switch i % 5 {
		case 0:
			return domain.StDelivered, 7, false
		case 1:
			return domain.StOutForDelivery, 6, false
		case 2:
			return domain.StException, 5, false
		case 3:
			return domain.StReturned, 5, false
		default:
			return domain.StDelivered, 7, true
		}
	case di%7 == 3 && i%6 == 4:
		return domain.StException, 5, false
	case di%11 == 5 && i%7 == 5:
		return domain.StReturned, 5, false
	default:
		return domain.StDelivered, 7, rnd.Intn(100) < 22
	}
}

// buildTrack 按状态生成 seq 连续、时间单调递增的轨迹链；链里混有纯在途中转打卡（不改变状态）。
func buildTrack(w *domain.Waybill, lane *domain.Lane, status string,
	origins []string, destNode string, rnd *rand.Rand, now time.Time) []domain.ScanEvent {

	chain := []struct {
		event, node, note string
		hourOffset        int
	}{
		{domain.StBooked, origins[0], "电子运单已生成，等待揽收", 0},
		{domain.StPickedUp, origins[len(origins)-1], fmt.Sprintf("已揽收 %d 件，称重比对通过", w.PieceCount), 2},
		{"line", origins[0], "装车出发，干线在途", 6},
		{domain.StInTransit, origins[0], "干线班车已发出", 7},
		{"line", "西安高陵中转场", "干线中转，换装第二程", 0},
		{domain.StArrived, destNode, "到达目的分拨，卸车完成", 0},
		{domain.StOutForDelivery, destNode, "交付派送员，开始末端派送", 0},
		{domain.StDelivered, destNode, "收件人已签收，回单归档", 0},
	}
	if lane.PromiseDays >= 4 {
		chain[4].hourOffset = lane.PromiseDays*24 - 10
	} else {
		chain[4].hourOffset = lane.PromiseDays*24 - 4
	}
	chain[5].hourOffset = lane.PromiseDays*24 - 2
	chain[6].hourOffset = lane.PromiseDays*24 + 2
	chain[7].hourOffset = lane.PromiseDays*24 + 6

	want := map[string][]int{
		domain.StBooked:         {0},
		domain.StPickedUp:       {0, 1},
		domain.StInTransit:      {0, 1, 2, 3},
		domain.StArrived:        {0, 1, 2, 3, 4, 5},
		domain.StOutForDelivery: {0, 1, 2, 3, 4, 5, 6},
		domain.StDelivered:      {0, 1, 2, 3, 4, 5, 6, 7},
		domain.StException:      {0, 1, 2, 3, 4},
		domain.StReturned:       {0, 1, 2, 3},
	}
	idxs, ok := want[status]
	if !ok {
		idxs = []int{0}
	}
	out := []domain.ScanEvent{}
	last := w.BookedAt
	for seq, ci := range idxs {
		c := chain[ci]
		t := w.BookedAt.Add(time.Duration(c.hourOffset) * time.Hour)
		if seq == len(idxs)-1 && status == domain.StDelivered && w.DeliveredAt != nil {
			t = *w.DeliveredAt
		}
		if !t.After(last) {
			t = last.Add(time.Duration(10+rnd.Intn(180)) * time.Minute)
		}
		last = t
		note := c.note
		et := c.event
		if status == domain.StException && seq == len(idxs)-1 {
			et = domain.StException
			note = "异常：收件人电话无法接通，运单挂起待处理"
		}
		out = append(out, domain.ScanEvent{Seq: seq + 1, EventType: et, Node: c.node, Note: note, OccurredAt: t})
	}
	if status == domain.StReturned {
		t := last.Add(3 * time.Hour)
		out = append(out, domain.ScanEvent{Seq: len(out) + 1, EventType: domain.StReturned,
			Node: destNode, Note: "按寄件人指令原路退回，运费另计", OccurredAt: t})
	}
	fitTrackWindow(w, out, now, rnd)
	return out
}

// fitTrackWindow 把越过「现在」的轨迹链按比例压回 now 之内：承诺时效是预算时长，
// 不是把打卡写到未来——否则看板首屏就会出现「明天已签收」、列表倒序也会跟着错乱。
// 压缩保序（比例一致），间隔过挤时按 1 分钟最小间距重排，签收时间跟着最后一条轨迹走。
func fitTrackWindow(w *domain.Waybill, out []domain.ScanEvent, now time.Time, rnd *rand.Rand) {
	if len(out) == 0 || !out[len(out)-1].OccurredAt.After(now) {
		return
	}
	// 收到点再落笔：全部压到 now 会让「最近更新」列清一色同一个时刻。
	ceiling := now.Add(-time.Duration(rnd.Intn(120)) * time.Minute)
	from := w.BookedAt
	room := ceiling.Sub(from)
	if room <= 0 {
		room = time.Minute
	}
	scale := float64(room) / float64(out[len(out)-1].OccurredAt.Sub(from))
	prev := from.Add(-time.Minute)
	for i := range out {
		t := from.Add(time.Duration(float64(out[i].OccurredAt.Sub(from)) * scale))
		if !t.After(prev) {
			t = prev.Add(time.Minute)
		}
		if t.After(ceiling) {
			t = ceiling
		}
		out[i].OccurredAt = t
		prev = t
	}
	if w.DeliveredAt != nil {
		*w.DeliveredAt = out[len(out)-1].OccurredAt
	}
}
