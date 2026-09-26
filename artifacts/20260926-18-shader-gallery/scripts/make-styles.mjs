/* 生成 styles.html：三风格对照页。
 * 铁律（历轮教训）：页面上出现的每一个测量数字都必须从 evidence/*.json、scripts/build-sizes.json 或 src/ 现取。
 * 这里不止是「尽量不手打」：每次取数都往 evidence/styles-numbers.json 记一条溯源
 * （渲染值 + 源文件 + JSON 路径 + 做了哪种换算），check-node.mjs 的 N 组再独立读源文件复算一遍，
 * 并反向要求页面测量区里出现的每个数字都能在这份溯源里对上。手打一个数就会红。
 * 用法：node scripts/make-styles.mjs */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const NODE_FILE = "evidence/check-node.json";
const BRW_FILE = "evidence/check-browser.json";
const SIZE_FILE = "scripts/build-sizes.json";
const MUT_FILE = "evidence/mutation.json";
const PROV_FILE = "evidence/styles-numbers.json";

const nodeEv = JSON.parse(read(NODE_FILE));
const brw = JSON.parse(read(BRW_FILE));
const sizes = JSON.parse(read(SIZE_FILE));
const mut = fs.existsSync(path.join(ROOT, MUT_FILE)) ? JSON.parse(read(MUT_FILE)) : null;

const STYLES = ["liquid-chrome", "crt-plasma", "silk-aurora"];
const CN = { "liquid-chrome": "液态铬面", "crt-plasma": "栅格磷光", "silk-aurora": "丝绸极光" };

/* 技法一句话不在这个脚本里手写：直接从着色器自己的 // 技法： 行取。
 * 上一版在这里写死了「silk-aurora = 丝带 + fresnel 边缘光」，而着色器里根本没有 fresnel——
 * 生成器里的手写文案会和被生成的东西互相矛盾，结构校验全绿也抓不到。 */
function techniqueOf(style) {
  const line = /^\s*\/\/\s*技法：(.*)$/m.exec(read(`src/shaders/${style}.glsl`));
  if (!line) throw new Error(`${style}.glsl 缺 // 技法： 行，对照页无从取数`);
  return line[1].trim();
}
function rootTokens(cssFile) {
  const css = read(cssFile).replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /:root\s*\{([\s\S]*?)\}/.exec(css);
  if (!block) return {};
  const out = {};
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function snippetsOf(style) {
  const text = read(`src/shaders/${style}.glsl`);
  return [...new Set([...text.matchAll(/\/\/\s*snippet:\s*([\w-]+)/g)].map((m) => m[1]))];
}
const glslLines = (style) => read(`src/shaders/${style}.glsl`).split("\n").length;

const byId = Object.fromEntries(brw.results.map((r) => [r.id, r]));
const nodeById = Object.fromEntries(nodeEv.results.map((r) => [r.id, r]));
/* 断言详情里会带产物源码片段（含 <script>、<div> 这类标签），嵌进对照页前必须转义，
 * 否则一段被注入的 HTML 就把整张 styles.html 的结构顶掉。 */
const esc = (t) => String(t === undefined ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- 取数即记溯源 ---------- */
const provenance = [];
const ref = (file, p) => ({ file, path: p });
function fixed(value, digits, r) {
  const rendered = Number(value).toFixed(digits);
  provenance.push({ rendered, op: "toFixed", digits, source: r });
  return rendered;
}
function int(value, r) {
  const rendered = String(value);
  provenance.push({ rendered, op: "exact", source: r });
  return rendered;
}
const countOf = int;
function grouped(value, r) {
  const rendered = Number(value).toLocaleString("en-US");
  provenance.push({ rendered, op: "thousands", source: r });
  return rendered;
}
function diff(a, b, digits, ra, rb) {
  const rendered = (a - b).toFixed(digits);
  provenance.push({ rendered, op: "diff", digits, source: ra, operand: rb });
  return rendered;
}
function minOf(values, digits, r, suffix) {
  const rendered = Math.min(...values).toFixed(digits) + (suffix || "");
  provenance.push({ rendered, op: "min", digits, suffix: suffix || "", source: r });
  return rendered;
}
/* 数组→一行文本：分隔符也要进溯源，否则复算侧只能猜（Array.toString 用的是不带空格的逗号）。 */
function joined(values, sep, r) {
  const rendered = values.join(sep);
  provenance.push({ rendered, op: "join", sep, source: r });
  return esc(rendered);
}
function eachJoin(values, r) {
  return values.map((v, i) => int(v, ref(r.file, `${r.path}[${i}]`))).join(" / ");
}
function verbatim(text, r, limit) {
  const rendered = String(text === undefined ? "" : text).slice(0, limit);
  provenance.push({ rendered, op: "verbatim", digits: limit, source: r });
  return esc(rendered);
}
/* 去掉断言详情的前缀再嵌页：N 组复算时按「源串以该前缀开头」还原，不接受任意手改。 */
function stripped(text, needle, r) {
  const rendered = String(text === undefined ? "" : text).startsWith(needle) ? String(text).slice(needle.length) : String(text);
  provenance.push({ rendered, op: "strip", needle, source: r });
  return esc(rendered || "无");
}

const per = (fn) => STYLES.map(fn);
function row(label, cells) {
  return `<tr><th scope="row">${label}</th>${cells.map((c) => `<td class="m">${c}</td>`).join("")}</tr>`;
}
function swatches(style) {
  const tokens = rootTokens(`src/css/skin-${style}.css`);
  const order = ["--bg", "--panel", "--ink", "--muted", "--accent", "--line", "--grid"];
  return order
    .filter((k) => /#[0-9a-fA-F]{6}/.test(tokens[k] || ""))
    .map((k) => `<li><i style="background:${tokens[k]}"></i><code>${k}</code> ${int(tokens[k], ref(`src/css/skin-${style}.css`, `:root.${k}`))}</li>`)
    .join("\n");
}

const arms = [
  ["K/frozen-holds-time", "uTime 冻结臂（?probe=frozen）"],
  ["K/samevariant-flattens-strip", "变体轴归零臂（?probe=samevariant）"],
  ["K/nomouse-arm", "指针隔离臂（?probe=nomouse）"],
  ["K/noscroll-arm", "滚动隔离臂（?probe=noscroll）"],
  ["K/solid-baseline-flat", "纯色基线臂（?probe=solid）"],
  ["K/nogl-fallback", "无 WebGL 降级臂（?probe=nogl）"],
  ["K/reduced-single-frame", "减动效臂"],
  ["K/pause-freezes-time", "暂停按钮真停住时钟"],
  ["K/dpr-clamped", "DPR 钳到 2"],
  ["K/scrim-works", "衬底消融（有/无衬底对比度）"],
];

function mutationTable() {
  if (!mut) return `<p class="lead">还没跑过 <code>node scripts/mutate.mjs</code>，${MUT_FILE} 尚不存在。</p>`;
  return `<table><thead><tr><th>用例</th><th>类型</th><th>注入</th><th>抓到它的断言</th><th>判定</th></tr></thead><tbody>
${mut.cases
  .map((c, i) => {
    const r = (p) => ref(MUT_FILE, `cases[${i}].${p}`);
    return `<tr><td class="m">${int(c.id, r("id"))}${c.all ? " /三份同改" : ""}${c.rebuild ? " /改源后重建" : ""}</td><td>${esc(c.kind)}→${esc(c.suite)}</td>
<td>${esc(c.name)}<br><code>${verbatim(c.injection.from, r("injection.from"), 46)}</code> → <code>${verbatim(c.injection.to, r("injection.to"), 46) || "（整段删掉）"}</code></td>
<td class="m">${joined(c.failed_assertions, ", ", r("failed_assertions"))}</td><td class="${c.verdict ? "pass" : "failed"}">${c.verdict ? "被抓且点名" : "不合格"}</td></tr>`;
  })
  .join("\n")}
</tbody></table>
<p class="lead">本批 ${countOf(mut.cases.length, ref(MUT_FILE, "cases.length"))} 例（${[...new Set(mut.cases.map((c) => c.kind))]
    .map((k) => `${esc(k)} ${countOf(mut.cases.filter((c) => c.kind === k).length, ref(MUT_FILE, `cases[kind=${k}].length`))} 例`)
    .join("、")}）；还原后复跑 check-node ${mut.restored.node_pass ? "全绿" : "未通过"}、check-browser ${
    mut.restored.browser_pass ? "全绿" : "未通过"
  }（记录时间 ${verbatim(mut.ran_at, ref(MUT_FILE, "ran_at"), 40)}）。</p>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>shader × 沉浸式展览页 · 三风格对照</title>
<style>
:root{--bg:#0e1013;--panel:#171a20;--ink:#eef1f6;--muted:#9aa4b2;--line:#2a2f38;--accent:#7dd3fc;--grid:#20252d;--mono:'SF Mono',Monaco,Consolas,monospace;--ui:system-ui,-apple-system,'Segoe UI',sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--ui);line-height:1.6;padding:clamp(20px,4vw,44px);max-width:1120px;margin:0 auto}
h1{font-size:clamp(22px,3.2vw,30px);letter-spacing:.01em;border-bottom:2px solid var(--ink);padding-bottom:10px}
p.lead{color:var(--muted);font-size:14px;margin:12px 0 26px;max-width:840px}
h2{font-size:15px;margin:30px 0 10px;color:var(--accent);font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.card{border:1px solid var(--line);background:var(--panel);padding:16px 18px}
.card .tag{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.08em}
.card h3{font-size:17px;margin:4px 0 8px}
.card p{font-size:13px;color:var(--muted)}
.card ul{list-style:none;margin:12px 0;font-size:12px;font-family:var(--mono)}
.card li{display:flex;align-items:center;gap:8px;margin:3px 0;color:var(--muted)}
.card i{width:14px;height:14px;border:1px solid var(--line);display:inline-block;flex:none}
.card a{display:inline-block;margin-top:6px;font-family:var(--mono);font-size:12px;border:1px solid var(--accent);color:var(--accent);padding:6px 12px;text-decoration:none}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}
th,td{border:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}
thead th{background:var(--panel);font-family:var(--mono);font-size:11px}
tbody th{background:var(--panel);font-weight:500;white-space:nowrap}
td.m{font-family:var(--mono)}
.pass{color:#6ee7a8}.failed{color:#fca5a5}
footer{margin-top:34px;border-top:1px solid var(--line);padding-top:12px;font-size:11.5px;color:var(--muted);font-family:var(--mono)}
code{font-family:var(--mono);font-size:.92em;word-break:break-all}
</style></head><body>
<h1>shader × 沉浸式展览页 · 三风格对照</h1>
<p class="lead">同一个 WebGL1 宿主、同一份事实源（虚构展览「潮汐刻度」），三份产物只在 <code>:root</code> 令牌与着色器上不同。下面每一格数字都由 <code>scripts/make-styles.mjs</code> 从 <code>${NODE_FILE}</code>、<code>${BRW_FILE}</code>、<code>${SIZE_FILE}</code>、<code>${MUT_FILE}</code> 与 <code>src/</code> 现取，并在 <code>${PROV_FILE}</code> 留下溯源，由 check-node 的 N 组独立复算——页面上没有第二个数字来源。</p>

<div class="cards">
${per((s) => {
  const size = sizes.built.find((b) => b.style === s);
  const snips = snippetsOf(s);
  return `<div class="card"><p class="tag">${s}</p><h3>${CN[s]}</h3>
<p>${esc(int(techniqueOf(s), ref(`src/shaders/${s}.glsl`, "technique")))}</p>
<ul>
<li><span>技能 snippet 引用：${snips.length ? esc(int(snips.join("、"), ref(`src/shaders/${s}.glsl`, "snippets"))) : "无（这份自写域扭曲/距离场，未套用技能现成 snippet）"}</span></li>
<li><span>GLSL ${countOf(glslLines(s), ref(`src/shaders/${s}.glsl`, "lines"))} 行 / 内联色板 ${countOf(size.palette_count, ref(SIZE_FILE, `built[style=${s}].palette_count`))} 项</span></li>
<li><span>产物 ${grouped(size.bytes, ref(SIZE_FILE, `built[style=${s}].bytes`))} 字节，单文件零外链</span></li>
</ul>
<ul>
${swatches(s)}
</ul>
<a href="preview/exhibit-${s}.html">打开 ${s}</a></div>`;
}).join("\n")}
</div>

<h2>真帧像素实测（无头 Chrome + SwiftShader 软件渲染，只比相对差异，不作性能结论）</h2>
<table><thead><tr><th>维度</th>${per((s) => `<th>${s}</th>`).join("")}</tr></thead><tbody>
${row("整帧平均亮度 / σ", per((s) => `${fixed(brw.metrics[s].fx.mean, 1, ref(BRW_FILE, `metrics.${s}.fx.mean`))} / ${fixed(brw.metrics[s].fx.sigma, 1, ref(BRW_FILE, `metrics.${s}.fx.sigma`))}`))}
${row("整帧动态范围 p99.5−p0.5", per((s) => diff(brw.metrics[s].fx.p995, brw.metrics[s].fx.p05, 1, ref(BRW_FILE, `metrics.${s}.fx.p995`), ref(BRW_FILE, `metrics.${s}.fx.p05`))))}
${row(`三带 uVariant 逐像素改变（每对 / ${countOf(brw.metrics[STYLES[0]].uniformResponse.sampled, ref(BRW_FILE, `metrics.${STYLES[0]}.uniformResponse.sampled`))} 采样点）`, per((s) => eachJoin(brw.metrics[s].bandPairDiff, ref(BRW_FILE, `metrics.${s}.bandPairDiff`))))}
${row("指针响应（uTime 冻结下改变像素）", per((s) => `${countOf(brw.metrics[s].uniformResponse.mousePixels, ref(BRW_FILE, `metrics.${s}.uniformResponse.mousePixels`))} / ${countOf(brw.metrics[s].uniformResponse.sampled, ref(BRW_FILE, `metrics.${s}.uniformResponse.sampled`))}`))}
${row("滚动响应（同上）", per((s) => `${countOf(brw.metrics[s].uniformResponse.scrollPixels, ref(BRW_FILE, `metrics.${s}.uniformResponse.scrollPixels`))} / ${countOf(brw.metrics[s].uniformResponse.sampled, ref(BRW_FILE, `metrics.${s}.uniformResponse.sampled`))}`))}
${row("软件帧率 / 每帧耗时", per((s) => `${fixed(brw.metrics[s].softFps, 1, ref(BRW_FILE, `metrics.${s}.softFps`))} fps / ${fixed(brw.metrics[s].frameMs, 1, ref(BRW_FILE, `metrics.${s}.frameMs`))} ms`))}
${row("最坏正文对比度（压活着色器 + 衬底合成）", per((s) => minOf(Object.values(brw.metrics[s].contrast), 2, ref(BRW_FILE, `metrics.${s}.contrast`), ":1")))}
${row("逐段对比度（hero-title / hero-sub / work-rule / facts-dt / rooms-td / section-lead）", per((s) => Object.entries(brw.metrics[s].contrast).map(([k, v]) => fixed(v, 2, ref(BRW_FILE, `metrics.${s}.contrast.${k}`))).join(" · ")))}
${row("横向溢出断言 1280 / 390", per((s) => `${byId[`J/no-h-overflow:${s}:1280`].pass ? "✓" : "✗"} / ${byId[`J/no-h-overflow:${s}:390`].pass ? "✓" : "✗"}`))}
${row("死选择器（有规则、无元素）", per((s) => stripped(byId[`J/no-dead-selectors:${s}`].detail, "有规则、无元素的选择器：", ref(BRW_FILE, `results[id=J/no-dead-selectors:${s}].detail`))))}
${row("Node 侧静态断言（该风格通过/总数）", per((s) => {
  const mine = nodeEv.results.filter((r) => r.id.includes(s));
  return `${countOf(mine.filter((r) => r.pass).length, ref(NODE_FILE, `results[id~${s}][pass].length`))}/${countOf(mine.length, ref(NODE_FILE, `results[id~${s}].length`))}`;
}))}
</tbody></table>

<h2>对照臂：每个「生效」断言都配一条让它失效的臂</h2>
<table><thead><tr><th>对照臂</th><th>结论</th><th>实测</th></tr></thead><tbody>
${arms.map(([id, label]) => {
  const r = byId[id];
  if (!r) return `<tr><td>${label}</td><td class="failed">缺</td><td class="m">—</td></tr>`;
  return `<tr><td>${label}</td><td class="${r.pass ? "pass" : "failed"}">${r.pass ? "符合预期" : "未符合"}</td><td class="m">${verbatim(r.detail, ref(BRW_FILE, `results[id=${id}].detail`), 190)}</td></tr>`;
}).join("\n")}
</tbody></table>

<h2>技能自带 CLI 与 snippet 真编译</h2>
<table><thead><tr><th>维度</th><th>实测</th></tr></thead><tbody>
<tr><th>snippet 段数（技能 assets/snippets/）</th><td class="m">${verbatim(byId["M/snippets-discovered"].detail, ref(BRW_FILE, "results[id=M/snippets-discovered].detail"), 160)}</td></tr>
${["fresnel", "dissolve", "ripple", "scanline", "pixelate", "vertex-wobble"].map((k) => `<tr><th>${k}</th><td class="m">编译 ${byId[`M/snippet-compiles:${k}`].pass ? "✓" : "✗"} · 改像素 ${byId[`M/snippet-mutates-frame:${k}`].pass ? "✓" : "✗"}｜${verbatim(byId[`M/snippet-mutates-frame:${k}`].detail, ref(BRW_FILE, `results[id=M/snippet-mutates-frame:${k}].detail`), 120)}</td></tr>`).join("\n")}
<tr><th>技能 CLI 命令全跑通</th><td class="m">${(nodeById["A/doc-example-commands-all-run"] || {}).pass ? "✓" : "✗"}｜${verbatim((nodeById["A/doc-example-commands-all-run"] || {}).actual, ref(NODE_FILE, "results[id=A/doc-example-commands-all-run].actual"), 160)}</td></tr>
</tbody></table>

<h2>变异测试</h2>
<p class="lead">往产物（或色板源文件）里注入缺陷，看两套校验抓不抓得到、报错有没有点名；每例改完立刻还原并复跑双套。用例定义在 <code>scripts/mutate.mjs</code>，下表每行都是 <code>${MUT_FILE}</code> 里的实录，不是手写摘要。</p>
${mutationTable()}

/* 页脚故意不写 check-node 的「通过数」：那个数被这一页自己引用，通过/失败会让它自己跳变（奇偶振荡），
 * 只写与引用无关的断言总数。 */
<footer>数据来源：${verbatim(brw.ran_at, ref(BRW_FILE, "ran_at"), 40)} 的 check-browser 运行（Chromium ${esc(brw.chromium.split("/").slice(-2).join("/"))}，playwright-core 取自 ${esc(brw.playwright_from)}）；check-node 共 ${countOf(nodeEv.results.length, ref(NODE_FILE, "results.length"))} 条静态断言、check-browser ${countOf(brw.results.filter((r) => r.pass).length, ref(BRW_FILE, "results[pass].length"))}/${countOf(brw.total, ref(BRW_FILE, "total"))}。本页由 scripts/make-styles.mjs 生成，改 evidence 或 src 后重跑即可复现；每个数字的出处见 ${PROV_FILE}，由 check-node 的 N 组独立复算；本页每个测量区还和 <code>evidence/styles-regions.json</code>（本脚本同批写下的区间快照）逐区比对，手改一格文字也会红。</footer>
</body></html>
`;

fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "styles.html"), html);
fs.writeFileSync(path.join(ROOT, PROV_FILE), JSON.stringify({ generated_at: new Date().toISOString(), entries: provenance }, null, 2));
/* 测量区快照：把「本次生成时每个测量区的内容」按文档顺序抄一份下来，check-node 再按同一套正则从
 * 盘上的页面里取一遍，逐区比对。为什么集合判据不够：对照页会转录变异表，而变异表里带着 M9 的注入原文
 * 「内联色板 12 项」——于是手打的 12 成了一个合法溯源值，变异把自己的判据缴了械（本轮真实撞出）。
 * 集合判据问的是「这个数在不在证据里」，位置判据问的是「这个位置上的这个数是不是生成器当次放的那个」。
 * 两处正则必须一致，改这里就同步改 check-node.mjs 的 N 组。 */
const regionSnapshot = (text) => {
  const body = text.replace(/<style>[\s\S]*?<\/style>/g, " ");
  return [...body.matchAll(/<li>([\s\S]*?)<\/li>/g), ...body.matchAll(/<td class="m">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
};
fs.writeFileSync(
  path.join(ROOT, "evidence", "styles-regions.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), regions: regionSnapshot(html) }, null, 2),
);

console.log(`styles.html 写出：${Buffer.byteLength(html)} 字节；数字溯源 ${provenance.length} 条 -> ${PROV_FILE}`);
