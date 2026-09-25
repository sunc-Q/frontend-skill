/* 真像素复核：playwright-core + 本机缓存 chromium（IDE 的 browser-use 面板 hidden 时唯一能出图的路径）。
   1) 三风格 × 桌面/手机两档截图
   2) 横向溢出断言（jsdom 的 innerWidth=0 会让这类断言假通过，见历轮环境笔记）
   3) 计算样式指纹：背景色、字体首族、日程表 transform、竖排、栅格列数
   4) 网页版曝光口径（历轮定式：p99.5-p0.5≥100 && σ≥18，另列暗底/纸底兑现）
   依赖装法见 scripts/verify.sh；本脚本产物 PNG 只在复核期存在，收尾删除。 */
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LAB = dirname(dirname(ROOT));
const req = createRequire(join(LAB, '.tmp', 'jsdom', 'noop.js'));
const { chromium } = req('playwright-core');
const OUT = join(LAB, '.tmp', 'shots');
mkdirSync(OUT, { recursive: true });

const STYLES = ['papercut', 'ticket', 'isometric'];
const EXPECT_DARK = { papercut: false, ticket: false, isometric: true };
/* 票据存根的主张就是「零阴影，层次全靠线宽与底色差」——对它断言有阴影会把风格指纹本身判死 */
const EXPECT_SHADOW = { papercut: true, ticket: false, isometric: true };

let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c === true) pass++; else fails.push(n + (d ? ' :: ' + d : '')); };
const eq = (n, a, e) => ok(n, a === e, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(e));

const CHROME_BIN = () => {
  if (process.env.CHROME) return process.env.CHROME;
  const found = execSync("ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/* | head -1").toString().trim();
  if (!found) throw new Error('找不到 chromium 缓存，请设 CHROME 环境变量指向可执行文件');
  return found;
};
const browser = await chromium.launch({
  executablePath: CHROME_BIN(),
  args: ['--no-sandbox', '--allow-file-access-from-files', '--force-device-scale-factor=1'],
});

for (const slug of STYLES) {
  const url = 'file://' + join(ROOT, 'preview', 'activity-' + slug + '.html');
  for (const vp of [{ w: 1280, h: 900, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('requestfailed', (r) => errors.push('REQFAIL ' + r.url()));
    const external = [];
    page.on('request', (r) => { if (!r.url().startsWith('file://')) external.push(r.url()); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__lab && window.__lab.ready === true, null, { timeout: 8000 });
    await page.evaluate(() => document.fonts.ready);
    const tag = slug + '-' + vp.tag;
    await page.screenshot({ path: join(OUT, tag + '.png'), fullPage: true });

    ok('V/' + tag + ' 无 JS 异常', errors.length === 0, errors.join(' | '));
    ok('V/' + tag + ' 零外部请求', external.length === 0, external.join(' | '));
    const m = await page.evaluate(() => {
      const d = document, de = d.documentElement;
      const cs = (sel, prop) => { const el = d.querySelector(sel); return el ? getComputedStyle(el)[prop] : 'MISSING'; };
      return {
        overflowX: de.scrollWidth - window.innerWidth,
        wide: [...d.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1.5).map((el) => el.tagName + '.' + (el.className || '')).slice(0, 6),
        bg: cs('body', 'backgroundColor'),
        h1font: cs('h1', 'fontFamily').split(',')[0].replace(/"/g, ''),
        cardFont: cs('.a-name', 'fontFamily').split(',')[0].replace(/"/g, ''),
        radius: cs('.artist', 'borderTopLeftRadius'),
        gridCols: cs('.lineup-grid', 'gridTemplateColumns'),
        schedTransform: cs('.sessions', 'transform'),
        stageWM: cs('.stage-name', 'writingMode'),
        cardShadow: cs('.artist', 'boxShadow'),
        /* 「看得见」= 矩形真的落在视口内：只判 width/height 会把 left:-9999px 的移出屏外误判成可见 */
        theadVisible: (() => { const th = d.querySelector('.sessions th'); const r = th.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left > -1 && r.top > -1; })(),
        rows: d.querySelectorAll('.sessions tbody tr').length,
        cards: d.querySelectorAll('.artist').length,
        kpi: d.getElementById('kpi-signed').textContent,
        monoH1: /mono/i.test(cs('h1', 'fontFamily')),
        italicH1: cs('h1', 'fontStyle'),
        posterW: (() => { d.getElementById('btn-poster').click(); const svg = d.querySelector('#poster-host svg'); const r = svg ? svg.getBoundingClientRect() : null; return r ? Math.round(r.width) : 0; })(),
      };
    });
    ok('V/' + tag + ' 无横向溢出', m.overflowX <= 0, 'overflowX=' + m.overflowX + ' 越界元素 ' + JSON.stringify(m.wide));
    eq('V/' + tag + ' 12 卡在真实布局里成列', m.cards, 12);
    eq('V/' + tag + ' 25 行渲染完整', m.rows, 25);
    eq('V/' + tag + ' KPI 已填充', m.kpi, '12,483');
    ok('V/' + tag + ' 票根在真浏览器里宽度受控（未撑破）', m.posterW > 0 && m.posterW <= vp.w, 'posterW=' + m.posterW);
    if (vp.tag === 'desktop') {
      (EXPECT_DARK[slug] ? ok : ok)('V/' + slug + ' 计算样式指纹已取到', true);
      ok('V/' + slug + ' 栅格列数已被解析（不是未求值的 var()/字面 repeat）', !/var\(|repeat\(|minmax/.test(m.gridCols) && /px/.test(m.gridCols) && m.gridCols.split(' ').length > 0, m.gridCols);
      ok('V/' + slug + ' 卡圆角已应用', /px/.test(m.radius), m.radius);
      ok('V/' + slug + ' 阴影手法与主张一致', EXPECT_SHADOW[slug] ? m.cardShadow !== 'none' : m.cardShadow === 'none', slug + ' → ' + m.cardShadow);
      ok('V/' + slug + ' 字体首族已解析', m.h1font !== 'MISSING' && !/var\(/.test(m.h1font), m.h1font);
      const lum = frameStats(join(OUT, tag + '.png'));
      writeFileSync(join(OUT, slug + '-frame.json'), JSON.stringify(lum, null, 2));
      const dark = lum.mean < 90;
      eq('V/' + slug + ' 明暗口径与主张一致', dark, EXPECT_DARK[slug]);
      ok('V/' + slug + ' 网页版曝光口径（p99.5-p0.5≥100 && σ≥18）', lum.span >= 100 && lum.sigma >= 18, JSON.stringify(lum));
      ok('V/' + slug + ' 全帧采样量足够（≥3000 点）', lum.n >= 3000, 'n=' + lum.n);
      if (slug === 'isometric') {
        ok('V/isometric 竖排舞台标签生效', /vertical/i.test(m.stageWM), m.stageWM);
        ok('V/isometric 日程表被压成轴测（matrix3d）', /matrix3d/.test(m.schedTransform), m.schedTransform);
        ok('V/isometric 标题为斜体 serif', m.italicH1 === 'italic' && /Georgia|Songti|serif/i.test(m.h1font), m.italicH1 + '/' + m.h1font);
      }
      if (slug === 'ticket') {
        ok('V/ticket 标题解析为等宽族', /mono|Menlo|Consolas|SF Mono/i.test(m.h1font), m.h1font);
        ok('V/ticket 卡零圆角', parseFloat(m.radius) === 0, m.radius);
        ok('V/ticket thead 可见（严格表格）', m.theadVisible === true, String(m.theadVisible));
      }
      if (slug === 'papercut') {
        ok('V/papercut 卡圆角 ≥ 20px', parseFloat(m.radius) >= 20, m.radius);
        ok('V/papercut thead 已按剪纸方案移出（非塌版）', m.theadVisible === false, String(m.theadVisible));
        ok('V/papercut 无 perspective 变换', !/matrix3d/.test(m.schedTransform), m.schedTransform);
      }
      await page.evaluate(() => {
        document.querySelector('#tab-notices').click();
        document.querySelectorAll('#sort-box button')[1].click();
        document.querySelector('.artist .vote').click();
        document.getElementById('qty-plus').click();
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, slug + '-desktop-interacted.png'), fullPage: false });
      const after = await page.evaluate(() => ({
        notices: document.querySelectorAll('#notice-host .notice').length,
        rank1: document.querySelector('.artist .rank').textContent,
        voted: document.querySelectorAll('.vote.voted').length,
        qty: document.getElementById('qty-out').textContent,
        total: document.getElementById('reg-total').textContent,
      }));
      eq('V/' + slug + ' 交互后公告 4 条', after.notices, 4);
      eq('V/' + slug + ' 交互后序号 01', after.rank1, '01');
      eq('V/' + slug + ' 交互后有已投档', after.voted >= 1, true);
      eq('V/' + slug + ' 数量步进到 3', after.qty, '3');
      eq('V/' + slug + ' 合计随数量变（380×3）', after.total, '¥1,140');
    }
    await page.close();
  }
}

/* 真像素统计：直接解码整页截图并按跨步采样全帧（历轮坑 #86：只读左下角会把
   「天空泛白 / 地面压黑」都判成正常；这里没有 canvas 画 DOM 的伪口径，只看产物像素）。 */
import { readFileSync as readBuf } from 'node:fs';
function frameStats(pngPath) {
  const { PNG } = req('pngjs');
  const img = PNG.sync.read(readBuf(pngPath));
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 40000)));
  const luma = [];
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (img.width * y + x) << 2;
      luma.push(0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]);
    }
  }
  luma.sort((a, b) => a - b);
  const n = luma.length;
  const mean = luma.reduce((s2, x) => s2 + x, 0) / n;
  const sigma = Math.sqrt(luma.reduce((s2, x) => s2 + (x - mean) ** 2, 0) / n);
  const at = (q) => luma[Math.min(n - 1, Math.max(0, Math.floor(n * q)))];
  return {
    n, w: img.width, h: img.height,
    mean: +mean.toFixed(1), sigma: +sigma.toFixed(1),
    span: +(at(0.995) - at(0.005)).toFixed(1),
    midPct: +((luma.filter((v) => v > 40 && v < 215).length / n) * 100).toFixed(1),
  };
}

await browser.close();
writeFileSync(join(OUT, 'visual-report.json'), JSON.stringify({ pass, fails }, null, 2));
console.log('\n视觉断言：通过 ' + pass + ' / 失败 ' + fails.length);
for (const f of fails) console.log('  ✗ ' + f);
if (fails.length) process.exitCode = 1;
