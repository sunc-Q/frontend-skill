package repository

import (
	"context"
	"strconv"
	"strings"
	"time"

	"autoshop/internal/domain"
)

// Stats 汇总口径全部来自 parts/stock_lots/work_orders/work_order_lines/stock_moves 五张表。
// 对外公布并逐条实测的不变量：
//  1. 账实相符：对每个配件 Σ(流水 qty_delta) == Σ(批次余量)（stock_issues 为空即成立）；
//  2. 结算分解：对每张已结算单 grand_total == labor_total + parts_total == Σ 明细行金额；
//  3. 行售价：配件行 amount == qty × 挂牌单价（毛利因此可由 Σ(amount − cost) 直接得出）。
//
// 所有聚合先按主体（工单/配件）在子查询里收拢，再回接维度表，
// 否则多表 LEFT JOIN 会把 SUM 放大成历史倍数的假账。
func (r *Repo) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	// 窗口长度是外部输入：未给（<=0）用默认 7 天，给了就夹到 [3,45]，
	// 补零后的趋势点数必须等于窗口天数，前端才能直接画图。
	if days <= 0 {
		days = 7
	}
	if days < 3 {
		days = 3
	}
	if days > 45 {
		days = 45
	}
	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}
	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	start := dayStart.AddDate(0, 0, -(days - 1))

	s := &domain.Stats{
		GeneratedAt: now, Today: today,
		Window: "近 " + strconv.Itoa(days) + " 天趋势；金额与库存为当前时点全量口径",
	}

	openArgs := make([]any, 0, len(domain.OpenStatuses))
	for _, st := range domain.OpenStatuses {
		openArgs = append(openArgs, st)
	}
	openPH := "?" + strings.Repeat(",?", len(domain.OpenStatuses)-1)

	if err := scan(&s.TotalOrders, `SELECT COUNT(*) FROM work_orders`); err != nil {
		return nil, err
	}
	if err := scan(&s.OpenOrders, `SELECT COUNT(*) FROM work_orders WHERE status IN (`+openPH+`)`, openArgs...); err != nil {
		return nil, err
	}
	if err := scan(&s.AwaitingParts, `SELECT COUNT(*) FROM work_orders WHERE status = 'awaiting_parts'`); err != nil {
		return nil, err
	}
	if err := scan(&s.SettledWait, `SELECT COUNT(*) FROM work_orders WHERE status = 'settled'`); err != nil {
		return nil, err
	}
	if err := scan(&s.PromiseLate, `SELECT COUNT(*) FROM work_orders
		WHERE status IN (`+openPH+`) AND promised_at < ?`, append(openArgs, now)...); err != nil {
		return nil, err
	}
	if err := scan(&s.TodayOpened, `SELECT COUNT(*) FROM work_orders WHERE opened_at >= ?`, dayStart); err != nil {
		return nil, err
	}
	if err := scan(&s.TodayIssues, `SELECT COUNT(*) FROM stock_moves WHERE kind = 'issue' AND occurred_at >= ?`, dayStart); err != nil {
		return nil, err
	}

	// 已结算口径：settled + picked_up 都算成交（结算即已开票）。
	settledPH := "'settled','picked_up'"
	type money struct {
		Revenue int64 `gorm:"column:revenue"`
		Labor   int64 `gorm:"column:labor"`
		Parts   int64 `gorm:"column:parts"`
	}
	var m money
	if err := scan(&m, `SELECT COALESCE(SUM(grand_total_cents),0) AS revenue,
		COALESCE(SUM(labor_total_cents),0) AS labor, COALESCE(SUM(parts_total_cents),0) AS parts
		FROM work_orders WHERE status IN (`+settledPH+`)`); err != nil {
		return nil, err
	}
	s.RevenueCents, s.LaborCents, s.PartsCents = m.Revenue, m.Labor, m.Parts
	if err := scan(&s.PartsCostCents, `SELECT COALESCE(SUM(l.cost_cents),0)
		FROM work_order_lines l JOIN work_orders w ON w.id = l.work_order_id
		WHERE l.kind = 'part' AND w.status IN (`+settledPH+`)`); err != nil {
		return nil, err
	}
	s.GrossMarginCents = s.RevenueCents - s.PartsCostCents
	if err := scan(&s.OpenLaborMin, `SELECT COALESCE(SUM(l.duration_min),0)
		FROM work_order_lines l JOIN work_orders w ON w.id = l.work_order_id
		WHERE l.kind = 'labor' AND w.status IN (`+openPH+`)`, openArgs...); err != nil {
		return nil, err
	}

	type stockAgg struct {
		Value int64 `gorm:"column:value_cents"`
		Units int   `gorm:"column:units"`
	}
	var sa stockAgg
	if err := scan(&sa, `SELECT COALESCE(SUM(qty_remaining * unit_cost_cents),0) AS value_cents,
		COALESCE(SUM(qty_remaining),0) AS units FROM stock_lots`); err != nil {
		return nil, err
	}
	s.StockValueCents, s.OnHandUnits = sa.Value, sa.Units
	if err := scan(&s.ActiveParts, `SELECT COUNT(*) FROM parts WHERE status = 'active'`); err != nil {
		return nil, err
	}
	if err := scan(&s.LowStockParts, `SELECT COUNT(*) FROM parts p
		LEFT JOIN (SELECT part_code, SUM(qty_remaining) AS on_hand FROM stock_lots GROUP BY part_code) l
			ON l.part_code = p.code
		WHERE p.status = 'active' AND COALESCE(l.on_hand,0) <= p.reorder_point`); err != nil {
		return nil, err
	}

	s.ByStatus = []domain.StatusBucket{}
	if err := scan(&s.ByStatus, `SELECT w.status AS status, COUNT(*) AS cnt,
		COALESCE(SUM(CASE WHEN w.status IN (`+openPH+`)
			THEN CAST((julianday(COALESCE(w.closed_at, ?), 'utc') - julianday(w.opened_at, 'utc')) * 1440 AS INTEGER)
			ELSE 0 END),0) AS open_minutes,
		COALESCE(SUM(w.grand_total_cents),0) AS revenue_cents
		FROM work_orders w GROUP BY w.status ORDER BY w.status`,
		append(append([]any{}, openArgs...), now)...); err != nil {
		return nil, err
	}

	s.ByCategory = []domain.CategoryBucket{}
	if err := scan(&s.ByCategory, `SELECT p.category AS category, COUNT(*) AS parts,
		COALESCE(SUM(l.on_hand),0) AS on_hand, COALESCE(SUM(l.value_cents),0) AS value_cents,
		COALESCE(SUM(CASE WHEN COALESCE(l.on_hand,0) <= p.reorder_point THEN 1 ELSE 0 END),0) AS short_parts
		FROM parts p
		LEFT JOIN (SELECT part_code, COALESCE(SUM(qty_remaining),0) AS on_hand,
			COALESCE(SUM(qty_remaining * unit_cost_cents),0) AS value_cents
			FROM stock_lots GROUP BY part_code) l ON l.part_code = p.code
		GROUP BY p.category ORDER BY value_cents DESC, p.category`); err != nil {
		return nil, err
	}

	// 趋势按天补零：SQL 只回有账的日期，稀疏日必须在 Go 里补齐，
	// 否则「哪些天存在」被数据库的行数决定，折线会自己缩水。
	type dayRow struct {
		Day   string `gorm:"column:day"`
		Cnt   int    `gorm:"column:cnt"`
		Value int64  `gorm:"column:value_cents"`
	}
	readMap := func(sql string, args ...any) (map[string]dayRow, error) {
		var rows []dayRow
		if err := scan(&rows, sql, args...); err != nil {
			return nil, err
		}
		out := make(map[string]dayRow, len(rows))
		for _, x := range rows {
			out[x.Day] = x
		}
		return out, nil
	}
	opened, err := readMap(`SELECT substr(opened_at,1,10) AS day, COUNT(*) AS cnt, 0 AS value_cents
		FROM work_orders WHERE opened_at >= ? GROUP BY day`, start)
	if err != nil {
		return nil, err
	}
	settledMap, err := readMap(`SELECT substr(settled_at,1,10) AS day, COUNT(*) AS cnt, 0 AS value_cents
		FROM work_orders WHERE settled_at IS NOT NULL AND settled_at >= ? GROUP BY day`, start)
	if err != nil {
		return nil, err
	}
	revenue, err := readMap(`SELECT substr(settled_at,1,10) AS day, 0 AS cnt,
		COALESCE(SUM(grand_total_cents),0) AS value_cents
		FROM work_orders WHERE settled_at IS NOT NULL AND settled_at >= ? GROUP BY day`, start)
	if err != nil {
		return nil, err
	}
	issued, err := readMap(`SELECT substr(occurred_at,1,10) AS day, COALESCE(SUM(-qty_delta),0) AS cnt, 0 AS value_cents
		FROM stock_moves WHERE kind IN ('issue','scrap') AND occurred_at >= ? GROUP BY day`, start)
	if err != nil {
		return nil, err
	}
	s.Trend = make([]domain.TrendPoint, 0, days)
	for d := start; !d.After(dayStart); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		s.Trend = append(s.Trend, domain.TrendPoint{
			Day:          key,
			Opened:       opened[key].Cnt,
			Settled:      settledMap[key].Cnt,
			RevenueCents: revenue[key].Value,
			IssuedQty:    issued[key].Cnt,
		})
	}

	s.TopParts = []domain.TopPart{}
	if err := scan(&s.TopParts, `SELECT t.part_code AS code, p.name AS name, p.category AS category,
		t.qty, t.cost_cents, t.amount_cents
		FROM (SELECT part_code, SUM(qty) AS qty, SUM(cost_cents) AS cost_cents, SUM(amount_cents) AS amount_cents
			FROM work_order_lines WHERE kind = 'part' AND created_at >= ? GROUP BY part_code) t
		JOIN parts p ON p.code = t.part_code
		ORDER BY t.amount_cents DESC, t.qty DESC LIMIT 8`, start); err != nil {
		return nil, err
	}

	// 不变量一：账实相符（逐配件比对流水与批次余量）。
	s.StockIssues = []domain.StockIssue{}
	if err := scan(&s.StockIssues, `SELECT p.code AS part_code, COALESCE(mv.s,0) AS moves_sum,
		COALESCE(l.s,0) AS lots_sum, COALESCE(l.over,0) AS overflow
		FROM parts p
		LEFT JOIN (SELECT part_code, COALESCE(SUM(qty_delta),0) AS s FROM stock_moves GROUP BY part_code) mv ON mv.part_code = p.code
		LEFT JOIN (SELECT part_code, COALESCE(SUM(qty_remaining),0) AS s,
			SUM(CASE WHEN qty_remaining > qty_received OR qty_remaining < 0 THEN 1 ELSE 0 END) AS over
			FROM stock_lots GROUP BY part_code) l ON l.part_code = p.code
		WHERE COALESCE(mv.s,0) <> COALESCE(l.s,0) OR COALESCE(l.over,0) > 0
		ORDER BY p.code LIMIT 20`); err != nil {
		return nil, err
	}
	s.StockInvariantOK = len(s.StockIssues) == 0
	var over int64
	if err := scan(&over, `SELECT COUNT(*) FROM stock_lots WHERE qty_remaining > qty_received OR qty_remaining < 0`); err != nil {
		return nil, err
	}
	s.LotOverflow = int(over)

	// 不变量二与三：SQL 只把账拉平，判定逻辑在 domain.CheckIdentity（与结算共用同一算法）。
	var amountRows []domain.OrderAmount
	if err := scan(&amountRows, `SELECT w.wo_no AS wo_no, 'order' AS kind, w.status AS status,
		w.labor_total_cents AS labor_total_cents, w.parts_total_cents AS parts_total_cents,
		w.grand_total_cents AS grand_total_cents, COALESCE(ls.s,0) AS line_sum_cents,
		0 AS list_price_cents, 0 AS qty
		FROM work_orders w
		LEFT JOIN (SELECT work_order_id, COALESCE(SUM(amount_cents),0) AS s
			FROM work_order_lines GROUP BY work_order_id) ls ON ls.work_order_id = w.id
		WHERE w.status IN ('settled','picked_up')
		UNION ALL
		SELECT w.wo_no, 'part_line', w.status, 0, 0, l.amount_cents, 0, p.list_price_cents, l.qty
		FROM work_order_lines l
		JOIN work_orders w ON w.id = l.work_order_id
		JOIN parts p ON p.code = l.part_code
		WHERE l.kind = 'part' AND w.status IN ('settled','picked_up')`); err != nil {
		return nil, err
	}
	// 复核的是「单」，行数是恒等式检查的样本量。
	seen := map[string]bool{}
	for _, row := range amountRows {
		seen[row.WoNo] = true
	}
	s.CheckedOrders = len(seen)
	s.IdentityIssues = domain.CheckIdentity(amountRows)
	s.IdentityViolations = len(s.IdentityIssues)
	s.AmountInvariantOK = s.IdentityViolations == 0

	return s, nil
}
