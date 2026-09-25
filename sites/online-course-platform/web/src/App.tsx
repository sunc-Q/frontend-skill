import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  cny,
  cnyCompact,
  COURSE_STATUS_LABEL,
  dateOnly,
  dateTime,
  daysUntil,
  ENROLL_STATUS_LABEL,
  sign,
  SOURCE_LABEL,
} from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  CourseDetail,
  CourseRow,
  DomainRollup,
  EnrollmentRow,
  InstructorRow,
  ListParams,
  SortDir,
  SortKey,
  Stats,
} from './types';

const TOKEN_KEY = 'biz-site-admin-token';

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<string>(() => initialTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  const [token, setToken] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [token]);

  const stats = useAsync<Stats>(() => api.stats(), []);
  const instructors = useAsync(() => api.instructors(), []);

  const [filters, setFilters] = useState<ListParams>({ sort: 'fill', dir: 'desc', page_size: 12 });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.courses({ ...filters, page, page_size: filters.page_size ?? 12 }),
    [filters.domain, filters.level, filters.q, filters.early, filters.sort, filters.dir, page, filters.page_size],
  );

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const detail = useAsync<CourseDetail | null>(
    () => (selectedCode === null ? Promise.resolve(null) : api.course(selectedCode)),
    [selectedCode, selectedCode === null ? 0 : (list.data?.items.length ?? 0) + ':' + String(list.loading)],
  );

  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (selectedCode === null && rows.length > 0) setSelectedCode(rows[0]?.code ?? null);
  }, [rows, selectedCode]);

  const totalRows = list.data?.total ?? 0;
  const pageSize = filters.page_size ?? 12;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">学阶公开课</span>
          <span className="brand-sub">Stepwise Course Platform</span>
        </div>

        <nav className="themes" aria-label="界面风格">
          <span className="field-label">风格</span>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="theme-btn"
              data-active={t.id === theme ? 'true' : 'false'}
              onClick={() => setTheme(t.id)}
              title={t.mood}
            >
              <span className="theme-icon" aria-hidden="true">
                <Swatch theme={t.id} />
              </span>
              <span className="theme-text">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="tokenbox">
          <label className="field-label" htmlFor="admin-token">
            管理令牌
          </label>
          <input
            id="admin-token"
            className="input"
            type="password"
            autoComplete="off"
            placeholder="ADMIN_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
      </header>

      <div className="statusline">
        <p className="lede">
          同一套接口与页面骨架，三种互不相同的视觉主张。数据全部来自 Go/Gin + SQLite 后端：
          <b>早鸟价按截止日、老学员 95 折按历史生效报名数</b>，价格与余位全部后端判定，满座自动转候补且候补不扣费。
        </p>
        <p className="stamp">
          数据快照 {stats.data ? dateTime(stats.data.generated_at) : '加载中'} · {stats.data?.window ?? ''}
        </p>
      </div>

      <Banner state={stats} label="看板接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">招生看板</h2>
            <span className="section-note">GMV 只含已生效报名的实付金额</span>
          </div>
          <KpiGrid s={stats.data} />

          <div className="section-head">
            <h2 className="section-title">课程目录</h2>
            <span className="section-note">
              第 {page} / {pages} 页 · 共 {totalRows} 门在售课
            </span>
          </div>
          <Filters
            value={filters}
            page={page}
            domains={stats.data?.by_domain ?? []}
            onChange={(next) => {
              setFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setPage(1);
            }}
            onPage={setPage}
          />
          <Banner state={list} label="课程列表" />
          <CourseTable
            rows={rows}
            loading={list.loading}
            sort={filters.sort ?? 'fill'}
            dir={filters.dir ?? 'desc'}
            selectedCode={selectedCode}
            onSort={(sort) => {
              const dir: SortDir = filters.sort === sort && filters.dir === 'desc' ? 'asc' : 'desc';
              setFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(code) => setSelectedCode(code)}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">领域结构</h2>
            <span className="section-note">按 GMV 排序</span>
          </div>
          <DomainBars rollup={stats.data?.by_domain ?? []} gmv={stats.data?.gmv_cents ?? 0} />
          <div className="section-head">
            <h2 className="section-title">月度报名</h2>
            <span className="section-note">报名 / 实收（条）</span>
          </div>
          <TrendTable monthly={stats.data?.monthly ?? []} />
          <div className="section-head">
            <h2 className="section-title">讲师榜</h2>
            <span className="section-note">按在读 + 结课学员数</span>
          </div>
          <InstructorTable items={instructors.data?.items ?? []} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">课程详情</h2>
            <span className="section-note">{selectedCode ?? '未选择'}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <DetailPanel state={detail} />
        </div>
        <div className="detail-side">
          <EnrollForm
            token={token}
            course={detail.data?.course ?? null}
            onDone={() => {
              detail.reload();
              list.reload();
              stats.reload();
            }}
          />
        </div>
      </section>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">运营动作</h2>
          <span className="section-note">写接口需 ADMIN_TOKEN；校验失败会逐字段回显</span>
        </div>
        <div className="ops-forms">
          <ProgressForm
            token={token}
            enrollment={detail.data?.recent_enrollments[0] ?? null}
            onDone={() => {
              detail.reload();
              stats.reload();
            }}
          />
          <StatusForm
            token={token}
            courseCode={selectedCode}
            onDone={() => {
              list.reload();
              detail.reload();
              stats.reload();
            }}
          />
        </div>
        <p className="footnote">
          接口：GET /api/health · /api/stats · /api/courses · /api/courses/&#123;code&#125; · /api/instructors ·
          POST /api/admin/enrollments · /api/admin/enrollments/&#123;id&#125;/progress · /api/admin/courses/&#123;code&#125;/status。
          当前讲师数：{instructors.data?.total ?? 0}。
        </p>
      </footer>
    </div>
  );
}

export function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  return <style data-theme-css={theme}>{themeCss(theme)}</style>;
}

function Banner({ state, label }: { state: { loading: boolean; error: string | null }; label: string }): React.JSX.Element | null {
  if (state.error === null) return null;
  return (
    <p className="banner" role="status">
      <span className="banner-tag">{label}</span>
      {state.loading ? '重试中… ' : ''}
      {state.error}
    </p>
  );
}

const KPI_KEYS: readonly string[] = [
  'gmv_cents',
  'published_courses',
  'paying_learners',
  'fill_pct',
  'completed_count',
  'waitlisted_count',
  'discount_total',
  'dropped_count',
  'completion_rate_pct',
  'total_courses',
];

const KPI_LABEL: Record<string, string> = {
  gmv_cents: '累计实收',
  published_courses: '在售课程',
  paying_learners: '付费学员',
  fill_pct: '整体满座率',
  completed_count: '累计结课',
  waitlisted_count: '候补人次',
  discount_total: '老学员让利',
  dropped_count: '退课人次',
  completion_rate_pct: '结课率',
  total_courses: '课程总数',
};

const KPI_HINT: Record<string, string> = {
  gmv_cents: 'active + completed 的实付合计',
  paying_learners: '在读 + 已结课（含跨课重复）',
  fill_pct: '占座人次 ÷ 在售课容量',
  completion_rate_pct: '结课 ÷（在读 + 结课）',
  waitlisted_count: '满座课未扣费的排队人次',
};

function KpiGrid({ s }: { s: Stats | null }): React.JSX.Element {
  return (
    <div className="kpis">
      {KPI_KEYS.map((key) => {
        const raw = s === null ? 0 : Number(s[key as keyof Stats] ?? 0);
        const text =
          s === null
            ? '—'
            : key === 'gmv_cents' || key === 'discount_total'
              ? cnyCompact(raw)
              : key === 'fill_pct'
                ? `${raw}%`
                : key === 'completion_rate_pct'
                  ? `${raw.toFixed(1)}%`
                  : raw.toLocaleString('en-US');
        return (
          <article className="kpi" key={key}>
            <h3 className="kpi-label">{KPI_LABEL[key] ?? key}</h3>
            <p className="kpi-value">{text}</p>
            <p className="kpi-hint">{KPI_HINT[key] ?? '实时统计'}</p>
          </article>
        );
      })}
    </div>
  );
}

function Filters({
  value,
  page,
  domains,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  domains: DomainRollup[];
  onChange: (next: { next: Partial<ListParams>; resetPage: boolean }) => void;
  onPage: (p: number) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState(value.q ?? '');

  useEffect(() => {
    if (search === (value.q ?? '')) return;
    const id = window.setTimeout(() => onChange({ next: { q: search }, resetPage: true }), 320);
    return () => window.clearTimeout(id);
  }, [search, value.q, onChange]);

  return (
    <div className="filters">
      <label className="field">
        <span className="field-label">领域</span>
        <select
          className="input"
          value={value.domain ?? ''}
          onChange={(e) => onChange({ next: { domain: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {domains.map((d) => (
            <option key={d.domain} value={d.domain}>
              {d.domain}（{d.courses}）
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">难度</span>
        <select
          className="input"
          value={value.level ?? ''}
          onChange={(e) => onChange({ next: { level: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          <option value="入门">入门</option>
          <option value="进阶">进阶</option>
          <option value="高级">高级</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">每页</span>
        <select
          className="input"
          value={String(value.page_size ?? 12)}
          onChange={(e) => onChange({ next: { page_size: Number(e.target.value) }, resetPage: true })}
        >
          {[8, 12, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-check">
        <span className="field-label">早鸟</span>
        <input
          className="check"
          type="checkbox"
          checked={value.early === '1'}
          onChange={(e) => onChange({ next: { early: e.target.checked ? '1' : '' }, resetPage: true })}
        />
      </label>
      <label className="field field-wide">
        <span className="field-label">搜索</span>
        <input
          className="input"
          type="search"
          value={search}
          maxLength={64}
          placeholder="课程名 / 标识 / 讲师（服务端转义 LIKE）"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="pager">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <span className="pager-now">{page}</span>
        <button type="button" className="btn" onClick={() => onPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

const COLUMNS: readonly { key: string; label: string; sort?: SortKey; numeric?: boolean }[] = [
  { key: 'code', label: '标识' },
  { key: 'course', label: '课程' },
  { key: 'instructor', label: '讲师' },
  { key: 'level', label: '难度' },
  { key: 'hours', label: '学时', sort: 'hours', numeric: true },
  { key: 'price', label: '现价', sort: 'price', numeric: true },
  { key: 'seats', label: '席位', sort: 'occupied', numeric: true },
  { key: 'fill', label: '满座率', sort: 'fill', numeric: true },
];

function CourseTable({
  rows,
  loading,
  sort,
  dir,
  selectedCode,
  onSort,
  onPick,
}: {
  rows: CourseRow[];
  loading: boolean;
  sort: SortKey;
  dir: SortDir;
  selectedCode: string | null;
  onSort: (key: SortKey) => void;
  onPick: (code: string) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">课程目录：点击行查看大纲与报名入口</caption>
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const key = col.sort;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={col.numeric ? 'num' : undefined}
                  aria-sort={key !== undefined && key === sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {key === undefined ? (
                    col.label
                  ) : (
                    <button
                      type="button"
                      className="sortbtn"
                      data-on={key === sort ? 'true' : 'false'}
                      onClick={() => onSort(key)}
                    >
                      <span>{col.label}</span>
                      <span className="sortmark" aria-hidden="true">
                        {key === sort ? (dir === 'asc' ? '▲' : '▼') : '·'}
                      </span>
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="empty" colSpan={COLUMNS.length}>
                没有符合条件的课程，试试放宽筛选条件
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr
              key={r.code}
              data-active={r.code === selectedCode ? 'true' : 'false'}
              onClick={() => onPick(r.code)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(r.code);
                }
              }}
            >
              <td className="mono">{r.code}</td>
              <td>
                <span className="cell-strong">{r.title}</span>
                <span className="cell-sub">{r.summary}</span>
                {r.early_now && r.early_deadline !== null ? (
                  <span className="badge" data-status="early">
                    早鸟剩 {Math.max(0, daysUntil(r.early_deadline))} 天
                  </span>
                ) : null}
              </td>
              <td>{r.instructor_name}</td>
              <td>{r.level}</td>
              <td className="num mono">{r.hours}h</td>
              <td className="num mono">
                <span data-on={r.early_now ? 'true' : 'false'}>{cny(r.effective_price)}</span>
                {r.early_now ? <span className="strike">{cny(r.price_cents)}</span> : null}
              </td>
              <td className="num mono">
                {r.occupied}/{r.capacity}
                {r.waitlisted > 0 ? <span className="cell-sub">候补 {r.waitlisted}</span> : null}
              </td>
              <td className="num">
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.min(100, Math.max(2, r.fill_pct))}%` }} />
                </span>
                <span className="cell-sub">{r.fill_pct}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DomainBars({ rollup, gmv }: { rollup: DomainRollup[]; gmv: number }): React.JSX.Element {
  const sorted = useMemo(() => [...rollup].sort((a, b) => b.gmv_cents - a.gmv_cents), [rollup]);
  const max = sorted[0]?.gmv_cents ?? 1;
  return (
    <ul className="bars">
      {sorted.map((d) => (
        <li className="bar" key={d.domain}>
          <span className="bar-head">
            <span className="bar-name">{d.domain}</span>
            <span className="bar-value">{cnyCompact(d.gmv_cents)}</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((d.gmv_cents / max) * 100))}%` }} />
          </span>
          <span className="bar-foot">
            {d.courses} 门课 · 满座率 {d.fill_pct}% · 占 GMV {gmv > 0 ? ((d.gmv_cents / gmv) * 100).toFixed(1) : '0.0'}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrendTable({ monthly }: { monthly: Stats['monthly'] }): React.JSX.Element {
  const max = monthly.reduce((acc, p) => Math.max(acc, p.enrolls, p.completed), 1);
  return (
    <table className="table mini plain">
      <caption className="caption">月度报名与实收</caption>
      <thead>
        <tr>
          <th scope="col">月份</th>
          <th scope="col">报名</th>
          <th scope="col">结课</th>
          <th scope="col">实收</th>
          <th scope="col">走势</th>
        </tr>
      </thead>
      <tbody>
        {monthly.map((p) => (
          <tr key={p.month}>
            <td className="mono">{p.month}</td>
            <td className="num mono">{p.enrolls}</td>
            <td className="num mono">{p.completed}</td>
            <td className="num mono">{cnyCompact(p.revenue)}</td>
            <td>
              <span className="spark">
                <span className="spark-add" style={{ width: `${(p.enrolls / max) * 100}%` }} />
                <span className="spark-cut" style={{ width: `${(p.completed / max) * 100}%` }} />
              </span>
              <span className="cell-sub">{sign(p.enrolls - p.completed)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InstructorTable({ items }: { items: InstructorRow[] }): React.JSX.Element {
  return (
    <table className="table mini plain">
      <caption className="caption">讲师概览（全部课程口径）</caption>
      <thead>
        <tr>
          <th scope="col">讲师</th>
          <th scope="col">主讲</th>
          <th scope="col">在售</th>
          <th scope="col">学员</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td>
              <span className="cell-strong">{i.name}</span>
              <span className="cell-sub">{i.org}</span>
            </td>
            <td className="num mono">{i.course_count}</td>
            <td className="num mono">{i.published_count}</td>
            <td className="num mono">{i.learner_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailPanel({ state }: { state: { data: CourseDetail | null; loading: boolean } }): React.JSX.Element {
  const d = state.data;
  if (d === null) {
    return <p className="placeholder">{state.loading ? '正在读取详情…' : '在目录中选择一门课程查看大纲与报名。'}</p>;
  }
  const c = d.course;
  const facts: readonly { label: string; value: string }[] = [
    { label: '领域 / 难度', value: `${c.domain} · ${c.level}` },
    { label: '讲师', value: `${d.instructor.name}（${d.instructor.title} · ${d.instructor.org}）` },
    { label: '学时 / 章节', value: `${c.hours} 小时 · ${d.chapters.length} 章` },
    { label: '标价', value: cny(c.price_cents) },
    { label: '现价', value: c.early_now ? `${cny(c.effective_price)}（早鸟，截止 ${dateOnly(c.early_deadline)}）` : cny(c.effective_price) },
    { label: '席位', value: `已占 ${c.occupied} / 容量 ${c.capacity} · 余 ${c.seats_left}${c.waitlisted > 0 ? ` · 候补 ${c.waitlisted}` : ''}` },
    { label: '上架日', value: dateOnly(c.published_at) },
    { label: '状态', value: COURSE_STATUS_LABEL[c.status] ?? c.status },
  ];
  const totalMin = d.chapters.reduce((acc, ch) => acc + ch.duration_min, 0);
  return (
    <>
      <p className="detail-title">
        {c.title} <span className="mono">{c.code}</span>
      </p>
      <p className="detail-summary">{c.summary}</p>
      <dl className="facts">
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <table className="table mini plain">
        <caption className="caption">课程大纲（合计 {Math.round(totalMin / 60)} 小时）</caption>
        <thead>
          <tr>
            <th scope="col">章节</th>
            <th scope="col">标题</th>
            <th scope="col" className="num">
              时长
            </th>
            <th scope="col">试看</th>
          </tr>
        </thead>
        <tbody>
          {d.chapters.map((ch) => (
            <tr key={ch.id}>
              <td className="mono">{String(ch.seq).padStart(2, '0')}</td>
              <td>{ch.title}</td>
              <td className="num mono">{ch.duration_min}′</td>
              <td>{ch.free_preview ? <span className="badge" data-status="free">免费</span> : <span className="cell-sub">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="table mini plain">
        <caption className="caption">最近报名（手机号已脱敏，共 {d.recent_enrollments.length} 条样本）</caption>
        <thead>
          <tr>
            <th scope="col">学员</th>
            <th scope="col">状态</th>
            <th scope="col">进度</th>
            <th scope="col" className="num">
              实付
            </th>
            <th scope="col">渠道</th>
            <th scope="col">报名日</th>
          </tr>
        </thead>
        <tbody>
          {d.recent_enrollments.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
                还没有报名记录
              </td>
            </tr>
          ) : null}
          {d.recent_enrollments.map((e) => (
            <tr key={e.id}>
              <td>
                <span className="cell-strong">{e.learner_name}</span>
                <span className="cell-sub mono">#{e.id} {e.masked_phone}</span>
              </td>
              <td>
                <span className="badge" data-status={e.status}>
                  {ENROLL_STATUS_LABEL[e.status] ?? e.status}
                </span>
              </td>
              <td>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.max(2, e.progress_pct)}%` }} />
                </span>
                <span className="cell-sub">{e.progress_pct}%</span>
              </td>
              <td className="num mono">
                {e.status === 'waitlist' ? '候补未扣费' : cny(e.paid_cents)}
                {e.discount > 0 ? <span className="cell-sub">立减 {cny(e.discount)}</span> : null}
              </td>
              <td>{SOURCE_LABEL[e.source] ?? e.source}</td>
              <td className="mono">{dateOnly(e.enrolled_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function EnrollForm({
  token,
  course,
  onDone,
}: {
  token: string;
  course: CourseRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('official');

  useEffect(() => {
    action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.code]);

  const full = course !== null && course.seats_left <= 0;
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (course === null) return;
        action.run(async () => {
          await api.enroll(token, { course_code: course.code, name: name.trim(), phone: phone.trim(), source });
          setName('');
          setPhone('');
          onDone();
        });
      }}
    >
      <h3 className="form-title">报名占座</h3>
      <p className="form-note">
        {course === null ? '未选择课程' : `${course.title} · ${course.code}`}
        {course !== null && course.early_now ? `（早鸟价 ${cny(course.effective_price)}）` : ''}
        {full ? ' · 名额已满，提交将进入候补队列且不扣费' : ''}
      </p>
      <label className="field">
        <span className="field-label">姓名</span>
        <input className="input" value={name} maxLength={32} placeholder="2-32 字" onChange={(e) => setName(e.target.value)} />
        {action.lastError?.fields.name ? <span className="err">{action.lastError.fields.name}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">手机号</span>
        <input className="input" value={phone} maxLength={11} inputMode="numeric" placeholder="11 位大陆号码" onChange={(e) => setPhone(e.target.value)} />
        {action.lastError?.fields.phone ? <span className="err">{action.lastError.fields.phone}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">渠道</span>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {action.lastError?.fields.source ? <span className="err">{action.lastError.fields.source}</span> : null}
      </label>
      {action.lastError?.code === 'unauthorized' || action.lastError?.code === 'forbidden' ? (
        <p className="hint">请在右上角填入正确的管理令牌。</p>
      ) : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={course === null || action.busy || token === ''}>
        {action.busy ? '提交中…' : full ? '进入候补' : '确认报名'}
      </button>
    </form>
  );
}

function ProgressForm({
  token,
  enrollment,
  onDone,
}: {
  token: string;
  enrollment: EnrollmentRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [pct, setPct] = useState('60');
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (enrollment === null) return;
        action.run(async () => {
          await api.progress(token, enrollment.id, Number(pct));
          onDone();
        });
      }}
    >
      <h3 className="form-title">记录学习进度</h3>
      <p className="form-note">
        {enrollment === null
          ? '选中课程后默认取最近一条报名'
          : `#${enrollment.id} ${enrollment.learner_name} ${enrollment.masked_phone} · ${ENROLL_STATUS_LABEL[enrollment.status]}`}
        {enrollment !== null && enrollment.status !== 'active' ? '（非在读状态，后端会返回 409）' : ''}
      </p>
      <label className="field">
        <span className="field-label">进度 %</span>
        <input className="input" type="number" min="0" max="100" step="1" value={pct} onChange={(e) => setPct(e.target.value)} />
        {action.lastError?.fields.progress_pct ? <span className="err">{action.lastError.fields.progress_pct}</span> : null}
      </label>
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={enrollment === null || action.busy || token === ''}>
        {action.busy ? '提交中…' : '提交进度（100% 自动结课）'}
      </button>
    </form>
  );
}

function StatusForm({
  token,
  courseCode,
  onDone,
}: {
  token: string;
  courseCode: string | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [to, setTo] = useState('published');
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (courseCode === null) return;
        action.run(async () => {
          await api.courseStatus(token, courseCode, to);
          onDone();
        });
      }}
    >
      <h3 className="form-title">课程上下架</h3>
      <p className="form-note">
        {courseCode === null ? '未选择课程' : `目标课程：${courseCode}`} · 状态机：draft→published→archived，其余迁移 409
      </p>
      <label className="field">
        <span className="field-label">迁移到</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="published">published（上架）</option>
          <option value="archived">archived（下线）</option>
        </select>
        {action.lastError?.fields.to ? <span className="err">{action.lastError.fields.to}</span> : null}
      </label>
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={courseCode === null || action.busy || token === ''}>
        {action.busy ? '提交中…' : '执行迁移'}
      </button>
    </form>
  );
}
