import {
  ApiError,
  type ApiErrorBody,
  type MenuList,
  type OrderDetail,
  type OrderList,
  type OrderListParams,
  type PlaceOrderInput,
  type Stats,
  type Zone,
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

function query(params: OrderListParams | Record<string, string | number | undefined>): string {
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

export const api = {
  health: () => request<{ status: string }>('/health', { timeoutMs: 4000 }),
  menu: (params: Record<string, string | number | undefined> = {}) => request<MenuList>(`/menu${query(params)}`),
  zones: () => request<{ items: Zone[]; total: number }>('/zones'),
  stats: () => request<Stats>('/stats'),
  orders: (params: OrderListParams) => request<OrderList>(`/orders${query(params)}`),
  order: (id: number) => request<OrderDetail>(`/orders/${encodeURIComponent(String(id))}`),
  placeOrder: (input: PlaceOrderInput) =>
    request<OrderDetail>('/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
  advance: (token: string, id: number, to: string) =>
    request<OrderDetail>(`/admin/orders/${encodeURIComponent(String(id))}/status`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ to }),
    }),
  setAvailability: (token: string, dishId: number, available: boolean) =>
    request<{ id: number; available: boolean }>(`/admin/dishes/${encodeURIComponent(String(dishId))}/availability`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ available }),
    }),
};
