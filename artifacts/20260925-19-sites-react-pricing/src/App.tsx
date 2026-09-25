import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AddOns } from './components/AddOns';
import { Compare } from './components/Compare';
import { Controls } from './components/Controls';
import { Faq } from './components/Faq';
import { Footer, Nav } from './components/Frame';
import { useEventRef, useOncePerLoad, usePointerVars, useReveal, useScrolledFlag } from './lib/hooks';
import {
  buildQuote,
  CANOPY_MIN_SEATS,
  clampSeats,
  formatMoney,
  tierOf,
  type AddOnId,
  type Currency,
  type Period,
  type TierId,
} from './lib/pricing';
import { readPrefs, writePrefs } from './lib/storage';

/* 报价单明细：用户点开才动态 import（bundle-dynamic-imports + bundle-conditional）。
   分析模块同理，首次交互后才拉起（bundle-defer-third-party）。 */
const QuoteSheet = lazy(() => import('./components/QuoteSheet'));

const HERO_FACTS = ['30 分钟接入', '不绑信用卡试用 14 天', '按当天人数折算'] as const;

export default function App() {
  const initial = readPrefs(); // 模块级缓存：只有第一次真的读 localStorage（js-cache-storage）
  const [tier, setTier] = useState<TierId>(initial.tier);
  const [seats, setSeats] = useState<number>(initial.seats);
  const [period, setPeriod] = useState<Period>(initial.period);
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [addOns, setAddOns] = useState<readonly AddOnId[]>(initial.addOns);
  const [email, setEmail] = useState<string>(initial.email);
  const [groups, setGroups] = useState<readonly string[]>([]);
  const [onlyDiff, setOnlyDiff] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [featureQuery, setFeatureQuery] = useState<string>('');
  const [showQuote, setShowQuote] = useState<boolean>(false);
  const [sentTo, setSentTo] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  const shellRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  /* ---------- 派生值：全部在渲染期算，不用 effect 回写 state（rerender-derived-state-no-effect） ---------- */
  const config = tierOf(tier);
  const billedSeats = tier === 'canopy' && seats < CANOPY_MIN_SEATS ? CANOPY_MIN_SEATS : seats;
  const picked = useMemo(() => new Set(addOns), [addOns]);
  const quote = useMemo(() => buildQuote({ tier, seats, period, currency, addOns }), [tier, seats, period, currency, addOns]);
  const groupSet = useMemo(() => new Set(groups), [groups]);
  const hasAnnualDiscount = period === 'annual' && config.annualDiscount > 0; // 单表达式不套 memo（rerender-simple-expression-in-memo）

  /* ---------- 交互：改档时在事件处理器里就地收敛状态，不留 effect ---------- */
  const selectTier = useCallback((next: TierId) => {
    const nextConfig = tierOf(next);
    setTier(next);
    setSeats((prev) => clampSeats(next, prev));
    // 原勾选的模块在新档可能不可选：同一个处理器里剪掉（rerender-functional-setstate）
    setAddOns((prev) => prev.filter((id) => nextConfig.allowedAddOns.includes(id)));
  }, []);

  const toggleAddOn = useCallback((id: AddOnId) => {
    setAddOns((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleGroup = useCallback((group: string) => {
    setGroups((prev) => (prev.includes(group) ? prev.filter((x) => x !== group) : [...prev, group]));
  }, []);

  const openQuote = useCallback(() => {
    startTransition(() => setShowQuote((prev) => !prev));
  }, []);

  /* 悬停/聚焦就提前拉取报价单模块：点开时不必等下载（bundle-preload）。
     单文件预览里这句是空操作（模块已被并进来），在 split 构建里才会真的多发一个请求。 */
  const preloadQuote = useCallback(() => {
    void import('./components/QuoteSheet');
  }, []);

  /* ---------- 订阅：整页只挂一次，回调放 ref 里保持最新闭包 ---------- */
  const markInterest = useEventRef(() => {
    void import('./lib/telemetry')
      .then((m) => m.track('first_interaction', { tier, seats }))
      .catch(() => undefined);
  });

  useOncePerLoad(() => {
    window.addEventListener('pointerdown', markInterest, { once: true, passive: true });
    void import('./lib/telemetry')
      .then((m) => m.track('pricing_view', { tier: initial.tier, seats: initial.seats }))
      .catch(() => undefined);
  });

  usePointerVars(shellRef);
  useScrolledFlag(barRef, 8);
  useReveal('[data-reveal]');

  useEffect(() => {
    writePrefs({ version: 2, seats, period, currency, tier, addOns: [...addOns], email });
  }, [seats, period, currency, tier, addOns, email]);

  return (
    <div ref={shellRef} className="page" data-testid="page">
      <Nav />

      <section className="hero">
        <div className="shell hero-grid">
          <div className="reveal" data-reveal>
            <p className="eyebrow">定价 · 2026 春季价目</p>
            <h1 className="hero-title">
              按当天在用的<em>席位</em>付费
            </h1>
            <p className="hero-note">
              松塔把散在邮件、群聊和网页批注里的客户反馈收进一条流水线。价格只跟两件事有关：多少人登录后台、一次买几个月。
            </p>
            <div className="facts">
              {HERO_FACTS.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          </div>

          <Controls
            tier={tier}
            seats={seats}
            period={period}
            currency={currency}
            addOns={addOns}
            onSeats={(next) => setSeats(clampSeats(tier, next))}
            onPeriod={setPeriod}
            onCurrency={setCurrency}
            onSelectTier={selectTier}
          />
        </div>
      </section>

      <section className="section reveal" id="addons" data-reveal>
        <div className="shell">
          <div className="section-head">
            <div>
              <p className="eyebrow">按需加购</p>
              <h2 className="title">存储、身份与响应速度各自计价</h2>
            </div>
            <p className="lede">
              按席位的模块跟着当前 {billedSeats} 席走，按组织的模块一次算一笔；取消勾选立刻从合计里退掉。
            </p>
          </div>
          <AddOns tier={tier} billedSeats={billedSeats} currency={currency} picked={picked} onToggle={toggleAddOn} />
        </div>
      </section>

      <Compare
        groups={groupSet}
        onlyDiff={onlyDiff}
        query={featureQuery}
        onToggleGroup={toggleGroup}
        onOnlyDiff={setOnlyDiff}
        onQuery={setFeatureQuery}
      />

      <section className="section" id="quote">
        <div className="shell">
          <div className="section-head">
            <div>
              <p className="eyebrow">这单多少钱</p>
              <h2 className="title">展开明细，打印或寄给自己</h2>
            </div>
            <p className="lede">
              明细里的每一项都来自上面的算价台，不做二次估算。{hasAnnualDiscount ? '当前含年付折扣。' : '当前为月付口径。'}
            </p>
          </div>
          {showQuote ? (
            <Suspense fallback={<p className="quote-loading">正在载入报价单明细…</p>}>
              <QuoteSheet quote={quote} email={email} onEmail={setEmail} onSent={setSentTo} />
            </Suspense>
          ) : (
            <p className="addon-empty" data-testid="quote-collapsed">
              明细当前收起：这一部分的代码还没下载，点下方合计条的「查看报价单」才按需载入。
            </p>
          )}
          {sentTo !== '' ? (
            <p className="field-ok" data-testid="quote-sent">
              已寄到 {sentTo}（演示站只写本地记录，不发真实邮件）
            </p>
          ) : (
            <p className="quote-note" data-testid="quote-unsent">
              还没有寄出过报价单。
            </p>
          )}
        </div>
      </section>

      <Faq query={query} onQuery={setQuery} />

      <Footer />

      <div className="summary is-sticky" ref={barRef} data-testid="summary-bar">
        <div className="summary-inner">
          <p className="summary-what" data-testid="summary-what">
            <b>
              {config.name} {config.latin}
            </b>{' '}
            · {billedSeats} 席 · {period === 'annual' ? '年付' : '月付'} ·{' '}
            {picked.size === 0 ? '无增值模块' : picked.size + ' 项增值模块'}
          </p>
          <p className="summary-total" data-testid="summary-total" data-charged={quote.charged}>
            {formatMoney(currency, quote.charged)}
            <span className="summary-unit" data-testid="summary-unit">
              {period === 'annual' ? '一次支付 · 折合每月 ' + formatMoney(currency, quote.monthlyTotal) : '每月'}
              {hasAnnualDiscount ? ' · 比月付省 ' + formatMoney(currency, quote.saved) : ''}
            </span>
          </p>
          <button
            type="button"
            className="btn"
            data-testid="toggle-quote"
            disabled={isPending}
            onClick={openQuote}
            onPointerEnter={preloadQuote}
            onFocus={preloadQuote}
          >
            {isPending ? '载入中…' : showQuote ? '收起明细' : '查看报价单'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="reset"
            onClick={() => {
              setTier('grove');
              setSeats(8);
              setPeriod('annual');
              setCurrency('CNY');
              setAddOns([]);
              setQuery('');
              setFeatureQuery('');
              setGroups([]);
              setOnlyDiff(false);
              setShowQuote(false);
              setSentTo('');
            }}
          >
            重置
          </button>
        </div>
      </div>
    </div>
  );
}
