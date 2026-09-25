package repository

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"time"

	"autoshop/internal/domain"
)

// Seed 灌一套口径自洽的修理厂数据。三条硬约束：
//  1. 批次入库、工单出库、作废退料全部走 domain.PlanIssue / domain.LaborAmount /
//     domain.PriceLine 这三把唯一的算尺 —— 线上算的账和种子里的账是同一套代码；
//  2. 每个批次一条正向流水、每次出库一条负向流水、退料/报损各一条，
//     因此「Σ流水 == Σ批次余量」在种子完成时天然成立（末尾自检会实测）；
//  3. 分支覆盖是设计出来的不是碰运气：状态机 8 态全覆盖，待料/缺件/逾期在办/
//     低库存/零库存/停用件都要有真样本，否则后续冒烟的负向断言会打在空集上。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	var cnt int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM work_orders`).Scan(&cnt).Error; err != nil {
		return err
	}
	if cnt > 0 {
		return nil
	}

	rnd := rand.New(rand.NewSource(20260926))
	// 种子一律用 UTC：本地时区写进去会让 SQLite 按字符串比较时间，逾期口径直接算反。
	now = now.UTC()
	utc := now.Truncate(time.Minute)
	today := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)

	// ---- 1. 配件主数据 ----
	type partDef struct {
		code, name, brand, cat, unit string
		cost, price                  int64
		reorder                      int
		shelf                        string
	}
	defs := []partDef{
		{"EN-STR-01", "火花塞（铱金，单支）", "火炬", domain.CatEngine, "件", 4200, 8800, 24, "A-01-3"},
		{"EN-BLT-02", "正时皮带套装", "盖茨", domain.CatEngine, "套", 31000, 52800, 4, "A-02-1"},
		{"EN-GSK-03", "气门室盖垫", "派尔克", domain.CatEngine, "件", 6800, 11800, 6, "A-02-4"},
		{"EN-COIL-04", "点火线圈", "德尔福", domain.CatEngine, "件", 12500, 21800, 8, "A-03-2"},
		{"EN-WPMP-05", "水泵总成", "SKF", domain.CatEngine, "件", 26800, 45800, 3, "A-03-5"},
		{"BR-PAD-01", "前刹车片套装", "天合", domain.CatBrake, "套", 15800, 27800, 12, "B-01-2"},
		{"BR-ROT-02", "刹车盘（单片）", "布雷博", domain.CatBrake, "片", 21000, 36500, 8, "B-01-5"},
		{"BR-CAL-03", "卡钳修理包", "菲罗多", domain.CatBrake, "套", 8600, 15200, 6, "B-02-1"},
		{"BR-FLU-04", "刹车油 DOT4（1L）", "嘉实多", domain.CatBrake, "升", 4800, 8600, 10, "B-03-2"},
		{"FL-OIL-01", "机油滤清器", "马勒", domain.CatFilter, "件", 3200, 6800, 30, "C-01-1"},
		{"FL-AIR-02", "空气滤芯", "马勒", domain.CatFilter, "件", 4600, 9200, 20, "C-01-3"},
		{"FL-CAB-03", "空调滤芯（带炭）", "曼牌", domain.CatFilter, "件", 5800, 11800, 18, "C-02-1"},
		{"FL-FUEL-04", "汽油滤芯", "博世", domain.CatFilter, "件", 9200, 16800, 8, "C-02-4"},
		{"EL-BAT-01", "蓄电池 60Ah", "瓦尔塔", domain.CatElectrical, "件", 32000, 52800, 6, "D-01-1"},
		{"EL-ALT-02", "发电机碳刷架", "电装", domain.CatElectrical, "件", 11000, 19800, 4, "D-02-2"},
		{"EL-SNS-03", "氧传感器", "电装", domain.CatElectrical, "件", 18500, 32800, 5, "D-02-5"},
		{"EL-WPR-04", "雨刮片（对装）", "法雷奥", domain.CatElectrical, "对", 6800, 12800, 16, "D-03-1"},
		{"EL-BUL-05", "LED 大灯泡（对）", "欧司朗", domain.CatElectrical, "对", 15600, 28800, 8, "D-03-4"},
		{"SU-SAK-01", "前减震器（单只）", "KYB", domain.CatSuspension, "件", 24500, 42800, 6, "E-01-2"},
		{"SU-ARM-02", "下摆臂总成", "伦福德", domain.CatSuspension, "件", 19800, 34800, 4, "E-01-5"},
		{"SU-LNK-03", "稳定杆连杆", "伦福德", domain.CatSuspension, "件", 7400, 14200, 10, "E-02-1"},
		{"SU-MNT-04", "发动机机脚胶", "伦福德", domain.CatSuspension, "件", 16800, 29800, 4, "E-02-4"},
		{"CN-OIL-01", "全合成机油 0W-20（4L）", "美孚", domain.CatConsumable, "桶", 16800, 28800, 20, "F-01-1"},
		{"CN-OIL-02", "全合成机油 5W-30（4L）", "壳牌", domain.CatConsumable, "桶", 14800, 25800, 24, "F-01-2"},
		{"CN-COOL-03", "防冻冷却液（4L）", "嘉实多", domain.CatConsumable, "桶", 8800, 16800, 14, "F-02-1"},
		{"CN-ADH-04", "燃油添加剂", "雪佛龙", domain.CatConsumable, "瓶", 4600, 9800, 18, "F-02-4"},
		{"CN-GRS-05", "高温润滑脂", "道达尔", domain.CatConsumable, "支", 2800, 5800, 12, "F-03-1"},
		{"TR-CLT-01", "离合器三件套", "卢克", domain.CatTransmission, "套", 88000, 148000, 2, "G-01-1"},
		{"TR-ATF-02", "自动变速箱油 ATF（4L）", "采埃孚", domain.CatTransmission, "桶", 22800, 39800, 10, "G-01-4"},
		{"TR-CVB-03", "CV 球笼防尘套", "GSP", domain.CatTransmission, "件", 5200, 10800, 8, "G-02-2"},
		{"TR-OLD-04", "矿物型变速箱油（已停用）", "国产", domain.CatTransmission, "桶", 12000, 19800, 0, "G-03-9"},
	}

	parts := make([]domain.Part, 0, len(defs))
	costBase := map[string]int64{}
	priceOf := map[string]int64{}
	for i, d := range defs {
		st := domain.PartActive
		if d.code == "TR-OLD-04" {
			st = domain.PartDiscontinued
		}
		parts = append(parts, domain.Part{
			Code: d.code, Name: d.name, Brand: d.brand, Category: d.cat, Unit: d.unit,
			ListPriceCents: d.price, ReorderPoint: d.reorder, ShelfLocation: d.shelf,
			Status: st, CreatedAt: today.AddDate(0, 0, -(120 + i)),
		})
		costBase[d.code] = d.cost
		priceOf[d.code] = d.price
	}

	// ---- 2. 入库批次（内存态先算完，最后一次性落库，保证流水与余量同源）----
	suppliers := []string{"华东中心库", "品牌直供", "本地代理", "厂家大促批"}
	lotsByPart := map[string][]*domain.StockLot{}
	lots := []domain.StockLot{}
	moves := []domain.StockMove{}
	lotSeq := 0
	for i, p := range parts {
		if p.Status == domain.PartDiscontinued {
			continue
		}
		n := 1 + rnd.Intn(3)
		if p.Category == domain.CatConsumable || p.Category == domain.CatFilter {
			n = 2 + rnd.Intn(2)
		}
		for k := 0; k < n; k++ {
			lotSeq++
			recv := today.AddDate(0, 0, -(150 - k*45 - (i*7)%21))
			qty := 20 + rnd.Intn(60)
			if p.ReorderPoint >= 18 {
				qty = 40 + rnd.Intn(80)
			}
			// 批次成本有涨有跌，FIFO 才量得出「同一件料不同批次不同价」。
			drift := int64(100 + (lotSeq*13)%23 - 11)
			cost := costBase[p.Code] * drift / 100
			lot := domain.StockLot{
				PartCode: p.Code, LotNo: fmt.Sprintf("LOT-%s-%03d", recv.Format("0601"), lotSeq),
				QtyReceived: qty, QtyRemaining: qty, UnitCostCents: cost,
				Supplier: suppliers[lotSeq%len(suppliers)], ReceivedAt: recv,
			}
			if rule, ok := domain.CatRules[p.Category]; ok && rule.Fragile {
				exp := recv.AddDate(0, 0, rule.ShelfLifeDays)
				lot.ExpiresAt = &exp
			}
			ptr := lot
			lots = append(lots, lot)
			lotsByPart[p.Code] = append(lotsByPart[p.Code], &ptr)
			moves = append(moves, domain.StockMove{
				PartCode: p.Code, LotNo: lot.LotNo, Kind: domain.MoveReceipt, QtyDelta: qty,
				UnitCostCents: cost, Note: "入库建批：" + lot.Supplier, OccurredAt: recv,
			})
		}
	}

	// 低库存与零库存样本：直接报损到目标水位，报损本身也进流水。
	shrinkTo := func(code string, keep int, at time.Time) {
		rest := keep
		for _, l := range lotsByPart[code] {
			if rest <= 0 {
				used := l.QtyRemaining
				if used == 0 {
					continue
				}
				l.QtyRemaining = 0
				moves = append(moves, domain.StockMove{
					PartCode: code, LotNo: l.LotNo, Kind: domain.MoveScrap, QtyDelta: -used,
					UnitCostCents: l.UnitCostCents, Note: "盘亏报损", OccurredAt: at,
				})
				continue
			}
			if l.QtyRemaining > rest {
				used := l.QtyRemaining - rest
				l.QtyRemaining = rest
				moves = append(moves, domain.StockMove{
					PartCode: code, LotNo: l.LotNo, Kind: domain.MoveScrap, QtyDelta: -used,
					UnitCostCents: l.UnitCostCents, Note: "盘亏报损（样品损耗）", OccurredAt: at,
				})
				rest = 0
			}
		}
	}
	shrinkTo("SU-MNT-04", 2, today.Add(-36*time.Hour)) // 低库存（补货点 4）
	shrinkTo("TR-CLT-01", 0, today.Add(-20*time.Hour)) // 零库存（补货点 2）→ 出库必 409

	// ---- 3. 工单、明细与出库流水 ----
	issue := func(partCode string, qty int, woNo string, at time.Time) (int64, bool) {
		var snapshot []domain.StockLot
		for _, l := range lotsByPart[partCode] {
			snapshot = append(snapshot, *l)
		}
		plan, cost, missing := domain.PlanIssue(snapshot, qty)
		if missing > 0 {
			return 0, false
		}
		for _, st := range plan {
			for _, l := range lotsByPart[partCode] {
				if l.LotNo == st.LotNo {
					l.QtyRemaining -= st.Qty
				}
			}
			moves = append(moves, domain.StockMove{
				PartCode: partCode, LotNo: st.LotNo, Kind: domain.MoveIssue, QtyDelta: -st.Qty,
				UnitCostCents: st.UnitCostCents, WoNo: woNo, Note: "工单出库", OccurredAt: at,
			})
		}
		return cost, true
	}

	ops := []struct {
		name  string
		min   int
		grade string
		parts []string
	}{
		{"更换机油机滤", 40, domain.GradeJunior, []string{"FL-OIL-01", "CN-OIL-01", "CN-OIL-02"}},
		{"更换空气与空调滤芯", 35, domain.GradeJunior, []string{"FL-AIR-02", "FL-CAB-03"}},
		{"前刹车片更换", 70, domain.GradeMiddle, []string{"BR-PAD-01"}},
		{"刹车盘成套更换", 110, domain.GradeMiddle, []string{"BR-ROT-02", "BR-FLU-04"}},
		{"火花塞整套更换", 90, domain.GradeMiddle, []string{"EN-STR-01"}},
		{"蓄电池更换与匹配", 30, domain.GradeJunior, []string{"EL-BAT-01"}},
		{"空调系统清洗加氟", 80, domain.GradeMiddle, []string{"CN-ADH-04"}},
		{"前减震器成对更换", 150, domain.GradeMaster, []string{"SU-SAK-01", "SU-LNK-03"}},
		{"下摆臂检修更换", 180, domain.GradeMaster, []string{"SU-ARM-02"}},
		{"变速箱油循环更换", 120, domain.GradeMaster, []string{"TR-ATF-02", "CN-COOL-03"}},
		{"正时皮带套装更换", 240, domain.GradeMaster, []string{"EN-BLT-02", "EN-GSK-03"}},
		{"全车健康检测", 45, domain.GradeMiddle, nil},
		{"冷却液更换与排气", 60, domain.GradeJunior, []string{"CN-COOL-03", "EN-WPMP-05"}},
		{"雨刮与灯具更换", 25, domain.GradeJunior, []string{"EL-WPR-04", "EL-BUL-05"}},
		{"氧传感器更换", 55, domain.GradeMiddle, []string{"EL-SNS-03"}},
	}
	advisors := []string{"沈立群", "白慧敏", "关东明", "程若楠", "骆致和", "虞山柏"}
	names := []string{"赵一鸣", "钱思远", "孙立群", "李慕白", "李云舒", "周景行", "吴陈书", "郑寒山",
		"王砚舟", "冯亦禾", "陈镜湖", "褚云礼", "卫子期", "蒋听澜", "沈砚青", "韩牧野"}
	cars := []string{"大众迈腾 2.0T", "丰田凯美瑞 2.5L", "本田 CR-V 1.5T", "比亚迪汉 EV",
		"特斯拉 Model 3", "日产轩逸 1.6L", "别克君威 2.0T", "奥迪 A4L 40TFSI",
		"吉利星越 L 2.0T", "长安 CS75 PLUS", "宝马 320Li", "奔驰 C260L"}
	provinces := []string{"沪A", "沪B", "苏A", "浙A", "京N", "粤B"}
	symptoms := []string{"冷车启动异响，怠速抖动", "刹车偏软，仪表提示制动系统故障", "保养到期，顺带检查空调不冷",
		"过减速带前方底盘咯吱响", "变速箱换挡顿挫，低速闯挡", "蓄电池亏电两次，无法正常点火",
		"机滤底座渗油，地面有油渍", "发动机故障灯亮，报氧传感器", "雨刮刮不干净，玻璃有水痕",
		"长途前全车检查", "冷却液温度偏高，风扇常转", "转向回位不良，方向发飘"}

	// 一周以前的单只允许离场态：否则「在厂」列表里全是十几天前的逾期单，看板失真。
	terminalPlan := []string{
		domain.WOPickedUp, domain.WOPickedUp, domain.WOPickedUp, domain.WOPickedUp, domain.WOCancelled,
	}
	// 昨天的在办单逐个铺满 6 个在制状态，保证状态机分支全覆盖且逾期样本是近期的。
	yesterdayPlan := []string{
		domain.WOReceived, domain.WODiagnosed, domain.WOAwaitingParts,
		domain.WORepairing, domain.WOQc, domain.WOSettled,
	}

	orders := []domain.WorkOrder{}
	lines := []domain.WorkOrderLine{}
	daySeq := map[string]int{}

	addOrder := func(at time.Time, status string) {
		day := at.Format("20060102")
		seq := daySeq[day]
		daySeq[day] = seq + 1
		woNo := fmt.Sprintf("WO-%s-%04d", day, seq+1)

		prio := seedPriority(rnd)
		opened := at
		promise := opened.Add(time.Duration(domain.PromiseHours(prio)) * time.Hour)
		if domain.IsOpen(status) {
			if len(orders)%4 == 3 {
				// 刻意掺几笔已过承诺交车时间的：逾期看板才有真样本。
				promise = now.Add(-time.Duration(45+rnd.Intn(200)) * time.Minute)
			} else if promise.Before(now) {
				// 昨天开的单按标准工时已到期：把承诺挪回在制窗口内，避免全列表逾期。
				promise = now.Add(time.Duration(30+rnd.Intn(540)) * time.Minute)
			}
		}
		wo := domain.WorkOrder{
			WoNo: woNo,
			PlateNo: fmt.Sprintf("%s·%c%04d", provinces[rnd.Intn(len(provinces))],
				'A'+rune(rnd.Intn(26)), rnd.Intn(9000)+1000),
			Model:         cars[rnd.Intn(len(cars))],
			CustomerName:  names[rnd.Intn(len(names))],
			CustomerPhone: fmt.Sprintf("138%08d", rnd.Intn(100000000)),
			MileageKm:     12000 + rnd.Intn(180000),
			Symptom:       symptoms[rnd.Intn(len(symptoms))],
			Status:        status, Priority: prio,
			Technician: advisors[rnd.Intn(len(advisors))],
			OpenedAt:   opened, UpdatedAt: opened,
			PromisedAt: promise,
		}
		orderIdx := int64(len(orders) + 1) // 表为空时自增 ID 从 1 起，末尾会实测校验
		lineAt := wo.OpenedAt.Add(20 * time.Minute)

		nOps := 1 + rnd.Intn(2)
		if status == domain.WOQc || status == domain.WOSettled || status == domain.WOPickedUp {
			nOps = 1 + rnd.Intn(3)
		}
		var orderLines []domain.WorkOrderLine
		push := func(l domain.WorkOrderLine) {
			l.WorkOrderID = orderIdx
			orderLines = append(orderLines, l)
			lines = append(lines, l)
		}
		// 刚接车的单只有登记信息：还没有工时、也没有动过库存。
		if status == domain.WOReceived {
			nOps = 0
		}
		for k := 0; k < nOps; k++ {
			op := ops[rnd.Intn(len(ops))]
			min := op.min + (rnd.Intn(9)-4)*5
			if min < 10 {
				min = 10
			}
			amount := domain.LaborAmount(min, op.grade)
			push(domain.WorkOrderLine{
				Kind: domain.LineLabor, Operation: op.name, Grade: op.grade, DurationMin: min,
				UnitCostCents: domain.LaborRates[op.grade], UnitPriceCents: domain.LaborRates[op.grade],
				AmountCents: amount, CreatedAt: lineAt,
			})
			for _, pc := range op.parts {
				if rnd.Intn(4) == 0 {
					continue
				}
				qty := 1 + rnd.Intn(2)
				if pc == "EN-STR-01" {
					qty = 4
				}
				cost, ok := issue(pc, qty, woNo, lineAt.Add(5*time.Minute))
				if !ok {
					continue
				}
				amt := domain.PriceLine(priceOf[pc], qty)
				push(domain.WorkOrderLine{
					Kind: domain.LinePart, PartCode: pc, Qty: qty, CostCents: cost,
					UnitCostCents: domain.UnitCost(cost, qty), UnitPriceCents: priceOf[pc],
					AmountCents: amt, Note: "按批次 FIFO 出库", CreatedAt: lineAt.Add(5 * time.Minute),
				})
			}
			lineAt = lineAt.Add(35 * time.Minute)
		}
		// 待料单：挂一行「零库存件」的未出库需求（金额 0，钱还没花、料还没出）。
		if status == domain.WOAwaitingParts {
			push(domain.WorkOrderLine{
				Kind: domain.LinePart, PartCode: "TR-CLT-01", Qty: 1,
				UnitPriceCents: priceOf["TR-CLT-01"], Note: "缺件挂起：已下采购单待到货",
				CreatedAt: lineAt,
			})
		}

		labor, partsSum, grand := domain.SumLineTotals(orderLines)
		switch status {
		case domain.WOSettled, domain.WOPickedUp:
			wo.LaborTotalCents, wo.PartsTotalCents, wo.GrandTotalCents = labor, partsSum, grand
			settled := wo.OpenedAt.Add(time.Duration(3+rnd.Intn(20)) * time.Hour)
			wo.SettledAt = &settled
			wo.UpdatedAt = settled
			if status == domain.WOPickedUp {
				closed := settled.Add(time.Duration(1+rnd.Intn(48)) * time.Hour)
				wo.ClosedAt = &closed
				wo.UpdatedAt = closed
			}
		case domain.WOCancelled:
			// 作废：已出库的料按原批次原量退回，退料流水与批次回补同步发生。
			var returns []domain.StockMove
			for _, mv := range moves {
				if mv.WoNo != woNo || mv.Kind != domain.MoveIssue {
					continue
				}
				for _, l := range lotsByPart[mv.PartCode] {
					if l.LotNo == mv.LotNo {
						l.QtyRemaining += -mv.QtyDelta
					}
				}
				returns = append(returns, domain.StockMove{
					PartCode: mv.PartCode, LotNo: mv.LotNo, Kind: domain.MoveReturn,
					QtyDelta: -mv.QtyDelta, UnitCostCents: mv.UnitCostCents, WoNo: woNo,
					Note: "工单作废退料", OccurredAt: wo.OpenedAt.Add(4 * time.Hour),
				})
			}
			moves = append(moves, returns...)
			wo.CancelReason = "客户改期，转合作厂维修"
			closed := wo.OpenedAt.Add(4 * time.Hour)
			wo.ClosedAt = &closed
			wo.UpdatedAt = closed
		}
		orders = append(orders, wo)
	}

	for d := 21; d >= 2; d-- {
		at := today.AddDate(0, 0, -d)
		n := 3 + rnd.Intn(5)
		for k := 0; k < n; k++ {
			addOrder(at.Add(time.Duration(9*60+rnd.Intn(9*60))*time.Minute), terminalPlan[rnd.Intn(len(terminalPlan))])
		}
	}
	for i, st := range yesterdayPlan {
		addOrder(today.AddDate(0, 0, -1).Add(time.Duration((10+i)*73)*time.Minute), st)
	}
	todayPlan := []string{
		domain.WOReceived, domain.WOReceived, domain.WODiagnosed, domain.WOAwaitingParts,
		domain.WORepairing, domain.WORepairing, domain.WOQc, domain.WOSettled,
	}
	for i, st := range todayPlan {
		addOrder(today.Add(time.Duration((7+i)*47)*time.Minute), st)
	}

	// 把内存批次终值写回 lots（按配件+批次号排序，保证每次种子产出同样的 ID 序列）。
	codes := make([]string, 0, len(lotsByPart))
	for code := range lotsByPart {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	var final []domain.StockLot
	for _, code := range codes {
		lst := lotsByPart[code]
		sort.Slice(lst, func(i, j int) bool { return lst[i].LotNo < lst[j].LotNo })
		for _, l := range lst {
			final = append(final, *l)
		}
	}
	lots = final

	db := r.db.WithContext(ctx)
	if err := db.CreateInBatches(parts, 50).Error; err != nil {
		return fmt.Errorf("灌配件失败: %w", err)
	}
	if err := db.CreateInBatches(lots, 50).Error; err != nil {
		return fmt.Errorf("灌批次失败: %w", err)
	}
	if err := db.CreateInBatches(orders, 50).Error; err != nil {
		return fmt.Errorf("灌工单失败: %w", err)
	}
	var maxID int64
	if err := db.Raw(`SELECT COALESCE(MAX(id),0) FROM work_orders`).Scan(&maxID).Error; err != nil {
		return err
	}
	if int(maxID) != len(orders) {
		return fmt.Errorf("工单自增 ID 与预分配的明细外键错位：max=%d len=%d", maxID, len(orders))
	}
	if err := db.CreateInBatches(lines, 100).Error; err != nil {
		return fmt.Errorf("灌明细失败: %w", err)
	}
	if err := db.CreateInBatches(moves, 100).Error; err != nil {
		return fmt.Errorf("灌流水失败: %w", err)
	}

	// ---- 4. 种子自检：坏数据宁可报错也不要留下 ----
	var covered int64
	if err := db.Raw(`SELECT COUNT(DISTINCT status) FROM work_orders`).Scan(&covered).Error; err != nil {
		return err
	}
	if covered < 8 {
		return fmt.Errorf("种子状态覆盖不足：只有 %d 态，应为 8 态", covered)
	}
	var mismatch int64
	if err := db.Raw(`SELECT COUNT(*) FROM (
		SELECT p.code, COALESCE(m.s,0) AS ms, COALESCE(l.s,0) AS ls
		FROM parts p
		LEFT JOIN (SELECT part_code, COALESCE(SUM(qty_delta),0) s FROM stock_moves GROUP BY part_code) m ON m.part_code = p.code
		LEFT JOIN (SELECT part_code, COALESCE(SUM(qty_remaining),0) s FROM stock_lots GROUP BY part_code) l ON l.part_code = p.code
		WHERE COALESCE(m.s,0) <> COALESCE(l.s,0))`).Scan(&mismatch).Error; err != nil {
		return err
	}
	if mismatch != 0 {
		return fmt.Errorf("种子账实不符：%d 个配件的流水与批次余量对不上", mismatch)
	}
	var badNegative int64
	if err := db.Raw(`SELECT COUNT(*) FROM stock_lots WHERE qty_remaining < 0 OR qty_remaining > qty_received`).Scan(&badNegative).Error; err != nil {
		return err
	}
	if badNegative != 0 {
		return fmt.Errorf("种子批次余量越界：%d 行", badNegative)
	}
	var zeroStock int64
	if err := db.Raw(`SELECT COUNT(*) FROM (
		SELECT p.code, COALESCE(SUM(l.qty_remaining),0) AS on_hand FROM parts p
		LEFT JOIN stock_lots l ON l.part_code = p.code GROUP BY p.code
		HAVING COALESCE(SUM(l.qty_remaining),0) <= 0)`).Scan(&zeroStock).Error; err != nil {
		return err
	}
	if zeroStock == 0 {
		return fmt.Errorf("种子没有零库存件，缺件 409 分支无样本")
	}
	// 逾期样本要「有、但不泛滥」：在制单一律逾期会让看板失去信号，也是本仓踩过的数据形状坑。
	var openCnt, lateCnt int64
	if err := db.Raw(`SELECT COUNT(*) FROM work_orders WHERE status IN ('received','diagnosed','awaiting_parts','repairing','qc','settled')`).Scan(&openCnt).Error; err != nil {
		return err
	}
	if err := db.Raw(`SELECT COUNT(*) FROM work_orders WHERE status IN ('received','diagnosed','awaiting_parts','repairing','qc','settled') AND promised_at < ?`, now).Scan(&lateCnt).Error; err != nil {
		return err
	}
	if lateCnt == 0 || lateCnt*2 > openCnt {
		return fmt.Errorf("种子逾期样本不合理：在制 %d 单，已过承诺 %d 单", openCnt, lateCnt)
	}
	return nil
}

// seedPriority：70% 普通、20% 加急、10% 保客回厂。
func seedPriority(rnd *rand.Rand) string {
	switch r := rnd.Intn(10); {
	case r < 7:
		return domain.PriorityNormal
	case r < 9:
		return domain.PriorityUrgent
	default:
		return domain.PriorityReturn
	}
}
