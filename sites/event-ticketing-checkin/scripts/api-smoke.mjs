// 端到端接口冒烟：对着一个真实运行的 cmd/api 实例逐条断言。
// 用法：ADMIN_TOKEN=… node scripts/api-smoke.mjs <baseURL> [无令牌实例baseURL]
//   第二个地址可选：另起一个不带 ADMIN_TOKEN 的实例，跑最后那组 503 fail-closed 探针。
//
// 这份脚本是收工前必跑的最后一道门：go test 全绿只证明仓储层，
// 只有真的走完 HTTP 才能确认「鉴权三层 + 冲突裁决 + 不泄露内部」这三件事在接口上仍然成立。

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const token = (process.env.ADMIN_TOKEN ?? '').trim();
if (token === '') {
  console.error('必须先 export ADMIN_TOKEN=…（与目标实例一致），否则鉴权断言会成批假失败');
  process.exit(2);
}
const AUTH = `Bearer ${token}`;

let pass = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond === true) {
    pass += 1;
    return;
  }
  failures.push(`${name}${detail === undefined ? '' : ' → ' + JSON.stringify(detail)}`);
}

function eq(name, got, want) {
  ok(name, got === want, { got, want });
}

async function call(method, path, { body, auth, headers, raw } = {}) {
  const h = { ...headers };
  if (auth === true) h.Authorization = `Bearer ${token}`;
  else if (typeof auth === 'string') h.Authorization = auth;
  if (body !== undefined && h['Content-Type'] === undefined) h['Content-Type'] = 'application/json';
  const init = { method, headers: h };
  init.body = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应由具体断言负责拦下 */
  }
  return { status: res.status, json, text, head: Object.fromEntries(res.headers.entries()) };
}

const get = (p, opt) => call('GET', p, opt);
const post = (p, body, opt) => call('POST', p, { ...opt, body });

// 内部实现细节的指纹：这些串一旦出现在响应里，就是把 err.Error() 或库表结构透给了调用方。
const LEAK = [
  'no such table', 'SQLITE_', 'constraint failed', 'gorm', 'Error 1', 'near "',
  'panic:', 'runtime error', 'internal/repository', 'unrecognized token', 'SELECT ',
];

function noLeak(name, text) {
  const hit = LEAK.filter((s) => text.toLowerCase().includes(s.toLowerCase()));
  ok(name + ' 不回显内部细节', hit.length === 0, hit);
}

function noRawPhone(name, text) {
  ok(name + ' 不含裸手机号', !/1[3-9]\d{9}/.test(text));
}

const stats = [];

// ---- 1. 健康与只读接口 ----
{
  const r = await get('/api/health');
  eq('health 200', r.status, 200);
  eq('health.status', r.json?.status, 'ok');
  ok('health 时间是 RFC3339', typeof r.json?.time === 'string' && /Z$/.test(r.json.time), r.json?.time);
  eq('health 禁缓存', r.head['cache-control'], 'no-store');
  eq('nosniff', r.head['x-content-type-options'], 'nosniff');
  ok('CSP 不放行内联脚本', !/script-src[^;]*unsafe-inline/.test(r.head['content-security-policy'] ?? ''), r.head['content-security-policy']);
  ok('CSP 放行内联 style（三风格靠它）', /style-src[^;]*unsafe-inline/.test(r.head['content-security-policy'] ?? ''));
}

let st = null;
{
  const r = await get('/api/stats?days=14');
  eq('stats 200', r.status, 200);
  st = r.json;
  ok('stats 回显窗口含 14', String(st?.window ?? '').includes('14'), st?.window);
  eq('对账恒等式全绿', st?.identity_ok, true);
  ok('identity_issues 是数组而非 null', Array.isArray(st?.identity_issues), st?.identity_issues);
  eq('日走势行数 = 窗口', st?.daily?.length, 14);
  ok('票张三态守恒', st !== null && st.tickets_valid + st.tickets_used + st.tickets_void === st.tickets_issued, {
    valid: st?.tickets_valid, used: st?.tickets_used, void: st?.tickets_void, issued: st?.tickets_issued,
  });
  ok('作废票真的被统计到（第 11 轮的别名坑）', (st?.tickets_void ?? 0) > 0, st?.tickets_void);
  ok('毛收入>0', (st?.gross_cent ?? 0) > 0, st?.gross_cent);
  ok('净额<=毛额', (st?.net_cent ?? 1) <= (st?.gross_cent ?? 0), { net: st?.net_cent, gross: st?.gross_cent });
  ok('退款留存配平', st !== null && st.refund_cent >= 0 && st.retained_cent >= 0, st);
  ok('渠道结构非空', Array.isArray(st?.by_channel) && st.by_channel.length >= 3, st?.by_channel?.length);
  ok('此刻开放场次存在', Array.isArray(st?.active_now) && st.active_now.length >= 1, st?.active_now?.length);
  noRawPhone('stats', r.text);
  noLeak('stats', r.text);
}

const SORTS = {
  events: ['doors', 'start', 'code', 'status', 'sold', 'gross', 'used', 'quota', 'id'],
  orders: ['created', 'payable', 'qty', 'status', 'code', 'event', 'id'],
  tickets: ['issued', 'used', 'code', 'status', 'seat', 'event', 'order', 'id'],
};

for (const [ep, keys] of Object.entries(SORTS)) {
  for (const sort of keys) {
    for (const dir of ['asc', 'desc']) {
      const r = await get(`/api/${ep}?sort=${sort}&dir=${dir}&page_size=3`);
      ok(`${ep} sort=${sort}&dir=${dir} 可执行`, r.status === 200 && (r.json?.items?.length ?? 0) > 0, {
        status: r.status, n: r.json?.items?.length, msg: r.json?.message,
      });
      eq(`${ep} sort=${sort} 回显排序键`, r.json?.sort, sort);
    }
  }
}

{
  // 排序键白名单：未知键与注入串都退回默认键，且绝不把 SQL 列名透给调用方。
  for (const probe of ['drop_table', 'created_at', 'sold_quantity', '" OR "1"="1']) {
    const r = await get(`/api/events?sort=${encodeURIComponent(probe)}`);
    ok(`非法 sort=${probe} 退回默认键`, r.status === 200 && r.json?.sort === 'doors', { status: r.status, sort: r.json?.sort });
    ok(`非法 sort=${probe} 不透出列名`, !/(_quantity|_at|_cent)$/.test(String(r.json?.sort)), r.json?.sort);
  }
  const r = await get('/api/events?page_size=9999&page=1');
  ok('page_size 有上限', (r.json?.page_size ?? 9999) <= 100 && (r.json?.page_size ?? 0) > 0, r.json?.page_size);
  const z = await get('/api/events?page_size=0&page=-3');
  eq('page/page_size 归一', z.json?.page_size >= 1 && z.json?.page >= 1, true);
}

let liveDetail = null;
{
  const r = await get('/api/events/ETLIVE01');
  eq('详情 200', r.status, 200);
  liveDetail = r.json;
  eq('详情编号', r.json?.event?.code, 'ETLIVE01');
  ok('详情带票档', Array.isArray(r.json?.ticket_types) && r.json.ticket_types.length >= 2, r.json?.ticket_types?.length);
  ok('现价不高于原价', (r.json?.ticket_types ?? []).every((t) => t.now_unit_cent <= t.unit_cent), r.json?.ticket_types);
  ok('在售场次窗口开放', r.json?.event?.checkin_open === true, r.json?.event?.checkin_open);
  noLeak('详情', r.text);
  const bad = await get('/api/events/ETNOPEXXX');
  eq('未知场次 404', bad.status, 404);
  eq('未知场次错误码', bad.json?.code, 'not_found');
  const trav = await get('/api/events/..%2f..%2fetc%2fpasswd');
  ok('穿越探针不是 5xx', trav.status < 500, trav.status);
}

let paidOrder = null;
let validTicket = null;
let usedTicket = null;
let cancelledOrder = null;
{
  const r = await get('/api/orders?status=paid&page_size=5&sort=payable&dir=desc');
  eq('订单列表 200', r.status, 200);
  paidOrder = r.json?.items?.[0] ?? null;
  ok('订单全部 paid', (r.json?.items ?? []).every((o) => o.status === 'paid'), r.json?.items?.map((o) => o.status));
  ok('订单金额拆分配平', (r.json?.items ?? []).every((o) => o.subtotal_cent + o.fee_cent === o.payable_cent), r.json?.items);
  ok('订单手机号已脱敏', (r.json?.items ?? []).every((o) => /\*\*\*\*/.test(String(o.phone_masked))), r.json?.items?.[0]?.phone_masked);
  noRawPhone('订单列表', r.text);

  const t = await get('/api/tickets?status=valid&event=ETLIVE01&page_size=5&sort=issued&dir=asc');
  validTicket = t.json?.items?.[0] ?? null;
  eq('有效票列表 200', t.status, 200);
  ok('有效票可核销', validTicket !== null && validTicket.checkinable === true, validTicket?.checkin_why);
  ok('有效票带闸口数组', Array.isArray(validTicket?.gates) && (validTicket?.gates.length ?? 0) > 0, validTicket?.gates);

  const u = await get('/api/tickets?status=used&page_size=3');
  usedTicket = u.json?.items?.[0] ?? null;
  ok('已用票带闸口与时刻', usedTicket !== null && usedTicket.gate !== '' && usedTicket.used_at !== undefined, usedTicket);

  const v = await get('/api/tickets?status=void&page_size=3');
  ok('种子中存在作废票', (v.json?.items?.length ?? 0) > 0, v.json?.total);

  const c = await get('/api/orders?status=cancelled&page_size=3');
  cancelledOrder = c.json?.items?.[0]?.code ?? null;
  ok('存在作废单样本', cancelledOrder !== null, c.json?.total);

  const one = await get(`/api/tickets/${validTicket?.code}`);
  eq('单票 200', one.status, 200);
  eq('单票编号', one.json?.ticket?.code, validTicket?.code);
  const q = await get(`/api/orders?q=${encodeURIComponent(String(paidOrder?.code))}`);
  eq('按订单号检索命中 1 条', q.json?.total, 1);
  noRawPhone('单票检索', one.text);
}

// ---- 2. 鉴权三层 ----
{
  const probes = [
    '/api/admin/events',
    '/api/admin/events/ETLIVE01/status',
    '/api/admin/sales',
    `/api/admin/tickets/${String(validTicket?.code)}/check-in`,
    `/api/admin/orders/${String(paidOrder?.code)}/refund`,
  ];
  for (const p of probes) {
    const noAuth = await post(p, {});
    eq(`${p} 无 Authorization → 401`, noAuth.status, 401);
    eq(`${p} 401 错误码`, noAuth.json?.code, 'unauthorized');
    const bare = await post(p, {}, { auth: 'Bearer' });
    eq(`${p} 只有方案名 → 401`, bare.status, 401);
    const basic = await post(p, {}, { auth: 'Basic Zm9vOmJhcg==' });
    eq(`${p} 非 Bearer 方案 → 401`, basic.status, 401);
    const wrong = await post(p, {}, { auth: 'Bearer not-the-token-at-all' });
    eq(`${p} 错令牌 → 403`, wrong.status, 403);
    eq(`${p} 403 错误码`, wrong.json?.code, 'forbidden');
    ok(`${p} 鉴权失败未写库`, (await get('/api/stats')).json?.identity_ok === true);
  }
  const lower = await post('/api/admin/sales', { event_code: 'ETNOPEXXX', type_code: 'X', quantity: 1, buyer: 'smoke_x', phone: '13800001111', channel: 'web' }, { auth: `bearer ${token}` });
  ok('小写 bearer 方案被接受（不返回 401/403）', lower.status !== 401 && lower.status !== 403, lower.status);
}

// ---- 3. 入参校验与边界 ----
{
  const cases = [
    ['手机号位数不足', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 1, buyer: 'smoke_a', phone: '1380000', channel: 'web' }, 'phone'],
    ['手机号非 1 开头', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 1, buyer: 'smoke_b', phone: '23800001111', channel: 'web' }, 'phone'],
    ['购票人含引号注入', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 1, buyer: 'a" OR "1"="1', phone: '13800001111', channel: 'web' }, 'buyer'],
    ['张数为 0', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 0, buyer: 'smoke_c', phone: '13800001111', channel: 'web' }, 'quantity'],
    ['张数超单笔上限', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 7, buyer: 'smoke_d', phone: '13800001111', channel: 'web' }, 'quantity'],
    ['渠道非法', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 1, buyer: 'smoke_e', phone: '13800001111', channel: 'fax' }, 'channel'],
    ['票档编号含分号', { event_code: 'ETLIVE01', type_code: 'TT;DELETE', quantity: 1, buyer: 'smoke_f', phone: '13800001111', channel: 'web' }, 'type_code'],
  ];
  for (const [name, body, field] of cases) {
    const r = await post('/api/admin/sales', body, { auth: AUTH });
    eq(`${name} → 400`, r.status, 400);
    eq(`${name} 错误码`, r.json?.code, 'invalid_request');
    eq(`${name} 标出字段 ${field}`, typeof r.json?.fields?.[field], 'string');
    noLeak(name, r.text);
  }

  const badOrder = {
    code: 'ETSMOKE01', title: '冒烟场次', artist: '测试团', category: 'concert', venue: '冒烟馆', city: '上海',
    gates: 'A,B', doors_at: '2026-12-01T10:00:00Z', start_at: '2026-12-01T09:00:00Z',
    presale_end: '2026-11-30T23:59:59Z', refund_cutoff_hours: 24, note: '开演早于开门',
  };
  const bad = await post('/api/admin/events', badOrder, { auth: AUTH });
  eq('开演早于开门 → 400', bad.status, 400);
  ok('两字段同时标错', typeof bad.json?.fields?.start_at === 'string' && typeof bad.json?.fields?.doors_at === 'string', bad.json?.fields);

  const truncated = await call('POST', '/api/admin/sales', {
    auth: AUTH,
    raw: '{"event_code":"ETLIVE01","type_code":"TTLIVE011","quantity":1,"buyer":"smoke_g","phone":"13800001111"',
    headers: { 'Content-Type': 'application/json' },
  });
  eq('截断 JSON → 400', truncated.status, 400);
  eq('截断 JSON 错误码', truncated.json?.code, 'invalid_request');
  noLeak('截断 JSON', truncated.text);

  const arr = await post('/api/admin/sales', [1, 2, 3], { auth: AUTH });
  eq('数组请求体 → 400', arr.status, 400);
  const empty = await call('POST', '/api/admin/sales', { auth: AUTH, raw: '', headers: { 'Content-Type': 'application/json' } });
  eq('空请求体 → 400', empty.status, 400);

  // 裸 CESU-8：Go 解码器会把它替换成 U+FFFD 后照常入库，必须按脏输入当场拒掉。
  const cesu = Buffer.from('{"event_code":"ETLIVE01","type_code":"TTLIVE011","quantity":1,"buyer":"smoke\xed\xa0\x80","phone":"13800001111","channel":"web"}', 'binary');
  const cr = await call('POST', '/api/admin/sales', { auth: AUTH, raw: cesu, headers: { 'Content-Type': 'application/json' } });
  eq('非法 UTF-8 → 400', cr.status, 400);
  eq('非法 UTF-8 标出 buyer', typeof cr.json?.fields?.buyer, 'string');

  const big = await post('/api/admin/sales', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 1, buyer: 'x'.repeat(30000), phone: '13800001111', channel: 'web' }, { auth: AUTH });
  ok('超大请求体被拦（413/400）', big.status === 413 || big.status === 400, big.status);
  const typed = await post('/api/admin/sales', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 'three', buyer: 'smoke_h', phone: '13800001111', channel: 'web' }, { auth: AUTH });
  eq('类型不符 → 400', typed.status, 400);
}

// ---- 4. 写入正链：建场次 → 开票 → 出票 → 核销 → 退票 ----
const SMOKE_CODE = 'ETSMOKE' + String(Date.now()).slice(-5);
{
  const created = await post('/api/admin/events', {
    code: SMOKE_CODE, title: '冒烟加场', artist: '灯塔室内乐团', category: 'theatre', venue: '冒烟小剧场', city: '上海',
    gates: 'S1,S2', doors_at: '2027-03-01T09:30:00Z', start_at: '2027-03-01T10:30:00Z',
    presale_end: '2027-02-27T23:59:59Z', refund_cutoff_hours: 24, note: '接口冒烟建的场次',
  }, { auth: AUTH });
  eq(`建场次 ${SMOKE_CODE} → 201`, created.status, 201);
  eq('新场次处于待开票', created.json?.event?.status, 'draft');
  const dup = await post('/api/admin/events', {
    code: SMOKE_CODE, title: '冒烟加场副本', artist: '灯塔室内乐团', category: 'theatre', venue: '冒烟小剧场', city: '上海',
    gates: 'S1', doors_at: '2027-03-01T09:30:00Z', start_at: '2027-03-01T10:30:00Z',
    presale_end: '2027-02-27T23:59:59Z', refund_cutoff_hours: 24, note: '重复编号探针',
  }, { auth: AUTH });
  eq('重复编号 → 409', dup.status, 409);
  eq('重复编号错误码', dup.json?.code, 'conflict');

  const tooFar = await post('/api/admin/events', {
    code: SMOKE_CODE + 'B', title: '越界场次', artist: '灯塔室内乐团', category: 'theatre', venue: '冒烟小剧场', city: '上海',
    gates: 'S1', doors_at: '2027-03-01T09:30:00Z', start_at: '2027-03-01T10:30:00Z',
    presale_end: '2027-02-27T23:59:59Z', refund_cutoff_hours: 200, note: '退票窗口越界',
  }, { auth: AUTH });
  eq('退票截止越界 → 400', tooFar.status, 400);
  eq('退票截止标出字段', typeof tooFar.json?.fields?.refund_cutoff_hours, 'string');

  // 草稿态不能出票，也不能直接散场。
  const saleDraft = await post('/api/admin/sales', { event_code: SMOKE_CODE, type_code: 'X', quantity: 1, buyer: 'smoke_i', phone: '13800001111', channel: 'web' }, { auth: AUTH });
  ok('草稿场次出票被拦', saleDraft.status === 409 || saleDraft.status === 400, saleDraft.status);
  const jump = await post(`/api/admin/events/${SMOKE_CODE}/status`, { action: 'close' }, { auth: AUTH });
  eq('草稿直接散场 → 409', jump.status, 409);
  eq('跳转错误码', jump.json?.code, 'conflict');

  const open = await post(`/api/admin/events/${SMOKE_CODE}/status`, { action: 'open' }, { auth: AUTH });
  eq('开票 → 200', open.status, 200);
  eq('状态转为在售', open.json?.event?.status, 'on_sale');
  const reopen = await post(`/api/admin/events/${SMOKE_CODE}/status`, { action: 'open' }, { auth: AUTH });
  eq('重复开票 → 409', reopen.status, 409);
  const badAct = await post(`/api/admin/events/${SMOKE_CODE}/status`, { action: 'teleport' }, { auth: AUTH });
  eq('非法动作 → 400', badAct.status, 400);
  const noSuch = await post('/api/admin/events/ETNOPEXXX/status', { action: 'open' }, { auth: AUTH });
  eq('不存在的场次 → 404', noSuch.status, 404);

  // 在售但没有票档 → 出票必须撞冲突，而不是凭空造票。
  const noType = await post('/api/admin/sales', { event_code: SMOKE_CODE, type_code: 'TTNOPE001', quantity: 1, buyer: 'smoke_j', phone: '13800001111', channel: 'web' }, { auth: AUTH });
  eq('未知票档 → 404', noType.status, 404);
  const foreign = (await get('/api/events/ETLIVE01')).json?.ticket_types?.[0]?.type_code ?? '';
  const mismatch = await post('/api/admin/sales', { event_code: SMOKE_CODE, type_code: foreign, quantity: 1, buyer: 'smoke_j2', phone: '13800001111', channel: 'web' }, { auth: AUTH });
  eq('票档不属于该场次 → 409', mismatch.status, 409);
  eq('串场票档裁决码', mismatch.json?.code, 'conflict');

  // 真出票：用种子里在售且有余量的票档。
  const types = (await get('/api/events/ETLIVE01')).json?.ticket_types ?? [];
  const sellable = types.find((t) => t.status === 'open' && t.quota - t.sold_quantity >= 2) ?? null;
  ok('种子中存在可出票档', sellable !== null, types.map((t) => [t.type_code, t.status, t.sold_quantity, t.quota]));
  const before = await get('/api/stats');

  // A 单：出 2 张，稍后拿一张去核销 → 这单变成「有人已进场」，整单退必须被拦。
  const saleA = await post('/api/admin/sales', {
    event_code: 'ETLIVE01', type_code: sellable?.type_code ?? '', quantity: 2,
    buyer: 'smoke_a2', phone: '13800002222', channel: 'box',
  }, { auth: AUTH });
  eq('A 单出票 → 201', saleA.status, 201);
  eq('A 单出票张数', saleA.json?.tickets?.length, 2);
  const odA = saleA.json?.order ?? {};
  eq('应收 = 小计 + 服务费', (odA.subtotal_cent ?? 0) + (odA.fee_cent ?? 0), odA.payable_cent);
  ok('单价口径合理且服务费不退', odA.unit_cent > 0 && odA.fee_cent === odA.service_cent * 2, odA);
  eq('新单状态', odA.status, 'paid');
  noRawPhone('A 单出票响应', saleA.text);
  const newTicketProbe = await get(`/api/tickets/${String(saleA.json?.tickets?.[0]?.code ?? '')}`);
  ok('新票可查且带闸口清单', Array.isArray(newTicketProbe.json?.ticket?.gates) && (newTicketProbe.json?.ticket?.gates.length ?? 0) > 0, newTicketProbe.json?.ticket?.gates);
  eq('新票初始为在效', newTicketProbe.json?.ticket?.status, 'valid');

  const after = await get('/api/stats');
  eq('出票后对账仍全绿', after.json?.identity_ok, true);
  ok('出票推进了库存', after.json?.sold_total === before.json?.sold_total + 2, {
    before: before.json?.sold_total, after: after.json?.sold_total,
  });
  ok('出票推进了票款', (after.json?.gross_cent ?? 0) > (before.json?.gross_cent ?? 0), {
    before: before.json?.gross_cent, after: after.json?.gross_cent,
  });

  // B 单：留在待开场场次（退票窗口还没过），专门走整单退票链。
  const futureTypes = (await get('/api/events/ET261001A')).json?.ticket_types ?? [];
  const buyable = futureTypes.find((t) => t.status === 'open' && t.remaining >= 1) ?? null;
  ok('待开场场次有可退票的在售票档', buyable !== null, futureTypes.map((t) => [t.type_code, t.status, t.remaining]));
  const quotaBefore = buyable?.sold_quantity ?? -1;
  const saleB = await post('/api/admin/sales', {
    event_code: 'ET261001A', type_code: buyable?.type_code ?? '', quantity: 1,
    buyer: 'smoke_b2', phone: '13900003333', channel: 'onsite',
  }, { auth: AUTH });
  eq('B 单出票 → 201', saleB.status, 201);
  const odB = saleB.json?.order ?? {};
  const ticketB = saleB.json?.tickets?.[0]?.code ?? '';

  // 停售票档：HTTP 侧用种子 TTLIVE013（配额已打满且停售）验证写路径被拒。
  const paused = await post('/api/admin/sales', {
    event_code: 'ETLIVE01', type_code: 'TTLIVE013', quantity: 1, buyer: 'smoke_k', phone: '13800001111', channel: 'web',
  }, { auth: AUTH });
  eq('停售/售罄票档出票 → 409', paused.status, 409);
  ok('停售裁决码明确', ['not_on_sale', 'sold_out', 'conflict'].includes(String(paused.json?.code)), paused.json?.code);

  // 核销正链与四类拒绝裁决。
  const newCode = saleA.json?.tickets?.[0]?.code ?? '';
  const gate = (saleA.json?.tickets?.[0]?.gates ?? ['G1'])[0] ?? 'G1';
  const ci = await post(`/api/admin/tickets/${newCode}/check-in`, { gate }, { auth: AUTH });
  eq('核销 → 200', ci.status, 200);
  eq('核销后状态', ci.json?.ticket?.status, 'used');
  eq('核销留下闸口', ci.json?.ticket?.gate, gate);
  ok('核销留下时刻', typeof ci.json?.ticket?.used_at === 'string', ci.json?.ticket?.used_at);
  ok('核销回执不泄露手机号', !/1[3-9]\d{9}/.test(ci.text), ci.text.slice(0, 200));
  const twice = await post(`/api/admin/tickets/${newCode}/check-in`, { gate }, { auth: AUTH });
  eq('重复核销 → 409', twice.status, 409);
  eq('重复核销裁决', twice.json?.code, 'already_used');
  const badGate = await post(`/api/admin/tickets/${String(usedTicket?.code ?? newCode)}/check-in`, { gate: 'Z9' }, { auth: AUTH });
  ok('非法闸口或非本场闸口有裁决码', badGate.status === 409 && ['gate_unknown', 'already_used'].includes(String(badGate.json?.code)), badGate.json?.code);
  if (usedTicket !== null) {
    const ug = await post(`/api/admin/tickets/${usedTicket.code}/check-in`, { gate: usedTicket.gate }, { auth: AUTH });
    eq('已入场票再核 → already_used', ug.json?.code, 'already_used');
  }
  const nf = await post('/api/admin/tickets/TKNOTEXIST000/check-in', { gate: 'G1' }, { auth: AUTH });
  eq('不存在的票 → 404', nf.status, 404);
  const notOpen = (await get('/api/tickets?event=ET261001A&status=valid&page_size=1')).json?.items?.[0] ?? null;
  if (notOpen !== null) {
    const dn = await post(`/api/admin/tickets/${notOpen.code}/check-in`, { gate: 'A' }, { auth: AUTH });
    eq('未开门场次 → doors_not_open', dn.json?.code, 'doors_not_open');
  }
  const closed = (await get('/api/tickets?event=ET260920A&page_size=1')).json?.items?.[0] ?? null;
  if (closed !== null) {
    const cc = await post(`/api/admin/tickets/${closed.code}/check-in`, { gate: 'A' }, { auth: AUTH });
    ok('已散场场次拒绝核销', cc.status === 409 && ['event_closed', 'already_used', 'ticket_void'].includes(String(cc.json?.code)), cc.json?.code);
  }

  // A 单已有人进场 → 整单退必须拦在一票一入的口径前面。
  const refA = await post(`/api/admin/orders/${String(odA.code)}/refund`, { reason: '冒烟：已进场想退' }, { auth: AUTH });
  eq('已进场订单退票 → 409', refA.status, 409);
  eq('已进场订单裁决码', refA.json?.code, 'partially_used');

  // 退票：B 单整单退 → 金额拆分 + 配额回吐 + 重复退 + 作废票闸口裁决。
  const refund = await post(`/api/admin/orders/${String(odB.code)}/refund`, { reason: '冒烟：开场前整单退' }, { auth: AUTH });
  eq('B 单退票 → 200', refund.status, 200);
  eq('退票后状态', refund.json?.order?.status, 'refunded');
  eq('退款额 = 票面小计', refund.json?.refunded_cent, odB.subtotal_cent);
  const ro = refund.json?.order ?? {};
  eq('退款 + 留存 = 实付', (ro.refunded_cent ?? 0) + (ro.retained_cent ?? 0), ro.payable_cent);
  eq('留存额 = 服务费', ro.retained_cent, odB.fee_cent);
  const quotaAfter = (await get('/api/events/ET261001A')).json?.ticket_types?.find((t) => t.type_code === buyable?.type_code)?.sold_quantity ?? -1;
  // quotaBefore 取的是 B 单出票之前的读数，出票 +1、退票 -1，回到原点才算真的回吐。
  ok('退票回吐了配额', quotaAfter === quotaBefore, { quotaBefore, quotaAfter });
  const again = await post(`/api/admin/orders/${String(odB.code)}/refund`, { reason: '重复退' }, { auth: AUTH });
  eq('重复退票 → 409', again.status, 409);
  eq('重复退票裁决', again.json?.code, 'already_refunded');
  // 退掉的票必须进不了场。裁决优先级是「场次窗口 → 票态」（domain.TicketVerdict 在窗口拒绝时直接透传），
  // 所以这张 ET261001A 的票在 HTTP 上先撞 doors_not_open；ticket_void 那条分支由 go test 在窗口已开的场次上覆盖。
  const voidCi = await post(`/api/admin/tickets/${ticketB}/check-in`, { gate: 'A' }, { auth: AUTH });
  eq('刚退掉的票过闸 → 409', voidCi.status, 409);
  ok('退掉的票被闸口拦下', ['ticket_void', 'doors_not_open'].includes(String(voidCi.json?.code)), voidCi.json?.code);
  if (cancelledOrder !== null) {
    const cr2 = await post(`/api/admin/orders/${cancelledOrder}/refund`, { reason: '没付过' }, { auth: AUTH });
    eq('作废单退票 → order_cancelled', cr2.json?.code, 'order_cancelled');
  }
  const nfo = await post('/api/admin/orders/ODNOPEXXXX/refund', { reason: '不存在' }, { auth: AUTH });
  eq('不存在的订单 → 404', nfo.status, 404);
  const badCode = await post('/api/admin/orders/..%2Fetc/refund', { reason: '非法编号' }, { auth: AUTH });
  ok('非法订单编号不是 5xx', badCode.status < 500, badCode.status);

  // 收尾：冒烟场次散场，且散场后写路径全部锁死。
  const close = await post(`/api/admin/events/${SMOKE_CODE}/status`, { action: 'close' }, { auth: AUTH });
  eq('散场 → 200', close.status, 200);
  eq('散场留痕', typeof close.json?.event?.closed_at, 'string');
  const afterClose = await post('/api/admin/sales', { event_code: SMOKE_CODE, type_code: 'TTNOPE001', quantity: 1, buyer: 'smoke_l', phone: '13800001111', channel: 'web' }, { auth: AUTH });
  ok('散场后出票被拦', afterClose.status === 409, afterClose.status);
  const cancel = await post(`/api/admin/events/${SMOKE_CODE}/status`, { action: 'cancel' }, { auth: AUTH });
  eq('散场是终态 → 409', cancel.status, 409);
}

// ---- 5. 全量响应泄露扫描 + 写后对账 ----
{
  const scan = ['/api/health', '/api/stats?days=7', '/api/events?page_size=50', '/api/orders?page_size=50',
    '/api/tickets?page_size=50', '/api/events/ETLIVE01'];
  for (const p of scan) {
    const r = await get(p);
    noLeak(`扫描 ${p}`, r.text);
    noRawPhone(`扫描 ${p}`, r.text);
    ok(`扫描 ${p} 不含裸 phone 字段`, !/"phone"\s*:/.test(r.text), r.text.match(/"phone"\s*:\s*"[^"]{0,20}/)?.[0]);
  }
  const fin = await get('/api/stats?days=14');
  eq('冒烟写入后对账仍全绿', fin.json?.identity_ok, true);
  ok('冒烟写入后票张仍守恒', fin.json.tickets_valid + fin.json.tickets_used + fin.json.tickets_void === fin.json.tickets_issued, fin.json);
  stats.push({ gross: fin.json?.gross_cent, sold: fin.json?.sold_total, issued: fin.json?.tickets_issued });
}

// ---- 6. 未配置 ADMIN_TOKEN 的实例必须 fail-closed（另起一个不带令牌的实例传第二个地址）----
{
  const nb = (process.argv[3] ?? '').replace(/\/$/, '');
  if (nb === '') {
    console.log('（跳过 503 探针：未提供无令牌实例地址，见 README 的重建命令）');
  } else {
    const bodies = [
      ['建场次', '/api/admin/events', { code: 'ETNOAUTH1', title: '无令牌探针', artist: '探针', category: 'concert', venue: '探针馆', city: 'PROBE', gates: 'P1', doors_at: '2026-12-01T12:00:00Z', start_at: '2026-12-01T14:00:00Z', presale_end: '2026-12-01T11:00:00Z', refund_cutoff_hours: 2, note: '' }],
      ['改状态', '/api/admin/events/ETLIVE01/status', { action: 'open' }],
      ['出票', '/api/admin/sales', { event_code: 'ETLIVE01', type_code: 'TTLIVE011', quantity: 1, buyer: 'noauth_probe', phone: '13800001111', channel: 'web' }],
      ['核销', '/api/admin/tickets/TKNOPE0001/check-in', { gate: 'A' }],
      ['退票', '/api/admin/orders/ODNOPE0001/refund', { reason: '无令牌探针' }],
    ];
    // 这一段必须打无令牌实例自己那个 base（call()/post() 绑的是主实例），
    // 否则请求带着「无 Authorization」打到有令牌的实例上，得到的是 401 而不是 503。
    const npost = async (path, body) => {
      const res = await fetch(nb + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 非 JSON 由下面的断言拦下 */
      }
      return { status: res.status, json, text };
    };
    const nget = async (path) => {
      const res = await fetch(nb + path);
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    for (const [name, path, body] of bodies) {
      const r = await npost(path, body);
      eq(`无 ADMIN_TOKEN 时${name} → 503`, r.status, 503);
      eq(`无 ADMIN_TOKEN ${name}的错误码`, String(r.json?.code), 'server_misconfigured');
      noLeak(`无 ADMIN_TOKEN ${name}不回显内部`, r.text);
    }
    // 写路径全 503，读路径必须照常工作——否则这个门是焊死在整个服务上的。
    const readOk = await nget('/api/stats?days=7');
    eq('无 ADMIN_TOKEN 时读接口仍 200', readOk.status, 200);
    eq('无 ADMIN_TOKEN 时对账仍全绿', readOk.json?.identity_ok, true);
  }
}

console.log(`\n通过 ${pass} 条断言，失败 ${failures.length} 条`);
for (const f of failures) console.log('  ✗ ' + f);
process.exit(failures.length === 0 ? 0 : 1);
