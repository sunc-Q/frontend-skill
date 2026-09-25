import type { ApiError, Artist, RegisterBody, ScheduleData, Summary } from './types';
import { FIXTURE_ARTISTS, FIXTURE_NOTICES, FIXTURE_SESSIONS, FIXTURE_SUMMARY } from './content';

export interface Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export function makeApiError(status: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  return err;
}

export function isApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null && 'code' in e && 'status' in e;
}

/* ---------- 设备令牌：一次生成、内存缓存读取（advanced-init-once + js-cache-storage） ---------- */

let deviceToken: string | null = null;
export function getDeviceToken(): string {
  if (deviceToken !== null) return deviceToken;
  if (typeof window === 'undefined') {
    /* Node 断言环境（async-check）里没有 localStorage：用固定测试令牌 */
    deviceToken = 'dt-node-test';
    return deviceToken;
  }
  const KEY = 'soundisle.device.v1';
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  if (stored !== null && stored.startsWith('dt-')) {
    deviceToken = stored;
    return deviceToken;
  }
  deviceToken = 'dt-' + Math.random().toString(36).slice(2, 10);
  try {
    window.localStorage.setItem(KEY, deviceToken);
  } catch {
    /* 隐私模式下降级为内存令牌 */
  }
  return deviceToken;
}

/* ---------- 请求日志：断言「去重/延迟加载」的落点（两种传输都记） ---------- */
export interface ReqEntry {
  m: 'GET' | 'POST';
  path: string;
  t: number;
}
export const reqLog: ReqEntry[] = [];
export function countReq(path: string): number {
  let n = 0;
  for (const r of reqLog) if (r.path === path) n += 1;
  return n;
}

/* ---------- HTTP 传输：GET 带 inflight 去重 + 短 TTL 缓存（client-swr-dedup 的手动等价） ---------- */

interface CacheEntry {
  at: number;
  promise: Promise<unknown>;
}

export function createHttpTransport(baseUrl = ''): Transport {
  const inflight = new Map<string, CacheEntry>();
  const TTL = 5000;

  async function raw<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const data = (await res.json()) as { ok?: boolean; code?: string; message?: string };
    if (!res.ok || data.ok === false) {
      throw makeApiError(res.status, String(data.code ?? 'http_' + res.status), String((data as { message?: string }).message ?? res.statusText));
    }
    return data as T;
  }

  return {
    get<T>(path: string): Promise<T> {
      const now = Date.now();
      const hit = inflight.get(path);
      if (hit !== undefined && now - hit.at < TTL) return hit.promise as Promise<T>;
      reqLog.push({ m: 'GET', path, t: Date.now() });
      const promise = raw<T>(baseUrl + path, { headers: { 'x-device': getDeviceToken() } });
      inflight.set(path, { at: now, promise });
      promise.catch(() => inflight.delete(path));
      return promise;
    },
    post<T>(path: string, body: unknown): Promise<T> {
      reqLog.push({ m: 'POST', path, t: Date.now() });
      return raw<T>(baseUrl + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device': getDeviceToken() },
        body: JSON.stringify(body),
      });
    },
  };
}

/* ---------- file:// 离线回退：同一资源层，仅换数据源 ---------- */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createFixtureTransport(): Transport {
  let summary: Summary = { ...FIXTURE_SUMMARY };
  const artists: Artist[] = FIXTURE_ARTISTS.map((a) => ({ ...a }));
  const votedByDevice = new Set<string>();
  let seq = 1;

  return {
    async get<T>(path: string): Promise<T> {
      reqLog.push({ m: 'GET', path, t: Date.now() });
      await delay(path === '/api/lineup' ? 40 : path === '/api/notices' ? 50 : 20);
      if (path === '/api/summary') return { ...summary, serverNow: Date.now() } as unknown as T;
      if (path === '/api/schedule') return { days: ['fri', 'sat', 'sun'], sessions: FIXTURE_SESSIONS } as unknown as T;
      if (path === '/api/lineup') return artists.map((a) => ({ ...a })) as unknown as T;
      if (path === '/api/notices') return FIXTURE_NOTICES as unknown as T;
      if (path === '/api/tickets/vip') return { left: Math.min(46, summary.ticketsLeft) } as unknown as T;
      throw makeApiError(404, 'fixture_404', 'fixture 无此路径 ' + path);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      reqLog.push({ m: 'POST', path, t: Date.now() });
      await delay(60);
      if (path === '/api/register') {
        const r = body as RegisterBody;
        if (r.phone.startsWith('000')) throw makeApiError(403, 'device_denied', '风控拦截：该手机号被暂时限制');
        if (/风控/.test(r.name)) throw makeApiError(409, 'risk_hold', '姓名触发实名风控，报名已回滚');
        if (r.qty > summary.ticketsLeft) throw makeApiError(409, 'sold_out', '余票不足，剩 ' + summary.ticketsLeft + ' 张');
        summary = { ...summary, signedCount: summary.signedCount + r.qty, ticketsLeft: summary.ticketsLeft - r.qty };
        return { ok: true, registrationId: 'REG-' + String(seq++).padStart(4, '0'), signedCount: summary.signedCount, ticketsLeft: summary.ticketsLeft } as unknown as T;
      }
      if (path === '/api/vote') {
        const { artistId } = body as { artistId: string };
        const artist = artists.find((a) => a.id === artistId);
        if (artist === undefined) throw makeApiError(404, 'no_artist', '查无此人');
        if (votedByDevice.has(artistId)) throw makeApiError(409, 'already_voted', '每位乐迷每档只有一次投票机会');
        votedByDevice.add(artistId);
        artist.votes += 1;
        return { ok: true, artistId, votes: artist.votes } as unknown as T;
      }
      throw makeApiError(404, 'fixture_404', 'fixture 无此路径 ' + path);
    },
  };
}

/* ---------- 传输选择与一次性初始化（advanced-init-once） ---------- */

let transport: Transport | null = null;
export function initTransport(): Transport {
  if (transport !== null) return transport;
  transport =
    typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? createFixtureTransport()
      : createHttpTransport('');
  return transport;
}
export function getTransport(): Transport {
  return transport ?? initTransport();
}
/** 仅供测试注入桩传输（断言请求次数/时序用）。传 null 复位。 */
export function setTransportForTests(t: Transport | null): void {
  transport = t;
}

/* ---------- 资源：promise 先行发起、await 推迟到使用处；data 变更可订阅 ---------- */

export interface Resource<T> {
  key: string;
  /** 首帧取数：在 bootstrap 时就已发出（async-parallel），此处只 await */
  promise: Promise<T>;
  data: T | null;
  error: unknown;
  subscribe(cb: () => void): () => void;
  /** 乐观补丁：立即改视图并通知订阅者 */
  patch(fn: (prev: T) => T): void;
  /** 服务端定案：以真实返回覆盖（或回滚）视图 */
  settle(v: T): void;
  invalidate(fetcher: () => Promise<T>): Promise<T>;
}

const registry = new Map<string, Resource<unknown>>();

function makeResource<T>(key: string, promise: Promise<T>): Resource<T> {
  const subs = new Set<() => void>();
  const emit = () => {
    for (const cb of subs) cb();
  };
  const res: Resource<T> = {
    key,
    promise,
    data: null,
    error: null,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    patch(fn) {
      if (res.data !== null) {
        res.data = fn(res.data);
        emit();
      }
    },
    settle(v) {
      res.data = v;
      res.error = null;
      emit();
    },
    invalidate(fetcher) {
      const p = fetcher().then(
        (v) => {
          res.settle(v);
          return v;
        },
        (e) => {
          res.error = e;
          emit();
          throw e;
        },
      );
      res.promise = p;
      return p;
    },
  };
  promise.then(
    (v) => res.settle(v),
    (e) => {
      res.error = e;
      emit();
    },
  );
  return res;
}

/**
 * loadResource：key 级去重 —— 多组件同一 tick 请求同一资源只发一次网络请求，
 * 且组件随时挂载都能拿到已 resolve 的数据（不再重复请求）。
 */
export function loadResource<T>(key: string, fetcher: () => Promise<T>): Resource<T> {
  const existing = registry.get(key);
  if (existing !== undefined) return existing as Resource<T>;
  const res = makeResource<T>(key, fetcher());
  registry.set(key, res as Resource<unknown>);
  return res;
}

export function peekResource(key: string): Resource<unknown> | undefined {
  return registry.get(key);
}

/** 仅供测试：清空资源注册表，让下一组断言从零发起请求 */
export function resetRegistryForTests(): void {
  registry.clear();
}

/* ---------- 应用启动：三个独立资源同刻并发发起，挂载路径上零串行 await（async-parallel） ---------- */

export interface Boot {
  summary: Resource<Summary>;
  schedule: Resource<ScheduleData>;
  lineup: Resource<Artist[]>;
}

export function bootstrap(t: Transport): Boot {
  const summary = loadResource('summary', () => t.get<Summary>('/api/summary'));
  const schedule = loadResource('schedule', () => t.get<ScheduleData>('/api/schedule'));
  const lineup = loadResource('lineup', () => t.get<Artist[]>('/api/lineup'));
  return { summary, schedule, lineup };
}
