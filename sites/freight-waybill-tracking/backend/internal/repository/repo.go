package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func (r *Repo) DB() *gorm.DB { return r.db }

// ---- 线路与规则 ----

func (r *Repo) Lanes(ctx context.Context, activeOnly bool) ([]domain.Lane, error) {
	var out []domain.Lane
	q := r.db.WithContext(ctx).Order("distance_km asc, code asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	if err := q.Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repo) LaneByCode(ctx context.Context, code string) (*domain.Lane, error) {
	var l domain.Lane
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&l).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (r *Repo) Rules(ctx context.Context, activeOnly bool) ([]domain.SurchargeRule, error) {
	var out []domain.SurchargeRule
	q := r.db.WithContext(ctx).Order("priority asc, code asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	if err := q.Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repo) CreateRule(ctx context.Context, rule *domain.SurchargeRule) error {
	err := r.db.WithContext(ctx).Create(rule).Error
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return domain.Wrap("conflict", "规则标识已存在", 409, err)
	}
	return err
}

func (r *Repo) ToggleRule(ctx context.Context, id int64) (*domain.SurchargeRule, error) {
	var out domain.SurchargeRule
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var cur domain.SurchargeRule
		if err := tx.First(&cur, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		cur.Active = !cur.Active
		if err := tx.Model(&domain.SurchargeRule{}).Where("id = ?", cur.ID).
			Update("active", cur.Active).Error; err != nil {
			return err
		}
		out = cur
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- 运单读取 ----

const waybillSelect = `w.*, l.code AS lane_code, l.origin, l.destination, l.tier, l.promise_days`

func (r *Repo) ListWaybills(ctx context.Context, q domain.ListQuery) ([]domain.WaybillRow, int64, error) {
	base := r.db.WithContext(ctx).Table("waybills AS w").
		Joins("JOIN lanes l ON l.id = w.lane_id")
	if q.Status != "" {
		base = base.Where("w.status = ?", q.Status)
	}
	if q.LaneCode != "" {
		base = base.Where("l.code = ?", q.LaneCode)
	}
	if q.Tier != "" {
		base = base.Where("l.tier = ?", q.Tier)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(w.code LIKE ? ESCAPE '\\' OR w.shipper_name LIKE ? ESCAPE '\\')", like, like)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// leg_count 用相关子查询：把它塞进同一条 LEFT JOIN 聚合会被事件行数放大。
	sel := waybillSelect + `, (SELECT COUNT(*) FROM scan_events e WHERE e.waybill_id = w.id) AS leg_count`
	var rows []domain.WaybillRow
	err := base.Select(sel).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", w.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		decorate(&rows[i])
	}
	return rows, total, nil
}

func (r *Repo) WaybillByCode(ctx context.Context, code string) (*domain.WaybillDetail, error) {
	var row domain.WaybillRow
	err := r.db.WithContext(ctx).Table("waybills AS w").
		Select(waybillSelect).
		Joins("JOIN lanes l ON l.id = w.lane_id").
		Where("w.code = ?", code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	decorate(&row)
	var events []domain.ScanEvent
	if err := r.db.WithContext(ctx).Where("waybill_id = ?", row.ID).
		Order("seq desc").Find(&events).Error; err != nil {
		return nil, err
	}
	if events == nil {
		events = []domain.ScanEvent{}
	}
	return &domain.WaybillDetail{WaybillRow: row, Events: events}, nil
}

// decorate 补齐只在出口存在的派生字段：脱敏手机号与附加费明细。
// 原文手机号在这里就被抹掉，任何出口都不可能带出 11 位号码。
func decorate(row *domain.WaybillRow) {
	row.PhoneMasked = domain.MaskPhone(row.Phone)
	row.Phone = ""
	row.SurchargeItems = decodeItems(row.SurchargeDetail)
}

func decodeItems(raw string) []domain.SurchargeItem {
	if strings.TrimSpace(raw) == "" {
		return []domain.SurchargeItem{}
	}
	var out []domain.SurchargeItem
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []domain.SurchargeItem{}
	}
	return out
}

func encodeItems(items []domain.SurchargeItem) string {
	if len(items) == 0 {
		return "[]"
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "[]"
	}
	return string(b)
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

// ---- 运单写入 ----

// CreateWaybill 在一个事务里发号、落计价快照、写首条轨迹。
// 单写者 + txlock(immediate) 下，闭包内所有查询都必须用 tx。
func (r *Repo) CreateWaybill(ctx context.Context, in domain.CreateWaybillInput, q *domain.Quote, lane *domain.Lane, now time.Time, node string) (*domain.WaybillDetail, error) {
	day := businessDate(now)
	prefix := "FY" + day + "-"
	created := ""
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var seq int64
		if err := tx.Model(&domain.Waybill{}).Where("code LIKE ? ESCAPE '\\'", prefix+"%").
			Count(&seq).Error; err != nil {
			return err
		}
		for attempt := 0; attempt < 5; attempt++ {
			code := fmt.Sprintf("%s%04d", prefix, seq+1+int64(attempt))
			w := &domain.Waybill{
				Code: code, LaneID: lane.ID, Status: domain.StBooked,
				ShipperName: in.ShipperName, Phone: in.Phone,
				PieceCount: in.PieceCount, WeightGrams: in.WeightGrams,
				VolumeCm3: in.VolumeCm3, HeaviestG: in.HeaviestG,
				DeclaredCents: in.DeclaredCents, Fragile: in.Fragile, RemoteArea: lane.RemoteArea,
				VolumetricGrams: q.VolumetricGrams, ChargeableGrams: q.ChargeableGrams,
				FreightCents: q.FreightCents, FuelCents: q.FuelCents,
				InsuranceCents: q.InsuranceCents, SurchargeCents: q.SurchargeCents,
				TotalCents: q.TotalCents, SurchargeDetail: encodeItems(q.Items),
				SurchargeCapped: q.Capped,
				BookedAt:        now, PromisedAt: now.AddDate(0, 0, lane.PromiseDays),
				UpdatedAt: now,
			}
			if err := tx.Create(w).Error; err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") {
					// 号段被并发占用：在同一事务内重算，绝不回头用 r.db。
					var again int64
					if e := tx.Model(&domain.Waybill{}).Where("code LIKE ? ESCAPE '\\'", prefix+"%").
						Count(&again).Error; e != nil {
						return e
					}
					seq = again
					continue
				}
				return err
			}
			ev := domain.ScanEvent{WaybillID: w.ID, Seq: 1, EventType: domain.StBooked,
				Node: node, Note: "电子运单已生成，等待揽收", OccurredAt: now}
			if err := tx.Create(&ev).Error; err != nil {
				return err
			}
			created = code
			return nil
		}
		return domain.New("conflict", "运单号发号冲突，请稍后重试", 409)
	})
	if err != nil {
		return nil, err
	}
	return r.WaybillByCode(ctx, created)
}

// businessDate 是全仓统一的业务日历日（UTC+8）：种子、发号、统计三处必须同口径，
// 否则 UTC 16:00 之后开的单会落到「昨天」的号段，与统计的今日对不上。
func businessDate(now time.Time) string {
	return now.UTC().Add(8 * time.Hour).Format("20060102")
}

// Advance 在事务内按「已有最大 seq + 1」写轨迹，并推进状态。
func (r *Repo) Advance(ctx context.Context, code, to, node, note string, now time.Time) (*domain.WaybillDetail, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var w domain.Waybill
		if err := tx.Where("code = ?", code).First(&w).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.CanAdvance(w.Status, to) {
			return domain.New("invalid_transition",
				fmt.Sprintf("不允许从「%s」推进到「%s」", w.Status, to), 409)
		}
		var maxSeq int64
		if err := tx.Model(&domain.ScanEvent{}).Where("waybill_id = ?", w.ID).
			Select("COALESCE(MAX(seq),0)").Scan(&maxSeq).Error; err != nil {
			return err
		}
		patch := map[string]any{"status": to, "updated_at": now}
		if to == domain.StDelivered {
			patch["delivered_at"] = now
		}
		if err := tx.Model(&domain.Waybill{}).Where("id = ?", w.ID).Updates(patch).Error; err != nil {
			return err
		}
		ev := domain.ScanEvent{WaybillID: w.ID, Seq: int(maxSeq) + 1, EventType: to,
			Node: node, Note: note, OccurredAt: now}
		return tx.Create(&ev).Error
	})
	if err != nil {
		return nil, err
	}
	return r.WaybillByCode(ctx, code)
}
