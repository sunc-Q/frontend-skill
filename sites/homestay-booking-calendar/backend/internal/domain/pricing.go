// 价格与可订性引擎：全部是纯函数，线上试算、下单、种子回放共用同一份代码，
// 统计层不再算第二次价——这是"两套口径必然漂移"的结构性防御。
package domain

import (
	"fmt"
	"sort"
	"strings"
)

// Stay 是一条仍占库存的入住（由 repository 读出，不含隐私字段）。
type Stay struct {
	Code     string `gorm:"column:code"`
	RoomCode string `gorm:"column:room_code"`
	CheckIn  string `gorm:"column:check_in"`
	CheckOut string `gorm:"column:check_out"`
	Units    int    `gorm:"column:units"`
	Status   string `gorm:"column:status"`
}

// Occupancy 是 room|date → 已占间数。
type Occupancy map[string]int

func occKey(room, date string) string { return room + "|" + date }

func (o Occupancy) Get(room, date string) int { return o[occKey(room, date)] }

// ExpandStays 把入住区间展开成逐夜占用。只统计 [from, to) 内的夜晚。
func ExpandStays(stays []Stay, from, to string) Occupancy {
	occ := Occupancy{}
	for _, s := range stays {
		for _, d := range EachNight(s.CheckIn, s.CheckOut) {
			if d < from || d >= to {
				continue
			}
			occ[occKey(s.RoomCode, d)] += s.Units
		}
	}
	return occ
}

// QuoteInput 是试算输入（不含隐私字段）。
type QuoteInput struct {
	CheckIn  string
	CheckOut string
	Units    int
	Guests   int
}

// BuildQuote 是唯一的报价/可订性判定入口。
//
// 规则分层（顺序即优先级，blockers 会全部收集而不是遇错即停，方便前台一次展示）：
//  1. 日期形状：格式、离店晚于入住、最长 30 晚
//  2. 逐夜：停售日 → 库存不足
//  3. 整段：下架、超员、过去的日期、周末连住门槛、清洁缓冲
//
// stays 必须是同房型（或含其它房型，内部按 room 过滤）仍占库存的入住集合。
func BuildQuote(rt RoomType, prop Property, cal map[string]RateDay, in QuoteInput, today string, stays []Stay) *QuoteResult {
	if in.Units <= 0 {
		in.Units = 1
	}
	if in.Guests <= 0 {
		in.Guests = 1
	}
	q := &QuoteResult{
		Room: RoomRow{
			Code: rt.Code, PropertyCode: rt.PropertyCode, PropertyName: prop.Name, Name: rt.Name,
			Beds: rt.Beds, Capacity: rt.Capacity, Units: rt.Units, BasePriceCents: rt.BasePriceCents,
			WeekendPct: rt.WeekendPct, HolidayPct: rt.HolidayPct, CleanFeeCents: rt.CleanFeeCents,
			Breakfast: rt.Breakfast, Scene: rt.Scene, Amenities: rt.Amenities, Status: rt.Status,
			MinStayDefault: rt.MinStayDefault,
		},
		CheckIn: in.CheckIn, CheckOut: in.CheckOut, Units: in.Units, Guests: in.Guests,
		CleanFeeCents: rt.CleanFeeCents,
		NightsDetail:  []NightPrice{},
		Blockers:      []string{},
	}
	if !ValidDate(in.CheckIn) || !ValidDate(in.CheckOut) {
		q.Blockers = append(q.Blockers, "入住/离店日期需为 YYYY-MM-DD")
		return q
	}
	nights := EachNight(in.CheckIn, in.CheckOut)
	q.Nights = len(nights)
	if q.Nights == 0 {
		q.Blockers = append(q.Blockers, "离店日必须晚于入住日")
		return q
	}
	if q.Nights > MaxNights {
		q.Blockers = append(q.Blockers, fmt.Sprintf("单次最长 %d 晚", MaxNights))
		return q
	}

	occ := ExpandStays(stays, in.CheckIn, in.CheckOut)
	for _, date := range nights {
		np := ResolveNight(rt, date, cal)
		np.Units = in.Units
		switch np.Kind {
		case KindClosed:
			np.Label = orEmpty(np.Label, "整院包场/维护停售")
			q.Blockers = append(q.Blockers,
				fmt.Sprintf("%s（%s）停售：%s", date, np.Weekday, np.Label))
		default:
			np.AmountCents = np.PriceCents * int64(in.Units)
			used := occ.Get(rt.Code, date)
			if used+in.Units > rt.Units {
				q.Blockers = append(q.Blockers, fmt.Sprintf("%s（%s）仅剩 %d 间，本单需 %d 间",
					date, np.Weekday, maxOf(rt.Units-used, 0), in.Units))
			}
		}
		switch np.Kind {
		case KindWeekend:
			q.WeekendNights++
		case KindHoliday:
			q.HolidayNights++
		}
		q.NightsDetail = append(q.NightsDetail, np)
	}

	if rt.Status != RoomActive {
		q.Blockers = append(q.Blockers, "该房型已下架")
	}
	if in.Guests > rt.Capacity*in.Units {
		q.Blockers = append(q.Blockers, fmt.Sprintf("%d 间最多住 %d 人（每间上限 %d 人）",
			in.Units, rt.Capacity*in.Units, rt.Capacity))
	}
	if DaysBetween(today, in.CheckIn) < 0 {
		q.Blockers = append(q.Blockers, "入住日不能早于今天")
	}
	q.MinStay = rt.MinStayDefault
	if IsWeekendNight(in.CheckIn) && prop.MinStayWeekend > q.MinStay {
		q.MinStay = prop.MinStayWeekend
	}
	if q.Nights < q.MinStay {
		q.Blockers = append(q.Blockers, fmt.Sprintf("%s 入住需连住 %d 晚（周末连住政策）", in.CheckIn, q.MinStay))
	}
	q.Blockers = append(q.Blockers, bufferBlockers(rt.Code, prop.CleanBufferDays, in.CheckIn, in.CheckOut, stays)...)

	for _, n := range q.NightsDetail {
		q.NightSubtotal += n.AmountCents
	}
	q.TotalCents = q.NightSubtotal + q.CleanFeeCents
	q.RoomNights = q.Nights * q.Units
	if q.RoomNights > 0 {
		q.AvgNightCents = q.NightSubtotal / int64(q.RoomNights)
	}
	q.Ok = len(q.Blockers) == 0 && q.IdentityOK()
	return q
}

// bufferBlockers 检查与相邻入住之间的清洁缓冲：退房日 + 缓冲天数 之后才能再入住。
func bufferBlockers(roomCode string, bufferDays int, checkIn, checkOut string, stays []Stay) []string {
	if bufferDays <= 0 {
		return nil
	}
	var out []string
	for _, st := range stays {
		if st.RoomCode != roomCode {
			continue
		}
		if gap := DaysBetween(st.CheckOut, checkIn); gap >= 0 && gap < bufferDays {
			out = append(out, fmt.Sprintf("%s 于 %s 退房，后需留 %d 天清洁（本单 %s 入住）", st.Code, st.CheckOut, bufferDays, checkIn))
		}
		if gap := DaysBetween(checkOut, st.CheckIn); gap >= 0 && gap < bufferDays {
			out = append(out, fmt.Sprintf("本单 %s 退房后，%s 在 %s 入住，中间不足 %d 天清洁缓冲", checkOut, st.Code, st.CheckIn, bufferDays))
		}
	}
	sort.Strings(out)
	return out
}

// BuildCalendar 生成某房型 [from, from+days) 的逐日可售格。
func BuildCalendar(rt RoomType, cal map[string]RateDay, occ Occupancy, from string, days int) []CalDay {
	out := make([]CalDay, 0, days)
	for i := 0; i < days; i++ {
		date := AddDays(from, i)
		np := ResolveNight(rt, date, cal)
		cell := CalDay{
			Date: date, Weekday: np.Weekday, Kind: np.Kind, Label: np.Label,
			PriceCents: np.PriceCents, Units: rt.Units, Occupied: occ.Get(rt.Code, date),
		}
		if np.Kind == KindClosed {
			cell.Closed = true
			cell.Available = 0
		} else {
			cell.Available = maxOf(rt.Units-cell.Occupied, 0)
			cell.FillBps = int(int64(cell.Occupied) * 10000 / int64(maxOf(rt.Units, 1)))
		}
		out = append(out, cell)
	}
	return out
}

// NextFreeFrom 在未来 limit 天内找第一个还有空房的日期；找不到返回空串。
func NextFreeFrom(rt RoomType, cal map[string]RateDay, occ Occupancy, today string, limit int) string {
	for i := 0; i < limit; i++ {
		date := AddDays(today, i)
		if ResolveNight(rt, date, cal).Kind == KindClosed {
			continue
		}
		if rt.Units-occ.Get(rt.Code, date) > 0 {
			return date
		}
	}
	return ""
}

// RoomWindowLoad 汇总某房型在窗口内的可售/已占房晚。
func RoomWindowLoad(rt RoomType, cal map[string]RateDay, occ Occupancy, from string, days int) (held, available int) {
	for i := 0; i < days; i++ {
		date := AddDays(from, i)
		if ResolveNight(rt, date, cal).Kind == KindClosed {
			continue
		}
		held += occ.Get(rt.Code, date)
		available += rt.Units
	}
	return held, available
}

func orEmpty(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func maxOf(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// NightsForCodes 从入住集合里挑出与给定区间相交且属于该房型的单号，供日历格tooltip。
func NightsForCodes(stays []Stay, roomCode, checkIn, checkOut string) map[string][]string {
	out := map[string][]string{}
	for _, s := range stays {
		if s.RoomCode != roomCode {
			continue
		}
		for _, d := range EachNight(s.CheckIn, s.CheckOut) {
			if d < checkIn || d >= checkOut {
				continue
			}
			out[d] = append(out[d], s.Code)
		}
	}
	return out
}
