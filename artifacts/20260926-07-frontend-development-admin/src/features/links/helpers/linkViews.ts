import type { BeLink, LinkFilter, SortKey } from '~types/index';

export interface ViewState {
  q: string;
  filter: LinkFilter;
  sort: SortKey;
  expandedId: number | null;
}

export const INITIAL_VIEW: ViewState = { q: '', filter: 'all', sort: 'clicks', expandedId: null };

export type ViewAction =
  | { type: 'q'; q: string }
  | { type: 'filter'; filter: LinkFilter }
  | { type: 'sort'; sort: SortKey }
  | { type: 'expand'; id: number | null };

export function viewReducer(s: ViewState, a: ViewAction): ViewState {
  switch (a.type) {
    case 'q':
      return s.q === a.q ? s : { ...s, q: a.q };
    case 'filter':
      return { ...s, filter: a.filter };
    case 'sort':
      return { ...s, sort: a.sort };
    case 'expand':
      return { ...s, expandedId: s.expandedId === a.id ? null : a.id };
  }
}

/** One pass filters, then a copy is sorted — the source array is never mutated. */
export function selectRows(rows: BeLink[], view: ViewState, deferredQ: string): BeLink[] {
  const needle = deferredQ.trim().toLowerCase();
  const out: BeLink[] = [];
  for (const r of rows) {
    if (view.filter === 'active' && r.paused) continue;
    if (view.filter === 'paused' && !r.paused) continue;
    if (needle !== '' && !r.slug.toLowerCase().includes(needle) && !r.target.toLowerCase().includes(needle)) continue;
    out.push(r);
  }
  return out.sort((a, b) => compare(a, b, view.sort));
}

function compare(a: BeLink, b: BeLink, sort: SortKey): number {
  if (sort === 'clicks') return b.clicks - a.clicks;
  if (sort === 'createdAt') return b.createdAt - a.createdAt;
  return a.slug.localeCompare(b.slug);
}

export function ownerCounts(rows: BeLink[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.owner, (m.get(r.owner) ?? 0) + 1);
  return m;
}

export function sumClicks(rows: BeLink[]): number {
  let total = 0;
  for (const r of rows) total += r.clicks;
  return total;
}
