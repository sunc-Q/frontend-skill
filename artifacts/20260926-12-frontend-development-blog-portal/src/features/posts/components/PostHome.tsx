import { lazy, useCallback, useMemo, useState, type ReactElement } from 'react';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';
import { countRender } from '@/lib/counter';
import { TAG_LABEL, featuredSlug, formatDate, intfmt } from '@/lib/facts';
import { STYLES, readStyleId } from '@/lib/style/registry';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { usePostsQuery } from '../hooks/usePostsQuery';
import { usePrefs } from '../hooks/usePrefs';
import { usePreloadInsights } from '~features/insights/hooks/useInsights';
import { loadInsightsPanel } from '~features/insights/preload';
import { ResultsList } from './ResultsList';
import { filterRows, hotThreshold, sortRows, sumMinutes, sumViews, tagCountsOf, toView } from '../helpers/listModel';
import type { SortId } from '~types/post';

/**
 * Skill clause "Lazy load heavy components: charts/editors". The chart panel is the only
 * genuinely heavy module on this page, so it is the only dynamic import here; the split build
 * (group L) is what proves the boundary rather than a claim in a comment.
 */
const InsightsPanel = lazy(loadInsightsPanel);

const SORTS: { id: SortId; label: string }[] = [
  { id: 'recent', label: '最新' },
  { id: 'popular', label: '最热' },
  { id: 'quick', label: '最省时' },
];

export function PostHome(): ReactElement {
  countRender('page');
  const { rows } = usePostsQuery();
  const { prefs, starred, setSort, setDensity, setTag, toggleStar, clearStars } = usePrefs();
  const [rawQuery, setRawQuery] = useState('');
  const [query] = useDebouncedValue(rawQuery, 350);
  const [panelOpen, setPanelOpen] = useState(false);
  const preloadInsights = usePreloadInsights();

  const skin = STYLES[readStyleId()];
  const rowHeight = skin.rowHeight[prefs.density];

  const matched = useMemo(() => filterRows(rows, query, prefs.tag), [rows, query, prefs.tag]);
  const sorted = useMemo(() => sortRows(matched, prefs.sort), [matched, prefs.sort]);
  const hotLine = useMemo(() => hotThreshold(sorted), [sorted]);
  const views = useMemo(
    () => sorted.map((r, i) => toView(r, i, prefs.density, hotLine)),
    [sorted, prefs.density, hotLine],
  );
  const tagStats = useMemo(() => tagCountsOf(rows), [rows]);
  const resultMinutes = useMemo(() => sumMinutes(sorted), [sorted]);
  const resultViews = useMemo(() => sumViews(sorted), [sorted]);
  const hotCount = useMemo(() => views.reduce((n, v) => n + (v.hot ? 1 : 0), 0), [views]);

  const featured = useMemo(() => {
    const slug = featuredSlug();
    return rows.find((r) => r.slug === slug) ?? (sorted[0] ?? null);
  }, [rows, sorted]);

  const onStar = useCallback(
    (slug: string): void => {
      toggleStar(slug);
    },
    [toggleStar],
  );

  const toolbar = (
    <div className="search" data-testid="search">
      <label htmlFor="q">检索</label>
      <input
        id="q"
        data-testid="q"
        type="search"
        autoComplete="off"
        value={rawQuery}
        placeholder="标题 / 标签 / 别名"
        onChange={(e) => setRawQuery(e.target.value)}
      />
      <span className="state" data-testid="debounce-state">
        {rawQuery !== query ? '等待输入…' : query.length > 0 ? `已检索 ${query}` : '全部文章'}
      </span>
    </div>
  );

  return (
    <>
      <div className="cols">
        <div>
          {featured === null ? null : (
            <section className="hero" data-testid="hero">
              <p className="kicker">本期最热 · 近 120 天内读数第一</p>
              <h2>
                <a href={featured.slug ? `#/post/${featured.slug}` : '#/post/'}>{featured.title}</a>
              </h2>
              <p className="summary" data-testid="hero-meta">
                {TAG_LABEL[featured.tag]} · {formatDate(featured.day)} · {intfmt(featured.views)} 次阅读 ·{' '}
                {featured.minutes} 分钟读完 · {featured.comments} 条讨论
              </p>
              <div className="actions">
                <a className="btn" href={`#/post/${featured.slug}`} data-testid="hero-link">
                  读这篇
                </a>
                <button type="button" className="btn ghost" data-testid="hero-star" aria-pressed={starred.has(featured.slug)} onClick={() => onStar(featured.slug)}>
                  {starred.has(featured.slug) ? '已收藏' : '收藏'}
                </button>
              </div>
            </section>
          )}

          {toolbar}

          <div className="toolbar" data-testid="controls">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                data-testid={`sort-${s.id}`}
                aria-pressed={prefs.sort === s.id}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              data-testid="density"
              aria-pressed={prefs.density === 'compact'}
              onClick={() => setDensity(prefs.density === 'compact' ? 'comfortable' : 'compact')}
            >
              {prefs.density === 'compact' ? '紧凑行高' : '舒适行高'}
            </button>
            {prefs.tag !== 'all' ? (
              <button type="button" className="chip" data-testid="clear-tag" aria-pressed="true" onClick={() => setTag('all')}>
                {TAG_LABEL[prefs.tag]} ×
              </button>
            ) : null}
            <span className="count" data-testid="result-count">
              {views.length} / {rows.length} 篇 · {intfmt(resultViews)} 阅读 · {intfmt(resultMinutes)} 分钟 · 高热 {hotCount}
            </span>
          </div>

          <SuspenseLoader minHeight={rowHeight * 6} label="文章列表">
            <ResultsList
              views={views}
              starred={starred}
              hotMark={skin.hotMark}
              rowHeight={rowHeight}
              total={rows.length}
              query={query}
              onStar={onStar}
            />
          </SuspenseLoader>
        </div>

        <aside className="side" aria-label="侧栏">
          <section className="panel" data-testid="tags">
            <h2>标签</h2>
            <div className="toolbar">
              {tagStats.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  className="chip"
                  data-testid={`tag-${t.tag}`}
                  aria-pressed={prefs.tag === t.tag}
                  onClick={() => setTag(prefs.tag === t.tag ? 'all' : t.tag)}
                >
                  {TAG_LABEL[t.tag]} {t.count}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>收藏</h2>
            <p data-testid="star-count">
              {starred.size} 篇已标记 · 只存在这台设备的浏览器里
            </p>
            <button type="button" className="btn ghost" data-testid="clear-stars" onClick={clearStars} disabled={starred.size === 0}>
              清空收藏
            </button>
          </section>

          <section className="panel">
            <h2>全站读数</h2>
            <p className="state">按需加载：不看就不取数、不下载图组件。</p>
            <button
              type="button"
              className="btn"
              data-testid="insights-toggle"
              aria-expanded={panelOpen}
              onPointerEnter={preloadInsights}
              onClick={() => setPanelOpen((v) => !v)}
            >
              {panelOpen ? '收起读数' : '展开读数'}
            </button>
            {panelOpen ? (
              <SuspenseLoader minHeight={168} label="全站读数">
                <InsightsPanel />
              </SuspenseLoader>
            ) : null}
          </section>
        </aside>
      </div>
    </>
  );
}

export default PostHome;
