import {
  ApiError,
  type ApiErrorBody,
  type CartView,
  type CreateProductInput,
  type ListParams,
  type MetaResponse,
  type ProductDetail,
  type ProductList,
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

function query(params: ListParams): string {
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
  meta: () => request<MetaResponse>('/meta'),
  products: (params: ListParams) => request<ProductList>(`/products${query(params)}`),
  product: (sku: string) => request<ProductDetail>(`/products/${encodeURIComponent(sku)}`),
  cart: (region: string) => request<CartView>(`/cart?region=${encodeURIComponent(region)}`),
  addToCart: (sku: string, qty: number, region: string) =>
    request<CartView>('/cart/items?region=' + encodeURIComponent(region), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, qty }),
    }),
  createProduct: (token: string, input: CreateProductInput) =>
    request<ProductDetail['product']>('/admin/products', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
};
