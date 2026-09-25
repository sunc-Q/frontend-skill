import { useEffect, useMemo, useState } from 'react';
import { api, seededAdminToken, setAdminToken } from './api';
import {
  CATEGORY_LABEL,
  GRADE_LABEL,
  MOVE_KIND_LABEL,
  ORDER_STATUS_LABEL,
  PART_STATUS_LABEL,
  PRIORITY_LABEL,
  dateOnly,
  dateTime,
  hourMin,
  lineLabel,
  minutesToHours,
  sign,
  statusLabel,
  waitLabel,
  yuan,
  yuanCompact,
} from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  AddLineInput,
  CreateOrderInput,
  Grade,
  LineKind,
  ListParams,
  MoveRow,
  OrderLineRow,
  OrderRow,
  OrderSort,
  PartRow,
  PartSort,
  Priority,
  ReceiptInput,
  SortDir,
  Stats,
  StockFilter,
  StockLot,
} from './types';

// 业务状态到「语气」的映射放在这里：base.css 只认 tone，不认业务枚举，
// 三套风格因此不可能各自偷偷决定「待料该是什么颜色」。
type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

const STATUS_TONE: Record<string, Tone> = {
  received: 'info',
  diagnosed: 'info',
  awaiting_parts: 'warn',
  repairing: 'warn',
  qc: 'ok',
  settled: 'ok',
  picked_up: 'idle',
  cancelled: 'bad',
};

const PRIORITY_TONE: Record<string, Tone> = {
  normal: 'idle',
  urgent: 'bad',
  warranty: 'warn',
};

const MOVE_TONE: Record<string, Tone> = {
  receipt: 'ok',
  issue: 'info',
  return: 'warn',
  scrap: 'bad',
};

const ORDER_COLUMNS: readonly { key: string; label: string; sort: OrderSort; numeric?: boolean }[] = [
  { key: 'no', label: '工单号', sort: 'no' },
  { key: 'plate', label: '车辆', sort: 'plate' },
  { key: 'opened', label: '开单', sort: 'opened' },
  { key: 'promised', label: '承诺交车', sort: 'promised' },
  { key: 'total', label: '挂账金额', sort: 'total', numeric: true },
  { key: 'tech', label: '服务顾问', sort: 'tech' },
  { key: 'priority', label: '优先级', sort: 'priority' },
  { key: 'status', label: '状态', sort: 'status' },
];

const PART_COLUMNS: readonly { key: string; label: string; sort: PartSort; numeric?: boolean }[] = [
  { key: 'code', label: '配件编码', sort: 'code' },
  { key: 'name', label: '名称 / 品牌', sort: 'name' },
  { key: 'category', label: '类别', sort: 'category' },
  { key: 'onhand', label: '在库', sort: 'onhand', numeric: true },
  { key: 'lot', label: '批次', sort: 'lot', numeric: true },
  { key: 'cost', label: '移动成本', sort: 'cost', numeric: true },
  { key: 'price', label: '挂牌价', sort: 'price', numeric: true },
  { key: 'value', label: '库存金额', sort: 'value', numeric: true },
];

const EMPTY_ORDER: OrderRow = {
  id: 0,
  wo_no: '',
  plate_no: '',
  model: '',
  customer_name: '',
  phone_masked: '',
  mileage_km: 0,
  symptom: '',
  status: 'received',
  priority: 'normal',
  technician: '',
  opened_at: '',
  promised_at: '',
  settled_at: null,
  closed_at: null,
  cancel_reason: '',
  labor_total_cents: 0,
  parts_total_cents: 0,
  grand_total_cents: 0,
  labor_minutes: 0,
  part_qty: 0,
  line_count: 0,
  promise_overdue: false,
  wait_minutes: 0,
  next_statuses: [],
};

type NumberStatKey = { [K in keyof Stats]: Stats[K] extends number ? K : never }[keyof Stats];

const KPI_SPECS: readonly {
  key: NumberStatKey;
  label: string;
  hint: string;
  kind: 'count' | 'money' | 'minutes';
  alarm?: boolean;
}[] = [
  { key: 'open_orders', label: '在制工单', hint: '接车至待提车，车还在厂内', kind: 'count' },
  { key: 'today_opened', label: '今日开单', hint: '按后端 UTC 日历日', kind: 'count' },
  { key: 'awaiting_parts', label: '待料', hint: '缺件挂起，进不了在修', kind: 'count', alarm: true },
  { key: 'promise_late', label: '超承诺交车', hint: '在制且已过承诺时点', kind: 'count', alarm: true },
  { key: 'revenue_cents', label: '结算营收', hint: 'Σ已结算工单挂账总额', kind: 'money' },
  { key: 'gross_margin_cents', label: '毛利', hint: '营收 − FIFO 出库批次成本', kind: 'money' },
  { key: 'open_labor_minutes', label: '在制工时', hint: '未离场工单已记分钟数', kind: 'minutes' },
  { key: 'today_issues', label: '今日出库行', hint: 'stock_moves 中 kind=issue', kind: 'count' },
  { key: 'stock_value_cents', label: '库存价值', hint: 'Σ批次余量 × 批次单位成本', kind: 'money' },
  { key: 'low_stock_parts', label: '低于再订货点', hint: '在用件在库 ≤ 订货点', kind: 'count', alarm: true },
  { key: 'settled_wait', label: '已结算待提车', hint: '钱已收、车未提', kind: 'count' },
];

interface LineDraft {
  kind: LineKind;
  operation: string;
  grade: Grade;
  durationMin: string;
  partCode: string;
  qty: string;
  note: string;
}

const EMPTY_LINE: LineDraft = {
  kind: 'labor',
  operation: '',
  grade: 'middle',
  durationMin: '60',
  partCode: '',
  qty: '1',
  note: '',
};

interface OrderDraft {
  plateNo: string;
  model: string;
  customerName: string;
  phone: string;
  mileageKm: string;
  symptom: string;
  priority: Priority;
  technician: string;
}

const EMPTY_NEW_ORDER: OrderDraft = {
  plateNo: '',
  model: '',
  customerName: '',
  phone: '',
  mileageKm: '',
  symptom: '',
  priority: 'normal',
  technician: '',
};

interface ReceiptDraft {
  partCode: string;
  lotNo: string;
  qty: string;
  unitCostYuan: string;
  supplier: string;
  expiresOn: string;
}

const EMPTY_RECEIPT: ReceiptDraft = {
  partCode: '',
  lotNo: '',
  qty: '10',
  unitCostYuan: '',
  supplier: '',
  expiresOn: '',
};

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<string>(() => initialTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  // 令牌只活在这一页的内存里：不写 localStorage、不进构建产物。
  const [token, setTokenState] = useState<string>(() => seededAdminToken());
  const setToken = (v: string): void => {
    setTokenState(v);
    setAdminToken(v);
  };
  useEffect(() => {
    setAdminToken(token);
  }, [token]);
  const canWrite = token !== '';

  const stats = useAsync<Stats>(() => api.stats(14), []);

  const [orderFilters, setOrderFilters] = useState<ListParams>({
    sort: 'promised',
    dir: 'asc',
    status: 'open',
    page_size: 12,
  });
  const [orderPage, setOrderPage] = useState(1);
  const orders = useAsync(
    () => api.orders({ ...orderFilters, page: orderPage }),
    [orderFilters.status, orderFilters.priority, orderFilters.q, orderFilters.sort, orderFilters.dir, orderPage],
  );

  const [pickedNo, setPickedNo] = useState<string | null>(null);
  const detail = useAsync(
    () => (pickedNo === null ? Promise.resolve(null) : api.order(pickedNo)),
    [pickedNo, orders.data?.items.length ?? 0],
  );
  useEffect(() => {
    if (pickedNo === null && (orders.data?.items.length ?? 0) > 0) {
      setPickedNo(orders.data?.items[0]?.wo_no ?? null);
    }
  }, [orders.data, pickedNo]);

  const [partFilters, setPartFilters] = useState<ListParams>({ sort: 'value', dir: 'desc', page_size: 8 });
  const [partPage, setPartPage] = useState(1);
  const parts = useAsync(
    () => api.parts({ ...partFilters, page: partPage }),
    [partFilters.q, partFilters.category, partFilters.stock, partFilters.status, partFilters.sort, partFilters.dir, partPage],
  );
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const partDetail = useAsync(
    () => (pickedCode === null ? Promise.resolve(null) : api.part(pickedCode)),
    [pickedCode],
  );
  useEffect(() => {
    if (pickedCode === null && (parts.data?.items.length ?? 0) > 0) {
      setPickedCode(parts.data?.items[0]?.code ?? null);
    }
  }, [parts.data, pickedCode]);

  const [lineDraft, setLineDraft] = useState<LineDraft>(EMPTY_LINE);

  const orderTotal = orders.data?.total ?? 0;
  const orderPages = Math.max(1, Math.ceil(orderTotal / (orderFilters.page_size ?? 12)));
  const partTotal = parts.data?.total ?? 0;
  const partPages = Math.max(1, Math.ceil(partTotal / (partFilters.page_size ?? 8)));

  const order: OrderRow = detail.data?.order ?? EMPTY_ORDER;
  const reloadAll = (): void => {
    orders.reload();
    stats.reload();
    detail.reload();
    parts.reload();
    partDetail.reload();
  };

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">铁砧汽修 · 工单与配件台</span>
          <span className="brand-sub">Workorder &amp; Parts Desk</span>
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
          同一套接口与页面骨架，三种互不相同的视觉主张。数据全部来自 Go/Gin + SQLite 后端的真实查询，口径写死后端：
          <b>配件出库按 FIFO 批次结算成本</b>（先入库先出，缺件整单回滚），
          <b>工时费 = 分钟 × 技师等级小时费率 ÷ 60</b>，质检之后明细锁定，作废自动退料回原批次；
          手机号只以掩码出场。
        </p>
        <p className="stamp">
          今日 {stats.data ? stats.data.today : '加载中'} · {stats.data?.window ?? ''}
        </p>
      </div>

      <Banner state={stats} label="统计接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">车间运行指标</h2>
            <span className="section-note">账实相符与金额恒等式由后端逐次回验</span>
          </div>
          <KpiGrid s={stats.data} />

          <div className="section-head">
            <h2 className="section-title">工单台账</h2>
            <span className="section-note">
              第 {orderPage} / {orderPages} 页 · 共 {orderTotal} 单
            </span>
          </div>
          <OrderFilters
            value={orderFilters}
            page={orderPage}
            pages={orderPages}
            onChange={(next) => {
              setOrderFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setOrderPage(1);
            }}
            onPage={setOrderPage}
          />
          <Banner state={orders} label="工单列表" />
          <OrderTable
            rows={orders.data?.items ?? []}
            loading={orders.loading}
            sort={(orderFilters.sort ?? 'promised') as OrderSort}
            dir={orderFilters.dir ?? 'asc'}
            pickedNo={pickedNo}
            onSort={(sort) => {
              const dir: SortDir = orderFilters.sort === sort && orderFilters.dir !== 'asc' ? 'asc' : 'desc';
              setOrderFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(no) => setPickedNo(no)}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">状态分布</h2>
            <span className="section-note">全量工单 · 含累计挂账</span>
          </div>
          <StatusBars s={stats.data} />
          <div className="section-head">
            <h2 className="section-title">配件类别库存</h2>
            <span className="section-note">按库存金额降序</span>
          </div>
          <CategoryBars s={stats.data} />
          <div className="section-head">
            <h2 className="section-title">近两周开单与结算</h2>
            <span className="section-note">开单 / 结算（单次）</span>
          </div>
          <TrendTable points={stats.data?.trend ?? []} />
          <div className="section-head">
            <h2 className="section-title">30 天耗材排行</h2>
            <span className="section-note">按出库销售额</span>
          </div>
          <TopPartsTable rows={stats.data?.top_parts ?? []} onPick={setPickedCode} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">工单详情</h2>
            <span className="section-note">{pickedNo ?? '未选择'}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <Facts row={order} loading={detail.loading} />

          <div className="section-head">
            <h2 className="section-title">结算明细</h2>
            <span className="section-note">合计取工单头快照，不由前端二次求和</span>
          </div>
          <LineTable rows={detail.data?.lines ?? []} head={order} loading={detail.loading} />

          <div className="section-head">
            <h2 className="section-title">本单库存流水</h2>
            <span className="section-note">出库即扣批次，作废即退原批次</span>
          </div>
          <MoveTable rows={detail.data?.moves ?? []} loading={detail.loading} showPart />
        </div>

        <div className="detail-side">
          <TransitionPanel
            canWrite={canWrite}
            row={pickedNo === null ? null : order}
            onDone={reloadAll}
          />
          <LineForm
            canWrite={canWrite}
            row={pickedNo === null ? null : order}
            draft={lineDraft}
            onDraft={setLineDraft}
            onDone={reloadAll}
          />
        </div>
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">配件库存与批次</h2>
          <span className="section-note">
            第 {partPage} / {partPages} 页 · 共 {partTotal} 种 · 点击行查看 FIFO 批次
          </span>
        </div>
        <div className="layout">
          <div className="col-main">
            <PartFilters
              value={partFilters}
              page={partPage}
              pages={partPages}
              onChange={(next) => {
                setPartFilters((prev) => ({ ...prev, ...next.next }));
                if (next.resetPage) setPartPage(1);
              }}
              onPage={setPartPage}
            />
            <Banner state={parts} label="配件列表" />
            <PartTable
              rows={parts.data?.items ?? []}
              loading={parts.loading}
              sort={(partFilters.sort ?? 'value') as PartSort}
              dir={partFilters.dir ?? 'desc'}
              pickedCode={pickedCode}
              onSort={(sort) => {
                const dir: SortDir = partFilters.sort === sort && partFilters.dir !== 'asc' ? 'asc' : 'desc';
                setPartFilters((prev) => ({ ...prev, sort, dir }));
              }}
              onPick={(code) => setPickedCode(code)}
            />
          </div>
          <aside className="col-side">
            <div className="section-head">
              <h2 className="section-title">批次与流水</h2>
              <span className="section-note">{pickedCode ?? '未选择'}</span>
            </div>
            <Banner state={partDetail} label="配件详情" />
            <PartFacts row={partDetail.data?.part ?? null} loading={partDetail.loading} />
            <LotsPanel
              loading={partDetail.loading}
              lots={partDetail.data?.lots ?? []}
              onIssue={(code) => setLineDraft((prev) => ({ ...prev, kind: 'part', partCode: code }))}
            />
            <MoveTable rows={partDetail.data?.moves ?? []} loading={partDetail.loading} showPart={false} />
          </aside>
        </div>
      </section>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">受理开单与到货入库</h2>
          <span className="section-note">写接口需 Bearer ADMIN_TOKEN；校验失败按字段回显</span>
        </div>
        <div className="layout">
          <div className="col-main">
            <NewOrderForm
              canWrite={canWrite}
              onCreated={(no) => {
                setPickedNo(no);
                reloadAll();
              }}
            />
          </div>
          <aside className="col-side">
            <ReceiptForm canWrite={canWrite} prefillCode={pickedCode ?? ''} onDone={reloadAll} />
          </aside>
        </div>

        <div className="section-head">
          <h2 className="section-title">后端自检</h2>
          <span className="section-note">每次 /api/stats 实测，不是文档里的承诺</span>
        </div>
        <InvariantPanel s={stats.data} />

        <p className="footnote">
          接口：GET /api/health · /api/work-orders · /api/work-orders/&#123;no&#125; · /api/parts ·
          /api/parts/&#123;code&#125; · /api/stats?days=；POST /api/admin/work-orders ·
          /api/admin/work-orders/&#123;no&#125;/transition · /api/admin/work-orders/&#123;no&#125;/lines ·
          /api/admin/receipts。
        </p>
      </footer>
    </div>
  );
}

export function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  return <style data-theme-css={theme}>{themeCss(theme)}</style>;
}

function Banner({
  state,
  label,
}: {
  state: { loading: boolean; error: string | null };
  label: string;
}): React.JSX.Element | null {
  if (state.error === null) return null;
  return (
    <p className="banner" role="status">
      <span className="banner-tag">{label}</span>
      {state.loading ? '重试中… ' : ''}
      {state.error}
    </p>
  );
}

function NoToken({ shown }: { shown: boolean }): React.JSX.Element | null {
  if (!shown) return null;
  return <p className="hint">右上角填入 ADMIN_TOKEN 后才能提交，写接口一律过 Bearer 校验。</p>;
}

function useDebouncedSearch(
  current: string,
  onChange: (v: string) => void,
): [string, (v: string) => void] {
  const [text, setText] = useState(current);
  useEffect(() => {
    if (text === current) return;
    const id = window.setTimeout(() => onChange(text), 320);
    return () => window.clearTimeout(id);
  }, [text, current, onChange]);
  return [text, setText];
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}): React.JSX.Element {
  return (
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
  );
}

function KpiGrid({ s }: { s: Stats | null }): React.JSX.Element {
  return (
    <div className="kpis">
      {KPI_SPECS.map((spec) => {
        const raw = s === null ? null : s[spec.key];
        const value = typeof raw === 'number' ? raw : 0;
        const text =
          s === null
            ? '—'
            : spec.kind === 'money'
              ? yuanCompact(value)
              : spec.kind === 'minutes'
                ? minutesToHours(value)
                : value.toLocaleString('zh-CN');
        const warn = spec.alarm === true ? (value > 0 ? 'true' : 'false') : 'none';
        return (
          <article className="kpi" key={spec.key} data-warn={warn}>
            <h3 className="kpi-label">{spec.label}</h3>
            <p className="kpi-value">{text}</p>
            <p className="kpi-hint">{spec.hint}</p>
          </article>
        );
      })}
      <article className="kpi" data-warn={s !== null && !s.stock_invariant_ok ? 'true' : 'false'}>
        <h3 className="kpi-label">账实自检</h3>
        <p className="kpi-value">{s === null ? '—' : s.stock_invariant_ok && s.amount_invariant_ok ? '通过' : '异常'}</p>
        <p className="kpi-hint">
          {s !== null && (s.identity_violations > 0 || !s.stock_invariant_ok)
            ? s.identity_issues.join('；')
            : `库存流水 == 批次余量 · 已核 ${s?.checked_orders ?? 0} 单金额`}
        </p>
      </article>
    </div>
  );
}

interface FilterChange {
  next: Partial<ListParams>;
  resetPage: boolean;
}

function OrderFilters({
  value,
  page,
  pages,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  pages: number;
  onChange: (next: FilterChange) => void;
  onPage: (p: number) => void;
}): React.JSX.Element {
  const [search, setSearch] = useDebouncedSearch(value.q ?? '', (v) =>
    onChange({ next: { q: v }, resetPage: true }),
  );
  return (
    <div className="filters">
      <label className="field">
        <span className="field-label">状态</span>
        <select
          className="input"
          value={value.status ?? ''}
          onChange={(e) => onChange({ next: { status: e.target.value }, resetPage: true })}
        >
          <option value="">全部状态</option>
          <option value="open">在厂（未提车）</option>
          {(Object.keys(ORDER_STATUS_LABEL) as (keyof typeof ORDER_STATUS_LABEL)[]).map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">优先级</span>
        <select
          className="input"
          value={value.priority ?? ''}
          onChange={(e) => onChange({ next: { priority: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {(Object.keys(PRIORITY_LABEL) as (keyof typeof PRIORITY_LABEL)[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
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
          placeholder="工单号 / 车牌 / 客户 / 服务顾问"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <Pager page={page} pages={pages} onPage={onPage} />
    </div>
  );
}

function OrderTable({
  rows,
  loading,
  sort,
  dir,
  pickedNo,
  onSort,
  onPick,
}: {
  rows: OrderRow[];
  loading: boolean;
  sort: OrderSort;
  dir: SortDir;
  pickedNo: string | null;
  onSort: (key: OrderSort) => void;
  onPick: (no: string) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">点击行查看结算明细与状态推进入口</caption>
        <thead>
          <tr>
            {ORDER_COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'num' : undefined}
                aria-sort={col.sort === sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className="sortbtn" data-on={col.sort === sort ? 'true' : 'false'} onClick={() => onSort(col.sort)}>
                  <span>{col.label}</span>
                  <span className="sortmark" aria-hidden="true">
                    {col.sort === sort ? (dir === 'asc' ? '▲' : '▼') : '·'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="empty" colSpan={ORDER_COLUMNS.length}>
                没有符合条件的工单
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr
              key={r.wo_no}
              data-active={r.wo_no === pickedNo ? 'true' : 'false'}
              onClick={() => onPick(r.wo_no)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(r.wo_no);
                }
              }}
            >
              <td className="mono">
                {r.wo_no}
                <span className="cell-sub">{r.mileage_km.toLocaleString('zh-CN')} km · {r.line_count} 行</span>
              </td>
              <td>
                <span className="cell-strong mono">{r.plate_no}</span>
                <span className="cell-sub">
                  {r.model} · {r.customer_name} {r.phone_masked}
                </span>
              </td>
              <td className="mono">
                {dateOnly(r.opened_at)} {hourMin(r.opened_at)}
                <span className="cell-sub" data-alarm={r.promise_overdue ? 'true' : 'false'}>
                  {r.promise_overdue ? '超承诺 · ' : ''}
                  {waitLabel(r.wait_minutes)}
                </span>
              </td>
              <td className="mono">
                {dateOnly(r.promised_at)} {hourMin(r.promised_at)}
                <span className="cell-sub">{r.symptom}</span>
              </td>
              <td className="num mono">
                {yuan(r.grand_total_cents)}
                <span className="cell-sub">
                  工时 {yuanCompact(r.labor_total_cents)} / 配件 {yuanCompact(r.parts_total_cents)}
                </span>
              </td>
              <td>{r.technician}</td>
              <td>
                <span className="badge" data-tone={PRIORITY_TONE[r.priority] ?? 'idle'}>
                  {PRIORITY_LABEL[r.priority as keyof typeof PRIORITY_LABEL] ?? r.priority}
                </span>
              </td>
              <td>
                <span className="badge" data-tone={STATUS_TONE[r.status] ?? 'idle'}>
                  {statusLabel(r.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value, alarm, mono }: { label: string; value: string; alarm?: boolean; mono?: boolean }): React.JSX.Element {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined} data-alarm={alarm === true ? 'true' : 'false'}>
        {value}
      </dd>
    </div>
  );
}

function Facts({ row, loading }: { row: OrderRow; loading: boolean }): React.JSX.Element {
  if (row.wo_no === '') {
    return <p className="placeholder">{loading ? '正在读取工单…' : '在台账中选择一张工单。'}</p>;
  }
  return (
    <dl className="facts">
      <Fact label="工单号" value={row.wo_no} mono />
      <Fact label="车牌" value={row.plate_no} mono />
      <Fact label="车型" value={row.model} />
      <Fact label="客户" value={`${row.customer_name} · ${row.phone_masked}`} />
      <Fact label="里程" value={`${row.mileage_km.toLocaleString('zh-CN')} km`} mono />
      <Fact label="服务顾问" value={row.technician} />
      <Fact label="状态" value={statusLabel(row.status)} />
      <Fact label="优先级" value={PRIORITY_LABEL[row.priority as keyof typeof PRIORITY_LABEL] ?? row.priority} />
      <Fact label="开单时间" value={dateTime(row.opened_at)} mono />
      <Fact label="承诺交车" value={dateTime(row.promised_at)} mono alarm={row.promise_overdue} />
      <Fact label="在厂时长" value={waitLabel(row.wait_minutes)} />
      <Fact label="工时合计" value={`${minutesToHours(row.labor_minutes)} · ${yuan(row.labor_total_cents)}`} mono />
      <Fact label="配件合计" value={`${row.part_qty} 件 · ${yuan(row.parts_total_cents)}`} mono />
      <Fact label="挂账总额" value={yuan(row.grand_total_cents)} mono />
      <Fact label="结算时间" value={row.settled_at === null ? '未结算' : dateTime(row.settled_at)} mono />
      <Fact label="离场时间" value={row.closed_at === null ? '在厂' : dateTime(row.closed_at)} mono />
      <Fact label="故障描述" value={row.symptom} />
      <Fact label="作废原因" value={row.cancel_reason === '' ? '—' : row.cancel_reason} alarm={row.status === 'cancelled'} />
    </dl>
  );
}

function LineTable({
  rows,
  head,
  loading,
}: {
  rows: OrderLineRow[];
  head: OrderRow;
  loading: boolean;
}): React.JSX.Element {
  const labor = rows.filter((l) => l.kind === 'labor');
  const parts = rows.filter((l) => l.kind === 'part');
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">工时行 ×{labor.length} · 配件行 ×{parts.length}，配件单价为 FIFO 批次成本</caption>
        <thead>
          <tr>
            <th scope="col">行别</th>
            <th scope="col">项目 / 配件</th>
            <th scope="col" className="num">
              数量 · 工时
            </th>
            <th scope="col" className="num">
              单价
            </th>
            <th scope="col" className="num">
              成本
            </th>
            <th scope="col" className="num">
              金额
            </th>
            <th scope="col">备注 / 记账时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="empty" colSpan={7}>
                这张工单还没有明细行
              </td>
            </tr>
          ) : null}
          {rows.map((l) => (
            <tr key={l.id}>
              <td>
                <span className="badge" data-tone={l.kind === 'labor' ? 'info' : 'idle'}>
                  {lineLabel(l.kind)}
                </span>
              </td>
              <td>
                <span className="cell-strong">{l.kind === 'labor' ? l.operation : l.part_name}</span>
                <span className="cell-sub">
                  {l.kind === 'labor'
                    ? `${GRADE_LABEL[l.grade as keyof typeof GRADE_LABEL] ?? l.grade}技师`
                    : `${l.part_code} · ${l.unit}`}
                </span>
              </td>
              <td className="num mono">
                {l.kind === 'labor' ? '—' : `${l.qty} ${l.unit}`}
                <span className="cell-sub">{l.kind === 'labor' ? `${l.duration_min} 分钟` : ''}</span>
              </td>
              <td className="num mono">{yuan(l.kind === 'labor' ? 0 : l.unit_price_cents)}</td>
              <td className="num mono">{yuan(l.cost_cents)}</td>
              <td className="num mono">{yuan(l.amount_cents)}</td>
              <td>
                {l.note === '' ? '—' : l.note}
                <span className="cell-sub mono">{dateTime(l.created_at)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>
              工时小计 {yuan(head.labor_total_cents)} · 配件小计 {yuan(head.parts_total_cents)}
            </td>
            <td className="num mono">—</td>
            <td className="num mono">{yuan(head.grand_total_cents)}</td>
            <td>合计为工单头快照，后端复核 grand = labor + parts = Σ行金额</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MoveTable({ rows, loading, showPart }: { rows: MoveRow[]; loading: boolean; showPart: boolean }): React.JSX.Element {
  const cols = 5 + (showPart ? 1 : 0);
  return (
    <table className="table mini plain">
      <caption className="caption">库存流水 {rows.length === 0 ? (loading ? '正在读取…' : '（无）') : `· 最近 ${rows.length} 条`}</caption>
      <thead>
        <tr>
          <th scope="col">时间</th>
          {showPart ? <th scope="col">配件</th> : null}
          <th scope="col">批次</th>
          <th scope="col">方向</th>
          <th scope="col" className="num">
            件数
          </th>
          <th scope="col" className="num">
            单位成本
          </th>
          <th scope="col">关联</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td className="mono">{dateTime(m.occurred_at)}</td>
            {showPart ? <td className="mono">{m.part_code}</td> : null}
            <td className="mono">{m.lot_no}</td>
            <td>
              <span className="badge" data-tone={MOVE_TONE[m.kind] ?? 'idle'}>
                {MOVE_KIND_LABEL[m.kind as keyof typeof MOVE_KIND_LABEL] ?? m.kind}
              </span>
            </td>
            <td className="num mono" data-alarm={m.qty_delta < 0 ? 'true' : 'false'}>
              {sign(m.qty_delta)}
            </td>
            <td className="num mono">{yuan(m.unit_cost_cents)}</td>
            <td className="mono">{m.wo_no === '' ? m.note : m.wo_no}</td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td className="empty" colSpan={cols}>
              暂无流水
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function TransitionPanel({
  canWrite,
  row,
  onDone,
}: {
  canWrite: boolean;
  row: OrderRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [reason, setReason] = useState('');
  useEffect(() => {
    action.clear();
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.wo_no]);

  if (row === null) {
    return (
      <div className="panel-form">
        <h3 className="form-title">状态推进</h3>
        <p className="placeholder">未选择工单。</p>
      </div>
    );
  }
  const cancellable = row.next_statuses.includes('cancelled');
  return (
    <div className="panel-form">
      <h3 className="form-title">状态推进</h3>
      <p className="form-note">
        {row.wo_no} 当前「{statusLabel(row.status)}」，可推进目标由后端状态机给出。
      </p>
      {row.next_statuses.length === 0 ? <p className="hint">该工单已是终态，只读归档。</p> : null}
      <div className="btn-row">
        {row.next_statuses.map((to) => (
          <button
            key={to}
            type="button"
            className="btn"
            data-tone={to === 'cancelled' ? 'bad' : 'ok'}
            disabled={!canWrite || action.busy}
            onClick={() => {
              action.run(async () => {
                const res = await api.transition(row.wo_no, to === 'cancelled' && reason !== '' ? { to, reason } : { to });
                setReason('');
                onDone();
                return res.message;
              });
            }}
          >
            → {statusLabel(to)}
          </button>
        ))}
      </div>
      {cancellable ? (
        <label className="field">
          <span className="field-label">作废原因（选填，≤ 64 字）</span>
          <input className="input" value={reason} maxLength={64} onChange={(e) => setReason(e.target.value)} />
          {action.lastError?.fields.reason ? <span className="err">{action.lastError.fields.reason}</span> : null}
          <span className="form-note">作废会把已出库的配件按原批次退回。</span>
        </label>
      ) : null}
      <NoToken shown={!canWrite} />
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
    </div>
  );
}

function LineForm({
  canWrite,
  row,
  draft,
  onDraft,
  onDone,
}: {
  canWrite: boolean;
  row: OrderRow | null;
  draft: LineDraft;
  onDraft: (next: LineDraft) => void;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  useEffect(() => {
    action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.wo_no]);

  const editable = row !== null && ['received', 'diagnosed', 'awaiting_parts', 'repairing'].includes(row.status);
  const set = (patch: Partial<LineDraft>): void => onDraft({ ...draft, ...patch });

  const submit = (): void => {
    if (row === null) return;
    const note = draft.note.trim();
    const input: AddLineInput =
      draft.kind === 'labor'
        ? {
            kind: 'labor',
            operation: draft.operation.trim(),
            grade: draft.grade,
            duration_min: Number(draft.durationMin) || 0,
            ...(note === '' ? {} : { note }),
          }
        : {
            kind: 'part',
            part_code: draft.partCode.trim(),
            qty: Number(draft.qty) || 0,
            ...(note === '' ? {} : { note }),
          };
    action.run(async () => {
      const res = await api.addLine(row.wo_no, input);
      onDraft({ ...draft, operation: '', partCode: '', note: '' });
      onDone();
      return res.message;
    });
  };

  const err = action.lastError?.fields ?? {};
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h3 className="form-title">追加明细行</h3>
      <div className="tabs" role="group" aria-label="行别">
        {(['labor', 'part'] as LineKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className="tab"
            aria-pressed={draft.kind === k ? 'true' : 'false'}
            onClick={() => set({ kind: k })}
          >
            {lineLabel(k)}
          </button>
        ))}
      </div>
      {draft.kind === 'labor' ? (
        <>
          <label className="field">
            <span className="field-label">工时项目</span>
            <input
              className="input"
              value={draft.operation}
              maxLength={64}
              placeholder="更换前刹车片"
              onChange={(e) => set({ operation: e.target.value })}
            />
            {err.operation ? <span className="err">{err.operation}</span> : null}
          </label>
          <label className="field">
            <span className="field-label">技师等级</span>
            <select className="input" value={draft.grade} onChange={(e) => set({ grade: e.target.value as Grade })}>
              {(Object.keys(GRADE_LABEL) as Grade[]).map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABEL[g]}（费率由后端定）
                </option>
              ))}
            </select>
            {err.grade ? <span className="err">{err.grade}</span> : null}
          </label>
          <label className="field">
            <span className="field-label">工时（分钟）</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1440}
              value={draft.durationMin}
              onChange={(e) => set({ durationMin: e.target.value })}
            />
            {err.duration_min ? <span className="err">{err.duration_min}</span> : null}
          </label>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">配件编码</span>
            <input
              className="input mono"
              value={draft.partCode}
              maxLength={16}
              placeholder="BR-PAD-01"
              onChange={(e) => set({ partCode: e.target.value })}
            />
            {err.part_code ? <span className="err">{err.part_code}</span> : null}
          </label>
          <label className="field">
            <span className="field-label">出库件数</span>
            <input
              className="input"
              type="number"
              min={1}
              max={999}
              value={draft.qty}
              onChange={(e) => set({ qty: e.target.value })}
            />
            {err.qty ? <span className="err">{err.qty}</span> : null}
          </label>
          <p className="form-note">出库按 FIFO 从最早批次扣减；件数不足后端整单回滚并返回缺件量。</p>
        </>
      )}
      <label className="field">
        <span className="field-label">备注（选填）</span>
        <input className="input" value={draft.note} maxLength={64} onChange={(e) => set({ note: e.target.value })} />
        {err.note ? <span className="err">{err.note}</span> : null}
      </label>
      {err.kind ? <p className="err">{err.kind}</p> : null}
      <NoToken shown={!canWrite} />
      {!editable ? <p className="hint">质检之后明细锁定，不能再加行。</p> : null}
      {action.lastError?.code === 'insufficient_stock' ? (
        <p className="hint">缺件：可在下方「到货入库」为该配件建批次后再出库。</p>
      ) : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary"
        disabled={!canWrite || !editable || action.busy || row === null}
      >
        {action.busy ? '记账中…' : '记入本单'}
      </button>
    </form>
  );
}

function PartFilters({
  value,
  page,
  pages,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  pages: number;
  onChange: (next: FilterChange) => void;
  onPage: (p: number) => void;
}): React.JSX.Element {
  const [search, setSearch] = useDebouncedSearch(value.q ?? '', (v) =>
    onChange({ next: { q: v }, resetPage: true }),
  );
  return (
    <div className="filters">
      <label className="field">
        <span className="field-label">库存</span>
        <select
          className="input"
          value={value.stock ?? ''}
          onChange={(e) => onChange({ next: { stock: e.target.value as StockFilter }, resetPage: true })}
        >
          <option value="">全部</option>
          <option value="low">低于订货点</option>
          <option value="out">零库存</option>
          <option value="ok">库存充足</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">类别</span>
        <select
          className="input"
          value={value.category ?? ''}
          onChange={(e) => onChange({ next: { category: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">状态</span>
        <select
          className="input"
          value={value.status ?? ''}
          onChange={(e) => onChange({ next: { status: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          <option value="active">在用</option>
          <option value="discontinued">停用</option>
        </select>
      </label>
      <label className="field field-wide">
        <span className="field-label">检索</span>
        <input
          className="input"
          type="search"
          value={search}
          maxLength={40}
          placeholder="编码 / 名称 / 品牌 / 库位"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <Pager page={page} pages={pages} onPage={onPage} />
    </div>
  );
}

function PartTable({
  rows,
  loading,
  sort,
  dir,
  pickedCode,
  onSort,
  onPick,
}: {
  rows: PartRow[];
  loading: boolean;
  sort: PartSort;
  dir: SortDir;
  pickedCode: string | null;
  onSort: (key: PartSort) => void;
  onPick: (code: string) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">在库件数按批次余量汇总；移动成本是加权平均，出库成本按 FIFO 批次</caption>
        <thead>
          <tr>
            {PART_COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'num' : undefined}
                aria-sort={col.sort === sort ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className="sortbtn" data-on={col.sort === sort ? 'true' : 'false'} onClick={() => onSort(col.sort)}>
                  <span>{col.label}</span>
                  <span className="sortmark" aria-hidden="true">
                    {col.sort === sort ? (dir === 'asc' ? '▲' : '▼') : '·'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="empty" colSpan={PART_COLUMNS.length}>
                没有符合条件的配件
              </td>
            </tr>
          ) : null}
          {rows.map((p) => (
            <tr
              key={p.code}
              data-active={p.code === pickedCode ? 'true' : 'false'}
              onClick={() => onPick(p.code)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(p.code);
                }
              }}
            >
              <td className="mono">{p.code}</td>
              <td>
                <span className="cell-strong">{p.name}</span>
                <span className="cell-sub">
                  {p.brand} · {p.shelf_location}
                </span>
              </td>
              <td>
                {CATEGORY_LABEL[p.category] ?? p.category}
                <span className="badge" data-tone={p.status === 'active' ? 'idle' : 'bad'}>
                  {PART_STATUS_LABEL[p.status] ?? p.status}
                </span>
              </td>
              <td className="num mono" data-alarm={p.below_reorder ? 'true' : 'false'}>
                {p.on_hand} {p.unit}
                <span className="cell-sub">订货点 · 近 30 天耗 {p.consumed_30d}</span>
              </td>
              <td className="num mono">
                {p.lot_count}
                <span className="cell-sub">{p.oldest_lot_at === '' ? '无批次' : `最早 ${p.oldest_lot_at}`}</span>
              </td>
              <td className="num mono">{yuan(p.avg_cost_cents)}</td>
              <td className="num mono">{yuan(p.list_price_cents)}</td>
              <td className="num mono">{yuan(p.stock_value_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartFacts({ row, loading }: { row: PartRow | null; loading: boolean }): React.JSX.Element {
  if (row === null) {
    return <p className="placeholder">{loading ? '正在读取配件…' : '在库存表中选择一个配件。'}</p>;
  }
  return (
    <dl className="facts">
      <Fact label="编码" value={row.code} mono />
      <Fact label="名称" value={`${row.name}（${row.brand}）`} />
      <Fact label="类别" value={CATEGORY_LABEL[row.category] ?? row.category} />
      <Fact label="库位" value={row.shelf_location} mono />
      <Fact label="在库 / 订货点" value={`${row.on_hand} ${row.unit} / ${row.reorder_point}`} mono alarm={row.below_reorder} />
      <Fact label="库存金额" value={yuan(row.stock_value_cents)} mono />
      <Fact label="近 30 天消耗" value={`${row.consumed_30d} ${row.unit}`} mono />
      <Fact label="挂牌价 / 移动成本" value={`${yuan(row.list_price_cents)} / ${yuan(row.avg_cost_cents)}`} mono />
    </dl>
  );
}

function LotsPanel({
  lots,
  loading,
  onIssue,
}: {
  lots: StockLot[];
  loading: boolean;
  onIssue: (code: string) => void;
}): React.JSX.Element {
  if (lots.length === 0) {
    return <p className="placeholder">{loading ? '正在读取批次…' : '该配件当前没有批次库存。'}</p>;
  }
  const firstWithStock = lots.find((l) => l.qty_remaining > 0)?.id ?? -1;
  return (
    <ul className="lotlist">
      {lots.map((l, i) => (
        <li className="lotrow" key={l.lot_no} data-alarm={l.qty_remaining === 0 ? 'true' : 'false'}>
          <span className="badge" data-tone={l.id === firstWithStock ? 'ok' : l.qty_remaining === 0 ? 'bad' : 'idle'}>
            {l.qty_remaining === 0 ? '已出空' : `FIFO #${i + 1}`}
          </span>
          <span className="cell-strong mono">{l.lot_no}</span>
          <span className="cell-sub">
            {l.supplier} · 入 {dateOnly(l.received_at)} · {yuan(l.unit_cost_cents)}/件
          </span>
          <span className="mono">
            {l.qty_remaining}/{l.qty_received}
          </span>
          <span className="cell-sub">{l.expires_at === null ? '长期' : `效期 ${dateOnly(l.expires_at)}`}</span>
          {l.qty_remaining > 0 ? (
            <button type="button" className="btn btn-mini" onClick={() => onIssue(l.part_code)}>
              出库此件 →
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StatusBars({ s }: { s: Stats | null }): React.JSX.Element {
  const rows = useMemo(() => [...(s?.by_status ?? [])].sort((a, b) => b.count - a.count), [s]);
  const max = rows[0]?.count ?? 1;
  return (
    <ul className="bars">
      {rows.map((b) => (
        <li className="bar" key={b.status}>
          <span className="bar-head">
            <span className="bar-name">{statusLabel(b.status)}</span>
            <span className="bar-value">{b.count} 单</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((b.count / max) * 100))}%` }} />
          </span>
          <span className="bar-foot">
            {b.revenue_cents > 0 ? `挂账 ${yuan(b.revenue_cents)} · ` : ''}
            {b.open_minutes > 0 ? `累计在厂 ${minutesToHours(Math.round(b.open_minutes / 60))}` : '无在厂时长'}
          </span>
        </li>
      ))}
      {rows.length === 0 ? <li className="bar">正在读取…</li> : null}
    </ul>
  );
}

function CategoryBars({ s }: { s: Stats | null }): React.JSX.Element {
  const rows = useMemo(() => [...(s?.by_category ?? [])].sort((a, b) => b.value_cents - a.value_cents), [s]);
  const max = rows[0]?.value_cents ?? 1;
  return (
    <ul className="bars">
      {rows.map((c) => (
        <li className="bar" key={c.category}>
          <span className="bar-head">
            <span className="bar-name">{CATEGORY_LABEL[c.category] ?? c.category}</span>
            <span className="bar-value">{yuanCompact(c.value_cents)}</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((c.value_cents / max) * 100))}%` }} />
          </span>
          <span className="bar-foot">
            {c.parts} 种 · 在库 {c.on_hand} 件{c.short_parts > 0 ? ` · ${c.short_parts} 种待补` : ''}
          </span>
        </li>
      ))}
      {rows.length === 0 ? <li className="bar">正在读取…</li> : null}
    </ul>
  );
}

function TrendTable({ points }: { points: Stats['trend'] }): React.JSX.Element {
  const max = points.reduce((acc, p) => Math.max(acc, p.opened, p.settled), 1);
  return (
    <table className="table mini plain">
      <caption className="caption">开单 / 结算（趋势点数与查询天数一致）</caption>
      <thead>
        <tr>
          <th scope="col">日期</th>
          <th scope="col" className="num">
            开单
          </th>
          <th scope="col" className="num">
            结算
          </th>
          <th scope="col">走势</th>
          <th scope="col" className="num">
            营收
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.day}>
            <td className="mono">{p.day.slice(5)}</td>
            <td className="num mono">{p.opened}</td>
            <td className="num mono">{p.settled}</td>
            <td>
              <span className="spark">
                <span className="spark-add" style={{ width: `${(p.opened / max) * 100}%` }} />
                <span className="spark-cut" style={{ width: `${(p.settled / max) * 100}%` }} />
              </span>
            </td>
            <td className="num mono">{p.revenue_cents > 0 ? yuanCompact(p.revenue_cents) : '—'}</td>
          </tr>
        ))}
        {points.length === 0 ? (
          <tr>
            <td className="empty" colSpan={5}>
              暂无数据
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function TopPartsTable({ rows, onPick }: { rows: Stats['top_parts']; onPick: (code: string) => void }): React.JSX.Element {
  return (
    <table className="table mini plain">
      <caption className="caption">近 30 天出库排行</caption>
      <thead>
        <tr>
          <th scope="col">配件</th>
          <th scope="col" className="num">
            件数
          </th>
          <th scope="col" className="num">
            销售额
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.code} onClick={() => onPick(t.code)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onPick(t.code)}>
            <td>
              <span className="cell-strong">{t.name}</span>
              <span className="cell-sub mono">
                {t.code} · {CATEGORY_LABEL[t.category] ?? t.category}
              </span>
            </td>
            <td className="num mono">{t.qty}</td>
            <td className="num mono">{yuan(t.amount_cents)}</td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td className="empty" colSpan={3}>
              近 30 天没有出库记录
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function InvariantPanel({ s }: { s: Stats | null }): React.JSX.Element {
  const rows: readonly { label: string; value: string; ok: boolean; hint: string }[] = [
    {
      label: '库存账实相符',
      value: s === null ? '—' : s.stock_invariant_ok ? '通过' : '异常',
      ok: s !== null && s.stock_invariant_ok,
      hint: 'Σ stock_moves 变动 == Σ 批次余量',
    },
    {
      label: '批次不超发',
      value: s === null ? '—' : s.lot_overflow === 0 ? '通过' : `超发 ${s.lot_overflow} 件`,
      ok: s !== null && s.lot_overflow === 0,
      hint: '任何批次余量不得为负',
    },
    {
      label: '结算金额恒等',
      value: s === null ? '—' : s.amount_invariant_ok ? '通过' : '异常',
      ok: s !== null && s.amount_invariant_ok,
      hint: `grand == labor + parts == Σ行金额，复核 ${s?.checked_orders ?? 0} 单`,
    },
    {
      label: '配件行 = 数量 × 挂牌价',
      value: s === null ? '—' : s.identity_violations === 0 ? '通过' : `${s.identity_violations} 处异常`,
      ok: s !== null && s.identity_violations === 0,
      hint: s !== null && s.identity_issues.length > 0 ? s.identity_issues.join('；') : '逐行 SQL 拉平后由 domain 判定',
    },
    {
      label: '异常批次',
      value: s === null ? '—' : `${s.stock_issues.length} 种`,
      ok: s !== null && s.stock_issues.length === 0,
      hint: s !== null && s.stock_issues.length > 0 ? s.stock_issues.map((i) => i.part_code).join('、') : '无',
    },
  ];
  return (
    <dl className="facts">
      {rows.map((r) => (
        <Fact key={r.label} label={`${r.label} · ${r.hint}`} value={r.value} alarm={!r.ok} />
      ))}
    </dl>
  );
}

function ReceiptForm({
  canWrite,
  prefillCode,
  onDone,
}: {
  canWrite: boolean;
  prefillCode: string;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [draft, setDraft] = useState<ReceiptDraft>(EMPTY_RECEIPT);
  const set = (patch: Partial<ReceiptDraft>): void => setDraft({ ...draft, ...patch });
  const err = action.lastError?.fields ?? {};
  // 侧栏选中件时 prefillCode 会直接显示在输入框里；提交必须读同一个值，
  // 否则「看得见配件编码、提交却报编码非法」——光驱动的 value 不等于 state。
  const codeValue = draft.partCode === '' ? prefillCode : draft.partCode;
  // 后端 lot_no 上限 20 位：LOT- + 编码 + - + 时间戳很容易顶破，
  // 所以编码只取尾 10 位、时间戳只取 4 位，最长 19 位。
  const autoLot = (code: string): string => `LOT-${code.slice(-10)}-${String(Date.now() % 10000).padStart(4, '0')}`;
  const lotNo = draft.lotNo.trim() === '' && codeValue.trim() !== '' ? autoLot(codeValue.trim()) : '';

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        const code = codeValue.trim();
        const input: ReceiptInput = {
          part_code: code,
          lot_no: draft.lotNo.trim() === '' ? autoLot(code) : draft.lotNo.trim(),
          qty: Number(draft.qty) || 0,
          unit_cost_cents: Math.round((Number(draft.unitCostYuan) || 0) * 100),
          supplier: draft.supplier.trim(),
          ...(draft.expiresOn === '' ? {} : { expires_on: draft.expiresOn }),
        };
        action.run(async () => {
          const res = await api.addReceipt(input);
          setDraft({ ...EMPTY_RECEIPT, partCode: code });
          onDone();
          return res.message;
        });
      }}
    >
      <h3 className="form-title">到货入库</h3>
      <p className="form-note">建批次并记账：新批次按入库时间排在 FIFO 队尾。</p>
      <label className="field">
        <span className="field-label">配件编码</span>
        <input
          className="input mono"
          value={codeValue}
          maxLength={16}
          placeholder="FL-OIL-01"
          onChange={(e) => set({ partCode: e.target.value })}
        />
        {err.part_code ? <span className="err">{err.part_code}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">批次号（留空自动生成 {lotNo === '' ? 'LOT-编码-时间戳' : lotNo}）</span>
        <input className="input mono" value={draft.lotNo} maxLength={20} onChange={(e) => set({ lotNo: e.target.value })} />
        {err.lot_no ? <span className="err">{err.lot_no}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">入库件数</span>
        <input className="input" type="number" min={1} max={100000} value={draft.qty} onChange={(e) => set({ qty: e.target.value })} />
        {err.qty ? <span className="err">{err.qty}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">单位成本（元）</span>
        <input
          className="input"
          type="number"
          min={0.01}
          step={0.01}
          value={draft.unitCostYuan}
          placeholder="例如 31.00"
          onChange={(e) => set({ unitCostYuan: e.target.value })}
        />
        {err.unit_cost_cents ? <span className="err">{err.unit_cost_cents}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">供应商</span>
        <input className="input" value={draft.supplier} maxLength={48} onChange={(e) => set({ supplier: e.target.value })} />
        {err.supplier ? <span className="err">{err.supplier}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">有效期（油液/化学品建议填）</span>
        <input className="input" type="date" value={draft.expiresOn} onChange={(e) => set({ expiresOn: e.target.value })} />
        {err.expires_on ? <span className="err">{err.expires_on}</span> : null}
      </label>
      <NoToken shown={!canWrite} />
      {action.lastError?.code === 'part_discontinued' ? <p className="hint">该配件已停用，不能入库。</p> : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={!canWrite || action.busy}>
        {action.busy ? '入库中…' : '确认入库'}
      </button>
    </form>
  );
}

function NewOrderForm({
  canWrite,
  onCreated,
}: {
  canWrite: boolean;
  onCreated: (no: string) => void;
}): React.JSX.Element {
  const action = useAction();
  const [draft, setDraft] = useState<OrderDraft>(EMPTY_NEW_ORDER);
  const set = (patch: Partial<OrderDraft>): void => setDraft({ ...draft, ...patch });
  const err = action.lastError?.fields ?? {};
  const input: CreateOrderInput = {
    plate_no: draft.plateNo.trim(),
    model: draft.model.trim(),
    customer_name: draft.customerName.trim(),
    phone: draft.phone.trim(),
    mileage_km: Number(draft.mileageKm) || 0,
    symptom: draft.symptom.trim(),
    priority: draft.priority,
    technician: draft.technician.trim(),
  };

  return (
    <form
      className="panel-form form-row"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          const res = await api.createOrder(input);
          setDraft({ ...EMPTY_NEW_ORDER, technician: draft.technician, priority: draft.priority });
          onCreated(res.order.wo_no);
          return res.message;
        });
      }}
    >
      <h3 className="form-title">受理开单</h3>
      <label className="field">
        <span className="field-label">车牌</span>
        <input className="input mono" value={draft.plateNo} maxLength={12} placeholder="沪A·12345" onChange={(e) => set({ plateNo: e.target.value })} />
        {err.plate_no ? <span className="err">{err.plate_no}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">车型</span>
        <input className="input" value={draft.model} maxLength={48} placeholder="大众 途岳 330TSI" onChange={(e) => set({ model: e.target.value })} />
        {err.model ? <span className="err">{err.model}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">客户姓名</span>
        <input className="input" value={draft.customerName} maxLength={32} onChange={(e) => set({ customerName: e.target.value })} />
        {err.customer_name ? <span className="err">{err.customer_name}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">手机号（11 位，仅入库，出口脱敏）</span>
        <input className="input mono" value={draft.phone} maxLength={11} inputMode="numeric" placeholder="13800001111" onChange={(e) => set({ phone: e.target.value })} />
        {err.phone ? <span className="err">{err.phone}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">里程（km）</span>
        <input className="input" type="number" min={0} max={1000000} value={draft.mileageKm} onChange={(e) => set({ mileageKm: e.target.value })} />
        {err.mileage_km ? <span className="err">{err.mileage_km}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">优先级（决定承诺交车时长）</span>
        <select className="input" value={draft.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        {err.priority ? <span className="err">{err.priority}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">服务顾问</span>
        <input className="input" value={draft.technician} maxLength={32} placeholder="李顾问" onChange={(e) => set({ technician: e.target.value })} />
        {err.technician ? <span className="err">{err.technician}</span> : null}
      </label>
      <label className="field field-wide">
        <span className="field-label">故障描述</span>
        <input className="input" value={draft.symptom} maxLength={160} placeholder="刹车异响，低速轻踩明显" onChange={(e) => set({ symptom: e.target.value })} />
        {err.symptom ? <span className="err">{err.symptom}</span> : null}
      </label>
      <NoToken shown={!canWrite} />
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={!canWrite || action.busy}>
        {action.busy ? '开单中…' : '建立工单'}
      </button>
      <p className="form-note">
        开单即按优先级算出承诺交车时点（加急 6 小时、保客回厂 12 小时、普通 30 小时），后续超承诺与等待时长都以该时点为准。
      </p>
    </form>
  );
}
