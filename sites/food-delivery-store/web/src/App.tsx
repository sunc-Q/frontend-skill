import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { CATEGORY_LABEL, dateTime, elapsedMinutes, minutesText, spiceText, STATUS_LABEL, timeOnly, yuan, yuanCompact } from './format';
import { initialTheme, persistTheme, Swatch, THEMES, themeCss } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  Dish,
  OrderListParams,
  OrderRow,
  OrderStatus,
  PlaceOrderInput,
  Stats,
} from './types';
import { NEXT_STATUS } from './types';

const TOKEN_KEY = 'biz-site-admin-token';
const BOARD_COLUMNS: OrderStatus[] = ['placed', 'cooking', 'ready', 'delivering'];

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
  const zones = useAsync(() => api.zones(), []);
  const menu = useAsync(() => api.menu({ page_size: 100 }), []);

  const [filters, setFilters] = useState<OrderListParams>({ sort: 'placed', dir: 'desc', page_size: 10 });
  const [page, setPage] = useState(1);
  const list = useAsync(
    () => api.orders({ ...filters, page, page_size: filters.page_size ?? 10 }),
    [filters.status, filters.zone, filters.q, filters.sort, filters.dir, page, filters.page_size],
  );

  const board = useAsync(() => api.orders({ status: '', sort: 'placed', dir: 'asc', page_size: 100 }), [stats.data?.generated_at]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useAsync(
    () => (selectedId === null ? Promise.resolve(null) : api.order(selectedId)),
    [selectedId],
  );

  const action = useAction();

  const refreshAll = useCallback(() => {
    stats.reload();
    list.reload();
    board.reload();
    menu.reload();
  }, [stats.reload, list.reload, board.reload, menu.reload]);

  const advance = (id: number, to: OrderStatus): void => {
    action.run(async () => {
      await api.advance(token, id, to);
      refreshAll();
    });
  };

  const toggleSoldOut = (dish: Dish): void => {
    action.run(async () => {
      await api.setAvailability(token, dish.id, !dish.available);
      menu.reload();
      stats.reload();
    });
  };

  const rows = list.data?.items ?? [];
  useEffect(() => {
    if (selectedId === null && rows.length > 0) setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  const totalRows = list.data?.total ?? 0;
  const pageSize = filters.page_size ?? 10;
  const pages = Math.max(1, Math.ceil(totalRows / pageSize));
  const inFlight = useMemo(() => {
    const b = stats.data?.by_status ?? {};
    return (b.placed ?? 0) + (b.cooking ?? 0) + (b.ready ?? 0) + (b.delivering ?? 0);
  }, [stats.data]);

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme={theme} />
          </span>
          <span className="brand-name">椒麻快送 · 灶台看板</span>
          <span className="brand-sub">外卖门店运营台</span>
        </div>
        <nav className="theme-switch" aria-label="风格切换">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === theme ? 'theme-btn is-active' : 'theme-btn'}
              onClick={() => setTheme(t.id)}
              title={t.mood}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <label className="token-field">
          <span className="field-label">管理令牌</span>
          <input
            type="password"
            value={token}
            placeholder="推进出餐/售罄切换需要"
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </header>

      {action.message !== null ? (
        <p className={action.kind === 'ok' ? 'flash flash-ok' : 'flash flash-err'} role="status">
          {action.message}
          {action.lastError?.code !== undefined && action.lastError.code !== '' ? (
            <span className="flash-code">{action.lastError.code}</span>
          ) : null}
        </p>
      ) : null}

      <section className="kpis" aria-label="经营指标">
        {stats.error !== null ? <p className="note">指标加载失败：{stats.error}</p> : null}
        <Kpi label="今日有效单" value={stats.data ? String(stats.data.today_orders) : '…'} hint={stats.data ? `全部 ${stats.data.orders_total} 单` : ''} />
        <Kpi label="今日流水" value={stats.data ? yuanCompact(stats.data.today_gmv_cents) : '…'} hint={stats.data ? `累计 ${yuanCompact(stats.data.gmv_cents)}` : ''} />
        <Kpi label="厨房在制" value={String(inFlight)} hint="待接单+制作+待取+配送" />
        <Kpi label="平均客单" value={stats.data ? yuan(stats.data.avg_order_cents) : '…'} hint={stats.data ? `出餐均值 ${stats.data.avg_prep_min} 分钟` : ''} />
        <Kpi label="取消率" value={stats.data ? `${stats.data.cancel_rate_pct}%` : '…'} hint="含顾客与厨房取消" />
        <Kpi
          label="在售菜品"
          value={stats.data ? `${stats.data.dishes_available}/${stats.data.dishes_total}` : '…'}
          hint="售罄自动置灰"
        />
      </section>

      <section className="board" aria-label="出餐看板">
        <h2 className="section-title">出餐看板 · 实时状态</h2>
        <div className="board-cols">
          {BOARD_COLUMNS.map((col) => {
            const orders = (board.data?.items ?? []).filter((o) => o.status === col);
            return (
              <div className="board-col" key={col} data-status={col}>
                <h3 className="col-head">
                  <span>{STATUS_LABEL[col] ?? col}</span>
                  <span className="col-count">{orders.length}</span>
                </h3>
                <ul className="col-list">
                  {orders.map((o) => {
                    const nexts = NEXT_STATUS[o.status];
                    return (
                      <li className="order-card" key={o.id} data-status={o.status}>
                        <button type="button" className="card-open" onClick={() => setSelectedId(o.id)}>
                          <span className="order-no">{o.order_no}</span>
                          <span className="order-meta">{timeOnly(o.placed_at)} 下单 · {o.recipient} · {o.zone_name}</span>
                          <span className="order-meta">{o.item_count} 件 · 预计 {minutesText(o.eta_minutes)}</span>
                          <span className="order-total">{yuan(o.total_cents)}</span>
                          <span className="order-elapsed">已 {elapsedMinutes(o.placed_at, nowMs)} 分钟</span>
                        </button>
                        <div className="card-actions">
                          {nexts.map((to) => (
                            <button
                              key={to}
                              type="button"
                              className={to === 'cancelled' ? 'btn btn-danger' : 'btn'}
                              disabled={action.busy || token === ''}
                              onClick={() => advance(o.id, to as OrderStatus)}
                            >
                              {to === 'cancelled' ? '取消' : `→ ${STATUS_LABEL[to] ?? to}`}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                  {orders.length === 0 ? <li className="empty-cell">暂无订单</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mid-grid">
        <section className="detail" aria-label="订单详情">
          <h2 className="section-title">订单详情</h2>
          {detail.loading && detail.data === null ? <p className="note">加载中…</p> : null}
          {detail.error !== null ? <p className="note">{detail.error}</p> : null}
          {detail.data === null && !detail.loading ? <p className="note">点击看板或订单列表查看明细。</p> : null}
          {detail.data !== null ? (
            <article className="detail-card">
              <header className="detail-head">
                <span className="order-no">{detail.data.order.order_no}</span>
                <span className="status-badge" data-status={detail.data.order.status}>{STATUS_LABEL[detail.data.order.status] ?? detail.data.order.status}</span>
              </header>
              <dl className="detail-dl">
                <div><dt>收餐人</dt><dd>{detail.data.order.recipient} · {detail.data.order.masked_phone}</dd></div>
                <div><dt>配送区域</dt><dd>{detail.data.order.zone_name}</dd></div>
                <div><dt>地址</dt><dd>{detail.data.order.address}</dd></div>
                <div><dt>备注</dt><dd>{detail.data.order.note === '' ? '—' : detail.data.order.note}</dd></div>
                <div><dt>下单时间</dt><dd>{dateTime(detail.data.order.placed_at)} UTC</dd></div>
                <div><dt>送达预估</dt><dd>出餐 {detail.data.order.prep_minutes} 分 + 在途 {Math.max(0, detail.data.order.eta_minutes - detail.data.order.prep_minutes)} 分</dd></div>
              </dl>
              <table className="table">
                <thead><tr><th>菜品</th><th>单价</th><th>数量</th><th>小计</th></tr></thead>
                <tbody>
                  {detail.data.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.dish_name}<span className="dim"> {it.dish_code}</span></td>
                      <td className="num">{yuan(it.unit_price_cents)}</td>
                      <td className="num">{it.qty}</td>
                      <td className="num">{yuan(it.line_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3}>菜品小计</td><td className="num">{yuan(detail.data.order.subtotal_cents)}</td></tr>
                  <tr><td colSpan={3}>配送费</td><td className="num">{yuan(detail.data.order.delivery_fee_cents)}</td></tr>
                  <tr className="total-row"><td colSpan={3}>实付合计</td><td className="num">{yuan(detail.data.order.total_cents)}</td></tr>
                </tfoot>
              </table>
            </article>
          ) : null}
        </section>

        <NewOrderForm
          zones={zones.data?.items ?? []}
          menu={menu.data?.items ?? []}
          onPlaced={refreshAll}
          busy={action.busy}
        />
      </div>

      <section className="menu" aria-label="菜单">
        <h2 className="section-title">门店菜单 · 含实时销量</h2>
        <MenuTable
          dishes={menu.data?.items ?? []}
          loading={menu.loading}
          error={menu.error}
          token={token}
          busy={action.busy}
          onToggle={toggleSoldOut}
        />
      </section>

      <section className="orders" aria-label="历史订单">
        <div className="orders-head">
          <h2 className="section-title">订单流水</h2>
          <div className="filters">
            <select
              aria-label="按状态筛选"
              value={filters.status ?? ''}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.value as OrderStatus | '' })); }}
            >
              <option value="">全部状态</option>
              {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <select
              aria-label="按区域筛选"
              value={filters.zone ?? ''}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, zone: e.target.value })); }}
            >
              <option value="">全部区域</option>
              {(zones.data?.items ?? []).map((z) => <option key={z.code} value={z.code}>{z.name}</option>)}
            </select>
            <input
              aria-label="搜索收餐人或单号"
              placeholder="搜索姓名 / 单号"
              value={filters.q ?? ''}
              onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, q: e.target.value })); }}
            />
            <select
              aria-label="排序"
              value={filters.sort ?? 'placed'}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as NonNullable<OrderListParams['sort']> }))}
            >
              <option value="placed">按下单时间</option>
              <option value="total">按金额</option>
              <option value="items">按件数</option>
              <option value="prep">按出餐工时</option>
            </select>
          </div>
        </div>
        {list.error !== null ? <p className="note">{list.error}</p> : null}
        <table className="table">
          <thead>
            <tr>
              <th>单号</th><th>状态</th><th>收餐</th><th>区域</th><th>件数</th>
              <th className="num">小计</th><th className="num">配送费</th><th className="num">实付</th><th>下单</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <OrderTr key={o.id} row={o} active={o.id === selectedId} onOpen={() => setSelectedId(o.id)} nowMs={nowMs} />
            ))}
            {rows.length === 0 && !list.loading ? <tr><td colSpan={9} className="empty-cell">没有符合条件的订单</td></tr> : null}
          </tbody>
        </table>
        <Pager page={page} pages={pages} total={totalRows} onPage={setPage} />
      </section>

      <footer className="foot">
        数据全部来自 Go/Gin + SQLite 后端接口 · 金额恒等式「实付 = 小计 + 配送费」由服务端保证 · 手机号仅以脱敏形式出口
      </footer>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }): React.JSX.Element {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-hint">{hint}</span>
    </div>
  );
}

function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  const css = useMemo(() => themeCss(theme), [theme]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

function OrderTr({ row, active, onOpen, nowMs }: {
  row: OrderRow; active: boolean; onOpen: () => void; nowMs: number;
}): React.JSX.Element {
  return (
    <tr className={active ? 'row is-active' : 'row'} onClick={onOpen}>
      <td className="mono">{row.order_no}</td>
      <td><span className="status-badge" data-status={row.status}>{STATUS_LABEL[row.status] ?? row.status}</span></td>
      <td>{row.recipient}<span className="dim"> {row.masked_phone}</span></td>
      <td>{row.zone_name}</td>
      <td className="num">{row.item_count}</td>
      <td className="num">{yuan(row.subtotal_cents)}</td>
      <td className="num">{yuan(row.delivery_fee_cents)}</td>
      <td className="num strong">{yuan(row.total_cents)}</td>
      <td className="dim">{timeOnly(row.placed_at)}<span className="dim"> ·{elapsedMinutes(row.placed_at, nowMs)}m</span></td>
    </tr>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }): React.JSX.Element {
  return (
    <div className="pager">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <span className="pager-info">第 {page} / {pages} 页 · 共 {total} 单</span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  );
}

function MenuTable({ dishes, loading, error, token, busy, onToggle }: {
  dishes: Dish[]; loading: boolean; error: string | null; token: string; busy: boolean;
  onToggle: (d: Dish) => void;
}): React.JSX.Element {
  const [cat, setCat] = useState<string>('');
  const shown = cat === '' ? dishes : dishes.filter((d) => d.category === cat);
  return (
    <>
      <div className="cat-tabs" role="group" aria-label="分类筛选">
        <button type="button" className={cat === '' ? 'cat is-active' : 'cat'} onClick={() => setCat('')}>全部</button>
        {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
          <button key={k} type="button" className={cat === k ? 'cat is-active' : 'cat'} onClick={() => setCat(k)}>{label}</button>
        ))}
      </div>
      {loading && dishes.length === 0 ? <p className="note">菜单加载中…</p> : null}
      {error !== null ? <p className="note">{error}</p> : null}
      <table className="table">
        <thead>
          <tr><th>编码</th><th>菜品</th><th>分类</th><th>辣度</th><th className="num">单价</th><th className="num">出餐</th><th className="num">累计销量</th><th>状态</th>{token !== '' ? <th>操作</th> : null}</tr>
        </thead>
        <tbody>
          {shown.map((d) => (
            <tr key={d.id} className={d.available ? '' : 'row sold-out'}>
              <td className="mono">{d.code}</td>
              <td>{d.name}<span className="dim"> {d.taste}</span></td>
              <td>{CATEGORY_LABEL[d.category] ?? d.category}</td>
              <td>{spiceText(d.spice)}</td>
              <td className="num">{yuan(d.price_cents)}</td>
              <td className="num">{d.prep_min}′</td>
              <td className="num">{d.sold_total}</td>
              <td>{d.available ? <span className="pill pill-ok">在售</span> : <span className="pill pill-out">售罄</span>}</td>
              {token !== '' ? (
                <td>
                  <button type="button" className="btn btn-mini" disabled={busy} onClick={() => onToggle(d)}>
                    {d.available ? '置售罄' : '恢复在售'}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

interface CartLine { code: string; qty: number }

function NewOrderForm({ zones, menu, onPlaced, busy }: {
  zones: { code: string; name: string; min_order_cents: number; fee_cents: number; eta_min: number }[];
  menu: Dish[];
  onPlaced: () => void;
  busy: boolean;
}): React.JSX.Element {
  const [form, setForm] = useState({ recipient: '', phone: '', zone: '', address: '', note: '' });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const openDishes = useMemo(() => menu.filter((d) => d.available), [menu]);

  const add = (code: string): void => {
    setNotice(null);
    setCart((c) => {
      const hit = c.find((x) => x.code === code);
      if (hit !== undefined) {
        if (hit.qty >= 20) return c;
        return c.map((x) => (x.code === code ? { ...x, qty: x.qty + 1 } : x));
      }
      if (c.length >= 8) {
        setNotice('单笔最多 8 个菜品，请先移除再添加');
        return c;
      }
      return [...c, { code, qty: 1 }];
    });
  };
  const remove = (code: string): void => setCart((c) => c.filter((x) => x.code !== code));

  const dishByCode = useMemo(() => new Map(openDishes.map((d) => [d.code, d])), [openDishes]);
  const subtotal = cart.reduce((acc, x) => acc + (dishByCode.get(x.code)?.price_cents ?? 0) * x.qty, 0);
  const zone = zones.find((z) => z.code === form.zone) ?? zones[0] ?? null;
  const total = subtotal + (zone?.fee_cents ?? 0);

  const submit = (): void => {
    setFieldErrs({});
    setNotice(null);
    const input: PlaceOrderInput = {
      recipient: form.recipient,
      phone: form.phone,
      zone: zone?.code ?? '',
      address: form.address,
      note: form.note,
      items: cart,
    };
    api.placeOrder(input)
      .then((res) => {
        setNotice(`下单成功 ${res.order.order_no} · 实付 ${yuan(res.order.total_cents)} · 预计 ${minutesText(res.order.eta_minutes)}`);
        setCart([]);
        setForm((f) => ({ ...f, address: '', note: '' }));
        onPlaced();
      })
      .catch((err: unknown) => {
        const e = err as { status?: number; code?: string; message?: string; fields?: Record<string, string> };
        if (e.fields !== undefined) setFieldErrs(e.fields);
        setNotice(`${e.message ?? '下单失败'}${e.code !== undefined ? `（${e.code}）` : ''}`);
      });
  };

  return (
    <section className="checkout" aria-label="新客下单">
      <h2 className="section-title">新客下单 · 点菜单模拟顾客端</h2>
      <div className="checkout-grid">
        <div className="dish-picker">
          {openDishes.map((d) => (
            <button key={d.code} type="button" className="dish-chip" onClick={() => add(d.code)} title={d.taste}>
              <span className="dish-name">{d.name}</span>
              <span className="dish-price">{yuan(d.price_cents)}</span>
            </button>
          ))}
        </div>
        <div className="checkout-side">
          <ul className="cart">
            {cart.length === 0 ? <li className="empty-cell">还没点菜，先从左侧选几道</li> : null}
            {cart.map((x) => {
              const d = dishByCode.get(x.code);
              return (
                <li key={x.code} className="cart-line">
                  <span>{d?.name ?? x.code} × {x.qty}</span>
                  <span className="num">{yuan((d?.price_cents ?? 0) * x.qty)}</span>
                  <button type="button" className="btn btn-mini" onClick={() => remove(x.code)}>移除</button>
                </li>
              );
            })}
          </ul>
          <div className="fee-lines">
            <span>菜品小计 {yuan(subtotal)}</span>
            <span>配送费 {yuan(zone?.fee_cents ?? 0)}（{zone?.name ?? '选择区域'}，起送 {zone !== null ? yuan(zone.min_order_cents) : '—'}）</span>
            <span className="strong">合计 {yuan(total)}</span>
          </div>
          <div className="form-grid">
            <label><span className="field-label">收餐人</span>
              <input value={form.recipient} onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))} placeholder="1-32 字" />
              {fieldErrs['recipient'] !== undefined ? <em className="err">{fieldErrs['recipient']}</em> : null}
            </label>
            <label><span className="field-label">手机号</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="1 开头 11 位" />
              {fieldErrs['phone'] !== undefined ? <em className="err">{fieldErrs['phone']}</em> : null}
            </label>
            <label><span className="field-label">配送区域</span>
              <select value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}>
                <option value="">请选择</option>
                {zones.map((z) => <option key={z.code} value={z.code}>{z.name}</option>)}
              </select>
              {fieldErrs['zone'] !== undefined ? <em className="err">{fieldErrs['zone']}</em> : null}
            </label>
            <label className="span2"><span className="field-label">地址</span>
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="街道 门牌 小区 栋 单元 房号" />
              {fieldErrs['address'] !== undefined ? <em className="err">{fieldErrs['address']}</em> : null}
            </label>
            <label className="span2"><span className="field-label">备注</span>
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="口味偏好、放件位置…" />
              {fieldErrs['note'] !== undefined ? <em className="err">{fieldErrs['note']}</em> : null}
            </label>
          </div>
          {Object.entries(fieldErrs).filter(([k]) => k.startsWith('items')).map(([k, v]) => (
            <em className="err" key={k}>{k}: {v}</em>
          ))}
          <button type="button" className="btn btn-primary" disabled={busy || cart.length === 0} onClick={submit}>提交订单</button>
          {notice !== null ? <p className="note">{notice}</p> : null}
        </div>
      </div>
    </section>
  );
}
