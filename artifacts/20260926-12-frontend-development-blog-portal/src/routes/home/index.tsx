import { lazy } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { postsApi } from '~features/posts/api/postsApi';
import { postsKey } from '~features/posts/api/queryKeys';
import type { RouteSpec } from '../router';

/** Skill clause: `routes/{feature-name}/index.tsx`, component lazy-loaded at the route. */
const PostHome = lazy(() => import('~features/posts').then((m) => ({ default: m.PostHome })));

export const homeRoute: RouteSpec = {
  pattern: '/',
  crumb: '最新',
  layoutId: 'home',
  loader: ({ queryClient }) =>
    queryClient.ensureQueryData(queryOptions({ queryKey: postsKey(), queryFn: () => postsApi.listPosts() })),
  component: PostHome,
};
