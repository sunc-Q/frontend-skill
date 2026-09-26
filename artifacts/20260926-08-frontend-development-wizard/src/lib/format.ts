import type { Currency } from '~types/index';

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** USD amounts are quoted to the nearest 0.5 — a rule the money cross-check depends on */
export const roundHalf = (n: number): number => Math.round((n + Number.EPSILON) * 2) / 2;

export const RATE_USD = 7.15;

export function thousands(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const grouped = (int as string).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${grouped}.${dec}`;
}

export function money(n: number, currency: Currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : '$';
  return `${symbol}${thousands(n)}`;
}

/** without thousands separators — used where the checks compare printed text to facts */
export function moneyPlain(n: number, currency: Currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : '$';
  return `${symbol}${n.toFixed(2)}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** grapheme-ish count: the tagline limit is in characters, not UTF-16 units */
export function charCount(s: string): number {
  return Array.from(s).length;
}

export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
