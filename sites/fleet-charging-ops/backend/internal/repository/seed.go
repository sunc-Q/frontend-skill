package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 灌出一套自洽的场站充电数据集：
// 3 座场站 12 桩（直流 8 + 交流 4；含 2 检修 1 离线）、18 台车（1 台退役）、
// 9 条分时规则（含 1 条停用、跨零点低谷窗口、周末兜底平段）、
// 近 14 个自然日的充电会话与结算快照。计价一律走 domain.ComputeBill——与线上结算同一引擎。
// 固定随机源，重复执行结果一致。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	var n int64
	if err := r.db.WithContext(ctx).Table("charge_sessions").Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}

	rnd := rand.New(rand.NewSource(20260926))
	// 落库时间一律 UTC：SQLite 里时间是带偏移的文本，混着 +08:00 与 +00:00 时
	// ORDER BY 变成按字符串排，「最近开充」会排到旧单后面。
	now = now.UTC()
	cstToday := now.Add(domain.BizOffsetHours * time.Hour).Truncate(24 * time.Hour)
	// at 把「UTC+8 的日历日 + 时刻」换算成落库的 UTC 时间，避免双时钟口径漂移。
	at := func(dayOffset, hour, minute int) time.Time {
		return time.Date(cstToday.Year(), cstToday.Month(), cstToday.Day()+dayOffset,
			hour, minute, 0, 0, time.UTC).Add(-domain.BizOffsetHours * time.Hour)
	}

	created := at(-60, 9, 0)
	piles := []domain.Pile{
		{Code: "DC-A01", Station: "西郊枢纽站", Bay: "A区01", Type: domain.PileTypeDC, PowerKw: 160, Status: domain.PileOnline},
		{Code: "DC-A02", Station: "西郊枢纽站", Bay: "A区02", Type: domain.PileTypeDC, PowerKw: 160, Status: domain.PileOnline},
		{Code: "DC-A03", Station: "西郊枢纽站", Bay: "A区03", Type: domain.PileTypeDC, PowerKw: 120, Status: domain.PileOnline},
		{Code: "DC-A04", Station: "西郊枢纽站", Bay: "A区04", Type: domain.PileTypeDC, PowerKw: 120, Status: domain.PileMaintenance, Note: "枪线过热更换中"},
		{Code: "DC-B01", Station: "临港冷链基地", Bay: "B区01", Type: domain.PileTypeDC, PowerKw: 180, Status: domain.PileOnline},
		{Code: "DC-B02", Station: "临港冷链基地", Bay: "B区02", Type: domain.PileTypeDC, PowerKw: 180, Status: domain.PileOnline},
		{Code: "DC-B03", Station: "临港冷链基地", Bay: "B区03", Type: domain.PileTypeDC, PowerKw: 120, Status: domain.PileOffline, Note: "配电房改造停电"},
		{Code: "DC-B04", Station: "临港冷链基地", Bay: "B区04", Type: domain.PileTypeDC, PowerKw: 120, Status: domain.PileOnline},
		{Code: "AC-C01", Station: "虹桥通勤场", Bay: "C区01", Type: domain.PileTypeAC, PowerKw: 7, Status: domain.PileOnline},
		{Code: "AC-C02", Station: "虹桥通勤场", Bay: "C区02", Type: domain.PileTypeAC, PowerKw: 7, Status: domain.PileOnline},
		{Code: "AC-C03", Station: "虹桥通勤场", Bay: "C区03", Type: domain.PileTypeAC, PowerKw: 7, Status: domain.PileMaintenance, Note: "计量表校验"},
		{Code: "AC-C04", Station: "虹桥通勤场", Bay: "C区04", Type: domain.PileTypeAC, PowerKw: 7, Status: domain.PileOnline},
	}
	for i := range piles {
		if err := r.db.WithContext(ctx).Create(&piles[i]).Error; err != nil {
			return fmt.Errorf("写入充电桩失败: %w", err)
		}
	}
	usable := make([]domain.Pile, 0, len(piles))
	for _, p := range piles {
		if p.Status == domain.PileOnline {
			usable = append(usable, p)
		}
	}

	// 分时价目表：工作日六段严丝合缝（含跨零点低谷），周末三段（含全天兜底平段）。
	rules := []domain.TariffRule{
		{Code: "wd-valley", Name: "工作日低谷（跨零点）", Period: domain.PeriodValley, DayType: domain.DayWeekday,
			StartMin: 1380, EndMin: 420, ElecCents: 35, ServiceCents: 10, Priority: 11, Active: true},
		{Code: "wd-peak-a", Name: "工作日早高峰", Period: domain.PeriodPeak, DayType: domain.DayWeekday,
			StartMin: 480, EndMin: 660, ElecCents: 125, ServiceCents: 60, Priority: 12, Active: true},
		{Code: "wd-peak-b", Name: "工作日晚高峰", Period: domain.PeriodPeak, DayType: domain.DayWeekday,
			StartMin: 1080, EndMin: 1260, ElecCents: 125, ServiceCents: 60, Priority: 13, Active: true},
		{Code: "wd-flat-a", Name: "工作日晨间平段", Period: domain.PeriodFlat, DayType: domain.DayWeekday,
			StartMin: 420, EndMin: 480, ElecCents: 72, ServiceCents: 40, Priority: 14, Active: true},
		{Code: "wd-flat-b", Name: "工作日午间平段", Period: domain.PeriodFlat, DayType: domain.DayWeekday,
			StartMin: 660, EndMin: 1080, ElecCents: 72, ServiceCents: 40, Priority: 15, Active: true},
		{Code: "wd-flat-c", Name: "工作日夜间平段", Period: domain.PeriodFlat, DayType: domain.DayWeekday,
			StartMin: 1260, EndMin: 1380, ElecCents: 72, ServiceCents: 40, Priority: 16, Active: true},
		{Code: "we-valley", Name: "周末凌晨低谷", Period: domain.PeriodValley, DayType: domain.DayWeekend,
			StartMin: 0, EndMin: 420, ElecCents: 33, ServiceCents: 8, Priority: 21, Active: true},
		{Code: "we-peak", Name: "周末日间高峰", Period: domain.PeriodPeak, DayType: domain.DayWeekend,
			StartMin: 600, EndMin: 1200, ElecCents: 118, ServiceCents: 58, Priority: 22, Active: true},
		{Code: "we-flat-base", Name: "周末兜底平段", Period: domain.PeriodFlat, DayType: domain.DayWeekend,
			StartMin: 0, EndMin: 1440, ElecCents: 66, ServiceCents: 42, Priority: 90, Active: true},
		{Code: "deep-valley", Name: "深夜谷中谷（已暂停）", Period: domain.PeriodValley, DayType: domain.DayAny,
			StartMin: 120, EndMin: 300, ElecCents: 22, ServiceCents: 5, Priority: 5, Active: false},
	}
	for i := range rules {
		rules[i].CreatedAt = created
		if err := r.db.WithContext(ctx).Create(&rules[i]).Error; err != nil {
			return fmt.Errorf("写入分时规则失败: %w", err)
		}
	}
	activeRules := domain.SortRulesActive(rules)

	depts := []struct {
		name, model string
		battery     int
	}{
		{"城配一队", "远程星智 E200", 86}, {"城配一队", "福田智蓝 OM", 72},
		{"冷链组", "宇光冷藏 EV", 100}, {"冷链组", "解放 j6p 纯电", 140},
		{"通勤班线", "比亚迪 K9", 226}, {"通勤班线", "中通 N12", 160},
		{"干线组", "重汽豪沃 TH", 172}, {"干线组", "东风天锦 EV", 138},
	}
	drivers := []string{"沈国平", "赵铁柱", "孙雅琴", "周立群", "吴建军", "郑一凡", "王海丽", "冯长生",
		"陈国栋", "褚天佑", "卫兰", "蒋大伟", "沈玲", "韩冬", "杨帆", "朱斌", "许晴", "何军"}
	vehicles := make([]domain.Vehicle, 0, 18)
	for i := 0; i < 18; i++ {
		d := depts[i%len(depts)]
		v := domain.Vehicle{
			PlateNo: fmt.Sprintf("沪A%c%05d", 'D'+rune(i%4), 10000+i*137%89999),
			Model:   d.model, Dept: d.name, BatteryKwh: d.battery,
			DriverName: drivers[i], Phone: fmt.Sprintf("138%08d", 20260000+i*311%89999999),
			CardNo: fmt.Sprintf("FC2026%04d", 1001+i), Active: true, CreatedAt: created,
		}
		if i == 17 {
			v.Active = false // 退役车：只留历史单，不能被选来开充
		}
		vehicles = append(vehicles, v)
		if err := r.db.WithContext(ctx).Create(&vehicles[i]).Error; err != nil {
			return fmt.Errorf("写入车辆失败: %w", err)
		}
	}
	fleet := make([]domain.Vehicle, 0, len(vehicles))
	for _, v := range vehicles {
		if v.Active {
			fleet = append(fleet, v)
		}
	}

	// 每日开充单量：由远及近爬坡，今天仍在开充。
	perDay := []int{7, 8, 9, 10, 9, 11, 12, 10, 13, 12, 14, 12, 15, 11}
	seqByDate := map[string]int{}
	total := 0
	// 未关闭会话（在充/故障挂起）的桩与车辆占位表，供 chargeOne 做互斥兜底。
	openPiles := map[int64]bool{}
	openVehicles := map[int64]bool{}

	// chargeOne 造一笔会话：从 startAt 充 durationMin 分钟、灌入 wh 瓦时。
	// 返回值同时把结算快照写好，价格全部出自 ComputeBill（与线上一致）。
	chargeOne := func(di, si, dayOffset int, startAt time.Time, durationMin int, v *domain.Vehicle, p *domain.Pile, status string) error {
		// 结构性兜底：随到的时间轴可能让两笔「未关闭」单落到同一桩/同一车，
		// 与部分唯一索引 idx_pile_open / idx_vehicle_open 冲突；撞车的一律退化成已结算单。
		if status == domain.SessCharging || status == domain.SessFaulted {
			if openPiles[p.ID] || openVehicles[v.ID] {
				status = domain.SessCompleted
			} else {
				openPiles[p.ID] = true
				openVehicles[v.ID] = true
			}
		}
		endAt := startAt.Add(time.Duration(durationMin) * time.Minute)
		// 满功率所需分钟数 = 电池可用量 ÷ 桩功率；实际时长取「充满」与「抽走一半」之间的随机。
		capWh := int64(v.BatteryKwh) * 1000
		fullMin := int(capWh*60/int64(p.PowerKw)/1000) + 1
		if durationMin > fullMin {
			durationMin = fullMin
		}
		// 墙钟约束：任何会话的结束时刻都不得落在未来——未关闭的单按「已充了多久」计电量，
		// 已结算的单按「开始→现在」钳住时长，否则 avg_power 会出现物理上不可能的功率。
		room := int(now.Sub(startAt).Minutes())
		if room < 0 {
			room = 0
		}
		if durationMin > room {
			durationMin = room
		}
		if durationMin < 1 {
			durationMin = 1
			startAt = now.Add(-time.Minute)
		}
		endAt = startAt.Add(time.Duration(durationMin) * time.Minute)
		actualWh := capWh * int64(durationMin) / int64(fullMin) / 20 * 20 // 对齐 20Wh，观感更像计量值
		if status == domain.SessAborted {
			actualWh = 0
		}
		if status == domain.SessCharging || status == domain.SessFaulted {
			endAt = time.Time{}
		}
		var bill *domain.Bill
		if actualWh > 0 && !endAt.IsZero() {
			bill = domain.ComputeBill(domain.BillInput{
				Start: startAt, End: endAt, ActualWh: actualWh,
				OverstayMin: seedOverstay(di+si, rnd), Rules: activeRules,
			})
			if !bill.IdentityOK(actualWh) {
				return fmt.Errorf("种子计价恒等式破口 @%d/%d", di, si)
			}
		} else {
			bill = &domain.Bill{Segments: []domain.SegmentView{}}
		}
		dateKey := startAt.Add(domain.BizOffsetHours * time.Hour).Format("20060102")
		seqByDate[dateKey]++
		code := "CS" + dateKey + "-" + fmt.Sprintf("%03d", seqByDate[dateKey])
		s := &domain.ChargeSession{
			Code: code, PileID: p.ID, VehicleID: v.ID, Status: status,
			StartAt: startAt, PlannedWh: capWh * int64(40+rnd.Intn(55)) / 100,
			ActualWh: actualWh, Note: "",
			OverstayMin: 0, UpdatedAt: now,
		}
		if status == domain.SessFaulted {
			s.Note = "故障：BMS 通信超时，枪座温度偏高"
		}
		if status == domain.SessAborted {
			s.Note = "弃单：车辆紧急调线，本次电量与费用全部作废"
		}
		if !endAt.IsZero() {
			s.EndAt = &endAt
		}
		if actualWh > 0 && bill.TotalCents > 0 {
			s.ElecCents = bill.ElecCents
			s.ServiceCents = bill.ServiceCents
			s.OverstayCents = bill.OverstayCents
			s.TotalCents = bill.TotalCents
			s.OverstayMin = bill.OverstayMin
			s.SegPeakWh, s.SegFlatWh, s.SegValleyWh = bill.PeakWh, bill.FlatWh, bill.ValleyWh
			s.SegUnpricedWh = bill.UnpricedWh
			s.SegDetail = encodeSegments(bill.Segments)
		}
		if err := r.db.WithContext(ctx).Create(s).Error; err != nil {
			return fmt.Errorf("写入充电会话失败: %w", err)
		}
		total++
		return nil
	}

	for di, count := range perDay {
		dayOffset := di - (len(perDay) - 1) // -13..0，0 为今天
		for si := 0; si < count; si++ {
			p := usable[(di*5+si*3)%len(usable)]
			v := fleet[(di*7+si*5)%len(fleet)]
			pile, veh := p, v
			// 今天：会话要么还在充、要么已结束，开始时刻不得越过 now。
			// 历史日：凌晨低谷（夜充主力）与白天时段交替，覆盖全部价格档。
			var startAt time.Time
			var durationMin int
			status := domain.SessCompleted
			if dayOffset == 0 {
				window := int(now.Sub(at(0, 0, 0)).Minutes()) - 30
				if window < 60 {
					window = 60
				}
				startAt = now.Add(-time.Duration(rnd.Intn(window)) * time.Minute).Truncate(time.Minute)
				if startAt.Before(at(0, 0, 0)) {
					startAt = at(0, 0, 0)
				}
				durationMin = 30 + rnd.Intn(150)
				// 当天末尾保留两笔在充 + 一笔故障挂起（开充时刻贴近 now，保证还没结束）。
				switch {
				case si == 0:
					status = domain.SessCharging
					startAt = now.Add(-time.Duration(5+rnd.Intn(40)) * time.Minute).Truncate(time.Minute)
				case si == 1 && di == len(perDay)-1:
					status = domain.SessCharging
					startAt = now.Add(-time.Duration(10+rnd.Intn(30)) * time.Minute).Truncate(time.Minute)
				case si == 2:
					status = domain.SessFaulted
					startAt = now.Add(-time.Duration(50+rnd.Intn(90)) * time.Minute).Truncate(time.Minute)
				default:
					// 已结算：时长必须容得下「开始→现在」，否则 end 会落到未来。
					maxDur := int(now.Sub(startAt).Minutes()) - 1
					if maxDur < 10 {
						// 凌晨刚过零点：今天还没地方放一笔「已结束」的单，改留在充。
						status = domain.SessCharging
						startAt = now.Add(-time.Duration(5+rnd.Intn(10)) * time.Minute).Truncate(time.Minute)
						durationMin = 0
					} else if durationMin > maxDur {
						durationMin = maxDur
					}
				}
			} else {
				switch (di + si) % 4 {
				case 0: // 凌晨低谷夜充
					startAt = at(dayOffset, 0+rnd.Intn(6), rnd.Intn(60))
					durationMin = 120 + rnd.Intn(240)
				case 1: // 早高峰补电
					startAt = at(dayOffset, 8+rnd.Intn(3), rnd.Intn(60))
					durationMin = 40 + rnd.Intn(80)
				case 2: // 午间平段
					startAt = at(dayOffset, 11+rnd.Intn(6), rnd.Intn(60))
					durationMin = 60 + rnd.Intn(120)
				default: // 晚高峰短充
					startAt = at(dayOffset, 18+rnd.Intn(3), rnd.Intn(60))
					durationMin = 30 + rnd.Intn(60)
				}
				if dayOffset == -1 && si == 3 {
					status = domain.SessAborted
				}
			}
			if err := chargeOne(di, si, dayOffset, startAt, durationMin, &veh, &pile, status); err != nil {
				return err
			}
		}
	}
	// 库文件权限由调用方在种子灌完后统一压制（见 main.go），
	// 因为 -wal/-shm 只在首次写入后才存在。
	return nil
}

// seedOverstay：约 22% 的结算单发生超时占桩（10-90 分钟），其余为零。
// 注意别用 seedMix%100 做百分比：di+si 的取值稀疏，会整批算不出超时单。
func seedOverstay(seedMix int, rnd *rand.Rand) int {
	_ = seedMix
	if rnd.Intn(100) < 22 {
		return 10 + rnd.Intn(81)
	}
	return 0
}
