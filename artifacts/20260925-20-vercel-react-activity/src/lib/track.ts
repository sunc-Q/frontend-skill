/* 埋点门面：同步调用只入队（微开销），空闲时才把 analytics chunk 拉下来。
   在 split 构建里 analytics 是独立 chunk —— bundle-defer-third-party 的可断言证据。 */
type Queued = { ev: string; data?: Record<string, string | number>; t: number };

const queue: Queued[] = [];
let loaded: { track: (ev: string, data?: Record<string, string | number>) => void } | null = null;

export function track(ev: string, data?: Record<string, string | number>): void {
  if (loaded !== null) loaded.track(ev, data);
  else queue.push({ ev, data, t: Date.now() });
}

export function queueSize(): number {
  return queue.length;
}

export async function whenIdle(fn: () => void): Promise<void> {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(fn);
  else setTimeout(fn, 200);
}

export function deferLoadAnalytics(): void {
  void whenIdle(async () => {
    const mod = await import('./analytics');
    loaded = mod.initAnalytics();
    for (const item of queue.splice(0, queue.length)) loaded.track(item.ev, item.data);
  });
}
