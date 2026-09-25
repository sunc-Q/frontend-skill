import React from 'react';
import { Paper, Typography } from '@mui/material';
import { Sparkline } from './Sparkline';

export interface KpiCardProps {
  label: string;
  value: string;
  delta: string;
  deltaDir: 'up' | 'down' | 'flat';
  spark: number[];
}

export const KpiCard: React.FC<KpiCardProps> = ({ label, value, delta, deltaDir, spark }) => (
  <Paper className="fd-relief" sx={{ p: 2, display: 'grid', gap: 0.5 }} data-kpi={label}>
    <Typography variant="caption" component="h3" sx={{ textTransform: 'uppercase' }}>{label}</Typography>
    <Typography variant="h6" className="fd-num" component="p" sx={{ m: 0 }}>
      {value}
    </Typography>
    <Typography variant="caption" component="p" sx={{ m: 0 }} data-delta={deltaDir} className={deltaDir === 'down' ? 'fd-delta-down' : 'fd-delta-up'}>
      {delta}
    </Typography>
    <span style={{ color: 'var(--fd-primary)', display: 'block' }}>
      <Sparkline values={spark} label={`${label}趋势`} />
    </span>
  </Paper>
);

export default KpiCard;
