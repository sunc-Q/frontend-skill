#!/usr/bin/env node
// 三风格取证跑手：真无头 Chrome（系统 Chrome + playwright-core）逐主题打开同一页面，
// 在页内执行 scripts/style-probe.js 采集 getComputedStyle，落一份合并 JSON + 截图。
//
// 为什么不用 IDE 内置浏览器面板：那是 0×0 的隐藏视图，量不到真实布局，
// 也拿不到截图；这里必须起一个有视口的浏览器。
//
// 用法：
//   node scripts/style-shoot.mjs <页面URL模板> <输出json> [截图前缀]
//   URL 模板里的 {theme} 依次换成 lego/riso/decon，例如
//     http://127.0.0.1:18401/?theme={theme}        （后端直接托管 dist/）
//     http://127.0.0.1:18409/lego.html             （单文件预览版，配 serve-static.mjs）
//
// playwright-core 位置：优先 $PW_PATH，其次本仓 node_modules，最后回落到本机已装的一份
// （它只是驱动器，浏览器用系统 Chrome，不额外下载几百 MB）。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const THEMES = ['lego', 'riso', 'decon'];

const tpl = process.argv[2];
const outFile = resolve(process.argv[3] ?? '/tmp/lcd-probe.json');
const shotPrefix = process.argv[4] ?? '/tmp/lcd-shot-';
if (!tpl) {
  console.error('用法: node scripts/style-shoot.mjs <URL模板> [输出json] [截图前缀]');
  process.exit(2);
}

const candidates = [
  ...(process.env.PW_PATH ? [process.env.PW_PATH] : []),
  join(here, '..', 'node_modules', 'playwright-core'),
  join(here, '..', 'web', 'node_modules', 'playwright-core'),
  '/Users/apple/Documents/workProject/试验/skill演示场/.tmp/pw2/node_modules/playwright-core',
];
let pw = null;
for (const c of candidates) {
  if (!existsSync(c)) continue;
  try {
    pw = require(c);
    break;
  } catch {
    /* 换下一个候选 */
  }
}
if (pw === null) {
  console.error(`找不到 playwright-core（试过：${candidates.join(' , ')}）`);
  console.error('装一份：npm i -D playwright-core --registry=https://registry.npmmirror.com');
  process.exit(2);
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}`);
  process.exit(2);
}

const probe = eval(`(${readFileSync(join(here, 'style-probe.js'), 'utf8')})`);
const browser = await pw.chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const out = {};
for (const theme of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 静态服务器没有 favicon，浏览器会自己发一次 404，这与页面无关。
    const where = m.location() ?? {};
    if (/favicon/i.test(m.text()) || /favicon/i.test(where.url ?? '')) return;
    errors.push(where.url ? `${m.text()} <- ${where.url}` : m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(tpl.replace('{theme}', theme), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.kpi', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.table tbody tr').length > 0, { timeout: 15000 });
  const res = await page.evaluate(probe);
  res.consoleErrors = errors;
  out[theme] = res;
  await page.screenshot({ path: `${shotPrefix}${theme}.png`, fullPage: true });
  await page.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) {
  console.log(`${k}: theme属性=${v.theme} 行=${v.rowCount} KPI=${v.kpiCount} 徽标=${v.badgeCount} 外链=${v.external.length} 错误=${v.consoleErrors.length}`);
}
console.log(`写入 ${outFile}，截图 ${shotPrefix}{${THEMES.join(',')}}.png`);
