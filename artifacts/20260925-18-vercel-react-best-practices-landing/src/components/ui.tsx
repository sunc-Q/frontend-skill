import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Feature } from '../lib/content';

/* rendering-hoist-jsx: 静态常量与 SVG 路径提到模块级，渲染期不再新建 */
export const SECTIONS = [
  { id: 'hero', label: '起点' },
  { id: 'features', label: '能力' },
  { id: 'how', label: '流程' },
  { id: 'voices', label: '使用者' },
  { id: 'faq', label: '疑问' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/* rerender-dependencies: effect 依赖用模块级常量，不用每次渲染新建的数组 */
const SECTION_IDS: SectionId[] = SECTIONS.map((s) => s.id);
const SPY_THRESHOLDS: number[] = [0.15, 0.4, 0.7];

export type ThemeKey = 'wabi' | 'construct' | 'memphis';

export const THEME_META: Record<ThemeKey, { name: string; note: string }> = {
  wabi: { name: '侘寂留白', note: '暖灰、大留白、细衬线' },
  construct: { name: '构成主义', note: '红黑对角、粗黑体、硬阴影' },
  memphis: { name: '孟菲斯', note: '粉彩撞色、虚线描边、贴纸几何' },
};

/* 同一份 JS 产物服务三个页面：主题只能来自 HTML 上的 data-theme */
export function detectTheme(): ThemeKey {
  const raw = document.documentElement.getAttribute('data-theme');
  if (raw === 'construct' || raw === 'memphis' || raw === 'wabi') return raw;
  return 'wabi';
}

const ICONS: Record<Feature['id'] | 'mark' | 'check' | 'arrow', string> = {
  private: 'M12 3 4.5 6.2v5.3c0 4.4 3.1 8.5 7.5 9.7 4.4-1.2 7.5-5.3 7.5-9.7V6.2L12 3Zm0 4.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0 8.9c1.8 0 3.4.9 4.3 2.2A8.8 8.8 0 0 1 12 20a8.8 8.8 0 0 1-4.3-2.3A5.2 5.2 0 0 1 12 16.5Z',
  fast: 'M13 2 4 13.5h5L9 22l9-11.5h-5L13 2Z',
  smart: 'M12 2a5 5 0 0 0-5 5c0 1.4-.8 2.6-2 3.6v2.3c1.2 1 2 2.2 2 3.6a5 5 0 0 0 10 0c0-1.4.8-2.6 2-3.6v-2.3c-1.2-1-2-2.2-2-3.6a5 5 0 0 0-5-5Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  mark: 'M12 2c-2.2 4-6 5.6-6 9.4A6 6 0 0 0 12 17a6 6 0 0 0 6-5.6C18 7.6 14.2 6 12 2Z',
  check: 'M9.6 17.4 4.8 12.6l1.6-1.6 3.2 3.2 7.2-7.2 1.6 1.6Z',
  arrow: 'M12 4v11.2l4.6-4.6 1.4 1.4-7 7-7-7 1.4-1.4L10 15.6V4Z',
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    out = out.length === 0 ? p : out + ' ' + p;
  }
  return out;
}

export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (el === null) return;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
}

/* client-event-listeners: 全站只用一个 IntersectionObserver 覆盖所有区块 */
export function useScrollSpy(): [SectionId, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId>('hero');

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        let best: string | null = null;
        let bestRatio = 0;
        for (const e of entries) {
          seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        }
        for (const id of SECTION_IDS) {
          const r = seen.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            best = id;
          }
        }
        if (best !== null) setActive(best as SectionId);
      },
      { threshold: SPY_THRESHOLDS, rootMargin: '-84px 0px -55% 0px' },
    );
    for (const id of SECTION_IDS) {
      const el = document.getElementById(id);
      if (el !== null) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const jump = (id: SectionId) => {
    scrollToId(id);
    setActive(id);
  };

  return [active, jump];
}

/* client-passive-event-listeners: passive 监听 + 只在跨越阈值时 setState，滚动不重复渲染 */
export function useScrolled(offset = 12): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let last = false;
    const onScroll = () => {
      const next = window.scrollY > offset;
      if (next !== last) {
        last = next;
        setScrolled(next);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [offset]);
  return scrolled;
}

/* rendering-content-visibility + client-event-listeners:
   一个 observer 给所有 [data-reveal] 元素加 .is-in，元素自身不挂监听 */
export function useReveal(): void {
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const targets = document.querySelectorAll('[data-reveal]');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
}

/* rerender-use-ref-transient-values + js-batch-dom-css:
   指针位置是高频瞬态值，存 ref、按帧一次性写两个自定义属性，全程不 setState */
export function usePointerVars(): (e: ReactMouseEvent) => void {
  const pending = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef(0);

  useEffect(
    () => () => {
      if (raf.current !== 0) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return (e) => {
    const host = e.currentTarget as HTMLElement;
    pending.current = { x: e.clientX, y: e.clientY };
    if (raf.current !== 0) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const p = pending.current;
      if (p === null) return;
      const r = host.getBoundingClientRect();
      const pct = (v: number, size: number) => Math.round(((v / (size || 1)) * 100 + Number.EPSILON) * 10) / 10;
      host.style.setProperty('--px', pct(p.x - r.left, r.width) + '%');
      host.style.setProperty('--py', pct(p.y - r.top, r.height) + '%');
    });
  };
}

/* bundle-defer-third-party: 统计脚本这类非关键三方等首屏空闲再注入 */
declare global {
  interface Window {
    __sgAnalytics?: { queued: number; ready: boolean };
  }
}

export function useDeferredAnalytics(): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const idle: (cb: () => void) => number =
      typeof window.requestIdleCallback === 'function'
        ? (cb) => window.requestIdleCallback(() => cb())
        : (cb) => window.setTimeout(cb, 800);
    idle(() => {
      window.__sgAnalytics = { queued: 0, ready: true };
    });
  }, []);
}

export interface Toast {
  id: number;
  message: string;
}

/* rerender-functional-setstate: 队列只用品函数更新，push/dismiss 引用永远稳定 */
export function useToasts(): [Toast[], (message: string) => void, (id: number) => void] {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((cur) => cur.concat([{ id, message }]));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  return [toasts, push, dismiss];
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const map = timers.current;
    for (const t of toasts) {
      if (map.has(t.id)) continue;
      map.set(
        t.id,
        setTimeout(() => {
          map.delete(t.id);
          dismissRef.current(t.id);
        }, 3600),
      );
    }
  }, [toasts]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.length > 0
        ? toasts.map((t) => (
            <div key={t.id} className="toast" data-toast={t.id}>
              {t.message}
            </div>
          ))
        : null}
    </div>
  );
}
