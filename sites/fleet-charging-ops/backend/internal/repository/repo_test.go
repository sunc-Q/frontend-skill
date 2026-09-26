package repository

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
)

// newSeeded 建一个临时库并灌入种子。now 固定在本地 21:00（UTC+8），
// 保证「今天」既有已结算单、也有在充单，且不越界到未来。
func newSeeded(t *testing.T, now time.Time) *Repo {
	t.Helper()
	path := filepath.Join(t.TempDir(), "t.db")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := New(db).Seed(context.Background(), now); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return New(db)
}

func appCode(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		t.Fatal("期望返回错误，实际为 nil")
	}
	var ae *domain.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("错误必须收敛成 *domain.AppError，实际 %T: %v", err, err)
	}
	return ae.Code
}

func mustStart(r *Repo, pile, plate string, wh int64, now time.Time) (*domain.SessionDetail, error) {
	return r.StartSession(context.Background(), domain.StartSessionInput{
		PileCode: pile, PlateNo: plate, PlannedWh: wh,
	}, now)
}

func TestSeedShapeAndStatusCoverage(t *testing.T) {
	now := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC) // 本地 21:00 周四
	r := newSeeded(t, now)
	ctx := context.Background()

	type countCase struct {
		table string
		want  int64
	}
	for _, tc := range []countCase{
		{"piles", 12}, {"vehicles", 18}, {"tariff_rules", 10},
	} {
		var got int64
		if err := r.DB().Table(tc.table).Count(&got).Error; err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("%s 行数 = %d, want %d", tc.table, got, tc.want)
		}
	}
	statuses := map[string]int64{}
	var rows []struct {
		S string `gorm:"column:s"`
		N int64  `gorm:"column:n"`
	}
	if err := r.DB().Raw("SELECT status AS s, COUNT(*) AS n FROM charge_sessions GROUP BY status").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for _, x := range rows {
		statuses[x.S] = x.N
	}
	// 四种状态必须都有，否则前端的状态过滤与统计会出现空档。
	for _, s := range []string{domain.SessCompleted, domain.SessCharging, domain.SessFaulted, domain.SessAborted} {
		if statuses[s] == 0 {
			t.Errorf("种子缺少状态 %s 的会话（%v）", s, statuses)
		}
	}
	st, err := r.Stats(ctx, now, 7)
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if !st.IdentityOK {
		t.Fatalf("种子自检未通过: %v", st.IdentityIssues)
	}
	if st.OverstayCents == 0 {
		t.Error("种子应包含超时占桩单，否则超时费口径无法被验证")
	}
	if len(st.RateBoard) == 0 {
		t.Error("价目板为空")
	}
}

// TestSeedRowInvariants 直接扫原始行，不经过视图，防止装饰层掩盖脏数据。
func TestSeedRowInvariants(t *testing.T) {
	now := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)
	r := newSeeded(t, now)
	var sessions []domain.ChargeSession
	if err := r.DB().Order("id").Find(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	activePile, activeVeh := map[int64]string{}, map[int64]string{}
	for _, s := range sessions {
		if s.StartAt.Location() != time.UTC {
			t.Fatalf("%s start_at 时区 %v，落库必须统一 UTC", s.Code, s.StartAt.Location())
		}
		if s.StartAt.After(now) {
			t.Fatalf("%s 开始时刻落在未来: %v > %v", s.Code, s.StartAt, now)
		}
		if s.EndAt != nil && s.EndAt.Before(s.StartAt) {
			t.Fatalf("%s 结束早于开始", s.Code)
		}
		if s.TotalCents != s.ElecCents+s.ServiceCents+s.OverstayCents {
			t.Fatalf("%s 总额恒等式破口: %+v", s.Code, s)
		}
		open := s.Status == domain.SessCharging || s.Status == domain.SessFaulted
		if open != (s.EndAt == nil) {
			t.Fatalf("%s 未关闭=%v 但 end_at 空=%v", s.Code, open, s.EndAt == nil)
		}
		if s.Status == domain.SessAborted &&
			(s.ActualWh != 0 || s.TotalCents != 0 || s.ElecCents != 0 || s.ServiceCents != 0) {
			t.Fatalf("%s 弃单必须金额电量全清零: %+v", s.Code, s)
		}
		if s.Status == domain.SessCompleted {
			if s.SegPeakWh+s.SegFlatWh+s.SegValleyWh+s.SegUnpricedWh != s.ActualWh {
				t.Fatalf("%s 分时拆分之和 ≠ 实际电量", s.Code)
			}
			var segs []domain.SegmentView
			if err := json.Unmarshal([]byte(s.SegDetail), &segs); err != nil {
				t.Fatalf("%s seg_detail 不是合法 JSON: %v", s.Code, err)
			}
			var sumWh, sumE, sumS int64
			for _, g := range segs {
				sumWh += g.Wh
				sumE += g.ElecCents
				sumS += g.ServiceCents
			}
			if sumWh+s.SegUnpricedWh != s.ActualWh || sumE != s.ElecCents || sumS != s.ServiceCents {
				t.Fatalf("%s 明细与快照不一致: segWh=%d segE=%d segS=%d", s.Code, sumWh, sumE, sumS)
			}
		}
		if open {
			if other, has := activePile[s.PileID]; has {
				t.Fatalf("桩 %d 上出现两条未关闭会话: %s / %s", s.PileID, other, s.Code)
			}
			if other, has := activeVeh[s.VehicleID]; has {
				t.Fatalf("车 %d 上出现两条未关闭会话: %s / %s", s.VehicleID, other, s.Code)
			}
			activePile[s.PileID] = s.Code
			activeVeh[s.VehicleID] = s.Code
		}
	}

	var vehicles []domain.Vehicle
	if err := r.DB().Find(&vehicles).Error; err != nil {
		t.Fatal(err)
	}
	for _, v := range vehicles {
		if !domain.PlateAllowed(v.PlateNo) {
			t.Errorf("车牌不符合口径: %q", v.PlateNo)
		}
		if !domain.MobileAllowed(v.Phone) {
			t.Errorf("手机号不符合口径: %q", v.Phone)
		}
	}
	// 手机号只能以掩码形式出现在对外视图里。
	items, err := r.Vehicles(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range items {
		b, _ := json.Marshal(v)
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		if _, has := m["phone"]; has {
			t.Fatalf("车辆视图泄露 phone 字段: %s", b)
		}
		masked, _ := m["phone_masked"].(string)
		if len(masked) != 11 || !strings.HasSuffix(masked, "****") && !strings.Contains(masked, "****") {
			t.Fatalf("掩码格式不符: %q", masked)
		}
	}
}

// TestStartSessionConflicts 表驱动：桩/车的可用性与互斥必须在仓储层就被挡住。
func TestStartSessionConflicts(t *testing.T) {
	now := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)
	r := newSeeded(t, now)
	ctx := context.Background()

	var freePile, busyPile, offPile string
	piles, err := r.Piles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range piles {
		switch {
		case p.Status != domain.PileOnline && offPile == "":
			offPile = p.Code
		case p.OpenSessions > 0 && busyPile == "":
			busyPile = p.Code
		case p.Status == domain.PileOnline && p.OpenSessions == 0 && freePile == "":
			freePile = p.Code
		}
	}
	if freePile == "" || busyPile == "" || offPile == "" {
		t.Fatalf("种子桩状态覆盖不足: free=%q busy=%q off=%q", freePile, busyPile, offPile)
	}
	var freePlate, busyPlate, retiredPlate string
	var allVeh []domain.Vehicle
	if err := r.DB().Order("id").Find(&allVeh).Error; err != nil {
		t.Fatal(err)
	}
	vehs := make([]domain.VehicleRow, 0, len(allVeh))
	for _, v := range allVeh {
		vehs = append(vehs, domain.VehicleRow{Vehicle: v})
	}
	openVeh := map[int64]bool{}
	var open []domain.ChargeSession
	if err := r.DB().Where("status IN ?", []string{domain.SessCharging, domain.SessFaulted}).Find(&open).Error; err != nil {
		t.Fatal(err)
	}
	for _, s := range open {
		openVeh[s.VehicleID] = true
	}
	for _, v := range vehs {
		switch {
		case !v.Active && retiredPlate == "":
			retiredPlate = v.PlateNo
		case v.Active && openVeh[v.ID] && busyPlate == "":
			busyPlate = v.PlateNo
		case v.Active && !openVeh[v.ID] && freePlate == "":
			freePlate = v.PlateNo
		}
	}
	if freePlate == "" || busyPlate == "" || retiredPlate == "" {
		t.Fatalf("种子车辆覆盖不足: free=%q busy=%q retired=%q", freePlate, busyPlate, retiredPlate)
	}

	cases := []struct {
		name  string
		in    domain.StartSessionInput
		want  string
		field string
	}{
		{"桩不存在", domain.StartSessionInput{PileCode: "ZZ-Z99", PlateNo: freePlate, PlannedWh: 20_000}, "pile_not_found", ""},
		{"桩离线/维保", domain.StartSessionInput{PileCode: offPile, PlateNo: freePlate, PlannedWh: 20_000}, "pile_unavailable", ""},
		{"桩已被占用", domain.StartSessionInput{PileCode: busyPile, PlateNo: freePlate, PlannedWh: 20_000}, "pile_occupied", ""},
		{"车辆未登记", domain.StartSessionInput{PileCode: freePile, PlateNo: "沪AZ00000", PlannedWh: 20_000}, "vehicle_not_found", ""},
		{"车辆已退役", domain.StartSessionInput{PileCode: freePile, PlateNo: retiredPlate, PlannedWh: 20_000}, "vehicle_retired", ""},
		{"车辆正在别处充电", domain.StartSessionInput{PileCode: freePile, PlateNo: busyPlate, PlannedWh: 20_000}, "vehicle_busy", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := mustStart(r, tc.in.PileCode, tc.in.PlateNo, tc.in.PlannedWh, now.Add(time.Minute))
			if got := appCode(t, err); got != tc.want {
				t.Fatalf("错误码 = %s, want %s（%v）", got, tc.want, err)
			}
		})
	}
	t.Run("计划电量超过电池容量", func(t *testing.T) {
		_, err := mustStart(r, freePile, freePlate, 9_999_000, now.Add(time.Minute))
		ae := err
		var a *domain.AppError
		if !errors.As(ae, &a) {
			t.Fatalf("应为 AppError: %v", ae)
		}
		if a.Code != "invalid_request" || a.Fields["planned_wh"] == "" {
			t.Fatalf("应回 planned_wh 字段错误: %+v", a)
		}
	})
	t.Run("开充成功且不落未来态", func(t *testing.T) {
		d, err := mustStart(r, freePile, freePlate, 30_000, now)
		if err != nil {
			t.Fatalf("合法开充失败: %v", err)
		}
		if d.Status != domain.SessCharging || d.EndAt != nil {
			t.Fatalf("新开会话状态不符: %+v", d.SessionRow)
		}
		if !strings.HasPrefix(d.Code, "CS20260924-") {
			t.Fatalf("会话编号未按业务日发号: %s", d.Code)
		}
		if d.PhoneMasked == "" || !strings.Contains(d.PhoneMasked, "****") {
			t.Fatalf("详情缺少掩码手机号: %q", d.PhoneMasked)
		}
		// 同一桩第二次开充必须被拒。
		if got := appCode(t, mustStartErr(r, freePile, freePlate, now.Add(time.Minute))); got != "vehicle_busy" && got != "pile_occupied" {
			t.Fatalf("重复占用应被挡: %s", got)
		}
	})
}

func mustStartErr(r *Repo, pile, plate string, now time.Time) error {
	_, err := mustStart(r, pile, plate, 20_000, now)
	return err
}

// TestSettleMatchesEngineAndAborts 走完整生命周期：开充→故障→弃单，
// 以及开充→结算，并核对落库快照与离线复算完全一致。
func TestSettleMatchesEngineAndAborts(t *testing.T) {
	now := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)
	r := newSeeded(t, now)
	ctx := context.Background()

	online := func(t *testing.T) (string, string) {
		t.Helper()
		var p domain.Pile
		if err := r.DB().Where("status = ? AND code NOT IN (SELECT p2.code FROM charge_sessions s JOIN piles p2 ON p2.id=s.pile_id WHERE s.status IN ('charging','faulted'))",
			domain.PileOnline).Order("code").First(&p).Error; err != nil {
			t.Fatal(err)
		}
		var v domain.Vehicle
		if err := r.DB().Where("active = 1 AND id NOT IN (SELECT vehicle_id FROM charge_sessions WHERE status IN ('charging','faulted'))").
			Order("id").First(&v).Error; err != nil {
			t.Fatal(err)
		}
		return p.Code, v.PlateNo
	}

	t.Run("开充后结算", func(t *testing.T) {
		pile, plate := online(t)
		d, err := mustStart(r, pile, plate, 40_000, now)
		if err != nil {
			t.Fatal(err)
		}
		settleAt := now.Add(90 * time.Minute)
		got, err := r.Settle(ctx, d.Code, domain.SettleInput{ActualWh: 45_000, OverstayMin: 25}, settleAt)
		if err != nil {
			t.Fatalf("Settle: %v", err)
		}
		rules, err := r.Tariffs(ctx, true)
		if err != nil {
			t.Fatal(err)
		}
		want := domain.ComputeBill(domain.BillInput{
			Start: d.StartAt, End: settleAt, ActualWh: 45_000, OverstayMin: 25,
			Rules: domain.SortRulesActive(rules),
		})
		if got.Status != domain.SessCompleted || got.EndAt == nil {
			t.Fatalf("结算后状态不符: %s %v", got.Status, got.EndAt)
		}
		if got.ElecCents != want.ElecCents || got.ServiceCents != want.ServiceCents ||
			got.OverstayCents != want.OverstayCents || got.TotalCents != want.TotalCents {
			t.Fatalf("快照与离线复算不一致: %+v vs %+v", got, want)
		}
		if got.OverstayMin != 25 {
			t.Fatalf("超时分钟未落库: %d", got.OverstayMin)
		}
		if len(got.Segments) != len(want.Segments) {
			t.Fatalf("分段数 %d != %d", len(got.Segments), len(want.Segments))
		}
		if !got.Covered {
			t.Errorf("种子价目表应覆盖全天，covered 应为 true")
		}
		// 终态不可再结算。
		if code := appCode(t, func() error {
			_, e := r.Settle(ctx, d.Code, domain.SettleInput{ActualWh: 10_000}, settleAt.Add(time.Minute))
			return e
		}()); code != "invalid_transition" {
			t.Fatalf("重复结算应被拒: %s", code)
		}
	})

	t.Run("超时长按上限截断", func(t *testing.T) {
		pile, plate := online(t)
		d, err := mustStart(r, pile, plate, 40_000, now)
		if err != nil {
			t.Fatal(err)
		}
		got, err := r.Settle(ctx, d.Code, domain.SettleInput{ActualWh: 20_000, OverstayMin: 10_000}, now.Add(60*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if got.OverstayMin != domain.MaxOverstayMin {
			t.Fatalf("超时分钟应被钳到 %d, got %d", domain.MaxOverstayMin, got.OverstayMin)
		}
		if got.OverstayCents != int64(domain.MaxOverstayMin)*domain.OverstayCentsPerMin {
			t.Fatalf("超时费未按钳制后的分钟计: %d", got.OverstayCents)
		}
	})

	t.Run("同一分钟内结算也要计价", func(t *testing.T) {
		pile, plate := online(t)
		d, err := mustStart(r, pile, plate, 40_000, now)
		if err != nil {
			t.Fatal(err)
		}
		// 开充后 8 毫秒即结算：墙钟时长不足一分钟。
		got, err := r.Settle(ctx, d.Code, domain.SettleInput{ActualWh: 1_200, OverstayMin: 30},
			now.Add(8*time.Millisecond))
		if err != nil {
			t.Fatalf("Settle: %v", err)
		}
		if got.TotalCents <= 0 || got.ElecCents <= 0 {
			t.Fatalf("电量已充进桩里就不能算成 0 元: %+v", got.SessionRow.ChargeSession)
		}
		if got.SegUnpricedWh != 0 || !got.Covered {
			t.Fatalf("一分钟下限窗口不该出现未定价瓦时: unpriced=%d covered=%t", got.SegUnpricedWh, got.Covered)
		}
		var sumWh int64
		for _, s := range got.Segments {
			sumWh += s.Wh
		}
		if sumWh != 1_200 {
			t.Fatalf("分段瓦时之和应等于实际电量: %d", sumWh)
		}
		if got.OverstayCents != 30*domain.OverstayCentsPerMin {
			t.Fatalf("超时占用费应为 %d 分, got %d", 30*domain.OverstayCentsPerMin, got.OverstayCents)
		}
		if got.EndAt == nil || !got.EndAt.Equal(now.Add(8*time.Millisecond)) {
			t.Fatalf("end_at 应落真实瞬刻而不是下限窗口末端: %v", got.EndAt)
		}
	})

	t.Run("故障后弃单", func(t *testing.T) {
		pile, plate := online(t)
		d, err := mustStart(r, pile, plate, 40_000, now)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := r.AdvanceTo(ctx, d.Code, domain.SessFaulted, "故障：枪座过温", now.Add(20*time.Minute)); err != nil {
			t.Fatalf("charging→faulted 失败: %v", err)
		}
		// 故障挂起仍占桩：同桩再开必须 409。
		if code := appCode(t, mustStartErr(r, pile, plate, now.Add(21*time.Minute))); code != "pile_occupied" {
			t.Fatalf("故障挂起应继续占桩: %s", code)
		}
		// 只有在充可以登记故障。
		if code := appCode(t, func() error {
			_, e := r.AdvanceTo(ctx, d.Code, domain.SessFaulted, "再来一次", now)
			return e
		}()); code != "invalid_transition" {
			t.Fatalf("faulted→faulted 应被拒: %s", code)
		}
		got, err := r.Abort(ctx, d.Code, "弃单：紧急调线", now.Add(30*time.Minute))
		if err != nil {
			t.Fatalf("Abort: %v", err)
		}
		if got.Status != domain.SessAborted || got.ActualWh != 0 || got.TotalCents != 0 ||
			got.SegUnpricedWh != 0 || len(got.Segments) != 0 || got.EndAt == nil {
			t.Fatalf("弃单未清空计费快照: %+v", got.SessionRow)
		}
		// 弃单是终态。
		if code := appCode(t, func() error {
			_, e := r.Settle(ctx, d.Code, domain.SettleInput{ActualWh: 5_000}, now.Add(40*time.Minute))
			return e
		}()); code != "invalid_transition" {
			t.Fatalf("aborted 不能再结算: %s", code)
		}
		// 释放桩与车：同一组合可再次开充。
		if _, err := mustStart(r, pile, plate, 20_000, now.Add(41*time.Minute)); err != nil {
			t.Fatalf("弃单后应释放占用: %v", err)
		}
	})

	t.Run("未关闭会话不计入营收", func(t *testing.T) {
		st, err := r.Stats(ctx, now.Add(2*time.Hour), 7)
		if err != nil {
			t.Fatal(err)
		}
		if !st.IdentityOK {
			t.Fatalf("生命周期写入后恒等式自检失败: %v", st.IdentityIssues)
		}
		if st.BilledCount != st.CompletedCount {
			t.Fatalf("计费单数 %d != 已结算单数 %d", st.BilledCount, st.CompletedCount)
		}
	})
}

// TestTariffToggleAndPileStatus 价目开关与桩状态守卫。
func TestTariffToggleAndPileStatus(t *testing.T) {
	now := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)
	r := newSeeded(t, now)
	ctx := context.Background()

	rules, err := r.Tariffs(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	target := rules[0]
	got, err := r.ToggleTariff(ctx, target.ID)
	if err != nil {
		t.Fatalf("ToggleTariff: %v", err)
	}
	if got.Active {
		t.Fatal("切换后应变为停用")
	}
	after, err := r.Tariffs(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(rules)-1 {
		t.Fatalf("启用规则数应减少 1: %d -> %d", len(rules), len(after))
	}
	if _, err := r.ToggleTariff(ctx, target.ID); err != nil {
		t.Fatal(err)
	}
	if code := appCode(t, func() error { _, e := r.ToggleTariff(ctx, 999999); return e }()); code != "not_found" {
		t.Fatalf("不存在的规则应 404: %s", code)
	}

	// 停用一个正在充电的桩必须被 pile_busy 挡住。
	var open domain.ChargeSession
	if err := r.DB().Where("status = ?", domain.SessCharging).First(&open).Error; err != nil {
		t.Fatal(err)
	}
	var busyPile domain.Pile
	if err := r.DB().First(&busyPile, open.PileID).Error; err != nil {
		t.Fatal(err)
	}
	if code := appCode(t, func() error {
		_, e := r.SetPileStatus(ctx, busyPile.Code, domain.PileMaintenance, "维保", now)
		return e
	}()); code != "pile_busy" {
		t.Fatalf("在充桩切出在线态应被拒: %s", code)
	}
	// 在线态之间互切不受限制，且落库。
	p, err := r.SetPileStatus(ctx, busyPile.Code, domain.PileOnline, "已恢复", now)
	if err != nil || p.Status != domain.PileOnline {
		t.Fatalf("切在线应放行: %v %+v", err, p)
	}
	if code := appCode(t, func() error {
		_, e := r.SetPileStatus(ctx, "ZZ-Z99", domain.PileOnline, "", now)
		return e
	}()); code != "not_found" {
		t.Fatalf("未知桩编号应 404: %s", code)
	}
}

// TestListQueries 过滤、排序、分页与脱敏在仓储层就要成立。
func TestListQueries(t *testing.T) {
	now := time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)
	r := newSeeded(t, now)
	ctx := context.Background()

	for _, key := range domain.SortKeys() {
		q := domain.ParseListQuery(map[string][]string{"sort": {key}, "dir": {"asc"}, "page_size": {"5"}})
		rows, total, err := r.ListSessions(ctx, q)
		if err != nil {
			t.Fatalf("sort=%s 查询失败: %v", key, err)
		}
		if total == 0 || len(rows) == 0 || len(rows) > 5 {
			t.Fatalf("sort=%s 分页异常: total=%d rows=%d", key, total, len(rows))
		}
	}
	rows, total, err := r.ListSessions(ctx, domain.ParseListQuery(map[string][]string{"status": {"charging"}}))
	if err != nil || int64(len(rows)) != total {
		t.Fatalf("状态过滤: err=%v total=%d rows=%d", err, total, len(rows))
	}
	for _, row := range rows {
		if row.Status != domain.SessCharging {
			t.Fatalf("过滤泄漏: %s", row.Status)
		}
		if row.PhoneMasked == "" || !strings.Contains(row.PhoneMasked, "****") {
			t.Fatalf("会话行缺少掩码手机号: %q", row.PhoneMasked)
		}
		b, _ := json.Marshal(row)
		if strings.Contains(string(b), "\"phone\":") {
			t.Fatalf("会话行泄露手机号字段: %s", b)
		}
	}
	// 搜索串同时命中标识/车牌/司机/站点，注入串不得炸库。
	q := domain.ParseListQuery(map[string][]string{"q": {"' OR 1=1 --"}})
	if _, _, err := r.ListSessions(ctx, q); err != nil {
		t.Fatalf("注入搜索串应安全返回: %v", err)
	}
	// 深翻页得到空集而不是报错。
	q = domain.ParseListQuery(map[string][]string{"page": {"9999"}})
	rows, _, err = r.ListSessions(ctx, q)
	if err != nil || len(rows) != 0 {
		t.Fatalf("越界分页: err=%v rows=%d", err, len(rows))
	}
	if _, err := r.SessionByCode(ctx, "CS00000000-001"); appCode(t, err) != "not_found" {
		t.Fatalf("未知会话编号应 404: %v", err)
	}
}
