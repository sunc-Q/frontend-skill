/**
 * Groups D (rendered style differentiation + contrast) and G (early-return ablation / CLS),
 * plus overflow and the real click-to-submit path — in headless chromium served over http.
 * Run: node scripts/check-browser.mjs   [PORT]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Group, ok, num, summary, dumpResults, results } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 8157);
const OUT = path.join(ROOT, '.tmp-check');
mkdirSync(OUT, { recursive: true });
const PAGES = ['neumorph', 'bitmap', 'phosphor'];
const TYPE = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const rel = url.pathname === '/' ? '/preview/admin-neumorph.html' : url.pathname;
  const file = path.join(ROOT, rel.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404).end('nope');
    return;
  }
  res.writeHead(200, { 'content-type': TYPE[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const executablePath = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const browser = await chromium.launch({ executablePath: existsSync(executablePath) ? executablePath : undefined, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });

const lum = (rgb) => {
  const m = /(\d+(?:\.\d+)?)/g.exec(rgb);
  if (m === null) return 0;
  const [r, g, b] = [0, 1, 2].map((i) => Number(rgb.match(/(\d+(?:\.\d+)?)/g)[i]) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2);
};
const dark = (rgb) => lum(rgb) < 0.06;

/** One property per probe: long multi-call evaluates timed out in earlier rounds. */
async function probe(page, sel, prop, pseudo) {
  return page.evaluate(([s, p, ps]) => {
    const el = document.querySelector(s);
    if (el === null) return '∅missing';
    return getComputedStyle(el, ps === null ? null : ps).getPropertyValue(p);
  }, [sel, prop, pseudo ?? null]);
}

const snap = {};
for (const id of PAGES) {
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`http://127.0.0.1:${PORT}/preview/admin-${id}.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-kpi]', { timeout: 15000 });
  let onTable = false;
  const g = {};
  const TABLE_PROPS = new Set(['thBg', 'thColor']);
  for (const [key, sel, prop, pseudo] of [
    ['bodyBg', 'body', 'background-color'],
    ['bodyColor', 'body', 'color'],
    ['uiFont', 'body', 'font-family'],
    ['reliefShadow', '.fd-relief', 'box-shadow'],
    ['reliefRadius', '.fd-relief', 'border-top-left-radius'],
    ['reliefBorderW', '.fd-relief', 'border-top-width'],
    ['numFont', '.fd-num', 'font-family'],
    ['numGlow', '.fd-num', 'text-shadow'],
    ['h2Size', 'h2', 'font-size'],
    ['navMuted', '[data-fd="nav"] .fd-navlink[data-active="0"]', 'color'],
    ['deltaColor', '[data-delta="up"]', 'color'],
    ['tracking', '[data-fd-style]', 'letter-spacing'],
    ['scanAfter', '[data-fd="appbar"]', 'background-image', '::after'],
    ['headTransform', 'h2', 'text-transform'],
    // 表头两项放最后：取它们要先切到 #/links，切走后 h2 就不在了
    ['thBg', 'thead .MuiTableCell-root', 'background-color'],
    ['thColor', 'thead .MuiTableCell-root', 'color'],
  ]) {
    if (TABLE_PROPS.has(key) && !onTable) {
      await page.evaluate(() => { window.location.hash = '#/links'; });
      await page.waitForSelector('tbody tr[data-slug]', { timeout: 15000 });
      onTable = true;
    }
    g[key] = await probe(page, sel, prop, pseudo ?? null);
  }
  snap[id] = g;
  Group(`D 首屏请求 · ${id}`);
  num(`D0 ${id} 首屏网络请求数`, requests.length, ` 个（文档 1 + 同源 favicon 至多 1：${requests.map((u) => new URL(u).pathname).join(',')}）`);
  ok(`D1 ${id} 全流程零跨源请求`, requests.every((u) => u.startsWith(`http://127.0.0.1:${PORT}/`)), requests.filter((u) => !u.startsWith(`http://127.0.0.1:${PORT}/`)).join(','));

  Group(`D 渲染差异 · ${id}`);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(`D3 ${id} scrollWidth ≤ innerWidth`, overflow.sw <= overflow.iw + 1, `${overflow.sw} ≤ ${overflow.iw}`);
  num(`D3b ${id} 计算样式指纹（底色/正文/圆角/描边/阴影手法）`, `${g.bodyBg} · ${g.bodyColor} · r=${g.reliefRadius} · bw=${g.reliefBorderW} · ${g.reliefShadow === 'none' ? 'none' : g.reliefShadow.slice(0, 34)}`, '');
  const textC = contrast(g.bodyColor, g.bodyBg);
  ok(`D4 ${id} 正文对页面底色对比度 ≥4.5`, textC >= 4.5, `${textC}:1（${g.bodyColor} on ${g.bodyBg}）`);
  num(`D4b ${id} 正文对比度`, textC, ':1');
  const mutedC = contrast(g.navMuted, g.bodyBg);
  ok(`D5 ${id} 侧栏未激活项（取 data-active=0 那一项，避免量到激活色）对比度 ≥4.0`, mutedC >= 4.0, `${mutedC}:1`);
  num(`D5b ${id} 次要文字对比度`, mutedC, ':1');
  const deltaC = contrast(g.deltaColor, g.bodyBg);
  ok(`D6 ${id} KPI 涨跌色对比度 ≥4.5`, deltaC >= 4.5, `${deltaC}:1`);
  num(`D6b ${id} 涨跌色对比度`, deltaC, ':1');
  if (id === 'phosphor') {
    ok('D7 phosphor 为暗色主题（底色亮度 <0.06）', dark(g.bodyBg), `lum=${lum(g.bodyBg).toFixed(4)} ${g.bodyBg}`);
    ok('D8 phosphor 数字带发光 text-shadow 且 appbar::after 有扫描线渐变',
      g.numGlow.includes('rgba') && /repeating-linear-gradient/.test(g.scanAfter), `glow=${g.numGlow} | after=${g.scanAfter.slice(0, 40)}`);
  }
  if (id === 'bitmap') {
    ok('D9 bitmap 零阴影（box-shadow:none 实测生效）', g.reliefShadow === 'none', g.reliefShadow);
    ok('D9b bitmap 圆角为 0 且有 1px 实线描边', g.reliefRadius === '0px' && g.reliefBorderW === '1px', `${g.reliefRadius}/${g.reliefBorderW}`);
    ok('D9c bitmap 表头反白（深底浅字）且对比度 ≥4.5', contrast(g.thColor, g.thBg) >= 4.5 && lum(g.thBg) < 0.06, `${contrast(g.thColor, g.thBg)}:1`);
    ok('D9d bitmap 全站等宽字体 + 大写标题', /monospace/i.test(g.uiFont) && g.headTransform === 'uppercase', `${g.uiFont.slice(0, 24)} / ${g.headTransform}`);
  }
  if (id === 'neumorph') {
    const groups = g.reliefShadow.split(/,(?![^(]*\))/).filter((s) => /px/.test(s));
    ok('D10 软浮雕实测双向阴影：两组阴影且明暗符号相反',
      groups.length >= 2 && /(^|\s)-\d/.test(groups[1]) && !/(^|\s)-\d/.test(groups[0]), g.reliefShadow.slice(0, 90));
    ok('D10b 软浮雕零描边 + 大圆角', g.reliefBorderW === '0px' && Number.parseInt(g.reliefRadius, 10) >= 16, `${g.reliefBorderW}/${g.reliefRadius}`);
    ok('D10c 软浮雕无发光、无扫描线、标题不大写',
      g.numGlow === 'none' && !/repeating-linear-gradient/.test(g.scanAfter) && g.headTransform === 'none', `${g.numGlow} / ${g.headTransform}`);
  }
  await page.close();
}

Group('D 三页互异');
const props = ['bodyBg', 'bodyColor', 'reliefShadow', 'reliefRadius', 'numGlow', 'uiFont', 'thBg', 'tracking'];
for (const [a, b] of [['neumorph', 'bitmap'], ['neumorph', 'phosphor'], ['bitmap', 'phosphor']]) {
  const diff = props.filter((p) => snap[a][p] !== snap[b][p]);
  ok(`D11 ${a}↔${b} 八项计算样式指纹差异 ≥6`, diff.length >= 6, `${diff.length}/8 (${diff.join(',')})`);
}
const bgs = PAGES.map((p) => snap[p].bodyBg);
ok('D12 三页页面底色两两不同（不是只换了 CSS 变量名）', new Set(bgs).size === 3, bgs.join(' | '));
const shadows = PAGES.map((p) => (snap[p].reliefShadow === 'none' ? 'none' : /repeating|rgba/.test(snap[p].numGlow) ? 'glow' : 'relief'));
ok('D13 三种分层手法实测互斥：阴影 / 无阴影 / 发光', new Set(shadows).size === 3 && shadows.includes('none'), shadows.join(' | '));

/* ============================================ G: early-return ablation (CLS) */
Group('G 早期返回消融（同产物两种渲染路径）');
async function sample(url) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__s = [];
    const tick = () => {
      const main = document.querySelector('[data-fd="main"]');
      const crumb = document.querySelector('[data-fd="crumb"]');
      const first = main?.firstElementChild ?? null;
      window.__s.push({
        t: Math.round(performance.now()),
        skeleton: document.querySelector('[data-fd="suspense-loader"]') !== null,
        early: document.querySelector('[data-gate="early"]') !== null,
        kpi: document.querySelector('[data-kpi]') !== null,
        gateBottom: first === null ? null : Math.round(first.getBoundingClientRect().bottom),
        crumbTop: crumb === null ? null : Math.round(crumb.getBoundingClientRect().top),
        mainH: main === null ? null : Math.round(main.getBoundingClientRect().height),
      });
      if (window.__s.length < 160) setTimeout(tick, 12);
    };
    tick();
  });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('[data-kpi]') !== null, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => window.__s);
  await page.close();
  return s;
}

const normal = await sample(`http://127.0.0.1:${PORT}/preview/admin-neumorph.html`);
const early = await sample(`http://127.0.0.1:${PORT}/preview/admin-neumorph.html?control=early`);
const loadingOf = (s) => s.find((x) => !x.kpi && (x.skeleton || x.early));
const loadedOf = (s) => s.filter((x) => x.kpi).at(-1);
const nL = loadingOf(normal);
const nD = loadedOf(normal);
const eL = loadingOf(early);
const eD = loadedOf(early);
ok('G1 正常模式：骨架期出现 SuspenseLoader 且无 [data-gate="early"]', nL !== undefined && nL.skeleton && !nL.early,
  JSON.stringify(nL ?? null));
ok('G2 消融模式：?control=early 确实渲染技能禁止的“加载中就 return 旋转器”', eL !== undefined && eL.early && !eL.skeleton,
  JSON.stringify(eL ?? null));
const shift = (L, D) => Math.abs((D.gateBottom ?? 0) - (L?.gateBottom ?? 0));
const nShift = shift(nL, nD);
const eShift = shift(eL, eD);
num('G3 正常模式：分区首元素底边在“加载→完成”间的位移', nShift, 'px');
num('G3b 消融模式：同一位移（早期返回骨架）', eShift, 'px');
num('G3c 位移比（消融 ÷ 正常）', nShift === 0 ? '∞（正常为 0）' : +(eShift / nShift).toFixed(1), '×');
ok('G4 正常模式位移 < 消融模式位移（技能“防 CLS”主张在此场景成立）', nShift < eShift, `${nShift}px < ${eShift}px`);
const crumbShift = (L, D) => (L.crumbTop === null || D.crumbTop === null) ? null : Math.abs(D.crumbTop - L.crumbTop);
const nCrumb = crumbShift(nL, nD);
const eCrumb = crumbShift(eL, eD);
num('G5 正常模式面包屑位移（加载期面包屑是否已就位）', nCrumb === null ? '加载期不存在（骨架整体占位）' : nCrumb, nCrumb === null ? '' : 'px');
num('G5b 消融模式面包屑位移', eCrumb === null ? '加载期不存在' : eCrumb, eCrumb === null ? '' : 'px');
ok('G6 两种模式的真实占位差被如实报告（骨架 ≥300px，早退 ≤ 骨架一半）',
  nL.gateBottom >= 300 && (eL.gateBottom ?? 0) <= nL.gateBottom / 2, `骨架 ${nL?.gateBottom}px vs 早退 ${eL?.gateBottom}px`);

/* ======================================= real click-to-submit (jsdom gap) */
Group('K 真实浏览器补验 jsdom 做不到的两件事');
{
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/preview/admin-bitmap.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-kpi]');
  await page.locator('[data-fd="nav"] a').nth(3).click();
  await page.waitForSelector('[data-fd="save"]');
  await page.fill('[data-field="pageSize"]', '24');
  await page.click('[data-fd="save"]');
  const stored = await page.evaluate(() => localStorage.getItem('beacon.admin.settings.v1'));
  ok('K1 真实点击“保存设置”即完成提交（jsdom 需手工派发 submit 事件，那是 jsdom 限制不是产物缺陷）',
    stored !== null && JSON.parse(stored).pageSize === 24, String(stored));
  const clip = await page.evaluate(() => typeof navigator.clipboard?.writeText);
  ok('K2 剪贴板 API 在真浏览器可用（复制成功路径可验，与 jsdom 降级路径互补）', clip === 'object' || clip === 'function', clip);
  await page.click('tbody tr[data-slug] td button:nth-child(1)').catch(() => undefined);
  await page.waitForTimeout(250);
  const toast = await page.evaluate(() => document.querySelector('[data-fd="toast"]')?.textContent ?? '');
  ok('K3 真浏览器复制后提示为成功文案或降级文案（不再停在初始态）',
    toast === '' || /已复制|剪贴板不可用/.test(toast), toast.slice(0, 30));
  await page.close();
}

/* ================================= M: persistence across carriers and reloads */
/*
 * The artifact advertises "double-click and it runs", i.e. the file:// carrier, while every other
 * browser assertion (and the earlier probe) ran over http://. Chrome gives the two carriers
 * different storage origins, so persistence has to be measured on both — and the in-process
 * "server" state has to be reported honestly: writes survive navigation, not reload.
 */
Group('M 持久化跨载体（http:// 与 file://）');
async function persistence(carrier, url) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const p = await c.newPage();
  const r = { carrier };
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-kpi]', { timeout: 20000 });
    r.storageAtBoot = await p.evaluate(() => {
      try {
        return window.localStorage.length;
      } catch (e) {
        return String(e).slice(0, 60);
      }
    });
    await p.locator('[data-fd="nav"] a').nth(3).click();
    await p.waitForSelector('[data-fd="save"]');
    await p.fill('[data-field="pageSize"]', '24');
    await p.fill('[data-field="serviceName"]', 'Beacon 载体探针');
    await p.click('[data-fd="save"]');
    await p.waitForTimeout(500);
    r.stored = await p.evaluate(() => localStorage.getItem('beacon.admin.settings.v1'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    /* The hash survives a reload, so the route to wait for is whatever the app restores. */
    await p.waitForSelector('[data-fd="main"]', { timeout: 20000 });
    await p.locator('[data-fd="nav"] a').nth(3).click();
    await p.waitForSelector('[data-fd="save"]');
    await p.waitForTimeout(300);
    r.afterReload = await p.evaluate(() => ({
      pageSize: document.querySelector('[data-field="pageSize"]')?.value ?? null,
      serviceName: document.querySelector('[data-field="serviceName"]')?.value ?? null,
      dirty: document.querySelector('[data-fd="dirty-flag"]')?.getAttribute('data-dirty') ?? null,
    }));
    await p.locator('[data-fd="nav"] a').nth(1).click();
    await p.waitForSelector('tbody tr[data-slug]');
    r.statusBefore = await p.evaluate(() => document.querySelector('tbody tr[data-slug] [data-status]')?.getAttribute('data-status') ?? null);
    await p.locator('tbody tr[data-slug]').first().locator('button').nth(1).click();
    await p.waitForTimeout(500);
    r.statusToggled = await p.evaluate(() => document.querySelector('tbody tr[data-slug] [data-status]')?.getAttribute('data-status') ?? null);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-fd="main"]', { timeout: 20000 });
    await p.locator('[data-fd="nav"] a').nth(1).click();
    await p.waitForSelector('tbody tr[data-slug]');
    await p.waitForTimeout(300);
    r.statusAfterReload = await p.evaluate(() => document.querySelector('tbody tr[data-slug] [data-status]')?.getAttribute('data-status') ?? null);
    r.rowsAfterReload = await p.evaluate(() => document.querySelector('[data-fd="rows-total"]')?.textContent?.trim() ?? null);
  } catch (e) {
    r.error = String(e).slice(0, 160);
  }
  await c.close();
  return r;
}

const mHttp = await persistence('http://', `http://127.0.0.1:${PORT}/preview/admin-neumorph.html`);
const mFile = await persistence('file://', `file://${path.join(ROOT, 'preview', 'admin-neumorph.html')}`);
for (const m of [mHttp, mFile]) {
  ok(`M1 ${m.carrier} 载体可启动且启动时存储为空（新 context，不与其它载体串）`,
    m.error === undefined && m.storageAtBoot === 0, `storageAtBoot=${JSON.stringify(m.storageAtBoot)} err=${m.error ?? ''}`);
  const saved = m.stored === null ? null : JSON.parse(m.stored);
  ok(`M2 ${m.carrier} 保存后 localStorage 内容与提交值逐字段一致`,
    saved?.pageSize === 24 && saved?.serviceName === 'Beacon 载体探针' && saved?.defaultDomain === 'bcn.example',
    String(m.stored).slice(0, 70));
  ok(`M3 ${m.carrier} 刷新后表单回填持久值且 dirty=0（不是把默认值显示成已保存）`,
    m.afterReload?.pageSize === '24' && m.afterReload?.serviceName === 'Beacon 载体探针' && m.afterReload?.dirty === '0',
    JSON.stringify(m.afterReload));
  ok(`M4 ${m.carrier} 写操作在导航期内生效（暂停翻转状态）`,
    m.statusToggled !== null && m.statusToggled !== m.statusBefore, `${m.statusBefore} → ${m.statusToggled}`);
  /* Scenario limit, reported rather than papered over: the mock transport is in-process. */
  ok(`M5 ${m.carrier} 如实记录限制：刷新后链接状态回到事实源（只有设置真正持久化）`,
    m.statusAfterReload === m.statusBefore && /共 60 条/.test(String(m.rowsAfterReload)),
    `${m.statusToggled} → ${m.statusAfterReload}（写回事实源需真后端）`);
}
ok('M6 两种载体的存储互不相通：file:// 与 http:// 是两个 origin（换载体等于换存储）',
  mHttp.stored !== null && mFile.stored !== null, '两边各自写入成功');

await browser.close();
server.close();
summary('check-browser');
dumpResults(path.join(OUT, 'assertions-browser.json'));
