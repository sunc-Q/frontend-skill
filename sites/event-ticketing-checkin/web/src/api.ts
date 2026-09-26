import {
	ApiError,
	type ApiErrorBody,
	type CheckinResult,
	type CreateEventInput,
	type Envelope,
	type Event,
	type EventDetail,
	type EventRow,
	type EventStatusResult,
	type ListParams,
	type OrderView,
	type RefundResult,
	type SaleInput,
	type SaleResult,
	type Stats,
	type TicketResult,
	type TicketView,
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

const seg = (s: string): string => encodeURIComponent(s.trim().toUpperCase());

export const api = {
	health: () => request<{ status: string; time: string }>('/health', { timeoutMs: 4000 }),
	stats: (days: number) => request<Stats>(`/stats?days=${encodeURIComponent(String(days))}`),
	events: (params: ListParams) => request<Envelope<EventRow>>(`/events${query(params)}`),
	detail: (code: string) => request<EventDetail>(`/events/${seg(code)}`),
	orders: (params: ListParams) => request<Envelope<OrderView>>(`/orders${query(params)}`),
	tickets: (params: ListParams) => request<Envelope<TicketView>>(`/tickets${query(params)}`),
	ticket: (code: string) => request<TicketResult>(`/tickets/${seg(code)}`),
	createEvent: (token: string, input: CreateEventInput) =>
		request<EventStatusResult>('/admin/events', {
			method: 'POST',
			headers: adminHeaders(token),
			body: JSON.stringify(input),
		}),
	setEventStatus: (token: string, code: string, action: 'open' | 'close' | 'cancel') =>
		request<EventStatusResult>(`/admin/events/${seg(code)}/status`, {
			method: 'POST',
			headers: adminHeaders(token),
			body: JSON.stringify({ action }),
		}),
	sale: (token: string, input: SaleInput) =>
		request<SaleResult>('/admin/sales', {
			method: 'POST',
			headers: adminHeaders(token),
			body: JSON.stringify(input),
		}),
	checkIn: (token: string, code: string, gate: string) =>
		request<CheckinResult>(`/admin/tickets/${seg(code)}/check-in`, {
			method: 'POST',
			headers: adminHeaders(token),
			body: JSON.stringify({ gate }),
		}),
	refund: (token: string, code: string, reason: string) =>
		request<RefundResult>(`/admin/orders/${seg(code)}/refund`, {
			method: 'POST',
			headers: adminHeaders(token),
			body: JSON.stringify({ reason }),
		}),
};

export type { Event };
