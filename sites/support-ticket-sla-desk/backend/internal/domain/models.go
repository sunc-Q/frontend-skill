package domain

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// ---- 工单状态机 ----

const (
	StNew      = "new"
	StAssigned = "assigned"
	StWorking  = "in_progress"
	StPending  = "pending_customer"
	StResolved = "resolved"
	StClosed   = "closed"
	StCanceled = "canceled"
)

var AllStatuses = []string{StNew, StAssigned, StWorking, StPending, StResolved, StClosed, StCanceled}

// 停表状态：等客户/等供应商期间不计 SLA 时效，必须由时间线可复算。
var pausedStatuses = map[string]bool{StPending: true}

// 终态：不可再推进（只能 409）。
var terminalStatuses = map[string]bool{StClosed: true, StCanceled: true}

var nextStatus = map[string][]string{
	StNew:      {StAssigned, StWorking, StCanceled},
	StAssigned: {StWorking, StPending, StCanceled},
	StWorking:  {StPending, StResolved, StCanceled},
	StPending:  {StWorking, StAssigned, StCanceled},
	StResolved: {StClosed, StWorking}, // →in_progress 即「客户验收不通过重开」
	StClosed:   {},
	StCanceled: {},
}

func IsTerminal(s string) bool     { return terminalStatuses[s] }
func IsPausedStatus(s string) bool { return pausedStatuses[s] }

// CanTransition 是状态推进的唯一裁判。
func CanTransition(from, to string) error {
	if !ValidStatus(from) || !ValidStatus(to) {
		return New("invalid_status", "未知的工单状态", 400)
	}
	if from == to {
		return New("same_status", "工单已处于该状态", 409)
	}
	for _, allow := range nextStatus[from] {
		if allow == to {
			return nil
		}
	}
	return New("invalid_transition",
		fmt.Sprintf("不允许从「%s」直接推进到「%s」", StatusLabel(from), StatusLabel(to)), 409)
}

func ValidStatus(s string) bool {
	for _, v := range AllStatuses {
		if v == s {
			return true
		}
	}
	return false
}

func StatusLabel(s string) string {
	switch s {
	case StNew:
		return "待受理"
	case StAssigned:
		return "已派单"
	case StWorking:
		return "处理中"
	case StPending:
		return "等客户反馈（停表）"
	case StResolved:
		return "已解决（待验收）"
	case StClosed:
		return "已关单"
	case StCanceled:
		return "已取消"
	default:
		return s
	}
}

// ReopenFrom 判定是否属于「重开」（resolved → in_progress）。
func ReopenFrom(from, to string) bool { return from == StResolved && to == StWorking }

const MaxReopen = 2

// ---- 实体 ----

type Customer struct {
	ID           int64     `gorm:"primaryKey" json:"id"`
	Code         string    `gorm:"uniqueIndex;size:24" json:"code"`
	Name         string    `gorm:"size:96" json:"name"`
	Tier         string    `gorm:"size:16;index" json:"tier"`
	Industry     string    `gorm:"size:32" json:"industry"`
	ContactName  string    `gorm:"size:32" json:"contact_name"`
	ContactPhone string    `gorm:"size:32" json:"-"` // 明文手机号绝不出接口
	Seats        int       `json:"seats"`
	Active       bool      `gorm:"index" json:"active"`
	JoinedAt     time.Time `json:"joined_at"`
}

type Agent struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	Code       string    `gorm:"uniqueIndex;size:16" json:"code"`
	Name       string    `gorm:"size:32" json:"name"`
	Team       string    `gorm:"size:32;index" json:"team"`
	Title      string    `gorm:"size:32" json:"title"`
	Skills     string    `gorm:"size:96" json:"skills"`
	Active     bool      `gorm:"index" json:"active"`
	CapacityBd int       `json:"capacity_bd_minutes"` // 每周可投入的工作分钟
	JoinedAt   time.Time `json:"joined_at"`
}

type SlaPolicy struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	Tier        string    `gorm:"size:16;uniqueIndex:idx_tier_sev" json:"tier"`
	Severity    string    `gorm:"size:4;uniqueIndex:idx_tier_sev" json:"severity"`
	ResponseMin int       `json:"response_min"`
	ResolveMin  int       `json:"resolve_min"`
	Description string    `gorm:"size:128" json:"description"`
	UpdatedBy   string    `gorm:"size:32" json:"updated_by"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Ticket struct {
	ID            int64      `gorm:"primaryKey" json:"id"`
	Code          string     `gorm:"uniqueIndex;size:24" json:"code"`
	Title         string     `gorm:"size:160" json:"title"`
	Description   string     `gorm:"size:1000" json:"description"`
	CustomerID    int64      `gorm:"index" json:"customer_id"`
	AgentID       *int64     `gorm:"index" json:"agent_id"`
	Team          string     `gorm:"size:32;index" json:"team"`
	Category      string     `gorm:"size:32" json:"category"`
	Channel       string     `gorm:"size:16" json:"channel"`
	Severity      string     `gorm:"size:4;index" json:"severity"`
	Priority      string     `gorm:"size:4;index" json:"priority"`
	Status        string     `gorm:"size:24;index" json:"status"`
	CreatedAt     time.Time  `gorm:"index" json:"created_at"`
	FirstResponse *time.Time `json:"first_response_at,omitempty"`
	ResolvedAt    *time.Time `json:"resolved_at,omitempty"`
	ClosedAt      *time.Time `json:"closed_at,omitempty"`
	CanceledAt    *time.Time `json:"canceled_at,omitempty"`

	// 时效快照：合同改策略不回溯在办工单，所以目标值与到期点都落库。
	ResponseTarget int       `json:"response_target_bd"`
	ResolveTarget  int       `json:"resolve_target_bd"`
	RespDueAt      time.Time `json:"resp_due_at"`
	ResolveDueAt   time.Time `gorm:"index" json:"resolve_due_at"`
	ReassignCount  int       `json:"reassign_count"`
	ReopenCount    int       `json:"reopen_count"`

	// 时间账（工作分钟）。停表区间只存「已完成」的累计值 + 一个进行中的起点。
	PausedSince *time.Time `gorm:"index" json:"paused_since,omitempty"`
	PauseReason string     `gorm:"size:32" json:"pause_reason"`
	PausedBd    int64      `json:"paused_bd_minutes"`
	ResponseBd  int64      `json:"response_bd_minutes"`
	ResolveBd   int64      `json:"resolve_bd_minutes"`
	MetResponse *bool      `json:"met_response,omitempty"`
	MetResolve  *bool      `json:"met_resolve,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

const (
	EvCreated  = "created"
	EvAssigned = "assigned"
	EvStatus   = "status"
	EvPaused   = "paused"
	EvResumed  = "resumed"
	EvNote     = "note"
	EvEscalate = "escalated"
)

type TicketEvent struct {
	ID         int64     `gorm:"primaryKey" json:"id"`
	TicketID   int64     `gorm:"index" json:"ticket_id"`
	Kind       string    `gorm:"size:16;index" json:"kind"`
	FromStatus string    `gorm:"size:24" json:"from_status"`
	ToStatus   string    `gorm:"size:24" json:"to_status"`
	Actor      string    `gorm:"size:32" json:"actor"`
	ActorRole  string    `gorm:"size:16" json:"actor_role"`
	Note       string    `gorm:"size:255" json:"note"`
	At         time.Time `gorm:"index" json:"at"`
}

// ---- 读取视图 ----

// TicketRow 是列表/详情共用的行视图：JOIN 一次取回展示字段，再叠加实时时间账。
type TicketRow struct {
	Ticket
	CustomerCode  string `json:"customer_code"`
	CustomerName  string `json:"customer_name"`
	Tier          string `json:"tier"`
	AgentCode     string `json:"agent_code"`
	AgentName     string `json:"agent_name"`
	MaskedPhone   string `json:"masked_phone"`
	ElapsedBd     int64  `json:"elapsed_bd_minutes"`
	PausedBdLive  int64  `json:"paused_bd_total_minutes"`
	RemainingBd   int64  `json:"remaining_bd_minutes"`
	DueAtLive     string `json:"due_at"`
	Breached      bool   `json:"breached"`
	AtRisk        bool   `json:"at_risk"`
	ProgressPct   int    `json:"progress_pct"`
	Finished      bool   `json:"finished"`
	ClockIdentity bool   `json:"clock_identity_ok"`
}

// SlaLedger 是详情页的「时间账本」：把挂钟拆成非工作/工作/停表/已用，逐条可核对。
type SlaLedger struct {
	CreatedAt         string `json:"created_at"`
	NowAt             string `json:"now_at"`
	EndAt             string `json:"end_at"`
	Stage             string `json:"stage"`
	WallMinutes       int64  `json:"wall_minutes"`
	OutsideMinutes    int64  `json:"outside_minutes"`
	BusinessMinutes   int64  `json:"business_minutes"`
	PausedBd          int64  `json:"paused_bd_minutes"`
	ElapsedBd         int64  `json:"elapsed_bd_minutes"`
	TargetBd          int    `json:"target_bd_minutes"`
	RemainingBd       int64  `json:"remaining_bd_minutes"`
	DueAt             string `json:"due_at"`
	TargetHuman       string `json:"target_human"`
	Met               *bool  `json:"met"`
	IdentityWallSplit bool   `json:"identity_wall_split_ok"`
	IdentityClock     bool   `json:"identity_clock_ok"`
	IdentityTimeline  bool   `json:"identity_timeline_ok"`
	Decomposition     string `json:"decomposition"`
}

type TimelineEntry struct {
	ID         int64  `json:"id"`
	Kind       string `json:"kind"`
	FromStatus string `json:"from_status"`
	ToStatus   string `json:"to_status"`
	Actor      string `json:"actor"`
	ActorRole  string `json:"actor_role"`
	Note       string `json:"note"`
	At         string `json:"at"`
	SpanBd     int64  `json:"span_bd_minutes"`
	SpanWall   int64  `json:"span_wall_minutes"`
	Counts     bool   `json:"counts_toward_sla"`
}

type AgentLoad struct {
	AgentCode  string `json:"agent_code"`
	AgentName  string `json:"agent_name"`
	Team       string `json:"team"`
	Title      string `json:"title"`
	Active     bool   `json:"active"`
	Open       int64  `json:"open"`
	Paused     int64  `json:"paused"`
	Breached   int64  `json:"breached"`
	ResolvedWk int64  `json:"resolved_week"`
	LoadBd     int64  `json:"load_bd_minutes"`
	CapacityBd int    `json:"capacity_bd_minutes"`
	LoadPct    int    `json:"load_pct"`
}

type RollupRow struct {
	Key      string  `json:"key"`
	Label    string  `json:"label"`
	Total    int64   `json:"total"`
	Open     int64   `json:"open"`
	Breached int64   `json:"breached"`
	MetPct   float64 `json:"met_pct"`
	AvgBd    float64 `json:"avg_bd_minutes"`
}

type DailyPoint struct {
	Date     string `json:"date"`
	Created  int64  `json:"created"`
	Resolved int64  `json:"resolved"`
	Working  bool   `json:"working_day"`
	Reason   string `json:"reason"`
	Breached int64  `json:"breached"`
}

type AuditBlock struct {
	Checked      int64  `json:"checked_tickets"`
	ClockOK      bool   `json:"clock_identity_ok"`
	ClockBad     int64  `json:"clock_violations"`
	TimelineOK   bool   `json:"timeline_identity_ok"`
	TimelineBad  int64  `json:"timeline_violations"`
	WallSplitOK  bool   `json:"wall_split_ok"`
	WallSplitBad int64  `json:"wall_split_violations"`
	ResponseOK   bool   `json:"response_identity_ok"`
	ResponseBad  int64  `json:"response_violations"`
	Explanation  string `json:"explanation"`
}

type Stats struct {
	GeneratedAt     string           `json:"generated_at"`
	Today           string           `json:"today"`
	NowInSession    bool             `json:"now_in_session"`
	WindowLabel     string           `json:"window_label"`
	Total           int64            `json:"total"`
	Open            int64            `json:"open"`
	NewUnassigned   int64            `json:"new_unassigned"`
	Paused          int64            `json:"paused"`
	Breached        int64            `json:"breached"`
	AtRisk          int64            `json:"at_risk"`
	CreatedToday    int64            `json:"created_today"`
	ResolvedToday   int64            `json:"resolved_today"`
	ResolvedTotal   int64            `json:"resolved_total"`
	MetRatePct      float64          `json:"met_rate_pct"`
	ResponseMetPct  float64          `json:"response_met_pct"`
	AvgResolveBd    float64          `json:"avg_resolve_bd_minutes"`
	AvgResponseBd   float64          `json:"avg_response_bd_minutes"`
	AvgResolveHours float64          `json:"avg_resolve_business_hours"`
	PausedBdTotal   int64            `json:"paused_bd_total"`
	WorkedBdTotal   int64            `json:"worked_bd_total"`
	OutsideBdTotal  int64            `json:"outside_minutes_total"`
	ByStatus        []RollupRow      `json:"by_status"`
	ByPriority      []RollupRow      `json:"by_priority"`
	ByTeam          []RollupRow      `json:"by_team"`
	ByTier          []RollupRow      `json:"by_tier"`
	Agents          []AgentLoad      `json:"agents"`
	Daily           []DailyPoint     `json:"daily"`
	Calendar        CalendarSnap     `json:"calendar"`
	CalendarDays    []CalendarDayRow `json:"calendar_days"`
	Audit           AuditBlock       `json:"audit"`
}

// CalendarDayRow 是「工作日历」条的一天：为什么计/不计、计多少分钟。
type CalendarDayRow struct {
	Date       string `json:"date"`
	Weekday    string `json:"weekday"`
	Working    bool   `json:"working"`
	Reason     string `json:"reason"`
	Minutes    int    `json:"minutes"`
	IsToday    bool   `json:"is_today"`
	IsHoliday  bool   `json:"is_holiday"`
	IsMakeup   bool   `json:"is_makeup"`
	PastWindow bool   `json:"past_window"`
}

type CalendarSnap struct {
	FieldZone       string   `json:"field_zone"`
	WorkingDays     []string `json:"working_days"`
	SessionWindows  []string `json:"session_windows"`
	MinutesPerDay   int      `json:"minutes_per_day"`
	Holidays        []string `json:"holidays"`
	MakeupWorkdays  []string `json:"makeup_workdays"`
	Today           string   `json:"today"`
	TodayWorking    bool     `json:"today_working"`
	TodayReason     string   `json:"today_reason"`
	NowInSession    bool     `json:"now_in_session"`
	NextWindowAt    string   `json:"next_window_at"`
	NextWindowLabel string   `json:"next_window_label"`
}

// ---- 写入 DTO ----

type CreateTicketInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Customer    string `json:"customer"`
	Severity    string `json:"severity"`
	Category    string `json:"category"`
	Channel     string `json:"channel"`
	Agent       string `json:"agent"`
}

type StatusInput struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

type PauseInput struct {
	Reason string `json:"reason"`
	Note   string `json:"note"`
}

type AssignInput struct {
	Agent string `json:"agent"`
	Note  string `json:"note"`
}

type PolicyInput struct {
	Tier        string `json:"tier"`
	Severity    string `json:"severity"`
	ResponseMin int    `json:"response_min"`
	ResolveMin  int    `json:"resolve_min"`
}

var Categories = []string{
	"网络与专线", "主机与虚拟化", "数据库", "账号与权限", "应用故障",
	"安全事件", "备份与恢复", "监控告警", "使用咨询", "变更申请",
}

// categoryTeam 是「分类 → 值班技能组」的映射。种子与线上提单共用它，
// 所以按组统计（stats.by_team）不会因为来源不同而分裂成两套组名。
var categoryTeam = map[string]string{
	"网络与专线":  "基础设施组",
	"主机与虚拟化": "基础设施组",
	"备份与恢复":  "基础设施组",
	"监控告警":   "平台值班组",
	"应用故障":   "应用支持组",
	"使用咨询":   "应用支持组",
	"变更申请":   "应用支持组",
	"数据库":    "数据与中间件组",
	"账号与权限":  "安全与合规组",
	"安全事件":   "安全与合规组",
}

func TeamForCategory(category string) string {
	if team, ok := categoryTeam[category]; ok {
		return team
	}
	return "应用支持组"
}

var Channels = []string{"工单门户", "电话", "邮件", "企业微信", "监控告警", "驻场代提"}

var PauseReasons = []string{"等客户复现", "等客户授权", "等厂商备件", "等第三方配合", "等变更窗口"}

func ValidCategory(s string) bool { return containsFold(Categories, s) }
func ValidChannel(s string) bool  { return containsFold(Channels, s) }
func ValidPauseReason(s string) bool {
	return s == "" || containsFold(PauseReasons, s)
}

func containsFold(list []string, v string) bool {
	for _, s := range list {
		if strings.EqualFold(s, v) {
			return true
		}
	}
	return false
}

func (in CreateTicketInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	title := strings.TrimSpace(in.Title)
	if n := len([]rune(title)); n < 4 || n > 80 {
		errs["title"] = "标题需为 4-80 个字符"
	}
	if n := len([]rune(strings.TrimSpace(in.Description))); n > 500 {
		errs["description"] = "描述最长 500 个字符"
	}
	if strings.TrimSpace(in.Customer) == "" {
		errs["customer"] = "必须指定客户编号"
	} else if !codeSafe(in.Customer) {
		errs["customer"] = "客户编号只允许字母、数字、下划线与连字符"
	}
	if !ValidSeverity(in.Severity) {
		errs["severity"] = "severity 只能是 S1/S2/S3/S4"
	}
	if in.Category != "" && !ValidCategory(in.Category) {
		errs["category"] = "category 不在分类字典内"
	}
	if in.Channel != "" && !ValidChannel(in.Channel) {
		errs["channel"] = "channel 不在渠道字典内"
	}
	if in.Agent != "" && !codeSafe(in.Agent) {
		errs["agent"] = "工程师编号格式非法"
	}
	return errs, len(errs) == 0
}

func (in StatusInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidStatus(in.Status) {
		errs["status"] = "status 只能是 new/assigned/in_progress/pending_customer/resolved/closed/canceled"
	}
	if n := len([]rune(in.Note)); n > 200 {
		errs["note"] = "备注最长 200 个字符"
	}
	return errs, len(errs) == 0
}

func (in PauseInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if strings.TrimSpace(in.Reason) == "" {
		errs["reason"] = "停表必须说明原因（账本要把这段时间记在谁头上）"
	} else if !ValidPauseReason(in.Reason) {
		errs["reason"] = "停表原因需从字典中选择"
	}
	if n := len([]rune(in.Note)); n > 200 {
		errs["note"] = "备注最长 200 个字符"
	}
	return errs, len(errs) == 0
}

func (in AssignInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !codeSafe(in.Agent) {
		errs["agent"] = "工程师编号只允许字母、数字、下划线与连字符"
	}
	if n := len([]rune(in.Note)); n > 200 {
		errs["note"] = "备注最长 200 个字符"
	}
	return errs, len(errs) == 0
}

func (in PolicyInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if !ValidTier(in.Tier) {
		errs["tier"] = "tier 只能是 platinum/gold/silver/bronze"
	}
	if !ValidSeverity(in.Severity) {
		errs["severity"] = "severity 只能是 S1/S2/S3/S4"
	}
	if in.ResponseMin < 5 || in.ResponseMin > 1440 {
		errs["response_min"] = "首次响应时效需为 5-1440 个工作分钟"
	}
	if in.ResolveMin < 30 || in.ResolveMin > 20160 {
		errs["resolve_min"] = "解决时效需为 30-20160 个工作分钟（≤ 21 个工作日）"
	} else if in.ResolveMin <= in.ResponseMin {
		errs["resolve_min"] = "解决时效必须大于首次响应时效"
	}
	return errs, len(errs) == 0
}

// codeSafe 防注入的第二道闸：这些值会进 WHERE 的参数位，但仍要求白名单字符，
// 因为长度合规的 `"'--` 之类串照样能通过纯长度校验（第 3 轮的教训）。
func codeSafe(s string) bool {
	if s == "" || len(s) > 32 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

// MaskPhone 是全链路唯一的手机号出口形态。
func MaskPhone(p string) string {
	r := []rune(p)
	if len(r) < 7 {
		return ""
	}
	return string(r[:3]) + "****" + string(r[len(r)-4:])
}

// WeekdayCN 供日历与统计复用。
func WeekdayCN(t time.Time) string { return weekdayCN[int(t.In(FieldTZ).Weekday())] }

// SessionWindowLabels 返回 "09:00-12:00" 之类的展示串。
func SessionWindowLabels() []string {
	out := make([]string, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, fmt.Sprintf("%s-%s", minuteStr(s.from), minuteStr(s.to)))
	}
	return out
}

func minuteStr(m int) string {
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

// HumanBd 导出版，供 service 组装提示文案。
func HumanBd(minutes int64) string { return humanBd(minutes) }

// HolidayList / MakeupList 按日期排序输出，避免 JSON 里顺序抖动。
func HolidayList() []string { return sortedKeys(holidaySet) }
func MakeupList() []string  { return sortedKeys(makeupSet) }

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// CalendarSnapshotAt 生成给前端的日历口径（含下一个工作窗口）。
func CalendarSnapshotAt(now time.Time) CalendarSnap {
	next := NextSessionAt(now)
	nowLocal := now.In(FieldTZ)
	snap := CalendarSnap{
		FieldZone:      "Asia/Shanghai（UTC+8，无夏令时）",
		WorkingDays:    []string{"Mon", "Tue", "Wed", "Thu", "Fri"},
		SessionWindows: SessionWindowLabels(),
		MinutesPerDay:  MinutesPerDay,
		Holidays:       HolidayList(),
		MakeupWorkdays: MakeupList(),
		Today:          dateKey(now),
		TodayWorking:   IsWorkingDay(now),
		TodayReason:    dayReason(now),
		NowInSession:   !next.After(nowLocal),
		NextWindowAt:   next.Format(time.RFC3339),
		NextWindowLabel: fmt.Sprintf("%s %s", dateKey(next),
			minuteStr(next.In(FieldTZ).Hour()*60+next.In(FieldTZ).Minute())),
	}
	return snap
}

// CalendarDays 输出连续 n 天的排班口径，供前端「工作日历」条使用。
func CalendarDays(now time.Time, n int) []CalendarDayRow {
	if n <= 0 || n > 60 {
		n = 14
	}
	base := dayStart(now).AddDate(0, 0, -(n / 3))
	out := make([]CalendarDayRow, 0, n)
	for i := 0; i < n; i++ {
		d := base.AddDate(0, 0, i)
		mins := 0
		for _, s := range daySessions(d) {
			mins += s.to - s.from
		}
		out = append(out, CalendarDayRow{
			Date: d.Format("2006-01-02"), Weekday: WeekdayCN(d), Working: IsWorkingDay(d),
			Reason: dayReason(d), Minutes: mins, IsToday: dateKey(d) == dateKey(now),
			IsHoliday: holidaySet[dateKey(d)], IsMakeup: makeupSet[dateKey(d)],
			PastWindow: dateKey(d) < dateKey(now),
		})
	}
	return out
}
