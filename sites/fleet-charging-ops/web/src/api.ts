import type {
  ApiErrorBody,
  CreateTariffInput,
  ItemsEnvelope,
  ListEnvelope,
  ListParams,
  Pile,
  PileRow,
  PileStatusInput,
  QuoteParams,
  QuoteResult,
  ReasonInput,
  SessionDetail,
  SessionRow,
  SettleInput,
  StartSessionInput,
  Stats,
  TariffRule,
  VehicleRow,
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
  piles: () => request<ItemsEnvelope<PileRow>>('/piles'),
  vehicles: (all = false) => request<ItemsEnvelope<VehicleRow>>(`/vehicles${all ? '?all=1' : ''}`),
  tariffs: (all = false) => request<ItemsEnvelope<TariffRule>>(`/tariffs${all ? '?all=1' : ''}`),
  stats: (days: number) => request<Stats>(`/stats${query({ days })}`),
  quote: (p: QuoteParams) => request<QuoteResult>(`/quote${query({ ...p })}`),
  sessions: (p: ListParams) => request<ListEnvelope<SessionRow>>(`/sessions${query({ ...p })}`),
  session: (code: string) => request<SessionDetail>(`/sessions/${seg(code)}`),

  start: (token: string, input: StartSessionInput) =>
    request<SessionDetail>('/admin/sessions', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  settle: (token: string, code: string, input: SettleInput) =>
    request<{ session: SessionDetail; message: string }>(`/admin/sessions/${seg(code)}/settle`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  fault: (token: string, code: string, input: ReasonInput) =>
    request<{ session: SessionDetail; message: string }>(`/admin/sessions/${seg(code)}/fault`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  abort: (token: string, code: string, input: ReasonInput) =>
    request<{ session: SessionDetail; message: string }>(`/admin/sessions/${seg(code)}/abort`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  createTariff: (token: string, input: CreateTariffInput) =>
    request<TariffRule>('/admin/tariffs', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  toggleTariff: (token: string, id: number) =>
    request<TariffRule>(`/admin/tariffs/${seg(id)}/toggle`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
  pileStatus: (token: string, code: string, input: PileStatusInput) =>
    request<Pile>(`/admin/piles/${seg(code)}/status`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
};
