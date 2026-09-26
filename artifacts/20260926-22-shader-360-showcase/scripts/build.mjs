/* 构建三套单文件展台页：唯一的变体区是 <style> 与 frag 的 SHADE 段，其余逐字节共用。
 * 用法：node scripts/build.mjs [--out DIR] [--mutate ID]  （--mutate 只作为 mutate.mjs 的入口说明，实际变异由 mutate.mjs 直接改产物文本）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC = path.join(ROOT, "src");
const read = (p) => fs.readFileSync(p, "utf8");
const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");

const outArg = process.argv.indexOf("--out");
const OUT = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.join(ROOT, "preview");

const facts = JSON.parse(read(path.join(SRC, "product.json")));
const labels = JSON.parse(read(path.join(SRC, "labels.json")));
const bodyHtml = read(path.join(SRC, "body.html"));
const head = read(path.join(SRC, "shaders", "head.glsl"));
const geometry = read(path.join(SRC, "shaders", "geometry.glsl"));
const mainGlsl = read(path.join(SRC, "shaders", "main.glsl"));
const vert = read(path.join(SRC, "shaders", "vert.glsl"));
const host = read(path.join(SRC, "host.js"));

const CAM = facts.camera;
CAM.fovTan = +Math.tan((CAM.fovDeg * Math.PI) / 180 / 2).toFixed(6);
facts.build = {
  geometrySha1: sha1(geometry).slice(0, 12),
  headSha1: sha1(head).slice(0, 12),
  mainSha1: sha1(mainGlsl).slice(0, 12),
  hostSha1: sha1(host).slice(0, 12),
  id: "20260926-22",
};

/* :root 令牌 → vec3：色板只有一份，CSS 与 GLSL 各自解析同一个变量名 */
function rootTokens(css) {
  const block = css.match(/:root\s*\{([^}]*)\}/);
  if (!block) throw new Error("CSS 缺 :root 块");
  const map = new Map();
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}
function hexToVec3(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return `vec3(${v.map((x) => x.toFixed(6)).join(", ")})`;
}

const report = { built: [], tokens: [], errors: [] };
for (const style of facts.styles) {
  const cssPath = path.join(SRC, "skins", style.id + ".css");
  const css = read(cssPath);
  const tokens = rootTokens(css);
  const shadeSrc = read(path.join(SRC, "shaders", "shade-" + style.id + ".glsl"));
  const used = [];
  const shade = shadeSrc.replace(/\{\{col:(--[a-z0-9-]+)\}\}/g, (_, name) => {
    const val = tokens.get(name);
    if (!val) throw new Error(`${style.id}: 令牌 ${name} 不在 :root 里`);
    if (!/^#[0-9a-f]{3,6}$/i.test(val)) throw new Error(`${style.id}: 令牌 ${name} 不是十六进制色（${val}）`);
    used.push({ token: name, hex: val, vec3: hexToVec3(val) });
    return hexToVec3(val);
  });
  const frag = head + "\n" + geometry + "\n" + shade + "\n" + mainGlsl;
  const factsJson = JSON.stringify(facts).replace(/</g, "\\u003c");
  const labelsJson = JSON.stringify(labels).replace(/</g, "\\u003c");
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${facts.product.brand} ${facts.product.model} · ${facts.product.name} 360° 展台 · ${style.name}</title>
<!--@STYLE:BEGIN-->
<style>
${css.trim()}
</style>
<!--@STYLE:END-->
</head>
<body data-skin="${style.id}">
${bodyHtml.trim()}
<script id="facts" type="application/json">${factsJson}</script>
<script id="labels" type="application/json">${labelsJson}</script>
<!--@VERT:BEGIN-->
<script id="vert" type="x-shader/x-vertex">${vert.trim()}</script>
<!--@VERT:END-->
<!--@FRAG:BEGIN-->
<script id="frag" type="x-shader/x-fragment">
${frag.trim()}
</script>
<!--@FRAG:END-->
<!--@HOST:BEGIN-->
<script>
${host.trim()}
</script>
<!--@HOST:END-->
</body>
</html>
`;
  const file = path.join(OUT, `showcase-${style.id}.html`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, html);
  report.built.push({ style: style.id, file: path.relative(ROOT, file), bytes: Buffer.byteLength(html), fragBytes: Buffer.byteLength(frag), shadeBytes: Buffer.byteLength(shade), cssBytes: Buffer.byteLength(css), geometrySha1: sha1(geometry), fragSha1: sha1(frag) });
  report.tokens.push({ style: style.id, used });
}
fs.writeFileSync(path.join(ROOT, "evidence", "build-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ out: path.relative(ROOT, OUT), built: report.built.map((b) => ({ style: b.style, bytes: b.bytes, fragSha1: b.fragSha1.slice(0, 8) })), geometrySha1: facts.build.geometrySha1, tokensResolved: report.tokens.reduce((a, t) => a + t.used.length, 0) }));
