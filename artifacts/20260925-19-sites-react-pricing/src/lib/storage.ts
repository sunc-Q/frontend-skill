import type { AddOnId, Currency, Period, TierId } from './pricing';
import { ADD_ON_BY_ID, clampSeats, TIER_BY_ID } from './pricing';

/** 只存用户做过的决定，不存任何能算出来的东西（价格、明细、排序结果）。 */
export interface PricingPrefs {
  readonly version: 2;
  readonly seats: number;
  readonly period: Period;
  readonly currency: Currency;
  readonly tier: TierId;
  readonly addOns: AddOnId[];
  readonly email: string;
}

const STORAGE_KEY = 'songta.pricing';

export const DEFAULT_PREFS: PricingPrefs = {
  version: 2,
  seats: 8,
  period: 'annual',
  currency: 'CNY',
  tier: 'grove',
  addOns: [],
  email: '',
};

const PERIODS = new Set<Period>(['monthly', 'annual']);
const CURRENCIES = new Set<Currency>(['CNY', 'USD']);

/** 读取只做一次并缓存在模块里：后续渲染与事件回调不再碰 localStorage（js-cache-storage / advanced-init-once）。 */
let cached: PricingPrefs | null = null;

export function readPrefs(): PricingPrefs {
  if (cached !== null) return cached;
  cached = parseStored(safeGet());
  return cached;
}

function safeGet(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // 隐私模式 / 存储被禁用：当成首次访问处理
  }
}

/** 版本不符或字段异常一律回落到默认值，且逐字段校验，不做整体信任。 */
function parseStored(raw: string | null): PricingPrefs {
  if (raw === null) return { ...DEFAULT_PREFS, addOns: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS, addOns: [] };
  }
  if (typeof data !== 'object' || data === null) return { ...DEFAULT_PREFS, addOns: [] };
  const d = data as Partial<Record<keyof PricingPrefs, unknown>>;
  if (d.version !== 2) return { ...DEFAULT_PREFS, addOns: [] };

  const tier = typeof d.tier === 'string' && TIER_BY_ID.has(d.tier as TierId) ? (d.tier as TierId) : DEFAULT_PREFS.tier;
  const seats = typeof d.seats === 'number' ? clampSeats(tier, d.seats) : DEFAULT_PREFS.seats;
  const period = typeof d.period === 'string' && PERIODS.has(d.period as Period) ? (d.period as Period) : DEFAULT_PREFS.period;
  const currency =
    typeof d.currency === 'string' && CURRENCIES.has(d.currency as Currency) ? (d.currency as Currency) : DEFAULT_PREFS.currency;
  const addOns = Array.isArray(d.addOns) ? d.addOns.filter((id): id is AddOnId => typeof id === 'string' && ADD_ON_BY_ID.has(id as AddOnId)) : [];
  const email = typeof d.email === 'string' ? d.email.slice(0, 80) : '';
  return { version: 2, seats, period, currency, tier, addOns, email };
}

export function writePrefs(prefs: PricingPrefs): void {
  const payload = JSON.stringify(prefs);
  if (payload.length > 2048) return; // 上限保护：超了说明存了不该存的东西
  try {
    window.localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* 写失败时保持内存状态可用，不打断页面 */
  }
}
