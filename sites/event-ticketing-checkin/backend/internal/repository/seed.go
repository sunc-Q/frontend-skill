package repository

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"gorm.io/gorm"

	"etk/internal/domain"
)

// 种子是一次「一个经营周的真实量级」回放：8 场演出（1 草稿 / 4 在售 / 2 已散场 / 1 取消），
// 20 个票档，约 60 笔订单与 150 张票，覆盖全部三张状态机的每一条边。
//
// 两条铁律（都是历史轮次用真缺陷换来的）：
//  1. 所有落库时间一律 UTC —— 混进 +08:00 会让 datetime 文本排序退化成字符串比较。
//  2. 确定性种子必须对「当前墙钟」做边界检查：检票时刻不得晚于 now，
//     进行中场次的时间要相对 now 生成，否则清晨跑批时「此刻开门」的场次会整段消失。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	now = now.UTC().Truncate(time.Second)
	rnd := rand.New(rand.NewSource(20260926))

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, spec := range eventSpecs(now) {
			e := spec.event
			e.CreatedAt = spec.created
			if err := tx.Create(&e).Error; err != nil {
				return fmt.Errorf("建场次 %s 失败: %w", e.Code, err)
			}
			for ti := range spec.types {
				t := &spec.types[ti]
				t.EventID = e.ID
				if err := tx.Create(t).Error; err != nil {
					return fmt.Errorf("建票档 %s 失败: %w", t.Code, err)
				}
			}
			if err := seedOrdersForEvent(tx, e, spec.types, spec.loadFactor, now, rnd); err != nil {
				return err
			}
		}
		return r.recomputeSold(ctx, tx)
	})
}

type eventSpec struct {
	event      domain.Event
	types      []domain.TicketType
	created    time.Time
	loadFactor float64 // 目标售出率（占配额比例）
}

func ts(now time.Time, dayOffset, hour, minute int) time.Time {
	base := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, time.UTC)
	return base.AddDate(0, 0, dayOffset)
}

// 相对 now 的分钟偏移：进行中场次必须锚在墙钟上，否则「此刻可检票」这条分支会随运行时刻漂移。
func rel(now time.Time, minutes int) time.Time {
	return now.Add(time.Duration(minutes) * time.Minute).Truncate(time.Minute)
}

func eventSpecs(now time.Time) []eventSpec {
	const sec = time.Second
	mk := func(code, title, artist, category, venue, city, gates string, doors, start, presale, created time.Time,
		status string, cutH int, note string, load float64, types ...domain.TicketType) eventSpec {
		return eventSpec{
			event: domain.Event{
				Code: code, Title: title, Artist: artist, Category: category, Venue: venue, City: city,
				Gates: gates, DoorsAt: doors, StartAt: start, OnSaleAt: created, PresaleEnd: presale,
				Status: status, RefundCutH: cutH, Note: note,
			},
			types:      types,
			created:    created,
			loadFactor: load,
		}
	}
	_ = sec

	return []eventSpec{
		mk("ET260920A", "秋声四重奏 · 音乐厅之夜", "穆索尔斯基四重奏团", "concert", "城市音乐厅 · 大厅", "上海",
			"A,B,VIP",
			ts(now, -6, 19, 0), ts(now, -6, 19, 30), ts(now, -20, 0, 0), ts(now, -25, 10, 0),
			domain.EventClosed, 24, "对号入座，迟到者第二乐章后入场", 0.82,
			tt("TT260920A1", "池座正价", "池座", 48000, 600, 0, 120, true),
			tt("TT260920A2", "楼座早鸟", "楼座", 28000, 600, 1200, 80, true),
			tt("TT260920A3", "学生票", "池座", 12000, 600, 0, 30, true),
		),
		mk("ET260924A", "话剧《雾港》首演场", "雾港剧团", "theatre", "南镬剧场", "上海",
			"A,B",
			ts(now, -2, 19, 30), ts(now, -2, 20, 0), ts(now, -14, 0, 0), ts(now, -18, 9, 0),
			domain.EventClosed, 12, "首演场含演后谈", 0.9,
			tt("TT260924A1", "全场统一票价", "池座", 38000, 500, 0, 160, true),
			tt("TT260924A2", "无障碍席", "池座", 38000, 0, 0, 12, true),
			tt("TT260924A3", "演后谈套票", "池座", 58000, 500, 800, 40, true),
		),
		mk("ETLIVE01", "夜航班 · 巡演收尾场", "夜航班乐队", "livehouse", "灯塔 Livehouse", "上海",
			"G1,G2",
			rel(now, -45), rel(now, 150), rel(now, -180), ts(now, -21, 12, 0),
			domain.EventOnSale, 6, "站席自由入场，闸口双通道", 0.55,
			tt("TTLIVE011", "预售站席", "站席", 22000, 400, 0, 300, false),
			tt("TTLIVE012", "现场补票", "站席", 28000, 400, 0, 60, false),
			tt("TTLIVE013", "工作票（前台核销）", "站席", 0, 0, 0, 20, false, domain.TypePaused),
		),
		mk("ET261001A", "钢与弦 · 交响金属之夜", "钢与弦爱乐", "concert", "城市音乐厅 · 大厅", "上海",
			"A,B,VIP",
			ts(now, 5, 19, 30), ts(now, 5, 20, 15), ts(now, 2, 23, 59), ts(now, -3, 10, 0),
			domain.EventOnSale, 24, "早鸟立减 12%，截止开演前三天", 0.34,
			tt("TT261001A1", "内场早鸟", "内场", 68000, 800, 1200, 90, true),
			tt("TT261001A2", "看台票", "看台", 38000, 800, 800, 240, true),
			tt("TT261001A3", "学生票", "看台", 15000, 800, 0, 40, true),
		),
		mk("ET261005A", "儿童剧《月亮上的邮差》", "小舟剧社", "family", "文化宫小剧场", "上海",
			"A,B",
			ts(now, 9, 10, 0), ts(now, 9, 10, 30), ts(now, -1, 18, 0), ts(now, -10, 8, 0),
			domain.EventOnSale, 6, "早鸟已结束，一律全价", 0.22,
			tt("TT261005A1", "亲子套票（1 大 1 小）", "池座", 32000, 400, 1500, 60, true),
			tt("TT261005A2", "单人票", "池座", 16000, 400, 1500, 100, true),
		),
		mk("ET261010A", "潮汐邀请赛 · 半决赛观众席", "潮汐电竞联盟", "esports", "西岸体育馆", "上海",
			"E1,E2,E3,N",
			ts(now, 14, 17, 0), ts(now, 14, 18, 30), ts(now, 6, 12, 0), ts(now, -6, 11, 0),
			domain.EventOnSale, 48, "四闸口同开，团体票分销给合作方", 0.41,
			tt("TT261010A1", "内场站席", "内场", 28800, 1000, 500, 400, false),
			tt("TT261010A2", "看台对号", "看台", 16800, 1000, 500, 600, true),
			tt("TT261010A3", "团体分销票", "看台", 12800, 500, 0, 200, true),
			tt("TT261010A4", "志愿者工作票", "看台", 0, 0, 0, 30, true, domain.TypePaused),
		),
		mk("ET261020A", "新剧场开幕展演（待开票）", "本地剧团联合", "theatre", "北屿新剧场", "上海",
			"A,B",
			ts(now, 24, 19, 0), ts(now, 24, 19, 45), ts(now, 20, 0, 0), ts(now, -1, 15, 0),
			domain.EventDraft, 24, "场次待官宣，票档先建好", 0,
			tt("TT261020A1", "开幕全价票", "池座", 20000, 400, 1000, 180, true),
			tt("TT261020A2", "开幕工作票", "池座", 0, 0, 0, 20, true, domain.TypePaused),
		),
		mk("ET260928C", "雷雨音乐会（因故取消）", "临时组合", "concert", "城市音乐厅 · 厅外广场", "上海",
			"A",
			ts(now, -1, 16, 0), ts(now, -1, 16, 30), ts(now, -8, 0, 0), ts(now, -15, 10, 0),
			domain.EventCanceld, 12, "主演身体不适整场取消，全额退票", 0.5,
			tt("TT260928C1", "广场站席", "站席", 18000, 400, 0, 200, false),
			tt("TT260928C2", "看台票", "看台", 12000, 400, 0, 120, true),
		),
	}
}

func tt(code, name, zone string, unit, service int64, earlyBps int, quota int64, seated bool, status ...string) domain.TicketType {
	st := domain.TypeOpen
	if len(status) > 0 {
		st = status[0]
	}
	return domain.TicketType{
		Code: code, Name: name, Zone: zone, UnitCent: unit, ServiceCent: service,
		EarlyBps: earlyBps, Quota: quota, Seated: seated, Status: st,
	}
}

var buyerFirst = []string{"chen", "lin", "wang", "zhao", "su", "ye", "gu", "shen", "lu", "zheng", "xie", "ou"}
var buyerLast = []string{"wei", "yan", "ming", "tao", "lei", "jing", "fan", "yuan", "hao", "qing", "bo", "ni"}
var channels = []string{domain.ChannelWeb, domain.ChannelWeb, domain.ChannelWeb, domain.ChannelBox, domain.ChannelPartner, domain.ChannelOnsite}

// seedOrdersForEvent 按目标售出率给每个票档出单，并刻意造出这些分支样本：
// 已退票（票全作废）、未支付作废（零票）、多张同单、以及已检票入场。
func seedOrdersForEvent(tx *gorm.DB, e domain.Event, types []domain.TicketType, load float64, now time.Time, rnd *rand.Rand) error {
	if load <= 0 {
		return nil
	}
	ordSeq := 0
	for ti := range types {
		t := &types[ti]
		if t.Status != domain.TypeOpen {
			continue
		}
		target := int64(float64(t.Quota) * load)
		if target > t.Quota {
			target = t.Quota
		}
		if target < 2 {
			target = 2
		}
		issued := int64(0)
		for issued < target {
			qty := int64(1 + rnd.Intn(4))
			if issued+qty > target {
				qty = target - issued
			}
			if qty < 1 {
				break
			}
			ordSeq++
			created := orderTime(e, now, rnd, ordSeq)
			channel := channels[rnd.Intn(len(channels))]
			// 取消场次一律整单退（票全作废、服务费留存），否则口径与「全额退票」公告矛盾。
			refunded := e.Status == domain.EventCanceld
			cancelled := !refunded && ordSeq%17 == 0
			bps := 0
			if now.Before(e.PresaleEnd) && t.EarlyBps > 0 {
				bps = t.EarlyBps
			}
			tot := domain.TotalsFor(t.UnitCent, t.ServiceCent, bps, bps > 0, qty)
			buyer := fmt.Sprintf("%s_%s%02d", buyerFirst[rnd.Intn(len(buyerFirst))], buyerLast[rnd.Intn(len(buyerLast))], rnd.Intn(90)+10)
			phone := fmt.Sprintf("13%09d", rnd.Intn(1000000000))
			// 编号带场次前缀 + 单内序号，跨场次天然不撞（纯算术映射会在序号复位时重号）。
			code := fmt.Sprintf("ET%s%03d", strings.TrimPrefix(e.Code, "ET"), ordSeq)
			order := domain.Order{
				Code: code, EventID: e.ID, TypeID: t.ID, Buyer: buyer, Phone: phone, Channel: channel,
				Quantity: qty, UnitCent: tot.UnitCent, ServiceCent: t.ServiceCent, DiscountBps: tot.DiscountBps,
				SubtotalCent: tot.SubtotalCent, FeeCent: tot.FeeCent, PayableCent: tot.PayableCent,
				CreatedAt: created, LastFourDigits: tailDigits(phone, 4),
			}
			switch {
			case cancelled:
				order.Status = domain.OrderCancelled
			case refunded:
				order.Status = domain.OrderRefunded
				order.PaidAt = &created
				rt := created.Add(40 * time.Minute)
				order.RefundedAt = &rt
				order.RefundedCent = tot.SubtotalCent
				order.RetainedCent = tot.FeeCent
				order.RefundReason = "行程变更，开演前申请退票"
			default:
				order.Status = domain.OrderPaid
				order.PaidAt = &created
			}
			if err := tx.Create(&order).Error; err != nil {
				return fmt.Errorf("建订单 %s 失败: %w", code, err)
			}
			if cancelled {
				continue
			}
			issued += qty
			var tickets []domain.Ticket
			for i := int64(1); i <= qty; i++ {
				seq := issued - qty + i
				zone, row, no := domain.SeatLabel(t.Zone, t.Seated, seq, domain.SeatsPerRow)
				st := domain.TicketValid
				var usedAt *time.Time
				var gate string
				if !refunded {
					st, usedAt, gate = checkinPlan(e, now, rnd, t, seq)
				}
				tickets = append(tickets, domain.Ticket{
					Code: fmt.Sprintf("TK%s%02d", code[2:], i), OrderID: order.ID, EventID: e.ID, TypeID: t.ID,
					Seq: seq, SeatZone: zone, SeatRow: row, SeatNo: no, Status: st,
					IssuedAt: created, UsedAt: usedAt, Gate: gate,
				})
			}
			if refunded {
				for i := range tickets {
					tickets[i].Status = domain.TicketVoid
				}
			}
			if err := tx.Create(&tickets).Error; err != nil {
				return fmt.Errorf("建票券失败: %w", err)
			}
		}
	}
	return nil
}

// orderTime 把下单时刻落在「开票之后、不晚于现在」的区间内，
// 并且散场/进行中场次的下单必须早于其开门时间——否则趋势图会出现未来开票的过去检票。
func orderTime(e domain.Event, now time.Time, rnd *rand.Rand, n int) time.Time {
	earliest := e.OnSaleAt
	if earliest.After(now) {
		earliest = now.AddDate(0, 0, -1)
	}
	latest := now
	if e.Status == domain.EventClosed && e.DoorsAt.Before(now) {
		latest = e.DoorsAt.Add(-30 * time.Minute)
	}
	if e.Status == domain.EventCanceld && e.DoorsAt.Before(now) {
		latest = e.DoorsAt.Add(-2 * time.Hour)
	}
	if !latest.After(earliest) {
		return earliest.UTC()
	}
	span := int64(latest.Sub(earliest) / time.Minute)
	if span < 1 {
		span = 1
	}
	offset := (int64(n)*137 + rnd.Int63n(span+1)) % (span + 1)
	return earliest.Add(time.Duration(offset) * time.Minute).UTC()
}

// checkinPlan 决定一张票此刻是「已入场 / 未入场」。
// 已散场按 85% 上座检票率、进行中按当前进度比例检票，时刻绝不晚于 now。
func checkinPlan(e domain.Event, now time.Time, rnd *rand.Rand, t *domain.TicketType, seq int64) (string, *time.Time, string) {
	gates := domain.GateList(e.Gates)
	gate := "A"
	if len(gates) > 0 {
		gate = gates[int(seq)%len(gates)]
	}
	ratio := 0.0
	switch e.Status {
	case domain.EventClosed:
		ratio = 0.85
	case domain.EventCanceld:
		return domain.TicketValid, nil, ""
	case domain.EventOnSale:
		if now.After(e.StartAt) {
			ratio = 0.8
		} else if now.After(e.DoorsAt) {
			// 进行中场次：检票进度随「已开门时长 / 总时长」线性推进。
			total := e.StartAt.Sub(e.DoorsAt)
			done := now.Sub(e.DoorsAt.Add(-time.Duration(domain.CheckinPreDoorsMin) * time.Minute))
			if total > 0 {
				ratio = float64(done) / float64(total+time.Duration(domain.CheckinGraceMin)*time.Minute)
			}
			if ratio > 0.7 {
				ratio = 0.7
			}
		}
	}
	if ratio <= 0 || float64(seq%100)/100.0 >= ratio {
		return domain.TicketValid, nil, ""
	}
	from := e.DoorsAt.Add(-time.Duration(domain.CheckinPreDoorsMin) * time.Minute)
	to := e.StartAt.Add(30 * time.Minute)
	if now.Before(to) {
		to = now
	}
	if !to.After(from) {
		from = to.Add(-10 * time.Minute)
	}
	span := int64(to.Sub(from) / time.Minute)
	if span < 1 {
		span = 1
	}
	usedAt := from.Add(time.Duration((seq*53)%(span+1)) * time.Minute).UTC()
	if usedAt.After(now) {
		usedAt = now.Add(-time.Minute)
	}
	return domain.TicketUsed, &usedAt, gate
}

// recomputeSold 是唯一给 sold_quantity 定口径的地方：
// 以「valid + used 的真实票数」为准，杜绝种子或写路径漂移出来的假配额。
func (r *Repo) recomputeSold(ctx context.Context, tx *gorm.DB) error {
	return tx.Exec(`UPDATE ticket_types SET sold_quantity = (
		SELECT COUNT(*) FROM tickets
		WHERE tickets.type_id = ticket_types.id AND tickets.status IN ('valid','used')
	)`).Error
}
