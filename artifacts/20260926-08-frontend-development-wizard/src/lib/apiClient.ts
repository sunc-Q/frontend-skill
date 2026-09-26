import { BOOTSTRAP, USCC_VALID } from './facts';
import type { BootstrapPayload, BridgeCall } from '~types/index';

/**
 * Transport abstraction. In this round every call is answered by the in-process mock
 * below, but the component code only ever sees `request()`, so the same source could be
 * pointed at a real origin by flipping USE_FETCH.
 *
 * The skill's API-service clause says route format is `/form/route`, **not**
 * `/api/form/route` — every path here follows that, and group A greps the source for it.
 */

const USE_FETCH = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('api') === '1';

const t0 = Date.now();
const calls: BridgeCall[] = [];

export function requestLog(): BridgeCall[] {
  return calls.slice();
}

export function resetRequestLog(): void {
  calls.length = 0;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface SubdomainVerdict {
  value: string;
  verdict: 'available' | 'taken' | 'reserved' | 'error';
}

const LAT = BOOTSTRAP.latencyMs;

/** latency per subdomain — `fast` resolves sooner than an earlier `slow` request */
const latencyFor = (value: string): number => {
  if (value === 'slow') return LAT.slow as number;
  if (value === 'fast') return LAT.fast as number;
  if (value === 'flaky') return 120;
  return LAT.default as number;
};

export async function checkSubdomain(value: string): Promise<SubdomainVerdict> {
  calls.push({ path: '/wizard/check-subdomain', method: 'POST', atMs: Date.now() - t0, key: `sub:${value}` });
  await sleep(latencyFor(value));
  if (value === 'flaky') return { value, verdict: 'error' };
  if (BOOTSTRAP.reservedSubdomains.includes(value)) return { value, verdict: 'reserved' };
  if (BOOTSTRAP.takenSubdomains.includes(value)) return { value, verdict: 'taken' };
  return { value, verdict: 'available' };
}

export async function checkEmail(value: string): Promise<SubdomainVerdict> {
  calls.push({ path: '/wizard/check-email', method: 'POST', atMs: Date.now() - t0, key: `mail:${value}` });
  await sleep(LAT.email as number);
  if (BOOTSTRAP.takenEmails.includes(value.toLowerCase())) return { value, verdict: 'taken' };
  return { value, verdict: 'available' };
}

export interface SubmitBody {
  token: string;
  payload: Record<string, unknown>;
}

const issued = new Map<string, string>();
const claimed = new Map<string, string>();

export async function submitWizard(body: SubmitBody): Promise<{
  ok: boolean;
  status: number;
  orderId?: string;
  reason?: string;
  duplicate?: boolean;
}> {
  calls.push({ path: '/wizard/submit', method: 'POST', atMs: Date.now() - t0, key: `submit:${body.token}` });
  await sleep(LAT.submit as number);
  const sub = String(body.payload.subdomain ?? '');
  const seen = issued.get(body.token);
  if (seen !== undefined) {
    /* idempotent replay: same token => same order, no second registration */
    return { ok: true, status: 200, orderId: seen, duplicate: true };
  }
  const prior = claimed.get(sub);
  if (prior !== undefined) {
    return { ok: false, status: 409, reason: 'subdomain_taken', orderId: prior, duplicate: false };
  }
  const orderId = `TD-${sub.toUpperCase()}-${String(claimed.size + 1).padStart(4, '0')}`;
  issued.set(body.token, orderId);
  claimed.set(sub, orderId);
  return { ok: true, status: 201, orderId, duplicate: false };
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
  calls.push({ path: '/wizard/bootstrap', method: 'GET', atMs: Date.now() - t0, key: 'bootstrap' });
  if (USE_FETCH) {
    const res = await fetch('/wizard/bootstrap');
    return (await res.json()) as BootstrapPayload;
  }
  await sleep(LAT.bootstrap as number);
  return { ...BOOTSTRAP };
}

/** server-side completeness rules the client must not be able to bypass */
export async function serverAudit(payload: Record<string, unknown>): Promise<string[]> {
  calls.push({ path: '/wizard/audit', method: 'POST', atMs: Date.now() - t0, key: 'audit' });
  await sleep(40);
  const problems: string[] = [];
  if (typeof payload.storeName !== 'string' || payload.storeName.trim().length < 2) problems.push('storeName');
  if (typeof payload.subdomain !== 'string' || payload.subdomain.length < 3) problems.push('subdomain');
  if (payload.agree !== true) problems.push('agree');
  if (payload.accountType === 'enterprise' && payload.uscc !== USCC_VALID) problems.push('uscc');
  return problems;
}
