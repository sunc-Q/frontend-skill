/* 模拟第三方统计：不在首屏包内，水合后由 requestIdleCallback 动态引入
   （bundle-defer-third-party 的等价做法）。引入前的调用先进内存队列。 */
export interface Analytics {
  track(ev: string, data?: Record<string, string | number>): void;
  queued(): number;
}

const buffer: { ev: string; data?: Record<string, string | number>; t: number }[] = [];

export function initAnalytics(): Analytics {
  return {
    track(ev, data) {
      buffer.push({ ev, data, t: Date.now() });
    },
    queued() {
      return buffer.length;
    },
  };
}
