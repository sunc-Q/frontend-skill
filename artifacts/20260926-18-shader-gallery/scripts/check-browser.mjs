/* 真机浏览器断言：Chromium + SwiftShader 软件 GL，跑在双击即开的 file:// 产物上
 * 覆盖：着色器真编译真链接 / 真帧像素统计 / 动画存活（含 frozen 消融臂）/
 *       uMouse·uScroll·uVariant 三个 uniform 的响应与消融臂（先 setPaused 冻结时间，
 *       这样画面差异只可能来自 uniform 本身）/ solid·nogl·reduced·pause·DPR 分支 /
 *       文字压在活着色器上的最坏对比度（含 noscrim 消融臂）/ 技能自带 6 段 snippet 真编译真生效 /
 *       控制台零输出、零跨源请求、两档视口无溢出
 * 依赖：playwright-core（安装方式见复现报告；缺失时整组记 SKIP 并以 2 退出，不假装通过）
 * 输出：evidence/check-browser.json
 * 对比度公式两份：页面侧 CONTRAST_JS（真机合成）+ check-node.mjs 的 :root 令牌推算（名义值），互为对照
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");

const STYLES = ["liquid-chrome", "crt-plasma", "silk-aurora"];
const THEME = { "liquid-chrome": "dark", "crt-plasma": "dark", "silk-aurora": "light" };
const GL_ARGS = [
  "--no-sandbox",
  "--allow-file-access-from-files",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];
/* 页面侧要用的三个工具：注入进每个新文档，避免在 Node 与浏览器里各写一份口径。
 * __labColor 必须认得 Chrome 对 color-mix() 的计算值写法 "color(srgb r g b / a)"（分量是 0..1），
 * 只正则 rgba() 会把所有衬底读成「没有衬底」，从而把整组对比度断言判成假失败。
 * 必须用 String.raw：普通模板字面量会把 \s \[ \( 的反斜杠吃掉，注入到页面里的正则就废了，
 * 表现为 __labColor 对 rgb() 返回 null、整组对比度断言以 TypeError 收场。 */
const CONTRAST_JS = String.raw`window.__labColor = function (str) {
  if (!str) return null;
  var t = String(str).trim();
  if (t === "transparent" || t === "none") return { rgb: [0, 0, 0], alpha: 0 };
  var m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return { rgb: [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)], alpha: 1 };
  m = /^color\(\s*srgb\s+([^)]+)\)$/i.exec(t);
  if (m) {
    var cs = m[1].trim().split(/[\s\/]+/).map(parseFloat);
    return { rgb: cs.slice(0, 3).map(function (v) { return Math.round(v * 255); }), alpha: cs.length > 3 ? cs[3] : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (m) {
    var ps = m[1].trim().split(/[\s,\/]+/).map(parseFloat);
    return { rgb: ps.slice(0, 3), alpha: ps.length > 3 ? ps[3] : 1 };
  }
  return null;
};
window.__labContrast = function (a, b) {
  function lum(rgb) {
    var c = rgb.map(function (v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  var l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
/* 祖先链上的文字衬底。body/html 的背景会被浏览器提升到根画布、落在 z-index:-1 的着色器画布 *之下*，
 * 所以它们不进合成链——着色器实测像素才是这段文字真正的底。 */
window.__labLayers = function (node) {
  var out = [];
  var el = node;
  while (el && el !== document.body && el !== document.documentElement) {
    var c = window.__labColor(getComputedStyle(el).backgroundColor);
    if (c && c.alpha > 0) {
      out.push({ rgb: c.rgb, alpha: c.alpha });
      if (c.alpha >= 1) break;
    }
    el = el.parentElement;
  }
  return out;
};`;

const results = [];
let group = "J";
const metrics = {};
function ok(id, pass, detail) {
  results.push({ id: `${group}/${id}`, pass: Boolean(pass), detail: detail === undefined ? "" : String(detail) });
}
function eq(id, actual, expected) {
  results.push({ id: `${group}/${id}`, pass: actual === expected, detail: `${actual} (期望 ${expected})` });
}

function loadPw() {
  const candidates = [
    process.env.SHADER_PW_MODULES,
    path.join(LAB, ".tmp", "shaderbuild", "node_modules"),
    path.join(ROOT, "node_modules"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      const p = require.resolve("playwright-core", { paths: [dir] });
      return { mod: require(p), from: dir };
    } catch {
      /* 继续找下一个候选 */
    }
  }
  return null;
}

const pw = loadPw();
if (!pw) {
  console.log("check-browser: SKIP —— 找不到 playwright-core。安装：mkdir -p " + path.join(LAB, ".tmp/shaderbuild") +
    " && cd $_ && npm i --registry=https://registry.npmmirror.com playwright-core");
  process.exit(2);
}

const { chromium } = pw.mod;
const cli = JSON.parse(fs.readFileSync(path.join(ROOT, "evidence", "cli-probe.json"), "utf8"));
const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: GL_ARGS });

const pageUrl = (style, query = "") => url.pathToFileURL(path.join(ROOT, "preview", `exhibit-${style}.html`)).href + query;

async function open(style, { query = "", viewport = { width: 1280, height: 800 }, reducedMotion = "no-preference", deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, deviceScaleFactor });
  await context.addInitScript(CONTRAST_JS);
  const page = await context.newPage();
  const state = { msgs: [], requests: [] };
  page.on("console", (m) => state.msgs.push(`${m.type()}:${m.text()}`));
  page.on("pageerror", (e) => state.msgs.push("pageerror:" + e.message));
  page.on("requestfailed", (r) => state.requests.push("failed:" + r.url()));
  page.on("request", (r) => state.requests.push(r.url()));
  await page.goto(pageUrl(style, query), { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__shaderProbe && window.__shaderProbe.info), null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return { context, page, state };
}

const compact = (s) => (s ? { mean: +s.mean.toFixed(2), sigma: +s.sigma.toFixed(2), p05: +s.p05.toFixed(1), p995: +s.p995.toFixed(1), rgb: s.meanRgb.map((v) => +v.toFixed(1)) } : null);

/* 本文件有两份对比度公式：这份在 Node 里对页面回传的实测像素做合成，
 * 上面 CONTRAST_JS 那份注入页面、给页面内联实验用；两者与 check-node.mjs 的令牌推算互为对照。 */
function relLum(rgb) {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrastRatio(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function diffCount(a, b, tol = 3) {
  let n = 0;
  const m = Math.min(a.length, b.length);
  for (let i = 0; i < m; i++) if (Math.abs(a[i][0] - b[i][0]) > tol || Math.abs(a[i][1] - b[i][1]) > tol || Math.abs(a[i][2] - b[i][2]) > tol) n++;
  return n;
}

/* ---------- J 组：主臂渲染 ---------- */
for (const style of STYLES) {
  group = "J";
  const { context, page, state } = await open(style);
  metrics[style] = {};

  const info = await page.evaluate(() => {
    const p = window.__shaderProbe;
    return { style: p.style, probe: p.probe, glVersion: p.glVersion, info: p.info() };
  });
  ok(`pipeline:${style}`, info.info.fx.ok && info.info.strip.ok,
    "fx " + JSON.stringify({ c: info.info.fx.compiled, l: info.info.fx.linked, e: info.info.fx.glError }) +
    " / strip " + JSON.stringify({ c: info.info.strip.compiled, l: info.info.strip.linked, e: info.info.strip.glError }));
  ok(`uniform-locations:${style}`, info.info.fx.nullLocations.length === 0 && info.info.strip.nullLocations.length === 0,
    "空 location：" + (info.info.fx.nullLocations.join(",") || "无") + " / " + (info.info.strip.nullLocations.join(",") || "无"));
  ok(`webgl1-only:${style}`, info.glVersion === "webgl1" && info.info.fx.buffer[0] > 0, info.glVersion + " 画布 " + info.info.fx.buffer.join("×"));
  ok(`console-clean:${style}`, state.msgs.length === 0, state.msgs.slice(0, 4).join(" | "));
  ok(`requests-local:${style}`, state.requests.every((u) => u.startsWith("file://")), state.requests.filter((u) => !u.startsWith("file://")).slice(0, 3).join(",") || `${state.requests.length} 个请求全为 file://`);

  const dead = await page.evaluate(() => {
    const css = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules).map((r) => r.cssText || "")).join("\n");
    const names = [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))].filter((c) => !/^probe-/.test(c));
    const runtime = ["reduced-hint"]; // 由宿主在减动效分支动态插入，主臂 DOM 里本就没有
    return names.filter((c) => !runtime.includes(c)).filter((c) => { try { return !document.querySelector("." + CSS.escape(c)); } catch { return false; } });
  });
  ok(`no-dead-selectors:${style}`, dead.length === 0, "有规则、无元素的选择器：" + dead.join(","));

  const before = await page.evaluate(() => ({ f: window.__shaderProbe.frames(), t: window.__shaderProbe.time() }));
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({ f: window.__shaderProbe.frames(), t: window.__shaderProbe.time(), ms: window.__shaderProbe.frameMs() }));
  ok(`animates:${style}`, after.f > before.f && after.t > before.t, `帧 ${before.f}→${after.f}，uTime ${before.t.toFixed(3)}→${after.t.toFixed(3)}；软件 GL 下 ${Math.round((after.f - before.f) / 0.9)} fps / 每帧 ${after.ms.toFixed(1)}ms，宿主把 dt 钳在 0.05s，所以慢机器上是慢动作而非掉帧（性能不作结论）`);
  metrics[style].softFps = +(((after.f - before.f) / 0.9).toFixed(1));
  metrics[style].frameMs = +after.ms.toFixed(1);

  /* 三带对照要在冻结的 uTime 下取：stats() 每次都重绘，不钳时间的话「带间差异」
   * 里会混进动画推进的量，判据就分不清是 uVariant 还是 uTime 造成的。 */
  const sampled = await page.evaluate(() => {
    const p = window.__shaderProbe;
    p.setPaused(true);
    const out = { fx: p.stats("fx", 0), bands: [0, 1, 2].map((i) => p.stats("strip", i)), t: p.time() };
    p.setPaused(false);
    return out;
  });
  const fx = compact(sampled.fx);
  const bands = sampled.bands.map((b) => (b ? b.mean : -1));
  metrics[style].fx = fx;
  metrics[style].bands = bands.map((m) => +m.toFixed(2));
  ok(`frame-has-signal:${style}`, fx && fx.p995 - fx.p05 >= 100 && fx.sigma >= 18, fx ? `整帧 p99.5-p0.5=${(fx.p995 - fx.p05).toFixed(1)}（阈 100）、σ=${fx.sigma.toFixed(1)}（阈 18）` : "readPixels 失败");
  ok(`theme-direction:${style}`, fx && (THEME[style] === "dark" ? fx.mean < 120 : fx.mean > 120), `${THEME[style]} 期望平均亮度 ${THEME[style] === "dark" ? "<120" : ">120"}，实测 ${fx && fx.mean.toFixed(1)}`);
  const spread = Math.max(...bands) - Math.min(...bands);
  const pairs = [[0, 1], [1, 2], [0, 2]];
  const bandDiff = sampled.bands.every(Boolean) ? pairs.map(([i, j]) => diffCount(sampled.bands[i].samples, sampled.bands[j].samples)) : [-1, -1, -1];
  const bandN = sampled.bands[0] ? sampled.bands[0].samples.length : 0;
  const minFrac = bandN ? Math.min(...bandDiff) / bandN : 0;
  metrics[style].bandPairDiff = bandDiff;
  /* 判据是逐像素改变比例，不是平均亮度极差：crt 的变体轴改的是栅格密度，总亮度基本不动，
   * 拿极差当门会把一个真的看得出差别的轴判成失败（和 mouse-uniform 同一个坑）。 */
  ok(`strip-variants-distinct:${style}`, minFrac > 0.25,
    `uTime 冻结在 ${sampled.t.toFixed(3)}，同一程序三种 uVariant 逐像素对照：${pairs.map(([i, j], k) => `${i}↔${j} 变 ${bandDiff[k]}`).join("、")}/${bandN} 个采样点（最小比例 ${(minFrac * 100).toFixed(1)}%，阈 25%）；三带平均亮度 ${bands.map((b) => b.toFixed(1)).join("/")}，极差仅 ${spread.toFixed(2)}——均值不敏感，故不作门`);
  ok(`strip-band-textured:${style}`, sampled.bands.every((b) => b && b.sigma > 8), "各带 σ=" + sampled.bands.map((b) => (b ? b.sigma.toFixed(1) : "null")).join("/"));

  /* uMouse / uScroll：先冻结时间，让差异只可能来自这两个 uniform */
  const resp = await page.evaluate(() => {
    const p = window.__shaderProbe;
    p.setPaused(true);
    const a = p.stats("fx", 0);
    return { mean: a.mean, samples: a.samples, mouse: p.mouse() };
  });
  await page.mouse.move(140, 120);
  await page.waitForTimeout(150);
  const afterMouse = await page.evaluate(() => { const t = window.__shaderProbe.stats("fx", 0); return { mean: t.mean, samples: t.samples, mouse: window.__shaderProbe.mouse() }; });
  const mouseDiff = diffCount(resp.samples, afterMouse.samples);
  ok(`mouse-uniform:${style}`, afterMouse.mouse.some((v, i) => Math.abs(v - resp.mouse[i]) > 0.01) && mouseDiff > afterMouse.samples.length * 0.1,
    `uMouse ${resp.mouse.map((v) => v.toFixed(3)).join(",")}→${afterMouse.mouse.map((v) => v.toFixed(3)).join(",")}；uTime 冻结下 ${mouseDiff}/${afterMouse.samples.length} 个采样像素改变（平均亮度只动 ${(afterMouse.mean - resp.mean).toFixed(3)}，可见均值不是好判据）`);
  await page.evaluate(() => window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.6)));
  await page.waitForTimeout(150);
  const afterScroll = await page.evaluate(() => { const t = window.__shaderProbe.stats("fx", 0); return { mean: t.mean, samples: t.samples, sc: window.__shaderProbe.scroll() }; });
  const scrollDiff = diffCount(afterMouse.samples, afterScroll.samples);
  ok(`scroll-uniform:${style}`, afterScroll.sc > 0.4 && scrollDiff > afterScroll.samples.length * 0.1,
    `uScroll=${afterScroll.sc.toFixed(3)}；同一 uTime 下 ${scrollDiff}/${afterScroll.samples.length} 个采样像素改变`);
  metrics[style].uniformResponse = { mousePixels: mouseDiff, scrollPixels: scrollDiff, sampled: afterMouse.samples.length };
  await page.evaluate(() => window.__shaderProbe.setPaused(false));

  /* L 组：文字压在活着色器上的最坏对比度 */
  group = "L";
  const probes = await page.evaluate(() => {
    const targets = [
      ["hero-title", ".hero-title", 3],
      ["hero-sub", ".hero-sub", 4.5],
      ["work-rule", ".work .rule", 4.5],
      ["facts-dt", ".facts dt", 4.5],
      ["rooms-td", ".rooms tbody td", 4.5],
      ["section-lead", ".section-lead", 4.5],
    ];
    window.scrollTo(0, 0);
    return targets.map(([name, sel, need]) => {
      const el = document.querySelector(sel);
      if (!el) return { name, missing: true };
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const p = window.__shaderProbe.rect("fx", r.left, r.top, Math.min(r.width, innerWidth - r.left), Math.min(r.height, innerHeight - r.top));
      const cvar = window.__labColor(getComputedStyle(el).color);
      return {
        name,
        need,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
        text: cvar ? cvar.rgb : null, rawColor: getComputedStyle(el).color,
        layers: window.__labLayers(el),
        pixels: p ? p.samples : null,
        pxCount: p ? p.points : 0,
      };
    });
  });
  for (const t of probes) {
    if (t.missing || !t.pixels || !t.pixels.length) { ok(`contrast-live:${style}:${t.name}`, false, "元素或像素缺失"); continue; }
    if (!t.text) { ok(`contrast-live:${style}:${t.name}`, false, "文字色解析失败：" + t.rawColor); continue; }
    let worst = Infinity;
    let worstBg = null;
    for (const px of t.pixels) {
      let bg = px.slice();
      for (const layer of t.layers) bg = bg.map((v, i) => layer.rgb[i] * layer.alpha + v * (1 - layer.alpha));
      const c = contrastRatio(t.text, bg);
      if (c < worst) { worst = c; worstBg = bg.map((v) => Math.round(v)); }
    }
    const floor = t.fontSize >= 24 ? 3 : t.need;
    ok(`contrast-live:${style}:${t.name}`, worst >= floor, `${worst.toFixed(2)}:1 ≥ ${floor}（最坏合成底 rgb ${worstBg && worstBg.join(",")}，实测 ${t.pxCount} 个像素，字号 ${t.fontSize}px，衬底 ${t.layers.length} 层）`);
    (metrics[style].contrast = metrics[style].contrast || {})[t.name] = +worst.toFixed(2);
  }
  group = "J";
  for (const [label, vw] of [["1280", 1280], ["390", 390]]) {
    await page.setViewportSize({ width: vw, height: 800 });
    await page.waitForTimeout(400);
    const ov = await page.evaluate(() => {
      const de = document.documentElement;
      const bad = [];
      document.querySelectorAll("main *, header *, nav *, footer *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1)) bad.push((el.tagName + "." + (el.className || "")).slice(0, 40) + "@" + Math.round(r.right));
      });
      return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, bad: bad.slice(0, 6) };
    });
    ok(`no-h-overflow:${style}:${label}`, ov.scrollWidth <= ov.clientWidth + 1 && ov.bad.length === 0, `${ov.scrollWidth}/${ov.clientWidth} ${ov.bad.join(" ")}`);
  }
  metrics[style].consoleMessages = state.msgs;
  metrics[style].requests = state.requests.length;
  await context.close();
}

/* ---------- K 组：消融臂（证明 J/L 组的断言真的有牙） ---------- */
group = "K";
{
  const { context, page } = await open("liquid-chrome", { query: "?probe=frozen" });
  const a = await page.evaluate(() => ({ f: window.__shaderProbe.frames(), t: window.__shaderProbe.time() }));
  await page.waitForTimeout(900);
  const b = await page.evaluate(() => ({ f: window.__shaderProbe.frames(), t: window.__shaderProbe.time() }));
  ok("frozen-holds-time", b.t === a.t && b.f > a.f, `uTime 恒为 ${a.t.toFixed(2)} 而帧计数仍 ${a.f}→${b.f}（说明 J 组靠的是 uTime 推进，不是 rAF 在跑）`);
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { query: "?probe=samevariant" });
  const arm = await page.evaluate(() => {
    const p = window.__shaderProbe;
    p.setPaused(true);
    const rows = [0, 1, 2].map((i) => p.stats("strip", i));
    p.setPaused(false);
    return rows;
  });
  const sameMeans = arm.map((r) => (r ? r.mean : -1));
  const sameDiff = Math.max(...[arm[0], arm[1], arm[2]].every(Boolean) ? [[0, 1], [1, 2], [0, 2]].map(([i, j]) => diffCount(arm[i].samples, arm[j].samples)) : [999]);
  ok("samevariant-flattens-strip", Math.max(...sameMeans) - Math.min(...sameMeans) <= 0.5 && sameDiff <= 2,
    `uVariant 恒 0 且三带几何已对齐后：平均亮度极差 ${(Math.max(...sameMeans) - Math.min(...sameMeans)).toFixed(3)}、逐像素最大改变 ${sameDiff}/${arm[0] ? arm[0].samples.length : 0} 点（J 组门是 25%）。这条是 J 组新判据的对照臂——它证明逐像素差异来自 uVariant，而不是带位置/边界。`);
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { query: "?probe=nomouse" });
  const a = await page.evaluate(() => { window.__shaderProbe.setPaused(true); return { m: window.__shaderProbe.mouse(), mean: window.__shaderProbe.stats("fx", 0).mean }; });
  await page.mouse.move(140, 120);
  await page.waitForTimeout(200);
  const b = await page.evaluate(() => ({ m: window.__shaderProbe.mouse(), mean: window.__shaderProbe.stats("fx", 0).mean }));
  ok("nomouse-arm", b.m[0] === a.m[0] && b.m[1] === a.m[1] && Math.abs(b.mean - a.mean) < 0.05, `指针移动后 uMouse 仍 ${b.m.map((v) => v.toFixed(3)).join(",")}，同时间戳画面 Δ=${(b.mean - a.mean).toFixed(4)}`);
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { query: "?probe=noscroll" });
  await page.evaluate(() => { window.__shaderProbe.setPaused(true); window.scrollTo(0, document.documentElement.scrollHeight); });
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => ({ sc: window.__shaderProbe.scroll(), top: window.scrollY }));
  ok("noscroll-arm", r.sc === 0 && r.top > 0, `页面真的滚了 ${r.top}px 而 uScroll 恒为 ${r.sc}`);
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { query: "?probe=solid" });
  const s = await page.evaluate(() => { const t = window.__shaderProbe.stats("fx", 0); return { mean: t.mean, sigma: t.sigma, rgb: t.meanRgb.map((v) => Math.round(v)), p995: t.p995, p05: t.p05 }; });
  ok("solid-baseline-flat", s.sigma < 2 && s.rgb[0] > 180 && s.rgb[1] < 90 && s.rgb[2] > 180, `常量品红：σ=${s.sigma.toFixed(2)}、平均 rgb=${s.rgb.join(",")}、极差 ${(s.p995 - s.p05).toFixed(1)}（黑屏检查表第 1 步：通路活着，J 组的暗帧不是全黑）`);
  await context.close();
}
{
  const { context, page, state } = await open("liquid-chrome", { query: "?probe=nogl" });
  const f = await page.evaluate(() => {
    const fb = document.getElementById("gl-fallback");
    const fx = document.getElementById("fx");
    return { shown: fb ? getComputedStyle(fb).display !== "none" : false, text: fb ? fb.textContent.trim().length : 0, fxHidden: fx ? getComputedStyle(fx).display === "none" : false };
  });
  ok("nogl-fallback", f.shown && f.fxHidden && f.text > 10, JSON.stringify(f));
  ok("nogl-no-error", !state.msgs.some((m) => m.startsWith("error:")), state.msgs.slice(0, 3).join(" | ") || "无 error 级输出");
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { reducedMotion: "reduce" });
  const a = await page.evaluate(() => ({ f: window.__shaderProbe.frames(), paused: window.__shaderProbe.paused(), hint: Boolean(document.querySelector(".reduced-hint") && document.getElementById("reduced-hint")), btnHidden: document.getElementById("motion-toggle").hidden }));
  await page.waitForTimeout(800);
  const b = await page.evaluate(() => { const s = window.__shaderProbe.stats("fx", 0); return { f: window.__shaderProbe.frames(), spread: s.p995 - s.p05, sigma: s.sigma }; });
  ok("reduced-single-frame", a.f === 1 && b.f === 1 && a.paused && a.hint && a.btnHidden, JSON.stringify({ ...a, framesAfterWait: b.f }));
  ok("reduced-still-renders", b.spread >= 100 && b.sigma >= 18, `停在第 12 秒的单帧仍有画面：极差 ${b.spread.toFixed(1)}、σ ${b.sigma.toFixed(1)}`);
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome");
  const t0 = await page.evaluate(() => ({ label: document.getElementById("motion-toggle").textContent, pressed: document.getElementById("motion-toggle").getAttribute("aria-pressed"), paused: window.__shaderProbe.paused() }));
  await page.click("#motion-toggle");
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => ({ label: document.getElementById("motion-toggle").textContent, pressed: document.getElementById("motion-toggle").getAttribute("aria-pressed"), paused: window.__shaderProbe.paused(), f: window.__shaderProbe.frames(), t: window.__shaderProbe.time() }));
  await page.waitForTimeout(700);
  const b = await page.evaluate(() => ({ f: window.__shaderProbe.frames(), t: window.__shaderProbe.time() }));
  ok("pause-freezes-time", t0.paused === false && a.paused === true && a.pressed === "true" && a.label !== t0.label && b.f > a.f && b.t === a.t,
    `按钮「${t0.label}/${t0.pressed}」→「${a.label}/${a.pressed}」；rAF 仍在画（帧号继续涨）但 uTime 锁在 ${a.t.toFixed(2)}`);
  await page.click("#motion-toggle");
  await page.waitForTimeout(600);
  const c = await page.evaluate(() => ({ paused: window.__shaderProbe.paused(), t: window.__shaderProbe.time() }));
  ok("resume-continues", c.paused === false && c.t > b.t, `再点一次恢复：uTime ${b.t.toFixed(2)}→${c.t.toFixed(2)}`);
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { query: "?probe=nopause" });
  const hidden = await page.evaluate(() => document.getElementById("motion-toggle").hidden);
  ok("nopause-arm", hidden === true, "消融开关隐藏了暂停按钮（主臂该按钮可见，故 K 组按钮断言不是恒真）");
  await context.close();
}
{
  const { context, page } = await open("liquid-chrome", { deviceScaleFactor: 3 });
  const d = await page.evaluate(() => { const i = window.__shaderProbe.info(); return { win: devicePixelRatio, dpr: i.fx.dpr, buffer: i.fx.buffer, css: i.fx.css }; });
  ok("dpr-clamped", d.win === 3 && d.dpr === 2 && Math.abs(d.buffer[0] - d.css[0] * 2) <= 2, `devicePixelRatio=${d.win} → 宿主取 ${d.dpr}，画布 ${d.buffer.join("×")} vs CSS ${d.css.join("×")}`);
  await context.close();
}
{
  const measure = async (query) => {
    const { context, page } = await open("liquid-chrome", { query });
    const out = await page.evaluate(() => {
      const el = document.querySelector(".hero-sub");
      const r = el.getBoundingClientRect();
      const text = window.__labColor(getComputedStyle(el).color).rgb;
      const p = window.__shaderProbe.rect("fx", r.left, r.top, r.width, r.height);
      const ls = window.__labLayers(el);
      let worst = Infinity;
      for (const px of p.samples) {
        let bg = px.slice();
        for (const layer of ls) bg = bg.map((v, i) => layer.rgb[i] * layer.alpha + v * (1 - layer.alpha));
        const c = window.__labContrast(text, bg);
        if (c < worst) worst = c;
      }
      return { worst, layers: ls.length, px: p.points };
    });
    await context.close();
    return out;
  };
  const withScrim = await measure("");
  const noScrim = await measure("?probe=noscrim");
  ok("scrim-works", withScrim.worst > noScrim.worst + 0.5 && withScrim.layers > 0 && noScrim.layers === 0,
    `同一段正文：有衬底 ${withScrim.worst.toFixed(2)}:1（${withScrim.layers} 层）vs 去掉衬底 ${noScrim.worst.toFixed(2)}:1（${noScrim.layers} 层）→ L 组的对比度确实是衬底给的`);
  metrics.scrimAblation = { withScrim: +withScrim.worst.toFixed(2), noScrim: +noScrim.worst.toFixed(2) };
}

/* ---------- M 组：技能自带 6 段 snippet 在真驱动里逐段编译、逐段生效 ---------- */
group = "M";
{
  const context = await browser.newContext({ viewport: { width: 320, height: 240 } });
  await context.addInitScript(CONTRAST_JS);
  const page = await context.newPage();
  await page.goto(pageUrl("liquid-chrome"), { waitUntil: "load" });
  const names = Object.keys(cli.snippets).sort();
  eq("snippets-discovered", names.join(","), "dissolve,fresnel,pixelate,ripple,scanline,vertex-wobble");
  const arms = {
    pixelate: { call: "vec2 t = pixelateUv(uv, vec2(8.0));", control: "vec2 t = uv;", out: "gl_FragColor = vec4(t, 0.0, 1.0);" },
    ripple: { call: "float t = rippleRing(uv, uTime);", control: "float t = 0.0;", out: "gl_FragColor = vec4(vec3(t), 1.0);" },
    scanline: { call: "float t = scanlineMask(gl_FragCoord.y, uTime, 12.0, 0.5);", control: "float t = 1.0;", out: "gl_FragColor = vec4(vec3(t), 1.0);" },
    fresnel: { call: "float t = fresnelTerm(normalize(vec3(uv - 0.5, -0.6)), normalize(vec3(0.0, 0.0, 1.0)), 2.0);", control: "float t = 0.0;", out: "gl_FragColor = vec4(vec3(t), 1.0);" },
    dissolve: { call: "float t = dissolveMask(uv.x, 0.5) + 0.5 * dissolveEdge(uv.y, 0.25, 0.2);", control: "float t = 0.0;", out: "gl_FragColor = vec4(vec3(t), 1.0);" },
    "vertex-wobble": { call: "vec3 t = vertexWobble(vec3(uv, 0.0), uTime, 0.3, 9.0);", control: "vec3 t = vec3(uv, 0.0);", out: "gl_FragColor = vec4(fract(t), 1.0);" },
  };
  const spec = Object.fromEntries(names.map((n) => [n, { code: cli.snippets[n].blocks.join("\n\n"), arm: arms[n] }]));
  const report = await page.evaluate((specIn) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const gl = canvas.getContext("webgl");
    if (!gl) return { noGl: true };
    const VS = "attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }";
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    function frag(code, term, out) {
      return ["precision highp float;", "uniform float uTime;", "uniform vec2 uResolution;", code,
        "void main() {", "  vec2 uv = gl_FragCoord.xy / uResolution;", term, out, "}"].join("\n");
    }
    function build(src) {
      const sh = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return { err: "compile: " + gl.getShaderInfoLog(sh) + " @ " + src.slice(0, 0) };
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, VS);
      gl.compileShader(vs);
      const pr = gl.createProgram();
      gl.attachShader(pr, vs);
      gl.attachShader(pr, sh);
      gl.bindAttribLocation(pr, 0, "position");
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { err: "link: " + gl.getProgramInfoLog(pr) };
      return { pr };
    }
    function shoot(pr) {
      gl.viewport(0, 0, 96, 96);
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(gl.getUniformLocation(pr, "uTime"), 3.7);
      gl.uniform2f(gl.getUniformLocation(pr, "uResolution"), 96, 96);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(96 * 96 * 4);
      gl.readPixels(0, 0, 96, 96, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { px, err: gl.getError() };
    }
    const out = {};
    for (const name of Object.keys(specIn)) {
      const { code, arm } = specIn[name];
      const A = build(frag(code, arm.call, arm.out));
      const B = build(frag(code, arm.control, arm.out));
      if (A.err || B.err) { out[name] = { error: (A.err || B.err).slice(0, 200) }; continue; }
      const pa = shoot(A.pr);
      const pb = shoot(B.pr);
      let diff = 0;
      for (let i = 0; i < pa.px.length; i += 4) {
        if (Math.abs(pa.px[i] - pb.px[i]) > 2 || Math.abs(pa.px[i + 1] - pb.px[i + 1]) > 2 || Math.abs(pa.px[i + 2] - pb.px[i + 2]) > 2) diff++;
      }
      out[name] = { diff, total: pa.px.length / 4, glError: pa.err, lit: pa.px.some((v, i) => i % 4 !== 3 && v > 8) };
      gl.deleteProgram(A.pr);
      gl.deleteProgram(B.pr);
    }
    return out;
  }, spec);
  ok("harness-webgl", !report.noGl, report.noGl ? "无 WebGL 上下文" : "在页面里另开 96×96 画布做隔离实验");
  for (const name of names) {
    const r = report[name] || {};
    ok(`snippet-compiles:${name}`, !r.error, r.error || "编译 + 链接均通过（真 ANGLE/SwiftShader 驱动，不是 Node 侧文本检查）");
    ok(`snippet-mutates-frame:${name}`, r.diff > 20 && r.glError === 0 && r.lit, `与「把该函数换成常量」的对照臂有 ${r.diff}/${r.total} 像素不同，glError=${r.glError}，有输出=${r.lit}`);
  }
  metrics.snippets = report;
  await context.close();
}

await browser.close();

const failures = results.filter((r) => !r.pass);
fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "evidence", "check-browser.json"), JSON.stringify({
  ran_at: new Date().toISOString(),
  chromium: chromium.executablePath(),
  playwright_from: pw.from,
  total: results.length,
  failed: failures.map((f) => f.id + " —— " + f.detail),
  metrics,
  results,
}, null, 2));
console.log(`check-browser: ${results.length - failures.length}/${results.length} PASS`);
for (const f of failures) console.log("  FAIL " + f.id + "  " + f.detail);
process.exit(failures.length ? 1 : 0);
