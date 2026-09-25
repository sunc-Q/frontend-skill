import { memo } from 'react';
import type { TierId } from '../lib/pricing';
import { TIERS } from '../lib/pricing';
import { FEATURE_GROUPS, FEATURE_ROWS, type FeatureRow } from '../lib/content';

const OWN_TIER: TierId = 'grove';

const YES = (
  <span className="mark-yes" aria-label="支持">
    ✓
  </span>
);
const NO = (
  <span className="mark-no" aria-label="不支持">
    —
  </span>
);

export interface CompareProps {
  readonly groups: ReadonlySet<string>;
  readonly onlyDiff: boolean;
  readonly query: string;
  readonly onToggleGroup: (group: string) => void;
  readonly onOnlyDiff: (next: boolean) => void;
  readonly onQuery: (next: string) => void;
}

export function Compare({ groups, onlyDiff, query, onToggleGroup, onOnlyDiff, onQuery }: CompareProps) {
  const needle = query.trim().toLowerCase();
  // 先看行数再逐行比对，行数为 0 时直接给出空态（js-length-check-first）
  const rows =
    FEATURE_ROWS.length === 0
      ? []
      : FEATURE_ROWS.filter(
          (r) =>
            (groups.size === 0 || groups.has(r.group)) &&
            (!onlyDiff || r.differs) &&
            (needle === '' || r.label.toLowerCase().includes(needle) || r.hint.toLowerCase().includes(needle)),
        );

  return (
    <div className="section" id="compare">
      <div className="shell">
        <div className="section-head">
          <div>
            <p className="eyebrow">逐格核对</p>
            <h2 className="title">三档到底差在哪</h2>
          </div>
          <p className="lede">差异行已标出，「只看差异」会把三档一致的能力折起来。</p>
        </div>

        <div className="compare-tools">
          <button type="button" className="chip" aria-pressed={onlyDiff} data-testid="only-diff" onClick={() => onOnlyDiff(!onlyDiff)}>
            只看差异
          </button>
          {FEATURE_GROUPS.map((group) => (
            <button
              key={group}
              type="button"
              className="chip"
              data-group={group}
              aria-pressed={groups.size === 0 || groups.has(group)}
              onClick={() => onToggleGroup(group)}
            >
              {group}
            </button>
          ))}
          <label className="compare-search">
            <span className="sr-only">搜索能力</span>
            <input
              type="search"
              value={query}
              placeholder="搜能力，如 席位"
              aria-label="在对比表里搜索能力"
              data-testid="compare-input"
              onChange={(event) => onQuery(event.currentTarget.value)}
            />
          </label>
          <span className="addon-note" data-testid="row-count">
            {rows.length} / {FEATURE_ROWS.length} 行
          </span>
        </div>

        <div className="table-wrap" role="table" aria-label="套餐能力对比">
          <div className="crow-head" role="row">
            <span role="columnheader">能力</span>
            {TIERS.map((tier) => (
              <span key={tier.id} role="columnheader">
                {tier.name} {tier.latin}
              </span>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="table-foot" data-testid="compare-empty">
              没有同时满足「{query.trim()} / {groups.size === 0 ? '全部分组' : [...groups].join('、')} /{' '}
              {onlyDiff ? '只看差异' : '全部行'}」的能力。清掉搜索或取消筛选试试。
            </p>
          ) : (
            rows.map((row) => <CompareRow key={row.key} row={row} />)
          )}
        </div>
        <p className="table-foot">
          计数口径：席位只统计能登录后台的内部成员，提交反馈的客户与投票访客不占席位。
        </p>
      </div>
    </div>
  );
}

/** 16 行 × 3 列的单元格；勾选模块或拖滑杆时这些行不必重渲染（rerender-memo，props 是稳定引用）。 */
function CompareRowBase({ row }: { row: FeatureRow }) {
  return (
    <div className="crow" role="row" data-row={row.key}>
      <span className="crow-label" role="rowheader">
        <span>{row.label}</span>
        <span className="crow-hint">{row.hint}</span>
      </span>
      {TIERS.map((tier) => (
        <span key={tier.id} className={'crow-cell' + (tier.id === OWN_TIER ? ' is-own' : '')} role="cell">
          {cellText(row.values[tier.id])}
        </span>
      ))}
    </div>
  );
}

function cellText(value: string | boolean) {
  return typeof value === 'boolean' ? (value ? YES : NO) : <span>{value}</span>;
}

const CompareRow = memo(CompareRowBase);
