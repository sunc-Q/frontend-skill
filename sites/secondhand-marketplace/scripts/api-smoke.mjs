// 真接口冒烟：对运行中的后端逐个端点跑一遍，把「安全口径」变成可复跑的断言。
// 用法：node scripts/api-smoke.mjs <API基址> <ADMIN_TOKEN> [未配置令牌的同构实例基址]
//   node scripts/api-smoke.mjs http://127.0.0.1:8080/api "$ADMIN_TOKEN" http://127.0.0.1:8081/api
// 令牌一律从环境变量/参数注入，别把真实值写进任何文件或提交记录。
// 注意：会真写数据（建靶子挂单、出价、拍板），只在冒烟专用库上跑。
const base = (process.argv[2] ?? '').replace(/\/$/, '');
const token = process.argv[3] ?? '';
const noauthBase = (process.argv[4] ?? '').replace(/\/$/, '');
if (!base || !token) {
  console.error('用法: node api-smoke.mjs <API基址> <ADMIN_TOKEN> [无令牌基址]');
  process.exit(2);
}

let pass = 0;
const fails = [];
const captures = [];
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
};

const req = async (path, { method = 'GET', body, auth, headers } = {}) => {
  const h = { ...(headers ?? {}) };
  if (auth === true) h.authorization = `Bearer ${token}`;
  else if (typeof auth === 'string') h.authorization = `Bearer ${auth}`;
  if (body !== undefined && typeof body !== 'string') body = JSON.stringify(body);
  if (typeof body === 'string') h['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body });
  const text = await res.text();
  captures.push({ method, path, status: res.status, text });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 交给调用方判定 */
  }
  return { status: res.status, json, text, headers: res.headers };
};

const stamp = Date.now().toString(36).toUpperCase();
const LEAK =
  /no such table|no such column|SQLITE_|constraint failed|near "|\bpanic\b|goroutine|runtime\.|\.go:\d+|GORM|driver|database is locked/i;
const fieldsOf = (j) => Object.keys(j?.fields ?? {}).join(',');

// ================= A. 读接口 =================
{
  const r = await req('/health');
  ok('health 200', r.status === 200 && r.json?.status === 'ok' && !!r.json?.time, `time=${r.json?.time}`);
}
let cats = [];
{
  const r = await req('/categories');
  cats = r.json?.items ?? [];
  ok(
    'categories 200 且字段齐全',
    r.status === 200 && cats.length >= 4 && cats.every((c) => c.code && c.name_zh && c.ref_cent > 0),
    `${cats.length} 类，首类 ${cats[0]?.code}/${cats[0]?.name_zh} 参考价 ${cats[0]?.ref_cent}`,
  );
}
{
  const r = await req('/metrics?days=6');
  const m = r.json ?? {};
  ok(
    'metrics 200 且口径自洽（状态分布之和=总数）',
    r.status === 200 && m.window === '6 天' && m.available + m.reserved + m.sold + m.withdrawn === m.listings_total,
    `总数=${m.listings_total} 在架=${m.available} 约定=${m.reserved} 成交=${m.sold} 下架=${m.withdrawn} GMV=${m.gmv_cent}`,
  );
  ok(
    'metrics 恒等式：GMV ≥ 0 且成交均价与笔数同现',
    m.gmv_cent >= 0 && (m.deals === 0 || m.avg_deal_cent > 0) && m.identity_ok === true,
    `deals=${m.deals} avg=${m.avg_deal_cent} identity_ok=${m.identity_ok}`,
  );
  const big = await req('/metrics?days=9999');
  ok('metrics days 收敛到上限', big.json?.window === '30 天' && (big.json?.daily?.length ?? 0) <= 30, `window=${big.json?.window} daily=${big.json?.daily?.length}`);
  const neg = await req('/metrics?days=-5');
  ok('metrics 负数天数回落默认窗口', neg.status === 200 && neg.json?.window === '7 天', `window=${neg.json?.window}`);
  const byCat = await req('/metrics?days=6');
  ok('metrics 含品类汇总', (byCat.json?.by_category ?? []).length > 0, `${byCat.json?.by_category?.length} 个品类`);
}
let seedTotal = 0;
{
  const r = await req('/listings');
  const items = r.json?.items ?? [];
  seedTotal = r.json?.total ?? 0;
  ok(
    'listings 默认分页 20 且带 served_at',
    r.status === 200 && items.length > 0 && items.length <= 20 && r.json?.page_size === 20 && !!r.json?.served_at,
    `items=${items.length} total=${seedTotal} sort=${r.json?.sort} dir=${r.json?.dir}`,
  );
  const paged = await req('/listings?page_size=10&page=2');
  const p1 = await req('/listings?page_size=10&page=1');
  ok('翻页不重叠', (paged.json?.items ?? []).every((x) => !(p1.json?.items ?? []).some((y) => y.code === x.code)), `p1=${p1.json?.items?.[0]?.code} p2=${paged.json?.items?.[0]?.code}`);
}
{
  const big = await req('/listings?page_size=9999');
  ok('page_size 有上限（防一次拉全表）', big.json?.page_size === 100 && (big.json?.items?.length ?? 0) <= 100, `page_size=${big.json?.page_size}`);
  const zero = await req('/listings?page_size=0');
  ok('page_size=0 回落默认', zero.json?.page_size === 20, `page_size=${zero.json?.page_size}`);
  const junk = await req('/listings?page_size=abc');
  ok('page_size 非法值不炸', junk.status === 200 && junk.json?.page_size === 20, `page_size=${junk.json?.page_size}`);
  const far = await req('/listings?page=999999');
  ok('越界页返回空集不报错', far.status === 200 && (far.json?.items?.length ?? 1) === 0 && far.json?.total === seedTotal, `total=${far.json?.total}`);
  const neg = await req('/listings?page=-3');
  ok('负页码收敛为第 1 页', neg.status === 200 && neg.json?.page === 1, `page=${neg.json?.page}`);
}
{
  const evil = await req(`/listings?sort=${encodeURIComponent('l.posted_at;DROP TABLE')}&dir=${encodeURIComponent('asc;--')}`);
  ok('sort/dir 注入被白名单吃掉', evil.status === 200 && evil.json?.sort === 'l.posted_at' && evil.json?.dir === 'desc', `sort=${evil.json?.sort} dir=${evil.json?.dir}`);
  const asc = await req('/listings?sort=asking&dir=asc&page_size=100');
  const asks = (asc.json?.items ?? []).map((x) => x.asking_cent);
  ok('sort=asking&dir=asc 单调递增', asks.length > 10 && asks.every((v, i) => i === 0 || asks[i - 1] <= v), `首=${asks[0]} 末=${asks.at(-1)}`);
  const desc = await req('/listings?sort=best&dir=desc&page_size=100');
  const bests = (desc.json?.items ?? []).map((x) => x.best_offer_cent);
  ok('sort=best 单调递减', bests.every((v, i) => i === 0 || bests[i - 1] >= v), `首=${bests[0]}`);
  const byOffers = await req('/listings?sort=offers&dir=desc&page_size=20');
  const counts = (byOffers.json?.items ?? []).map((x) => x.offer_count);
  ok('sort=offers 按出价数排', counts.every((v, i) => i === 0 || counts[i - 1] >= v), `首行出价数=${counts[0]}`);
}
{
  const all = seedTotal;
  const byStatus = await req('/listings?status=available&page_size=100');
  ok('status 过滤只留该状态', (byStatus.json?.items ?? []).every((x) => x.status === 'available') && (byStatus.json?.total ?? 0) < all, `available=${byStatus.json?.total}/${all}`);
  const bogus = await req(`/listings?status=${encodeURIComponent("available' OR 1=1")}`);
  ok('非法 status 退回不过滤（而非注入放行）', bogus.json?.total === all, `total=${bogus.json?.total}`);
  const byCat = await req('/listings?category=photo&page_size=100');
  ok('category 过滤生效', (byCat.json?.items ?? []).length > 0 && (byCat.json?.items ?? []).every((x) => x.category_code === 'photo'), `photo=${byCat.json?.total} 单`);
  const byCond = await req('/listings?condition=like_new&page_size=100');
  ok('condition 过滤生效', (byCond.json?.items ?? []).every((x) => x.condition === 'like_new'), `like_new=${byCond.json?.total}`);
  const combo = await req('/listings?status=available&category=photo&condition=like_new&page_size=100');
  ok('多条件取交集', (combo.json?.total ?? 0) <= Math.min(byStatus.json?.total ?? 0, byCat.json?.total ?? 0), `组合=${combo.json?.total}`);
  const badCat = await req(`/listings?category=${encodeURIComponent('photo; DELETE')}`);
  ok('category 注入形被拒为不过滤', badCat.json?.total === all, `total=${badCat.json?.total}`);
}
{
  const inj = await req(`/listings?q=${encodeURIComponent("' OR 1=1 --")}`);
  ok('注入串按普通文本查：命中 0 行', inj.status === 200 && (inj.json?.items?.length ?? 1) === 0, `total=${inj.json?.total}`);
  const like = await req(`/listings?q=${encodeURIComponent('%')}`);
  ok('LIKE 通配符被转义（% 查不到全表）', (like.json?.total ?? 0) === 0, `total=${like.json?.total}`);
  const underscore = await req(`/listings?q=${encodeURIComponent('_')}&page_size=100`);
  // 没转义的话 '_' 会当成「任意单字符」把全表捞出来；转义对了就只命中真含下划线的行
  ok(
    '单下划线按字面匹配（只命中真含 _ 的行）',
    (underscore.json?.items ?? []).length > 0 &&
      (underscore.json?.items ?? []).every((x) => `${x.seller} ${x.title} ${x.code}`.includes('_')) &&
      (underscore.json?.total ?? 0) < seedTotal,
    `命中 ${underscore.json?.total}/${seedTotal} 行`,
  );
  const longQ = await req(`/listings?q=${encodeURIComponent('长'.repeat(300))}`);
  ok('超长 q 截断不报 500', longQ.status === 200, `status=${longQ.status}`);
  const kw = String(cats[0]?.name_zh ?? '').slice(0, 2);
  const hit = await req(`/listings?q=${encodeURIComponent(kw)}`);
  ok('中文关键词能查到', (hit.json?.items?.length ?? 0) > 0, `「${kw}」命中 ${hit.json?.total}`);
}
let targetCode = '';
let dealsCount = 0;
{
  const r = await req('/deals?status=pending&page_size=100');
  const items = r.json?.items ?? [];
  dealsCount = r.json?.total ?? 0;
  ok(
    'deals 出价台 200 且字段齐全',
    r.status === 200 && items.length > 0 && items.every((o) => o.deal_no && o.status && typeof o.amount_cent === 'number' && !!o.listing_code),
    `pending=${dealsCount} 笔`,
  );
  const byAmount = await req('/deals?sort=amount&dir=desc&page_size=100');
  const amounts = (byAmount.json?.items ?? []).map((o) => o.amount_cent);
  ok('deals sort=amount 单调', amounts.every((v, i) => i === 0 || amounts[i - 1] >= v), `首=${amounts[0]}`);
  const badSort = await req(`/deals?sort=${encodeURIComponent('o.amount_cent DESC--')}`);
  ok('deals 非法 sort 落回默认列', badSort.json?.sort === 'o.placed_at', `sort=${badSort.json?.sort}`);
  const wide = await req('/deals?page_size=9999');
  ok('deals page_size 同样封顶', wide.json?.page_size === 100, `page_size=${wide.json?.page_size}`);
}

// ================= B. 详情 =================
{
  const list = await req('/listings?status=available&page_size=100&sort=offers&dir=desc');
  const codes = (list.json?.items ?? []).filter((x) => (x.pending_count ?? 0) > 0).slice(0, 8).map((x) => x.code);
  const details = [];
  for (const code of codes) {
    const d = await req('/listings/' + encodeURIComponent(code));
    if (d.status === 200 && (d.json?.offers ?? []).some((o) => o.is_best === true)) {
      details.push({ code, json: d.json });
      break;
    }
  }
  const pick0 = details[0];
  targetCode = pick0?.code ?? '';
  const offers = pick0?.json?.offers ?? [];
  const best = offers.filter((o) => o.is_best === true);
  ok('详情能取到「正在拍」的单', !!pick0 && offers.length > 0, `${targetCode} 共 ${offers.length} 笔出价`);
  ok('详情 is_best 唯一且与列表最优价同口径', best.length === 1 && pick0?.json?.listing?.best_offer_cent === best[0]?.amount_cent, `best=${best[0]?.amount_cent} 列表=${pick0?.json?.listing?.best_offer_cent}`);
  const sorted = offers.every((o, i) => i === 0 || offers[i - 1].amount_cent >= o.amount_cent);
  ok('详情出价按金额降序', sorted, offers.map((o) => `${o.rank}:${o.amount_cent}`).join(' '));
  ok('详情挂单有溢价指数与浏览量', Number.isFinite(pick0?.json?.listing?.asking_ref_pct) && typeof pick0?.json?.listing?.views === 'number', `ref_pct=${pick0?.json?.listing?.asking_ref_pct} views=${pick0?.json?.listing?.views}`);
  ok('详情出价带挂单上下文', offers.every((o) => o.listing_code === targetCode && !!o.asking_cent), `asking=${offers[0]?.asking_cent}`);
}
{
  const miss = await req('/listings/FS-ZZZZ9');
  ok('未知编号 404 且返回 JSON 错误体', miss.status === 404 && !!miss.json?.code && !!miss.json?.message && !LEAK.test(miss.text), `code=${miss.json?.code}`);
  const traversal = await req('/listings/' + encodeURIComponent('../../backend/internal'));
  ok('路径穿越型编号被拒', traversal.status >= 400 && traversal.status < 500 && !LEAK.test(traversal.text), `status=${traversal.status} code=${traversal.json?.code}`);
  const htmlish = await req('/listings/' + encodeURIComponent('<script>x</script>'));
  ok('非法字符编号 4xx 不回显输入', htmlish.status >= 400 && htmlish.status < 500 && !htmlish.text.includes('<script>'), `status=${htmlish.status}`);
  const nope = await req('/nope-not-an-endpoint');
  ok('未知路由 404 JSON 而非栈页', nope.status === 404 && nope.json?.code === 'not_found' && !/panic|gin-gonic/.test(nope.text), `status=${nope.status}`);
}

// ================= C. 鉴权矩阵 =================
const ADMIN_EP = [
  ['/admin/listings', { code: 'FS-AUTH0', title: 't', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }],
  [`/admin/listings/${targetCode || 'FS-1001'}/offers`, { buyer: 'probe_x', amount_cent: 100000, message: 'x' }],
  ['/admin/deals/FD-00000000-0000/decide', { action: 'accept' }],
];
for (const [path, body] of ADMIN_EP) {
  const anon = await req(path, { method: 'POST', body, auth: false });
  ok(`缺令牌 401：${path}`, anon.status === 401 && !!anon.json?.code && !LEAK.test(anon.text), `status=${anon.status} code=${anon.json?.code}`);
  const wrong = await req(path, { method: 'POST', body, auth: 'definitely-not-the-token' });
  ok(`错令牌 403：${path}`, wrong.status === 403 && !LEAK.test(wrong.text), `status=${wrong.status} code=${wrong.json?.code}`);
  const empty = await req(path, { method: 'POST', body, auth: '' });
  ok(`空 Bearer 401：${path}`, empty.status === 401, `status=${empty.status}`);
  const basic = await fetch(base + path, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(':' + token).toString('base64'), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const basicText = await basic.text();
  captures.push({ method: 'POST(basic)', path, status: basic.status, text: basicText });
  ok(`只认 Bearer（Basic 不算数）：${path}`, basic.status === 401 || basic.status === 403, `status=${basic.status}`);
  const guess = await req(path, { method: 'POST', body, auth: 'admin' });
  ok(`弱口令猜测也被 403：${path}`, guess.status === 403, `status=${guess.status}`);
}
if (noauthBase) {
  let closed = 0;
  for (const [path] of ADMIN_EP) {
    const r = await fetch(noauthBase + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const text = await r.text();
    captures.push({ method: 'NOAUTH', path, status: r.status, text });
    if (r.status === 503) closed++;
  }
  ok('未配置 ADMIN_TOKEN 时写接口 fail-closed 503', closed === ADMIN_EP.length, `${closed}/${ADMIN_EP.length} 端点 503`);
}

// ================= D. 建挂单 =================
const newCode = `FS-SM${stamp}`.slice(0, 24);
{
  const good = await req('/admin/listings', {
    method: 'POST',
    auth: true,
    body: { code: newCode, title: '冒烟靶子：一台用过两年的定焦镜头', category: 'photo', seller: 'smoke_bot', asking_cent: 260000, floor_cent: 180000, condition: 'good', area: '徐汇·漕河泾' },
  });
  ok('建挂单 201', good.status === 201 && good.json?.listing?.code === newCode && good.json?.listing?.status === 'available', `code=${good.json?.listing?.code} msg=${good.json?.message}`);
  ok('新建挂单带行情参考价', (good.json?.listing?.ref_cent ?? 0) > 0, `ref_cent=${good.json?.listing?.ref_cent}（写接口回本体，溢价指数在读取视图里算）`);
  const again = await req('/admin/listings', {
    method: 'POST',
    auth: true,
    body: { code: newCode, title: '重号覆盖尝试', category: 'photo', seller: 'smoke_bot', asking_cent: 100, floor_cent: 1, condition: 'good', area: 'a' },
  });
  ok('重号 409 而不是覆盖', again.status === 409 && !!again.json?.code, `code=${again.json?.code}`);
  const seen = await req('/listings/' + newCode);
  ok('新建单立刻可查且零出价', seen.status === 200 && seen.json?.listing?.seller === 'smoke_bot' && (seen.json?.offers ?? []).length === 0, `出价 ${seen.json?.offers?.length} 笔`);
  const altCode = `FS-SM${stamp}Z`;
  const lower = await req('/admin/listings', {
    method: 'POST',
    auth: true,
    body: { code: altCode.toLowerCase(), title: '编号大小写靶子', category: 'photo', seller: 's', asking_cent: 260000, floor_cent: 180000, condition: 'good', area: 'a' },
  });
  ok('小写编号统一大写入库', lower.status === 201 && lower.json?.listing?.code === altCode, `code=${lower.json?.listing?.code}`);
  const altDetail = await req('/listings/' + altCode);
  ok('大写后可按原样编号取回', altDetail.status === 200 && altDetail.json?.listing?.code === altCode, `status=${altDetail.status}`);
}
{
  const cases = [
    ['缺标题', { code: `FS-M${stamp}A`, title: '', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }, 'title'],
    ['编号过短', { code: 'FS', title: 't', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }, 'code'],
    ['编号含符号', { code: 'FS";DROP--', title: 't', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }, 'code'],
    ['保底高于挂牌', { code: `FS-M${stamp}B`, title: 't', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 1100, condition: 'good', area: 'a' }, 'floor_cent'],
    ['金额为负', { code: `FS-M${stamp}C`, title: 't', category: 'photo', seller: 's', asking_cent: -5, floor_cent: -9, condition: 'good', area: 'a' }, 'asking_cent'],
    ['成色非法', { code: `FS-M${stamp}D`, title: 't', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'broken', area: 'a' }, 'condition'],
    ['分类不存在', { code: `FS-M${stamp}E`, title: '不存在的品类靶子', category: 'nope', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }, 'category'],
    ['标题超长', { code: `FS-M${stamp}F`, title: '长'.repeat(200), category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }, 'title'],
    ['卖家名超长', { code: `FS-M${stamp}G`, title: 't', category: 'photo', seller: 's'.repeat(80), asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' }, 'seller'],
    ['地区超长', { code: `FS-M${stamp}I`, title: 't', category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: '区'.repeat(60) }, 'area'],
    ['金额越界', { code: `FS-M${stamp}J`, title: 't', category: 'photo', seller: 's', asking_cent: 60000000, floor_cent: 1, condition: 'good', area: 'a' }, 'asking_cent'],
  ];
  for (const [name, body, want] of cases) {
    const r = await req('/admin/listings', { method: 'POST', auth: true, body });
    ok(`建挂单校验拒绝：${name}`, r.status === 400 && !!r.json?.fields?.[want] && !LEAK.test(r.text), `code=${r.json?.code} fields=${fieldsOf(r.json)}`);
  }
  // 卖家名没有「只允许字母数字」的约束（要能显示中文昵称），所以注入串应当作为普通文本入库，
  // 而不是被拦掉或被拼进 SQL：这条断言同时验证「参数化查询 + 原样存储」。
  const injectSeller = await req('/admin/listings', {
    method: 'POST',
    auth: true,
    body: { code: `FS-M${stamp}K`, title: '注入形卖家名靶子', category: 'photo', seller: "a' OR '1'='1", asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' },
  });
  ok("注入形卖家名按文本收单（201，不是拼进 SQL）", injectSeller.status === 201 && injectSeller.json?.listing?.seller === "a' OR '1'='1", `status=${injectSeller.status} seller=${injectSeller.json?.listing?.seller}`);
  const stillHealthy = await req('/listings?page_size=100');
  ok('收到注入形数据后读侧依旧正常', stillHealthy.status === 200 && (stillHealthy.json?.total ?? 0) > 0, `total=${stillHealthy.json?.total}`);
  const searchInject = await req(`/listings?q=${encodeURIComponent("' OR '1'='1")}`);
  ok(
    "注入串当搜索词：只按字面文本命中（就是那条同名卖家靶子），不是全表放行",
    searchInject.json?.total === 1 && searchInject.json?.items?.[0]?.seller === "a' OR '1'='1",
    `total=${searchInject.json?.total} 命中卖家=${searchInject.json?.items?.[0]?.seller}`,
  );
  const broken = await req('/admin/listings', { method: 'POST', auth: true, body: '{"code":' });
  ok('坏 JSON 400 不 500', broken.status === 400 && broken.json?.code === 'invalid_request', `status=${broken.status}`);
  const fffd = await req('/admin/listings', {
    method: 'POST',
    auth: true,
    body: `{"code":"FS-M${stamp}X","title":"坏编码尾\\ud800","category":"photo","seller":"s","asking_cent":1000,"floor_cent":900,"condition":"good","area":"a"}`,
  });
  ok('孤立代理对（CESU-8）被拒', fffd.status === 400, `status=${fffd.status} code=${fffd.json?.code}`);
  const after = await req('/listings?page_size=100');
  ok('校验失败没留下脏行（只有三个靶子入库）', after.json?.total === seedTotal + 3, `total=${after.json?.total}（种子 ${seedTotal} + 靶子 3）`);
}
{
  const big = JSON.stringify({ code: `FS-M${stamp}BIG`, title: 'A'.repeat(40000), category: 'photo', seller: 's', asking_cent: 1000, floor_cent: 900, condition: 'good', area: 'a' });
  const r = await req('/admin/listings', { method: 'POST', auth: true, body: big });
  ok('超大请求体被 Content-Length 闸拦下 413', r.status === 413 || r.status === 400, `status=${r.status} bytes=${big.length}`);
  // 不声明长度的分块体由 MaxBytesReader 拦（Go 侧 TestBodySizeLimits 覆盖两条路径）
  const overMessage = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_big', amount_cent: 245000, message: '说'.repeat(60000) } });
  ok('超长留言请求被拒且不 500', overMessage.status === 413 || overMessage.status === 400, `status=${overMessage.status}`);
}

// ================= E. 出价状态机 =================
let dealLow = '';
let dealHigh = '';
{
  const below = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_low', amount_cent: 179900, message: '低于保底' } });
  ok('出价低于保底 409 below_floor', below.status === 409 && below.json?.code === 'below_floor', `code=${below.json?.code} msg=${below.json?.message}`);
  const above = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_high', amount_cent: 260100, message: '高于挂牌' } });
  ok('出价高于挂牌 409 above_asking', above.status === 409 && above.json?.code === 'above_asking', `code=${above.json?.code}`);
  const first = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_a', amount_cent: 200000, message: '先挂一笔' } });
  dealLow = first.json?.offer?.deal_no ?? '';
  ok('首笔出价 201 pending', first.status === 201 && !!dealLow && first.json?.offer?.status === 'pending', `deal=${dealLow} 有效期到 ${first.json?.offer?.expires_at}`);
  const same = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_a', amount_cent: 200000, message: '不加价改主意' } });
  ok('同一买家等价改价 409 increment_too_small', same.status === 409 && same.json?.code === 'increment_too_small', `code=${same.json?.code} msg=${same.json?.message}`);
  const lower = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_a', amount_cent: 195000, message: '降回去' } });
  ok('同一买家出更低也 409', lower.status === 409 && lower.json?.code === 'increment_too_small', `code=${lower.json?.code}`);
  const higher = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_b', amount_cent: 240000, message: '抢拍 <img src=x onerror=alert(1)>' } });
  dealHigh = higher.json?.offer?.deal_no ?? '';
  ok('别人出更高 201', higher.status === 201 && !!dealHigh, `deal=${dealHigh}`);
  const detail = await req('/listings/' + newCode);
  const offers = detail.json?.offers ?? [];
  ok(
    '高价单顶掉低价单：outbid + 最优价跟随',
    offers.find((o) => o.deal_no === dealLow)?.status === 'outbid' && detail.json?.listing?.best_offer_cent === 240000 && offers.find((o) => o.deal_no === dealHigh)?.is_best === true,
    `笔数=${offers.length} best=${detail.json?.listing?.best_offer_cent}`,
  );
  ok('出价留言按原文入库（不当脚本）', offers.some((o) => String(o.message).includes('onerror')), `留言长度=${offers[0]?.message?.length}`);
  const noAuth = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', body: { buyer: 'p_c', amount_cent: 250000, message: 'x' }, auth: false });
  ok('匿名出价被拒', noAuth.status === 401, `status=${noAuth.status}`);
  const badBuyer = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: '', amount_cent: 250000, message: 'x' } });
  ok('缺买家名 400', badBuyer.status === 400 && !!badBuyer.json?.fields?.buyer, `fields=${fieldsOf(badBuyer.json)}`);
  const badMsg = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_d', amount_cent: 245000, message: '说'.repeat(300) } });
  ok('留言超长 400', badMsg.status === 400 && !!badMsg.json?.fields?.message, `fields=${fieldsOf(badMsg.json)}`);
  const badAmount = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_e', amount_cent: -1, message: 'x' } });
  ok('负金额出价 400', badAmount.status === 400 && !!badAmount.json?.fields?.amount_cent, `fields=${fieldsOf(badAmount.json)}`);
  const badCodeR = await req('/admin/listings/' + encodeURIComponent("FS'><%") + '/offers', { method: 'POST', auth: true, body: { buyer: 'p_f', amount_cent: 245000, message: 'x' } });
  ok('非法编号出价 400 且不泄露', badCodeR.status === 400 && badCodeR.json?.code === 'invalid_code' && !LEAK.test(badCodeR.text), `status=${badCodeR.status} code=${badCodeR.json?.code}`);
}
for (const [name, code, want] of [
  ['已售出不可出价', 'FS-1008', 'listing_sold'],
  ['已下架不可出价', 'FS-1010', 'listing_withdrawn'],
  ['已约定不可出价', 'FS-1006', 'listing_reserved'],
]) {
  const r = await req(`/admin/listings/${code}/offers`, { method: 'POST', auth: true, body: { buyer: 'probe_x', amount_cent: 250000, message: '试试' } });
  ok(`${name} 409`, r.status === 409 && r.json?.code === want, `code=${r.json?.code} msg=${r.json?.message}`);
}
{
  const ghost = await req('/admin/listings/FS-NOSUCH/offers', { method: 'POST', auth: true, body: { buyer: 'probe_x', amount_cent: 250000, message: 'x' } });
  ok('给不存在的挂单出价 404', ghost.status === 404, `status=${ghost.status} code=${ghost.json?.code}`);
}

// ================= F. 拍板 =================
{
  const badAction = await req(`/admin/deals/${dealHigh}/decide`, { method: 'POST', auth: true, body: { action: 'maybe' } });
  ok('非法 action 400', badAction.status === 400 && !!badAction.json?.fields?.action, `code=${badAction.json?.code}`);
  const accept = await req(`/admin/deals/${dealHigh}/decide`, { method: 'POST', auth: true, body: { action: 'accept' } });
  ok('确认成交 200 → reserved', accept.status === 200 && accept.json?.listing?.status === 'reserved', `status=${accept.json?.listing?.status} msg=${accept.json?.message}`);
  const repeat = await req(`/admin/deals/${dealHigh}/decide`, { method: 'POST', auth: true, body: { action: 'accept' } });
  ok('重复确认 409 already_accepted', repeat.status === 409 && repeat.json?.code === 'already_accepted', `code=${repeat.json?.code}`);
  const stale = await req(`/admin/deals/${dealLow}/decide`, { method: 'POST', auth: true, body: { action: 'accept' } });
  ok('确认已被顶掉的出价 409', stale.status === 409 && stale.json?.code === 'offer_not_pending', `code=${stale.json?.code}`);
  const reject = await req(`/admin/deals/${dealLow}/decide`, { method: 'POST', auth: true, body: { action: 'reject' } });
  ok('拒绝非 pending 出价 409', reject.status === 409 && reject.json?.code === 'offer_not_pending', `code=${reject.json?.code}`);
  const after = await req('/listings/' + newCode);
  const offers = after.json?.offers ?? [];
  ok('一笔挂单最多一条 accepted', offers.filter((o) => o.status === 'accepted').length === 1, `accepted=${offers.filter((o) => o.status === 'accepted').length}`);
  ok('成交后最优价锁定在成交额', after.json?.listing?.best_offer_cent === 240000 && after.json?.listing?.status === 'reserved', `best=${after.json?.listing?.best_offer_cent}`);
  const ghost = await req('/admin/deals/FD-99991231-9999/decide', { method: 'POST', auth: true, body: { action: 'accept' } });
  ok('确认不存在的出价单 404', ghost.status === 404, `status=${ghost.status} code=${ghost.json?.code}`);
  const closed = await req(`/admin/listings/${newCode}/offers`, { method: 'POST', auth: true, body: { buyer: 'p_c', amount_cent: 250000, message: '拍板后再拍' } });
  ok('拍板后不再收出价（reserved 闸）', closed.status === 409 && closed.json?.code === 'listing_reserved', `code=${closed.json?.code}`);
}
{
  const pending = await req('/deals?status=pending&page_size=100');
  ok('已确认的单退出 pending 队列', !(pending.json?.items ?? []).some((o) => o.deal_no === dealHigh), `pending=${pending.json?.total}（原先 ${dealsCount}）`);
  const all = await req('/deals?status=accepted&page_size=100&sort=id&dir=desc');
  ok('出价台按 status 能查到刚确认的 accepted', (all.json?.items ?? []).some((o) => o.deal_no === dealHigh), `accepted=${all.json?.total} 笔`);
  ok('deals 不带 status 时只给在拍队列（默认口径）', (pending.json?.items ?? []).every((o) => o.status === 'pending'), `pending=${pending.json?.total}`);
  const m = await req('/metrics?days=6');
  ok('成交计入 GMV 与成交笔数', m.json?.deals >= 1 && m.json?.gmv_cent >= 240000, `deals=${m.json?.deals} gmv=${m.json?.gmv_cent}`);
  const expired = await req('/listings?status=available&page_size=100');
  ok('僵尸 pending 有统计口径', typeof m.json?.expired_pending_offers === 'number', `过期未清理 pending=${m.json?.expired_pending_offers} 笔`);
  void expired;
}

// ================= G. CORS 与安全头 =================
{
  const local = await fetch(base + '/health', { headers: { origin: 'http://127.0.0.1:5173' } });
  ok('本机来源放行 CORS', local.headers.get('access-control-allow-origin') === 'http://127.0.0.1:5173', `acao=${local.headers.get('access-control-allow-origin')}`);
  const evil = await fetch(base + '/health', { headers: { origin: 'https://evil.example.com' } });
  ok('外部来源不给 CORS 头', evil.headers.get('access-control-allow-origin') === null, `acao=${evil.headers.get('access-control-allow-origin')}`);
  const nul = await fetch(base + '/health', { headers: { origin: 'null' } });
  ok('Origin: null 不放行', nul.headers.get('access-control-allow-origin') !== 'null', `acao=${nul.headers.get('access-control-allow-origin')}`);
  const prefix = await fetch(base + '/health', { headers: { origin: 'http://127.0.0.1.evil.example' } });
  ok('前缀伪装 loopback 不放行', prefix.headers.get('access-control-allow-origin') === null, `acao=${prefix.headers.get('access-control-allow-origin')}`);
  const pre = await fetch(base + '/admin/listings', {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' },
  });
  ok('本机预检可通', pre.status < 400 && pre.headers.get('access-control-allow-origin') === 'http://localhost:5173', `status=${pre.status}`);
  const sec = await fetch(base + '/health');
  const csp = sec.headers.get('content-security-policy') ?? '';
  ok(
    '安全头齐备（nosniff/DENY/no-referrer/CSP）',
    ['x-content-type-options', 'x-frame-options', 'referrer-policy'].every((h) => sec.headers.get(h) !== null) && csp.includes("script-src 'self'"),
    `CSP=${csp.slice(0, 48)}…`,
  );
}

// ================= H. 泄露总扫 =================
{
  const leaks = captures.filter((c) => LEAK.test(`${c.status} ${c.text}`));
  ok('所有响应无 SQL/Go 内部错误串', leaks.length === 0, `${captures.length} 条响应参与扫描`);
  for (const l of leaks.slice(0, 3)) console.log('  泄露嫌疑：' + l.method + ' ' + l.path + ' -> ' + l.text.slice(0, 160));
  const errResponses = captures.filter((c) => c.status >= 400);
  // Go 的 net/http 在进路由前就会拒畸形路径（纯文本 400）；处理器的错误契约才是 {code,message}。
  const PRE_ROUTER = /^(invalid URL path|400 Bad Request|Method Not Allowed|URI Too Long)\s*$/;
  const preRouter = errResponses.filter((c) => PRE_ROUTER.test(c.text.trim()));
  ok('路由层先挡下畸形请求且无泄露', preRouter.length > 0 && preRouter.every((c) => !LEAK.test(c.text)), `${preRouter.length} 条：${preRouter.map((c) => c.path.slice(0, 26)).join(' | ')}`);
  const ours = errResponses.filter((c) => !PRE_ROUTER.test(c.text.trim()));
  const badShape = ours.filter((c) => {
    try {
      const j = JSON.parse(c.text);
      return typeof j?.code !== 'string' || j.code === '' || typeof j?.message !== 'string' || j.message === '';
    } catch {
      return true;
    }
  });
  ok('处理器吐出的 4xx/5xx 全是 {code,message} 形状', badShape.length === 0, `${ours.length} 条错误响应，${badShape.length} 条形状不合`);
  for (const b of badShape.slice(0, 3)) console.log('  形状异常：' + b.method + ' ' + b.path + ' -> ' + b.status + ' ' + b.text.slice(0, 120));
}

// 渲染侧断言（scripts/render-probe.mjs）要知道这批靶子的坐标，落一个交接文件。
if (process.env.SMOKE_OUT) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    process.env.SMOKE_OUT,
    JSON.stringify({ base, code: newCode, altCode: `FS-SM${stamp}Z`, dealHigh, dealLow, marker: 'onerror=alert(1)', injectedSeller: "a' OR '1'='1" }, null, 2),
  );
}

console.log(`\n冒烟结果：${pass} 通过 / ${fails.length} 失败${fails.length ? '：' + fails.join('、') : ''}`);
if (fails.length > 0) process.exitCode = 1;
