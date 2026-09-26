import { POST_INDEX, corpus } from '@/lib/facts';
import { read } from '@/lib/transport';
import { POSTS_KEY } from './queryKeys';
import type { ListPayload, PostPayload, PostRow } from '../types';

/**
 * features/{feature}/api/{feature}Api.ts — the skill's service-layer shape.
 * One place turns the corpus into wire rows, so the list, the detail page and the mock
 * origin all ship the same numbers (see the cross-check in group E).
 */
export function wireRows(): PostRow[] {
  return corpus.posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    day: p.day,
    tag: p.tag,
    views: p.views,
    minutes: p.readingMinutes,
    comments: p.comments,
  }));
}

function toRow(p: (typeof corpus.posts)[number]): PostRow {
  return {
    slug: p.slug,
    title: p.title,
    day: p.day,
    tag: p.tag,
    views: p.views,
    minutes: p.readingMinutes,
    comments: p.comments,
  };
}

export const postsApi = {
  key: POSTS_KEY,
  listPosts(): Promise<ListPayload> {
    return read<ListPayload>('/posts', () => ({ rows: wireRows(), generatedFor: 'grayscale' }));
  },
  getPost(slug: string): Promise<PostPayload> {
    return read<PostPayload>(`/post/${slug}`, () => {
      const p = POST_INDEX.get(slug);
      if (p === undefined) throw new Error(`postsApi: 没有文章 ${slug}`);
      return {
        ...toRow(p),
        summary: p.summary,
        series: p.series,
        sections: p.sections,
        body: p.body,
        related: corpus.posts
          .filter((q) => q.slug !== p.slug && (q.tag === p.tag || (p.series !== null && q.series === p.series)))
          .sort((a, b) => b.views - a.views)
          .slice(0, 4)
          .map(toRow),
      };
    });
  },
};
