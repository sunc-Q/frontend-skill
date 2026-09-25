// 前端类型与后端 internal/domain 的 JSON 出口一一对应。
// 时间一律是 RFC3339 字符串：现场口径（UTC+8）由后端算好，前端不做时区换算。

export interface Option {
  value: string;
  label: string;
}

export interface Health {
  status: string;
  time: string;
  field_time: string;
  today_field: string;
  working_day: boolean;
  day_reason: string;
  now_in_session: boolean;
  next_window_at: string;
  minutes_per_day: number;
  session_windows: string[];
  admin_token_set: boolean;
}

export interface Meta {
  statuses: Option[];
  tiers: Option[];
  severities: string[];
  priorities: string[];
  only: Option[];
  sorts: string[];
  categories: string[];
  channels: string[];
  pause_reasons: string[];
  at_risk_window_bd: number;
  max_reopen: number;
  max_page_size: number;
  minutes_per_day: number;
  session_windows: string[];
  field_zone: string;
  field_utc_offset_min: number;
  next_window_at: string;
  policy_bounds: { response_min: number[]; resolve_min: number[] };
  unit_note: string;
}

export interface TicketRow {
  id: number;
  code: string;
  title: string;
  description: string;
  customer_id: number;
  agent_id: number | null;
  team: string;
  category: string;
  channel: string;
  severity: string;
  priority: string;
  status: string;
  created_at: string;
  first_response_at?: string;
  resolved_at?: string;
  closed_at?: string;
  canceled_at?: string;
  response_target_bd: number;
  resolve_target_bd: number;
  resp_due_at: string;
  resolve_due_at: string;
  reassign_count: number;
  reopen_count: number;
  paused_since?: string;
  pause_reason: string;
  paused_bd_minutes: number;
  response_bd_minutes: number;
  resolve_bd_minutes: number;
  met_response?: boolean;
  met_resolve?: boolean;
  updated_at: string;
  customer_code: string;
  customer_name: string;
  tier: string;
  agent_code: string;
  agent_name: string;
  masked_phone: string;
  elapsed_bd_minutes: number;
  paused_bd_total_minutes: number;
  remaining_bd_minutes: number;
  due_at: string;
  breached: boolean;
  at_risk: boolean;
  progress_pct: number;
  finished: boolean;
  clock_identity_ok: boolean;
}

export interface TicketList {
  items: TicketRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: string;
  only: string;
  served_at: string;
  now_field_time: string;
  now_in_session: boolean;
  next_window_at: string;
  has_more: boolean;
  filter_echo: Record<string, string>;
}

export interface Ledger {
  created_at: string;
  now_at: string;
  end_at: string;
  stage: string;
  wall_minutes: number;
  outside_minutes: number;
  business_minutes: number;
  paused_bd_minutes: number;
  elapsed_bd_minutes: number;
  target_bd_minutes: number;
  remaining_bd_minutes: number;
  due_at: string;
  target_human: string;
  met: boolean | null;
  identity_wall_split_ok: boolean;
  identity_clock_ok: boolean;
  identity_timeline_ok: boolean;
  decomposition: string;
}

export interface ResponseClock {
  bd_minutes: number;
  target_bd_minutes: number;
  target_human: string;
  due_at: string;
  met: boolean | null;
  pending: boolean;
}

export interface TimelineEntry {
  id: number;
  kind: string;
  from_status: string;
  to_status: string;
  actor: string;
  actor_role: string;
  note: string;
  at: string;
  span_bd_minutes: number;
  span_wall_minutes: number;
  counts_toward_sla: boolean;
}

export interface TicketDetail {
  ticket: TicketRow;
  ledger: Ledger;
  timeline: TimelineEntry[];
  response: ResponseClock;
}

export interface Agent {
  id: number;
  code: string;
  name: string;
  team: string;
  title: string;
  skills: string;
  active: boolean;
  capacity_bd_minutes: number;
  joined_at: string;
}

export interface Customer {
  id: number;
  code: string;
  name: string;
  tier: string;
  industry: string;
  contact_name: string;
  seats: number;
  active: boolean;
  joined_at: string;
}

export interface Policy {
  id: number;
  tier: string;
  severity: string;
  response_min: number;
  resolve_min: number;
  description: string;
  updated_by: string;
  updated_at: string;
}

export interface PolicyList {
  items: Policy[];
  total: number;
  tiers: string[];
  severities: string[];
  note: string;
}

export interface RollupRow {
  key: string;
  label: string;
  total: number;
  open: number;
  breached: number;
  met_pct: number;
  avg_bd_minutes: number;
}

export interface AgentLoad {
  agent_code: string;
  agent_name: string;
  team: string;
  title: string;
  active: boolean;
  open: number;
  paused: number;
  breached: number;
  resolved_week: number;
  load_bd_minutes: number;
  capacity_bd_minutes: number;
  load_pct: number;
}

export interface DailyPoint {
  date: string;
  created: number;
  resolved: number;
  working_day: boolean;
  reason: string;
  breached: number;
}

export interface CalendarDayRow {
  date: string;
  weekday: string;
  working: boolean;
  reason: string;
  minutes: number;
  is_today: boolean;
  is_holiday: boolean;
  is_makeup: boolean;
  past_window: boolean;
}

export interface CalendarSnap {
  field_zone: string;
  working_days: string[];
  session_windows: string[];
  minutes_per_day: number;
  holidays: string[];
  makeup_workdays: string[];
  today: string;
  today_working: boolean;
  today_reason: string;
  now_in_session: boolean;
  next_window_at: string;
  next_window_label: string;
}

export interface AuditBlock {
  checked_tickets: number;
  clock_identity_ok: boolean;
  clock_violations: number;
  timeline_identity_ok: boolean;
  timeline_violations: number;
  wall_split_ok: boolean;
  wall_split_violations: number;
  response_identity_ok: boolean;
  response_violations: number;
  explanation: string;
}

export interface Stats {
  generated_at: string;
  today: string;
  now_in_session: boolean;
  window_label: string;
  total: number;
  open: number;
  new_unassigned: number;
  paused: number;
  breached: number;
  at_risk: number;
  created_today: number;
  resolved_today: number;
  resolved_total: number;
  met_rate_pct: number;
  response_met_pct: number;
  avg_resolve_bd_minutes: number;
  avg_response_bd_minutes: number;
  avg_resolve_business_hours: number;
  paused_bd_total: number;
  worked_bd_total: number;
  outside_minutes_total: number;
  by_status: RollupRow[];
  by_priority: RollupRow[];
  by_team: RollupRow[];
  by_tier: RollupRow[];
  agents: AgentLoad[];
  daily: DailyPoint[];
  calendar: CalendarSnap;
  calendar_days: CalendarDayRow[];
  audit: AuditBlock;
}

export interface ListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  dir?: string;
  only?: string;
  status?: string;
  severity?: string;
  priority?: string;
  tier?: string;
  team?: string;
  agent?: string;
  customer?: string;
  q?: string;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  customer: string;
  severity: string;
  category: string;
  channel: string;
  agent: string;
}

export interface PolicyInput {
  tier: string;
  severity: string;
  response_min: number;
  resolve_min: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback);
    this.status = status;
    this.code = body?.code ?? 'unknown';
    this.fields = body?.fields ?? {};
  }
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
}
