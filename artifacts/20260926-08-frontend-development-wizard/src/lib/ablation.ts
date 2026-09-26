/**
 * Ablation rig. `__FD_MEMO__` is a build-time define:
 *   vite.config.ts          -> true  (shipped arm: React.memo + useCallback)
 *   vite.control.config.ts  -> false (control arm: plain component + inline handler)
 * Everything else is identical source, so the two bundles differ only in the clause
 * under test. check-dom mounts both and compares DOM bytes + renders-per-keystroke.
 */
declare const __FD_MEMO__: boolean | undefined;

export const MEMO_ARM: boolean = typeof __FD_MEMO__ === 'boolean' ? __FD_MEMO__ : true;
export const ARM_NAME: 'memo' | 'plain' = MEMO_ARM ? 'memo' : 'plain';

const renders = new Map<string, number>();

/** counted inside the component body, so it measures renders, not effects */
export function meter(key: string): void {
  renders.set(key, (renders.get(key) ?? 0) + 1);
}

export function renderCounts(): Record<string, number> {
  return Object.fromEntries([...renders.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export function totalRenders(prefix?: string): number {
  let sum = 0;
  for (const [key, n] of renders.entries()) if (prefix === undefined || key.startsWith(prefix)) sum += n;
  return sum;
}

export function resetRenders(): void {
  renders.clear();
}
