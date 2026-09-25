/* 校验器（唯一入口：bash scripts/verify.sh）
   A 结构与算术自证 / B 交互（jsdom 真 DOM） / C 风格指纹三式 / D 与 20:00 React 轮的成本对照 / G 台账幂等
   约定：期望值一律现读磁盘或从数据源推导，不口算（历轮踩坑 #43 #83）。 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LAB = dirname(dirname(ROOT));
/* ESM 不认 NODE_PATH：按候选目录用 createRequire 解析 jsdom（装在 LAB/.tmp/jsdom，收尾会删，verify.sh 可重建） */
const roots = [join(LAB, '.tmp', 'jsdom'), ROOT, dirname(ROOT)];
let JSDOM = null;
for (const r0 of roots) {
  try { JSDOM = createRequire(join(r0, 'noop.js'))('jsdom').JSDOM; break; } catch (e) { /* 下一个候选 */ }
}
if (!JSDOM) { console.error('找不到 jsdom：请先跑 scripts/verify.sh（它会装到 ' + join(LAB, '.tmp', 'jsdom') + '）'); process.exit(2); }
const SRC = join(ROOT, 'src');
const PREV = join(LAB, 'artifacts', '20260925-20-vercel-react-activity');
const read = (p) => readFileSync(p, 'utf8');
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond === true) { pass++; return; }
  fails.push(name + (detail === undefined ? '' : ' :: ' + detail));
}
function eq(name, actual, expected) { ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected)); }
function num(name, actual, cmp, expected, unit) {
  const good = cmp === '>=' ? actual >= expected : cmp === '<=' ? actual <= expected : cmp === '>' ? actual > expected : actual < expected;
  ok(name, good, 'got ' + actual + (unit || '') + ' ' + cmp + ' ' + expected);
}

const STYLES = ['papercut', 'ticket', 'isometric'];
const THEME_MARK = { papercut: '风格 A', ticket: '风格 B', isometric: '风格 C' };
const pages = {};
const html = {};
for (const s of STYLES) {
  const p = join(ROOT, 'preview', 'activity-' + s + '.html');
  html[s] = read(p);
  pages[s] = { bytes: Buffer.byteLength(html[s]) };
}

/* ---------- 数据源（从 content.js 现读，避免手抄） ---------- */
const contentSrc = read(join(SRC, 'content.js'));
const artistRows = contentSrc.match(/^\s*\{ id: 'a\d\d',/gm) || [];
const sessionRows = contentSrc.match(/^\s*\['m\d\d',/gm) || [];
const noticeRows = contentSrc.match(/^\s*\{ id: 'n\d', kind:/gm) || [];
const tierRows = contentSrc.match(/\{ id: '(day|full|vip)', name:/g) || [];

/* ================= A 组：结构与算术 ================= */
{
  for (const s of STYLES) {
    ok('A/' + s + ' 存在', existsSync(join(ROOT, 'preview', 'activity-' + s + '.html')));
    ok('A/' + s + ' 无占位符残留', !/__BASE__|__THEME__|__APP__/.test(html[s]));
    ok('A/' + s + ' lang+title+description', /<html lang="zh-CN">/.test(html[s]) && /<title>星屿/.test(html[s]) && /name="description"/.test(html[s]));
    ok('A/' + s + ' 零外链（标签级）', !/<(link|img|script)[^>]+(href|src)\s*=\s*["']https?:/i.test(html[s]) && !/<link[^>]+rel=["']stylesheet/i.test(html[s]),
      (html[s].match(/<(link|img|script)[^>]*(href|src)\s*=\s*["']https?:/gi) || []).join('|'));
    ok('A/' + s + ' 无 http(s) 资源引用（属性与 CSS 出现处）',
      !(html[s].match(/(?:src|href|url\()\s*=?\s*["']?https?:\/\//i)), 'found external ref');
    ok('A/' + s + ' 层叠顺序：结构层 < 主题层 < 脚本', html[s].indexOf('结构层') < html[s].indexOf(THEME_MARK[s]) && html[s].indexOf(THEME_MARK[s]) < html[s].indexOf('"use strict"'));
  }
  const dom = await load('papercut');
  const d = dom.window.document;
  eq('A 阵容卡数 = content 行数', d.querySelectorAll('#lineup-grid .artist').length, artistRows.length);
  eq('A 艺人行去重', new Set([...d.querySelectorAll('.artist')].map((n) => n.getAttribute('data-id'))).size, artistRows.length);
  eq('A 日程表行数 = content 行数', d.querySelectorAll('#schedule-list tbody tr').length, sessionRows.length);
  const stageCounts = [...d.querySelectorAll('.stage-block')].map((b) => b.querySelectorAll('tbody tr').length);
  eq('A 分组求和 == 总场次', stageCounts.reduce((a, b) => a + b, 0), sessionRows.length);
  eq('A 舞台块数', d.querySelectorAll('.stage-block').length, 3);
  /* 独立 reduce 反推：从 content.js 直接数每个 stage，再与 DOM 分组比对（防口算） */
  for (const st of ['main', 'isle', 'lounge']) {
    const want = (contentSrc.match(new RegExp("'m\\d\\d', *'(fri|sat|sun)', *'" + st + "'", 'g')) || []).length;
    const got = d.querySelector('.stage-block[data-stage="' + st + '"]').querySelectorAll('tbody tr').length;
    eq('A ' + st + ' 场次数与源一致', got, want);
  }
  eq('A KPI 个数', d.querySelectorAll('.kpis .kpi').length, 3);
  eq('A 票档按钮 = 源档位数', d.querySelectorAll('#tier-box .tier').length, tierRows.length);
  eq('A 初始已报名人数 = 源 signedCount', d.getElementById('kpi-signed').textContent, '12,483');
  /* 余票 + 已出 = 容量（口径自证，不写死数字） */
  const left = Number(d.getElementById('kpi-left').textContent.replace(/,/g, ''));
  const sold = Number((d.getElementById('progress-text').textContent.match(/已出 ([\d,]+) 张/) || [])[1].replace(/,/g, ''));
  const cap = Number((d.getElementById('progress-text').textContent.match(/容量 ([\d,]+)/) || [])[1].replace(/,/g, ''));
  eq('A 已出 + 余票 == 容量', left + sold, cap);
  eq('A 进度条宽 == 已出/容量', d.getElementById('progress-fill').style.getPropertyValue('--pct'), ((sold / cap) * 100).toFixed(2) + '%');
  eq('A 初始公告零请求（defer 未触发）', countReqs(dom, '/api/notices'), 0);
  eq('A 初始 VIP 库存零请求（defer 未触发）', countReqs(dom, '/api/tickets/vip'), 0);
  eq('A 票根零 SVG（按需渲染前）', d.querySelectorAll('#poster-host svg').length, 0);
  eq('A 每个日程表都有 thead', d.querySelectorAll('.sessions thead').length, d.querySelectorAll('.sessions').length);
  eq('A 每表表头 4 格', new Set([...d.querySelectorAll('.sessions thead tr')].map((tr) => tr.querySelectorAll('th').length)).size, 1);
  eq('A 表头列数 = 4', d.querySelector('.sessions thead tr').querySelectorAll('th').length, 4);
  eq('A 每行单元格数 = 表头列数', new Set([...d.querySelectorAll('#schedule-list tbody tr')].map((tr) => tr.children.length)).size, 1);
  eq('A 无 innerHTML 用法（XSS 面为零）', /innerHTML/.test(stripComments(read(join(SRC, 'app.js')))), false);
  /* 重复 id 是静默杀手：getElementById 返回文档里第一个，本轮 #schedule 曾同时挂在 <section> 与内层 <div> 上，
     renderSchedule 的 textContent='' 于是抹掉整个分区（含 #sched-count），boot 后整段报名日程直接消失。 */
  const ids = [...d.querySelectorAll('[id]')].map((n) => n.id);
  eq('A 零重复 id', ids.length, new Set(ids).size);
  const appIds = [...read(join(SRC, 'app.js')).matchAll(/slot\('([^']+)'\)/g)].map((m) => m[1]);
  eq('A 每个 slot() 目标都唯一存在', appIds.filter((id) => ids.filter((x) => x === id).length !== 1).join(','), '');
  num('A slot() 引用了足量元素', new Set(appIds).size, '>=', 30);
  ok('A passive 滚动监听已声明', /\{ passive: true \}/.test(read(join(SRC, 'app.js'))));
  await close(dom);
}

/* ================= B 组：交互（三风格各跑一遍同一脚本） ================= */
for (const s of STYLES) {
  const dom = await load(s);
  const w = dom.window, d = w.document;
  const waitFor = (fn, lim = 4000) => new Promise((res, rej) => {
    const t0 = Date.now();
    (function step() { if (fn()) return res(); if (Date.now() - t0 > lim) return rej(new Error('timeout ' + s)); setTimeout(step, 4); }());
  });
  const lab = () => w.__lab;
  const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  /* B1 排序复排不重建 */
  const built0 = lab().stats.cardsBuilt;
  const orderOf = () => [...d.querySelectorAll('.artist')].map((n) => n.getAttribute('data-id')).join(',');
  const order0 = orderOf();
  click(d.querySelector('#sort-box button[data-sort="signed"]'));
  const order1 = orderOf();
  eq('B/' + s + ' 换排序后整列顺序改变', order1 !== order0, true);
  const first1 = order1.split(',')[0];
  eq('B/' + s + ' 换排序不重建卡片', lab().stats.cardsBuilt, built0);
  eq('B/' + s + ' 排序后仍 12 卡', d.querySelectorAll('.artist').length, 12);
  eq('B/' + s + ' 官宣顺序首张 = a01', first1, 'a01');
  eq('B/' + s + ' 序号已重排', d.querySelector('.artist .rank').textContent, '01');
  eq('B/' + s + ' aria-pressed 跟随', d.querySelector('#sort-box button[data-sort="signed"]').getAttribute('aria-pressed'), 'true');
  click(d.querySelector('#sort-box button[data-sort="votes"]'));
  eq('B/' + s + ' 人气排序首张 = 票王 a01', d.querySelector('.artist').getAttribute('data-id'), 'a01');

  /* B2 投票乐观更新 + 服务端确认 + 二次投票回滚（already_voted） */
  const card = d.querySelector('.artist[data-id="a05"]');
  const votesNode = card.querySelector('.votes');
  const before = Number(votesNode.textContent.replace(/,/g, ''));
  click(card.querySelector('.vote'));
  eq('B/' + s + ' 乐观 +1 立即可见（确认前）', Number(votesNode.textContent.replace(/,/g, '')), before + 1);
  await waitFor(() => card.querySelector('.vote').classList.contains('voted'));
  eq('B/' + s + ' 服务端确认后仍为 +1', Number(votesNode.textContent.replace(/,/g, '')), before + 1);
  eq('B/' + s + ' 投票写入本机偏好', lab().prefs.voted.indexOf('a05') >= 0, true);
  const reqsAfter1 = countReqs(dom, '/api/vote/a05');
  click(card.querySelector('.vote'));
  await waitFor(() => countReqs(dom, '/api/vote/a05') > reqsAfter1);
  await waitFor(() => /投票未计入/.test(d.getElementById('reg-status').textContent));
  await sleep(120);
  eq('B/' + s + ' 二次投票被拒后回滚到 +1', Number(votesNode.textContent.replace(/,/g, '')), before + 1);
  eq('B/' + s + ' 拒投提示走 notice 状态', d.getElementById('reg-status').getAttribute('data-kind'), 'notice');

  /* B3 公告 tab：点击前零请求，点击后 1 次，再点不重复（dedup） */
  click(d.getElementById('tab-notices'));
  await waitFor(() => d.querySelectorAll('#notice-host .notice').length > 0);
  eq('B/' + s + ' 公告条数 = 源', d.querySelectorAll('#notice-host .notice').length, noticeRows.length);
  eq('B/' + s + ' 公告请求恰 1 次', countReqs(dom, '/api/notices'), 1);
  eq('B/' + s + ' 首次载入计数 = 1', lab().stats.noticesLoads, 1);
  click(d.getElementById('tab-sched')); click(d.getElementById('tab-notices'));
  eq('B/' + s + ' 复用缓存不重发', countReqs(dom, '/api/notices'), 1);
  eq('B/' + s + ' 复用缓存不重计', lab().stats.noticesLoads, 1);
  eq('B/' + s + ' 公告面板可见', d.getElementById('notice-pane').hasAttribute('hidden'), false);

  /* B4 日程筛选：Map 单循环 + 空态 */
  const iter0 = lab().stats.loopIterations;
  click([...d.querySelectorAll('.day-tab')].find((b) => b.getAttribute('data-day') === 'sat'));
  const satRows = (contentSrc.match(/'sat', *'(main|isle|lounge)'/g) || []).length;
  eq('B/' + s + ' 周六场次数与源一致', d.querySelectorAll('#schedule-list tbody tr').length, satRows);
  num('B/' + s + ' 一次筛选只扫一遍全表', lab().stats.loopIterations - iter0, '<=', sessionRows.length);
  eq('B/' + s + ' 筛选计数文案', d.getElementById('sched-count').textContent, '筛选出 ' + satRows + ' / 25 场');
  const sel = d.getElementById('sel-stage'); sel.value = 'lounge';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const loungeSat = (contentSrc.match(/'sat', *'lounge'/g) || []).length;
  eq('B/' + s + ' 双筛选 = 日期∩舞台', d.querySelectorAll('#schedule-list tbody tr').length, loungeSat);
  eq('B/' + s + ' 舞台块只剩一个', d.querySelectorAll('.stage-block').length, loungeSat > 0 ? 1 : 0);
  sel.value = 'isle'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  eq('B/' + s + ' 空态出现', d.querySelectorAll('#schedule-list .empty').length, (contentSrc.match(/'sat', *'isle'/g) || []).length > 0 ? 0 : 1);
  sel.value = 'all'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  click([...d.querySelectorAll('.day-tab')].find((b) => b.getAttribute('data-day') === 'all'));
  eq('B/' + s + ' 复位后仍是 25 行', d.querySelectorAll('#schedule-list tbody tr').length, sessionRows.length);

  /* B5 报名表单：校验分支 → 乐观更新 → 服务端风控回滚 → 提交锁 → 成功口径 */
  const nameIn = d.getElementById('in-name'), phoneIn = d.getElementById('in-phone');
  const submitBtn = d.getElementById('btn-submit'), status = d.getElementById('reg-status');
  const signedBefore = Number(d.getElementById('kpi-signed').textContent.replace(/,/g, ''));
  const leftBefore = Number(d.getElementById('kpi-left').textContent.replace(/,/g, ''));
  setVal(w, nameIn, '柯'); setVal(w, phoneIn, '13800000000');
  click(submitBtn);
  eq('B/' + s + ' 姓名过短被拦', /2-20 位真实姓名/.test(status.textContent), true);
  eq('B/' + s + ' 校验失败时不发请求', countReqs(dom, '/api/register'), 0);
  eq('B/' + s + ' 校验失败时不动 KPI', Number(d.getElementById('kpi-signed').textContent.replace(/,/g, '')), signedBefore);
  setVal(w, nameIn, '柯屿'); setVal(w, phoneIn, '23800000000');
  click(submitBtn);
  eq('B/' + s + ' 手机号非法被拦', /手机号格式不正确/.test(status.textContent), true);
  eq('B/' + s + ' 非法手机号仍未发请求（客户端先挡）', countReqs(dom, '/api/register'), 0);
  setVal(w, nameIn, '李风控'); setVal(w, phoneIn, '13800001234');
  click(submitBtn);
  eq('B/' + s + ' 乐观更新先于服务端（已报名 +2）', Number(d.getElementById('kpi-signed').textContent.replace(/,/g, '')), signedBefore + 2);
  eq('B/' + s + ' 乐观更新同步扣减余票', Number(d.getElementById('kpi-left').textContent.replace(/,/g, '')), leftBefore - 2);
  await waitFor(() => /风控/.test(status.textContent));
  eq('B/' + s + ' 服务端风控回滚已报名', Number(d.getElementById('kpi-signed').textContent.replace(/,/g, '')), signedBefore);
  eq('B/' + s + ' 回滚同时还原余票', Number(d.getElementById('kpi-left').textContent.replace(/,/g, '')), leftBefore);
  eq('B/' + s + ' 回滚文案给出回滚后口径', new RegExp('已回滚至 ' + signedBefore.toLocaleString('en-US')).test(status.textContent), true);
  setVal(w, nameIn, '柯屿');
  click(submitBtn); click(submitBtn);
  eq('B/' + s + ' 提交锁挡住重复请求（含风控那次共 2 次）', countReqs(dom, '/api/register'), 2);
  await waitFor(() => status.getAttribute('data-kind') === 'ok');
  eq('B/' + s + ' 成功文案含单号', /^报名成功 · 单号 R-10/.test(status.textContent), true);
  eq('B/' + s + ' 成功后已报名 +2', Number(d.getElementById('kpi-signed').textContent.replace(/,/g, '')), signedBefore + 2);
  eq('B/' + s + ' 单价 × 数量 = 合计（单日票 380×2）', /¥760/.test(status.textContent), true);
  eq('B/' + s + ' 票根提示写入单号', /单号 R-10/.test(d.getElementById('poster-hint').textContent), true);

  /* B6 VIP 分支延后取数 + 偏好持久化 */
  eq('B/' + s + ' 选 VIP 前零库存请求', countReqs(dom, '/api/tickets/vip'), 0);
  click([...d.querySelectorAll('#tier-box .tier')].find((b) => b.getAttribute('data-tier') === 'vip'));
  await waitFor(() => /前区平台余量/.test(d.getElementById('vip-box').textContent));
  eq('B/' + s + ' VIP 库存请求恰 1 次', countReqs(dom, '/api/tickets/vip'), 1);
  eq('B/' + s + ' VIP 面板可见', d.getElementById('vip-box').hasAttribute('hidden'), false);
  const vipLeft = Number((d.getElementById('vip-box').textContent.match(/余量 (\d+) 席/) || [])[1]);
  eq('B/' + s + ' VIP 余量 = min(46, 当前余票)', vipLeft, Math.min(46, Number(d.getElementById('kpi-left').textContent.replace(/,/g, ''))));
  click([...d.querySelectorAll('#tier-box .tier')].find((b) => b.getAttribute('data-tier') === 'full'));
  await sleep(60);
  eq('B/' + s + ' 合计随票档变（三日全通 ×2）', d.getElementById('reg-total').textContent, '¥1,960');
  eq('B/' + s + ' 票档偏好已持久化', JSON.parse(w.localStorage.getItem('soundisle.prefs.v1')).data.tier, 'full');
  eq('B/' + s + ' 已投票手已持久化', JSON.parse(w.localStorage.getItem('soundisle.prefs.v1')).data.voted.indexOf('a05') >= 0, true);
  eq('B/' + s + ' 清档前 SVG 数为 0', d.querySelectorAll('#poster-host svg').length, 0);
  click(d.getElementById('btn-poster'));
  eq('B/' + s + ' 点击后生成 1 张票根', d.querySelectorAll('#poster-host svg').length, 1);
  eq('B/' + s + ' 票根印上单号', /R-10/.test(d.querySelector('#poster-host .p-value').textContent), true);
  eq('B/' + s + ' 票根条码 28 格', d.querySelectorAll('#poster-host .p-bar').length, 28);
  click(d.getElementById('btn-clear'));
  eq('B/' + s + ' 清除后偏好回默认', lab().prefs.tier, 'day');
  await close(dom);
}

/* ================= B7 跨页一致性：DOM 与脚本逐字节相同，只有主题层不同 ================= */
{
  const strip = (s) => html[s].replace(/<style>[\s\S]*?风格 [ABC][\s\S]*?<\/style>/, '<!--THEME-->');
  eq('B7 三页去掉主题层后逐字节相同', strip('papercut') === strip('ticket') && strip('ticket') === strip('isometric'), true);
  const scriptOf = (s) => html[s].match(/[ \t]*<script>([\s\S]*?)<\/script>/m)[1];
  eq('B7 三页脚本逐字节相同', scriptOf('papercut') === scriptOf('ticket') && scriptOf('ticket') === scriptOf('isometric'), true);
  eq('B7 脚本文件即内联体（无二次加工）', scriptOf('papercut').indexOf(read(join(SRC, 'app.js')).trim()) > 0, true);
}

/* ================= B8 二次访问：从 localStorage 恢复已投状态与票档 ================= */
{
  const seed = JSON.stringify({ v: 1, data: { voted: ['a02', 'bad-id', 'a99'], tier: 'vip' } });
  const dom = await load('ticket', seed);
  const d = dom.window.document;
  const votedCards = [...d.querySelectorAll('.vote.voted')].map((n) => n.closest('.artist').getAttribute('data-id')).sort();
  const realIds = (contentSrc.match(/\{ id: '(a\d\d)'/g) || []).map((x) => x.match(/a\d\d/)[0]);
  eq('B8 合法且在阵容内的已投记录被恢复', votedCards.join(','), ['a02', 'a99'].filter((x) => realIds.includes(x)).join(','));
  eq('B8 非法 voted id 被 sanitize 丢弃', votedCards.indexOf('bad-id') < 0, true);
  eq('B8 sanitize 保留两个合法 id（含阵容外 id 也不炸卡）', dom.window.__lab.prefs.voted.length, 2);
  eq('B8 票档偏好回填 VIP', [...d.querySelectorAll('.tier[aria-pressed="true"]')][0].getAttribute('data-tier'), 'vip');
  await waitFor(() => /前区平台余量/.test(d.getElementById('vip-box').textContent), 'B8 二次访问直接取 VIP 余量');
  eq('B8 恢复票档会补取前区库存（一次）', countReqs(dom, '/api/tickets/vip'), 1);
  eq('B8 恢复的已投卡不重复计数', lab_voted_len(dom), 2);
  await close(dom);
}
function lab_voted_len(dom) { return dom.window.__lab.prefs.voted.length; }

/* ================= C 组：风格指纹三式（全部从 CSS 文本现读，不依赖 jsdom 的 var 解析） ================= */
const palettes = {};
for (const s of STYLES) {
  const css = read(join(SRC, 'theme-' + s + '.css'));
  const declared = new Set((css.slice(0, css.indexOf('body {')).match(/#[0-9A-Fa-f]{3,8}/g) || []).map((x) => x.toLowerCase()));
  const all = new Set((css.match(/#[0-9A-Fa-f]{3,8}/g) || []).map((x) => x.toLowerCase()));
  palettes[s] = all;
  ok('C/' + s + ' 色板封闭（页内 hex 全属 :root 声明）', [...all].every((h) => declared.has(h)), [...all].filter((h) => !declared.has(h)).join(','));
}
{
  const base = read(join(SRC, 'base.css'));
  eq('C 结构层零 hex（分层未失效）', /#[0-9A-Fa-f]{3,8}/.test(base.replace(/:root\s*\{[\s\S]*?\}/g, '')), false);
  eq('C 结构层 !important 只允许 [hidden] 一处', (base.match(/!important/g) || []).length, 1);
  ok('C 该处确为 [hidden] 复位', /\[hidden\][\s\S]{0,40}!important/.test(base));
  const names = [...STYLES];
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    const a = palettes[names[i]], b = palettes[names[j]];
    eq('C 色板零交集 ' + names[i] + '×' + names[j], [...a].filter((h) => b.has(h)).length, 0);
  }
  /* 七指纹：①阵容栅格 ②标题族 ③正文档 ④卡圆角 ⑤日程表处理 ⑥竖排 ⑦变换/阴影手法 */
  const fp = {};
  for (const s of names) {
    const css = stripComments(read(join(SRC, 'theme-' + s + '.css')));
    /* 极简 CSS 规则表：先建 (selector, decls) 索引，再按「选择器组里是否含目标选择器」取值，
       避免用「距离 :root 多少字符」这类脆弱窗口（本轮首跑就是它把两页字体读成同一个 none） */
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const inSel = (r, target) => r.sel.split(',').some((x) => x.trim() === target);
    const declIn = (target, prop) => {
      for (const r of rules) if (inSel(r, target)) { const m = r.body.match(new RegExp('(?:^|;)\\s*' + prop + ': *([^;]+)')); if (m) return m[1].trim(); }
      return 'none';
    };
    const token = (name) => { const m = css.match(new RegExp('--' + name + ': *([^;]+);')); return m ? m[1].trim() : 'none'; };
    fp[s] = {
      lineupCols: declIn('.lineup-grid', 'grid-template-columns'),
      headFont: token('font-head'),
      bodyFont: token('font-body'),
      radius: declIn('.artist', 'border-radius'),
      sessionsTrick: /thead[\s\S]{0,60}position: *absolute/.test(css) ? 'thead-hidden'
        : (/tr:nth-child\(even\)[\s\S]{0,80}background/.test(css) ? 'zebra-table' : 'plain-table'),
      vertical: /writing-mode: *vertical-rl/.test(css),
      transform: /perspective\(/.test(css) ? 'perspective' : /skewY\(/.test(css) ? 'skew' : 'none',
      shadow: /box-shadow:[^;]*0 0 \d+px/.test(css) ? 'glow' : /box-shadow: *0 \d+px 0/.test(css) ? 'hard-offset' : /box-shadow: *\d+px \d+px 0/.test(css) ? 'cast-offset' : 'none',
    };
  }
  const keys = Object.keys(fp.papercut);
  for (const [a, b] of [['papercut', 'ticket'], ['ticket', 'isometric'], ['papercut', 'isometric']]) {
    const diff = keys.filter((k) => String(fp[a][k]) !== String(fp[b][k]));
    num('C 指纹差异 ≥3 ' + a + '×' + b, diff.length, '>=', 3, ' 项（实差 ' + diff.join(',') + '）');
  }
  /* 指纹不能三页全同：至少每项都有区分度 */
  for (const k of keys) num('C 指纹项「' + k + '」三页非单一值', new Set(names.map((n) => String(fp[n][k]))).size, '>=', 2);
  /* body 背景色由 token 决定，三页互不相同 */
  const bgOf = (s) => { const css = read(join(SRC, 'theme-' + s + '.css')); return css.match(/--bg: *var\((--[a-z0-9-]+)\)/)[1]; };
  eq('C 三页背景 token 互不相同', new Set(names.map(bgOf)).size, 3);
  writeFileSync(join(ROOT, 'scripts', 'fingerprints.json'), JSON.stringify(fp, null, 2) + '\n');
}

/* ================= D 组：与 20:00 React 轮的成本对照 ================= */
{
  const prevFiles = readdirSync(join(PREV, 'preview')).filter((f) => /^activity-.*\.html$/.test(f));
  eq('D 基线轮有 3 份预览页', prevFiles.length, 3);
  const prevBytes = prevFiles.map((f) => Buffer.byteLength(readFileSync(join(PREV, 'preview', f))));
  const prevTotal = prevBytes.reduce((a, b) => a + b, 0);
  const myTotal = STYLES.reduce((a, s) => a + pages[s].bytes, 0);
  const prevSrc = walk(join(PREV, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
  const prevLoc = prevSrc.reduce((a, f) => a + read(f).split('\n').length, 0);
  const mySrc = walk(SRC).filter((f) => /\.(js|css|html)$/.test(f));
  const myLoc = mySrc.reduce((a, f) => a + read(f).split('\n').length, 0);
  num('D 三页总字节 < 基线的 1/3', myTotal, '<', Math.round(prevTotal / 3), 'B');
  num('D 单页字节 < 基线单页均值', Math.round(myTotal / 3), '<', Math.round(prevTotal / 3), 'B');
  num('D 产物总体积 < 1MB', myTotal + Buffer.byteLength(read(join(ROOT, 'build.mjs'))), '<', 1024 * 1024);
  num('D 源码行数 < 基线（同功能面）', myLoc, '<', prevLoc);
  eq('D 无 node_modules 于场景目录', existsSync(join(ROOT, 'node_modules')), false);
  eq('D 无 dist 于场景目录', existsSync(join(ROOT, 'dist')), false);
  eq('D 基线轮确有 mock 服务端（能力差记账）', existsSync(join(PREV, 'server', 'mock-api.mjs')), true);
  writeFileSync(join(ROOT, 'scripts', 'cost-comparison.json'), JSON.stringify({
    thisRound: { bytesPerStyle: pages, totalBytes: myTotal, loc: myLoc, files: mySrc.length },
    baselineReact: { bytesPerStyle: prevBytes.map((b) => ({ bytes: b })), totalBytes: prevTotal, loc: prevLoc, files: prevSrc.length },
    ratio_bytes: +(prevTotal / myTotal).toFixed(2), ratio_loc: +(prevLoc / myLoc).toFixed(2),
  }, null, 2) + '\n');
  console.log('  · 成本对照：零框架 ' + myTotal + 'B/' + myLoc + ' 行 vs React ' + prevTotal + 'B/' + prevLoc + ' 行 → 体积 ' + (prevTotal / myTotal).toFixed(2) + '× 行数 ' + (prevLoc / myLoc).toFixed(2) + '×');
}

/* ================= G 组：台账幂等（快照 + 增量 == 现值） ================= */
{
  const snap = JSON.parse(read(join(ROOT, 'scripts', 'ledger-snapshot.json')));
  const st = JSON.parse(read(join(LAB, 'state', 'state.json')));
  eq('G used_styles 增量 = 本轮三风格', st.used_styles.length - snap.used_styles, 3);
  eq('G used_styles 末三条 = 快照本轮风格', st.used_styles.slice(-3).join('|'), snap.this_round_styles.join('|'));
  eq('G tried 增量 = 1', st.tried.length - snap.tried, 1);
  eq('G runs 增量 = 1', st.runs.length - snap.runs, 1);
  eq('G environment_notes 增量 = 快照声明条数', st.environment_notes.length - snap.environment_notes, snap.new_env_notes);
  eq('G skills_seen 数量不变（同名先删后插）', st.skills_seen.length, snap.skills_seen);
  const last = st.tried[st.tried.length - 1];
  eq('G tried 末条 = 本轮组合', last.scenario.indexOf('声浪岛') >= 0 && /sites-building/.test(last.skill), true);
  eq('G 本轮风格未与历史重复', new Set(st.used_styles).size, st.used_styles.length);
}

/* ---------- 工具 ---------- */
function countReqs(dom, path) { return dom.window.__lab.svc.reqLog.filter((r) => r.path === path).length; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function setVal(w, el, v) {
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
async function waitFor(fn, label) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > 4000) throw new Error('waitFor 超时：' + (label || '')); await sleep(4); }
}
async function load(slug, seed) {
  const dom = new JSDOM(html[slug], { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/activity-' + slug + '.html' });
  if (seed !== undefined) {
    dom.window.close();
    const d2 = await loadWithSeed(slug, seed);
    return d2;
  }
  await waitFor(() => d2ready(dom));
  return dom;
}
function d2ready(dom) { return dom.window.__lab && dom.window.__lab.ready === true; }
async function loadWithSeed(slug, seed) {
  const dom = new JSDOM(html[slug], {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://localhost/activity-' + slug + '.html',
    beforeParse(w) {
      const store = new Map([['soundisle.prefs.v1', seed]]);
      Object.defineProperty(w, 'localStorage', {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        }, configurable: true,
      });
    },
  });
  await waitFor(() => d2ready(dom));
  return dom;
}
async function loadDom(slug) {
  const dom = new JSDOM(html[slug], { runScripts: 'outside-only', pretendToBeVisual: true });
  return dom;
}
async function waitForReady(dom) { await waitFor(() => d2ready(dom)); }
async function close(dom) { dom.window.__lab.timers.forEach((t) => dom.window.clearInterval(t)); dom.window.close(); }

console.log('\n断言：通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exitCode = 1; }
else console.log('check: 全部通过');
