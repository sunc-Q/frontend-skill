export interface Product {
  id: number;
  sku: string;
  name: string;
  name_en: string;
  category: string;
  brand: string;
  price_cents: number;
  stock: number;
  weight_g: number;
  hs_code: string;
  origin: string;
  lead_min_days: number;
  lead_max_days: number;
  sold_30: number;
  listed: boolean;
  bullets: string;
  created_at: string;
  rating_avg: number;
  review_cnt: number;
}

export interface Review {
  id: number;
  product_id: number;
  author: string;
  country: string;
  rating: number;
  body: string;
  verified: boolean;
  posted_at: string;
}

export interface ReviewSummary {
  avg: number;
  count: number;
  dist: number[];
}

export interface Region {
  code: string;
  name: string;
  currency: string;
  fx_per_usd: number;
  duty_pct: number;
  ship_first_cents: number;
  ship_step_g: number;
  ship_step_cents: number;
  free_ship_from_cents: number;
}

export interface RegionTotal extends Region {
  goods_cents: number;
  freight_cents: number;
  duty_cents: number;
  total_cents: number;
  free_ship: boolean;
}

export interface CartLine {
  sku: string;
  name: string;
  qty: number;
  price_cents: number;
  weight_g: number;
  stock: number;
  listed: boolean;
  line_cents: number;
}

export interface CartView {
  lines: CartLine[];
  item_qty: number;
  total_weight_g: number;
  region: string;
  totals: RegionTotal[];
  served_at: string;
}

export interface CatalogStats {
  total: number;
  listed: number;
  out_of_stock: number;
  avg_rating: number;
  sold_30_sum: number;
  catalog_value_cents: number;
}

export interface MetaResponse {
  categories: string[];
  regions: Region[];
  stats: CatalogStats;
}

export interface ProductList {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  category?: string;
  served_at: string;
}

export interface ProductDetail {
  product: Product;
  stats: ReviewSummary;
  reviews: Review[];
}

export type SortKey = 'price' | 'rating' | 'sold' | 'stock' | 'name' | 'created';
export type SortDir = 'asc' | 'desc';

export interface ListParams {
  category?: string;
  in_stock?: string;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  name_en: string;
  category: string;
  brand: string;
  price_cents: number;
  stock: number;
  weight_g: number;
  hs_code: string;
  origin: string;
  lead_min_days: number;
  lead_max_days: number;
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
