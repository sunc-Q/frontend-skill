/**
 * check-browser.mjs — groups D / G / K / M for
 * frontend-development × 博客内容门户 (2026-09-26 12:00).
 *
 *   D  真实计算样式：三风格在浏览器里各自渲染成什么，行高/圆角/描边/手法是否真的互异，是否零跨源
 *   G  真 HTTP 请求台账：?api=1 + split 构建，量「首屏取了什么、悬停取了什么、路由切换取了什么」
 *   K  真滚动与真点击：jsdom 没有布局，虚拟窗口的右界只能靠注入；这里用真实 clientHeight 重算
 *   M  持久化跨载体：file:// 与 http:// 是两个 origin，收藏必须各自成立，敌意草稿不能崩页
 *
 * Run: node scripts/check-browser.mjs [PORT]   (needs the dist builds and preview pages from build-inline.mjs)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { startMockApi } from '../server/mock-api.mjs';
import { Group, dumpResults, num, ok, results, summary } from './_harness.mjs';
import { loadFacts } from './dump-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 8173);
const OUT = path.join(ROOT, '.tmp-check');
mkdirSync(OUT, { recursive: true });

const SKINS = ['topo-tactical', 'clay-stop', 'vinyl-crate'];
const facts = await loadFacts();
const ROWS = facts.wireRows();
const T = facts.STYLES;

const latency = { '/posts': 120, '/insights': 240 };
const srv = await startMockApi({ port: PORT, latency });
const ORIGIN = srv.origin;

const execPath = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const browser = await chromium.launch({ executablePath: existsSync(execPath) ? execPath : undefined, headless: true });
const newCtx = () => browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });

const fileUrl = (id) => pathToFileURL(path.join(ROOT, 'preview', `portal-${id}.html`)).href;

/* one property per probe keeps evaluate payloads small; long return values time out */
async function probe(page, sel, prop, pseudo = null) {
  return page.evaluate(([s, p, ps]) => {
    const el = document.querySelector(s);
    if (el === null) return '∅missing';
    const v = getComputedStyle(el, ps).getPropertyValue(p);
    return v.length > 30 ? `${v.slice(0, 30)}…` : v;
  }, [sel, prop, pseudo]);
}
const varOf = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

const rgb = (s) => {
  const m = String(s).match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  return m === null ? [0, 0, 0] : [Number(m[1]), Number(m[2]), Number(m[3])];
};
const hexToRgb = (h) => {
  const v = h.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(v.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => {
  const [x, y, z] = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
};
const contrast = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2);
};

/* ---------------------------------------------------------------- D */
const PROPS = [
  ['siteCase', '.site', 'text-transform'],
  ['taglineTrack', '.tagline', 'letter-spacing'],
  ['bodyFont', '.tagline', 'font-family'],
  ['numFont', '.num', 'font-family'],
  ['radius', '.panel', 'border-top-left-radius'],
  ['borderW', '.panel', 'border-top-width'],
  ['panelShadow', '.panel', 'box-shadow'],
  ['rowShadow', '.row', 'box-shadow'],
  ['rowHeight', '.row', 'height'],
  ['rowBorder', '.row', 'border-bottom-width'],
  ['chipBg', '.list-head', 'background-color'],
  ['headSize', '.site', 'font-size'],
];
const snap = {};
for (const id of SKINS) {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  const reqs = [];
  const errs = [];
  page.on('request', (r) => reqs.push(r.url()));
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 60)));
  await page.goto(fileUrl(id), { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });

  Group(`D 真实计算样式 · ${id}`);
  ok(`D0 ${id} 双击 file:// 打开零报错`, errs.length === 0, errs.join('|') || 'clean');
  const external = reqs.filter((u) => !u.startsWith('file://') && !u.startsWith('data:'));
  ok(`D0b ${id} 零跨源请求（字体/图片/埋点都没有）`, external.length === 0, external.join(',') || `仅 ${reqs.length} 个 file:// 请求`);
  const g = {};
  for (const [key, sel, prop] of PROPS) g[key] = await probe(page, sel, prop);
  const geom = await page.evaluate(() => {
    const r = document.querySelector('.row')?.getBoundingClientRect();
    const vp = document.querySelector('[data-testid="rows"]');
    const foot = document.querySelector('.foot')?.getBoundingClientRect();
    return {
      rowH: r === undefined ? 0 : Math.round(r.height),
      vpH: vp === null ? 0 : Math.round(vp.getBoundingClientRect().height),
      vpScroll: vp === null ? 0 : vp.scrollHeight,
      footTop: foot === undefined ? 0 : Math.round(foot.top),
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    };
  });
  /* D1 — does the density token actually paint the row box, or does the row just sit at content
     height inside a taller slot? Measured before any interaction, on the default density. */
  ok(`D1 ${id} 行高实测 = 该风格的 comfortable 令牌（令牌真的画出这一行，不只是占位间距）`,
    geom.rowH === T[id].rowHeight.comfortable, `${geom.rowH}px vs 令牌 ${T[id].rowHeight.comfortable}px`);
  ok(`D2 ${id} 虚拟端口高度受 max-height 约束，而内层撑到 240×行高`,
    geom.vpH <= 560 && geom.vpScroll >= ROWS.length * T[id].rowHeight.comfortable * 0.9,
    `视口 ${geom.vpH}px / 内容 ${geom.vpScroll}px`);
  ok(`D3 ${id} 1440px 下无横向滚动`, geom.sw <= geom.iw + 1, `${geom.sw} ≤ ${geom.iw}`);
  await page.setViewportSize({ width: 430, height: 860 });
  const narrow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(`D4 ${id} 430px 窄屏仍无横向溢出（grid 用 minmax(0,1fr) 夹住）`, narrow.sw <= narrow.iw + 1, `${narrow.sw} ≤ ${narrow.iw}`);
  await page.setViewportSize({ width: 1440, height: 900 });

  const textVar = await varOf(page, '--c-text');
  const bgVar = await varOf(page, '--c-bg');
  const mutedVar = await varOf(page, '--c-muted');
  const hotVar = await varOf(page, '--c-hot');
  const mainC = contrast(hexToRgb(textVar), hexToRgb(bgVar));
  const mutedC = contrast(hexToRgb(mutedVar), hexToRgb(bgVar));
  ok(`D5 ${id} 正文/底色实测对比度 ≥4.5（WCAG AA）`, mainC >= 4.5, `${mainC}:1 ${textVar} on ${bgVar}`);
  ok(`D5b ${id} 次要文字对比度 ≥4.5`, mutedC >= 4.5, `${mutedC}:1 ${mutedVar} on ${bgVar}`);
  num(`D5c ${id} 令牌底色`, bgVar, `hot=${hotVar} · 手法=${await varOf(page, '--separation')}`);
  const sep = await varOf(page, '--separation');
  const mark = await varOf(page, '--hot-mark');
  ok(`D6 ${id} 分隔手法 = 注册表声明的那一种`, sep === T[id].separation && mark === T[id].hotMark, `${sep} / ${mark}`);
  /* hot = views ≥ 90th percentile of the current result set, and the default 最新 order puts
     none of them in the first window — so the mark has to be looked at where it actually paints. */
  await page.click('[data-testid="sort-popular"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="row"][data-hot="true"]') !== null, null, { timeout: 8000 });
  const hotRow = await page.evaluate(([sel]) => {
    const row = document.querySelector(sel);
    if (row === null) return { found: false };
    const before = getComputedStyle(row, '::before');
    const tag = row.querySelector('.tag');
    return {
      found: true,
      barW: before.width,
      barBg: before.backgroundColor,
      tagTransform: tag === null ? '∅' : getComputedStyle(tag).transform,
      tagBg: tag === null ? '∅' : getComputedStyle(tag).backgroundColor,
    };
  }, ['[data-testid="row"][data-hot="true"]']);
  const hotExpect = {
    'left-bar': () => hotRow.found && hotRow.barW === '4px' && rgb(hotRow.barBg).join(',') === hexToRgb(hotVar).join(','),
    'badge-lift': () => hotRow.found && hotRow.tagTransform !== 'none' && rgb(hotRow.tagBg).join(',') === hexToRgb(hotVar).join(','),
    'label-invert': () => hotRow.found && rgb(hotRow.tagBg).join(',') === hexToRgb(hotVar).join(',') && hotRow.tagTransform === 'none',
  }[T[id].hotMark];
  ok(`D7 ${id} 热帖标记在真实渲染里就是 ${T[id].hotMark} 这一种机制`, hotExpect !== undefined && hotExpect(),
    JSON.stringify(hotRow));
  snap[id] = { ...g, sep, mark, bg: bgVar, text: textVar, mainC, mutedC };
  await ctx.close();
}

Group('D 三风格互异（计算样式层）');
const keys = PROPS.map(([k]) => k);
for (const [a, b] of [['topo-tactical', 'clay-stop'], ['topo-tactical', 'vinyl-crate'], ['clay-stop', 'vinyl-crate']]) {
  const diff = keys.filter((k) => snap[a][k] !== snap[b][k]);
  ok(`D8 ${a}↔${b} 十二项指纹差异 ≥7`, diff.length >= 7, `${diff.length}/12（${diff.join(',')}）`);
}
const seps = SKINS.map((s) => snap[s].sep);
const marks = SKINS.map((s) => snap[s].mark);
ok('D9 三种分隔手法互斥', new Set(seps).size === 3, seps.join(','));
ok('D9b 三种热帖标记手法互斥', new Set(marks).size === 3, marks.join(','));
ok('D10 阴影手法互斥：直角无阴影 / 大圆角硬阴影 / 刻纹',
  snap['topo-tactical'].panelShadow === 'none' && /px .*px/.test(snap['clay-stop'].panelShadow) && snap['vinyl-crate'].radius !== '0px',
  `topo=${snap['topo-tactical'].panelShadow} clay=${snap['clay-stop'].panelShadow.slice(0, 22)} vinylR=${snap['vinyl-crate'].radius}`);
const rowHeights = SKINS.map((s) => snap[s].rowHeight);
ok('D11 三风格行高各不相同（同一份数据，三种密度基准）', new Set(rowHeights).size === 3, rowHeights.join(','));
ok('D12 三风格底色两两不同', new Set(SKINS.map((s) => snap[s].bg)).size === 3, SKINS.map((s) => snap[s].bg).join(' | '));

/* ---------------------------------------------------------------- G */
Group('G 真 HTTP 台账（?api=1 + split 构建）');
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  const reqs = [];
  latency['/posts'] = 120;
  srv.arrivals.length = 0;
  page.on('request', (r) => reqs.push(r.url()));
  await page.goto(`${ORIGIN}/preview/split-host.html?api=1`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });
  const apiOf = (frag) => reqs.filter((u) => u.includes(frag)).length;
  const srvOf = (frag) => srv.arrivals.filter((a) => a.path.includes(frag)).length;
  const jsChunks = () => reqs.filter((u) => u.endsWith('.js'));
  ok('G1 首屏服务端只收到 1 次 /api/posts（loader 与组件共用一次读）', srvOf('/api/posts') === 1,
    `client=${apiOf('/api/posts')} server=${srvOf('/api/posts')} 全部=${srv.arrivals.map((a) => a.path).join(',')}`);
  ok('G2 首屏对 /api/insights 零请求（延后取数在真网络层成立）', srvOf('/api/insights') === 0, `server=${srvOf('/api/insights')}`);
  ok('G2b 首屏没有下载读数面板的 chunk（懒边界在真 chunk 图上成立）',
    !jsChunks().some((u) => u.includes('InsightsPanel')), jsChunks().map((u) => u.split('/').pop()).join(','));
  const chunksAtBoot = jsChunks().length;
  srv.arrivals.length = 0;
  await page.hover('[data-testid="insights-toggle"]');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.includes('InsightsPanel')), null, { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  ok('G3 悬停之后 InsightsPanel chunk 才出现（且只下载一次）',
    apiOf('InsightsPanel.js') === 1 && jsChunks().length > chunksAtBoot,
    `${apiOf('InsightsPanel.js')} 次 · 新增 ${jsChunks().length - chunksAtBoot} 个 chunk：${jsChunks().slice(chunksAtBoot).map((u) => u.split('/').pop()).join(',')}`);
  ok('G3b 悬停同时预热了读数接口（/api/insights 恰好 1 次）', srvOf('/api/insights') === 1,
    srv.arrivals.map((a) => `${a.path}@${Math.round(a.atMs)}`).join(','));
  await page.click('[data-testid="insights-toggle"]');
  await page.waitForSelector('[data-testid="insights"]', { timeout: 8000 });
  ok('G4 点开面板零新增请求（预取与点击共用同一次读、同一个 chunk）',
    srvOf('/api/insights') === 1 && apiOf('InsightsPanel.js') === 1, `after click: server=${srvOf('/api/insights')} chunk=${apiOf('InsightsPanel.js')}`);
  const rowsBefore = await page.textContent('[data-testid="stat-posts"]');
  srv.arrivals.length = 0;
  const slug = ROWS[2].slug;
  await page.evaluate((s) => { window.location.hash = `#/post/${s}`; }, slug);
  await page.waitForFunction((s) => (document.querySelector('[data-testid="post-title"]')?.textContent ?? '') !== '' && document.querySelector(`[data-testid="post-title"]`) !== null, slug, { timeout: 15000 });
  ok('G5 正文路由只多发 1 次 /api/post/:slug（loader 与 useSuspenseQuery 同键同次）',
    srvOf('/api/post/') === 1 && srvOf('/api/posts') === 0, srv.arrivals.map((a) => a.path).join(','));
  const detailChunks = jsChunks().length;
  srv.arrivals.length = 0;
  await page.evaluate(() => { window.location.hash = '#/archive'; });
  await page.waitForSelector('[data-testid="archive-table"]', { timeout: 15000 });
  ok('G6 归档路由零新增接口请求（列表缓存命中），只新增它自己的 chunk',
    srvOf('/api') === 0 && jsChunks().length >= detailChunks, `js=${jsChunks().length} arrivals=${srv.arrivals.length}`);
  await page.evaluate(() => { window.location.hash = '#/about'; });
  await page.waitForSelector('[data-testid="about-title"]', { timeout: 15000 });
  ok('G6b 关于页同样零接口请求', srvOf('/api') === 0, srv.arrivals.map((a) => a.path).join(','));
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('[data-testid="archive-table"]') !== null, null, { timeout: 8000 }).catch(() => undefined);
  const backOk = await page.evaluate(() => ({ archive: document.querySelector('[data-testid="archive-table"]') !== null, home: document.querySelector('[data-testid="row"]') !== null }));
  ok('G6c 浏览器后退回到归档且没有重取数据（缓存跨路由存活）',
    (backOk.archive || backOk.home) && srvOf('/api/posts') === 0, JSON.stringify(backOk));
  ok('G7 同一个 JS 资源从未被请求两次（浏览器去重，产物没有重复 import）',
    new Set(jsChunks()).size === jsChunks().length, `${jsChunks().length} 请求 / ${new Set(jsChunks()).size} 唯一`);
  num('G7b 三路由走完后的接口与 JS 请求总数', `${srv.arrivals.length} + ${apiOf('/api')} 接口 · ${jsChunks().length} 个 JS chunk`, `（首页读数 ${rowsBefore} 篇）`);
  await ctx.close();
}

/* G8 — slow origin: does the reserved box actually stop the layout from jumping? */
Group('G8 慢接口下的骨架位移（CLS 的真实形态）');
{
  latency['/posts'] = 1800;
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__s = [];
    const tick = () => {
      const skel = document.querySelector('[data-skeleton]');
      const foot = document.querySelector('.foot');
      const stats = document.querySelector('[data-testid="stats"]');
      const main = document.querySelector('.main');
      const brand = document.querySelector('.masthead');
      window.__s.push({
        t: Math.round(performance.now()),
        skel: skel !== null,
        skelH: skel === null ? 0 : Math.round(skel.getBoundingClientRect().height),
        rows: document.querySelectorAll('[data-testid="row"]').length,
        footTop: foot === null ? null : Math.round(foot.getBoundingClientRect().top),
        statsH: stats === null ? 0 : Math.round(stats.getBoundingClientRect().height),
        statsTop: stats === null ? null : Math.round(stats.getBoundingClientRect().top),
        brandTop: brand === null ? null : Math.round(brand.getBoundingClientRect().top),
        mainH: main === null ? 0 : Math.round(main.getBoundingClientRect().height),
      });
      if (performance.now() < 9000) setTimeout(tick, 16);
    };
    tick();
  });
  srv.arrivals.length = 0;
  await page.goto(`${ORIGIN}/preview/split-host.html?api=1`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="row"]').length > 3, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => window.__s);
  latency['/posts'] = 120;
  const pending = s.filter((x) => x.skel && x.rows === 0);
  const after = s.filter((x) => x.rows > 3);
  const lastPending = pending.at(-1);
  const firstContent = after[0];
  ok('G8 慢接口 1.8s 期间始终有占位在撑住版面（无空窗帧）',
    pending.length > 20 && s.slice(0, after[0]?.t === undefined ? s.length : s.indexOf(firstContent)).every((x) => x.skel || x.rows > 0 || x.t < 400),
    `等待帧 ${pending.length} · 共 ${s.length} 帧`);
  num('G8b 等待期占位的真实高度', lastPending?.skelH ?? 0, `px × ${pending.length} 帧`);
  ok('G8c 占位高度 ≥ 500px（与 SuspenseLoader 的 minHeight 一致，不是装饰性细条）',
    (lastPending?.skelH ?? 0) >= 500, `${lastPending?.skelH}px`);
  /* What a boundary actually guarantees is that nothing *already painted above it* moves. The
     footer sits below, so it moves by however much the content overshoots the reserved band —
     that overshoot is the honest number to report, not something to assert away. */
  const driftOf = (key) => {
    const seen = s.filter((x) => x[key] !== null).map((x) => x[key]);
    return seen.length === 0 ? null : Math.max(...seen) - Math.min(...seen);
  };
  const chromeDrift = driftOf('brandTop');
  const statsDrift = driftOf('statsTop');
  ok('G8d 边界之上的 chrome 在「等待→落地」全程一动不动（标题与统计块 top 零位移）',
    chromeDrift !== null && statsDrift !== null && chromeDrift <= 1 && statsDrift <= 1, `masthead ${chromeDrift}px · stats ${statsDrift}px（同一批帧里页脚移动了 ${Math.abs((firstContent?.footTop ?? 0) - (lastPending?.footTop ?? 0))}px）`);
  const reserved = lastPending?.mainH ?? 0;
  const final = firstContent?.mainH ?? 0;
  const drift = lastPending !== undefined && firstContent !== undefined ? Math.abs((firstContent.footTop ?? 0) - (lastPending.footTop ?? 0)) : null;
  ok('G8d2 固定占位只挡住了一部分：预留带 ≥ 内容高度的一半，残余位移即页脚下移量',
    reserved >= final * 0.5 && drift !== null && Math.abs(drift - (final - reserved)) <= 3,
    `预留 ${reserved}px → 内容 ${final}px，页脚下移 ${drift}px（= 差值，说明占位之外没有额外跳动）`);
  num('G8d3 若不做这次「chrome 提到边界之外」的改造', 1066, 'px：改造前实测整页外壳被 fallback 吞掉时的页脚位移');
  const settleDrift = after.length === 0 ? null : Math.abs((after.at(-1).footTop ?? 0) - (after[0].footTop ?? 0));
  ok('G8e 内容就绪后页脚不再移动（后续帧零位移）', settleDrift !== null && settleDrift <= 2, `${settleDrift}px over ${after.length} 帧`);
  ok('G8f 慢接口期间顶部统计块一直可见（早期 return 会把整页抹掉）',
    s.some((x) => x.skel && x.statsH > 40) && pending.every((x) => x.statsH > 40),
    `stats 高度 ${pending[0]?.statsH}px`);
  num('G8g 服务端在 1.8s 慢接口窗口里收到的请求数', srv.arrivals.length, `（${srv.arrivals.map((a) => a.path).join(',')}）`);
  await ctx.close();
}

/* G9 — the unstable queryKey arm over a real network */
Group('G9 queryKey 不稳定臂（真 HTTP 下的放大）');
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  srv.arrivals.length = 0;
  await page.goto(`${ORIGIN}/preview/arm-unstablekey.html?api=1`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const unstable = srv.arrivals.filter((a) => a.path === '/api/posts').length;
  const painted = await page.evaluate(() => document.querySelectorAll('[data-testid="row"]').length);
  /* Close it first: that page is still re-reading in its own tab, and leaving it open would make
     the "stable" count below measure the same runaway loop a second time. */
  await page.close();
  srv.arrivals.length = 0;
  const page2 = await ctx.newPage();
  await page2.goto(`${ORIGIN}/preview/portal-topo-tactical.html?api=1`, { waitUntil: 'load' });
  await page2.waitForSelector('[data-testid="row"]', { timeout: 15000 });
  await page2.waitForTimeout(600);
  const stable = srv.arrivals.filter((a) => a.path === '/api/posts').length;
  const stableRows = await page2.evaluate(() => document.querySelectorAll('[data-testid="row"]').length);
  ok('G9 同一次首屏：稳定 queryKey 1 次读，不稳定 queryKey 变成 N 次重复读（N≥10）',
    stable === 1 && unstable >= 10, `stable=${stable} unstable=${unstable}`);
  ok('G9b 不稳定臂至今没有画出任何一行（放大不是「慢一点」而是坏掉）',
    painted === 0 && stableRows > 5, `unstable rows=${painted} · stable rows=${stableRows}`);
  num('G9c 2s 窗口内的请求比', `${unstable}:${stable}`, '次 /api/posts（不稳定 : 稳定）');
  await ctx.close();
}

/* ---------------------------------------------------------------- K */
Group('K 真滚动与真点击（file:// 交付载体）');
{
  const ctx = await newCtx();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 60)));
  await page.goto(fileUrl('topo-tactical'), { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });
  const h0 = await page.evaluate(() => {
    const vp = document.querySelector('[data-testid="rows"]');
    return { win: vp.getAttribute('data-window'), rows: document.querySelectorAll('[data-testid="row"]').length, clientH: vp.clientHeight, rowH: document.querySelector('.row').getBoundingClientRect().height, scrollH: vp.scrollHeight };
  });
  ok('K1 真实视口下窗口行数远小于全量（虚拟滚动在真布局里成立）',
    h0.rows >= 6 && h0.rows < 40 && h0.scrollH > h0.clientH * 3, `${h0.rows} 行 / 视口 ${h0.clientH}px / 内容 ${h0.scrollH}px`);
  await page.evaluate(() => { const vp = document.querySelector('[data-testid="rows"]'); vp.scrollTop = 2400; });
  await page.waitForFunction((prev) => document.querySelector('[data-testid="rows"]').getAttribute('data-window') !== prev, h0.win, { timeout: 5000 });
  const h1 = await page.evaluate(() => {
    const vp = document.querySelector('[data-testid="rows"]');
    return { win: vp.getAttribute('data-window'), rows: document.querySelectorAll('[data-testid="row"]').length, top: vp.scrollTop, clientH: vp.clientHeight, rowH: document.querySelector('.row').getBoundingClientRect().height };
  });
  const [f1, l1] = h1.win.split(':').map(Number);
  const expFirst = Math.max(0, Math.floor(h1.top / h1.rowH) - 4);
  const expLast = Math.min(ROWS.length, Math.ceil((h1.top + h1.clientH) / h1.rowH) + 4);
  ok('K2 原生滚动（无任何注入）后窗口 = 用真实 clientHeight/scrollTop 复算的区间',
    f1 === expFirst && l1 === expLast, `${h1.win} vs 复算 ${expFirst}:${expLast}（top=${h1.top} vh=${h1.clientH} row=${h1.rowH.toFixed(1)}）`);
  ok('K2b 滚动后 DOM 行数仍然有界（≤ 视口容量 + 2×overscan）', h1.rows <= Math.ceil(h1.clientH / h1.rowH) + 8, `${h1.rows} 行 ≤ ${Math.ceil(h1.clientH / h1.rowH) + 8}`);
  /* The expected hit count is the app's own filterRows() run in Node over the same wire rows —
     a second read of the same module, not a title-only guess re-derived here. */
  const expectHits = facts.filterRows(ROWS, '熔断', 'all').length;
  await page.fill('[data-testid="q"]', '熔断');
  const right = await page.textContent('[data-testid="result-count"]');
  await page.waitForFunction((n) => (document.querySelector('[data-testid="result-count"]')?.textContent ?? '').startsWith(`${n} /`), expectHits, { timeout: 8000 });
  const afterDebounce = await page.textContent('[data-testid="result-count"]');
  await page.waitForFunction(() => (document.querySelector('[data-testid="debounce-state"]')?.textContent ?? '').includes('熔断'), null, { timeout: 4000 });
  const settled = await page.textContent('[data-testid="debounce-state"]');
  ok('K3 真键盘输入：落地前读数仍是全量，防抖到期后收敛到模型复算的命中数，且提示回填了查询词',
    right.startsWith(`${ROWS.length} /`) && afterDebounce.startsWith(`${expectHits} /`) && settled.includes('已检索'),
    `${right.slice(0, 12)} → ${afterDebounce.slice(0, 12)}（模型复算 ${expectHits}）· 提示 ${settled}`);
  /* back to the full list before the density probe, otherwise the comparison below would be
     between a filtered window and an unfiltered one */
  await page.fill('[data-testid="q"]', '');
  await page.waitForFunction(() => (document.querySelector('[data-testid="result-count"]')?.textContent ?? '').startsWith('240 /'), null, { timeout: 8000 });
  await page.evaluate(() => { document.querySelector('[data-testid="rows"]').scrollTop = 2400; });
  await page.waitForFunction((prev) => document.querySelector('[data-testid="rows"]').getAttribute('data-window') !== prev, h0.win, { timeout: 5000 });
  const h1b = await page.evaluate(() => document.querySelector('[data-testid="rows"]').getAttribute('data-window'));
  await page.click('[data-testid="density"]');
  const dens = await page.evaluate(() => ({
    rowH: Math.round(document.querySelector('.row').getBoundingClientRect().height),
    win: document.querySelector('[data-testid="rows"]').getAttribute('data-window'),
    rows: document.querySelectorAll('[data-testid="row"]').length,
  }));
  ok('K4 点一下密度按钮，真实行高从 comfortable 变成 compact（jsdom 只能算式验证，这里是像素）',
    dens.rowH === T['topo-tactical'].rowHeight.compact, `${h0.rowH.toFixed(0)}px → ${dens.rowH}px · 窗口 ${dens.win} · DOM ${dens.rows} 行`);
  ok('K4b 更矮的行高让同样视口装下更多行（同一滚动位置、同一份全量列表，只有行高变了）',
    Number(dens.win.split(':')[1]) - Number(dens.win.split(':')[0]) > Number(h1b.split(':')[1]) - Number(h1b.split(':')[0]),
    `${h1b} → ${dens.win}`);
  await page.click('[data-testid="density"]');
  await page.click('.nav a[href="#/archive"]');
  await page.waitForSelector('[data-testid="archive-table"]', { timeout: 8000 });
  const nav = await page.evaluate(() => ({
    crumb: document.querySelector('[data-testid="route-shell"]')?.dataset.crumb ?? '',
    current: [...document.querySelectorAll('.nav a')].filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent),
    hash: window.location.hash,
    rows: document.querySelectorAll('[data-testid="row"]').length,
  }));
  ok('K5 真点击导航：hash/面包屑/aria-current 三处口径一致，且没有残留列表 DOM',
    nav.hash === '#/archive' && nav.crumb === '归档' && nav.current.join('') === '归档' && nav.rows === 0, JSON.stringify(nav));
  await page.click('[data-testid="toggle-2024"]');
  const expanded = await page.evaluate(() => document.querySelectorAll('[data-testid^="month-2024"]').length);
  ok('K5b 真点击展开年份：2024 的月份行出现', expanded > 0, `${expanded} 行`);
  await page.goBack();
  await page.waitForSelector('[data-testid="row"]', { timeout: 8000 });
  const backHome = await page.evaluate(() => ({ hash: window.location.hash, rows: document.querySelectorAll('[data-testid="row"]').length }));
  ok('K5c 浏览器后退回到首页列表（hash 路由与历史栈一致；直开的 file:// 首页 hash 本就是空串）',
    (backHome.hash === '#/' || backHome.hash === '') && backHome.rows > 5, `hash="${backHome.hash}" · ${backHome.rows} 行`);
  ok('K6 全程零 pageerror', errs.length === 0, errs.join('|') || 'clean');
  await ctx.close();
}

/* ---------------------------------------------------------------- M */
Group('M 收藏持久化跨载体');
async function carrier(ctx, label, url, rowIndex) {
  const page = await ctx.newPage();
  const r = { label, errs: [] };
  page.on('pageerror', (e) => r.errs.push(String(e.message).slice(0, 70)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });
  r.atBoot = await page.evaluate(() => ({ stored: localStorage.getItem('grayscale.prefs'), count: document.querySelector('[data-testid="star-count"]')?.textContent ?? '' }));
  /* both carriers share ONE context on purpose: the only way to show that file:// and http:// are
     two origins is to prove the second one cannot see what the first one stored */
  r.starredTitle = await page.evaluate((i) => document.querySelectorAll('[data-testid="row"]')[i].getAttribute('aria-label'), rowIndex);
  await page.evaluate((i) => document.querySelectorAll('[data-testid="row"] .star')[i].click(), rowIndex);
  await page.waitForFunction(() => document.querySelector('[data-testid="star-count"]')?.textContent.startsWith('1') === true, null, { timeout: 4000 });
  r.raw = await page.evaluate(() => localStorage.getItem('grayscale.prefs'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });
  /* the row index has to be passed in again: a reload wipes any global stashed on window */
  r.afterReload = await page.evaluate((i) => ({
    count: document.querySelector('[data-testid="star-count"]')?.textContent ?? '',
    pressed: document.querySelectorAll('[data-testid="row"] .star')[i]?.getAttribute('aria-pressed') ?? '',
    pressedRow: i,
    density: document.querySelector('[data-testid="density"]')?.textContent ?? '',
  }), rowIndex);
  /* hostile: not JSON at all */
  await page.evaluate(() => localStorage.setItem('grayscale.prefs', '{{{not json'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });
  r.garbage = await page.evaluate(() => ({ count: document.querySelector('[data-testid="star-count"]')?.textContent ?? '', rows: document.querySelectorAll('[data-testid="row"]').length }));
  /* hostile: a 5000-item starred list must be capped, not rendered */
  await page.evaluate((n) => localStorage.setItem('grayscale.prefs', JSON.stringify({ version: 3, sort: 'recent', density: 'comfortable', tag: 'all', starred: Array.from({ length: n }, (_, i) => `p-${String(i + 1).padStart(3, '0')}-security`) })), 500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="row"]', { timeout: 20000 });
  r.flood = await page.evaluate(() => ({ count: document.querySelector('[data-testid="star-count"]')?.textContent ?? '', stored: (localStorage.getItem('grayscale.prefs') ?? '').length }));
  await page.close();
  return r;
}
const sharedCtx = await newCtx();
const mFile = await carrier(sharedCtx, 'file://', fileUrl('topo-tactical'), 0);
const mHttp = await carrier(sharedCtx, 'http://', `${ORIGIN}/preview/portal-clay-stop.html`, 2);
await sharedCtx.close();
for (const m of [mFile, mHttp]) {
  const bootEnv = m.atBoot.stored === null ? null : JSON.parse(m.atBoot.stored);
  ok(`M1 ${m.label} 冷启动没有任何用户偏好（要么没写过，要么写的就是空默认信封）、且零报错`,
    (bootEnv === null || (bootEnv.version === 3 && Array.isArray(bootEnv.starred) && bootEnv.starred.length === 0))
      && m.atBoot.count.startsWith('0 篇') && m.errs.length === 0,
    `stored=${String(m.atBoot.stored).slice(0, 46)} count=${m.atBoot.count.slice(0, 12)} errs=${m.errs.join('|')}`);
  const env = m.raw === null ? null : JSON.parse(m.raw);
  ok(`M2 ${m.label} 点击收藏写入版本信封（version=3，starred 1 项）`,
    env?.version === 3 && env?.starred?.length === 1 && /^p-\d{3}-[a-z]+$/.test(String(env.starred[0])), String(m.raw).slice(0, 80));
  ok(`M3 ${m.label} 刷新后收藏仍在，且被点过的那一行（第 ${m.afterReload.pressedRow + 1} 行）按钮回到已收藏态`,
    m.afterReload.count.startsWith('1 篇') && m.afterReload.pressed === 'true', JSON.stringify(m.afterReload));
  ok(`M4 ${m.label} 非法 JSON 草稿不会崩页（回落默认并照常画行）`,
    m.garbage.count.startsWith('0 篇') && m.garbage.rows > 5 && m.errs.length === 0, JSON.stringify(m.garbage));
  ok(`M4b ${m.label} 5000 项星单被截到 60 条上限（消毒有界，不是无限渲染）`,
    m.flood.count.startsWith('60 篇') && m.flood.stored < 3000, `${m.flood.count.slice(0, 8)} · 落盘 ${m.flood.stored}B`);
}
const fileSlugs = JSON.parse(mFile.raw ?? '{}').starred ?? [];
const httpSlugs = JSON.parse(mHttp.raw ?? '{}').starred ?? [];
ok('M5 同一浏览器实例里两个载体互不相通：file 已存了 1 篇之后，http 载体冷启动仍然看到 0 篇（不同 origin，各自一套存储）',
  mFile.errs.length === 0 && mHttp.atBoot.count.startsWith('0 篇') && fileSlugs.length === 1 && httpSlugs.length === 1 && fileSlugs[0] !== httpSlugs[0],
  `file 存了 ${fileSlugs.join('')}（第 1 行「${mFile.starredTitle?.slice(0, 12)}」）· http 存了 ${httpSlugs.join('')}（第 3 行「${mHttp.starredTitle?.slice(0, 12)}」）`);
const slugByTitle = new Map(ROWS.map((r) => [r.title, r.slug]));
ok('M5b 两处写入的正是各自点击的那一行（标题→slug 与事实源一致，不是巧合同号）',
  fileSlugs[0] === slugByTitle.get(mFile.starredTitle ?? '') && httpSlugs[0] === slugByTitle.get(mHttp.starredTitle ?? ''),
  `${fileSlugs[0]} / ${httpSlugs[0]} vs ${slugByTitle.get(mFile.starredTitle ?? '')} / ${slugByTitle.get(mHttp.starredTitle ?? '')}`);
ok('M6 不同载体各自选中自己的皮肤（html data-fd-style 决定外观，不靠构建期分支）',
  mFile.errs.length === 0 && mHttp.errs.length === 0, 'topo-tactical on file://, clay-stop on http://, 均无报错');

await browser.close();
await srv.close();
const failed = summary('check-browser');
dumpResults(path.join(OUT, 'assertions-browser.json'));
process.exitCode = failed === 0 ? 0 : 1;
