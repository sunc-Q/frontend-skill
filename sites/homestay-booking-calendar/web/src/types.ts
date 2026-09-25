// 与后端 domain/service 的 JSON 一一对应：这里不发明字段，也不隐藏字段。

export interface ApiErrorBody {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
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

export interface RoomRow {
  code: string;
  property_code: string;
  property_name: string;
  name: string;
  beds: string;
  capacity: number;
  units: number;
  base_price_cents: number;
  weekend_pct: number;
  holiday_pct: number;
  clean_fee_cents: number;
  breakfast: boolean;
  scene: string;
  amenities: string;
  status: string;
  min_stay_default: number;
  nights_sold: number;
  bookings: number;
  revenue_cents: number;
  adr_cents: number;
  occ_bps_window: number;
  next_free_from?: string;
}

export interface CalDay {
  date: string;
  weekday: string;
  kind: string;
  label?: string;
  price_cents: number;
  units: number;
  occupied: number;
  available: number;
  closed: boolean;
  fill_bps: number;
}

export interface NightPrice {
  date: string;
  weekday: string;
  kind: string;
  label?: string;
  price_cents: number;
  base_cents: number;
  amount_cents: number;
  units: number;
}

export interface Quote {
  room: RoomRow;
  check_in: string;
  check_out: string;
  nights: number;
  units: number;
  guests: number;
  nights_detail: NightPrice[];
  night_subtotal_cents: number;
  clean_fee_cents: number;
  total_cents: number;
  avg_night_cents: number;
  blockers: string[];
  weekend_nights: number;
  holiday_nights: number;
  min_stay: number;
  room_nights: number;
  ok: boolean;
}

export interface BookingRow {
  code: string;
  room_code: string;
  room_name: string;
  property_code: string;
  property_name: string;
  guest_name: string;
  masked_phone: string;
  check_in: string;
  check_out: string;
  nights: number;
  units: number;
  guests: number;
  channel: string;
  status: string;
  holds_room: boolean;
  counts_revenue: boolean;
  night_subtotal_cents: number;
  clean_fee_cents: number;
  total_cents: number;
  refund_cents: number;
  paid_cents: number;
  avg_night_cents: number;
  note?: string;
  next_statuses: string[];
  created_at: string;
  updated_at: string;
  days_to_check_in: number;
}

export interface RoomList {
  items: RoomRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: SortDir;
  today: string;
  window: number;
  filters: { property: string; status: string; breakfast: string };
}

export interface RoomDetail {
  room: RoomRow;
  calendar: CalDay[];
  property: PropertyMeta;
  today: string;
}

export interface PropertyMeta {
  code: string;
  name: string;
  region: string;
  intro: string;
  check_in_at: string;
  check_out_at: string;
  clean_buffer_days: number;
  min_stay_weekend: number;
  rating: number;
}

export interface PropertyRow extends PropertyMeta {
  rooms: RoomRow[];
  unit_total: number;
  nights_sold: number;
  revenue_cents: number;
  adr_cents: number;
  occ_bps_window: number;
}

export interface PropertyList {
  items: PropertyRow[];
  today: string;
  window: number;
}

export interface BookingList {
  items: BookingRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: SortDir;
  today: string;
  filters: { status: string; property: string; channel: string; room: string; horizon: string; q: string };
}

export interface BookingDetail {
  booking: BookingRow;
  nights: NightPrice[];
}

export interface QuoteOut {
  quote: Quote;
  today: string;
}

export interface BookOut {
  booking: BookingRow;
  message: string;
}

export interface StatusOut {
  booking: BookingRow;
  message: string;
}

export interface ClosureOut {
  day: CalDay;
  message: string;
}

export interface RoomStatusOut {
  active_rooms: number;
  message: string;
}

export interface WindowMeta {
  from: string;
  to: string;
  days: number;
}

export interface Portfolio {
  properties: number;
  room_types: number;
  rooms_active: number;
  units: number;
  units_active: number;
  capacity_persons: number;
  rate_days: number;
  clean_buffer_days_max: number;
}

export interface OpsBoard {
  arrivals: number;
  departures: number;
  in_house: number;
  in_house_units: number;
  pending: number;
  pending_units: number;
  held_room_nights_next: number;
  sellable_units_avg: number;
  pending_value_cents: number;
}

export interface Money {
  gmv_cents: number;
  refund_cents: number;
  net_cents: number;
  clean_fee_cents: number;
  night_revenue_cents: number;
  cancelled_bookings: number;
  avg_order_cents: number;
  sold_bookings: number;
  cancel_gross_cents: number;
  collected_cents: number;
}

export interface Performance {
  room_nights_sold: number;
  room_nights_available: number;
  occ_bps: number;
  adr_cents: number;
  revpar_cents: number;
  revpar_derived_cents: number;
  revpar_drift_cents: number;
  revenue_cents: number;
}

export interface Identity {
  night_sum_cents: number;
  booking_subtotal_cents: number;
  subtotal_matches: boolean;
  revpar_drift_cents: number;
  revpar_identity_ok: boolean;
  net_identity_ok: boolean;
  net_gap_cents: number;
}

export interface ChannelRow {
  channel: string;
  bookings: number;
  room_nights: number;
  revenue_cents: number;
  share_bps: number;
}

export interface PropRow {
  code: string;
  name: string;
  units: number;
  bookings: number;
  room_nights: number;
  revenue_cents: number;
  adr_cents: number;
  occ_bps_forward: number;
}

export interface LoadRow {
  date: string;
  weekday: string;
  room_nights_sold: number;
  held_units: number;
  capacity_units: number;
  free_units: number;
  fill_bps: number;
  revenue_cents: number;
  closed_rooms: number;
  weekend: boolean;
}

export interface KindRow {
  kind: string;
  room_nights: number;
  amount_cents: number;
  share_bps: number;
  avg_price_cents: number;
}

export interface TopRoom {
  code: string;
  name: string;
  property_name: string;
  room_nights: number;
  revenue_cents: number;
  adr_cents: number;
  fill_bps_forward: number;
}

export interface Stats {
  generated_at: string;
  today: string;
  weekday: string;
  history: WindowMeta;
  forward: WindowMeta;
  portfolio: Portfolio;
  ops: OpsBoard;
  money: Money;
  performance: Performance;
  identity: Identity;
  channels: ChannelRow[];
  properties: PropRow[];
  load: LoadRow[];
  kind_mix: KindRow[];
  top_rooms: TopRoom[];
}

export type SortDir = 'asc' | 'desc';

export interface ListParams {
  [key: string]: string | number | undefined;
}

export interface BookInput {
  check_in: string;
  check_out: string;
  units: number;
  guests: number;
  guest_name: string;
  phone: string;
  channel: string;
  note: string;
}

export interface ClosureInput {
  date: string;
  closed: boolean;
  label: string;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  checked_in: '在住',
  checked_out: '已离店',
  cancelled: '已取消',
  no_show: '未到店',
};

export const STATUS_ORDER = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

export const CHANNEL_LABEL: Record<string, string> = {
  direct: '门店直订',
  ota_ctrip: '携程',
  ota_meituan: '美团',
  ota_airbnb: 'Airbnb',
  walk_in: '上门客',
  referrer: '老客推荐',
};

export const KIND_LABEL: Record<string, string> = {
  weekday: '平日',
  weekend: '周末',
  holiday: '节假日',
  promo: '特价',
  closed: '停售',
};

export const HORIZON_LABEL: Record<string, string> = {
  '': '全部',
  arrivals: '今日到店',
  inhouse: '在住',
  departures: '今日退房',
  upcoming: '未来待住',
  past: '已过去',
};

export const BOOKING_SORTS = ['check_in', 'check_out', 'nights', 'total', 'guest', 'status', 'channel', 'room', 'property', 'created'];
export const ROOM_SORTS = ['property', 'code', 'name', 'units', 'price', 'bookings', 'nights', 'revenue'];
