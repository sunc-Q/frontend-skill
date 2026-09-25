import type { KpiUnit } from '../types';

const nf = new Intl.NumberFormat('zh-CN');

export function int(value: number): string {
  return nf.format(Math.round(value));
}

export function compact(value: number): string {
  if (value >= 10000) return (value / 1000).toFixed(value >= 100000 ? 0 : 1) + 'k';
  return nf.format(Math.round(value));
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m} 分 ${String(s % 60).padStart(2, '0')} 秒`;
}

export function percent(ratio: number, digits = 1): string {
  return (ratio * 100).toFixed(digits) + '%';
}

export function kpiValue(value: number, unit: KpiUnit): string {
  switch (unit) {
    case 'duration':
      return duration(value);
    case 'percent':
      return percent(value / 100, 1);
    case 'pages':
      return value.toFixed(2);
    default:
      return int(value);
  }
}

/** 环比变化；上期为 0 时返回 null，避免编造无穷增幅 */
export function delta(current: number, prev: number): number | null {
  if (!prev) return null;
  return current / prev - 1;
}

export function signedPercent(ratio: number, digits = 1): string {
  const v = (ratio * 100).toFixed(digits);
  return (ratio > 0 ? '+' : '') + v + '%';
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function monthDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}
