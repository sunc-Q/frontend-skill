import type { ReactElement, ReactNode } from 'react';
import { corpus, intfmt } from '@/lib/facts';

export interface LayoutProps {
  routeId: 'home' | 'post' | 'archive' | 'about';
  children: ReactNode;
}

const NAV: { id: LayoutProps['routeId']; href: string; label: string }[] = [
  { id: 'home', href: '#/', label: '最新' },
  { id: 'archive', href: '#/archive', label: '归档' },
  { id: 'about', href: '#/about', label: '关于' },
];

/**
 * Shared shell: one header, one nav with aria-current, one stats block, one footer. Nothing here
 * reads from the network — the numbers come from the bundle — so App renders it *outside* the
 * route's Suspense boundary and the chrome survives a slow origin. Routes own <main> only.
 */
export function Layout({ routeId, children }: LayoutProps): ReactElement {
  const { stats } = corpus;
  return (
    <div className="shell" data-testid="shell">
      <header className="masthead">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1 className="site">灰度通讯 GRAYSCALE</h1>
            <p className="tagline">发布、观测与故障复盘的私人记录 · 示例站点</p>
          </div>
        </div>
        <nav className="nav" aria-label="主导航">
          {NAV.map((n) => (
            <a key={n.id} href={n.href} aria-current={routeId === n.id ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <dl className="stats" data-testid="stats">
        <div className="stat">
          <dt>文章</dt>
          <dd data-testid="stat-posts">{intfmt(stats.posts)}</dd>
        </div>
        <div className="stat">
          <dt>阅读次数</dt>
          <dd data-testid="stat-views">{intfmt(stats.views)}</dd>
        </div>
        <div className="stat">
          <dt>累计分钟</dt>
          <dd data-testid="stat-minutes">{intfmt(stats.minutes)}</dd>
        </div>
        <div className="stat">
          <dt>最长连续更新（月）</dt>
          <dd data-testid="stat-streak">{intfmt(stats.streak)}</dd>
        </div>
      </dl>
      <main className="main">{children}</main>
      <footer className="foot">
        <p>
          本站为 frontend-development 技能验证用的虚构站点：文章、读数与邮箱均不存在，读数由同一份事实源推导。
        </p>
        <p className="demo" data-testid="foot-count">
          {stats.posts} 篇 · 跨 {stats.spanMonths} 个自然月、其中 {stats.months} 个月有文（最长断更 {stats.longestGap} 个月）· 中位数 {stats.medianMinutes} 分钟 / 平均 {intfmt(stats.avgViews)} 次阅读
        </p>
      </footer>
    </div>
  );
}

export default Layout;
