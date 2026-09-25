/* 松塔 Songta 定价：纯函数层。不依赖 React，可在 Node 里直接断言。
   计价口径（全部写死在此，页面只负责展示）：
   - 林木 Grove：按席位阶梯计价（同一张账单内不同区间单价叠加）
   - 冠层 Canopy：单一单价，但最少按 20 席计费；SSO 与审计日志已含
   - 苗木 Seed：0 元，席位上限 3，不能选购任何增值模块
   - 年付：整单折扣（Grove 8 折、Canopy 75 折），增值模块跟随所属套餐的折扣率
   - 币种：以 CNY 为基准，USD = CNY / 汇率；CNY 取整到 1 元，USD 取整到 0.5 美元
*/

export type Period = 'monthly' | 'annual';
export type Currency = 'CNY' | 'USD';
export type TierId = 'seed' | 'grove' | 'canopy';
export type AddOnId = 'storage' | 'sso' | 'audit' | 'priority' | 'api';

export interface Bracket {
  readonly from: number;
  readonly to: number;
  readonly unit: number;
}

export interface Tier {
  readonly id: TierId;
  readonly name: string;
  readonly latin: string;
  readonly tagline: string;
  readonly seats: { readonly min: number; readonly max: number; readonly suggested: number };
  readonly annualDiscount: number;
  readonly includedAddOns: readonly AddOnId[];
  readonly allowedAddOns: readonly AddOnId[];
  readonly highlights: readonly string[];
}

export interface AddOn {
  readonly id: AddOnId;
  readonly name: string;
  readonly note: string;
  /** per-seat 按席位计价，flat 按组织计价 */
  readonly kind: 'per-seat' | 'flat';
  readonly price: number;
  readonly availableOn: readonly TierId[];
}

export const USD_PER_CNY = 1 / 7.15;

/** 阶梯：from/to 为席位数闭区间，unit 为该区间每席每月价（CNY）。 */
export const GROVE_BRACKETS: readonly Bracket[] = [
  { from: 1, to: 5, unit: 39 },
  { from: 6, to: 20, unit: 29 },
  { from: 21, to: 50, unit: 22 },
  { from: 51, to: 1000, unit: 17 },
];

export const CANOPY_UNIT = 58;
export const CANOPY_MIN_SEATS = 20;
export const SEAT_CAP = 100;

export const TIERS: readonly Tier[] = [
  {
    id: 'seed',
    name: '苗木',
    latin: 'Seed',
    tagline: '一个人先把反馈收干净',
    seats: { min: 1, max: 3, suggested: 2 },
    annualDiscount: 0,
    includedAddOns: [],
    allowedAddOns: [],
    highlights: ['1 个公开看板', '500 条反馈上限', '邮箱与网页片段收集', '社区支持'],
  },
  {
    id: 'grove',
    name: '林木',
    latin: 'Grove',
    tagline: '小团队按席位付费，用多少买多少',
    seats: { min: 1, max: SEAT_CAP, suggested: 8 },
    annualDiscount: 0.2,
    includedAddOns: [],
    allowedAddOns: ['storage', 'priority', 'api'],
    highlights: ['无限看板与反馈', '重复反馈自动合并', '公开路线图与投票', '自定义域名'],
  },
  {
    id: 'canopy',
    name: '冠层',
    latin: 'Canopy',
    tagline: '要过安全审查的团队选这档',
    seats: { min: 1, max: SEAT_CAP, suggested: 40 },
    annualDiscount: 0.25,
    includedAddOns: ['sso', 'audit'],
    allowedAddOns: ['storage', 'priority', 'api'],
    highlights: ['含 SSO/SAML 与审计日志', '角色与看板级权限', '数据导出与保留策略', '工作日 4 小时响应'],
  },
];

/** tierId -> Tier（js-index-maps：重复查表用 Map，不再每次 find） */
export const TIER_BY_ID: ReadonlyMap<TierId, Tier> = new Map(TIERS.map((t) => [t.id, t]));

export const ADD_ONS: readonly AddOn[] = [
  {
    id: 'storage',
    name: '附件存储 +200GB',
    note: '截图、录屏与客户原话录音',
    kind: 'flat',
    price: 120,
    availableOn: ['grove', 'canopy'],
  },
  {
    id: 'sso',
    name: 'SSO / SAML',
    note: 'Okta、飞书、企业微信身份源',
    kind: 'per-seat',
    price: 8,
    availableOn: ['canopy'],
  },
  {
    id: 'audit',
    name: '审计日志导出',
    note: '90 天操作留痕，可投递到对象存储',
    kind: 'flat',
    price: 200,
    availableOn: ['canopy'],
  },
  {
    id: 'priority',
    name: '优先支持',
    note: '4 小时首响，含一次上线陪跑',
    kind: 'per-seat',
    price: 5,
    availableOn: ['grove', 'canopy'],
  },
  {
    id: 'api',
    name: '高级 API 与 Webhook',
    note: '每分钟 600 次调用，出站事件重试 3 次',
    kind: 'flat',
    price: 90,
    availableOn: ['grove', 'canopy'],
  },
];

export const ADD_ON_BY_ID: ReadonlyMap<AddOnId, AddOn> = new Map(ADD_ONS.map((a) => [a.id, a]));

export function tierOf(id: TierId): Tier {
  const tier = TIER_BY_ID.get(id);
  if (tier === undefined) throw new Error('未知套餐 ' + id);
  return tier;
}

/** 林木的阶梯席位费：一次遍历逐区间累加，不做 filter+map+reduce 三趟（js-combine-iterations）。 */
export function groveSeatsMonthly(seats: number): number {
  let total = 0;
  let remaining = seats;
  for (const bracket of GROVE_BRACKETS) {
    if (remaining <= 0) return total; // js-early-exit
    const span = bracket.to - bracket.from + 1;
    const take = remaining < span ? remaining : span;
    total += take * bracket.unit;
    remaining -= take;
  }
  return total;
}

export function canopySeatsMonthly(seats: number): number {
  const billed = seats < CANOPY_MIN_SEATS ? CANOPY_MIN_SEATS : seats;
  return billed * CANOPY_UNIT;
}

/** 套餐本身的月价（未含增值模块，未折扣）。 */
export function tierMonthly(tier: TierId, seats: number): number {
  if (tier === 'seed') return 0;
  if (tier === 'canopy') return canopySeatsMonthly(seats);
  return groveSeatsMonthly(seats);
}

/** 折前月价合计（套餐 + 已选增值模块）。一次循环同时累加，不做两趟遍历。
    三张卡片 + 合计条 + 最便宜档比较都会反复问同一个问题，结果按原始值键缓存（js-cache-function-results）。 */
const LIST_CACHE = new Map<string, number>();

export function listMonthly(tier: TierId, seats: number, addOns: readonly AddOnId[]): number {
  const cacheKey = tier + '|' + seats + '|' + addOns.join(',');
  const hit = LIST_CACHE.get(cacheKey);
  if (hit !== undefined) return hit;
  const computed = computeListMonthly(tier, seats, addOns);
  if (LIST_CACHE.size > 500) LIST_CACHE.clear(); // 只做上限保护，不做 LRU
  LIST_CACHE.set(cacheKey, computed);
  return computed;
}

function computeListMonthly(tier: TierId, seats: number, addOns: readonly AddOnId[]): number {
  const picked = new Set(addOns); // js-set-map-lookups
  const clamped = clampSeats(tier, seats);
  const billed = tier === 'canopy' && clamped < CANOPY_MIN_SEATS ? CANOPY_MIN_SEATS : clamped;
  let total = tierMonthly(tier, clamped);
  for (const id of tierOf(tier).allowedAddOns) {
    if (!picked.has(id)) continue;
    const addOn = ADD_ON_BY_ID.get(id);
    if (addOn === undefined) continue;
    total += addOn.kind === 'flat' ? addOn.price : addOn.price * billed;
  }
  return total;
}

export interface QuoteLine {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  /** 本计费周期内的金额：月付是一个月，年付是十二个月。币种已折算、已取整。 */
  readonly amount: number;
}

export interface Quote {
  readonly tier: TierId;
  readonly period: Period;
  readonly currency: Currency;
  readonly seats: number;
  readonly billedSeats: number;
  /** 明细行，含「年付折扣」负项。不变式：各行 amount 之和 === charged。 */
  readonly lines: readonly QuoteLine[];
  /** 折前月价合计 */
  readonly listMonthly: number;
  /** 折后每月口径（年付时 = charged / 12 取整） */
  readonly monthlyTotal: number;
  /** 本周期实际支付额（月付一个月 / 年付一次付清十二个月） */
  readonly charged: number;
  /** 年付相对月付一年省下的钱；月付为 0 */
  readonly saved: number;
  readonly discountRate: number;
  readonly perSeatMonthly: number;
}

function roundFor(currency: Currency, value: number): number {
  return currency === 'CNY' ? Math.round(value) : Math.round(value * 2) / 2;
}

/** 账单生成：先把每行的「月价(CNY)」列出来，再统一按周期放大、按币种折算取整。
    charged 由各行相加得来，保证明细与合计永远对得上（scripts/pricing-check.mjs 逐行核对）。 */
export function buildQuote(input: {
  tier: TierId;
  seats: number;
  period: Period;
  currency: Currency;
  addOns: readonly AddOnId[];
}): Quote {
  const { tier, period, currency } = input;
  const config = tierOf(tier);
  const clampedSeats = clampSeats(tier, input.seats);
  const billedSeats = tier === 'canopy' && clampedSeats < CANOPY_MIN_SEATS ? CANOPY_MIN_SEATS : clampedSeats;
  const picked = new Set(input.addOns); // js-set-map-lookups
  const factor = period === 'annual' ? 12 : 1;

  const rows: { key: string; label: string; detail: string; cny: number }[] = [];
  const listBase = tierMonthly(tier, clampedSeats);
  rows.push({
    key: 'tier',
    label: config.name + ' ' + config.latin,
    detail:
      tier === 'seed'
        ? '免费档，不含增值模块'
        : tier === 'canopy'
          ? billedSeats + ' 席 × ¥' + CANOPY_UNIT + (clampedSeats < CANOPY_MIN_SEATS ? '（不足 20 席按 20 席计）' : '')
          : bracketDetail(clampedSeats),
    cny: listBase,
  });

  // 一次遍历同时得到模块小计与明细行（js-combine-iterations）
  let listAddOns = 0;
  for (const id of config.allowedAddOns) {
    if (!picked.has(id)) continue;
    const addOn = ADD_ON_BY_ID.get(id);
    if (addOn === undefined) continue;
    const monthly = addOn.kind === 'flat' ? addOn.price : addOn.price * billedSeats;
    listAddOns += monthly;
    rows.push({
      key: 'addon-' + id,
      label: addOn.name,
      detail: addOn.kind === 'flat' ? '按组织，每月固定' : billedSeats + ' 席 × ¥' + addOn.price,
      cny: monthly,
    });
  }

  const listTotal = listBase + listAddOns;
  const discountRate = period === 'annual' ? config.annualDiscount : 0;
  const monthlyTotalCny = listTotal * (1 - discountRate);

  const lines: QuoteLine[] = rows.map((row) => ({
    key: row.key,
    label: row.label,
    detail: row.detail,
    amount: convert(currency, row.cny * factor),
  }));

  if (discountRate > 0) {
    lines.push({
      key: 'discount',
      label: '年付折扣',
      detail: config.name + '档 -' + Math.round(discountRate * 100) + '%',
      amount: -convert(currency, listTotal * discountRate * factor),
    });
  }

  // charged 取各行之和，而不是独立算一遍——明细与合计不可能对不上
  let charged = 0;
  for (const line of lines) charged += line.amount;

  // 省下的钱 = 不打折按同样的取整规则买十二个月 - 本单一次支付额
  const twelveList = convert(currency, listTotal) * 12;
  const saved = period === 'annual' ? twelveList - charged : 0;

  return {
    tier,
    period,
    currency,
    seats: clampedSeats,
    billedSeats,
    lines,
    listMonthly: convert(currency, listTotal),
    monthlyTotal: period === 'annual' ? roundFor(currency, charged / 12) : charged,
    charged,
    saved,
    discountRate,
    perSeatMonthly: billedSeats === 0 ? 0 : roundFor(currency, monthlyTotalCny / billedSeats),
  };
}

export function convert(currency: Currency, cny: number): number {
  return roundFor(currency, currency === 'CNY' ? cny : cny * USD_PER_CNY);
}

/** 某一档在当前席位 / 周期 / 币种下的「每月应付」（含已选增值模块与年付折扣）。
    卡片与合计条都走这一个口径，避免两处各写一遍算法。 */
export function monthlyFor(
  tier: TierId,
  seats: number,
  addOns: readonly AddOnId[],
  period: Period,
  currency: Currency,
): number {
  const config = tierOf(tier);
  const clamped = clampSeats(tier, seats);
  const rate = period === 'annual' ? config.annualDiscount : 0;
  return convert(currency, listMonthly(tier, clamped, addOns) * (1 - rate));
}

/** 阶梯明细文本，如「1-5 席 ¥39 · 6-8 席 ¥29」；同时用作断言的交叉证据。 */
export function bracketDetail(seats: number): string {
  const parts: string[] = [];
  let remaining = seats;
  for (const bracket of GROVE_BRACKETS) {
    if (remaining <= 0) break;
    const span = bracket.to - bracket.from + 1;
    const take = remaining < span ? remaining : span;
    parts.push(bracket.from + '-' + (bracket.from + take - 1) + ' 席 ¥' + bracket.unit);
    remaining -= take;
  }
  return parts.join(' · ');
}

export function clampSeats(tier: TierId, seats: number): number {
  const config = tierOf(tier);
  const safe = Number.isFinite(seats) ? Math.floor(seats) : 1;
  if (safe < config.seats.min) return config.seats.min;
  if (safe > config.seats.max) return config.seats.max;
  return safe;
}

/** 折前三档中每月最便宜的一档：用循环求最小值而不是 sort（js-min-max-loop）。 */
export function cheapestTier(seats: number, addOns: readonly AddOnId[]): { tier: TierId; monthly: number } {
  let bestTier: TierId = 'seed';
  let best = Number.POSITIVE_INFINITY;
  for (const tier of TIERS) {
    const monthly = listMonthly(tier.id, seats, addOns);
    if (monthly < best) {
      best = monthly;
      bestTier = tier.id;
    }
  }
  return { tier: bestTier, monthly: best };
}

/** 给定预算能买到几席（林木）：线性推进，不用二分也不排序，价格曲线本身单调。 */
export function seatsWithinBudget(budgetCny: number): number {
  if (budgetCny <= 0) return 0; // js-early-exit
  let seats = 0;
  let spent = 0;
  for (const bracket of GROVE_BRACKETS) {
    const span = bracket.to - bracket.from + 1;
    const affordable = Math.floor((budgetCny - spent) / bracket.unit);
    if (affordable <= 0) return seats;
    const take = affordable < span ? affordable : span;
    seats += take;
    spent += take * bracket.unit;
    if (take < span) return seats;
  }
  return seats;
}

/** 下一个更便宜的阶梯从几席开始；已到最低阶梯返回 null（渲染侧显式给出空态）。 */
export function nextBracketAt(seats: number): number | null {
  for (const bracket of GROVE_BRACKETS) {
    if (seats < bracket.from) return bracket.from;
  }
  return null;
}

const SYMBOLS: Readonly<Record<Currency, string>> = { CNY: '¥', USD: '$' };

export function formatMoney(currency: Currency, value: number): string {
  const digits = currency === 'CNY' ? 0 : value % 1 === 0 ? 0 : 2;
  return SYMBOLS[currency] + value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 已包含在某档里的增值模块（用于对比表显示「已含」）。 */
export function includedIn(tier: TierId): ReadonlySet<AddOnId> {
  return new Set(tierOf(tier).includedAddOns);
}
