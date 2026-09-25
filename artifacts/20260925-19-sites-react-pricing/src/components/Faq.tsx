import { useDeferredValue, useState } from 'react';
import { FAQS } from '../lib/content';

/** 排序键提到模块作用域：toSorted 的比较函数每次渲染新建没有意义。 */
function byPopularity(a: { popularity: number }, b: { popularity: number }): number {
  return b.popularity - a.popularity;
}

const BY_POPULARITY = FAQS.toSorted(byPopularity); // js-tosorted-immutable：不改原始数组

export interface FaqProps {
  readonly query: string;
  readonly onQuery: (next: string) => void;
}

export function Faq({ query, onQuery }: FaqProps) {
  // 输入框保持即时回显，列表用延迟值更新（rendering-usetransition-loading 的同一思路）
  const deferred = useDeferredValue(query);
  const [open, setOpen] = useState<string | null>(null);
  const trimmed = deferred.trim();
  const hits =
    trimmed === ''
      ? BY_POPULARITY
      : BY_POPULARITY.filter((item) => item.q.includes(trimmed) || item.a.includes(trimmed) || item.key.includes(trimmed.toLowerCase()));

  return (
    <div className="section" id="faq">
      <div className="shell">
        <div className="section-head">
          <div>
            <p className="eyebrow">签字前最常问</p>
            <h2 className="title">六个问题，直接答</h2>
          </div>
          <p className="lede">默认按提问热度排序，可搜索问题正文与答案。</p>
        </div>

        <div className="faq-search">
          <label className="sr-only" htmlFor="faq-q">
            搜索问题
          </label>
          <input
            id="faq-q"
            type="search"
            value={query}
            placeholder="席位、发票、迁移…"
            onChange={(event) => onQuery(event.currentTarget.value)}
            data-testid="faq-input"
          />
          <span className="chip" data-testid="faq-count">
            {hits.length} 条
          </span>
        </div>

        {hits.length === 0 ? (
          <p className="faq-empty" data-testid="faq-empty">
            没有匹配「{trimmed}」的条目。换成「席位」「发票」试试，或直接写信给销售。
          </p>
        ) : (
          <ul className="faq-list">
            {hits.map((item) => {
              const expanded = open === item.key;
              return (
                <li className="faq-item" key={item.key} data-faq={item.key}>
                  <button
                    type="button"
                    className="faq-q"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : item.key)}
                  >
                    <span>{item.q}</span>
                    <span className="plus" aria-hidden="true">
                      {expanded ? '−' : '+'}
                    </span>
                  </button>
                  {expanded ? <p className="faq-a">{item.a}</p> : <p className="sr-only">展开后可见答案</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
