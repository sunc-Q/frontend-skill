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

// ---- 桩、车与价目规则 ----

func (r *Repo) Piles(ctx context.Context) ([]domain.PileRow, error) {
	var piles []domain.Pile
	if err := r.db.WithContext(ctx).Order("station asc, code asc").Find(&piles).Error; err != nil {
		return nil, err
	}
	out := make([]domain.PileRow, 0, len(piles))
	for _, p := range piles {
		row := domain.PileRow{Pile: p}
		// 相关子查询而非 LEFT JOIN 聚合：多口径塞同一条 JOIN 会被行数放大（历史轮踩过的口径级 bug）。
		if err := r.db.WithContext(ctx).Table("charge_sessions").
			Where("pile_id = ?", p.ID).Count(&row.Sessions).Error; err != nil {
			return nil, err
		}
		if err := r.db.WithContext(ctx).Table("charge_sessions").
			Where("pile_id = ? AND status IN ?", p.ID, []string{domain.SessCharging, domain.SessFaulted}).
			Count(&row.OpenSessions).Error; err != nil {
			return nil, err
		}
		var kwh int64
		if err := r.db.WithContext(ctx).Table("charge_sessions").
			Where("pile_id = ? AND status = ?", p.ID, domain.SessCompleted).
			Select("COALESCE(SUM(actual_wh),0)/1000").Scan(&kwh).Error; err != nil {
			return nil, err
		}
		row.EnergyKwh = kwh
		out = append(out, row)
	}
	return out, nil
}

func (r *Repo) Vehicles(ctx context.Context, activeOnly bool) ([]domain.VehicleRow, error) {
	var vs []domain.Vehicle
	q := r.db.WithContext(ctx).Order("dept asc, plate_no asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	if err := q.Find(&vs).Error; err != nil {
		return nil, err
	}
	out := make([]domain.VehicleRow, 0, len(vs))
	for _, v := range vs {
		row := domain.VehicleRow{Vehicle: v}
		row.PhoneMasked = domain.MaskPhone(v.Phone)
		row.Phone = "" // 原文在这里就被抹掉，任何出口都不可能带出 11 位号码
		if err := r.db.WithContext(ctx).Table("charge_sessions").
			Where("vehicle_id = ?", v.ID).Count(&row.Sessions).Error; err != nil {
			return nil, err
		}
		var kwh int64
		if err := r.db.WithContext(ctx).Table("charge_sessions").
			Where("vehicle_id = ? AND status = ?", v.ID, domain.SessCompleted).
			Select("COALESCE(SUM(actual_wh),0)/1000").Scan(&kwh).Error; err != nil {
			return nil, err
		}
		row.EnergyKwh = kwh
		out = append(out, row)
	}
	return out, nil
}

func (r *Repo) VehicleByPlate(ctx context.Context, plate string) (*domain.Vehicle, error) {
	var v domain.Vehicle
	err := r.db.WithContext(ctx).Where("plate_no = ?", plate).First(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *Repo) PileByCode(ctx context.Context, code string) (*domain.Pile, error) {
	var p domain.Pile
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (r *Repo) Tariffs(ctx context.Context, activeOnly bool) ([]domain.TariffRule, error) {
	var out []domain.TariffRule
	q := r.db.WithContext(ctx).Order("rule_priority asc, code asc")
	if activeOnly {
		q = q.Where("active = ?", true)
	}
	if err := q.Find(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repo) TariffByID(ctx context.Context, id int64) (*domain.TariffRule, error) {
	var t domain.TariffRule
	err := r.db.WithContext(ctx).First(&t, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (r *Repo) CreateTariff(ctx context.Context, rule *domain.TariffRule) error {
	err := r.db.WithContext(ctx).Create(rule).Error
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "unique") {
		return domain.Wrap("conflict", "规则标识已存在", 409, err)
	}
	return err
}

func (r *Repo) ToggleTariff(ctx context.Context, id int64) (*domain.TariffRule, error) {
	var out domain.TariffRule
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var cur domain.TariffRule
		if err := tx.First(&cur, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		cur.Active = !cur.Active
		if err := tx.Model(&domain.TariffRule{}).Where("id = ?", cur.ID).
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

func (r *Repo) SetPileStatus(ctx context.Context, code, status, note string, now time.Time) (*domain.Pile, error) {
	var out domain.Pile
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var p domain.Pile
		if err := tx.Where("code = ?", code).First(&p).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if status != domain.PileOnline {
			var open int64
			if err := tx.Model(&domain.ChargeSession{}).
				Where("pile_id = ? AND status IN ?", p.ID,
					[]string{domain.SessCharging, domain.SessFaulted}).
				Count(&open).Error; err != nil {
				return err
			}
			if open > 0 {
				return domain.New("pile_busy", "该桩还有未关闭的充电会话，不能切出在线态", 409)
			}
		}
		p.Status = status
		if note != "" {
			p.Note = note
		}
		if err := tx.Model(&domain.Pile{}).Where("id = ?", p.ID).
			Updates(map[string]any{"status": status, "note": p.Note}).Error; err != nil {
			return err
		}
		out = p
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---- 会话读取 ----

const sessionSelect = `s.*, p.code AS pile_code, p.station, p.bay, p.power_kw,
	v.plate_no, v.dept, v.driver_name`

func (r *Repo) ListSessions(ctx context.Context, q domain.ListQuery) ([]domain.SessionRow, int64, error) {
	base := r.db.WithContext(ctx).Table("charge_sessions AS s").
		Joins("JOIN piles p ON p.id = s.pile_id").
		Joins("JOIN vehicles v ON v.id = s.vehicle_id")
	if q.Status != "" {
		base = base.Where("s.status = ?", q.Status)
	}
	if q.OpenOnly {
		base = base.Where("s.status IN ?", []string{domain.SessCharging, domain.SessFaulted})
	}
	if q.PileCode != "" {
		base = base.Where("p.code = ?", q.PileCode)
	}
	if q.Plate != "" {
		base = base.Where("v.plate_no = ?", q.Plate)
	}
	if q.Dept != "" {
		base = base.Where("v.dept = ?", q.Dept)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where(`(s.code LIKE ? ESCAPE '\' OR v.plate_no LIKE ? ESCAPE '\' OR v.driver_name LIKE ? ESCAPE '\')`, like, like, like)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []domain.SessionRow
	err := base.Select(sessionSelect).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", s.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		decorate(&rows[i], ctx, r)
	}
	return rows, total, nil
}

func (r *Repo) SessionByCode(ctx context.Context, code string) (*domain.SessionDetail, error) {
	var row domain.SessionRow
	err := r.db.WithContext(ctx).Table("charge_sessions AS s").
		Select(sessionSelect).
		Joins("JOIN piles p ON p.id = s.pile_id").
		Joins("JOIN vehicles v ON v.id = s.vehicle_id").
		Where("s.code = ?", code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	decorate(&row, ctx, r)
	rules, err := r.Tariffs(ctx, true)
	if err != nil {
		return nil, err
	}
	return &domain.SessionDetail{SessionRow: row, RateBoard: domain.BuildRateBoard(rules)}, nil
}

// decorate 补齐只在出口存在的派生字段：司机手机号掩码、时长/均速、分时明细。
func decorate(row *domain.SessionRow, ctx context.Context, r *Repo) {
	// 手机号原文不落会话表，从车辆表即取即掩后丢弃。
	var phone string
	_ = r.db.WithContext(ctx).Table("vehicles").Where("id = ?", row.VehicleID).
		Select("driver_phone").Scan(&phone).Error
	row.PhoneMasked = domain.MaskPhone(phone)
	row.Segments = decodeSegments(row.SegDetail)
	row.Covered = row.SegUnpricedWh == 0
	end := time.Time{}
	if row.EndAt != nil {
		end = *row.EndAt
	} else if row.Status == domain.SessCharging {
		end = time.Now().UTC()
	}
	if !end.IsZero() && end.After(row.StartAt) {
		row.DurationMin = int(end.Sub(row.StartAt).Minutes())
		if row.DurationMin > 0 && row.ActualWh > 0 {
			row.AvgPowerKw = int(domain.RoundHalfUpInt(row.ActualWh*60, int64(row.DurationMin)*1000))
		}
	}
}

func decodeSegments(raw string) []domain.SegmentView {
	if strings.TrimSpace(raw) == "" {
		return []domain.SegmentView{}
	}
	var out []domain.SegmentView
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []domain.SegmentView{}
	}
	return out
}

func encodeSegments(items []domain.SegmentView) string {
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

// ---- 会话写入 ----

// StartSession 在一个事务里查重（桩/车各只能有一条未关闭会话）、发号、落单。
// 单写者 + txlock(immediate) 下，闭包内所有查询都必须用 tx。
func (r *Repo) StartSession(ctx context.Context, in domain.StartSessionInput, now time.Time) (*domain.SessionDetail, error) {
	created := ""
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var p domain.Pile
		if err := tx.Where("code = ?", in.PileCode).First(&p).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.New("pile_not_found", "充电桩不存在", 404)
			}
			return err
		}
		if p.Status != domain.PileOnline {
			return domain.New("pile_unavailable", "该桩当前不可用（"+domain.StatusLabel[p.Status]+"）", 409)
		}
		var v domain.Vehicle
		if err := tx.Where("plate_no = ?", in.PlateNo).First(&v).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.New("vehicle_not_found", "车辆未登记", 404)
			}
			return err
		}
		if !v.Active {
			return domain.New("vehicle_retired", "该车辆已退役，不能开充", 409)
		}
		var pileBusy, vehBusy int64
		if err := tx.Model(&domain.ChargeSession{}).
			Where("pile_id = ? AND status IN ?", p.ID,
				[]string{domain.SessCharging, domain.SessFaulted}).
			Count(&pileBusy).Error; err != nil {
			return err
		}
		if pileBusy > 0 {
			return domain.New("pile_occupied", "该桩已有未关闭的充电会话", 409)
		}
		if err := tx.Model(&domain.ChargeSession{}).
			Where("vehicle_id = ? AND status IN ?", v.ID,
				[]string{domain.SessCharging, domain.SessFaulted}).
			Count(&vehBusy).Error; err != nil {
			return err
		}
		if vehBusy > 0 {
			return domain.New("vehicle_busy", "该车辆已有未关闭的充电会话", 409)
		}
		if in.PlannedWh > int64(v.BatteryKwh)*1000 {
			return domain.Field("invalid_request", "参数校验未通过", map[string]string{
				"planned_wh": fmt.Sprintf("计划电量超过车辆电池容量 %d kWh", v.BatteryKwh),
			})
		}

		day := businessDate(now)
		prefix := "CS" + day + "-"
		var seq int64
		if err := tx.Model(&domain.ChargeSession{}).Where("code LIKE ? ESCAPE '\\'", prefix+"%").
			Count(&seq).Error; err != nil {
			return err
		}
		for attempt := 0; attempt < 5; attempt++ {
			code := fmt.Sprintf("%s%03d", prefix, seq+1+int64(attempt))
			s := &domain.ChargeSession{
				Code: code, PileID: p.ID, VehicleID: v.ID, Status: domain.SessCharging,
				StartAt: now, PlannedWh: in.PlannedWh, Note: in.Note, UpdatedAt: now,
			}
			if err := tx.Create(s).Error; err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "unique") {
					// 号段被并发占用或占用索引兜底触发：在同一事务内重算，绝不回头用 r.db。
					var again int64
					if e := tx.Model(&domain.ChargeSession{}).
						Where("code LIKE ? ESCAPE '\\'", prefix+"%").Count(&again).Error; e != nil {
						return e
					}
					seq = again
					continue
				}
				return err
			}
			created = code
			return nil
		}
		return domain.New("conflict", "会话编号冲突，请稍后重试", 409)
	})
	if err != nil {
		return nil, err
	}
	return r.SessionByCode(ctx, created)
}

// Settle 在事务内用唯一计价引擎拆段计价并落结算快照；状态推进只在表允许的跃迁里发生。
func (r *Repo) Settle(ctx context.Context, code string, in domain.SettleInput, now time.Time) (*domain.SessionDetail, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var s domain.ChargeSession
		if err := tx.Where("code = ?", code).First(&s).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.CanAdvance(s.Status, domain.SessCompleted) {
			return domain.New("invalid_transition", "该会话当前状态不能结算", 409)
		}
		var p domain.Pile
		if err := tx.First(&p, s.PileID).Error; err != nil {
			return err
		}
		var rules []domain.TariffRule
		if err := tx.Where("active = ?", true).
			Order("rule_priority asc, code asc").Find(&rules).Error; err != nil {
			return err
		}
		// 结算窗口至少按 1 分钟计价：同一分钟内开充即结算时，真实墙钟时长 <60s，
		// 直接喂给引擎会落进零时长分支、把已充走的电量记成「未定价」并算出 0 元。
		// end_at 仍写真实瞬刻，只有计价区间被抬高到 1 分钟（与服务层的 60s 功率上限口径对齐）。
		billEnd := now
		if billEnd.Sub(s.StartAt) < time.Minute {
			billEnd = s.StartAt.Add(time.Minute)
		}
		b := domain.ComputeBill(domain.BillInput{
			Start: s.StartAt, End: billEnd, ActualWh: in.ActualWh,
			OverstayMin: in.OverstayMin, Rules: domain.SortRulesActive(rules),
		})
		if !b.IdentityOK(in.ActualWh) {
			return domain.New("pricing_broken", "计价恒等式校验未通过，已拒绝结算", 500)
		}
		patch := map[string]any{
			"status": domain.SessCompleted, "end_at": now,
			"actual_wh":  in.ActualWh,
			"elec_cents": b.ElecCents, "service_cents": b.ServiceCents,
			"overstay_cents": b.OverstayCents, "total_cents": b.TotalCents,
			"overstay_min": min(in.OverstayMin, domain.MaxOverstayMin),
			"seg_peak_wh":  b.PeakWh, "seg_flat_wh": b.FlatWh,
			"seg_valley_wh": b.ValleyWh, "seg_unpriced_wh": b.UnpricedWh,
			"seg_detail": encodeSegments(b.Segments), "updated_at": now,
		}
		return tx.Model(&domain.ChargeSession{}).Where("id = ?", s.ID).Updates(patch).Error
	})
	if err != nil {
		return nil, err
	}
	return r.SessionByCode(ctx, code)
}

// AdvanceTo 只处理不产生金额的状态推进（当前仅 charging→faulted）。
func (r *Repo) AdvanceTo(ctx context.Context, code, to, note string, now time.Time) (*domain.SessionDetail, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var s domain.ChargeSession
		if err := tx.Where("code = ?", code).First(&s).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.CanAdvance(s.Status, to) {
			return domain.New("invalid_transition", "不允许从当前状态推进到该状态", 409)
		}
		if to == domain.SessFaulted && s.Status != domain.SessCharging {
			return domain.New("invalid_transition", "只有在充会话可以登记故障", 409)
		}
		return tx.Model(&domain.ChargeSession{}).Where("id = ?", s.ID).
			Updates(map[string]any{"status": to, "note": note, "updated_at": now}).Error
	})
	if err != nil {
		return nil, err
	}
	return r.SessionByCode(ctx, code)
}

// Abort 弃单：清空计费快照（金额与电量归零、明细置空），保留会话行做审计痕迹。
func (r *Repo) Abort(ctx context.Context, code, note string, now time.Time) (*domain.SessionDetail, error) {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var s domain.ChargeSession
		if err := tx.Where("code = ?", code).First(&s).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.CanAdvance(s.Status, domain.SessAborted) {
			return domain.New("invalid_transition", "只有故障挂起的会话可以弃单", 409)
		}
		return tx.Model(&domain.ChargeSession{}).Where("id = ?", s.ID).
			Updates(map[string]any{
				"status": domain.SessAborted, "note": note, "updated_at": now,
				"actual_wh": 0, "elec_cents": 0, "service_cents": 0,
				"overstay_cents": 0, "total_cents": 0, "overstay_min": 0,
				"seg_peak_wh": 0, "seg_flat_wh": 0, "seg_valley_wh": 0, "seg_unpriced_wh": 0,
				"seg_detail": "[]", "end_at": now,
			}).Error
	})
	if err != nil {
		return nil, err
	}
	return r.SessionByCode(ctx, code)
}

// businessDate 是全仓统一的业务日历日（UTC+8）：种子、发号、统计三处必须同口径，
// 否则 UTC 16:00 之后开的会话会落到「昨天」的号段，与统计的今日对不上。
func businessDate(now time.Time) string {
	return now.UTC().Add(domain.BizOffsetHours * time.Hour).Format("20060102")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
