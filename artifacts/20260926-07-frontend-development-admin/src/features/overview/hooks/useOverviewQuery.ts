import { useSuspenseQuery } from '@tanstack/react-query';
import { OVERVIEW_QUERY_KEY, overviewApi } from '../api/overviewApi';
import type { OverviewData } from '~types/index';

export function useOverviewQuery(): OverviewData {
  const { data } = useSuspenseQuery({
    queryKey: OVERVIEW_QUERY_KEY,
    queryFn: overviewApi.get,
    staleTime: Infinity,
  });
  return data;
}

export default useOverviewQuery;
