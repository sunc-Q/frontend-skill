import { useQuery, type QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';

/**
 * Ablation device, not a product feature.
 *
 * frontend-development states as a CRITICAL RULE: "No Early Returns — ❌ NEVER
 * `if (isLoading) return <LoadingSpinner/>` … ✅ ALWAYS <SuspenseLoader><Content/></SuspenseLoader>",
 * with the justification "Prevents Cumulative Layout Shift (CLS)". The skill gives no
 * measurement, so `?control=early` reproduces the forbidden shape on the same bundle and
 * the check script measures the loading/loaded geometry of both modes.
 */
export const CONTROL_EARLY_RETURN =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('control') === 'early';

export interface RouteGateProps {
  queryKey: QueryKey;
  queryFn: () => Promise<unknown>;
  children: ReactNode;
}

export function RouteGate({ queryKey, queryFn, children }: RouteGateProps): ReactNode {
  const query = useQuery({ queryKey, queryFn, staleTime: Infinity });
  if (CONTROL_EARLY_RETURN && query.data === undefined) {
    return (
      <Box data-gate="early" sx={{ height: 40, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircularProgress size={18} />
        <span className="fd-foot">加载中…</span>
      </Box>
    );
  }
  return <SuspenseLoader>{children}</SuspenseLoader>;
}
