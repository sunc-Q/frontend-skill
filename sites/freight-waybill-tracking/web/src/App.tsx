import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  count,
  dateOnly,
  dateTime,
  EVENT_LABEL,
  hoursFromNow,
  KIND_LABEL,
  kg,
  NEXT_STATUS,
  pct,
  STATUS_LABEL,
  STATUS_ORDER,
  stamp,
  TIER_LABEL,
  toneOf,
  yuan,
  yuanCompact,
} from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  AdvanceInput,
  CreateRuleInput,
  CreateWaybillInput,
  ListParams,
  QuoteResult,
  RuleKind,
  SortDir,
  SortKey,
  Stats,
  Tier,
  WaybillRow,
  WaybillStatus,
} from './types';

const TOKEN_KEY = 'biz-site-admin-token';
const TREND_DAYS = 14;

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

  const stats = useAsync<Stats>(() => api.stats(TREND_DAYS), [theme]);
  const lanes = useAsync(() => api.lanes(true), []);
  const rules = useAsync(() => api.rules(true), []);

  const [filters, setFilters] = useState<ListParams>({ sort: 'booked', dir: 'desc', page_size: 12 });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.waybills({ ...filters, page, page_size: filters.page_size ?? 12 }),
    [filters.status, filters.lane, filters.tier, filters.q, filters.sort, filters.dir, page, filters.page_size],
  );

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const detail = useAsync(
    () => (selectedCode === null ? Promise.resolve(null) : api.waybill(selectedCode)),
    [selectedCode, (selectedCode === null ? 0 : list.data?.items.length ?? 0) + ':' + String(list.loading)],
  );

  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (selectedCode === null && rows.length > 0) setSelectedCode(rows[0]?.code ?? null);
  }, [rows, selectedCode]);

  const totalRows = list.data?.total ?? 0;
  const pageSize = filters.page_size ?? 12;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));

  const laneOptions = useMemo(() => lanes.data?.items ?? [], [lanes.data]);

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">运单运营台</span>
          <span className="brand-sub">Freight Waybill Console</span>
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
          同一套接口与页面骨架，三种互不相同的视觉主张。数据全部来自 Go/Gin + SQLite 后端的真实查询，
          计费口径写死后端：<b>体积重 = 体积(cm³)×1000÷抛比</b>，计费重取 max(实际重, 体积重) 后
          <b>向上进位到 500g</b>，附加费按优先级逐条仲裁并<b>封顶运费 80%</b>。
        </p>
        <p className="stamp">
          数据快照 {stats.data ? stamp(stats.data.generated_at) : '加载中'} · 业务日 {stats.data?.today ?? '—'}
        </p>
      </div>

      <Banner state={stats} label="指标接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">经营指标</h2>
            <span className="section-note">{stats.data?.window ?? '加载中'}</span>
          </div>
          <IdentityBar st={stats.data} />
          <KpiGrid st={stats.data} />

          <div className="section-head">
            <h2 className="section-title">运单台账</h2>
            <span className="section-note">
              第 {page} / {pages} 页 · 共 {totalRows} 条
            </span>
          </div>
          <Filters
            value={filters}
            page={page}
            pages={pages}
            lanes={laneOptions}
            onChange={(next) => {
              setFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setPage(1);
            }}
            onPage={setPage}
          />
          <Banner state={list} label="运单列表" />
          <WaybillTable
            rows={rows}
            loading={list.loading}
            sort={keyOf(filters.sort)}
            dir={filters.dir ?? 'desc'}
            selectedCode={selectedCode}
            onSort={(sort) => {
              const dir: SortDir = filters.sort === sort && filters.dir === 'asc' ? 'desc' : 'asc';
              setFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(code) => setSelectedCode(code)}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">运费试算台</h2>
            <span className="section-note">GET /api/quote · 与开单同一引擎</span>
          </div>
          <QuotePanel lanes={laneOptions} />

          <div className="section-head">
            <h2 className="section-title">线路营收结构</h2>
            <span className="section-note">按营收排序 · 剔除已退回</span>
          </div>
          <LaneBars rollup={stats.data?.by_lane ?? []} revenue={stats.data?.revenue_cents ?? 0} />

          <div className="section-head">
            <h2 className="section-title">状态与趋势</h2>
            <span className="section-note">近 {TREND_DAYS} 个自然日</span>
          </div>
          <StatusChips st={stats.data} />
          <TrendTable daily={stats.data?.daily ?? []} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">运单详情与计费明细</h2>
            <span className="section-note">{selectedCode ?? '未选择'}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <DetailPanel state={detail} />
        </div>
        <div className="detail-side">
          <AdvanceForm
            token={token}
            status={detail.data?.status ?? null}
            code={detail.data?.code ?? null}
            onDone={() => {
              detail.reload();
              list.reload();
              stats.reload();
            }}
          />
          <ExceptionForm
            token={token}
            code={detail.data?.code ?? null}
            status={detail.data?.status ?? null}
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
        <Banner state={lanes} label="线路接口" />
        <div className="form-grid">
          <CreateWaybillForm
            token={token}
            lanes={laneOptions.filter((l) => l.active)}
            onCreated={(code) => {
              setSelectedCode(code);
              list.reload();
              stats.reload();
              rules.reload();
            }}
          />
          <CreateRuleForm
            token={token}
            onCreated={() => {
              rules.reload();
              stats.reload();
            }}
          />
        </div>
        <div className="section-head">
          <h2 className="section-title">线路与附加费规则</h2>
          <span className="section-note">规则停用后立即不参与仲裁</span>
        </div>
        <Banner state={rules} label="规则接口" />
        <RuleTable
          rules={rules.data?.items ?? []}
          loading={rules.loading}
          token={token}
          onToggled={() => {
            rules.reload();
            stats.reload();
          }}
        />
        <LaneTable lanes={laneOptions} loading={lanes.loading} />
        <p className="footnote">
          接口：GET /api/health · /api/lanes · /api/rules · /api/stats · /api/quote · /api/waybills ·
          /api/waybills/&#123;code&#125;；POST /api/admin/waybills · /api/admin/waybills/&#123;code&#125;/advance ·
          /api/admin/waybills/&#123;code&#125;/exception · /api/admin/rules · /api/admin/rules/&#123;id&#125;/toggle。
          当前线路 {lanes.data?.total ?? 0} 条 · 规则 {rules.data?.total ?? 0} 条 · 运单 {totalRows} 条。
        </p>
      </footer>
    </div>
  );
}

export function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  return <style data-theme-css={theme}>{themeCss(theme)}</style>;
}

function Banner({ state, label }: { state: { loading: boolean; error: string | null }; label: string }) {
  if (state.error === null) return null;
  return (
    <p className="banner" role="status">
      <span className="banner-tag">{label}</span>
      {state.loading ? '重试中… ' : ''}
      {state.error}
    </p>
  );
}

function IdentityBar({ st }: { st: Stats | null }): React.JSX.Element | null {
  if (st === null) return null;
  return (
    <p className="identity" data-ok={st.identity_ok ? 'true' : 'false'} role="status">
      <span>
        后端实时自检：{st.identity_ok ? '五条计价恒等式与三组分项合计全部成立' : '恒等式出现破口，已中止对外报价'}
      </span>
      {st.identity_issues.length > 0 ? (
        <ul className="identity-list">
          {st.identity_issues.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
    </p>
  );
}

interface Kpi {
  key: string;
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}

function KpiGrid({ st }: { st: Stats | null }): React.JSX.Element {
  const v = (n: number | undefined, f: (x: number) => string): string => (st === undefined || n === undefined ? '—' : f(n));
  const kpis: Kpi[] = [
    {
      key: 'revenue',
      label: '累计营收',
      value: v(st?.revenue_cents, yuanCompact),
      hint: '运费+燃油+保价+附加，剔除退回单',
    },
    { key: 'today', label: '今日营收', value: v(st?.revenue_today_cents, yuanCompact), hint: '按 UTC+8 日历日' },
    { key: 'booked', label: '今日开单', value: v(st?.booked_today, count), hint: '电子运单生成数' },
    { key: 'total', label: '运单总数', value: v(st?.total_waybills, count), hint: '含全部历史口径' },
    { key: 'transit', label: '在途运单', value: v(st?.in_transit, count), hint: '揽收至派送之间' },
    {
      key: 'exception',
      label: '异常挂起',
      value: v(st?.exception_count, count),
      hint: st === null ? '—' : `占全部 ${pct(st.exception_pct)}`,
      warn: (st?.exception_count ?? 0) > 0,
    },
    {
      key: 'ontime',
      label: '签收准点率',
      value: v(st?.on_time_pct, pct),
      hint: '签收时间 ≤ 承诺时间',
      warn: st !== null && st.on_time_pct < 80,
    },
    { key: 'avg', label: '单票均价', value: v(st?.avg_total_cents, yuan), hint: '营收 ÷ 计费单数' },
    { key: 'cargo', label: '计费总重', value: v(st?.total_chargeable_kg, (x) => `${count(x)} kg`), hint: '进位后口径' },
    {
      key: 'bulky',
      label: '泡货占比',
      value: v(st?.bulky_pct, pct),
      hint: st === null ? '—' : `${count(st.bulky_count)} 单按体积重计费`,
    },
    {
      key: 'capped',
      label: '附加费封顶',
      value: v(st?.surcharge_capped_count, count),
      hint: '触达运费 80% 上限被截断',
    },
    { key: 'scan', label: '轨迹打卡', value: v(st?.event_count, count), hint: '含纯在途干线打卡' },
  ];
  return (
    <div className="kpis">
      {kpis.map((k) => (
        <article className="kpi" key={k.key} data-warn={k.warn === true ? 'true' : 'false'}>
          <h3 className="kpi-label">{k.label}</h3>
          <p className="kpi-value">{k.value}</p>
          <p className="kpi-hint">{k.hint}</p>
        </article>
      ))}
    </div>
  );
}

const FILTER_STATUSES: readonly (WaybillStatus | '')[] = ['', ...STATUS_ORDER];
const FILTER_TIERS: readonly (Tier | '')[] = ['', 'express', 'standard', 'economy'];

function Filters({
  value,
  page,
  pages,
  lanes,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  pages: number;
  lanes: { code: string; origin: string; destination: string }[];
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
        <span className="field-label">状态</span>
        <select
          className="input"
          value={value.status ?? ''}
          onChange={(e) => onChange({ next: { status: e.target.value as WaybillStatus | '' }, resetPage: true })}
        >
          {FILTER_STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s === '' ? '全部状态' : STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">线路</span>
        <select
          className="input"
          value={value.lane ?? ''}
          onChange={(e) => onChange({ next: { lane: e.target.value }, resetPage: true })}
        >
          <option value="">全部线路</option>
          {lanes.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code} {l.origin}→{l.destination}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">档位</span>
        <select
          className="input"
          value={value.tier ?? ''}
          onChange={(e) => onChange({ next: { tier: e.target.value as Tier | '' }, resetPage: true })}
        >
          {FILTER_TIERS.map((t) => (
            <option key={t || 'all'} value={t}>
              {t === '' ? '全部档位' : TIER_LABEL[t] ?? t}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">每页</span>
        <select
          className="input"
          value={String(value.page_size ?? 12)}
          onChange={(e) => onChange({ next: { page_size: Number(e.target.value) }, resetPage: true })}
        >
          {[12, 25, 50, 100].map((n) => (
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
          maxLength={40}
          placeholder="单号或寄件人（服务端转义 LIKE）"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="pager">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <span className="pager-now mono">
          {page}/{pages}
        </span>
        <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

const COLUMNS: readonly { key: string; label: string; sort?: SortKey; numeric?: boolean }[] = [
  { key: 'code', label: '运单号', sort: 'code' },
  { key: 'lane', label: '线路', sort: 'lane' },
  { key: 'status', label: '状态', sort: 'status' },
  { key: 'chargeable', label: '计费重', sort: 'chargeable', numeric: true },
  { key: 'pieces', label: '件数', sort: 'pieces', numeric: true },
  { key: 'total', label: '应收', sort: 'total', numeric: true },
  { key: 'promised', label: '承诺时效', sort: 'promised' },
  { key: 'booked', label: '下单 · 打卡', sort: 'booked' },
];

function keyOf(sort: SortKey | undefined): SortKey {
  return sort ?? 'booked';
}

function WaybillTable({
  rows,
  loading,
  sort,
  dir,
  selectedCode,
  onSort,
  onPick,
}: {
  rows: WaybillRow[];
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
        <caption className="caption">运单台账：点击行查看计费明细与轨迹</caption>
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
                没有符合条件的运单，试试放宽筛选条件
              </td>
            </tr>
          ) : null}
          {rows.map((r) => {
            const hrs = hoursFromNow(r.promised_at);
            const closed = r.status === 'delivered' || r.status === 'returned';
            const late = !closed && hrs < 0;
            const bulky = r.volumetric_grams > r.weight_grams;
            return (
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
                <td className="mono">
                  <span className="cell-strong">{r.code}</span>
                  <span className="cell-sub">{r.shipper_name}</span>
                </td>
                <td>
                  <span className="cell-strong mono">{r.lane_code}</span>
                  <span className="cell-sub">
                    {r.origin}→{r.destination} · {TIER_LABEL[r.tier] ?? r.tier}
                  </span>
                </td>
                <td>
                  <span className="badge" data-tone={toneOf(r.status)}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.fragile ? <span className="cell-sub">易碎加固</span> : null}
                  {r.remote_area ? <span className="cell-sub">偏远区</span> : null}
                </td>
                <td className="num mono">
                  {kg(r.chargeable_grams)}
                  <span className="cell-sub" data-alarm={bulky ? 'true' : 'false'}>
                    实际 {kg(r.weight_grams)}
                  </span>
                </td>
                <td className="num mono">
                  {r.piece_count}
                  <span className="cell-sub">最重 {kg(r.heaviest_piece_g)}</span>
                </td>
                <td className="num mono">
                  {yuan(r.total_cents)}
                  <span className="cell-sub" data-alarm={r.surcharge_capped ? 'true' : 'false'}>
                    {r.surcharge_capped ? '附加费已封顶' : `附加 ${yuan(r.surcharge_cents)}`}
                  </span>
                </td>
                <td className="mono">
                  {dateOnly(r.promised_at)}
                  <span className="cell-sub" data-alarm={late ? 'true' : 'false'}>
                    {closed ? '已结案' : hrs < 0 ? `逾期 ${Math.abs(hrs)} 小时` : `剩 ${hrs} 小时`}
                  </span>
                </td>
                <td className="mono">
                  {dateTime(r.booked_at)}
                  <span className="cell-sub">{r.leg_count} 次打卡</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LaneBars({
  rollup,
  revenue,
}: {
  rollup: Stats['by_lane'];
  revenue: number;
}): React.JSX.Element {
  const sorted = useMemo(() => [...rollup].sort((a, b) => b.revenue_cents - a.revenue_cents), [rollup]);
  const max = sorted[0]?.revenue_cents ?? 1;
  if (sorted.length === 0) return <p className="placeholder">加载中…</p>;
  return (
    <ul className="bars">
      {sorted.map((l) => (
        <li className="bar" key={l.lane_code}>
          <span className="bar-head">
            <span className="bar-name mono">{l.lane_code}</span>
            <span className="bar-value">{yuanCompact(l.revenue_cents)}</span>
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${Math.max(2, Math.round((l.revenue_cents / max) * 100))}%` }}
            />
          </span>
          <span className="bar-foot">
            {l.route} · {TIER_LABEL[l.tier] ?? l.tier} · {l.waybills} 单 / {count(l.cargo_kg)} kg
            {revenue > 0 ? ` · 占营收 ${((l.revenue_cents / revenue) * 100).toFixed(1)}%` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatusChips({ st }: { st: Stats | null }): React.JSX.Element {
  if (st === null) return <p className="placeholder">加载中…</p>;
  const byStatus = new Map(st.by_status.map((x) => [x.status, x.count]));
  return (
    <ul className="chips">
      {STATUS_ORDER.map((s) => (
        <li className="chip" key={s}>
          <span>{STATUS_LABEL[s]}</span>
          <span className="chip-val">{count(byStatus.get(s) ?? 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function TrendTable({ daily }: { daily: Stats['daily'] }): React.JSX.Element {
  const maxBooked = daily.reduce((acc, p) => Math.max(acc, p.booked), 1);
  const maxRevenue = daily.reduce((acc, p) => Math.max(acc, p.revenue_cents), 1);
  return (
    <div className="tablewrap">
      <table className="table mini plain">
        <caption className="caption">每日开单与营收</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col" className="num">
              开单
            </th>
            <th scope="col" className="num">
              营收
            </th>
            <th scope="col">走势</th>
          </tr>
        </thead>
        <tbody>
          {daily.length === 0 ? (
            <tr>
              <td className="empty" colSpan={4}>
                加载中…
              </td>
            </tr>
          ) : null}
          {daily.map((p) => (
            <tr key={p.day}>
              <td className="mono">{p.day}</td>
              <td className="num mono">{p.booked}</td>
              <td className="num mono">{yuanCompact(p.revenue_cents)}</td>
              <td>
                <span className="spark">
                  <span className="spark-add" style={{ width: `${(p.booked / maxBooked) * 100}%` }} />
                  <span className="spark-cut" style={{ width: `${(p.revenue_cents / maxRevenue) * 45}%` }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 报价试算 ----------

function QuotePanel({ lanes }: { lanes: { code: string; origin: string; destination: string; active: boolean }[] }) {
  const sellable = lanes.filter((l) => l.active);
  const [lane, setLane] = useState('');
  const [weight, setWeight] = useState('5200');
  const [volume, setVolume] = useState('48000');
  const [heaviest, setHeaviest] = useState('3000');
  const [declared, setDeclared] = useState('80000');
  const [fragile, setFragile] = useState(true);
  const [res, setRes] = useState<QuoteResult | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (lane === '' && sellable.length > 0) setLane(sellable[0]?.code ?? '');
  }, [lane, sellable]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setMsg(null);
      setFields({});
      api
        .quote({
          lane,
          weight_g: Number(weight),
          volume_cm3: Number(volume),
          heaviest_g: Number(heaviest),
          declared_cents: Number(declared),
          fragile: fragile ? 1 : 0,
        })
        .then((q) => {
          setRes(q);
          setMsg({ kind: 'ok', text: `试算完成：${q.route} 应收 ${yuan(q.total_cents)}` });
        })
        .catch((err: unknown) => {
          setRes(null);
          const isApi = typeof err === 'object' && err !== null && 'fields' in err;
          if (isApi) {
            const ae = err as { message?: string; fields?: Record<string, string> };
            setFields(ae.fields ?? {});
            setMsg({ kind: 'err', text: ae.message ?? '试算失败' });
          } else {
            setMsg({ kind: 'err', text: '试算失败，请稍后重试' });
          }
        })
        .finally(() => setBusy(false));
    },
    [lane, weight, volume, heaviest, declared, fragile],
  );

  return (
    <form className="panel-form" onSubmit={submit}>
      <p className="form-note">
        试算走与开单完全相同的计价引擎：抛比按线路档位（特快 6000 / 标快 8000 / 经济 12000），
        泡货按体积计费，附加费逐条仲裁后封顶运费 80%。
      </p>
      <label className="field">
        <span className="field-label">线路</span>
        <select className="input" value={lane} onChange={(e) => setLane(e.target.value)}>
          {sellable.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code} {l.origin}→{l.destination}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">实际重（克）</span>
        <input className="input mono" type="number" min={1} max={2000000} value={weight} onChange={(e) => setWeight(e.target.value)} />
        {fields.weight_g ? <span className="err">{fields.weight_g}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">体积（cm³）</span>
        <input className="input mono" type="number" min={0} max={20000000} value={volume} onChange={(e) => setVolume(e.target.value)} />
        {fields.volume_cm3 ? <span className="err">{fields.volume_cm3}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">最重单件（克）</span>
        <input className="input mono" type="number" min={1} value={heaviest} onChange={(e) => setHeaviest(e.target.value)} />
        {fields.heaviest_g ? <span className="err">{fields.heaviest_g}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">声明价值（分）</span>
        <input className="input mono" type="number" min={0} value={declared} onChange={(e) => setDeclared(e.target.value)} />
        {fields.declared_cents ? <span className="err">{fields.declared_cents}</span> : null}
      </label>
      <label className="field checkbox">
        <input type="checkbox" checked={fragile} onChange={(e) => setFragile(e.target.checked)} />
        <span className="field-label">易碎品</span>
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled={busy || lane === ''}>
          {busy ? '试算中…' : '试算运费'}
        </button>
      </div>
      {msg ? <p className="form-msg" data-kind={msg.kind}>{msg.text}</p> : null}
      {res ? <QuoteBill q={res} /> : null}
    </form>
  );
}

function QuoteBill({ q }: { q: QuoteResult }): React.JSX.Element {
  return (
    <>
      <ul className="bill">
        <li className="bill-row" data-part="volume">
          <span className="bill-key">体积重</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{kg(q.volumetric_grams)}</span>
        </li>
        <li className="bill-row" data-part="chargeable">
          <span className="bill-key">计费重</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{kg(q.chargeable_grams)}</span>
          <span className="bill-sub">
            <span>续重 {q.continue_units} 档（每档 500g）</span>
          </span>
        </li>
        <li className="bill-row" data-part="freight">
          <span className="bill-key">运费</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(q.freight_cents)}</span>
        </li>
        <li className="bill-row" data-part="fuel">
          <span className="bill-key">燃油附加</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(q.fuel_cents)}</span>
        </li>
        <li className="bill-row" data-part="insurance">
          <span className="bill-key">保价费</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(q.insurance_cents)}</span>
        </li>
        <li className="bill-row" data-part="surcharge">
          <span className="bill-key">附加费</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(q.surcharge_cents)}</span>
          <span className="bill-sub">
            {q.items.map((it) => (
              <span key={it.code} className="bill-line">
                <span>{it.name}</span>
                <span className="mono">{yuan(it.cents)}</span>
              </span>
            ))}
            {q.items.length === 0 ? <span>无命中规则</span> : null}
            {q.capped ? <span>已按运费 80% 截断</span> : null}
          </span>
        </li>
      </ul>
      <p className="bill-total">
        <span className="bill-total-key">应收合计 · {TIER_LABEL[q.tier] ?? q.tier} · 承诺 {q.promise_days} 日</span>
        <span className="bill-total-val">{yuan(q.total_cents)}</span>
      </p>
      <p className="form-note">{q.volumetric_rule}</p>
    </>
  );
}

// ---------- 详情 ----------

function DetailPanel({ state }: { state: { data: import('./types').WaybillDetail | null; loading: boolean } }) {
  const d = state.data;
  if (d === null) {
    return <p className="placeholder">{state.loading ? '正在读取详情…' : '在台账中选择一单查看明细与轨迹。'}</p>;
  }
  const facts: readonly { label: string; value: string; alarm?: boolean }[] = [
    { label: '运单号', value: d.code },
    { label: '线路', value: `${d.lane_code} ${d.origin}→${d.destination}` },
    { label: '档位 / 时效', value: `${TIER_LABEL[d.tier] ?? d.tier} · ${d.promise_days} 日` },
    { label: '状态', value: STATUS_LABEL[d.status] ?? d.status },
    { label: '寄件人', value: d.shipper_name },
    { label: '联系电话', value: d.phone_masked },
    { label: '件数', value: `${d.piece_count} 件` },
    { label: '实际重量', value: kg(d.weight_grams) },
    { label: '体积', value: `${count(d.volume_cm3)} cm³` },
    { label: '体积重', value: kg(d.volumetric_grams), alarm: d.volumetric_grams > d.weight_grams },
    { label: '计费重', value: kg(d.chargeable_grams) },
    { label: '最重单件', value: kg(d.heaviest_piece_g) },
    { label: '声明价值', value: d.declared_cents > 0 ? yuan(d.declared_cents) : '未保价' },
    { label: '货物属性', value: [d.fragile ? '易碎' : null, d.remote_area ? '偏远区' : null].filter(Boolean).join(' · ') || '普通' },
    { label: '下单时间', value: dateTime(d.booked_at) },
    { label: '承诺送达', value: dateTime(d.promised_at) },
    { label: '签收时间', value: d.delivered_at === undefined ? '未签收' : dateTime(d.delivered_at) },
  ];
  return (
    <>
      <dl className="facts">
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <dt>{f.label}</dt>
            <dd data-alarm={f.alarm === true ? 'true' : 'false'}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="section-head">
        <h3 className="section-title">计费明细</h3>
        <span className="section-note">下单时的费率快照，后续调价不回溯</span>
      </div>
      <ul className="bill">
        <li className="bill-row" data-part="freight">
          <span className="bill-key">运费</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(d.freight_cents)}</span>
          <span className="bill-sub">
            <span>
              计费重 {kg(d.chargeable_grams)}（实际 {kg(d.weight_grams)} / 体积 {kg(d.volumetric_grams)}）
            </span>
          </span>
        </li>
        <li className="bill-row" data-part="fuel">
          <span className="bill-key">燃油附加</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(d.fuel_cents)}</span>
        </li>
        <li className="bill-row" data-part="insurance">
          <span className="bill-key">保价费</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(d.insurance_cents)}</span>
        </li>
        <li className="bill-row" data-part="surcharge">
          <span className="bill-key">附加费</span>
          <span className="bill-rule" aria-hidden="true" />
          <span className="bill-val">{yuan(d.surcharge_cents)}</span>
          <span className="bill-sub">
            {d.surcharge_items.map((it) => (
              <span key={it.code} className="bill-line">
                <span>{it.name}</span>
                <span className="mono">{yuan(it.cents)}</span>
              </span>
            ))}
            {d.surcharge_items.length === 0 ? <span>无命中规则</span> : null}
            {d.surcharge_capped ? <span>已按运费 80% 截断</span> : null}
          </span>
        </li>
      </ul>
      <p className="bill-total">
        <span className="bill-total-key">应收合计</span>
        <span className="bill-total-val">{yuan(d.total_cents)}</span>
      </p>
      <div className="section-head">
        <h3 className="section-title">路由轨迹</h3>
        <span className="section-note">{d.events.length} 条 · 含纯在途打卡</span>
      </div>
      {d.events.length === 0 ? <p className="placeholder">暂无轨迹事件</p> : null}
      <ol className="track">
        {d.events.map((ev, i) => (
          <li className="track-item" key={ev.id} data-current={i === 0 ? 'true' : 'false'}>
            <span className="track-rail" aria-hidden="true">
              <span className="track-dot" />
              {i < d.events.length - 1 ? <span className="track-line" /> : null}
            </span>
            <div className="track-body">
              <p className="track-when">
                <span className="track-kind">{EVENT_LABEL[ev.event_type] ?? ev.event_type}</span>
                <span>#{ev.seq}</span>
                <span>{dateTime(ev.occurred_at)}</span>
              </p>
              <p className="track-node">{ev.node}</p>
              <p className="track-note">{ev.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

// ---------- 写操作表单 ----------

function useSubmit() {
  const action = useAction();
  const [fields, setFields] = useState<Record<string, string>>({});
  const submit = useCallback(
    (e: React.FormEvent, fn: () => Promise<void>) => {
      e.preventDefault();
      setFields({});
      action.run(async () => {
        try {
          await fn();
        } catch (err: unknown) {
          if (typeof err === 'object' && err !== null && 'fields' in err) {
            setFields((err as { fields?: Record<string, string> }).fields ?? {});
          }
          throw err;
        }
      });
    },
    [action],
  );
  return { action, fields, submit };
}

function AdvanceForm({
  token,
  status,
  code,
  onDone,
}: {
  token: string;
  status: WaybillStatus | null;
  code: string | null;
  onDone: () => void;
}): React.JSX.Element {
  const options = status === null ? [] : NEXT_STATUS[status];
  const [to, setTo] = useState<WaybillStatus>('picked_up');
  const [node, setNode] = useState('上海分拨中心');
  const [note, setNote] = useState('');
  const { action, fields, submit } = useSubmit();

  useEffect(() => {
    if (options.length > 0 && !options.includes(to)) setTo(options[0] ?? 'picked_up');
  }, [options, to]);

  const missing = token === '' || code === null || options.length === 0;
  return (
    <form className="panel-form" onSubmit={(e) => submit(e, async () => {
      await api.advance(token, code ?? '', { to, node, note } satisfies AdvanceInput);
      onDone();
    })}>
      <p className="form-title">登记轨迹</p>
      <p className="form-note">{code === null ? '先选择一单' : `当前 ${code} · ${status === null ? '—' : STATUS_LABEL[status]}`}</p>
      <label className="field">
        <span className="field-label">推进到</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value as WaybillStatus)} disabled={options.length === 0}>
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
          {options.length === 0 ? <option value="">已结案，无后续状态</option> : null}
        </select>
        {fields.to ? <span className="err">{fields.to}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">打卡网点</span>
        <input className="input" value={node} maxLength={40} onChange={(e) => setNode(e.target.value)} />
        {fields.node ? <span className="err">{fields.node}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">备注</span>
        <input className="input" value={note} maxLength={120} placeholder="选填，≤120 字" onChange={(e) => setNote(e.target.value)} />
        {fields.note ? <span className="err">{fields.note}</span> : null}
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled={missing || action.busy}>
          {action.busy ? '提交中…' : '确认推进'}
        </button>
      </div>
      {missing && token !== '' ? <p className="hint">该运单已无可推进状态。</p> : null}
      {token === '' ? <p className="hint">未填管理令牌，写接口会返回 401。</p> : null}
      {action.message ? <p className="form-msg" data-kind={action.kind ?? 'idle'}>{action.message}</p> : null}
    </form>
  );
}

function ExceptionForm({
  token,
  code,
  status,
  onDone,
}: {
  token: string;
  code: string | null;
  status: WaybillStatus | null;
  onDone: () => void;
}): React.JSX.Element {
  const [node, setNode] = useState('西安中转场');
  const [reason, setReason] = useState('收件地址不详');
  const { action, fields, submit } = useSubmit();
  const closed = status === 'delivered' || status === 'returned';
  return (
    <form className="panel-form" onSubmit={(e) => submit(e, async () => {
      await api.reportException(token, code ?? '', { node, reason });
      onDone();
    })}>
      <p className="form-title">上报异常</p>
      <p className="form-note">异常单会挂起并停止时效考核；已结案运单不能再报。</p>
      <label className="field">
        <span className="field-label">网点</span>
        <input className="input" value={node} maxLength={40} onChange={(e) => setNode(e.target.value)} />
        {fields.node ? <span className="err">{fields.node}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">异常原因</span>
        <input className="input" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
        {fields.reason ? <span className="err">{fields.reason}</span> : null}
      </label>
      <div className="btn-row">
        <button
          className="btn"
          data-tone="bad"
          type="submit"
          disabled={token === '' || code === null || closed || action.busy}
        >
          {action.busy ? '提交中…' : '挂起该单'}
        </button>
      </div>
      {closed ? <p className="hint">已结案，不能再登记异常。</p> : null}
      {action.message ? <p className="form-msg" data-kind={action.kind ?? 'idle'}>{action.message}</p> : null}
    </form>
  );
}

function CreateWaybillForm({
  token,
  lanes,
  onCreated,
}: {
  token: string;
  lanes: { code: string; origin: string; destination: string }[];
  onCreated: (code: string) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<CreateWaybillInput>({
    lane_code: '',
    shipper_name: '陆港电子',
    phone: '13800001234',
    piece_count: 2,
    weight_grams: 5200,
    volume_cm3: 48000,
    heaviest_piece_g: 3000,
    declared_cents: 80000,
    fragile: true,
    node: '上海分拨中心',
  });
  const [last, setLast] = useState<string | null>(null);
  const { action, fields, submit } = useSubmit();

  useEffect(() => {
    if (form.lane_code === '' && lanes.length > 0) setForm((p) => ({ ...p, lane_code: lanes[0]?.code ?? '' }));
  }, [lanes, form.lane_code]);

  const set = <K extends keyof CreateWaybillInput>(k: K, v: CreateWaybillInput[K]): void =>
    setForm((p) => ({ ...p, [k]: v }));

  return (
    <form className="panel-form form-row" onSubmit={(e) => submit(e, async () => {
      const created = await api.createWaybill(token, form);
      setLast(created.code);
      onCreated(created.code);
    })}>
      <p className="form-title">新开运单</p>
      <p className="form-note">价格由后端计价引擎当场算定并快照落库，前端不参与任何金额计算。</p>
      <label className="field">
        <span className="field-label">线路</span>
        <select className="input" value={form.lane_code} onChange={(e) => set('lane_code', e.target.value)}>
          {lanes.map((l) => (
            <option key={l.code} value={l.code}>
              {l.code} {l.origin}→{l.destination}
            </option>
          ))}
        </select>
        {fields.lane_code ? <span className="err">{fields.lane_code}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">寄件人</span>
        <input className="input" value={form.shipper_name} maxLength={40} onChange={(e) => set('shipper_name', e.target.value)} />
        {fields.shipper_name ? <span className="err">{fields.shipper_name}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">手机号</span>
        <input className="input mono" value={form.phone} maxLength={11} inputMode="numeric" onChange={(e) => set('phone', e.target.value)} />
        {fields.phone ? <span className="err">{fields.phone}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">件数</span>
        <input className="input mono" type="number" min={1} max={200} value={form.piece_count} onChange={(e) => set('piece_count', Number(e.target.value))} />
        {fields.piece_count ? <span className="err">{fields.piece_count}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">实际重（克）</span>
        <input className="input mono" type="number" min={1} max={2000000} value={form.weight_grams} onChange={(e) => set('weight_grams', Number(e.target.value))} />
        {fields.weight_grams ? <span className="err">{fields.weight_grams}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">体积（cm³）</span>
        <input className="input mono" type="number" min={0} max={20000000} value={form.volume_cm3} onChange={(e) => set('volume_cm3', Number(e.target.value))} />
        {fields.volume_cm3 ? <span className="err">{fields.volume_cm3}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">最重单件（克）</span>
        <input className="input mono" type="number" min={1} max={2000000} value={form.heaviest_piece_g} onChange={(e) => set('heaviest_piece_g', Number(e.target.value))} />
        {fields.heaviest_piece_g ? <span className="err">{fields.heaviest_piece_g}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">声明价值（分）</span>
        <input className="input mono" type="number" min={0} max={10000000} value={form.declared_cents} onChange={(e) => set('declared_cents', Number(e.target.value))} />
        {fields.declared_cents ? <span className="err">{fields.declared_cents}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">揽收网点</span>
        <input className="input" value={form.node} maxLength={40} onChange={(e) => set('node', e.target.value)} />
        {fields.node ? <span className="err">{fields.node}</span> : null}
      </label>
      <label className="field checkbox">
        <input type="checkbox" checked={form.fragile} onChange={(e) => set('fragile', e.target.checked)} />
        <span className="field-label">易碎品</span>
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled={token === '' || action.busy}>
          {action.busy ? '开单中…' : '开单'}
        </button>
        {last ? <span className="chip">最新单号 <span className="chip-val mono">{last}</span></span> : null}
      </div>
      {token === '' ? <p className="hint">未填管理令牌，开单会返回 401。</p> : null}
      {action.message ? <p className="form-msg" data-kind={action.kind ?? 'idle'}>{action.message}</p> : null}
    </form>
  );
}

const RULE_KINDS: readonly RuleKind[] = ['remote_pct', 'heavy_piece', 'fragile_flat', 'long_haul_flat'];

function CreateRuleForm({ token, onCreated }: { token: string; onCreated: () => void }): React.JSX.Element {
  const [form, setForm] = useState<CreateRuleInput>({
    code: 'night-pickup',
    name: '夜间取件费',
    kind: 'fragile_flat',
    threshold_g: 0,
    threshold_km: 0,
    rate_pct: 0,
    amount_cents: 500,
    min_cents: 0,
    priority: 50,
  });
  const { action, fields, submit } = useSubmit();
  const set = <K extends keyof CreateRuleInput>(k: K, v: CreateRuleInput[K]): void => setForm((p) => ({ ...p, [k]: v }));

  return (
    <form className="panel-form form-row" onSubmit={(e) => submit(e, async () => {
      await api.createRule(token, form);
      onCreated();
    })}>
      <p className="form-title">新增附加费规则</p>
      <p className="form-note">规则一旦启用即参与所有新单的仲裁；历史单保持快照不变。</p>
      <label className="field">
        <span className="field-label">规则标识</span>
        <input className="input mono" value={form.code} maxLength={24} onChange={(e) => set('code', e.target.value)} />
        {fields.code ? <span className="err">{fields.code}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">规则名称</span>
        <input className="input" value={form.name} maxLength={40} onChange={(e) => set('name', e.target.value)} />
        {fields.name ? <span className="err">{fields.name}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">计费方式</span>
        <select className="input" value={form.kind} onChange={(e) => set('kind', e.target.value as RuleKind)}>
          {RULE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {fields.kind ? <span className="err">{fields.kind}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">单件门槛（克）</span>
        <input className="input mono" type="number" min={0} value={form.threshold_g} onChange={(e) => set('threshold_g', Number(e.target.value))} disabled={form.kind !== 'heavy_piece'} />
        {fields.threshold_g ? <span className="err">{fields.threshold_g}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">里程门槛（km）</span>
        <input className="input mono" type="number" min={0} value={form.threshold_km} onChange={(e) => set('threshold_km', Number(e.target.value))} disabled={form.kind !== 'long_haul_flat'} />
        {fields.threshold_km ? <span className="err">{fields.threshold_km}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">费率（%）</span>
        <input className="input mono" type="number" min={0} max={100} value={form.rate_pct} onChange={(e) => set('rate_pct', Number(e.target.value))} disabled={form.kind !== 'remote_pct'} />
        {fields.rate_pct ? <span className="err">{fields.rate_pct}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">固定额（分）</span>
        <input className="input mono" type="number" min={0} value={form.amount_cents} onChange={(e) => set('amount_cents', Number(e.target.value))} />
        {fields.amount_cents ? <span className="err">{fields.amount_cents}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">最低额（分）</span>
        <input className="input mono" type="number" min={0} value={form.min_cents} onChange={(e) => set('min_cents', Number(e.target.value))} disabled={form.kind !== 'remote_pct'} />
        {fields.min_cents ? <span className="err">{fields.min_cents}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">优先级</span>
        <input className="input mono" type="number" min={1} max={99} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
        {fields.priority ? <span className="err">{fields.priority}</span> : null}
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" type="submit" disabled={token === '' || action.busy}>
          {action.busy ? '提交中…' : '新增规则'}
        </button>
      </div>
      {action.message ? <p className="form-msg" data-kind={action.kind ?? 'idle'}>{action.message}</p> : null}
    </form>
  );
}

const RULE_COLS = ['标识', '名称', '计费方式', '门槛', '金额', '优先级', '状态'] as const;

function RuleTable({
  rules,
  loading,
  token,
  onToggled,
}: {
  rules: { id: number; code: string; name: string; kind: RuleKind; threshold_g: number; threshold_km: number; rate_pct: number; amount_cents: number; min_cents: number; priority: number; active: boolean }[];
  loading: boolean;
  token: string;
  onToggled: () => void;
}): React.JSX.Element {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: number): void => {
    setErr(null);
    setBusyId(id);
    api
      .toggleRule(token, id)
      .then(() => onToggled())
      .catch((e: unknown) => {
        const msg = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message?: string }).message) : '操作失败';
        setErr(msg);
      })
      .finally(() => setBusyId(null));
  };

  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">附加费规则：仲裁顺序按优先级升序，同优先级按标识</caption>
        <thead>
          <tr>
            {RULE_COLS.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
            <th scope="col">动作</th>
          </tr>
        </thead>
        <tbody>
          {rules.length === 0 && !loading ? (
            <tr>
              <td className="empty" colSpan={RULE_COLS.length + 1}>
                暂无规则
              </td>
            </tr>
          ) : null}
          {rules.map((r) => (
            <tr key={r.id} tabIndex={0} onKeyDown={(e) => {
              if (e.key === 'Enter') toggle(r.id);
            }}>
              <td className="mono">{r.code}</td>
              <td>{r.name}</td>
              <td>{KIND_LABEL[r.kind]}</td>
              <td className="mono">
                {r.kind === 'heavy_piece' ? kg(r.threshold_g) : null}
                {r.kind === 'long_haul_flat' ? `${r.threshold_km} km` : null}
                {r.kind === 'remote_pct' ? `${r.rate_pct}% 起 ¥${(r.min_cents / 100).toFixed(2)}` : null}
                {r.kind === 'fragile_flat' ? '易碎即收' : null}
              </td>
              <td className="num mono">
                {r.amount_cents > 0 ? yuan(r.amount_cents) : '按运费比例'}
              </td>
              <td className="num mono">{r.priority}</td>
              <td>
                <span className="badge" data-tone={r.active ? 'ok' : 'idle'}>
                  {r.active ? '启用中' : '已停用'}
                </span>
              </td>
              <td>
                <button className="btn btn-mini" type="button" disabled={token === '' || busyId === r.id} onClick={() => toggle(r.id)}>
                  {busyId === r.id ? '提交中…' : r.active ? '停用' : '启用'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {err ? <p className="banner"><span className="banner-tag">规则启停</span>{err}</p> : null}
    </div>
  );
}

function LaneTable({
  lanes,
  loading,
}: {
  lanes: {
    code: string;
    origin: string;
    destination: string;
    tier: Tier;
    distance_km: number;
    first_kg: number;
    first_cents: number;
    half_kg_cents: number;
    min_cents: number;
    fuel_pct: number;
    vol_divisor: number;
    promise_days: number;
    remote_area: boolean;
    active: boolean;
  }[];
  loading: boolean;
}): React.JSX.Element {
  return (
    <ul className="lanes">
      {loading && lanes.length === 0 ? <li className="placeholder">线路加载中…</li> : null}
      {lanes.map((l) => (
        <li className="lane" key={l.code} data-off={l.active ? 'false' : 'true'}>
          <span className="lane-code">{l.code}</span>
          <span className="lane-route">
            {l.origin}→{l.destination} · {TIER_LABEL[l.tier] ?? l.tier} · {l.distance_km} km · {l.promise_days} 日达
          </span>
          <span className="lane-meta">
            首 {l.first_kg}kg {yuan(l.first_cents)} + 每 500g {yuan(l.half_kg_cents)}（最低 {yuan(l.min_cents)}）· 燃油 {l.fuel_pct}% · 抛比 {l.vol_divisor}
            {l.remote_area ? ' · 偏远' : ''}
            {l.active ? '' : ' · 已停售'}
          </span>
        </li>
      ))}
    </ul>
  );
}
