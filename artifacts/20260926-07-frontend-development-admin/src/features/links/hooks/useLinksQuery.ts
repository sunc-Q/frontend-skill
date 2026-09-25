import { useSuspenseQuery } from '@tanstack/react-query';
import { linksApi, LINKS_QUERY_KEY } from '../api/linksApi';
import type { BeLink } from '~types/index';

/** Skill clause: "PRIMARY PATTERN: useSuspenseQuery — replaces isLoading checks". */
export function useLinksQuery(): BeLink[] {
  const { data } = useSuspenseQuery({
    queryKey: LINKS_QUERY_KEY,
    queryFn: linksApi.list,
    staleTime: Infinity,
  });
  return data;
}

export default useLinksQuery;
