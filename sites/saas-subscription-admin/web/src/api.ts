import { ApiError, type ApiErrorBody, type CreatePlanInput, type ListParams, type Metrics, type Plan, type RenewInput, type SubscriptionDetail, type SubscriptionList } from './types';

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
  plans: () => request<{ items: Plan[]; total: number }>('/plans'),
  metrics: (months = 9) => request<Metrics>(`/metrics?months=${encodeURIComponent(String(months))}`),
  subscriptions: (params: ListParams) => request<SubscriptionList>(`/subscriptions${query(params)}`),
  subscription: (id: number) => request<SubscriptionDetail>(`/subscriptions/${encodeURIComponent(String(id))}`),
  createPlan: (token: string, input: CreatePlanInput) =>
    request<Plan>('/admin/plans', { method: 'POST', headers: adminHeaders(token), body: JSON.stringify(input) }),
  renew: (token: string, id: number, input: RenewInput) =>
    request<SubscriptionDetail>(`/admin/subscriptions/${encodeURIComponent(String(id))}/renew`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
};
