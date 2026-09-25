/* async-* / server-* 攻坚断言：把「取数时序」变成可打印的数字。
   做法：起本地 mock API 服务 → esbuild 打包 src/lib/api.ts（无 React 依赖）→
   在 Node 里驱动真实 HTTP，用服务端带时间戳的请求日志做并行/去重/single-flight 断言。 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 8141;
const BASE = 'http://127.0.0.1:' + PORT;
const root = process.cwd();
let pass = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) pass += 1;
  else fails.push(name + (extra === '' ? '' : ' — ' + extra));
}
function lt(name, actual, bound, unit = 'ms') {
  ok(name, actual < bound, actual.toFixed(1) + unit + ' 应 < ' + bound + unit);
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}

async function api(path, init) {
  const res = await fetch(BASE + path, init);
  return { status: res.status, data: await res.json() };
}
async function logs() {
  return (await api('/api/logs')).data.log;
}
async function logsFull() {
  return (await api('/api/logs')).data;
}
async function reset() {
  await api('/api/reset');
}

async function waitServer(ms = 8000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    try {
      const r = await fetch(BASE + '/api/stats');
      if (r.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('mock API 未能在 ' + ms + 'ms 内启动');
}

mkdirSync(join(root, '.tmp'), { recursive: true });
execFileSync(join(root, 'node_modules/.bin/esbuild'), [join(root, 'src/lib/api.ts'), '--bundle', '--format=esm', '--platform=neutral', '--outfile=' + join(root, '.tmp/api.mjs')], { stdio: 'inherit' });

const server = spawn(process.execPath, [join(root, 'server/mock-api.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
let serverOut = '';
server.stdout.on('data', (c) => (serverOut += String(c)));

try {
  await waitServer();
  const mod = await import(join(root, '.tmp/api.mjs'));
  const { createHttpTransport, bootstrap, loadResource, resetRegistryForTests, reqLog, setTransportForTests } = mod;
  const transport = createHttpTransport(BASE);
  setTransportForTests(transport);

  /* ===== 1. async-parallel：bootstrap 三资源同刻发起，总时长≈max(120,220,400) 而非 740 ===== */
  await reset();
  resetRegistryForTests();
  reqLog.length = 0;
  const t0 = performance.now();
  const boot = bootstrap(transport);
  await Promise.all([boot.summary.promise, boot.schedule.promise, boot.lineup.promise]);
  const wall = performance.now() - t0;
  const lg = await logs();
  const inOf = (p) => lg.filter((e) => e.kind === 'request-in' && e.path === p);
  const arrivals = [
    ...inOf('/api/summary').map((e) => e.h),
    ...inOf('/api/schedule').map((e) => e.h),
    ...inOf('/api/lineup').map((e) => e.h),
  ].sort((a, b) => a - b);
  eq('parallel: 三个端点各到 1 次', arrivals.length, 3);
  ok('parallel: 到达窗口 <60ms（同一 tick 发起）', arrivals[2] - arrivals[0] < 60, '窗口=' + (arrivals[2] - arrivals[0]).toFixed(1) + 'ms');
  lt('parallel: 总时长上限 650ms（串行下限是 740ms）', wall, 650);
  ok('parallel: 总时长 ≥400ms（确实等过最慢上游）', wall >= 400, wall.toFixed(1) + 'ms');
  eq('defer: bootstrap 期间没有请求 notices', inOf('/api/notices').length, 0);
  eq('defer: bootstrap 期间没有请求 vip 库存', inOf('/api/tickets/vip').length, 0);
  const sum = await boot.summary.promise;
  eq('数据形状: summary.ticketsLeft', sum.ticketsLeft, 642);
  const arts = await boot.lineup.promise;
  eq('数据形状: lineup 12 组', arts.length, 12);
  const sch = await boot.schedule.promise;
  eq('数据形状: schedule 25 场', sch.sessions.length, 25);

  /* ===== 2. client-swr-dedup：同 tick 两次 GET 同一 URL → 服务端只见 1 次到达 ===== */
  await reset();
  // 新传输实例：避开上一节 bootstrap 留下的 5s TTL 缓存（缓存命中=0 次网络请求，本身就是去重证据）
  const t2 = createHttpTransport(BASE);
  const p1 = t2.get('/api/summary');
  const p2 = t2.get('/api/summary');
  const p3 = t2.get('/api/summary');
  await Promise.all([p1, p2, p3]);
  eq('dedup: 3 个消费者 → 1 次服务端到达', (await logs()).filter((e) => e.kind === 'request-in' && e.path === '/api/summary').length, 1);
  const rA = loadResource('dup-key', () => t2.get('/api/summary'));
  const rB = loadResource('dup-key', () => t2.get('/api/summary'));
  ok('dedup: 资源注册表按 key 返回同一实例', rA === rB);

  /* ===== 3. async-api-routes（服务端形态）：/api/home start-early → await-late ===== */
  await reset();
  const t3 = performance.now();
  const home = await api('/api/home');
  const homeWall = performance.now() - t3;
  const lg3 = await logs();
  const starts = lg3.filter((e) => e.kind === 'upstream-start' && ['summary', 'lineup', 'notices'].includes(e.src));
  eq('home: 三个上游都发起了', starts.length, 3);
  const spread = Math.max(...starts.map((e) => e.h)) - Math.min(...starts.map((e) => e.h));
  ok('home: 上游发起窗口 <10ms（先发起后统一 await）', spread < 10, '窗口=' + spread.toFixed(1) + 'ms');
  lt('home: 响应时长上限 600ms（串行下限约 820ms）', homeWall, 600);
  eq('home: 聚合结果正确', home.data.summary.ticketsLeft + home.data.lineup.length + home.data.noticesCount, 642 + 12 + 4);

  /* ===== 4. single-flight + LRU（server-cache-react/lru 的等价形态） ===== */
  await reset();
  const [h1, h2] = await Promise.all([api('/api/home'), api('/api/home')]);
  const lg4 = await logs();
  eq('single-flight: 并发 2 请求只构建 1 次', lg4.filter((e) => e.kind === 'home-build-start').length, 1);
  eq('single-flight: 第二个请求并入在途 promise', lg4.filter((e) => e.kind === 'home-single-flight-join').length, 1);
  ok('single-flight: 两个响应一致', JSON.stringify(h1.data.lineup) === JSON.stringify(h2.data.lineup));
  await api('/api/home');
  const lg4b = await logs();
  eq('LRU: TTL 内第三次直接命中缓存', lg4b.filter((e) => e.kind === 'home-cache-hit').length, 1);
  eq('LRU: 仍未新增构建', lg4b.filter((e) => e.kind === 'home-build-start').length, 1);

  /* ===== 5. server-auth-actions：动作接口先验设备令牌 ===== */
  await reset();
  const noTok = await api('/api/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '张三', phone: '13800001111', qty: 1, tier: 'day' }) });
  eq('auth: 无令牌 → 401 missing_device', noTok.data.code, 'missing_device');
  eq('auth: 状态码 401', noTok.status, 401);
  const blocked = await api('/api/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'dt-blocked' }, body: JSON.stringify({ name: '张三', phone: '13800001111', qty: 1, tier: 'day' }) });
  eq('auth: 风控令牌 → 403 device_denied', blocked.data.code, 'device_denied');
  const good = await transport.post('/api/register', { name: '李四', phone: '13900002222', qty: 3, tier: 'full' });
  eq('auth: 正常令牌放行，余票 642→639', good.ticketsLeft, 639);
  const after = (await api('/api/summary')).data;
  eq('auth: 报名后 signedCount 增加 3', after.signedCount, 12486);

  /* ===== 6. 服务端校验分支 + 失败不改状态 ===== */
  const badQty = await api('/api/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'dt-test' }, body: JSON.stringify({ name: '王五', phone: '13700003333', qty: 5, tier: 'day' }) });
  eq('validate: qty=5 → 422 bad_qty', badQty.data.code, 'bad_qty');
  const badPhone = await api('/api/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'dt-test' }, body: JSON.stringify({ name: '王五', phone: '2370000333', qty: 1, tier: 'day' }) });
  eq('validate: 手机号非法 → 422 bad_phone', badPhone.data.code, 'bad_phone');
  let riskErr = null;
  try {
    await transport.post('/api/register', { name: '风控测试', phone: '13600004444', qty: 2, tier: 'day' });
  } catch (e) {
    riskErr = e;
  }
  eq('validate: 姓名风控 → 409 risk_hold', riskErr === null ? null : riskErr.code, 'risk_hold');
  const untouched = (await api('/api/summary')).data;
  eq('validate: 失败请求不改变服务端余票', untouched.ticketsLeft, 639);

  /* ===== 7. vote 幂等（每设备每档一次） ===== */
  await reset();
  setTransportForTests(null);
  const t7 = createHttpTransport(BASE);
  const v1 = await t7.post('/api/vote', { artistId: 'a01' });
  eq('vote: 首票成功 +1', v1.votes, 3122);
  let v2err = null;
  try {
    await t7.post('/api/vote', { artistId: 'a01' });
  } catch (e) {
    v2err = e;
  }
  eq('vote: 同设备重复投 → 409 already_voted', v2err === null ? null : v2err.code, 'already_voted');

  /* ===== 8. after() 非阻塞：响应先走，浏览量后记 ===== */
  await reset();
  const walls = [];
  for (let i = 0; i < 6; i += 1) {
    const s = performance.now();
    await fetch(BASE + '/api/tickets/vip');
    walls.push(performance.now() - s);
  }
  await new Promise((r) => setTimeout(r, 80));
  const lg8 = await logsFull();
  const responded = lg8.log.filter((e) => e.kind === 'responded' && e.path === '/api/tickets/vip');
  const afters = lg8.log.filter((e) => e.kind === 'after' && e.path === '/api/tickets/vip');
  eq('after: 6 个请求都有 after 事件', afters.length, 6);
  eq('after: responded 事件同样 6 条', responded.length, 6);
  const afterEv = new Map(lg8.afterEvents.map((e) => [e.reqId, e]));
  ok(
    'after: afterH ≥ respondedH（先响应后处理）',
    afters.every((a) => {
      const pair = afterEv.get(a.reqId);
      return pair !== undefined && pair.afterH >= pair.respondedH;
    }),
  );
  const maxWall = Math.max(...walls);
  lt('after: 单请求耗时未被拖长（<200ms）', maxWall, 200);

  console.log('async-check 通过 ' + pass + ' 项 / 失败 ' + fails.length + ' 项');
  console.log('timing: parallel=' + wall.toFixed(0) + 'ms home=' + homeWall.toFixed(0) + 'ms vipMax=' + maxWall.toFixed(0) + 'ms');
  if (fails.length > 0) {
    for (const f of fails) console.log('  FAIL ' + f);
    process.exitCode = 1;
  }
} finally {
  server.kill();
  rmSync(join(root, '.tmp/api.mjs'), { force: true });
}
