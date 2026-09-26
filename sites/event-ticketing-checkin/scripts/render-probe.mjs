// 渲染侧断言：证明两件事——
//   1) 页面数据真的来自接口：现场建一个带唯一编号的「冒烟靶子」场次、现场出一张票，
//      UI 必须查得到它们（本地过滤或写死的假数据都过不了这一关）；
//   2) 接口返回的恶意文本 <img src=x onerror=alert(1)> 只被当作文本渲染，不生成任何可执行节点。
//    恶意串放在场次标题 / 演出方 / 场馆 / 备注这类自由文本里；
//    购票人字段后端只收字母数字下划线连字符，注入串根本进不了库，所以不作靶子。
// 入参一律从接口取，不硬编码种子编号。
// 用法：node scripts/render-probe.mjs <SPA基址> <API基址> <主题...>   （令牌走 ADMIN_TOKEN 环境变量，
//   不进命令行——ps 能看到别人的 argv）
//   基址要用同时托管 SPA 与 /api 的 Go 实例（同源），否则第 4 条跨源断言会误报。
import { openSession } from './headless.mjs';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
const api = (process.argv[3] ?? 'http://127.0.0.1:8080/api').replace(/\/$/, '');
const token = (process.env.ADMIN_TOKEN ?? '').trim();
const themes = process.argv.slice(4);
if (!base || !api || !token || themes.length === 0) {
  console.error('用法: ADMIN_TOKEN=… node render-probe.mjs <SPA基址> <API基址> <主题...>');
  process.exit(2);
}

const MARKER = 'onerror=alert(1)';
const MARKED = `<img src=x ${MARKER}>`;
const stamp = String(Date.now()).slice(-6);
const EVENT_CODE = `ETXSS${stamp}`;
// 购票人只收字母数字/_/-，所以这里给个纯 ASCII 的名字——注入靶子另有其人（见 MARKED 用在哪）。
const BUYER = `SMOKE${stamp}`;

let pass = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
};

const get = async (path) => {
  const res = await fetch(api + path);
  return { status: res.status, json: await res.json().catch(() => null) };
};
const post = async (path, body) => {
  const res = await fetch(api + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const pad = (n) => String(n).padStart(2, '0');
const ts = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;

// ---- 靶子 1：标题与备注里带恶意串的场次（恶意串只能落在自由文本，编号仍走字符白名单）----
const now = new Date();
const at = (h) => ts(new Date(now.getTime() + h * 3600_000));
const created = await post('/admin/events', {
  code: EVENT_CODE,
  title: `冒烟靶子 ${MARKED}`,
  artist: '冒烟演出方',
  category: 'concert',
  venue: '冒烟场馆',
  city: 'TESTCITY',
  gates: 'XG1,XG2',
  doors_at: at(2),
  start_at: at(3),
  presale_end: at(1),
  refund_cutoff_hours: 2,
  note: `备注 ${MARKED}`,
});
if (created.status !== 201) {
  console.error(`建靶子场次失败 ${created.status}: ${JSON.stringify(created.json)}`);
  process.exit(2);
}
const opened = await post(`/admin/events/${EVENT_CODE}/status`, { action: 'open' });
if (opened.status !== 200) {
  console.error(`开放靶子场次失败 ${opened.status}: ${JSON.stringify(opened.json)}`);
  process.exit(2);
}

// ---- 靶子 2：购票人名带恶意串的票。票档不能凭空造（只能来自已有场次），
//      所以从接口的在售场次里逐场试出「有 open 票档且能下单」的那一档。----
const list = await get('/events?status=on_sale&sort=doors&dir=asc&page_size=50');
const candidates = (list.json?.items ?? []).filter((e) => e.code !== EVENT_CODE);
let usedEvent = '';
let usedType = '';
let orderCode = '';
let ticketCode = '';
for (const ev of candidates) {
  const detail = await get(`/events/${ev.code}`);
  const type = (detail.json?.ticket_types ?? []).find((t) => t.status === 'open' && Number(t.remaining) > 0);
  if (type === undefined) continue;
  const attempt = await post('/admin/sales', {
    event_code: ev.code,
    type_code: type.type_code,
    quantity: 1,
    buyer: BUYER,
    phone: '13800001111',
    channel: 'web',
  });
  if (attempt.status === 201) {
    usedEvent = ev.code;
    usedType = type.type_code;
    orderCode = String(attempt.json?.order?.code ?? '');
    ticketCode = String(attempt.json?.tickets?.[0]?.code ?? '');
    break;
  }
}
if (ticketCode === '') {
  console.error(`在售场次里出票失败：试过 ${candidates.map((c) => c.code).join(',')}`);
  process.exit(2);
}
console.log(`靶子就绪：场次 ${EVENT_CODE} / 订单 ${orderCode}（${usedEvent}·${usedType}）/ 票 ${ticketCode}\n`);

// React 受控输入要用原生 setter + input 事件，直接赋 value 会被组件下一次渲染覆盖回去。
const typeInto = (selector, value) =>
  `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (el === null) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
const clickTab = (i, word) =>
  `(() => { const t=[...document.querySelectorAll('.tab')][${i}]; if (t === undefined || !t.textContent.includes(${JSON.stringify(word)})) return false; t.click(); return true; })()`;

const DANGER = `(() => {
  const cells = [...document.querySelectorAll('#root *')].filter((c) => c.childElementCount === 0 && c.textContent.includes(${JSON.stringify(MARKER)}));
  return {
    img: document.querySelectorAll('#root img').length,
    script: document.querySelectorAll('#root script').length,
    iframe: document.querySelectorAll('#root iframe').length,
    object: document.querySelectorAll('#root object').length,
    embed: document.querySelectorAll('#root embed, #root link[rel=import]').length,
    attr: document.querySelectorAll('#root [onerror]').length,
    cells: cells.length,
    firstText: cells.length > 0 ? cells[0].textContent : '',
    firstHtml: cells.length > 0 ? cells[0].innerHTML : '',
  };
})()`;

// 页面上同时挂着「列表表」和「票档详情表」两张 .table，取证必须只看第一张；
// 检索又是异步的：只等「出现目标行」会在旧列表上就判定成功（第一轮就假通过过），
// 所以等成「只剩这一行且这行就是它」，让过滤真正生效后再断言。
const LIST = `document.querySelectorAll('.table')[0]`;
const settledOn = (needle) =>
  `(() => { const rs=[...${LIST}.querySelectorAll('tbody tr')]; return rs.length === 1 && rs[0].textContent.includes(${JSON.stringify(needle)}); })()`;
const listRows = `(() => { const rs=[...${LIST}.querySelectorAll('tbody tr')]; return { n: rs.length, text: rs.map(r=>r.textContent).join(' ').slice(0,120) }; })()`;

const sess = await openSession({ port: Number(process.env.CDP_PORT || 19835), profileDir: '/tmp/etk-render/chrome' });
try {
  for (const theme of themes) {
    await sess.goto(`${base}/?theme=${theme}`);
    const loaded = await sess.waitFor('document.querySelectorAll(".kpi").length > 0', 90);
    if (!loaded) {
      ok(`${theme}: 页面加载`, false, '没渲染出 .kpi（接口或脚本失败）');
      continue;
    }
    ok(`${theme}: 页面加载`, true, `data-theme=${String(await sess.evaluate('document.documentElement.dataset.theme'))}`);

    // 1) 场次页签按编号搜：命中行必须来自接口（现场造的靶子场次）
    const switched = await sess.evaluate(clickTab(1, '场次'));
    if (!switched) {
      ok(`${theme}: 切到场次页签`, false, '.tab[1] 不是「场次与票档」');
      continue;
    }
    ok(`${theme}: 场次列表已加载`, !!(await sess.waitFor(`${LIST} !== null && ${LIST}.querySelectorAll('tbody tr').length > 0`, 60)));
    await sess.evaluate(typeInto('input[placeholder="名称 / 编号 / 场馆"]', EVENT_CODE));
    const byCode = await sess.waitFor(settledOn(EVENT_CODE), 90);
    const rowExpr = `[...${LIST}.querySelectorAll('tbody tr')][0]`;
    const rowText = byCode ? String(await sess.evaluate(`${rowExpr}.textContent`)) : '';
    ok(`${theme}: 按编号搜到来自接口的靶子场次`, !!byCode, rowText.slice(0, 46).replace(/\s+/g, ' '));

    // 2) 把恶意串本身当搜索词：q 原样进接口，列表按字面匹配（历轮靶子都会被捞出来），
    //    且这些行只能是文本——库里存的就是这串尖括号，一旦被当 HTML 渲染这里立刻现形。
    await sess.evaluate(typeInto('input[placeholder="名称 / 编号 / 场馆"]', MARKED));
    const byInject = await sess.waitFor(
      `(() => { const rs=[...${LIST}.querySelectorAll('tbody tr')]; return rs.length > 0 && rs.every(r => r.textContent.includes('冒烟靶子')); })()`,
      60,
    );
    const injected = await sess.evaluate(listRows);
    ok(`${theme}: 恶意串作搜索词按字面命中且每行都是靶子`, !!byInject, `${injected.n} 行 / ${injected.text.slice(0, 40).replace(/\s+/g, ' ')}`);

    // 3) 点开靶子场次：详情小票里的演出方 / 场馆 / 备注都带着恶意串，必须只是文本
    await sess.evaluate(`(() => { const r=${rowExpr}; r.scrollIntoView(); r.click(); return true; })()`);
    const stubbed = await sess.waitFor(`document.querySelector('.stub')?.textContent.includes(${JSON.stringify(MARKED)})`, 60);
    ok(`${theme}: 场次详情小票显示了接口里的恶意文本`, !!stubbed, stubbed ? '备注/演出方文本已出现' : '没取到带恶意串的 .stub');

    const danger = await sess.evaluate(DANGER);
    ok(
      `${theme}: 恶意串没有生成任何可执行节点`,
      danger.img === 0 && danger.script === 0 && danger.iframe === 0 && danger.object === 0 && danger.embed === 0 && danger.attr === 0,
      `img=${danger.img} script=${danger.script} iframe=${danger.iframe} object=${danger.object} embed=${danger.embed} onerror属性=${danger.attr}`,
    );
    ok(`${theme}: 恶意串存在于纯文本节点`, danger.cells >= 1 && danger.firstText.includes(MARKER), `${danger.cells} 个文本节点 / 首个 ${JSON.stringify(danger.firstText.slice(0, 40))}`);
    ok(`${theme}: 该节点 innerHTML 是转义后的文本`, !/<(img|script|iframe|object|embed)\b/i.test(danger.firstHtml), danger.firstHtml.slice(0, 56));

    // 4) 台账按购票人查：接口刚写进去的单必须按字面命中且只 1 行
    await sess.evaluate(clickTab(5, '台账'));
    ok(`${theme}: 台账列表已加载`, !!(await sess.waitFor(`${LIST} !== null && ${LIST}.querySelectorAll('tbody tr').length > 0`, 60)));
    await sess.evaluate(typeInto('input[placeholder="编号 / 购票人 / 座位"]', BUYER));
    const buyerHit = await sess.waitFor(settledOn(BUYER), 90);
    const ledgerRow = buyerHit ? String(await sess.evaluate(`${rowExpr}.textContent`)) : '';
    ok(`${theme}: 购票人按字面命中且只 1 行`, !!buyerHit, ledgerRow.slice(0, 40).replace(/\s+/g, ' '));
    ok(`${theme}: 命中行的订单号就是接口返回的那个`, ledgerRow.includes(orderCode), orderCode);

    // 5) 核销台查这张新票：详情小票显示接口里的购票人
    await sess.evaluate(clickTab(3, '核销'));
    await sess.evaluate(typeInto('input[placeholder="TK…"]', ticketCode));
    const ticketStub = await sess.waitFor(`document.querySelector('.stub')?.textContent.includes(${JSON.stringify(BUYER)})`, 60);
    ok(`${theme}: 票券详情小票显示接口里的购票人`, !!ticketStub, ticketStub ? ticketCode : '未取得 .stub');

    // 6) 资源同源（页面与 /api 同源，任何跨源请求都是外链）+ 无异常
    const extern = await sess.evaluate(
      `performance.getEntriesByType('resource').map(e => e.name).filter(n => !n.startsWith(${JSON.stringify(base + '/')}) && !n.startsWith(${JSON.stringify(api + '/')}))`,
    );
    ok(`${theme}: 无跨源资源请求`, (extern ?? []).length === 0, (extern ?? []).join(',') || '全部同源');
    ok(`${theme}: 无 JS 异常与控制台报错`, sess.noise.length === 0, sess.noise.slice(0, 2).join(' | '));
  }
} finally {
  sess.close();
}

// 善后：靶子场次关闸；冒烟单留成审计记录（不物理删除）。
const closed = await post(`/admin/events/${EVENT_CODE}/status`, { action: 'close' });
console.log(`\n靶子善后：close=${closed.status}（场次 ${EVENT_CODE} 已关闸留档，订单 ${orderCode} 保留为审计记录）`);
console.log(`渲染断言：${pass} 通过 / ${fails.length} 失败${fails.length > 0 ? '：' + fails.join('、') : ''}`);
if (fails.length > 0) process.exitCode = 1;
