import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import {
  CONDITION_LABEL,
  LISTING_STATUS_LABEL,
  OFFER_STATUS_LABEL,
  centToYuan,
  cny,
  cnyCompact,
  dateTime,
  daysAgo,
  premiumPct,
  yuanToCent,
} from './format';
import { THEMES, initialTheme, persistTheme, themeCss, Swatch } from './themes';
import { useAction, useAsync } from './useAsync';
import type {
  Category,
  Condition,
  CreateListingInput,
  DealSortKey,
  ListingDetail,
  ListingSortKey,
  ListingStatus,
  Metrics,
  OfferStatus,
} from './types';

const TOKEN_KEY = 'flea.adminToken';
const DAYS = 14;
const PAGE_SIZE = 12;

const LISTING_SORTS: { key: ListingSortKey; label: string }[] = [
  { key: 'posted', label: '发布时间' },
  { key: 'best', label: '最高出价' },
  { key: 'asking', label: '挂牌价' },
  { key: 'offers', label: '出价数' },
  { key: 'views', label: '浏览' },
  { key: 'code', label: '编号' },
];

const OFFER_SORTS: { key: DealSortKey; label: string }[] = [
  { key: 'placed', label: '出价时间' },
  { key: 'amount', label: '金额' },
  { key: 'expires', label: '有效期' },
];

const OFFER_STATUS_LABELS = OFFER_STATUS_LABEL;

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<string>(() => initialTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  const [token, setToken] = useState<string>(() => readToken());
  useEffect(() => {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 隐私模式忽略 */
    }
  }, [token]);

  const metrics = useAsync<Metrics>(() => api.metrics(DAYS), []);
  const categories = useAsync<Category[]>(() => api.categories().then((r) => r.items), []);

  const [status, setStatus] = useState<ListingStatus | ''>('');
  const [category, setCategory] = useState<string>('');
  const [condition, setCondition] = useState<Condition | ''>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<ListingSortKey>('posted');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const list = useAsync(
    () =>
      api.listings({
        status,
        category,
        condition,
        q: search,
        sort,
        dir,
        page,
        page_size: PAGE_SIZE,
      }),
    [status, category, condition, search, sort, dir, page],
  );

  const rows = list.data?.items ?? [];
  const [selectedCode, setSelectedCode] = useState<string>('');
  useEffect(() => {
    if (rows.length === 0) return;
    if (!rows.some((r) => r.code === selectedCode)) setSelectedCode(rows[0]?.code ?? '');
  }, [rows, selectedCode]);

  const detail = useAsync<ListingDetail | null>(
    () => (selectedCode === '' ? Promise.resolve(null) : api.detail(selectedCode)),
    [selectedCode, list.data?.served_at ?? ''],
  );

  const [offerStatus, setOfferStatus] = useState<OfferStatus | ''>('');
  const [offerSort, setOfferSort] = useState<DealSortKey>('placed');
  const deals = useAsync(
    () => api.deals({ status: offerStatus, sort: offerSort, dir: 'desc', page: 1, page_size: 8 }),
    [offerStatus, offerSort],
  );

  const refreshAll = (): void => {
    metrics.reload();
    list.reload();
    deals.reload();
  };

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="shell">
      <ThemeStyle theme={theme} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Swatch theme="mark" />
          </span>
          <span className="brand-name">旧货市集撮合台</span>
          <span className="brand-sub">Secondhand Marketplace Desk</span>
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
          挂单与出价双向撮合：卖家挂出价与隐性保底价，买家公开出价互相顶；
          只有一笔出价能等到「确认成交」，其余当场标为被顶。下面所有数字都来自后端接口。
        </p>
        <span className="stamp" data-ok={metrics.data?.identity_ok === true ? 'yes' : 'no'}>
          {metrics.data === null ? '对账中…' : metrics.data.identity_ok ? '口径对账通过' : '口径对账异常'}
        </span>
      </div>

      <Kpis m={metrics.data} loading={metrics.loading} error={metrics.error} />

      <main className="layout">
        <section className="col-main">
          <div className="panel">
            <div className="section-head">
              <h2 className="section-title">挂单看板</h2>
              <p className="section-note">
                {list.loading ? '读取中…' : `共 ${total} 条挂单 · 第 ${page}/${pages} 页`}
              </p>
            </div>

            <div className="filters">
              <div className="field field-wide">
                <label className="field-label" htmlFor="f-q">
                  搜索（标题 / 编号 / 卖家）
                </label>
                <input
                  id="f-q"
                  className="input"
                  value={search}
                  placeholder="例如：徕卡 或 FS-1005"
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>

              <div className="field">
                <span className="field-label">状态</span>
                <div className="chips" role="group" aria-label="挂单状态">
                  <Chip active={status === ''} label="全部" onClick={() => { setStatus(''); setPage(1); }} />
                  {(Object.keys(LISTING_STATUS_LABEL) as ListingStatus[]).map((s) => (
                    <Chip
                      key={s}
                      active={status === s}
                      label={LISTING_STATUS_LABEL[s] ?? s}
                      onClick={() => { setStatus(s); setPage(1); }}
                    />
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">品类</span>
                <div className="chips" role="group" aria-label="品类">
                  <Chip active={category === ''} label="全部" onClick={() => { setCategory(''); setPage(1); }} />
                  {(categories.data ?? []).map((c) => (
                    <Chip
                      key={c.code}
                      active={category === c.code}
                      label={c.name_zh}
                      onClick={() => { setCategory(c.code); setPage(1); }}
                    />
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">成色</span>
                <div className="chips" role="group" aria-label="成色">
                  <Chip active={condition === ''} label="全部" onClick={() => setCondition('')} />
                  {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
                    <Chip key={c} active={condition === c} label={CONDITION_LABEL[c] ?? c} onClick={() => setCondition(c)} />
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">排序</span>
                <div className="chips" role="group" aria-label="排序">
                  {LISTING_SORTS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="sortbtn"
                      data-active={sort === s.key ? 'true' : 'false'}
                      onClick={() => { setSort(s.key); setPage(1); }}
                    >
                      {s.label}
                      <span className="sortmark">{sort === s.key ? (dir === 'asc' ? '↑' : '↓') : ''}</span>
                    </button>
                  ))}
                  <button type="button" className="btn" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
                    换向
                  </button>
                </div>
              </div>
            </div>

            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>编号</th>
                    <th>挂单</th>
                    <th>品类</th>
                    <th>挂牌 / 行情</th>
                    <th>最高在拍出价</th>
                    <th>出价</th>
                    <th>浏览</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.code}
                      data-active={r.code === selectedCode ? 'true' : 'false'}
                      onClick={() => setSelectedCode(r.code)}
                    >
                      <td className="mono cell-strong">{r.code}</td>
                      <td>
                        <div className="cell-strong">{r.title}</div>
                        <div className="cell-sub">
                          {r.seller} · {CONDITION_LABEL[r.condition] ?? r.condition} · {r.area} · {daysAgo(r.posted_at, Date.now())} 天前
                        </div>
                      </td>
                      <td className="cell-sub">{r.category_name}</td>
                      <td className="num">
                        {cny(r.asking_cent)}
                        <div className="cell-sub">{premiumPct(r.asking_ref_pct)} vs 行情</div>
                      </td>
                      <td className="num">
                        {r.best_offer_cent > 0 ? cny(r.best_offer_cent) : '—'}
                        <div className="cell-sub">
                          {r.best_offer_cent > 0 ? (r.best_over_floor ? '已过保底' : '未达保底') : '无人出价'}
                        </div>
                      </td>
                      <td className="num">
                        {r.pending_count}/{r.offer_count}
                        <div className="cell-sub">待确认 / 全部</div>
                      </td>
                      <td className="num">{r.views}</td>
                      <td>
                        <span className="badge" data-status={r.status}>
                          {LISTING_STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {list.error !== null ? <p className="err">挂单读取失败：{list.error}</p> : null}
              {!list.loading && rows.length === 0 ? <p className="empty">当前筛选条件下没有挂单。</p> : null}
            </div>

            <div className="pager">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span className="pager-now">{`${page} / ${pages}`}</span>
              <button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                下一页
              </button>
            </div>
          </div>

          <DetailPanel
            detail={detail.data}
            loading={detail.loading}
            error={detail.error}
            token={token}
            onChanged={refreshAll}
          />
        </section>

        <aside className="col-side">
          <NewListingPanel token={token} categories={categories.data ?? []} onCreated={refreshAll} />
          <CategoryBoard m={metrics.data} />
          <DealsPanel
            deals={deals.data?.items ?? []}
            loading={deals.loading}
            error={deals.error}
            status={offerStatus}
            onStatus={setOfferStatus}
            sort={offerSort}
            onSort={setOfferSort}
          />
        </aside>
      </main>

      <footer className="pagefoot">
        <p className="footnote">
          数据由后端 <span className="mono">Seed()</span> 灌入，页面不写死任何一条挂单或出价；
          三套风格共用同一份 DOM 与脚本，只切换 CSS。
        </p>
      </footer>
    </div>
  );
}

function readToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function ThemeStyle({ theme }: { theme: string }): React.JSX.Element {
  return <style data-theme-css={theme}>{themeCss(theme)}</style>;
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" className="chip" data-active={active ? 'true' : 'false'} onClick={onClick}>
      {label}
    </button>
  );
}

function Kpis({ m, loading, error }: { m: Metrics | null; loading: boolean; error: string | null }): React.JSX.Element {
  if (error !== null) return <p className="err">指标读取失败：{error}</p>;
  if (m === null) return <p className="hint">{loading ? '指标读取中…' : '暂无指标'}</p>;
  const cards: { label: string; value: string; hint: string }[] = [
    { label: '挂单总数', value: String(m.listings_total), hint: `在拍 ${m.listings_active} · 下架 ${m.withdrawn}` },
    { label: '成交笔数', value: String(m.deals), hint: `已售出 ${m.sold} · 待交付 ${m.reserved}` },
    { label: '成交额', value: cnyCompact(m.gmv_cent), hint: `近 7 日 ${cnyCompact(m.gmv_7d_cent)} · 均价 ${cny(m.avg_deal_cent)}` },
    { label: '待确认出价', value: String(m.offers_pending), hint: `累计出价 ${m.offers_total}` },
    { label: '最优出价覆盖率', value: `${m.best_bid_yield_pct}%`, hint: '有有效在拍价的挂单占比' },
    { label: '过期仍挂 pending', value: String(m.expired_pending_offers), hint: '退化口径：不计入最优价' },
  ];
  return (
    <section className="kpis" aria-label="总览">
      {cards.map((c) => (
        <div className="kpi" key={c.label}>
          <span className="kpi-label">{c.label}</span>
          <span className="kpi-value">{c.value}</span>
          <span className="kpi-hint">{c.hint}</span>
        </div>
      ))}
      {m.identity_note !== undefined && m.identity_note !== '' ? <p className="caption">{m.identity_note}</p> : null}
    </section>
  );
}

function DetailPanel({
  detail,
  loading,
  error,
  token,
  onChanged,
}: {
  detail: ListingDetail | null;
  loading: boolean;
  error: string | null;
  token: string;
  onChanged: () => void;
}): React.JSX.Element {
  const action = useAction();
  const row = detail?.listing ?? null;
  const offers = detail?.offers ?? [];
  const best = useMemo(() => offers.find((o) => o.is_best) ?? null, [offers]);

  const [buyer, setBuyer] = useState('');
  const [amountYuan, setAmountYuan] = useState('');
  const [message, setMessage] = useState('');

  if (error !== null) return <div className="panel detail"><p className="err">{error}</p></div>;
  if (row === null) return <div className="panel detail"><p className="placeholder">{loading ? '详情读取中…' : '点左侧任意一行看撮合详情'}</p></div>;

  const submitOffer = (): void => {
    action.run(async () => {
      await api.placeOffer(token, row.code, {
        buyer: buyer.trim(),
        amount_cent: yuanToCent(Number(amountYuan)),
        message: message.trim(),
      });
      setAmountYuan('');
      onChanged();
    });
  };

  const decide = (dealNo: string, kind: 'accept' | 'reject'): void => {
    action.run(async () => {
      await api.decide(token, dealNo, kind);
      onChanged();
    });
  };

  return (
    <section className="panel detail">
      <div className="section-head">
        <h2 className="section-title">{row.title}</h2>
        <p className="section-note">
          <span className="mono">{row.code}</span> · {row.category_name} · {row.seller} · {row.area}
        </p>
      </div>

      <div className="detail-main">
        <dl className="facts">
          <div className="fact">
            <dt>挂牌价</dt>
            <dd className="num">{cny(row.asking_cent)}</dd>
          </div>
          <div className="fact">
            <dt>保底价</dt>
            <dd className="num">{cny(row.floor_cent)}</dd>
          </div>
          <div className="fact">
            <dt>行情参考价</dt>
            <dd className="num">{cny(row.ref_cent)}</dd>
          </div>
          <div className="fact">
            <dt>最高在拍出价</dt>
            <dd className="num">{row.best_offer_cent > 0 ? cny(row.best_offer_cent) : '—'}</dd>
          </div>
          <div className="fact">
            <dt>挂出时间</dt>
            <dd className="num">{dateTime(row.posted_at)}</dd>
          </div>
          <div className="fact">
            <dt>状态</dt>
            <dd>
              <span className="badge" data-status={row.status}>
                {LISTING_STATUS_LABEL[row.status] ?? row.status}
              </span>
            </dd>
          </div>
        </dl>

        <div className="tablewrap">
          <table className="table mini">
            <thead>
              <tr>
                <th>出价单号</th>
                <th>买家</th>
                <th>金额</th>
                <th>状态</th>
                <th>下单 / 到期</th>
                <th>留言</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.deal_no} data-best={o.is_best ? 'true' : 'false'}>
                  <td className="mono">
                    {o.rank}. {o.deal_no}
                  </td>
                  <td>{o.buyer}</td>
                  <td className="num">
                    {cny(o.amount_cent)}
                    <div className="cell-sub">{o.over_floor ? '≥ 保底价' : '低于保底价'}</div>
                  </td>
                  <td>
                    <span className="badge" data-status={o.status} data-best={o.is_best ? 'yes' : 'no'}>
                      {OFFER_STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="num">
                    {dateTime(o.placed_at)}
                    <div className="cell-sub">{o.status === 'pending' ? `有效期至 ${dateTime(o.expires_at)}` : dateTime(o.expires_at)}</div>
                  </td>
                  <td className="cell-sub">{o.message}</td>
                  <td>
                    {o.status === 'pending' ? (
                      <span className="rowbtns">
                        <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => decide(o.deal_no, 'accept')}>
                          确认成交
                        </button>
                        <button type="button" className="btn" disabled={action.busy} onClick={() => decide(o.deal_no, 'reject')}>
                          拒绝
                        </button>
                      </span>
                    ) : (
                      <span className="cell-sub">已定</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {offers.length === 0 ? <p className="empty">这条挂单还没有人出价。</p> : null}
        </div>

        <div className="panel-form">
          <p className="form-title">代客出价（写接口，需管理令牌）</p>
          <div className="form-row">
            <label className="field" htmlFor="offer-buyer">
              <span className="field-label">买家昵称</span>
              <input id="offer-buyer" className="input" value={buyer} placeholder="guitar_fan" onChange={(e) => setBuyer(e.target.value)} />
            </label>
            <label className="field" htmlFor="offer-amount">
              <span className="field-label">出价（元）</span>
              <input
                id="offer-amount"
                className="input"
                inputMode="decimal"
                value={amountYuan}
                placeholder={row.best_offer_cent > 0 ? String(centToYuan(row.best_offer_cent + 2000)) : String(centToYuan(row.floor_cent))}
                onChange={(e) => setAmountYuan(e.target.value)}
              />
            </label>
            <label className="field field-wide" htmlFor="offer-msg">
              <span className="field-label">留言</span>
              <input id="offer-msg" className="input" value={message} placeholder="周末来自提" onChange={(e) => setMessage(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={action.busy || token === ''} onClick={submitOffer}>
              提交出价
            </button>
          </div>
          <p className="form-note">
            当前最高：{best === null ? '无' : cny(best.amount_cent)}；服务端要求每次至少加 20 元
            （MinIncrementCent=2000 分），低于保底价或高于挂牌价都会被 409 挡回。
          </p>
          <ActionLine action={action} />
        </div>
      </div>
    </section>
  );
}

function ActionLine({ action }: { action: ReturnType<typeof useAction> }): React.JSX.Element | null {
  if (action.message === null) return null;
  const code = action.lastError?.code;
  return (
    <p className="form-msg" data-kind={action.kind ?? 'err'}>
      {code !== undefined ? `[${code}] ` : ''}
      {action.message}
    </p>
  );
}

function NewListingPanel({
  token,
  categories,
  onCreated,
}: {
  token: string;
  categories: Category[];
  onCreated: () => void;
}): React.JSX.Element {
  const action = useAction();
  const [form, setForm] = useState({ code: '', title: '', seller: '', area: '徐汇·田林', askingYuan: '', floorYuan: '' });
  const [category, setCategory] = useState(categories[0]?.code ?? '');
  const [condition, setCondition] = useState<Condition>('good');

  const set = (k: keyof typeof form, v: string): void => setForm({ ...form, [k]: v });

  const submit = (): void => {
    const input: CreateListingInput = {
      code: form.code.trim().toUpperCase(),
      title: form.title.trim(),
      category,
      seller: form.seller.trim(),
      asking_cent: yuanToCent(Number(form.askingYuan)),
      floor_cent: yuanToCent(Number(form.floorYuan)),
      condition,
      area: form.area.trim(),
    };
    action.run(async () => {
      await api.createListing(token, input);
      set('code', '');
      set('title', '');
      onCreated();
    });
  };

  return (
    <section className="panel panel-form">
      <p className="form-title">新挂单上架</p>
      <div className="form-row">
        <label className="field" htmlFor="nl-code">
          <span className="field-label">编号</span>
          <input id="nl-code" className="input" value={form.code} placeholder="FS-2001" onChange={(e) => set('code', e.target.value)} />
        </label>
        <label className="field field-wide" htmlFor="nl-title">
          <span className="field-label">标题</span>
          <input id="nl-title" className="input" value={form.title} placeholder="琴 + 硬盒 + 备用弦" onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field" htmlFor="nl-cat">
          <span className="field-label">品类</span>
          <select id="nl-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name_zh}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="nl-cond">
          <span className="field-label">成色</span>
          <select id="nl-cond" className="input" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
            {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="nl-seller">
          <span className="field-label">卖家</span>
          <input id="nl-seller" className="input" value={form.seller} placeholder="seller_01" onChange={(e) => set('seller', e.target.value)} />
        </label>
        <label className="field" htmlFor="nl-area">
          <span className="field-label">自提区域</span>
          <input id="nl-area" className="input" value={form.area} onChange={(e) => set('area', e.target.value)} />
        </label>
        <label className="field" htmlFor="nl-asking">
          <span className="field-label">挂牌价（元）</span>
          <input id="nl-asking" className="input" inputMode="decimal" value={form.askingYuan} placeholder="880" onChange={(e) => set('askingYuan', e.target.value)} />
        </label>
        <label className="field" htmlFor="nl-floor">
          <span className="field-label">保底价（元）</span>
          <input id="nl-floor" className="input" inputMode="decimal" value={form.floorYuan} placeholder="720" onChange={(e) => set('floorYuan', e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={action.busy || token === ''} onClick={submit}>
          上架
        </button>
      </div>
      {token === '' ? <p className="hint">未填管理令牌时，写接口一律 401。</p> : null}
      <ActionLine action={action} />
    </section>
  );
}

function CategoryBoard({ m }: { m: Metrics | null }): React.JSX.Element {
  if (m === null) return <section className="panel bars"><p className="hint">行情读取中…</p></section>;
  const max = m.by_category.reduce((a, c) => (c.gmv_cent > a ? c.gmv_cent : a), 0);
  return (
    <section className="panel bars" aria-label="品类行情">
      <div className="section-head">
        <h2 className="section-title">品类行情</h2>
        <p className="section-note">条形长度＝成交额（{m.window}）</p>
      </div>
      {m.by_category.map((c) => (
        <div className="bar" key={c.category_code}>
          <div className="bar-head">
            <span className="bar-name">{c.category_name}</span>
            <span className="bar-value">{cnyCompact(c.gmv_cent)}</span>
          </div>
          <div className="bar-track">
            <span className="bar-fill" style={{ width: `${max === 0 ? 0 : Math.round((c.gmv_cent / max) * 100)}%` }} />
          </div>
          <div className="bar-foot">
            <span className="caption">
              {c.listings} 单 · 成交 {c.sold} · 均价 {cny(c.avg_deal_cent)}
            </span>
            <span className="caption mono">ref {cnyCompact(c.ref_cent)}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function DealsPanel({
  deals,
  loading,
  error,
  status,
  onStatus,
  sort,
  onSort,
}: {
  deals: ListingDetail['offers'];
  loading: boolean;
  error: string | null;
  status: OfferStatus | '';
  onStatus: (s: OfferStatus | '') => void;
  sort: DealSortKey;
  onSort: (s: DealSortKey) => void;
}): React.JSX.Element {
  return (
    <section className="panel">
      <div className="section-head">
        <h2 className="section-title">出价流水</h2>
        <p className="section-note">{loading ? '读取中…' : `${deals.length} 条 · 按${OFFER_SORTS.find((s) => s.key === sort)?.label ?? ''}排序`}</p>
      </div>
      <div className="chips" role="group" aria-label="出价状态">
        <Chip active={status === ''} label="全部" onClick={() => onStatus('')} />
        {(Object.keys(OFFER_STATUS_LABEL) as OfferStatus[]).map((s) => (
          <Chip key={s} active={status === s} label={OFFER_STATUS_LABEL[s] ?? s} onClick={() => onStatus(s)} />
        ))}
      </div>
      <div className="chips" role="group" aria-label="流水排序">
        {OFFER_SORTS.map((s) => (
          <button key={s.key} type="button" className="sortbtn" data-active={sort === s.key ? 'true' : 'false'} onClick={() => onSort(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="tablewrap">
        <table className="table mini plain">
          <thead>
            <tr>
              <th>单号</th>
              <th>挂单</th>
              <th>买家</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((o) => (
              <tr key={o.deal_no}>
                <td className="mono">{o.deal_no}</td>
                <td className="mono">{o.listing_code}</td>
                <td>{o.buyer}</td>
                <td className="num">{cny(o.amount_cent)}</td>
                <td>
                  <span className="badge" data-status={o.status}>
                    {OFFER_STATUS_LABELS[o.status] ?? o.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error !== null ? <p className="err">{error}</p> : null}
        {!loading && deals.length === 0 ? <p className="empty">该状态暂无出价。</p> : null}
      </div>
    </section>
  );
}
