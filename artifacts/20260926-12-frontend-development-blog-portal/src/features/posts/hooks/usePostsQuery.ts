import { useSuspenseQuery } from '@tanstack/react-query';
import { postsApi } from '../api/postsApi';
import { postsKey } from '../api/queryKeys';
import type { ListPayload } from '../types';

/**
 * Skill clause "PRIMARY PATTERN: useSuspenseQuery" + "Cache-first strategy".
 * The route loader and this hook share one request: see group F (request counting) and G
 * (queryKey stability), which is measured over real HTTP rather than argued.
 */
export function usePostsQuery(): ListPayload {
  const { data } = useSuspenseQuery({ queryKey: postsKey(), queryFn: () => postsApi.listPosts() });
  return data;
}
