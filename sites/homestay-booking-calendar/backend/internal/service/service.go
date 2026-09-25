// Package service 是编排层：取数 + 调用 domain 的纯判定 + 组装视图。
// 这里不写业务规则本身（规则在 domain/pricing.go），避免"两套口径"。
package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"bizsite/internal/domain"
	"bizsite/internal/repository"
)

type Service struct {
	repo *repository.Repo
}

func New(repo *repository.Repo) *Service { return &Service{repo: repo} }

// Today 用本地日历日：民宿卖的是"哪一晚"，不能用 UTC。
func Today() string { return domain.DateStr(time.Now().Local()) }

const defaultWindow = 28

// ---------- 房型 / 门店 ----------

func (s *Service) Rooms(ctx context.Context, q domain.RoomQuery, today string, days int) ([]domain.RoomRow, int64, error) {
	rows, total, err := s.repo.Rooms(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	cal, occ, rts, err := s.houseState(ctx, today, days)
	if err != nil {
		return nil, 0, err
	}
	byCode := map[string]domain.RoomType{}
	for _, rt := range rts {
		byCode[rt.Code] = rt
	}
	for i := range rows {
		rt, ok := byCode[rows[i].Code]
		if !ok {
			continue
		}
		held, avail := domain.RoomWindowLoad(rt, cal, occ, today, days)
		rows[i].OccBpsWindow = domain.Bps(held, avail)
		rows[i].NextFreeFrom = domain.NextFreeFrom(rt, cal, occ, today, days+30)
	}
	return rows, total, nil
}

// Properties 返回门店 + 其房型 + 整院窗口负载。
func (s *Service) Properties(ctx context.Context, today string, days int) ([]domain.PropertyRow, error) {
	props, err := s.repo.Properties(ctx)
	if err != nil {
		return nil, err
	}
	rooms, _, err := s.Rooms(ctx, domain.RoomQuery{Page: 1, PageSize: domain.MaxPageSize, Sort: "property", Dir: "asc"}, today, days)
	if err != nil {
		return nil, err
	}
	rts, err := s.repo.RoomsAll(ctx)
	if err != nil {
		return nil, err
	}
	cal, err := s.repo.LoadCalendar(ctx)
	if err != nil {
		return nil, err
	}
	stays, err := s.repo.LoadStays(ctx, today, domain.AddDays(today, days), domain.HoldStatuses)
	if err != nil {
		return nil, err
	}
	occ := domain.ExpandStays(stays, today, domain.AddDays(today, days))
	byProp := map[string][]domain.RoomRow{}
	for _, rt := range rooms {
		byProp[rt.PropertyCode] = append(byProp[rt.PropertyCode], rt)
	}
	rtByCode := map[string]domain.RoomType{}
	for _, rt := range rts {
		rtByCode[rt.Code] = rt
	}
	out := make([]domain.PropertyRow, 0, len(props))
	for _, p := range props {
		row := domain.PropertyRow{
			Code: p.Code, Name: p.Name, Region: p.Region, Intro: p.Intro,
			CheckInAt: p.CheckInAt, CheckOutAt: p.CheckOutAt,
			CleanBufferDays: p.CleanBufferDays, MinStayWeekend: p.MinStayWeekend,
			Rating: p.Rating, Rooms: byProp[p.Code],
		}
		if row.Rooms == nil {
			row.Rooms = []domain.RoomRow{}
		}
		held, avail := 0, 0
		for _, rt := range row.Rooms {
			row.UnitTotal += rt.Units
			row.NightsSold += rt.NightsSold
			row.RevenueCents += rt.RevenueCents
			if full, ok := rtByCode[rt.Code]; ok {
				h, a := domain.RoomWindowLoad(full, cal, occ, today, days)
				held += h
				avail += a
			}
		}
		row.ADR = domain.SafeDiv(row.RevenueCents, int64(row.NightsSold))
		row.OccBpsWindow = domain.Bps(held, avail)
		out = append(out, row)
	}
	return out, nil
}

// RoomDetail 是房型卡片 + 未来日历。
func (s *Service) RoomDetail(ctx context.Context, code, from string, days int, today string) (*domain.RoomRow, []domain.CalDay, *domain.Property, error) {
	rt, prop, cal, err := s.roomWithProperty(ctx, code)
	if err != nil {
		return nil, nil, nil, err
	}
	stays, err := s.repo.LoadStays(ctx, from, domain.AddDays(from, days), domain.HoldStatuses)
	if err != nil {
		return nil, nil, nil, err
	}
	occ := domain.ExpandStays(stays, from, domain.AddDays(from, days))
	cards, _, err := s.Rooms(ctx, domain.RoomQuery{Property: prop.Code, Page: 1, PageSize: domain.MaxPageSize, Sort: "property", Dir: "asc"}, today, days)
	if err != nil {
		return nil, nil, nil, err
	}
	var card *domain.RoomRow
	for i := range cards {
		if cards[i].Code == code {
			card = &cards[i]
			break
		}
	}
	if card == nil {
		return nil, nil, nil, domain.ErrNotFound
	}
	_ = rt
	return card, domain.BuildCalendar(*rt, cal, occ, from, days), prop, nil
}

// ---------- 试算 / 下单 ----------

// Quote 无副作用：blockers 非空时 ok=false，但仍返回 200 与完整拆价，
// 让前台能把"哪几晚订不了"逐条显示出来。
func (s *Service) Quote(ctx context.Context, roomCode string, in domain.QuoteInput, today string) (*domain.QuoteResult, error) {
	rt, prop, cal, err := s.roomWithProperty(ctx, roomCode)
	if err != nil {
		return nil, err
	}
	stays, err := s.quoteStays(ctx, in)
	if err != nil {
		return nil, err
	}
	return domain.BuildQuote(*rt, *prop, cal, in, today, stays), nil
}

// quoteStays 取一段足够宽的占房集合：判定区间 + 前后各 7 天（覆盖缓冲政策）。
func (s *Service) quoteStays(ctx context.Context, in domain.QuoteInput) ([]domain.Stay, error) {
	from := domain.AddDays(in.CheckIn, -7)
	to := domain.AddDays(in.CheckOut, 8)
	return s.repo.LoadStays(ctx, from, to, domain.HoldStatuses)
}

func (s *Service) Book(ctx context.Context, roomCode string, in domain.BookingInput, now time.Time) (*domain.BookingRow, error) {
	today := domain.DateStr(now.Local())
	var out *domain.BookingRow
	err := s.repo.Transaction(ctx, func(tx *repository.Repo) error {
		rt, err := tx.RoomByCode(ctx, roomCode)
		if err != nil {
			return err
		}
		prop, err := tx.PropertyByCode(ctx, rt.PropertyCode)
		if err != nil {
			return err
		}
		cal, err := tx.LoadCalendar(ctx)
		if err != nil {
			return err
		}
		stays, err := tx.LoadStays(ctx, domain.AddDays(in.CheckIn, -7), domain.AddDays(in.CheckOut, 8), domain.HoldStatuses)
		if err != nil {
			return err
		}
		q := domain.BuildQuote(*rt, *prop, cal, domain.QuoteInput{
			CheckIn: in.CheckIn, CheckOut: in.CheckOut, Units: in.Units, Guests: in.Guests,
		}, today, stays)
		if !q.Ok {
			return domain.New("not_available", "所选日期不可订："+strings.Join(q.Blockers, "；"), 409)
		}
		seq, err := tx.CountBookingsOfDay(ctx, now.Format("20060102"))
		if err != nil {
			return err
		}
		for attempt := 0; attempt < domain.MaxCodeRetry; attempt++ {
			code := fmt.Sprintf("HS%s-%03d", now.Format("20060102"), int(seq)+attempt+1)
			if exists, err := tx.BookingByCode(ctx, code); err == nil && exists != nil {
				continue
			}
			b := &domain.Booking{
				Code: code, RoomCode: rt.Code, PropertyCode: rt.PropertyCode,
				GuestName: strings.TrimSpace(in.GuestName), Phone: strings.TrimSpace(in.Phone),
				CheckIn: in.CheckIn, CheckOut: in.CheckOut,
				Units: in.Units, Guests: in.Guests, Channel: in.Channel, Status: domain.StPending,
				NightSubtotalCents: q.NightSubtotal, CleanFeeCents: q.CleanFeeCents, TotalCents: q.TotalCents,
				Nights: q.Nights, Note: strings.TrimSpace(in.Note), AvgNightPriceCents: q.AvgNightCents,
				CreatedAt: now, UpdatedAt: now,
			}
			nights := make([]domain.BookingNight, 0, len(q.NightsDetail))
			for _, n := range q.NightsDetail {
				nights = append(nights, domain.BookingNight{
					Date: n.Date, Kind: n.Kind, Label: n.Label, PriceCents: n.PriceCents,
					Units: n.Units, AmountCents: n.AmountCents,
				})
			}
			if err := tx.InsertBooking(ctx, b, nights); err != nil {
				if repository.IsUniqueViolation(err) {
					continue
				}
				return err
			}
			row := b.Row(prop.Name, rt.Name, today)
			out = &row
			return nil
		}
		return domain.New("code_exhausted", "订单号发号失败，请稍后重试", 409)
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------- 状态机 ----------

func (s *Service) SetStatus(ctx context.Context, code string, in domain.StatusInput, now time.Time) (*domain.BookingRow, string, error) {
	today := domain.DateStr(now.Local())
	var msg string
	var out *domain.BookingRow
	err := s.repo.Transaction(ctx, func(tx *repository.Repo) error {
		b, err := tx.BookingByCode(ctx, code)
		if err != nil {
			return err
		}
		from := b.Status
		if from == in.To {
			return domain.New("same_status", "订单已经处于该状态", 409)
		}
		if !domain.CanTransit(from, in.To) {
			return domain.New("bad_transition", fmt.Sprintf("不允许 %s → %s 的状态跳转", from, in.To), 409)
		}
		rt, err := tx.RoomByCode(ctx, b.RoomCode)
		if err != nil {
			return err
		}
		prop, err := tx.PropertyByCode(ctx, b.PropertyCode)
		if err != nil {
			return err
		}
		switch in.To {
		case domain.StCancelled:
			refund, why := domain.RefundFor(b, today)
			b.RefundCents = refund
			msg = fmt.Sprintf("已取消：%s（退款 %s，清洁费不退）", why, domain.Yuan(refund))
		case domain.StNoShow:
			b.RefundCents = 0
			msg = "已记未到：房费全额计入营收，库存即刻释放"
		case domain.StCheckedIn:
			if domain.DaysBetween(today, b.CheckIn) > 0 {
				return domain.New("not_yet", fmt.Sprintf("入住日是 %s，不能提前办理入住", b.CheckIn), 409)
			}
			msg = "已办理入住，房间开始占用"
		case domain.StCheckedOut:
			if domain.DaysBetween(b.CheckOut, today) > 0 {
				return domain.New("too_early", "还未到离店日，不能办理退房", 409)
			}
			msg = "已退房，库存与清洁缓冲已更新"
		default:
			msg = "订单已确认"
		}
		if note := strings.TrimSpace(in.Note); note != "" {
			b.Note = note
		}
		b.Status = in.To
		b.UpdatedAt = now
		if err := tx.SaveBookingState(ctx, b); err != nil {
			return err
		}
		row := b.Row(prop.Name, rt.Name, today)
		out = &row
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return out, msg, nil
}

// ---------- 停售 / 上下架 ----------

func (s *Service) ToggleClosure(ctx context.Context, roomCode string, in domain.ClosureInput) (*domain.CalDay, error) {
	rt, err := s.repo.RoomByCode(ctx, roomCode)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpsertClosure(ctx, in, rt); err != nil {
		return nil, err
	}
	cal, err := s.repo.LoadCalendar(ctx)
	if err != nil {
		return nil, err
	}
	occ := domain.Occupancy{}
	stays, err := s.repo.LoadStays(ctx, in.Date, domain.AddDays(in.Date, 1), domain.HoldStatuses)
	if err != nil {
		return nil, err
	}
	occ = domain.ExpandStays(stays, in.Date, domain.AddDays(in.Date, 1))
	cell := domain.BuildCalendar(*rt, cal, occ, in.Date, 1)
	if len(cell) == 0 {
		return nil, domain.ErrInternal
	}
	return &cell[0], nil
}

func (s *Service) SetRoomStatus(ctx context.Context, roomCode, to string) (int64, error) {
	if _, err := s.repo.RoomByCode(ctx, roomCode); err != nil {
		return 0, err
	}
	if err := s.repo.RoomStatusToggleTarget(ctx, roomCode, to); err != nil {
		return 0, err
	}
	return s.repo.ActiveRoomCount(ctx)
}

// ---------- 订单读取 ----------

func (s *Service) Bookings(ctx context.Context, q domain.BookingQuery, today string) ([]domain.BookingRow, int64, error) {
	return s.repo.Bookings(ctx, q, today)
}

func (s *Service) BookingDetail(ctx context.Context, code, today string) (*domain.BookingRow, []domain.NightPrice, error) {
	b, pname, rname, err := s.repo.BookingFull(ctx, code)
	if err != nil {
		return nil, nil, err
	}
	items, err := s.repo.NightsOf(ctx, b.ID)
	if err != nil {
		return nil, nil, err
	}
	row := b.Row(pname, rname, today)
	return &row, items, nil
}

// ---------- 共用取数 ----------

func (s *Service) roomWithProperty(ctx context.Context, code string) (*domain.RoomType, *domain.Property, map[string]domain.RateDay, error) {
	rt, err := s.repo.RoomByCode(ctx, code)
	if err != nil {
		return nil, nil, nil, err
	}
	prop, err := s.repo.PropertyByCode(ctx, rt.PropertyCode)
	if err != nil {
		return nil, nil, nil, err
	}
	cal, err := s.repo.LoadCalendar(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	return rt, prop, cal, nil
}

func (s *Service) houseState(ctx context.Context, from string, days int) (map[string]domain.RateDay, domain.Occupancy, []domain.RoomType, error) {
	cal, err := s.repo.LoadCalendar(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	stays, err := s.repo.LoadStays(ctx, from, domain.AddDays(from, days), domain.HoldStatuses)
	if err != nil {
		return nil, nil, nil, err
	}
	rts, err := s.repo.RoomsAll(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	return cal, domain.ExpandStays(stays, from, domain.AddDays(from, days)), rts, nil
}

func (s *Service) Repo() *repository.Repo { return s.repo }

// DefaultWindow 供 handler 统一收敛 ?days=。
func DefaultWindow() int { return defaultWindow }
