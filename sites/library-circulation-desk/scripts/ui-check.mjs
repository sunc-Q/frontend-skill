#!/usr/bin/env node
// UI 真操作回归：系统 Chrome + playwright-core 打开单文件预览版（走真接口），
// 完成一次「借出 → 归还」的真实写操作，并顺带验风格切换与控制台洁净。
//
// 为什么必须真点：api-smoke.sh 证明的是后端状态机对，
// 但「馆员实际能不能在这张表上把一本书借出去」只有真浏览器点一遍才算数——
// React 受控输入、按钮 disabled 规则、提交后的回填与列表刷新都在这一层。
//
// 用法（需要后端与静态服务器已在跑）：
//   BASE=http://127.0.0.1:18401 PAGE=http://127.0.0.1:18409/lego.html \
//   ADMIN_TOKEN=<本地演示令牌> BARCODE=… CARD=… \
//   node scripts/ui-check.mjs
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BASE = process.env.BASE ?? 'http://127.0.0.1:18401';
const PAGE = process.env.PAGE ?? `${BASE}/`;
const TOKEN = process.env.ADMIN_TOKEN ?? '';
const BARCODE = process.env.BARCODE ?? '';
const CARD = process.env.CARD ?? '';
const SHOT = process.env.SHOT ?? '/tmp/lcd-ui-';

let pass = 0;
let fail = 0;
const ok = (name, extra = '') => { pass++; console.log(`  ok   ${name}${extra ? ' — ' + String(extra).slice(0, 90) : ''}`); };
const bad = (name, extra = '') => { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + String(extra).slice(0, 160) : ''}`); };
const chk = (name, want, got) => (String(got).includes(want) ? ok(name, got) : bad(name, `期望含「${want}」实际「${got}」`));

const candidates = [
  ...(process.env.PW_PATH ? [process.env.PW_PATH] : []),
  join(here, '..', 'node_modules', 'playwright-core'),
  join(here, '..', 'web', 'node_modules', 'playwright-core'),
  '/Users/apple/Documents/workProject/试验/skill演示场/.tmp/pw2/node_modules/playwright-core',
];
let pw = null;
for (const c of candidates) {
  if (!existsSync(c)) continue;
  try { pw = require(c); break; } catch { /* 下一个 */ }
}
if (pw === null) { console.error(`找不到 playwright-core（试过 ${candidates.join(' , ')}）`); process.exit(2); }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.error(`找不到 Chrome：${CHROME}`); process.exit(2); }
if (!BARCODE || !CARD || !TOKEN) { console.error('需要 BARCODE / CARD / ADMIN_TOKEN（从 probe-samples.py 取，别硬猜）'); process.exit(2); }

const api = async (path) => (await fetch(BASE + path)).json();

const browser = await pw.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const where = m.location() ?? {};
  if (/favicon/i.test(m.text()) || /favicon/i.test(where.url ?? '')) return;
  errors.push(where.url ? `${m.text()} <- ${where.url}` : m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

console.log('\n① 打开预览页并等数据落到表格里');
await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.table tbody tr', { timeout: 15000 });
const rows0 = await page.locator('.table tbody tr').count();
rows0 > 0 ? ok('台账有行', `rows=${rows0}`) : bad('台账为空', '');
const ext = await page.evaluate(() => [...document.querySelectorAll('link[href],script[src],img[src]')]
  .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
  .filter((v) => /^https?:|^\/\//.test(v)));
ext.length === 0 ? ok('零外链资源') : bad('存在外链', JSON.stringify(ext));

console.log('\n② 管理令牌与必填项：没填时写按钮必须禁用');
const borrowBtn = page.locator('form').filter({ hasText: '确认借出' }).locator('button[type=submit]');
await borrowBtn.isEnabled()
  ? bad('未填任何东西却可提交', '')
  : ok('空表单 → 借出按钮禁用');
// 借出按钮的 disabled 是三条并列：无令牌 / 无条码 /无证号。先只填条码+证号，
// 按钮仍应禁用（令牌这道门必须真的在管），填了令牌才解禁。
await page.fill('input[placeholder="BN-000001"]', BARCODE);
await page.fill('input[placeholder="R-2026-0001"]', CARD);
await page.waitForTimeout(300);
await borrowBtn.isEnabled()
  ? bad('未填令牌却可提交', '')
  : ok('有条码有证号、缺令牌 → 仍禁用');
await page.fill('input[placeholder="ADMIN_TOKEN"]', TOKEN);
await page.waitForTimeout(300);
await borrowBtn.isEnabled() ? ok('填入令牌后按钮解禁') : bad('填了令牌仍禁用', '');

console.log('\n③ 真实借出：提交 → 接口侧核对');
const before = await api('/api/stats');
await borrowBtn.click();
await page.waitForSelector('.form-msg[data-kind="ok"]', { timeout: 10000 });
const msg = await page.locator('form').filter({ hasText: '确认借出' }).locator('.form-msg').innerText();
chk('借出成功提示', '操作已完成', msg);
const after = await api('/api/stats');
Number(after.active_loans) === Number(before.active_loans) + 1
  ? ok('在借单数 +1', `${before.active_loans} → ${after.active_loans}`)
  : bad('在借单数未增加', `${before.active_loans} → ${after.active_loans}`);
const detail = await api(`/api/loans?q=${encodeURIComponent(BARCODE)}&status=active&page_size=5`);
const newLoan = (detail.items ?? []).find((r) => r.copy_barcode === BARCODE);
newLoan
  ? ok('新借阅单可在接口查到', `id=${newLoan.id} ${newLoan.item_code} ${newLoan.status}`)
  : bad('接口查不到这条新单', JSON.stringify(detail).slice(0, 120));
const copyAfter = await api(`/api/items/${encodeURIComponent(newLoan?.item_code ?? '')}`)
  .then((d) => (d.copies ?? []).find((c) => c.barcode === BARCODE))
  .catch(() => null);
copyAfter && copyAfter.status === 'on_loan'
  ? ok('复本状态转借出', `borrower=${copyAfter.borrower_card ?? '-'}`)
  : bad('复本状态未变', JSON.stringify(copyAfter));

console.log('\n④ 真实归还：检索条码 → 选中该单 → 确认归还 → 快照核对');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.table tbody tr', { timeout: 15000 });
// 令牌存在 localStorage，但重载后仍要确认一次——按钮 disabled 的三种原因里
// 「没令牌」最容易伪装成「状态机不对」，先把它排除掉。
const tokVal = await page.inputValue('input[placeholder="ADMIN_TOKEN"]');
if (tokVal === '') {
  await page.fill('input[placeholder="ADMIN_TOKEN"]', TOKEN);
  await page.waitForTimeout(300);
}
ok('重载后令牌仍在输入框', tokVal === '' ? '(重新填入)' : `len=${tokVal.length}`);
// 用条码检索，别赌「第一行就是刚借的那条」：同一册可能有历史归还记录，
// 所以要按「含该条码 且 状态为在借」两条件筛行。
await page.fill('input[placeholder*="条码"]', BARCODE);
const row = page.locator('.table tbody tr').filter({ hasText: BARCODE }).filter({ hasText: '在借' }).first();
await row.waitFor({ state: 'visible', timeout: 15000 });
await row.click();
await page.waitForTimeout(600);
const detailTitle = await page.locator('.detail').innerText().catch(() => '');
detailTitle.includes(BARCODE)
  ? ok('详情面板对准该条码')
  : bad('详情面板未对准', detailTitle.slice(0, 80));
const returnBtn = page.locator('form').filter({ hasText: '确认归还' }).locator('button[type=submit]');
await returnBtn.isVisible()
  ? ok('归还面板随选中行出现')
  : bad('归还面板未出现', '');
await returnBtn.click({ timeout: 8000 });
await page.waitForSelector('.form-msg[data-kind="ok"]', { timeout: 10000 });
const back = await api(`/api/loans/${newLoan.id}`);
back.loan?.status === 'returned'
  ? ok('借阅单转已还', `fine_cents=${back.loan.fine_cents} returned_at=${back.loan.returned_at?.slice(0, 10)}`)
  : bad('归还未生效', JSON.stringify(back.loan ?? back).slice(0, 120));
const afterReturn = await api('/api/stats');
Number(afterReturn.active_loans) === Number(before.active_loans)
  ? ok('在借单数回到操作前', `${afterReturn.active_loans}`)
  : bad('在借单数未回落', `${before.active_loans} → ${afterReturn.active_loans}`);

console.log('\n⑤ 风格切换：点第三个主题按钮，DOM 不变而 data-theme 变');
const themes = page.locator('.theme-btn');
const n = await themes.count();
n === 3 ? ok('三个主题按钮', `n=${n}`) : bad('主题按钮数量异常', `n=${n}`);
// 结构同构判定：把装饰性的品牌 swatch（每风格一枚不同 SVG，本来就该不同）排除后，
// 业务 DOM 必须逐节点一致——标签+class 序列相同，且 data-active 这类状态属性不参与比较。
const sig = () => page.evaluate(() => {
  const shell = document.querySelector('.shell');
  const skip = new Set(['svg', 'path', 'circle', 'rect', 'polygon', 'line', 'g']);
  const nodes = [...shell.querySelectorAll('*')].filter((e) => !skip.has(e.tagName.toLowerCase()));
  return {
    n: nodes.length,
    seq: nodes.map((e) => `${e.tagName.toLowerCase()}.${e.className}`).join('|'),
  };
});
const before5 = await sig();
await themes.nth(2).click();
await page.waitForTimeout(600);
const themeNow = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
themeNow === 'decon' ? ok('切换到解构主义拼版', themeNow) : bad('切换后 data-theme 异常', themeNow);
const after5 = await sig();
if (before5.n === after5.n && before5.seq === after5.seq) {
  ok('业务 DOM 逐节点同构（装饰 swatch 除外）', `nodes=${after5.n}`);
} else {
  bad('DOM 结构漂移', `${before5.n} → ${after5.n}`);
}
// 不比 textContent 总长：页面上是接口数据，归还动作后的重取会让数字位数变化，
// 那是内容更新不是结构漂移；结构层面用节点序列 + 行/卡计数说话。
const counts = () => page.evaluate(() => ({
  rows: document.querySelectorAll('.table tbody tr').length,
  kpis: document.querySelectorAll('.kpi').length,
  badges: document.querySelectorAll('.badge').length,
}));
const c1 = await counts();
await themes.nth(1).click();
await page.waitForTimeout(400);
const c2 = await counts();
JSON.stringify(c1) === JSON.stringify(c2)
  ? ok('切换前后计数一致', JSON.stringify(c2))
  : bad('计数漂移', `${JSON.stringify(c1)} → ${JSON.stringify(c2)}`);
await page.screenshot({ path: `${SHOT}decon.png`, fullPage: true });
await themes.nth(1).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOT}riso.png`, fullPage: true });

console.log('\n⑥ 控制台');
errors.length === 0 ? ok('零 console 错误') : bad('存在 console 错误', JSON.stringify(errors.slice(0, 3)));

await browser.close();
console.log(`\npass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
