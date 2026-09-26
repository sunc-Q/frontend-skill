import { useMemo, type ReactElement } from 'react';
import { useInsightsData } from '../hooks/useInsights';
import { intfmt } from '@/lib/facts';
import type { InsightsPayload } from '../types';

/**
 * The heavy module: an SVG chart set that only exists once the reader asks for it.
 * It is the payload the split-build evidence group (L) measures, so keep it self-contained —
 * nothing outside this file may import it statically.
 */
export function InsightsPanel(): ReactElement {
  const data = useInsightsData();
  const chart = useMemo(() => scaleBars(data), [data]);
  return (
    <section className="panel" data-testid="insights" aria-labelledby="insights-h">
      <h2 id="insights-h">全站读数</h2>
      <svg viewBox="0 0 280 90" width="100%" height="90" role="img" aria-label="按年份的累计阅读分钟柱图">
        {chart.years.map((b) => (
          <g key={b.year}>
            <rect x={b.x} y={90 - b.h} width={b.w} height={b.h} fill="var(--c-primary)" />
            <text x={b.x + b.w / 2} y={86} fontSize="7" textAnchor="middle" fill="var(--c-muted)">
              {String(b.year).slice(2)}
            </text>
          </g>
        ))}
      </svg>
      <table data-testid="insights-table">
        <thead>
          <tr>
            <th scope="col">月份</th>
            <th scope="col">篇数</th>
            <th scope="col">阅读</th>
          </tr>
        </thead>
        <tbody>
          {chart.months.map((m) => (
            <tr key={m.month}>
              <th scope="row">{m.month}</th>
              <td>{m.count}</td>
              <td>{intfmt(m.views)}</td>
            </tr>
          ))}
        </tbody>
        <caption>最近 8 个月；完整口径见「归档」。数据为演示用途的虚构读数。</caption>
      </table>
      <p className="state" data-testid="insights-total">
        合计 {intfmt(chart.totalMinutes)} 分钟 / {chart.tags.length} 个主题
      </p>
    </section>
  );
}

interface Scaled {
  years: { year: number; x: number; w: number; h: number }[];
  months: InsightsPayload['months'];
  tags: InsightsPayload['tags'];
  totalMinutes: number;
}

/** Pure geometry so the checks can recompute the bar heights from the payload. */
export function scaleBars(data: InsightsPayload): Scaled {
  const max = data.years.reduce((m, y) => Math.max(m, y.minutes), 0) || 1;
  const slot = 280 / Math.max(1, data.years.length);
  return {
    years: data.years.map((y, i) => ({
      year: y.year,
      x: Math.round(i * slot + slot * 0.18),
      w: Math.round(slot * 0.64),
      h: Math.max(2, Math.round((y.minutes / max) * 72)),
    })),
    months: data.months.slice(0, 8),
    tags: data.tags,
    totalMinutes: data.years.reduce((s, y) => s + y.minutes, 0),
  };
}

export default InsightsPanel;
