/* Node 侧静态断言（A–F 组）：不依赖浏览器，检查「构建说过的话有没有真做到」。
 * 纪律：
 *  - 断言总数不含任何条件性 push（跑一次就打印一个稳定总数）；
 *  - 凡进文档的数字一律由这里打印，不手抄；
 *  - 数值比较优先「字符串精确匹配构建产物」，避免浮点容差把缺陷放过。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { bandEdges, COARSE } from "../src/bands.js";
import { DB_FLOOR, DB_CEIL, ONSET_WINDOW, ONSET_FACTOR, ONSET_FLOOR } from "../src/features.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const failures = [];
const seenNames = [];
function ok(name, cond, detail) {
  seenNames.push(name);
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); }
  console.log((cond ? "PASS " : "FAIL ") + name + (detail && !cond ? "  [" + detail + "]" : ""));
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

const STYLES = ["colonnade", "ripple", "thermal"];
const sizes = JSON.parse(read("scripts/build-sizes.json"));
const spec = JSON.parse(read("src/audio-spec.json"));
const gt = JSON.parse(read("evidence/ground-truth.json")).summary;
const baseCss = read("src/css/base.css");
const hostSrc = read("src/host.js");

/* ---------- 页面拆解 ---------- */
function loadPage(style) {
  const file = "preview/visualizer-" + style + ".html";
  const html = read(file);
  const styles = [...html.matchAll(/<style>\n([\s\S]*?)\n<\/style>/g)].map((m) => m[1]);
  const scriptStart = html.indexOf("<script>");
  const payload = html.slice(scriptStart + 8, html.lastIndexOf("</script>"));
  const sentinel = payload.indexOf("==SHARED-HOST-BOUNDARY==");
  const mStyle = /var STYLE = \{\n\s*name: "(.+?)",\n\s*palette: (.+?),\n\s*uniforms: (.+?),\n\s*fragmentSource: (.+?),\n\s*bands: (.+?)\n\s*\};/.exec(payload);
  const shader = mStyle ? JSON.parse(mStyle[4]) : "";
  const audioUri = (/src="(data:audio[^"]+)"/.exec(html) || [])[1] || "";
  const bodyTag = /<body[^>]*>/.exec(html)[0];
  return {
    style, file, html, bytes: Buffer.byteLength(html),
    cssBase: styles[0] || "", cssSkin: styles[1] || "",
    payload, sharedTail: sentinel >= 0 ? payload.slice(payload.indexOf("*/", sentinel) + 2) : "",
    uniforms: mStyle ? JSON.parse(mStyle[3]) : [],
    palette: mStyle ? JSON.parse(mStyle[2]) : {},
    bandSpec: mStyle ? JSON.parse(mStyle[5]) : {},
    shader, audioUri, bodyTag
  };
}
const P = {};
STYLES.forEach((s) => { P[s] = loadPage(s); });

/* ================= A · 构建一致性与自包含 ================= */
STYLES.forEach((s) => {
  ok("A1 " + s + " 页面存在且体积合理（内联音频 ≈ 940KB）", P[s].bytes > 900000 && P[s].bytes < 1500000, P[s].bytes + "B");
});
STYLES.forEach((s) => {
  const b64 = P[s].audioUri.replace(/^data:audio\/wav;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  eq("A2 " + s + " 内联音频解码后 sha256 == 构建登记的 wav", crypto.createHash("sha256").update(buf).digest("hex"), sizes.wavSha256);
});
STYLES.forEach((s) => {
  const h = P[s].html;
  const urls = [...h.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1])
    .filter((u) => !u.startsWith("data:") && !u.startsWith("#"));
  const net = [...h.matchAll(/\b(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0])
    .filter((u) => !/w3\.org|schema\.org/.test(u));
  const calls = [...h.matchAll(/\b(fetch\(|XMLHttpRequest|importScripts|@import|new Worker|createMediaElementSource\(\s*['"])/g)].map((m) => m[0]);
  ok("A3 " + s + " 零外链（属性 URL " + urls.length + " / 网络字面量 " + net.length + " / 远程 API " + calls.length + "）",
    urls.length === 0 && net.length === 0 && calls.length === 0, urls.concat(net, calls).join(","));
});
eq("A4 三页哨兵之后的宿主段落逐字节相同（皮肤差异只允许发生在 <style> 与 STYLE 块）",
  P.colonnade.sharedTail === P.ripple.sharedTail && P.ripple.sharedTail === P.thermal.sharedTail, true);
ok("A5 宿主段落占整页脚本载荷的比例合理（>70%）",
  P.colonnade.sharedTail.length / P.colonnade.payload.length > 0.7,
  (P.colonnade.sharedTail.length / P.colonnade.payload.length).toFixed(3));
STYLES.forEach((s) => {
  ok("A6 " + s + " 内联脚本载荷无裸 </script", !/<\/script/i.test(P[s].payload));
});
STYLES.forEach((s) => {
  eq("A7 " + s + " 只有两个 <style>（结构层 + 皮肤层）", (P[s].html.match(/<style>/g) || []).length, 2);
});
eq("A8 三页结构层 CSS 逐字节相同", P.colonnade.cssBase === P.ripple.cssBase && P.ripple.cssBase === P.thermal.cssBase, true);
ok("A9 三页皮肤 CSS 两两互异",
  P.colonnade.cssSkin !== P.ripple.cssSkin && P.ripple.cssSkin !== P.thermal.cssSkin && P.colonnade.cssSkin !== P.thermal.cssSkin);
STYLES.forEach((s) => {
  ok("A10 " + s + " body class/data-style 与本页皮肤一致",
    P[s].bodyTag.includes('class="skin-' + s + '"') && P[s].bodyTag.includes('data-style="' + s + '"'), P[s].bodyTag);
});

/* ---- DOM 骨架同构：剥掉样式与脚本载荷，只留标签流 ---- */
function tagStream(html) {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, "<style/>")
    .replace(/<script>[\s\S]*?<\/script>/g, "<script/>")
    .replace(/src="data:audio[^"]*"/, 'src="AUDIO"')
    .replace(/class="skin-[a-z]+"/, 'class="skin-*"')
    .replace(/data-style="[a-z]+"/, 'data-style="*"')
    .replace(/<caption>本页着色器[\s\S]*?<\/table>/, "<table-uniform-omitted/>")
    .replace(/<caption>本页实际生效[\s\S]*?<\/table>/, "<meta-omitted/>")
    .replace(/<title>[\s\S]*?<\/title>/, "<title/>")
    .replace(/<meta name="description"[^>]*>/, "<desc/>")
    .replace(/<p class="lead">[\s\S]*?<\/p>/g, "<lead/>")
    .match(/<\/?[a-z][^>]*>/gi);
}
const streams = STYLES.map((s) => tagStream(P[s].html).join("\n"));
ok("A11 三页 DOM 骨架同构（同一份模板，只有皮肤与本页 uniform 表不同）",
  streams[0] === streams[1] && streams[1] === streams[2],
  "len " + streams.map((x) => x.length).join("/"));

/* ================= B · uniform 三方纪律（着色器 ↔ 宿主清单 ↔ 页面表格） ================= */
STYLES.forEach((s) => {
  const declaredNonVec3 = [...P[s].shader.matchAll(/uniform\s+(?:float|vec2|sampler2D)\s+(\w+)\s*;/g)].map((m) => m[1]);
  const declaredVec3 = [...P[s].shader.matchAll(/uniform\s+vec3\s+(\w+)\s*;/g)].map((m) => m[1]);
  eq("B1 " + s + " 宿主登记的 uniforms == 着色器声明的非 vec3",
    JSON.stringify(P[s].uniforms.slice().sort()), JSON.stringify(declaredNonVec3.slice().sort()));
  const rows = [...P[s].html.matchAll(/<tr><th scope="row">(u[A-Za-z0-9]+)<\/th><td>(\w+)<\/td>/g)];
  eq("B2 " + s + " 页面 uniform 表行数 == 着色器声明总数（" + (declaredNonVec3.length + declaredVec3.length) + "）",
    rows.length, declaredNonVec3.length + declaredVec3.length);
  eq("B3 " + s + " 页面表里的名字集合 == 着色器声明集合（文案不漂移）",
    JSON.stringify(rows.map((r) => r[1]).sort()),
    JSON.stringify(declaredNonVec3.concat(declaredVec3).sort()));
  eq("B4 " + s + " 表内类型标注与声明类型一致",
    rows.filter((r) => declaredVec3.includes(r[1]) && r[2] !== "vec3").length
    + rows.filter((r) => !declaredVec3.includes(r[1]) && !["float", "vec2", "sampler2D"].includes(r[2]) ).length, 0);
  ok("B5 " + s + " 声明的 vec3 全部由皮肤令牌供色",
    declaredVec3.every((u) => u in P[s].palette), declaredVec3.join(","));
});
/* 着色器里不该出现宿主没提供的量，也不该出现内置别名（技能护栏：不自造宏/内置量） */
STYLES.forEach((s) => {
  const glsl = P[s].shader;
  ok("B6 " + s + " 片元是 GLSL ES 1.0（有 precision、无 #version、不用 texture()/in/out）",
    /precision\s+(mediump|highp)\s+float/.test(glsl) && !/#version/.test(glsl)
    && !/\btexture\s*\(/.test(glsl) && !/^\s*in\s+vec/mg.test(glsl) && /gl_FragColor/.test(glsl));
  ok("B7 " + s + " 只声明 float/vec2/vec3/sampler2D（无 Mat/IVec 等宿主没接的类型）",
    [...glsl.matchAll(/uniform\s+(\w+)\s/g)].every((m) => ["float", "vec2", "vec3", "sampler2D"].includes(m[1])));
});
ok("B8 三个着色器各不相同（不是同一份源码换皮）",
  new Set(STYLES.map((s) => P[s].shader)).size === 3);
ok("B9 colonnade 刻意不声明 uTime（主画面没有任何自带时钟）", !/uniform\s+float\s+uTime/.test(P.colonnade.shader));
ok("B10 thermal 用 uHistory（历史纹理）而另两页不用",
  /uniform\s+sampler2D\s+uHistory/.test(P.thermal.shader)
  && !/uHistory/.test(P.colonnade.shader) && !/uHistory/.test(P.ripple.shader));
ok("B11 每个着色器都消费 uOrigin（多视口共用画布时不减原点就是三条裁片）",
  STYLES.every((s) => /uOrigin/.test(P[s].shader) && /gl_FragCoord/.test(P[s].shader)));
ok("B12 宿主对 uOrigin 逐视口写不同 x（不是同一个常量）",
  /gl\.uniform2f\(locations\.uOrigin,\s*x,\s*0\)/.test(hostSrc));
ok("B13 消融臂可叠加：宿主用 has(...) 而不是单值比较",
  !/probe === "/.test(hostSrc) && /function has\(name\) \{\s*return probes\.indexOf\(name\) >= 0; \}/.test(hostSrc));
const hostArms = [...new Set([...hostSrc.matchAll(/has\("([a-z]+)"\)/g)].map((m) => m[1]))].sort();
eq("B14 宿主消融臂集合与构建清单一致", JSON.stringify(hostArms),
  JSON.stringify([...new Set(sizes.ablations.flatMap((a) => a.arm.split(",")))].sort()));
STYLES.forEach((s) => {
  const pageArms = [...new Set([...P[s].html.matchAll(/\?probe=([a-z,]+)/g)].map((m) => m[1]))];
  eq("B15 " + s + " 页面列出的消融臂 == 构建清单（含叠加臂 frozen,noaudio）",
    JSON.stringify(pageArms.sort()), JSON.stringify(sizes.ablations.map((a) => a.arm).sort()));
});

/* B16：导语里「主画面刻意没有 uTime」这类陈述必须与着色器实际声明同真同假。
 * 这条是被变异 X2 逼出来的：只改文案、数据与代码都不动，其余判据全绿。 */
STYLES.forEach((s) => {
  const claims = /刻意没有 uTime/.test(P[s].html);
  const declares = /uniform\s+float\s+uTime/.test(P[s].shader);
  eq("B16 " + s + " 「有没有 uTime」的文案陈述与着色器声明一致（文案 " + claims + " / 声明 " + declares + "）", claims, !declares);
});

/* ================= C · 皮肤封闭色板 / 交集 / 对比度 / 指纹 ================= */
function rootBlock(css) { const s = css.indexOf(":root"); return css.slice(s, css.indexOf("}", s)); }
function hexesOf(css) { return [...new Set((css.match(/#[0-9a-fA-F]{3,6}\b/g) || []).map((x) => x.toLowerCase()))]; }
function expand(h) {
  const x = h.replace("#", "");
  const f = x.length === 3 ? x.split("").map((c) => c + c).join("") : x;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}
function relLum(h) {
  const [r, g, b] = expand(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function token(css, name) {
  const m = new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{3,6})").exec(css);
  return m ? m[1].toLowerCase() : null;
}
const palettes = {};
STYLES.forEach((s) => {
  const root = rootBlock(P[s].cssSkin);
  const declared = [...new Set([...root.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => m[2].toLowerCase()))];
  const used = hexesOf(P[s].cssSkin);
  palettes[s] = declared;
  ok("C1 " + s + " 皮肤色板封闭：页内出现的每个十六进制色都在 :root 声明",
    used.every((h) => declared.includes(h)), used.filter((h) => !declared.includes(h)).join(","));
  eq("C2 " + s + " 结构层（base.css）零字面颜色", hexesOf(baseCss).length, 0);
  const usedVars = new Set([...(baseCss + P[s].cssSkin).matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const definedVars = new Set([...(baseCss + P[s].cssSkin).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  const undef = [...usedVars].filter((v) => !definedVars.has(v));
  eq("C3 " + s + " 每个 var(--x) 都有定义（掉规则就会退回浏览器默认值）", undef.length, 0);
  void used;
});
for (let i = 0; i < STYLES.length; i++) for (let j = i + 1; j < STYLES.length; j++) {
  const inter = palettes[STYLES[i]].filter((h) => palettes[STYLES[j]].includes(h));
  eq("C4 " + STYLES[i] + " × " + STYLES[j] + " 色板零交集", inter.length, 0);
}
STYLES.forEach((s) => {
  const bg = token(P[s].cssSkin, "c-bg"), text = token(P[s].cssSkin, "c-text"), muted = token(P[s].cssSkin, "c-muted");
  const panel = token(P[s].cssSkin, "c-panel");
  const c1 = contrast(text, bg), c2 = contrast(muted, bg), c3 = contrast(text, panel);
  ok("C5 " + s + " 正文/元数据对比度过 WCAG AA（" + c1.toFixed(2) + " / " + c2.toFixed(2) + " / " + c3.toFixed(2) + "）",
    c1 >= 4.5 && c2 >= 4.5 && c3 >= 4.5);
});
/* 三风格指纹：每页主张不同，用可机检的手法差异来兜住「只换了配色」 */
const FP = {};
STYLES.forEach((s) => {
  const css = P[s].cssSkin;
  FP[s] = {
    radius: (css.match(/border-radius:\s*([0-9.]+px|0)/g) || []).map((x) => /(\S+)[;]?$/.exec(x)[1]).filter((v) => v !== "0").length,
    blur: /box-shadow:[^;]*blur\(/.test(css),
    gradient: /gradient\(/.test(css),
    mono: /--f-body:[^;]*monospace/.test(css),
    upper: (css.match(/text-transform:\s*uppercase/g) || []).length,
    borderPx: (css.match(/border:\s*([0-9.]+)px/g) || []).map((x) => parseFloat(/([\d.]+)px/.exec(x)[1])),
    lineHeight: (parseFloat(/--lh-body:\s*([\d.]+)/.exec(css)[1]) || 0),
    displayPx: parseFloat(/--fs-display:\s*([\d.]+)px/.exec(css)[1]),
    family: (/--f-body:\s*([^;]+)/.exec(css)[1] || "").trim().split(",")[0].replace(/["']/g, "")
  };
});
ok("C6 三风格字体主族互异（" + STYLES.map((s) => FP[s].family).join(" / ") + "）",
  new Set(STYLES.map((s) => FP[s].family)).size === 3);
ok("C7 三风格「圆角手法」互异（非零圆角条数 " + STYLES.map((s) => FP[s].radius).join("/") + "，且热像页必须直角）",
  new Set(STYLES.map((s) => FP[s].radius)).size >= 2 && FP.thermal.radius === 0);
const softShadow = (css) => /box-shadow:[^;]*(rgba|blur\()/.test(css);
const hardShadow = (css) => /box-shadow:[^;]*\b\d+px \d+px 0[\s;,]/.test(css);
const anyShadow = (css) => /box-shadow:\s*(?!none)/.test(css);
ok("C8 阴影手法互斥：" + STYLES.map((s) => (softShadow(P[s].cssSkin) ? "弥散" : hardShadow(P[s].cssSkin) ? "硬偏移" : "无")).join(" / ") +
  "（恰好一页弥散、一页硬偏移、一页零阴影）",
  STYLES.filter((s) => softShadow(P[s].cssSkin)).length === 1 &&
  STYLES.filter((s) => hardShadow(P[s].cssSkin)).length === 1 &&
  STYLES.filter((s) => !anyShadow(P[s].cssSkin)).length === 1);
ok("C9 恰好一页全站等宽排版", STYLES.filter((s) => FP[s].mono).length === 1);
ok("C10 大写转换条数互异且至少一页不用", new Set(STYLES.map((s) => FP[s].upper)).size >= 2
  && Math.min(...STYLES.map((s) => FP[s].upper)) === 0);
const maxBorder = (s) => Math.max(0, ...FP[s].borderPx);
ok("C11 描边取向互异（最粗描边 " + STYLES.map((s) => maxBorder(s) + "px").join(" / ") + "：账簿 2px 实线 / 水墨只走 1px 发丝线 / 热像 4px 粗描边）",
  maxBorder("colonnade") === 2 && maxBorder("ripple") <= 1 && maxBorder("thermal") >= 4 &&
  new Set(STYLES.map(maxBorder)).size === 3);
STYLES.forEach((s) => {
  const bg = token(P[s].cssSkin, "c-btn-bg"), ink = token(P[s].cssSkin, "c-btn-ink");
  ok("C14 " + s + " 播放按钮前景/底色对比度过 AA（" + (bg && ink ? contrast(ink, bg).toFixed(2) : "缺令牌") + "）",
    !!bg && !!ink && contrast(ink, bg) >= 4.5);
});
ok("C12 行高与标题字号取向互异（" + STYLES.map((s) => FP[s].lineHeight + "×" + FP[s].displayPx).join(" / ") + "）",
  new Set(STYLES.map((s) => FP[s].lineHeight)).size === 3 && new Set(STYLES.map((s) => FP[s].displayPx)).size === 3);
ok("C13 三页正文背景色两两互异", new Set(STYLES.map((s) => token(P[s].cssSkin, "c-bg"))).size === 3);

/* ================= D · 曲目事实与解析读数 ================= */
const facts = spec.facts;
eq("D1 合成器声明 120 BPM / 8 小节 / 16 秒", [spec.synth.bpm, spec.synth.bars, spec.synth.durationSec].join("/"), "120/8/16");
eq("D2 采样数 = 时长 × 采样率", facts.samples, spec.synth.sampleRate * spec.synth.durationSec);
eq("D3 削顶样本为 0（峰值归一没把动态压平）", facts.clippedSamples, 0);
ok("D4 峰值在 0.8–0.95 之间（留了余量，不是 1.0 满幅）", facts.peakDbfs > -2 && facts.peakDbfs < -0.4, facts.peakDbfs.toFixed(2) + " dBFS");
const evList = spec.events.map((e) => e.t);
ok("D5 事件清单非空且全部落在曲长内（" + evList.length + " 个事件）",
  evList.length > 100 && evList.every((t) => t >= 0 && t <= spec.synth.durationSec));
eq("D6 counts.kick 与 kick 时刻数组长度一致（数字不是手抄的）",
  facts.counts.kick, facts.kickTimes.length);
ok("D7 底鼓间距 ≥ 半拍（0.25s @120BPM）且都在拍上",
  facts.kickTimes.every((t, i) => i === 0 || t - facts.kickTimes[i - 1] >= 0.24) &&
  facts.kickTimes.every((t) => Math.abs((t / 0.5) - Math.round(t / 0.5)) < 1e-6));
ok("D8 起拍读数存在且落在合理区间（合成 20 底鼓 + 10 军鼓 ⇒ 检测 20–60）",
  gt.onsets >= 20 && gt.onsets <= 60, String(gt.onsets));
eq("D9 Node 分析帧数 = 1371（hop 256 / FFT 2048 / 16s）", gt.frameCount, 1371);
eq("D10 频率分辨率 = 采样率 / FFT", gt.binWidthHz, Number((spec.synth.sampleRate / 2048).toFixed(4)));
eq("D11 64 个对数带，边界与共享模块一致", JSON.stringify(gt.bandEdges),
  JSON.stringify({ count: 64, lo: Number(bandEdges()[0].toFixed(3)), hi: Number(bandEdges()[64].toFixed(1)) }));
eq("D12 粗带划分与共享模块一致", JSON.stringify(gt.coarse.map((c) => [c.key, c.from, c.to])),
  JSON.stringify(COARSE.map((c) => [c.key, c.from, c.to])));
eq("D13 小节窗口由 spec 推导（groove 5 小节 + breakdown 1 小节）",
  JSON.stringify([gt.windows.barSec, gt.windows.grooveBars.length, gt.windows.breakdownBar]), JSON.stringify([2, 5, 5]));
ok("D14 浏览器窗口口径写进宿主：min/maxDecibels 由共享常量提供，不是各写一份",
  /analyser\.minDecibels = FEATURES_INLINE\.DB_FLOOR/.test(hostSrc) && /analyser\.maxDecibels = FEATURES_INLINE\.DB_CEIL/.test(hostSrc));
eq("D15 宿主显式关掉跨帧平滑（否则两个解析器不可比）", /analyser\.smoothingTimeConstant = 0/.test(hostSrc) ? 1 : 0, 1);

/* dB 窗口反事实：这一组是「为什么不用默认 -30」的证据，不是装饰 */
const cf = gt.counterfactualCeilMinus30;
eq("D16 采用窗口上限 -10 dB", DB_CEIL, -10);
eq("D17 采用窗口下对齐 AnalyserNode 默认 -100 dB", DB_FLOOR, -100);
eq("D18 采用口径下 groove 低频带饱和率为 0", gt.saturation.grooveBass.fullRate, 0);
ok("D19 默认 -30 口径下 groove 低频带被顶满（>20%）——换窗口的理由", cf.saturation.grooveBass.fullRate > 0.2,
  cf.saturation.grooveBass.fullRate.toFixed(4));
eq("D20 反事实只改窗口：texel 总数与采用口径同批（同源 FFT、同一套带边界）",
  cf.saturation.grooveBass.total, gt.saturation.grooveBass.total);
ok("D21 -30 口径下 groove 低频的层次被抹掉（唯一值数下降到 <70%）",
  cf.bassSeriesGroove.uniqueValues < gt.bassWindowAtCeil.groove.uniqueValues * 0.7,
  cf.bassSeriesGroove.uniqueValues + " vs " + gt.bassWindowAtCeil.groove.uniqueValues);
ok("D22 -30 口径下 groove 有 >15% 的帧整段低频钉在 1.0", cf.bassSeriesGroove.pinnedAtOne > 0.15, cf.bassSeriesGroove.pinnedAtOne.toFixed(4));
ok("D23 采用口径下 groove 与 breakdown 的低频中位数仍能分开（>0.3）",
  gt.bassWindowAtCeil.grooveBreakdownGap > 0.3, gt.bassWindowAtCeil.grooveBreakdownGap.toFixed(4));
ok("D24 breakdown 低频凹陷是真事实（比值 <0.6）", gt.dips.ratio < 0.6, gt.dips.ratio.toFixed(4));
eq("D25 起拍阈值常量与宿主/页面文案同源",
  [ONSET_WINDOW, ONSET_FACTOR, ONSET_FLOOR].join("/"), "30/1.35/0.012");
ok("D26 页面脚注里的阈值文案与常量同值（不是手抄的旧数）",
  P.colonnade.html.includes(ONSET_WINDOW + " 帧通量均值 × " + ONSET_FACTOR + " + " + ONSET_FLOOR));

/* 页面里的数字必须由事实转写而来 */
const factStrings = [
  ">" + spec.synth.bpm + " BPM · 4/4<",
  ">" + spec.synth.durationSec.toFixed(2) + " 秒 · " + spec.synth.bars + " 小节<",
  (spec.synth.sampleRate / 1000).toFixed(2) + "k Hz · 单声道 · 16-bit PCM",
  ">" + facts.peakDbfs.toFixed(2) + " dBFS · 削顶样本 " + facts.clippedSamples + " 个<",
  ">FFT 2048 · 频率分辨率 " + gt.binWidthHz.toFixed(2) + " Hz · 64 个对数带<"
];
STYLES.forEach((s) => {
  const miss = factStrings.filter((x) => !P[s].html.includes(x));
  eq("D27 " + s + " 曲目事实五项与 spec/解析读数逐字相同", miss.join(" | "), "");
});
const barRe = /<tr><th scope="row">0(\d)<\/th><td>([\d.]+)–([\d.]+) s<\/td><td>([^<]+)<\/td><td>([\d.]+)<\/td><td>([\d.]+)<\/td><td>([\d.]+)<\/td><td>([\d.]+)<\/td><\/tr>/g;
const barRows = [...P.colonnade.html.matchAll(barRe)];
eq("D28 逐小节表 8 行", barRows.length, 8);
const barMismatch = [];
barRows.forEach((r) => {
  const i = Number(r[1]) - 1, g = gt.perBar[i];
  const want = [g.level.median.toFixed(3), g.bass.median.toFixed(3), g.mid.median.toFixed(3), g.treble.median.toFixed(3)].join();
  const got = [r[5], r[6], r[7], r[8]].join();
  if (want !== got) barMismatch.push(i + 1 + ":" + got + "≠" + want);
  const specBar = facts.bars[i];
  if (Number(r[2]) !== specBar.from || Number(r[3]) !== specBar.to) barMismatch.push(i + 1 + " 时间列与 spec 不符");
  if (r[4] === "groove" && !specBar.role.startsWith("groove")) barMismatch.push(i + 1 + " 编制标签与 spec 不符");
});
eq("D29 逐小节四列读数与 Node 中位数逐格相同、时间/编制与 spec 相同", barMismatch.join(" | "), "");
const barTexts = STYLES.map((s) => (P[s].html.match(barRe) || []).map((x) => x[0]).join("\n"));
eq("D30 三页逐小节表内容相同（同一份事实，不是一页一个主题）", barTexts[0] === barTexts[1] && barTexts[1] === barTexts[2], true);
ok("D31 低频带起点在 40Hz（bin 宽 " + gt.binWidthHz + "Hz，带边界来自共享模块而不是随手写）",
  bandEdges()[0] >= 40 && bandEdges()[0] < 100);
/* 乐谱真值 ↔ Node 解析真值：两个独立来源必须对上，否则「起拍」只是检测器自说自话 */
const unmatched = facts.kickTimes.filter((k) => !gt.onsetTimes.some((o) => Math.abs(o - k) <= 0.08));
ok("D32 每个底鼓 ±80ms 内都能找到起拍（" + (facts.kickTimes.length - unmatched.length) + "/" + facts.kickTimes.length + "）",
  unmatched.length <= facts.kickTimes.length * 0.1, "未匹配 " + unmatched.join(","));
const breakFrom = facts.breakdownBar * 2, breakTo = (facts.breakdownBar + 1) * 2;
const riser = spec.events.find((e) => e.kind === "riser");
const riserEnd = riser.t + riser.sec;         /* 小节长度由事件自己的 sec 字段给，不写死 2 */
eq("D33 breakdown 小节内、上升噪声收尾之前起拍数为 0（该段无打击乐，检测器不是恒真）",
  gt.onsetTimes.filter((t) => t >= breakFrom && t < riserEnd - 0.1).length, 0);
ok("D34 上升噪声扫到顶时检测器必须响应（否则它只对瞬态敏感，读数偏窄）",
  gt.onsetTimes.some((t) => Math.abs(t - riserEnd) <= 0.15), "riser " + riser.t + "→" + riserEnd.toFixed(2));
ok("D35 breakdown 小节里高频读数仍在（噪声铺底没被误判为全静）",
  gt.perBar[facts.breakdownBar].treble.median > 0.02, gt.perBar[facts.breakdownBar].treble.median.toFixed(3));
eq("D36 groove 各小节的低频读数都高于铺底小节（能量排序与编制一致）",
  facts.grooveBars.every((b) => gt.perBar[b].bass.median > gt.perBar[0].bass.median), true);
/* D37：导语里「第 NN 小节是 breakdown」是被变异 X1 逼出来的——指错小节时数据、代码、结构全都不动 */
const brkLabel = "第 " + String(facts.breakdownBar + 1).padStart(2, "0") + " 小节是 breakdown";
const wrongLabels = [...P.colonnade.html.matchAll(/第 (\d\d) 小节是 breakdown/g)].map((m) => "第 " + m[1] + " 小节");
STYLES.forEach((s) => {
  const hits = [...P[s].html.matchAll(/第 (\d\d) 小节是 breakdown/g)].map((m) => m[1]);
  eq("D37 " + s + " 导语里的 breakdown 小节号与事实同源（应为 " + (facts.breakdownBar + 1) + "，出现 " + (hits.join("/") || "无") + "）",
    hits.length, 1);
  ok("D37b " + s + " 该句逐字来自 spec 的 breakdownBar（" + brkLabel + "）", P[s].html.includes(brkLabel), wrongLabels.join(","));
});

/* ================= E · 台账契约（幂等式，不是「我记得」） ================= */
const snap = JSON.parse(read("scripts/ledger-snapshot.json"));
const state = JSON.parse(fs.readFileSync(path.join(LAB, "state", "state.json"), "utf8"));
const logText = fs.readFileSync(path.join(LAB, "records", "work-log.md"), "utf8");
function grow(name, prevArr, curArr, added) {
  const lost = prevArr.filter((x) => !curArr.includes(x));
  eq(name + " 历史条目一条不少", lost.length, 0);
  /* 「= 快照 + 本轮新增」这个等式假设了这一轮是唯一的写入者，并发轮次下不成立
   * （本轮 --apply 之后 00:20 轮又追加了自己的条目）。等式改成下界：本轮新增必须在、
   * 历史不能少，多出来的条目属于别的轮次，不做归属断言。 */
  ok(name + " ≥ 快照 + 本轮新增（并发轮次只会上界更宽，实测 " + curArr.length + " ≥ " + (prevArr.length + added.length) + "）",
    curArr.length >= prevArr.length + added.length);
  const extra = added.filter((x) => !curArr.includes(x));
  eq(name + " 新增项确实写进了台账", extra.length, 0);
}
/* tried 在 state.json 里是对象数组，快照里存的是 update-ledger 用的那把键（skill || scenario）；
 * 两边口径必须一致，否则 includes 永远对不上，「历史一条不少」会假红、「新增确实写入」会假绿。 */
const triedKeys = (arr) => arr.map((t) => (typeof t === "string" ? t : t.skill + " || " + t.scenario));
grow("E1 tried", snap.prev.tried, triedKeys(state.tried), snap.add.tried);
grow("E2 used_styles", snap.prev.used_styles, state.used_styles, snap.add.used_styles);
grow("E3 environment_notes", snap.prev.environment_notes, state.environment_notes, snap.add.environment_notes);
ok("E4 runs ≥ 快照 + 1（本轮那一条在内；并发轮次各自追加，实测 " + state.runs.length + " ≥ " + (snap.prev.runs + 1) + "）",
  state.runs.length >= snap.prev.runs + 1);
/* E5 原口径是「本轮目录名必须在 work-log 末行」——这个假设在并发轮次下不成立：
 * 本轮 --apply 之后，另一个 00:20 轮又追加了它自己的一行，末行就不再是本轮的了。
 * 改成不依赖「谁是最后一行」的写法：本轮行必须出现且只出现一次，并且排在快照记下的
 * 上一轮行之后（这同时守住「只追加、不改历史」）。runs 末条同样按目录名查，不按位置。 */
const logLinesAll = logText.trimEnd().split("\n");
const myIdx = logLinesAll.findIndex((l) => l.includes(snap.round_dir));
const prevIdx = logLinesAll.findIndex((l) => l.includes(snap.prev_log_marker));
ok("E5 本轮目录名在 work-log 中出现一次且晚于快照记下的上一轮行（" + (myIdx + 1) + " > " + (prevIdx + 1) + "）",
  /* runs 末条是对象，直接 .includes 会在「work-log 那半已经为真」时抛 TypeError——
   * 也就是说这条判据只在通过的边缘上炸，入账前红着反而看不出来，所以先序列化再比。 */
  myIdx >= 0 && prevIdx >= 0 && myIdx > prevIdx &&
    logLinesAll.filter((l) => l.includes(snap.round_dir)).length === 1 &&
    JSON.stringify(state.runs.find((r) => JSON.stringify(r).includes(snap.round_dir)) || {}).includes(snap.round_dir),
  snap.round_dir);
ok("E6 work-log 历史行只追加：上一轮的关键行仍在",
  logText.includes(snap.prev_log_marker));
/* 原来写成 snap.prev.tried.includes(snap.combo_key)：prev.tried 是「skill || 场景」的键，
 * combo_key 是裸场景串，includes 恒为 false——这条判据是永真的假绿。改成两边同口径。 */
const newScenario = String(snap.add.tried[0]).split(" || ")[1] || "";
eq("E7 场景 × 技能组合此前未试过（快照的去重结论为「新」，且新增场景串不出现在任何历史键里）",
  snap.combo_key !== "DUPLICATE" && snap.prev.tried.every((k) => !k.includes(newScenario)), true);
ok("E8 本轮 3 个风格此前都不在台账里",
  snap.add.used_styles.every((x) => !snap.prev.used_styles.includes(x)), snap.add.used_styles.join("/"));

/* ================= F · 仓库与产物契约 ================= */
const skillSnap = path.join(LAB, "skills", "shader", "SKILL.md");
ok("F1 所用技能有只读快照在 LAB/skills/ 下", fs.existsSync(skillSnap));
const artFiles = fs.readdirSync(ROOT);
ok("F2 场景目录只有可直接打开的产物与校验脚本（无 node_modules/dist/.tmp）",
  !artFiles.some((f) => ["node_modules", "dist", ".tmp", ".package-lock.json"].includes(f)), artFiles.join(","));
ok("F3 preview/ 三页均可直接双击打开（.html 且体积>900KB）",
  fs.readdirSync(path.join(ROOT, "preview")).length === 3 && STYLES.every((s) => P[s].bytes > 900000));
const totalBytes = STYLES.reduce((a, s) => a + P[s].bytes, 0);
ok("F4 三页合计 " + (totalBytes / 1048576).toFixed(2) + "MB ≤ 50MB 限额", totalBytes < 50 * 1048576);
ok("F5 产物内联音频与 Node 真值是同一个字节序列（同一份 PCM 两个解析器）",
  crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "audio/track.wav"))).digest("hex") === sizes.wavSha256);

/* 按判据名前缀（A/B/C/D/E/F）分组计数：报告与台账里「某一组多少条」必须由这里给，不许手打 */
function groupTally(names) {
  const t = {};
  names.forEach((n) => { const g = /^([A-Z])\d/.exec(n); const k = g ? g[1] : "?"; t[k] = (t[k] || 0) + 1; });
  return t;
}
const nodeEvidence = {
  generated_by: "scripts/check-node.mjs",
  pass: pass, fail: fail, total: pass + fail, failures: failures, groups: groupTally(seenNames)
};
fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "evidence", "check-node.json"), JSON.stringify(nodeEvidence, null, 1));

console.log("\n== check-node: " + pass + " passed, " + fail + " failed, total " + (pass + fail) + " ==");
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
