/**
 * Groups F (single-flight / no-early-return / duplicate ids) and H (interaction) —
 * run against the three shipped single-file previews through jsdom.
 * Run: node scripts/check-dom.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { build } from 'esbuild';
import { Group, ok, num, summary, deepEq, dumpResults, results } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['neumorph', 'bitmap', 'phosphor'];
const OUT = path.join(ROOT, '.tmp-check');
mkdirSync(OUT, { recursive: true });

async function loadTs(rel, name) {
  await build({
    entryPoints: [path.join(ROOT, rel)],
    outfile: path.join(OUT, `${name}.mjs`),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    alias: { '~types': path.join(ROOT, 'src/types') },
  });
  return import(`file://${path.join(OUT, `${name}.mjs`)}`);
}

const oracle = await loadTs('src/features/settings/helpers/settingsValidation.ts', 'oracle');
const dataset = await loadTs('src/lib/dataset.ts', 'dataset-mine');
const { buildDataset } = dataset;

/* ------------------------------------------------------------- fixtures */
const facts = buildDataset();
const ACTIVE = facts.links.filter((l) => !l.paused).length;
const PAUSED = facts.links.length - ACTIVE;
const EXPECT_ROWS = facts.links.length;
const byClicks = [...facts.links].sort((a, b) => b.clicks - a.clicks);
const byCreated = [...facts.links].sort((a, b) => b.createdAt - a.createdAt);
const bySlug = [...facts.links].sort((a, b) => a.slug.localeCompare(b.slug));
const fmt = new Intl.NumberFormat('zh-CN');
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/* --------------------------------------------------------------- boot */
async function boot(id, opts) {
  const seed = (opts === undefined || opts.localStorage === undefined) ? {} : opts.localStorage;
  const html = readFileSync(path.join(ROOT, 'preview', `admin-${id}.html`), 'utf8');
  const msgs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => msgs.push(`jsdomError ${e.message}`));
  vc.on('error', (m) => msgs.push(`error ${String(m)}`));
  vc.on('warn', (m) => msgs.push(`warn ${String(m)}`));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://beacon.test/',
    virtualConsole: vc,
    beforeParse(win) {
      for (const [k, v] of Object.entries(seed)) win.localStorage.setItem(k, v);
    },
  });
  const win = dom.window;
  const doc = win.document;
  const wait = (fn, ms) => new Promise((resolve) => {
    const limit = ms === undefined ? 6000 : ms;
    const t0 = Date.now();
    const tick = () => {
      let ready = false;
      try {
        ready = fn() === true;
      } catch {
        ready = false;
      }
      if (ready) resolve(true);
      else if (Date.now() - t0 > limit) resolve(false);
      else setTimeout(tick, 15);
    };
    tick();
  });
  const at = (sel) => doc.querySelector(sel);
  const all = (sel) => [...doc.querySelectorAll(sel)];
  const click = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const byText = (sel, text) => all(sel).find((e) => (e.textContent ?? '').trim() === text);
  const type = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const goto = async (hash) => {
    const want = hash === '#/' ? 'overview' : hash.replace(/^#\//, '');
    win.location.hash = hash;
    const landed = await wait(() => at(`[data-section="${want}"]`) !== null, 4000);
    if (!landed) throw new Error(`路由 ${hash} 未渲染对应分区`);
  };
  const log = () => (win.__fdBridge.requestLog());
  // jsdom 不实现“点击 submit 按钮 → 隐式提交表单”，故显式派发 submit 事件；
  // 真实点击提交按钮这条路径由 check-browser.mjs 在 chromium 里验证。
  const submit = () => {
    const form = at('[data-fd="save"]').closest('form');
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  };
  const appMsgs = () => msgs.filter((m) => !/Not implemented/i.test(m));
  return { id, win, doc, wait, at, all, click, byText, type, goto, log, submit, appMsgs, msgs, dom };
}

/* =========================================================== F per page */
for (const id of PAGES) {
  Group(`F · ${id}`);
  const p = await boot(id);
  await p.wait(() => p.at('[data-kpi]') !== null);
  ok('F1 正常模式下早期返回骨架节点数恒为 0（技能 CRITICAL RULE 的运行时证据）',
    p.all('[data-gate="early"]').length === 0, `count=${p.all('[data-gate="early"]').length}`);
  await p.goto('#/links');
  await p.goto('#/keys');
  await p.goto('#/settings');
  await p.goto('#/');
  const paths = p.log().map((e) => `${e.method} ${e.path}`);
  const countOf = (needle) => paths.filter((x) => x === needle).length;
  ok('F2 三消费方共享一次 /links 请求（同 queryKey 的 useSuspenseQuery 单飞）',
    countOf('get /links') === 1, `get /links=${countOf('get /links')}；消费方=总览计数 + Top5 + 短链表格`);
  ok('F3 回访各路由不重复请求（staleTime: Infinity 缓存优先）',
    countOf('get /overview') === 1 && countOf('get /keys') === 1, JSON.stringify(paths));
  const ids = p.all('[id]').map((e) => e.id);
  ok('F4 四路由遍历后 DOM 无重复 id', new Set(ids).size === ids.length, `${ids.length} 个 id`);
  const noisy = p.appMsgs().filter((m) => /Warning|unique "key"|Minified React error|not wrapped|Each child/i.test(m));
  ok('F5 控制台无 React 警告/错误', noisy.length === 0, noisy.slice(0, 2).join(' | '));
  p.dom.window.close();
}

/* ============================================== H1..H5 overview + links */
for (const id of PAGES) {
  Group(`H1 总览 · ${id}`);
  const p = await boot(id);
  const skelP = p.wait(() => p.at('[data-fd="suspense-loader"]') !== null, 220);
  const skel = await skelP;
  await p.wait(() => p.at('[data-kpi]') !== null);
  ok('H1a 挂载即出四张 KPI 卡', p.all('[data-kpi]').length === 4, `${p.all('[data-kpi]').length}`);
  ok('H1b 数据到达前先出 SuspenseLoader 骨架（不是空白、不是早退 spinner）', skel, `minHeight 360px`);
  const kpiVals = p.all('[data-kpi]').map((e) => (e.querySelector('.fd-num') === null ? '' : (e.querySelector('.fd-num').textContent ?? '').trim()));
  ok('H1c KPI 四项与事实源逐项相等（7 日点击/API 30 日/可用率/短链总数）',
    deepEq(kpiVals, [fmt.format(facts.stats.clicks7d), fmt.format(facts.stats.apiCalls30d), `${facts.stats.uptime.toFixed(2)}%`, fmt.format(facts.stats.totalLinks)]),
    kpiVals.join(' / '));
  const bars = p.all('[data-day]').map((e) => Number(e.getAttribute('data-value')));
  ok('H1d 趋势图 14 根柱子逐个等于 series14', deepEq(bars, facts.series14), `${bars.length} 根`);
  ok('H1e Top5 首位 = stats.topSlug，事件流 8 条',
    (p.at('[data-panel="top5"] li .fd-slug') === null ? '' : p.at('[data-panel="top5"] li .fd-slug').textContent ?? '').replace('r/', '') === facts.stats.topSlug &&
      p.all('[data-event-kind]').length === 8, `${facts.stats.topSlug} / ${p.all('[data-event-kind]').length}`);
  ok('H1f 四张卡各带一条折线（Sparkline SVG），role=img 有 aria-label',
    p.all('[data-fd="sparkline"]').length === 4 && p.all('svg[role="img"][aria-label]').length >= 5, `${p.all('[data-fd="sparkline"]').length}`);
  num(`H1g 总览文案中的服务端短链数 · ${id}`, Number((p.at('[data-fd="link-count"]').textContent ?? '').replace(/\D/g, '')), ' 条');

  Group(`H2 导航 · ${id}`);
  ok('H2a 侧栏四项且恰好一项激活', p.all('[data-fd="nav"] .fd-navlink').length === 4 && p.all('[data-active="1"]').length === 1,
    `${p.all('[data-fd="nav"] .fd-navlink').length} 项 active=${p.all('[data-active="1"]').length}`);
  await p.goto('#/links');
  ok('H2b 切到 /links 渲染表格分区且外壳保留', p.at('[data-section="links"]') !== null && p.at('[data-fd="appbar"]') !== null && p.all('[data-active="1"]').length === 1,
    `active=${p.all('[data-active="1"]').map((e) => e.textContent.trim()).join(',')}`);
  ok('H2c 面包屑随行切换', (p.at('[data-fd="crumb"]').textContent ?? '').startsWith('短链'), p.at('[data-fd="crumb"]').textContent ?? '');

  Group(`H3 搜索防抖 · ${id}`);
  const input = p.at('[data-fd="search"]');
  const note = () => (p.at('[data-fd="toolbar-note"]').textContent ?? '').trim();
  const rows = () => p.all('tbody tr[data-slug]').length;
  ok('H3a 初始行数 = 服务端 60 条', rows() === EXPECT_ROWS, `${rows()}`);
  p.type(input, 'spring');
  const staleMarked = note().includes('正在过滤');
  const rows0 = rows();
  await new Promise((r) => setTimeout(r, 120));
  const rows120 = rows();
  await p.wait(() => !note().includes('正在过滤'), 3000);
  const expected = facts.links.filter((l) => l.slug.toLowerCase().includes('spring') || l.target.toLowerCase().includes('spring')).length;
  ok('H3b 键入瞬间进入“正在过滤…”陈旧态', staleMarked, note());
  ok('H3c 350ms 防抖窗口内结果不变（未即时重算）', rows120 === rows0, `${rows0} → ${rows120}`);
  ok('H3d 防抖落地后命中数与事实源过滤结果一致', rows() === expected && expected > 0 && expected < EXPECT_ROWS, `${rows()} vs 期望 ${expected}`);
  ok('H3e 陈旧标记自动消失', !note().includes('正在过滤'), note());
  p.type(input, 'zzzzqq');
  await p.wait(() => p.all('.fd-empty').length === 1, 3000);
  ok('H3f 无结果时渲染显式空态（不是空白表）', (p.at('.fd-empty').textContent ?? '').includes('zzzzqq') && rows() === 0,
    p.at('.fd-empty').textContent.trim());
  p.type(input, '');
  await p.wait(() => rows() === EXPECT_ROWS, 3000);

  Group(`H4 筛选与排序 · ${id}`);
  p.click(p.byText('[data-filter]', '停用'));
  await p.wait(() => rows() === PAUSED, 3000);
  ok('H4a “停用”筛选行数 = 事实源 paused 数', rows() === PAUSED, `${rows()} = ${PAUSED}`);
  ok('H4b 工具条读数跟随视图（不是全量常数）',
    note() === `${PAUSED} 条 · 合计 ${fmt.format(sum(facts.links.filter((l) => l.paused).map((l) => l.clicks)))} 次点击`, note());
  p.click(p.byText('[data-filter]', '活跃'));
  await p.wait(() => rows() === ACTIVE, 3000);
  ok('H4c “活跃”筛选行数 = 事实源 active 数', rows() === ACTIVE, `${rows()} = ${ACTIVE}`);
  p.click(p.byText('[data-filter]', '全部'));
  await p.wait(() => rows() === EXPECT_ROWS, 3000);
  const firstSlug = () => (p.at('tbody tr[data-slug] .fd-slug').textContent ?? '').replace('r/', '');
  p.click(p.byText('[data-sort]', '按短链码'));
  await p.wait(() => firstSlug() === bySlug[0].slug, 3000);
  ok('H4d 按短链码排序首行正确', firstSlug() === bySlug[0].slug, `${firstSlug()} = ${bySlug[0].slug}`);
  p.click(p.byText('[data-sort]', '按创建'));
  await p.wait(() => firstSlug() === byCreated[0].slug, 3000);
  ok('H4e 按创建时间倒序首行正确', firstSlug() === byCreated[0].slug, `${firstSlug()} = ${byCreated[0].slug}`);
  p.click(p.byText('[data-sort]', '按点击'));
  await p.wait(() => firstSlug() === byClicks[0].slug, 3000);
  const sorted = p.all('tbody tr[data-slug] td.fd-num').map((e) => Number((e.textContent ?? '').replace(/\D/g, '')));
  ok('H4f 按点击倒序首行正确且全列单调不增', firstSlug() === byClicks[0].slug && sorted.every((v, i) => i === 0 || sorted[i - 1] >= v),
    `${firstSlug()} clicks=${byClicks[0].clicks}`);
  ok('H4g 筛选/排序组各只有一个 data-on=1', p.all('[data-sort][data-on="1"]').length === 1 && p.all('[data-filter][data-on="1"]').length === 1,
    `${p.all('[data-sort][data-on="1"]').length}/${p.all('[data-filter][data-on="1"]').length}`);

  Group(`H5 展开与写操作 · ${id}`);
  const slug0 = p.at('tbody tr[data-slug]').getAttribute('data-slug');
  p.click(p.at('tbody tr[data-slug]'));
  await p.wait(() => p.all('dl.fd-detail').length === 1, 2000);
  ok('H5a 行展开显示明细（4 个字段）且只有一行展开', p.all('dl.fd-detail').length === 1 && p.all('dl.fd-detail dt').length === 4,
    `${p.all('dl.fd-detail dt').length} 项`);
  p.click(p.at('tbody tr[data-slug]'));
  await p.wait(() => p.all('dl.fd-detail').length === 0, 2000);
  ok('H5b 再次点击收起（展开态互斥）', p.all('dl.fd-detail').length === 0, '0');
  const status0 = p.at('tbody tr[data-slug] [data-status]').getAttribute('data-status');
  const row0btns = () => [...p.all('tbody tr[data-slug]')[0].querySelectorAll('button')];
  p.click(row0btns()[1]);
  await p.wait(() => p.at('tbody tr[data-slug] [data-status]').getAttribute('data-status') !== status0, 3000);
  const status1 = p.at('tbody tr[data-slug] [data-status]').getAttribute('data-status');
  ok('H5c 停用/启用翻转状态', status0 !== status1 && (status0 === 'active') !== (status1 === 'active'), `${status0} → ${status1}`);
  ok('H5d 写操作只发一次 POST 且行数不变', rows() === EXPECT_ROWS && p.log().filter((e) => e.method === 'post').length === 1,
    `rows=${rows()} posts=${p.log().filter((e) => e.method === 'post').length}`);
  ok('H5e 操作按钮不连带触发行展开（stopPropagation 生效）', p.all('dl.fd-detail').length === 0, `${p.all('dl.fd-detail').length}`);
  const toastCount = () => Number(p.at('[data-fd-toast-count]').getAttribute('data-fd-toast-count') ?? '0');
  p.click(row0btns()[2]);
  await p.wait(() => p.at('tbody tr[data-slug]').getAttribute('data-pending') === '1', 1500);
  ok('H5f 两步删除第一步只武装：行数与请求数都不变', rows() === EXPECT_ROWS && p.log().filter((e) => e.method === 'post').length === 1,
    `pending=${p.at('tbody tr[data-slug]').getAttribute('data-pending')}`);
  ok('H5g 武装态按钮文案改为“再点一次确认删除”', (row0btns()[2].textContent ?? '').trim() === '再点一次确认删除', (row0btns()[2].textContent ?? '').trim());
  p.click(row0btns()[2]);
  await p.wait(() => rows() === EXPECT_ROWS - 1, 3000);
  ok('H5h 第二步真正删除（行数 -1，POST 数 +1）', rows() === EXPECT_ROWS - 1 && p.log().filter((e) => e.method === 'post').length === 2,
    `${rows()} 行 / ${p.log().filter((e) => e.method === 'post').length} 次 POST`);
  ok('H5i “服务端共 N 条”同步扣减', (p.at('[data-fd="rows-total"]').textContent ?? '').includes(`${EXPECT_ROWS - 1} 条`),
    p.at('[data-fd="rows-total"]').textContent ?? '');
  await p.wait(() => toastCount() >= 1 && (p.at('[data-fd="toast"]')?.textContent ?? '').includes('已删除 r/'), 2500);
  ok('H5j 删除成功走 useMuiSnackbar 提示（无 alert/confirm）', toastCount() >= 1, `toast=${p.at('[data-fd="toast"]')?.textContent ?? ''} count=${toastCount()}`);
  ok('H5k 被删的行确实是武装那一行（slug 一致性）', !p.all('tbody tr[data-slug]').some((e) => e.getAttribute('data-slug') === slug0), slug0 ?? '');
  p.dom.window.close();
}

/* ================================================= H6 keys per page */
for (const id of PAGES) {
  Group(`H6 密钥页 · ${id}`);
  const p = await boot(id);
  await p.goto('#/keys');
  await p.wait(() => p.all('[data-keyid]').length === 5, 5000);
  ok('H6a 初始 5 个密钥', p.all('[data-keyid]').length === 5, `${p.all('[data-keyid]').length}`);
  const cell = () => p.at('[data-keyid] .fd-slug');
  const masked = (cell().textContent ?? '').trim();
  ok('H6b 默认脱敏：前缀 + 12 个掩码点 + 末四位', /^[\w-]+_•{12}\w{4}$/.test(masked), masked);
  ok('H6c 脱敏串不等于任何明文密钥', !facts.keys.some((k) => masked === `bcn_${k.secret}`), masked);
  const btns = () => [...p.all('[data-keyid]')[0].querySelectorAll('button')];
  const kid0 = Number(p.at('[data-keyid]').getAttribute('data-keyid'));
  p.click(btns()[0]);
  await p.wait(() => (cell().textContent ?? '').startsWith('bcn_'), 2000);
  ok('H6d 显示明文与事实源一致且带 data-revealed=1',
    (cell().textContent ?? '').trim() === `bcn_${facts.keys.find((k) => k.id === kid0).secret}` && cell().getAttribute('data-revealed') === '1',
    (cell().textContent ?? '').trim().slice(0, 26));
  p.click(btns()[0]);
  await p.wait(() => (cell().textContent ?? '').trim() === masked, 2000);
  ok('H6e 再次点击回到脱敏', (cell().textContent ?? '').trim() === masked, (cell().textContent ?? '').trim());
  const postsOf = (pt) => p.log().filter((e) => e.method === 'post' && e.path === pt).length;
  p.click(btns()[2]);
  await p.wait(() => p.at('[data-keyid]').getAttribute('data-pending') === '1', 1500);
  ok('H6f 吊销第一步只武装（无 POST、密钥数不变）', p.all('[data-keyid]').length === 5 && postsOf('/keys') === 0,
    `${p.all('[data-keyid]').length} 个 / posts=${postsOf('/keys')}`);
  p.click(btns()[2]);
  await p.wait(() => p.all('[data-keyid]').length === 4, 3000);
  ok('H6g 吊销第二步生效：4 个密钥 + 一次 POST /keys', p.all('[data-keyid]').length === 4 && postsOf('/keys') === 1, `posts=${postsOf('/keys')}`);
  ok('H6h 顶部说明计数同步为「共 4 个密钥」', (p.at('[data-fd="keys-hint"]').textContent ?? '').includes('共 4 个密钥'),
    (p.at('[data-fd="keys-hint"]').textContent ?? '').slice(0, 24));
  await p.wait(() => (p.at('[data-fd="toast"]')?.textContent ?? '').includes('已吊销密钥'), 2500);
  ok('H6i 吊销提示带密钥名称', (p.at('[data-fd="toast"]')?.textContent ?? '').includes('已吊销密钥'), p.at('[data-fd="toast"]')?.textContent ?? '');
  p.click(btns()[1]);
  await p.wait(() => /剪贴板不可用|已复制/.test(p.at('[data-fd="toast"]')?.textContent ?? ''), 2500);
  const copyToast = p.at('[data-fd="toast"]').textContent ?? '';
  ok('H6j 剪贴板不可用时给可操作降级提示（jsdom 无 clipboard/execCommand）',
    copyToast.includes('剪贴板不可用') || copyToast.includes('已复制'), copyToast);
  p.dom.window.close();
}

/* ================================================= H7 settings per page */
for (const id of PAGES) {
  Group(`H7 服务设置 · ${id}`);
  const p = await boot(id);
  await p.goto('#/settings');
  await p.wait(() => p.at('[data-fd="save"]') !== null, 5000);
  const field = (name) => p.at(`[data-field="${name}"]`);
  const dirty = () => p.at('[data-fd="dirty-flag"]').getAttribute('data-dirty');
  const helper = (name) => p.at(`[data-field="${name}"]`).closest('.MuiFormControl-root').querySelector('.MuiFormHelperText-root').textContent.trim();
  ok('H7a 初始无未保存修改', dirty() === '0', dirty());
  ok('H7b 表单初值 = 同一份 DEFAULT_SETTINGS', field('serviceName').value === 'Beacon 信标短链' && field('pageSize').value === '10',
    `${field('serviceName').value} / ${field('pageSize').value}`);
  p.type(field('serviceName'), '');
  await p.wait(() => dirty() === '1', 2000);
  p.type(field('defaultDomain'), 'NOT A DOMAIN');
  p.type(field('pageSize'), '99');
  p.submit();
  await p.wait(() => helper('serviceName').startsWith('服务名称不能为空'), 2500);
  const expect = oracle.validateSettings({ serviceName: '', defaultDomain: 'NOT A DOMAIN', weeklyDigest: true, slowLinkAlert: false, pageSize: 99 });
  ok('H7c 三字段同时报错，且文案与直调 zod 预言完全相同（渲染路径与 schema 路径无漂移）',
    helper('serviceName') === expect.serviceName && helper('defaultDomain') === expect.defaultDomain && helper('pageSize') === expect.pageSize,
    [helper('serviceName'), helper('defaultDomain'), helper('pageSize')].join(' | '));
  ok('H7d 校验失败不写存储', p.win.localStorage.getItem('beacon.admin.settings.v1') === null,
    String(p.win.localStorage.getItem('beacon.admin.settings.v1')));
  p.type(field('serviceName'), 'Beacon 信标短链');
  p.type(field('defaultDomain'), 'bcn.example');
  p.type(field('pageSize'), '20');
  p.submit();
  await p.wait(() => p.win.localStorage.getItem('beacon.admin.settings.v1') !== null, 2500);
  const saved = JSON.parse(p.win.localStorage.getItem('beacon.admin.settings.v1') ?? '{}');
  ok('H7e 合法值落盘（v1 键、五字段、pageSize 为数字 20）',
    deepEq(Object.keys(saved).sort(), ['defaultDomain', 'pageSize', 'serviceName', 'slowLinkAlert', 'weeklyDigest']) && saved.pageSize === 20,
    JSON.stringify(saved));
  ok('H7f 保存后脏值标记复位', dirty() === '0', dirty());
  const p2 = await boot(id, { localStorage: { 'beacon.admin.settings.v1': JSON.stringify(saved) } });
  await p2.goto('#/settings');
  await p2.wait(() => p2.at('[data-fd="save"]') !== null, 5000);
  ok('H7g 重开页面后设置从存储恢复（持久化闭环）',
    p2.at('[data-field="pageSize"]').value === '20' && p2.at('[data-field="defaultDomain"]').value === 'bcn.example' && p2.at('[data-fd="dirty-flag"]').getAttribute('data-dirty') === '0',
    `${p2.at('[data-field="pageSize"]').value}/${p2.at('[data-field="defaultDomain"]').value}`);
  p2.click(p2.at('[data-fd="reset"]'));
  await p2.wait(() => p2.at('[data-field="pageSize"]').value === '10', 2000);
  ok('H7h 恢复默认写回表单并置脏（未保存）', p2.at('[data-field="pageSize"]').value === '10' && p2.at('[data-fd="dirty-flag"]').getAttribute('data-dirty') === '1',
    `dirty=${p2.at('[data-fd="dirty-flag"]').getAttribute('data-dirty')}`);
  const corrupt = await boot(id, { localStorage: { 'beacon.admin.settings.v1': '{"pageSize":"lots","serviceName":42' } });
  await corrupt.goto('#/settings');
  await corrupt.wait(() => corrupt.at('[data-fd="save"]') !== null, 5000);
  ok('H7i 损坏 JSON 回落默认值而不是崩溃（无未捕获异常）', corrupt.at('[data-field="pageSize"]').value === '10' &&
    corrupt.appMsgs().length === 0, `${corrupt.at('[data-field="pageSize"]').value} / msgs=${corrupt.appMsgs().length}`);
  p.dom.window.close();
  p2.dom.window.close();
  corrupt.dom.window.close();
}

summary('check-dom');
dumpResults(path.join(OUT, 'assertions-dom.json'));
