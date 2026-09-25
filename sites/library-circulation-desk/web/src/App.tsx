import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  CATEGORY_LABEL,
  CONDITION_LABEL,
  COPY_STATUS_LABEL,
  dateOnly,
  dateTime,
  LOAN_STATUS_LABEL,
  MEMBER_STATUS_LABEL,
  MEMBER_TYPE_LABEL,
  yuan,
  yuanCompact,
} from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  BorrowInput,
  CopyRow,
  ItemRow,
  ListParams,
  LoanRow,
  LoanSortKey,
  MemberDetail,
  Stats,
} from './types';

const TOKEN_KEY = 'libdesk-admin-token';
const LOAN_COLUMNS: readonly { key: string; label: string; sort?: LoanSortKey; numeric?: boolean }[] = [
  { key: 'due', label: '应还日期', sort: 'due' },
  { key: 'member', label: '读者', sort: 'member' },
  { key: 'item', label: '书目', sort: 'item' },
  { key: 'barcode', label: '条码', sort: 'barcode' },
  { key: 'borrowed', label: '借出日', sort: 'borrowed' },
  { key: 'renew', label: '续借', sort: 'renew', numeric: true },
  { key: 'fine', label: '罚金', sort: 'fine', numeric: true },
  { key: 'status', label: '状态', sort: 'status' },
];

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

  const stats = useAsync<Stats>(() => api.stats(14), []);

  const [loanFilters, setLoanFilters] = useState<ListParams>({ sort: 'due', dir: 'asc', page_size: 12 });
  const [loanPage, setLoanPage] = useState(1);
  const loans = useAsync(
    () => api.loans({ ...loanFilters, page: loanPage }),
    [loanFilters.status, loanFilters.q, loanFilters.category, loanFilters.sort, loanFilters.dir, loanPage],
  );

  const [selectedLoan, setSelectedLoan] = useState<number | null>(null);
  const detail = useAsync(
    () => (selectedLoan === null ? Promise.resolve(null) : api.loan(selectedLoan)),
    [selectedLoan, loans.data?.items.length ?? 0],
  );
  useEffect(() => {
    if (selectedLoan === null && (loans.data?.items.length ?? 0) > 0) {
      setSelectedLoan(loans.data?.items[0]?.id ?? null);
    }
  }, [loans.data, selectedLoan]);

  const [catalogFilters, setCatalogFilters] = useState<ListParams>({ sort: 'available', dir: 'desc', page_size: 8 });
  const [catalogPage, setCatalogPage] = useState(1);
  const items = useAsync(
    () => api.items({ ...catalogFilters, page: catalogPage }),
    [catalogFilters.q, catalogFilters.category, catalogFilters.status, catalogFilters.sort, catalogFilters.dir, catalogPage],
  );
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const itemDetail = useAsync(
    () => (pickedItem === null ? Promise.resolve(null) : api.item(pickedItem)),
    [pickedItem],
  );
  useEffect(() => {
    if (pickedItem === null && (items.data?.items.length ?? 0) > 0) {
      setPickedItem(items.data?.items[0]?.code ?? null);
    }
  }, [items.data, pickedItem]);

  const [prefill, setPrefill] = useState<BorrowInput>({ barcode: '', card_no: '' });
  const [memberCard, setMemberCard] = useState('R-2026-0001');
  const memberLookup = useAsync(
    () => (memberCard === '' ? Promise.resolve(null) : api.member(memberCard)),
    [memberCard],
  );

  const totalLoans = loans.data?.total ?? 0;
  const loanPages = Math.max(1, Math.ceil(totalLoans / (loanFilters.page_size ?? 12)));
  const totalItems = items.data?.total ?? 0;
  const itemPages = Math.max(1, Math.ceil(totalItems / (catalogFilters.page_size ?? 8)));

  const reloadAll = (): void => {
    loans.reload();
    stats.reload();
    items.reload();
    detail.reload();
    memberLookup.reload();
    itemDetail.reload();
  };

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">苍岚图书馆 · 流通工作台</span>
          <span className="brand-sub">Circulation Desk</span>
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
          <b>逾期费 = min(逾期天数 × 书别费率, 单册封顶)</b>，归还时一次性结算并快照，之后不回溯；
          未缴欠费超过 ¥30 即停借，参考工具书仅限馆内阅览。
        </p>
        <p className="stamp">
          今日 {stats.data ? stats.data.today : '加载中'} · {stats.data?.window ?? ''}
        </p>
      </div>

      <Banner state={stats} label="统计接口" />

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">流通指标</h2>
            <span className="section-note">库存守恒与欠费口径由后端逐次回验</span>
          </div>
          <KpiGrid s={stats.data} />

          <div className="section-head">
            <h2 className="section-title">流通台账</h2>
            <span className="section-note">
              第 {loanPage} / {loanPages} 页 · 共 {totalLoans} 条
            </span>
          </div>
          <LoanFilters
            value={loanFilters}
            page={loanPage}
            onChange={(next) => {
              setLoanFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setLoanPage(1);
            }}
            onPage={setLoanPage}
          />
          <Banner state={loans} label="借阅列表" />
          <LoanTable
            rows={loans.data?.items ?? []}
            loading={loans.loading}
            sort={(loanFilters.sort ?? 'due') as LoanSortKey}
            dir={loanFilters.dir ?? 'asc'}
            selectedId={selectedLoan}
            onSort={(sort) => {
              const dir = loanFilters.sort === sort && loanFilters.dir !== 'asc' ? 'asc' : 'desc';
              setLoanFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(id) => setSelectedLoan(id)}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">馆藏结构</h2>
            <span className="section-note">按类别 · 册数与在借</span>
          </div>
          <CategoryBars s={stats.data} />
          <div className="section-head">
            <h2 className="section-title">近两周借还</h2>
            <span className="section-note">借出 / 归还（册次）</span>
          </div>
          <TrendTable points={stats.data?.trend ?? []} />
        </aside>
      </main>

      <section className="detail">
        <div className="detail-main">
          <div className="section-head">
            <h2 className="section-title">借阅单详情</h2>
            <span className="section-note">{selectedLoan === null ? '未选择' : `#${selectedLoan}`}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <LoanDetailPanel row={detail.data?.loan ?? null} loading={detail.loading} />
        </div>
        <div className="detail-side">
          <ReturnPanel
            token={token}
            row={detail.data?.loan ?? null}
            onDone={reloadAll}
          />
        </div>
      </section>

      <section className="catalog">
        <div className="section-head">
          <h2 className="section-title">馆藏目录</h2>
          <span className="section-note">
            第 {catalogPage} / {itemPages} 页 · 共 {totalItems} 种 · 点击行查看复本并选定在架册
          </span>
        </div>
        <div className="layout">
          <div className="col-main">
            <CatalogFilters
              value={catalogFilters}
              page={catalogPage}
              onChange={(next) => {
                setCatalogFilters((prev) => ({ ...prev, ...next.next }));
                if (next.resetPage) setCatalogPage(1);
              }}
              onPage={setCatalogPage}
            />
            <Banner state={items} label="书目列表" />
            <ItemTable
              rows={items.data?.items ?? []}
              loading={items.loading}
              pickedCode={pickedItem}
              onPick={(code) => setPickedItem(code)}
            />
          </div>
          <aside className="col-side">
            <div className="section-head">
              <h2 className="section-title">复本与在借人</h2>
              <span className="section-note">{pickedItem ?? '未选择'}</span>
            </div>
            <Banner state={itemDetail} label="书目详情" />
            <CopiesPanel
              loading={itemDetail.loading}
              copies={itemDetail.data?.copies ?? []}
              onPickCopy={(barcode) => setPrefill((prev) => ({ ...prev, barcode }))}
            />
          </aside>
        </div>
      </section>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">流通台</h2>
          <span className="section-note">写接口需 ADMIN_TOKEN；校验失败会逐字段回显</span>
        </div>
        <div className="layout">
          <div className="col-main">
            <BorrowForm
              token={token}
              prefill={prefill}
              onChangePrefill={setPrefill}
              onDone={reloadAll}
            />
          </div>
          <aside className="col-side">
            <MemberLookupForm card={memberCard} onChange={setMemberCard} />
            <Banner state={memberLookup} label="读者接口" />
            <MemberPanel data={memberLookup.data?.member ?? null} loans={memberLookup.data?.loans ?? []} />
          </aside>
        </div>
        <p className="footnote">
          接口：GET /api/health · /api/items · /api/items/&#123;code&#125; · /api/loans · /api/loans/&#123;id&#125; ·
          /api/members/&#123;card&#125; · /api/stats；POST /api/admin/borrow ·
          /api/admin/loans/&#123;id&#125;/return · /api/admin/loans/&#123;id&#125;/renew。
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

const KPI_ORDER: readonly (keyof Stats)[] = [
  'available_copies',
  'on_loan_copies',
  'active_loans',
  'overdue_loans',
  'borrow_today',
  'return_today',
  'outstanding_fine',
  'collected_fine',
];

const KPI_LABEL: Record<string, string> = {
  available_copies: '在架册数',
  on_loan_copies: '借出册数',
  active_loans: '在借单',
  overdue_loans: '逾期未还',
  borrow_today: '今日借出',
  return_today: '今日归还',
  outstanding_fine: '未缴欠费',
  collected_fine: '已收罚金',
};

const KPI_HINT: Record<string, string> = {
  available_copies: 'available 状态副本',
  on_loan_copies: '与在借单一一对应',
  overdue_loans: 'due_at 早于今日的在借单',
  outstanding_fine: '已归还且未缴的逾期费',
  collected_fine: '已归还且缴清的逾期费',
};

function KpiGrid({ s }: { s: Stats | null }): React.JSX.Element {
  return (
    <div className="kpis">
      {KPI_ORDER.map((key) => {
        const raw = s?.[key];
        const value = typeof raw === 'number' ? raw : 0;
        const money = key === 'outstanding_fine' || key === 'collected_fine';
        const text = s === null ? '—' : money ? yuanCompact(value) : value.toLocaleString('zh-CN');
        return (
          <article className="kpi" key={String(key)}>
            <h3 className="kpi-label">{KPI_LABEL[String(key)] ?? String(key)}</h3>
            <p className="kpi-value">{text}</p>
            <p className="kpi-hint">{KPI_HINT[String(key)] ?? '当前时点口径'}</p>
          </article>
        );
      })}
      <article className="kpi" data-warn={s !== null && !s.identity_ok ? 'true' : 'false'}>
        <h3 className="kpi-label">恒等式自检</h3>
        <p className="kpi-value">{s === null ? '—' : s.identity_ok ? '通过' : '异常'}</p>
        <p className="kpi-hint">
          {s !== null && !s.identity_ok ? s.identity_issues.join('；') : '库存守恒 · 欠费同源 · 状态一一对应'}
        </p>
      </article>
    </div>
  );
}

function LoanFilters({
  value,
  page,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
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
          onChange={(e) => onChange({ next: { status: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {(['overdue', 'active', 'returned'] as const).map((s) => (
            <option key={s} value={s}>
              {LOAN_STATUS_LABEL[s]}
            </option>
          ))}
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
          {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
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
          placeholder="读者 / 证号 / 书名 / 条码（服务端转义 LIKE）"
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

function loanState(r: LoanRow): { label: string; tone: string } {
  if (r.status === 'returned') return { label: '已还', tone: 'returned' };
  if (r.overdue_days > 0) return { label: `逾期 ${r.overdue_days} 天`, tone: 'overdue' };
  return { label: '在借', tone: 'active' };
}

function LoanTable({
  rows,
  loading,
  sort,
  dir,
  selectedId,
  onSort,
  onPick,
}: {
  rows: LoanRow[];
  loading: boolean;
  sort: LoanSortKey;
  dir: 'asc' | 'desc';
  selectedId: number | null;
  onSort: (key: LoanSortKey) => void;
  onPick: (id: number) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">流通台账：点击行查看详情与归还 / 续借入口</caption>
        <thead>
          <tr>
            {LOAN_COLUMNS.map((col) => {
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
                    <button type="button" className="sortbtn" data-on={key === sort ? 'true' : 'false'} onClick={() => onSort(key)}>
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
              <td className="empty" colSpan={LOAN_COLUMNS.length}>
                没有符合条件的借阅记录
              </td>
            </tr>
          ) : null}
          {rows.map((r) => {
            const st = loanState(r);
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
                  {dateOnly(r.due_at)}
                  {r.status === 'active' ? (
                    <span className="cell-sub" data-overdue={r.overdue_days > 0 ? 'true' : 'false'}>
                      {r.overdue_days > 0 ? `逾期 ${r.overdue_days} 天` : '未到期'}
                    </span>
                  ) : (
                    <span className="cell-sub">还于 {dateOnly(r.returned_at)}</span>
                  )}
                </td>
                <td>
                  <span className="cell-strong">{r.member_name}</span>
                  <span className="cell-sub">
                    {r.member_card} · {MEMBER_TYPE_LABEL[r.member_type] ?? r.member_type}
                  </span>
                </td>
                <td>
                  <span className="cell-strong">{r.item_title}</span>
                  <span className="cell-sub">{CATEGORY_LABEL[r.item_category] ?? r.item_category}</span>
                </td>
                <td className="mono">
                  {r.copy_barcode}
                  <span className="cell-sub">{r.copy_location}</span>
                </td>
                <td className="mono">{dateOnly(r.borrowed_at)}</td>
                <td className="num mono">{r.renew_count}/2</td>
                <td className="num mono" data-overdue={r.status === 'returned' && r.fine_cents > 0 && !r.fine_paid ? 'true' : 'false'}>
                  {r.status === 'active' ? (r.fine_due > 0 ? `${yuan(r.fine_due)} 计` : '—') : yuan(r.fine_cents)}
                  {r.status === 'returned' && r.fine_cents > 0 ? (r.fine_paid ? ' 已缴' : ' 未缴') : ''}
                </td>
                <td>
                  <span className="badge" data-status={st.tone}>
                    {st.label}
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

function CategoryBars({ s }: { s: Stats | null }): React.JSX.Element {
  const rollup = useMemo(() => [...(s?.by_category ?? [])].sort((a, b) => b.copies - a.copies), [s]);
  const max = rollup[0]?.copies ?? 1;
  return (
    <ul className="bars">
      {rollup.map((c) => (
        <li className="bar" key={c.category}>
          <span className="bar-head">
            <span className="bar-name">{CATEGORY_LABEL[c.category] ?? c.category}</span>
            <span className="bar-value">{c.copies} 册</span>
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, Math.round((c.copies / max) * 100))}%` }} />
          </span>
          <span className="bar-foot">
            {c.items} 种 · 在借 {c.active_loans} 单
          </span>
        </li>
      ))}
      {rollup.length === 0 ? <li className="bar">正在读取…</li> : null}
    </ul>
  );
}

function TrendTable({ points }: { points: Stats['trend'] }): React.JSX.Element {
  const max = points.reduce((acc, p) => Math.max(acc, p.borrow, p.returned), 1);
  return (
    <table className="table mini plain">
      <caption className="caption">近两周借还流水</caption>
      <thead>
        <tr>
          <th scope="col">日期</th>
          <th scope="col">借出</th>
          <th scope="col">归还</th>
          <th scope="col">走势</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.day}>
            <td className="mono">{p.day.slice(5)}</td>
            <td className="num mono">{p.borrow}</td>
            <td className="num mono">{p.returned}</td>
            <td>
              <span className="spark">
                <span className="spark-add" style={{ width: `${(p.borrow / max) * 100}%` }} />
                <span className="spark-cut" style={{ width: `${(p.returned / max) * 100}%` }} />
              </span>
            </td>
          </tr>
        ))}
        {points.length === 0 ? (
          <tr>
            <td className="empty" colSpan={4}>
              暂无数据
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function LoanDetailPanel({ row, loading }: { row: LoanRow | null; loading: boolean }): React.JSX.Element {
  if (row === null) {
    return <p className="placeholder">{loading ? '正在读取详情…' : '在台账中选择一条借阅查看详情。'}</p>;
  }
  const st = loanState(row);
  const facts: readonly { label: string; value: string }[] = [
    { label: '书目', value: `${row.item_title}（${row.item_code}）` },
    { label: '类别', value: CATEGORY_LABEL[row.item_category] ?? row.item_category },
    { label: '复本条码', value: row.copy_barcode },
    { label: '库位', value: row.copy_location },
    { label: '读者', value: `${row.member_name} · ${MEMBER_TYPE_LABEL[row.member_type] ?? row.member_type}` },
    { label: '证号', value: row.member_card },
    { label: '借出时间', value: dateTime(row.borrowed_at) },
    { label: '应还时间', value: dateTime(row.due_at) },
    { label: '归还时间', value: row.returned_at === undefined ? '—' : dateTime(row.returned_at) },
    { label: '续借次数', value: `${row.renew_count}/2` },
    { label: '逾期天数', value: row.status === 'active' ? `${row.overdue_days} 天` : '按归还日定格' },
    {
      label: row.status === 'active' ? '当前应计罚金' : '结算罚金',
      value: yuan(row.status === 'active' ? row.fine_due : row.fine_cents),
    },
    { label: '缴费状态', value: row.status === 'active' ? '归还时结算' : row.fine_paid ? '已缴清' : '未缴' },
    { label: '当前状态', value: st.label },
  ];
  return (
    <dl className="facts">
      {facts.map((f) => (
        <div className="fact" key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReturnPanel({
  token,
  row,
  onDone,
}: {
  token: string;
  row: LoanRow | null;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  if (row === null) {
    return (
      <div className="panel-form">
        <h3 className="form-title">归还 / 续借</h3>
        <p className="placeholder">未选择借阅单。</p>
      </div>
    );
  }
  const isActive = row.status === 'active';
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          await api.returnLoan(token, row.id, paid);
          onDone();
        });
      }}
    >
      <h3 className="form-title">办理归还</h3>
      <p className="form-note">
        {row.item_title} · {row.member_name}
        {isActive && row.overdue_days > 0
          ? `（已逾期 ${row.overdue_days} 天，预计罚金 ${yuan(row.fine_due)}）`
          : ''}
      </p>
      <label className="field checkbox">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} disabled={!isActive} />
        <span className="field-label">逾期费当场缴清</span>
      </label>
      {action.lastError?.code === 'unauthorized' || action.lastError?.code === 'forbidden' ? (
        <p className="hint">请在右上角填入正确的管理令牌。</p>
      ) : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={!isActive || action.busy || token === ''}>
          {action.busy ? '提交中…' : '确认归还'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!isActive || row.renew_count >= 2 || row.overdue_days > 0 || action.busy || token === ''}
          onClick={() => {
            action.run(async () => {
              await api.renew(token, row.id);
              onDone();
            });
          }}
        >
          续借（剩 {Math.max(0, 2 - row.renew_count)} 次）
        </button>
      </div>
      {!isActive ? <p className="hint">该单已归还，归档记录只读。</p> : null}
    </form>
  );
}

function CatalogFilters({
  value,
  page,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
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
        <span className="field-label">可借性</span>
        <select
          className="input"
          value={value.status ?? ''}
          onChange={(e) => onChange({ next: { status: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          <option value="available">有在架册</option>
          <option value="on_loan">有借出册</option>
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
          {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-wide">
        <span className="field-label">检索</span>
        <input
          className="input"
          type="search"
          value={search}
          maxLength={64}
          placeholder="书名 / 作者 / 索书号"
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

function ItemTable({
  rows,
  loading,
  pickedCode,
  onPick,
}: {
  rows: ItemRow[];
  loading: boolean;
  pickedCode: string | null;
  onPick: (code: string) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">馆藏书目：点击行查看复本</caption>
        <thead>
          <tr>
            <th scope="col">索书号</th>
            <th scope="col">书名 / 作者</th>
            <th scope="col">出版</th>
            <th scope="col">类别</th>
            <th scope="col" className="num">
              借期
            </th>
            <th scope="col" className="num">
              在架
            </th>
            <th scope="col" className="num">
              馆藏
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && !loading ? (
            <tr>
              <td className="empty" colSpan={7}>
                没有符合条件的书目
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr
              key={r.code}
              data-active={r.code === pickedCode ? 'true' : 'false'}
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
                <span className="cell-sub">{r.author}</span>
              </td>
              <td>
                {r.publisher}
                <span className="cell-sub">{r.pub_year}</span>
              </td>
              <td>{CATEGORY_LABEL[r.category] ?? r.category}</td>
              <td className="num mono">{r.loan_days > 0 ? `${r.loan_days} 天` : '阅览'}</td>
              <td className="num mono" data-overdue={r.category === 'reference' ? 'false' : r.available_copies === 0 ? 'true' : 'false'}>
                {r.available_copies}
              </td>
              <td className="num mono">{r.total_copies}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopiesPanel({
  copies,
  loading,
  onPickCopy,
}: {
  copies: CopyRow[];
  loading: boolean;
  onPickCopy: (barcode: string) => void;
}): React.JSX.Element {
  if (copies.length === 0) {
    return <p className="placeholder">{loading ? '正在读取复本…' : '暂无复本数据。'}</p>;
  }
  return (
    <ul className="copylist">
      {copies.map((c) => (
        <li className="copyrow" key={c.barcode}>
          <span className="cell-strong mono">{c.barcode}</span>
          <span className="cell-sub">
            {c.location} · {CONDITION_LABEL[c.condition] ?? c.condition}
          </span>
          <span className="badge" data-status={c.status}>
            {COPY_STATUS_LABEL[c.status] ?? c.status}
          </span>
          {c.status === 'on_loan' && c.borrower_name !== undefined ? (
            <span className="cell-sub">
              {c.borrower_name} · {c.borrower_card} · 应还 {dateOnly(c.due_at)}
            </span>
          ) : null}
          {c.status === 'available' ? (
            <button type="button" className="btn btn-mini" onClick={() => onPickCopy(c.barcode)}>
              选定此册 →
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function BorrowForm({
  token,
  prefill,
  onChangePrefill,
  onDone,
}: {
  token: string;
  prefill: BorrowInput;
  onChangePrefill: (next: BorrowInput) => void;
  onDone: () => void;
}): React.JSX.Element {
  const action = useAction();
  return (
    <form
      className="panel-form form-row"
      onSubmit={(e) => {
        e.preventDefault();
        action.run(async () => {
          await api.borrow(token, {
            barcode: prefill.barcode.trim(),
            card_no: prefill.card_no.trim(),
          });
          onChangePrefill({ barcode: '', card_no: prefill.card_no });
          onDone();
        });
      }}
    >
      <h3 className="form-title">借出登记</h3>
      <label className="field">
        <span className="field-label">复本条码</span>
        <input
          className="input"
          value={prefill.barcode}
          maxLength={20}
          placeholder="BN-000001"
          onChange={(e) => onChangePrefill({ ...prefill, barcode: e.target.value })}
        />
        {action.lastError?.fields.barcode ? <span className="err">{action.lastError.fields.barcode}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">读者证号</span>
        <input
          className="input"
          value={prefill.card_no}
          maxLength={16}
          placeholder="R-2026-0001"
          onChange={(e) => onChangePrefill({ ...prefill, card_no: e.target.value })}
        />
        {action.lastError?.fields.card_no ? <span className="err">{action.lastError.fields.card_no}</span> : null}
      </label>
      {action.lastError?.code === 'unauthorized' || action.lastError?.code === 'forbidden' ? (
        <p className="hint">请在右上角填入正确的管理令牌。</p>
      ) : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={action.busy || token === '' || prefill.barcode === '' || prefill.card_no === ''}>
        {action.busy ? '提交中…' : '确认借出'}
      </button>
      <p className="form-note">
        后端在单事务内校验：副本在架 → 参考书不外借 → 证件有效 → 配额（普通 8 / 家庭 12 / 学生 5）→ 欠费门槛 ¥30。
      </p>
    </form>
  );
}

function MemberLookupForm({ card, onChange }: { card: string; onChange: (v: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(card);
  useEffect(() => setDraft(card), [card]);
  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft.trim());
      }}
    >
      <h3 className="form-title">读者查询</h3>
      <label className="field">
        <span className="field-label">证号</span>
        <input className="input" value={draft} maxLength={16} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="submit" className="btn">
        查询
      </button>
    </form>
  );
}

function MemberPanel({ data, loans }: { data: MemberDetail | null; loans: LoanRow[] }): React.JSX.Element {
  if (data === null) return <p className="placeholder">输入证号查询读者档案。</p>;
  return (
    <>
      <dl className="facts">
        <div className="fact">
          <dt>姓名</dt>
          <dd>{data.name}</dd>
        </div>
        <div className="fact">
          <dt>证号</dt>
          <dd className="mono">{data.card_no}</dd>
        </div>
        <div className="fact">
          <dt>联系方式</dt>
          <dd className="mono">{data.phone_masked || '—'}</dd>
        </div>
        <div className="fact">
          <dt>证别</dt>
          <dd>
            {MEMBER_TYPE_LABEL[data.member_type] ?? data.member_type}（配额 {data.quota} 册）
          </dd>
        </div>
        <div className="fact">
          <dt>状态</dt>
          <dd>{MEMBER_STATUS_LABEL[data.status] ?? data.status}</dd>
        </div>
        <div className="fact">
          <dt>在借 / 逾期</dt>
          <dd>
            {data.active_loans} / {data.overdue_loans}
          </dd>
        </div>
        <div className="fact">
          <dt>未缴欠费</dt>
          <dd data-overdue={data.outstanding_fine > 0 ? 'true' : 'false'}>{yuan(data.outstanding_fine)}</dd>
        </div>
        <div className="fact">
          <dt>开证日期</dt>
          <dd className="mono">{dateOnly(data.joined_at)}</dd>
        </div>
      </dl>
      {loans.length > 0 ? (
        <table className="table mini plain">
          <caption className="caption">最近 {loans.length} 条借阅</caption>
          <thead>
            <tr>
              <th scope="col">书目</th>
              <th scope="col">应还</th>
              <th scope="col">状态</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id}>
                <td>{l.item_title}</td>
                <td className="mono">{dateOnly(l.due_at)}</td>
                <td>{loanState(l).label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
