import { useDeferredValue, useMemo, useState } from 'react';
import { FAQS } from '../lib/content';
import { cn } from '../components/ui';

export function Questions() {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  /* rerender-transitions: 搜索框输入是紧急更新，列表重排不是 */
  const deferred = useDeferredValue(query);
  const stale = deferred !== query;

  /* rerender-derived-state-no-effect + js-combine-iterations：
     一次遍历同时得出命中列表和命中总数，不在 effect 里再 setState */
  const hits = useMemo(() => {
    const q = deferred.trim();
    if (q === '') return FAQS;
    const out = [];
    for (const f of FAQS) {
      if (f.q.includes(q) || f.a.includes(q)) out.push(f);
    }
    return out;
  }, [deferred]);

  const toggle = (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
  };

  return (
    <section id="faq" className="section">
      <div className="sec-head">
        <h2 className="section-title">被问得最多的几件事</h2>
        <div className="search">
          <input
            type="search"
            className="search-i"
            data-faq-search
            placeholder="搜问题，例如「格式」「收费」"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="search-n" data-faq-count>
            {hits.length}
          </span>
          <span className="search-stale" data-stale={String(stale)}>
            {stale ? '筛选中…' : ''}
          </span>
        </div>
      </div>

      <dl className="faqs" data-faqs>
        {hits.length > 0
          ? hits.map((f) => {
              const on = openId === f.id;
              return (
                <div className={cn('faq', on && 'faq--on')} key={f.id} data-faq={f.id}>
                  <dt>
                    <button
                      type="button"
                      className="faq-q"
                      aria-expanded={on}
                      onClick={() => toggle(f.id)}
                    >
                      <span>{f.q}</span>
                      <span className="faq-mark">{on ? '−' : '+'}</span>
                    </button>
                  </dt>
                  <dd className="faq-a">{f.a}</dd>
                </div>
              );
            })
          : <p className="empty">没有匹配「{deferred}」的问答。</p>}
      </dl>
    </section>
  );
}
