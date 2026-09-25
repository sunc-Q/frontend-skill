import React, { useMemo } from 'react';
import { Chip, Paper, Typography } from '@mui/material';
import { useLinksQuery } from '~features/links/hooks/useLinksQuery';
import { topByClicks } from '../helpers/statsHelpers';
import { fmtInt } from '@/lib/format';

export const TopList: React.FC = () => {
  const links = useLinksQuery();
  const top5 = useMemo(() => topByClicks(links, 5), [links]);
  return (
    <Paper className="fd-relief" sx={{ p: 2, display: 'grid', gap: 1 }} data-panel="top5">
      <div className="fd-panel-head">
        <Typography variant="subtitle2" component="h2">热门短链 Top 5</Typography>
        <Typography variant="caption" component="span">按累计点击</Typography>
      </div>
      <ol className="fd-toplist" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {top5.map((l) => (
          <li key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="fd-slug">r/{l.slug}</span>
            <Chip size="small" label={l.paused ? '已停用' : '活跃'} variant="outlined" />
            <span className="fd-num">{fmtInt(l.clicks)}</span>
          </li>
        ))}
      </ol>
    </Paper>
  );
};

export default TopList;
