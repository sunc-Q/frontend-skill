import { lazy } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { postsApi } from '~features/posts/api/postsApi';
import { postsKey } from '~features/posts/api/queryKeys';
import type { RouteSpec } from '../router';

const ArchivePage = lazy(() => import('~features/archive').then((m) => ({ default: m.ArchivePage })));

/**
 * The loader asks for the list with the home page's key. From the home page that is a cache hit
 * and therefore zero requests; straight from a deep link it is one. Group G measures both, which
 * is the only way to tell "cache-first" apart from "the request happened to be fast".
 */
export const archiveRoute: RouteSpec = {
  pattern: '/archive',
  crumb: '归档',
  layoutId: 'archive',
  loader: ({ queryClient }) =>
    queryClient.ensureQueryData(queryOptions({ queryKey: postsKey(), queryFn: () => postsApi.listPosts() })),
  component: ArchivePage,
};
