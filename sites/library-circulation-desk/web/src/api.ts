import {
  ApiError,
  type ApiErrorBody,
  type BorrowInput,
  type BorrowResponse,
  type ItemDetailResponse,
  type ItemRow,
  type ListParams,
  type LoanResponse,
  type LoanRow,
  type MemberResponse,
  type PageEnvelope,
  type ReturnResponse,
  type Stats,
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
  items: (params: ListParams) => request<PageEnvelope<ItemRow>>(`/items${query(params)}`),
  item: (code: string) => request<ItemDetailResponse>(`/items/${encodeURIComponent(code)}`),
  loans: (params: ListParams) => request<PageEnvelope<LoanRow>>(`/loans${query(params)}`),
  loan: (id: number) => request<LoanResponse>(`/loans/${encodeURIComponent(String(id))}`),
  member: (card: string) => request<MemberResponse>(`/members/${encodeURIComponent(card)}`),
  stats: (days = 14) => request<Stats>(`/stats?days=${encodeURIComponent(String(days))}`),
  borrow: (token: string, input: BorrowInput) =>
    request<BorrowResponse>('/admin/borrow', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  returnLoan: (token: string, id: number, paid: boolean) =>
    request<ReturnResponse>(`/admin/loans/${encodeURIComponent(String(id))}/return`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ paid }),
    }),
  renew: (token: string, id: number) =>
    request<LoanResponse>(`/admin/loans/${encodeURIComponent(String(id))}/renew`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({}),
    }),
};
