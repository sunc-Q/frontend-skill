import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { dateOnly, dateTime, daysUntil, PERIOD_LABEL, sign, STATUS_LABEL, usd, usdCompact } from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  CreatePlanInput,
  ListParams,
  Metrics,
  Period,
  PlanRollup,
  RenewInput,
  SortDir,
  SortKey,
  SubStatus,
  SubscriptionDetail,
  SubscriptionRow,
} from './types';

const TOKEN_KEY = 'biz-site-admin-token';
const MONTHS = 9;

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

  const metrics = useAsync<Metrics>(() => api.metrics(MONTHS), [theme]);
  const plans = useAsync(() => api.plans(), []);

  const [filters, setFilters] = useState<ListParams>({ sort: 'renew_at', dir: 'asc', page_size: 12 });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.subscriptions({ ...filters, page, page_size: filters.page_size ?? 12 }),
    [filters.status, filters.plan, filters.q, filters.sort, filters.dir, page, filters.page_size],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useAsync(
    () => (selectedId === null ? Promise.resolve(null) : api.subscription(selectedId)),
    [selectedId, (selectedId === null ? 0 : (list.data?.items.length ?? 0)) + ':' + String(list.loading)],
  );

  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (selectedId === null && rows.length > 0) setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

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
          <span className="brand-name">订阅经营台</span>
          <span className="brand-sub">Subscription Ops Console</span>
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
          指标口径写死后端：<b>MRR 只统计正常计费与逾期订阅</b>，年付按 12 个月分摊。
        </p>
        <p className="stamp">
          数据快照 {metrics.data ? dateTime(metrics.data.generated_at) : '加载中'} · {metrics.data?.window ?? ''}
        </p>
      </div>

      <Banner state={metrics} label="指标接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">经营指标</h2>
            <span className="section-note">MRR / ARR / ARPU 与近 {MONTHS} 个月新增退订</span>
          </div>
          <KpiGrid m={metrics.data} />

          <div className="section-head">
            <h2 className="section-title">订阅台账</h2>
            <span className="section-note">
              第 {page} / {pages} 页 · 共 {totalRows} 条
            </span>
          </div>
          <Filters
            value={filters}
            page={page}
            plans={metrics.data?.by_plan ?? []}
            onChange={(next) => {
              setFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setPage(1);
            }}
            onPage={setPage}
          />
          <Banner state={list} label="订阅列表" />
          <SubTable
            rows={rows}
            loading={list.loading}
            sort={filters.sort ?? 'renew_at'}
            dir={filters.dir ?? 'asc'}
            selectedId={selectedId}
            onSort={(sort) => {
              const dir = filters.sort === sort && filters.dir === 'desc' ? 'asc' : 'desc';
              setFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(id) => setSelectedId(id)}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">套餐结构</h2>
            <span className="section-note">按 MRR 排序</span>
          </div>
          <PlanBars rollup={metrics.data?.by_plan ?? []} mrr={metrics.data?.mrr ?? 0} />
          <div className="section-head">
            <h2 className="section-title">增长曲线</h2>
            <span className="section-note">新增 / 退订（条）</span>
          </div>
          <TrendTable monthly={metrics.data?.monthly ?? []} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">订阅详情</h2>
            <span className="section-note">{selectedId === null ? '未选择' : `ID #${selectedId}`}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <DetailPanel state={detail} />
        </div>
        <div className="detail-side">
          <RenewForm
            token={token}
            row={detail.data?.subscription ?? null}
            onDone={() => {
              detail.reload();
              list.reload();
              metrics.reload();
            }}
          />
        </div>
      </section>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">运营动作</h2>
          <span className="section-note">写接口需 ADMIN_TOKEN；校验失败会逐字段回显</span>
        </div>
        <PlanForm
          token={token}
          onCreated={() => {
            metrics.reload();
            plans.reload();
          }}
        />
        <p className="footnote">
          接口：GET /api/health · /api/plans · /api/metrics · /api/subscriptions · /api/subscriptions/&#123;id&#125; ·
          POST /api/admin/plans · POST /api/admin/subscriptions/&#123;id&#125;/renew。当前套餐数：
          {plans.data?.total ?? 0}。
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

const KPI_ORDER: readonly (keyof Metrics)[] = [
  'mrr',
  'arr',
  'arpu',
  'active_subs',
  'trialing_subs',
  'past_due_subs',
  'canceled_subs',
  'churn_rate_pct',
  'trial_conversion_pct',
  'total_subscribers',
];

const KPI_LABEL: Record<string, string> = {
  mrr: '月度经常性收入',
  arr: '年度经常性收入',
  arpu: '单订阅均收',
  active_subs: '正常计费',
  trialing_subs: '试用中',
  past_due_subs: '逾期未付',
  canceled_subs: '累计退订',
  churn_rate_pct: '生命周期流失率',
  trial_conversion_pct: '试用转化率',
  total_subscribers: '订阅方总数',
};

const KPI_HINT: Record<string, string> = {
  mrr: 'active + past_due 的月度折算',
  arr: 'MRR × 12',
  arpu: 'MRR ÷ 计费订阅数',
  churn_rate_pct: '退订 ÷（计费 + 退订）',
  trial_conversion_pct: '已结束试用 ÷ 全部开通过',
};

function KpiGrid({ m }: { m: Metrics | null }): React.JSX.Element {
  return (
    <div className="kpis">
      {KPI_ORDER.map((key) => {
        const raw = m?.[key];
        const value = typeof raw === 'number' ? raw : 0;
        const text =
          m === null
            ? '—'
            : key === 'mrr' || key === 'arr' || key === 'arpu'
              ? usdCompact(value)
              : key === 'churn_rate_pct' || key === 'trial_conversion_pct'
                ? `${value.toFixed(1)}%`
                : value.toLocaleString('en-US');
        return (
          <article className="kpi" key={String(key)}>
            <h3 className="kpi-label">{KPI_LABEL[String(key)] ?? String(key)}</h3>
            <p className="kpi-value">{text}</p>
            <p className="kpi-hint">{KPI_HINT[String(key)] ?? '实时统计'}</p>
          </article>
        );
      })}
    </div>
  );
}

function Filters({
  value,
  page,
  plans,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  plans: PlanRollup[];
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
          onChange={(e) => onChange({ next: { status: e.target.value as SubStatus | '' }, resetPage: true })}
        >
          <option value="">全部</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">套餐</span>
        <select
          className="input"
          value={value.plan ?? ''}
          onChange={(e) => onChange({ next: { plan: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {plans.map((p) => (
            <option key={p.plan_code} value={p.plan_code}>
              {p.plan_name}（{p.subs}）
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
          maxLength={64}
          placeholder="公司名或邮箱（服务端转义 LIKE）"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="pager">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </button>
        <span className="pager-now">
          {page}
        </span>
        <button type="button" className="btn" onClick={() => onPage(page + 1)}>
          下一页
        </button>
      </div>
    </div>
  );
}

const COLUMNS: readonly { key: string; label: string; sort?: SortKey; numeric?: boolean }[] = [
  { key: 'id', label: '编号' },
  { key: 'company', label: '订阅方', sort: 'company' },
  { key: 'plan', label: '套餐' },
  { key: 'period', label: '账期' },
  { key: 'seats', label: '席位', sort: 'seats', numeric: true },
  { key: 'mrr', label: 'MRR', sort: 'mrr', numeric: true },
  { key: 'status', label: '状态', sort: 'status' },
  { key: 'renew', label: '下次续费', sort: 'renew_at' },
];

function SubTable({
  rows,
  loading,
  sort,
  dir,
  selectedId,
  onSort,
  onPick,
}: {
  rows: SubscriptionRow[];
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
        <caption className="caption">订阅台账：点击行查看详情与续费入口</caption>
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
                没有符合条件的订阅，试试放宽筛选条件
              </td>
            </tr>
          ) : null}
          {rows.map((r) => {
            const d = daysUntil(r.renew_at);
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
                <td className="mono">#{r.id}</td>
                <td>
                  <span className="cell-strong">{r.company}</span>
                  <span className="cell-sub">{r.email}</span>
                </td>
                <td>{r.plan_name}</td>
                <td>{PERIOD_LABEL[r.period] ?? r.period}</td>
                <td className="num mono">{r.seats}</td>
                <td className="num mono">{usd(r.mrr)}</td>
                <td>
                  <span className="badge" data-status={r.status}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="mono">
                  {dateOnly(r.renew_at)}
                  <span className="cell-sub" data-overdue={r.status !== 'canceled' && d < 0 ? 'true' : 'false'}>
                    {r.status === 'canceled' ? '已终止' : d < 0 ? `逾期 ${Math.abs(d)} 天` : `${d} 天后`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlanBars({ rollup, mrr }: { rollup: PlanRollup[]; mrr: number }): React.JSX.Element {
  const sorted = useMemo(() => [...rollup].sort((a, b) => b.mrr - a.mrr), [rollup]);
  const max = sorted[0]?.mrr ?? 1;
  return (
    <ul className="bars">
      {sorted.map((p) => (
        <li className="bar" key={p.plan_code}>
          <span className="bar-head">
            <span className="bar-name">{p.plan_name}</span>
            <span className="bar-value">{usdCompact(p.mrr)}</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((p.mrr / max) * 100))}%` }} />
          </span>
          <span className="bar-foot">
            {p.subs} 个订阅 · 占 MRR {mrr > 0 ? ((p.mrr / mrr) * 100).toFixed(1) : '0.0'}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrendTable({ monthly }: { monthly: Metrics['monthly'] }): React.JSX.Element {
  const max = monthly.reduce((acc, p) => Math.max(acc, p.new_subs, p.cancellations), 1);
  return (
    <table className="table mini plain">
      <caption className="caption">月度新增与退订</caption>
      <thead>
        <tr>
          <th scope="col">月份</th>
          <th scope="col">新增</th>
          <th scope="col">退订</th>
          <th scope="col">净增 MRR</th>
          <th scope="col">走势</th>
        </tr>
      </thead>
      <tbody>
        {monthly.map((p) => (
          <tr key={p.month}>
            <td className="mono">{p.month}</td>
            <td className="num mono">{p.new_subs}</td>
            <td className="num mono">{p.cancellations}</td>
            <td className="num mono">{usdCompact(p.mrr_added - p.mrr_lost)}</td>
            <td>
              <span className="spark">
                <span className="spark-add" style={{ width: `${(p.new_subs / max) * 100}%` }} />
                <span className="spark-cut" style={{ width: `${(p.cancellations / max) * 100}%` }} />
              </span>
              <span className="cell-sub">
                {sign(p.new_subs - p.cancellations)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailPanel({ state }: { state: { data: SubscriptionDetail | null; loading: boolean } }): React.JSX.Element {
  const d = state.data;
  if (d === null) {
    return <p className="placeholder">{state.loading ? '正在读取详情…' : '在台账中选择一行查看详情。'}</p>;
  }
  const s = d.subscription;
  const facts: readonly { label: string; value: string }[] = [
    { label: '订阅方', value: s.company },
    { label: '联系邮箱', value: s.email },
    { label: '套餐', value: `${s.plan_name}（${s.plan_code}）` },
    { label: '账期', value: PERIOD_LABEL[s.period] ?? s.period },
    { label: '席位', value: String(s.seats) },
    { label: 'MRR', value: usd(s.mrr) },
    { label: '开通日', value: dateOnly(s.start_at) },
    { label: '最近扣款', value: dateOnly(s.last_payment_at) },
    { label: '下次续费', value: dateOnly(s.renew_at) },
    { label: '退订日期', value: dateOnly(s.canceled_at) },
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
      <table className="table mini plain">
        <caption className="caption">支付流水（最近 {d.payments.length} 笔）</caption>
        <thead>
          <tr>
            <th scope="col">扣款日</th>
            <th scope="col">账期</th>
            <th scope="col" className="num">
              金额
            </th>
          </tr>
        </thead>
        <tbody>
          {d.payments.length === 0 ? (
            <tr>
              <td className="empty" colSpan={3}>
                试用中，尚未产生扣款
              </td>
            </tr>
          ) : null}
          {d.payments.map((p) => (
            <tr key={p.id}>
              <td className="mono">{dateOnly(p.paid_at)}</td>
              <td>{PERIOD_LABEL[p.period] ?? p.period}</td>
              <td className="num mono">{usd(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RenewForm({
  token,
  row,
  onDone,
}: {
  token: string;
  row: SubscriptionRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const defaultRenew = row === null ? '' : dateOnly(row.renew_at);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<Period>('monthly');
  const [nextRenew, setNextRenew] = useState(defaultRenew);

  useEffect(() => {
    if (row === null) return;
    setAmount((row.mrr / 100).toFixed(2));
    setPeriod(row.period === 'yearly' ? 'yearly' : 'monthly');
    setNextRenew(dateOnly(row.renew_at));
    action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  const blocked = row === null || row.status === 'trialing';
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (row === null) return;
        const input: RenewInput = {
          amount: Math.round(Number(amount) * 100),
          period,
          next_renew: nextRenew,
        };
        action.run(async () => {
          await api.renew(token, row.id, input);
          onDone();
        });
      }}
    >
      <h3 className="form-title">记一笔续费</h3>
      <p className="form-note">
        {row === null ? '未选择订阅' : `${row.company} · ${row.plan_name}`}
        {row?.status === 'trialing' ? '（试用中的订阅不能直接记续费，后端会返回 409）' : ''}
      </p>
      <label className="field">
        <span className="field-label">金额（美元）</span>
        <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">账期</span>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="monthly">月付</option>
          <option value="yearly">年付</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">下次续费日</span>
        <input className="input" type="date" value={nextRenew} onChange={(e) => setNextRenew(e.target.value)} />
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
        {action.busy ? '提交中…' : '确认入账'}
      </button>
    </form>
  );
}

function PlanForm({ token, onCreated }: { token: string; onCreated: () => void }): React.JSX.Element {
  const action = useAction();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [monthly, setMonthly] = useState('');
  const [yearly, setYearly] = useState('');
  const [quota, setQuota] = useState('');

  return (
    <form
      className="panel-form form-row"
      onSubmit={(e) => {
        e.preventDefault();
        const input: CreatePlanInput = {
          code: code.trim(),
          name: name.trim(),
          price_monthly: Math.round(Number(monthly || '0') * 100),
          price_yearly: Math.round(Number(yearly || '0') * 100),
          seat_quota: Number(quota || '0'),
        };
        action.run(async () => {
          await api.createPlan(token, input);
          setCode('');
          setName('');
          setMonthly('');
          setYearly('');
          setQuota('');
          onCreated();
        });
      }}
    >
      <h3 className="form-title">新增套餐</h3>
      <label className="field">
        <span className="field-label">标识 code</span>
        <input className="input" value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} />
        {action.lastError?.fields.code ? <span className="err">{action.lastError.fields.code}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">名称</span>
        <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
        {action.lastError?.fields.name ? <span className="err">{action.lastError.fields.name}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">月付（美元）</span>
        <input className="input" type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        {action.lastError?.fields.price_monthly ? <span className="err">{action.lastError.fields.price_monthly}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">年付（美元）</span>
        <input className="input" type="number" min="0" step="0.01" value={yearly} onChange={(e) => setYearly(e.target.value)} />
        {action.lastError?.fields.price_yearly ? <span className="err">{action.lastError.fields.price_yearly}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">席位上限</span>
        <input className="input" type="number" min="0" step="1" value={quota} onChange={(e) => setQuota(e.target.value)} />
        {action.lastError?.fields.seat_quota ? <span className="err">{action.lastError.fields.seat_quota}</span> : null}
      </label>
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={action.busy || token === ''}>
        {action.busy ? '提交中…' : '创建'}
      </button>
    </form>
  );
}
