import {
  ApiError,
  type ApiErrorBody,
  type AssessmentList,
  type AttemptList,
  type ListParams,
  type Paper,
  type Receipt,
  type StartExamInput,
  type StartOut,
  type Stats,
  type StatusOut,
  type SubmitInput,
  type SubmitOut,
  type Statistics,
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
    if (v !== '' && v !== 0) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s === '' ? '' : `?${s}`;
}

function codePath(code: string): string {
  return encodeURIComponent(code.trim());
}

function adminHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export const api = {
  health: () => request<{ status: string }>('/health', { timeoutMs: 4000 }),
  stats: (params: ListParams = {}) => request<Stats>(`/stats${qs(params)}`),
  assessments: (params: ListParams) => request<AssessmentList>(`/assessments${qs(params)}`),
  paper: (code: string) => request<Paper>(`/assessments/${codePath(code)}`),
  statistics: (code: string) => request<Statistics>(`/assessments/${codePath(code)}/statistics`),
  attempts: (code: string, params: ListParams) =>
    request<AttemptList>(`/assessments/${codePath(code)}/attempts${qs(params)}`),
  receipt: (no: string) => request<Receipt>(`/attempts/${codePath(no)}`),
  startAttempt: (token: string, code: string, input: StartExamInput) =>
    request<StartOut>(`/assessments/${codePath(code)}/attempts`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  submit: (token: string, no: string, input: SubmitInput) =>
    request<SubmitOut>(`/attempts/${codePath(no)}/submit`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify(input),
    }),
  setStatus: (token: string, code: string, to: string) =>
    request<StatusOut>(`/assessments/${codePath(code)}/status`, {
      method: 'POST',
      headers: adminHeaders(token),
      body: JSON.stringify({ to }),
    }),
};
