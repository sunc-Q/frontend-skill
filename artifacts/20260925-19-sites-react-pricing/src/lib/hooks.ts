import { useEffect, useRef } from 'react';

/** 一个组件实例只初始化一次：动态 import 与事件订阅都要求「每次页面加载一次」（advanced-init-once）。 */
export function useOncePerLoad(init: () => void): void {
  const done = useRef(false);
  const latest = useRef(init);
  // 依赖表留空 = 每次加载一次；回调走 ref，不因闭包过期而重跑（rerender-dependencies）
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    latest.current();
  }, []);
}

/** 把回调放进 ref，监听器只订阅一次且永远拿到最新闭包（advanced-event-handler-refs）。 */
export function useEventRef<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  return useRef((...args: A): R => ref.current(...args)).current;
}

/** 指针位置写进 CSS 变量：用 ref + 直接改样式，不进 state（rerender-use-ref-transient-values）。 */
export function usePointerVars(targetRef: { current: HTMLElement | null }): void {
  useEffect(() => {
    const node = targetRef.current;
    if (node === null) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = node.getBoundingClientRect();
        // 一次写入两条属性，避免分多次触发样式重算（js-batch-dom-css）
        node.style.setProperty('--px', (((event.clientX - rect.left) / rect.width) * 100).toFixed(1) + '%');
        node.style.setProperty('--py', (((event.clientY - rect.top) / rect.height) * 100).toFixed(1) + '%');
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [targetRef]);
}

/** 页面滚动只挂一个 passive 监听器，并且只切换一个类（client-event-listeners / client-passive-event-listeners）。 */
export function useScrolledFlag(nodeRef: { current: HTMLElement | null }, threshold: number): void {
  useEffect(() => {
    const node = nodeRef.current;
    if (node === null) return;
    let scrolled = false;
    const onScroll = () => {
      const next = window.scrollY > threshold;
      if (next === scrolled) return;
      scrolled = next;
      node.classList.toggle('is-scrolled', next);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [nodeRef, threshold]);
}

/** 进场动画：只对挂载时就存在的静态区块打标。基态可见，.is-in 只是「加上一层动画」。 */
export function useReveal(selector: string): void {
  useEffect(() => {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length === 0) return; // js-length-check-first
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [selector]);
}
