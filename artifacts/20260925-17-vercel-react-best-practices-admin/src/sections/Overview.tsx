import { useMemo } from 'react';
import type { Dataset } from '../data/dataset';
import { fmtInt, fmtDelta, fmtPct, fmtDate } from '../lib/format';
import { Sparkline, BarChart14, StatusPill } from '../components/shared';

const EVENT_LABEL: Record<string, string> = {
  deploy: '部署',
  alert: '告警',
  user: '成员',
  system: '系统',
};

export function OverviewSection({ data }: { data: Dataset }) {
  const { stats, series14, events, links } = data;

  // rerender-memo: 派生计算放在 useMemo，且依赖为原始数据引用
  const top5 = useMemo(() => links.slice().sort((a, b) => b.clicks - a.clicks).slice(0, 5), [links]);
  const wow = fmtDelta(stats.clicks7d, stats.clicksPrev7d);

  return (
    <div className="stack">
      <div className="kpi-row">
        <article className="kpi">
          <h3>近 7 日点击</h3>
          <p className="kpi-value">{fmtInt(stats.clicks7d)}</p>
          <p className={wow.startsWith('-') ? 'kpi-delta down' : 'kpi-delta up'}>{wow} 环比</p>
          <Sparkline values={stats.sparkDaily} />
        </article>
        <article className="kpi">
          <h3>30 日 API 调用</h3>
          <p className="kpi-value">{fmtInt(stats.apiCalls30d)}</p>
          <p className="kpi-delta">稳定增长</p>
          <Sparkline values={stats.sparkApi} />
        </article>
        <article className="kpi">
          <h3>可用率（8 周）</h3>
          <p className="kpi-value">{fmtPct(stats.uptime, 2)}</p>
          <p className="kpi-delta">SLA 目标 99.9%</p>
          <Sparkline values={stats.sparkUptime} />
        </article>
        <article className="kpi">
          <h3>短链总数</h3>
          <p className="kpi-value">{fmtInt(stats.totalLinks)}</p>
          <p className="kpi-delta">活跃 {stats.activeLinks} 条</p>
          <Sparkline values={stats.sparkWeekly} />
        </article>
      </div>

      <div className="panel-row">
        <section className="panel">
          <header className="panel-head">
            <h2>近 14 日点击趋势</h2>
            <span className="panel-sub">峰值 {fmtInt(Math.max(...series14))} / 日</span>
          </header>
          <BarChart14 values={series14} />
          <footer className="panel-foot">
            <span>9-12</span><span>9-18</span><span>9-25</span>
          </footer>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>热门短链 Top 5</h2>
            <span className="panel-sub">按累计点击</span>
          </header>
          <ol className="toplist">
            {top5.map((l) => (
              <li key={l.id}>
                <span className="toplist-slug">r/{l.slug}</span>
                <StatusPill paused={l.paused} />
                <span className="toplist-clicks">{fmtInt(l.clicks)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>最近事件</h2>
          <span className="panel-sub">自动刷新已暂停</span>
        </header>
        <ul className="events">
          {events.map((e) => (
            <li key={e.id}>
              <span className="event-kind">{EVENT_LABEL[e.kind] ?? '系统'}</span>
              <span className="event-text">{e.text}</span>
              <time className="event-time">{fmtDate(e.at)}</time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
