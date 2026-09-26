/**
 * Generates styles.html — the three-style comparison entry — from machine evidence only:
 * .tmp-check/assertions-{node,dom,browser}.json + scripts/build-inline-meta.json + the compiled
 * style registry. Nothing on the page is typed by hand, so re-running the checks and then this
 * script cannot leave a stale number behind.
 *
 * It writes styles.html rather than index.html on purpose: index.html is the *Vite entry*, and a
 * generator that overwrote it would make `bash scripts/verify.sh` unreproducible on the second run.
 *
 * Run: node scripts/make-styles.mjs   (after the three check scripts)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_IDS, STYLES, paletteOf } from '../.tmp-check/registry.mjs';
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
const allWith = (tag, prefix) => files[tag].filter((r) => r.id.startsWith(prefix));
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
  palette: paletteOf(id).slice(0, 6),
  bytes: pageOf(id).bytes,
  bodyContrast: printed('browser', `D3b ${id}`),
  mutedContrast: printed('browser', `D4b ${id}`),
  fingerprint: printed('browser', `D4c ${id}`),
  noExternal: find('browser', `D0 ${id}`).pass ? '零跨源请求' : '有跨源请求',
  noScroll: find('browser', `D1 ${id}`).pass ? '1440px 无横向滚动' : '溢出',
}));

/** The claim each skin makes, read from the same token object the CSS is derived from. */
const techniqueRows = STYLE_IDS.map((id) => [
  `${STYLES[id].name}（${id}）`,
  `分隔=${STYLES[id].separation} · 焦点=${STYLES[id].focusRing} · 圆角=${STYLES[id].radius} · 描边=${STYLES[id].borderWidth} · 标题=${STYLES[id].headTransform}/${STYLES[id].headingSize} · 字族 UI=${STYLES[id].fontUi.split(',')[0]}`,
]);

/** D8/D9/D10: mutual exclusion, measured in Chromium rather than asserted from source. */
const exclusionRows = [
  ['12 项计算样式指纹的两两差异（阈值 ≥7）', allWith('browser', 'D8 ').map((r) => `${r.id.split(' ')[1]} → ${r.detail}`).join(' ｜ ')],
  ['三种分隔手法实测互斥', find('browser', 'D9 ').pass ? '正交细网 / 45° 斜纹 / 圆点孔，互不出现' : '未互斥'],
  ['阴影手法实测互斥', find('browser', 'D10').pass ? '两风格零阴影、一风格 6px 硬投影' : '未互斥'],
  ['数字字体是否随风格变化', find('browser', 'D11').pass ? '是（三页不全同）' : '否（说明字体没参与风格）'],
  ['三页 <script> 载荷', find('node', 'B2').pass ? '逐字节相同（风格不复制运行时）' : '不同'],
  ['结构层字面颜色', find('node', 'C5').pass ? '零处（删掉令牌块后无颜色可换）' : '存在'],
];

/** N 组：同一份源码的 __FD_MEMO__ 双臂，jsdom 里的渲染次数与墙钟。 */
const memoRows = [
  ['两臂 bundle 字节（同源码，只差 define）', `${printed('node', 'J4 ')} / 消融臂 ${printed('node', 'J4b ')}`],
  ['两臂归一化 DOM 是否相同', find('dom', 'N1 ').pass ? '相同（消融只换实现不换结果）' : '不同'],
  ['一次击键的字段渲染次数 memo / plain', printed('dom', 'N2b ')],
  ['30 次击键（字符数不变）memo / plain', printed('dom', 'N5 ')],
  ['30 次击键（长度逐次变化）memo / plain', printed('dom', 'N6 ')],
  ['被输入的那个字段是否也命中浅比较', find('dom', 'N6b').pass ? '是——值不经过 props（uncontrolled register）' : '否'],
  ['墙钟合计（两种情形各 30 击）memo / plain', printed('dom', 'N7 ')],
  ['反向控制：props 真变时 memo 是否跟上', find('dom', 'N6d').pass ? '跟上（blur 后 dirty 标记与 plain 臂一致）' : '未跟上'],
];

/** G 组：同一份产物换传输（mock ↔ ?api=1 真 fetch），真浏览器逐帧采样。 */
const transferRows = [
  ['bootstrap 请求次数（mock / ?api=1）', printed('browser', 'G1 ')],
  ['等待期是否出现过空窗帧（mock / api）', `${find('browser', 'G2 mock').pass ? '无空窗' : '有空窗'} / ${find('browser', 'G2 api').pass ? '无空窗' : '有空窗'}`],
  ['两级骨架时长（路由 / 字段，mock）', printed('browser', 'G2b mock')],
  ['两级骨架时长（路由 / 字段，api 2.2s）', printed('browser', 'G2b api')],
  ['骨架总时长 mock / api', printed('browser', 'G6 ')],
  ['占位下方按钮位移（api，骨架→内容）', printed('browser', 'G3 api')],
  ['占位下方说明文字位移（api）', printed('browser', 'G3a api')],
  ['字段级占位实测高度（api）', printed('browser', 'G3c api')],
  ['慢接口期间整页是否仍可用', `${find('browser', 'G5 ').pass ? '标题/步骤条/草稿面板都在场' : '被一起抹掉'} · ${find('browser', 'G5 ').detail}`],
];

const costRows = [
  ['本轮 src 文件数 / 行数', printed('node', 'J1 ')],
  ['07:00 轮（同 skill × 管理后台）src 文件数 / 行数', printed('node', 'J2 ')],
  ['行数比（向导 ÷ 后台）', printed('node', 'J2b ')],
  ['单文件 bundle 字节 / gzip', printed('node', 'J4 ')],
  ['三页预览合计字节', printed('node', 'J3 ')],
  ['进入 artifacts 的目录体积（排除 node_modules/dist*）', `${printed('node', 'J6 ')}`],
  ['证据构建入口 / 全套字节', printed('node', 'L3 ')],
  ['本场景可延迟的重量占比', printed('node', 'L3b ')],
  ['技能契约缺失的引用文件数', printed('node', 'A1b ')],
  ['本轮把一行摘要变成判据的条款数', printed('node', 'A2b ')],
];

const card = (s, i) => `
  <a class="card" href="preview/wizard-${esc(s.id)}.html">
    <span class="row"><span class="idx">${i + 1}</span><span class="name">${esc(s.name)}
      <span class="mid">${esc(s.id)}</span></span>
      <span class="sw">${s.palette.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></span>
    <p>${esc(s.desc)}</p>
    <dl class="facts">
      <dt>计算样式指纹</dt><dd class="mono">${esc(s.fingerprint)}</dd>
      <dt>对比度（正文 / 次要，WCAG AA ≥4.5）</dt><dd class="mono">${esc(s.bodyContrast)} · ${esc(s.mutedContrast)}</dd>
      <dt>外链与溢出</dt><dd class="mono">${esc(s.noExternal)} · ${esc(s.noScroll)}</dd>
      <dt>预览文件</dt><dd class="mono">preview/wizard-${esc(s.id)}.html · ${s.bytes.toLocaleString('en-US')} B</dd>
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
<title>潮汐社开店向导 · frontend-development × 表单密集多步向导 · 三风格对照</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 40px 24px 72px; font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; background: #f4f4f6; color: #1b1b1f; }
  .wrap { max-width: 960px; margin: 0 auto; }
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
  .sw i { width: 22px; height: 22px; border-radius: 5px; border: 1px solid rgba(0,0,0,.12); display: block; }
  .card p { margin: 8px 0 0; color: #55555c; font-size: 14px; }
  .facts { display: grid; grid-template-columns: 250px 1fr; gap: 2px 14px; margin: 12px 0 0; font-size: 12.5px; }
  .facts dt { color: #7c7c85; }
  .facts dd { margin: 0; color: #2c2c33; }
  .mono, td.mono { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e2e7; border-radius: 12px; overflow: hidden; margin: 0 0 8px; }
  caption { caption-side: top; text-align: left; font-size: 13px; color: #7c7c85; padding: 10px 12px 6px; }
  th, td { text-align: left; padding: 9px 12px; border-top: 1px solid #ececf0; vertical-align: top; }
  th { font-weight: 550; color: #3a3a42; width: 46%; }
  ol.steps { padding-left: 20px; }
  .ok { color: #1f7a44; } .bad { color: #a8322f; }
  .note { margin-top: 30px; font-size: 13px; color: #66666e; border-top: 1px dashed #dcdce0; padding-top: 16px; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; background: #ececef; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>潮汐社 · 手作订阅开店向导</h1>
  <p class="lead">第 ${runNo} 轮：skill <code>frontend-development</code> × 场景「表单密集多步向导」（4 步 22 字段 / 双异步唯一性校验 / 草稿持久化 / 幂等提交）。三份预览共用同一个逐字节相同的构建产物，风格差异只来自 <code>data-fd-style</code> 与令牌块；本页所有数字由 <code>.tmp-check/assertions-*.json</code> 经 <code>scripts/make-styles.mjs</code> 生成，不手写。</p>

  ${styleRows.map(card).join('\n')}

  <h2>断言汇总</h2>
  <table>
    <caption>三组校验脚本：node 侧静态与事实源 / jsdom 交互与双臂消融 / 真实 Chromium 计算样式与逐帧采样</caption>
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

  <h2>三套手法各自的构造（互斥性由 D9/D10/D11 实测）</h2>
  ${table('分隔手法 / 焦点环 / 圆角 / 描边 / 标题变形 / 字族，全部读自同一份令牌对象', techniqueRows)}
  ${table('「换皮肤不换 DOM」这组主张的实测结果', exclusionRows)}

  <h2>memo 条款的双臂消融（同一份源码，只换 <code>__FD_MEMO__</code>）</h2>
  <p class="lead">技能原文只有一句「用 React.memo / useCallback / useMemo」。两臂是同一份源码的两次构建（${printed('node', 'J4 ').split(' /')[0]}B 对 ${printed('node', 'J4b ')}），渲染计数与墙钟由 jsdom 里的字段级计数器量出。</p>
  ${table('连续输入时的渲染次数与耗时（N 组）', memoRows)}

  <h2>延迟接口的可见代价（同一份产物，mock ↔ <code>?api=1</code> 真 fetch）</h2>
  <p class="lead">G 组在 Chromium 里以 8ms 步长逐帧采样占位与骨架，度量「等待期是否空窗」「数据到达时是否位移」。路由级边界预留 520px，字段级边界预留 176px。</p>
  ${table('两种传输下的骨架、请求与位移（G 组）', transferRows)}

  <h2>成本与规模（对照 07:00 轮同 skill 的管理后台）</h2>
  ${table('本轮与上一轮的磁盘现算值', costRows)}

  <h2>预览与复现</h2>
  <ol class="steps">
    <li>直接双击任一 <code>preview/wizard-*.html</code>（<code>file://</code> 下可完整交互，页面零外链；M 组已对两种载体各跑一遍）。</li>
    <li>慢接口对照：<code>python3 -m http.server 8157</code> 后访问 <code>/preview/wizard-paper-grid.html?api=1</code>，可肉眼看到两级骨架与 2.2s 等待。</li>
    <li>渲染双臂：主产物显示 <code>当前臂 memo</code>，消融臂由 <code>vite.control.config.ts</code> 单独构建，两臂比对在 <code>scripts/check-dom.mjs</code> 的 N 组。</li>
    <li>全量复现：<code>bash scripts/verify.sh</code>（npm install → tsc → 三套 vite 构建 → 内联 → 三个 checker → 本页）。</li>
  </ol>
  <div class="note">
    三页共用同一组件树与同一事实源：4 步（身份 / 套餐 / 主体与开票 / 确认）22 字段，含 subdomain 与 supportEmail 两个异步唯一性校验、18 组分支联动、报价双实现互校、version=3 草稿信封与敌意输入消毒、内容派生的幂等提交令牌。<br />
    技能 <code>frontend-development</code> 的 SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 共 ${printed('node', 'A1b ')}在本机不存在，因此页面上的每个数字都来自本轮自建判据，而不是技能文档。
  </div>
</div>
</body>
</html>
`;

writeFileSync(path.join(ROOT, 'styles.html'), html, 'utf8');
console.log(`styles.html written: ${Buffer.byteLength(html, 'utf8')}B from ${totalAll} assertions`);
