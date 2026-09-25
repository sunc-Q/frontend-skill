import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { series14 } from '@/lib/apiClient';
import { fmtInt } from '@/lib/format';
import { maxOf } from '../helpers/statsHelpers';

const BAR_W = 100 / (series14.length * 1.6);
const GAP = (100 - BAR_W * series14.length) / (series14.length - 1);
const MAX = maxOf(series14);
const AXIS = ['9-12', '9-18', '9-25'];

/** Static JSX / derived geometry hoisted to module scope (renders 14 rects per mount). */
export const TrendPanel: React.FC = () => (
  <Paper className="fd-relief fd-scanline" sx={{ p: 2, display: 'grid', gap: 1 }} data-panel="trend">
    <div className="fd-panel-head">
      <Typography variant="subtitle2" component="h2">近 14 日点击趋势</Typography>
      <Typography variant="caption" component="span">峰值 {fmtInt(MAX)} / 日</Typography>
    </div>
    <Box component="svg" viewBox="0 0 100 40" width="100%" height={120} preserveAspectRatio="none" role="img" aria-label="近 14 日点击柱状趋势">
      {series14.map((v, i) => (
        <rect
          key={i}
          x={(i * (BAR_W + GAP)).toFixed(3)}
          y={(40 - (v / MAX) * 38).toFixed(3)}
          width={BAR_W.toFixed(3)}
          height={((v / MAX) * 38).toFixed(3)}
          fill="currentColor"
          data-day={i}
          data-value={v}
        />
      ))}
    </Box>
    <div className="fd-foot" style={{ display: 'flex', justifyContent: 'space-between' }}>
      {AXIS.map((d) => <span key={d}>{d}</span>)}
    </div>
  </Paper>
);

export default TrendPanel;
