import type { Region } from './types';

export function usd(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function usdCompact(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'k';
  return '$' + v.toFixed(0);
}

// local 按后端下发的固定汇率把美分折成目的国货币（JPY 无小数位）。
export function local(cents: number, region: Region): string {
  if (!Number.isFinite(cents)) return '—';
  const major = (cents / 100) * region.fx_per_usd;
  const digits = region.currency === 'JPY' ? 0 : 2;
  const sym = { USD: '$', EUR: '€', JPY: '¥', AUD: 'A$', AED: 'د.إ ' }[region.currency] ?? region.currency + ' ';
  return (
    sym +
    major.toLocaleString(region.currency === 'AED' ? 'ar-AE' : 'en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  );
}

export function grams(g: number): string {
  if (!Number.isFinite(g)) return '—';
  return g >= 1000 ? (g / 1000).toFixed(2).replace(/\.?0+$/, '') + ' kg' : g + ' g';
}

export function dateOnly(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function dateTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${dateOnly(iso)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export const COUNTRY_FLAG: Record<string, string> = {
  US: '美国',
  DE: '德国',
  JP: '日本',
  AU: '澳大利亚',
  AE: '阿联酋',
};

export function stars(avg: number): string {
  if (!Number.isFinite(avg) || avg <= 0) return '暂无评分';
  const full = Math.round(avg);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}
