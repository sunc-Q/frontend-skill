import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  bp,
  cny,
  cnyCompact,
  CATEGORY_LABEL,
  CHANNEL_LABEL,
  countdown,
  dateTime,
  earlyOff,
  EVENT_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  TICKET_STATUS_LABEL,
  TYPE_STATUS_LABEL,
  verdict
} from './format';
import { initialTheme, persistTheme, Swatch, themeCss, THEMES, type ThemeId } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  CreateEventInput,
  OrderView,
  SaleInput,
  Stats,
  TypeRollup
} from './types';

const TABS = [
  { id: 'overview', label: '经营总览' },
  { id: 'events', label: '场次与票档' },
  { id: 'sell', label: '出票' },
  { id: 'gate', label: '核销台' },
  { id: 'refund', label: '退票' },
  { id: 'ledger', label: '台账' }
] as const;

type TabId = (typeof TABS)[number]['id'];

const TOKEN_KEY = 'etk-admin-token';

function readToken(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(TOKEN_KEY) ?? '';
}

// 主题样式注入：同一份 DOM/JS，只换这一整块 CSS。
function useThemeStyle(theme: ThemeId): void {
  useEffect(() => {
    const id = 'etk-theme';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (el === null) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = themeCss(theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

function useClock(): number {
  const [ms, setMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setMs(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  return ms;
}

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(() => initialTheme());
  const [tab, setTab] = useState<TabId>('overview');
  const [token, setToken] = useState<string>(() => readToken());
  useThemeStyle(theme);

  const nowMs = useClock();
  const stats = useAsync<Stats>(() => api.stats(14), [tab === 'overview' ? 1 : 0]);

  const changeTheme = (id: ThemeId): void => {
    setTheme(id);
    persistTheme(id);
  };

  const changeToken = (value: string): void => {
    setToken(value);
    window.sessionStorage.setItem(TOKEN_KEY, value);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Swatch />
          <div className="brand-text">
            <div className="brand-title">灯塔票务 · 场次经营与核销台</div>
            <div className="brand-sub">
              {stats.data === null ? '正在读取接口…' : `数据时刻 ${dateTime(stats.data.today + 'T00:00:00Z')} · 每 20 秒对表`}
            </div>
          </div>
        </div>
        <div className="themes" role="group" aria-label="界面风格">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === theme ? 'theme-btn is-on' : 'theme-btn'}
              title={t.mood}
              aria-pressed={t.id === theme}
              onClick={() => changeTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="token-box">
          <span className="token-label">管理令牌</span>
          <input
            className="token-input"
            type="password"
            value={token}
            placeholder="写入接口需要 ADMIN_TOKEN"
            onChange={(e) => changeToken(e.target.value)}
          />
        </label>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? 'tab is-on' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <KpiStrip stats={stats.data} loading={stats.loading} error={stats.error} />

      {tab === 'overview' ? <OverviewPanel stats={stats} nowMs={nowMs} /> : null}
      {tab === 'events' ? <EventsPanel token={token} nowMs={nowMs} changed={stats.reload} /> : null}
      {tab === 'sell' ? <SellPanel token={token} nowMs={nowMs} changed={stats.reload} /> : null}
      {tab === 'gate' ? <GatePanel token={token} nowMs={nowMs} changed={stats.reload} /> : null}
      {tab === 'refund' ? <RefundPanel token={token} nowMs={nowMs} changed={stats.reload} /> : null}
      {tab === 'ledger' ? <LedgerPanel nowMs={nowMs} /> : null}

      <footer className="foot">
        <span>金额一律由后端按分计算，前端只做展示；手机号仅出脱敏值。</span>
        <span className="foot-right">{THEMES.find((t) => t.id === theme)?.mood ?? ''}</span>
      </footer>
    </div>
  );
}

function KpiStrip({ stats, loading, error }: { stats: Stats | null; loading: boolean; error: string | null }): React.JSX.Element {
  const cells: Array<{ key: string; label: string; value: string; foot: string }> = stats === null
    ? []
    : [
        { key: 'gross', label: '累计票款（毛）', value: cnyCompact(stats.gross_cent), foot: `今日 ${cny(stats.today_gross_cent)}` },
        { key: 'net', label: '实收净额', value: cnyCompact(stats.net_cent), foot: `留存服务费 ${cny(stats.retained_cent)}` },
        { key: 'refund', label: '已退票款', value: cnyCompact(stats.refund_cent), foot: `退款率 ${bp(stats.refund_rate_bp)}` },
        { key: 'sell', label: '配额售罄率', value: bp(stats.sell_through_bp), foot: `${stats.sold_total} / ${stats.quota_total} 张` },
        { key: 'checkin', label: '入场核销率', value: bp(stats.checkin_rate_bp), foot: `今日检票 ${stats.today_checkins} 张` },
        { key: 'issued', label: '出票总量', value: String(stats.tickets_issued), foot: `未入场 ${stats.tickets_valid} · 作废 ${stats.tickets_void}` },
        { key: 'events', label: '在售场次', value: `${stats.events_on_sale} / ${stats.events_total}`, foot: `此刻闸口开放 ${stats.active_now.length} 场` },
        { key: 'avg', label: '客单价', value: cny(stats.avg_order_cent), foot: `订单 ${stats.orders_paid} 笔已付` }
      ];
  return (
    <section className="kpis" aria-label="关键指标">
      {loading && stats === null ? <div className="kpi-empty">读取中…</div> : null}
      {error !== null && stats === null ? <div className="kpi-empty is-err">{error}</div> : null}
      {cells.map((c) => (
        <div className="kpi" key={c.key}>
          <div className="kpi-label">{c.label}</div>
          <div className="kpi-value">{c.value}</div>
          <div className="kpi-foot">{c.foot}</div>
        </div>
      ))}
      {stats !== null ? (
        <div className={stats.identity_ok ? 'identity is-ok' : 'identity is-bad'}>
          <div className="identity-title">{stats.identity_ok ? '对账恒等式全绿' : '对账发现问题'}</div>
          <div className="identity-note">{stats.identity_note}</div>
          {stats.identity_issues.length > 0 ? (
            <ul className="identity-list">
              {stats.identity_issues.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <main className="panel">{children}</main>;
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        {sub !== undefined ? <p className="card-sub">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StatusTag({ code }: { code: string }): React.JSX.Element {
  const tone: Record<string, string> = {
    on_sale: 'ok',
    paid: 'ok',
    valid: 'info',
    used: 'ok',
    draft: 'mute',
    pending: 'mute',
    cancelled: 'bad',
    closed: 'mute',
    refunded: 'warn',
    void: 'bad',
    paused: 'warn',
    open: 'ok'
  };
  const label: Record<string, string> = {
    ...EVENT_STATUS_LABEL,
    ...ORDER_STATUS_LABEL,
    ...TICKET_STATUS_LABEL,
    ...TYPE_STATUS_LABEL
  };
  return <span className={'tag tag-' + (tone[code] ?? 'mute')}>{label[code] ?? code}</span>;
}

function Bar({ bpValue, caption }: { bpValue: number; caption: string }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, bpValue / 100));
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: pct.toFixed(1) + '%' }} />
      <span className="bar-label">{caption}</span>
    </div>
  );
}

function ErrLine({ state }: { state: { error: string | null; errorCode: string | null } }): React.JSX.Element | null {
  if (state.error === null) return null;
  return (
    <p className="err">
      {state.error}
      {state.errorCode !== null ? <span className="err-code">{state.errorCode}</span> : null}
    </p>
  );
}

function NeedToken({ token }: { token: string }): React.JSX.Element | null {
  if (token.trim() !== '') return null;
  return <p className="hint">先在右上角填入管理令牌，写入接口才会放行。</p>;
}

// ---- 经营总览 ----

function OverviewPanel({ stats, nowMs }: { stats: ReturnType<typeof useAsync<Stats>>; nowMs: number }): React.JSX.Element {
  const s = stats.data;
  return (
    <Panel>
      <ErrLine state={stats} />
      {s === null ? (
        <p className="empty">暂无数据。</p>
      ) : (
        <>
          <Card title="此刻闸口开放" sub={`窗口 = 开门前 30 分钟 至 开演后 240 分钟 · 本地对表 ${dateTime(new Date(nowMs).toISOString())}`}>
            {s.active_now.length === 0 ? (
              <p className="empty">此刻没有开放入场的场次。种子数据里 ETLIVE01 的窗口随运行时刻锚定。</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>场次</th>
                    <th>场馆</th>
                    <th>开门</th>
                    <th>开演</th>
                    <th>闸口</th>
                    <th>已入场 / 在效</th>
                  </tr>
                </thead>
                <tbody>
                  {s.active_now.map((e) => (
                    <tr key={e.code}>
                      <td>
                        <span className="strong">{e.title}</span>
                        <span className="mono">{e.code}</span>
                      </td>
                      <td>{e.venue}</td>
                      <td>{dateTime(e.doors_at)}</td>
                      <td>
                        {dateTime(e.start_at)} <span className="mute">{countdown(e.start_at, nowMs).text}</span>
                      </td>
                      <td className="mono">{e.gates}</td>
                      <td className="num">
                        {e.used_tickets} / {e.valid_tickets}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <div className="grid grid-2">
            <Card title={`近 ${s.window} 日走势`} sub="按 UTC 日聚合 · 订单数 / 出票 / 检票 / 票款与退款">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>订单</th>
                    <th>出票</th>
                    <th>检票</th>
                    <th>票款</th>
                    <th>退款</th>
                  </tr>
                </thead>
                <tbody>
                  {s.daily.map((d) => (
                    <tr key={d.day}>
                      <td className="mono">{d.day}</td>
                      <td className="num">{d.orders}</td>
                      <td className="num">{d.tickets}</td>
                      <td className="num">{d.checkins}</td>
                      <td className="num">{cny(d.gross_cent)}</td>
                      <td className="num">{d.refund_cent > 0 ? cny(d.refund_cent) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="渠道结构" sub="线上 / 票店 / 合作方 / 现场">
              <table className="table">
                <thead>
                  <tr>
                    <th>渠道</th>
                    <th>订单</th>
                    <th>票张</th>
                    <th>票款</th>
                    <th>服务费</th>
                    <th>入场率</th>
                  </tr>
                </thead>
                <tbody>
                  {s.by_channel.map((c) => (
                    <tr key={c.channel}>
                      <td>{CHANNEL_LABEL[c.channel] ?? c.channel}</td>
                      <td className="num">{c.orders}</td>
                      <td className="num">{c.tickets}</td>
                      <td className="num">{cnyCompact(c.gross_cent)}</td>
                      <td className="num">{cnyCompact(c.fee_cent)}</td>
                      <td className="num">{bp(c.checkin_bp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">{s.identity_note}</p>
            </Card>
          </div>
        </>
      )}
    </Panel>
  );
}

// ---- 场次与票档 ----

function EventsPanel({ token, nowMs, changed }: { token: string; nowMs: number; changed: () => void }): React.JSX.Element {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('doors');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState('');

  const list = useAsync(
    () => api.events({ status, category, q: search, sort, dir: 'asc', page, page_size: 8 }),
    [status, category, search, sort, page]
  );
  const detail = useAsync(
    () => (picked === '' ? Promise.resolve(null) : api.detail(picked)),
    [picked]
  );
  const action = useAction();

  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (picked !== '' || rows.length === 0) return;
    const first = rows[0];
    if (first !== undefined) setPicked(first.code);
  }, [rows, picked]);

  const setStatusFor = (code: string, act: 'open' | 'close' | 'cancel'): void => {
    action.run(async () => {
      await api.setEventStatus(token, code, act);
      list.reload();
      detail.reload();
      changed();
    });
  };

  return (
    <Panel>
      <div className="grid grid-2">
        <Card title="场次清单" sub="排序与筛选全部由后端白名单执行">
          <div className="filters">
            <label className="field">
              <span className="label">状态</span>
              <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">全部</option>
                {Object.entries(EVENT_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">类型</span>
              <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
                <option value="">全部</option>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">排序</span>
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
                {['doors', 'start', 'sold', 'gross', 'used', 'code', 'status'].map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">搜索</span>
              <input
                className="input"
                value={search}
                placeholder="名称 / 编号 / 场馆"
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </label>
          </div>
          <ErrLine state={list} />
          <table className="table">
            <thead>
              <tr>
                <th>场次</th>
                <th>开演</th>
                <th>状态</th>
                <th>售罄率</th>
                <th>入场</th>
                <th>票款</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.code} className={e.code === picked ? 'is-sel' : ''} onClick={() => setPicked(e.code)}>
                  <td>
                    <div className="strong">{e.title}</div>
                    <div className="mono mute">{e.code} · {e.venue} · {CATEGORY_LABEL[e.category] ?? e.category}</div>
                  </td>
                  <td>
                    <div>{dateTime(e.start_at)}</div>
                    <div className="mute">{countdown(e.doors_at, nowMs).text}</div>
                  </td>
                  <td>
                    <StatusTag code={e.status} />
                    {e.early_live ? <span className="tag tag-warn">早鸟中</span> : null}
                    {!e.checkin_open && e.status === 'on_sale' ? <span className="tag tag-mute" title={verdict(e.checkin_why)}>闸关</span> : null}
                  </td>
                  <td className="cell-bar">
                    <Bar bpValue={e.sell_through_bp} caption={`${e.sold_total}/${e.quota_total}`} />
                  </td>
                  <td className="num">
                    {e.used_tickets}
                    <span className="mute">/{e.valid_tickets + e.used_tickets}</span>
                  </td>
                  <td className="num">{cnyCompact(e.gross_cent)}</td>
                  <td className="btn-row">
                    {e.status === 'draft' ? (
                      <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => setStatusFor(e.code, 'open')}>开票</button>
                    ) : null}
                    {e.status === 'on_sale' ? (
                      <>
                        <button type="button" className="btn" disabled={action.busy} onClick={() => setStatusFor(e.code, 'close')}>散场</button>
                        <button type="button" className="btn btn-danger" disabled={action.busy} onClick={() => setStatusFor(e.code, 'cancel')}>取消</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !list.loading ? (
                <tr>
                  <td colSpan={7} className="empty">没有符合条件的场次。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <Pager
            page={page}
            pageSize={8}
            total={list.data?.total ?? 0}
            onPage={(p) => setPage(p)}
            extra={<span className="mono mute">sort={list.data?.sort ?? sort} · dir={list.data?.dir ?? 'asc'}</span>}
          />
          <ErrLine state={{ error: action.message, errorCode: action.kind === 'err' ? action.kind : null }} />
          <NeedToken token={token} />
        </Card>
        <Card title={picked === '' ? '票档明细' : `票档明细 · ${picked}`} sub="现价随早鸟窗口实时变化，配额与库存由后端算">
          {detail.loading ? <p className="empty">读取中…</p> : null}
          {detail.data === null ? <p className="empty">选择左侧任一场次查看票档。</p> : null}
          {detail.data !== null ? (
            <>
              <div className="lookup">
                <div className="stub">
                  <div className="stub-row"><span className="stub-k">场次</span><span className="stub-v">{detail.data.event.title}</span></div>
                  <div className="stub-row"><span className="stub-k">演出方</span><span className="stub-v">{detail.data.event.artist}</span></div>
                  <div className="stub-row"><span className="stub-k">开门 / 开演</span><span className="stub-v">{dateTime(detail.data.event.doors_at)} → {dateTime(detail.data.event.start_at)}</span></div>
                  <div className="stub-row"><span className="stub-k">闸口</span><span className="stub-v mono">{detail.data.event.gates}</span></div>
                  <div className="stub-row"><span className="stub-k">退票截止</span><span className="stub-v">开演前 {detail.data.event.refund_cutoff_hours} 小时</span></div>
                  <div className="stub-row"><span className="stub-k">备注</span><span className="stub-v">{detail.data.event.note}</span></div>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>票档</th>
                    <th>区域</th>
                    <th>标价</th>
                    <th>现价</th>
                    <th>早鸟</th>
                    <th>已售 / 配额</th>
                    <th>在效 / 入场 / 作废</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.ticket_types.map((t) => (
                    <TypeRow key={t.type_code} t={t} />
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </Card>
      </div>
    </Panel>
  );
}

function TypeRow({ t }: { t: TypeRollup }): React.JSX.Element {
  const off = earlyOff(t.early_bps);
  return (
    <tr>
      <td>
        <div className="strong">{t.type_name}</div>
        <div className="mono mute">{t.type_code}{t.seated ? ' · 对号入座' : ' · 自由入场'}</div>
      </td>
      <td>{t.zone}</td>
      <td className="num">{cny(t.unit_cent)}</td>
      <td className="num">{t.now_unit_cent === t.unit_cent ? cny(t.unit_cent) : <><span className="strike">{cny(t.unit_cent)}</span> {cny(t.now_unit_cent)}</>}</td>
      <td>{off === '' ? '—' : <span className="tag tag-warn">{off}</span>}</td>
      <td className="num">{t.sold_quantity} / {t.quota}</td>
      <td className="num">{t.valid_tickets} / {t.used_tickets} / {t.void_tickets}</td>
      <td><StatusTag code={t.status} /></td>
    </tr>
  );
}

function Pager({ page, pageSize, total, onPage, extra }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  extra?: React.ReactNode;
}): React.JSX.Element {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <span className="page-info">第 {page} / {pages} 页 · 共 {total} 条</span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
      {extra !== undefined ? <span className="page-extra">{extra}</span> : null}
    </div>
  );
}

// ---- 出票 ----

const EMPTY_EVENT: CreateEventInput = {
  code: '',
  title: '',
  artist: '',
  category: 'concert',
  venue: '',
  city: '上海',
  gates: 'A,B',
  doors_at: '',
  start_at: '',
  presale_end: '',
  refund_cutoff_hours: 24,
  note: ''
};

function localISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function SellPanel({ token, nowMs, changed }: { token: string; nowMs: number; changed: () => void }): React.JSX.Element {
  const events = useAsync(() => api.events({ status: 'on_sale', sort: 'start', dir: 'asc', page_size: 100 }), []);
  const [eventCode, setEventCode] = useState('');
  const [typeCode, setTypeCode] = useState('');
  const [quantity, setQuantity] = useState(2);
  const [buyer, setBuyer] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('web');
  const [created, setCreated] = useState<{ order: string; tickets: string[] } | null>(null);
  const sale = useAction();

  const detail = useAsync(
    () => (eventCode === '' ? Promise.resolve(null) : api.detail(eventCode)),
    [eventCode]
  );
  const types = useMemo<TypeRollup[]>(() => detail.data?.ticket_types ?? [], [detail.data]);

  useEffect(() => {
    const first = types.find((t) => t.status === 'open' && t.remaining > 0);
    if (first !== undefined && !types.some((t) => t.type_code === typeCode && t.status === 'open')) {
      setTypeCode(first.type_code);
    }
  }, [types, typeCode]);

  const pickedEvent = events.data?.items.find((e) => e.code === eventCode) ?? null;
  const pickedType = types.find((t) => t.type_code === typeCode) ?? null;
  const unit = pickedType?.now_unit_cent ?? 0;
  const fee = pickedType?.service_cent ?? 0;

  const [form, setForm] = useState<CreateEventInput>(EMPTY_EVENT);
  const create = useAction();
  const [createdEvent, setCreatedEvent] = useState<string | null>(null);

  const submitSale = (): void => {
    const input: SaleInput = { event_code: eventCode, type_code: typeCode, quantity, buyer, phone, channel };
    sale.run(async () => {
      const res = await api.sale(token, input);
      setCreated({ order: res.order.code, tickets: res.tickets.map((t) => t.code) });
      events.reload();
      detail.reload();
      changed();
    });
  };

  const submitEvent = (): void => {
    create.run(async () => {
      const res = await api.createEvent(token, form);
      setCreatedEvent(res.event.code);
      events.reload();
      changed();
    });
  };

  const patch = (key: keyof CreateEventInput, value: string | number): void => {
    setForm((f) => ({ ...f, [key]: value }) as CreateEventInput);
  };

  const quickTime = (hours: number): string => localISO(new Date(nowMs + hours * 3_600_000));

  return (
    <Panel>
      <div className="grid grid-2">
        <Card title="窗口出票" sub="收款即出票：金额、早鸟立减、服务费全部后端算">
          <ErrLine state={events} />
          <div className="form">
            <label className="field">
              <span className="label">场次</span>
              <select className="select" value={eventCode} onChange={(e) => { setEventCode(e.target.value); setCreated(null); }}>
                <option value="">选择在售场次</option>
                {events.data?.items.map((ev) => (
                  <option key={ev.code} value={ev.code}>{ev.title}（{ev.code}）</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">票档</span>
              <select className="select" value={typeCode} disabled={types.length === 0} onChange={(e) => setTypeCode(e.target.value)}>
                {types.map((t) => (
                  <option key={t.type_code} value={t.type_code}>
                    {t.type_name} · {cny(t.now_unit_cent)} · 余 {t.remaining}
                    {t.status === 'paused' ? '（停售）' : ''}
                  </option>
                ))}
                {types.length === 0 ? <option value="">先选场次</option> : null}
              </select>
            </label>
            <label className="field">
              <span className="label">张数（1-6）</span>
              <input
                className="input"
                type="number"
                min={1}
                max={6}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="label">购票人</span>
              <input className="input" value={buyer} placeholder="字母数字与下划线" onChange={(e) => setBuyer(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">手机号（11 位）</span>
              <input className="input" value={phone} inputMode="numeric" maxLength={11} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">渠道</span>
              <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          {pickedEvent !== null && pickedType !== null ? (
            <div className="calc">
              <div className="calc-row"><span>现价 × 张数</span><span className="num">{cny(unit)} × {quantity} = {cny(unit * quantity)}</span></div>
              <div className="calc-row"><span>服务费（不退）</span><span className="num">{cny(fee * quantity)}</span></div>
              <div className="calc-row calc-total"><span>预计应收</span><span className="num">{cny((unit + fee) * quantity)}</span></div>
              <div className="calc-note">
                {pickedType.early_bps > 0 && detail.data !== null && new Date(detail.data.event.presale_end).getTime() > nowMs
                  ? `早鸟 ${earlyOff(pickedType.early_bps)}已在价格里`
                  : '当前按票面标价计价'}
              </div>
            </div>
          ) : null}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={sale.busy || eventCode === '' || typeCode === ''} onClick={submitSale}>
              出票并收款
            </button>
            <button type="button" className="btn" disabled={!sale.busy} onClick={() => { sale.clear(); setCreated(null); }}>清空回执</button>
          </div>
          <NeedToken token={token} />
          {sale.message !== null ? <p className={sale.kind === 'ok' ? 'ok' : 'err'}>{sale.message}</p> : null}
          {created !== null ? (
            <div className="receipt">
              <div className="stub">
                <div className="stub-row"><span className="stub-k">订单号</span><span className="stub-v mono">{created.order}</span></div>
                <div className="stub-row"><span className="stub-k">票券</span><span className="stub-v mono">{created.tickets.join(' · ')}</span></div>
                <div className="stub-row"><span className="stub-k">张数</span><span className="stub-v">{created.tickets.length}</span></div>
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="新建场次" sub="新场次落成待开票，需在场次清单里点「开票」才上架">
          <div className="form">
            <label className="field">
              <span className="label">场次编号</span>
              <input className="input mono" value={form.code} placeholder="ET261111A" onChange={(e) => patch('code', e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span className="label">演出名称</span>
              <input className="input" value={form.title} onChange={(e) => patch('title', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">演出方</span>
              <input className="input" value={form.artist} onChange={(e) => patch('artist', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">类型</span>
              <select className="select" value={form.category} onChange={(e) => patch('category', e.target.value)}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">场馆</span>
              <input className="input" value={form.venue} onChange={(e) => patch('venue', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">城市</span>
              <input className="input" value={form.city} onChange={(e) => patch('city', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">闸口（逗号分隔）</span>
              <input className="input mono" value={form.gates} onChange={(e) => patch('gates', e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span className="label">退票截止（开演前 2-72 小时）</span>
              <input
                className="input"
                type="number"
                min={2}
                max={72}
                value={form.refund_cutoff_hours}
                onChange={(e) => patch('refund_cutoff_hours', Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="label">开门时间（UTC）</span>
              <input className="input mono" value={form.doors_at} placeholder="RFC3339" onChange={(e) => patch('doors_at', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">开演时间（UTC）</span>
              <input className="input mono" value={form.start_at} placeholder="RFC3339" onChange={(e) => patch('start_at', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">早鸟截止（UTC）</span>
              <input className="input mono" value={form.presale_end} placeholder="RFC3339" onChange={(e) => patch('presale_end', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">备注</span>
              <input className="input" value={form.note} onChange={(e) => patch('note', e.target.value)} />
            </label>
          </div>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => {
              patch('doors_at', quickTime(72));
              patch('start_at', quickTime(74));
              patch('presale_end', quickTime(70));
            }}>填三个相对时刻</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={create.busy || form.code === '' || form.title === ''}
              onClick={submitEvent}
            >
              建场次
            </button>
          </div>
          <NeedToken token={token} />
          {create.message !== null ? <p className={create.kind === 'ok' ? 'ok' : 'err'}>{create.message}</p> : null}
          {createdEvent !== null ? <p className="ok">已建好 {createdEvent}，在「场次与票档」里开票后才能卖。</p> : null}
          <FieldsBox action={create} />
        </Card>
      </div>
    </Panel>
  );
}

function FieldsBox({ action }: { action: ReturnType<typeof useAction> }): React.JSX.Element | null {
  const keys = Object.keys(action.lastError?.fields ?? {});
  if (keys.length === 0) return null;
  return (
    <ul className="fieldlist">
      {keys.map((k) => (
        <li key={k}>
          <span className="mono">{k}</span>
          <span>{action.lastError?.fields[k] ?? ''}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- 核销台 ----

function GatePanel({ token, nowMs, changed }: { token: string; nowMs: number; changed: () => void }): React.JSX.Element {
  const [code, setCode] = useState('');
  const [gate, setGate] = useState('');
  const [log, setLog] = useState<Array<{ time: string; text: string; kind: string }>>([]);
  const action = useAction();

  const lookup = useAsync(
    () => (code.trim().length < 6 ? Promise.resolve(null) : api.ticket(code.trim())),
    [code.trim()]
  );
  const t = lookup.data?.ticket ?? null;
  const gates = t?.gates ?? [];

  const stats = useAsync(() => api.stats(3), []);
  const live = stats.data?.active_now[0] ?? null;
  const queue = useAsync(
    () => (live === null ? Promise.resolve(null) : api.tickets({ event: live.code, status: 'valid', sort: 'issued', dir: 'asc', page_size: 12 })),
    [live?.code ?? '']
  );

  const doCheckIn = (ticketCode: string, useGate: string): void => {
    action.run(async () => {
      const res = await api.checkIn(token, ticketCode, useGate);
      setLog((l) => [{ time: dateTime(new Date().toISOString()), text: `${res.ticket.code} 经 ${res.ticket.gate} 入场 · ${res.ticket.seat_label}`, kind: 'ok' }, ...l].slice(0, 8));
      setCode('');
      queue.reload();
      stats.reload();
      changed();
    });
  };

  const pushFail = (msg: string): void => {
    setLog((l) => [{ time: dateTime(new Date().toISOString()), text: msg, kind: 'err' }, ...l].slice(0, 8));
  };

  const tryCheckIn = (): void => {
    if (t === null) return;
    if (!t.checkinable) {
      pushFail(`${t.code} 拒绝入场：${verdict(t.checkin_why)}`);
      return;
    }
    doCheckIn(t.code, gate !== '' ? gate : (gates[0] ?? ''));
  };

  return (
    <Panel>
      <div className="grid grid-2">
        <Card title="闸口验票" sub="一票一入；窗口与票态判定全部后端裁决">
          <label className="field">
            <span className="label">票券编号</span>
            <input className="input mono" value={code} placeholder="TK…" onChange={(e) => setCode(e.target.value)} />
          </label>
          {lookup.loading ? <p className="empty">查验中…</p> : null}
          {code.trim().length >= 6 && lookup.data === null && !lookup.loading ? <p className="err">查不到这张票（{lookup.errorCode ?? 'not_found'}）</p> : null}
          {t !== null ? (
            <div className="lookup">
              <div className="stub">
                <div className="stub-row"><span className="stub-k">票券</span><span className="stub-v mono">{t.code}</span></div>
                <div className="stub-row"><span className="stub-k">场次</span><span className="stub-v">{t.event_title}</span></div>
                <div className="stub-row"><span className="stub-k">开门 / 开演</span><span className="stub-v">{dateTime(t.doors_at)} → {dateTime(t.start_at)}</span></div>
                <div className="stub-row"><span className="stub-k">座位</span><span className="stub-v">{t.seat_label}</span></div>
                <div className="stub-row"><span className="stub-k">购票人</span><span className="stub-v">{t.buyer} · {t.phone_masked}</span></div>
                <div className="stub-row"><span className="stub-k">状态</span><span className="stub-v"><StatusTag code={t.status} /></span></div>
                <div className="stub-row"><span className="stub-k">裁决</span>
                  <span className="stub-v">
                    {t.checkinable
                      ? <span className="tag tag-ok">可以检票入场</span>
                      : <span className="tag tag-bad">{verdict(t.checkin_why)}</span>}
                  </span>
                </div>
              </div>
              <div className="btn-row">
                <label className="field">
                  <span className="label">闸口</span>
                  <select className="select" value={gate} onChange={(e) => setGate(e.target.value)}>
                    {gates.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                    {gates.length === 0 ? <option value="">本场无闸口</option> : null}
                  </select>
                </label>
                <button type="button" className="btn btn-primary" disabled={action.busy || !t.checkinable} onClick={tryCheckIn}>
                  放行入场
                </button>
              </div>
            </div>
          ) : null}
          <NeedToken token={token} />
          {action.message !== null ? <p className={action.kind === 'ok' ? 'ok' : 'err'}>{action.message}</p> : null}
          <FieldsBox action={action} />
          <div className="log">
            <div className="log-title">本机验票流水（近 8 条）</div>
            {log.length === 0 ? <p className="empty">还没有验票记录。</p> : null}
            {log.map((x, i) => (
              <p key={`${x.time}-${i}`} className={'log-item log-' + x.kind}>
                <span className="mono mute">{x.time}</span> {x.text}
              </p>
            ))}
          </div>
        </Card>

        <Card title="待入场队列" sub={live === null ? '此刻没有开放入场的场次' : `${live.title} · ${dateTime(live.doors_at)} 开门`}>
          <ErrLine state={queue} />
          <table className="table table-dense">
            <thead>
              <tr>
                <th>票券</th>
                <th>座位</th>
                <th>购票人</th>
                <th>出票时刻</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(queue.data?.items ?? []).map((tk) => (
                <tr key={tk.code}>
                  <td className="mono">{tk.code}</td>
                  <td>{tk.seat_label}</td>
                  <td>{tk.buyer} <span className="mute mono">{tk.phone_masked}</span></td>
                  <td className="mute">{dateTime(tk.issued_at)}</td>
                  <td className="btn-row">
                    <button
                      type="button"
                      className="btn"
                      disabled={action.busy || !tk.checkinable}
                      title={tk.checkinable ? '按本场首个闸口放行' : verdict(tk.checkin_why)}
                      onClick={() => doCheckIn(tk.code, tk.gates[0] ?? '')}
                    >
                      检票
                    </button>
                  </td>
                </tr>
              ))}
              {(queue.data?.items ?? []).length === 0 ? (
                <tr><td colSpan={5} className="empty">队列已空，或当前无开放场次。</td></tr>
              ) : null}
            </tbody>
          </table>
          <p className="hint">本地对表 {dateTime(new Date(nowMs).toISOString())}，闸口窗口每 20 秒重新判定。</p>
        </Card>
      </div>
    </Panel>
  );
}

// ---- 退票 ----

function RefundPanel({ token, nowMs, changed }: { token: string; nowMs: number; changed: () => void }): React.JSX.Element {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('行程变更，开演前申请退票');
  const action = useAction();
  const [done, setDone] = useState<{ order: string; cent: number } | null>(null);

  const search = useAsync(
    () => (code.trim().length < 6 ? Promise.resolve(null) : api.orders({ q: code.trim(), page_size: 5 })),
    [code.trim()]
  );
  const order: OrderView | null = search.data?.items.find((o) => o.code === code.trim().toUpperCase()) ?? null;

  const submit = (): void => {
    if (order === null) return;
    action.run(async () => {
      const res = await api.refund(token, order.code, reason);
      setDone({ order: res.order.code, cent: res.refunded_cent });
      search.reload();
      changed();
    });
  };

  const refundableOrders = useAsync(() => api.orders({ status: 'paid', sort: 'created', dir: 'desc', page_size: 10 }), [done]);

  return (
    <Panel>
      <div className="grid grid-2">
        <Card title="按订单号退票" sub="只退票面，服务费留存；判定顺序：状态 → 票态 → 截止">
          <label className="field">
            <span className="label">订单编号</span>
            <input className="input mono" value={code} placeholder="ET…" onChange={(e) => { setCode(e.target.value); setDone(null); }} />
          </label>
          <label className="field">
            <span className="label">退票原因（2-120 字）</span>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {search.loading ? <p className="empty">查询中…</p> : null}
          {order === null && !search.loading && code.trim().length >= 6 ? <p className="err">没有匹配的订单。</p> : null}
          {order !== null ? (
            <div className="lookup">
              <div className="stub">
                <div className="stub-row"><span className="stub-k">订单</span><span className="stub-v mono">{order.code}</span></div>
                <div className="stub-row"><span className="stub-k">场次 / 票档</span><span className="stub-v">{order.event_title} · {order.type_name}</span></div>
                <div className="stub-row"><span className="stub-k">购票人</span><span className="stub-v">{order.buyer} · {order.phone_masked}</span></div>
                <div className="stub-row"><span className="stub-k">票面小计</span><span className="stub-v num">{cny(order.subtotal_cent)}</span></div>
                <div className="stub-row"><span className="stub-k">服务费（不退）</span><span className="stub-v num">{cny(order.fee_cent)}</span></div>
                <div className="stub-row"><span className="stub-k">实付</span><span className="stub-v num">{cny(order.payable_cent)}</span></div>
                <div className="stub-row"><span className="stub-k">票态</span><span className="stub-v">在效 {order.ticket_count - order.used_count - order.void_count} · 已入场 {order.used_count} · 已作废 {order.void_count}</span></div>
                <div className="stub-row"><span className="stub-k">可退性</span>
                  <span className="stub-v">
                    {order.refundable ? <span className="tag tag-ok">可全额退票面</span> : <span className="tag tag-bad">{verdict(order.refund_why)}</span>}
                  </span>
                </div>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-danger" disabled={action.busy || !order.refundable} onClick={submit}>
                  确认退票
                </button>
              </div>
            </div>
          ) : null}
          <NeedToken token={token} />
          {action.message !== null ? <p className={action.kind === 'ok' ? 'ok' : 'err'}>{action.message}</p> : null}
          {done !== null ? <p className="ok">{done.order} 已退 {cny(done.cent)}，服务费留存。</p> : null}
          <FieldsBox action={action} />
        </Card>

        <Card title="最近已支付订单" sub="点开左侧输入框填入编号即可试退">
          <ErrLine state={refundableOrders} />
          <table className="table table-dense">
            <thead>
              <tr>
                <th>订单</th>
                <th>场次</th>
                <th>张数</th>
                <th>实付</th>
                <th>可退</th>
              </tr>
            </thead>
            <tbody>
              {(refundableOrders.data?.items ?? []).map((o) => (
                <tr key={o.code} className={o.code === code.trim().toUpperCase() ? 'is-sel' : ''} onClick={() => setCode(o.code)}>
                  <td className="mono">{o.code}</td>
                  <td>{o.event_title}</td>
                  <td className="num">{o.quantity}</td>
                  <td className="num">{cny(o.payable_cent)}</td>
                  <td>{o.refundable ? <span className="tag tag-ok">可退</span> : <span className="tag tag-mute" title={verdict(o.refund_why)}>{verdict(o.refund_why)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">退票截止按场次配置（开演前 2-72 小时），过期即锁死。本地对表 {dateTime(new Date(nowMs).toISOString())}。</p>
        </Card>
      </div>
    </Panel>
  );
}

// ---- 台账 ----

function LedgerPanel({ nowMs }: { nowMs: number }): React.JSX.Element {
  const [kind, setKind] = useState<'orders' | 'tickets'>('orders');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const size = 12;

  const orders = useAsync(
    () => (kind === 'orders' ? api.orders({ status, q: search, sort: 'created', dir: 'desc', page, page_size: size }) : Promise.resolve(null)),
    [kind, status, search, page]
  );
  const tickets = useAsync(
    () => (kind === 'tickets' ? api.tickets({ status, q: search, sort: 'issued', dir: 'desc', page, page_size: size }) : Promise.resolve(null)),
    [kind, status, search, page]
  );
  const total = (orders.data?.total ?? tickets.data?.total ?? 0);
  const active = kind === 'orders' ? orders : tickets;

  const labels = kind === 'orders' ? ORDER_STATUS_LABEL : TICKET_STATUS_LABEL;

  return (
    <Panel>
      <Card title="经营台账" sub="订单与票券逐条可查，检索按字面量匹配（注入串只会当文本）">
        <div className="filters">
          <div className="seg">
            <button type="button" className={kind === 'orders' ? 'seg-btn is-on' : 'seg-btn'} onClick={() => { setKind('orders'); setStatus(''); setPage(1); }}>订单</button>
            <button type="button" className={kind === 'tickets' ? 'seg-btn is-on' : 'seg-btn'} onClick={() => { setKind('tickets'); setStatus(''); setPage(1); }}>票券</button>
          </div>
          <label className="field">
            <span className="label">状态</span>
            <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">全部</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">搜索</span>
            <input className="input" value={search} placeholder="编号 / 购票人 / 座位" onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </label>
          <span className="mute">对表 {dateTime(new Date(nowMs).toISOString())}</span>
        </div>
        <ErrLine state={active} />
        {kind === 'orders' ? (
          <table className="table">
            <thead>
              <tr>
                <th>订单</th>
                <th>场次</th>
                <th>票档</th>
                <th>购票人</th>
                <th>渠道</th>
                <th>张数</th>
                <th>实付</th>
                <th>票态</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {(orders.data?.items ?? []).map((o) => (
                <tr key={o.code}>
                  <td className="mono">{o.code}</td>
                  <td>{o.event_title}</td>
                  <td>{o.type_name}</td>
                  <td>{o.buyer} <span className="mute mono">{o.phone_masked}</span></td>
                  <td>{CHANNEL_LABEL[o.channel] ?? o.channel}</td>
                  <td className="num">{o.quantity}</td>
                  <td className="num">{cny(o.payable_cent)}{o.discount_bps > 0 ? <span className="tag tag-warn">早鸟</span> : null}</td>
                  <td className="num mute">{o.ticket_count - o.used_count - o.void_count}/{o.used_count}/{o.void_count}</td>
                  <td><StatusTag code={o.status} />{o.refunded_cent > 0 ? <span className="mute"> {cny(o.refunded_cent)}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>票券</th>
                <th>订单</th>
                <th>场次</th>
                <th>座位</th>
                <th>出票</th>
                <th>入场</th>
                <th>闸口</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {(tickets.data?.items ?? []).map((tk) => (
                <tr key={tk.code}>
                  <td className="mono">{tk.code}</td>
                  <td className="mono">{tk.order_code}</td>
                  <td>{tk.event_title}</td>
                  <td>{tk.seat_label}</td>
                  <td className="mute">{dateTime(tk.issued_at)}</td>
                  <td className="mute">{tk.used_at === undefined ? '—' : dateTime(tk.used_at)}</td>
                  <td className="mono">{tk.gate ?? '—'}</td>
                  <td>
                    <StatusTag code={tk.status} />
                    {!tk.checkinable && tk.status === 'valid' ? <span className="tag tag-mute" title={verdict(tk.checkin_why)}>{verdict(tk.checkin_why)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pager page={page} pageSize={size} total={total} onPage={setPage} />
      </Card>
    </Panel>
  );
}
