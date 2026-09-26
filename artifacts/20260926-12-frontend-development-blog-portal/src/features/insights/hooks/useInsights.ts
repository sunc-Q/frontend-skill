import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { insightsApi } from '../api/insightsApi';
import { loadInsightsPanel } from '../preload';
import { insightsKey } from '~features/posts/api/queryKeys';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { InsightsPayload } from '../types';

/**
 * Deferred read. Nothing on the home page calls this hook until the panel is asked for,
 * except the `pointerenter` pre-load below, which is the skill's "preload the action the user
 * can already see" stance rather than speculative polish.
 */
export function useInsightsData(): InsightsPayload {
  const { data } = useSuspenseQuery({ queryKey: insightsKey(), queryFn: () => insightsApi.load() });
  return data;
}

export function usePreloadInsights(): () => void {
  const qc = useQueryClient();
  return useCallback((): void => {
    // Data alone is not enough: the click would still wait on the lazy module (H39e measures it).
    void loadInsightsPanel();
    void qc.prefetchQuery({ queryKey: insightsKey(), queryFn: () => insightsApi.load(), staleTime: Infinity });
  }, [qc]);
}
