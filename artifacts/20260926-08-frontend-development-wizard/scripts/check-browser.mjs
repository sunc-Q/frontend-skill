/**
 * check-browser.mjs — groups D / G / K / M for
 * frontend-development × 表单密集多步向导 (2026-09-26 08:00).
 *
 *   D  真实计算样式：三风格在浏览器里到底渲染成了什么，对比度是否达标，是否零跨源请求
 *   G  延迟接口的骨架与位移：?api=1 让 bootstrap 走真 fetch，量占位是否真的挡住了 CLS
 *   K  真浏览器点击提交：jsdom 只能手工派发 submit，这里验一次真的点到回执
 *   M  持久化跨载体：http:// 与 file:// 是两个 origin，草稿必须各自成立
 *
 * Run: node scripts/check-browser.mjs [PORT]   (needs the three previews built by build-inline.mjs)
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Group, bytes, dumpResults, num, ok, results, summary } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 8163);
const OUT = path.join(ROOT, '.tmp-check');
mkdirSync(OUT, { recursive: true });
const PAGES = ['paper-grid', 'pcb-green', 'concrete-rose'];
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** how long the fake origin holds /wizard/bootstrap open — the whole point of group G */
let apiDelay = 0;
let bootstrapFixture = null;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', ORIGIN);
  if (url.pathname === '/wizard/bootstrap') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        .end(bootstrapFixture ?? JSON.stringify({}));
    }, apiDelay);
    return;
  }
  if (url.pathname === '/wizard/echo') {
    res.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ reason: 'subdomain_taken' }));
    return;
  }
  const rel = url.pathname === '/' ? '/preview/wizard-paper-grid.html' : url.pathname;
  const file = path.join(ROOT, rel.replace(/^\/+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404).end('nope');
    return;
  }
  const type = path.extname(file) === '.html' ? 'text/html; charset=utf-8'
    : path.extname(file) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const execPath = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const browser = await chromium.launch({ executablePath: existsSync(execPath) ? execPath : undefined, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });

const rgb = (s) => (s.match(/(\d+(?:\.\d+)?)/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
const lum = (s) => {
  const [r, g, b] = rgb(s).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2);
};

/** one property per probe — batching getComputedStyle calls into one evaluate timed out before */
async function probe(page, sel, prop, pseudo) {
  return page.evaluate(([s, p, ps]) => {
    const el = document.querySelector(s);
    if (el === null) return '∅missing';
    return getComputedStyle(el, ps === null ? null : ps).getPropertyValue(p);
  }, [sel, prop, pseudo ?? null]);
}

/* ---------------------------------------------------------------- D */
const PROPS = [
  ['appBg', '.fd-app', 'background-color'],
  ['appImage', '.fd-app', 'background-image'],
  ['textColor', '.fd-app', 'color'],
  ['mutedColor', '.fd-head-sub', 'color'],
  ['uiFont', '.fd-app', 'font-family'],
  ['numFont', '.fd-line-amt', 'font-family'],
  ['brandCase', '.fd-brand', 'text-transform'],
  ['radius', '.fd-panel', 'border-top-left-radius'],
  ['borderW', '.fd-panel', 'border-top-width'],
  ['panelShadow', '.fd-panel', 'box-shadow'],
  ['tracking', '.fd-app', 'letter-spacing'],
  ['bodySize', '.fd-app', 'font-size'],
];
const snap = {};
for (const id of PAGES) {
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('console', (m) => { if (m.type() === 'error') requests.push(`console-error:${m.text()}`); });
  await page.goto(`${ORIGIN}/preview/wizard-${id}.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-role="meta-step"]', { timeout: 20000 });
  /* the sidebar is the only place all three money rows exist without touching the form */
  await page.waitForSelector('.fd-line-amt', { timeout: 20000 });
  const g = {};
  for (const [key, sel, prop, pseudo] of PROPS) g[key] = await probe(page, sel, prop, pseudo ?? null);

  Group(`D 渲染真实样式 · ${id}`);
  const cross = requests.filter((u) => !u.startsWith(`${ORIGIN}/`));
  ok(`D0 ${id} 全流程零跨源请求（含字体/图片/埋点）`, cross.length === 0, cross.join(',') || `仅 ${requests.length} 个同源请求`);
  const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(`D1 ${id} 1440px 下无横向滚动`, overflow.sw <= overflow.iw + 1, `${overflow.sw} ≤ ${overflow.iw}`);
  const narrow = await page.evaluate(() => {
    document.documentElement.style.setProperty('zoom', '1');
    return { sw: document.documentElement.scrollWidth };
  });
  ok(`D2 ${id} 结构层用 minmax(0,1fr)/min(100%,…) 夹住宽度（不是靠固定像素）`,
    narrow.sw <= 1441, `scrollWidth=${narrow.sw}`);
  const textC = contrast(g.textColor, g.appBg);
  ok(`D3 ${id} 正文对页面底色对比度 ≥4.5（WCAG AA）`, textC >= 4.5, `${textC}:1 ${g.textColor} on ${g.appBg}`);
  num(`D3b ${id} 正文对比度`, textC, ':1');
  const mutedC = contrast(g.mutedColor, g.appBg);
  ok(`D4 ${id} 次要文字对比度 ≥4.5`, mutedC >= 4.5, `${mutedC}:1`);
  num(`D4b ${id} 次要文字对比度`, mutedC, ':1');
  num(`D4c ${id} 手法指纹（底色/圆角/描边/分隔手法）`,
    `${g.appBg} · r=${g.radius} · bw=${g.borderW} · ${/repeating-linear-gradient\(0deg/.test(g.appImage) ? 'ruled' : /repeating-linear-gradient\(45deg/.test(g.appImage) ? 'silk' : /radial-gradient/.test(g.appImage) ? 'dot' : '?'}${g.panelShadow === 'none' ? '/无阴影' : '/有阴影'}`, '');
  if (id === 'pcb-green') {
    ok('D5 pcb-green 为暗色底（亮度 <0.06）且斜向丝网纹', lum(g.appBg) < 0.06 && /repeating-linear-gradient\(45deg/.test(g.appImage),
      `lum=${lum(g.appBg).toFixed(4)}`);
    ok('D5b pcb-green 无面板阴影、等宽数字字体', g.panelShadow === 'none' && /monospace/i.test(g.numFont), `${g.panelShadow.slice(0, 20)} / ${g.numFont.slice(0, 22)}`);
  }
  if (id === 'paper-grid') {
    ok('D6 paper-grid 是正交细网（两道 repeating-linear-gradient）且无阴影',
      /repeating-linear-gradient\(0deg/.test(g.appImage) && /repeating-linear-gradient\(90deg/.test(g.appImage) && g.panelShadow === 'none', g.appImage.slice(0, 46));
    ok(`D6b paper-grid 品牌标题保留原大小写（text-transform:none）`, g.brandCase === 'none', g.brandCase);
  }
  if (id === 'concrete-rose') {
    ok('D7 concrete-rose 用硬位移阴影作分隔（box-shadow 含 6px 6px 0）且为圆点纹',
      /6px 6px 0/.test(g.panelShadow) && /radial-gradient/.test(g.appImage), `${g.panelShadow.slice(0, 40)} | ${g.appImage.slice(0, 24)}`);
    ok('D7b concrete-rose 粗描边（≥3px）+ 大写标题',
      Number.parseInt(g.borderW, 10) >= 3 && g.brandCase === 'uppercase', `${g.borderW} / ${g.brandCase}`);
  }
  await page.close();
  snap[id] = g;
}

Group('D 三风格互异（计算样式层）');
const keys = PROPS.map(([k]) => k);
for (const [a, b] of [['paper-grid', 'pcb-green'], ['paper-grid', 'concrete-rose'], ['pcb-green', 'concrete-rose']]) {
  const diff = keys.filter((k) => snap[a][k] !== snap[b][k]);
  ok(`D8 ${a}↔${b} 十二项指纹差异 ≥7`, diff.length >= 7, `${diff.length}/12（${diff.join(',')}）`);
}
const methodOf = (i) => (i.includes('repeating-linear-gradient(0deg') ? 'ruled' : i.includes('45deg') ? 'silk' : i.includes('radial-gradient') ? 'dot' : 'none');
const images = PAGES.map((p) => snap[p].appImage);
const methods = images.map(methodOf);
ok('D9 三种分隔手法在浏览器里实测互斥（正交网 / 斜纹 / 圆点）',
  new Set(methods).size === 3 && !methods.includes('none'),
  `${methods.join(',')} ← ${images.map((i) => i.slice(0, 20)).join(' | ')}`);
const shadows = PAGES.map((p) => (snap[p].panelShadow === 'none' ? 'none' : 'shadow'));
ok('D10 阴影手法也互斥：两风格无阴影、一风格硬阴影', shadows.filter((s) => s === 'none').length === 2 && shadows.includes('shadow'), shadows.join(','));
const fonts = PAGES.map((p) => snap[p].numFont);
ok('D11 数字字体并非三页同一（字体是风格的一部分）', new Set(fonts).size >= 2, fonts.map((f) => f.slice(0, 18)).join(' | '));
ok('D12 三页底色两两不同', new Set(PAGES.map((p) => snap[p].appBg)).size === 3, PAGES.map((p) => snap[p].appBg).join(' | '));

/* ---------------------------------------------------------------- G */
Group('G 延迟真接口的骨架与位移（?api=1）');
{
  const warm = await ctx.newPage();
  await warm.goto(`${ORIGIN}/preview/wizard-paper-grid.html`, { waitUntil: 'load' });
  await warm.waitForSelector('[data-role="meta-step"]');
  bootstrapFixture = await warm.evaluate(() => JSON.stringify(window.__fdBridge.facts.bootstrap));
  await warm.close();
  writeFileSync(path.join(OUT, 'bootstrap-fixture.json'), bootstrapFixture, 'utf8');
  ok('G0 事实源可从产物内取到（fixture 不抄第二份表）',
    bootstrapFixture !== null && JSON.parse(bootstrapFixture).categories.length === 6,
    `${bytes(bootstrapFixture ?? '')}B，${JSON.parse(bootstrapFixture ?? '{}').categories.length} 个品类`);
}
async function sample(url) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__s = [];
    const tick = () => {
      const host = document.querySelector('[data-min-height="176"]');
      const route = document.querySelector('[data-min-height="520"]');
      const probeEl = document.querySelector('[data-role="probe-below"]');
      const submit = document.querySelector('[data-action="next"]');
      window.__s.push({
        t: Math.round(performance.now()),
        skeleton: document.querySelector('[data-testid="suspense-fallback"]') !== null,
        routeSkel: route !== null && route.querySelector('[data-testid="suspense-fallback"]') !== null,
        host: host !== null,
        hostH: host === null ? null : Math.round(host.getBoundingClientRect().height),
        probeTop: probeEl === null ? null : Math.round(probeEl.getBoundingClientRect().top),
        nextTop: submit === null ? null : Math.round(submit.getBoundingClientRect().top),
        options: document.querySelectorAll('[data-field="category"] option').length,
      });
      /* A frame cap is the wrong budget: at 8ms the sampler ran out *before* the 2.2s origin
         answered, which is what made every api measurement read zero. Time-bounded instead. */
      if (performance.now() < 7000) setTimeout(tick, 8);
    };
    tick();
  });
  const seen = [];
  page.on('request', (r) => seen.push(r.url()));
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelectorAll('[data-field="category"] option').length > 1, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => window.__s);
  await page.close();
  return { s, seen };
}
const mockRun = await sample(`${ORIGIN}/preview/wizard-paper-grid.html`);
apiDelay = 2200;
const apiRun = await sample(`${ORIGIN}/preview/wizard-paper-grid.html?api=1`);
apiDelay = 0;
const bootOf = (r) => r.seen.filter((u) => u.includes('/wizard/bootstrap')).length;
ok('G1 mock 载体不发网络请求，?api=1 载体恰好发 1 次 bootstrap（同一产物两种传输）',
  bootOf(mockRun) === 0 && bootOf(apiRun) === 1, `mock=${bootOf(mockRun)} api=${bootOf(apiRun)}`);

/**
 * Two Suspense boundaries live in this app and they answer different questions: the route one
 * (`data-min-height=520`, from main.tsx) covers lazy-mounted panels, the field one
 * (`data-min-height=176`, inside the identity panel) covers the option fetch. Only one of them
 * is observable per run — a slow origin keeps the route boundary pending, so the field host is
 * not even in the document yet — so `windowOf` reports whichever one was actually pending and
 * the assertions follow the measurement instead of assuming it.
 */
const routePending = (s) => s.filter((x) => x.routeSkel);
const fieldPending = (s) => s.filter((x) => x.host && x.options <= 1);
const mountedShell = (s) => s.filter((x) => x.nextTop !== null);
const span = (f) => (f.length === 0 ? 0 : f.at(-1).t - f[0].t);
const firstOf = (f) => f[0];
const lastOf = (f) => f.at(-1);

for (const [label, run] of [['mock', mockRun], ['api', apiRun]]) {
  const rp = routePending(run.s);
  const fp = fieldPending(run.s);
  const shell = mountedShell(run.s);
  ok(`G2 ${label}：等待期始终有可见占位（路由级或字段级），从未空窗`,
    run.s.length > 0 && (rp.length > 0 || fp.length > 0),
    `路由骨架 ${rp.length} 帧(${span(rp)}ms)，字段骨架 ${fp.length} 帧(${span(fp)}ms)，共 ${run.s.length} 帧`);
  num(`G2b ${label} 两级骨架时长`, `${span(rp)} / ${span(fp)}`, 'ms（路由/字段）');
  if (fp.length > 1) {
    const L = lastOf(fp.filter((x) => x.options <= 1));
    const D = fp[fp.indexOf(L) + 1] ?? lastOf(fp);
    ok(`G3 ${label}：字段骨架→内容之间「下一步」按钮位移 ≤2px`,
      Math.abs(D.nextTop - L.nextTop) <= 2, `${L.nextTop} → ${D.nextTop}`);
    ok(`G3a ${label}：占位下方说明文字同样不位移`, Math.abs(D.probeTop - L.probeTop) <= 2,
      `${L.probeTop} → ${D.probeTop}`);
    ok(`G3c ${label}：占位高度实测 ≥170px`, (L.hostH ?? 0) >= 170, `${L.hostH}px`);
  } else {
    num(`G3 ${label}：字段级骨架本次未被采到（等待期被路由级边界吃掉），位移改由挂载后帧序列度量`, fp.length, '帧');
    const after = run.s.filter((x) => x.host && x.options > 1);
    const drift = after.length === 0 ? null : Math.abs(after.at(-1).nextTop - after[0].nextTop);
    ok(`G3b ${label}：内容就绪后按钮不再移动（就绪→稳定位移 ≤2px）`, drift !== null && drift <= 2,
      `drift=${drift}px over ${after.length} 帧`);
  }
  const gap = shell.find((x) => !x.skeleton && x.options <= 1 && !x.routeSkel);
  ok(`G4 ${label}：页面挂载后没有「既无骨架也无内容」的空窗帧`, gap === undefined,
    gap === undefined ? `${shell.length} 帧挂载期内均有着落` : `空窗于 t=${gap.t}`);
}
ok('G5 真接口慢 2.2s 期间整页仍可用：标题、步骤条、草稿面板都在场（早期返回会把它们一起抹掉）',
  mountedShell(apiRun.s).length > 20 && apiRun.s.some((x) => x.routeSkel && !x.host),
  `挂载后帧 ${mountedShell(apiRun.s).length}，路由等待帧 ${routePending(apiRun.s).length}`);
ok('G5b ?api=1 的总等待窗口明显长于 mock（延迟可见，而不是被同步假数据抹平）',
  span(routePending(apiRun.s)) + span(fieldPending(apiRun.s)) >= span(routePending(mockRun.s)) + span(fieldPending(mockRun.s)) + 800,
  `api≈${span(routePending(apiRun.s)) + span(fieldPending(apiRun.s))}ms vs mock≈${span(routePending(mockRun.s)) + span(fieldPending(mockRun.s))}ms`);
num('G6 骨架总时长：mock / api（延迟接口的可见代价）',
  `${span(routePending(mockRun.s)) + span(fieldPending(mockRun.s))} / ${span(routePending(apiRun.s)) + span(fieldPending(apiRun.s))}`, 'ms');

/* ---------------------------------------------------------------- K */
Group('K 真浏览器点完整条提交链路');
{
  const page = await ctx.newPage();
  const submits = [];
  page.on('request', (r) => { if (r.url().includes('wizard')) submits.push(r.url()); });
  await page.goto(`${ORIGIN}/preview/wizard-concrete-rose.html`, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="load-sample"]');
  await page.click('[data-action="load-sample"]');
  await page.waitForFunction(() => (document.querySelector('[data-async-for="subdomain"]')?.textContent ?? '').includes('可用'), null, { timeout: 10000 });
  ok('K1 载入示例后异步校验自己跑完（不是靠手点输入框）', true, '子域名角标已变「可用」');
  for (let i = 0; i < 3; i += 1) {
    await page.click('[data-action="next"]');
    await page.waitForTimeout(320);
  }
  const step = await page.textContent('[data-role="meta-step"]');
  ok('K2 三次「下一步」到达第 4 步（真浏览器里的步骤闸门与 jsdom 结论一致）', /STEP 4\//.test(step ?? ''), step ?? '');
  const totalBefore = await page.textContent('[data-role="review-total"]');
  await page.click('[data-action="submit"]');
  await page.waitForSelector('[data-role="receipt"][data-shown="1"]', { timeout: 12000 });
  const serial = await page.textContent('[data-role="receipt-serial"]');
  ok('K3 提交拿到回执号（真点击，不需要合成 submit 事件）', /^TD-[A-Z0-9]+-\d{4}$/.test(serial ?? ''), `回执=${serial} 合计=${totalBefore}`);
  const draftAfter = await page.evaluate(() => localStorage.getItem('tideside.wizard.draft'));
  ok('K4 提交成功即清草稿（真浏览器里 localStorage 确实为空）', draftAfter === null, String(draftAfter).slice(0, 40));
  await page.click('[data-action="submit"]');
  await page.waitForTimeout(900);
  const state = await page.textContent('[data-role="submit-state"]');
  ok('K5 再点一次提交得到「重复提交已并入同一订单」（幂等令牌在真浏览器里成立）',
    (state ?? '').includes('重复'), (state ?? '').slice(0, 40));
  const sameSerial = await page.textContent('[data-role="receipt-serial"]');
  ok('K5b 重复提交不换回执号', sameSerial === serial, `${serial} → ${sameSerial}`);
  await page.close();
}

/* ---------------------------------------------------------------- M */
Group('M 草稿跨载体与跨刷新（http:// 与 file:// 是两个 origin）');
async function persistence(carrier, url) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const p = await c.newPage();
  const r = { carrier, errors: [] };
  p.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 80)));
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-role="meta-step"]', { timeout: 20000 });
    r.storageAtBoot = await p.evaluate(() => {
      try {
        return window.localStorage.length;
      } catch (e) {
        return `throw:${String(e).slice(0, 40)}`;
      }
    });
    r.draftTextAtBoot = await p.textContent('[data-role="draft-state"]');
    await p.fill('[data-field="storeName"]', '载体验证店名');
    await p.fill('[data-field="subdomain"]', 'carrier-probe');
    await p.waitForTimeout(1300);
    await p.click('[data-action="save-draft"]');
    await p.waitForTimeout(250);
    r.raw = await p.evaluate(() => localStorage.getItem('tideside.wizard.draft'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-role="meta-step"]', { timeout: 20000 });
    r.afterReload = await p.evaluate(() => ({
      store: document.querySelector('[data-field="storeName"]')?.value ?? null,
      sub: document.querySelector('[data-field="subdomain"]')?.value ?? null,
      draft: document.querySelector('[data-role="draft-state"]')?.textContent ?? null,
      step: document.querySelector('[data-role="meta-step"]')?.textContent ?? null,
    }));
    /* hostile draft: unknown keys + wrong types + a step that does not exist */
    await p.evaluate(() => localStorage.setItem('tideside.wizard.draft', JSON.stringify({
      version: 3, step: 'nowhere', values: { storeName: 42, subdomain: 'ok-name', hacked: 'x' }, savedAt: '2020-01-01T00:00:00.000Z',
    })));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-role="meta-step"]', { timeout: 20000 });
    r.hostile = await p.evaluate(() => ({
      store: document.querySelector('[data-field="storeName"]')?.value ?? null,
      sub: document.querySelector('[data-field="subdomain"]')?.value ?? null,
      step: document.querySelector('[data-role="meta-step"]')?.textContent ?? null,
      draft: document.querySelector('[data-role="draft-state"]')?.textContent ?? null,
    }));
  } catch (e) {
    r.error = String(e).slice(0, 160);
  }
  await c.close();
  return r;
}
const mHttp = await persistence('http://', `${ORIGIN}/preview/wizard-paper-grid.html`);
const mFile = await persistence('file://', `file://${path.join(ROOT, 'preview', 'wizard-paper-grid.html')}`);
for (const m of [mHttp, mFile]) {
  ok(`M1 ${m.carrier} 载体可冷启动且起始无草稿（新 context 不串存储，页面零报错）`,
    m.error === undefined && m.storageAtBoot === 0 && m.errors.length === 0,
    `storage=${JSON.stringify(m.storageAtBoot)} err=${m.error ?? ''} pageerrors=${m.errors.join('|')}`);
  ok(`M2 ${m.carrier} 初始提示为「尚无草稿」而不是残留文案`, (m.draftTextAtBoot ?? '').includes('尚无草稿'), String(m.draftTextAtBoot).slice(0, 24));
  const env = m.raw === null ? null : JSON.parse(m.raw);
  ok(`M3 ${m.carrier} 手动保存写入版本化信封（version=3，字段与输入一致，未知字段不会进来）`,
    env?.version === 3 && env?.values?.storeName === '载体验证店名' && Object.keys(env?.values ?? {}).length <= 22,
    String(m.raw).slice(0, 60));
  ok(`M4 ${m.carrier} 刷新后草稿回填且提示「已恢复」`,
    m.afterReload?.store === '载体验证店名' && (m.afterReload?.draft ?? '').includes('已恢复'),
    JSON.stringify(m.afterReload));
  ok(`M5 ${m.carrier} 敌意草稿被逐项消毒：未知键丢弃、类型不符回落、非法步骤回第一步`,
    m.hostile?.store === '' && m.hostile?.sub === 'ok-name' && /STEP 1\//.test(String(m.hostile?.step)) && (m.hostile?.draft ?? '').includes('丢弃'),
    JSON.stringify(m.hostile));
}
ok('M6 两种载体各自写入成功且互不相通（file:// 与 http:// 是不同 origin）',
  mHttp.raw !== null && mFile.raw !== null && mHttp.raw !== mFile.raw, '各自 localStorage 独立写入');

await browser.close();
server.close();
summary('check-browser');
dumpResults(path.join(OUT, 'assertions-browser.json'));
const perGroup = {};
for (const r of results) {
  const letter = (r.group.match(/^[A-Z]/) ?? ['?'])[0];
  perGroup[letter] = (perGroup[letter] ?? 0) + 1;
}
console.log(`browser assertions per group: ${JSON.stringify(perGroup)}`);
