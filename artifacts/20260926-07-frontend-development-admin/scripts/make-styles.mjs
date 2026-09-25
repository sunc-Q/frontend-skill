/**
 * Generates index.html (the three-style comparison entry) from machine evidence only:
 * .tmp-check/assertions-{node,dom,browser}.json + scripts/build-inline-meta.json + the
 * compiled style registry. Nothing in the output page is typed by hand, so a later run
 * that re-executes the checks gets a page whose numbers cannot drift from the asserts.
 * Run: node scripts/make-styles.mjs   (after the three check scripts)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_IDS, STYLES, paletteOf } from '../.tmp-check/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const CHECK = path.join(ROOT, '.tmp-check');
const meta = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'build-inline-meta.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8'));
/* The write-back adds one runs[] entry, so the round number must not depend on when this runs. */
const writtenBack = ledger.tried.some((e) => e.report === 'reports/20260926-07-frontend-development-admin.md');
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
const all = Object.entries(files).flatMap(([tag, rows]) => rows.map((r) => ({ ...r, tag })));

function find(tag, id) {
  const row = all.find((r) => r.tag === tag && r.id.startsWith(id));
  if (!row) throw new Error(`assertion ${id} not found in ${tag} results`);
  return row;
}
const printed = (tag, id) => {
  const r = find(tag, id);
  return r.printed ?? r.detail;
};
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* pass/fail bookkeeping per checker file */
const tally = Object.entries(files).map(([tag, rows]) => ({
  tag,
  total: rows.length,
  failed: rows.filter((r) => !r.pass),
}));
const failedRows = tally.filter((t) => t.failed.length > 0);
const totalAll = tally.reduce((s, t) => s + t.total, 0);
const failedAll = tally.reduce((s, t) => s + t.failed.length, 0);

/* per-style measured evidence */
const pageOf = (id) => meta.pages.find((p) => p.id === id);
const styleRows = STYLE_IDS.map((id) => ({
  id,
  name: STYLES[id].name,
  desc: STYLES[id].desc,
  palette: paletteOf(id).slice(0, 5),
  bytes: pageOf(id).bytes,
  browser: path.basename(pageOf(id).file),
  fingerprint: printed('browser', `D3b ${id}`),
  body: printed('browser', `D4b ${id}`),
  muted: printed('browser', `D5b ${id}`),
  delta: printed('browser', `D6b ${id}`),
  requests: printed('browser', `D0 ${id}`),
}));

/* the three mutually exclusive separation techniques asserted by C / D13 */
const claimText = {
  neumorph: '双向相反符号阴影塑形 + 零描边 + 18px 圆角',
  bitmap: '1px 实线网格 + 零圆角零阴影 + 表头反白',
  phosphor: '磷绿 text-shadow 发光 + repeating-linear-gradient 扫描线 + 暗底',
};
const claimRows = STYLE_IDS.map((id) => [`${STYLES[id].name}（${id}）`, claimText[id]]);

const occ = (tag, id) => JSON.parse(find(tag, id).detail);
const normal = occ('browser', 'G1 ');
const early = occ('browser', 'G2 ');
const ablation = [
  ['加载→数据到达期间分区首元素底边位移', `${printed('browser', 'G3 ')} vs ${printed('browser', 'G3b ')}（比 ${printed('browser', 'G3c ')}）`],
  ['位移方向断言', `${printed('browser', 'G4 ')}`],
  ['加载期可视占位高度', `骨架 ${normal.gateBottom}px vs 早退 ${early.gateBottom}px`],
  ['加载期主区高度', `骨架 ${normal.mainH}px vs 早退 ${early.mainH}px`],
  ['正常模式渲染路径', `SuspenseLoader=${normal.skeleton} 早期返回=${normal.early} KPI=${normal.kpi}`],
  ['消融模式渲染路径', `SuspenseLoader=${early.skeleton} 早期返回=${early.early} KPI=${early.kpi}`],
];

const cost = [
  ['单文件产物字节（三页共用的 IIFE bundle）', printed('node', 'B9 ')],
  ['gzip 后的产物字节（传输口径）', printed('node', 'J8 ')],
  ['三页预览合计字节', printed('node', 'J5 ')],
  ['进入 artifacts 的场景目录体积（排除 node_modules/dist）', printed('node', 'J9 ')],
  ['证据构建里路由级代码可延迟占比（单文件预览版把它抵消了）', printed('node', 'L3b ')],
  ['证据构建入口 / 全套字节', printed('node', 'L3 ')],
  ['本轮 src 文件数 / 行数', printed('node', 'J1 ')],
  ['17:00 轮（vercel-react-best-practices × 管理后台）src 文件数 / 行数', printed('node', 'J2 ')],
  ['同功能面代码行比（本轮 ÷ 上轮）', printed('node', 'J3 ')],
  ['同功能面产物字节比（本轮 ÷ 上轮）', printed('node', 'J4 ')],
  ['本轮活跃短链数 / 累计点击（与上轮同源数据）', `${printed('node', 'E7 ')} · ${printed('node', 'E7b ')}`],
];

const card = (s, i) => `
  <a class="card" href="preview/admin-${s.id}.html">
    <span class="row"><span class="idx">${i + 1}</span><span class="name">${esc(s.name)}
      <span class="mid">${esc(s.id)}</span></span>
      <span class="sw">${s.palette.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></span>
    <p>${esc(s.desc)}</p>
    <dl class="facts">
      <dt>计算样式指纹</dt><dd class="mono">${esc(s.fingerprint)}</dd>
      <dt>对比度（正文 / 次要 / 涨跌）</dt><dd class="mono">${esc(s.body)} · ${esc(s.muted)} · ${esc(s.delta)}</dd>
      <dt>首屏网络请求</dt><dd class="mono">${esc(s.requests)}</dd>
      <dt>预览文件</dt><dd class="mono">preview/admin-${esc(s.id)}.html · ${s.bytes.toLocaleString('en-US')} B</dd>
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
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Beacon 信标后台 · frontend-development × 管理后台 · 三风格对照</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 40px 24px 72px; font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; background: #f6f6f8; color: #1b1b1f; }
  .wrap { max-width: 940px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: .01em; }
  h2 { font-size: 17px; margin: 34px 0 12px; }
  .lead { color: #66666e; margin: 0 0 26px; }
  .card { display: block; text-decoration: none; color: inherit; background: #fff; border: 1px solid #e2e2e7; border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; }
  .card:hover { border-color: #2563eb; box-shadow: 0 6px 20px rgba(20,20,30,.07); }
  .row { display: flex; align-items: baseline; gap: 12px; }
  .idx { font-size: 12px; color: #8a8a92; font-variant-numeric: tabular-nums; }
  .name { font-size: 17px; font-weight: 650; }
  .mid { font-weight: 400; color: #8a8a92; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; margin-left: 6px; }
  .sw { display: inline-flex; gap: 4px; margin-left: auto; }
  .sw i { width: 24px; height: 24px; border-radius: 5px; border: 1px solid rgba(0,0,0,.12); display: block; }
  .card p { margin: 8px 0 0; color: #55555c; font-size: 14px; }
  .facts { display: grid; grid-template-columns: 168px 1fr; gap: 2px 14px; margin: 12px 0 0; font-size: 12.5px; }
  .facts dt { color: #7c7c85; }
  .facts dd { margin: 0; color: #2c2c33; }
  .mono, td.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e2e7; border-radius: 12px; overflow: hidden; margin: 0 0 8px; }
  caption { caption-side: top; text-align: left; font-size: 13px; color: #7c7c85; padding: 10px 12px 6px; }
  th, td { text-align: left; padding: 9px 12px; border-top: 1px solid #ececf0; vertical-align: top; }
  th { font-weight: 550; color: #3a3a42; width: 46%; }
  ol.steps { padding-left: 20px; }
  .ok { color: #1f7a44; } .bad { color: #a8322f; }
  .note { margin-top: 30px; font-size: 13px; color: #66666e; border-top: 1px dashed #dcdce0; padding-top: 16px; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; background: #ececef; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Beacon 信标 · 短链服务运营后台</h1>
  <p class="lead">第 ${runNo} 轮：skill <code>frontend-development</code> × 场景「管理后台」。三份预览共用同一个逐字节相同的构建产物，风格差异只来自 CSS 变量与主题层；本页所有数字由断言 JSON 生成（<code>scripts/make-styles.mjs</code>），不手写。</p>

  ${styleRows.map(card).join('\n')}

  <h2>断言汇总</h2>
  <table>
    <caption>三组校验脚本：node 侧静态与数据 / jsdom 交互 / 真实 Chromium 计算样式与位移</caption>
    <tbody>
      ${tally
        .map(
          (t) =>
            `<tr><th>scripts/check-${t.tag}.mjs</th><td class="mono ${t.failed.length ? 'bad' : 'ok'}">${t.total - t.failed.length}/${t.total} 通过</td></tr>`,
        )
        .join('')}
      <tr><th>合计</th><td class="mono ${failedAll ? 'bad' : 'ok'}">${totalAll - failedAll}/${totalAll} 通过${failedAll ? ` · ${failedAll} 项失败` : ''}</td></tr>
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

  <h2>三种风格各自的表达手法（互斥，断言 C/D13 组）</h2>
  ${table('同一 DOM 下三套互不混用的分隔/塑形手法（断言 C 组 + D13）', claimRows)}

  <h2>「No Early Returns」条款的消融实测</h2>
  <p class="lead">同一份产物，用 <code>?control=early</code> 切到技能禁止的 <code>if (loading) return &lt;spinner/&gt;</code> 渲染路径，由 Chromium 采样元素底边位置得到位移量。</p>
  ${table('加载→数据到达期间的布局位移（px，越大越差）', ablation)}

  <h2>成本与规模（对照 17:00 轮同场景 vercel-react-best-practices）</h2>
  ${table('本轮 vs 上一轮同一功能面', cost)}

  <h2>预览与复现</h2>
  <ol class="steps">
    <li>直接双击任一 <code>preview/admin-*.html</code>（<code>file://</code> 下可完整交互，页面零外链）。</li>
    <li>消融对照：<code>python3 -m http.server 8157</code> 后访问 <code>/preview/admin-neumorph.html?control=early</code>。</li>
    <li>全量复现：<code>bash scripts/verify.sh</code>（npm install → tsc → 两套 vite 构建 → 内联 → 三个 checker）。</li>
  </ol>
  <div class="note">
    页面均共用同一组件树：总览 / 短链管理 / API 密钥 / 服务设置四个分区，含搜索防抖、筛选、三种排序、行展开、暂停、两步删除、密钥显隐与吊销、React Hook Form + Zod 校验。<br />
    数据事实源与 17:00 轮逐字段相同（断言 E 组 13 项），因此上表的字节/行比是同一功能面在不同技能下的真实差异。
  </div>
</div>
</body>
</html>
`;

writeFileSync(path.join(ROOT, 'index.html'), html, 'utf8');
console.log(`index.html written: ${Buffer.byteLength(html, 'utf8')}B from ${totalAll} assertions`);
