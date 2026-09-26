import {
  ApiError,
  type ApiErrorBody,
  type Category,
  type CreateListingInput,
  type DealList,
  type DealParams,
  type ListingDetail,
  type ListingList,
  type ListParams,
  type Metrics,
  type Offer,
  type PlaceOfferInput,
} from './types';

declare global {
  interface Window {
    __API_BASE__?: string;
  }
}

function apiBase(): string {
  const fromWindow = typeof window !== 'undefined' ? window.__API_BASE__ : undefined;
  const value = (fromWindow ?? '/api').trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 8000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiBase() + path, {
      ...rest,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(rest.headers ?? {}) },
    });
    const text = await res.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    if (!res.ok) {
      throw new ApiError(res.status, body as ApiErrorBody | null, `请求失败（${res.status}）`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

function query(params: ListParams | DealParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s === '' ? '' : `?${s}`;
}

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const seg = (s: string): string => encodeURIComponent(s.trim().toUpperCase());

export const api = {
  health: () => request<{ status: string; time: string }>('/health', { timeoutMs: 4000 }),
  categories: () => request<{ items: Category[]; total: number }>('/categories'),
  metrics: (days = 14) => request<Metrics>(`/metrics?days=${encodeURIComponent(String(days))}`),
  listings: (params: ListParams) => request<ListingList>(`/listings${query(params)}`),
  deals: (params: DealParams) => request<DealList>(`/deals${query(params)}`),
  detail: (code: string) => request<ListingDetail>(`/listings/${seg(code)}`),
  createListing: (token: string, input: CreateListingInput) =>
    request<{ listing: ListingDetail['listing']; message: string }>('/admin/listings', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  placeOffer: (token: string, code: string, input: PlaceOfferInput) =>
    request<{ offer: Offer; message: string }>(`/admin/listings/${seg(code)}/offers`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  decide: (token: string, dealNo: string, action: 'accept' | 'reject') =>
    request<{ listing: ListingDetail['listing']; deal_no: string; message: string }>(
      `/admin/deals/${encodeURIComponent(dealNo.trim())}/decide`,
      { method: 'POST', headers: adminHeaders(token), body: JSON.stringify({ action }) },
    ),
};
