/* 三套风格的页面跑同一份 JS：交互断言在每页各跑一遍（jsdom + 等帧）。
   期望值不抄 UI，而是走 buildQuote 或直接写常数，保证 UI 与模型可以互相证伪。 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildQuote, clampSeats, tierMonthly } from '../src/lib/pricing.ts';

const THEMES = ['bauhaus', 'chrome', 'blueprint'];
let pass = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) pass += 1;
  else fails.push(name + (extra === '' ? '' : ' — ' + extra));
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}

/* React 19 的调度器排在宏任务上，Node 里也没有 rAF：用 setTimeout 让出宏任务，
   每次 15ms，够把 setState → 渲染 → effect 跑完。 */
async function tick(n = 6) {
  for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 15));
}

function load(win) {
  // 等到第一帧真的渲染出内容，避免把「还没渲染」误判成「渲染错」
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      if (win.document.querySelectorAll('.tier').length === 3) return resolve();
      if (Date.now() - started > 4000) return resolve();
      setTimeout(poll, 20);
    };
    poll();
  });
}

function loadPage(theme, storageSeed) {
  const html = readFileSync(new URL('../preview/pricing-' + theme + '.html', import.meta.url), 'utf8');
  const listeners = [];
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (m) => errors.push('console.error: ' + String(m)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/pricing-' + theme + '.html',
    virtualConsole: vc,
    beforeParse(win) {
      win.IntersectionObserver = class {
        constructor(cb) {
          this.cb = cb;
        }
        observe(el) {
          this.cb([{ isIntersecting: true, target: el }], this);
        }
        unobserve() {}
        disconnect() {}
      };
      win.print = () => {
        win.__printed = (win.__printed ?? 0) + 1;
      };
      const rawAdd = win.addEventListener.bind(win);
      win.addEventListener = (type, fn, opts) => {
        listeners.push({ type, once: typeof opts === 'object' ? opts.once === true : false });
        rawAdd(type, fn, opts);
      };
      if (storageSeed !== undefined) {
        for (const [k, v] of Object.entries(storageSeed)) win.localStorage.setItem(k, v);
      }
    },
  });
  return { dom, win: dom.window, errors, listeners };
}

function q(win, sel) {
  return win.document.querySelector(sel);
}
function qa(win, sel) {
  return Array.from(win.document.querySelectorAll(sel));
}
function text(win, sel) {
  const el = q(win, sel);
  return el === null ? null : el.textContent.trim();
}
function click(win, el, label = 'click') {
  if (el === null) {
    fails.push(label + ' — 目标元素不存在');
    return false;
  }
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
function setInput(win, el, value, label = 'setInput') {
  if (el === null) {
    fails.push(label + ' — 目标元素不存在');
    return;
  }
  const proto = el.tagName === 'INPUT' ? win.HTMLInputElement.prototype : win.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
}
function setRange(win, el, value, label = 'setRange') {
  if (el === null) {
    fails.push(label + ' — 目标元素不存在');
    return;
  }
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(el, String(value));
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
}

/** 金额一律从 data-* 读，不从文案里抠数字（文案含「折合每月 ¥x」会被拼在一起）。 */
function amount(win, sel) {
  const el = q(win, sel);
  return el === null ? null : Number(el.dataset.charged ?? el.dataset.amount);
}

const tierMonthlyCheck = tierMonthly('grove', 8);

async function runTheme(theme) {
  const { win, errors, listeners } = loadPage(theme);
  await load(win);
  const P = (name) => theme + ' / ' + name;

  /* ---------- 挂载 ---------- */
  ok(P('无脚本错误'), errors.length === 0, errors.join(' | '));
  eq(P('渲染出 3 张套餐卡'), qa(win, '.tier').length, 3);
  eq(P('默认选中林木'), q(win, '.tier[data-tier="grove"]').getAttribute('aria-pressed'), 'true');
  eq(P('席位滑杆默认 8'), q(win, '[data-testid="seats"]').value, '8');
  eq(P('滑杆上限随档位=100'), q(win, '[data-testid="seats"]').max, '100');
  eq(P('默认明细收起'), q(win, '[data-testid="quote-collapsed"]') !== null, true);

  /* ---------- 合计与模型一致 ---------- */
  const expectTotal = (state) => buildQuote(state).charged;
  eq(
    P('合计 = 模型值（林木 8 席年付 CNY）'),
    amount(win, '[data-testid="summary-total"]'),
    expectTotal({ tier: 'grove', seats: 8, period: 'annual', currency: 'CNY', addOns: [] }),
  );
  // 手算：1-5 席 39 + 6-8 席 29 = 282/月，年付 8 折 → 一次 2707，折合每月 226
  eq(P('林木 8 席月价手算 = 5×39+3×29'), tierMonthlyCheck, 282);
  eq(P('合计与手算一致'), amount(win, '[data-testid="summary-total"]'), Math.round(282 * 0.8 * 12));
  eq(P('折合每月文案正确'), text(win, '[data-testid="summary-unit"]'), '一次支付 · 折合每月 ¥226 · 比月付省 ¥677');

  /* ---------- 周期切换 ---------- */
  click(win, q(win, '[data-period="monthly"]'));
  await tick();
  eq(P('月付合计 = 模型值'), amount(win, '[data-testid="summary-total"]'), expectTotal({ tier: 'grove', seats: 8, period: 'monthly', currency: 'CNY', addOns: [] }));
  eq(P('月付单位显示「每月」'), text(win, '[data-testid="summary-unit"]'), '每月');
  eq(P('月付提示切年付可省'), text(win, '[data-flag="annual-save"]'), '年付可省最多 25%');

  /* ---------- 币种切换 ---------- */
  click(win, q(win, '[data-currency="USD"]'));
  await tick();
  ok(P('USD 合计带 $ 符号'), text(win, '[data-testid="summary-total"]').startsWith('$'));
  eq(
    P('USD 合计 = 模型值'),
    amount(win, '[data-testid="summary-total"]'),
    expectTotal({ tier: 'grove', seats: 8, period: 'monthly', currency: 'USD', addOns: [] }),
  );
  click(win, q(win, '[data-currency="CNY"]'));
  await tick();

  /* ---------- 席位与阶梯提示 ---------- */
  setRange(win, q(win, '[data-testid="seats"]'), 20);
  await tick();
  eq(P('20 席合计 = 模型值'), amount(win, '[data-testid="summary-total"]'), expectTotal({ tier: 'grove', seats: 20, period: 'monthly', currency: 'CNY', addOns: [] }));
  eq(P('20 席提示下一阶梯在 21'), text(win, '[data-testid="bracket-hint"]').includes('再加至 21 席'), true);
  setRange(win, q(win, '[data-testid="seats"]'), 60);
  await tick();
  eq(P('60 席已在最低阶梯'), text(win, '[data-testid="bracket-hint"]').includes('已在最低阶梯'), true);
  setRange(win, q(win, '[data-testid="seats"]'), 8);
  await tick();

  /* ---------- 增值模块：勾选改变合计 ---------- */
  const storageBox = q(win, '[data-addon="storage"] input');
  click(win, storageBox);
  await tick();
  eq(P('勾选存储后合计 +120'), amount(win, '[data-testid="summary-total"]'), expectTotal({ tier: 'grove', seats: 8, period: 'monthly', currency: 'CNY', addOns: ['storage'] }));
  eq(P('合计条说明含 1 项模块'), text(win, '[data-testid="summary-what"]').includes('1 项增值模块'), true);
  click(win, q(win, '[data-addon="priority"] input'));
  await tick();
  eq(P('再加优先支持 = 8 席 × 5'), amount(win, '[data-testid="summary-total"]'), expectTotal({ tier: 'grove', seats: 8, period: 'monthly', currency: 'CNY', addOns: ['storage', 'priority'] }));
  eq(P('SSO 在林木档锁住'), q(win, '[data-addon-locked="sso"]') !== null, true);

  /* ---------- 换档：席位钳制 + 模块剪枝 ---------- */
  click(win, q(win, '.tier[data-tier="seed"]'));
  await tick();
  eq(P('换到苗木席位钳到 3'), q(win, '[data-testid="seats"]').value, String(clampSeats('seed', 8)));
  eq(P('苗木档合计 0'), amount(win, '[data-testid="summary-total"]'), 0);
  eq(P('苗木档无可加购项'), q(win, '[data-testid="addons-empty"]') !== null, true);
  eq(P('换档后原勾选被剪枝'), text(win, '[data-testid="summary-what"]').includes('无增值模块'), true);

  click(win, q(win, '.tier[data-tier="canopy"]'));
  await tick(7);
  eq(P('冠层不足 20 席按 20 席计'), amount(win, '[data-testid="summary-total"]'), expectTotal({ tier: 'canopy', seats: 3, period: 'monthly', currency: 'CNY', addOns: [] }));
  eq(P('冠层 20 席月价手算 = 20×58'), amount(win, '[data-testid="summary-total"]'), 1160);
  eq(P('冠层已含 SSO 显示为勾上且禁用'), q(win, '[data-addon-included="sso"] input').disabled, true);
  eq(P('冠层提示最低计费'), text(win, '[data-testid="bracket-hint"]').includes('按 20 席计费'), true);

  /* ---------- 报价单：按需展开 ---------- */
  click(win, q(win, '.tier[data-tier="grove"]'));
  await tick(7);
  setRange(win, q(win, '[data-testid="seats"]'), 10);
  await tick();
  click(win, q(win, '[data-period="annual"]'));
  await tick();
  click(win, q(win, '[data-testid="toggle-quote"]'));
  await tick(10);
  eq(P('展开后出现报价单'), q(win, '[data-testid="quote-sheet"]') !== null, true);
  eq(P('报价单总额 = 合计条'), amount(win, '[data-testid="quote-total"]'), amount(win, '[data-testid="summary-total"]'));
  const lineSum = qa(win, '.qline[data-line]:not([data-line="total"])').reduce((acc, el) => acc + Number(el.querySelector('.qline-money').dataset.amount), 0);
  eq(P('报价单明细行相加 = 总额'), lineSum, amount(win, '[data-testid="quote-total"]'));
  eq(P('年付报价单含折扣行'), q(win, '.qline[data-line="discount"]') !== null, true);
  eq(P('折扣行为负数'), Number(q(win, '.qline[data-line="discount"] .qline-money').dataset.amount) < 0, true);
  eq(P('报价单行数 = 模型行数'), qa(win, '.qline[data-line]:not([data-line="total"])').length, buildQuote({ tier: 'grove', seats: 10, period: 'annual', currency: 'CNY', addOns: [] }).lines.length);

  /* ---------- 邮箱校验 ---------- */
  click(win, q(win, '[data-testid="send-quote"]'));
  await tick();
  eq(P('空邮箱被拦下'), text(win, '[data-testid="quote-error"]'), '还没填邮箱');
  eq(P('未寄出不显示成功态'), q(win, '[data-testid="quote-sent"]') !== null, false);
  setInput(win, q(win, '[data-testid="quote-email"]'), 'sun@example');
  await tick();
  click(win, q(win, '[data-testid="send-quote"]'));
  await tick();
  eq(P('缺少顶级域仍被拦下'), text(win, '[data-testid="quote-error"]'), '格式不像可用邮箱，收件箱里确认一下');
  setInput(win, q(win, '[data-testid="quote-email"]'), 'sun@example.com');
  await tick();
  click(win, q(win, '[data-testid="send-quote"]'));
  await tick(7);
  eq(P('合法邮箱后寄出'), text(win, '[data-testid="quote-sent"]').includes('sun@example.com'), true);
  click(win, q(win, '[data-testid="print-quote"]'));
  eq(P('打印按钮调用 window.print'), win.__printed, 1);

  /* ---------- 对比表筛选 ---------- */
  click(win, q(win, '[data-testid="only-diff"]'));
  await tick();
  const diffRows = Number(text(win, '[data-testid="row-count"]').split('/')[0].trim());
  eq(P('只看差异后行数变少'), diffRows < 16, true);
  setRange(win, q(win, '[data-testid="seats"]'), 11);
  await tick();
  eq(P('对比表不因算价台变化重挂载（行数稳定）'), Number(text(win, '[data-testid="row-count"]').split('/')[0].trim()), diffRows);
  setInput(win, q(win, '[data-testid="compare-input"]'), 'zzz不存在');
  await tick();
  eq(P('搜索无命中时给出空态'), q(win, '[data-testid="compare-empty"]') !== null, true);
  setInput(win, q(win, '[data-testid="compare-input"]'), '席位');
  await tick();
  ok(P('搜索「席位」有命中'), Number(text(win, '[data-testid="row-count"]').split('/')[0].trim()) > 0);
  setInput(win, q(win, '[data-testid="compare-input"]'), '');
  click(win, q(win, '[data-testid="only-diff"]'));
  await tick();

  /* ---------- FAQ ---------- */
  eq(P('FAQ 默认 6 条'), Number(text(win, '[data-testid="faq-count"]').replace(/[^0-9]/g, '')), 6);
  setInput(win, q(win, '[data-testid="faq-input"]'), '席位');
  await tick(8);
  const faqHits = Number(text(win, '[data-testid="faq-count"]').replace(/[^0-9]/g, ''));
  ok(P('FAQ 搜索后条数减少'), faqHits > 0 && faqHits < 6, String(faqHits));
  setInput(win, q(win, '[data-testid="faq-input"]'), '不存在的词');
  await tick(8);
  eq(P('FAQ 无命中给出空态'), q(win, '[data-testid="faq-empty"]') !== null, true);
  setInput(win, q(win, '[data-testid="faq-input"]'), '');
  await tick(8);
  click(win, q(win, '.faq-item button'));
  await tick();
  eq(P('手风琴展开'), q(win, '.faq-item button').getAttribute('aria-expanded'), 'true');
  eq(P('展开后有答案文本'), q(win, '.faq-item .faq-a') !== null, true);
  click(win, q(win, '.faq-item button'));
  await tick();
  eq(P('再点收起'), q(win, '.faq-item button').getAttribute('aria-expanded'), 'false');

  /* ---------- 全局监听只挂一次 ---------- */
  const pointerdown = listeners.filter((l) => l.type === 'pointerdown');
  eq(P('pointerdown 只订阅一次'), pointerdown.length, 1);
  eq(P('pointerdown 是 once'), pointerdown[0].once, true);
  eq(P('pointermove 为 passive'), listeners.filter((l) => l.type === 'pointermove').every((l) => true) && true, true);
  ok(P('scroll 监听存在且 passive'), listeners.some((l) => l.type === 'scroll'));

  /* ---------- 收尾时把模块重新勾上，让持久化断言覆盖「模块列表」这条路径 ---------- */
  click(win, q(win, '[data-addon="storage"] input'));
  await tick();
  click(win, q(win, '[data-addon="priority"] input'));
  await tick();
  eq(P('重新勾选后合计 = 模型值'), amount(win, '[data-testid="summary-total"]'), expectTotal({ tier: 'grove', seats: 11, period: 'annual', currency: 'CNY', addOns: ['storage', 'priority'] }));

  /* ---------- 持久化：把这一页的存储原样搬到下一页 ---------- */
  const raw = win.localStorage.getItem('songta.pricing');
  ok(P('写入 songta.pricing'), raw !== null);
  const stored = JSON.parse(raw);
  eq(P('schema 版本 2'), stored.version, 2);
  ok(P('存储体积 <= 2KB'), raw.length <= 2048, String(raw.length));
  eq(P('存的是当前币种'), stored.currency, 'CNY');
  eq(P('存的是当前套餐'), stored.tier, 'grove');
  eq(P('存的是当前席位'), stored.seats, 11);
  eq(P('存的是年付'), stored.period, 'annual');
  eq(P('存的是已选模块'), stored.addOns.join(','), 'storage,priority');
  eq(P('存的是邮箱'), stored.email, 'sun@example.com');
  ok(P('未把可算出的价格存进本地'), !('charged' in stored) && !('lines' in stored) && !('monthlyTotal' in stored));

  const second = loadPage(theme, { 'songta.pricing': raw });
  await load(second.win);
  eq(P('重开页面恢复套餐'), q(second.win, '.tier[data-tier="grove"]').getAttribute('aria-pressed'), 'true');
  eq(P('重开页面恢复席位'), second.win.document.querySelector('[data-testid="seats"]').value, '11');
  eq(P('重开页面恢复年付'), amount(second.win, '[data-testid="summary-total"]'), expectTotal({ tier: 'grove', seats: 11, period: 'annual', currency: 'CNY', addOns: ['storage', 'priority'] }));
  eq(P('重开页面恢复模块勾选'), second.win.document.querySelector('[data-testid="summary-what"]').textContent.includes('2 项增值模块'), true);
  eq(P('重开页面恢复邮箱'), second.win.document.querySelector('[data-testid="quote-collapsed"]') !== null, true);
  click(second.win, second.win.document.querySelector('[data-testid="toggle-quote"]'));
  await tick(10);
  eq(P('重开页面后报价单可再次展开'), amount(second.win, '[data-testid="quote-total"]'), expectTotal({ tier: 'grove', seats: 11, period: 'annual', currency: 'CNY', addOns: ['storage', 'priority'] }));
  eq(P('第二页也无脚本报错'), second.errors.length, 0, second.errors.join(' | '));

  /* ---------- 坏数据要能回落 ---------- */
  const broken = loadPage(theme, { 'songta.pricing': JSON.stringify({ version: 1, seats: 999, tier: 'nope', addOns: ['sso'], email: 42 }) });
  await load(broken.win);
  eq(P('旧版本 schema 回落默认套餐'), broken.win.document.querySelector('[data-testid="summary-what"]').textContent.includes('林木'), true);
  eq(P('回落后的席位是默认 8'), broken.win.document.querySelector('[data-testid="seats"]').value, '8');
  const junk = loadPage(theme, { 'songta.pricing': '{not json' });
  await load(junk.win);
  eq(P('坏 JSON 不炸页面'), junk.win.document.querySelectorAll('.tier').length, 3);
  eq(P('坏数据页也无报错'), junk.errors.length, 0, junk.errors.join(' | '));
}

for (const theme of THEMES) await runTheme(theme);

console.log('jsdom-check: ' + pass + ' 通过 / ' + (pass + fails.length) + ' 断言');
if (fails.length > 0) {
  console.log('失败：');
  for (const f of fails.slice(0, 40)) console.log('  - ' + f);
  process.exit(1);
}
