package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"autoshop/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

// likePattern 把用户搜索串转成安全的 LIKE 模式：
// 通配符必须被当字面量，否则 `q=%` 会匹配全表，`q=_` 会伪装成任意单字符。
func likePattern(s string) string {
	t := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(s))
	return "%" + t + "%"
}

// phoneMaskSQL 让脱敏发生在 SQL 里：原始号码不允许离开 repository 层。
const phoneMaskSQL = `substr(w.customer_phone,1,3) || '****' || substr(w.customer_phone,8,4) AS customer_phone`

const orderSelect = `w.id, w.wo_no, w.plate_no, w.model AS model_name, w.customer_name, ` + phoneMaskSQL + `,
	w.mileage_km, w.symptom, w.status, w.priority, w.technician, w.opened_at, w.promised_at,
	w.settled_at, w.closed_at, w.cancel_reason, w.labor_total_cents, w.parts_total_cents, w.grand_total_cents,
	COALESCE(l.line_count,0) AS line_count, COALESCE(l.labor_minutes,0) AS labor_minutes,
	COALESCE(l.part_qty,0) AS part_qty`

const orderLineAgg = `LEFT JOIN (
		SELECT work_order_id,
			COUNT(*) AS line_count,
			COALESCE(SUM(CASE WHEN kind = 'labor' THEN duration_min ELSE 0 END),0) AS labor_minutes,
			COALESCE(SUM(CASE WHEN kind = 'part' THEN qty ELSE 0 END),0) AS part_qty
		FROM work_order_lines GROUP BY work_order_id) l ON l.work_order_id = w.id`

// ListOrders 分页返回工单头 + 明细聚合。聚合先在子查询里按工单收拢，
// 再 LEFT JOIN 回主表 —— 直接把明细表 JOIN 进来会让一单多行成倍放大总数。
func (r *Repo) ListOrders(ctx context.Context, q domain.ListQuery) ([]domain.OrderRow, int64, error) {
	db := r.db.WithContext(ctx)
	where := []string{"1 = 1"}
	args := []any{}
	switch {
	case q.Status == "open":
		placeholders := strings.Repeat("?,", len(domain.OpenStatuses))
		where = append(where, "w.status IN ("+placeholders[:len(placeholders)-1]+")")
		for _, s := range domain.OpenStatuses {
			args = append(args, s)
		}
	case q.Status == "all" || q.Status == "":
	default:
		where = append(where, "w.status = ?")
		args = append(args, q.Status)
	}
	if q.Priority != "" {
		where = append(where, "w.priority = ?")
		args = append(args, q.Priority)
	}
	if q.Search != "" {
		p := likePattern(q.Search)
		where = append(where, `(w.wo_no LIKE ? ESCAPE '\' OR w.plate_no LIKE ? ESCAPE '\' OR w.customer_name LIKE ? ESCAPE '\' OR w.technician LIKE ? ESCAPE '\')`)
		args = append(args, p, p, p, p)
	}
	clause := strings.Join(where, " AND ")

	var total int64
	if err := db.Raw(`SELECT COUNT(*) FROM work_orders w WHERE `+clause, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	dir := "ASC"
	if q.Dir == "desc" {
		dir = "DESC"
	}
	rows := []domain.OrderRow{}
	sql := `SELECT ` + orderSelect + ` FROM work_orders w ` + orderLineAgg + ` WHERE ` + clause +
		` ORDER BY ` + q.Sort + ` ` + dir + `, w.id ASC LIMIT ? OFFSET ?`
	if err := db.Raw(sql, append(append([]any{}, args...), q.PageSize, q.Offset())...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// OrderByNo 读单个工单头（供 service 判状态与写回金额快照）。
func (r *Repo) OrderByNo(ctx context.Context, no string) (*domain.WorkOrder, error) {
	var wo domain.WorkOrder
	err := r.db.WithContext(ctx).Where("wo_no = ?", no).First(&wo).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &wo, nil
}

func (r *Repo) OrderByID(ctx context.Context, id int64) (*domain.WorkOrder, error) {
	var wo domain.WorkOrder
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&wo).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &wo, nil
}

// OrderHead 读列表视图的单行（按工单号）。
func (r *Repo) OrderHead(ctx context.Context, no string) (*domain.OrderRow, error) {
	var rows []domain.OrderRow
	err := r.db.WithContext(ctx).Raw(`SELECT `+orderSelect+` FROM work_orders w `+orderLineAgg+
		` WHERE w.wo_no = ?`, no).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	return &rows[0], nil
}

func (r *Repo) LinesOfOrder(ctx context.Context, orderID int64) ([]domain.OrderLineRow, error) {
	rows := []domain.OrderLineRow{}
	err := r.db.WithContext(ctx).Raw(`SELECT l.id, l.kind, l.operation, l.grade, l.duration_min, l.part_code,
		COALESCE(p.name,'') AS part_name, COALESCE(p.unit,'') AS unit, l.qty, l.unit_cost_cents, l.cost_cents,
		l.unit_price_cents, l.amount_cents, COALESCE(l.note,'') AS note, l.created_at
		FROM work_order_lines l LEFT JOIN parts p ON p.code = l.part_code
		WHERE l.work_order_id = ? ORDER BY l.id`, orderID).Scan(&rows).Error
	return rows, err
}

func (r *Repo) MovesOfOrder(ctx context.Context, woNo string, limit int) ([]domain.MoveRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	rows := []domain.MoveRow{}
	err := r.db.WithContext(ctx).Raw(`SELECT id, part_code, lot_no, kind, qty_delta, unit_cost_cents,
		COALESCE(wo_no,'') AS wo_no, COALESCE(note,'') AS note, occurred_at
		FROM stock_moves WHERE wo_no = ? ORDER BY id DESC LIMIT ?`, woNo, limit).Scan(&rows).Error
	return rows, err
}

// ---- 配件与库存读 ----

// oldest_lot_at 取批次入库时间的日期部分：MIN() 之后的列不再带 DATETIME 亲和性，
// 驱动会原样返回文本，直接扫进 time.Time 会报 unsupported Scan。
const partSelect = `p.id, p.code, p.name, p.brand, p.category, p.unit, p.list_price_cents,
	p.reorder_point, p.shelf_location, p.status,
	COALESCE(l.on_hand,0) AS on_hand, COALESCE(l.lot_count,0) AS lot_count,
	COALESCE(l.avg_cost_cents,0) AS avg_cost_cents, COALESCE(l.stock_value_cents,0) AS stock_value_cents,
	COALESCE(m.consumed_30,0) AS consumed_30,
	CASE WHEN l.oldest_lot_at IS NULL THEN '' ELSE substr(l.oldest_lot_at,1,10) END AS oldest_lot_at`

const partAggJoins = `LEFT JOIN (
		SELECT part_code, COUNT(*) AS lot_count, SUM(qty_remaining) AS on_hand,
			CAST(CASE WHEN SUM(qty_remaining) > 0
				THEN SUM(qty_remaining * unit_cost_cents) / SUM(qty_remaining) ELSE 0 END AS INTEGER) AS avg_cost_cents,
			SUM(qty_remaining * unit_cost_cents) AS stock_value_cents, MIN(received_at) AS oldest_lot_at
		FROM stock_lots GROUP BY part_code) l ON l.part_code = p.code
	LEFT JOIN (
		SELECT part_code, COALESCE(SUM(-qty_delta),0) AS consumed_30
		FROM stock_moves WHERE kind IN ('issue','scrap') AND occurred_at >= datetime('now','-30 days')
		GROUP BY part_code) m ON m.part_code = p.code`

func (r *Repo) ListParts(ctx context.Context, q domain.ListQuery) ([]domain.PartRow, int64, error) {
	db := r.db.WithContext(ctx)
	where := []string{"1 = 1"}
	args := []any{}
	if q.Category != "" {
		where = append(where, "p.category = ?")
		args = append(args, q.Category)
	}
	if q.Status != "" {
		where = append(where, "p.status = ?")
		args = append(args, q.Status)
	}
	switch q.Stock {
	case "low":
		where = append(where, "COALESCE(l.on_hand,0) <= p.reorder_point")
	case "out":
		where = append(where, "COALESCE(l.on_hand,0) <= 0")
	case "ok":
		where = append(where, "COALESCE(l.on_hand,0) > p.reorder_point")
	}
	if q.Search != "" {
		p := likePattern(q.Search)
		where = append(where, `(p.code LIKE ? ESCAPE '\' OR p.name LIKE ? ESCAPE '\' OR p.brand LIKE ? ESCAPE '\' OR p.shelf_location LIKE ? ESCAPE '\')`)
		args = append(args, p, p, p, p)
	}
	clause := strings.Join(where, " AND ")

	var total int64
	countSQL := `SELECT COUNT(*) FROM parts p ` + partAggJoins + ` WHERE ` + clause
	if err := db.Raw(countSQL, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	dir := "ASC"
	if q.Dir == "desc" {
		dir = "DESC"
	}
	rows := []domain.PartRow{}
	sql := `SELECT ` + partSelect + ` FROM parts p ` + partAggJoins + ` WHERE ` + clause +
		` ORDER BY ` + q.Sort + ` ` + dir + `, p.id ASC LIMIT ? OFFSET ?`
	if err := db.Raw(sql, append(append([]any{}, args...), q.PageSize, q.Offset())...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *Repo) PartRowByCode(ctx context.Context, code string) (*domain.PartRow, error) {
	rows := []domain.PartRow{}
	err := r.db.WithContext(ctx).Raw(`SELECT `+partSelect+` FROM parts p `+partAggJoins+` WHERE p.code = ?`, code).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	return &rows[0], nil
}

func (r *Repo) PartByCode(ctx context.Context, code string) (*domain.Part, error) {
	var p domain.Part
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	return &p, err
}

// LotsForUpdate 取某配件的批次（按 FIFO 顺序）。
// 注意：事务内必须用传入的 *gorm.DB（单写者连接，用 r.db 会自锁）。
func lotsOf(tx *gorm.DB, partCode string) ([]domain.StockLot, error) {
	lots := []domain.StockLot{}
	err := tx.Where("part_code = ?", partCode).Order("received_at ASC").Order("lot_no ASC").Find(&lots).Error
	return lots, err
}

func (r *Repo) LotsOfPart(ctx context.Context, code string) ([]domain.StockLot, error) {
	return lotsOf(r.db.WithContext(ctx), code)
}

func (r *Repo) MovesOfPart(ctx context.Context, code string, limit int) ([]domain.MoveRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	rows := []domain.MoveRow{}
	err := r.db.WithContext(ctx).Raw(`SELECT id, part_code, lot_no, kind, qty_delta, unit_cost_cents,
		COALESCE(wo_no,'') AS wo_no, COALESCE(note,'') AS note, occurred_at
		FROM stock_moves WHERE part_code = ? ORDER BY id DESC LIMIT ?`, code, limit).Scan(&rows).Error
	return rows, err
}

// ---- 写路径 ----

// CreateOrder 建单。工单号 WO-YYYYMMDD-NNNN 在事务内按当日单数发号，
// 唯一冲突时同一个事务闭包里重算重试（绝不换连接）。
func (r *Repo) CreateOrder(ctx context.Context, in domain.CreateOrderInput, now time.Time) (*domain.WorkOrder, error) {
	var out *domain.WorkOrder
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		day := now.UTC().Format("20060102")
		prefix := "WO-" + day + "-"
		var last int64
		if err := tx.Raw(`SELECT COALESCE(COUNT(*),0) FROM work_orders WHERE wo_no LIKE ?`, prefix+"%").Scan(&last).Error; err != nil {
			return err
		}
		for attempt := 1; attempt <= 5; attempt++ {
			seq := int(last) + attempt
			no := fmt.Sprintf("%s%04d", prefix, seq)
			var dup int64
			if err := tx.Raw(`SELECT COUNT(*) FROM work_orders WHERE wo_no = ?`, no).Scan(&dup).Error; err != nil {
				return err
			}
			if dup > 0 {
				continue
			}
			wo := &domain.WorkOrder{
				WoNo:          no,
				PlateNo:       strings.TrimSpace(in.PlateNo),
				Model:         strings.TrimSpace(in.Model),
				CustomerName:  strings.TrimSpace(in.CustomerName),
				CustomerPhone: strings.TrimSpace(in.Phone),
				MileageKm:     in.MileageKm,
				Symptom:       strings.TrimSpace(in.Symptom),
				Status:        domain.WOReceived,
				Priority:      priorityOrDefault(in.Priority),
				Technician:    strings.TrimSpace(in.Technician),
				OpenedAt:      now.UTC(),
				PromisedAt:    now.UTC().Add(time.Duration(domain.PromiseHours(priorityOrDefault(in.Priority))) * time.Hour),
				UpdatedAt:     now.UTC(),
			}
			if err := tx.Create(wo).Error; err != nil {
				return err
			}
			created := *wo
			out = &created
			return nil
		}
		return domain.Wrap("wo_no_exhausted", "当日工单号已用尽，请重试", 500, errors.New("sequence exhausted"))
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func priorityOrDefault(p string) string {
	if p == "" {
		return domain.PriorityNormal
	}
	return p
}

// AddLaborLine 追加一条工时行。金额只由 domain.LaborAmount 算，写快照后不再重算。
// 门禁在仓储层再挡一次：service 挡的是 HTTP 入口，这里挡的是所有调用方。
func (r *Repo) AddLaborLine(ctx context.Context, orderID int64, in domain.AddLineInput, now time.Time) (*domain.OrderLineRow, error) {
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	var out *domain.OrderLineRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var status string
		if err := tx.Raw(`SELECT status FROM work_orders WHERE id = ?`, orderID).Scan(&status).Error; err != nil {
			return err
		}
		if status == "" {
			return domain.ErrNotFound
		}
		if !domain.LinesEditable(status) {
			return domain.New("lines_locked", "该工单已进入"+status+"，明细已锁定", 409)
		}
		line := &domain.WorkOrderLine{
			WorkOrderID:    orderID,
			Kind:           domain.LineLabor,
			Operation:      strings.TrimSpace(in.Operation),
			Grade:          in.Grade,
			DurationMin:    in.DurationMin,
			CostCents:      0,
			UnitCostCents:  domain.LaborRates[in.Grade],
			UnitPriceCents: domain.LaborRates[in.Grade],
			AmountCents:    domain.LaborAmount(in.DurationMin, in.Grade),
			Note:           strings.TrimSpace(in.Note),
			CreatedAt:      now.UTC(),
		}
		if err := tx.Create(line).Error; err != nil {
			return err
		}
		out = &domain.OrderLineRow{
			ID: line.ID, Kind: line.Kind, Operation: line.Operation, Grade: line.Grade,
			DurationMin: line.DurationMin, Qty: 0, UnitCostCents: line.UnitCostCents,
			AmountCents: line.AmountCents, Note: line.Note, CreatedAt: line.CreatedAt,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// IssuePart 是配件出库的唯一入口：事务内读批次 → PlanIssue 定 FIFO →
// 逐批扣减 → 逐批写流水（流水直接挂工单号）→ 写一行出库明细。缺件整单回滚。
func (r *Repo) IssuePart(ctx context.Context, orderID int64, partCode string, qty int, note string, now time.Time) (*domain.OrderLineRow, []domain.IssueLot, error) {
	var line domain.WorkOrderLine
	var steps []domain.IssueLot
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if !domain.SafeCodeRe(partCode, 16) {
			return domain.Field("invalid_request", "参数校验未通过",
				map[string]string{"part_code": "配件编码只允许字母/数字/-/_，且不超过 16 位"})
		}
		if qty <= 0 || qty > 999 {
			return domain.Field("invalid_request", "参数校验未通过",
				map[string]string{"qty": "出库数量需在 1 ~ 999 之间"})
		}
		var head struct {
			WoNo   string `gorm:"column:wo_no"`
			Status string `gorm:"column:status"`
		}
		if err := tx.Raw(`SELECT wo_no, status FROM work_orders WHERE id = ?`, orderID).Scan(&head).Error; err != nil {
			return err
		}
		if head.WoNo == "" {
			return domain.ErrNotFound
		}
		if !domain.LinesEditable(head.Status) {
			return domain.New("lines_locked", "该工单已进入"+head.Status+"，明细已锁定", 409)
		}
		var p domain.Part
		if err := tx.Where("code = ?", partCode).First(&p).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if p.Status != domain.PartActive {
			return domain.New("part_discontinued", "该配件已停用，不能出库", 409)
		}
		lots, err := lotsOf(tx, partCode)
		if err != nil {
			return err
		}
		plan, cost, missing := domain.PlanIssue(lots, qty)
		if missing > 0 {
			return domain.New("insufficient_stock",
				fmt.Sprintf("库存不足：需 %d 件，可用 %d 件", qty, qty-missing), 409)
		}
		for _, st := range plan {
			res := tx.Model(&domain.StockLot{}).
				Where("lot_no = ? AND qty_remaining >= ?", st.LotNo, st.Qty).
				UpdateColumn("qty_remaining", gorm.Expr("qty_remaining - ?", st.Qty))
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected != 1 {
				return domain.New("lot_race", "批次余量已变化，请重试", 409)
			}
			if err := tx.Create(&domain.StockMove{
				PartCode: partCode, LotNo: st.LotNo, Kind: domain.MoveIssue,
				QtyDelta: -st.Qty, UnitCostCents: st.UnitCostCents, WoNo: head.WoNo,
				Note: "工单出库", OccurredAt: now.UTC(),
			}).Error; err != nil {
				return err
			}
		}
		amount := domain.PriceLine(p.ListPriceCents, qty)
		line = domain.WorkOrderLine{
			WorkOrderID: orderID, Kind: domain.LinePart, PartCode: partCode, Qty: qty,
			CostCents: cost, UnitCostCents: domain.UnitCost(cost, qty),
			UnitPriceCents: p.ListPriceCents, AmountCents: amount,
			Note: strings.TrimSpace(note), CreatedAt: now.UTC(),
		}
		if err := tx.Create(&line).Error; err != nil {
			return err
		}
		steps = plan
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return &domain.OrderLineRow{
		ID: line.ID, Kind: line.Kind, PartCode: line.PartCode, Qty: line.Qty,
		UnitCostCents: line.UnitCostCents, CostCents: line.CostCents,
		UnitPriceCents: line.UnitPriceCents, AmountCents: line.AmountCents,
		Note: line.Note, CreatedAt: line.CreatedAt, PartName: line.PartCode,
	}, steps, nil
}

// AddReceipt 入库建批次：写一条批次 + 一条正向流水，账实相符从源头成立。
func (r *Repo) AddReceipt(ctx context.Context, in domain.ReceiptInput, now time.Time) (*domain.StockLot, error) {
	var expires *time.Time
	if in.ExpiresOn != "" {
		t, err := time.Parse("2006-01-02", in.ExpiresOn)
		if err != nil {
			return nil, domain.Field("invalid_request", "参数校验未通过",
				map[string]string{"expires_on": "有效期需为 YYYY-MM-DD"})
		}
		utc := t.UTC()
		expires = &utc
	}
	lot := &domain.StockLot{
		PartCode: in.PartCode, LotNo: in.LotNo, QtyReceived: in.Qty, QtyRemaining: in.Qty,
		UnitCostCents: in.UnitCostCents, Supplier: strings.TrimSpace(in.Supplier),
		ReceivedAt: now.UTC(), ExpiresAt: expires,
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 仓储层自己也要挡一遍：这里是不受信任输入进 SQL 前的最后一道门。
		if errs, ok := in.Validate(); !ok {
			return domain.Field("invalid_request", "参数校验未通过", errs)
		}
		var p domain.Part
		if err := tx.Where("code = ?", in.PartCode).First(&p).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if p.Status != domain.PartActive {
			return domain.New("part_discontinued", "该配件已停用，不能入库", 409)
		}
		if err := tx.Create(lot).Error; err != nil {
			if isUnique(err) {
				return domain.New("lot_exists", "批次号已存在", 409)
			}
			return err
		}
		return tx.Create(&domain.StockMove{
			PartCode: in.PartCode, LotNo: in.LotNo, Kind: domain.MoveReceipt,
			QtyDelta: in.Qty, UnitCostCents: in.UnitCostCents,
			Note: "入库建批：" + lot.Supplier, OccurredAt: now.UTC(),
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return lot, nil
}

// Transition 推进状态机。三条业务门：
//  1. 跃迁必须落在 woNext 表内；
//  2. 进质检要有工时行，进结算要有工时行且明细金额齐备（此刻把总额快照到单头）；
//  3. 作废要把该单已出库的配件按原批次退回，并写反向流水。
func (r *Repo) Transition(ctx context.Context, orderID int64, to, reason string, now time.Time) (*domain.WorkOrder, error) {
	var out *domain.WorkOrder
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var wo domain.WorkOrder
		if err := tx.Where("id = ?", orderID).First(&wo).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.CanTransition(wo.Status, to) {
			return domain.New("invalid_transition",
				fmt.Sprintf("%s 不能直接到 %s", wo.Status, to), 409)
		}
		lines := []domain.WorkOrderLine{}
		if err := tx.Where("work_order_id = ?", orderID).Find(&lines).Error; err != nil {
			return err
		}
		laborCount := 0
		for _, l := range lines {
			if l.Kind == domain.LineLabor {
				laborCount++
			}
		}
		switch to {
		case domain.WOQc:
			if laborCount == 0 {
				return domain.New("no_labor", "尚无工时记录，不能报完工质检", 409)
			}
		case domain.WOSettled:
			if laborCount == 0 {
				return domain.New("no_labor", "尚无工时记录，不能结算", 409)
			}
			labor, parts, grand := domain.SumLineTotals(lines)
			if grand <= 0 {
				return domain.New("empty_bill", "明细金额为 0，不能结算", 409)
			}
			wo.LaborTotalCents, wo.PartsTotalCents, wo.GrandTotalCents = labor, parts, grand
			wo.SettledAt = ptr(now.UTC())
		case domain.WOCancelled:
			if domain.ReturnStock(wo.Status) {
				if err := returnParts(tx, wo.WoNo, now); err != nil {
					return err
				}
			}
			wo.CancelReason = strings.TrimSpace(reason)
			wo.ClosedAt = ptr(now.UTC())
		case domain.WOPickedUp:
			wo.ClosedAt = ptr(now.UTC())
		}
		wo.Status = to
		wo.UpdatedAt = now.UTC()
		if err := tx.Save(&wo).Error; err != nil {
			return err
		}
		saved := wo
		out = &saved
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// returnParts 把某工单已出库的配件按原批次退回（FIFO 的逆操作：取回原批原量）。
func returnParts(tx *gorm.DB, woNo string, now time.Time) error {
	type row struct {
		LotNo         string
		PartCode      string
		QtyDelta      int
		UnitCostCents int64
	}
	var rows []row
	if err := tx.Raw(`SELECT lot_no, part_code, qty_delta, unit_cost_cents FROM stock_moves
		WHERE wo_no = ? AND kind = 'issue'`, woNo).Scan(&rows).Error; err != nil {
		return err
	}
	for _, m := range rows {
		qty := -m.QtyDelta
		if qty <= 0 {
			continue
		}
		res := tx.Model(&domain.StockLot{}).
			Where("lot_no = ?", m.LotNo).
			UpdateColumn("qty_remaining", gorm.Expr("qty_remaining + ?", qty))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return domain.New("lot_missing", "退回时找不到原批次", 409)
		}
		if err := tx.Create(&domain.StockMove{
			PartCode: m.PartCode, LotNo: m.LotNo, Kind: domain.MoveReturn,
			QtyDelta: qty, UnitCostCents: m.UnitCostCents, WoNo: woNo,
			Note: "工单作废退料", OccurredAt: now.UTC(),
		}).Error; err != nil {
			return err
		}
	}
	return tx.Model(&domain.StockMove{}).Where("wo_no = ? AND kind = 'issue'", woNo).
		Update("note", "工单作废退料（原出库已冲销）").Error
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "unique")
}

func ptr(t time.Time) *time.Time { return &t }
