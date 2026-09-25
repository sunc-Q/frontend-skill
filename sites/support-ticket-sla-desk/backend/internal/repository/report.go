package repository

import (
	"context"
	"sort"
	"strconv"
	"time"

	"bizsite/internal/domain"
)

// BuildStats 组装看板统计。
//
// 铁律：这里**不做第二套时效算法** —— 每只工单只跑一次 domain.ComputeClock /
// domain.LedgerFor（与列表、详情完全同一个函数），统计层只负责求和与分组。
// 所以「看板说的超时数」与「队列表格里数出来的超时行数」不可能漂移。
func (r *Repo) BuildStats(ctx context.Context, now time.Time) (*domain.Stats, error) {
	raw, err := r.AllTickets(ctx, 5000)
	if err != nil {
		return nil, err
	}
	agents, err := r.AllAgents(ctx)
	if err != nil {
		return nil, err
	}
	events, err := r.AllEvents(ctx, 50000)
	if err != nil {
		return nil, err
	}
	evByTicket := make(map[int64][]domain.TicketEvent, len(raw))
	for _, e := range events {
		evByTicket[e.TicketID] = append(evByTicket[e.TicketID], e)
	}

	today := domain.DateKey(now)
	st := &domain.Stats{
		GeneratedAt:  now.In(domain.FieldTZ).Format(time.RFC3339),
		Today:        today,
		NowInSession: !domain.NextSessionAt(now).After(now),
		Calendar:     domain.CalendarSnapshotAt(now),
		CalendarDays: domain.CalendarDays(now, 16),
	}

	var metN, metD, respN, respMet, respBdSum, resolveBdSum, resolveBdN int64
	byStatus := make(map[string]*acc, len(domain.AllStatuses))
	byPriority := make(map[string]*acc, 4)
	byTeam := make(map[string]*acc, 8)
	byTier := make(map[string]*acc, 4)
	loads := make(map[int64]*loadAcc, len(agents))
	dailyCreated := make(map[string]int64)
	dailyResolved := make(map[string]int64)
	dailyBreached := make(map[string]int64)

	for i := range raw {
		rw := &raw[i]
		t := &rw.Ticket
		cs := domain.ComputeClock(t, now)
		ledger := domain.LedgerFor(t, domain.PauseSpansFromEvents(evByTicket[t.ID], now), now)
		open := !(cs.Finished || cs.Canceled)

		st.Total++
		if open {
			st.Open++
		}
		if t.Status == domain.StNew && t.AgentID == nil {
			st.NewUnassigned++
		}
		if t.Status == domain.StPending {
			st.Paused++
		}
		if cs.Breached {
			st.Breached++
		}
		if cs.AtRisk {
			st.AtRisk++
		}
		st.PausedBdTotal += cs.PausedBd
		st.WorkedBdTotal += cs.ElapsedBd
		st.OutsideBdTotal += ledger.OutsideMinutes

		dailyCreated[domain.DateKey(t.CreatedAt)]++
		if domain.DateKey(t.CreatedAt) == today {
			st.CreatedToday++
		}

		// 结束日：解决时刻优先（关单只是验收动作），取消单用取消时刻，在办单没有结束日。
		endDay := ""
		switch {
		case t.ResolvedAt != nil:
			endDay = domain.DateKey(*t.ResolvedAt)
			if endDay == today {
				st.ResolvedToday++
			}
		case t.Status == domain.StClosed && t.ClosedAt != nil:
			endDay = domain.DateKey(*t.ClosedAt)
		case t.Status == domain.StCanceled && t.CanceledAt != nil:
			endDay = domain.DateKey(*t.CanceledAt)
		}
		if endDay != "" {
			if t.Status == domain.StResolved || t.Status == domain.StClosed {
				dailyResolved[endDay]++
			}
			if cs.Breached {
				dailyBreached[endDay]++
			}
		}

		if t.Status == domain.StResolved || t.Status == domain.StClosed {
			st.ResolvedTotal++
		}
		if cs.Finished {
			resolveBdSum += t.ResolveBd
			resolveBdN++
			if cs.Met != nil {
				metD++
				if *cs.Met {
					metN++
				}
			}
		}
		if t.FirstResponse != nil {
			respN++
			respBdSum += t.ResponseBd
			if t.MetResponse != nil && *t.MetResponse {
				respMet++
			}
		}

		for key, bucket := range map[string]map[string]*acc{
			t.Status: byStatus, t.Priority: byPriority, t.Team: byTeam, rw.Tier: byTier,
		} {
			if key == "" {
				continue
			}
			a := bucket[key]
			if a == nil {
				a = &acc{}
				bucket[key] = a
			}
			a.total++
			if open {
				a.open++
			}
			if cs.Breached {
				a.breached++
			}
			if cs.Met != nil {
				a.metD++
				if *cs.Met {
					a.metN++
				}
			}
			if cs.Finished {
				a.bdN++
				a.bdSum += t.ResolveBd
			}
		}

		if t.AgentID != nil && open {
			l := loads[*t.AgentID]
			if l == nil {
				l = &loadAcc{}
				loads[*t.AgentID] = l
			}
			l.open++
			if t.Status == domain.StPending {
				l.paused++
			}
			if cs.Breached {
				l.breached++
			}
			l.loadBd += cs.ElapsedBd
		}

		// 审计：四条恒等式逐单核对，用的就是详情页那份账本。
		st.Audit.Checked++
		if !ledger.IdentityClock {
			st.Audit.ClockBad++
		}
		if !ledger.IdentityTimeline {
			st.Audit.TimelineBad++
		}
		if !ledger.IdentityWallSplit {
			st.Audit.WallSplitBad++
		}
		if respBd, met, pending := domain.ComputeResponseClock(t, now); !pending && met != nil {
			if t.ResponseBd != respBd || (t.MetResponse != nil && *t.MetResponse != *met) {
				st.Audit.ResponseBad++
			}
		}
	}

	st.Audit.ClockOK = st.Audit.ClockBad == 0
	st.Audit.TimelineOK = st.Audit.TimelineBad == 0
	st.Audit.WallSplitOK = st.Audit.WallSplitBad == 0
	st.Audit.ResponseOK = st.Audit.ResponseBad == 0
	st.Audit.Explanation = "四项逐单核对：① 工作分钟 = 停表 + 计时中；② 到期点反算 = 目标 + 停表；" +
		"③ 挂钟 = 非工作 + 工作；④ 时间线复算 = 落库停表累计。共核对 " +
		strconv.FormatInt(st.Audit.Checked, 10) + " 只工单。"

	st.MetRatePct = ratePct(metN, metD)
	st.ResponseMetPct = ratePct(respMet, respN)
	if respN > 0 {
		st.AvgResponseBd = round1(float64(respBdSum) / float64(respN))
	}
	if resolveBdN > 0 {
		st.AvgResolveBd = round1(float64(resolveBdSum) / float64(resolveBdN))
		st.AvgResolveHours = round1(st.AvgResolveBd / 60)
	}

	st.ByStatus = finalize(byStatus, domain.StatusLabel, domain.AllStatuses)
	st.ByPriority = finalize(byPriority, identityLabel, []string{"P1", "P2", "P3", "P4"})
	st.ByTeam = finalize(byTeam, identityLabel, nil)
	st.ByTier = finalize(byTier, domain.TierLabel, domain.Tiers)

	weekAgo := now.Add(-7 * 24 * time.Hour)
	st.Agents = make([]domain.AgentLoad, 0, len(agents))
	for _, a := range agents {
		l := domain.AgentLoad{
			AgentCode: a.Code, AgentName: a.Name, Team: a.Team, Title: a.Title,
			Active: a.Active, CapacityBd: a.CapacityBd,
		}
		if p := loads[a.ID]; p != nil {
			l.Open, l.Paused, l.Breached, l.LoadBd = p.open, p.paused, p.breached, p.loadBd
		}
		for i := range raw {
			t := &raw[i].Ticket
			if t.AgentID == nil || *t.AgentID != a.ID {
				continue
			}
			if t.ResolvedAt != nil && t.ResolvedAt.After(weekAgo) {
				l.ResolvedWk++
			}
		}
		if l.CapacityBd > 0 {
			l.LoadPct = int(float64(l.LoadBd) * 100 / float64(l.CapacityBd))
		}
		st.Agents = append(st.Agents, l)
	}

	st.Daily = make([]domain.DailyPoint, 0, 14)
	st.CalendarDays = domain.CalendarDays(now, 16)
	base := domain.StartOfDay(now)
	for i := 13; i >= 0; i-- {
		d := base.AddDate(0, 0, -i)
		k := domain.DateKey(d)
		st.Daily = append(st.Daily, domain.DailyPoint{
			Date: k, Created: dailyCreated[k], Resolved: dailyResolved[k],
			Working: domain.IsWorkingDay(d), Reason: domain.DayReason(d),
			Breached: dailyBreached[k],
		})
	}
	if st.NowInSession {
		st.WindowLabel = "工作窗口计时中"
	} else {
		st.WindowLabel = "休市中 · 下一窗口 " + st.Calendar.NextWindowLabel
	}
	return st, nil
}

type acc struct {
	total, open, breached, metN, metD, bdN, bdSum int64
}

type loadAcc struct {
	open, paused, breached, loadBd int64
}

func ratePct(part, whole int64) float64 {
	if whole <= 0 {
		return 0
	}
	return round1(float64(part) * 100 / float64(whole))
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

func identityLabel(s string) string { return s }

// finalize 按给定顺序输出分组行（order 为 nil 时按键名字典序），零计数分组自动跳过。
func finalize(m map[string]*acc, label func(string) string, order []string) []domain.RollupRow {
	keys := order
	if keys == nil {
		keys = make([]string, 0, len(m))
		for k := range m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	out := make([]domain.RollupRow, 0, len(keys))
	for _, k := range keys {
		a := m[k]
		if a == nil {
			continue
		}
		out = append(out, domain.RollupRow{
			Key: k, Label: label(k), Total: a.total, Open: a.open, Breached: a.breached,
			MetPct: ratePct(a.metN, a.metD),
			AvgBd: func() float64 {
				if a.bdN == 0 {
					return 0
				}
				return round1(float64(a.bdSum) / float64(a.bdN))
			}(),
		})
	}
	return out
}
