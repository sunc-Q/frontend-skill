import type { RuleKind, WaybillStatus } from './types';

// 金额与重量全程用整数（分 / 克），只在渲染时换算，避免浮点累加造成分位漂移。
export function yuan(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function yuanCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 10_000) return '¥' + (v / 10_000).toFixed(2) + ' 万';
  if (Math.abs(v) >= 1_000) return '¥' + (v / 1_000).toFixed(1) + 'k';
  return '¥' + v.toFixed(0);
}

export function kg(grams: number): string {
  if (!Number.isFinite(grams)) return '—';
  if (grams < 1000) return `${grams} g`;
  return (grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2) + ' kg';
}

export function count(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

export function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

// 后端时间戳是 UTC，业务日历日是 UTC+8；「今天」的判定必须同口径，
// 否则北京时间 0-8 点会把当天单量算成昨天（历史轮次踩过的双时钟坑）。
const CST_OFFSET_MS = 8 * 3_600_000;

function parts(iso: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + CST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function dateOnly(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const p = parts(iso);
  return p === null ? iso.slice(0, 10) : `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function dateTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const p = parts(iso);
  return p === null ? iso : `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
}

export function stamp(iso: string): string {
  const p = parts(iso);
  return p === null ? iso : `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)} 北京时间`;
}

export function dayDiff(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// 相对「现在」的小时差：正数表示还剩多久，负数表示已逾期多久。
export function hoursFromNow(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.round((t - Date.now()) / 3_600_000);
}

export const STATUS_LABEL: Record<WaybillStatus, string> = {
  booked: '已下单',
  picked_up: '已揽收',
  in_transit: '干线运输中',
  arrived: '已到达分拨',
  out_for_delivery: '派送中',
  delivered: '已签收',
  exception: '异常挂起',
  returned: '已退回',
};

export const TIER_LABEL: Record<string, string> = {
  express: '特快',
  standard: '标快',
  economy: '经济',
};

export const KIND_LABEL: Record<RuleKind, string> = {
  remote_pct: '偏远区按比例',
  heavy_piece: '单件超重固定额',
  fragile_flat: '易碎加固固定额',
  long_haul_flat: '长途干线固定额',
};

export const EVENT_LABEL: Record<string, string> = {
  booked: '下单',
  picked_up: '揽收',
  in_transit: '干线发出',
  arrived: '到达分拨',
  out_for_delivery: '外出派送',
  delivered: '签收',
  exception: '异常登记',
  returned: '退回',
  line: '在途打卡',
};

// 状态 → 抽象语气：CSS 只认语气，业务口径留在 JS 里（三风格共用同一份映射）。
export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

export const STATUS_TONE: Record<WaybillStatus, Tone> = {
  booked: 'idle',
  picked_up: 'info',
  in_transit: 'info',
  arrived: 'info',
  out_for_delivery: 'warn',
  delivered: 'ok',
  exception: 'bad',
  returned: 'bad',
};

export function toneOf(status: string): Tone {
  return STATUS_TONE[status as WaybillStatus] ?? 'idle';
}

export const STATUS_ORDER: readonly WaybillStatus[] = [
  'booked',
  'picked_up',
  'in_transit',
  'arrived',
  'out_for_delivery',
  'delivered',
  'exception',
  'returned',
];

// 与后端 NextStatus 同表：前端只用它决定「可推进到哪些状态」，
// 真正的裁判仍在后端（这里只是为了不把非法选项喂给用户）。
export const NEXT_STATUS: Record<WaybillStatus, readonly WaybillStatus[]> = {
  booked: ['picked_up', 'exception', 'returned'],
  picked_up: ['in_transit', 'exception', 'returned'],
  in_transit: ['arrived', 'exception', 'returned'],
  arrived: ['out_for_delivery', 'exception', 'returned'],
  out_for_delivery: ['delivered', 'exception', 'returned'],
  delivered: [],
  exception: ['in_transit', 'out_for_delivery', 'returned'],
  returned: [],
};

export function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
