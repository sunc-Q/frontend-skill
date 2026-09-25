import { useEffect, useRef, useState } from 'react';
import { cn } from '../types';
import type { Link } from '../data/dataset';

/* rendering-hoist-jsx: 静态 JSX / 常量提到模块级，不在渲染内重建 */
export const NAV_ITEMS = [
  { id: 'overview', label: '总览' },
  { id: 'links', label: '短链管理' },
  { id: 'keys', label: 'API 密钥' },
  { id: 'settings', label: '服务设置' },
] as const;

export type SectionId = (typeof NAV_ITEMS)[number]['id'];

export const THEME_META: Record<string, { name: string; desc: string }> = {
  business: { name: '商务白', desc: '浅色企业风' },
  mono: { name: '单色暗', desc: '高对比深色' },
  win95: { name: '95 桌面', desc: '复古系统风' },
};

const ICON_PATHS: Record<SectionId, string> = {
  overview: 'M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6ZM13 9h8V3h-8v6Z',
  links: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM9 13h6v-2H9v2Zm5-6h-1v1.9h4V7h-4v1.9h1a3.1 3.1 0 0 1 0 6.2h-4v-1.9h4A3.1 3.1 0 0 1 14 8Z',
  keys: 'M12.5 6.5a4 4 0 1 0-3.4 6.3L7 15H5v2H3v2h4l6.2-6.2a4 4 0 0 0-.7-6.3Zm1.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9.4 4a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2-1.2l-.4-2.5H10.4l-.4 2.5c-.7.3-1.4.7-2 1.2l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1c.6.5 1.3.9 2 1.2l.4 2.5h4.4l.4-2.5c.7-.3 1.4-.7 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z',
};

export function NavIcon({ section }: { section: SectionId }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[section]} />
    </svg>
  );
}

export function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function StatusPill({ paused }: { paused: boolean }) {
  return (
    <span className={cn('pill', !paused && 'pill--ok')}>
      {paused ? '已停用' : '活跃'}
    </span>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 34;
  let min = Infinity;
  let max = -Infinity;
  // js-min-max-loop: 遍历求极值，不用 sort
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 6) - 3).toFixed(1)}`)
    .join(' ');
  return (
    <svg className={cn('spark', className)} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function BarChart14({ values }: { values: number[] }) {
  let max = 0;
  for (const v of values) {
    if (v > max) max = v;
  }
  const bars = [];
  for (let i = 0; i < values.length; i++) {
    const pct = Math.round((values[i] ?? 0) / (max || 1) * 100);
    bars.push(
      <span key={i} className="bar" style={{ height: `${pct}%` }} title={String(values[i])} />
    );
  }
  return <div className="barchart">{bars}</div>;
}

export function Toasts({ toasts, onDismiss }: { toasts: Array<{ id: number; message: string; ts: number }>; onDismiss: (id: number) => void }) {
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    for (const t of toasts) {
      if (map.has(t.id)) continue;
      const timer = setTimeout(() => {
        map.delete(t.id);
        onDismiss(t.id);
      }, 3200);
      map.set(t.id, timer);
    }
    return () => {
      for (const [, timer] of map) clearTimeout(timer);
      map.clear();
    };
  }, [toasts, onDismiss]);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.length > 0 ? toasts.map((t) => <div key={t.id} className="toast">{t.message}</div>) : null}
    </div>
  );
}

/* 两步确认（删除/吊销）：定时器与回调都是副作用，必须留在事件处理器里，
   写进 state updater 会被 React 重复调用而挂多余定时器 / 走错分支。 */
export function useTwoStep(onConfirm: () => void): [() => void, number, () => void] {
  const [pending, setPending] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const click = () => {
    clearTimer();
    if (pending === 0) {
      setPending(1);
      timer.current = setTimeout(() => setPending(0), 4000);
      return;
    }
    setPending(0);
    confirmRef.current();
  };
  const cancel = () => {
    clearTimer();
    setPending(0);
  };
  return [click, pending, cancel];
}

export function actButtonLabel(twoStep: boolean, base: string): string {
  return twoStep ? '再点一次确认' : base;
}

export type { Link };
