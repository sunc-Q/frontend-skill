import {
  ApiError,
  type ApiErrorBody,
  type BookInput,
  type BookingDetail,
  type BookingList,
  type ClosureInput,
  type ClosureOut,
  type ListParams,
  type PropertyList,
  type QuoteOut,
  type RoomDetail,
  type RoomList,
  type RoomStatusOut,
  type Stats,
  type StatusOut,
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

function qs(params: ListParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== 0) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s === '' ? '' : `?${s}`;
}

function seg(s: string): string {
  return encodeURIComponent(s.trim());
}

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export const api = {
  health: () => request<{ status: string }>('/health', { timeoutMs: 4000 }),
  stats: (params: ListParams = {}) => request<Stats>(`/stats${qs(params)}`),
  properties: (params: ListParams = {}) => request<PropertyList>(`/properties${qs(params)}`),
  rooms: (params: ListParams) => request<RoomList>(`/rooms${qs(params)}`),
  roomDetail: (code: string, params: ListParams = {}) =>
    request<RoomDetail>(`/rooms/${seg(code)}${qs(params)}`),
  quote: (code: string, params: ListParams) => request<QuoteOut>(`/rooms/${seg(code)}/quote${qs(params)}`),
  bookings: (params: ListParams) => request<BookingList>(`/bookings${qs(params)}`),
  bookingDetail: (code: string) => request<BookingDetail>(`/bookings/${seg(code)}`),
  book: (token: string, roomCode: string, input: BookInput, now: string) =>
    request<{ booking: BookingList['items'][number]; message: string }>(
      `/rooms/${seg(roomCode)}/bookings${now === '' ? '' : `?now=${seg(now)}`}`,
      { method: 'POST', headers: adminHeaders(token), body: JSON.stringify(input) },
    ),
  setStatus: (token: string, code: string, to: string, note: string, now: string) =>
    request<StatusOut>(`/bookings/${seg(code)}/status${now === '' ? '' : `?now=${seg(now)}`}`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ to, note }),
    }),
  toggleClosure: (token: string, roomCode: string, input: ClosureInput) =>
    request<ClosureOut>(`/rooms/${seg(roomCode)}/closure`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  setRoomStatus: (token: string, roomCode: string, to: string) =>
    request<RoomStatusOut>(`/rooms/${seg(roomCode)}/status`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ to }),
    }),
};
