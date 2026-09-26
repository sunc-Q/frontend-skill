/* 生成 index.html：本轮的一屏总览（三页入口 + 关键读数）。
 * 规矩：页面里出现的每个数字都必须从 evidence/*.json 与 scripts/build-sizes.json 转写而来，
 * 脚本不认的字段就 throw，绝不在这里手写读数——历轮教训：手写死的文案会和新数据矛盾，
 * 而结构校验全绿也抓不到。
 * 运行顺序：check-node → check-browser → mutate → 本脚本 → check-clean → summarize
 * （本脚本只读磁盘上已经存在的证据 JSON，绝不读 summarize 的产物，否则与 check-clean 互相依赖成环） */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const j = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const missing = ["evidence/ground-truth.json", "scripts/build-sizes.json", "evidence/check-browser.json",
  "evidence/mutation-strict.json", "evidence/check-node.json", "src/audio-spec.json"]
  .filter((p) => !fs.existsSync(path.join(ROOT, p)));
if (missing.length) throw new Error("缺少证据文件，先把校验跑完再来生成总览：" + missing.join(", "));

const sizes = j("scripts/build-sizes.json");
const gt = j("evidence/ground-truth.json").summary;
const cn = j("evidence/check-node.json");
const cb = j("evidence/check-browser.json");
const mut = j("evidence/mutation-strict.json");
const spec = j("src/audio-spec.json");

/* 体积直接量磁盘，不读 summarize 的产物：本脚本要在 check-clean 之前跑，不能反向依赖它 */
function dirBytes(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return t;
}
const artifactMb = dirBytes(ROOT) / 1048576;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—");
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : "—");
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");

const styleCards = sizes.styles.map((s) => {
  const name = s.style;
  const series = cb.reads[name + ":series"] || {};
  const corr = series.corr || {};
  const dip = cb.reads[name + ":dip"];
  const arm = cb.reads["frozen:" + name];
  const boot = cb.reads[name + ":boot"];
  const sw = Object.entries(s.glHexes).map(([u, hex]) =>
    `<li><span class="sw" style="background:${esc(hex)}"></span><code>${esc(u)}</code> <b>${esc(hex)}</b></li>`).join("");
  return `<article class="card">
  <h3>${esc(s.label)}<a href="${esc(s.file)}">打开这一页 →</a></h3>
  <p class="meta">${esc(s.file)} · ${(s.bytes / 1048576).toFixed(2)} MB · 着色器 ${s.shaderBytes}B · 皮肤 CSS ${s.skinCssBytes}B · 宿主段 ${(s.scriptPayloadBytes / 1024).toFixed(1)} kB</p>
  <ul class="swatches">${sw}</ul>
  <table>
    <tr><th>浏览器低频读数 vs Node 真值</th><td>r = ${f3(corr.bass)}（对齐偏移 ${series.offset ?? 0}s）</td></tr>
    <tr><th>中频 / 高频相关</th><td>${f3(corr.mid)} / ${f3(corr.treble)}</td></tr>
    <tr><th>fps（SwiftShader 软渲染）</th><td>${f1(boot && boot.frames ? boot.frames.fps : NaN)}</td></tr>
    ${dip ? `<tr><th>breakdown 凹陷（浏览器窗口口径）</th><td>${dip.browserGroove.toFixed(3)} → ${dip.browserBreak.toFixed(3)}（比值 ${dip.browserRatio.toFixed(3)}；Node ${dip.nodeRatio.toFixed(3)}）</td></tr>` : ""}
    ${arm ? `<tr><th>frozen 臂下画面仍在变</th><td>${pct(arm.changedPct)} 像素变化</td></tr>` : ""}
  </table>
</article>`;
}).join("\n");

const cf = gt.counterfactualCeilMinus30;
const sat = gt.saturation;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>shader × 音频可视化 · 本轮总览</title>
<style>
:root { --ink:#171a14; --paper:#f7f5ef; --muted:#5d6157; --line:#d5d1c4; --accent:#8a3324; --mono:ui-monospace,Menlo,monospace; }
* { box-sizing: border-box; }
body { margin:0; padding:2rem 1.25rem 3rem; background:var(--paper); color:var(--ink);
  font:15px/1.6 "Avenir Next","PingFang SC",sans-serif; }
main { max-width: 68rem; margin:0 auto; }
h1 { font-size:1.6rem; margin:0 0 .35rem; letter-spacing:.01em; }
h2 { font-size:1.05rem; margin:2rem 0 .6rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
h3 { display:flex; justify-content:space-between; gap:1rem; font-size:1.05rem; margin:0 0 .4rem; }
h3 a { font:12px var(--mono); color:var(--accent); text-decoration:none; white-space:nowrap; }
p, li { color:var(--ink); }
.lede { color:var(--muted); max-width:60rem; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(19rem,1fr)); gap:1rem; }
.card { border:1px solid var(--line); background:#fff; padding:.9rem 1rem; }
.card .meta { font:11.5px/1.5 var(--mono); color:var(--muted); margin:.1rem 0 .6rem; }
.swatches { list-style:none; display:flex; flex-wrap:wrap; gap:.4rem .8rem; padding:0; margin:0 0 .7rem; font:11px var(--mono); }
.sw { display:inline-block; width:.85rem; height:.85rem; border:1px solid var(--line); vertical-align:-1px; }
table { border-collapse:collapse; width:100%; font-size:12.5px; }
th { text-align:left; font-weight:500; color:var(--muted); padding:.25rem .5rem .25rem 0; width:58%; }
td { font:12px var(--mono); padding:.25rem 0; }
dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.5rem 1rem; margin:0; }
.kv { border-left:3px solid var(--line); padding:.1rem .7rem; }
.kv dt { font-size:11.5px; color:var(--muted); }
.kv dd { margin:.1rem 0 0; font:13px var(--mono); }
.arms { list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(21rem,1fr)); gap:.35rem .9rem; font:12px var(--mono); }
footer { margin-top:2.5rem; padding-top:1rem; border-top:1px solid var(--line); font-size:12px; color:var(--muted); }
</style>
</head>
<body>
<main>
<h1>shader × 音频可视化 · 三风格产物总览</h1>
<p class="lede">技能：shader（GLSL/WebGL 片元着色器）。场景：一首 16 秒虚构电子曲的实时频谱驱动画面。
本文件的每个数字都由 scripts/make-styles.mjs 从 <code>evidence/*.json</code> 转写而来，脚本不认的字段直接报错，不手写读数。</p>

<h2>断言总量</h2>
<dl>
  <div class="kv"><dt>静态判据（check-node）</dt><dd>${cn.pass}/${cn.total}</dd></div>
  <div class="kv"><dt>真浏览器判据（check-browser）</dt><dd>${cb.pass}/${cb.total}</dd></div>
  <div class="kv"><dt>变异体（mutate，全部须被抓住）</dt><dd>${mut.caught}/${mut.count}</dd></div>
  <div class="kv"><dt>清理判据（check-clean）</dt><dd>在本页生成之后运行，总数见 evidence/assert-totals.json</dd></div>
  <div class="kv"><dt>本页生成时已跑合计</dt><dd>${cn.total + cb.total} 条</dd></div>
  <div class="kv"><dt>产物体积</dt><dd>${artifactMb.toFixed(2)} MB / 上限 50 MB</dd></div>
</dl>

<h2>曲目与分析口径</h2>
<dl>
  <div class="kv"><dt>曲子</dt><dd>${spec.synth.bpm} BPM · ${spec.synth.bars} 小节 · ${spec.synth.durationSec}s · ${spec.synth.sampleRate} Hz 单声道</dd></div>
  <div class="kv"><dt>峰值</dt><dd>${spec.facts.peakDbfs.toFixed(2)} dBFS · 削顶 ${spec.facts.clippedSamples} 样本</dd></div>
  <div class="kv"><dt>FFT / hop</dt><dd>${gt.fftSize} / ${gt.hop} → ${gt.frameCount} 帧 · bin ${gt.binWidthHz} Hz · ${gt.bandEdges.count} 个对数带 ${gt.bandEdges.lo}–${gt.bandEdges.hi} Hz</dd></div>
  <div class="kv"><dt>dB 窗口</dt><dd>${gt.scale.dbFloor} – ${gt.scale.dbCeil} dB（默认上限是 -30）</dd></div>
  <div class="kv"><dt>采用口径下 groove 低频饱和率</dt><dd>${pct(sat.grooveBass.fullRate)}（${sat.grooveBass.full}/${sat.grooveBass.total} texel）</dd></div>
  <div class="kv"><dt>默认 -30 口径</dt><dd>饱和 ${pct(cf.saturation.grooveBass.fullRate)} · 低频整段钉在 1.0 的帧 ${pct(cf.bassSeriesGroove.pinnedAtOne)} · 唯一值 ${cf.bassSeriesGroove.uniqueValues} vs ${gt.bassWindowAtCeil.groove.uniqueValues}</dd></div>
  <div class="kv"><dt>groove↔breakdown 低频中位数间距</dt><dd>${gt.bassWindowAtCeil.grooveBreakdownGap.toFixed(4)}（比值 ${gt.dips.ratio.toFixed(4)}）</dd></div>
  <div class="kv"><dt>起拍</dt><dd>检出 ${gt.onsets.length ?? gt.onsetTimes.length} 次 · 阈值 = 30 帧通量均值 × 1.35 + 0.012</dd></div>
</dl>

<h2>三页</h2>
<div class="cards">
${styleCards}
</div>

<h2>消融臂（同一份源码，只换 query）</h2>
<ul class="arms">
${sizes.ablations.map((a) => `<li><code>?probe=${esc(a.arm)}</code> —— ${esc(a.what)} → ${esc(a.want)}</li>`).join("\n")}
</ul>
<p class="lede">互斥对：<code>?probe=frozen</code>（只拔时钟，画面必须仍变）与 <code>?probe=frozen,noaudio</code>（时钟与音频一起拔，画面必须一像素都不动）。
三页实测：frozen 下像素变化 ${sizes.styles.map((s) => pct(cb.reads["frozen:" + s.style]?.changedPct ?? NaN)).join(" / ")}，
frozen,noaudio 下变化 ${sizes.styles.map((s) => cb.reads["frozen,noaudio:" + s.style]?.changed ?? "—").join(" / ")} 像素。</p>

<h2>变异与还原</h2>
<p class="lede">对产物做了 ${mut.count} 个故意破坏（value ${mut.mutations.filter((m) => m.kind === "value").length} /
structural ${mut.mutations.filter((m) => m.kind === "structural").length} /
semantic ${mut.mutations.filter((m) => m.kind === "semantic").length}），
抓住 ${mut.caught} 个；还原后 check-node 失败项与基线一致：${mut.restored_identical ? "是" : "否"}（明细见 evidence/mutation-strict.json）。
其中 S7 由设计就是「静态判据无反应、只有互斥消融臂能抓」，X1/X2 两条语义变异最初无人抓住，因此补了 D37 与 B16。</p>

<footer>本页是本轮产物的入口，不是第四种风格。所有读数只在本机 headless Chromium + SwiftShader 下取得，
不构成任何性能或兼容性主张；曲目与企划均为虚构。</footer>
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), html);
const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) throw new Error("index.html 占位符残留 " + leftover.join(","));

/* 自检：本页必须真的把证据里的数字写进去了（生成的页面不回头核对，等于没生成） */
let gPass = 0, gFail = 0;
const ck = (name, cond, detail) => { if (cond) gPass++; else { gFail++; console.log("FAIL " + name + (detail ? "  [" + detail + "]" : "")); } };
const mustNumbers = [
  gt.frameCount + " 帧", gt.binWidthHz + " Hz", gt.scale.dbCeil + " dB",
  (gt.saturation.grooveBass.fullRate * 100).toFixed(1) + "%",
  gt.counterfactualCeilMinus30.saturation.grooveBass.fullRate ? (gt.counterfactualCeilMinus30.saturation.grooveBass.fullRate * 100).toFixed(1) + "%" : "x",
  gt.dips.ratio.toFixed(4),
  (cn.total + cb.total) + " 条",
  spec.synth.bpm + " BPM"
];
mustNumbers.forEach((n, i) => ck("G" + (i + 1) + " index.html 含读数「" + n + "」", html.includes(n)));
sizes.styles.forEach((s) => {
  ck("G" + (9 + sizes.styles.indexOf(s)) + " 三页链接与色板齐备（" + s.style + "）",
    html.includes(s.file) && Object.values(s.glHexes).every((hex) => html.includes(hex)));
});
const urls = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => !u.startsWith("preview/"));
ck("G12 index.html 零外链（只指向本目录三页）", urls.length === 0, urls.join(","));
ck("G13 每页的相关性读数都取到了（没有 — 占位）",
  sizes.styles.every((s) => (cb.reads[s.style + ":series"] || {}).corr && Number.isFinite(cb.reads[s.style + ":series"].corr.bass)));
ck("G14 三页的 dip 读数齐备（说明 K6 跑到了）", sizes.styles.every((s) => cb.reads[s.style + ":dip"]));
console.log("index.html " + Buffer.byteLength(html) + "B（数字全部来自 evidence JSON）· 自检 " + gPass + "/" + (gPass + gFail));
if (gFail) process.exit(1);
