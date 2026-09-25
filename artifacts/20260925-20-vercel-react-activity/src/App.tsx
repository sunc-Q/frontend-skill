import { Component, Suspense, useEffect, type ReactNode } from 'react';
import type { Boot } from './lib/api';
import { deferLoadAnalytics } from './lib/track';
import Frame from './components/Frame';
import Hero, { HeroSkeleton } from './components/Hero';
import Lineup, { LineupSkeleton } from './components/Lineup';
import Schedule, { ScheduleSkeleton } from './components/Schedule';
import Register, { RegisterSkeleton } from './components/Register';
import Poster from './components/Poster';

class SectionBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="section error-card" data-testid="section-error">
        <h2>{this.props.label}加载失败</h2>
        <p>数据服务没有应答。可以先浏览其他板块，或稍后重试。</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          重试
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}

export default function App({ boot }: { boot: Boot }) {
  useEffect(() => {
    deferLoadAnalytics(); // 水合完成后才拉统计模块（bundle-defer-third-party）
  }, []);
  return (
    <div className="page">
      <Frame />
      <SectionBoundary label="">
        <Suspense fallback={<HeroSkeleton />}>
          <Hero boot={boot} />
        </Suspense>
      </SectionBoundary>
      <SectionBoundary label="演出阵容 · ">
        <Suspense fallback={<LineupSkeleton />}>
          <Lineup boot={boot} />
        </Suspense>
      </SectionBoundary>
      <SectionBoundary label="日程 · ">
        <Suspense fallback={<ScheduleSkeleton />}>
          <Schedule boot={boot} />
        </Suspense>
      </SectionBoundary>
      <SectionBoundary label="">
        <Suspense fallback={<RegisterSkeleton />}>
          <Register boot={boot} />
        </Suspense>
      </SectionBoundary>
      <Poster />
      <footer className="foot">
        <p>星屿文化 · 声浪岛音乐节组委会 · 湘ICP备2026-0517号</p>
        <p>本页为技能验证用途的虚构活动页，报名/支付链路均为本地模拟数据。</p>
      </footer>
    </div>
  );
}
