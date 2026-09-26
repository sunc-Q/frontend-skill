import { useSuspenseQuery } from '@tanstack/react-query';
import { postsApi } from '../api/postsApi';
import { postKey } from '../api/queryKeys';
import type { PostPayload } from '../types';

/**
 * Detail read. Same pattern as the list, and the route loader uses the same key, so
 * "click a row" and "open the deep link" share one request while the tab is open —
 * which is what group G counts over real HTTP (?api=1).
 */
export function usePostQuery(slug: string): PostPayload {
  const { data } = useSuspenseQuery({ queryKey: postKey(slug), queryFn: () => postsApi.getPost(slug) });
  return data;
}
