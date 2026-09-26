import { arm } from '@/lib/ablation';

/**
 * The skill's data-fetching section says "useSuspenseQuery … Cache-first strategy" but never
 * spells out that the key has to be referentially stable. The conformant arm returns
 * module-level constants; the `unstable-key` arm builds a fresh object key per call, which is
 * the shape `queryKey: [{ scope, built }]` produces in real code. Group G counts the HTTP
 * requests that follow, so the missing half-sentence becomes a number instead of an opinion.
 */
export const POSTS_KEY = ['posts'] as const;
export const INSIGHTS_KEY = ['insights'] as const;
export const postKeyOf = (slug: string): readonly unknown[] => ['post', slug] as const;

export function postsKey(): readonly unknown[] {
  return arm.stableKey ? POSTS_KEY : [{ scope: 'posts', built: Date.now() }];
}

export function insightsKey(): readonly unknown[] {
  return arm.stableKey ? INSIGHTS_KEY : [{ scope: 'insights', built: Date.now() }];
}

export function postKey(slug: string): readonly unknown[] {
  return arm.stableKey ? postKeyOf(slug) : [{ scope: 'post', slug, built: Date.now() }];
}
