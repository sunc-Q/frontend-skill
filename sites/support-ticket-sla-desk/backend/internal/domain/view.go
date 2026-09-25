package domain

import "time"

// ClockState 是「一只工单此刻的时间账」。列表、详情、统计三处共用这一个函数，
// 不存在第二套算法，所以三个口径不可能漂移。
type ClockState struct {
	ElapsedBd     int64     `json:"elapsed_bd_minutes"`
	PausedBd      int64     `json:"paused_bd_minutes"`
	PausedLiveBd  int64     `json:"paused_live_bd_minutes"`
	TotalBd       int64     `json:"business_minutes_observed"`
	RemainingBd   int64     `json:"remaining_bd_minutes"`
	Due           time.Time `json:"due"`
	Breached      bool      `json:"breached"`
	AtRisk        bool      `json:"at_risk"`
	ProgressPct   int       `json:"progress_pct"`
	Finished      bool      `json:"finished"`
	Canceled      bool      `json:"canceled"`
	Met           *bool     `json:"met"`
	ClockIdentity bool      `json:"clock_identity_ok"`
}

// ComputeClock 计算时效账。endAt 决定「算到哪一刻」：
// 已解决/已关单算到解决时刻（关单只是验收动作，不再计时效），取消单不参与时效，
// 其余一律算到 now。
func ComputeClock(t *Ticket, now time.Time) ClockState {
	st := ClockState{ClockIdentity: true}
	st.Finished = t.Status == StResolved || t.Status == StClosed
	st.Canceled = t.Status == StCanceled

	end := now
	switch {
	case t.ResolvedAt != nil:
		end = *t.ResolvedAt
	case t.Status == StClosed && t.ClosedAt != nil:
		end = *t.ClosedAt
	case t.Status == StCanceled:
		if t.CanceledAt != nil {
			end = *t.CanceledAt
		}
	}
	if end.Before(t.CreatedAt) {
		end = t.CreatedAt
	}

	st.PausedBd = t.PausedBd
	if t.PausedSince != nil && t.PausedSince.Before(end) {
		st.PausedLiveBd = BusinessMinutesBetween(*t.PausedSince, end)
		st.PausedBd += st.PausedLiveBd
	}
	st.TotalBd = BusinessMinutesBetween(t.CreatedAt, end)
	st.ElapsedBd = st.TotalBd - st.PausedBd
	if st.ElapsedBd < 0 {
		st.ElapsedBd = 0
	}
	target := int64(t.ResolveTarget)
	st.Due = AdvanceBusiness(t.CreatedAt, target+st.PausedBd)
	st.RemainingBd = target - st.ElapsedBd

	switch {
	case st.Canceled:
		st.Breached = false
		st.Met = nil
		st.RemainingBd = 0
		st.ProgressPct = 0
	case st.Finished:
		met := st.ElapsedBd <= target
		st.Met = &met
		st.Breached = !met
		st.ProgressPct = pct(st.ElapsedBd, target)
		if met {
			st.RemainingBd = target - st.ElapsedBd
		} else {
			st.RemainingBd = st.ElapsedBd - target // 超时量用正数表达，前端单独标「超时」
		}
	default:
		st.Breached = end.After(st.Due)
		st.AtRisk = !st.Breached && st.RemainingBd <= int64(AtRiskWindow())
		st.ProgressPct = pct(st.ElapsedBd, target)
	}

	// 两条恒等式：①观测到的工作分钟 = 已用 + 停表；②到期点反算必须回到目标值。
	// 第二条是对 Advance/BusinessMinutes 互逆性的线上体检，能抓住任何一侧的偏移。
	if st.TotalBd != st.ElapsedBd+st.PausedBd {
		st.ClockIdentity = false
	}
	if t.ResolveTarget > 0 && BusinessMinutesBetween(t.CreatedAt, st.Due) != target+st.PausedBd {
		st.ClockIdentity = false
	}
	return st
}

// ComputeResponseClock 首响时效：停表不参与（首响发生在挂起之前），到期点固定。
func ComputeResponseClock(t *Ticket, now time.Time) (bd int64, met *bool, pending bool) {
	if t.FirstResponse == nil {
		elapsed := BusinessMinutesBetween(t.CreatedAt, now)
		if t.Status == StCanceled {
			return elapsed, nil, false
		}
		m := elapsed <= int64(t.ResponseTarget) && !now.After(t.RespDueAt)
		return elapsed, &m, true
	}
	bd = BusinessMinutesBetween(t.CreatedAt, *t.FirstResponse)
	m := t.MetResponse
	if m == nil {
		v := bd <= int64(t.ResponseTarget)
		m = &v
	}
	return bd, m, false
}

// ResponseClock 是首响时效的对外视图（详情页与统计共用同一个计算函数）。
type ResponseClock struct {
	BdMinutes int64  `json:"bd_minutes"`
	TargetBd  int    `json:"target_bd_minutes"`
	Human     string `json:"target_human"`
	DueAt     string `json:"due_at"`
	Met       *bool  `json:"met"`
	Pending   bool   `json:"pending"`
}

func pct(part, whole int64) int {
	if whole <= 0 {
		return 0
	}
	v := int(float64(part) * 100 / float64(whole))
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// LedgerFor 组装详情页的时间账本：把挂钟拆成「非工作 + 工作」，再把工作拆成「停表 + 已用」。
// 三条分解式全部由独立计算得出，页面直接把等式显示出来。
func LedgerFor(t *Ticket, spans []PauseSpan, now time.Time) SlaLedger {
	cs := ComputeClock(t, now)
	end := now
	if t.ResolvedAt != nil {
		end = *t.ResolvedAt
	} else if t.Status == StClosed && t.ClosedAt != nil {
		end = *t.ClosedAt
	} else if t.Status == StCanceled && t.CanceledAt != nil {
		end = *t.CanceledAt
	}
	wall := int64(end.Sub(t.CreatedAt).Minutes())
	if wall < 0 {
		wall = 0
	}
	ledger := SlaLedger{
		CreatedAt:       t.CreatedAt.In(FieldTZ).Format(time.RFC3339),
		NowAt:           now.In(FieldTZ).Format(time.RFC3339),
		EndAt:           end.In(FieldTZ).Format(time.RFC3339),
		Stage:           StatusLabel(t.Status),
		WallMinutes:     wall,
		OutsideMinutes:  wall - cs.TotalBd,
		BusinessMinutes: cs.TotalBd,
		PausedBd:        cs.PausedBd,
		ElapsedBd:       cs.ElapsedBd,
		TargetBd:        t.ResolveTarget,
		RemainingBd:     cs.RemainingBd,
		DueAt:           cs.Due.In(FieldTZ).Format(time.RFC3339),
		TargetHuman:     HumanBd(int64(t.ResolveTarget)),
		Met:             cs.Met,
		IdentityClock:   cs.ClockIdentity,
	}
	ledger.IdentityWallSplit = ledger.OutsideMinutes >= 0 &&
		ledger.BusinessMinutes+ledger.OutsideMinutes == wall
	if len(spans) > 0 {
		ledger.IdentityTimeline = BusinessMinutesOfSpans(spans) == cs.PausedBd
	} else {
		ledger.IdentityTimeline = cs.PausedBd == 0
	}
	ledger.Decomposition = itoa(wall) + " = 非工作 " + itoa(ledger.OutsideMinutes) +
		" + 工作 " + itoa(cs.TotalBd) + "；工作 " + itoa(cs.TotalBd) +
		" = 停表 " + itoa(cs.PausedBd) + " + 计时中 " + itoa(cs.ElapsedBd)
	return ledger
}

// PauseSpansFromEvents 从时间线（paused/resumed 事件对）复算停表区间。
// 这是「时间线自证」的数据来源：账本不信任 tickets.paused_bd，而是重新积分一遍。
func PauseSpansFromEvents(events []TicketEvent, now time.Time) []PauseSpan {
	spans := make([]PauseSpan, 0, 4)
	var open *time.Time
	for _, e := range events {
		at := e.At
		switch e.Kind {
		case EvPaused:
			if open == nil {
				cp := at
				open = &cp
			}
		case EvResumed:
			if open != nil {
				spans = append(spans, PauseSpan{From: *open, To: at})
				open = nil
			}
		}
	}
	if open != nil {
		end := now
		if end.After(*open) {
			spans = append(spans, PauseSpan{From: *open, To: end})
		}
	}
	return spans
}
