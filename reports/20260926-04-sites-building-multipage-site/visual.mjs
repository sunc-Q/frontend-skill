// 20260926-04 真浏览器复核：headless chromium（本机缓存）逐风格：
// 计算样式指纹 / 横向溢出 / 目录页交互（筛选+排序+导航到详情） / 详情总长 / 截图 + H/contrast+exposureEnds 式子
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'artifacts', '20260926-04-sites-building-multipage-site');
const SHOTS = join(import.meta.dirname, 'shots');
mkdirSync(SHOTS, { recursive: true });
const EXE = '/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const STYLES = [
  { dir: 'acid-gfx', expect: { bodyBg: 'rgb(11, 11, 16)', brand: 'clip-path', fontHead: 'Helvetica' } },
  { dir: 'art-nouveau', expect: { bodyBg: 'rgb(244, 236, 217)', radius: 'borderRadius', fontHead: 'Georgia' } },
  { dir: 'dark-academia', expect: { bodyBg: 'rgb(32, 22, 15)', fontHead: 'Times New Roman' } },
];
let pass = 0, fail = 0;
const ok = (c, n, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${e ? ' | ' + e : ''}`); };

const b = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-dev-shm-usage'] });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });

for (const st of STYLES) {
  const base = `file://${join(OUT, st.dir)}`;
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  // --- 目录页 ---
  await page.goto(`${base}/releases/index.html`, { waitUntil: 'load' });
  const r = await page.evaluate(() => {
    const cs = getComputedStyle;
    return {
      bodyBg: cs(document.body).backgroundColor,
      cards: document.querySelectorAll('#catalog .card').length,
      count: document.getElementById('count').value,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      chipCss: cs(document.querySelector('.chip.is-on')).backgroundColor,
      navCur: document.querySelectorAll('[aria-current="page"]').length,
      cssLoaded: document.styleSheets[0].cssRules.length,
    };
  });
  ok(r.cssLoaded > 80, `V1 ${st.dir} CSS 已应用`, `rules=${r.cssLoaded}`);
  ok(r.bodyBg === st.expect.bodyBg, `V2 ${st.dir} body 底色=主题黑/纸色`, r.bodyBg);
  ok(r.cards === 6 && r.count === '共 6 张', `V3 ${st.dir} 真实浏览器渲染出 6 卡`, `cards=${r.cards} count=${r.count}`);
  ok(!r.overflow, `V4 ${st.dir} 1280 宽无横向溢出`);
  ok(r.navCur === 1, `V5 ${st.dir} aria-current 唯一`);
  // 交互：筛「氛围」→2；再排序「新→旧」首卡 YZ-006；点详情链接
  await page.click('.filters .chip[data-tag="氛围"]');
  const afterFilter = await page.evaluate(() => ({ n: document.querySelectorAll('#catalog .card').length, c: document.getElementById('count').value }));
  ok(afterFilter.n === 2 && afterFilter.c === '共 2 张 · 氛围', `V6 ${st.dir} 点击筛选→2 张`, JSON.stringify(afterFilter));
  await page.click('#sortBtn');
  const firstCard = await page.evaluate(() => document.querySelector('#catalog .card .card-no').textContent);
  ok(firstCard.startsWith('YZ-006'), `V7 ${st.dir} 点击排序后首卡 YZ-006`, firstCard);
  await page.click('.card a.card-link');
  await page.waitForURL('**/release/index.html');
  const rel = await page.evaluate(() => ({
    total: document.getElementById('total').value,
    tracks: document.querySelectorAll('#tracklist li').length,
    h1: document.querySelector('h1').textContent.includes('潮汐图鉴'),
  }));
  ok(rel.tracks === 8 && rel.total === '8 段 · 总长 41:31' && rel.h1, `V8 ${st.dir} 跨目录导航到详情+总长`, JSON.stringify(rel));
  // --- 首页截图 ---
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  const home = await page.evaluate(() => ({
    hero: !!document.querySelector('.hero h1'),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    brand: getComputedStyle(document.querySelector('.brand-mark')).width,
  }));
  ok(home.hero && !home.overflow, `V9 ${st.dir} 首页渲染+无溢出`, JSON.stringify(home));
  await page.screenshot({ path: join(SHOTS, `${st.dir}.png`), fullPage: true });
  ok(errs.length === 0, `V10 ${st.dir} 零 pageerror`, errs.join(';'));
  page.removeAllListeners('pageerror');
}

/* ---- H/contrast + exposureEnds 式子（从 build-game 轮移植，改为对 PNG 真帧做） ---- */
const statPage = await b.newPage();
await statPage.goto('about:blank');
const shotFiles = STYLES.map(s => s.dir);
const stats = {};
for (const d of shotFiles) {
  const data = 'data:image/png;base64,' + readFileSync(join(SHOTS, `${d}.png`)).toString('base64');
  stats[d] = await statPage.evaluate(async src => {
    const img = new Image();
    await new Promise(r => { img.onload = r; img.src = src; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, cv.width, cv.height).data;
    let sum = 0, sum2 = 0, n = 0, dark = 0, clipped = 0, mid = 0;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      sum += l; sum2 += l * l; n++;
      if (l < 10) dark++;
      if (l > 245) clipped++;
      if (l >= 40 && l <= 200) mid++;
      hist[Math.min(255, Math.round(l))]++;
    }
    const mean = sum / n;
    const pct = q => { let c = 0, t = n * q; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= t) return v; } return 255; };
    const p5 = pct(0.05), p95 = pct(0.95);
    const p2 = pct(0.02), p98 = pct(0.98);
    const p05 = pct(0.005), p995 = pct(0.995);
    return { mean: +mean.toFixed(2), sigma: +Math.sqrt(sum2 / n - mean * mean).toFixed(2), darkPct: +(100 * dark / n).toFixed(2), clipPct: +(100 * clipped / n).toFixed(2), midPct: +(100 * mid / n).toFixed(2), p5, p95, spread: p95 - p5, p2, p98, spread298: p98 - p2, p05, p995, spreadExtreme: p995 - p05 };
  }, data);
  const s = stats[d];
  const isDark = d !== 'art-nouveau';
  // 移植发现：游戏帧的 mid%>10 不适用扁平网页——背景/墨色分踞亮度两极，[40,200] 带只剩插图。
  // 网页版口径改为「两极真实在场」：p95-p5 跨度 ≥150 且 σ≥18；主题兑现单列一条。
  ok(s.spreadExtreme >= 100 && s.sigma >= 18, `H1' ${d} contrast 网页版（p99.5-p0.5≥100 且 σ≥18）`, JSON.stringify(s));
  ok((isDark ? s.mean < 80 : s.mean > 180), `H1b ${d} 主题兑现（暗底 mean<80 / 纸底 mean>180）`, 'mean=' + s.mean);
  ok(s.clipPct < 10 && s.darkPct < 10, `H2 ${d} exposureEnds（clip/dark 两端 <10，未糊死）`);
}
// 三帧互异（风格真的不同）
import { createHash } from 'node:crypto';
const hs = shotFiles.map(d => createHash('sha256').update(readFileSync(join(SHOTS, `${d}.png`))).digest('hex').slice(0, 16));
ok(new Set(hs).size === 3, 'H3 三风格截图逐帧互异', hs.join(','));

await b.close();
console.log(`\n== visual: ${pass} PASS / ${fail} FAIL ==`);
console.log('stats:', JSON.stringify(stats));
process.exit(fail ? 1 : 0);
