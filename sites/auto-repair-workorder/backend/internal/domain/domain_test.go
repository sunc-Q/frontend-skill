package domain

import (
	"strings"
	"testing"
	"time"
)

func tlot(lotNo string, qty, cost int, at time.Time) StockLot {
	return StockLot{LotNo: lotNo, QtyReceived: qty, QtyRemaining: qty, UnitCostCents: int64(cost), ReceivedAt: at}
}

func TestLaborAmountIsTheOnlyRateAlgorithm(t *testing.T) {
	cases := []struct {
		name   string
		min    int
		grade  string
		want   int64
		reason string
	}{
		{"整小时", 60, GradeJunior, 18000, "1 小时 × ¥180"},
		{"半小时", 30, GradeMaster, 19000, "38000/2 恰为整数"},
		{"四舍五入到分", 7, GradeMiddle, 3033, "7×26000/60=3033.33→3033"},
		{"向上进位", 25, GradeMiddle, 10833, "25×26000/60=10833.33→10833"},
		{"四舍三五入", 45, GradeJunior, 13500, "45×18000/60=13500"},
		{"半点进位", 1, GradeMaster, 633, "38000/60=633.33→633"},
		{"半分入位", 4, GradeJunior, 1200, "18000×4/60=1200"},
		{"零工时", 0, GradeJunior, 0, "非正工时不计费"},
		{"负工时", -30, GradeJunior, 0, "负数按 0"},
		{"未知等级", 60, "intern", 0, "等级不在费率表内按 0"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := LaborAmount(c.min, c.grade); got != c.want {
				t.Fatalf("LaborAmount(%d,%q)=%d 期望 %d（%s）", c.min, c.grade, got, c.want, c.reason)
			}
		})
	}
}

func TestPlanIssueFIFO(t *testing.T) {
	base := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	cases := []struct {
		name        string
		lots        []StockLot
		qty         int
		wantSteps   []IssueLot
		wantCost    int64
		wantMissing int
	}{
		{
			name: "单批次够量",
			lots: []StockLot{tlot("L-0901", 10, 5000, base)},
			qty:  3, wantSteps: []IssueLot{{"L-0901", 3, 5000}}, wantCost: 15000,
		},
		{
			name: "跨批次按入库先后",
			lots: []StockLot{
				tlot("L-0910", 4, 5200, base.AddDate(0, 0, 9)),
				tlot("L-0901", 3, 5000, base),
			},
			qty: 5, wantSteps: []IssueLot{{"L-0901", 3, 5000}, {"L-0910", 2, 5200}}, wantCost: 25400,
		},
		{
			name: "同日按批次号兜底",
			lots: []StockLot{
				tlot("L-B", 2, 100, base),
				tlot("L-A", 2, 90, base),
			},
			qty: 3, wantSteps: []IssueLot{{"L-A", 2, 90}, {"L-B", 1, 100}}, wantCost: 280,
		},
		{
			name: "跳过已耗尽批次",
			lots: []StockLot{
				{LotNo: "L-EMPTY", QtyReceived: 5, QtyRemaining: 0, UnitCostCents: 10, ReceivedAt: base},
				tlot("L-FULL", 4, 20, base.AddDate(0, 0, 1)),
			},
			qty: 4, wantSteps: []IssueLot{{"L-FULL", 4, 20}}, wantCost: 80,
		},
		{
			name:      "件数不足报缺失量",
			lots:      []StockLot{tlot("L-0901", 2, 5000, base)},
			qty:       5,
			wantSteps: []IssueLot{{"L-0901", 2, 5000}}, wantCost: 10000, wantMissing: 3,
		},
		{
			name:     "零库存件全部缺失",
			lots:     nil,
			qty:      1,
			wantCost: 0, wantMissing: 1,
		},
		{
			name:        "非正数量视为无效请求",
			lots:        []StockLot{tlot("L-0901", 2, 5000, base)},
			qty:         0,
			wantMissing: 0,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			steps, cost, missing := PlanIssue(c.lots, c.qty)
			if len(steps) != len(c.wantSteps) {
				t.Fatalf("出库步骤数 %d 期望 %d（%+v）", len(steps), len(c.wantSteps), steps)
			}
			for i, s := range steps {
				if s != c.wantSteps[i] {
					t.Fatalf("第 %d 步 %+v 期望 %+v", i, s, c.wantSteps[i])
				}
			}
			if cost != c.wantCost {
				t.Fatalf("成本 %d 期望 %d", cost, c.wantCost)
			}
			if missing != c.wantMissing {
				t.Fatalf("缺失 %d 期望 %d", missing, c.wantMissing)
			}
		})
	}
}

func TestPlanIssueDoesNotMutateInput(t *testing.T) {
	base := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	lots := []StockLot{tlot("L-A", 2, 100, base), tlot("L-B", 2, 110, base.AddDate(0, 0, 1))}
	before := append([]StockLot(nil), lots...)
	if _, _, _ = PlanIssue(lots, 3); len(lots) != len(before) {
		t.Fatal("入参长度被改动")
	}
	for i := range lots {
		if lots[i] != before[i] {
			t.Fatalf("入参第 %d 行被改动：%+v vs %+v", i, lots[i], before[i])
		}
	}
}

func TestTransitionMatrix(t *testing.T) {
	all := []string{WOReceived, WODiagnosed, WOAwaitingParts, WORepairing, WOQc, WOSettled, WOPickedUp, WOCancelled}
	legal := map[string][]string{
		WOReceived:      {WODiagnosed, WOCancelled},
		WODiagnosed:     {WOAwaitingParts, WORepairing, WOQc, WOCancelled},
		WOAwaitingParts: {WORepairing, WOCancelled},
		WORepairing:     {WOQc, WOCancelled},
		WOQc:            {WOSettled},
		WOSettled:       {WOPickedUp},
		WOPickedUp:      nil,
		WOCancelled:     nil,
	}
	for _, from := range all {
		ok := map[string]bool{}
		for _, to := range legal[from] {
			ok[to] = true
		}
		for _, to := range all {
			if got := CanTransition(from, to); got != ok[to] {
				t.Errorf("%s→%s = %v，期望 %v", from, to, got, ok[to])
			}
		}
		if !ValidStatus(from) {
			t.Errorf("%s 未登记为合法状态", from)
		}
		if next := NextStatuses(from); len(next) != len(legal[from]) {
			t.Errorf("%s 的可选目标 %v 与表 %v 不符", from, next, legal[from])
		}
	}
	for _, bad := range []string{"", "settled ", "picked-up", "DROP"} {
		if ValidStatus(bad) {
			t.Errorf("非法状态 %q 被判为合法", bad)
		}
		if len(NextStatuses(bad)) != 0 {
			t.Errorf("非法状态 %q 竟有可选目标", bad)
		}
	}
}

func TestOpenLinesEditableAndStockReturnAgree(t *testing.T) {
	cases := []struct {
		status    string
		isOpen    bool
		editable  bool
		wantBack  bool
		promise   int
		overdueAt time.Time
	}{
		{WOReceived, true, true, true, 30, time.Time{}},
		{WODiagnosed, true, true, true, 6, time.Time{}},
		{WOAwaitingParts, true, true, true, 12, time.Time{}},
		{WORepairing, true, true, true, 30, time.Time{}},
		{WOQc, true, false, false, 30, time.Time{}},
		{WOSettled, true, false, false, 30, time.Time{}},
		{WOPickedUp, false, false, false, 30, time.Time{}},
		{WOCancelled, false, false, false, 30, time.Time{}},
	}
	for _, c := range cases {
		t.Run(c.status, func(t *testing.T) {
			if got := IsOpen(c.status); got != c.isOpen {
				t.Errorf("IsOpen=%v 期望 %v", got, c.isOpen)
			}
			if got := LinesEditable(c.status); got != c.editable {
				t.Errorf("LinesEditable=%v 期望 %v（质检之后账目必须锁定）", got, c.editable)
			}
			if got := ReturnStock(c.status); got != c.wantBack {
				t.Errorf("ReturnStock=%v 期望 %v", got, c.wantBack)
			}
			// 已离场的单不再计入逾期，否则看板会被历史单淹没。
			now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
			past := now.Add(-time.Hour)
			future := now.Add(time.Hour)
			if got := PromiseOverdue(c.status, past, now); got != c.isOpen {
				t.Errorf("过期承诺的 overdue=%v，期望与在厂态一致 %v", got, c.isOpen)
			}
			if PromiseOverdue(c.status, future, now) {
				t.Errorf("未到期承诺被判逾期")
			}
		})
	}
	if PromiseHours(PriorityUrgent) != 6 || PromiseHours(PriorityReturn) != 12 || PromiseHours(PriorityNormal) != 30 {
		t.Error("承诺交车时长表被改动")
	}
	if PromiseHours("随便写的") != 30 {
		t.Error("未知优先级应回落普通 30 小时")
	}
}

func TestSumLineTotalsAndCheckIdentity(t *testing.T) {
	lines := []WorkOrderLine{
		{Kind: LineLabor, AmountCents: LaborAmount(90, GradeMiddle)},
		{Kind: LinePart, AmountCents: PriceLine(12000, 2)},
		{Kind: LineLabor, AmountCents: LaborAmount(30, GradeJunior)},
		{Kind: LinePart, AmountCents: PriceLine(990, 4)},
		{Kind: "unknown", AmountCents: 999999},
	}
	labor, parts, grand := SumLineTotals(lines)
	if want := int64(39000 + 9000); labor != want {
		t.Fatalf("工时合计 %d 期望 %d", labor, want)
	}
	if want := int64(24000 + 3960); parts != want {
		t.Fatalf("配件合计 %d 期望 %d", parts, want)
	}
	if grand != labor+parts {
		t.Fatalf("总额 %d != 工时 %d + 配件 %d", grand, labor, parts)
	}
	if grand != 75960 {
		t.Fatalf("期望总额 75960，实得 %d（未知 kind 不应计入）", grand)
	}

	rows := []OrderAmount{
		{WoNo: "WO-OK", Kind: "order", GrandTotalCents: grand, LaborTotalCents: labor, PartsTotalCents: parts, LineSumCents: grand},
		{WoNo: "WO-PART", Kind: "part_line", GrandTotalCents: PriceLine(12000, 2), ListPriceCents: 12000, Qty: 2},
	}
	if issues := CheckIdentity(rows); len(issues) != 0 {
		t.Fatalf("合规账被判违规：%v", issues)
	}

	bad := []OrderAmount{
		{WoNo: "WO-SNAP", Kind: "order", GrandTotalCents: grand + 1, LaborTotalCents: labor, PartsTotalCents: parts, LineSumCents: grand},
		{WoNo: "WO-DRIFT", Kind: "order", GrandTotalCents: grand, LaborTotalCents: labor, PartsTotalCents: parts, LineSumCents: grand - 10},
		{WoNo: "WO-PRICE", Kind: "part_line", GrandTotalCents: PriceLine(12000, 2) + 100, ListPriceCents: 12000, Qty: 2},
		{WoNo: "WO-NOISE", Kind: "whatever", GrandTotalCents: 1},
	}
	issues := CheckIdentity(bad)
	if len(issues) != 4 {
		t.Fatalf("应报 4 条恒等式违例，实得 %d：%v", len(issues), issues)
	}
	for _, want := range []string{"总额 != 工时 + 配件", "总额 != Σ明细行金额", "行金额 != 数量 × 挂牌价"} {
		found := false
		for _, is := range issues {
			if strings.Contains(is, want) {
				found = true
			}
		}
		if !found {
			t.Errorf("缺少违例说明 %q（全部：%v）", want, issues)
		}
	}
}

func TestPriceLineUnitCostAndMask(t *testing.T) {
	if PriceLine(12000, 0) != 0 || PriceLine(12000, -3) != 0 {
		t.Error("非正数量的行金额必须为 0")
	}
	if PriceLine(12000, 3) != 36000 {
		t.Error("行金额应为数量×挂牌价")
	}
	if UnitCost(25400, 5) != 5080 {
		t.Errorf("UnitCost 整除失败：%d", UnitCost(25400, 5))
	}
	if UnitCost(100, 3) != 33 || UnitCost(200, 3) != 67 {
		t.Errorf("UnitCost 四舍五入不对：%d / %d", UnitCost(100, 3), UnitCost(200, 3))
	}
	if UnitCost(100, 0) != 0 {
		t.Error("零数量不得除出成本")
	}
	if got := Mask("13800004514"); got != "138****4514" {
		t.Errorf("脱敏结果 %q", got)
	}
	for _, bad := range []string{"", "138", "1380000451a", "138000045140", "23800004514", "' OR 1=1--"} {
		if got := Mask(bad); got != "（号码无效）" {
			t.Errorf("Mask(%q)=%q，无效号码必须走固定文案", bad, got)
		}
	}
}

func TestInputValidationMatrix(t *testing.T) {
	long65 := strings.Repeat("啊", 65)
	okOrder := CreateOrderInput{
		PlateNo: "沪A·B1234", Model: "大众迈腾 2.0T", CustomerName: "赵一鸣",
		Phone: "13800004514", MileageKm: 68000, Symptom: "冷车启动异响", Priority: PriorityNormal,
		Technician: "沈立群",
	}
	if errs, ok := okOrder.Validate(); !ok {
		t.Fatalf("合规输入被拒：%v", errs)
	}
	cases := []struct {
		name    string
		mutate  func(*CreateOrderInput)
		wantKey string
	}{
		{"空车牌", func(in *CreateOrderInput) { in.PlateNo = "" }, "plate_no"},
		{"注入车牌", func(in *CreateOrderInput) { in.PlateNo = "沪A'; DROP TABLE work_orders;--" }, "plate_no"},
		{"超长车牌", func(in *CreateOrderInput) { in.PlateNo = "沪A" + strings.Repeat("B", 20) }, "plate_no"},
		{"空车型", func(in *CreateOrderInput) { in.Model = "   " }, "model"},
		{"超长车型", func(in *CreateOrderInput) { in.Model = strings.Repeat("车", 49) }, "model"},
		{"空姓名", func(in *CreateOrderInput) { in.CustomerName = "" }, "customer_name"},
		{"手机号少一位", func(in *CreateOrderInput) { in.Phone = "1380000451" }, "phone"},
		{"手机号非数字", func(in *CreateOrderInput) { in.Phone = "1380000451a" }, "phone"},
		{"负里程", func(in *CreateOrderInput) { in.MileageKm = -1 }, "mileage_km"},
		{"里程越界", func(in *CreateOrderInput) { in.MileageKm = 1_000_001 }, "mileage_km"},
		{"空故障描述", func(in *CreateOrderInput) { in.Symptom = "" }, "symptom"},
		{"超长故障描述", func(in *CreateOrderInput) { in.Symptom = long65 + strings.Repeat("抖", 200) }, "symptom"},
		{"未知优先级", func(in *CreateOrderInput) { in.Priority = "asap" }, "priority"},
		{"空顾问", func(in *CreateOrderInput) { in.Technician = "" }, "technician"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := okOrder
			c.mutate(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatalf("非法输入被放行：%+v", in)
			}
			if _, has := errs[c.wantKey]; !has {
				t.Errorf("错误字段应含 %s，实得 %v", c.wantKey, keysOf(errs))
			}
			for _, v := range errs {
				if v == "" {
					t.Error("校验错误必须有文案")
				}
			}
		})
	}
	// 优先级留空按普通处理，不能算错。
	in := okOrder
	in.Priority = ""
	if errs, ok := in.Validate(); !ok || len(errs) != 0 {
		t.Errorf("留空优先级应回落 normal，实得 %v", errs)
	}
}

func TestLineAndReceiptValidationMatrix(t *testing.T) {
	okLabor := AddLineInput{Kind: LineLabor, Operation: "更换机滤", Grade: GradeMiddle, DurationMin: 45}
	if errs, ok := okLabor.Validate(); !ok {
		t.Fatalf("合规工时行被拒：%v", errs)
	}
	okPart := AddLineInput{Kind: LinePart, PartCode: "EN-STR-01", Qty: 4}
	if errs, ok := okPart.Validate(); !ok {
		t.Fatalf("合规配件行被拒：%v", errs)
	}
	lineCases := []struct {
		name    string
		in      AddLineInput
		mutate  func(*AddLineInput)
		wantKey string
	}{
		{"未知行类型", okLabor, func(in *AddLineInput) { in.Kind = "misc" }, "kind"},
		{"工时行缺项目", okLabor, func(in *AddLineInput) { in.Operation = "" }, "operation"},
		{"工时行超长项目", okLabor, func(in *AddLineInput) { in.Operation = strings.Repeat("打", 65) }, "operation"},
		{"工时行未知等级", okLabor, func(in *AddLineInput) { in.Grade = "senior" }, "grade"},
		{"工时行零分钟", okLabor, func(in *AddLineInput) { in.DurationMin = 0 }, "duration_min"},
		{"工时行超一天", okLabor, func(in *AddLineInput) { in.DurationMin = 1441 }, "duration_min"},
		{"配件行注入编码", okPart, func(in *AddLineInput) { in.PartCode = "EN-1' OR '1'='1" }, "part_code"},
		{"配件行空编码", okPart, func(in *AddLineInput) { in.PartCode = "" }, "part_code"},
		{"配件行超长编码", okPart, func(in *AddLineInput) { in.PartCode = strings.Repeat("A", 17) }, "part_code"},
		{"配件行零数量", okPart, func(in *AddLineInput) { in.Qty = 0 }, "qty"},
		{"配件行超量", okPart, func(in *AddLineInput) { in.Qty = 1000 }, "qty"},
		{"备注超长", okPart, func(in *AddLineInput) { in.Note = strings.Repeat("注", 65) }, "note"},
	}
	for _, c := range lineCases {
		t.Run(c.name, func(t *testing.T) {
			in := c.in
			c.mutate(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatalf("非法行被放行：%+v", in)
			}
			if _, has := errs[c.wantKey]; !has {
				t.Errorf("应报 %s，实得 %v", c.wantKey, keysOf(errs))
			}
		})
	}

	okReceipt := ReceiptInput{PartCode: "EN-STR-01", LotNo: "LOT-20260926-01", Qty: 12,
		UnitCostCents: 4500, Supplier: "华东配件中心", ExpiresOn: "2028-01-01"}
	if errs, ok := okReceipt.Validate(); !ok {
		t.Fatalf("合规入库被拒：%v", errs)
	}
	recCases := []struct {
		name    string
		mutate  func(*ReceiptInput)
		wantKey string
	}{
		{"注入批次号", func(in *ReceiptInput) { in.LotNo = "LOT-01;delete" }, "lot_no"},
		{"超长批次号", func(in *ReceiptInput) { in.LotNo = strings.Repeat("L", 21) }, "lot_no"},
		{"零数量", func(in *ReceiptInput) { in.Qty = 0 }, "qty"},
		{"天文数量", func(in *ReceiptInput) { in.Qty = 100_001 }, "qty"},
		{"免费入库", func(in *ReceiptInput) { in.UnitCostCents = 0 }, "unit_cost_cents"},
		{"负成本", func(in *ReceiptInput) { in.UnitCostCents = -1 }, "unit_cost_cents"},
		{"成本越界", func(in *ReceiptInput) { in.UnitCostCents = 50_000_001 }, "unit_cost_cents"},
		{"空供应商", func(in *ReceiptInput) { in.Supplier = "" }, "supplier"},
		{"有效期格式错", func(in *ReceiptInput) { in.ExpiresOn = "2028/01/01" }, "expires_on"},
		{"配件编码非法", func(in *ReceiptInput) { in.PartCode = "配件 01" }, "part_code"},
	}
	for _, c := range recCases {
		t.Run(c.name, func(t *testing.T) {
			in := okReceipt
			c.mutate(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatalf("非法入库被放行：%+v", in)
			}
			if _, has := errs[c.wantKey]; !has {
				t.Errorf("应报 %s，实得 %v", c.wantKey, keysOf(errs))
			}
		})
	}
	// 有效期留空是允许的（结构件不记保质期）。
	in := okReceipt
	in.ExpiresOn = ""
	if errs, ok := in.Validate(); !ok {
		t.Errorf("留空有效期应通过：%v", errs)
	}
}

func TestSafeTextBlocksMarkupAndControlChars(t *testing.T) {
	for _, ok := range []string{"更换机油机滤", "沪A·12345 车主", "Bosch 博世", "怠速抖动，冷车明显", "a"} {
		if !SafeText(ok, 64) {
			t.Errorf("正常文本 %q 被拒", ok)
		}
	}
	for _, bad := range []string{
		"", "   ", "\t\n", strings.Repeat("异", 65),
		"<script>alert(1)</script>", "张三'; DROP TABLE work_orders;--",
		`配件"报价`, "back`tick", "a&b", "半\\反斜杠", "含\x00控制字符", "结尾\x7f",
	} {
		if SafeText(bad, 64) {
			t.Errorf("注入/畸形文本 %q 被放行", bad)
		}
	}
	// 边界：正好限长必须放行。
	if !SafeText(strings.Repeat("沪", 32), 32) {
		t.Error("正好 32 字被误拒")
	}
}

func TestCodeAndPlateWhitelists(t *testing.T) {
	for _, ok := range []string{"EN-STR-01", "a", "A_B-c9", "1234567890123456"} {
		if !SafeCodeRe(ok, 16) {
			t.Errorf("合法编码 %q 被拒", ok)
		}
	}
	for _, bad := range []string{"", " ", "EN STR", "EN'STR", "配件-01", "EN-STR-0123456789X", "EN-STR\n01", "EN-STR;01", "EN-STR\x0001"} {
		if SafeCodeRe(bad, 16) {
			t.Errorf("编码 %q 被放行", bad)
		}
	}
	for _, ok := range []string{"沪A·B1234", "京N12345", "苏A.D8888", "abc123"} {
		if !PlateOK(ok) {
			t.Errorf("车牌 %q 被拒", ok)
		}
	}
	for _, bad := range []string{"", "   ", "沪A B1234", "沪A-B1234", "沪A;drop", strings.Repeat("沪", 13), "沪A·B12345678901"} {
		if PlateOK(bad) {
			t.Errorf("车牌 %q 被放行", bad)
		}
	}
	for _, ok := range []string{"13800004514", "19912345678"} {
		if !PhoneRe(ok) {
			t.Errorf("手机号 %q 被拒", ok)
		}
	}
	for _, bad := range []string{"", "1380000451", "138000045141", "+8613800004", "138000045l4"} {
		if PhoneRe(bad) {
			t.Errorf("手机号 %q 被放行", bad)
		}
	}
	for _, c := range []string{CatEngine, CatBrake, CatFilter, CatElectrical, CatSuspension, CatConsumable, CatTransmission} {
		if !ValidCategory(c) {
			t.Errorf("类别 %q 未登记", c)
		}
	}
	if ValidCategory("body") {
		t.Error("未知类别被判合法")
	}
	if !CatRules[CatConsumable].Fragile || CatRules[CatConsumable].ShelfLifeDays == 0 {
		t.Error("耗材必须记保质期")
	}
	if CatRules[CatEngine].Fragile {
		t.Error("结构件不应记保质期")
	}
}

func keysOf(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
