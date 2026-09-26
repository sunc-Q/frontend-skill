import { TAG_LABEL, dayToMonth, daysAgo, relatedTo } from '@/lib/facts';
import type { PostRow } from '../types';
import type { Density, MonthBucket, Post, SortId, TagId } from '~types/post';

/**
 * All list arithmetic lives here as pure functions: the component only decides *when* to call
 * them (skill clause "useMemo: Expensive computations (filter, sort, map)"), and the checks can
 * call the same functions in Node without React to get independent expected values.
 */

export interface ViewModel {
  key: string;
  num: string;
  title: string;
  tagLabel: string;
  date: string;
  /** the row's second line — density actually changes what is on screen, so it is visible to a checker */
  sub: string;
  when: string;
  views: string;
  minutes: number;
  comments: number;
  href: string;
  hot: boolean;
}

export const SEARCH_MIN = 1;

export function matchRow(row: PostRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (needle.length < SEARCH_MIN) return true;
  return (
    row.title.toLowerCase().includes(needle) ||
    TAG_LABEL[row.tag].toLowerCase().includes(needle) ||
    row.slug.includes(needle)
  );
}

export function filterRows(rows: PostRow[], q: string, tag: TagId | 'all'): PostRow[] {
  const byTag = tag === 'all' ? rows : rows.filter((r) => r.tag === tag);
  if (q.trim().length < SEARCH_MIN) return byTag;
  return byTag.filter((r) => matchRow(r, q));
}

export function sortRows(rows: PostRow[], sort: SortId): PostRow[] {
  // never mutate the cached array (the skill's immutability stance; also keeps memo props stable)
  const copy = [...rows];
  if (sort === 'popular') return copy.sort((a, b) => b.views - a.views || a.slug.localeCompare(b.slug));
  if (sort === 'quick') return copy.sort((a, b) => a.minutes - b.minutes || b.day - a.day);
  return copy.sort((a, b) => b.day - a.day || a.slug.localeCompare(b.slug));
}

export function toView(row: PostRow, index: number, density: Density, topViews: number): ViewModel {
  return {
    key: row.slug,
    num: String(index + 1).padStart(3, '0'),
    title: row.title,
    tagLabel: TAG_LABEL[row.tag],
    date: dayToMonth(row.day),
    sub:
      density === 'compact'
        ? `${TAG_LABEL[row.tag]} · ${row.minutes}′`
        : `${dayToMonth(row.day)} · ${row.comments} 条讨论`,
    when: relative(row.day),
    views: row.views.toLocaleString('en-US'),
    minutes: row.minutes,
    comments: row.comments,
    href: `#/post/${row.slug}`,
    hot: row.views >= topViews,
  };
}

function relative(day: number): string {
  const d = daysAgo(day);
  if (d <= 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 7) return `${d} 天前`;
  if (d < 60) return `${Math.floor(d / 7)} 周前`;
  if (d < 730) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}

/** 90th percentile of views inside the current result set — the "hot" flag's rule. */
export function hotThreshold(rows: PostRow[]): number {
  if (rows.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = rows.map((r) => r.views).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.round(sorted.length * 0.9));
  return sorted[idx] ?? Number.POSITIVE_INFINITY;
}

export function monthBucketsOf(rows: PostRow[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  for (const r of rows) {
    const month = dayToMonth(r.day);
    const cur = map.get(month);
    if (cur === undefined) {
      map.set(month, { month, year: Number(month.slice(0, 4)), count: 1, views: r.views, minutes: r.minutes });
    } else {
      cur.count += 1;
      cur.views += r.views;
      cur.minutes += r.minutes;
    }
  }
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

export function tagCountsOf(rows: PostRow[]): { tag: TagId; count: number }[] {
  const map = new Map<TagId, number>();
  for (const r of rows) map.set(r.tag, (map.get(r.tag) ?? 0) + 1);
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function sumViews(rows: PostRow[]): number {
  return rows.reduce((acc, r) => acc + r.views, 0);
}

export function sumMinutes(rows: PostRow[]): number {
  return rows.reduce((acc, r) => acc + r.minutes, 0);
}

/** Detail-page helpers, also used by the checks to compute expected values independently. */
export function relatedRows(slug: string): PostRow[] {
  return relatedTo(slug).map((p: Post) => ({
    slug: p.slug,
    title: p.title,
    day: p.day,
    tag: p.tag,
    views: p.views,
    minutes: p.readingMinutes,
    comments: p.comments,
  }));
}

export function prevNext(slug: string, rows: PostRow[]): { prev: PostRow | null; next: PostRow | null } {
  const ordered = sortRows(rows, 'recent');
  const i = ordered.findIndex((r) => r.slug === slug);
  return { prev: i > 0 ? (ordered[i - 1] ?? null) : null, next: i >= 0 && i < ordered.length - 1 ? (ordered[i + 1] ?? null) : null };
}

/** Article body → blocks. The renderer is shared by the detail page and the checks. */
export interface Block {
  kind: 'h2' | 'h3' | 'p' | 'quote' | 'code';
  text: string;
  lang?: string;
}

export function parseBody(body: string): Block[] {
  const out: Block[] = [];
  const lines = body.split('\n');
  let inCode = false;
  let lang = '';
  let buf: string[] = [];
  const flush = (): void => {
    if (buf.length > 0) {
      out.push({ kind: 'p', text: buf.join(' ') });
      buf = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      if (inCode) {
        out.push({ kind: 'code', text: buf.join('\n'), lang });
        buf = [];
        inCode = false;
      } else {
        flush();
        inCode = true;
        lang = line.slice(3);
      }
      continue;
    }
    if (inCode) {
      buf.push(raw);
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      out.push({ kind: 'h2', text: line.slice(3) });
    } else if (line.startsWith('### ')) {
      flush();
      out.push({ kind: 'h3', text: line.slice(4) });
    } else if (line.startsWith('> ')) {
      flush();
      out.push({ kind: 'quote', text: line.slice(2) });
    } else if (line.length > 0) {
      buf.push(line);
    } else flush();
  }
  flush();
  return out;
}

/** Minimal Go-token highlighter: categories only, colours come from the skin's tokens. */
export type Token = { t: string; c: 'kw' | 'str' | 'num' | 'com' | 'fn' | 'plain' };

const KEYWORDS = new Set(['func', 'return', 'if', 'else', 'for', 'var', 'const', 'type', 'struct', 'package', 'import', 'nil', 'err']);

export function highlight(src: string): Token[][] {
  return src.split('\n').map((line) => {
    const tokens: Token[] = [];
    const re = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+\b)|([A-Za-z_]\w*)|([{}(),;:.]|[^\s{}(),;:.])|(\s+)/g;
    let m: RegExpExecArray | null = re.exec(line);
    while (m !== null) {
      const [, com, str, num, ident, punct, space] = m;
      if (com !== undefined) tokens.push({ t: com, c: 'com' });
      else if (str !== undefined) tokens.push({ t: str, c: 'str' });
      else if (num !== undefined) tokens.push({ t: num, c: 'num' });
      else if (ident !== undefined) tokens.push({ t: ident, c: KEYWORDS.has(ident) ? 'kw' : 'plain' });
      else if (punct !== undefined) tokens.push({ t: punct, c: 'plain' });
      else if (space !== undefined) tokens.push({ t: space, c: 'plain' });
      m = re.exec(line);
    }
    return tokens;
  });
}
