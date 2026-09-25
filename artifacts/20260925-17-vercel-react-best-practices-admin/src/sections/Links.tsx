import { useDeferredValue, useMemo, useReducer, useRef, useState } from 'react';
import type { Link } from '../data/dataset';
import { fmtInt, fmtDate, copyText } from '../lib/format';
import { StatusPill, useTwoStep, actButtonLabel } from '../components/shared';
import { cn } from '../types';

type SortKey = 'clicks' | 'createdAt' | 'slug';
type FilterKey = 'all' | 'active' | 'paused';

interface LinksState {
  rows: Link[];
  q: string;
  sort: SortKey;
  filter: FilterKey;
  expandedId: number | null;
}

type LinksAction =
  | { type: 'q'; q: string }
  | { type: 'sort'; sort: SortKey }
  | { type: 'filter'; filter: FilterKey }
  | { type: 'toggle'; id: number }
  | { type: 'expand'; id: number | null }
  | { type: 'remove'; id: number };

// rerender-functional-setstate: reducer 保证回调稳定，不依赖闭包中的旧 state
function linksReducer(s: LinksState, a: LinksAction): LinksState {
  switch (a.type) {
    case 'q':
      return s.q === a.q ? s : { ...s, q: a.q };
    case 'sort':
      return { ...s, sort: a.sort };
    case 'filter':
      return { ...s, filter: a.filter };
    case 'toggle':
      return { ...s, rows: s.rows.map((r) => (r.id === a.id ? { ...r, paused: !r.paused } : r)) };
    case 'expand':
      return { ...s, expandedId: s.expandedId === a.id ? null : a.id };
    case 'remove':
      return { ...s, rows: s.rows.filter((r) => r.id !== a.id), expandedId: s.expandedId === a.id ? null : s.expandedId };
  }
}

export function LinksSection({ initial, onToast }: { initial: Link[]; onToast: (m: string) => void }) {
  const [state, dispatch] = useReducer(linksReducer, {
    rows: initial,
    q: '',
    sort: 'clicks',
    filter: 'all',
    expandedId: null,
  });
  // js-index-maps: 构建 owner -> 条数 的 Map，替代每行 O(n) 查找
  const ownerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of state.rows) m.set(r.owner, (m.get(r.owner) ?? 0) + 1);
    return m;
  }, [state.rows]);

  // rerender-transitions + useDeferredValue: 输入框保持即时响应，过滤降级为非紧急更新
  const deferredQ = useDeferredValue(state.q);
  const staleSearch = deferredQ !== state.q;

  const visible = useMemo(() => {
    const q = deferredQ.trim().toLowerCase();
    const out: Link[] = [];
    // js-combine-iterations: 一次循环完成过滤，不链式 filter+filter
    for (const r of state.rows) {
      if (state.filter === 'active' && r.paused) continue;
      if (state.filter === 'paused' && !r.paused) continue;
      if (q !== '' && !r.slug.toLowerCase().includes(q) && !r.target.toLowerCase().includes(q)) continue;
      out.push(r);
    }
    // js-tosorted-immutable: 不改动 state.rows 原数组
    return out.toSorted((a, b) => {
      if (state.sort === 'clicks') return b.clicks - a.clicks;
      if (state.sort === 'createdAt') return b.createdAt - a.createdAt;
      return a.slug.localeCompare(b.slug);
    });
  }, [state.rows, state.filter, state.sort, deferredQ]);

  const totalShownClicks = useMemo(() => visible.reduce((acc, r) => acc + r.clicks, 0), [visible]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const copyGuard = useRef(0);

  const onCopy = (r: Link) => {
    const now = Date.now();
    if (now - copyGuard.current < 300) return;
    copyGuard.current = now;
    setBusyId(r.id);
    void copyText(`https://bcn.example/${r.slug}`).then((ok) => {
      setBusyId(null);
      onToast(ok ? `已复制 r/${r.slug} 的短链地址` : '剪贴板不可用，请手动复制');
    });
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <label className="search">
          <span className="search-icon" aria-hidden="true">#</span>
          <input
            value={state.q}
            placeholder="搜索短链码或目标地址…"
            onChange={(e) => dispatch({ type: 'q', q: e.target.value })}
          />
        </label>
        <div className="seg" role="group" aria-label="状态筛选">
          {(['all', 'active', 'paused'] as const).map((f) => (
            <button key={f} type="button" className={cn('seg-btn', state.filter === f && 'seg-btn--on')} onClick={() => dispatch({ type: 'filter', filter: f })}>
              {f === 'all' ? '全部' : f === 'active' ? '活跃' : '停用'}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="排序">
          {([['clicks', '按点击'], ['createdAt', '按创建'], ['slug', '按短链码']] as const).map(([k, label]) => (
            <button key={k} type="button" className={cn('seg-btn', state.sort === k && 'seg-btn--on')} onClick={() => dispatch({ type: 'sort', sort: k })}>
              {label}
            </button>
          ))}
        </div>
        <span className={cn('toolbar-note', staleSearch && 'toolbar-note--stale')}>
          {visible.length} 条 · 合计 {fmtInt(totalShownClicks)} 次点击{staleSearch ? ' · 正在过滤…' : ''}
        </span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>短链</th>
            <th>目标地址</th>
            <th>创建者</th>
            <th className="num">点击</th>
            <th>最近访问</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {visible.length > 0 ? (
            visible.map((r) => (
              <Row
                key={r.id}
                row={r}
                ownerCount={ownerCounts.get(r.owner) ?? 0}
                expanded={state.expandedId === r.id}
                copying={busyId === r.id}
                onExpand={() => dispatch({ type: 'expand', id: r.id })}
                onCopy={() => onCopy(r)}
                onToggle={() => {
                  dispatch({ type: 'toggle', id: r.id });
                  onToast(r.paused ? `已启用 r/${r.slug}` : `已停用 r/${r.slug}`);
                }}
                onRemove={() => {
                  dispatch({ type: 'remove', id: r.id });
                  onToast(`已删除 r/${r.slug}`);
                }}
              />
            ))
          ) : (
            <tr>
              <td colSpan={7} className="table-empty">
                没有匹配「{deferredQ}」的短链
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, ownerCount, expanded, copying, onExpand, onCopy, onToggle, onRemove }: {
  row: Link;
  ownerCount: number;
  expanded: boolean;
  copying: boolean;
  onExpand: () => void;
  onCopy: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [confirmClick, pending, cancelPending] = useTwoStep(onRemove);
  return (
    <>
      <tr className={cn('row', expanded && 'row--on')} data-slug={row.slug} data-pending={String(pending)} onClick={onExpand}>
        <td className="mono">r/{row.slug}</td>
        <td className="truncate" title={row.target}>{row.target}</td>
        <td>{row.owner}</td>
        <td className="num">{fmtInt(row.clicks)}</td>
        <td>{fmtDate(row.lastClickAt)}</td>
        <td><StatusPill paused={row.paused} /></td>
        <td>
          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn--ghost" onClick={onCopy}>{copying ? '复制中…' : '复制'}</button>
            <button type="button" className="btn btn--ghost" onClick={onToggle}>{row.paused ? '启用' : '停用'}</button>
            {pending !== 0 ? (
              <button type="button" className="btn btn--danger" onClick={confirmClick}>{actButtonLabel(true, '删除')}</button>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={confirmClick}>删除</button>
            )}
            {pending !== 0 ? <button type="button" className="btn btn--ghost" onClick={cancelPending}>取消</button> : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="detail">
          <td colSpan={7}>
            <dl className="detail-grid">
              <div><dt>创建时间</dt><dd>{fmtDate(row.createdAt)}</dd></div>
              <div><dt>同创建者短链数</dt><dd>{ownerCount} 条（{row.owner}）</dd></div>
              <div><dt>完整地址</dt><dd className="mono">{row.target}</dd></div>
              <div><dt>备注</dt><dd>{row.note !== '' ? row.note : '无'}</dd></div>
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}
