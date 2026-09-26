import { dayToMonth } from '@/lib/facts';
import type { PostRow } from '~features/posts/types';

export interface MonthRow {
  month: string;
  count: number;
  views: number;
  minutes: number;
  fastest: number;
}

export interface YearRow {
  year: number;
  count: number;
  views: number;
  minutes: number;
  months: MonthRow[];
}

/** Grouping is a pure function so the checker can run the identical code path in Node. */
export function buildArchive(rows: PostRow[]): YearRow[] {
  const years = new Map<number, Map<string, MonthRow>>();
  for (const r of rows) {
    const month = dayToMonth(r.day);
    const year = Number(month.slice(0, 4));
    const yMap = years.get(year);
    const target = yMap ?? new Map<string, MonthRow>();
    if (yMap === undefined) years.set(year, target);
    const cur = target.get(month);
    if (cur === undefined) {
      target.set(month, { month, count: 1, views: r.views, minutes: r.minutes, fastest: r.minutes });
    } else {
      cur.count += 1;
      cur.views += r.views;
      cur.minutes += r.minutes;
      cur.fastest = Math.min(cur.fastest, r.minutes);
    }
  }
  return [...years.entries()]
    .map(([year, months]) => {
      const list = [...months.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
      return {
        year,
        months: list,
        count: list.reduce((n, m) => n + m.count, 0),
        views: list.reduce((n, m) => n + m.views, 0),
        minutes: list.reduce((n, m) => n + m.minutes, 0),
      };
    })
    .sort((a, b) => b.year - a.year);
}
