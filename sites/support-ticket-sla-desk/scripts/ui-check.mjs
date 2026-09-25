#!/usr/bin/env node
// 真浏览器交互回归：用系统 Chrome + playwright-core 打开单文件预览版，
// 逐项点一遍页面（页签/筛选/选行/建单/停表/恢复/缺令牌），断言接口驱动的行为。
//
// 为什么不用 IDE 内置浏览器面板：它是 0×0 的隐藏视图，点不到也量不到，
// 只能靠计算样式断言——所以这里必须起一个有视口的真浏览器。
//
// 用法：node scripts/ui-check.mjs <页面URL> <ADMIN_TOKEN>
//   例：node scripts/ui-check.mjs http://127.0.0.1:18262/ledger.html "$UI_TOKEN"
// 前置：后端已起（默认 8091）、preview 已内联、serve-static 托管 preview 目录。
// 注意：本脚本会真的写库（建 1 张单 + 停表/恢复各 1 次），只对着本地实例跑。
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const url = process.argv[2] ?? 'http://127.0.0.1:18262/ledger.html';
// 令牌只从环境读，绝不写进文件；命令行参数是可选覆盖。
const token = (process.argv[3] ?? process.env.UI_TOKEN ?? '').trim();
if (token === '') {
  console.error('需要管理令牌：UI_TOKEN=<本地实例令牌> node scripts/ui-check.mjs [页面URL]');
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
  process.exit(2);
}
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}`);
  process.exit(2);
}

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    console.log(`  ok   ${name}${extra === '' ? '' : ` — ${extra}`}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra === '' ? '' : ` — ${extra}`}`);
  }
};

const browser = await pw.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const where = m.location() ?? {};
  if (/favicon/i.test(m.text()) || /favicon/i.test(where.url ?? '')) return;
  errors.push(m.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.tickets tbody tr', { timeout: 15000 });

// 1) 页签切换：停表页签的每一行都必须处于 pending_customer
const tabCount = await page.locator('.tab').count();
ok('页签数量来自 /api/meta', tabCount === 6, `实际 ${tabCount}`);
await page.getByRole('tab', { name: /停表中/ }).click();
await page.waitForFunction(
  () => document.querySelectorAll('.tickets tbody tr').length > 0 &&
    [...document.querySelectorAll('.tickets tbody tr')].every((tr) => tr.textContent.includes('挂起中')),
  { timeout: 15000 },
);
ok('切到「停表中」后整列都在挂起', true);
const pausedRows = await page.locator('.tickets tbody tr').count();

// 2) 关键词筛选：回到全部页签，按工单号搜
await page.getByRole('tab', { name: /全部/ }).first().click();
const someCode = await page.locator('.tickets tbody tr .cell-code').first().textContent();
await page.fill('#f-q', (someCode ?? '').trim());
await page.waitForFunction(
  (code) => document.querySelectorAll('.tickets tbody tr').length === 1 &&
    (document.querySelector('.cell-code')?.textContent ?? '').trim() === code,
  (someCode ?? '').trim(),
  { timeout: 15000 },
);
ok('按工单号搜索命中唯一行', true, someCode ?? '');

// 3) 选行 → 详情账本与时间线
await page.locator('.tickets tbody tr').first().click();
await page.waitForSelector('.equation-text', { timeout: 15000 });
const eq = (await page.locator('.equation-text').first().textContent() ?? '').trim();
ok('详情分解式由后端下发', /\d+\s*=\s*非工作/.test(eq), eq.slice(0, 46));
const idents = await page.locator('.ident[data-ok="true"]').count();
ok('详情页恒等式全部成立', idents >= 3, `✓ ${idents} 条`);
const tl = await page.locator('.tl-entry').count();
ok('时间线有内容', tl >= 2, `${tl} 跳`);

// 3b) 时区一致性：列表行的建单时间（接口给的是 UTC）必须与详情账本的建单时间
//     （接口给的是现场挂钟 +08:00）显示成同一个墙上时刻。曾经这里差 8 小时。
const tz = await page.evaluate(() => {
  const cell = document.querySelector('.tickets tbody tr .cell-title');
  const rowText = cell ? (cell.textContent ?? '') : '';
  const rowM = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2})[^(]*建/.exec(rowText);
  const facts = [...document.querySelectorAll('.fact')];
  const f = facts.find((x) => (x.querySelector('dt')?.textContent ?? '') === '建单时间');
  return { row: rowM ? (rowM[1] ?? '') : '', detail: (f?.querySelector('dd')?.textContent ?? '').trim() };
});
ok('列表与详情的建单时刻一致（时区换算正确）', tz.row !== '' && tz.row === tz.detail, `${tz.row} vs ${tz.detail}`);

// 4) 缺令牌时写操作必须被前端拦住并给出可读提示
await page.fill('#admin-token', '');
await page.selectOption('#op-status', 'in_progress').catch(() => {});
const noteBefore = await page.locator('.ops .action-note').count();
if (noteBefore === 0) {
  await page.locator('.ops .btn').first().click();
}
await page.waitForSelector('.ops .action-note', { timeout: 5000 }).catch(() => {});
const guardText = (await page.locator('.ops .action-note').first().textContent().catch(() => '')) ?? '';
ok('未填令牌时写操作被挡下', guardText.includes('令牌'), guardText.slice(0, 40));

// 5) 建单 → 停表 → 恢复（真写接口）
await page.fill('#admin-token', token);
const stamp = Date.now().toString(36).toUpperCase().slice(-5);
const title = `UI 回归工单 ${stamp}`;
await page.fill('#c-title', title);
const custCount = await page.locator('#c-cust option').count();
ok('客户下拉由 /api/customers 填充', custCount > 10, `${custCount - 1} 家`);
await page.selectOption('#c-cust', { index: 1 });
await page.selectOption('#c-sev', 'S1');
await page.selectOption('#c-cat', { index: 2 });
await page.locator('.create-form button[type="submit"]').click();
// 服务端回执落在 .action-note 上（文案由 useAction 统一给「操作已完成」），
// 新单不一定落在当前排序的第一页，所以先等回执、再用标题精确搜。
await page.waitForFunction(
  () => /完成/.test(document.querySelector('.create-form .action-note')?.textContent ?? ''),
  null,
  { timeout: 20000 },
);
ok('建单接口返回成功回执', true, title);

// 新单可能不在当前页：直接搜它的标题再操作
await page.fill('#f-q', title);
await page.waitForFunction(
  (t) => document.querySelectorAll('.tickets tbody tr').length === 1 &&
    (document.querySelector('.row-title')?.textContent ?? '').includes(t),
  title,
  { timeout: 15000 },
);
await page.locator('.tickets tbody tr').first().click();
await page.waitForFunction(
  (t) => (document.querySelector('.sub-title')?.textContent ?? '').includes(t),
  title,
  { timeout: 15000 },
);
// 新单是「待受理」，状态机不允许直接停表（必须先有人接）：先派单，再停表/恢复。
// 时间线里的 data-kind 是最硬的证据，比按钮回执文案可靠，所以拿它当等待条件。
await page.selectOption('#op-agent', { index: 1 });
await page.getByRole('button', { name: '派单' }).click();
await page.waitForSelector('.tl-entry[data-kind="assigned"]', { timeout: 15000 });
ok('派单写进时间线', true);
await page.selectOption('#op-reason', { index: 1 });
await page.getByRole('button', { name: '停表' }).click();
await page.waitForSelector('.tl-entry[data-kind="paused"]', { timeout: 15000 });
const pausedChip = (await page.locator('.ledger-bar').first().textContent()) ?? '';
ok('停表后账本仍在结算（有分解条）', pausedChip.length > 0);
await page.getByRole('button', { name: '恢复计时' }).click();
await page.waitForSelector('.tl-entry[data-kind="resumed"]', { timeout: 15000 });
ok('恢复计时写进时间线', true);
const eqAfter = (await page.locator('.equation-text').first().textContent() ?? '').trim();
ok('停表一轮后分解式仍然自洽', /停表 \d+ \+ 计时中/.test(eqAfter), eqAfter.slice(0, 46));

// 6) 侧栏与日历都取到了接口数据
ok('工作日历 16 格', (await page.locator('.cal-day').count()) === 16);
ok('工程师负载 12 行', (await page.locator('.load-row').count()) === 12);
ok('合同矩阵 4 行', (await page.locator('.matrix tbody tr').count()) === 4);
ok('审计四项全绿', (await page.locator('.col-side .ident[data-ok="true"]').count()) >= 4);
ok('零外部资源', (await page.evaluate(() => [...document.querySelectorAll('link[href], script[src], img[src]')]
  .map((e) => e.getAttribute('href') || e.getAttribute('src') || '')
  .filter((v) => /^https?:|^\/\//.test(v)).length)) === 0);
ok(`无控制台错误（停表页签曾见 ${pausedRows} 行）`, errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(failed === 0 ? '\nUI 回归全部通过' : `\nUI 回归失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
