import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  bigKwh,
  count,
  dateTime,
  DAY_TYPE_LABEL,
  kwh,
  minutes as minutesText,
  PERIOD_LABEL,
  pct,
  PILE_LABEL,
  SESSION_LABEL,
  SESSION_ORDER,
  stamp,
  timeOnly,
  toneOfPeriod,
  toneOfPile,
  toneOfStatus,
  windowLabel,
  yuan,
  yuanCompact,
} from './format';
import { initialTheme, persistTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  CreateTariffInput,
  ListParams,
  PileRow,
  PileStatus,
  QuoteResult,
  SessionDetail,
  SessionRow,
  SessStatus,
  SortDir,
  SortKey,
  Stats,
  TariffRule,
  VehicleRow,
} from './types';
import { isOpenSession } from './types';

const TOKEN_KEY = 'biz-site-admin-token';
const TREND_DAYS = 14;
const PAGE_SIZE = 12;

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
  const piles = useAsync(() => api.piles(), []);
  const vehicles = useAsync(() => api.vehicles(true), []);
  const tariffs = useAsync(() => api.tariffs(true), []);

  const [filters, setFilters] = useState<ListParams>({ sort: 'start', dir: 'desc', page_size: PAGE_SIZE });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.sessions({ ...filters, page, page_size: filters.page_size ?? PAGE_SIZE }),
    [filters.status, filters.pile, filters.plate, filters.dept, filters.q, filters.open, filters.sort, filters.dir, page, filters.page_size],
  );

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const detail = useAsync(
    () => (selectedCode === null ? Promise.resolve(null) : api.session(selectedCode)),
    [selectedCode, `${String(list.loading)}:${list.data?.items.length ?? 0}`],
  );

  useEffect(() => {
    if (selectedCode !== null) return;
    const first = list.data?.items[0]?.code;
    if (first !== undefined) setSelectedCode(first);
  }, [list.data, selectedCode]);

  const rows = list.data?.items ?? [];
  const totalRows = list.data?.total ?? 0;
  const pageSize = filters.page_size ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  const pileOptions = useMemo(() => piles.data?.items ?? [], [piles.data]);

  const refreshAll = (): void => {
    list.reload();
    stats.reload();
    piles.reload();
    detail.reload();
  };

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">车队充电运营台</span>
          <span className="brand-sub">Fleet Charging Ops · 分时计价与占桩调度</span>
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

        <label className="tokenbox">
          <span className="field-label">管理令牌</span>
          <input
            className="input mono"
            type="password"
            value={token}
            placeholder="ADMIN_TOKEN"
            autoComplete="off"
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </header>

      <p className="statusline">
        <span>数据口径：{stats.data?.window ?? '加载中…'}</span>
        <span className="mono">服务端生成 {stamp(stats.data?.generated_at ?? '')}</span>
      </p>

      <IdentityBar st={stats.data} />
      <Banner state={stats} label="统计接口" />

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">今日运营</h2>
          <span className="section-note">
            所有金额与电量都来自后端结算快照，前端不重算价；峰平谷之和恒等于实际电量
          </span>
        </div>
        <KpiGrid st={stats.data} />
        <StatusChips st={stats.data} />
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">桩位矩阵</h2>
          <span className="section-note">
            一桩同时最多一条未关闭会话（部分唯一索引兜底）；点卡片可筛选台账
          </span>
        </div>
        <Banner state={piles} label="桩接口" />
        <PileBoard
          piles={pileOptions}
          loading={piles.loading}
          activeCode={filters.pile ?? ''}
          onPick={(code) => {
            setFilters((f) => ({ ...f, pile: f.pile === code ? '' : code }));
            setPage(1);
          }}
        />
        <div className="detail">
          <div className="detail-main">
            <div className="section-head">
              <h3 className="section-title">近 {TREND_DAYS} 日充电趋势</h3>
              <span className="section-note">开充单量 · 结算电量 · 营收</span>
            </div>
            <TrendTable daily={stats.data?.daily ?? []} />
          </div>
          <div className="detail-side">
            <div className="section-head">
              <h3 className="section-title">分时价目板</h3>
              <span className="section-note">与结算同一套仲裁口径</span>
            </div>
            <RateBoard windows={stats.data?.rate_board ?? []} />
          </div>
        </div>
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">充电台账</h2>
          <span className="section-note">共 {count(totalRows)} 条 · 排序字段全部走后端白名单</span>
        </div>
        <Banner state={list} label="台账接口" />
        <Filters
          value={filters}
          page={page}
          pages={pages}
          piles={pileOptions}
          vehicles={vehicles.data?.items ?? []}
          onChange={(next) => {
            setFilters((f) => ({ ...f, ...next.next }));
            if (next.resetPage) setPage(1);
          }}
          onPage={setPage}
        />
        <SessionTable
          rows={rows}
          loading={list.loading}
          sortKey={list.data?.sort ?? 'start'}
          dir={list.data?.dir ?? 'desc'}
          selected={selectedCode}
          onSort={(key) => {
            const nextDir: SortDir = filters.sort === key && filters.dir === 'asc' ? 'desc' : 'asc';
            setFilters((f) => ({ ...f, sort: key, dir: nextDir }));
          }}
          onPick={(code) => setSelectedCode(code)}
        />
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">会话详情与调度动作</h2>
          <span className="section-note">开充 → 在充 → （故障挂起）→ 结算 / 弃单；终态不可回退</span>
        </div>
        <DetailPanel state={detail} />
        <div className="detail">
          <div className="detail-main">
            <SettleForm
              token={token}
              session={detail.data}
              onDone={refreshAll}
            />
          </div>
          <div className="detail-side">
            <StateForm token={token} session={detail.data} onDone={refreshAll} />
            <StartSessionForm
              token={token}
              piles={pileOptions.filter((p) => p.status === 'online' && p.open_sessions === 0)}
              vehicles={(vehicles.data?.items ?? []).filter((v) => v.active)}
              onStart={(code) => {
                setSelectedCode(code);
                refreshAll();
              }}
            />
          </div>
        </div>
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">计价试算</h2>
          <span className="section-note">与结算共用同一个后端引擎：报价即账，不存在两套价</span>
        </div>
        <div className="form-grid">
          <QuotePanel piles={pileOptions.filter((p) => p.status === 'online')} />
          <PileStatusForm
            token={token}
            piles={pileOptions}
            onDone={() => {
              piles.reload();
              stats.reload();
              list.reload();
            }}
          />
        </div>
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">车队与价目规则</h2>
          <span className="section-note">规则停用后立即不参与仲裁；司机手机号只出掩码</span>
        </div>
        <Banner state={vehicles} label="车辆接口" />
        <VehicleTable rows={vehicles.data?.items ?? []} loading={vehicles.loading} />
        <Banner state={tariffs} label="规则接口" />
        <RuleTable
          rules={tariffs.data?.items ?? []}
          loading={tariffs.loading}
          token={token}
          onToggled={() => {
            tariffs.reload();
            stats.reload();
          }}
        />
        <CreateTariffForm
          token={token}
          onCreated={() => {
            tariffs.reload();
            stats.reload();
          }}
        />
        <p className="footnote">
          接口：GET /api/health · /api/piles · /api/vehicles · /api/tariffs · /api/stats · /api/quote ·
          /api/sessions · /api/sessions/&#123;code&#125;；POST /api/admin/sessions ·
          /api/admin/sessions/&#123;code&#125;/settle · /fault · /abort · /api/admin/tariffs ·
          /api/admin/tariffs/&#123;id&#125;/toggle · /api/admin/piles/&#123;code&#125;/status。 当前桩{' '}
          {piles.data?.total ?? 0} 台 · 车 {(vehicles.data?.total ?? 0).toString()} 台 · 规则{' '}
          {tariffs.data?.total ?? 0} 条 · 会话 {count(totalRows)} 单。
        </p>
      </section>
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
        后端实时自检：
        {st.identity_ok
          ? '总额恒等式、分时拆分恒等式、结算标记一致性、占桩互斥与四组分项合计全部成立'
          : '恒等式出现破口，已中止对外报价'}
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
  const v = (n: number | undefined, f: (x: number) => string): string => (n === undefined ? '—' : f(n));
  const kpis: Kpi[] = [
    { key: 'rev', label: '累计营收', value: v(st?.revenue_cents, yuanCompact), hint: '电费+服务费+超时占用费，只计已结算单' },
    { key: 'revToday', label: '今日营收', value: v(st?.revenue_today_cents, yuanCompact), hint: '按 UTC+8 日历日' },
    { key: 'kwhToday', label: '今日结算电量', value: v(st?.kwh_today, bigKwh), hint: '已入帐电量' },
    { key: 'started', label: '今日开充', value: v(st?.started_today, count), hint: '含在充与已结算' },
    { key: 'charging', label: '在充会话', value: v(st?.charging_now, count), hint: '占用桩位中' },
    {
      key: 'faulted',
      label: '故障挂起',
      value: v(st?.faulted_count, count),
      hint: '可补结算，也可弃单',
      warn: (st?.faulted_count ?? 0) > 0,
    },
    { key: 'total', label: '会话总数', value: v(st?.total_sessions, count), hint: '含全部历史口径' },
    { key: 'kwh', label: '累计电量', value: v(st?.total_kwh, bigKwh), hint: '结算口径合计' },
    { key: 'avgPrice', label: '度电均价', value: v(st?.avg_price_cents_per_kwh, (x) => `${x} 分/kWh`), hint: '营收 ÷ 总电量' },
    {
      key: 'peak',
      label: '峰段电量占比',
      value: v(st?.peak_pct, pct),
      hint: st === null ? '—' : `峰 ${count(st.peak_kwh)} · 平 ${count(st.flat_kwh)} · 谷 ${count(st.valley_kwh)} kWh`,
      warn: st !== null && st.peak_pct > 50,
    },
    { key: 'valley', label: '谷段电量占比', value: v(st?.valley_pct, pct), hint: '夜充比例越高越省' },
    {
      key: 'overstay',
      label: '超时占桩率',
      value: v(st?.overstay_rate_pct, pct),
      hint: st === null ? '—' : `超时费 ${yuan(st.overstay_cents)} · 8 分/分钟封顶 360 分`,
      warn: st !== null && st.overstay_rate_pct > 30,
    },
    { key: 'dur', label: '平均充电时长', value: v(st?.avg_duration_min, minutesText), hint: '已结算单' },
    {
      key: 'piles',
      label: '桩在线率',
      value: v(st?.pile_online_pct, pct),
      hint: st === null ? '—' : `在线 ${count(st.pile_online)} / 共 ${count(st.pile_total)} 台`,
      warn: st !== null && st.pile_online_pct < 80,
    },
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

function StatusChips({ st }: { st: Stats | null }): React.JSX.Element {
  if (st === null) return <div className="chips" />;
  const map = new Map(st.by_status.map((x) => [x.status, x.count]));
  return (
    <div className="chips">
      {SESSION_ORDER.map((s) => (
        <span className="chip" key={s} data-tone={toneOfStatus(s)}>
          <b className="chip-key">{SESSION_LABEL[s]}</b>
          <i className="chip-val mono">{count(map.get(s) ?? 0)}</i>
        </span>
      ))}
      <span className="chip" data-tone="info">
        <b className="chip-key">在册车辆</b>
        <i className="chip-val mono">{count(st.vehicle_total)}</i>
      </span>
    </div>
  );
}

function PileBoard({
  piles,
  loading,
  activeCode,
  onPick,
}: {
  piles: PileRow[];
  loading: boolean;
  activeCode: string;
  onPick: (code: string) => void;
}): React.JSX.Element {
  if (loading && piles.length === 0) return <p className="placeholder">桩位数据加载中…</p>;
  return (
    <ul className="piles">
      {piles.map((p) => (
        <li
          key={p.code}
          className="pile"
          data-tone={toneOfPile(p.status)}
          data-off={p.status === 'online' ? 'false' : 'true'}
          data-selected={activeCode === p.code ? 'true' : 'false'}
        >
          <button type="button" className="pile-code" onClick={() => onPick(p.code)}>
            {p.code}
          </button>
          <span className="pile-name">
            {p.station} · {p.bay}
          </span>
          <span className="pile-meta mono">
            {p.type === 'dc' ? 'DC' : 'AC'} {p.power_kw}kW · {PILE_LABEL[p.status]}
          </span>
          <span className="pile-meta mono">
            会话 {count(p.sessions)} · {count(p.energy_kwh)} kWh
            {p.open_sessions > 0 ? ` · 占用 ${count(p.open_sessions)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RateBoard({ windows }: { windows: Stats['rate_board'] }): React.JSX.Element {
  if (windows.length === 0) return <p className="placeholder">暂无启用规则，价目板为空。</p>;
  const weekday = windows.filter((w) => w.day_type !== 'weekend');
  const weekend = windows.filter((w) => w.day_type === 'weekend');
  return (
    <div className="bars">
      <BarGroup title="工作日" rows={weekday} />
      <BarGroup title="周末" rows={weekend} />
    </div>
  );
}

function BarGroup({ title, rows }: { title: string; rows: Stats['rate_board'] }): React.JSX.Element {
  const totalMin = rows.reduce((acc, w) => {
    const toMin = (t: string): number => {
      const [hh = '0', mm = '0'] = t.split(':');
      return Number(hh) * 60 + Number(mm);
    };
    const [from = '00:00', to = '24:00'] = w.window.split('-');
    const span = toMin(to) - toMin(from);
    return acc + (span <= 0 ? span + 1440 : span);
  }, 0);
  return (
    <article className="bar">
      <header className="bar-head">
        <span className="bar-name">{title}</span>
        <span className="bar-value mono">{totalMin} 分钟已定价</span>
      </header>
      <ul className="lotlist">
        {rows.map((w, i) => (
          <li className="lotrow" key={`${title}-${w.rule_code}-${i}`} data-tone={toneOfPeriod(w.period)}>
            <span className="cell-strong mono">{w.window}</span>
            <span className="cell-sub">
              {PERIOD_LABEL[w.period]} · {w.rule_code}
            </span>
            <span className="mono">
              电 {w.elec_cents_per_kwh} 分 · 服 {w.service_cents_per_kwh} 分
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function TrendTable({ daily }: { daily: Stats['daily'] }): React.JSX.Element {
  if (daily.length === 0) return <p className="placeholder">趋势数据加载中…</p>;
  const maxKwh = Math.max(1, ...daily.map((d) => d.kwh));
  const maxRev = Math.max(1, ...daily.map((d) => d.revenue_cents));
  return (
    <div className="bars">
      {daily.map((d) => (
        <article className="bar" key={d.day}>
          <header className="bar-head">
            <span className="bar-name mono">{d.day}</span>
            <span className="bar-value mono">
              {count(d.sessions)} 单 · {count(d.kwh)} kWh · {yuanCompact(d.revenue_cents)}
            </span>
          </header>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${barWidth(d.kwh, maxKwh)}%` }} />
          </span>
          <span className="bar-track">
            <span className="bar-fill bar-fill-alt" style={{ width: `${barWidth(d.revenue_cents, maxRev)}%` }} />
          </span>
          <footer className="bar-foot">上条=结算电量，下条=营收（同一坐标系相对最大值）</footer>
        </article>
      ))}
    </div>
  );
}

// 条形宽度只在这里换算：CSS 负责外观，结构层负责唯一一次宽度计算。
const barWidth = (v: number, max: number): number =>
  Math.min(100, Math.max(0, Math.round((v * 100) / max)));

const FILTER_STATUSES: readonly (SessStatus | '')[] = ['', ...SESSION_ORDER];

function Filters({
  value,
  page,
  pages,
  piles,
  vehicles,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  pages: number;
  piles: PileRow[];
  vehicles: VehicleRow[];
  onChange: (next: { next: Partial<ListParams>; resetPage: boolean }) => void;
  onPage: (p: number) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState(value.q ?? '');
  useEffect(() => {
    if (search === (value.q ?? '')) return;
    const id = window.setTimeout(() => onChange({ next: { q: search }, resetPage: true }), 320);
    return () => window.clearTimeout(id);
  }, [search, onChange, value.q]);

  const depts = useMemo(() => Array.from(new Set(vehicles.map((v) => v.dept))).sort(), [vehicles]);

  return (
    <div className="filters">
      <label className="field">
        <span className="field-label">状态</span>
        <select
          className="input"
          value={value.status ?? ''}
          onChange={(e) => onChange({ next: { status: e.target.value as SessStatus | '' }, resetPage: true })}
        >
          {FILTER_STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s === '' ? '全部状态' : SESSION_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">只看未关闭</span>
        <select
          className="input"
          value={value.open === 1 ? '1' : ''}
          onChange={(e) => onChange({ next: { open: e.target.value === '1' ? 1 : undefined }, resetPage: true })}
        >
          <option value="">否</option>
          <option value="1">是（在充+故障）</option>
        </select>
      </label>

      <label className="field">
        <span className="field-label">桩编号</span>
        <select
          className="input mono"
          value={value.pile ?? ''}
          onChange={(e) => onChange({ next: { pile: e.target.value }, resetPage: true })}
        >
          <option value="">全部桩位</option>
          {piles.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.station}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">车队</span>
        <select
          className="input"
          value={value.dept ?? ''}
          onChange={(e) => onChange({ next: { dept: e.target.value }, resetPage: true })}
        >
          <option value="">全部车队</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">车牌（精确）</span>
        <input
          className="input mono"
          value={value.plate ?? ''}
          placeholder="沪AD12345"
          maxLength={16}
          onChange={(e) => onChange({ next: { plate: e.target.value.toUpperCase() }, resetPage: true })}
        />
      </label>

      <label className="field field-wide">
        <span className="field-label">关键字</span>
        <input
          className="input"
          value={search}
          placeholder="会话编号 / 车牌 / 司机 / 场站"
          maxLength={40}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">每页</span>
        <select
          className="input mono"
          value={String(value.page_size ?? PAGE_SIZE)}
          onChange={(e) => onChange({ next: { page_size: Number(e.target.value) }, resetPage: true })}
        >
          {[12, 20, 40, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="pager">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <span className="pager-now mono">
          {page} / {pages}
        </span>
        <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

const SORT_KEYS: readonly { key: SortKey; label: string }[] = [
  { key: 'code', label: '编号' },
  { key: 'start', label: '开始' },
  { key: 'end', label: '结束' },
  { key: 'energy', label: '电量' },
  { key: 'total', label: '金额' },
  { key: 'status', label: '状态' },
  { key: 'pile', label: '桩' },
  { key: 'plate', label: '车牌' },
  { key: 'overstay', label: '超时' },
];

function SessionTable({
  rows,
  loading,
  sortKey,
  dir,
  selected,
  onSort,
  onPick,
}: {
  rows: SessionRow[];
  loading: boolean;
  sortKey: SortKey;
  dir: SortDir;
  selected: string | null;
  onSort: (key: SortKey) => void;
  onPick: (code: string) => void;
}): React.JSX.Element {
  if (loading && rows.length === 0) return <p className="placeholder">台账加载中…</p>;
  if (rows.length === 0) return <p className="empty">没有符合条件的会话。</p>;
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th>会话</th>
            {SORT_KEYS.map((s) => (
              <th key={s.key}>
                <button type="button" className="sortbtn" onClick={() => onSort(s.key)}>
                  {s.label}
                  <span className="sortmark">{sortKey === s.key ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
            <th>时长/功率</th>
            <th>司机</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.code}
              data-selected={r.code === selected ? 'true' : 'false'}
              onClick={() => onPick(r.code)}
            >
              <td className="cell-strong mono">{r.code}</td>
              <td className="mono">{r.pile_code}</td>
              <td className="mono">{r.plate_no}</td>
              <td>{r.dept}</td>
              <td>
                <span className="badge" data-tone={toneOfStatus(r.status)}>
                  {SESSION_LABEL[r.status]}
                </span>
              </td>
              <td className="num mono">{r.actual_wh > 0 ? kwh(r.actual_wh) : '—'}</td>
              <td className="num mono">{r.total_cents > 0 ? yuan(r.total_cents) : '—'}</td>
              <td className="num mono">{r.overstay_min > 0 ? `${r.overstay_min} 分` : '—'}</td>
              <td className="mono">{timeOnly(r.start_at)}</td>
              <td className="mono">{r.end_at === null ? '未结束' : timeOnly(r.end_at)}</td>
              <td className="mono">
                {r.duration_min} 分 · {r.avg_power_kw} kW
              </td>
              <td className="cell-sub">
                {r.driver_name} <span className="mono">{r.phone_masked}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailPanel({
  state,
}: {
  state: { data: SessionDetail | null; loading: boolean; error: string | null };
}): React.JSX.Element {
  const d = state.data;
  if (d === null) return <p className="placeholder">{state.error ?? '选择左侧台账里的一行查看详情。'}</p>;
  const segTotal = d.segments.reduce((a, s) => a + s.wh, 0);
  return (
    <div className="detail">
      <div className="detail-main">
        <dl className="facts">
          <div className="fact">
            <dt>会话编号</dt>
            <dd className="mono">{d.code}</dd>
          </div>
          <div className="fact">
            <dt>状态</dt>
            <dd>
              <span className="badge" data-tone={toneOfStatus(d.status)}>
                {SESSION_LABEL[d.status]}
              </span>
            </dd>
          </div>
          <div className="fact">
            <dt>桩位</dt>
            <dd className="mono">
              {d.pile_code} · {d.station} {d.bay} · {d.power_kw}kW
            </dd>
          </div>
          <div className="fact">
            <dt>车辆</dt>
            <dd className="mono">
              {d.plate_no} · {d.dept}
            </dd>
          </div>
          <div className="fact">
            <dt>司机</dt>
            <dd>
              {d.driver_name} <span className="mono">{d.phone_masked}</span>
            </dd>
          </div>
          <div className="fact">
            <dt>开始 / 结束</dt>
            <dd className="mono">
              {dateTime(d.start_at)} → {d.end_at === null ? '进行中' : dateTime(d.end_at)}
            </dd>
          </div>
          <div className="fact">
            <dt>计划 / 实际电量</dt>
            <dd className="mono">
              {kwh(d.planned_wh)} / {d.actual_wh > 0 ? kwh(d.actual_wh) : '未记录'}
            </dd>
          </div>
          <div className="fact">
            <dt>时长 · 平均功率</dt>
            <dd className="mono">
              {d.duration_min} 分 · {d.avg_power_kw} kW
            </dd>
          </div>
        </dl>
        {d.note !== '' ? <p className="hint">{d.note}</p> : null}
        {d.covered === false ? (
          <p className="banner" role="status">
            <span className="banner-tag">未定价窗口</span>
            有 {count(d.seg_unpriced_wh)} Wh 落在无启用规则覆盖的时间段内，这部分电量计零元。
          </p>
        ) : null}
      </div>

      <div className="detail-side">
        <div className="section-head">
          <h3 className="section-title">分时拆分</h3>
          <span className="section-note">峰+平+谷+未定价 = 实际电量</span>
        </div>
        {d.segments.length === 0 ? (
          <p className="placeholder">
            {isOpenSession(d.status) ? '会话未结算，暂无拆分。' : '本次会话没有产生计费电量。'}
          </p>
        ) : (
          <div className="bill">
            {d.segments.map((s, i) => (
              <p className="bill-row" key={`${s.rule_code}-${i}`} data-tone={toneOfPeriod(s.period)}>
                <span className="bill-key mono">
                  {timeOnly(s.start_at)}-{timeOnly(s.end_at)} · {s.minutes}分
                </span>
                <span className="bill-sub">{PERIOD_LABEL[s.period]} {s.rule_name}</span>
                <span className="bill-val mono">{kwh(s.wh)}</span>
                <span className="bill-rule mono">
                  电 {yuan(s.elec_cents)} · 服 {yuan(s.service_cents)}
                </span>
              </p>
            ))}
            {d.seg_unpriced_wh > 0 ? (
              <p className="bill-row">
                <span className="bill-key mono">未定价</span>
                <span className="bill-sub">无启用规则覆盖</span>
                <span className="bill-val mono">{kwh(d.seg_unpriced_wh)}</span>
                <span className="bill-rule mono">电 ¥0.00 · 服 ¥0.00</span>
              </p>
            ) : null}
            <p className="bill-total">
              <span className="bill-total-key">
                合计 {count(segTotal + d.seg_unpriced_wh)} Wh · 峰 {count(d.seg_peak_wh)} / 平{' '}
                {count(d.seg_flat_wh)} / 谷 {count(d.seg_valley_wh)}
              </span>
              <span className="bill-total-val mono">
                电费 {yuan(d.elec_cents)} + 服务费 {yuan(d.service_cents)} + 超时{' '}
                {yuan(d.overstay_cents)} = {yuan(d.total_cents)}
              </span>
            </p>
          </div>
        )}
        <p className="hint">
          结算当时生效的价目窗口共 {d.rate_board.length} 段（与 /api/stats 的价目板同源）。
        </p>
      </div>
    </div>
  );
}

function FormMessage({ action }: { action: ReturnType<typeof useAction> }): React.JSX.Element | null {
  if (action.message === null) return null;
  const err = action.lastError;
  const fields = err?.fields ?? {};
  const keys = Object.keys(fields);
  return (
    <p className="form-msg" data-kind={action.kind ?? 'idle'} role="status">
      <span>{action.message}</span>
      {keys.length > 0 ? (
        <span className="err">
          {keys.map((k) => (
            <span key={k} className="hint">
              {k}：{fields[k]}
            </span>
          ))}
        </span>
      ) : null}
      {err?.code === 'server_misconfigured' ? <span className="hint">后端未设置 ADMIN_TOKEN</span> : null}
      {err?.code === 'unauthorized' ? <span className="hint">请在顶栏填写管理令牌</span> : null}
    </p>
  );
}

function SettleForm({
  token,
  session,
  onDone,
}: {
  token: string;
  session: SessionDetail | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [wh, setWh] = useState('30000');
  const [overstay, setOverstay] = useState('0');
  const open = session !== null && isOpenSession(session.status);

  const submit = (): void => {
    if (session === null) return;
    action.run(async () => {
      await api.settle(token, session.code, {
        actual_wh: Number(wh),
        overstay_min: Number(overstay),
        faulted_settled: session.status === 'faulted',
      });
      onDone();
    });
  };

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="form-title">结算会话</h3>
      <p className="form-note">
        {open
          ? `按 ${session?.pile_code ?? ''}（${session?.power_kw ?? 0}kW）满功率复核电量，拆段计价由后端完成。`
          : '当前选中会话已是终态：换一条在充/故障挂起的会话，或先新建开充。'}
      </p>
      <label className="field">
        <span className="field-label">实际电量（Wh）</span>
        <input
          className="input mono"
          type="number"
          min={100}
          max={600000}
          step={20}
          value={wh}
          disabled={!open}
          onChange={(e) => setWh(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">超时占桩（分钟，封顶 360）</span>
        <input
          className="input mono"
          type="number"
          min={0}
          max={360}
          value={overstay}
          disabled={!open}
          onChange={(e) => setOverstay(e.target.value)}
        />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={!open || action.busy || token === ''}>
          {action.busy ? '提交中…' : '结算并出账'}
        </button>
      </div>
      <FormMessage action={action} />
    </form>
  );
}

function StateForm({
  token,
  session,
  onDone,
}: {
  token: string;
  session: SessionDetail | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [reason, setReason] = useState('枪座过温保护');

  if (session === null) return <p className="placeholder">未选择会话。</p>;
  const canFault = session.status === 'charging';
  const canAbort = session.status === 'faulted';

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <h3 className="form-title">异常处置</h3>
      <p className="form-note">故障挂起仍占桩；弃单会把电量与费用全部作废并保留审计痕迹。</p>
      <label className="field">
        <span className="field-label">原因</span>
        <input className="input" maxLength={80} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          disabled={!canFault || action.busy || token === ''}
          onClick={() =>
            action.run(async () => {
              await api.fault(token, session.code, { reason });
              onDone();
            })
          }
        >
          登记故障
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canAbort || action.busy || token === ''}
          onClick={() =>
            action.run(async () => {
              await api.abort(token, session.code, { reason });
              onDone();
            })
          }
        >
          弃单作废
        </button>
      </div>
      <FormMessage action={action} />
    </form>
  );
}

function StartSessionForm({
  token,
  piles,
  vehicles,
  onStart,
}: {
  token: string;
  piles: PileRow[];
  vehicles: VehicleRow[];
  onStart: (code: string) => void;
}): React.JSX.Element {
  const action = useAction();
  const [pile, setPile] = useState('');
  const [plate, setPlate] = useState('');
  const [planned, setPlanned] = useState('40000');
  const [note, setNote] = useState('');
  // 一桩一车只允许一条未关闭会话（后端有部分唯一索引兜底），这里只把明显不可用的选项收起来。
  const freePiles = piles.filter((p) => p.status === 'online' && p.open_sessions === 0);
  const candidates = vehicles.filter((v) => v.active);
  const currentPile = piles.find((p) => p.code === pile) ?? freePiles[0];

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          const created = await api.start(token, {
            pile_code: currentPile?.code ?? '',
            plate_no: plate,
            planned_wh: Number(planned),
            note,
          });
          onStart(created.code);
        });
      }}
    >
      <h3 className="form-title">新建开充</h3>
      <p className="form-note">只有在线且无未关闭会话的桩可选；计划电量不得超过车辆电池容量。</p>
      <label className="field">
        <span className="field-label">充电桩</span>
        <select className="input mono" value={currentPile?.code ?? ''} onChange={(e) => setPile(e.target.value)}>
          <option value="">请选择</option>
          {freePiles.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.station} · {p.power_kw}kW
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">车牌</span>
        <select className="input mono" value={plate} onChange={(e) => setPlate(e.target.value)}>
          <option value="">请选择</option>
          {candidates.map((v) => (
            <option key={v.plate_no} value={v.plate_no}>
              {v.plate_no} · {v.dept} · {v.battery_kwh}kWh
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">计划电量（Wh）</span>
        <input
          className="input mono"
          type="number"
          min={100}
          max={600000}
          step={100}
          value={planned}
          onChange={(e) => setPlanned(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">备注</span>
        <input className="input" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={action.busy || token === '' || plate === ''}>
          {action.busy ? '提交中…' : '开始充电'}
        </button>
      </div>
      <FormMessage action={action} />
    </form>
  );
}

function QuotePanel({ piles }: { piles: PileRow[] }): React.JSX.Element {
  const [pile, setPile] = useState(piles[0]?.code ?? 'DC-A01');
  const [wh, setWh] = useState('40000');
  const [mins, setMins] = useState('120');
  const [delay, setDelay] = useState('0');
  const [overstay, setOverstay] = useState('0');
  const action = useAction();
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  const effect = quote === null ? null : effectOf(quote);

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          const q = await api.quote({
            pile,
            wh: Number(wh),
            minutes: Number(mins),
            delay_min: Number(delay),
            overstay_min: Number(overstay),
          });
          setQuote(q);
        });
      }}
    >
      <h3 className="form-title">分时计价试算</h3>
      <p className="form-note">
        口径：从现在起 delay 分钟后开充，充 minutes 分钟、灌入 wh 瓦时，与结算走同一段代码。
      </p>
      <label className="field">
        <span className="field-label">充电桩</span>
        <select className="input mono" value={pile} onChange={(e) => setPile(e.target.value)}>
          {piles.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.station} · {p.power_kw}kW
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">电量（Wh）</span>
        <input className="input mono" type="number" min={100} max={600000} step={100} value={wh} onChange={(e) => setWh(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">时长（分钟）</span>
        <input className="input mono" type="number" min={5} max={1440} value={mins} onChange={(e) => setMins(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">延迟开充（分钟）</span>
        <input className="input mono" type="number" min={0} max={10080} value={delay} onChange={(e) => setDelay(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">超时占桩（分钟）</span>
        <input className="input mono" type="number" min={0} max={360} value={overstay} onChange={(e) => setOverstay(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          {action.busy ? '试算中…' : '出报价'}
        </button>
        {effect !== null ? (
          <span className="hint">
            挪到{effect.dir} {effect.minutes} 分钟可省 {yuan(effect.saveCents)}
          </span>
        ) : null}
      </div>
      <FormMessage action={action} />
      {quote !== null ? <QuoteBill q={quote} /> : null}
    </form>
  );
}

function effectOf(q: QuoteResult): { dir: '前' | '后'; minutes: number; saveCents: number } | null {
  // 纯展示用：把最贵一段的电量挪到最便宜一段的差额，作为「挪一挪能省多少」的提示。
  if (q.segments.length < 2) return null;
  const price = (wh: number, e: number, s: number): number => Math.round((wh * (e + s)) / 1000);
  const sorted = [...q.segments].sort(
    (a, b) => a.elec_cents + a.service_cents - (b.elec_cents + b.service_cents),
  );
  const worst = sorted[sorted.length - 1];
  const best = sorted[0];
  if (worst === best || worst === undefined || best === undefined) return null;
  const wp = price(worst.wh, worst.elec_cents / worst.wh * 1000, worst.service_cents / worst.wh * 1000);
  const bp = price(worst.wh, best.elec_cents / best.wh * 1000, best.service_cents / best.wh * 1000);
  const save = wp - bp;
  if (save <= 0) return null;
  return { dir: best.start_at < worst.start_at ? '前' : '后', minutes: worst.minutes, saveCents: save };
}

function QuoteBill({ q }: { q: QuoteResult }): React.JSX.Element {
  return (
    <div className="bill">
      <p className="bill-line">
        <span className="bill-key">窗口</span>
        <span className="bill-val mono">
          {dateTime(q.start_at)} → {dateTime(q.end_at)} · {q.minutes} 分 · {q.pile_code} {q.power_kw}kW
        </span>
      </p>
      {q.segments.map((s, i) => (
        <p className="bill-row" key={`${s.rule_code}-${i}`} data-tone={toneOfPeriod(s.period)}>
          <span className="bill-key mono">
            {timeOnly(s.start_at)}-{timeOnly(s.end_at)} · {s.minutes}分
          </span>
          <span className="bill-sub">
            {PERIOD_LABEL[s.period]} {s.rule_name}
          </span>
          <span className="bill-val mono">{kwh(s.wh)}</span>
          <span className="bill-rule mono">
            电 {yuan(s.elec_cents)} · 服 {yuan(s.service_cents)}
          </span>
        </p>
      ))}
      {q.unpriced_wh > 0 ? (
        <p className="bill-row" data-tone="idle">
          <span className="bill-key mono">未定价 {q.unpriced_min} 分</span>
          <span className="bill-sub">无启用规则覆盖，金额为零</span>
          <span className="bill-val mono">{kwh(q.unpriced_wh)}</span>
          <span className="bill-rule mono">电 ¥0.00 · 服 ¥0.00</span>
        </p>
      ) : null}
      <p className="bill-total">
        <span className="bill-total-key">
          度电均价 {q.avg_price_cents_per_kwh} 分 · 峰 {count(q.peak_wh)} / 平 {count(q.flat_wh)} / 谷{' '}
          {count(q.valley_wh)} Wh
        </span>
        <span className="bill-total-val mono">
          电费 {yuan(q.elec_cents)} + 服务费 {yuan(q.service_cents)} + 超时 {yuan(q.overstay_cents)} ={' '}
          {yuan(q.total_cents)}
        </span>
      </p>
      <p className="hint" data-ok={q.identity_ok ? 'true' : 'false'}>
        {q.identity_ok ? '恒等式自检通过：分段之和与总额一致' : '恒等式破口，请勿使用该报价'} · {q.tariff_rule}
      </p>
    </div>
  );
}

function VehicleTable({ rows, loading }: { rows: VehicleRow[]; loading: boolean }): React.JSX.Element {
  if (loading && rows.length === 0) return <p className="placeholder">车辆加载中…</p>;
  return (
    <div className="tablewrap">
      <table className="table mini">
        <thead>
          <tr>
            <th>车牌</th>
            <th>车型</th>
            <th>车队</th>
            <th className="num">电池</th>
            <th>司机</th>
            <th>联系电话</th>
            <th>充电卡</th>
            <th className="num">会话</th>
            <th className="num">累计电量</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.plate_no}>
              <td className="cell-strong mono">{v.plate_no}</td>
              <td>{v.model}</td>
              <td>{v.dept}</td>
              <td className="num mono">{v.battery_kwh} kWh</td>
              <td>{v.driver_name}</td>
              <td className="mono">{v.phone_masked}</td>
              <td className="mono">{v.card_no}</td>
              <td className="num mono">{count(v.sessions)}</td>
              <td className="num mono">{count(v.energy_kwh)} kWh</td>
              <td>
                <span className="badge" data-tone={v.active ? 'ok' : 'idle'}>
                  {v.active ? '在册' : '已退役'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RuleTable({
  rules,
  loading,
  token,
  onToggled,
}: {
  rules: TariffRule[];
  loading: boolean;
  token: string;
  onToggled: () => void;
}): React.JSX.Element {
  const action = useAction();
  if (loading && rules.length === 0) return <p className="placeholder">规则加载中…</p>;
  return (
    <div className="tablewrap">
      <table className="table mini">
        <thead>
          <tr>
            <th>标识</th>
            <th>名称</th>
            <th>档位</th>
            <th>日期类型</th>
            <th>窗口</th>
            <th className="num">电价</th>
            <th className="num">服务费</th>
            <th className="num">优先级</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.code}>
              <td className="cell-strong mono">{r.code}</td>
              <td>{r.name}</td>
              <td>
                <span className="badge" data-tone={toneOfPeriod(r.period)}>
                  {PERIOD_LABEL[r.period]}
                </span>
              </td>
              <td>{DAY_TYPE_LABEL[r.day_type]}</td>
              <td className="mono">{windowLabel(r.start_min, r.end_min)}</td>
              <td className="num mono">{r.elec_cents_per_kwh} 分</td>
              <td className="num mono">{r.service_cents_per_kwh} 分</td>
              <td className="num mono">{r.priority}</td>
              <td>
                <span className="badge" data-tone={r.active ? 'ok' : 'idle'}>
                  {r.active ? '启用' : '停用'}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-mini"
                  disabled={token === '' || action.busy}
                  onClick={() =>
                    action.run(async () => {
                      await api.toggleTariff(token, r.id);
                      onToggled();
                    })
                  }
                >
                  {r.active ? '停用' : '启用'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_RULE: CreateTariffInput = {
  code: '',
  name: '',
  period: 'valley',
  day_type: 'weekday',
  start_min: 0,
  end_min: 420,
  elec_cents_per_kwh: 35,
  service_cents_per_kwh: 10,
  priority: 50,
};

function CreateTariffForm({ token, onCreated }: { token: string; onCreated: () => void }): React.JSX.Element {
  const action = useAction();
  const [form, setForm] = useState<CreateTariffInput>(EMPTY_RULE);
  const set = <K extends keyof CreateTariffInput>(k: K, v: CreateTariffInput[K]): void =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          await api.createTariff(token, form);
          setForm(EMPTY_RULE);
          onCreated();
        });
      }}
    >
      <h3 className="form-title">新增分时规则</h3>
      <p className="form-note">窗口按本地分钟边界，支持跨零点（如 23:00-07:00）；优先级小者在同分钟胜出。</p>
      <label className="field">
        <span className="field-label">标识 code</span>
        <input className="input mono" maxLength={24} value={form.code} onChange={(e) => set('code', e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">名称</span>
        <input className="input" maxLength={40} value={form.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">档位</span>
        <select className="input" value={form.period} onChange={(e) => set('period', e.target.value as CreateTariffInput['period'])}>
          <option value="peak">峰段</option>
          <option value="flat">平段</option>
          <option value="valley">谷段</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">日期类型</span>
        <select className="input" value={form.day_type} onChange={(e) => set('day_type', e.target.value as CreateTariffInput['day_type'])}>
          <option value="any">每天</option>
          <option value="weekday">工作日</option>
          <option value="weekend">周末</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">开始（分钟）</span>
        <input className="input mono" type="number" min={0} max={1439} value={form.start_min} onChange={(e) => set('start_min', Number(e.target.value))} />
      </label>
      <label className="field">
        <span className="field-label">结束（分钟）</span>
        <input className="input mono" type="number" min={1} max={1440} value={form.end_min} onChange={(e) => set('end_min', Number(e.target.value))} />
      </label>
      <label className="field">
        <span className="field-label">电价（分/kWh）</span>
        <input className="input mono" type="number" min={1} max={300} value={form.elec_cents_per_kwh} onChange={(e) => set('elec_cents_per_kwh', Number(e.target.value))} />
      </label>
      <label className="field">
        <span className="field-label">服务费（分/kWh）</span>
        <input className="input mono" type="number" min={0} max={300} value={form.service_cents_per_kwh} onChange={(e) => set('service_cents_per_kwh', Number(e.target.value))} />
      </label>
      <label className="field">
        <span className="field-label">优先级</span>
        <input className="input mono" type="number" min={1} max={999} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={token === '' || action.busy}>
          {action.busy ? '提交中…' : '创建并启用'}
        </button>
      </div>
      <FormMessage action={action} />
    </form>
  );
}

function PileStatusForm({
  token,
  piles,
  onDone,
}: {
  token: string;
  piles: PileRow[];
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [code, setCode] = useState(piles[0]?.code ?? '');
  const [status, setStatus] = useState<PileStatus>('maintenance');
  const [note, setNote] = useState('定期年检');

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          await api.pileStatus(token, code, { status, note });
          onDone();
        });
      }}
    >
      <h3 className="form-title">桩位状态切换</h3>
      <p className="form-note">切出在线态前必须没有未关闭会话，否则后端以 pile_busy 409 拒绝。</p>
      <label className="field">
        <span className="field-label">充电桩</span>
        <select className="input mono" value={code} onChange={(e) => setCode(e.target.value)}>
          {piles.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {PILE_LABEL[p.status]} · 未关闭 {p.open_sessions}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">目标状态</span>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PileStatus)}>
          <option value="online">在线</option>
          <option value="maintenance">维保中</option>
          <option value="offline">离线</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">备注</span>
        <input className="input" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={token === '' || action.busy || code === ''}>
          {action.busy ? '提交中…' : '提交状态'}
        </button>
      </div>
      <FormMessage action={action} />
    </form>
  );
}
