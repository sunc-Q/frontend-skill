export interface Draft {
  v: 1;
  plan: string;
  platform: string;
  email: string;
}

const KEY = 'shiguang.landing.v1';

const FALLBACK: Draft = { v: 1, plan: 'solo', platform: 'mac', email: '' };

let cache: Draft | null = null;

function available(): Storage | null {
  try {
    const s = window.localStorage;
    if (s === null || s === undefined) return null;
    const probe = '__sg_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    // file:// 下部分浏览器直接抛 SecurityError，静默降级为内存态
    return null;
  }
}

export function loadDraft(): Draft {
  if (cache !== null) return cache;
  const store = available();
  let next = FALLBACK;
  if (store !== null) {
    try {
      const raw = store.getItem(KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const o = parsed as Partial<Draft>;
          if (o.v === 1 && typeof o.plan === 'string' && typeof o.platform === 'string') {
            next = { v: 1, plan: o.plan, platform: o.platform, email: typeof o.email === 'string' ? o.email : '' };
          }
        }
      }
    } catch {
      next = FALLBACK;
    }
  }
  cache = next;
  return next;
}

export function saveDraft(d: Draft): boolean {
  cache = d;
  const store = available();
  if (store === null) return false;
  try {
    store.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function draftFrom(partial: Partial<Draft>, cur: Draft): Draft {
  return { v: 1, plan: partial.plan ?? cur.plan, platform: partial.platform ?? cur.platform, email: partial.email ?? cur.email };
}
