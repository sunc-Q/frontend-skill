import {
  ApiError,
  type AddLineInput,
  type CreateOrderInput,
  type ListParams,
  type OrderDetailResponse,
  type OrderMutationResponse,
  type OrderRow,
  type PageEnvelope,
  type PartDetailResponse,
  type PartRow,
  type ReceiptInput,
  type ReceiptResponse,
  type Stats,
  type TransitionInput,
} from './types';

declare global {
  interface Window {
    __API_BASE__?: string;
    __ADMIN_TOKEN__?: string;
  }
}

function apiBase(): string {
  const fromWindow = typeof window !== 'undefined' ? window.__API_BASE__ : undefined;
  const value = (fromWindow ?? '/api').trim();
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

// 写接口要 Bearer 令牌。演示环境下令牌由页面右上角手工输入并存在本页内存里，
// 绝不写进 localStorage，也不让任何构建产物带上真实令牌。
let adminToken = '';

export function setAdminToken(token: string): void {
  adminToken = token;
}

export function hasAdminToken(): boolean {
  return adminToken !== '';
}

export function seededAdminToken(): string {
  return typeof window !== 'undefined' ? (window.__ADMIN_TOKEN__ ?? '') : '';
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
      throw new ApiError(res.status, body as ApiErrorBodyLike, `请求失败（${res.status}）`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

type ApiErrorBodyLike = { code?: string; message?: string; fields?: Record<string, string> } | null;

function query(params: ListParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s === '' ? '' : `?${s}`;
}

function adminHeaders(): HeadersInit {
  return { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
}

export const api = {
  health: () => request<{ status: string }>('/health', { timeoutMs: 4000 }),
  orders: (params: ListParams) => request<PageEnvelope<OrderRow>>(`/work-orders${query(params)}`),
  order: (no: string) => request<OrderDetailResponse>(`/work-orders/${encodeURIComponent(no)}`),
  parts: (params: ListParams) => request<PageEnvelope<PartRow>>(`/parts${query(params)}`),
  part: (code: string) => request<PartDetailResponse>(`/parts/${encodeURIComponent(code)}`),
  stats: (days: number) => request<Stats>(`/stats?days=${encodeURIComponent(String(days))}`),
  createOrder: (input: CreateOrderInput) =>
    request<OrderMutationResponse>('/admin/work-orders', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    }),
  transition: (no: string, input: TransitionInput) =>
    request<OrderMutationResponse>(`/admin/work-orders/${encodeURIComponent(no)}/transition`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    }),
  addLine: (no: string, input: AddLineInput) =>
    request<OrderMutationResponse>(`/admin/work-orders/${encodeURIComponent(no)}/lines`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    }),
  addReceipt: (input: ReceiptInput) =>
    request<ReceiptResponse>('/admin/receipts', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(input),
    }),
};
