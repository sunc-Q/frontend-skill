export type WaybillStatus =
  | 'booked'
  | 'picked_up'
  | 'in_transit'
  | 'arrived'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returned';

export type Tier = 'express' | 'standard' | 'economy';
export type SortKey =
  | 'code'
  | 'total'
  | 'chargeable'
  | 'weight'
  | 'booked'
  | 'promised'
  | 'status'
  | 'lane'
  | 'pieces'
  | 'id';
export type SortDir = 'asc' | 'desc';
export type RuleKind = 'remote_pct' | 'heavy_piece' | 'fragile_flat' | 'long_haul_flat';

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

export interface Lane {
  id: number;
  code: string;
  origin: string;
  destination: string;
  tier: Tier;
  distance_km: number;
  first_kg: number;
  first_cents: number;
  half_kg_cents: number;
  min_cents: number;
  fuel_pct: number;
  vol_divisor: number;
  promise_days: number;
  remote_area: boolean;
  active: boolean;
}

export interface SurchargeRule {
  id: number;
  code: string;
  name: string;
  kind: RuleKind;
  threshold_g: number;
  threshold_km: number;
  rate_pct: number;
  amount_cents: number;
  min_cents: number;
  priority: number;
  active: boolean;
}

export interface SurchargeItem {
  code: string;
  name: string;
  cents: number;
}

export interface WaybillRow {
  id: number;
  code: string;
  lane_id: number;
  lane_code: string;
  origin: string;
  destination: string;
  tier: Tier;
  promise_days: number;
  status: WaybillStatus;
  shipper_name: string;
  phone_masked: string;
  piece_count: number;
  weight_grams: number;
  volume_cm3: number;
  heaviest_piece_g: number;
  declared_cents: number;
  fragile: boolean;
  remote_area: boolean;
  volumetric_grams: number;
  chargeable_grams: number;
  freight_cents: number;
  fuel_cents: number;
  insurance_cents: number;
  surcharge_cents: number;
  total_cents: number;
  surcharge_items: SurchargeItem[];
  surcharge_capped: boolean;
  leg_count: number;
  booked_at: string;
  promised_at: string;
  delivered_at?: string;
  updated_at: string;
}

export interface ScanEvent {
  id: number;
  waybill_id: number;
  seq: number;
  event_type: WaybillStatus | 'line';
  node: string;
  note: string;
  occurred_at: string;
}

export interface WaybillDetail extends WaybillRow {
  events: ScanEvent[];
}

export interface ListEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: string;
  served_at: string;
}

export interface ItemsEnvelope<T> {
  items: T[];
  total: number;
}

export interface StatusCount {
  status: WaybillStatus;
  count: number;
}

export interface LaneRollup {
  lane_id: number;
  lane_code: string;
  route: string;
  tier: Tier;
  waybills: number;
  revenue_cents: number;
  cargo_kg: number;
}

export interface DailyPoint {
  day: string;
  booked: number;
  revenue_cents: number;
}

export interface Stats {
  generated_at: string;
  today: string;
  trend_days: number;
  window: string;
  total_waybills: number;
  billed_count: number;
  booked_today: number;
  in_transit: number;
  exception_count: number;
  delivered: number;
  returned: number;
  event_count: number;
  revenue_cents: number;
  revenue_today_cents: number;
  freight_cents: number;
  fuel_cents: number;
  insurance_cents: number;
  surcharge_cents: number;
  avg_total_cents: number;
  total_chargeable_kg: number;
  bulky_count: number;
  bulky_pct: number;
  insured_count: number;
  surcharge_capped_count: number;
  on_time_pct: number;
  exception_pct: number;
  by_status: StatusCount[];
  by_lane: LaneRollup[];
  daily: DailyPoint[];
  identity_ok: boolean;
  identity_issues: string[];
}

export interface QuoteResult {
  lane_code: string;
  route: string;
  tier: Tier;
  promise_days: number;
  volumetric_grams: number;
  chargeable_grams: number;
  continue_units: number;
  freight_cents: number;
  fuel_cents: number;
  insurance_cents: number;
  surcharge_cents: number;
  total_cents: number;
  items: SurchargeItem[];
  capped: boolean;
  identity_ok: boolean;
  volumetric_rule: string;
}

export interface QuoteParams {
  lane: string;
  weight_g: number;
  volume_cm3: number;
  heaviest_g?: number;
  declared_cents?: number;
  fragile?: 0 | 1;
}

export interface ListParams {
  status?: WaybillStatus | '';
  lane?: string;
  tier?: Tier | '';
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface CreateWaybillInput {
  lane_code: string;
  shipper_name: string;
  phone: string;
  piece_count: number;
  weight_grams: number;
  volume_cm3: number;
  heaviest_piece_g: number;
  declared_cents: number;
  fragile: boolean;
  node: string;
}

export interface AdvanceInput {
  to: WaybillStatus;
  node: string;
  note: string;
}

export interface ExceptionInput {
  node: string;
  reason: string;
}

export interface CreateRuleInput {
  code: string;
  name: string;
  kind: RuleKind;
  threshold_g: number;
  threshold_km: number;
  rate_pct: number;
  amount_cents: number;
  min_cents: number;
  priority: number;
}
