package repository

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"autoshop/internal/domain"
)

// seedAt 用真实 UTC 时钟：/api/stats 里的「是否逾期」按 time.Now() 判定，
// 种子若挂在一个未来时刻，逾期样本对 Stats 来说就全成了「还没到期」。
var seedAt = time.Now().UTC().Truncate(time.Minute)

func woPrefix() string { return "WO-" + seedAt.Format("20060102") + "-" }

// newSeeded 开一个临时库并灌种子。Seed 自带断言，跑测试同时也复验一遍种子自检。
func newSeeded(t *testing.T) (*Repo, context.Context) {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), seedAt); err != nil {
		t.Fatalf("灌种子失败: %v", err)
	}
	return r, context.Background()
}

func mustNewOrder(t *testing.T, r *Repo, plate, symptom string) *domain.WorkOrder {
	t.Helper()
	wo, err := r.CreateOrder(context.Background(), domain.CreateOrderInput{
		PlateNo: plate, Model: "测试车 1.5T", CustomerName: "测试客", Phone: "13800001111",
		Symptom: symptom, Priority: domain.PriorityNormal, Technician: "顾问甲",
	}, seedAt)
	if err != nil {
		t.Fatalf("建单失败: %v", err)
	}
	return wo
}

func onHandOf(t *testing.T, r *Repo, code string) int {
	t.Helper()
	row, err := r.PartRowByCode(context.Background(), code)
	if err != nil {
		t.Fatalf("读配件 %s 失败: %v", code, err)
	}
	return row.OnHand
}

func appErr(t *testing.T, err error) *domain.AppError {
	t.Helper()
	if err == nil {
		t.Fatal("期望返回错误，实得 nil")
	}
	var ae *domain.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("期望 AppError，实得 %T %v", err, err)
	}
	return ae
}

func mustCode(t *testing.T, err error, want string) {
	t.Helper()
	if ae := appErr(t, err); ae.Code != want {
		t.Fatalf("错误码 %s（%s），期望 %s", ae.Code, ae.Message, want)
	}
}

func orderQuery(values url.Values) domain.ListQuery {
	return domain.ParseOrderQuery(values)
}

func partQuery(values url.Values) domain.ListQuery {
	return domain.ParsePartQuery(values)
}

// ---------- 种子与对外口径 ----------

func TestSeedKeepsEveryPublishedInvariantGreen(t *testing.T) {
	r, ctx := newSeeded(t)
	s, err := r.Stats(ctx, 30)
	if err != nil {
		t.Fatalf("统计失败: %v", err)
	}
	if !s.StockInvariantOK || len(s.StockIssues) != 0 {
		t.Errorf("账实相符不变量被破坏：%+v", s.StockIssues)
	}
	if !s.AmountInvariantOK || s.IdentityViolations != 0 {
		t.Errorf("金额恒等式被破坏：%v", s.IdentityIssues)
	}
	if s.LotOverflow != 0 {
		t.Errorf("批次余量越界 %d 行", s.LotOverflow)
	}
	var settled int64
	if err := r.db.Raw(`SELECT COUNT(*) FROM work_orders WHERE status IN ('settled','picked_up')`).Scan(&settled).Error; err != nil {
		t.Fatalf("复核结算单数失败: %v", err)
	}
	if s.TotalOrders < 100 || int64(s.CheckedOrders) != settled {
		t.Errorf("种子体量异常：orders=%d checked=%d settled=%d", s.TotalOrders, s.CheckedOrders, settled)
	}
	if s.OpenOrders < 8 {
		t.Errorf("在制单太少：%d", s.OpenOrders)
	}
	// 逾期样本要「有、但不泛滥」，否则看板要么没信号要么全红。
	if s.PromiseLate == 0 || s.PromiseLate*2 > s.OpenOrders {
		t.Errorf("逾期样本不合理：在制 %d，逾期 %d", s.OpenOrders, s.PromiseLate)
	}
	if s.AwaitingParts == 0 || s.LowStockParts == 0 {
		t.Errorf("缺件/低库存样本缺失：awaiting=%d low=%d", s.AwaitingParts, s.LowStockParts)
	}
	if s.RevenueCents <= 0 || s.GrossMarginCents <= 0 || s.GrossMarginCents >= s.RevenueCents {
		t.Errorf("毛利口径异常：revenue=%d margin=%d", s.RevenueCents, s.GrossMarginCents)
	}
	if s.LaborCents+s.PartsCents != s.RevenueCents {
		t.Errorf("成交额分解 %d+%d != %d", s.LaborCents, s.PartsCents, s.RevenueCents)
	}
	if len(s.ByStatus) != 8 {
		t.Errorf("状态分桶 %d 个，期望 8 态全覆盖", len(s.ByStatus))
	}
	if len(s.Trend) != 30 {
		t.Errorf("趋势点数 %d，期望 30（稀疏日必须补 0）", len(s.Trend))
	}
	var emptyDays, busyDays int
	for _, p := range s.Trend {
		if p.Opened == 0 && p.Settled == 0 && p.IssuedQty == 0 {
			emptyDays++
		} else {
			busyDays++
		}
	}
	if emptyDays == 0 || busyDays == 0 {
		t.Errorf("趋势稠密化没生效：空日 %d、有单日 %d", emptyDays, busyDays)
	}
	// 类别合计册数必须等于总在库册数：第 9 轮就是被 JOIN 放大坑过（237 vs 40）。
	var catSum, catValue int64
	for _, b := range s.ByCategory {
		catSum += int64(b.OnHand)
		catValue += b.ValueCents
	}
	if len(s.ByCategory) != len(domain.CatRules) {
		t.Errorf("类别分桶 %d 个，期望 %d 类", len(s.ByCategory), len(domain.CatRules))
	}
	if catSum != int64(s.OnHandUnits) {
		t.Errorf("类别合计 %d != 总在库 %d", catSum, s.OnHandUnits)
	}
	if catValue != s.StockValueCents {
		t.Errorf("类别库存值合计 %d != %d", catValue, s.StockValueCents)
	}
	if len(s.TopParts) == 0 || s.TopParts[0].Qty <= 0 {
		t.Errorf("热门配件榜为空或数量异常：%+v", s.TopParts)
	}
}

func TestListRowsOnlyExposeMaskedPhones(t *testing.T) {
	r, ctx := newSeeded(t)
	rows, total, err := r.ListOrders(ctx, orderQuery(url.Values{"page_size": {"100"}, "sort": {"id"}}))
	if err != nil {
		t.Fatalf("列表失败: %v", err)
	}
	if total == 0 || len(rows) == 0 {
		t.Fatal("列表为空")
	}
	for _, row := range rows {
		if len([]rune(row.PhoneMasked)) != 11 || !strings.Contains(row.PhoneMasked, "****") {
			t.Fatalf("脱敏形态异常：%q（单号 %s）", row.PhoneMasked, row.WoNo)
		}
		if row.NextStatuses != nil {
			t.Error("NextStatuses 由 service 填充，仓储层不应有值")
		}
	}
	head, err := r.OrderHead(ctx, rows[0].WoNo)
	if err != nil {
		t.Fatalf("详情失败: %v", err)
	}
	if head.PhoneMasked != rows[0].PhoneMasked {
		t.Errorf("列表与详情脱敏值不一致：%q vs %q", rows[0].PhoneMasked, head.PhoneMasked)
	}
}

// ---------- FIFO 出库 ----------

func TestIssuePartFollowsFIFOAndBlocksShortage(t *testing.T) {
	r, ctx := newSeeded(t)
	wo := mustNewOrder(t, r, "沪A·B1234", "FIFO 用例")
	if !strings.HasPrefix(wo.WoNo, woPrefix()) {
		t.Errorf("工单号未按当日序列生成：%q", wo.WoNo)
	}
	if wo.Status != domain.WOReceived {
		t.Errorf("新单应为 received，实得 %s", wo.Status)
	}
	if !wo.PromisedAt.Equal(wo.OpenedAt.Add(30 * time.Hour)) {
		t.Errorf("普通单承诺应为 30 小时后：%v / %v", wo.OpenedAt, wo.PromisedAt)
	}

	code, lots := pickMultiLotPart(t, r)
	steps, wantCost, missing := domain.PlanIssue(lots, 3)
	if missing != 0 {
		t.Fatalf("计划缺件 %d", missing)
	}
	before := 0
	for _, l := range lots {
		before += l.QtyRemaining
	}
	line, got, err := r.IssuePart(ctx, wo.ID, code, 3, "跨批次出库", seedAt.Add(time.Hour))
	if err != nil {
		t.Fatalf("出库失败: %v", err)
	}
	if len(got) != len(steps) {
		t.Fatalf("出库步骤 %d 与计划 %d 不符", len(got), len(steps))
	}
	for i := range steps {
		if got[i].LotNo != steps[i].LotNo || got[i].Qty != steps[i].Qty || got[i].UnitCostCents != steps[i].UnitCostCents {
			t.Errorf("第 %d 步 %+v 期望 %+v", i, got[i], steps[i])
		}
	}
	if line.CostCents != wantCost {
		t.Errorf("行成本 %d != FIFO 计划 %d", line.CostCents, wantCost)
	}
	if line.AmountCents != domain.PriceLine(line.UnitPriceCents, 3) {
		t.Errorf("行金额 %d != 3 × 挂牌价 %d", line.AmountCents, line.UnitPriceCents)
	}
	if line.UnitCostCents != domain.UnitCost(wantCost, 3) {
		t.Errorf("单件成本 %d != %d", line.UnitCostCents, domain.UnitCost(wantCost, 3))
	}
	if after := onHandOf(t, r, code); after != before-3 {
		t.Errorf("余量 %d != 出库前 %d − 3", after, before)
	}
	moves, err := r.MovesOfOrder(ctx, wo.WoNo, 50)
	if err != nil {
		t.Fatalf("读流水失败: %v", err)
	}
	var issued int
	for _, mv := range moves {
		if mv.Kind == domain.MoveIssue && mv.PartCode == code {
			issued += -mv.QtyDelta
		}
	}
	if issued != 3 {
		t.Errorf("出库流水合计 %d，期望 3", issued)
	}
	// 逐批扣减必须留在原批次上，且每批不得为负。
	final, _ := r.LotsOfPart(ctx, code)
	for _, l := range final {
		if l.QtyRemaining < 0 || l.QtyRemaining > l.QtyReceived {
			t.Errorf("批次 %s 余量越界：%d/%d", l.LotNo, l.QtyRemaining, l.QtyReceived)
		}
	}

	after := onHandOf(t, r, code)
	mustCode(t, issueErr(r, wo.ID, code, after+1), "insufficient_stock")
	if got := onHandOf(t, r, code); got != after {
		t.Errorf("失败出库改动了余量：%d → %d", after, got)
	}
	mustCode(t, issueErr(r, wo.ID, "TR-CLT-01", 1), "insufficient_stock")
	mustCode(t, issueErr(r, wo.ID, "TR-OLD-04", 1), "part_discontinued")
	mustCode(t, issueErr(r, wo.ID, "NO-SUCH-PART", 1), "not_found")
	for _, bad := range []struct {
		code string
		qty  int
	}{
		{"EN-STR-01", 0}, {"EN-STR-01", -2}, {"EN-STR-01", 1000},
		{"EN-STR-01' OR 1=1--", 1}, {"", 1}, {strings.Repeat("A", 40), 1}, {"配件 01", 1},
	} {
		if _, _, err := r.IssuePart(ctx, wo.ID, bad.code, bad.qty, "边界", seedAt); err == nil {
			t.Errorf("非法出库参数被放行：code=%q qty=%d", bad.code, bad.qty)
		}
	}
	mustCode(t, issueErr(r, 999999, "EN-STR-01", 1), "not_found")
}

func issueErr(r *Repo, orderID int64, code string, qty int) error {
	_, _, err := r.IssuePart(context.Background(), orderID, code, qty, "边界", seedAt)
	return err
}

// pickMultiLotPart 找一个「有余量、且可用批次 ≥2」的在架件，保证跨批次分支有真样本。
func pickMultiLotPart(t *testing.T, r *Repo) (string, []domain.StockLot) {
	t.Helper()
	rows, _, err := r.ListParts(context.Background(), partQuery(url.Values{"page_size": {"100"}, "sort": {"onhand"}, "dir": {"desc"}}))
	if err != nil {
		t.Fatalf("配件列表失败: %v", err)
	}
	for _, p := range rows {
		if p.Status != domain.PartActive || p.OnHand < 3 {
			continue
		}
		lots, err := r.LotsOfPart(context.Background(), p.Code)
		if err != nil {
			t.Fatalf("读批次失败: %v", err)
		}
		nonEmpty := 0
		for _, l := range lots {
			if l.QtyRemaining > 0 {
				nonEmpty++
			}
		}
		if nonEmpty >= 2 {
			return p.Code, lots
		}
	}
	t.Fatal("种子里找不到跨批次配件，FIFO 分支无样本")
	return "", nil
}

// ---------- 状态机 / 结算快照 / 退料 ----------

func TestTransitionGatesAndSettlementSnapshot(t *testing.T) {
	r, ctx := newSeeded(t)
	wo := mustNewOrder(t, r, "沪A·C2222", "状态机用例")

	// 刚接车的单什么都能跳：状态机闸门先于业务校验（no_labor 的用例见空账单测试）。
	mustCode(t, r.mustTransition(ctx, wo.ID, domain.WOQc), "invalid_transition")
	mustCode(t, r.mustTransition(ctx, wo.ID, domain.WOSettled), "invalid_transition")
	mustCode(t, r.mustTransition(ctx, wo.ID, "picked_up"), "invalid_transition")
	mustCode(t, r.mustTransition(ctx, 999999, domain.WODiagnosed), "not_found")

	if _, err := r.Transition(ctx, wo.ID, domain.WODiagnosed, "", seedAt); err != nil {
		t.Fatalf("合法跃迁失败: %v", err)
	}
	if _, err := r.AddLaborLine(ctx, wo.ID, domain.AddLineInput{
		Kind: domain.LineLabor, Operation: "更换机油机滤", Grade: domain.GradeMiddle, DurationMin: 60,
	}, seedAt); err != nil {
		t.Fatalf("加工时行失败: %v", err)
	}
	addSomeParts(t, r, wo.ID)

	lines, err := r.LinesOfOrder(ctx, wo.ID)
	if err != nil {
		t.Fatalf("读明细失败: %v", err)
	}
	labor, parts, grand := totalsOf(lines)
	if labor == 0 || parts == 0 || grand != labor+parts {
		t.Fatalf("用例明细不完整：labor=%d parts=%d", labor, parts)
	}
	if _, err := r.Transition(ctx, wo.ID, domain.WOQc, "", seedAt); err != nil {
		t.Fatalf("有工时后报完工应成功: %v", err)
	}
	// 质检之后账目锁定：再加行会让已快照的总额对不上明细。
	mustCode(t, addLaborErr(r, wo.ID), "lines_locked")
	_, _, err = r.IssuePart(ctx, wo.ID, "FL-OIL-01", 1, "锁定后出库", seedAt)
	mustCode(t, err, "lines_locked")

	settled, err := r.Transition(ctx, wo.ID, domain.WOSettled, "", seedAt)
	if err != nil {
		t.Fatalf("结算失败: %v", err)
	}
	if settled.LaborTotalCents != labor || settled.PartsTotalCents != parts || settled.GrandTotalCents != grand {
		t.Errorf("结算快照 %d/%d/%d != 明细合计 %d/%d/%d",
			settled.LaborTotalCents, settled.PartsTotalCents, settled.GrandTotalCents, labor, parts, grand)
	}
	if settled.SettledAt == nil || !settled.SettledAt.Equal(seedAt) {
		t.Errorf("结算时间未正确落库：%v", settled.SettledAt)
	}
	if got := mustStats(t, r, ctx); !got.AmountInvariantOK {
		t.Errorf("结算后金额恒等式破了：%v", got.IdentityIssues)
	}
	if _, err := r.Transition(ctx, wo.ID, domain.WOPickedUp, "", seedAt); err != nil {
		t.Fatalf("提车失败: %v", err)
	}
	mustCode(t, r.mustTransition(ctx, wo.ID, domain.WOPickedUp), "invalid_transition")
	final, err := r.OrderByNo(ctx, wo.WoNo)
	if err != nil || final.Status != domain.WOPickedUp || final.ClosedAt == nil {
		t.Fatalf("终态落库异常：%+v %v", final, err)
	}
}

func TestCancelledOrderReturnsStockToOriginalLots(t *testing.T) {
	r, ctx := newSeeded(t)
	wo := mustNewOrder(t, r, "沪A·D3333", "退料用例")
	if _, err := r.Transition(ctx, wo.ID, domain.WODiagnosed, "", seedAt); err != nil {
		t.Fatalf("跃迁失败: %v", err)
	}
	code, lots := pickMultiLotPart(t, r)
	before := 0
	for _, l := range lots {
		before += l.QtyRemaining
	}
	steps, _, missing := domain.PlanIssue(lots, 2)
	if missing != 0 {
		t.Fatalf("计划缺件 %d", missing)
	}
	if _, _, err := r.IssuePart(ctx, wo.ID, code, 2, "出库后退料", seedAt); err != nil {
		t.Fatalf("出库失败: %v", err)
	}
	if got := onHandOf(t, r, code); got != before-2 {
		t.Fatalf("出库后余量 %d，期望 %d", got, before-2)
	}
	if _, err := r.Transition(ctx, wo.ID, domain.WOCancelled, "客户改期", seedAt); err != nil {
		t.Fatalf("作废失败: %v", err)
	}
	if got := onHandOf(t, r, code); got != before {
		t.Errorf("退料后余量 %d，期望回到 %d", got, before)
	}
	// 退料必须回到**原批次原量**，只把总数凑平是不够的。
	afterLots, _ := r.LotsOfPart(ctx, code)
	byNo := map[string]int{}
	for _, l := range afterLots {
		byNo[l.LotNo] = l.QtyRemaining
	}
	for _, l := range lots {
		if byNo[l.LotNo] != l.QtyRemaining {
			t.Errorf("批次 %s 余量 %d != 出库前 %d", l.LotNo, byNo[l.LotNo], l.QtyRemaining)
		}
	}
	var wantReturn int
	for _, s := range steps {
		wantReturn += s.Qty
	}
	moves, _ := r.MovesOfOrder(ctx, wo.WoNo, 50)
	var ret, iss int
	kinds := map[string]bool{}
	for _, mv := range moves {
		kinds[mv.Kind] = true
		if mv.Kind == domain.MoveReturn {
			ret += mv.QtyDelta
		}
		if mv.Kind == domain.MoveIssue {
			iss += -mv.QtyDelta
		}
	}
	if ret != wantReturn || iss != wantReturn {
		t.Errorf("退料流水 %d != 出库流水 %d", ret, iss)
	}
	if !kinds[domain.MoveIssue] || !kinds[domain.MoveReturn] {
		t.Errorf("流水种类不全：%v", kinds)
	}
	mustCode(t, r.mustTransition(ctx, wo.ID, domain.WORepairing), "invalid_transition")
	head, err := r.OrderByNo(ctx, wo.WoNo)
	if err != nil || head.CancelReason != "客户改期" || head.ClosedAt == nil {
		t.Errorf("作废原因/时间未落库：%+v %v", head, err)
	}
	// 作废不影响账实相符不变量。
	if got := mustStats(t, r, ctx); !got.StockInvariantOK || got.LotOverflow != 0 {
		t.Errorf("退料后不变量被破坏：%+v", got.StockIssues)
	}
}

func TestEmptyBillCannotSettle(t *testing.T) {
	r, ctx := newSeeded(t)
	wo := mustNewOrder(t, r, "沪A·E4444", "空账单用例")
	if _, err := r.Transition(ctx, wo.ID, domain.WODiagnosed, "", seedAt); err != nil {
		t.Fatalf("跃迁失败: %v", err)
	}
	// 工时为 0 的行不会存在（校验挡掉），这里用极小工时后立刻质检→结算应齐备；
	// 反过来：只有配件行、没有工时行时必须报 no_labor。
	if _, _, err := r.IssuePart(ctx, wo.ID, "FL-OIL-01", 1, "只有料", seedAt); err != nil {
		addSomeParts(t, r, wo.ID)
	}
	mustCode(t, r.mustTransition(ctx, wo.ID, domain.WOQc), "no_labor")
}

// ---------- 入库 ----------

func TestReceiptCreatesLotAndRejectsBadInput(t *testing.T) {
	r, ctx := newSeeded(t)
	before := onHandOf(t, r, "FL-OIL-01")
	in := domain.ReceiptInput{PartCode: "FL-OIL-01", LotNo: "LOT-TEST-01", Qty: 5,
		UnitCostCents: 4200, Supplier: "测试供应商"}
	lot, err := r.AddReceipt(ctx, in, seedAt)
	if err != nil {
		t.Fatalf("入库失败: %v", err)
	}
	if lot.QtyRemaining != 5 || lot.QtyReceived != 5 || lot.UnitCostCents != 4200 {
		t.Errorf("批次写入异常：%+v", lot)
	}
	if got := onHandOf(t, r, in.PartCode); got != before+5 {
		t.Errorf("入库后余量 %d，期望 %d", got, before+5)
	}
	mustCode(t, addReceiptErr(r, in), "lot_exists")
	mustCode(t, addReceiptErr(r, domain.ReceiptInput{PartCode: "TR-OLD-04", LotNo: "LOT-TEST-02",
		Qty: 1, UnitCostCents: 100, Supplier: "测试供应商"}), "part_discontinued")
	mustCode(t, addReceiptErr(r, domain.ReceiptInput{PartCode: "NO-SUCH-PART", LotNo: "LOT-TEST-03",
		Qty: 1, UnitCostCents: 100, Supplier: "测试供应商"}), "not_found")
	for _, bad := range []domain.ReceiptInput{
		{PartCode: "FL-OIL-01'; DROP TABLE stock_lots;--", LotNo: "LOT-X", Qty: 1, UnitCostCents: 100, Supplier: "s"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X;delete", Qty: 1, UnitCostCents: 100, Supplier: "s"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 0, UnitCostCents: 100, Supplier: "s"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 1, UnitCostCents: 0, Supplier: "s"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 1, UnitCostCents: 100, Supplier: " "},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 1, UnitCostCents: 100, Supplier: "s", ExpiresOn: "2028/01/01"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 1, UnitCostCents: 100, Supplier: "s", ExpiresOn: "下个月"},
		{PartCode: "FL-OIL-01", LotNo: strings.Repeat("L", 40), Qty: 1, UnitCostCents: 100, Supplier: "s"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 200_000, UnitCostCents: 100, Supplier: "s"},
		{PartCode: "FL-OIL-01", LotNo: "LOT-X", Qty: 1, UnitCostCents: 60_000_000, Supplier: "s"},
	} {
		if _, err := r.AddReceipt(ctx, bad, seedAt); err == nil {
			t.Errorf("非法入库被放行：%+v", bad)
		}
	}
	// 新批次必须参与 FIFO：入库批次排最后，出库仍先吃旧批次。
	code, lots := pickMultiLotPart(t, r)
	if _, err := r.AddReceipt(ctx, domain.ReceiptInput{PartCode: code, LotNo: "LOT-FIFO-TAIL", Qty: 4,
		UnitCostCents: 888888, Supplier: "测试供应商"}, seedAt.Add(48*time.Hour)); err != nil {
		t.Fatalf("入库失败: %v", err)
	}
	refreshed, _ := r.LotsOfPart(ctx, code)
	steps, _, _ := domain.PlanIssue(refreshed, 1)
	if len(steps) == 0 || steps[0].LotNo == "LOT-FIFO-TAIL" {
		t.Errorf("新入库批次抢到了 FIFO 首位：%+v（旧批次 %d 个）", steps, len(lots))
	}
	if got := mustStats(t, r, ctx); !got.StockInvariantOK {
		t.Errorf("入库后账实不符：%+v", got.StockIssues)
	}
}

func addReceiptErr(r *Repo, in domain.ReceiptInput) error {
	_, err := r.AddReceipt(context.Background(), in, seedAt)
	return err
}

func addLaborErr(r *Repo, orderID int64) error {
	_, err := r.AddLaborLine(context.Background(), orderID, domain.AddLineInput{
		Kind: domain.LineLabor, Operation: "补做项目", Grade: domain.GradeJunior, DurationMin: 30,
	}, seedAt)
	return err
}

// ---------- 查询收敛 ----------

func TestEverySortKeyResolvesAndPagingIsCapped(t *testing.T) {
	r, ctx := newSeeded(t)
	for _, key := range []string{"opened", "promised", "updated", "no", "plate", "status", "priority", "total", "tech", "id", "", "bogus", "' OR 1=1--", "w.opened_at; DROP TABLE work_orders"} {
		for _, dir := range []string{"asc", "desc", "sideways", ""} {
			rows, total, err := r.ListOrders(ctx, orderQuery(url.Values{
				"sort": {key}, "dir": {dir}, "page_size": {"5"},
			}))
			if err != nil {
				t.Fatalf("排序 %q/%q 失败（这类错误在 SQLite 规划期即 500）: %v", key, dir, err)
			}
			if len(rows) == 0 || total == 0 {
				t.Errorf("排序 %q/%q 结果为空", key, dir)
			}
			for i := 1; i < len(rows); i++ {
				if rows[i].ID == rows[i-1].ID {
					t.Errorf("排序 %q 出现重复行 id=%d", key, rows[i].ID)
				}
			}
		}
	}
	for _, key := range []string{"code", "name", "category", "price", "onhand", "value", "lot", "cost", "id", "", "bogus"} {
		if _, _, err := r.ListParts(ctx, partQuery(url.Values{"sort": {key}, "dir": {"desc"}, "page_size": {"5"}})); err != nil {
			t.Fatalf("配件排序 %q 失败: %v", key, err)
		}
	}
	rows, _, err := r.ListOrders(ctx, orderQuery(url.Values{"page_size": {"99999"}}))
	if err != nil {
		t.Fatalf("列表失败: %v", err)
	}
	if len(rows) > domain.MaxPageSize {
		t.Errorf("page_size 未钳制：返回 %d 行", len(rows))
	}
	parts, _, err := r.ListParts(ctx, partQuery(url.Values{"page_size": {"99999"}}))
	if err != nil || len(parts) > domain.MaxPageSize {
		t.Errorf("配件分页未钳制：%d 行 %v", len(parts), err)
	}
	// 越界页码必须回空而不是 500。
	if rows, total, err := r.ListOrders(ctx, orderQuery(url.Values{"page": {"99999"}})); err != nil || len(rows) != 0 {
		t.Errorf("超页应为空：%d 行 %v", len(rows), err)
	} else if total == 0 {
		t.Error("超页仍要报总数")
	}
}

func TestSearchEscapingAndEnumFallback(t *testing.T) {
	r, ctx := newSeeded(t)
	for _, meta := range []string{"%", "_", `\`, "%_"} {
		rows, _, err := r.ListOrders(ctx, orderQuery(url.Values{"q": {meta}}))
		if err != nil {
			t.Fatalf("q=%q 失败: %v", meta, err)
		}
		if len(rows) != 0 {
			t.Errorf("q=%q 命中 %d 行，说明 LIKE 元字符没转义", meta, len(rows))
		}
		if rows2, _, err := r.ListParts(ctx, partQuery(url.Values{"q": {meta}})); err != nil || len(rows2) != 0 {
			t.Errorf("配件 q=%q 命中 %d 行 %v", meta, len(rows2), err)
		}
	}
	for _, inj := range []string{"'; DROP TABLE work_orders;--", "' OR '1'='1", `"x" OR 1=1`} {
		if _, _, err := r.ListOrders(ctx, orderQuery(url.Values{"q": {inj}})); err != nil {
			t.Errorf("注入串搜索报错: %v", err)
		}
	}
	// 搜索必须真的命中：拿列表里已有的车牌去搜，应至少回到那一单。
	rows, _, err := r.ListOrders(ctx, orderQuery(url.Values{"sort": {"id"}, "page_size": {"5"}}))
	if err != nil || len(rows) == 0 {
		t.Fatalf("基线列表失败: %v", err)
	}
	plate := rows[0].PlateNo
	hits, _, err := r.ListOrders(ctx, orderQuery(url.Values{"q": {plate}}))
	if err != nil {
		t.Fatalf("按车牌搜索失败: %v", err)
	}
	found := false
	for _, h := range hits {
		if h.PlateNo == plate {
			found = true
		}
	}
	if !found {
		t.Errorf("按车牌 %q 搜索没命中自身（返回 %d 行）", plate, len(hits))
	}
	// 超长搜索串按 rune 截断而不是报错。
	longQ := strings.Repeat("沪", 200)
	if _, _, err := r.ListOrders(ctx, orderQuery(url.Values{"q": {longQ}})); err != nil {
		t.Errorf("超长搜索应截断： %v", err)
	}
	// 非法枚举一律回落，不能变成 SQL 条件或 400。
	for _, bad := range []string{"not-a-status", "' OR 1=1", "OPEN"} {
		q := orderQuery(url.Values{"status": {bad}, "priority": {bad}, "category": {bad}, "stock": {bad}})
		if q.Status != "" || q.Priority != "" || q.Category != "" || q.Stock != "" {
			t.Errorf("非法枚举未回落：%+v", q)
		}
		if _, _, err := r.ListOrders(ctx, q); err != nil {
			t.Errorf("回落后的查询失败: %v", err)
		}
	}
	// 合法过滤必须真的生效。
	if rows, _, err := r.ListOrders(ctx, orderQuery(url.Values{"status": {domain.WORepairing}, "page_size": {"100"}})); err != nil {
		t.Errorf("状态过滤失败: %v", err)
	} else {
		for _, x := range rows {
			if x.Status != domain.WORepairing {
				t.Fatalf("状态过滤串味：%+v", x)
			}
		}
	}
	if rows, _, err := r.ListOrders(ctx, orderQuery(url.Values{"status": {"open"}, "page_size": {"100"}})); err != nil {
		t.Errorf("open 过滤失败: %v", err)
	} else {
		for _, x := range rows {
			if !domain.IsOpen(x.Status) {
				t.Fatalf("open 过滤混进离场态 %s", x.Status)
			}
		}
	}
	if rows, _, err := r.ListParts(ctx, partQuery(url.Values{"stock": {"out"}, "page_size": {"100"}})); err != nil {
		t.Errorf("零库存过滤失败: %v", err)
	} else {
		for _, x := range rows {
			if x.OnHand > 0 {
				t.Fatalf("stock=out 混进有余量的件：%+v", x)
			}
		}
	}
	if rows, _, err := r.ListParts(ctx, partQuery(url.Values{"category": {domain.CatConsumable}, "page_size": {"100"}})); err != nil {
		t.Errorf("类别过滤失败: %v", err)
	} else {
		for _, x := range rows {
			if x.Category != domain.CatConsumable {
				t.Fatalf("类别过滤串味：%+v", x)
			}
		}
	}
}

func TestStatsWindowClampsAndUnknownDaysFallback(t *testing.T) {
	r, ctx := newSeeded(t)
	for _, tc := range []struct {
		days int
		want int
	}{{-5, 7}, {0, 7}, {1, 3}, {3, 3}, {7, 7}, {30, 30}, {45, 45}, {400, 45}} {
		s, err := r.Stats(ctx, tc.days)
		if err != nil {
			t.Fatalf("days=%d 失败: %v", tc.days, err)
		}
		if len(s.Trend) != tc.want {
			t.Errorf("days=%d 趋势点数 %d，期望 %d", tc.days, len(s.Trend), tc.want)
		}
		if !s.StockInvariantOK || !s.AmountInvariantOK {
			t.Errorf("days=%d 时不变量被破坏", tc.days)
		}
	}
}

func TestNotFoundOnDetailPaths(t *testing.T) {
	r, ctx := newSeeded(t)
	for _, no := range []string{"WO-NOPE", "'; DROP", strings.Repeat("A", 60), ""} {
		mustCode(t, orderErr(r, ctx, no), "not_found")
		mustCode(t, headErr(r, ctx, no), "not_found")
	}
	for _, code := range []string{"NO-SUCH-CODE", "", strings.Repeat("X", 40)} {
		mustCode(t, partErr(r, ctx, code), "not_found")
	}
}

func orderErr(r *Repo, ctx context.Context, no string) error {
	_, err := r.OrderByNo(ctx, no)
	return err
}

func headErr(r *Repo, ctx context.Context, no string) error {
	_, err := r.OrderHead(ctx, no)
	return err
}

func partErr(r *Repo, ctx context.Context, code string) error {
	_, err := r.PartRowByCode(ctx, code)
	return err
}

// ---------- 工单号发号 ----------

func TestWoNumberingIsDailyAndUnique(t *testing.T) {
	r, ctx := newSeeded(t)
	seen := map[string]bool{}
	for i := 0; i < 6; i++ {
		wo := mustNewOrder(t, r, "沪A·F5555", "发号用例")
		if seen[wo.WoNo] {
			t.Fatalf("工单号重复：%s", wo.WoNo)
		}
		seen[wo.WoNo] = true
		want := woPrefix()
		if !strings.HasPrefix(wo.WoNo, want) || len(wo.WoNo) != len(want)+4 {
			t.Errorf("工单号形态异常：%q", wo.WoNo)
		}
	}
	// 种子里已有的号不能被覆盖：新号必须避开历史序列。
	wo := mustNewOrder(t, r, "沪A·G6666", "发号用例二")
	if _, err := r.OrderByNo(ctx, wo.WoNo); err != nil {
		t.Fatalf("新单读不回: %v", err)
	}
}

// ---------- 小工具 ----------

func (r *Repo) mustTransition(ctx context.Context, id int64, to string) error {
	_, err := r.Transition(ctx, id, to, "", seedAt)
	return err
}

func totalsOf(lines []domain.OrderLineRow) (labor, parts, grand int64) {
	asLines := make([]domain.WorkOrderLine, 0, len(lines))
	for _, l := range lines {
		asLines = append(asLines, domain.WorkOrderLine{Kind: l.Kind, AmountCents: l.AmountCents})
	}
	return domain.SumLineTotals(asLines)
}

func addSomeParts(t *testing.T, r *Repo, orderID int64) {
	t.Helper()
	rows, _, err := r.ListParts(context.Background(), partQuery(url.Values{"page_size": {"100"}, "sort": {"onhand"}, "dir": {"desc"}}))
	if err != nil {
		t.Fatalf("配件列表失败: %v", err)
	}
	for _, p := range rows {
		if p.Status != domain.PartActive || p.OnHand < 2 {
			continue
		}
		if _, _, err := r.IssuePart(context.Background(), orderID, p.Code, 1, "补料", seedAt); err == nil {
			return
		}
	}
	t.Fatal("找不到可出库配件")
}

func mustStats(t *testing.T, r *Repo, ctx context.Context) *domain.Stats {
	t.Helper()
	s, err := r.Stats(ctx, 30)
	if err != nil {
		t.Fatalf("统计失败: %v", err)
	}
	return s
}
