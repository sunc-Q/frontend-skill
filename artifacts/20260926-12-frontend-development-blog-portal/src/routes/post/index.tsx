import { lazy } from 'react';
import { queryOptions } from '@tanstack/react-query';
import { postsApi } from '~features/posts/api/postsApi';
import { postKey, postsKey } from '~features/posts/api/queryKeys';
import type { RouteSpec } from '../router';

const PostPage = lazy(() => import('~features/posts').then((m) => ({ default: m.PostPage })));

/**
 * Two loaders on purpose: warm the list so a back-navigation is instant, and warm the detail
 * only when the deep link names the post. Whether they actually fire is counted per route in
 * group G, because the unstable-key arm re-requests them on every render.
 */
export const postRoute: RouteSpec = {
  pattern: '/post/:slug',
  crumb: '正文',
  layoutId: 'post',
  loader: async ({ queryClient, params }) => {
    const list = queryClient.ensureQueryData(queryOptions({ queryKey: postsKey(), queryFn: () => postsApi.listPosts() }));
    const slug = params['slug'];
    if (slug === undefined) return list;
    await Promise.all([list, queryClient.ensureQueryData(queryOptions({ queryKey: postKey(slug), queryFn: () => postsApi.getPost(slug) }))]);
    return undefined;
  },
  component: PostPage,
};
