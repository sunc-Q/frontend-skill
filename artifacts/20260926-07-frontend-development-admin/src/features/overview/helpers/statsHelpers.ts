import type { BeLink } from '~types/index';

/** One pass for max: no sort, no spread. */
export function maxOf(values: number[]): number {
  let out = Number.NEGATIVE_INFINITY;
  for (const v of values) if (v > out) out = v;
  return out;
}

export function topByClicks(links: BeLink[], n: number): BeLink[] {
  return links.slice().sort((a, b) => b.clicks - a.clicks).slice(0, n);
}

export function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}
