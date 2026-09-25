/* 三风格单文件页（file:// → fixture 传输）跑同一套交互断言。
   关注点：Suspense 逐级补全、defer 取数只在需要时发生、乐观更新与回滚、持久化、XSS 防护。
   时序策略：jsdom 的 setTimeout 受事件循环挤压（实测 20ms 定时器可漂移到数百 ms），
   所以除「乐观必须赶在服务端确认前」这类有上下界含义的检查外，一律条件轮询而非固定 sleep。 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const THEMES = ['deco', 'vapor', 'riso'];
let pass = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) pass += 1;
  else fails.push(name + (extra === '' ? '' : ' — ' + extra));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const started = Date.now();
  for (;;) {
    let v = false;
    try {
      v = fn();
    } catch {
      v = false;
    }
    if (v) return true;
    if (Date.now() - started > ms) return false;
    await sleep(4);
  }
}

function loadPage(theme, seed) {
  const html = readFileSync(new URL('../preview/activity-' + theme + '.html', import.meta.url), 'utf8');
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', (m) => errors.push('console.error: ' + String(m)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'file:///preview/activity-' + theme + '.html',
    virtualConsole: vc,
    beforeParse(win) {
      // jsdom 在 file:// 源上禁用 localStorage（SecurityError）：注入 Map 桩，保持 API 形状
      const mem = new Map();
      Object.defineProperty(win, 'localStorage', {
        value: {
          getItem: (k) => (mem.has(k) ? mem.get(k) : null),
          setItem: (k, v) => mem.set(k, String(v)),
          removeItem: (k) => mem.delete(k),
          clear: () => mem.clear(),
        },
        configurable: true,
      });
      if (seed) {
        for (const [k, v] of Object.entries(seed)) win.localStorage.setItem(k, v);
      }
    },
  });
  return { win: dom.window, errors };
}

const q = (win, sel) => win.document.querySelector(sel);
const qa = (win, sel) => Array.from(win.document.querySelectorAll(sel));
const txt = (win, sel) => {
  const el = q(win, sel);
  return el === null ? null : el.textContent.trim();
};
function click(win, el, label) {
  if (el === null) {
    fails.push(label + ' — 目标元素不存在');
    return false;
  }
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
function setInput(win, el, value, label) {
  if (el === null) {
    fails.push(label + ' — 目标元素不存在');
    return;
  }
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
}
const countReq = (win, path) => (win.__reqs ?? []).filter((r) => r.path === path).length;
const votesOf = (win, id) => {
  const el = q(win, '[data-artist=' + id + '] [data-votes]');
  return el === null ? null : Number(el.dataset.votes);
};

async function suite(theme) {
  const P = theme + ': ';
  const { win, errors } = loadPage(theme, null);
  /* --- 流式补全：首 commit 只出顶栏与骨架（数据 fixture 有延迟） --- */
  const booted = await waitFor(() => q(win, '[data-testid=topbar]') !== null);
  ok(P + '首帧: 顶栏已渲染', booted);
  ok(P + '首帧: hero 骨架在', q(win, '[data-testid=hero-skeleton]') !== null);
  ok(P + '首帧: lineup 骨架在', q(win, '[data-testid=lineup-skeleton]') !== null);
  ok(P + '首帧: schedule 骨架在', q(win, '[data-testid=schedule-skeleton]') !== null);
  /* 等到 KPI 出现再核数值（轮询，不赌固定 sleep） */
  ok(P + 'summary 就绪: KPI 出现', await waitFor(() => q(win, '[data-signed]') !== null));
  eq(P + '已报名初值', txt(win, '[data-signed]'), '12,483');
  eq(P + '余票槽位', txt(win, '[data-remain-slot]'), '642');
  ok(P + 'lineup 就绪: 12 张卡', await waitFor(() => qa(win, '.artist[data-artist]').length === 12));
  eq(P + '骨架全部退场', qa(win, '[data-testid*=skeleton]').length, 0);
  eq(P + 'countdown 格子', qa(win, '.cd-cell').length, 4);
  eq(P + 'nav 链接', qa(win, '.nav-link').length, 4);
  eq(P + 'fri 日程 7 场', qa(win, '[data-testid=day-fri] .slot').length, 7);
  /* --- 去重：hero 与 register 共享同一 summary 资源，仅 1 次请求 --- */
  eq(P + 'dedup: /api/summary 仅一次请求', countReq(win, '/api/summary'), 1);
  eq(P + 'dedup: /api/schedule 仅一次请求', countReq(win, '/api/schedule'), 1);
  /* --- async-defer-await：notices 与 vip 库存都不该在触达前发请求 --- */
  eq(P + 'defer: 未点须知前 0 次 notices', countReq(win, '/api/notices'), 0);
  eq(P + 'defer: 未选 VIP 前 0 次 vip 库存', countReq(win, '/api/tickets/vip'), 0);
  click(win, q(win, '[data-tab=notices]'), P + '点须知 tab');
  /* 加载中或须知已到位都算分支生效；请求必须恰好 1 次 */
  ok(P + 'notices: 分支渲染出内容', await waitFor(() => qa(win, '.notice').length > 0 || txt(win, '[data-testid=notices-loading]') !== null));
  ok(P + 'notices: 4 条须知到位', await waitFor(() => qa(win, '.notice').length === 4));
  eq(P + 'notices: 恰 1 次请求', countReq(win, '/api/notices'), 1);
  click(win, q(win, '[data-tab=sat]'), P + '点 sat');
  ok(P + 'sat 日程 11 场', await waitFor(() => qa(win, '[data-testid=day-sat] .slot').length === 11));
  click(win, q(win, '[data-tab=notices]'), P + '再点须知');
  await waitFor(() => qa(win, '.notice').length === 4);
  eq(P + 'notices: 二次打开不再请求', countReq(win, '/api/notices'), 1);
  /* --- VIP 分支取数 --- */
  click(win, q(win, '[data-tier=vip]'), P + '点 VIP 档');
  ok(P + 'vip: 前区余 46 席到位', await waitFor(() => txt(win, '[data-testid=vip-left]') === '前区余 46 席'));
  eq(P + 'vip: 恰好 1 次请求', countReq(win, '/api/tickets/vip'), 1);
  /* --- 投票乐观：+1 必须出现在 fixture 响应（≥60ms）之前 → 轮询上限压到 45ms --- */
  const votesBefore = votesOf(win, 'a01');
  click(win, q(win, '[data-vote=a01]'), P + '投 a01');
  ok(P + 'vote: 乐观 +1 先于服务端到达', await waitFor(() => votesOf(win, 'a01') === votesBefore + 1, 45));
  ok(P + 'vote: 按钮变已投票', await waitFor(() => txt(win, '[data-vote=a01]') === '已投票'));
  await sleep(200);
  eq(P + 'vote: 服务端确认后数值不回跳', votesOf(win, 'a01'), votesBefore + 1);
  const prefs = JSON.parse(win.localStorage.getItem('soundisle.prefs.v1') ?? '{}');
  ok(P + 'vote: 偏好落库含 a01', Array.isArray(prefs.data?.voted) && prefs.data.voted.includes('a01'));
  /* --- 排序：人气序 ≠ 官宣序（a05 票数 2714 高于 a03 的 2218） --- */
  const votesOrder = q(win, '[data-testid=lineup]').dataset.order;
  ok(P + '人气序: a05 排在 a03 前', votesOrder.indexOf('a05') < votesOrder.indexOf('a03'), votesOrder);
  click(win, q(win, '[data-sort=billing]'), P + '切官宣序');
  ok(
    P + '官宣序: 完整 id 序列',
    await waitFor(() => q(win, '[data-testid=lineup]')?.dataset.order === ['a01', 'a02', 'a03', 'a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12'].join('>')),
  );
  /* --- 报名：校验 → 乐观 → 成功 --- */
  setInput(win, q(win, '[data-field=name]'), '阿枫', P + '姓名');
  setInput(win, q(win, '[data-field=phone]'), '123', P + '坏手机');
  click(win, q(win, '[data-testid=submit]'), P + '坏号提交');
  ok(P + '校验: 手机号错误被拦下', await waitFor(() => (txt(win, '[data-testid=form-error]') ?? '').includes('手机号格式')));
  eq(P + '校验: 未发出 POST', countReq(win, '/api/register'), 0);
  setInput(win, q(win, '[data-field=phone]'), '13800001111', P + '恢复手机');
  setInput(win, q(win, '[data-field=qty]'), '2', P + 'qty');
  const signed0 = Number(q(win, '[data-signed]').textContent.replace(/,/g, ''));
  click(win, q(win, '[data-testid=submit]'), P + '提交报名');
  ok(P + '乐观: signedCount 立即 +2', await waitFor(() => Number(q(win, '[data-signed]').textContent.replace(/,/g, '')) === signed0 + 2, 45));
  ok(P + '成功: done-card 出现', await waitFor(() => q(win, '[data-testid=done-card]') !== null));
  ok(P + '成功: 含受理号 REG-0001', (txt(win, '[data-testid=done-card]') ?? '').includes('REG-0001'));
  eq(P + '成功: 服务端定案后仍是 +2', Number(q(win, '[data-signed]').textContent.replace(/,/g, '')), signed0 + 2);
  eq(P + '成功: 余票 -2', txt(win, '[data-remain-slot]'), (642 - 2).toLocaleString('zh-CN'));
  /* --- 回滚：姓名触发风控，乐观值必须退回 --- */
  click(win, q(win, '.done-card button'), P + '再报一单');
  await waitFor(() => q(win, '[data-field=name]') !== null);
  setInput(win, q(win, '[data-field=name]'), '风控测试', P + '风险名');
  setInput(win, q(win, '[data-field=phone]'), '13900002222', P + '手机2');
  setInput(win, q(win, '[data-field=qty]'), '2', P + 'qty2');
  const signed1 = Number(q(win, '[data-signed]').textContent.replace(/,/g, ''));
  click(win, q(win, '[data-testid=submit]'), P + '提交风险报名');
  ok(P + '回滚前: 乐观 +2 曾显示', await waitFor(() => Number(q(win, '[data-signed]').textContent.replace(/,/g, '')) === signed1 + 2, 45));
  ok(P + '回滚后: signedCount 复原', await waitFor(() => Number(q(win, '[data-signed]').textContent.replace(/,/g, '')) === signed1));
  ok(P + '回滚后: 错误文案带风控原因', await waitFor(() => (txt(win, '[data-testid=form-error]') ?? '').includes('风控')));
  /* --- 海报：动态模块 + XSS 转义 --- */
  setInput(win, q(win, '[data-field=holder]'), '<img src=x onerror=alert(1)>', P + '持票人');
  click(win, q(win, '[data-testid=poster-make]'), P + '生成海报');
  ok(P + 'poster: SVG 出现', await waitFor(() => q(win, '[data-testid=poster-stage] svg') !== null));
  const artHtml = q(win, '[data-testid=poster-art]')?.innerHTML ?? '';
  ok(P + 'poster: 用户输入被转义', !artHtml.includes('<img') && artHtml.includes('&lt;img'));
  /* --- 控制台 --- */
  eq(P + '无控制台错误', errors.length, 0);
  win.close(); // 不关窗口：倒计时 setInterval 会让进程永远不退出
}

/* 持久化恢复场景：voted a02 + tier=full 的种子（只跑一次，选 riso 页） */
async function seedSuite() {
  const seed = { 'soundisle.prefs.v1': JSON.stringify({ v: 1, data: { voted: ['a02'], tier: 'full' } }) };
  const { win, errors } = loadPage('riso', seed);
  await waitFor(() => qa(win, '.artist[data-artist]').length === 12);
  eq('seed: a02 按钮恢复为已投票', txt(win, '[data-vote=a02]'), '已投票');
  eq('seed: a01 仍可投', txt(win, '[data-vote=a01]'), '投 TA');
  ok('seed: tier=full 回填为选中', q(win, '[data-tier=full]')?.getAttribute('aria-checked') === 'true');
  eq('seed: 无控制台错误', errors.length, 0);
  win.close();
}

for (const t of THEMES) await suite(t);
await seedSuite();
console.log('jsdom-check 通过 ' + pass + ' 项 / 失败 ' + fails.length + ' 项');
if (fails.length > 0) {
  for (const f of fails) console.log('  FAIL ' + f);
  process.exitCode = 1;
}
