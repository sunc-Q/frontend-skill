/**
 * Generates styles.html — the three-style comparison entry — from machine evidence only:
 * .tmp-check/assertions-{node,dom,browser}.json + scripts/build-inline-meta.json + the compiled
 * style registry (through the same esbuild bridge the checkers use). Nothing on the page is typed
 * by hand, so re-running the checks and then this script cannot leave a stale number behind.
 *
 * It writes styles.html rather than index.html on purpose: index.html is the *Vite entry*, and a
 * generator that overwrote it would make `bash scripts/verify.sh` unreproducible on the second run.
 *
 * Run: node scripts/make-styles.mjs   (after the three check scripts)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFacts } from './dump-facts.mjs';
import { ROUND_ID } from './round-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const CHECK = path.join(ROOT, '.tmp-check');
const meta = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'build-inline-meta.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8'));
/* The write-back adds one runs[] entry, so the round number must not depend on when this runs. */
const writtenBack = ledger.tried.some((e) => e.report === `reports/${ROUND_ID}.md`);
const runNo = ledger.runs.length + (writtenBack ? 0 : 1);

function load(tag) {
  const file = path.join(CHECK, `assertions-${tag}.json`);
  if (!existsSync(file)) {
    console.error(`missing ${file} — run scripts/check-${tag}.mjs first`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

const files = { node: load('node'), dom: load('dom'), browser: load('browser') };

function find(tag, prefix) {
  const row = files[tag].find((r) => r.id.startsWith(prefix));
  if (!row) throw new Error(`assertion "${prefix}" not found in ${tag} results`);
  return row;
}
const printed = (tag, prefix) => {
  const r = find(tag, prefix);
  return r.printed ?? r.detail;
};
const passes = (tag, prefix) => find(tag, prefix).pass;
/** num rows print `value · detail` — the leading value is the first arm's count repeated, so for a
    table cell drop it and keep the sentence (only N8 needs this). */
const observed = (tag, prefix) => {
  const r = find(tag, prefix);
  return r.detail ?? String(r.printed).replace(/^\d+/, '').trim();
};
const allWith = (tag, prefix) => files[tag].filter((r) => r.id.startsWith(prefix));
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const { STYLE_IDS, STYLES, corpus } = await loadFacts();
const corpusStats = corpus.stats;
const intf = (n) => Number(n).toLocaleString('en-US');

const tally = Object.entries(files).map(([tag, rows]) => ({
  tag,
  total: rows.length,
  failed: rows.filter((r) => !r.pass),
}));
const failedRows = tally.filter((t) => t.failed.length > 0);
const totalAll = tally.reduce((s, t) => s + t.total, 0);
const failedAll = tally.reduce((s, t) => s + t.failed.length, 0);

const pageOf = (id) => meta.pages.find((p) => p.id === id);
const styleRows = STYLE_IDS.map((id) => ({
  id,
  ...STYLES[id],
  palette: Object.values(STYLES[id].color).slice(0, 8),
  bytes: pageOf(id).bytes,
  /* predicted from the token block vs measured in Chromium — the two must agree or CSS lies */
  tokenContrast: printed('node', `C8 ${id} 正文/次要`),
  realContrast: `${printed('browser', `D5 ${id}`).split(' ')[0]} / ${printed('browser', `D5b ${id}`).split(' ')[0]}`,
  mechanism: printed('browser', `D6 ${id}`),
  hotProof: passes('browser', `D7 ${id}`),
  noExternal: passes('browser', `D0b ${id}`) ? '零跨源请求' : '有跨源请求',
  noOverflow: passes('browser', `D3 ${id}`) && passes('browser', `D4 ${id}`) ? '1440px 与 430px 均无横向溢出' : '溢出',
  rowPx: printed('browser', `D1 ${id}`),
  windowPx: printed('browser', `D2 ${id}`),
}));

/** The claim each skin makes, read from the same token object the CSS is derived from. */
const techniqueRows = STYLE_IDS.map((id) => [
  `${STYLES[id].name}（${id}）`,
  `分隔=${STYLES[id].separation} · 热帖=${STYLES[id].hotMark} · 圆角=${STYLES[id].radius} · 描边=${STYLES[id].borderWidth} · 行阴影=${STYLES[id].rowShadow} · 面板阴影=${STYLES[id].cardShadow} · 标题=${STYLES[id].headTransform}/${STYLES[id].headingSize} · 字族 UI=${STYLES[id].fontUi.split(',')[0]} 数字=${STYLES[id].fontNum.split(',')[0]} · 行高=${STYLES[id].rowHeight.comfortable}/${STYLES[id].rowHeight.compact}`,
]);

/** C/D 组：源码里声明的互斥性，在真实计算样式里是否仍然互斥。 */
const exclusionRows = [
  ['十四维令牌指纹的两两差异（阈值 ≥7）', allWith('node', 'C5 ').map((r) => `${r.id.slice(3).split(' 十四')[0]} → ${r.detail.split('：')[0]}`).join(' ｜ ')],
  ['十二项计算样式指纹的两两差异（阈值 ≥7）', allWith('browser', 'D8 ').map((r) => `${r.id.split(' ')[1]} → ${r.detail.split('（')[0]}`).join(' ｜ ')],
  ['三种分隔手法实测互斥', passes('browser', 'D9 ') ? printed('browser', 'D9 ') : '未互斥'],
  ['三种热帖标记实测互斥', passes('browser', 'D9b ') ? printed('browser', 'D9b ') : '未互斥'],
  ['阴影手法实测互斥', passes('browser', 'D10 ') ? printed('browser', 'D10 ') : '未互斥'],
  ['三风格行高是否各不相同', passes('browser', 'D11 ') ? `是（${printed('browser', 'D11 ')}）——同一份数据在三种密度基准下画出不同窗口` : '否'],
  ['令牌层是否真的画出了这一行', allWith('browser', 'D1 ').map((r) => `${r.id.split(' ')[1]}→${r.detail}`).join(' ｜ ')],
  ['结构层字面颜色', passes('node', 'C2 ') ? '零处（删掉令牌块后无颜色可换）' : '存在'],
  ['三页 <script> 载荷', passes('node', 'B2 ') ? `${printed('node', 'B2 ')}——同一份字符串，风格不复制运行时` : '不同'],
  ['字节不变式（页面 = 脚本字节 + 壳字节）', passes('node', 'B4 ') ? `脚本 ${printed('node', 'B8 ')} ＋ ${printed('node', 'B4 ')}` : '不成立'],
];

/** N 组：同一份源码的四臂构建，只换 __FD_ARM__。 */
const ablationRows = [
  ['四臂 bundle 字符数（同源码，只差 define；差异 <1% 即构建成本可忽略）', observed('dom', 'N10 ')],
  ['主臂 DOM 行数 / 关掉虚拟滚动后', `${printed('dom', 'N1 ')} ↔ ${printed('dom', 'N2 ')}`],
  ['滚动一次后：窗口与 DOM 行数是否有界', `${printed('dom', 'N11 ')} ｜ ${printed('dom', 'N12 ')} ｜ ${printed('dom', 'N12b ')}`],
  ['真实像素下的同一件事（Chromium，非注入）', `${printed('browser', 'K1 ')} ｜ ${printed('browser', 'K2 ')} ｜ ${printed('browser', 'K2b ')}`],
  ['3 次击键的 row 渲染次数：主臂 / 关 memo', `${printed('dom', 'N3 ')} ↔ ${printed('dom', 'N4 ')}（每击键 ${printed('dom', 'N7 ')} ↔ ${printed('dom', 'N7b ')}）`],
  ['差异是否只在行这一层', passes('dom', 'N6 ') ? printed('dom', 'N6 ') + '（列表容器没有被重建）' : '否'],
  ['这三次击键是否真的改过列表', passes('dom', 'N4b ') ? printed('dom', 'N4b ') + '（否则「行渲染 0 次」只是什么都没发生）' : '未改动'],
  ['1.5s 窗口内的取数次数：主臂 / queryKey 不稳定', observed('dom', 'N8 ')],
  ['queryKey 不稳定的真实后果', passes('dom', 'N9b ') ? `${printed('dom', 'N9 ')}；主臂三次击键 ${printed('dom', 'N9b ')}` : '未测'],
  ['三臂里哪一条是「坏掉」而不是「变慢」', passes('dom', 'N9c ') ? printed('dom', 'N9c ') : '未测'],
  ['关掉虚拟滚动的 DOM 节点代价', printed('dom', 'N13 ')],
  ['四臂在 jsdom 里是否都零报错', passes('dom', 'N0 ') ? printed('dom', 'N0 ') : '有报错'],
];

/** G 组：同一份产物换成真 HTTP（?api=1 + split 构建），服务端与浏览器各记一遍账。 */
const transferRows = [
  ['首屏接口请求（客户端 / 服务端各记一次）', printed('browser', 'G1 ')],
  ['首屏是否取了读数的数据', passes('browser', 'G2 ') ? `否（/api/insights ${printed('browser', 'G2 ')}）` : '是'],
  ['首屏下载了哪些 JS chunk', printed('browser', 'G2b ')],
  ['悬停「展开读数」按钮之后', printed('browser', 'G3 ')],
  ['悬停是否同时预热了接口', passes('browser', 'G3b ') ? printed('browser', 'G3b ') : '未预热'],
  ['点开面板时新增请求数', passes('browser', 'G4 ') ? printed('browser', 'G4 ') + '（预取与点击共用同一次读、同一个 chunk）' : '有新增'],
  ['进入正文路由的接口代价', printed('browser', 'G5 ')],
  ['进入归档路由的接口代价', passes('browser', 'G6 ') ? printed('browser', 'G6 ') + '（列表缓存命中，只下载它自己的 chunk）' : '重取了数据'],
  ['浏览器后退', (() => { const d = JSON.parse(String(find('browser', 'G6c ').detail ?? '{}')); return `回到归档=${d.archive} 且没有重取数据（首页列表 DOM 已卸载=${!d.home}）`; })()],
  ['三路由走完后累计', printed('browser', 'G7b ')],
  ['同一 JS 资源是否被请求两次', passes('browser', 'G7 ') ? printed('browser', 'G7 ') : '有重复'],
  ['未预热点开 vs 预热点开（jsdom 帧数，噪声 ±3）', `${printed('dom', 'H39d ')} ｜ 可断言的部分：${printed('dom', 'H39e ')}`],
];

/** G8：本轮唯一的结构性发现——Suspense 边界挂在路由层时，外壳被 fallback 一起吞掉。 */
const boundaryRows = [
  ['1.8s 慢接口期间的占位', passes('browser', 'G8 ') ? printed('browser', 'G8 ') : '出现空窗帧'],
  ['占位真实高度', `${printed('browser', 'G8b ')}（≥500px：${printed('browser', 'G8c ')}）`],
  ['改造后：边界之上的 chrome 位移', printed('browser', 'G8d ')],
  ['改造后：固定预留挡不住的部分', printed('browser', 'G8d2 ')],
  ['改造前的同一次测量（对照，非断言）', printed('browser', 'G8d3 ')],
  ['内容落地后页脚是否继续跳', passes('browser', 'G8e ') ? printed('browser', 'G8e ') : '仍在跳'],
  ['慢接口期间顶部统计块是否在场', passes('browser', 'G8f ') ? `${printed('browser', 'G8f ')}——没有 early-return 把整页抹掉` : '被抹掉'],
  ['服务端在 1.8s 窗口里实际收到', printed('browser', 'G8g ')],
  ['稳定 / 不稳定 queryKey 的 2s 窗口请求比', printed('browser', 'G9c ')],
];

/** M 组：同一浏览器实例里两种载体各自的持久化。 */
const carrierRows = [
  ['冷启动落盘（新 context 不串存储，切片自 M1 原文）', allWith('browser', 'M1 ').map((r) => `${r.id.split(' ')[1]}：${String(r.detail).slice(0, 92)}`).join(' ｜ ')],
  /* M2's detail is the checker's own 80-char slice of the written envelope — every field on this
     row is pulled out of that slice by regex, so a changed envelope shows up here instead of
     contradicting a hand-typed summary. */
  ['点击后写入 localStorage 的 version=3 信封', allWith('browser', 'M2 ').map((r) => {
    const d = String(r.detail);
    const field = (k) => new RegExp(`"${k}":"([^"]*)`).exec(d)?.[1] ?? '（不在 80 字切片内）';
    return `${r.id.split(' ')[1]}：version=${/"version":(\d+)/.exec(d)?.[1]}、${["sort", "density", "tag"].map((k) => `${k}=${field(k)}`).join(' ')}、starred 前缀「${/"starred":\["([^"]*)/.exec(d)?.[1]}…」`;
  }).join(' ｜ ')],
  ['刷新后收藏与行内按钮态', allWith('browser', 'M3 ').map((r) => { const d = JSON.parse(String(r.detail)); return `${r.id.split(' ')[1]}：${d.count.split(' ·')[0]} · 第 ${d.pressedRow + 1} 行 pressed=${d.pressed} · 密度仍为${d.density}`; }).join(' ｜ ')],
  ['敌意输入：非 JSON 草稿', allWith('browser', 'M4 ').map((r) => `${r.id.split(' ')[1]}：回落默认且照画 ${JSON.parse(String(r.detail)).rows} 行`).join(' ｜ ')],
  ['敌意输入：5000 项星单', allWith('browser', 'M4b ').map((r) => `${r.id.split(' ')[1]}：${r.detail}`).join(' ｜ ')],
  ['两个载体互不相通', printed('browser', 'M5 ')],
  ['写入的正是各自点过的那一行', passes('browser', 'M5b ') ? printed('browser', 'M5b ') : '未证实'],
  ['同一份构建在两种载体上各自选中自己的皮肤', printed('browser', 'M6 ')],
];

const costRows = [
  ['本场景 src 文件数 / 行数', printed('node', 'J1 ')],
  ['单文件产物字节（三页）', printed('node', 'B9 ')],
  ['内联 bundle 字节', printed('node', 'B8 ')],
  ['证据构建：入口 chunk / 可延迟 chunk', `${printed('node', 'L2 ')} ＋ ${printed('node', 'L3 ')}`],
  ['可延迟重量占比（本轮要回答的问题）', printed('node', 'L3b ')],
  ['两构建总量差', printed('node', 'L7 ')],
  ['08:00 向导轮 bundle / 07:00 管理后台轮 bundle', `${printed('node', 'J4b 08:00')} / ${printed('node', 'J4b 07:00')}`],
  ['本轮 bundle ÷ 向导轮 bundle', printed('node', 'J5 ')],
  ['对照分母现读（目录字节/文件数）', allWith('node', 'J3 ').map((r) => `${r.id.split(' ')[2]} ${r.detail}`).join(' ｜ ')],
  ['首屏从 eval 到第一行（jsdom，含 90ms fixture）', `${printed('dom', 'F8 ')}，其中同步 eval 段 ${printed('dom', 'F8b ')}`],
  ['技能 SKILL.md 声明的资源 vs 本机实有', `${printed('node', 'A1c ')}，${printed('node', 'A1e ')} 缺失`],
  ['一行摘要条款里可机检并被逐条断言的', printed('node', 'A2c ')],
];

const card = (s, i) => `
  <a class="card" href="preview/portal-${esc(s.id)}.html">
    <span class="row"><span class="idx">${i + 1}</span><span class="name">${esc(s.name)}
      <span class="mid">${esc(s.id)}</span></span>
      <span class="sw">${s.palette.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></span>
    <p>${esc(s.desc)}</p>
    <dl class="facts">
      <dt>对比度（令牌层预测 / Chromium 实测，WCAG AA ≥4.5）</dt><dd class="mono">${esc(s.tokenContrast)} · ${esc(s.realContrast)}</dd>
      <dt>分隔与热帖机制（实测）</dt><dd class="mono">${esc(s.mechanism)} · 热帖机制按预期渲染：${s.hotProof ? '是' : '否'}</dd>
      <dt>行高令牌是否真的画出这一行</dt><dd class="mono">${esc(s.rowPx)} ｜ ${esc(s.windowPx)}</dd>
      <dt>外链与溢出</dt><dd class="mono">${esc(s.noExternal)} · ${esc(s.noOverflow)}</dd>
      <dt>预览文件</dt><dd class="mono">${esc(pageOf(s.id).file)} · ${s.bytes.toLocaleString('en-US')} B</dd>
    </dl>
  </a>`;

const table = (caption, rows) => `
  <table>
    <caption>${esc(caption)}</caption>
    <tbody>${rows
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td class="mono">${esc(v)}</td></tr>`)
      .join('')}</tbody>
  </table>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>灰度通讯 · frontend-development × 博客内容门户（路由与代码分割密集场景）· 三风格对照</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 40px 24px 72px; font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; background: #f4f4f6; color: #1b1b1f; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: .01em; }
  h2 { font-size: 17px; margin: 34px 0 12px; }
  .lead { color: #66666e; margin: 0 0 26px; }
  .card { display: block; text-decoration: none; color: inherit; background: #fff; border: 1px solid #e2e2e7; border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; }
  .card:hover { border-color: #2f4e83; box-shadow: 0 6px 20px rgba(20,20,30,.07); }
  .row { display: flex; align-items: baseline; gap: 12px; }
  .idx { font-size: 12px; color: #8a8a92; font-variant-numeric: tabular-nums; }
  .name { font-size: 17px; font-weight: 650; }
  .mid { font-weight: 400; color: #8a8a92; font-family: ui-monospace, Menlo, monospace; font-size: 12px; margin-left: 6px; }
  .sw { display: inline-flex; gap: 4px; margin-left: auto; }
  .sw i { width: 20px; height: 20px; border-radius: 5px; border: 1px solid rgba(0,0,0,.12); display: block; }
  .card p { margin: 8px 0 0; color: #55555c; font-size: 14px; }
  .facts { display: grid; grid-template-columns: 300px 1fr; gap: 2px 14px; margin: 12px 0 0; font-size: 12.5px; }
  .facts dt { color: #7c7c85; }
  .facts dd { margin: 0; color: #2c2c33; }
  .mono, td.mono { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e2e7; border-radius: 12px; overflow: hidden; margin: 0 0 8px; table-layout: fixed; }
  caption { caption-side: top; text-align: left; font-size: 13px; color: #7c7c85; padding: 10px 12px 6px; }
  th, td { text-align: left; padding: 9px 12px; border-top: 1px solid #ececf0; vertical-align: top; word-break: break-word; }
  th { font-weight: 550; color: #3a3a42; width: 42%; }
  ol.steps { padding-left: 20px; }
  .ok { color: #1f7a44; } .bad { color: #a8322f; }
  .note { margin-top: 30px; font-size: 13px; color: #66666e; border-top: 1px dashed #dcdce0; padding-top: 16px; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; background: #ececef; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>灰度通讯 GRAYSCALE · 博客内容门户</h1>
  <p class="lead">第 ${runNo} 轮：skill <code>frontend-development</code> × 场景「博客内容门户 / 路由与代码分割密集场景」（4 条 hash 路由 + 1 个懒图表面板 / 240 篇文章 / 虚拟滚动列表 / 防抖检索 / 收藏持久化）。三份预览共用同一份内联构建产物（${printed('node', 'B2 ')}，逐字节相同），风格差异只来自 <code>&lt;html data-fd-style&gt;</code> 与令牌块；本页所有数字由 <code>.tmp-check/assertions-*.json</code> 经 <code>scripts/make-styles.mjs</code> 生成，不手写。</p>

  ${styleRows.map(card).join('\n')}

  <h2>断言汇总</h2>
  <table>
    <caption>三组校验脚本：node 侧静态契约与事实源复算 / jsdom 交互与四臂消融 / 真实 Chromium 计算样式、逐帧采样与真 HTTP 台账</caption>
    <tbody>
      ${tally
        .map(
          (t) =>
            `<tr><th>scripts/check-${t.tag}.mjs</th><td class="mono ${t.failed.length ? 'bad' : 'ok'}">${t.total - t.failed.length}/${t.total} 通过${t.failed.length ? `（${t.failed.map((f) => esc(f.id.split(' ')[0])).join(', ')}）` : ''}</td></tr>`,
        )
        .join('')}
      <tr><th>合计</th><td class="mono ${failedAll ? 'bad' : 'ok'}">${totalAll - failedAll}/${totalAll} 通过${failedAll ? ` · ${failedAll} 项失败` : ' · 全绿'}</td></tr>
    </tbody>
  </table>
  ${
    failedRows.length
      ? failedRows
          .map(
            (t) =>
              `<table><caption>check-${t.tag}.mjs 失败项</caption><tbody>${t.failed
                .map((f) => `<tr><th>${esc(f.group)} · ${esc(f.id)}</th><td>${esc(f.detail)}</td></tr>`)
                .join('')}</tbody></table>`,
          )
          .join('\n')
      : ''
  }

  <h2>三套手法各自的构造（互斥性由 C5/C6 声明、D8–D12 在真实渲染里复测）</h2>
  ${table('分隔手法 / 热帖标记 / 圆角 / 描边 / 阴影 / 标题变形 / 字族 / 行高，全部读自同一份令牌对象', techniqueRows)}
  ${table('「换皮肤不换 DOM、也不换字节」这组主张的实测结果', exclusionRows)}

  <h2>三臂消融：同一份源码只换 <code>__FD_ARM__</code></h2>
  <p class="lead">技能原文给了三条各自独立的主张——「虚拟滚动处理大列表」「React.memo 行组件」「queryKey 要稳定」。四臂是同一份源码的四次构建（字符数 ${observed('dom', 'N10 ')}，差异 &lt;1%），渲染计数由文件内计数器量出，DOM 行数由 jsdom 与真实 Chromium 各量一遍。</p>
  ${table('虚拟滚动 / memo 行 / 稳定 queryKey 各自值多少（N 组）', ablationRows)}

  <h2>代码分割的可见代价：<code>?api=1</code> 真 HTTP + 真 chunk 图</h2>
  <p class="lead">G 组跑在 <code>dist-split</code>（真正的多 chunk 图，入口 ${printed('node', 'L2 ')}）之上，由本机 mock origin 同时记两份账：服务端到达日志与浏览器请求列表。L 组则从构建产物侧独立复算了「首包里到底有没有这些实现」。</p>
  ${table('谁在什么时候取了数、下载了哪个 chunk（G 组）', transferRows)}

  <h2>本轮的结构性发现：Suspense 边界挂在哪一层</h2>
  <p class="lead">技能只说了「用 Suspense 包住懒组件」，没说边界应该挂在哪。把它挂在路由层时，<code>Layout</code>（站名、导航、全站统计、页脚）成了 fallback 的一部分被一起抹掉；把 chrome 提到边界之外之后，等待期只剩 <code>&lt;main&gt;</code> 在动。</p>
  ${table('1.8s 慢接口下逐帧采样的位移账（G8/G9 组）', boundaryRows)}

  <h2>收藏持久化：同一浏览器实例里的两种载体</h2>
  ${table('file:// 与 http:// 各跑一遍同一组敌意输入（M 组）', carrierRows)}

  <h2>成本与规模（对照同日 07:00 管理后台轮、08:00 向导轮）</h2>
  ${table('本轮与两轮的现算值', costRows)}

  <h2>预览与复现</h2>
  <ol class="steps">
    <li>直接双击任一 <code>preview/portal-*.html</code>（<code>file://</code> 下可完整交互，页面零外链；M 组已对两种载体各跑一遍）。</li>
    <li>真网络与真 chunk 图：<code>node server/mock-api.mjs 8157</code> 后访问 <code>http://127.0.0.1:8157/preview/split-host.html</code>，慢接口在 <code>?api=1</code> 下由 <code>/api/*</code> 逐路径可调延迟驱动。</li>
    <li>消融臂：<code>preview/arm-nomemo.html</code>、<code>arm-novirtual.html</code>、<code>arm-unstablekey.html</code>（页脚标记当前臂）；四臂比对在 <code>scripts/check-dom.mjs</code> 的 N 组。unstablekey 臂双击后<b>永远不会画出列表</b>，这正是它的主张。</li>
    <li>全量复现：<code>bash scripts/verify.sh</code>（npm install → tsc → 五套 vite 构建 → 内联 → 三个 checker → 本页 → 台账校验 → 收尾清单校验）。</li>
  </ol>
  <div class="note">
    三页共用同一组件树与同一事实源：${esc(String(corpusStats.posts))} 篇虚构文章、${esc(intf(corpusStats.views))} 次阅读，标签 / 归档 / 相关文 / 读数面板全部由 <code>src/lib/facts.ts</code> 一份语料推导（F10 断言了「页面上打印的读数 = Node 侧独立复算值」），Node 与浏览器经同一个 esbuild 桥读取；检索、排序、密度、收藏走 version=3 信封并逐字段消毒（非法枚举、非法 tag、畸形与重复 slug、5000 项星单截到 60 条）。<br />
    技能 <code>frontend-development</code> 的 SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 共 ${printed('node', 'A1e ')} 在本机不存在（第 4 次复跑仍未修复），因此页面上的每个数字都来自本轮自建判据，而不是技能文档。
  </div>
</div>
</body>
</html>
`;

writeFileSync(path.join(ROOT, 'styles.html'), html, 'utf8');
console.log(`styles.html written: ${Buffer.byteLength(html, 'utf8')}B from ${totalAll} assertions`);
