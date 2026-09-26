/**
 * Transport abstraction: the exact same component code runs against a local fixture
 * (file:// preview, no network) and against the mock origin (`?api=1`, real HTTP).
 * Every read is counted into `window.__fdReqs`, which is what makes "zero external
 * requests", "single-flight" and "this route fetched N times" assertable instead of claimed.
 */

export interface ReqEntry {
  path: string;
  mode: 'fixture' | 'http';
  /** hrtime-ish monotonic ms since boot */
  at: number;
}

declare global {
  interface Window {
    __fdReqs?: ReqEntry[];
    __fdClock?: number;
  }
}

const boot = typeof performance !== 'undefined' ? performance.now() : 0;

export function reqLog(): ReqEntry[] {
  const w = typeof window === 'undefined' ? undefined : window;
  if (w === undefined) return [];
  if (w.__fdReqs === undefined) w.__fdReqs = [];
  return w.__fdReqs;
}

export function resetReqLog(): void {
  reqLog().length = 0;
}

/** Fixture latency, in ms. The list is deliberately slower than the detail read. */
const LATENCY: Record<string, number> = {
  '/posts': 90,
  '/insights': 70,
  '/starred': 40,
};

export function apiMode(): boolean {
  return typeof window !== 'undefined' && /[?&]api=1/.test(window.location.search);
}

export async function read<T>(path: string, fixture: () => T): Promise<T> {
  const mode = apiMode() ? 'http' : 'fixture';
  reqLog().push({ path, mode, at: Math.round((performance.now() - boot) * 10) / 10 });
  if (mode === 'http') {
    const res = await fetch(`/api${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`transport: ${path} → ${res.status}`);
    return (await res.json()) as T;
  }
  await new Promise((r) => setTimeout(r, LATENCY[path] ?? 60));
  return fixture();
}

/**
 * In-flight de-duplication for reads that are not backed by a query cache
 * (the deferred insights panel). Key stability matters here: see `queryKeys.ts`.
 */
const inflight = new Map<string, Promise<unknown>>();

export function readShared<T>(path: string, fixture: () => T): Promise<T> {
  const existing = inflight.get(path);
  if (existing !== undefined) return existing as Promise<T>;
  const p = read<T>(path, fixture).finally(() => {
    inflight.delete(path);
  });
  inflight.set(path, p);
  return p;
}
