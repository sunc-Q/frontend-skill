import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';
import { usePostsQuery } from '~features/posts/hooks/usePostsQuery';
import { countRender } from '@/lib/counter';
import { intfmt } from '@/lib/facts';
import { buildArchive } from '../helpers/archiveModel';

/**
 * Archive: the second route that needs data, and it needs none of its own — the list payload is
 * already in the query cache. `resetReqLog()` before navigating here is what turns the skill's
 * "Cache-first strategy" clause into a counted fact (group G) instead of a comment.
 */
export function ArchivePage(): ReactElement {
  countRender('page');
  const { rows } = usePostsQuery();
  const years = useMemo(() => buildArchive(rows), [rows]);
  const [openYear, setOpenYear] = useState<number | null>(years[0]?.year ?? null);

  return (
    <>
      <div className="cols">
        <div>
          <section className="hero" data-testid="archive-hero">
            <p className="kicker">按月份归档 · 零额外请求</p>
            <h2>{intfmt(rows.length)} 篇 · {years.length} 个年份 · {new Set(rows.map((r) => r.day)).size} 个不同发布日</h2>
            <p className="summary">
              这张表和首页读的是同一份缓存：数据只取一次，两处读数因此必然一致（断言 E 组逐项对账）。
            </p>
          </section>
          <SuspenseLoader minHeight={240} label="归档表">
            <table className="datatable" data-testid="archive-table">
              <caption className="state">点击年份展开该年的月度读数</caption>
              <thead>
                <tr>
                  <th scope="col">区间</th>
                  <th scope="col">篇数</th>
                  <th scope="col">阅读</th>
                  <th scope="col">分钟</th>
                  <th scope="col">最快一篇</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <Fragment key={y.year}>
                    <tr data-testid={`year-${y.year}`}>
                      <th scope="row">
                        <button type="button" className="chip" aria-expanded={openYear === y.year} data-testid={`toggle-${y.year}`} onClick={() => setOpenYear(openYear === y.year ? null : y.year)}>
                          {y.year} 年
                        </button>
                      </th>
                      <td>{y.count}</td>
                      <td>{intfmt(y.views)}</td>
                      <td>{intfmt(y.minutes)}</td>
                      <td>{Math.min(...y.months.map((m) => m.fastest))}′</td>
                    </tr>
                    {openYear === y.year
                      ? y.months.map((m) => (
                          <tr key={m.month} data-testid={`month-${m.month}`}>
                            <th scope="row" className="num">{m.month}</th>
                            <td>{m.count}</td>
                            <td>{intfmt(m.views)}</td>
                            <td>{intfmt(m.minutes)}</td>
                            <td>{m.fastest}′</td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </SuspenseLoader>
        </div>
        <aside className="side" aria-label="侧栏">
          <section className="panel">
            <h2>口径</h2>
            <p className="state" data-testid="archive-note">
              「最快一篇」= 该月最短阅读时长；年行取其下各月的最小值。跨月做平均没有解释力，所以这里只放极值与合计。
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

export default ArchivePage;
