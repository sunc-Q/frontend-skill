#!/usr/bin/env node
// UI 真操作回归：系统 Chrome + playwright-core 打开页面（走真接口），三套风格各完整跑一遍
// 「试算 → 开充 → 故障 → 补结算 → 弃单 → 新增规则 → 启停影响报价 → 搜索 → 桩状态守卫」，
// 并把只读面（排序、脱敏、外链、控制台报错）一起断言掉。
//
// 为什么必须真点：api-smoke.sh 证明的是后端状态机与计费口径对，
// 但「运营人员能不能在这张界面上把这单推下去」只有真浏览器点一遍才算数——
// React 受控输入、按钮 disabled 规则（无令牌 / 终态）、提交后的详情回填与列表刷新、
// 字段级错误回显，全在这一层。
//
// 用法（需要后端已在跑，且库是刚灌过种子的干净库）：
//   BASE=http://127.0.0.1:18501 PAGE='http://127.0.0.1:18501/?theme={theme}' \
//   ADMIN_TOKEN=<本地演示令牌> node scripts/ui-check.mjs
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BASE = process.env.BASE ?? 'http://127.0.0.1:18501';
const PAGE = process.env.PAGE ?? `${BASE}/?theme={theme}`;
const TOKEN = process.env.ADMIN_TOKEN ?? '';
const THEMES = (process.env.THEMES ?? 'flight-board,watch-dial,botanical-plate').split(',');
const SHOT = process.env.SHOT ?? '/tmp/fco-ui-';

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
const FORM = (title) => `form.panel-form:has(.form-title:text-is("${title}"))`;
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
// （「车牌」的下拉里也有别的字段文案，first() 就选到了一个没有 input 的 label）。
const fld = (page, scope, label) =>
  page.locator(`${scope} label.field:has(.field-label:text-is("${label}"))`).first();
async function typeIn(page, scope, label, value) {
  await fld(page, scope, label).locator('input').fill(String(value));
}
async function choose(page, scope, label, value) {
  await fld(page, scope, label).locator('select').selectOption({ value });
}
// 提交 + 等回执：给旧消息打上标记，只认「没有标记的新节点」。
// 表单都会先把 message 置空（节点卸载后重建），靠 data-kind 直接等会读到上一轮残留的「操作已完成」。
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
// 状态机按钮是 type=button（同一个表单里两个动作），只能按文案点。
async function clickBtn(page, scope, text, kind) {
  const form = page.locator(scope).first();
  await form.evaluate((el) => {
    const m = el.querySelector('p.form-msg');
    if (m !== null) m.setAttribute('data-ui-stale', '1');
  });
  await form.locator(`button:has-text("${text}")`).first().click();
  const loc = form.locator(`p.form-msg[data-kind="${kind}"]:not([data-ui-stale])`);
  await loc.waitFor({ state: 'visible', timeout: 20000 });
  return String(await loc.textContent());
}
// 列表计数读台账那节的「共 N 条」，比数 DOM 行数可靠（各表共用 .table）。
async function waitListCount(page, n) {
  await page.waitForFunction((c) => [...document.querySelectorAll('.section-note')]
    .some((x) => (x.textContent ?? '').includes(`共 ${c} 条`)), n, { timeout: 20000 });
}
const money = (s) => Math.round(Number(String(s).replace(/[^\d.]/g, '')) * 100);

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
    await page.waitForSelector('.kpi', { timeout: 25000 });
    await page.waitForSelector('.table tbody tr', { timeout: 25000 });

    eq(`${theme}：data-theme 已切换`, theme, await page.evaluate(() => document.documentElement.dataset.theme));
    const counts = await page.evaluate(() => ({
      kpis: document.querySelectorAll('.kpi').length,
      tracks: document.querySelectorAll('.bar-track').length,
      badges: document.querySelectorAll('.badge').length,
      tabs: document.querySelectorAll('.theme-btn').length,
      pw: document.querySelectorAll('input[type=password]').length,
    }));
    yes(`${theme}：KPI 卡成片`, counts.kpis >= 6, `kpi=${counts.kpis}`);
    yes(`${theme}：趋势条形成图`, counts.tracks >= 2, `bar=${counts.tracks}`);
    yes(`${theme}：状态徽标成片`, counts.badges >= 6, `badge=${counts.badges}`);
    eq(`${theme}：风格切换钮三枚`, 3, counts.tabs);
    eq(`${theme}：令牌框是 password 输入`, 1, counts.pw);
    eq(`${theme}：恒等式条判定为真`, 'true',
      await page.evaluate(() => document.querySelector('.identity')?.dataset.ok));

    // ---------- 风格切换：点按钮换的是 CSS，DOM 结构必须一格不动 ----------
    // 色卡 svg 每套主题的子节点数本来就不同，同构性只量结构层（svg 内部除外）。
    const shape = () => page.evaluate(() =>
      [...document.querySelectorAll('.shell *')].filter((e) => e.closest('svg') === null).length);
    const domBefore = await shape();
    const idx = THEMES.indexOf(theme);
    await page.locator('.theme-btn').nth((idx + 1) % THEMES.length).click();
    await page.waitForFunction((t) => document.documentElement.dataset.theme !== t, theme, { timeout: 15000 });
    const switched = await page.evaluate(() => document.documentElement.dataset.theme);
    yes(`${theme}：点风格按钮确实换了主题`, switched !== theme, `${theme} → ${switched}`);
    eq(`${theme}：换风格不动 DOM 结构`, domBefore, await shape());
    // 切回本主题：后面的断言都按这一主题的语义读（虽然只换 CSS）。
    await page.locator('.theme-btn').nth(idx).click();
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 15000 });

    // ---------- 只读交互：排序 ----------
    await page.locator('th .sortbtn').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('.sortmark')]
      .some((x) => (x.textContent ?? '').trim() !== ''), { timeout: 10000 });
    ok(`${theme}：点表头后排序箭头亮起`);
    const mark1 = await page.locator('th .sortbtn .sortmark').first().textContent();
    await page.locator('th .sortbtn').first().click();
    await page.waitForFunction((prev) => [...document.querySelectorAll('.sortmark')]
      .some((x) => (x.textContent ?? '') !== prev), mark1, { timeout: 10000 });
    ok(`${theme}：再点同列翻向（${mark1?.trim()} → 反向）`);

    // ---------- 无令牌时写按钮必须禁用 ----------
    await page.locator('.tokenbox input').fill('');
    eq(`${theme}：空令牌下开充按钮禁用`, 'true',
      String(await page.locator(`${FORM('新建开充')} button[type=submit]`).isDisabled()));
    eq(`${theme}：空令牌下规则表单禁用`, 'true',
      String(await page.locator(`${FORM('新增分时规则')} button[type=submit]`).isDisabled()));
    await page.locator('.tokenbox input').fill(TOKEN);

    // ---------- 试算台：报价必须与接口逐分一致 ----------
    const pilesAll = (await api('/api/piles')).items;
    const pile = pilesAll.filter((p) => p.status === 'online' && p.open_sessions === 0 && p.type === 'dc')
      .sort((a, b) => b.power_kw - a.power_kw)[0];
    const Q = FORM('分时计价试算');
    await choose(page, Q, '充电桩', pile.code);
    await typeIn(page, Q, '电量（Wh）', 30000);
    await typeIn(page, Q, '时长（分钟）', 180);
    await typeIn(page, Q, '超时占桩（分钟）', 30);
    chk(`${theme}：试算给出回执`, '操作已完成', await submit(page, Q, 'ok'));
    const billText = await page.locator(`${Q} .bill`).first().innerText();
    yes(`${theme}：报价里有分时拆分与合计行`,
      /峰/.test(billText) && /电费/.test(billText) && /=/.test(billText));
    chk(`${theme}：报价自带恒等式自检`, '恒等式自检通过', billText);
    const qApi = await api(`/api/quote?pile=${pile.code}&wh=30000&minutes=180&overstay_min=30`);
    const shownTotal = money((await page.locator(`${Q} .bill-total-val`).first().innerText()).split('=').pop());
    eq(`${theme}：界面总额 = 接口总额（分）`, qApi.total_cents, shownTotal);
    eq(`${theme}：界面超时费 = 分钟×8`, 30 * 8, qApi.overstay_cents);
    eq(`${theme}：分段瓦时之和 = 报价电量`, 30000,
      qApi.segments.reduce((a, s) => a + s.wh, 0) + qApi.unpriced_wh);
    // 超物理量程的电量：input 上的 min/max 先把提交挡在浏览器层（原生校验，不发请求）。
    await typeIn(page, Q, '电量（Wh）', 99999999);
    const vm = await fld(page, Q, '电量（Wh）').locator('input')
      .evaluate((n) => `${n.validity.rangeOverflow}:${n.validationMessage}`);
    yes(`${theme}：超范围试算被表单挡下（不发请求）`, vm.startsWith('true:'), vm);
    eq(`${theme}：挡下后页面无错误回执`, 0, await page.locator(`${Q} p.form-msg[data-kind="err"]`).count());
    await typeIn(page, Q, '电量（Wh）', 30000);

    // ---------- 开充 → 故障 → 补结算 ----------
    const vehicles = (await api('/api/vehicles?all=1')).items
      .filter((v) => v.active && v.battery_kwh * 1000 >= 30000);
    const openList = (await api('/api/sessions?open=1&page_size=100')).items;
    const busyPlates = new Set(openList.map((s) => s.plate_no));
    const plate = vehicles.find((v) => !busyPlates.has(v.plate_no));
    const plate2 = vehicles.find((v) => !busyPlates.has(v.plate_no) && v.plate_no !== plate?.plate_no);
    const piles2 = pilesAll.filter((p) => p.status === 'online' && p.open_sessions === 0);
    const pile2 = piles2.find((p) => p.code !== pile?.code);
    if (!plate || !plate2 || !pile || !pile2) { bad(`${theme}：没有两套空闲桩车`, '无法验证生命周期'); continue; }

    const S = FORM('新建开充');
    await choose(page, S, '充电桩', pile.code);
    await choose(page, S, '车牌', plate.plate_no);
    await typeIn(page, S, '计划电量（Wh）', 30000);
    await typeIn(page, S, '备注', `UI回归·${theme}`);
    chk(`${theme}：开充成功`, '操作已完成', await submit(page, S, 'ok'));
    const created = (await api(`/api/sessions?plate=${plate.plate_no}&open=1&page_size=1`)).items[0];
    yes(`${theme}：新会话已入库并回填详情`, created !== undefined, created?.code);
    await waitFact(page, '会话编号', created.code);
    const f1 = await facts(page);
    chk(`${theme}：详情状态=充电中`, '充电中', f1['状态']);
    chk(`${theme}：详情桩位带功率`, `${pile.code} ·`, f1['桩位']);
    chk(`${theme}：司机电话只显示掩码`, '****', f1['司机']);
    yes(`${theme}：未结算时没有计费明细`,
      (await page.locator(`${FORM('结算会话')} button[type=submit]`).isDisabled()) === false,
      '结算按钮对在充会话可用');

    const A = FORM('异常处置');
    await typeIn(page, A, '原因', `UI回归：枪座过温 ${theme}`);
    chk(`${theme}：登记故障成功`, '操作已完成', await clickBtn(page, A, '登记故障', 'ok'));
    await waitFact(page, '状态', '故障挂起');
    eq(`${theme}：故障挂起仍占桩`, 1,
      (await api(`/api/sessions?plate=${plate.plate_no}&open=1&page_size=5`)).items.length);

    const SF = FORM('结算会话');
    // 满功率 1 分钟也吃不下 600 kWh：这条越界 input 挡不住，必须靠后端物理上限复核并逐字段回显。
    await typeIn(page, SF, '实际电量（Wh）', 600000);
    const semsg = await submit(page, SF, 'err');
    yes(`${theme}：超物理电量结算被拒且回显字段`,
      (await fld(page, SF, '实际电量（Wh）').locator('.err').count()) > 0 || /actual_wh/.test(semsg), semsg);
    const actWh = Math.max(200, Math.floor(pile.power_kw * 500 / 60));
    await typeIn(page, SF, '实际电量（Wh）', actWh);
    await typeIn(page, SF, '超时占桩（分钟，封顶 360）', 12);
    chk(`${theme}：故障单补结算成功`, '操作已完成', await submit(page, SF, 'ok'));
    await waitFact(page, '状态', '已结算');
    const settled = await api(`/api/sessions/${created.code}`);
    const segWh = settled.segments.reduce((a, s) => a + s.wh, 0);
    eq(`${theme}：补结算后分段和=实际电量`, actWh, segWh + settled.seg_unpriced_wh);
    eq(`${theme}：总额=电+服+超时`,
      settled.elec_cents + settled.service_cents + settled.overstay_cents, settled.total_cents);
    eq(`${theme}：超时分=分钟×8`, 12 * 8, settled.overstay_cents);
    yes(`${theme}：一分钟内结算也出账（补结算不再是 0 元）`, settled.total_cents > 0, `${settled.total_cents} 分`);
    // 详情区与试算区共用 .bill-total-val，所以只断言「页面上有一处复述了这笔账」。
    yes(`${theme}：界面合计行复述同一笔账`,
      await page.evaluate((t) => [...document.querySelectorAll('.bill-total-val')]
        .some((x) => (x.textContent ?? '').includes(t)), (settled.total_cents / 100).toFixed(2)),
      `${(settled.total_cents / 100).toFixed(2)} 元`);

    // ---------- 终态锁死 ----------
    eq(`${theme}：终态下结算按钮禁用`, 'true',
      String(await page.locator(`${SF} button[type=submit]`).isDisabled()));
    eq(`${theme}：终态下故障按钮禁用`, 'true',
      String(await page.locator(`${A} button:has-text("登记故障")`).isDisabled()));
    eq(`${theme}：终态下弃单按钮禁用`, 'true',
      String(await page.locator(`${A} button:has-text("弃单作废")`).isDisabled()));

    // ---------- 弃单链路：开充 → 故障 → 弃单 → 释放桩车 ----------
    await choose(page, S, '充电桩', pile2.code);
    await choose(page, S, '车牌', plate2.plate_no);
    await typeIn(page, S, '备注', `UI弃单·${theme}`);
    await submit(page, S, 'ok');
    const doomed = (await api(`/api/sessions?plate=${plate2.plate_no}&open=1&page_size=1`)).items[0];
    await waitFact(page, '会话编号', doomed.code);
    await typeIn(page, A, '原因', `UI回归：紧急调线 ${theme}`);
    await clickBtn(page, A, '登记故障', 'ok');
    await waitFact(page, '状态', '故障挂起');
    await clickBtn(page, A, '弃单作废', 'ok');
    await waitFact(page, '状态', '已弃单');
    const aborted = await api(`/api/sessions/${doomed.code}`);
    yes(`${theme}：弃单清空金额与电量`,
      aborted.total_cents === 0 && aborted.actual_wh === 0 && aborted.segments.length === 0,
      `${aborted.total_cents} 分 / ${aborted.actual_wh} Wh`);
    chk(`${theme}：弃单原因进备注`, '弃单：UI回归：紧急调线',
      await page.locator('.detail-main .hint').first().innerText());
    eq(`${theme}：弃单后释放该桩`, 0,
      (await api('/api/piles')).items.find((p) => p.code === pile2.code).open_sessions);

    // ---------- 新增规则 + 启停对报价的即时影响 ----------
    // 基线必须在建新规则之前取：这条规则是 priority=1 的全天价，一旦启用就接管所有报价。
    const R = FORM('新增分时规则');
    const ruleCode = `UI${stamp}${theme.slice(0, 3).toUpperCase()}`;
    const probe = `/api/quote?pile=${pile.code}&wh=20000&minutes=120&overstay_min=0`;
    const baseQuote = await api(probe);
    await typeIn(page, R, '标识 code', ruleCode);
    await typeIn(page, R, '名称', `UI回归全天价${theme}`);
    await choose(page, R, '档位', 'peak');
    await choose(page, R, '日期类型', 'any');
    await typeIn(page, R, '开始（分钟）', 0);
    await typeIn(page, R, '结束（分钟）', 1440);
    await typeIn(page, R, '电价（分/kWh）', 300);
    await typeIn(page, R, '服务费（分/kWh）', 200);
    await typeIn(page, R, '优先级', 1);
    chk(`${theme}：新规则创建成功`, '操作已完成', await submit(page, R, 'ok'));
    const ruleOf = async () => (await api('/api/tariffs?all=1')).items.find((x) => x.code === ruleCode);
    yes(`${theme}：新规则已入库且默认启用`, (await ruleOf())?.active === true, ruleCode);
    const row = page.locator('table tbody tr').filter({ hasText: ruleCode }).first();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    const waitActive = async (want) => {
      await page.waitForFunction(async ([c, a]) => {
        const r = (await (await fetch('/api/tariffs?all=1')).json()).items.find((x) => x.code === c);
        return r !== undefined && r.active === a;
      }, [ruleCode, want], { timeout: 20000 });
      // 读侧断言：等徽标真的翻到目标文案（列表刷新是一个新请求，点完立刻读会读到旧的）。
      await row.locator(`span.badge:has-text("${want ? '启用' : '停用'}")`)
        .waitFor({ state: 'visible', timeout: 20000 });
      ok(`${theme}：规则表徽标 = ${want ? '启用' : '停用'}`);
    };
    const toggle = async () => { await row.locator('button.btn-mini').click(); };
    await waitActive(true);
    const onQuote = await api(probe);
    yes(`${theme}：高优先级规则立刻接管报价（${baseQuote.total_cents} → ${onQuote.total_cents} 分）`,
      onQuote.total_cents > baseQuote.total_cents
      && onQuote.segments.every((s) => s.rule_code === ruleCode),
      onQuote.segments.map((s) => s.rule_code).join(','));
    await toggle();
    await waitActive(false);
    const offQuote = await api(probe);
    yes(`${theme}：停用后报价逐分回到基线（${offQuote.total_cents} vs ${baseQuote.total_cents} 分）`,
      offQuote.total_cents === baseQuote.total_cents
      && offQuote.segments.map((s) => s.rule_code).join(',') === baseQuote.segments.map((s) => s.rule_code).join(','));
    await toggle();
    await waitActive(true);
    yes(`${theme}：再启用又回到新价`, (await api(probe)).total_cents === onQuote.total_cents);
    // 收尾停用：这条 priority=1 的全天价留着会把后面两套风格的报价全带跑。
    await toggle();
    await waitActive(false);

    // ---------- 搜索过滤（含 LIKE 通配符转义） ----------
    await typeIn(page, '.filters', '关键字', created.code);
    await waitListCount(page, 1);
    chk(`${theme}：搜索按会话号收敛到一行`, created.code,
      await page.locator('.table').first().innerText());
    await typeIn(page, '.filters', '关键字', '%');
    await page.waitForSelector('.empty', { timeout: 20000 });
    ok(`${theme}：搜索里的 % 不被当成通配符（空结果）`);
    await typeIn(page, '.filters', '关键字', `UI回归·${theme}`);
    await page.waitForSelector('.empty', { timeout: 20000 });
    ok(`${theme}：备注文本不参与搜索（隐私与口径一致）`);
    await typeIn(page, '.filters', '关键字', plate.plate_no);
    await page.waitForFunction(() => [...document.querySelectorAll('.section-note')]
      .some((x) => /共 [1-9]/.test(x.textContent ?? '')), { timeout: 20000 });
    ok(`${theme}：按车牌搜索有命中`);
    await typeIn(page, '.filters', '车牌（精确）', plate.plate_no);
    await waitListCount(page, (await api(`/api/sessions?plate=${plate.plate_no}&page_size=1`)).total);
    ok(`${theme}：车牌精确筛选与接口计数一致`);
    await typeIn(page, '.filters', '关键字', '');
    await typeIn(page, '.filters', '车牌（精确）', '');

    // ---------- 桩状态守卫：有未关闭会话的桩不能切离在线 ----------
    const busyPile = (await api('/api/piles')).items.find((p) => p.open_sessions > 0);
    const P = FORM('桩位状态切换');
    if (busyPile !== undefined) {
      await choose(page, P, '充电桩', busyPile.code);
      await choose(page, P, '目标状态', 'maintenance');
      const msg = await submit(page, P, 'err');
      chk(`${theme}：在充桩切维保被拒并回显码`, 'pile_busy', msg);
    } else {
      bad(`${theme}：找不到未关闭会话占用的桩`, '守卫断言没内容');
    }
    const freePile = (await api('/api/piles')).items
      .filter((p) => p.status === 'online' && p.open_sessions === 0)
      .sort((a, b) => b.power_kw - a.power_kw)[0];
    await choose(page, P, '充电桩', freePile.code);
    await choose(page, P, '目标状态', 'maintenance');
    await typeIn(page, P, '备注', `UI回归年检${theme}`);
    chk(`${theme}：空闲桩可切维保`, '操作已完成', await submit(page, P, 'ok'));
    await page.waitForFunction(async (c) => {
      const p = (await (await fetch('/api/piles')).json()).items.find((x) => x.code === c);
      return p !== undefined && p.status === 'maintenance';
    }, freePile.code, { timeout: 20000 });
    ok(`${theme}：切维保后读侧状态同步`);
    await choose(page, P, '目标状态', 'online');
    await submit(page, P, 'ok');
    await page.waitForFunction(async (c) => {
      const p = (await (await fetch('/api/piles')).json()).items.find((x) => x.code === c);
      return p !== undefined && p.status === 'online';
    }, freePile.code, { timeout: 20000 });
    ok(`${theme}：桩位可切回在线`);

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
