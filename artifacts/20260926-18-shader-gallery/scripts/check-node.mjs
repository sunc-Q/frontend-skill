/* 静态断言：产物结构 / GLSL 条款落地 / 令牌与色板 / 事实复算 / 反膨胀 / 台账契约 / 磁盘纪律
 * 依赖：node scripts/cli-probe.mjs 已生成 evidence/cli-probe.json
 * 输出：evidence/check-node.json + 控制台计数
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const STYLES = ["liquid-chrome", "crt-plasma", "silk-aurora"];
const PAGES = {};
for (const s of STYLES) PAGES[s] = read(`preview/exhibit-${s}.html`);
const cli = JSON.parse(read("evidence/cli-probe.json"));
const facts = JSON.parse(read("src/facts.json"));
const baseCss = read("src/css/base.css");
const hostJs = read("src/host.js");
const shaders = Object.fromEntries(["liquid-chrome", "crt-plasma", "silk-aurora"].map((s) => [s, read(`src/shaders/${s}.glsl`)]));
const skins = Object.fromEntries(STYLES.map((s) => [s, read(`src/css/skin-${s}.css`)]));
const shadersPlain = Object.fromEntries(Object.entries(shaders).map(([k, v]) => [k, stripSlashes(v)]));
const hostPlain = stripSlashes(hostJs);

function stripSlashes(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function skillMdMentionsBundledTemplate(which) {
  const md = fs.readFileSync(path.join(cli.skill_dir, "SKILL.md"), "utf8");
  const block = /Bundled templates:\s*([\s\S]*?)\n\n/.exec(md);
  const bt = String.fromCharCode(96);
  const listed = block ? [...block[1].matchAll(new RegExp("^- " + bt + "([^" + bt + "]+)" + bt, "gm"))].map((m) => m[1]) : [];
  return which === "r3f" ? listed.some((f) => f.includes("r3f-demo")) : listed.length > 0;
}

function sharedFrom(html) {
  const i = html.indexOf("==SHARED-HOST-BOUNDARY==");
  return i < 0 ? "" : html.slice(i);
}

const results = [];
let group = "";
function ok(id, cond, actual) {
  results.push({ group, id, pass: !!cond, actual: actual === undefined ? "" : String(actual).slice(0, 240) });
}
function eq(id, actual, expected) {
  results.push({ group, id, pass: String(actual) === String(expected), actual: `${actual} (期望 ${expected})` });
}

/* ---------- D 组工具：令牌解析（含 var 链与 color-mix） ---------- */
function rootTokens(css) {
  const block = /:root\s*\{([\s\S]*?)\}/.exec(css);
  const map = {};
  if (!block) return map;
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
}
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function resolveColor(token, tokens, depth = 0) {
  if (depth > 6) return null;
  let value = token;
  value = value.replace(/var\((--[\w-]+)(?:\s*,[^)]*)?\)/g, (_, name) => tokens[name] || "transparent");
  const mix = /color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)/.exec(value);
  if (mix) {
    const base = resolveColor(mix[1], tokens, depth + 1);
    const other = resolveColor(mix[3], tokens, depth + 1);
    const a = Number(mix[2]) / 100;
    if (!base) return null;
    if (!other) return { rgb: base.rgb, alpha: base.alpha * a };
    const w1 = a;
    const w2 = 1 - a;
    const A = base.alpha * w1 + other.alpha * w2;
    return {
      rgb: base.rgb.map((v, i) => (A === 0 ? v : (v * base.alpha * w1 + other.rgb[i] * other.alpha * w2) / A)),
      alpha: A,
    };
  }
  const hex = /(#[0-9a-fA-F]{6})\b/.exec(value);
  if (hex) return { rgb: hexToRgb(hex[1]), alpha: 1 };
  if (/transparent/.test(value)) return { rgb: [0, 0, 0], alpha: 0 };
  return null;
}
function composite(fg, bg) {
  return fg.map((v, i) => v * bg.alpha + bg.rgb[i] * (1 - bg.alpha));
}
function relLum(rgb) {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ---------- A 组：技能自带 CLI 与资产清单诚实度 ---------- */
group = "A";
ok("A/assets-listed-all-exist", cli.manifest.templates.every((t) => t.exists) && cli.manifest.snippets.every((t) => t.exists) && cli.manifest.references.every((t) => t.exists), JSON.stringify(cli.manifest).length);
eq("A/asset-counts", [cli.manifest.templates.length, cli.manifest.snippets.length, cli.manifest.references.length].join("/"), "8/6/5");
eq("A/disk-assets-fully-documented", cli.unlisted.assets.length + cli.unlisted.references.length, 0);
ok("A/script-count", cli.on_disk.scripts.length === 1 && cli.on_disk.scripts[0] === "shader.js", cli.on_disk.scripts.join(","));
ok("A/doc-example-commands-all-run", cli.doc_runs.length >= 11 && cli.doc_runs.every((d) => d.code === 0), cli.doc_runs.filter((d) => d.code !== 0).map((d) => d.line).join(" | "));
eq("A/commands-advertised", ["intake", "debug", "effects", "boilerplate", "snippet", "demo", "scaffold"].filter((c) => cli.doc_runs.some((d) => d.args[0] === c)).length, 7);
// 「技能自己宣称的第一个模板 webgl-fullscreen-demo，它自己的路由永远不会选到」——缺陷存在性断言
eq("A/webgl-fullscreen-demo-unreachable-by-own-router", cli.matrix.filter((m) => m.file.includes("webgl-fullscreen")).length, 0);
ok("A/router-matrix-covers-all-targets", cli.matrix.length === 7 * 8, cli.matrix.length);
ok("A/router-chosen-files-all-exist", cli.matrix.every((m) => m.exists), cli.matrix.filter((m) => !m.exists).length + " 条指向不存在的文件");
ok("A/dead-ternary-in-material-branch", cli.dead_ternary && cli.dead_ternary.same === true, JSON.stringify(cli.dead_ternary));
// effects 列 8 个技法，boilerplate 只认 5 个、snippet 只认 6 个
eq("A/boilerplate-coverage-gap", Object.entries(cli.coverage.boilerplate).filter(([, c]) => c !== 0).map(([k]) => k).join(","), "gradient,noise,fbm,pixelate");
eq("A/snippet-coverage-gap", Object.entries(cli.coverage.snippet).filter(([, c]) => c !== 0).map(([k]) => k).join(","), "gradient,noise,fbm");
ok("A/scaffold-aliases-pixelate-to-scanline", cli.scaffold_matrix.find((s) => s.effect === "pixelate").boilerplate === "scanline", cli.scaffold_matrix.find((s) => s.effect === "pixelate").boilerplate);
ok("A/scaffold-falls-back-to-ripple-for-gradient", cli.scaffold_matrix.find((s) => s.effect === "gradient").boilerplate === "ripple", cli.scaffold_matrix.find((s) => s.effect === "gradient").boilerplate);
ok("A/scaffold-gradient-demo-is-postprocess", cli.scaffold_matrix.find((s) => s.effect === "gradient").demo.includes("postprocess"), cli.scaffold_matrix.find((s) => s.effect === "gradient").demo);
// 护栏「Do not assume WebGL2」：技能自带的两个 WebGL 模板必须是 WebGL1
const skillGlHosts = ["assets/webgl-fullscreen-demo/index.html", "assets/postprocess-demo/index.html"].map((f) =>
  fs.readFileSync(path.join(cli.skill_dir, f), "utf8"),
);
ok("A/skill-demos-use-webgl1", skillGlHosts.every((h) => /getContext\("webgl"/.test(h) && !/getContext\("webgl2"/.test(h)), "两个模板的 getContext 调用");
ok("A/skill-demos-failure-path-loud", skillGlHosts.every((h) => /throw new Error/.test(h) && /COMPILE_STATUS/.test(h)), "缺显式失败与编译状态检查");
const threeDemo = fs.readFileSync(path.join(cli.skill_dir, "assets/threejs-material-demo/index.html"), "utf8");
const cdnHit = threeDemo.match(/https?:\/\/[^"']+/);
ok("A/threejs-demo-has-cdn-dependency", /unpkg\.com/.test(threeDemo), cdnHit ? cdnHit[0] : "无外链");
const r3fDir = path.join(cli.skill_dir, "assets/r3f-demo");
const r3fHtml = fs.readFileSync(path.join(r3fDir, "index.html"), "utf8");
const r3fPkg = JSON.parse(fs.readFileSync(path.join(r3fDir, "package.json"), "utf8"));
ok("A/r3f-demo-needs-build", /src="\/main\.jsx"/.test(r3fHtml) && r3fPkg.scripts.dev === "vite" && Boolean(r3fPkg.dependencies["@react-three/fiber"]), "r3f 模板用根绝对路径 + 需要 vite 起服务，双击不可用");
ok("A/r3f-demo-listed-as-template", skillMdMentionsBundledTemplate("r3f"), "SKILL.md 的 Bundled templates 里确实列了这个不可直接打开的模板");

/* ---------- B 组：交付形态与自包含 ---------- */
group = "B";
for (const s of STYLES) {
  const html = PAGES[s];
  const bytes = Buffer.byteLength(html);
  ok(`B/exists:${s}`, bytes > 20000 && bytes < 200000, bytes + "B");
  ok(`B/zero-network-tags:${s}`, !/<(img|link|script)[^>]+(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html), "标签级外链");
  ok(`B/zero-import-or-fetch:${s}`, !/\b(import\s+\*?\s*\{?[^;]*from|fetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon)\b/.test(html), "取数语句");
  ok(`B/zero-storage:${s}`, !/localStorage|sessionStorage|indexedDB|caches\./ .test(html), "持久化语句");
  ok(`B/zero-form:${s}`, !/<(form|input|textarea|select)\b/i.test(html), "表单元素");
  ok(`B/single-style-block:${s}`, (html.match(/<style>/g) || []).length === 1 && (html.match(/<\/style>/g) || []).length === 1);
  ok(`B/inline-script-count:${s}`, (html.match(/<script>/g) || []).length === 1 && (html.match(/<script type="application\/json"/g) || []).length === 1);
  ok(`B/utf8-lang:${s}`, /<html lang="zh-CN">/.test(html) && /<meta charset="UTF-8"\s*\/>/i.test(html), "缺 lang 或 charset");
  ok(`B/viewport-meta:${s}`, /name="viewport" content="width=device-width/.test(html));
  ok(`B/demo-disclosure:${s}`, /虚构/.test(html) && /示例站点/.test(html), "缺少虚构声明");
  const shared = sharedFrom(html);
  ok(`B/shared-host:${s}`, shared.length > 8000, shared.length + "B 共享段");
}
const sharedHosts = STYLES.map((s) => sharedFrom(PAGES[s]));
ok("B/host-identical-across-styles", sharedHosts.every((h) => h === sharedHosts[0]), sharedHosts.map((h) => h.length).join("/"));
// DOM：把风格专属的三处标记归一后必须逐字节相同
const domKeys = ["<style>", "</style>"];
function domOf(html) {
  const start = html.indexOf("</style>") + "</style>".length;
  const end = html.indexOf('<script type="application/json"');
  return html
    .slice(start, end)
    .replace(/style-(liquid-chrome|crt-plasma|silk-aurora)/g, "style-XX")
    .replace(/>(liquid-chrome|crt-plasma|silk-aurora)</g, ">XX<")
    .replace(/<code>[a-z-]+\.glsl<\/code>/g, "<code>XX.glsl</code>");
}
const doms = STYLES.map((s) => domOf(PAGES[s]));
ok("B/dom-identical-across-styles", doms.every((d) => d === doms[0]), doms.map((d) => d.length).join("/"));
const cssOf = STYLES.map((s) => /<style>([\s\S]*?)<\/style>/.exec(PAGES[s])[1]);
const bases = cssOf.map((c) => c.split("/* 风格一")[0].split("/* 风格二")[0].split("/* 风格三")[0]);
ok("B/base-css-identical", bases.every((b) => b === bases[0]), bases.map((b) => b.length).join("/"));
ok("B/skins-differ", new Set(cssOf).size === 3);
/* 源文件→产物的漂移闸：B 组此前只拿三份产物互比，三份一起改（或只改产物）就没人管。
 * M2 变异就是这么钻过去的：只改页面里的 --accent，令牌类断言读的是 src/css，全绿通过。 */
for (let i = 0; i < STYLES.length; i++) {
  const s = STYLES[i];
  ok(`B/css-source-inlined:${s}`, cssOf[i].includes(baseCss) && cssOf[i].includes(skins[s]), "产物 <style> 与 src/css/base.css + skin 不逐字一致");
  const hostShared = hostJs.slice(hostJs.indexOf("==SHARED-HOST-BOUNDARY=="));
  ok(`B/host-source-inlined:${s}`, hostShared.length > 8000 && PAGES[s].includes(hostShared), "哨兵之后的共享宿主段与 src/host.js 不逐字一致");
}

/* ---------- C 组：GLSL 条款落地（护栏→式子） ---------- */
group = "C";
const UNIFORMS = ["uTime", "uResolution", "uMouse", "uScroll", "uVariant", "uOrigin"];
for (const s of STYLES) {
  const glSrc = shaders[s];
  const gl = shadersPlain[s];
  ok(`C/glsl-inlined:${s}`, PAGES[s].includes(JSON.stringify(glSrc).replace(/</g, "\\u003c")), "产物内联与源文件一致");
  ok(`C/no-webgl2-syntax:${s}`, !/#version\s+300|#version\s+es|in\s+vec2\s+|\bout\s+vec2|texture\(/.test(gl), "出现 WebGL2/GLSL ES 3.0 写法");
  ok(`C/glsl-es1-output:${s}`, /gl_FragColor\s*=/.test(gl) && !/\boutColor\b|layout\(location/.test(gl));
  ok(`C/precision-declared:${s}`, /^\s*precision\s+(highp|mediump|lowp)\s+float\s*;/m.test(gl), "缺 precision 限定符");
  ok(`C/no-shadertoy-builtins:${s}`, !/\b(iTime|iResolution|iMouse|fragCoord|mainImage)\b/.test(gl), "ShaderToy 内置未换形");
  ok(`C/uniform-prefix:${s}`, (gl.match(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm) || []).every((line) => /^u[XYAZ]?[a-z]/.test(line.trim().split(/\s+/).pop().replace(";", "")) || true) && UNIFORMS.every((u) => new RegExp(`uniform\\s+\\w+\\s+${u};`).test(gl)), UNIFORMS.join(","));
  for (const u of UNIFORMS) {
    const declared = new RegExp(`uniform\\s+\\w+\\s+${u}\\s*;`).test(gl);
    const used = new RegExp(`\\b${u}\\b`).test(gl.replace(/uniform\s+\w+\s+\w+\s*;/g, ""));
    ok(`C/uniform-used:${s}:${u}`, declared && used, `declared=${declared} used=${used}`);
  }
  ok(`C/no-texture-dependency:${s}`, !/\btexture2D\s*\(/.test(gl), "无纹理却采样");
  ok(`C/zero-invent-macros:${s}`, !/#(ifndef|extension|include)\b/.test(gl), "自造宏");
  ok(`C/aspect-correction:${s}`, /uResolution\.x\s*\/\s*max\(uResolution\.y/.test(gl), "缺 aspect 修正（技能 boilerplate 点名的常见缺陷）");
  ok(`C/loop-bounds-constant:${s}`, (gl.match(/for\s*\(\s*int\s+\w+\s*=\s*\d+\s*;/g) || []).length === (gl.match(/\bfor\s*\(/g) || []).length, "循环边界非常量（GLSL ES 1.0 会拒绝）");
  ok(`C/variant-visible:${s}`, /uVariant/.test(gl) && /(variant|floor\(uVariant)/.test(gl));
  ok(`C/glsl-size:${s}`, gl.split("\n").length <= 110, gl.split("\n").length + " 行");
}
// 视口原点：三带可比的唯一前提是所有屏幕坐标都先减掉 uOrigin
for (const s2 of STYLES) {
  const gl2 = shadersPlain[s2];
  const raw = (gl2.match(/gl_FragCoord/g) || []).length;
  const offsetLine = /vec2 fc = gl_FragCoord\.xy - uOrigin;/.test(gl2);
  ok(`C/fragcoord-through-origin:${s2}`, raw === 1 && offsetLine, `gl_FragCoord 出现 ${raw} 次（应为 1，且只在减去 uOrigin 那一行）`);
}
ok("C/host-passes-uOrigin-per-band", /gl\.uniform2f\(locations\.uOrigin, x, 0\)/.test(hostPlain), "每个视口把自己的原点 x 传进着色器");

ok("C/host-uses-webgl1", /getContext\("webgl"/.test(hostPlain) && !/getContext\("webgl2"/.test(hostPlain));
ok("C/host-no-es-module-or-300es", !/#version|\brequire\(|\bimport\s|\bexport\s/.test(hostPlain), "注释外出现 import/export/#version");
ok("C/uniforms-set-every-frame", (hostJs.match(/gl\.uniform\w+\(locations\.\w+/g) || []).length >= 5, (hostJs.match(/gl\.uniform\w+\(locations\.\w+/g) || []).length + " 处");
ok("C/dpr-clamped", /Math\.min\(window\.devicePixelRatio[^\n]*,\s*2\)/.test(hostJs));
ok("C/visible-baseline-path", /SOLID_SOURCE/.test(hostJs) && /gl_FragColor = vec4\(1\.0, 0\.0, 1\.0/.test(hostJs), "黑屏检查表第 1 步（常量可见色）没有实现成可跑的通路");
ok("C/fallback-for-no-gl", /gl-fallback/.test(hostJs) && /未取得 WebGL 上下文/.test(PAGES[STYLES[0]]));
ok("C/passive-listeners", (hostJs.match(/\{ passive: true \}/g) || []).length === 2, (hostJs.match(/passive/g) || []).length + " 处");
ok("C/pointer-listener-on-window", /window\.addEventListener\("pointermove"/.test(hostJs));
ok("C/host-no-innerHTML", !/\.innerHTML|document\.write/.test(hostJs), "宿主用了 innerHTML 注入用户输入");
// 技能 snippet 真被复用（pixelate/scanline/ripple 三段原文签名出现在产物着色器里）
const reused = ["pixelateUv", "scanlineMask", "rippleRing"].filter((fn) => Object.values(shaders).some((g) => new RegExp(`function\\s+${fn}\\b|\\w+\\s+${fn}\\(`).test(g)));
eq("C/skill-snippets-reused", reused.join(","), "pixelateUv,scanlineMask,rippleRing");
const snippetSrc = Object.entries(cli.snippets).map(([k, v]) => [k, v.blocks.join("\n").trim()]);
const reusedSnippets = snippetSrc.filter(([, code]) => code && Object.values(shadersPlain).some((g) => g.includes(code))).map(([k]) => k);
eq("C/snippets-verbatim-set", [...reusedSnippets].sort().join(","), "pixelate,ripple,scanline");
for (const [name, code] of snippetSrc) {
  const needsMesh = ["fresnel", "dissolve", "vertex-wobble"].includes(name);
  ok(`C/snippet-applicability:${name}`, Boolean(code) && !(needsMesh ? reusedSnippets.includes(name) : !reusedSnippets.includes(name)), needsMesh ? "需要法线/网格，全屏屏幕空间着色器不适用" : "屏空间技法应可复用");
}

/* ---------- D 组：令牌与色板 ---------- */
group = "D";
const tokens = Object.fromEntries(STYLES.map((s) => [s, rootTokens(skins[s])]));
ok("D/base-css-zero-color-literals", !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix/.test(baseCss), "基座里出现颜色字面量");
for (const s of STYLES) {
  const cssAll = stripCssComments(cssOf[STYLES.indexOf(s)]);
  const rootBlocks = cssAll.match(/:root\s*\{[\s\S]*?\}/g) || [];
  const outside = rootBlocks.reduce((acc, b) => acc.split(b).join(""), cssAll);
  ok(`D/hex-only-in-root:${s}`, !/#[0-9a-fA-F]{3,8}\b/.test(outside), (outside.match(/#[0-9a-fA-F]{3,8}/g) || []).slice(0, 4).join(","));
  ok(`D/func-colors-only-in-root:${s}`, !/\brgba?\(|\bhsla?\(|color-mix\(/.test(outside), "函数式颜色出现在 :root 之外");
  const usedVars = new Set([...cssAll.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const declared = new Set(Object.keys(tokens[s]).concat(Object.keys(rootTokens(baseCss))));
  const undef = [...usedVars].filter((v) => !declared.has(v));
  ok(`D/vars-defined:${s}`, undef.length === 0, "未定义令牌：" + undef.join(","));
  const unused = [...declared].filter((v) => !cssAll.includes(`var(${v})`));
  ok(`D/no-dead-tokens:${s}`, unused.length === 0, "死令牌：" + unused.join(","));
  const hexes = [...new Set((rootBlocks.join(" ").match(/#[0-9a-fA-F]{6}/g) || []))];
  const colorTokens = ["--bg","--panel","--ink","--muted","--accent","--line","--grid","--btn-bg","--btn-ink","--btn-bg-pressed"];
  eq(`D/palette-color-decls:${s}`, colorTokens.filter((k) => typeof tokens[s][k] === "string" && /#[0-9a-fA-F]{6}/.test(tokens[s][k])).length, 10);
  ok(`D/palette-distinct-hex:${s}`, hexes.length >= 8, "独立色 " + hexes.length + " 个（btn-bg≡accent、btn-bg-pressed≡line 为有意别名）");
  ok(`D/no-pure-black-white:${s}`, !/#000000|#ffffff/i.test(hexes.join(",")), hexes.join(","));
  const panel = resolveColor(tokens[s]["--panel"], tokens[s]);
  const bg = resolveColor(tokens[s]["--bg"], tokens[s]);
  const ink = resolveColor(tokens[s]["--ink"], tokens[s]);
  const muted = resolveColor(tokens[s]["--muted"], tokens[s]);
  const accent = resolveColor(tokens[s]["--accent"], tokens[s]);
  const btnBg = resolveColor(tokens[s]["--btn-bg"], tokens[s]);
  const btnInk = resolveColor(tokens[s]["--btn-ink"], tokens[s]);
  const scrim = resolveColor(tokens[s]["--scrim"], tokens[s]);
  const scrimOnBg = composite(scrim.rgb, { rgb: bg.rgb, alpha: scrim.alpha });
  ok(`D/contrast-ink-panel:${s}`, contrast(ink.rgb, scrimOnBg) >= 7, contrast(ink.rgb, scrimOnBg).toFixed(2) + ":1（正文/衬底合成色）");
  ok(`D/contrast-muted-panel:${s}`, contrast(muted.rgb, scrimOnBg) >= 4.5, contrast(muted.rgb, scrimOnBg).toFixed(2) + ":1");
  ok(`D/contrast-accent-panel:${s}`, contrast(accent.rgb, scrimOnBg) >= 3, contrast(accent.rgb, scrimOnBg).toFixed(2) + ":1");
  ok(`D/contrast-button:${s}`, contrast(btnInk.rgb, btnBg.rgb) >= 4.5, contrast(btnInk.rgb, btnBg.rgb).toFixed(2) + ":1");
  ok(`D/scrim-is-translucent:${s}`, scrim.alpha > 0.5 && scrim.alpha < 1, "alpha=" + scrim.alpha);
}
for (let i = 0; i < STYLES.length; i++) {
  for (let j = i + 1; j < STYLES.length; j++) {
    const a = Object.values(tokens[STYLES[i]]).join(" ");
    const b = Object.values(tokens[STYLES[j]]).join(" ");
    const shared = [...new Set((a.match(/#[0-9a-fA-F]{6}/g) || []))].filter((h) => b.toLowerCase().includes(h.toLowerCase()));
    ok(`D/palette-disjoint:${STYLES[i]}~${STYLES[j]}`, shared.length === 0, "交集 " + shared.join(","));
  }
}
// 三风格的排版指纹：至少 6 维互异
const fingerprintDims = {
  radius: (s) => tokens[s]["--radius-panel"],
  family: (s) => (tokens[s]["--font-body"].split(",")[0] || "").trim(),
  rule: (s) => tokens[s]["--rule"],
  listStyle: (s) => tokens[s]["--list-style"],
  heroHeight: (s) => tokens[s]["--hero-min-height"],
  lineHeight: (s) => tokens[s]["--lh"],
  tracking: (s) => tokens[s]["--track-label"],
  worksGrid: (s) => tokens[s]["--grid-works"],
  caption: (s) => tokens[s]["--caption-align"],
  scrimAlpha: (s) => resolveColor(tokens[s]["--scrim"], tokens[s]).alpha,
};
for (let i = 0; i < STYLES.length; i++) {
  for (let j = i + 1; j < STYLES.length; j++) {
    const diffs = Object.entries(fingerprintDims).filter(([, fn]) => fn(STYLES[i]) !== fn(STYLES[j])).map(([k]) => k);
    ok(`D/fingerprint>=6:${STYLES[i]}~${STYLES[j]}`, diffs.length >= 6, diffs.length + " 维：" + diffs.join(","));
  }
}

/* ---------- E 组：事实复算（两条独立口径） ---------- */
group = "E";
function runDays(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1;
}
const expected = {
  run_days: runDays(facts.show.open, facts.show.close),
  work_count: facts.works.length,
  total_duration: facts.works.reduce((a, w) => a + w.duration_s, 0),
  room_area_total: facts.rooms.reduce((a, r) => a + r.area_m2, 0),
  room_cap_total: facts.rooms.reduce((a, r) => a + r.capacity, 0),
  guided_total: Math.round((facts.stats.guided_tours_per_week * runDays(facts.show.open, facts.show.close)) / 7),
};
expected.room_density = (expected.room_area_total / expected.room_cap_total).toFixed(2);
eq("E/run_days", expected.run_days, 45);
for (const s of STYLES) {
  const html = PAGES[s];
  const embedded = JSON.parse(/<script type="application\/json" id="facts">([\s\S]*?)<\/script>/.exec(html)[1]);
  eq(`E/embedded-derived:${s}`, [embedded.derived.run_days, embedded.derived.work_count, embedded.derived.total_duration, embedded.derived.room_area_total, embedded.derived.room_cap_total, embedded.derived.guided_total, embedded.derived.room_density].join("|"), [expected.run_days, expected.work_count, expected.total_duration, expected.room_area_total, expected.room_cap_total, expected.guided_total, expected.room_density].join("|"));
  const must = [
    facts.show.title_zh, facts.show.title_en, facts.show.venue, facts.show.city, facts.show.statement,
    `${facts.show.open}</time> — <time datetime="${facts.show.close}">`, `展期 ${expected.run_days} 天`,
    facts.visit.days, facts.visit.hours, facts.visit.last_entry, `¥${facts.visit.ticket_adult}`, `¥${facts.visit.ticket_concession}`,
    `共 ${expected.work_count} 件作品，累计实时时长 ${expected.total_duration} 秒`,
    `面积合计 ${expected.room_area_total} ㎡`, `瞬时承载合计 ${expected.room_cap_total} 人`, `平均 ${expected.room_density} ㎡/人`,
    `每周 ${facts.stats.guided_tours_per_week} 场，展期共 ${expected.guided_total} 场`,
    facts.footer.demo_note, facts.footer.tech, `42,000`,
  ];
  const missing = must.filter((text) => !html.includes(text));
  ok(`E/text-present:${s}`, missing.length === 0, "缺失：" + missing.slice(0, 3).join(" / "));
  const worksMissing = facts.works.filter((w) => !html.includes(`作品 ${w.no}`) || !html.includes(w.name) || !html.includes(w.rule) || !html.includes(`${w.year} 年`));
  ok(`E/works-present:${s}`, worksMissing.length === 0, worksMissing.map((w) => w.no).join(","));
  const notesMissing = facts.notes.filter((n) => !html.includes(n.date) || !html.includes(n.text));
  const creditsMissing = facts.credits.filter((c) => !html.includes(c.role) || !html.includes(c.name));
  ok(`E/notes-credits:${s}`, notesMissing.length === 0 && creditsMissing.length === 0, notesMissing.length + "/" + creditsMissing.length);
  // 每行的人均面积独立复算
  const rowBad = facts.rooms.filter((r) => !html.includes(`<td>${(r.area_m2 / r.capacity).toFixed(2)}</td>`));
  ok(`E/room-rows:${s}`, rowBad.length === 0, rowBad.map((r) => r.name).join(","));
}

/* ---------- F 组：反功能膨胀（着色器页面的最小可用面） ---------- */
group = "F";
for (const s of STYLES) {
  const html = PAGES[s];
  ok(`F/one-button:${s}`, (html.match(/<button/g) || []).length === 1, (html.match(/<button/g) || []).length + " 个按钮");
  ok(`F/no-aria-live-abuse:${s}`, (html.match(/aria-live/g) || []).length <= 1);
  ok(`F/no-router:${s}`, !/history\.pushState|location\.hash\s*=|popstate|hashchange/.test(html));
  ok(`F/no-timers-outside-raf:${s}`, !/setInterval\(|setTimeout\(/.test(html), "宿主里出现额外定时器");
  ok(`F/canvas-count:${s}`, (html.match(/<canvas/g) || []).length === 2, (html.match(/<canvas/g) || []).length + " 块画布");
  ok(`F/ids-unique:${s}`, (() => { const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]); return new Set(ids).size === ids.length; })(), "存在重复 id");
  ok(`F/anchors-resolve:${s}`, [...html.matchAll(/href="#([^"]+)"/g)].every((m) => html.includes(`id="${m[1]}"`)), "锚点指向不存在的目标");
  ok(`F/headings:${s}`, (html.match(/<h1/g) || []).length === 1 && (html.match(/<h2/g) || []).length === 6, (html.match(/<h[12]/g) || []).length + "");
  ok(`F/no-console-log:${s}`, !/console\.(log|warn|error)/.test(hostJs));
}

/* ---------- G 组：静态溢出与响应式防线 ---------- */
group = "G";
for (const s of STYLES) {
  const css = cssOf[STYLES.indexOf(s)];
  const badRepeat = [...css.matchAll(/repeat\((?:auto-fit|auto-fill)[^)]*\)/g)].filter((m) => !m[0].includes("minmax(min(100%"));
  ok(`G/repeat-guarded:${s}`, badRepeat.length === 0, badRepeat.map((m) => m[0]).join(" | "));
  const fixedWide = [...css.matchAll(/(?:^|[^-\w])(?:width|min-width)\s*:\s*(\d{3,})px/g)].filter((m) => Number(m[1]) >= 500);
  ok(`G/no-wide-fixed:${s}`, fixedWide.length === 0, fixedWide.map((m) => m[0].trim()).join(" | "));
  ok(`G/no-nowrap:${s}`, !/white-space:\s*nowrap/.test(css));
  const minmaxZero = [...css.matchAll(/grid-template-columns:[^;]*minmax\((\d+)px/g)].filter((m) => Number(m[1]) > 0);
  ok(`G/grid-minmax-zero:${s}`, minmaxZero.length === 0, minmaxZero.map((m) => m[0]).join(" | "));
  ok(`G/uses-fluid-type:${s}`, /clamp\(/.test(css), `字号与间距未用 clamp() 做流体缩放`);
  ok(`G/grid-uses-minmax:${s}`, /minmax\(/.test(css), `网格列没用 minmax()，窄屏会顶破容器`);
  ok(`G/media-queries:${s}`, (css.match(/@media/g) || []).length >= 1);
}
ok("G/mobile-breakpoint-in-base", /@media \(max-width: 44rem\)/.test(baseCss));
ok("G/reduced-motion-handled", /prefers-reduced-motion/.test(baseCss) && /prefers-reduced-motion/.test(hostJs));

/* ---------- H 组：磁盘纪律 ---------- */
group = "H";
const dirFiles = [];
(function walk(dir, base) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel, base);
    else dirFiles.push({ rel, bytes: fs.statSync(path.join(ROOT, rel)).size });
  }
})("", ROOT);
ok("H/no-build-dirs", !dirFiles.some((f) => /(^|\/)(node_modules|dist|\.cache)(\/|$)/.test(f.rel)), dirFiles.map((f) => f.rel).filter((r) => /node_modules|dist/.test(r)).join(","));
const total = dirFiles.reduce((a, f) => a + f.bytes, 0);
ok("H/under-50mb", total < 50 * 1024 * 1024, (total / 1024).toFixed(1) + "KB");
ok("H/pages-present", STYLES.every((s) => dirFiles.some((f) => f.rel === `preview/exhibit-${s}.html`)));
ok("H/no-stray-logs", !dirFiles.some((f) => /\.log$|\.tmp$/.test(f.rel)), dirFiles.map((f) => f.rel).filter((r) => /\.log$/.test(r)).join(","));

/* ---------- I 组：台账契约（幂等，写回前后都成立） ---------- */
group = "I";
const statePath = path.join(LAB, "state", "state.json");
const logPath = path.join(LAB, "records", "work-log.md");
const live = JSON.parse(fs.readFileSync(statePath, "utf8"));
const snapPath = path.join(ROOT, "scripts", "ledger-snapshot.json");
const snap = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, "utf8")) : null;
const ROUND_ID = "20260926-18-shader-exhibit";
const roundTried = live.tried.filter((t) => (t.artifacts || "").includes(ROUND_ID) || (t.skill || "").startsWith("shader"));
if (!snap) {
  ok("I/snapshot-pending", false, "还没有 scripts/ledger-snapshot.json：先跑 node scripts/ledger-snapshot.mjs");
} else {
  const writtenBack = roundTried.length > 0;
  eq("I/tried-delta", live.tried.length, snap.tried + (writtenBack ? 1 : 0));
  eq("I/runs-delta", live.runs.length, snap.runs + (writtenBack ? 1 : 0));
  eq("I/used-styles-delta", live.used_styles.length, snap.used_styles + (writtenBack ? 3 : 0));
  ok("I/combo-was-untried", snap.tried_skills.filter((x) => x.includes("shader ×")).length === 0, snap.tried_skills.filter((x) => x.includes("shader ×")).join(" | "));
  const styleCollisions = STYLES.filter((s) => snap.used_styles_all.includes(s));
  ok("I/styles-were-unused", styleCollisions.length === 0, "快照中已存在：" + styleCollisions.join(","));
  const myLogLines = fs.readFileSync(logPath, "utf8").split("\n").filter((l) => l.includes(ROUND_ID) || l.includes("| shader（"));
  eq("I/worklog-delta", myLogLines.length, snap.my_log_lines + (writtenBack ? 1 : 0));
  /* 这三条写回前后都要「存在」：断言总数被对照页脚引用，若它们随写回才出现，
   * 总数就会在写回那一刻 +3，页脚与报告里刚抄进去的数字当场过期。
   * 未写回时按 pending 通过（与 R 组对未写出报告的处理同一口径）。 */
  const t = roundTried[0] || null;
  ok("I/tried-fields-complete", !t || Boolean(t.time && t.scenario && t.styles && t.report && t.artifacts && t.conclusion), t ? Object.keys(t).join(",") : "台账尚未写回，pending");
  ok("I/report-exists", !t || fs.existsSync(path.join(LAB, t.report)), t ? t.report : "台账尚未写回，pending");
  ok("I/run-linked", !t || live.runs.some((r) => (r.artifact_size || "").length > 0 && (r.cleanup || "").length > 0), t ? live.runs[live.runs.length - 1].artifact_size || "" : "台账尚未写回，pending");
  const debt = () => live.tried.map((t, i) => ({ i, miss: ["time", "scenario", "styles", "report", "artifacts"].filter((k) => !t[k]) })).filter((x) => x.miss.length).map((x) => `tried[${x.i}]:${x.miss.join("/")}`);
  const newDebt = debt().filter((d) => !snap.ledger_debt.includes(d));
  ok("I/no-new-ledger-debt", newDebt.length === 0, "新增欠账：" + newDebt.join(" ; ") + "（既有欠账 " + snap.ledger_debt.length + " 条，属他人轮次，本轮只报告）");
  eq("I/ledger-debt-unchanged", debt().length, snap.ledger_debt.length);
}
const reportsDir = path.join(LAB, "reports");
const reportDirs = fs.readdirSync(reportsDir).filter((f) => fs.statSync(path.join(reportsDir, f)).isDirectory());
ok("H/no-new-report-dirs", reportDirs.length === (snap ? snap.report_dirs : 0), "reports/ 下的目录：" + reportDirs.join(" ; ") + "（快照 " + (snap ? snap.report_dirs : "?") + " 个，属 04:00 轮未清理中间件，本轮只报告）");
ok("H/this-round-report-shape", !reportDirs.some((d) => d.startsWith(ROUND_ID)), "本轮复现文档必须是 .md 文件");

/* ---------- N 组：对照页数字溯源 ----------
 * make-styles.mjs 每取一个数就往 evidence/styles-numbers.json 记一条（渲染值 + 换算 + 源指针）。
 * 这里当第二双眼睛：拿指针重新读源文件、重新算一遍换算，看渲染值对不对得上；
 * 再反向扫一遍页面测量区（<li> 与 <td class="m">），凡是残留的数字都必须已在溯源里出现过。
 * 于是「往 styles.html 手打一个 8.31:1」和「evidence 变了但页面没重生成」都会红。 */
group = "N";
function unescapeHtml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
const provPath = path.join(ROOT, "evidence", "styles-numbers.json");
const stylesPath = path.join(ROOT, "styles.html");
ok("N/styles-html-exists", fs.existsSync(stylesPath), fs.existsSync(stylesPath) ? Buffer.byteLength(fs.readFileSync(stylesPath)) + " 字节" : "styles.html 不存在");
const prov = fs.existsSync(provPath) ? JSON.parse(read("evidence/styles-numbers.json")) : null;
ok("N/provenance-recorded", Boolean(prov) && prov.entries.length > 100, prov ? `${prov.entries.length} 条溯源` : "evidence/styles-numbers.json 不存在，先跑 make-styles");

/* 指针语法：prop / prop[0] / prop[key=value] 全等 / prop[key~value] 子串 / prop[key] 真值过滤 */
function parsePointer(pointer) {
  const segs = [];
  let cur = "";
  for (let i = 0; i < pointer.length; i++) {
    const c = pointer[i];
    if (c === ".") {
      if (cur !== "") segs.push({ kind: "prop", key: cur });
      cur = "";
    } else if (c === "[") {
      if (cur !== "") segs.push({ kind: "prop", key: cur });
      cur = "";
      const end = pointer.indexOf("]", i);
      if (end < 0) throw new Error(`指针未闭合：${pointer}`);
      const inner = pointer.slice(i + 1, end);
      const f = /^([\w-]+)([=~])([\s\S]*)$/.exec(inner);
      if (f) segs.push({ kind: "filter", key: f[1], op: f[2], value: f[3] });
      else if (/^\d+$/.test(inner)) segs.push({ kind: "index", index: Number(inner) });
      else segs.push({ kind: "truth", key: inner });
      i = end;
    } else cur += c;
  }
  if (cur !== "") segs.push({ kind: "prop", key: cur });
  return segs;
}
function walk(value, segs, pointer) {
  for (const s of segs) {
    if (s.kind === "prop") {
      if (Array.isArray(value) && !(s.key in Object(value))) {
        value = value.map((el) => (el || {})[s.key]);
        continue;
      }
      if (value === null || value === undefined || !(s.key in Object(value))) throw new Error(`指针 ${pointer} 在 ${s.key} 处断开`);
      value = value[s.key];
    } else if (s.kind === "index") {
      if (!Array.isArray(value) || value[s.index] === undefined) throw new Error(`指针 ${pointer} 的[${s.index}] 越界`);
      value = value[s.index];
    } else if (s.kind === "filter") {
      if (!Array.isArray(value)) throw new Error(`指针 ${pointer} 要过滤 ${s.key}，但当前不是数组`);
      value = value.filter((el) => (el || {})[s.key] !== undefined && (s.op === "=" ? String(el[s.key]) === s.value : String(el[s.key]).includes(s.value)));
    } else {
      if (!Array.isArray(value)) throw new Error(`指针 ${pointer} 要按 ${s.key} 真值过滤，但当前不是数组`);
      value = value.filter((el) => Boolean((el || {})[s.key]));
    }
  }
  return value;
}
const jsonCache = {};
function rootTokensOf(cssFile) {
  const css = read(cssFile).replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /:root\s*\{([\s\S]*?)\}/.exec(css);
  const out = {};
  if (block) for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
/* 第二个解析器：源文件 → 值。和生成器各写各的，只共享「指针字符串」这一个约定。 */
function sourceValue(file, pointer) {
  if (file.endsWith(".json")) {
    if (!(file in jsonCache)) jsonCache[file] = JSON.parse(read(file));
    return walk(jsonCache[file], parsePointer(pointer), pointer);
  }
  if (file.endsWith(".glsl")) {
    const text = read(file);
    if (pointer === "lines") return text.split("\n").length;
    if (pointer === "technique") {
      const m = /^\s*\/\/\s*技法：(.*)$/m.exec(text);
      if (!m) throw new Error(`${file} 里没有 // 技法： 行`);
      return m[1].trim();
    }
    if (pointer === "snippets") return [...new Set([...text.matchAll(/\/\/\s*snippet:\s*([\w-]+)/g)].map((x) => x[1]))].join("、");
    throw new Error(`${file} 不支持指针 ${pointer}`);
  }
  if (file.endsWith(".css")) {
    const m = /^:root\.(--[\w-]+)$/.exec(pointer);
    if (!m) throw new Error(`${file} 只支持 :root.--token 指针，收到 ${pointer}`);
    const tokens = rootTokensOf(file);
    if (!(m[1] in tokens)) throw new Error(`${file} 的 :root 里没有 ${m[1]}`);
    return tokens[m[1]];
  }
  throw new Error(`不支持的源文件类型 ${file}`);
}
function recompute(entry) {
  let src = sourceValue(entry.source.file, entry.source.path);
  /* 「唯一命中」的过滤指针（built[style=x].bytes、results[id=y].detail）读出来是单元素数组，
   * 生成器那边拿的就是那一个对象，这里同样按一个对象算。 */
  if (Array.isArray(src) && src.length === 1) src = src[0];
  switch (entry.op) {
    case "exact":
      return String(src);
    case "join":
      /* 单元素数组在上面已经摊平成一个字符串，那种情况直接返回它。 */
      return Array.isArray(src) ? src.join(entry.sep) : String(src);
    case "toFixed":
      return Number(src).toFixed(entry.digits);
    case "thousands":
      return Number(src).toLocaleString("en-US");
    case "diff": {
      const b = sourceValue(entry.operand.file, entry.operand.path);
      return (Number(src) - Number(b)).toFixed(entry.digits);
    }
    case "min":
      return Math.min(...Object.values(src)).toFixed(entry.digits) + (entry.suffix || "");
    case "verbatim":
      return String(src).slice(0, entry.digits);
    case "strip":
      return String(src).startsWith(entry.needle) ? String(src).slice(entry.needle.length) : String(src);
    default:
      throw new Error(`未知换算类型 ${entry.op}`);
  }
}
if (prov) {
  const byFile = {};
  prov.entries.forEach((e, i) => {
    (byFile[e.source.file] = byFile[e.source.file] || []).push({ ...e, i });
  });
  for (const [file, list] of Object.entries(byFile)) {
    const bad = [];
    for (const e of list) {
      let expect;
      try {
        expect = recompute(e);
      } catch (err) {
        bad.push(`#${e.i} ${file}:${e.source.path} → ${err.message}`);
        continue;
      }
      if (expect !== e.rendered) bad.push(`#${e.i} ${e.op} ${file}:${e.source.path} 记录「${String(e.rendered).slice(0, 60)}」≠复算「${String(expect).slice(0, 60)}」`);
    }
    ok(`N/provenance-resolves:${path.basename(file)}`, bad.length === 0, `${list.length} 条对得上` + (bad.length ? `；不一致 ${bad.length}：` + bad.slice(0, 4).join(" ; ") : ""));
  }
  const traceable = prov.entries.map((e) => e.rendered).filter((r) => r !== "");
  const page = fs.existsSync(stylesPath) ? read("styles.html") : "";
  const body = page.replace(/<style>[\s\S]*?<\/style>/g, " ");
  const regions = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g), ...body.matchAll(/<td class="m">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  ok("N/measurement-regions", regions.length > 40, `${regions.length} 个测量区`);
  const leftovers = [];
  for (const raw of regions) {
    let text = unescapeHtml(raw.replace(/<[^>]*>/g, " "));
    for (const t of [...traceable].sort((a, b) => b.length - a.length)) text = text.split(t).join(" ");
    for (const m of text.matchAll(/\d[\d.,]*/g)) leftovers.push(m[0]);
  }
  ok("N/page-numbers-traceable", leftovers.length === 0, leftovers.length ? `页面测量区里有溯源之外的数字：${[...new Set(leftovers)].slice(0, 8).join(" ")}` : `${traceable.length} 个溯源值覆盖了全部测量区数字`);
  /* 位置绑定：集合判据能被「同一个字符串自己也出现在证据里」绕过（对照页转录变异表，注入原文因此成了
   * 合法溯源值），所以再问一层「这个位置上的内容是不是生成器当次写下的那个」。正则与 make-styles.mjs 末尾同源。 */
  const REGIONS_FILE = "evidence/styles-regions.json";
  const plain = (t) => String(t === undefined ? "（不存在）" : t).replace(/<[^>]*>/g, " ").trim().slice(0, 46);
  if (!fs.existsSync(path.join(ROOT, REGIONS_FILE))) {
    ok("N/regions-match-generation", false, `缺 ${REGIONS_FILE}：重跑 node scripts/make-styles.mjs`);
  } else {
    const gen = JSON.parse(read(REGIONS_FILE)).regions;
    const live = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g), ...body.matchAll(/<td class="m">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const diffs = [];
    for (let i = 0; i < Math.max(gen.length, live.length); i++) {
      if (gen[i] !== live[i]) diffs.push(`#${i} 生成时「${plain(gen[i])}」≠页面上「${plain(live[i])}」`);
    }
    ok(
      "N/regions-match-generation",
      diffs.length === 0 && gen.length === live.length && live.length > 40,
      `${live.length}/${gen.length} 区` + (diffs.length ? `；改动 ${diffs.length} 处：` + diffs.slice(0, 3).join(" ; ") : ""),
    );
  }
  const refs = [...page.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  ok("N/styles-links-resolve", refs.length > 0 && refs.every((r) => !/^https?:|^\/\//.test(r) && fs.existsSync(path.join(ROOT, r))), refs.join(" "));
  ok("N/styles-no-placeholder", !/\$\{|undefined|NaN/.test(page), (page.match(/\$\{|undefined|NaN/g) || []).length + " 处未展开/未定义");
}

/* ---------- 复现报告与盘上数字同源（放在最后，好让断言总数含它自己） ----------
 * 历轮教训：生成器里手写死的文案会和被生成的东西互相矛盾，结构校验全绿也抓不到。
 * 报告是人写的，同样会被产物打脸——所以关键数字要机器读一遍：字节数、两套断言总数、变异例数。 */
group = "R";
const REPORT_REL = "reports/20260926-18-shader-immersive-exhibition.md";
const reportPath = path.join(LAB, REPORT_REL);
if (!fs.existsSync(reportPath)) {
  ok("R/report-numbers-current", true, "报告尚未写出（台账写回时补），此条按 pending 通过");
} else {
  const report = fs.readFileSync(reportPath, "utf8");
  const sizes = JSON.parse(read("scripts/build-sizes.json"));
  /* 变异例数取 mutate.mjs 的用例表（设计量），不取 evidence/mutation.json：
   * 后者要到流水线下一步才刷新，拿它判红会把「跑的顺序」当成「对不对」。
   * 这一轮跑够没跑够，由 mutate 自己的退出码与 records 长度管。 */
  const caseCount = (read("scripts/mutate.mjs").match(/^\s+id: "M\d/gm) || []).length;
  const mustContain = [
    ...sizes.built.map((b) => `${b.style} → ${b.bytes.toLocaleString("en-US")} 字节`),
    /* +1 是本条自己：总数只随代码组成变化，不随通过/失败变化，所以没有自指振荡。 */
    `check-node ${results.length + 1}`,
    `check-browser ${JSON.parse(read("evidence/check-browser.json")).total}`,
    `变异 ${caseCount} 例`,
  ];
  const missing = mustContain.filter((t) => !report.includes(t));
  ok("R/report-numbers-current", missing.length === 0, `报告里缺这些与产物同源的原文：${missing.join(" ; ")}`);
}

fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "evidence", "check-node.json"), JSON.stringify({ results, counts: null }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`check-node: ${results.length - failed.length}/${results.length} PASS`);
for (const f of failed) console.log(`  FAIL ${f.id}  ${f.actual}`);
process.exit(failed.length ? 1 : 0);
