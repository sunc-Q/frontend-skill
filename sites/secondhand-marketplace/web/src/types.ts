// 与后端 internal/domain 的 JSON 契约一一对应。金额全部是「分」，时间是 UTC 文本。

export type ListingStatus = 'available' | 'reserved' | 'sold' | 'withdrawn';
export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'outbid' | 'expired';
export type Condition = 'like_new' | 'good' | 'fair' | 'parts';
export type SortDir = 'asc' | 'desc';

export interface Category {
  id: number;
  code: string;
  name_zh: string;
  unit: string;
  ref_cent: number;
  item_kind: string;
}

export interface Listing {
  id: number;
  code: string;
  title: string;
  category_id: number;
  seller: string;
  asking_cent: number;
  floor_cent: number;
  ref_cent: number;
  condition: Condition;
  area: string;
  status: ListingStatus;
  views: number;
  best_offer_cent: number;
  posted_at: string;
  sold_at?: string;
}

export interface ListingRow extends Listing {
  category_code: string;
  category_name: string;
  offer_count: number;
  pending_count: number;
  asking_ref_pct: number;
  best_over_floor: boolean;
}

export interface Offer {
  id: number;
  listing_id: number;
  deal_no: string;
  buyer: string;
  amount_cent: number;
  message: string;
  status: OfferStatus;
  placed_at: string;
  expires_at: string;
  decided_at?: string;
}

export interface OfferView extends Offer {
  listing_code: string;
  title: string;
  category_name: string;
  asking_cent: number;
  floor_cent: number;
  listing_status: ListingStatus;
  is_best: boolean;
  over_floor: boolean;
  rank: number;
}

export interface DailyPoint {
  day: string;
  posted: number;
  offers: number;
  deals: number;
  gmv_cent: number;
}

export interface CategoryRollup {
  category_id: number;
  category_code: string;
  category_name: string;
  ref_cent: number;
  listings: number;
  sold: number;
  gmv_cent: number;
  avg_deal_cent: number;
  best_offer_cent: number;
}

export interface Metrics {
  today: string;
  listings_total: number;
  listings_active: number;
  available: number;
  reserved: number;
  sold: number;
  withdrawn: number;
  offers_total: number;
  offers_pending: number;
  deals: number;
  gmv_cent: number;
  avg_deal_cent: number;
  gmv_7d_cent: number;
  deals_7d: number;
  best_bid_yield_pct: number;
  expired_pending_offers: number;
  identity_ok: boolean;
  identity_note?: string;
  daily: DailyPoint[];
  by_category: CategoryRollup[];
  generated_at: string;
  window: string;
}

export interface ListingList {
  items: ListingRow[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: string;
  served_at: string;
}

export interface DealList {
  items: OfferView[];
  total: number;
  page: number;
  page_size: number;
  sort: string;
  dir: string;
  served_at: string;
}

export interface ListingDetail {
  listing: ListingRow;
  offers: OfferView[];
}

export interface CreateListingInput {
  code: string;
  title: string;
  category: string;
  seller: string;
  asking_cent: number;
  floor_cent: number;
  condition: Condition;
  area: string;
}

export interface PlaceOfferInput {
  buyer: string;
  amount_cent: number;
  message: string;
}

export type ListingSortKey = 'posted' | 'asking' | 'best' | 'offers' | 'views' | 'code' | 'status';
export type DealSortKey = 'placed' | 'amount' | 'expires' | 'deal' | 'status';

export interface ListParams {
  status?: ListingStatus | '';
  category?: string;
  condition?: Condition | '';
  q?: string;
  sort?: ListingSortKey;
  dir?: SortDir;
  page?: number;
  page_size?: number;
}

export interface DealParams {
  status?: OfferStatus | '';
  category?: string;
  q?: string;
  sort?: DealSortKey;
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
    super(body?.message !== undefined && body.message !== '' ? body.message : fallback);
    this.status = status;
    this.code = body?.code ?? 'unknown';
    this.fields = body?.fields ?? {};
  }
}
