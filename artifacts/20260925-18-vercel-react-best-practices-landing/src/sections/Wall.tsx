import { memo, useMemo, useState, useTransition } from 'react';
import type { CSSProperties } from 'react';
import type { PhotoKind } from '../lib/gallery';
import { KIND_LABEL, TOTAL_PHOTOS, buildPhotos, countKept } from '../lib/gallery';
import { Icon, cn } from '../components/ui';

type View = 'raw' | 'sorted';

const FILTERS: Array<PhotoKind | 'all'> = ['all', 'person', 'event', 'blur', 'screenshot'];

const ALBUM_HUE: Record<string, number> = {
  人物: 22,
  事件: 168,
  模糊待清理: 44,
  截图归档: 300,
};

/* rerender-memo: 168 个格子是整页最贵的一块，props 全为基元；
   data-renders 把内部渲染次数暴露出来，供 jsdom 断言「父组件重渲染时它没重渲染」 */
let gridRenders = 0;

const Grid = memo(function Grid({ items, counts, view }: { items: string; counts: string; view: View }) {
  gridRenders += 1;
  const cells = useMemo(() => JSON.parse(items) as Array<{ id: string; kind: PhotoKind; span: 1 | 2; hue: number }>, [items]);
  const n = JSON.parse(counts) as Record<PhotoKind | 'all', number>;

  if (view === 'sorted') {
    return (
      <div className="albums" data-albums data-renders={gridRenders}>
        {Object.keys(ALBUM_HUE).map((name) => {
          const key = name === '模糊待清理' ? 'blur' : name === '截图归档' ? 'screenshot' : name === '人物' ? 'person' : 'event';
          return (
            <div className="album" key={name} data-album={name}>
              <span className="album-cover" style={{ '--h': String(ALBUM_HUE[name] ?? 0) } as CSSProperties} />
              <span className="album-name">{name}</span>
              <span className="album-n">{n[key]}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="wall" data-wall data-renders={gridRenders}>
      {cells.map((p) => (
        <span
          key={p.id}
          className={cn('cell', `cell--${p.kind}`, p.span === 2 && 'cell--wide')}
          data-kind={p.kind}
          style={{ '--h': String(p.hue) } as CSSProperties}
        />
      ))}
    </div>
  );
});

export function Wall() {
  /* rerender-lazy-state-init: 168 条种子数据只在首次挂载时构造一次 */
  const [data] = useState(buildPhotos);
  /* js-index-maps: 一次遍历建分类计数表，并序列化成基元字符串——
     memo 的 props 由此全是基元值，比较代价为零 */
  const counts = useMemo(() => {
    const m: Record<PhotoKind | 'all', number> = { all: data.photos.length, person: 0, event: 0, blur: 0, screenshot: 0 };
    for (const q of data.photos) m[q.kind] += 1;
    return JSON.stringify(m);
  }, [data]);
  const [view, setView] = useState<View>('raw');
  /* rendering-usetransition-loading: 重排状态用 useTransition 自带的 isPending，
     不自己 setPending(true/false)（上一轮我自己写的反模式） */
  const [isPending, startSwitch] = useTransition();
  const [filter, setFilter] = useState<PhotoKind | 'all'>('all');
  const [tick, setTick] = useState(0);

  /* js-set-map-lookups: 「保留哪些分类」用 Set 做 O(1) 判断，序列化成基元 props */
  const items = useMemo(() => {
    if (filter === 'all') return JSON.stringify(data.photos);
    const keep = new Set<PhotoKind>([filter]);
    return JSON.stringify(data.photos.filter((p) => keep.has(p.kind)));
  }, [data, filter]);

  const kept = useMemo(() => countKept(data.photos), [data]);
  const n = JSON.parse(counts) as Record<PhotoKind | 'all', number>;

  const switchView = (next: View) => {
    // rerender-transitions: 重排 168 格不是紧急更新，包进 transition 保证点击手感
    startSwitch(() => setView(next));
  };

  return (
    <section className="section section--wall" id="wall-demo">
      <div className="wall-head">
        <h2 className="section-title">一坨年份堆变成相册的过程</h2>
        <p className="wall-note">
          下面是 {TOTAL_PHOTOS} 张虚构照片（种子固定，三页数据完全一致）。整理后值得留 {kept} 张，其余归档不删除。
        </p>
      </div>

      <div className="wall-tools" role="group" aria-label="切换与筛选">
        <div className="seg" data-seg>
          <button
            type="button"
            className={cn('seg-b', view === 'raw' && 'seg-b--on')}
            data-view="raw"
            onClick={() => switchView('raw')}
          >
            整理前
          </button>
          <button
            type="button"
            className={cn('seg-b', view === 'sorted' && 'seg-b--on')}
            data-view="sorted"
            onClick={() => switchView('sorted')}
          >
            整理后
          </button>
        </div>
        <span className="wall-pending" data-pending={String(isPending)}>
          {isPending ? '重排中…' : ''}
        </span>
        <div className="chips" data-chips>
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f}
              className={cn('chip', filter === f && 'chip--on')}
              data-filter={f}
              disabled={view !== 'raw'}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : KIND_LABEL[f]}
              <span className="chip-n">{n[f]}</span>
            </button>
          ))}
        </div>
        {/* 只改这个计数器：Wall 自身重渲染，但 Grid 的 props 没变，memo 应挡住 */}
        <button type="button" className="btn btn--ghost btn--sm" data-parent-tick onClick={() => setTick((t) => t + 1)}>
          父组件重渲染 <span data-tick>{tick}</span>
        </button>
      </div>

      <Grid items={items} counts={counts} view={view} />

      <p className="wall-hint">
        <Icon name="arrow" size={14} />
        网格内部渲染次数：<span data-renders-hint>{gridRenders}</span>（点上面「父组件重渲染」不应让它增长）
      </p>
    </section>
  );
}
