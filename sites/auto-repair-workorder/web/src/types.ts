// 与后端 internal/domain 的 JSON 口径一一对应：字段名、可空性都以接口实际返回为准。

export type OrderStatus =
  | 'received'
  | 'diagnosed'
  | 'awaiting_parts'
  | 'repairing'
  | 'qc'
  | 'settled'
  | 'picked_up'
  | 'cancelled';

export type Priority = 'normal' | 'urgent' | 'warranty';
export type Grade = 'junior' | 'middle' | 'master';
export type LineKind = 'labor' | 'part';
export type PartStatus = 'active' | 'discontinued';
export type Category =
  | 'engine'
  | 'brake'
  | 'filter'
  | 'electrical'
  | 'suspension'
  | 'consumable'
  | 'transmission';
export type MoveKind = 'receipt' | 'issue' | 'return' | 'scrap';
export type SortDir = 'asc' | 'desc';

export interface OrderRow {
  id: number;
  wo_no: string;
  plate_no: string;
  model: string;
  customer_name: string;
  phone_masked: string;
  mileage_km: number;
  symptom: string;
  status: OrderStatus;
  priority: Priority;
  technician: string;
  opened_at: string;
  promised_at: string;
  settled_at: string | null;
  closed_at: string | null;
  cancel_reason: string;
  labor_total_cents: number;
  parts_total_cents: number;
  grand_total_cents: number;
  labor_minutes: number;
  part_qty: number;
  line_count: number;
  promise_overdue: boolean;
  wait_minutes: number;
  next_statuses: string[];
}

export interface OrderLineRow {
  id: number;
  kind: LineKind;
  operation: string;
  grade: string;
  duration_min: number;
  part_code: string;
  part_name: string;
  unit: string;
  qty: number;
  unit_cost_cents: number;
  cost_cents: number;
  unit_price_cents: number;
  amount_cents: number;
  note: string;
  created_at: string;
}

export interface MoveRow {
  id: number;
  lot_no: string;
  part_code: string;
  kind: MoveKind;
  qty_delta: number;
  unit_cost_cents: number;
  wo_no: string;
  note: string;
  occurred_at: string;
}

export interface PartRow {
  id: number;
  code: string;
  name: string;
  brand: string;
  category: Category;
  unit: string;
  list_price_cents: number;
  reorder_point: number;
  shelf_location: string;
  status: PartStatus;
  on_hand: number;
  lot_count: number;
  avg_cost_cents: number;
  stock_value_cents: number;
  consumed_30d: number;
  below_reorder: boolean;
  oldest_lot_at: string;
}

export interface StockLot {
  id: number;
  part_code: string;
  lot_no: string;
  qty_received: number;
  qty_remaining: number;
  unit_cost_cents: number;
  supplier: string;
  received_at: string;
  expires_at: string | null;
}

export interface PageEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  served_at: string;
}

export interface OrderDetailResponse {
  order: OrderRow;
  lines: OrderLineRow[];
  moves: MoveRow[];
}

export interface PartDetailResponse {
  part: PartRow;
  lots: StockLot[];
  moves: MoveRow[];
}

export interface OrderMutationResponse {
  order: OrderRow;
  line?: OrderLineRow;
  message: string;
}

export interface ReceiptResponse {
  part: PartRow;
  lot: StockLot;
  message: string;
}

export interface CreateOrderInput {
  plate_no: string;
  model: string;
  customer_name: string;
  phone: string;
  mileage_km: number;
  symptom: string;
  priority: Priority;
  technician: string;
}

export interface AddLineInput {
  kind: LineKind;
  part_code?: string;
  operation?: string;
  grade?: Grade;
  duration_min?: number;
  qty?: number;
  note?: string;
}

export interface ReceiptInput {
  part_code: string;
  lot_no: string;
  qty: number;
  unit_cost_cents: number;
  supplier: string;
  expires_on?: string;
}

export interface TransitionInput {
  to: OrderStatus | string;
  reason?: string;
}

export interface StatusBucket {
  status: OrderStatus;
  count: number;
  open_minutes: number;
  revenue_cents: number;
}

export interface CategoryBucket {
  category: Category;
  parts: number;
  on_hand: number;
  value_cents: number;
  short_parts: number;
}

export interface TrendPoint {
  day: string;
  opened: number;
  settled: number;
  revenue_cents: number;
  issued_qty: number;
}

export interface TopPart {
  code: string;
  name: string;
  category: Category;
  qty: number;
  cost_cents: number;
  amount_cents: number;
}

export interface Stats {
  generated_at: string;
  today: string;
  window: string;
  total_orders: number;
  open_orders: number;
  today_opened: number;
  awaiting_parts: number;
  promise_late: number;
  settled_wait: number;
  revenue_cents: number;
  labor_cents: number;
  parts_cents: number;
  parts_cost_cents: number;
  gross_margin_cents: number;
  open_labor_minutes: number;
  stock_value_cents: number;
  on_hand_units: number;
  active_parts: number;
  low_stock_parts: number;
  today_issues: number;
  by_status: StatusBucket[];
  by_category: CategoryBucket[];
  trend: TrendPoint[];
  top_parts: TopPart[];
  stock_issues: { part_code: string; moves_sum: number; lots_sum: number; overflow: number }[];
  stock_invariant_ok: boolean;
  amount_invariant_ok: boolean;
  lot_overflow: number;
  checked_orders: number;
  identity_issues: string[];
  identity_violations: number;
}

export type OrderSort = 'opened' | 'promised' | 'updated' | 'no' | 'plate' | 'status' | 'priority' | 'total' | 'tech';
export type PartSort = 'code' | 'name' | 'category' | 'price' | 'onhand' | 'value' | 'lot' | 'cost';
export type StockFilter = 'low' | 'out' | 'ok' | 'all' | '';

export interface ListParams {
  status?: string;
  category?: string;
  stock?: StockFilter;
  priority?: string;
  q?: string;
  sort?: string;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

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
    this.code = body?.code ?? String(status);
    this.fields = body?.fields ?? {};
  }
}
