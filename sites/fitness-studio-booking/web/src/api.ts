import { ApiError } from './types';
import type { ApiErrorBody, BookingResponse, ClassItem, CreateBookingInput, CreateMemberInput, ListParams, Member, ScheduleList, SessionDetail, Stats } from './types';

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
  stats: (days = 7) => request<Stats>(`/stats?days=${encodeURIComponent(String(days))}`),
  classes: () => request<{ items: ClassItem[]; total: number }>('/classes'),
  schedule: (params: ListParams) => request<ScheduleList>(`/schedule${query(params)}`),
  session: (id: number) => request<SessionDetail>(`/sessions/${encodeURIComponent(String(id))}`),
  book: (token: string, sessionId: number, input: CreateBookingInput) =>
    request<BookingResponse>(`/admin/sessions/${encodeURIComponent(String(sessionId))}/bookings`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  createMember: (token: string, input: CreateMemberInput) =>
    request<Member>('/admin/members', { method: 'POST', headers: adminHeaders(token), body: JSON.stringify(input) }),
};
