package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"etk/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func (r *Repo) DB() *gorm.DB { return r.db }

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	if err := r.db.WithContext(ctx).Model(&domain.Event{}).Count(&n).Error; err != nil {
		return false, err
	}
	return n > 0, nil
}

// escapeLike 让搜索串里的 % 与 _ 只当字面量（配 ESCAPE '\' 使用）。
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func codeOf(ctx context.Context, tx *gorm.DB, table, prefix string, now time.Time) (string, error) {
	day := now.Format("060102")
	var n int64
	like := prefix + day + "-%"
	if err := tx.Table(table).Where("code LIKE ?", like).Count(&n).Error; err != nil {
		return "", err
	}
	for attempt := int64(0); attempt < 400; attempt++ {
		code := fmt.Sprintf("%s%s-%03d", prefix, day, n+1+attempt)
		var dup int64
		if err := tx.Table(table).Where("code = ?", code).Count(&dup).Error; err != nil {
			return "", err
		}
		if dup == 0 {
			return code, nil
		}
	}
	return "", domain.Wrap("conflict", "单号已耗尽，请稍后再试", 409, errors.New("code space exhausted"))
}

// ---- 读取视图 SQL ----

// eventsSrc：票档与票券的聚合各自先成子查询再回接，
// 直接把 ticket_types LEFT JOIN 进 events 会把场次行放大、配额与营收全部翻倍。
const eventsSrc = `FROM (
	SELECT e.*,
	       COALESCE(a.type_count,0) AS type_count,
	       COALESCE(a.quota_total,0) AS quota_total,
	       COALESCE(a.sold_total,0) AS sold_total,
	       COALESCE(a.min_unit,0) AS min_unit_cent,
	       COALESCE(t.valid_tickets,0) AS valid_tickets,
	       COALESCE(t.used_tickets,0) AS used_tickets,
	       COALESCE(t.void_tickets,0) AS void_tickets,
	       COALESCE(o.gross_cent,0) AS gross_cent
	FROM events e
	LEFT JOIN (
		SELECT event_id, COUNT(*) AS type_count, COALESCE(SUM(quota),0) AS quota_total,
		       COALESCE(SUM(sold_quantity),0) AS sold_total,
		       MIN(CASE WHEN status = 'open' THEN unit_cent END) AS min_unit
		FROM ticket_types GROUP BY event_id
	) a ON a.event_id = e.id
	LEFT JOIN (
		SELECT event_id,
		       SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) AS valid_tickets,
		       SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_tickets,
		       SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void_tickets
		FROM tickets GROUP BY event_id
	) t ON t.event_id = e.id
	LEFT JOIN (
		SELECT event_id, COALESCE(SUM(payable_cent),0) AS gross_cent
		FROM orders WHERE status IN ('paid','refunded') GROUP BY event_id
	) o ON o.event_id = e.id
) AS e`

const eventsSelect = `e.*`

func (r *Repo) ListEvents(ctx context.Context, q domain.EventQuery, now time.Time) ([]domain.EventRow, int64, error) {
	where := []string{}
	args := []any{}
	if q.Status != "" {
		where = append(where, "e.status = ?")
		args = append(args, q.Status)
	}
	if q.Category != "" {
		where = append(where, "e.category = ?")
		args = append(args, q.Category)
	}
	if q.City != "" {
		where = append(where, "e.city = ?")
		args = append(args, q.City)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		where = append(where, `(e.title LIKE ? ESCAPE '\' OR e.code LIKE ? ESCAPE '\' OR e.artist LIKE ? ESCAPE '\' OR e.venue LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like, like)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	var total int64
	if err := r.db.WithContext(ctx).Raw("SELECT COUNT(*) "+eventsSrc+clause, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.EventRow
	sql := "SELECT " + eventsSelect + " " + eventsSrc + clause +
		" ORDER BY " + q.SortCol + " " + strings.ToUpper(q.Dir) + ", e.id ASC LIMIT ? OFFSET ?"
	listArgs := append(append([]any{}, args...), q.PageSize, q.Offset())
	if err := r.db.WithContext(ctx).Raw(sql, listArgs...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	for i := range rows {
		DecorateEvent(&rows[i], now)
	}
	return rows, total, nil
}

// DecorateEvent 把「此刻」相关的派生位算出来：早鸟是否仍在跑、闸口是否开合。
// 这些不进 SQL——它们随墙钟变化，落库即漂移。
func DecorateEvent(row *domain.EventRow, now time.Time) {
	row.EarlyLive = !row.PresaleEnd.IsZero() && now.Before(row.PresaleEnd) && row.Status == domain.EventOnSale
	if row.QuotaTotal > 0 {
		row.SellThroughBp = row.SoldTotal * domain.BasisPoint / row.QuotaTotal
	}
	v := domain.WindowFor(row.Status, row.DoorsAt, row.StartAt, now)
	row.CheckinOpen = v.Allowed
	if !v.Allowed {
		row.CheckinWhy = v.Code
	}
}

func (r *Repo) EventByCode(ctx context.Context, code string) (*domain.Event, error) {
	var e domain.Event
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repo) EventByID(ctx context.Context, id int64) (*domain.Event, error) {
	var e domain.Event
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repo) EventRowByCode(ctx context.Context, code string, now time.Time) (*domain.EventRow, error) {
	var rows []domain.EventRow
	sql := "SELECT " + eventsSelect + " " + eventsSrc + " WHERE e.code = ? LIMIT 1"
	if err := r.db.WithContext(ctx).Raw(sql, code).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	DecorateEvent(&rows[0], now)
	return &rows[0], nil
}

// TypeRollupFor 把票档的实时可售口径算出来（含早鸟现价与配额余量）。
func (r *Repo) TypeRollupFor(ctx context.Context, eventID int64, e *domain.Event, now time.Time) ([]domain.TypeRollup, error) {
	var types []domain.TicketType
	if err := r.db.WithContext(ctx).Where("event_id = ?", eventID).Order("unit_cent asc, id asc").Find(&types).Error; err != nil {
		return nil, err
	}
	agg := map[int64][3]int64{}
	var rows []struct {
		TypeID  int64
		ValidN  int64
		UsedN   int64
		VoidCnt int64
	}
	err := r.db.WithContext(ctx).Raw(`SELECT type_id,
		SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END) AS valid_n,
		SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_n,
		SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void_cnt
		FROM tickets WHERE event_id = ? GROUP BY type_id`, eventID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, a := range rows {
		agg[a.TypeID] = [3]int64{a.ValidN, a.UsedN, a.VoidCnt}
	}
	res := make([]domain.TypeRollup, 0, len(types))
	for _, t := range types {
		c := agg[t.ID]
		remaining := t.Quota - t.Sold
		if remaining < 0 {
			remaining = 0
		}
		res = append(res, domain.TypeRollup{
			TypeCode: t.Code, TypeName: t.Name, Zone: t.Zone,
			UnitCent: t.UnitCent, ServiceCent: t.ServiceCent, EarlyBps: t.EarlyBps,
			NowUnitCent: domain.UnitAt(t.UnitCent, domain.EarlyDiscountBps(&t, e, now)),
			Quota:       t.Quota, Sold: t.Sold, Remaining: remaining,
			ValidTickets: c[0], UsedTickets: c[1], VoidTickets: c[2],
			Status: t.Status, Seated: t.Seated,
		})
	}
	return res, nil
}

const ordersSrc = `FROM orders o
	JOIN events ev ON ev.id = o.event_id
	JOIN ticket_types tt ON tt.id = o.type_id
	LEFT JOIN (
		SELECT order_id,
		       COUNT(*) AS ticket_count,
		       SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used_count,
		       SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void_count
		FROM tickets GROUP BY order_id
	) tk ON tk.order_id = o.id`

const ordersSelect = `o.*, ev.code AS event_code, ev.title AS event_title, ev.city, tt.code AS type_code, tt.name AS type_name,
	COALESCE(tk.ticket_count,0) AS ticket_count, COALESCE(tk.used_count,0) AS used_count, COALESCE(tk.void_count,0) AS void_count`

func (r *Repo) ListOrders(ctx context.Context, q domain.OrderQuery, now time.Time) ([]domain.OrderView, int64, error) {
	where := []string{}
	args := []any{}
	if q.Status != "" {
		where = append(where, "o.status = ?")
		args = append(args, q.Status)
	}
	if q.Channel != "" {
		where = append(where, "o.channel = ?")
		args = append(args, q.Channel)
	}
	if q.Event != "" {
		where = append(where, "ev.code = ?")
		args = append(args, q.Event)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		where = append(where, `(o.code LIKE ? ESCAPE '\' OR o.buyer LIKE ? ESCAPE '\' OR ev.title LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	var total int64
	if err := r.db.WithContext(ctx).Raw("SELECT COUNT(*) "+ordersSrc+clause, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.OrderView
	sql := "SELECT " + ordersSelect + " " + ordersSrc + clause +
		" ORDER BY " + q.SortCol + " " + strings.ToUpper(q.Dir) + ", o.id ASC LIMIT ? OFFSET ?"
	listArgs := append(append([]any{}, args...), q.PageSize, q.Offset())
	if err := r.db.WithContext(ctx).Raw(sql, listArgs...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	r.decorateOrders(ctx, rows, now)
	return rows, total, nil
}

func (r *Repo) decorateOrders(ctx context.Context, rows []domain.OrderView, now time.Time) {
	eventCache := map[int64]*domain.Event{}
	for i := range rows {
		row := &rows[i]
		row.PhoneMasked = domain.PhoneMasked(row.Phone)
		e, ok := eventCache[row.EventID]
		if !ok {
			var loaded domain.Event
			if err := r.db.WithContext(ctx).Select("id, code, status, start_at, refund_cutoff_hours").
				Where("id = ?", row.EventID).First(&loaded).Error; err == nil {
				e = &loaded
				eventCache[row.EventID] = e
			}
		}
		v, _ := domain.RefundVerdict(&row.Order, e, row.UsedCount, row.VoidCount, now)
		row.Refundable = v.Allowed
		if !v.Allowed {
			row.RefundWhy = v.Code
		}
	}
}

func (r *Repo) OrderByCode(ctx context.Context, code string, now time.Time) (*domain.OrderView, error) {
	var rows []domain.OrderView
	sql := "SELECT " + ordersSelect + " " + ordersSrc + " WHERE o.code = ? LIMIT 1"
	if err := r.db.WithContext(ctx).Raw(sql, code).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	r.decorateOrders(ctx, rows[:1], now)
	return &rows[0], nil
}

const ticketsSrc = `FROM tickets t
	JOIN orders o ON o.id = t.order_id
	JOIN events ev ON ev.id = t.event_id
	JOIN ticket_types tt ON tt.id = t.type_id`

const ticketsSelect = `t.*, o.code AS order_code, o.buyer, o.phone, o.unit_cent, o.service_cent,
	ev.code AS event_code, ev.title AS event_title, ev.status AS event_status,
	ev.doors_at, ev.start_at, ev.gates AS gates_raw,
	tt.name AS type_name, tt.zone AS zone_name`

func (r *Repo) ListTickets(ctx context.Context, q domain.TicketQuery, now time.Time) ([]domain.TicketView, int64, error) {
	where := []string{}
	args := []any{}
	if q.Status != "" {
		where = append(where, "t.status = ?")
		args = append(args, q.Status)
	}
	if q.Event != "" {
		where = append(where, "ev.code = ?")
		args = append(args, q.Event)
	}
	if q.Type != "" {
		where = append(where, "tt.code = ?")
		args = append(args, q.Type)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		where = append(where, `(t.code LIKE ? ESCAPE '\' OR o.code LIKE ? ESCAPE '\' OR t.seat_zone LIKE ? ESCAPE '\' OR t.seat_row LIKE ? ESCAPE '\')`)
		args = append(args, like, like, like, like)
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	var total int64
	if err := r.db.WithContext(ctx).Raw("SELECT COUNT(*) "+ticketsSrc+clause, args...).Scan(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.TicketView
	sql := "SELECT " + ticketsSelect + " " + ticketsSrc + clause +
		" ORDER BY " + q.SortCol + " " + strings.ToUpper(q.Dir) + ", t.id ASC LIMIT ? OFFSET ?"
	listArgs := append(append([]any{}, args...), q.PageSize, q.Offset())
	if err := r.db.WithContext(ctx).Raw(sql, listArgs...).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	for i := range rows {
		DecorateTicket(&rows[i], now)
	}
	return rows, total, nil
}

func (r *Repo) TicketByCode(ctx context.Context, code string, now time.Time) (*domain.TicketView, error) {
	var rows []domain.TicketView
	sql := "SELECT " + ticketsSelect + " " + ticketsSrc + " WHERE t.code = ? LIMIT 1"
	if err := r.db.WithContext(ctx).Raw(sql, code).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, domain.ErrNotFound
	}
	DecorateTicket(&rows[0], now)
	return &rows[0], nil
}

func DecorateTicket(row *domain.TicketView, now time.Time) {
	row.SeatLabel = row.Ticket.SeatText()
	row.Gates = domain.GateList(row.GatesRaw)
	row.PhoneMasked = domain.PhoneMasked(row.Phone)
	v := domain.WindowFor(row.EventStatus, row.DoorsAt, row.StartAt, now)
	v = domain.TicketVerdict(&row.Ticket, v)
	row.Checkinable = v.Allowed
	if !v.Allowed {
		row.CheckinWhy = v.Code
	}
}

// ---- 写入 ----

func (r *Repo) CreateEvent(ctx context.Context, in domain.CreateEventInput, now time.Time) (*domain.Event, error) {
	doors, _ := time.Parse(time.RFC3339, in.DoorsAt)
	start, _ := time.Parse(time.RFC3339, in.StartAt)
	presale, _ := time.Parse(time.RFC3339, in.PresaleEnd)
	e := &domain.Event{
		Code: in.Code, Title: in.Title, Artist: in.Artist, Category: in.Category,
		Venue: in.Venue, City: in.City, Gates: in.Gates,
		DoorsAt: doors.UTC(), StartAt: start.UTC(), OnSaleAt: now, PresaleEnd: presale.UTC(),
		Status: domain.EventDraft, RefundCutH: in.RefundCutHours, Note: in.Note, CreatedAt: now,
	}
	err := r.db.WithContext(ctx).Create(e).Error
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return nil, domain.Wrap("conflict", "场次编号已存在", 409, err)
	}
	if err != nil {
		return nil, err
	}
	return e, nil
}

// SetEventStatus 只允许状态机里存在的跃迁；closed 时写 closed_at。
func (r *Repo) SetEventStatus(ctx context.Context, code, to string, now time.Time) (*domain.Event, error) {
	var out *domain.Event
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var e domain.Event
		if err := tx.Where("code = ?", code).First(&e).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.NextEventStatus(e.Status, to) {
			return domain.New("conflict", "场次状态不能从 "+e.Status+" 变为 "+to, 409)
		}
		updates := map[string]any{"status": to}
		if to == domain.EventClosed {
			updates["closed_at"] = now
		}
		if err := tx.Model(&domain.Event{}).Where("id = ?", e.ID).Updates(updates).Error; err != nil {
			return err
		}
		e.Status = to
		if to == domain.EventClosed {
			t := now
			e.ClosedAt = &t
		}
		out = &e
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Sale 是一次「出票并当场收款」：校验场次与票档 → 事务内扣配额 → 建单 → 逐张出票。
// 单写者（SetMaxOpenConns(1) + txlock immediate）保证同事务内的读不会被别人插队，
// 因此这里的「先读 sold 再写 sold」不需要额外的行锁。
func (r *Repo) Sale(ctx context.Context, in domain.SaleInput, now time.Time) (*domain.OrderView, []domain.Ticket, error) {
	var view *domain.OrderView
	var tickets []domain.Ticket
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var ev domain.Event
		if err := tx.Where("code = ?", in.EventCode).First(&ev).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if ev.Status != domain.EventOnSale {
			switch ev.Status {
			case domain.EventDraft:
				return domain.New("conflict", "场次尚未开票", 409)
			case domain.EventClosed:
				return domain.New("conflict", "场次已散场，停止售票", 409)
			default:
				return domain.New("conflict", "场次已取消", 409)
			}
		}
		var tt domain.TicketType
		if err := tx.Where("code = ?", in.TypeCode).First(&tt).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if tt.EventID != ev.ID {
			return domain.New("conflict", "票档不属于该场次", 409)
		}
		if tt.Status != domain.TypeOpen {
			return domain.New("conflict", "票档已停售", 409)
		}
		remaining := tt.Quota - tt.Sold
		if in.Quantity > remaining {
			return domain.New("sold_out", fmt.Sprintf("票档余量不足，仅剩 %d 张", remaining), 409)
		}
		qty := in.Quantity
		bps := domain.EarlyDiscountBps(&tt, &ev, now)
		tot := domain.TotalsFor(tt.UnitCent, tt.ServiceCent, bps, bps > 0, qty)

		orderCode, err := codeOf(ctx, tx, "orders", "ET", now)
		if err != nil {
			return err
		}
		paidAt := now
		order := &domain.Order{
			Code: orderCode, EventID: ev.ID, TypeID: tt.ID,
			Buyer: in.Buyer, Phone: in.Phone, Channel: in.Channel, Quantity: qty,
			UnitCent: tot.UnitCent, ServiceCent: tt.ServiceCent, DiscountBps: tot.DiscountBps,
			SubtotalCent: tot.SubtotalCent, FeeCent: tot.FeeCent, PayableCent: tot.PayableCent,
			Status: domain.OrderPaid, CreatedAt: now, PaidAt: &paidAt,
			LastFourDigits: tailDigits(in.Phone, 4),
		}
		if err := tx.Create(order).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return domain.Wrap("conflict", "订单编号冲突，请重试", 409, err)
			}
			return err
		}
		stub := strings.TrimPrefix(orderCode, "ET")
		for i := int64(1); i <= qty; i++ {
			seq := tt.Sold + i
			zone, row, no := domain.SeatLabel(tt.Zone, tt.Seated, seq, domain.SeatsPerRow)
			tickets = append(tickets, domain.Ticket{
				Code:    fmt.Sprintf("TK%s-%d", stub, i),
				OrderID: order.ID, EventID: ev.ID, TypeID: tt.ID, Seq: seq,
				SeatZone: zone, SeatRow: row, SeatNo: no,
				Status: domain.TicketValid, IssuedAt: now,
			})
		}
		if err := tx.Create(&tickets).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				return domain.Wrap("conflict", "票号冲突，请重试", 409, err)
			}
			return err
		}
		if err := tx.Model(&domain.TicketType{}).Where("id = ?", tt.ID).
			UpdateColumn("sold_quantity", gorm.Expr("sold_quantity + ?", qty)).Error; err != nil {
			return err
		}
		// 票档售完只在读侧派生（quota==sold），不落 status：双写必然漂移。
		view = &domain.OrderView{Order: *order, EventCode: ev.Code, EventTitle: ev.Title, City: ev.City,
			TypeCode: tt.Code, TypeName: tt.Name, TicketCount: qty}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	view.PhoneMasked = domain.PhoneMasked(view.Phone)
	view.Refundable = true
	return view, tickets, nil
}

func tailDigits(s string, n int) string {
	digits := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if c := s[i]; c >= '0' && c <= '9' {
			digits = append(digits, c)
		}
	}
	if len(digits) < n {
		return string(digits)
	}
	return string(digits[len(digits)-n:])
}

// CheckIn 核销一张票：闸门 + 窗口 + 票态三重裁决，任一不过都不写库。
func (r *Repo) CheckIn(ctx context.Context, ticketCode, gate string, now time.Time) (*domain.TicketView, string, error) {
	var out *domain.TicketView
	var msg string
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var t domain.Ticket
		if err := tx.Where("code = ?", ticketCode).First(&t).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		var ev domain.Event
		if err := tx.Where("id = ?", t.EventID).First(&ev).Error; err != nil {
			return err
		}
		v := domain.WindowFor(ev.Status, ev.DoorsAt, ev.StartAt, now)
		v = domain.TicketVerdict(&t, v)
		if !v.Allowed {
			return domain.New(v.Code, v.Message, 409)
		}
		gv := domain.GateVerdict(domain.GateList(ev.Gates), gate)
		if !gv.Allowed {
			return domain.New(gv.Code, gv.Message, 400)
		}
		updates := map[string]any{"status": domain.TicketUsed, "used_at": now, "gate": strings.ToUpper(strings.TrimSpace(gate))}
		if err := tx.Model(&domain.Ticket{}).Where("id = ? AND status = ?", t.ID, domain.TicketValid).Updates(updates).Error; err != nil {
			return err
		}
		var fresh domain.Ticket
		if err := tx.Where("id = ?", t.ID).First(&fresh).Error; err != nil {
			return err
		}
		if fresh.Status != domain.TicketUsed {
			return domain.New("already_used", "该票刚被其它闸口检过", 409)
		}
		normalized := strings.ToUpper(strings.TrimSpace(gate))
		msg = fmt.Sprintf("核验通过：%s 进 %s 闸口", fresh.SeatText(), normalized)
		view := &domain.TicketView{Ticket: fresh, EventCode: ev.Code, EventTitle: ev.Title,
			EventStatus: ev.Status, DoorsAt: ev.DoorsAt, StartAt: ev.StartAt, GatesRaw: ev.Gates}
		out = view
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	// 出票人/票档名要额外一次 JOIN，事务外补即可（不影响裁决）。
	full, err := r.TicketByCode(ctx, out.Code, now)
	if err != nil {
		return out, msg, nil
	}
	return full, msg, nil
}

// Refund 整单退票：票全部作废、配额回吐、服务费留存。
// 铁律——事务内只写状态、任何业务失败都 return nil 之后再抛 409，
// 否则同事务里刚写的 void 会被一起回滚（第 13 轮踩过的 GORM 事务坑）。
func (r *Repo) Refund(ctx context.Context, orderCode, reason string, now time.Time) (*domain.OrderView, int64, error) {
	var view *domain.OrderView
	var refundCent int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var o domain.Order
		if err := tx.Where("code = ?", orderCode).First(&o).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		var ev domain.Event
		if err := tx.Where("id = ?", o.EventID).First(&ev).Error; err != nil {
			return err
		}
		var usedCount, voidCount, validCount int64
		if err := tx.Model(&domain.Ticket{}).Where("order_id = ? AND status = ?", o.ID, domain.TicketUsed).Count(&usedCount).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Ticket{}).Where("order_id = ? AND status = ?", o.ID, domain.TicketVoid).Count(&voidCount).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Ticket{}).Where("order_id = ? AND status = ?", o.ID, domain.TicketValid).Count(&validCount).Error; err != nil {
			return err
		}
		v, amount := domain.RefundVerdict(&o, &ev, usedCount, voidCount, now)
		if !v.Allowed {
			return domain.New(v.Code, v.Message, 409)
		}
		if amount <= 0 {
			return domain.New("zero_refund", "可退金额为 0，无需退票", 409)
		}
		if validCount == 0 {
			return domain.New("no_tickets", "该订单没有可作废的在效票", 409)
		}
		updates := map[string]any{
			"status": domain.OrderRefunded, "refunded_at": now,
			"refunded_cent": amount, "retained_cent": o.PayableCent - amount,
			"refund_reason": reason,
		}
		if err := tx.Model(&domain.Order{}).Where("id = ?", o.ID).Updates(updates).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Ticket{}).Where("order_id = ? AND status = ?", o.ID, domain.TicketValid).
			UpdateColumn("status", domain.TicketVoid).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.TicketType{}).Where("id = ?", o.TypeID).
			UpdateColumn("sold_quantity", gorm.Expr("sold_quantity - ?", validCount)).Error; err != nil {
			return err
		}
		refundCent = amount
		o.Status = domain.OrderRefunded
		o.RefundedCent = amount
		o.RetainedCent = o.PayableCent - amount
		t := now
		o.RefundedAt = &t
		o.RefundReason = reason
		view = &domain.OrderView{Order: o, EventCode: ev.Code, EventTitle: ev.Title, City: ev.City}
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	full, err := r.OrderByCode(ctx, view.Code, now)
	if err != nil {
		return view, refundCent, nil
	}
	return full, refundCent, nil
}
