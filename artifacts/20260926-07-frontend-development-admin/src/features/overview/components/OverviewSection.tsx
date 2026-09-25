import React, { Suspense, useMemo } from 'react';
import { Grid, Paper, Typography } from '@mui/material';
import { useOverviewQuery } from '../hooks/useOverviewQuery';
import { KpiCard } from './KpiCard';
import { EventFeed } from './EventFeed';
import { fmtDelta, fmtInt, fmtPct } from '@/lib/format';
import { useLinksQuery } from '~features/links/hooks/useLinksQuery';

// Skill clause: "Lazy load heavy components (DataGrid, charts)" — the two chart panels.
const TrendPanel = React.lazy(() => import('./TrendPanel').then((m) => ({ default: m.TrendPanel })));
const TopList = React.lazy(() => import('./TopList').then((m) => ({ default: m.TopList })));

export const OverviewSection: React.FC = () => {
  const { stats, events } = useOverviewQuery();
  const links = useLinksQuery();
  const wow = fmtDelta(stats.clicks7d, stats.clicksPrev7d);
  const activeRatio = useMemo(() => (stats.activeLinks / Math.max(stats.totalLinks, 1)) * 100, [stats]);

  return (
    <div data-section="overview" style={{ display: 'grid', gap: 16 }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard label="近 7 日点击" value={fmtInt(stats.clicks7d)} delta={`${wow} 环比`} deltaDir={wow.startsWith('-') ? 'down' : 'up'} spark={stats.sparkDaily} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard label="30 日 API 调用" value={fmtInt(stats.apiCalls30d)} delta="稳定增长" deltaDir="flat" spark={stats.sparkApi} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard label="可用率（8 周）" value={fmtPct(stats.uptime, 2)} delta="SLA 目标 99.9%" deltaDir={stats.uptime >= 99.9 ? 'up' : 'down'} spark={stats.sparkUptime} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <KpiCard label="短链总数" value={fmtInt(stats.totalLinks)} delta={`活跃 ${stats.activeLinks} 条 · ${fmtPct(activeRatio, 0)}`} deltaDir="flat" spark={stats.sparkWeekly} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Suspense fallback={<Paper className="fd-relief" sx={{ p: 2, minHeight: 200 }} />}>
            <TrendPanel />
          </Suspense>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Suspense fallback={<Paper className="fd-relief" sx={{ p: 2, minHeight: 200 }} />}>
            <TopList />
          </Suspense>
        </Grid>
      </Grid>

      <EventFeed events={events} />
      <Typography variant="caption" component="p" data-fd="link-count">
        服务端短链共 {links.length} 条
      </Typography>
    </div>
  );
};

export default OverviewSection;
