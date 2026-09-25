import {
  ApiError,
  type Agent,
  type ApiErrorBody,
  type CreateTicketInput,
  type Customer,
  type Health,
  type ListParams,
  type Meta,
  type Policy,
  type PolicyInput,
  type PolicyList,
  type Stats,
  type TicketDetail,
  type TicketList,
  type TicketRow,
} from './types';
import { setFieldOffset } from './format';

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

function qs(params: ListParams): string {
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
  health: () => request<Health>('/health', { timeoutMs: 4000 }),
  // meta 一到就把现场时区偏移灌进展示层：之后所有时间串都按这个固定偏移换算，
  // 与打开页面那台机器的系统时区无关。
  meta: () =>
    request<Meta>('/meta').then((m) => {
      setFieldOffset(m.field_utc_offset_min);
      return m;
    }),
  stats: () => request<Stats>('/stats'),
  tickets: (params: ListParams) => request<TicketList>(`/tickets${qs(params)}`),
  ticket: (code: string) => request<TicketDetail>(`/tickets/${encodeURIComponent(code)}`),
  agents: () => request<{ items: Agent[]; total: number }>('/agents'),
  customers: () => request<{ items: Customer[]; total: number }>('/customers'),
  policies: () => request<PolicyList>('/sla/policies'),

  createTicket: (token: string, input: CreateTicketInput) =>
    request<{ ticket: TicketRow; message: string }>('/tickets', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  changeStatus: (token: string, code: string, status: string, note: string) =>
    request<{ ticket: TicketRow; message: string }>(`/tickets/${encodeURIComponent(code)}/status`, {
      method: 'PATCH',
      headers: adminHeaders(token),
      body: JSON.stringify({ status, note }),
    }),
  pause: (token: string, code: string, reason: string, note: string) =>
    request<{ ticket: TicketRow; message: string }>(`/tickets/${encodeURIComponent(code)}/pause`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ reason, note }),
    }),
  resume: (token: string, code: string, note: string) =>
    request<{ ticket: TicketRow; message: string }>(`/tickets/${encodeURIComponent(code)}/resume`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ note }),
    }),
  assign: (token: string, code: string, agent: string, note: string) =>
    request<{ ticket: TicketRow; message: string }>(`/tickets/${encodeURIComponent(code)}/assign`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ agent, note }),
    }),
  upsertPolicy: (token: string, input: PolicyInput) =>
    request<{ policy: Policy; created: boolean; message: string }>('/sla/policies', {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
};
