#!/usr/bin/env node
// UI 真操作回归：系统 Chrome + playwright-core 打开页面（走真接口），三套风格各完整跑一遍
// 「试算 → 开单 → 推进 → 报异常 → 恢复 → 退回 → 新增规则 → 启停 → 搜索」，
// 并把只读面（排序、脱敏、外链、控制台报错）一起断言掉。
//
// 为什么必须真点：api-smoke.sh 证明的是后端状态机与计费口径对，
// 但「运营人员能不能在这张界面上把这单推下去」只有真浏览器点一遍才算数——
// React 受控输入、按钮 disabled 规则（无令牌 / 已结案）、提交后的详情回填与列表刷新、
// 字段级错误回显，全在这一层。
//
// 用法（需要后端已在跑，且库是刚灌过种子的干净库）：
//   BASE=http://127.0.0.1:18511 PAGE='http://127.0.0.1:18511/?theme={theme}' \
//   ADMIN_TOKEN=<本地演示令牌> node scripts/ui-check.mjs
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BASE = process.env.BASE ?? 'http://127.0.0.1:18511';
const PAGE = process.env.PAGE ?? `${BASE}/?theme={theme}`;
const TOKEN = process.env.ADMIN_TOKEN ?? '';
const THEMES = (process.env.THEMES ?? 'ticket-stub,michelin-gilt,crackle-glaze').split(',');
const SHOT = process.env.SHOT ?? '/tmp/fwt-ui-';

let pass = 0;
let fail = 0;
const say = (s) => console.log(s);
const ok = (name, extra = '') => { pass++; say(`  ok   ${name}${extra ? ' — ' + String(extra).slice(0, 90) : ''}`); };
const bad = (name, extra = '') => { fail++; say(`  FAIL ${name}${extra ? ' — ' + String(extra).slice(0, 200) : ''}`); };
const eq = (name, want, got) => (String(want) === String(got) ? ok(name, got) : bad(name, `期望「${want}」实际「${got}」`));
const chk = (name, want, got) => (String(got).includes(want) ? ok(name, String(got).slice(0, 90)) : bad(name, `期望含「${want}」实际「${got}」`));
const yes = (name, cond, extra = '') => (cond ? ok(name, extra) : bad(name, extra));
const sec = (s) => say(`\n\u001b[1m${s}\u001b[0m`);

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
if (!TOKEN) { console.error('需要 ADMIN_TOKEN（写接口全过 Bearer 校验，空令牌只能验证只读面）'); process.exit(2); }

const api = async (p) => (await fetch(BASE + p)).json();

const browser = await pw.chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const stamp = Date.now().toString(36).slice(-5);
// 表单作用域：同类表单在 DOM 里不止一个，靠标题文本限定才不会点错按钮。
const FORM = (title) => `form.panel-form:has-text("${title}")`;
// 等待条件一律用「目标值本身」：只等「DOM 变了」会把上一轮的残留当成这一轮的结果。
async function waitFact(page, label, want) {
  await page.waitForFunction(([l, w]) => {
    const d = [...document.querySelectorAll('.facts div')]
      .find((x) => x.querySelector('dt')?.textContent === l);
    return d !== undefined && String(d.querySelector('dd').textContent).includes(w);
  }, [label, want], { timeout: 20000 });
}
const facts = (page) => page.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('.facts div')].map((d) => [
    d.querySelector('dt').textContent, d.querySelector('dd').textContent,
  ])));
// 只按 .field-label 自身的文案定位：整块的 hasText 会被 <option> 文本污染
// （「计费方式」的下拉里也有「……固定额」，first() 就选到了一个没有 input 的 label）。
const fld = (page, scope, label) =>
  page.locator(`${scope} label.field:has(.field-label:has-text("${label}"))`).first();
async function typeIn(page, scope, label, value) {
  await fld(page, scope, label).locator('input').fill(String(value));
}
async function choose(page, scope, label, value) {
  await fld(page, scope, label).locator('select').selectOption({ value });
}
// 提交 + 等回执：给旧消息打上标记，只认「没有标记的新节点」。
// useAction 与试算台都会先把 message 置空（节点卸载后重建），
// 靠 data-kind 直接等会读到上一轮残留的「操作已完成」。
async function submit(page, scope, kind) {
  const form = page.locator(scope).first();
  await form.evaluate((el) => {
    const m = el.querySelector('p.form-msg');
    if (m !== null) m.setAttribute('data-ui-stale', '1');
  });
  await form.locator('button[type=submit]').first().click();
  const loc = form.locator(`p.form-msg[data-kind="${kind}"]:not([data-ui-stale])`);
  await loc.waitFor({ state: 'visible', timeout: 20000 });
  return String(await loc.textContent());
}
// 列表计数读页面上的「共 N 条」，比数 DOM 行数可靠（各表共用 .table）。
async function waitListCount(page, n) {
  await page.waitForFunction((c) => [...document.querySelectorAll('.section-note')]
    .some((x) => x.textContent === `第 1 / 1 页 · 共 ${c} 条`), n, { timeout: 20000 });
}

for (const theme of THEMES) {
  sec(`风格 ${theme}`);
  const url = PAGE.replace('{theme}', theme);
  const page = await browser.newPage({ viewport: { width: 1360, height: 1500 } });
  const errors = [];
  const external = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location() ?? {};
    if (/favicon/i.test(m.text()) || /favicon/i.test(where.url ?? '')) return;
    // 反向用例（非法试算、越权写入）本来就打 4xx，浏览器会替 fetch 记一条资源错误；
    // 5xx 才是真出事。
    if (/status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    try {
      const h = new URL(u).hostname;
      if (h !== '127.0.0.1' && h !== 'localhost') external.push(u);
    } catch { external.push(u); }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.track-item', { timeout: 25000 });

    eq(`${theme}：data-theme 已切换`, theme, await page.evaluate(() => document.documentElement.dataset.theme));
    const counts = await page.evaluate(() => ({
      kpis: document.querySelectorAll('.kpi').length,
      tracks: document.querySelectorAll('.track-item').length,
      bills: document.querySelectorAll('.bill-row').length,
      pw: document.querySelectorAll('input[type=password]').length,
    }));
    yes(`${theme}：KPI 卡成片`, counts.kpis >= 6, `kpi=${counts.kpis}`);
    yes(`${theme}：详情轨迹已渲染`, counts.tracks >= 1, `track=${counts.tracks}`);
    yes(`${theme}：详情计费明细成表`, counts.bills >= 4, `bill=${counts.bills}`);
    eq(`${theme}：令牌框是 password 输入`, 1, counts.pw);

    // ---------- 只读交互：排序 ----------
    await page.locator('th .sortbtn').first().click();
    await page.waitForSelector('th[aria-sort="ascending"], th[aria-sort="descending"]', { timeout: 10000 });
    ok(`${theme}：点表头切换排序并回写 aria-sort`);

    // ---------- 无令牌时写按钮必须禁用 ----------
    await page.fill('#admin-token', '');
    eq(`${theme}：空令牌下开单按钮禁用`, 'true',
      String(await page.locator(`${FORM('新开运单')} button[type=submit]`).isDisabled()));
    await page.fill('#admin-token', TOKEN);

    // ---------- 试算台 ----------
    const lanes = (await api('/api/lanes')).items.filter((l) => l.active);
    const lane = lanes[0];
    const Q = 'aside.col-side form.panel-form';
    await choose(page, Q, '线路', lane.code);
    await typeIn(page, Q, '实际重', 7300);
    await typeIn(page, Q, '体积', 120000);
    await typeIn(page, Q, '最重单件', 4100);
    await typeIn(page, Q, '声明价值', 80000);
    const fragileBox = page.locator(`${Q} label.field.checkbox input[type=checkbox]`).first();
    if (!(await fragileBox.isChecked())) await fragileBox.click();
    chk(`${theme}：试算给出回执`, '试算完成', await submit(page, Q, 'ok'));
    const billText = await page.locator(`${Q} .bill`).first().innerText();
    yes(`${theme}：计费明细含体积重与续重档`, /体积重/.test(billText) && /续重/.test(billText));
    // 最重单件 > 实际重：必须逐字段回显，而不是静默改数。
    await typeIn(page, Q, '最重单件', 999999);
    const emsg = await submit(page, Q, 'err');
    yes(`${theme}：非法试算回显字段错误`,
      (await fld(page, Q, '最重单件').locator('.err').count()) > 0, emsg);

    // ---------- 开单 ----------
    const shipper = `UI回归${theme}-${stamp}`;
    const phone = '13800001234';
    const CW = FORM('新开运单');
    await typeIn(page, CW, '寄件人', shipper);
    await typeIn(page, CW, '手机号', phone);
    await submit(page, CW, 'ok');
    const created = (await api('/api/waybills?page_size=1&q=' + encodeURIComponent(shipper))).items[0];
    yes(`${theme}：新单已进列表`, created !== undefined, shipper);
    const code = created.code;
    await waitFact(page, '运单号', code);
    const f1 = await facts(page);
    eq(`${theme}：详情状态=已下单`, '已下单', f1['状态']);
    eq(`${theme}：电话只显示掩码`, '138****1234', f1['联系电话']);
    yes(`${theme}：页面文本不含手机号原文`,
      !(await page.evaluate(() => document.body.innerText)).includes(phone));
    // 第二单只验接口侧可见性：批量开单同样走这条表单。
    await typeIn(page, CW, '寄件人', shipper + '-B');
    await submit(page, CW, 'ok');
    const second = (await api('/api/waybills?page_size=1&q=' + encodeURIComponent(shipper + '-B'))).items[0];
    yes(`${theme}：连开两单号段递增`, second !== undefined && second.code > code, `${code} / ${second?.code}`);

    // ---------- 推进 → 异常 → 恢复 → 退回 ----------
    const A = FORM('登记轨迹');
    const E = FORM('上报异常');
    await choose(page, A, '推进到', 'picked_up');
    await typeIn(page, A, '打卡网点', `UI揽收网点-${theme}`);
    await submit(page, A, 'ok');
    await waitFact(page, '状态', '已揽收');
    eq(`${theme}：揽收后两条轨迹`, 2, await page.locator('.track-item').count());
    chk(`${theme}：最新轨迹带 UI 打卡网点`, `UI揽收网点-${theme}`,
      await page.locator('.track-item').first().innerText());

    await choose(page, A, '推进到', 'in_transit');
    await submit(page, A, 'ok');
    await waitFact(page, '状态', '干线运输中');

    await typeIn(page, E, '异常原因', 'UI回归：收件人电话无法接通');
    await submit(page, E, 'ok');
    await waitFact(page, '状态', '异常挂起');
    chk(`${theme}：异常原因进最新轨迹`, '收件人电话无法接通',
      await page.locator('.track-item').first().innerText());
    await choose(page, A, '推进到', 'in_transit');
    await submit(page, A, 'ok');
    await waitFact(page, '状态', '干线运输中');
    ok(`${theme}：异常单恢复推进成功`);

    await choose(page, A, '推进到', 'returned');
    await submit(page, A, 'ok');
    await waitFact(page, '状态', '已退回');
    eq(`${theme}：终态下推进选项清空`, 'true',
      String(await page.locator(`${A} select`).isDisabled()));
    eq(`${theme}：终态下异常按钮禁用`, 'true',
      String(await page.locator(`${E} button[type=submit]`).isDisabled()));

    // ---------- 新增规则 + 启停对报价的即时影响 ----------
    const R = FORM('新增附加费规则');
    const ruleCode = `UI${theme.slice(0, 6).replace(/[^A-Za-z]/g, '')}${stamp.slice(-4)}`.toUpperCase();
    await typeIn(page, R, '规则标识', ruleCode);
    await typeIn(page, R, '规则名称', `UI回归附加费${theme}`);
    await choose(page, R, '计费方式', 'heavy_piece');
    await typeIn(page, R, '单件门槛', 30000);
    await typeIn(page, R, '固定额', 1500);
    await typeIn(page, R, '优先级', 41);
    await submit(page, R, 'ok');
    const ruleOf = async () => (await api('/api/rules?all=1')).items.find((x) => x.code === ruleCode);
    yes(`${theme}：新规则已入库且默认启用`, (await ruleOf())?.active === true, ruleCode);
    const row = page.locator('table tbody tr').filter({ hasText: ruleCode }).first();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    // 启停后的读侧断言：等徽标真的翻到目标文案，而不是点完立刻读（列表刷新是一个新请求）。
    const waitBadge = async (text) => {
      await row.locator(`span.badge:has-text("${text}")`).waitFor({ state: 'visible', timeout: 20000 });
      ok(`${theme}：规则表徽标 = ${text}`);
    };
    await waitBadge('启用中');
    await row.locator('button.btn-mini').click();
    await page.waitForFunction(async (c) => {
      const r = (await (await fetch('/api/rules?all=1')).json()).items.find((x) => x.code === c);
      return r !== undefined && r.active === false;
    }, ruleCode, { timeout: 20000 });
    await waitBadge('已停用');
    // 门槛 30kg、单件 50kg：这条规则只在启用时参与仲裁。
    const quoteURL = `/api/quote?lane=${lane.code}&weight_g=60000&volume_cm3=0&heaviest_g=50000`;
    const offQuote = await api(quoteURL);
    eq(`${theme}：停用规则不进明细`, false, offQuote.items.some((i) => i.code === ruleCode));
    await row.locator('button.btn-mini').click();
    await page.waitForFunction(async (c) => {
      const r = (await (await fetch('/api/rules?all=1')).json()).items.find((x) => x.code === c);
      return r !== undefined && r.active === true;
    }, ruleCode, { timeout: 20000 });
    await waitBadge('启用中');
    const onQuote = await api(quoteURL);
    yes(`${theme}：启用后附加费立刻回到报价（${offQuote.surcharge_cents} → ${onQuote.surcharge_cents}）`,
      onQuote.items.some((i) => i.code === ruleCode) && onQuote.surcharge_cents > offQuote.surcharge_cents);

    // ---------- 搜索过滤（含 LIKE 通配符转义） ----------
    await typeIn(page, '.filters', '搜索', code);
    await waitListCount(page, 1);
    chk(`${theme}：搜索按单号收敛到一行`, code,
      await page.locator('.table').first().innerText());
    await typeIn(page, '.filters', '搜索', '%');
    await waitListCount(page, 0);
    ok(`${theme}：搜索里的 % 不被当成通配符（0 命中）`);
    await typeIn(page, '.filters', '搜索', '');
    await page.waitForFunction(() => [...document.querySelectorAll('.section-note')]
      .some((x) => /共 [1-9]/.test(x.textContent ?? '')), { timeout: 20000 });

    await page.screenshot({ path: `${SHOT}${theme}.png`, fullPage: true });
  } catch (e) {
    bad(`${theme}：流程中断`, String(e).slice(0, 300));
    try { await page.screenshot({ path: `${SHOT}${theme}-crash.png`, fullPage: true }); } catch { /* 忽略 */ }
  } finally {
    eq(`${theme}：无外部请求`, 0, external.length === 0 ? 0 : external.join(' , '));
    eq(`${theme}：控制台零报错`, 0, errors.length === 0 ? 0 : errors.join(' | '));
    await page.close();
  }
}

await browser.close();
say(`\n\u001b[1mpass=${pass} fail=${fail}\u001b[0m`);
process.exit(fail > 0 ? 1 : 0);
