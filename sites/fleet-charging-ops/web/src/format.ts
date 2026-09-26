import type { DayType, PileStatus, Period, SessStatus } from './types';

// 金额与电量全程整数（分 / 瓦时），只在渲染时换算，避免浮点累加造成分位漂移。
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

export function kwh(wh: number): string {
  if (!Number.isFinite(wh)) return '—';
  if (Math.abs(wh) < 1000) return `${wh} Wh`;
  return (wh / 1000).toFixed(wh % 1000 === 0 ? 0 : 1) + ' kWh';
}

export function bigKwh(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 10_000) return (n / 10_000).toFixed(2) + ' 万 kWh';
  return n.toLocaleString('en-US') + ' kWh';
}

export function count(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

export function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

export function minutes(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分`;
}

// 分钟数 → HH:MM（规则窗口用）
export function clock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function windowLabel(startMin: number, endMin: number): string {
  if (startMin === 0 && endMin === 1440) return '全天 00:00-24:00';
  if (endMin <= startMin) return `${clock(startMin)}-次日 ${clock(endMin)}`;
  return `${clock(startMin)}-${clock(endMin)}`;
}

// 后端时间戳是 UTC，业务日历日是 UTC+8；「今天」的判定必须同口径，
// 否则北京时间 0-8 点会把当天单量算成昨天（历史轮次踩过的双时钟坑）。
const CST_OFFSET_MS = 8 * 3_600_000;

function parts(iso: string | null | undefined): { y: number; m: number; d: number; hh: number; mm: number } | null {
  if (iso === undefined || iso === null || iso === '') return null;
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

export function dateOnly(iso: string | null | undefined): string {
  const p = parts(iso);
  return p === null ? '—' : `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function dateTime(iso: string | null | undefined): string {
  const p = parts(iso);
  return p === null ? '—' : `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`;
}

export function timeOnly(iso: string | null | undefined): string {
  const p = parts(iso);
  return p === null ? '—' : `${pad(p.hh)}:${pad(p.mm)}`;
}

export function stamp(iso: string): string {
  const p = parts(iso);
  return p === null ? iso : `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)} 北京时间`;
}

// 相对「现在」的分钟差：正数表示还剩多久，负数表示已经过去多久。
export function minutesFromNow(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.round((t - Date.now()) / 60_000);
}

export const PERIOD_LABEL: Record<Period, string> = { peak: '峰段', flat: '平段', valley: '谷段' };

export const DAY_TYPE_LABEL: Record<DayType, string> = { any: '每天', weekday: '工作日', weekend: '周末' };

export const SESSION_LABEL: Record<SessStatus, string> = {
  charging: '充电中',
  completed: '已结算',
  faulted: '故障挂起',
  aborted: '已弃单',
};

export const PILE_LABEL: Record<PileStatus, string> = {
  online: '在线',
  maintenance: '维保中',
  offline: '离线',
};

export const SESSION_ORDER: readonly SessStatus[] = ['charging', 'faulted', 'completed', 'aborted'];

// 状态 → 抽象语气：CSS 只认语气，业务口径留在 JS 里（三风格共用同一份映射）。
export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

export const SESSION_TONE: Record<SessStatus, Tone> = {
  charging: 'info',
  faulted: 'warn',
  completed: 'ok',
  aborted: 'bad',
};

export const PILE_TONE: Record<PileStatus, Tone> = {
  online: 'ok',
  maintenance: 'warn',
  offline: 'bad',
};

export const PERIOD_TONE: Record<Period, Tone> = {
  peak: 'bad',
  flat: 'info',
  valley: 'ok',
};

export function toneOfStatus(s: string): Tone {
  return SESSION_TONE[s as SessStatus] ?? 'idle';
}

export function toneOfPile(s: string): Tone {
  return PILE_TONE[s as PileStatus] ?? 'idle';
}

export function toneOfPeriod(p: string): Tone {
  return PERIOD_TONE[p as Period] ?? 'idle';
}

export function typeLabel(t: string): string {
  return t === 'dc' ? '直流快充' : '交流慢充';
}
