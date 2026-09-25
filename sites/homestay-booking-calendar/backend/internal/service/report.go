// 看板口径组装：这里只做取数与算术，不重算价格（价格只在 domain.BuildQuote 里算一次）。
package service

import (
	"context"
	"sort"
	"time"

	"bizsite/internal/domain"
	"bizsite/internal/repository"
)

// 历史与未来两个窗口：ADR/OCC/RevPAR 用过去 30 个已离店的房晚口径，
// 房态负载用未来 28 天的占房口径，两者分开标注、绝不混算。
const (
	HistoryDays = 30
	ForwardDays = 28
)

type Stats struct {
	GeneratedAt string       `json:"generated_at"`
	Today       string       `json:"today"`
	Weekday     string       `json:"weekday"`
	History     WindowMeta   `json:"history"`
	Forward     WindowMeta   `json:"forward"`
	Portfolio   Portfolio    `json:"portfolio"`
	Ops         OpsBoard     `json:"ops"`
	Money       Money        `json:"money"`
	Performance Performance  `json:"performance"`
	Identity    Identity     `json:"identity"`
	Channels    []ChannelRow `json:"channels"`
	Props       []PropRow    `json:"properties"`
	Load        []LoadRow    `json:"load"`
	KindMix     []KindRow    `json:"kind_mix"`
	TopRooms    []TopRoom    `json:"top_rooms"`
}

type WindowMeta struct {
	From string `json:"from"`
	To   string `json:"to"`
	Days int    `json:"days"`
}

type Portfolio struct {
	Properties   int `json:"properties"`
	RoomTypes    int `json:"room_types"`
	RoomsActive  int `json:"rooms_active"`
	Units        int `json:"units"`
	UnitsActive  int `json:"units_active"`
	Capacity     int `json:"capacity_persons"`
	RateDays     int `json:"rate_days"`
	BufferAvgMin int `json:"clean_buffer_days_max"`
}

type OpsBoard struct {
	Arrivals          int   `json:"arrivals"`
	Departures        int   `json:"departures"`
	InHouse           int   `json:"in_house"`
	InHouseUnits      int   `json:"in_house_units"`
	Pending           int   `json:"pending"`
	PendingUnits      int   `json:"pending_units"`
	HeldNextWindow    int   `json:"held_room_nights_next"`
	SellableUnitsAvg  int   `json:"sellable_units_avg"`
	PendingTotalCents int64 `json:"pending_value_cents"`
}

type Money struct {
	GMVCents     int64 `json:"gmv_cents"`
	RefundCents  int64 `json:"refund_cents"`
	NetCents     int64 `json:"net_cents"`
	CleanCents   int64 `json:"clean_fee_cents"`
	NightCents   int64 `json:"night_revenue_cents"`
	Cancelled    int   `json:"cancelled_bookings"`
	AvgOrder     int64 `json:"avg_order_cents"`
	SoldBookings int   `json:"sold_bookings"`
	CancelGross  int64 `json:"cancel_gross_cents"`
	Collected    int64 `json:"collected_cents"`
}

type Performance struct {
	RoomNightsSold     int   `json:"room_nights_sold"`
	RoomNightsAvail    int   `json:"room_nights_available"`
	OccBps             int   `json:"occ_bps"`
	ADRCents           int64 `json:"adr_cents"`
	RevPARCents        int64 `json:"revpar_cents"`
	RevPARDerivedCents int64 `json:"revpar_derived_cents"`
	DriftCents         int64 `json:"revpar_drift_cents"`
	RevenueCents       int64 `json:"revenue_cents"`
}

// Identity 把两条恒等式作为对外字段公布：不达标就是数据坏了，而不是悄悄藏起来。
type Identity struct {
	NightSumCents        int64 `json:"night_sum_cents"`
	BookingSubtotalCents int64 `json:"booking_subtotal_cents"`
	SubtotalMatches      bool  `json:"subtotal_matches"`
	RevPARDriftCents     int64 `json:"revpar_drift_cents"`
	RevPARIdentityOK     bool  `json:"revpar_identity_ok"`
	NetIdentityOK        bool  `json:"net_identity_ok"`
	NetGapCents          int64 `json:"net_gap_cents"`
}

type ChannelRow struct {
	Channel      string `json:"channel"`
	Bookings     int    `json:"bookings"`
	RoomNights   int    `json:"room_nights"`
	RevenueCents int64  `json:"revenue_cents"`
	ShareBps     int    `json:"share_bps"`
}

type PropRow struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Units        int    `json:"units"`
	Bookings     int    `json:"bookings"`
	RoomNights   int    `json:"room_nights"`
	RevenueCents int64  `json:"revenue_cents"`
	ADRCents     int64  `json:"adr_cents"`
	OccBps       int    `json:"occ_bps_forward"`
}

type LoadRow struct {
	Date         string `json:"date"`
	Weekday      string `json:"weekday"`
	Sold         int    `json:"room_nights_sold"`
	Held         int    `json:"held_units"`
	Available    int    `json:"capacity_units"`
	Free         int    `json:"free_units"`
	FillBps      int    `json:"fill_bps"`
	RevenueCents int64  `json:"revenue_cents"`
	ClosedRooms  int    `json:"closed_rooms"`
	Weekend      bool   `json:"weekend"`
}

type KindRow struct {
	Kind        string `json:"kind"`
	RoomNights  int    `json:"room_nights"`
	AmountCents int64  `json:"amount_cents"`
	ShareBps    int    `json:"share_bps"`
	AvgPrice    int64  `json:"avg_price_cents"`
}

type TopRoom struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	PropertyName string `json:"property_name"`
	RoomNights   int    `json:"room_nights"`
	RevenueCents int64  `json:"revenue_cents"`
	ADRCents     int64  `json:"adr_cents"`
	FillBps      int    `json:"fill_bps_forward"`
}

// Stats 组装看板。now 由调用方注入，便于测试确定性。
func (s *Service) Stats(ctx context.Context, now time.Time) (*Stats, error) {
	today := domain.DateStr(now.Local())
	hFrom := domain.AddDays(today, -HistoryDays)
	fTo := domain.AddDays(today, ForwardDays)

	cal, err := s.repo.LoadCalendar(ctx)
	if err != nil {
		return nil, err
	}
	rts, err := s.repo.RoomsAll(ctx)
	if err != nil {
		return nil, err
	}
	props, err := s.repo.Properties(ctx)
	if err != nil {
		return nil, err
	}
	stays, err := s.repo.LoadStays(ctx, hFrom, fTo, domain.HoldStatuses)
	if err != nil {
		return nil, err
	}
	occ := domain.ExpandStays(stays, hFrom, fTo)

	out := &Stats{
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Today:       today, Weekday: domain.WeekdayCN(today),
		History: WindowMeta{From: hFrom, To: domain.AddDays(today, -1), Days: HistoryDays},
		Forward: WindowMeta{From: today, To: domain.AddDays(today, ForwardDays-1), Days: ForwardDays},
	}

	// --- 资产盘点 ---
	closedUnits := func(date string) (int, int) { // 返回当日停售房型数与可售间数
		closed, avail := 0, 0
		for _, rt := range rts {
			if rt.Status != domain.RoomActive {
				continue
			}
			if domain.ResolveNight(rt, date, cal).Kind == domain.KindClosed {
				closed++
				continue
			}
			avail += rt.Units
		}
		return closed, avail
	}
	out.Portfolio.Properties = len(props)
	out.Portfolio.RoomTypes = len(rts)
	for _, rt := range rts {
		out.Portfolio.Capacity += rt.Capacity * rt.Units
		if rt.Status == domain.RoomActive {
			out.Portfolio.RoomsActive++
			out.Portfolio.UnitsActive += rt.Units
		} else {
			out.Portfolio.Units += rt.Units
		}
		if p := propOf(props, rt.PropertyCode); p != nil && p.CleanBufferDays > out.Portfolio.BufferAvgMin {
			out.Portfolio.BufferAvgMin = p.CleanBufferDays
		}
	}
	out.Portfolio.Units += out.Portfolio.UnitsActive
	if n, err := s.repo.RateDayCount(ctx); err == nil {
		out.Portfolio.RateDays = int(n)
	}

	// --- 历史窗口业绩（ADR / OCC / RevPAR）---
	hist, err := s.repo.NightWindow(ctx, hFrom, today)
	if err != nil {
		return nil, err
	}
	out.Performance.RevenueCents = hist.Amount
	out.Performance.RoomNightsSold = hist.RoomNights
	avail := 0
	for i := 0; i < HistoryDays; i++ {
		_, a := closedUnits(domain.AddDays(hFrom, i))
		avail += a
	}
	out.Performance.RoomNightsAvail = avail
	out.Performance.OccBps = domain.Bps(hist.RoomNights, avail)
	out.Performance.ADRCents = domain.SafeDiv(hist.Amount, int64(hist.RoomNights))
	out.Performance.RevPARCents = domain.SafeDiv(hist.Amount, int64(avail))
	// RevPAR = ADR × OCC：整数除法各有截断，用派生值与真实值的偏差把口径透明度交出去。
	out.Performance.RevPARDerivedCents = out.Performance.ADRCents * int64(out.Performance.OccBps) / 10000
	out.Performance.DriftCents = out.Performance.RevPARCents - out.Performance.RevPARDerivedCents

	// --- 金额三口径 ---
	money, err := s.repo.MoneyAgg(ctx)
	if err != nil {
		return nil, err
	}
	out.Money = Money{
		GMVCents: money.GMVCents, RefundCents: money.RefundCents, NetCents: money.NetCents,
		CleanCents: money.CleanTotal, NightCents: money.NightSubtotal,
		CancelGross: money.CancelGross, Collected: money.NetCents,
	}
	statusAgg, err := s.repo.StatusAgg(ctx)
	if err != nil {
		return nil, err
	}
	for _, x := range statusAgg {
		switch x.Status {
		case domain.StCancelled:
			out.Money.Cancelled = x.N
		case domain.StPending:
			out.Ops.Pending = x.N
			out.Ops.PendingUnits = x.Units
		}
		if domain.CountsRevenue(x.Status) {
			out.Money.SoldBookings += x.N
		}
	}
	out.Money.AvgOrder = domain.SafeDiv(money.GMVCents, int64(out.Money.SoldBookings))

	nightSum, err := s.repo.NightAmountSum(ctx)
	if err != nil {
		return nil, err
	}
	out.Identity = Identity{
		NightSumCents: nightSum, BookingSubtotalCents: money.NightSubtotal,
		SubtotalMatches:  nightSum == money.NightSubtotal,
		RevPARDriftCents: out.Performance.DriftCents,
		RevPARIdentityOK: abs64(out.Performance.DriftCents) <= 100,
		// 净额恒等式：实收 = 成交额 + 取消单里不退的部分 − 退款，必须分毫不差。
		NetIdentityOK: money.GMVCents+money.CancelGross-money.RefundCents == money.NetCents,
		NetGapCents:   money.GMVCents + money.CancelGross - money.RefundCents - money.NetCents,
	}

	// --- 今日运营面板 ---
	count := func(where string, args ...any) int {
		n, err := s.repo.CountWhere(ctx, "bookings", where, args...)
		if err != nil {
			return 0
		}
		return int(n)
	}
	out.Ops.Arrivals = count("check_in = ? AND status IN ('pending','confirmed','checked_in')", today)
	out.Ops.Departures = count("check_out = ? AND status IN ('confirmed','checked_in')", today)
	var inhouse, inhouseUnits int
	if n, u, err := s.repo.InHouseToday(ctx, today); err == nil {
		inhouse, inhouseUnits = n, u
	}
	out.Ops.InHouse, out.Ops.InHouseUnits = inhouse, inhouseUnits
	held, availNow := 0, 0
	for i := 0; i < ForwardDays; i++ {
		date := domain.AddDays(today, i)
		closed, a := closedUnits(date)
		_ = closed
		availNow += a
		for _, rt := range rts {
			if rt.Status != domain.RoomActive {
				continue
			}
			held += occ.Get(rt.Code, date)
		}
	}
	out.Ops.SellableUnitsAvg = availNow / ForwardDays
	out.Ops.HeldNextWindow = held
	out.Ops.PendingTotalCents = money.PendingTotal

	// --- 负载曲线（未来 28 天）---
	daily, err := s.repo.DailyNights(ctx, today, fTo)
	if err != nil {
		return nil, err
	}
	soldMap := map[string]repository.DailyNights{}
	for _, x := range daily {
		soldMap[x.Date] = x
	}
	out.Load = make([]LoadRow, 0, ForwardDays)
	for i := 0; i < ForwardDays; i++ {
		date := domain.AddDays(today, i)
		closed, a := closedUnits(date)
		h := 0
		for _, rt := range rts {
			if rt.Status != domain.RoomActive {
				continue
			}
			h += occ.Get(rt.Code, date)
		}
		row := LoadRow{
			Date: date, Weekday: domain.WeekdayCN(date), Held: h, Available: a,
			Free: a - h, FillBps: domain.Bps(h, a), ClosedRooms: closed,
			Sold: soldMap[date].RoomNights, RevenueCents: soldMap[date].Amount,
			Weekend: domain.IsWeekendNight(date),
		}
		if row.Free < 0 {
			row.Free = 0
		}
		out.Load = append(out.Load, row)
	}

	// --- 渠道 / 门店 / 房型 ---
	chans, err := s.repo.ChannelAgg(ctx)
	if err != nil {
		return nil, err
	}
	out.Channels = make([]ChannelRow, 0, len(chans))
	for _, x := range chans {
		out.Channels = append(out.Channels, ChannelRow{
			Channel: x.Channel, Bookings: x.N, RoomNights: x.Nights, RevenueCents: x.Total,
			ShareBps: domain.Bps(int(x.Total/100), int(money.GMVCents/100)),
		})
	}
	pagg, err := s.repo.PropertyAgg(ctx)
	if err != nil {
		return nil, err
	}
	unitsByProp := map[string]int{}
	for _, rt := range rts {
		unitsByProp[rt.PropertyCode] += rt.Units
	}
	heldByProp := map[string]int{}
	availByProp := map[string]int{}
	for i := 0; i < ForwardDays; i++ {
		date := domain.AddDays(today, i)
		for _, rt := range rts {
			if rt.Status != domain.RoomActive {
				continue
			}
			if domain.ResolveNight(rt, date, cal).Kind == domain.KindClosed {
				continue
			}
			heldByProp[rt.PropertyCode] += occ.Get(rt.Code, date)
			availByProp[rt.PropertyCode] += rt.Units
		}
	}
	out.Props = make([]PropRow, 0, len(pagg))
	for _, x := range pagg {
		p := propOf(props, x.PropertyCode)
		name := x.PropertyCode
		if p != nil {
			name = p.Name
		}
		out.Props = append(out.Props, PropRow{
			Code: x.PropertyCode, Name: name, Units: unitsByProp[x.PropertyCode],
			Bookings: x.N, RoomNights: x.Units, RevenueCents: x.Amount,
			ADRCents: domain.SafeDiv(x.Amount, int64(x.Units)),
			OccBps:   domain.Bps(heldByProp[x.PropertyCode], availByProp[x.PropertyCode]),
		})
	}
	rooms, _, err := s.repo.Rooms(ctx, domain.RoomQuery{Page: 1, PageSize: domain.MaxPageSize, Sort: "revenue", Dir: "desc"})
	if err != nil {
		return nil, err
	}
	out.TopRooms = make([]TopRoom, 0, 6)
	for _, rt := range rooms {
		if rt.NightsSold == 0 {
			continue
		}
		out.TopRooms = append(out.TopRooms, TopRoom{
			Code: rt.Code, Name: rt.Name, PropertyName: rt.PropertyName,
			RoomNights: rt.NightsSold, RevenueCents: rt.RevenueCents, ADRCents: rt.ADR,
			FillBps: rt.OccBpsWindow,
		})
		if len(out.TopRooms) == 6 {
			break
		}
	}
	mix, err := s.repo.KindMix(ctx, hFrom, fTo)
	if err != nil {
		return nil, err
	}
	var mixTotal int64
	for _, x := range mix {
		mixTotal += x.Amount
	}
	out.KindMix = make([]KindRow, 0, len(mix))
	for _, x := range mix {
		out.KindMix = append(out.KindMix, KindRow{
			Kind: x.Kind, RoomNights: x.RoomNights, AmountCents: x.Amount,
			ShareBps: domain.Bps(int(x.Amount), int(mixTotal)),
			AvgPrice: domain.SafeDiv(x.Amount, int64(x.RoomNights)),
		})
	}
	sort.SliceStable(out.Props, func(i, j int) bool { return out.Props[i].RevenueCents > out.Props[j].RevenueCents })
	return out, nil
}

// TodayStats 给没有注入时钟的调用方用。
func (s *Service) TodayStats(ctx context.Context) (*Stats, error) {
	return s.Stats(ctx, time.Now())
}

func propOf(props []domain.Property, code string) *domain.Property {
	for i := range props {
		if props[i].Code == code {
			return &props[i]
		}
	}
	return nil
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
