export interface Dish {
  id: number;
  code: string;
  name: string;
  category: string;
  price_cents: number;
  prep_min: number;
  spice: number;
  available: boolean;
  taste: string;
  created_at: string;
  sold_total: number;
}

export interface Zone {
  id: number;
  code: string;
  name: string;
  distance_km: string;
  min_order_cents: number;
  fee_cents: number;
  eta_min: number;
  active: boolean;
}

export type OrderStatus = 'placed' | 'cooking' | 'ready' | 'delivering' | 'delivered' | 'cancelled';

export const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['cooking', 'cancelled'],
  cooking: ['ready', 'cancelled'],
  ready: ['delivering'],
  delivering: ['delivered'],
  delivered: [],
  cancelled: [],
};

export interface OrderRow {
  id: number;
  order_no: string;
  recipient: string;
  masked_phone: string;
  zone_code: string;
  zone_name: string;
  address: string;
  note: string;
  status: OrderStatus;
  item_count: number;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  prep_minutes: number;
  eta_minutes: number;
  placed_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  dish_code: string;
  dish_name: string;
  unit_price_cents: number;
  qty: number;
  line_cents: number;
}

export interface OrderList {
  items: OrderRow[];
  total: number;
  page: number;
  page_size: number;
  served_at: string;
}

export interface MenuList {
  items: Dish[];
  total: number;
  page: number;
  page_size: number;
  categories: Record<string, string>;
}

export interface OrderDetail {
  order: OrderRow;
  items: OrderItem[];
  message?: string;
}

export interface DishRollup {
  dish_code: string;
  dish_name: string;
  category: string;
  qty: number;
  revenue: number;
}

export interface CategoryRollup {
  category: string;
  orders: number;
  revenue: number;
}

export interface Stats {
  orders_total: number;
  today_orders: number;
  gmv_cents: number;
  today_gmv_cents: number;
  avg_order_cents: number;
  avg_prep_min: number;
  cancel_rate_pct: number;
  by_status: Record<string, number>;
  top_dishes: DishRollup[];
  by_category: CategoryRollup[];
  dishes_total: number;
  dishes_available: number;
  generated_at: string;
  window: string;
}

export interface OrderItemInput {
  code: string;
  qty: number;
}

export interface PlaceOrderInput {
  recipient: string;
  phone: string;
  zone: string;
  address: string;
  note: string;
  items: OrderItemInput[];
}

export type SortDir = 'asc' | 'desc';

export interface OrderListParams {
  status?: OrderStatus | '';
  zone?: string;
  q?: string;
  sort?: 'placed' | 'total' | 'items' | 'status' | 'prep';
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
