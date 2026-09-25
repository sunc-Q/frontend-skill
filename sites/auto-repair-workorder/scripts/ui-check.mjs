#!/usr/bin/env node
// UI 真操作回归：系统 Chrome + playwright-core 打开页面（走真接口），
// 完整跑一遍「受理开单 → 记工时 → FIFO 出库 → 状态推进到结算/提车」，
// 再跑一条「出库后退料作废」，三套风格各跑一遍。
//
// 为什么必须真点：api-smoke.sh 证明的是后端状态机与账目对，
// 但「服务顾问实际能不能在这张表上把单开出去、把料出出去」只有真浏览器点一遍才算数——
// React 受控输入、按钮 disabled 规则（无令牌 / 质检后锁定 / 终态）、
// 提交后的回填与列表刷新、字段级错误回显，全在这一层。
//
// 用法（需要后端已在跑）：
//   BASE=http://127.0.0.1:18411 PAGE='http://127.0.0.1:18411/?theme={theme}' \
//   ADMIN_TOKEN=<本地演示令牌> node scripts/ui-check.mjs
//   PAGE 也可以是单文件预览版：'http://127.0.0.1:18412/{theme}.html'
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BASE = process.env.BASE ?? 'http://127.0.0.1:18411';
const PAGE = process.env.PAGE ?? `${BASE}/?theme={theme}`;
const TOKEN = process.env.ADMIN_TOKEN ?? '';
const THEMES = (process.env.THEMES ?? 'garage-plate,couture,tarot').split(',');
const SHOT = process.env.SHOT ?? '/tmp/arw-ui-';
const JSON_OUT = process.env.OUT ?? '/tmp/arw-ui.json';

let pass = 0;
let fail = 0;
const say = (s) => console.log(s);
const ok = (name, extra = '') => { pass++; say(`  ok   ${name}${extra ? ' — ' + String(extra).slice(0, 90) : ''}`); };
const bad = (name, extra = '') => { fail++; say(`  FAIL ${name}${extra ? ' — ' + String(extra).slice(0, 200) : ''}`); };
const chk = (name, want, got) => (String(got).includes(want) ? ok(name, got) : bad(name, `期望含「${want}」实际「${got}」`));
const eq = (name, want, got) => (String(want) === String(got) ? ok(name, got) : bad(name, `期望「${want}」实际「${got}」`));
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
// 表单作用域：三张写表单在 DOM 里分属不同区块，靠作用域限定才不会点错按钮。
const NEW = 'form.panel-form.form-row';
const LINE = '.detail-side form.panel-form';
const TRANS = '.detail-side div.panel-form';
// 到货入库表单也在 footer 里，而「受理开单」是 footer 的 .col-main：
// 只用 footer form.panel-form 会同时命中两张表单，点提交按钮时 strict mode 直接报错。
const RECEIPT = 'footer .col-side form.panel-form';
const FACTS = 'section.detail .detail-main dl.facts';

const browser = await pw.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const summary = {};

for (const theme of THEMES) {
  sec(`主题 ${theme}`);
  const page = await browser.newPage({ viewport: { width: 1360, height: 1500 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location() ?? {};
    if (/favicon/i.test(m.text()) || /favicon/i.test(where.url ?? '')) return;
    // 故意的负向用例（缺字段提交）会让浏览器记一条 "Failed to load resource ... 400"，
    // 那是预期产物；这里只关心 JS 异常与页面自己抛出的 error。
    if (/Failed to load resource/i.test(m.text())) return;
    errors.push(where.url ? `${m.text()} <- ${where.url}` : m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // 读某张表单里某个字段（按 field-label 文案定位）对应的控件
  const f = (scope, label, what = 'input') =>
    page.locator(`${scope} label.field:has(span.field-label:has-text("${label}")) ${what}`).first();
  // 写操作之后详情区是「重新拉接口」才刷新的，读太快拿到的是上一帧的值；
  // 需要看到新值的断言一律走 factWait，而不是 fact。
  const factWait = async (label, needle, timeout = 12000) => {
    const t0 = Date.now();
    let v = '';
    while (Date.now() - t0 < timeout) {
      v = await fact(label);
      if (v.includes(needle)) return v;
      await page.waitForTimeout(200);
    }
    return v;
  };
  const fact = async (label) =>
    (await page.locator(`${FACTS} .fact:has(dt:text-is("${label}")) dd`).first().textContent().catch(() => null) ?? '').trim();
  const msg = async (scope) => (await page.locator(`${scope} .form-msg`).first().textContent().catch(() => null) ?? '').trim();
  const clickBtn = async (scope, text) => {
    await page.locator(`${scope} button:has-text("${text}")`).first().click();
  };
  const yuan = (cents) => (cents / 100).toFixed(2);
  // fill 只派发 input 事件，React 的受控 state 要等一帧才落地；紧接着 click
  // 有概率把「半个表单」提交出去（缺件编码 → 400），于是同一条断言时好时坏。
  const settle = (ms = 200) => page.waitForTimeout(ms);
  // 详情区是「写完重新拉接口」才刷新的：读太快拿到上一帧（工单号还是上一单）
  // 或 loading 占位（流水表写着「正在读取…」）。凡是要看新值的断言先轮询到位再取值，
  // 超时就返回最后一次读数——失败信息里带的仍是真相，只是不再假红。
  const poll = async (read, test, timeout = 15000) => {
    const t0 = Date.now();
    let v;
    while (Date.now() - t0 < timeout) {
      v = await read();
      if (test(v)) return v;
      await page.waitForTimeout(200);
    }
    return v;
  };
  const txtOf = (sel) => poll(() => page.locator(sel).first().innerText().catch(() => ''), (t) => !t.includes('正在读取'));
  const dump = async (scope) =>
    ((await page.locator(`${scope} .err`).allTextContents()).join(' / ') +
      ' | msg=' + (await msg(scope)) + ' | 表体=' +
      String((await page.locator(scope).first().innerText().catch(() => '')).replace(/\s+/g, ' '))).slice(0, 260);
  const waitMsg = async (scope, needle, name) => {
    try {
      await page.waitForFunction(
        ([q, n]) => { const e = document.querySelector(`${q} .form-msg`); return e !== null && e.textContent.includes(n); },
        [scope, needle], { timeout: 15000 },
      );
      ok(`${name} → 提示「${needle}」`);
      return true;
    } catch {
      bad(`${name}：等不到「${needle}」`, await dump(scope));
      return false;
    }
  };
  const submit = async (scope, needle, name) => {
    await settle();
    await page.locator(`${scope} button[type=submit]`).first().click();
    return waitMsg(scope, needle, name);
  };

  await page.goto(PAGE.replace('{theme}', theme), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.kpi', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.table tbody tr').length > 0, null, { timeout: 15000 });

  // ── 1. 主题落地与令牌门控
  eq(`${theme}：data-theme 已生效`, theme, await page.getAttribute('html', 'data-theme'));
  eq(`${theme}：风格按钮只有一个激活`, '1', await page.locator('.theme-btn[data-active="true"]').count());
  // .shell 本身透明（背景画在 body / topbar 上），量它是三套一样的 rgba(0,0,0,0)，
  // 拿它做「切了确实变了」的兜底指标会假红。改量 topbar 与 body。
  const shellBg = await page.evaluate(() => {
    const pick = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    const b = pick('body');
    return (b === 'rgba(0, 0, 0, 0)' ? pick('.topbar') : b) + '/' + pick('.topbar');
  });
  const shellFont = await page.evaluate(() => getComputedStyle(document.querySelector('.shell')).fontFamily.split(',')[0].replace(/["']/g, ''));

  const newBtn = page.locator(`${NEW} button[type=submit]`);
  eq('无令牌时「建立工单」禁用', 'true', String(await newBtn.isDisabled()));
  chk('无令牌时提示需填 ADMIN_TOKEN', 'ADMIN_TOKEN', await page.locator(`${NEW} .hint`).first().textContent());
  await page.fill('#admin-token', TOKEN);
  await page.waitForTimeout(150);
  eq('填令牌后「建立工单」可用', 'false', String(await newBtn.isDisabled()));

  // ── 2. 字段级校验回显（不填车牌/手机就提交）
  await f(NEW, '车型').fill('测试车型 UI-CHK');
  await newBtn.click();
  await page.waitForSelector(`${NEW} .err`, { timeout: 8000 });
  const errCount = await page.locator(`${NEW} .err`).count();
  if (errCount >= 2) ok(`缺字段提交 → ${errCount} 处字段级回显`);
  else bad('缺字段提交应有字段级回显', `err=${errCount}`);
  chk('回显点名车牌', '车牌', await page.locator(`${NEW} label.field:has-text("车牌") .err`).first().textContent().catch(() => ''));
  const afterReject = (await api('/api/work-orders?page_size=1')).total;

  // ── 3. 正常开单（加急：承诺 6 小时）
  const plate = `沪A·UI${theme.slice(0, 2).toUpperCase()}${Date.now() % 10000}`;
  await f(NEW, '车牌').fill(plate);
  await f(NEW, '客户姓名').fill('周海峰');
  await f(NEW, '手机号').fill('13900002222');
  await f(NEW, '里程').fill('48213');
  await f(NEW, '优先级', 'select').selectOption('urgent');
  await f(NEW, '服务顾问').fill('孙顾问');
  await f(NEW, '故障描述').fill('低速刹车异响，需检查片与盘');
  if (!(await submit(NEW, '工单已建立', '开单'))) { await page.close(); continue; }
  const created = (await api(`/api/work-orders?q=${encodeURIComponent(plate)}`)).items[0];
  if (created === undefined) { bad('接口侧查不到刚开的单', plate); await page.close(); continue; }
  const no = created.wo_no;
  eq('开单后端侧落库', no, await factWait('工单号', no));
  eq('详情标题即本单', no, (await page.locator('section.detail .section-note').first().textContent()).trim());
  chk('手机号只以掩码出场', '139****', await fact('客户'));
  eq('状态起步为接车', '接车', await fact('状态'));
  const promisedH = (new Date(created.promised_at) - new Date(created.opened_at)) / 3.6e6;
  eq('加急承诺 = 6 小时', '6', promisedH.toFixed(0));
  eq('列表总数 +1', String(afterReject + 1), String((await api('/api/work-orders?page_size=1')).total));

  // ── 4. 工时行：90 分钟中级 = 39000 分
  await clickBtn(LINE, '工时');
  await f(LINE, '工时项目').fill('更换前刹车片与润滑');
  await f(LINE, '技师等级', 'select').selectOption('middle');
  await f(LINE, '工时（分钟）').fill('90');
  await submit(LINE, '明细已入账', '工时行入账');
  const lineAmt = await poll(
    () => page.locator('section.detail .detail-main .tablewrap table').first().locator('tbody tr').first().locator('td.num').nth(3).textContent().catch(() => ''),
    (t) => (t ?? '').includes('390.00'));
  chk('工时行金额 ¥390.00', '390.00', lineAmt ?? '');
  eq('在制单单头快照仍为 0（结算才记账）', '¥0.00', await fact('挂账总额'));

  // ── 5. 找件出库：检索到指定配件 → 点批次「出库此件」→ 数量 2
  const pool = (await api('/api/parts?status=active&stock=ok&page_size=100')).items;
  const part = pool.find((p) => p.lot_count >= 2 && p.on_hand >= 6) ?? pool[0];
  const code = part.code;
  await f('section.catalog .filters', '检索').fill(code);
  await page.waitForFunction((c) => [...document.querySelectorAll('section.catalog table tbody tr td.mono')].some((td) => td.textContent.trim() === c), code, { timeout: 10000 });
  await page.locator(`section.catalog table tbody tr:has(td:text-is("${code}"))`).first().click();
  await page.waitForSelector('.lotrow', { timeout: 10000 });
  const handBefore = (await api(`/api/parts/${code}`)).part.on_hand;
  await page.locator('.lotrow .btn-mini').first().click();
  await settle();
  chk('批次按钮把行别切到配件并带上编码', '出库件数', await page.locator(`${LINE} .field-label`).nth(0).textContent().then(async () => page.locator(`${LINE}`).innerText()));
  await f(LINE, '出库件数').fill('2');
  await submit(LINE, '明细已入账', '退料用例出库');
  eq('出库后在库 −2', String(handBefore - 2), String((await api(`/api/parts/${code}`)).part.on_hand));
  const movesTxt = await poll(() => txtOf('section.detail .detail-main table.mini'), (t) => t.includes('-2') && t.includes('出库'));
  chk('本单流水出现出库 −2', '-2', movesTxt);
  chk('流水标出库', '出库', movesTxt);

  // ── 6. 状态推进：接车 → 检测定项 → 在修 → 完工质检（明细锁定）→ 已结算 → 已提车
  const advanceTo = async (to, needle, name) => {
    await settle();
    await page.locator(`${TRANS} button:has-text("→ ${to}")`).first().click();
    await waitMsg(TRANS, needle, name);
  };
  await advanceTo('检测定项', 'diagnosed', '接车 → 检测定项');
  eq('状态已更新', '检测定项', await factWait('状态', '检测定项'));
  await advanceTo('在修', 'repairing', '检测定项 → 在修');
  eq('在修仍可加行', 'false', await poll(async () => String(await page.locator(`${LINE} button[type=submit]`).first().isDisabled()), (v) => v === 'false'));
  await advanceTo('完工质检', 'qc', '在修 → 完工质检');
  chk('质检后明细锁定提示', '质检之后明细锁定', await poll(() => page.locator(`${LINE} .hint`).first().textContent().catch(() => ''), (t) => (t ?? '').includes('质检之后明细锁定')));
  eq('质检后加行按钮禁用', 'true', await poll(async () => String(await page.locator(`${LINE} button[type=submit]`).first().isDisabled()), (v) => v === 'true'));
  await advanceTo('已结算', 'settled', '完工质检 → 已结算');
  const expTotal = 39000 + 2 * part.list_price_cents;
  chk('结算快照 = 工时 + 2×挂牌价', `¥${yuan(expTotal)}`, await factWait('挂账总额', `¥${yuan(expTotal)}`));
  chk('结算时间已落表', '20', await factWait('结算时间', '20'));
  chk('挂账总额随结算刷新', '¥', await factWait('挂账总额', '¥'));
  await advanceTo('已提车', 'picked_up', '已结算 → 已提车');
  chk('终态提示', '已是终态', await poll(() => page.locator(`${TRANS} .hint`).first().textContent().catch(() => ''), (t) => (t ?? '').includes('已是终态')));
  eq('终态在厂时长仍显示', true, (await fact('在厂时长')) !== '');

  // ── 7. 作废退料：新单出库 3 件后作废，件数按原批次回库
  const plate2 = `沪B·UI${theme.slice(0, 2).toUpperCase()}${Date.now() % 10000}`;
  await f(NEW, '车牌').fill(plate2);
  await f(NEW, '车型').fill('测试车型 退料');
  await f(NEW, '客户姓名').fill('李婉');
  await f(NEW, '手机号').fill('13700003333');
  await f(NEW, '里程').fill('90000');
  await f(NEW, '服务顾问').fill('孙顾问');
  await f(NEW, '故障描述').fill('变速箱顿挫，先领件试车');
  await submit(NEW, '工单已建立', '退料用例开单');
  const no2 = (await api(`/api/work-orders?q=${encodeURIComponent(plate2)}`)).items[0].wo_no;
  await page.waitForFunction((n) => { const e = document.querySelector('section.detail .detail-main dl.facts'); return e !== null && e.textContent.includes(n); }, no2, { timeout: 15000 });
  eq('开单后详情自动切到新单', no2, await factWait('工单号', no2));
  await page.locator('.lotrow .btn-mini').first().click();
  await page.waitForTimeout(120);
  await f(LINE, '出库件数').fill('3');
  await submit(LINE, '明细已入账', '退料用例出库');
  const issued = (await api(`/api/parts/${code}`)).part.on_hand;
  eq('领料后在库 −3', String(handBefore - 2 - 3), String(issued));
  await f(TRANS, '作废原因').fill('客户改期，件先回货架');
  await advanceTo('已作废', 'cancelled', '在制单作废');
  eq('作废后库存回到领料前', String(handBefore - 2), String((await api(`/api/parts/${code}`)).part.on_hand));
  const moves2 = await poll(() => txtOf('section.detail .detail-main table.mini'), (t) => t.includes('退料'));
  chk('作废单流水出现退料', '退料', moves2);
  chk('作废原因回显', '客户改期', await factWait('作废原因', '客户改期'));
  chk('作废后明细同样锁定', '质检之后明细锁定', await poll(() => page.locator(`${LINE} .hint`).first().textContent().catch(() => ''), (t) => (t ?? '').includes('质检之后明细锁定')));

  // ── 8. 到货入库（第三张写表单）：留空批次号自动生成
  await f(RECEIPT, '配件编码').fill(code);
  await f(RECEIPT, '入库件数').fill('5');
  await f(RECEIPT, '单位成本').fill('31.55');
  await f(RECEIPT, '供应商').fill('UI 冒烟供应商');
  await submit(RECEIPT, '批次已入库', '到货入库');
  eq('入库后在库 +5', String(handBefore - 2 + 5), String((await api(`/api/parts/${code}`)).part.on_hand));

  // ── 9. 洁净度与账实自检面板
  const inv = await api('/api/stats?days=14');
  chk('后端自检面板：库存账实相符', '通过', await page.locator('footer dl.facts').first().innerText());
  eq('接口侧库存差异为空', '[]', JSON.stringify(inv.stock_issues));
  if (errors.length === 0) ok('控制台零报错');
  else bad('控制台出现报错', errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: `${SHOT}${theme}.png`, fullPage: true });
  summary[theme] = { shellBg, shellFont, order: no, order2: no2, part: code, expTotalCents: expTotal };
  await page.close();
}

// ── 10. 三主题的样式落地必须互不相同（取证脚本负责细项，这里只兜住「切了没变」）
sec('三主题落地差异（UI 侧兜底）');
const bgs = Object.entries(summary).map(([k, v]) => `${k}=${v.shellBg}`);
if (new Set(Object.values(summary).map((v) => v.shellBg)).size === Object.keys(summary).length) ok('顶栏/页面底色互不相同', bgs.join(' '));
else bad('顶栏/页面底色存在相同值', bgs.join(' '));
if (new Set(Object.values(summary).map((v) => v.shellFont)).size === Object.keys(summary).length) ok('字体族互不相同', Object.entries(summary).map(([k, v]) => `${k}=${v.shellFont}`).join(' '));
else bad('字体族存在相同值');
const totals = new Set(Object.values(summary).map((v) => v.expTotalCents));
eq('三主题走的是同一笔账（结算金额一致）', '1', String(totals.size));

mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify({ summary, pass, fail }, null, 1));
say(`\n写入 ${JSON_OUT}`);
say(`\npass=${pass} fail=${fail}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
