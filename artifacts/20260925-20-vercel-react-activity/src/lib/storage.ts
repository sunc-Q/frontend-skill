/* 带版本的 localStorage 封装（client-localstorage-schema）：
   单一 key、显式 version、字段白名单校验，读出的结果在模块内缓存一次（js-cache-storage）。 */
const KEY = 'soundisle.prefs.v1';

interface Prefs {
  voted: string[];
  tier: string;
}

const DEFAULTS: Prefs = { voted: [], tier: 'day' };
let cached: Prefs | null = null;

function sanitize(raw: unknown): Prefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS };
  const r = raw as { voted?: unknown; tier?: unknown };
  const voted = Array.isArray(r.voted) ? r.voted.filter((x): x is string => typeof x === 'string' && /^a\d\d$/.test(x)) : [];
  const tier = typeof r.tier === 'string' && ['day', 'full', 'vip'].includes(r.tier) ? r.tier : 'day';
  return { voted, tier };
}

export function readPrefs(): Prefs {
  if (cached !== null) return cached;
  try {
    const text = window.localStorage.getItem(KEY);
    const parsed: unknown = text === null ? null : JSON.parse(text);
    const v = (parsed as { v?: unknown } | null)?.v;
    cached = v === 1 ? sanitize((parsed as { data?: unknown }).data) : { ...DEFAULTS };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  const next = sanitize({ ...readPrefs(), ...patch });
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, data: next }));
  } catch {
    /* 存储不可用时保持内存视图 */
  }
  return next;
}
