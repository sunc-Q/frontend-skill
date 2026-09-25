import React from 'react';
import { Box } from '@mui/material';

export interface SparklineProps {
  values: number[];
  label: string;
  height?: number;
}

const VIEW_W = 100;

/** Chart drawn from inline SVG so the preview stays dependency-free and zero-link. */
export const Sparkline: React.FC<SparklineProps> = ({ values, label, height = 26 }) => {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = VIEW_W / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / span) * (height - 2)).toFixed(2)}`).join(' ');
  return (
    <Box component="svg" viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" height={height} role="img" aria-label={label} preserveAspectRatio="none" data-fd="sparkline">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </Box>
  );
};

export default Sparkline;
