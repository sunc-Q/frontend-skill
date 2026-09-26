import { corpus, dayToYear } from '@/lib/facts';
import { readShared } from '@/lib/transport';
import type { InsightsPayload } from '~features/insights/types';

export const insightsApi = {
  /**
   * Deferred by contract: first paint issues zero requests for this path (group G),
   * `pointerenter` warms it, and the click shares that in-flight read (single-flight).
   */
  load(): Promise<InsightsPayload> {
    return readShared<InsightsPayload>('/insights', () => insightsBuild());
  },
};

export function insightsBuild(): InsightsPayload {
  const yearMap = new Map<number, { year: number; minutes: number; posts: number }>();
  for (const p of corpus.posts) {
    const y = dayToYear(p.day);
    const cur = yearMap.get(y);
    if (cur === undefined) yearMap.set(y, { year: y, minutes: p.readingMinutes, posts: 1 });
    else {
      cur.minutes += p.readingMinutes;
      cur.posts += 1;
    }
  }
  return {
    months: corpus.byMonth.map((m) => ({ month: m.month, count: m.count, views: m.views })),
    tags: corpus.byTag.map((t) => ({ tag: t.tag, count: t.count })),
    years: [...yearMap.values()].sort((a, b) => a.year - b.year),
  };
}
