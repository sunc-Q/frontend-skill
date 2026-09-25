import { useSuspenseQuery } from '@tanstack/react-query';
import { KEYS_QUERY_KEY, keysApi } from '../api/keysApi';
import type { ApiKey } from '~types/index';

export function useKeysQuery(): ApiKey[] {
  const { data } = useSuspenseQuery({
    queryKey: KEYS_QUERY_KEY,
    queryFn: keysApi.list,
    staleTime: Infinity,
  });
  return data;
}

export default useKeysQuery;
