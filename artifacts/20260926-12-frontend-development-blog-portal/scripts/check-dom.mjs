/**
 * check-dom.mjs — jsdom suite for
 * frontend-development × 博客内容门户 (2026-09-26 12:00).
 *
 *   F  首屏窗口：挂载前后各发了什么请求、骨架是否真的占了位
 *   H  交互全链路：防抖、筛选、排序、行高、收藏与持久化、深链、三条路由、按需面板
 *   N   三臂消融：同一份源码只换 __FD_ARM__，量「虚拟滚动」「memo 行」「稳定 queryKey」各自值多少
 *
 * Real pixels, contrast and real-HTTP request counts are NOT here — jsdom has no layout engine and
 * no network stack worth trusting. Those live in check-browser.mjs.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Group, dumpResults, num, ok, results, summary } from './_harness.mjs';
import { loadFacts } from './dump-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mkdir = mkdirSync(path.join(ROOT, '.tmp-check'), { recursive: true });
const BUNDLES = {
  main: readFileSync(path.join(ROOT, 'dist/assets/main.js'), 'utf8'),
  nomemo: readFileSync(path.join(ROOT, 'dist-nomemo/assets/main.js'), 'utf8'),
  novirtual: readFileSync(path.join(ROOT, 'dist-novirtual/assets/main.js'), 'utf8'),
  unstablekey: readFileSync(path.join(ROOT, 'dist-unstablekey/assets/main.js'), 'utf8'),
};
const facts = await loadFacts();
const ROWS = facts.wireRows();

/* ------------------------------------------------------------------ boot */
async function boot(opts = {}) {
  const {
    id = 'topo-tactical',
    bundle = BUNDLES.main,
    hash = '',
    seed = {},
    budget = 2500,
    url = `https://grayscale.test/portal.html${hash}`,
  } = opts;
  const msgs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => msgs.push(`jsdomError ${e.message}`));
  vc.on('error', (m) => msgs.push(`error ${String(m)}`));
  const dom = new JSDOM(
    `<!doctype html><html lang="zh-CN" data-fd-style="${id}"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`,
    {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      url,
      virtualConsole: vc,
      beforeParse(win) {
        for (const [k, v] of Object.entries(seed)) win.localStorage.setItem(k, v);
      },
    },
  );
  const win = dom.window;
  const doc = win.document;
  const t0 = Date.now();
  win.eval(bundle);
  const firstPaintMs = Date.now() - t0;

  /**
   * Conditional polling, never a fixed sleep: the lab's own note is that fixed ticks drift and
   * produce fake failures. The predicate is the value we intend to assert on.
   */
  const wait = (fn, ms = 6000) =>
    new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let ready = false;
        try {
          ready = fn() === true;
        } catch {
          ready = false;
        }
        if (ready) resolve(true);
        else if (Date.now() - start > ms) resolve(false);
        else setTimeout(tick, 10);
      };
      tick();
    });

  const at = (sel) => doc.querySelector(sel);
  const all = (sel) => [...doc.querySelectorAll(sel)];
  const text = (sel) => (at(sel)?.textContent ?? '').trim();
  const click = (el) => el !== undefined && el !== null && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const type = (el, value) => {
    if (el === null || el === undefined) throw new Error('type(): target missing — app never painted this element');
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  /**
   * React synthesises onPointerEnter from native `pointerover`/`pointerout` (it computes the
   * enter/leave pair itself), so a bare `pointerenter` dispatch reaches nothing. Dispatch the
   * event React actually listens for, with relatedTarget null = "came from outside".
   */
  const hover = (el) =>
    el !== null && el !== undefined && el.dispatchEvent(new win.Event('pointerover', { bubbles: true, cancelable: true }));
  const go = (h) => {
    win.location.hash = h;
    win.dispatchEvent(new win.HashChangeEvent('hashchange'));
  };
  const bridge = () => win.__fdBridge;
  const reqPaths = () => bridge().reqLog().map((r) => r.path);
  const domRows = () => all('[data-testid="row"]').length;
  const painted = () => at('[data-testid="row"]') !== null || at('[data-testid="empty"]') !== null;

  /**
   * Sample the in-flight window instead of sleeping a guess: every Suspense boundary renders
   * SuspenseLoader while its read is pending, so the placeholders that F6/F7 measure only exist
   * for a few hundred ms. Sampling also gives us `mounted` for the ablation arms, where one arm
   * never paints at all.
   */
  const skel = { sync: 0, samples: [], minHeights: [], inline: [], labels: [] };
  skel.sync = all('[data-skeleton]').length;
  let mounted = painted();
  while (!mounted && Date.now() - t0 < budget) {
    const nodes = all('[data-skeleton]');
    skel.samples.push(nodes.length);
    for (const n of nodes) {
      const attr = Number(n.getAttribute('data-min-height'));
      if (Number.isFinite(attr) && !skel.minHeights.includes(attr)) skel.minHeights.push(attr);
      const inline = Number((n.getAttribute('style') ?? '').match(/min-height:\s*(\d+)/)?.[1]);
      if (Number.isFinite(inline) && !skel.inline.includes(inline)) skel.inline.push(inline);
      const label = n.querySelector('.state')?.textContent?.trim() ?? '';
      if (label !== '' && !skel.labels.includes(label)) skel.labels.push(label);
    }
    await new Promise((r) => setTimeout(r, 15));
    mounted = painted();
  }
  const mountMs = Date.now() - t0;
  const reqsAtMount = reqPaths().length;
  return { win, doc, at, all, text, click, type, hover, go, bridge, reqPaths, domRows, wait, msgs, firstPaintMs, skel, mounted, mountMs, reqsAtMount };
}

const settle = async (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Samples the placeholder DOM while an action runs, instead of guessing how long a boundary stays
 * suspended. Stops as soon as the deferred panel is on screen, so `peak` is the honest "was there
 * ever a frame with nothing in it" answer for that click.
 */
async function sampleFor(app, ms, action) {
  const labels = [];
  const heights = [];
  let peak = 0;
  let frames = 0;
  action?.();
  const start = Date.now();
  while (Date.now() - start < ms) {
    frames += 1;
    const nodes = app.all('[data-skeleton]');
    peak = Math.max(peak, nodes.length);
    for (const n of nodes) {
      const l = n.querySelector('.state')?.textContent?.trim() ?? '';
      if (l !== '' && !labels.includes(l)) labels.push(l);
      const h = Number(n.getAttribute('data-min-height'));
      if (Number.isFinite(h) && !heights.includes(h)) heights.push(h);
    }
    if (app.at('[data-testid="insights"]') !== null) break;
    await settle(10);
  }
  return { labels, heights, peak, frames };
}

/* ---------------------------------------------------------------- F */
Group('F 首屏窗口');
const app = await boot();
const skelPeak = app.skel.samples.length > 0 ? Math.max(...app.skel.samples) : 0;
ok('F0 首屏无 console error', app.msgs.length === 0, app.msgs.slice(0, 2).join(' | '));
ok('F1 首屏只发 1 个请求，且是 /posts', JSON.stringify(app.reqPaths()) === JSON.stringify(['/posts']), app.reqPaths().join(','));
ok('F2 首屏对 /insights 零请求（延后取数不是措辞）', !app.reqPaths().includes('/insights'));
ok('F3 挂载即有行（无早期 return，Suspense 边界之后才有 DOM）', app.domRows() > 0, `${app.domRows()} 行 / 共 ${ROWS.length} 篇`);
ok('F4 路由壳标了 crumb', app.at('[data-testid="route-shell"]')?.dataset.crumb === '最新', app.at('[data-testid="route-shell"]')?.dataset.crumb);
ok('F5 列表窗口只渲染一部分（虚拟滚动生效）', app.domRows() < 40 && app.domRows() >= 6, `${app.domRows()} 行在 DOM 里`);
const firstSkelFrame = app.skel.samples.findIndex((n) => n >= 1);
const blankAfterFallback = app.skel.samples.slice(firstSkelFrame).filter((n) => n === 0).length;
ok('F6 占位一旦出现，到首行落地之前不再出现任何空白帧（掉帧式闪烁 = 0）',
  app.skel.samples.length > 3 && firstSkelFrame >= 0 && blankAfterFallback === 0,
  `采样 ${app.skel.samples.length} 帧 · 首个占位在第 ${firstSkelFrame} 帧 · 之后空白 ${blankAfterFallback} 帧`);
num('F6b React 首次提交前的空白采样帧（jsdom 调度，不是页面行为）；在飞期间占位峰值', firstSkelFrame, `帧 × 15ms · 峰值 ${skelPeak} 个占位`);
ok('F6b 首屏挂起的是路由壳这一个边界：列表边界从未挂起，因为 loader 已经把同一次读取到（一次读、两处共用）',
  app.skel.labels.some((l) => l.includes('路由')) && !app.skel.labels.some((l) => l.includes('文章列表')) && app.reqsAtMount === 1,
  app.skel.labels.join(' / '));
ok('F7 占位在真实 DOM 上留了高度：data-min-height 与内联 style 同值且都 >0',
  app.skel.minHeights.length >= 1 && app.skel.minHeights.every((h) => h > 0) && JSON.stringify(app.skel.minHeights) === JSON.stringify(app.skel.inline),
  `${app.skel.minHeights.join('/')}px 内联 ${app.skel.inline.join('/')}px`);
ok('F7b 占位文案可解释（每个都以「载入」开头并带上边界名）', app.skel.labels.length >= 1 && app.skel.labels.every((l) => l.startsWith('载入')), app.skel.labels.join(' / '));
ok('F7c 读数到位后占位全部移除（不留空洞）', app.all('[data-skeleton]').length === 0, `${app.all('[data-skeleton]').length} 个残留`);
num('F8 首屏从 eval 到第一行的真实耗时（含 fixture 90ms 与懒模块解析）', app.mountMs, 'ms');
num('F8b 同步 eval 段耗时', app.firstPaintMs, 'ms');
ok('F8c 首屏时刻的请求数 = 1（挂载点没有并发取数）', app.reqsAtMount === 1, `${app.reqsAtMount}`);
await app.wait(() => app.text('[data-testid="result-count"]').includes('240'));
ok('F9 列表读数与事实源一致（240 篇）', app.text('[data-testid="result-count"]').startsWith('240 / 240 篇'), app.text('[data-testid="result-count"]'));
const viewsShown = app.text('[data-testid="result-count"]').match(/·\s*([\d,]+)\s*阅读/)?.[1] ?? '';
ok('F10 页面上打印的阅读总数 = 独立复算值（不是手抄）', viewsShown === facts.corpus.stats.views.toLocaleString('en-US'), `${viewsShown} vs ${facts.corpus.stats.views}`);
app.win.close();

/* ---------------------------------------------------------------- H */
Group('H 交互 · 检索与筛选');
const h = await boot();
await h.wait(() => h.domRows() > 5);
const q = h.at('[data-testid="q"]');
h.type(q, '灰度');
const immediate = h.text('[data-testid="result-count"]');
ok('H1 输入后立刻不改结果（防抖生效，界面不逐字重排）', immediate.startsWith('240 / 240 篇'), immediate);
ok('H2 输入态提示切换为「等待输入…」', h.text('[data-testid="debounce-state"]').includes('等待输入'), h.text('[data-testid="debounce-state"]'));
await h.wait(() => !h.text('[data-testid="result-count"]').startsWith('240 / 240'), 2000);
const expectGray = ROWS.filter((r) => r.title.includes('灰度')).length;
const gotCount = Number(h.text('[data-testid="result-count"]').split(' /')[0]);
ok('H3 防抖到期后的命中数 = 独立复算', gotCount === expectGray, `${gotCount} vs ${expectGray}`);
ok('H4 检索态文案回填了查询词', h.text('[data-testid="debounce-state"]').includes('灰度'), h.text('[data-testid="debounce-state"]'));
h.type(q, '不存在的词zzz');
await h.wait(() => h.at('[data-testid="empty"]') !== null, 2000);
ok('H5 空结果走显式空态而不是零行 DOM', h.domRows() === 0 && h.at('[data-testid="empty"]') !== null, h.text('[data-testid="empty"]').slice(0, 24));
ok('H6 空态里带上了查询词与可选总数（可解释）', h.text('[data-testid="empty"]').includes('不存在的词zzz') && h.text('[data-testid="empty"]').includes('240'), h.text('[data-testid="empty"]').slice(0, 40));
h.type(q, '');
await h.wait(() => h.text('[data-testid="result-count"]').startsWith('240 / 240'), 2000);
ok('H7 清空检索后回到全量', h.text('[data-testid="result-count"]').startsWith('240 / 240'), h.text('[data-testid="result-count"]'));

Group('H 交互 · 标签与排序');
const tagBefore = h.text('[data-testid="result-count"]');
h.click(h.at('[data-testid="tag-deploy"]'));
await h.wait(() => !h.text('[data-testid="result-count"]').startsWith('240 /'), 1500);
const deployExpect = facts.corpus.byTag.find((t) => t.tag === 'deploy')?.count ?? -1;
const afterTag = Number(h.text('[data-testid="result-count"]').split(' /')[0]);
ok('H8 标签筛选后的篇数 = byTag 复算（且确实从全量变了）', afterTag === deployExpect && !tagBefore.startsWith(`${deployExpect} /`), `${tagBefore.slice(0, 9)} → ${afterTag} vs 复算 ${deployExpect}`);
ok('H9 筛选后每一行的标签都是「发布」', h.all('[data-testid="row"] [class="tag"]').every((e) => e.textContent === '发布'), h.all('[data-testid="row"] .tag').slice(0, 3).map((e) => e.textContent).join('/'));
h.click(h.at('[data-testid="clear-tag"]'));
await h.wait(() => h.text('[data-testid="result-count"]').startsWith('240 /'), 1500);
ok('H10 「发布 ×」chip 出现并可清除', h.text('[data-testid="result-count"]').startsWith('240 /'), h.text('[data-testid="result-count"]'));
h.click(h.at('[data-testid="sort-popular"]'));
await h.wait(() => h.at('[data-testid="row"]') !== null, 800);
const popFirst = ROWS.slice().sort((a, b) => b.views - a.views || a.slug.localeCompare(b.slug))[0];
ok('H11 「最热」首行 = 独立复算的全站阅读第一', h.at('[data-testid="row"] .t')?.textContent === popFirst.title, `${h.at('[data-testid="row"] .t')?.textContent} vs ${popFirst.title}`);
h.click(h.at('[data-testid="sort-quick"]'));
await h.wait(() => h.at('[data-testid="row"]') !== null, 800);
const quickFirst = ROWS.slice().sort((a, b) => a.minutes - b.minutes || b.day - a.day)[0];
ok('H12 「最省时」首行 = 分钟升序、并列按日期降序的复算第一', h.at('[data-testid="row"] .t')?.textContent === quickFirst.title, `${h.at('[data-testid="row"] .t')?.textContent} vs ${quickFirst.title}`);
h.click(h.at('[data-testid="sort-recent"]'));
await h.wait(() => h.at('[data-testid="row"]')?.textContent === ROWS.slice().sort((a, b) => b.day - a.day)[0].title, 1200);
ok('H13 「最新」回到日期序', h.at('[data-testid="row"] .t')?.textContent === ROWS.slice().sort((a, b) => b.day - a.day)[0].title, '');

Group('H 交互 · 密度与收藏');
const subBefore = h.at('[data-testid="row-sub"]')?.textContent ?? '';
const rowsBeforeDensity = h.domRows();
const windowBefore = h.at('[data-testid="rows"]')?.getAttribute('data-window') ?? '';
h.click(h.at('[data-testid="density"]'));
await h.wait(() => (h.at('[data-testid="row-sub"]')?.textContent ?? '') !== subBefore, 1200);
ok('H14 行高切换确实改变了每行副文案（密度不是纯装饰）', (h.at('[data-testid="row-sub"]')?.textContent ?? '').includes('′'), h.at('[data-testid="row-sub"]')?.textContent);
const windowAfter = h.at('[data-testid="rows"]')?.getAttribute('data-window') ?? '';
ok('H15 同一 420px 视口下紧凑行高装下更多行（窗口右界随 rowHeight 变小而变大；真实像素归 D 组）',
  Number(windowAfter.split(':')[1]) > Number(windowBefore.split(':')[1]) && h.domRows() > rowsBeforeDensity,
  `${windowBefore} → ${windowAfter} · DOM ${rowsBeforeDensity} → ${h.domRows()}`);
const firstTitle = h.at('[data-testid="row"]')?.getAttribute('aria-label') ?? '';
const firstSlug = ROWS.find((r) => r.title === firstTitle)?.slug ?? '';
const starBtn = h.all('[data-testid="row"] .star')[0];
h.click(starBtn);
await h.wait(() => h.at('[data-testid="star-count"]')?.textContent?.startsWith('1'), 1200);
ok('H16 收藏后计数变 1 且该行按钮 aria-pressed=true', h.at('[data-testid="row"] .star')?.getAttribute('aria-pressed') === 'true', h.at('[data-testid="row"] .star')?.getAttribute('aria-pressed'));
const stored = h.win.localStorage.getItem(facts.PREFS_KEY);
ok('H17 偏好已写入 localStorage，且 starred 里正是刚点的那一行（不是默认值也不是序号巧合）',
  stored !== null && JSON.parse(stored).version === facts.PREFS_VERSION && JSON.parse(stored).starred.length === 1 && JSON.parse(stored).starred[0] === firstSlug,
  `${String(stored).slice(0, 70)} · 目标 ${firstSlug}`);
const reloaded = await boot({ seed: { [facts.PREFS_KEY]: stored ?? '' } });
await reloaded.wait(() => reloaded.at('[data-testid="star-count"]')?.textContent?.startsWith('1') === true, 1500);
ok('H18 重新加载后收藏仍在（且不是靠默认值）', reloaded.text('[data-testid="star-count"]').startsWith('1 篇'), reloaded.text('[data-testid="star-count"]'));
ok('H19 重加载后密度/排序偏好也一并恢复', reloaded.text('[data-testid="density"]').includes('紧凑'), reloaded.text('[data-testid="density"]'));
const okSlug = ROWS[0].slug;
const okSlug2 = ROWS[5].slug;
const staleEnvelope = await boot({ seed: { [facts.PREFS_KEY]: JSON.stringify({ version: 99, sort: 'popular', starred: [okSlug] }) } });
await staleEnvelope.wait(() => staleEnvelope.at('[data-testid="star-count"]') !== null, 1500);
ok('H20a 版本信封不符 → 整份草稿作废回落默认（星单不被陌生版本带进来）',
  staleEnvelope.text('[data-testid="star-count"]').startsWith('0 篇') && staleEnvelope.text('[data-testid="density"]').includes('舒适'),
  staleEnvelope.text('[data-testid="star-count"]'));
staleEnvelope.win.close();
const hostile = await boot({ seed: { [facts.PREFS_KEY]: JSON.stringify({ version: facts.PREFS_VERSION, sort: 'nope', density: 'huge', tag: 'zzz', starred: ['x', okSlug, 7, okSlug2, `${okSlug}../../etc`, okSlug] }) } });
await hostile.wait(() => hostile.at('[data-testid="star-count"]')?.textContent?.startsWith('2 篇') === true, 1500);
ok('H20b 同版本敌意草稿逐字段消毒：非法枚举回落默认，星单只留形状合法的两篇（重复项去重）',
  hostile.text('[data-testid="star-count"]').startsWith('2 篇'), hostile.text('[data-testid="star-count"]'));
ok('H20c 敌意 tag 让筛选回落「全部」而不是筛出空列表（消毒必须保住可见内容）',
  hostile.domRows() > 5 && hostile.text('[data-testid="result-count"]').startsWith(`${ROWS.length} /`), `${hostile.domRows()} 行 · ${hostile.text('[data-testid="result-count"]').slice(0, 18)}`);
/* The store self-heals: loadPrefs sanitises on read and the hydrated state is written straight
   back, so the hostile keys do not survive — but that write is an effect, so the predicate has to
   be the cleaned value itself. Reading storage once right after boot caught it still dirty. */
const healed = await hostile.wait(() => !(hostile.win.localStorage.getItem(facts.PREFS_KEY) ?? '').includes('nope'), 2000);
const hostileStoredBoot = hostile.win.localStorage.getItem(facts.PREFS_KEY) ?? '';
const hostileStored = JSON.parse(hostileStoredBoot);
ok('H21 敌意草稿被就地治愈：回写的信封里脏枚举/脏 tag 已被合法值替换，星单只剩两篇',
  healed && hostileStored.version === facts.PREFS_VERSION && hostileStored.sort === 'recent' && hostileStored.density === 'comfortable' && hostileStored.tag === 'all' && JSON.stringify(hostileStored.starred) === JSON.stringify([okSlug, okSlug2]),
  JSON.stringify(hostileStored).slice(0, 110));
reloaded.click(reloaded.at('[data-testid="clear-stars"]'));
await reloaded.wait(() => reloaded.text('[data-testid="star-count"]').startsWith('0 篇'), 1200);
ok('H22 清空收藏生效并落盘', JSON.parse(reloaded.win.localStorage.getItem(facts.PREFS_KEY) ?? '{}').starred.length === 0, '');
for (const x of [h, reloaded, hostile]) x.win.close();

Group('H 交互 · 路由与按需面板');
const nav = await boot();
await nav.wait(() => nav.domRows() > 5);
nav.go('#/post/' + ROWS[3].slug);
await nav.wait(() => nav.text('[data-testid="post-title"]') === ROWS[3].title, 2500);
ok('H23 深链到正文：标题来自 /post/:slug 的读数', nav.text('[data-testid="post-title"]') === ROWS[3].title, nav.text('[data-testid="post-title"]'));
const postPaths = nav.reqPaths().filter((p) => p.startsWith('/post'));
ok('H24 正文页请求 = 列表一次 + 正文一次（loader 与组件共用同一次读，不是各发一遍）',
  JSON.stringify(postPaths) === JSON.stringify(['/posts', `/post/${ROWS[3].slug}`]), postPaths.join(','));
const relCount = nav.all('[data-testid="related"]').length;
const expectRel = facts.relatedTo(ROWS[3].slug).length;
ok('H25 相关阅读条数 = 独立复算，且按阅读降序', relCount === expectRel && expectRel > 0, `${relCount} vs ${expectRel}`);
ok('H26 正文小节数与 sections 一致（TOC 与正文同源）', Number(nav.text('[data-testid="block-count"]').match(/(\d+) 节/)?.[1]) === facts.corpus.posts[3].sections.length, nav.text('[data-testid="block-count"]'));
const codeEl = nav.at('[data-testid="code"]');
const codeTokKinds = new Set(nav.all('[data-testid="code"] span[class^="tok-"]').map((e) => e.className));
const goBlock = (facts.corpus.posts[3].body.match(/```go\n([\s\S]*?)```/) ?? [])[1] ?? '';
ok('H27 代码块四类 token 都渲染出 DOM 节点（高亮不是只包一层 plain）',
  ['tok-kw', 'tok-str', 'tok-num', 'tok-com'].every((c) => codeTokKinds.has(c)), [...codeTokKinds].sort().join(','));
const codeText = (codeEl?.textContent ?? '').replace(/\s+$/, '');
ok('H27b 高亮后的 DOM 文本逐字等于事实源里的代码（着色没有吃掉任何字符）',
  goBlock.replace(/\s+$/, '') !== '' && codeText === goBlock.replace(/\s+$/, ''),
  `DOM ${codeText.split('\n').length} 行 vs 事实源 ${goBlock.trimEnd().split('\n').length} 行`);
nav.go('#/archive');
await nav.wait(() => nav.at('[data-testid="archive-table"]') !== null, 2000);
const yearCounts = nav.all('[data-testid^="year-"]').map((tr) => Number(tr.querySelectorAll('td')[0]?.textContent));
ok('H28 归档年合计相加 = 240（与首页同一份缓存）', yearCounts.reduce((a, b) => a + b, 0) === 240, yearCounts.join('+'));
nav.click(nav.at('[data-testid="toggle-2023"]') ?? undefined);
await nav.wait(() => nav.all('[data-testid^="month-2023"]').length > 0, 1500);
ok('H29 展开 2023 后出现该月行，且月合计 = 该年计数', nav.all('[data-testid^="month-2023"]').length > 0, `${nav.all('[data-testid^="month-2023"]').length} 行`);
const monthSum = nav.all('[data-testid^="month-2023"]').map((tr) => Number(tr.querySelectorAll('td')[0]?.textContent)).reduce((a, b) => a + b, 0);
const y23 = facts.buildArchive(ROWS).find((y) => y.year === 2023);
ok('H30 展开的月份篇数相加 = 该年年行篇数', monthSum === (y23?.count ?? -1), `${monthSum} vs ${y23?.count}`);
ok('H31 归档路由零新增请求（列表已在缓存里）', nav.reqPaths().filter((p) => p === '/posts').length === 1, nav.reqPaths().join(','));
nav.go('#/about');
await nav.wait(() => nav.at('[data-testid="about-title"]') !== null, 2000);
ok('H32 关于页文案里的月份/断更数与事实源一致',
  nav.text('.prose').includes(`${facts.corpus.stats.spanMonths} 个自然月`) && nav.text('.prose').includes(`最长断更 ${facts.corpus.stats.longestGap} 个月`),
  nav.text('.prose').slice(0, 60));
ok('H33 关于页同样零请求', nav.reqPaths().filter((p) => p === '/posts').length === 1, nav.reqPaths().join(','));
nav.go('#/');
await nav.wait(() => nav.domRows() > 5, 2000);
ok('H34 回到首页：缓存命中，仍然只有 1 次 /posts', nav.reqPaths().filter((p) => p === '/posts').length === 1, nav.reqPaths().join(','));
const insightsBefore = nav.reqPaths().length;
ok('H34b 未点开的读数面板根本不在 DOM 里（延后的是模块，不是藏起来的元素），且首页没有残留占位',
  nav.at('[data-testid="insights"]') === null && nav.all('[data-skeleton]').length === 0,
  `${nav.all('[data-skeleton]').length} 个占位`);
const trigger = nav.at('[data-testid="insights-toggle"]');
nav.hover(trigger);
await nav.wait(() => nav.reqPaths().includes('/insights'), 1500);
ok('H35 悬停即预取读数（React 把 onPointerEnter 合成在原生 pointerover 上，未点击就发一次 /insights）',
  nav.reqPaths().includes('/insights'), `${nav.reqPaths().join(',')} · 首页时 ${insightsBefore} 次`);
const hoverReads = nav.reqPaths().filter((p) => p === '/insights').length;
await settle(260);
const preWarmed = await sampleFor(nav, 900, () => nav.click(trigger));
ok('H36 点击展开面板，且没有新增第二次读（面板与预取共用同一次读）',
  hoverReads === 1 && nav.at('[data-testid="insights"]') !== null && nav.reqPaths().filter((p) => p === '/insights').length === 1,
  nav.reqPaths().join(','));
ok('H36b 点开的第一帧必然还是占位：lazy 首次渲染一定挂一次边界（React 语义，不是实现漏了）',
  preWarmed.peak >= 1 && preWarmed.frames >= 2, `${preWarmed.frames} 帧 · 峰值 ${preWarmed.peak} 个占位`);
const expectMonths = facts.corpus.byMonth.slice(0, 8);
const panelRows = nav.all('[data-testid="insights-table"] tbody tr');
const rowsMatch = panelRows.length === expectMonths.length && panelRows.every((tr, i) => {
  const m = tr.querySelector('th')?.textContent?.trim() ?? '';
  const count = Number(tr.querySelectorAll('td')[0]?.textContent);
  const views = Number((tr.querySelectorAll('td')[1]?.textContent ?? '').replace(/,/g, ''));
  return m === expectMonths[i]?.month && count === expectMonths[i]?.count && views === expectMonths[i]?.views;
});
ok('H37 面板月份行数 = 文案承诺的「最近 8 个月」，且逐行的篇数/阅读 = byMonth 前 8 项', rowsMatch,
  `${panelRows.length} 行 vs ${expectMonths.length} · ${panelRows.map((tr) => tr.querySelector('th')?.textContent).join(' ')}`);
const svgBars = nav.all('[data-testid="insights"] svg rect').length;
const expectYears = new Set(facts.corpus.posts.map((p) => facts.dayToYear(p.day))).size;
ok('H37b 柱图条数 = 事实源里的年份个数（图与表同一份数，只是聚合轴不同）',
  svgBars === expectYears && svgBars > 1, `${svgBars} 条 vs ${expectYears} 年`);
ok('H38 全部导航结束后 /insights 只出现一次（single-flight）',
  nav.reqPaths().filter((p) => p === '/insights').length === 1, nav.reqPaths().join(','));
nav.win.close();

Group('H 交互 · 冷点开对照');
const cold = await boot();
await cold.wait(() => cold.domRows() > 5);
const coldReadBeforeClick = cold.reqPaths().includes('/insights');
const coldSample = await sampleFor(cold, 1200, () => cold.click(cold.at('[data-testid="insights-toggle"]')));
ok('H39 不做预热的点开：占位真的出现过（「载入 全站读数…」），且 /insights 仍然只读一次',
  coldSample.peak >= 1 && coldSample.labels.some((l) => l.includes('全站读数')) && cold.reqPaths().filter((p) => p === '/insights').length === 1,
  `${coldSample.peak} 个占位 / ${coldSample.frames} 帧 · ${coldSample.labels.join(' / ')}`);
ok('H39b 冷点开的占位同样预留了高度（点开不会把侧栏顶跳）', coldSample.heights.length >= 1 && coldSample.heights.every((h) => h > 0), coldSample.heights.join('/'));
ok('H39c 点开之后面板在 DOM 里，且首屏那一次 /posts 没有被重复触发',
  cold.at('[data-testid="insights"]') !== null && cold.reqPaths().filter((p) => p === '/posts').length === 1, cold.reqPaths().join(','));
num('H39d 点开到面板落地的采样帧数（每帧 ≈12ms，本机噪声 ±3）', coldSample.frames, `冷 ${coldSample.frames} 帧 vs 预热 ${preWarmed.frames} 帧`);
/* Frame counts on this carrier differ only by sampler noise: the inline build already carries the
   panel code, so pre-warming can buy at most the 70ms read, which the ~300ms jsdom render swamps.
   What *is* deterministic — and the whole claim hover-preloading makes — is where the read sits
   relative to the click. The real byte/chunk difference is measured in browser group G. */
ok('H39e 预取的作用只有一个可断言的形态：预热点开时读发生在点击之前、冷点开时读发生在点击之后，两者都不多读一次',
  coldReadBeforeClick === false && hoverReads === 1 && cold.reqPaths().filter((p) => p === '/insights').length === 1 && nav.reqPaths().filter((p) => p === '/insights').length === 1,
  `冷：点击前 ${coldReadBeforeClick} / 点击后共 ${cold.reqPaths().filter((p) => p === '/insights').length} 次；预热：点击前已读 ${hoverReads} 次`);
cold.win.close();

/* ---------------------------------------------------------------- N */
Group('N 三臂消融');
/**
 * One wall-clock window per arm, so the unstable-queryKey arm — which never finishes painting —
 * still gets a comparable request count instead of "however long the test happened to wait".
 */
const ARM_WINDOW = 1500;
async function armRun(label, bundle) {
  const k = await boot({ bundle, budget: ARM_WINDOW });
  const reqsOnWindow = k.reqPaths().length;
  const countsWindow = k.bridge().renderCounts();
  const consoleErrors = k.msgs.length;
  const rowsOnWindow = k.domRows();
  let perKeystroke = null;
  let reqsAfterKeys = reqsOnWindow;
  let rowsAfterKeys = rowsOnWindow;
  if (k.mounted) {
    k.bridge().resetRenderCounts();
    const before = k.bridge().renderCounts();
    const input = k.at('[data-testid="q"]');
    for (const ch of '索引重建') {
      k.type(input, ch);
      await k.wait(() => false, 30);
    }
    await k.wait(() => k.text('[data-testid="result-count"]').includes('索引'), 2000);
    const after = k.bridge().renderCounts();
    perKeystroke = { row: after.row - before.row, list: after.list - before.list, page: after.page - before.page };
    reqsAfterKeys = k.reqPaths().length;
    rowsAfterKeys = k.domRows();
  }
  const out = { label, mounted: k.mounted, rowsOnWindow, rowsAfterKeys, reqsOnWindow, reqsAfterKeys, countsWindow, perKeystroke, consoleErrors, paths: k.reqPaths().slice(), bytes: bundle.length };
  k.win.close();
  return out;
}
const arms = [];
for (const [label, bundle] of Object.entries(BUNDLES)) arms.push(await armRun(label, bundle));
const byLabel = Object.fromEntries(arms.map((a) => [a.label, a]));
const kc = (l) => byLabel[l].perKeystroke ?? { row: -1, list: -1, page: -1 };
ok('N0 四臂在同样窗口里都没有 console error（消融只换 define，不换稳定性）', arms.every((a) => a.consoleErrors === 0), arms.map((a) => `${a.label}:${a.consoleErrors}`).join(' '));
ok('N0b 计数器读数不是活引用：主臂挂载窗口的 row 计数必须已经累加过（返回同一对象会让所有差值恒为 0）',
  byLabel.main.countsWindow.row >= byLabel.main.rowsOnWindow, `窗口内 row 计数 ${byLabel.main.countsWindow.row}`);
num('N1 主臂 DOM 行数', byLabel.main.rowsOnWindow, `（全量 ${ROWS.length}）`);
num('N2 novirtual 臂 DOM 行数', byLabel.novirtual.rowsOnWindow, '');
ok('N2b 关掉虚拟滚动后所有行进 DOM（条款的价值 = 240-窗口行数 个节点）', byLabel.novirtual.rowsOnWindow === ROWS.length && byLabel.main.rowsOnWindow < ROWS.length, `${byLabel.novirtual.rowsOnWindow} vs ${byLabel.main.rowsOnWindow}`);
num('N3 主臂 3 次击键的 row 渲染次数', kc('main').row, '');
num('N4 nomemo 臂 3 次击键的 row 渲染次数', kc('nomemo').row, '');
ok('N4b 这三次击键真的改过列表（否则「row 渲染 0 次」只是什么都没发生）',
  arms.every((a) => !a.mounted || a.rowsAfterKeys !== a.rowsOnWindow), arms.map((a) => `${a.label}:${a.rowsOnWindow}→${a.rowsAfterKeys}`).join(' '));
ok('N5 memo 关掉后行渲染次数显著上升（条款不是空话）', byLabel.nomemo.mounted && byLabel.main.mounted && kc('nomemo').row > kc('main').row * 3, `${kc('nomemo').row} > ${kc('main').row * 3}`);
ok('N6 两臂的列表容器渲染次数相同（差异只在行，不是整个列表被重建）',
  kc('main').list === kc('nomemo').list && kc('nomemo').list >= 3,
  `${kc('main').list} vs ${kc('nomemo').list}`);
num('N7 主臂每击键 row 渲染', +(kc('main').row / 3).toFixed(2), '次');
num('N7b nomemo 臂每击键 row 渲染', +(kc('nomemo').row / 3).toFixed(2), '次');
num('N7c 主臂 3 次击键的 page 渲染', kc('main').page, '次（页面组件随筛选态重渲染，行不重渲染）');
num('N8 同样 1.5s 窗口内的请求数：主臂 / unstablekey 臂', byLabel.main.reqsOnWindow, `主臂 ${byLabel.main.reqsOnWindow} · unstablekey ${byLabel.unstablekey.reqsOnWindow}`);
ok('N9 queryKey 不稳定 → 首屏从未完成 + 请求被放大（同源码、同交互，只差 define）',
  byLabel.unstablekey.mounted === false && byLabel.unstablekey.reqsOnWindow > byLabel.main.reqsOnWindow * 5,
  `unstablekey 请求 ${byLabel.unstablekey.reqsOnWindow} 次 / 行 ${byLabel.unstablekey.rowsOnWindow} / page 渲染 ${byLabel.unstablekey.countsWindow.page}`);
ok('N9b 主臂三次击键零新增请求（防抖 + 缓存：击键不打网络）',
  byLabel.main.reqsAfterKeys === byLabel.main.reqsOnWindow, `${byLabel.main.reqsOnWindow} → ${byLabel.main.reqsAfterKeys} · ${byLabel.main.paths.join(',')}`);
ok('N9c 三臂里只有 unstablekey 从未完成首屏（另外两条消融臂只是变慢，不是坏掉）',
  arms.filter((a) => !a.mounted).map((a) => a.label).join(',') === 'unstablekey', arms.map((a) => `${a.label}:${a.mounted}`).join(' '));
ok('N10 四臂 bundle 字符数差异 <1%（消融不靠改代码，构建成本可忽略）',
  Math.max(...arms.map((a) => a.bytes)) - Math.min(...arms.map((a) => a.bytes)) < arms[0].bytes * 0.01,
  arms.map((a) => a.bytes).join('/'));
const scroll = await boot({ bundle: BUNDLES.novirtual });
await scroll.wait(() => scroll.domRows() === ROWS.length, 6000);
const novirtNodes = scroll.all('[data-testid="row"]').length;
scroll.win.close();

/**
 * jsdom has no layout, so a real scroll cannot happen here: the viewport metrics are injected on
 * the node and the scroll event is dispatched. The window that comes back is then re-derived by
 * hand from the same rowHeight the DOM reports — this checks the arithmetic, not the browser.
 * Genuine scrolling (and the 240-row arm's jank) is measured in check-browser.mjs group K.
 */
const scrollMain = await boot({ bundle: BUNDLES.main });
await scrollMain.wait(() => scrollMain.domRows() > 3, 6000);
const port = scrollMain.at('[data-testid="rows"]');
const w0 = port?.getAttribute('data-window') ?? '';
const rowBox = Number((scrollMain.at('.vrow')?.getAttribute('style') ?? '').match(/height:\s*([\d.]+)/)?.[1]);
const TOP = 3000;
const VIEW = 420;
Object.defineProperty(port, 'scrollTop', { value: TOP, configurable: true });
Object.defineProperty(port, 'clientHeight', { value: VIEW, configurable: true });
port?.dispatchEvent(new scrollMain.win.Event('scroll', { bubbles: true }));
const expectFirst = Math.max(0, Math.floor(TOP / rowBox) - 4);
const expectLast = Math.min(ROWS.length, Math.ceil((TOP + VIEW) / rowBox) + 4);
await scrollMain.wait(() => (scrollMain.at('[data-testid="rows"]')?.getAttribute('data-window') ?? '') === `${expectFirst}:${expectLast}`, 2000);
const w1 = scrollMain.at('[data-testid="rows"]')?.getAttribute('data-window') ?? '';
ok('N11 滚动后窗口 = 手算的 floor(top/rowHeight)-overscan 区间（虚拟列表跟着视口走，不是写死前 11 行）',
  w1 === `${expectFirst}:${expectLast}`, `${w0} → ${w1}，期望 ${expectFirst}:${expectLast}（rowHeight ${rowBox}px）`);
ok('N12 滚动后窗口宽度仍有界（≤ ceil(视口/行高)+2×overscan），没有一次性把 240 行拉进 DOM',
  scrollMain.domRows() <= Math.ceil(VIEW / rowBox) + 8 && scrollMain.domRows() > 3,
  `${w0} → ${w1} · DOM ${scrollMain.domRows()} 行 ≤ ${Math.ceil(VIEW / rowBox) + 8}`);
ok('N12b 滚动后 DOM 行数仍远小于全量，且首行序号跟着窗口走',
  scrollMain.domRows() < ROWS.length / 4 && scrollMain.at('[data-testid="row"] .num')?.textContent !== '01',
  `${scrollMain.domRows()} 行 · 首行编号 ${scrollMain.at('[data-testid="row"] .num')?.textContent}`);
num('N13 novirtual 臂 DOM 节点行数', novirtNodes, `（主臂 ${scrollMain.domRows()} · 主臂行高 ${rowBox}px）`);
scrollMain.win.close();

const n = summary('check-dom');
dumpResults(path.join(ROOT, '.tmp-check', 'assertions-dom.json'));
process.exitCode = n === 0 ? 0 : 1;
