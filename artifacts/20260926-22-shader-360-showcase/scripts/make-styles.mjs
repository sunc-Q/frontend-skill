/* 生成三风格对照页 preview/styles.html：一页看尽三种皮肤，并且页面上每个数字都挂着指针。
 * 用法：node scripts/make-styles.mjs   （依赖 build.mjs / check-browser.mjs 已跑过，因为部分数字来自 evidence/）
 * 纪律：本页不写一个字面量数字——凡是数字，都由 makeResolver 现读磁盘算出，
 *       check-node 的 N 组用同一个解析器复算，两边对不上就红。 */
import fs from "node:fs";
import path from "node:path";
import { read, bytes, parts, makeResolver } from "./lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const STYLES = ["vitrine", "plaque", "industrial"];
const resolve = makeResolver(ROOT, STYLES);

const facts = JSON.parse(read(path.join(SRC, "product.json")));
const browserReport = JSON.parse(read(path.join(ROOT, "evidence", "browser-report.json")));
const buildReport = JSON.parse(read(path.join(ROOT, "evidence", "build-report.json")));
const mutationPath = path.join(ROOT, "evidence", "mutation-report.json");
const mutation = fs.existsSync(mutationPath) ? JSON.parse(read(mutationPath)) : null;

/* 指针 → HTML：显示值永远等于 resolve(指针)，写不出来的数字就不许出现 */
function num(ptr, unit = "") {
  const v = resolve(ptr);
  if (v == null) throw new Error(`指针解析失败：${ptr}`);
  return `<b class="n" data-num="${ptr}">${v}</b>${unit ? `<i class="u">${unit}</i>` : ""}`;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pngDataUri = (f) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, "shots", f)).toString("base64")}`;

const builtIdx = (s) => buildReport.built.findIndex((b) => b.style === s);

const skinCards = STYLES.map((s, i) => {
  const st = facts.styles.find((x) => x.id === s);
  const bi = builtIdx(s);
  return `<article class="card" data-style="${s}">
  <h3>${esc(st.name)}<span class="tag">${esc(st.shade)} · ${esc(st.mood)}</span></h3>
  <img src="${pngDataUri(`stage-${s}.png`)}" alt="${esc(st.name)}皮肤下的展台剪影" width="420" height="420">
  <p class="claim">${esc(st.claim)}</p>
  <dl class="fp">
    <dt>圆角令牌</dt><dd><code data-num="css:${s}:--radius">${esc(resolve(`css:${s}:--radius`))}</code></dd>
    <dt>描边令牌</dt><dd><code data-num="css:${s}:--rule">${esc(resolve(`css:${s}:--rule`))}</code></dd>
    <dt>标题字族</dt><dd><code data-num="css:${s}:--font-display">${esc(resolve(`css:${s}:--font-display`))}</code></dd>
    <dt>整页字节</dt><dd>${num(`json:evidence/build-report.json#built/${bi}/bytes`)}<span class="dim">（几何块 sha1 ${num("sha1:src/shaders/geometry.glsl")}，三页同一个值）</span></dd>
    <dt>着色器字节</dt><dd>${num(`json:evidence/build-report.json#built/${bi}/fragBytes`)}<span class="dim">，其中变体 SHADE 段 ${num(`json:evidence/build-report.json#built/${bi}/shadeBytes`)}</span></dd>
    <dt>最低对比度</dt><dd>${num(`calc:minRatio.${s}`)}<span class="dim">（WCAG 门槛 4.5，大字 3.0）</span></dd>
    <dt>剪影像素数</dt><dd>${num(`json:evidence/browser-report.json#evidence/sweep/${s}/0/area`)}<span class="dim">（顶带重心 ${num(`json:evidence/browser-report.json#evidence/sweep/${s}/0/bandCx`)}px）</span></dd>
  </dl>
  <p class="go"><a href="showcase-${s}.html">打开这一皮肤的交互页 →</a></p>
</article>`;
}).join("\n");

/* 镜像恒等表：θ 与 180°−θ 的顶带重心之和必须正好是画面宽度减一 */
const sweep0 = browserReport.evidence.sweep.vitrine;
const mirrorRows = sweep0.map((r, i) => {
  const az2 = ((180 - r.az) % 360 + 360) % 360;
  const j = sweep0.findIndex((x) => x.az === az2);
  return `<tr><td>${num(`json:evidence/browser-report.json#evidence/sweep/vitrine/${i}/az`)}°</td>
  <td>${num(`json:evidence/browser-report.json#evidence/sweep/vitrine/${i}/bandCx`)}</td>
  <td>${num(`json:evidence/browser-report.json#evidence/sweep/vitrine/${j}/az`)}°</td>
  <td>${num(`json:evidence/browser-report.json#evidence/sweep/vitrine/${j}/bandCx`)}</td>
  <td class="sum">${num(`calc:bandCxSum.vitrine.${i}`)}</td>
  <td>${num("calc:mirrorWidth")}</td></tr>`;
}).join("\n");

/* 跨皮肤同一性：同视角同几何，alpha 指纹逐位相同、颜色互异 */
const crossRows = browserReport.evidence.crossSkin.map((c, i) => `<tr>
  <td data-style="${c.style}">${esc(facts.styles.find((s) => s.id === c.style).name)}</td>
  <td>${num(`json:evidence/browser-report.json#evidence/crossSkin/${i}/alpha`)}</td>
  <td>${num(`json:evidence/browser-report.json#evidence/crossSkin/${i}/rgba`)}</td>
  <td>${num(`json:evidence/browser-report.json#evidence/crossSkin/${i}/area`)}</td>
</tr>`).join("\n");

const presetRows = browserReport.evidence.presets.vitrine.map((p, i) => `<tr>
  <td>${esc(p.id)}</td>
  <td>${esc(p.expect)}</td>
  <td>${esc(p.measured)}</td>
  <td>${num(`json:evidence/browser-report.json#evidence/presets/vitrine/${i}/azDeg`)}°</td>
</tr>`).join("\n");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>三风格对照 · ${esc(facts.product.name)} 360° 展台</title>
<style>
:root { --ink: #16191d; --dim: #5d6570; --line: #d8dbe0; --bg: #f5f6f8; --accent: #2f5d8a; --mono: ui-monospace, "SFMono-Regular", Menlo, monospace; }
* { box-sizing: border-box; }
body { margin: 0; padding: 30px 26px 60px; background: var(--bg); color: var(--ink);
  font: 15px/1.62 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
main { max-width: 1180px; margin: 0 auto; }
h1 { margin: 0 0 .25em; font-size: clamp(24px, 3.4vw, 36px); letter-spacing: -.015em; }
.sub { margin: 0 0 26px; color: var(--dim); max-width: 76ch; }
h2 { margin: 42px 0 14px; font-size: 19px; border-bottom: 1px solid var(--line); padding-bottom: .35em; }
h3 { margin: 0 0 10px; font-size: 16px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.tag { font: 11px/1 var(--mono); color: var(--dim); text-transform: uppercase; letter-spacing: .08em; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px 18px; }
.card img { display: block; width: 100%; height: auto; background: #0d0f12; border-radius: 6px; }
.claim { color: var(--dim); font-size: 13.5px; min-height: 3.2em; }
dl.fp { margin: 12px 0 0; display: grid; grid-template-columns: 8.2em 1fr; gap: 5px 12px; font-size: 13px; }
dl.fp dt { color: var(--dim); }
dl.fp dd { margin: 0; }
code { font: 12px/1.5 var(--mono); word-break: break-all; }
b.n { font-variant-numeric: tabular-nums; font-weight: 600; }
i.u { font-style: normal; color: var(--dim); font-size: 11.5px; }
.dim { color: var(--dim); font-weight: 400; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 0; background: #fff; font-size: 13.5px; }
caption { text-align: left; color: var(--dim); font-size: 13px; padding-bottom: 6px; }
th, td { border: 1px solid var(--line); padding: 6px 9px; text-align: left; font-variant-numeric: tabular-nums; }
thead th { background: #eceef2; font-size: 12.5px; }
td.sum { background: #f2f7fb; }
.go { margin: 14px 0 0; }
a { color: var(--accent); }
.note { color: var(--dim); font-size: 13px; max-width: 82ch; }
.ledger { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 8px; }
.ledger div { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.ledger span { display: block; color: var(--dim); font-size: 12px; }
.ledger b { font-size: 21px; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<main>
<h1>三风格对照 · ${esc(facts.product.name)}（${esc(facts.product.model)}）</h1>
<p class="sub">同一件商品、同一份几何源码，三种皮肤。本页所有数字都挂 <code>data-num</code> 指针，由
<code>scripts/lib.mjs</code> 的同一个解析器现读磁盘算出；<code>check-node</code> 的 N 组逐条复算，任一数字与事实脱钩即红。
三张交互页合计 ${num("calc:previewTotalBytes")} 字节。</p>

<h2>一、三种皮肤一眼对比</h2>
<div class="cards">
${skinCards}
</div>
<p class="note">三页几何块 sha1 相同（${num("sha1:src/shaders/geometry.glsl")}），说明「同一件商品」不是修辞而是字节事实；
差异只落在 <code>&lt;style&gt;</code> 与着色器 SHADE 段。剪影像素数相同即证据：皮肤不改变形状。</p>

<h2>二、360° 的硬判据：绕 z→−z 对称 ⟹ 顶带重心镜像互补</h2>
<table>
<caption>方位 θ 与 180°−θ 的顶带重心之和必须等于 ${num("calc:mirrorWidth")}（画布宽 ${num("json:src/product.json#controls/backingStorePx")} 减一）。
求交预算、包围盒、朝向判据三套皮肤共用，所以这里任何一行不闭合都只可能是几何被改坏。</caption>
<thead><tr><th scope="col">θ</th><th scope="col">bandCx(θ)</th><th scope="col">180°−θ</th><th scope="col">bandCx(180°−θ)</th><th scope="col">之和</th><th scope="col">应为</th></tr></thead>
<tbody>
${mirrorRows}
</tbody>
</table>

<h2>三、跨皮肤同一性（方位 ${esc(String(sweep0.find((r) => r.az === 37) ? 37 : sweep0[0].az))}°，冻结时钟）</h2>
<table>
<caption>alpha 指纹相同 ⟹ 剪影像素级一致；rgba 指纹互异 ⟹ 着色确实换了一套。这两行同时成立，才算「同商品、异观感」。</caption>
<thead><tr><th scope="col">皮肤</th><th scope="col">alpha 指纹</th><th scope="col">rgba 指纹</th><th scope="col">剪影像素</th></tr></thead>
<tbody>
${crossRows}
</tbody>
</table>

<h2>四、预设视角的三向核对</h2>
<table>
<caption>页面声明的锚点、像素实测的锚点、着色器判据三者必须同词；表内方位取自浏览器实测视图。</caption>
<thead><tr><th scope="col">预设</th><th scope="col">声明</th><th scope="col">实测</th><th scope="col">到位方位</th></tr></thead>
<tbody>
${presetRows}
</tbody>
</table>

<h2>五、验证总账</h2>
<div class="ledger">
  <div><span>浏览器断言</span><b>${num("json:evidence/browser-report.json#total")}</b><span class="dim">通过 ${num("json:evidence/browser-report.json#pass")} / 红 ${num("json:evidence/browser-report.json#fail")}</span></div>
  <div><span>扫方位数</span><b>${num("calc:sweepCount")}</b><span class="dim">每皮肤每方位都查触边</span></div>
  <div><span>事实源几何字节</span><b>${num("bytes:src/shaders/geometry.glsl")}</b><span class="dim">sha1 ${num("sha1:src/shaders/geometry.glsl")}</span></div>
  <div><span>宿主脚本字节</span><b>${num("bytes:src/host.js")}</b><span class="dim">sha1 ${num("sha1:src/host.js")}</span></div>
  <div><span>事实条目</span><b>${num("count:src/product.json#presets")}</b><span class="dim">个预设 · ${num("count:src/product.json#styles")} 套皮肤 · ${num("count:src/product.json#parts")} 个部件</span></div>
  ${mutation ? `<div><span>变异臂</span><b>${num("json:evidence/mutation-report.json#arms")}</b><span class="dim">被抓住 ${num("json:evidence/mutation-report.json#caught")} 条</span></div>` : ""}
</div>
<p class="note">本页与三张交互页全部单文件自包含：零外链、零脚本、零网络请求，双击即开。截图来自 SwiftShader 软渲染的真实 WebGL1 上下文。</p>
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "preview", "styles.html"), html);
const nodeCount = (html.match(/data-num="/g) || []).length;
console.log(JSON.stringify({ out: "preview/styles.html", bytes: bytes(html), pointers: nodeCount, unresolved: 0 }));
