import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  BOOKING_LABEL,
  CARD_LABEL,
  CATEGORY_LABEL,
  cny,
  cnyCompact,
  dateOnly,
  daysUntil,
  endAt,
  LEVEL_LABEL,
  SESSION_LABEL,
  SOURCE_LABEL,
  stamp,
  timeOnly,
  weekday,
} from './format';
import { initialTheme, persistTheme, Swatch, themeCss, THEMES } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  BookingSource,
  CardType,
  Category,
  CoachLevel,
  CreateBookingInput,
  CreateMemberInput,
  ListParams,
  RosterEntry,
  SessionRow,
  SessionStatus,
  SortDir,
  SortKey,
  Stats,
} from './types';

const TOKEN_KEY = 'fitness-studio-admin-token';
const STATS_SPAN = 7;

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

  const stats = useAsync<Stats>(() => api.stats(STATS_SPAN), []);
  const coaches = useAsync(() => api.classes(), []);

  const [filters, setFilters] = useState<ListParams>({ sort: 'start_at', dir: 'asc', page_size: 14, days: 14 });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.schedule({ ...filters, page, page_size: filters.page_size ?? 14 }),
    [filters.date, filters.days, filters.category, filters.coach, filters.level, filters.status, filters.q, filters.sort, filters.dir, page, filters.page_size],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const detail = useAsync(
    () => (selectedId === null ? Promise.resolve(null) : api.session(selectedId)),
    [selectedId, detailNonce],
  );

  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (selectedId === null && rows.length > 0) setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const totalRows = list.data?.total ?? 0;
  const pageSize = filters.page_size ?? 14;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  const coachNames = useMemo(() => {
    const set = new Set<string>();
    for (const c of coaches.data?.items ?? []) set.add(c.coach);
    return [...set].sort();
  }, [coaches.data]);

  const refreshAll = (): void => {
    list.reload();
    stats.reload();
    setDetailNonce((n) => n + 1);
  };

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">FitLab 城市健身工作室</span>
          <span className="brand-sub">Studio Schedule &amp; Booking</span>
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
          一套课表接口 + 一份 DOM，三种互不相同的视觉主张。所有数字来自 Go/Gin + SQLite 后端的真实查询，
          口径写死后端：<b>满座率 = 已确认人数 ÷ 未取消课节的容量之和</b>，收入只按已开课课节的到座人数计。
        </p>
        <p className="stamp">
          数据快照 {stats.data ? stamp(stats.data.generated_at) : '加载中'} · {stats.data?.window ?? ''}
        </p>
      </div>

      <Banner state={stats} label="指标接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">课表</h2>
            <span className="section-note">
              {list.data ? `自 ${list.data.from} 起 ${list.data.days} 天 · 第 ${page} / ${pages} 页 · 共 ${totalRows} 节` : '加载中'}
            </span>
          </div>
          <Filters
            value={filters}
            page={page}
            coaches={coachNames}
            categories={Object.keys(CATEGORY_LABEL) as Category[]}
            onChange={(next) => {
              setFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setPage(1);
            }}
            onPage={setPage}
          />
          <Banner state={list} label="课表接口" />
          <ScheduleTable
            rows={rows}
            loading={list.loading}
            sort={filters.sort ?? 'start_at'}
            dir={filters.dir ?? 'asc'}
            selectedId={selectedId}
            onSort={(sort) => {
              const dir: SortDir = filters.sort === sort && filters.dir === 'desc' ? 'asc' : 'desc';
              setFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(id) => setSelectedId(id)}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">经营指标</h2>
            <span className="section-note">窗口：{stats.data?.window ?? '—'}</span>
          </div>
          <KpiGrid m={stats.data} />

          <div className="section-head">
            <h2 className="section-title">分类满座率</h2>
            <span className="section-note">按已确认人数排序</span>
          </div>
          <CategoryBars stats={stats.data} />

          <div className="section-head">
            <h2 className="section-title">每日到课</h2>
            <span className="section-note">已确认 / 座位数</span>
          </div>
          <DayTable days={stats.data?.days ?? []} />

          <div className="section-head">
            <h2 className="section-title">教练负载</h2>
            <span className="section-note">窗口内排课与满座率</span>
          </div>
          <CoachTable coaches={stats.data?.by_coach ?? []} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">课节详情与出场名单</h2>
            <span className="section-note">{selectedId === null ? '未选择' : `课节 #${selectedId}`}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <DetailPanel state={detail} />
        </div>
        <div className="detail-side">
          <BookForm
            token={token}
            row={detail.data?.session ?? null}
            onDone={() => {
              setDetailNonce((n) => n + 1);
              list.reload();
              stats.reload();
            }}
          />
        </div>
      </section>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">前台动作</h2>
          <span className="section-note">写接口需 ADMIN_TOKEN；校验失败会逐字段回显</span>
        </div>
        <MemberForm token={token} onCreated={refreshAll} />
        <p className="footnote">
          接口：GET /api/health · /api/stats · /api/schedule · /api/classes · /api/sessions/&#123;id&#125; ·
          POST /api/admin/sessions/&#123;id&#125;/bookings · POST /api/admin/members。当前在售课程：
          {coaches.data?.total ?? 0} 门。
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

const KPI_LABEL: Record<string, string> = {
  occupancy_pct: '平均满座率',
  confirmed_bookings: '已确认预约',
  open_sessions: '开放课节',
  waitlist_bookings: '候补排队',
  revenue_cents: '到课收入',
  no_show_rate_pct: '未到率',
  active_members: '有效会员',
  avg_confirmed_per_session: '单课平均人数',
};

const KPI_HINT: Record<string, string> = {
  occupancy_pct: 'confirmed ÷ 未取消课节容量',
  confirmed_bookings: '窗口内确认占座笔数',
  revenue_cents: '已开课课节 confirmed × 单价',
  no_show_rate_pct: '已开课里 no_show ÷ 全部到场记录',
  avg_confirmed_per_session: 'confirmed ÷ 课节数',
};

const KPI_ORDER: readonly (keyof Stats)[] = [
  'occupancy_pct',
  'confirmed_bookings',
  'open_sessions',
  'waitlist_bookings',
  'revenue_cents',
  'no_show_rate_pct',
  'active_members',
  'avg_confirmed_per_session',
];

function KpiGrid({ m }: { m: Stats | null }): React.JSX.Element {
  return (
    <div className="kpis">
      {KPI_ORDER.map((key) => {
        const raw = m?.[key];
        const value = typeof raw === 'number' ? raw : 0;
        const text =
          m === null
            ? '—'
            : key === 'revenue_cents'
              ? cnyCompact(value)
              : key === 'occupancy_pct' || key === 'no_show_rate_pct' || key === 'avg_confirmed_per_session'
                ? `${value.toFixed(1)}${key === 'avg_confirmed_per_session' ? ' 人' : '%'}`
                : value.toLocaleString('zh-CN');
        return (
          <article className="kpi" key={String(key)}>
            <h3 className="kpi-label">{KPI_LABEL[String(key)] ?? String(key)}</h3>
            <p className="kpi-value">{text}</p>
            <p className="kpi-hint">{KPI_HINT[String(key)] ?? '窗口内实时统计'}</p>
          </article>
        );
      })}
    </div>
  );
}

function Filters({
  value,
  page,
  coaches,
  categories,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  coaches: string[];
  categories: Category[];
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
        <span className="field-label">起算日</span>
        <input
          className="input"
          type="date"
          value={value.date ?? ''}
          onChange={(e) => onChange({ next: { date: e.target.value }, resetPage: true })}
        />
      </label>
      <label className="field">
        <span className="field-label">天数</span>
        <select
          className="input"
          value={String(value.days ?? 14)}
          onChange={(e) => onChange({ next: { days: Number(e.target.value) }, resetPage: true })}
        >
          {[1, 3, 7, 14].map((n) => (
            <option key={n} value={n}>
              {n} 天
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">类别</span>
        <select
          className="input"
          value={value.category ?? ''}
          onChange={(e) => onChange({ next: { category: e.target.value as Category | '' }, resetPage: true })}
        >
          <option value="">全部</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">教练</span>
        <select
          className="input"
          value={value.coach ?? ''}
          onChange={(e) => onChange({ next: { coach: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {coaches.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">级别</span>
        <select
          className="input"
          value={value.level ?? ''}
          onChange={(e) => onChange({ next: { level: e.target.value as CoachLevel | '' }, resetPage: true })}
        >
          <option value="">全部</option>
          {(Object.keys(LEVEL_LABEL) as CoachLevel[]).map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">状态</span>
        <select
          className="input"
          value={value.status ?? ''}
          onChange={(e) => onChange({ next: { status: e.target.value as SessionStatus | '' }, resetPage: true })}
        >
          <option value="">全部</option>
          {(Object.keys(SESSION_LABEL) as SessionStatus[]).map((s) => (
            <option key={s} value={s}>
              {SESSION_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">每页</span>
        <select
          className="input"
          value={String(value.page_size ?? 14)}
          onChange={(e) => onChange({ next: { page_size: Number(e.target.value) }, resetPage: true })}
        >
          {[7, 14, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-wide">
        <span className="field-label">搜索</span>
        <input
          className="input"
          type="search"
          value={search}
          maxLength={64}
          placeholder="课程名 / 教练 / 教室（服务端转义 LIKE）"
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
  { key: 'when', label: '时间' },
  { key: 'class', label: '课程', sort: 'class' },
  { key: 'coach', label: '教练', sort: 'coach' },
  { key: 'room', label: '教室', sort: 'room' },
  { key: 'load', label: '强度' },
  { key: 'seats', label: '座位', sort: 'booked', numeric: true },
  { key: 'remaining', label: '余位', sort: 'remaining', numeric: true },
  { key: 'price', label: '单价', numeric: true },
  { key: 'status', label: '状态' },
];

function ScheduleTable({
  rows,
  loading,
  sort,
  dir,
  selectedId,
  onSort,
  onPick,
}: {
  rows: SessionRow[];
  loading: boolean;
  sort: SortKey;
  dir: SortDir;
  selectedId: number | null;
  onSort: (key: SortKey) => void;
  onPick: (id: number) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">课表：点击一节查看名单与预约入口</caption>
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
                这个条件下没有排课，试试放宽筛选或换个日期
              </td>
            </tr>
          ) : null}
          {rows.map((r) => {
            const d = daysUntil(r.start_at);
            const pct = r.capacity > 0 ? Math.min(100, Math.round((r.confirmed / r.capacity) * 100)) : 0;
            return (
              <tr
                key={r.id}
                data-active={r.id === selectedId ? 'true' : 'false'}
                onClick={() => onPick(r.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick(r.id);
                  }
                }}
              >
                <td className="mono">
                  <span className="cell-strong">
                    {dateOnly(r.start_at)} {weekday(r.start_at)}
                  </span>
                  <span className="cell-sub">
                    {timeOnly(r.start_at)}–{endAt(r.start_at, r.duration_min)} ·{' '}
                    {r.status === 'open' ? (d === 0 ? '今天' : d > 0 ? `${d} 天后` : '已过') : '—'}
                  </span>
                </td>
                <td>
                  <span className="cell-strong">{r.class_name}</span>
                  <span className="cell-sub">
                    {CATEGORY_LABEL[r.category]} · {r.duration_min} 分钟
                  </span>
                </td>
                <td>
                  <span className="cell-strong">{r.coach}</span>
                  <span className="cell-sub">{LEVEL_LABEL[r.coach_level]}</span>
                </td>
                <td className="mono">{r.room}</td>
                <td>
                  <span className="load" data-level={r.intensity >= 4 ? 'high' : r.intensity >= 3 ? 'mid' : 'low'}>
                    {'●'.repeat(r.intensity)}
                    <span className="load-off">{'○'.repeat(Math.max(0, 5 - r.intensity))}</span>
                  </span>
                </td>
                <td>
                  <span className="seats">
                    <span className="seats-num mono">
                      {r.confirmed}/{r.capacity}
                    </span>
                    <span className="bar-track seats-track">
                      <span className="bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
                    </span>
                  </span>
                  {r.waitlist > 0 ? <span className="cell-sub">候补 {r.waitlist} 人</span> : null}
                </td>
                <td className="num mono" data-full={r.status === 'open' && r.remaining <= 0 ? 'true' : 'false'}>
                  {r.status === 'canceled' ? '—' : r.remaining}
                </td>
                <td className="num mono">{cny(r.price_cents)}</td>
                <td>
                  <span className="badge" data-status={r.status}>
                    {SESSION_LABEL[r.status]}
                  </span>
                  {r.note !== '' ? <span className="cell-sub">{r.note}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CategoryBars({ stats }: { stats: Stats | null }): React.JSX.Element {
  const items = [...(stats?.by_category ?? [])].sort((a, b) => b.confirmed - a.confirmed);
  const max = items[0]?.confirmed ?? 1;
  if (items.length === 0) return <p className="placeholder">暂无分类数据</p>;
  return (
    <ul className="bars">
      {items.map((p) => (
        <li className="bar" key={p.category}>
          <span className="bar-head">
            <span className="bar-name">{CATEGORY_LABEL[p.category]}</span>
            <span className="bar-value">{p.occupancy_pct.toFixed(1)}%</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((p.confirmed / max) * 100))}%` }} />
          </span>
          <span className="bar-foot">
            {p.sessions} 节课 · {p.confirmed}/{p.seats} 座
          </span>
        </li>
      ))}
    </ul>
  );
}

function DayTable({ days }: { days: Stats['days'] }): React.JSX.Element {
  const max = days.reduce((acc, d) => Math.max(acc, d.seats), 1);
  if (days.length === 0) return <p className="placeholder">暂无每日数据</p>;
  return (
    <table className="table mini plain">
      <caption className="caption">每日到课与座位</caption>
      <thead>
        <tr>
          <th scope="col">日期</th>
          <th scope="col" className="num">
            课节
          </th>
          <th scope="col" className="num">
            已确认
          </th>
          <th scope="col">走势</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.day}>
            <td className="mono">{d.day.slice(5)}</td>
            <td className="num mono">{d.sessions}</td>
            <td className="num mono">{d.confirmed}</td>
            <td>
              <span className="spark">
                <span className="spark-add" style={{ width: `${(d.confirmed / max) * 100}%` }} />
                <span className="spark-cut" style={{ width: `${(d.canceled / max) * 100}%` }} />
              </span>
              <span className="cell-sub">取消 {d.canceled}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoachTable({ coaches }: { coaches: Stats['by_coach'] }): React.JSX.Element {
  if (coaches.length === 0) return <p className="placeholder">暂无教练数据</p>;
  return (
    <table className="table mini plain">
      <caption className="caption">教练排课负载</caption>
      <thead>
        <tr>
          <th scope="col">教练</th>
          <th scope="col" className="num">
            课节
          </th>
          <th scope="col" className="num">
            已确认
          </th>
          <th scope="col" className="num">
            满座率
          </th>
        </tr>
      </thead>
      <tbody>
        {coaches.map((c) => (
          <tr key={c.coach}>
            <td>
              <span className="cell-strong">{c.coach}</span>
              <span className="cell-sub">{LEVEL_LABEL[c.coach_level]}</span>
            </td>
            <td className="num mono">{c.sessions}</td>
            <td className="num mono">{c.confirmed}</td>
            <td className="num mono" data-overload={c.occupancy_pct >= 85 ? 'true' : 'false'}>
              {c.occupancy_pct.toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailPanel({ state }: { state: { data: { session: SessionRow; roster: RosterEntry[] } | null; loading: boolean } }): React.JSX.Element {
  const d = state.data;
  if (d === null) {
    return <p className="placeholder">{state.loading ? '正在读取课节详情…' : '在课表中选择一节查看详情与名单。'}</p>;
  }
  const s = d.session;
  const facts: readonly { label: string; value: string }[] = [
    { label: '课程', value: `${s.class_name}（${s.class_code}）` },
    { label: '类别 / 强度', value: `${CATEGORY_LABEL[s.category]} · ${s.intensity}/5` },
    { label: '教练', value: `${s.coach} · ${LEVEL_LABEL[s.coach_level]}` },
    { label: '教室', value: s.room },
    { label: '时间', value: `${dateOnly(s.start_at)} ${weekday(s.start_at)} ${timeOnly(s.start_at)}–${endAt(s.start_at, s.duration_min)} UTC` },
    { label: '时长', value: `${s.duration_min} 分钟` },
    { label: '单价', value: cny(s.price_cents) },
    { label: '状态', value: SESSION_LABEL[s.status] },
  ];
  return (
    <>
      <dl className="facts">
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {s.note !== '' ? <p className="hint">备注：{s.note}</p> : null}
      <table className="table mini plain">
        <caption className="caption">出场名单（{d.roster.length} 人）</caption>
        <thead>
          <tr>
            <th scope="col">会员</th>
            <th scope="col">联系方式</th>
            <th scope="col">卡种</th>
            <th scope="col">状态</th>
            <th scope="col">来源</th>
            <th scope="col">预约时间</th>
          </tr>
        </thead>
        <tbody>
          {d.roster.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
                还没有人约这节课
              </td>
            </tr>
          ) : null}
          {d.roster.map((e) => (
            <tr key={e.booking_id}>
              <td className="cell-strong">{e.name}</td>
              <td className="mono">{e.phone}</td>
              <td>
                {CARD_LABEL[e.card_type]}
                {e.credits > 0 ? <span className="cell-sub">余 {e.credits} 次</span> : null}
              </td>
              <td>
                <span className="badge" data-booking={e.status}>
                  {BOOKING_LABEL[e.status]}
                </span>
              </td>
              <td>{SOURCE_LABEL[e.source]}</td>
              <td className="mono">{stamp(e.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function BookForm({
  token,
  row,
  onDone,
}: {
  token: string;
  row: SessionRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [memberId, setMemberId] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<BookingSource>('front_desk');
  const [waitlist, setWaitlist] = useState(true);

  const blocked = row === null || row.status !== 'open' || row.remaining <= 0;
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (row === null) return;
        const input: CreateBookingInput = { source, allow_waitlist: waitlist };
        const id = Number(memberId);
        if (memberId !== '' && Number.isInteger(id) && id > 0) input.member_id = id;
        else if (phone !== '') input.phone = phone.trim();
        action.run(async () => {
          await api.book(token, row.id, input);
          onDone();
        });
      }}
    >
      <h3 className="form-title">为会员占座</h3>
      <p className="form-note">
        {row === null ? '未选择课节' : `${row.class_name} · ${dateOnly(row.start_at)} ${timeOnly(row.start_at)}`}
        {row !== null && row.status !== 'open' ? '（该课节已结课或已取消，后端会返回 409）' : ''}
        {row !== null && row.status === 'open' && row.remaining <= 0 ? '（已满座，勾选候补才允许排队）' : ''}
      </p>
      <label className="field">
        <span className="field-label">会员 ID</span>
        <input
          className="input"
          type="number"
          min="1"
          step="1"
          value={memberId}
          placeholder="例如 12"
          onChange={(e) => setMemberId(e.target.value)}
        />
        {action.lastError?.fields.member_id ? <span className="err">{action.lastError.fields.member_id}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">或手机号</span>
        <input
          className="input"
          inputMode="tel"
          maxLength={20}
          value={phone}
          placeholder="13800001234"
          onChange={(e) => setPhone(e.target.value)}
        />
        {action.lastError?.fields.phone ? <span className="err">{action.lastError.fields.phone}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">来源</span>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value as BookingSource)}>
          {(Object.keys(SOURCE_LABEL) as BookingSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={waitlist} onChange={(e) => setWaitlist(e.target.checked)} />
        <span>满座时允许进入候补队列</span>
      </label>
      {action.lastError?.code === 'unauthorized' || action.lastError?.code === 'forbidden' ? (
        <p className="hint">请在右上角填入正确的管理令牌。</p>
      ) : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={blocked || action.busy || token === ''}>
        {action.busy ? '提交中…' : '确认预约'}
      </button>
    </form>
  );
}

function MemberForm({ token, onCreated }: { token: string; onCreated: () => void }): React.JSX.Element {
  const action = useAction();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [card, setCard] = useState<CardType>('monthly');
  const [credits, setCredits] = useState('');

  return (
    <form
      className="panel-form form-row"
      onSubmit={(e) => {
        e.preventDefault();
        const input: CreateMemberInput = {
          name: name.trim(),
          phone: phone.trim(),
          card_type: card,
          credits: Number(credits || '0'),
          days_valid: 0,
        };
        action.run(async () => {
          await api.createMember(token, input);
          setName('');
          setPhone('');
          setCredits('');
          onCreated();
        });
      }}
    >
      <h3 className="form-title">会员建档</h3>
      <label className="field">
        <span className="field-label">姓名</span>
        <input className="input" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        {action.lastError?.fields.name ? <span className="err">{action.lastError.fields.name}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">手机号</span>
        <input className="input" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
        {action.lastError?.fields.phone ? <span className="err">{action.lastError.fields.phone}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">卡种</span>
        <select className="input" value={card} onChange={(e) => setCard(e.target.value as CardType)}>
          {(Object.keys(CARD_LABEL) as CardType[]).map((c) => (
            <option key={c} value={c}>
              {CARD_LABEL[c]}
            </option>
          ))}
        </select>
        {action.lastError?.fields.card_type ? <span className="err">{action.lastError.fields.card_type}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">次卡次数</span>
        <input className="input" type="number" min="0" max="500" step="1" value={credits} onChange={(e) => setCredits(e.target.value)} />
        {action.lastError?.fields.credits ? <span className="err">{action.lastError.fields.credits}</span> : null}
      </label>
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={action.busy || token === ''}>
        {action.busy ? '提交中…' : '建档'}
      </button>
    </form>
  );
}
