import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { COUNTRY_FLAG, dateOnly, dateTime, grams, local, stars, usd } from './format';
import { persistTheme, initialTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  CreateProductInput,
  CartLine,
  CartView,
  ListParams,
  Product,
  ProductDetail,
  RegionTotal,
  SortDir,
  SortKey,
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

  const meta = useAsync(() => api.meta(), []);
  const [region, setRegion] = useState('US');

  const [filters, setFilters] = useState<ListParams>({ sort: 'sold', dir: 'desc', page_size: 12 });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.products({ ...filters, page, page_size: filters.page_size ?? 12 }),
    [filters.category, filters.in_stock, filters.q, filters.sort, filters.dir, page, filters.page_size],
  );

  const rows = list.data?.items ?? [];
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  useEffect(() => {
    if (selectedSku === null && rows.length > 0) setSelectedSku(rows[0]?.sku ?? null);
  }, [rows, selectedSku]);

  const detail = useAsync(
    () => (selectedSku === null ? Promise.resolve(null) : api.product(selectedSku)),
    [selectedSku],
  );

  const cart = useAsync(() => api.cart(region), [region]);
  const refreshCart = () => {
    cart.reload();
    detail.reload();
    list.reload();
  };

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
          <span className="brand-name">澜鲸全球购</span>
          <span className="brand-sub">NovaCart Cross-Border Storefront</span>
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
          同一套接口与页面骨架，三种互不相同的视觉主张。<b>货值、运费、关税与到手总价全部由后端按目的国税则折算</b>：
          首重 500g 计价、续重按 500g 向上取整，关税按申报货值（成交价口径）逐国税率计征，达到各国免邮线自动免运费。
        </p>
        <p className="stamp">数据快照 {list.data ? dateTime(list.data.served_at) : '加载中'}</p>
      </div>

      <Banner state={meta} label="目录接口" />

      <div className="kpis">
        <Kpi label="SKU 总数" value={meta.data ? String(meta.data.stats.total) : '—'} hint="含已下架" />
        <Kpi label="在售 SKU" value={meta.data ? String(meta.data.stats.listed) : '—'} hint="listed = true" />
        <Kpi label="在售缺货" value={meta.data ? String(meta.data.stats.out_of_stock) : '—'} hint="在售但库存为 0" />
        <Kpi
          label="全店均分"
          value={meta.data && meta.data.stats.avg_rating > 0 ? meta.data.stats.avg_rating.toFixed(2) : '—'}
          hint="全部目的国留评均值"
        />
        <Kpi label="30 天销量" value={meta.data ? meta.data.stats.sold_30_sum.toLocaleString('en-US') : '—'} hint="件" />
        <Kpi
          label="在售货值"
          value={meta.data ? usd(meta.data.stats.catalog_value_cents) : '—'}
          hint="Σ 售价 × 库存（美分口径）"
        />
      </div>

      <main className="layout">
        <section className="col-main">
          <div className="section-head">
            <h2 className="section-title">商品货架</h2>
            <span className="section-note">
              第 {page} / {pages} 页 · 共 {totalRows} 个 SKU · 点击行看详情
            </span>
          </div>
          <Filters
            value={filters}
            page={page}
            categories={meta.data?.categories ?? []}
            onChange={(next) => {
              setFilters((prev) => ({ ...prev, ...next.next }));
              if (next.resetPage) setPage(1);
            }}
            onPage={setPage}
          />
          <Banner state={list} label="商品列表" />
          <ProductTable
            rows={rows}
            loading={list.loading}
            sort={filters.sort ?? 'sold'}
            dir={filters.dir ?? 'desc'}
            selectedSku={selectedSku}
            onSort={(sort) => {
              const dir: SortDir = filters.sort === sort && filters.dir === 'desc' ? 'asc' : 'desc';
              setFilters((prev) => ({ ...prev, sort, dir }));
            }}
            onPick={(sku) => setSelectedSku(sku)}
          />

          <div className="section-head">
            <h2 className="section-title">商品详情</h2>
            <span className="section-note">{selectedSku === null ? '未选择' : selectedSku}</span>
          </div>
          <Banner state={detail} label="详情接口" />
          <DetailPanel
            state={detail}
            region={region}
            onCartChanged={refreshCart}
          />
        </section>

        <aside className="col-side">
          <div className="section-head">
            <h2 className="section-title">购物车</h2>
            <span className="section-note">{cart.data ? `${cart.data.item_qty} 件 · ${grams(cart.data.total_weight_g)}` : '读取中'}</span>
          </div>
          <Banner state={cart} label="购物车" />
          <CartPanel
            view={cart.data}
            onRemove={(sku) => {
              void api.addToCart(sku, 0, region).then(refreshCart);
            }}
          />
          <div className="section-head">
            <h2 className="section-title">到手价 · 分目的国</h2>
            <span className="section-note">点击行切换目的国</span>
          </div>
          <TotalsTable
            totals={cart.data?.totals ?? []}
            selected={region}
            onPick={(code) => setRegion(code)}
          />
        </aside>
      </main>

      <footer className="pagefoot">
        <div className="section-head">
          <h2 className="section-title">运营上新</h2>
          <span className="section-note">POST /api/admin/products 需 ADMIN_TOKEN；校验失败逐字段回显</span>
        </div>
        <ProductForm
          token={token}
          categories={meta.data?.categories ?? []}
          onCreated={() => {
            list.reload();
            meta.reload();
          }}
        />
        <p className="footnote">
          接口：GET /api/health · /api/meta · /api/products · /api/products/&#123;sku&#125; · /api/cart ·
          POST /api/cart/items · POST /api/admin/products（Bearer）。
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

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <article className="kpi">
      <h3 className="kpi-label">{label}</h3>
      <p className="kpi-value">{value}</p>
      <p className="kpi-hint">{hint}</p>
    </article>
  );
}

function Filters({
  value,
  page,
  categories,
  onChange,
  onPage,
}: {
  value: ListParams;
  page: number;
  categories: string[];
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
        <span className="field-label">类目</span>
        <select
          className="input"
          value={value.category ?? ''}
          onChange={(e) => onChange({ next: { category: e.target.value }, resetPage: true })}
        >
          <option value="">全部</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
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
          {[12, 18, 30, 60].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">仅有货</span>
        <select
          className="input"
          value={value.in_stock ?? ''}
          onChange={(e) => onChange({ next: { in_stock: e.target.value }, resetPage: true })}
        >
          <option value="">不限</option>
          <option value="1">只看有货</option>
        </select>
      </label>
      <label className="field field-wide">
        <span className="field-label">搜索</span>
        <input
          className="input"
          type="search"
          value={search}
          maxLength={64}
          placeholder="品名 / 品牌 / SKU（服务端转义 LIKE）"
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
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: '商品', sort: 'name' },
  { key: 'category', label: '类目' },
  { key: 'price', label: '售价', sort: 'price', numeric: true },
  { key: 'stock', label: '库存', sort: 'stock', numeric: true },
  { key: 'rating', label: '评分', sort: 'rating', numeric: true },
  { key: 'sold', label: '30 天销量', sort: 'sold', numeric: true },
  { key: 'status', label: '状态' },
];

function ProductTable({
  rows,
  loading,
  sort,
  dir,
  selectedSku,
  onSort,
  onPick,
}: {
  rows: Product[];
  loading: boolean;
  sort: SortKey;
  dir: SortDir;
  selectedSku: string | null;
  onSort: (key: SortKey) => void;
  onPick: (sku: string) => void;
}): React.JSX.Element {
  return (
    <div className="tablewrap">
      <table className="table" data-loading={loading ? 'true' : 'false'}>
        <caption className="caption">商品货架：点击行查看详情与加购入口</caption>
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
              <td className="empty" colSpan={COLUMNS.length}>
                没有符合条件的商品，试试放宽筛选条件
              </td>
            </tr>
          ) : null}
          {rows.map((p) => (
            <tr
              key={p.sku}
              data-active={p.sku === selectedSku ? 'true' : 'false'}
              onClick={() => onPick(p.sku)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(p.sku);
                }
              }}
            >
              <td className="mono">{p.sku}</td>
              <td>
                <span className="cell-strong">{p.name}</span>
                <span className="cell-sub">{p.name_en}</span>
              </td>
              <td>{p.category}</td>
              <td className="num mono">{usd(p.price_cents)}</td>
              <td className="num mono">{p.stock}</td>
              <td className="num mono">
                {p.review_cnt > 0 ? p.rating_avg.toFixed(1) : '—'}
                <span className="cell-sub">{p.review_cnt} 条</span>
              </td>
              <td className="num mono">{p.sold_30.toLocaleString('en-US')}</td>
              <td>
                <span className="badge" data-status={!p.listed ? 'off' : p.stock === 0 ? 'low' : 'on'}>
                  {!p.listed ? '已下架' : p.stock === 0 ? '缺货' : '在售'}
                </span>
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
  region,
  onCartChanged,
}: {
  state: { data: ProductDetail | null; loading: boolean };
  region: string;
  onCartChanged: () => void;
}): React.JSX.Element {
  const d = state.data;
  const [qty, setQty] = useState('1');
  const action = useAction();
  useEffect(() => {
    setQty('1');
    action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.product.sku]);
  if (d === null) {
    return <p className="placeholder">{state.loading ? '正在读取详情…' : '在货架中选择一行查看详情。'}</p>;
  }
  const p = d.product;
  const facts: readonly { label: string; value: string }[] = [
    { label: '英文品名', value: p.name_en },
    { label: '品牌', value: p.brand },
    { label: '售价（申报口径）', value: usd(p.price_cents) },
    { label: '单件重量', value: grams(p.weight_g) },
    { label: 'HS 编码', value: p.hs_code },
    { label: '产地', value: p.origin },
    { label: '发货时效', value: `付款后 ${p.lead_min_days}-${p.lead_max_days} 天` },
    { label: '30 天销量', value: String(p.sold_30) },
  ];
  const maxDist = Math.max(1, ...d.stats.dist);
  return (
    <>
      <h3 className="detail-title">
        {p.name} <span className="detail-sub">{p.category}</span>
      </h3>
      <dl className="facts">
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <p className="bullets">{p.bullets.split('|').join(' · ')}</p>
      <div className="rating">
        <span className="rating-stars">{stars(d.stats.avg)}</span>
        <span className="rating-num">
          {d.stats.count > 0 ? d.stats.avg.toFixed(2) : '—'} / 5.00 · {d.stats.count} 条留评
        </span>
      </div>
      <ul className="bars">
        {[5, 4, 3, 2, 1].map((starN, i) => (
          <li className="bar" key={starN}>
            <span className="bar-head">
              <span className="bar-name">{starN} 星</span>
              <span className="bar-value">{d.stats.dist[5 - i] ?? 0}</span>
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.max(2, Math.round(((d.stats.dist[5 - i] ?? 0) / maxDist) * 100))}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <table className="table mini plain">
        <caption className="caption">最新 {d.reviews.length} 条目的国留评</caption>
        <thead>
          <tr>
            <th scope="col">买家</th>
            <th scope="col">国家</th>
            <th scope="col">星级</th>
            <th scope="col">内容</th>
            <th scope="col">日期</th>
          </tr>
        </thead>
        <tbody>
          {d.reviews.map((rv) => (
            <tr key={rv.id}>
              <td>
                <span className="cell-strong">{rv.author}</span>
                <span className="cell-sub">{rv.verified ? '已验证购买' : '留评'}</span>
              </td>
              <td>{COUNTRY_FLAG[rv.country] ?? rv.country}</td>
              <td className="mono">{'★'.repeat(rv.rating)}</td>
              <td className="review-body">{rv.body}</td>
              <td className="mono">{dateOnly(rv.posted_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="panel-form form-row addcart"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Math.max(0, Math.min(999, Math.round(Number(qty) || 0)));
          action.run(async () => {
            await api.addToCart(p.sku, n, region);
            onCartChanged();
          });
        }}
      >
        <h3 className="form-title">加入购物车</h3>
        <label className="field">
          <span className="field-label">数量（上限 = 库存 {p.stock}）</span>
          <input className="input" type="number" min="0" max="999" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        {action.lastError?.code === 'out_of_stock' ? <p className="hint">库存不足，后端拒绝了本次加购（409）。</p> : null}
        {action.message !== null ? (
          <p className="form-msg" data-kind={action.kind ?? 'idle'}>
            {action.message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={action.busy || !p.listed || p.stock === 0}>
          {action.busy ? '提交中…' : !p.listed ? '已下架' : p.stock === 0 ? '到货提醒' : '加购'}
        </button>
      </form>
    </>
  );
}

function CartPanel({
  view,
  onRemove,
}: {
  view: Pick<CartView, 'lines' | 'item_qty'> | null;
  onRemove: (sku: string) => void;
}): React.JSX.Element {
  if (view === null) return <p className="placeholder">正在读取购物车…</p>;
  if (view.lines.length === 0) return <p className="placeholder">购物车为空，去货架加购一件试试。</p>;
  return (
    <ul className="cart">
      {view.lines.map((l: CartLine) => (
        <li className="cart-line" key={l.sku} data-listed={l.listed ? 'true' : 'false'}>
          <span className="cart-line-name">{l.name}</span>
          <span className="cart-line-meta">
            {l.sku} · {l.qty} 件 · 单件 {grams(l.weight_g)}
            {!l.listed ? ' · 已下架不计价' : ''}
          </span>
          <span className="cart-line-price">{usd(l.line_cents)}</span>
          <button type="button" className="btn btn-mini" onClick={() => onRemove(l.sku)}>
            移除
          </button>
        </li>
      ))}
    </ul>
  );
}

function TotalsTable({
  totals,
  selected,
  onPick,
}: {
  totals: RegionTotal[];
  selected: string;
  onPick: (code: string) => void;
}): React.JSX.Element {
  const sorted = useMemo(() => [...totals].sort((a, b) => a.total_cents - b.total_cents), [totals]);
  return (
    <div className="tablewrap">
      <table className="table totals" data-loading={totals.length === 0 ? 'true' : 'false'}>
        <caption className="caption">同一购物车在五个目的国的到手价（美分口径 + 本币折算）</caption>
        <thead>
          <tr>
            <th scope="col">目的国</th>
            <th scope="col" className="num">货值</th>
            <th scope="col" className="num">运费</th>
            <th scope="col" className="num">关税</th>
            <th scope="col" className="num">总到手</th>
            <th scope="col" className="num">本币</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
                读取中…
              </td>
            </tr>
          ) : null}
          {sorted.map((t) => (
            <tr
              key={t.code}
              data-active={t.code === selected ? 'true' : 'false'}
              onClick={() => onPick(t.code)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(t.code);
                }
              }}
            >
              <td>
                <span className="cell-strong">{t.name}</span>
                <span className="cell-sub">
                  {t.code} · 税率 {t.duty_pct}% {t.free_ship ? ' · 已达免邮线' : ''}
                </span>
              </td>
              <td className="num mono">{usd(t.goods_cents)}</td>
              <td className="num mono">{t.freight_cents === 0 ? '免' : usd(t.freight_cents)}</td>
              <td className="num mono">{usd(t.duty_cents)}</td>
              <td className="num mono">{usd(t.total_cents)}</td>
              <td className="num mono">{local(t.total_cents, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductForm({
  token,
  categories,
  onCreated,
}: {
  token: string;
  categories: string[];
  onCreated: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [f, setF] = useState({
    sku: '',
    name: '',
    name_en: '',
    category: categories[0] ?? '',
    brand: '',
    price: '',
    stock: '',
    weight: '',
    hs_code: '',
    origin: '',
    lead_min: '1',
    lead_max: '3',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const errFor = (k: string): string | null => action.lastError?.fields[k] ?? null;

  return (
    <form
      className="panel-form form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const input: CreateProductInput = {
          sku: f.sku.trim(),
          name: f.name.trim(),
          name_en: f.name_en.trim(),
          category: f.category,
          brand: f.brand.trim(),
          price_cents: Math.round(Number(f.price || '0') * 100),
          stock: Number(f.stock || '0'),
          weight_g: Number(f.weight || '0'),
          hs_code: f.hs_code.trim(),
          origin: f.origin.trim(),
          lead_min_days: Number(f.lead_min || '0'),
          lead_max_days: Number(f.lead_max || '0'),
        };
        action.run(async () => {
          await api.createProduct(token, input);
          setF((prev) => ({ ...prev, sku: '', name: '', name_en: '', brand: '', price: '', stock: '', weight: '', hs_code: '', origin: '' }));
          onCreated();
        });
      }}
    >
      <h3 className="form-title">新增 SKU（运营）</h3>
      <label className="field">
        <span className="field-label">SKU</span>
        <input className="input" value={f.sku} maxLength={32} placeholder="CB-EL-0101" onChange={set('sku')} />
        {errFor('sku') ? <span className="err">{errFor('sku')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">中文名</span>
        <input className="input" value={f.name} maxLength={160} onChange={set('name')} />
        {errFor('name') ? <span className="err">{errFor('name')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">英文名</span>
        <input className="input" value={f.name_en} maxLength={160} onChange={set('name_en')} />
      </label>
      <label className="field">
        <span className="field-label">类目</span>
        <select className="input" value={f.category} onChange={set('category')}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {errFor('category') ? <span className="err">{errFor('category')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">品牌</span>
        <input className="input" value={f.brand} maxLength={48} onChange={set('brand')} />
      </label>
      <label className="field">
        <span className="field-label">售价（美元）</span>
        <input className="input" type="number" min="0" step="0.01" value={f.price} onChange={set('price')} />
        {errFor('price_cents') ? <span className="err">{errFor('price_cents')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">库存</span>
        <input className="input" type="number" min="0" step="1" value={f.stock} onChange={set('stock')} />
        {errFor('stock') ? <span className="err">{errFor('stock')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">重量（克）</span>
        <input className="input" type="number" min="1" step="1" value={f.weight} onChange={set('weight')} />
        {errFor('weight_g') ? <span className="err">{errFor('weight_g')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">HS 编码</span>
        <input className="input" value={f.hs_code} maxLength={13} placeholder="8517.62" onChange={set('hs_code')} />
        {errFor('hs_code') ? <span className="err">{errFor('hs_code')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">产地</span>
        <input className="input" value={f.origin} maxLength={32} onChange={set('origin')} />
      </label>
      <label className="field">
        <span className="field-label">时效 min</span>
        <input className="input" type="number" min="1" step="1" value={f.lead_min} onChange={set('lead_min')} />
        {errFor('lead_min_days') ? <span className="err">{errFor('lead_min_days')}</span> : null}
      </label>
      <label className="field">
        <span className="field-label">时效 max</span>
        <input className="input" type="number" min="1" step="1" value={f.lead_max} onChange={set('lead_max')} />
        {errFor('lead_max_days') ? <span className="err">{errFor('lead_max_days')}</span> : null}
      </label>
      {action.lastError?.code === 'unauthorized' || action.lastError?.code === 'forbidden' ? (
        <p className="hint">请在右上角填入正确的管理令牌。</p>
      ) : null}
      {action.lastError?.code === 'conflict' ? <p className="hint">该 SKU 已存在（409）。</p> : null}
      {action.message !== null ? (
        <p className="form-msg" data-kind={action.kind ?? 'idle'}>
          {action.message}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={action.busy || token === ''}>
        {action.busy ? '提交中…' : '上架'}
      </button>
    </form>
  );
}
