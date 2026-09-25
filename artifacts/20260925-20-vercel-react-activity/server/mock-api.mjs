/* 星屿·声浪岛音乐节 —— 本地 mock API 服务（零依赖 node:http）。
   这不只是假数据源：它把「取数时序」变成可断言的证据——
   - /api/logs   每个请求的进入/响应时间戳 + 聚合路由的内部事件（upstream-start/done）
   - /api/stats  after() 仿写：响应发出后才记浏览量（server-after-nonblocking 的等价验证）
   - /api/home   start-early/await-late 聚合 + single-flight + LRU（server-* 条款的可跑通形态）
   静态部分服务 dist-split 构建，浏览器里可直接跑真 HTTP 取数。 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const STATIC = join(ROOT, process.env.STATIC_DIR ?? 'dist-split');
const PORT = Number(process.env.PORT ?? 8141);

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);
const log = [];
function ev(kind, data) {
  log.push({ t: Date.now(), h: nowMs(), kind, ...data });
}

/* ---------- 业务状态 ---------- */
const seed = () => ({
  summary: { signedCount: 12483, ticketsLeft: 642, capacity: 18000, brandPartners: 23 },
  artistVotes: new Map(),
  registrations: [],
  voted: new Set(),
});
let state = seed();

const SCHEDULE = {
  fri: [
    ['18:30', '19:20', '开幕：鼓圈巡游', '星屿鼓班', 'main', '开幕'],
    ['19:40', '20:40', '潮汐地图 全专首演', '潮汐地图', 'main', '头牌'],
    ['20:00', '20:50', '不插电黄昏场', '南墙乐队', 'isle', '不插电'],
    ['21:00', '23:00', '黑胶静默迪斯科', 'DJ 白噪音', 'lounge', '静音'],
    ['21:10', '22:10', '岛屿信号 宇宙电波', '岛屿信号', 'main', '头牌'],
    ['21:30', '22:30', 'City Pop 霓虹夜', '夜航班机', 'isle', '复古'],
    ['23:00', '01:00', '日场收声派对', '电子羊', 'lounge', '派对'],
  ],
  sat: [
    ['13:00', '13:50', '开场：声音装置导览', '白噪音研究所', 'main', '装置'],
    ['14:20', '15:10', '芥末汽水 盯鞋风暴', '芥末汽水', 'main', '盯鞋'],
    ['13:30', '14:20', '少年冲浪声', '铜锣湾少年', 'isle', '冲浪'],
    ['15:00', '15:50', '低多边形 现场编程', '低多边形', 'isle', '生成'],
    ['14:00', '17:00', '唱片市集：厂牌擂台', '六厂牌', 'lounge', '市集'],
    ['16:00', '17:00', '橘子罐头 车库狂想', '橘子罐头', 'main', '车库'],
    ['18:00', '19:00', '雾中列车 慢速轰鸣', '雾中列车', 'main', '后摇'],
    ['17:30', '18:30', '落日对唱会', '南墙 × 芥末', 'isle', '联名'],
    ['20:00', '21:10', '银河录像厅 舞池重启', '银河录像厅', 'main', 'Disco'],
    ['21:30', '23:30', '氛围场：江面回声', '白噪音研究所', 'lounge', '氛围'],
    ['21:40', '22:50', '电子羊 三小时装置 Techno', '电子羊', 'main', '头牌'],
  ],
  sun: [
    ['13:30', '14:20', '亲子声浪工坊', '星屿剧团', 'main', '亲子'],
    ['14:00', '15:00', '新声竞演：八支Demo', '八支新声', 'isle', '竞演'],
    ['15:30', '16:30', '城市之声圆桌演出', '长沙音乐人联盟', 'main', '在地'],
    ['15:00', '18:00', '交换唱片下午茶', '乐迷会', 'lounge', '市集'],
    ['17:30', '18:40', '潮汐地图 × 交响组曲', '潮汐地图', 'main', '联名'],
    ['19:00', '20:00', '告别的轮盘：观众点歌', '夜航班机', 'isle', '互动'],
    ['20:30', '22:00', '闭幕大合奏 + 江面烟花', '全体阵容', 'main', '闭幕'],
  ],
};
const LINEUP = [
  ['a01', '潮汐地图', 'Tidemap', '数学摇滚', '长沙', 3121, true],
  ['a02', '岛屿信号', 'Isle Signal', '合成器流行', '上海', 2980, true],
  ['a03', '南墙乐队', 'Southwall', '民谣摇滚', '广州', 2218, false],
  ['a04', '电子羊', 'Electronic Sheep', 'Techno', '柏林', 2530, true],
  ['a05', '芥末汽水', 'Mustard Soda', '盯鞋', '成都', 2714, false],
  ['a06', '夜航班机', 'Nightflight', 'City Pop', '东京', 2044, false],
  ['a07', '白噪音研究所', 'White Lab', '氛围电子', '杭州', 1876, false],
  ['a08', '铜锣湾少年', 'Causeway Boys', '冲浪摇滚', '厦门', 1690, false],
  ['a09', '低多边形', 'Low Poly', '独立电子', '武汉', 1455, false],
  ['a10', '橘子罐头', 'Tangerine Tin', '车库摇滚', '西安', 1320, false],
  ['a11', '雾中列车', 'Fog Train', '后摇', '重庆', 1176, false],
  ['a12', '银河录像厅', 'Galaxy Video', 'Disco', '北京', 998, false],
];
const NOTICES = [
  { id: 'n1', kind: 'shuttle', title: '免费接驳轮渡', body: '湘江三号码头 ↔ 星屿东埠，12:00-23:30 每 20 分钟一班；凭票根登船。散场后加开 22:30 / 23:00 / 23:30 三班大船。' },
  { id: 'n2', kind: 'entry', title: '入场与安检', body: '每日 12:00 开闸。禁止携带玻璃容器、冷焰火、长度超过 50cm 的应援物。现场设寄存处（¥10/件，支持扫码）。' },
  { id: 'n3', kind: 'weather', title: '天气预案', body: '据 10 日预报，三日晴间多云、江边夜间约 16℃。中雨以上演出照常（主舞台顶棚覆盖 70%）；暴雨红色预警时启动闭幕日顺延预案，票务自动保留。' },
  { id: 'n4', kind: 'camp', title: '露营区守则', body: '三日全通票可预订湖东营地（200 顶限额）。15:00 后禁止生明火；营地 24h 有值守与热水站，撤营请带走垃圾可换纪念徽章。' },
];

function sessions() {
  const out = [];
  for (const day of ['fri', 'sat', 'sun']) {
    for (const row of SCHEDULE[day]) {
      out.push({ id: day + '-' + row[0].replace(':', ''), day, start: row[0], end: row[1], title: row[2], artist: row[3], stage: row[4], tag: row[5] });
    }
  }
  return { days: ['fri', 'sat', 'sun'], sessions: out };
}
function lineup() {
  return LINEUP.map(([id, name, enName, genre, city, base, headliner]) => ({
    id, name, enName, genre, city, headliner,
    votes: base + (state.artistVotes.get(id) ?? 0),
  }));
}

/* ---------- 「上游调用」：带人工延迟，并打点，供时序断言 ---------- */
const UPSTREAM_LATENCY = { summary: 120, schedule: 220, lineup: 400, notices: 300, vip: 150 };
function upstream(name, producer) {
  return new Promise((resolve) => {
    ev('upstream-start', { src: name });
    setTimeout(() => {
      ev('upstream-done', { src: name });
      resolve(producer());
    }, UPSTREAM_LATENCY[name] ?? 100);
  });
}

/* ---------- server-cache-react 等价：同请求内 single-flight；server-cache-lru：跨请求 LRU ---------- */
const lru = new Map(); // key -> {at, value}  最近最少使用，容量 4，TTL 2000ms
const LRU_MAX = 4;
function lruGet(key) {
  const hit = lru.get(key);
  if (hit === undefined) return null;
  if (Date.now() - hit.at > 2000) {
    lru.delete(key);
    return null;
  }
  lru.delete(key);
  lru.set(key, hit);
  return hit.value;
}
function lruSet(key, value) {
  lru.set(key, { at: Date.now(), value });
  while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value);
}
const inflight = new Map(); // single-flight
let upstreamCalls = { home: 0 };

/* /api/home —— async-api-routes 的形态：promises 先发起、最后统一 await；
   三个上游彼此独立（其中 notices 只取数量），并行总时长≈max(120,400,300)，串行会是 820。 */
async function buildHome() {
  upstreamCalls.home += 1;
  ev('home-build-start', {});
  const pSummary = upstream('summary', () => ({ ...state.summary, serverNow: Date.now() }));
  const pLineup = upstream('lineup', lineup);
  const pNotices = upstream('notices', () => NOTICES.length);
  const [summary, artists, noticesCount] = await Promise.all([pSummary, pLineup, pNotices]);
  ev('home-build-done', {});
  return { ok: true, summary, lineup: artists, noticesCount };
}
function getHome() {
  const cached = lruGet('home');
  if (cached !== null) {
    ev('home-cache-hit', {});
    return Promise.resolve(cached);
  }
  const pending = inflight.get('home');
  if (pending !== undefined) {
    ev('home-single-flight-join', {});
    return pending;
  }
  const p = buildHome().then((v) => {
    lruSet('home', v);
    inflight.delete('home');
    return v;
  });
  inflight.set('home', p);
  return p;
}

/* ---------- 鉴权（server-auth-actions 的等价：动作接口先验设备令牌） ---------- */
function authDevice(req) {
  const d = req.headers['x-device'];
  if (typeof d !== 'string' || d.length === 0) return { ok: false, status: 401, code: 'missing_device', message: '缺少设备令牌' };
  if (d === 'dt-blocked') return { ok: false, status: 403, code: 'device_denied', message: '设备被风控' };
  if (!d.startsWith('dt-')) return { ok: false, status: 401, code: 'bad_device', message: '设备令牌无效' };
  return { ok: true };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100000) return reject(new Error('body too large'));
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/* JSON 响应 + after() 仿写：先 flush 响应，setImmediate 里再记浏览量（不阻塞响应） */
let viewCount = 0;
let afterEvents = [];
function json(res, status, payload, reqId, path) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
  const respondedH = nowMs();
  ev('responded', { reqId, path, h: respondedH });
  setImmediate(() => {
    viewCount += 1;
    afterEvents.push({ reqId, respondedH, afterH: nowMs() });
    ev('after', { reqId, path });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  const reqId = 'r' + (log.length & 0xffffff);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  ev('request-in', { reqId, method: req.method, path });

  try {
    if (path === '/api/reset') {
      state = seed();
      log.length = 0;
      lru.clear();
      inflight.clear();
      upstreamCalls.home = 0;
      viewCount = 0;
      afterEvents = [];
      return json(res, 200, { ok: true }, reqId, path);
    }
    if (path === '/api/logs') return json(res, 200, { ok: true, log, upstreamCalls, viewCount, afterEvents }, reqId, path);
    if (path === '/api/stats') return json(res, 200, { ok: true, viewCount, afterEvents, upstreamCalls }, reqId, path);
    if (path === '/api/summary') {
      await upstream('summary', () => {});
      return json(res, 200, { ok: true, ...state.summary, serverNow: Date.now() }, reqId, path);
    }
    if (path === '/api/schedule') {
      await upstream('schedule', () => {});
      return json(res, 200, { ok: true, ...sessions() }, reqId, path);
    }
    if (path === '/api/lineup') {
      await upstream('lineup', () => {});
      return json(res, 200, lineup(), reqId, path);
    }
    if (path === '/api/notices') {
      await upstream('notices', () => {});
      return json(res, 200, NOTICES, reqId, path);
    }
    if (path === '/api/tickets/vip') {
      await upstream('vip', () => {});
      return json(res, 200, { ok: true, left: Math.min(46, state.summary.ticketsLeft) }, reqId, path);
    }
    if (path === '/api/home') {
      const home = await getHome();
      return json(res, 200, home, reqId, path);
    }
    if (req.method === 'POST' && path === '/api/register') {
      const a = authDevice(req);
      if (!a.ok) return json(res, a.status, { ok: false, code: a.code, message: a.message }, reqId, path);
      const b = await readBody(req);
      await upstream('summary', () => {});
      const qty = Number(b.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 4) return json(res, 422, { ok: false, code: 'bad_qty', message: '每单限 1-4 张' }, reqId, path);
      if (typeof b.phone !== 'string' || !/^1[3-9]\d{9}$/.test(b.phone)) return json(res, 422, { ok: false, code: 'bad_phone', message: '手机号格式不正确' }, reqId, path);
      if (b.phone.startsWith('000')) return json(res, 403, { ok: false, code: 'device_denied', message: '风控拦截：该手机号被暂时限制' }, reqId, path);
      if (typeof b.name === 'string' && b.name.includes('风控')) return json(res, 409, { ok: false, code: 'risk_hold', message: '姓名触发实名风控，报名已回滚' }, reqId, path);
      if (qty > state.summary.ticketsLeft) return json(res, 409, { ok: false, code: 'sold_out', message: '余票不足，剩 ' + state.summary.ticketsLeft + ' 张' }, reqId, path);
      state.summary.signedCount += qty;
      state.summary.ticketsLeft -= qty;
      const id = 'REG-' + String(state.registrations.length + 1).padStart(4, '0');
      state.registrations.push({ id, qty, tier: String(b.tier ?? 'day') });
      return json(res, 200, { ok: true, registrationId: id, signedCount: state.summary.signedCount, ticketsLeft: state.summary.ticketsLeft }, reqId, path);
    }
    if (req.method === 'POST' && path === '/api/vote') {
      const a = authDevice(req);
      if (!a.ok) return json(res, a.status, { ok: false, code: a.code, message: a.message }, reqId, path);
      const b = await readBody(req);
      await upstream('lineup', () => {});
      const artistId = String(b.artistId ?? '');
      if (!LINEUP.some((l) => l[0] === artistId)) return json(res, 404, { ok: false, code: 'no_artist', message: '查无此人' }, reqId, path);
      const dedupeKey = String(req.headers['x-device']) + '|' + artistId;
      if (state.voted.has(dedupeKey)) return json(res, 409, { ok: false, code: 'already_voted', message: '每位乐迷每档只有一次投票机会' }, reqId, path);
      state.voted.add(dedupeKey);
      state.artistVotes.set(artistId, (state.artistVotes.get(artistId) ?? 0) + 1);
      const artist = lineup().find((x) => x.id === artistId);
      return json(res, 200, { ok: true, artistId, votes: artist === undefined ? 0 : artist.votes }, reqId, path);
    }
    if (req.method === 'GET' && !path.startsWith('/api/')) {
      let file = path === '/' ? '/index.html' : path;
      file = normalize(file).replace(/^([.][.][/\\])+/, '');
      try {
        const buf = await readFile(join(STATIC, file));
        const ext = file.slice(file.lastIndexOf('.'));
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        res.end(buf);
        ev('responded', { reqId, path });
        return;
      } catch {
        try {
          const buf = await readFile(join(STATIC, 'index.html'));
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(buf);
          ev('responded', { reqId, path });
          return;
        } catch {
          res.writeHead(404);
          res.end('not found');
          ev('responded', { reqId, path });
          return;
        }
      }
    }
    json(res, 404, { ok: false, code: 'no_route', message: '无此接口' }, reqId, path);
  } catch (e) {
    json(res, 500, { ok: false, code: 'server_error', message: String((e && e.message) || e) }, reqId, path);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('mock api on http://127.0.0.1:' + PORT + ' static=' + STATIC);
});
