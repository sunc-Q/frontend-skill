/**
 * Render counters. The app never reads these; group N does. Baked into the same bundle for both
 * ablation arms, so the only difference between arms is the clause under test.
 */
declare global {
  interface Window {
    __fdRenders?: { row: number; page: number; list: number };
  }
}

export type CounterKey = 'row' | 'page' | 'list';

export function countRender(which: CounterKey): void {
  if (typeof window === 'undefined') return;
  if (window.__fdRenders === undefined) window.__fdRenders = { row: 0, page: 0, list: 0 };
  window.__fdRenders[which] += 1;
}

/**
 * Returns a snapshot, not the live object: a caller that keeps `before`/`after` references to the
 * same object measures `x - x`, which reads as "the clause costs nothing" and is silently wrong.
 */
export function renderCounts(): { row: number; page: number; list: number } {
  const live = typeof window === 'undefined' ? undefined : window.__fdRenders;
  return { row: live?.row ?? 0, page: live?.page ?? 0, list: live?.list ?? 0 };
}

export function resetRenderCounts(): void {
  if (typeof window === 'undefined') return;
  window.__fdRenders = { row: 0, page: 0, list: 0 };
}
