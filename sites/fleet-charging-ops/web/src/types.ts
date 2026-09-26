// 与后端 internal/domain 的视图一一对应：前端不做二次计算，只做展示。

export type SessStatus = 'charging' | 'completed' | 'faulted' | 'aborted';
export type PileStatus = 'online' | 'maintenance' | 'offline';
export type PileType = 'dc' | 'ac';
export type Period = 'peak' | 'flat' | 'valley';
export type DayType = 'any' | 'weekday' | 'weekend';
export type SortKey =
  | 'code'
  | 'start'
  | 'end'
  | 'energy'
  | 'total'
  | 'status'
  | 'pile'
  | 'plate'
  | 'overstay'
  | 'id';
export type SortDir = 'asc' | 'desc';

export interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body?.code ?? 'unknown';
  }

  get fields(): Record<string, string> {
    return this.body?.fields ?? {};
  }
}

export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  sort: SortKey;
  dir: SortDir;
  served_at: string;
}

export interface ItemsEnvelope<T> {
  items: T[];
  total: number;
}

export interface Pile {
  id: number;
  code: string;
  station: string;
  bay: string;
  type: PileType;
  power_kw: number;
  status: PileStatus;
  note: string;
  created_at: string;
}

export interface PileRow extends Pile {
  open_sessions: number;
  sessions: number;
  energy_kwh: number;
}

export interface Vehicle {
  id: number;
  plate_no: string;
  model: string;
  dept: string;
  battery_kwh: number;
  driver_name: string;
  card_no: string;
  active: boolean;
  created_at: string;
}

export interface VehicleRow extends Vehicle {
  phone_masked: string;
  sessions: number;
  energy_kwh: number;
}

export interface TariffRule {
  id: number;
  code: string;
  name: string;
  period: Period;
  day_type: DayType;
  start_min: number;
  end_min: number;
  elec_cents_per_kwh: number;
  service_cents_per_kwh: number;
  priority: number;
  active: boolean;
  created_at: string;
}

export interface Segment {
  period: Period;
  rule_code: string;
  rule_name: string;
  start_at: string;
  end_at: string;
  minutes: number;
  wh: number;
  elec_cents: number;
  service_cents: number;
}

export interface RateWindow {
  period: Period;
  day_type: DayType;
  window: string;
  elec_cents_per_kwh: number;
  service_cents_per_kwh: number;
  rule_code: string;
}

export interface SessionBase {
  id: number;
  code: string;
  pile_id: number;
  vehicle_id: number;
  status: SessStatus;
  start_at: string;
  end_at: string | null;
  planned_wh: number;
  actual_wh: number;
  elec_cents: number;
  service_cents: number;
  overstay_cents: number;
  total_cents: number;
  overstay_min: number;
  seg_peak_wh: number;
  seg_flat_wh: number;
  seg_valley_wh: number;
  seg_unpriced_wh: number;
  note: string;
  updated_at: string;
}

export interface SessionRow extends SessionBase {
  pile_code: string;
  station: string;
  bay: string;
  power_kw: number;
  plate_no: string;
  dept: string;
  driver_name: string;
  phone_masked: string;
  duration_min: number;
  avg_power_kw: number;
  segments: Segment[];
  covered: boolean;
}

export interface SessionDetail extends SessionRow {
  rate_board: RateWindow[];
}

export interface StatusCount {
  status: SessStatus;
  count: number;
}

export interface PileRollup {
  pile_id: number;
  pile_code: string;
  station: string;
  sessions: number;
  kwh: number;
  revenue_cents: number;
  open_sessions: number;
}

export interface DeptRollup {
  dept: string;
  sessions: number;
  kwh: number;
  revenue_cents: number;
}

export interface DailyPoint {
  day: string;
  sessions: number;
  kwh: number;
  revenue_cents: number;
}

export interface Stats {
  generated_at: string;
  today: string;
  trend_days: number;
  window: string;
  total_sessions: number;
  billed_count: number;
  started_today: number;
  charging_now: number;
  faulted_count: number;
  aborted_count: number;
  completed_count: number;
  total_kwh: number;
  revenue_cents: number;
  elec_cents: number;
  service_cents: number;
  overstay_cents: number;
  kwh_today: number;
  revenue_today_cents: number;
  avg_price_cents_per_kwh: number;
  peak_kwh: number;
  flat_kwh: number;
  valley_kwh: number;
  peak_pct: number;
  valley_pct: number;
  avg_duration_min: number;
  overstay_rate_pct: number;
  pile_total: number;
  pile_online: number;
  pile_online_pct: number;
  vehicle_total: number;
  by_status: StatusCount[];
  by_pile: PileRollup[];
  by_dept: DeptRollup[];
  daily: DailyPoint[];
  rate_board: RateWindow[];
  identity_ok: boolean;
  identity_issues: string[];
}

export interface QuoteResult {
  pile_code: string;
  station: string;
  bay: string;
  power_kw: number;
  start_at: string;
  end_at: string;
  minutes: number;
  wh: number;
  segments: Segment[];
  peak_wh: number;
  flat_wh: number;
  valley_wh: number;
  unpriced_wh: number;
  unpriced_min: number;
  elec_cents: number;
  service_cents: number;
  overstay_cents: number;
  total_cents: number;
  avg_price_cents_per_kwh: number;
  covered: boolean;
  identity_ok: boolean;
  tariff_rule: string;
}

export interface ListParams {
  status?: SessStatus | '';
  open?: 1 | undefined;
  pile?: string;
  plate?: string;
  dept?: string;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface QuoteParams {
  pile: string;
  wh: number;
  minutes: number;
  delay_min?: number;
  overstay_min?: number;
}

export interface StartSessionInput {
  pile_code: string;
  plate_no: string;
  planned_wh: number;
  note: string;
}

export interface SettleInput {
  actual_wh: number;
  overstay_min: number;
  faulted_settled?: boolean;
}

export interface ReasonInput {
  reason: string;
}

export interface CreateTariffInput {
  code: string;
  name: string;
  period: Period;
  day_type: DayType;
  start_min: number;
  end_min: number;
  elec_cents_per_kwh: number;
  service_cents_per_kwh: number;
  priority: number;
}

export interface PileStatusInput {
  status: PileStatus;
  note: string;
}

export const STATUS_LABEL: Record<SessStatus, string> = {
  charging: '充电中',
  completed: '已结算',
  faulted: '故障挂起',
  aborted: '已弃单',
};

export const PILE_STATUS_LABEL: Record<PileStatus, string> = {
  online: '在线',
  maintenance: '维保中',
  offline: '离线',
};

export const PERIOD_LABEL: Record<Period, string> = {
  peak: '峰',
  flat: '平',
  valley: '谷',
};

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  any: '每天',
  weekday: '工作日',
  weekend: '周末',
};

// 与后端 domain.SessionNext 同表：UI 只按它决定按钮可用性。
export const SESSION_NEXT: Record<SessStatus, SessStatus[]> = {
  charging: ['completed', 'faulted'],
  faulted: ['completed', 'aborted'],
  completed: [],
  aborted: [],
};

export const isOpenSession = (s: SessStatus): boolean => s === 'charging' || s === 'faulted';
