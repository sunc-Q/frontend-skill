import { useEffect, useRef, useState } from 'react';
import { EVENT } from '../lib/content';

/* 静态装饰 SVG 提升到模块级：整棵树共用同一元素引用（rendering-hoist-jsx） */
const ISLE_MARK = (
  <svg className="mark" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="26" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M6 26h28" stroke="currentColor" strokeWidth="2" />
    <path d="M13 17c2-6 5-9 7-9s5 3 7 9" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const NAV = [
  { href: '#lineup', label: '阵容' },
  { href: '#schedule', label: '日程' },
  { href: '#register', label: '报名' },
  { href: '#poster', label: '海报' },
];

export default function Frame() {
  const [condensed, setCondensed] = useState(false);
  // 只订阅回调里用到的布尔值的最小化：滚动位置放 ref，不进 state（rerender-use-ref-transient-values）
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const next = y > 64;
      lastY.current = y;
      if (next !== condensed) setCondensed(next);
    };
    // 滚动监听不需要 preventDefault：passive 让合成器不等 JS（client-passive-event-listeners）
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [condensed]);

  return (
    <header className={'topbar' + (condensed ? ' is-condensed' : '')} data-testid="topbar">
      <div className="brand">
        {ISLE_MARK}
        <span className="brand-cn">{EVENT.name}</span>
        <span className="brand-en">{EVENT.enName}</span>
      </div>
      <nav className="nav" aria-label="页面导航">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className="nav-link">
            {n.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
