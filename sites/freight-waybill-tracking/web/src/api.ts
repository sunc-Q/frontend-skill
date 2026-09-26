import type {
  AdvanceInput,
  ApiErrorBody,
  CreateRuleInput,
  CreateWaybillInput,
  ExceptionInput,
  ItemsEnvelope,
  Lane,
  ListParams,
  QuoteParams,
  QuoteResult,
  Stats,
  SurchargeRule,
  WaybillDetail,
  WaybillRow,
  ListEnvelope,
} from './types';
import { ApiError } from './types';

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

function query(params: Record<string, string | number | undefined>): string {
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

const seg = (v: string | number): string => encodeURIComponent(String(v));

export const api = {
  health: () => request<{ status: string; time: string }>('/health', { timeoutMs: 4000 }),
  lanes: (all = false) => request<ItemsEnvelope<Lane>>(`/lanes${all ? '?all=1' : ''}`),
  rules: (all = false) => request<ItemsEnvelope<SurchargeRule>>(`/rules${all ? '?all=1' : ''}`),
  stats: (days: number) => request<Stats>(`/stats${query({ days })}`),
  quote: (p: QuoteParams) => request<QuoteResult>(`/quote${query({ ...p })}`),
  waybills: (p: ListParams) => request<ListEnvelope<WaybillRow>>(`/waybills${query({ ...p })}`),
  waybill: (code: string) => request<WaybillDetail>(`/waybills/${seg(code)}`),
  createWaybill: (token: string, input: CreateWaybillInput) =>
    request<WaybillDetail>('/admin/waybills', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  advance: (token: string, code: string, input: AdvanceInput) =>
    request<{ waybill: WaybillDetail; message: string }>(`/admin/waybills/${seg(code)}/advance`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  reportException: (token: string, code: string, input: ExceptionInput) =>
    request<{ waybill: WaybillDetail; message: string }>(`/admin/waybills/${seg(code)}/exception`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  createRule: (token: string, input: CreateRuleInput) =>
    request<SurchargeRule>('/admin/rules', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  toggleRule: (token: string, id: number) =>
    request<SurchargeRule>(`/admin/rules/${seg(id)}/toggle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
};
