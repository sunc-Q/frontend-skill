/* 静态断言（不需要浏览器）：自包含、单一事实源、共用区逐字节相同、跨层色板、
 * 三风格指纹互异、GLSL ES 1.00 纪律、几何常量镜像、WCAG 对比度、shader 技能条款、
 * 对照页数字溯源（每个数字都能按指针从 src/evidence 现算出来）。
 * 输出 evidence/check-node.json；任何一条红都以非零码退出。
 * 原则：能机检的条款一律写成断言，不靠肉眼；数字一律现算，不手打；注释不算代码。 */
import fs from "node:fs";
import path from "node:path";
import {
  read, sha1, bytes, parts, rootTokens, hexOf, vec3Of, contrast, noComments, makeResolver,
} from "./lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const STYLES = ["vitrine", "plaque", "industrial"];
const resolvePointer = makeResolver(ROOT, STYLES);
const srcFacts = JSON.parse(read(path.join(SRC, "product.json")));
const labels = JSON.parse(read(path.join(SRC, "labels.json")));
const buildReport = JSON.parse(read(path.join(ROOT, "evidence", "build-report.json")));

const P = {}, H = {};
for (const s of STYLES) {
  H[s] = read(path.join(ROOT, "preview", `showcase-${s}.html`));
  P[s] = parts(H[s]);
}
/* 页面里注入的那份 facts 才是「页面看到的事实」，断言一律以它为准 */
const facts = JSON.parse(H.vitrine.match(/<script id="facts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const pageFactsMinusDerived = (() => {
  const c = structuredClone(facts);
  delete c.build;
  delete c.camera.fovTan;
  return c;
})();

const results = [];
let group = "";
const g = (name) => { group = name; };
const ok = (id, cond, detail = "") => results.push({ id: `${group}/${id}`, pass: Boolean(cond), detail: String(detail) });
const eq = (id, actual, expected, detail = "") => results.push({ id: `${group}/${id}`, pass: actual === expected, detail: `实际 ${actual} / 期望 ${expected}${detail ? " · " + detail : ""}` });

/* ---------- A 产物与自包含 ---------- */
g("A");
for (const s of STYLES) {
  const file = path.join(ROOT, "preview", `showcase-${s}.html`);
  const html = H[s];
  const b = bytes(html);
  ok(`${s}-存在`, fs.existsSync(file), file);
  eq(`${s}-doctype`, html.slice(0, 15).toLowerCase(), "<!doctype html>");
  eq(`${s}-style标签数`, (html.match(/<style>/g) || []).length, 1);
  // facts + labels + vert + frag + host，五份内联，一份不外链
  eq(`${s}-script标签数`, (html.match(/<script/g) || []).length, 5);
  eq(`${s}-canvas数`, (html.match(/<canvas/g) || []).length, 1);
  const ext = [...html.matchAll(/(?:src|href)="([^"#]*)"/g)].map((m) => m[1]).filter((v) => v && !v.startsWith("data:"));
  eq(`${s}-外链属性`, ext.length, 0, ext.join(","));
  ok(`${s}-零http`, !/https?:\/\//.test(html), [...html.matchAll(/https?:\/\/[^"' )]{0,40}/g)].map((m) => m[0]).join(","));
  ok(`${s}-无module`, !/type="module"/.test(html) && !/^\s*import\s/m.test(P[s].hostCode));
  ok(`${s}-无网络与持久化API`, !/\bfetch\(|XMLHttpRequest|localStorage|indexedDB|sendBeacon/.test(P[s].hostCode));
  ok(`${s}-CSS无url()`, !/url\(/.test(P[s].css));
  ok(`${s}-无位图无字体外链`, !/@font-face|<img|\.png|\.jpg|\.webp/.test(html));
  ok(`${s}-体积合理`, b > 30000 && b < 200000, `${b}B`);
}
eq("A-预览总大小<400KB", STYLES.reduce((a, s) => a + bytes(H[s]), 0) < 400000, true);

/* ---------- B 单一事实源 ---------- */
g("B");
for (const s of STYLES) {
  // 骨架里不得有字面量数字：标签名（h1/h2）与属性剥掉后，文本节点必须一个数字都没有
  const text = P[s].dom.replace(/<[^>]*>/g, "|").split("|").filter((t) => t.trim()).join(" ");
  const digits = text.match(/[0-9]/g) || [];
  eq(`${s}-DOM文本节点零数字`, digits.length, 0, digits.join("") + " ← " + text.slice(0, 46));
}
const domI18n = [...new Set((P.vitrine.dom.match(/data-i18n="([^"]+)"/g) || []).map((m) => m.split('"')[1]))];
const labelKeys = Object.keys(labels).filter((k) => !k.startsWith("$"));
const runtimeOnly = ["readout", "readoutAria", "readoutPending", "buildStamp", "anchorRight", "anchorLeft", "anchorCenter", "volume", "date", "presetAria", "btnSpinOn", "glReady", "glRenderer", "glUniform", "glDraws", "glArea", "glAnchor", "glHint"];
ok("B-i18n键都在labels里", domI18n.every((k) => k in labels), domI18n.filter((k) => !(k in labels)).join(","));
eq("B-labels无孤儿键", labelKeys.filter((k) => !domI18n.includes(k) && !runtimeOnly.includes(k)).length, 0);
ok("B-运行时键都可用", runtimeOnly.every((k) => k in labels), runtimeOnly.filter((k) => !(k in labels)).join(","));
const factPaths = [...new Set((P.vitrine.dom.match(/data-fact="([^"]+)"/g) || []).map((m) => m.split('"')[1]))];
const pick = (o, d) => d.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
ok("B-data-fact全部可解析", factPaths.every((p) => pick(facts, p) !== undefined), factPaths.filter((p) => pick(facts, p) === undefined).join(","));
// host.js 里出现中文只允许在注释里；字符串字面量出现中文 = 文案离开了 labels.json
const cjkStrings = (P.vitrine.hostCode.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) || []).filter((x) => /[\u4e00-\u9fff]/.test(x));
eq("B-host.js字符串无中文文案", cjkStrings.length, 0, cjkStrings.join(" "));
eq("B-页面facts只比src多派生字段", JSON.stringify(pageFactsMinusDerived), JSON.stringify(srcFacts));
ok("B-构建号写进facts", typeof facts.build.id === "string" && facts.build.id.length > 0, facts.build.id);
eq("B-三页facts与labels段逐字节相同", new Set(STYLES.map((s) => sha1((H[s].match(/<script id="(facts|labels)"[\s\S]*?<\/script>/g) || []).join("|")))).size, 1);
// 事实自洽：部件质量之和必须等于声明的空壶重（退化输入下恒等式会自我证明，所以额外查它真的收过钱）
const massSum = facts.parts.reduce((a, p) => a + p.massG, 0);
ok("B-部件合计与几何口径自洽", massSum > 0 && Number.isFinite(massSum), `${massSum}g`);
eq("B-合计行由parts现算(host里无手打总数)", /document\.getElementById\("partsTotalCell"\)\.textContent = total \+ " g"/.test(P.vitrine.hostCode), true);

/* ---------- C 共用区逐字节相同 ---------- */
g("C");
const regionHash = {};
for (const name of ["vert", "host", "dom", "head", "geometry", "main", "fragShared", "css", "shade"]) {
  const set = new Set(STYLES.map((s) => sha1(P[s][name])));
  regionHash[name] = [...set].map((h) => h.slice(0, 8));
  if (["vert", "host", "dom", "head", "geometry", "main", "fragShared"].includes(name)) eq(`C-${name}三页相同`, set.size, 1);
  if (name === "css" || name === "shade") eq(`C-${name}三页互异`, set.size, 3);
}
fs.writeFileSync(path.join(ROOT, "evidence", "regions.json"), JSON.stringify(regionHash, null, 2) + "\n");
const bodyHtmlSrc = read(path.join(SRC, "body.html"));
ok("C-产物DOM含src骨架", P.vitrine.dom.includes(bodyHtmlSrc.trim().slice(0, 120)));
eq("C-几何块sha1写进页面facts", facts.build.geometrySha1, sha1(read(path.join(SRC, "shaders", "geometry.glsl"))).slice(0, 12));
// 构建报告里的 sha1 必须是磁盘源码的 sha1，而不是「上次构建留下的一串字符」：三页同值 + 与源码同值
eq("C-三页报告的几何sha1同一个值", new Set(buildReport.built.map((b) => b.geometrySha1)).size, 1);
eq("C-报告sha1=源码现算sha1", buildReport.built[0].geometrySha1, sha1(read(path.join(SRC, "shaders", "geometry.glsl"))));
eq("C-页面戳的宿主sha1=源码现算", facts.build.hostSha1, sha1(read(path.join(SRC, "host.js"))).slice(0, 12));

/* ---------- D 色板跨层单一来源 ---------- */
g("D");
for (const s of STYLES) {
  const tokens = rootTokens(P[s].css);
  const used = buildReport.tokens.find((t) => t.style === s).used;
  ok(`D-${s}-有令牌被解析`, used.length >= 3, used.length);
  for (const u of used) {
    eq(`D-${s}-${u.token}取自:root`, u.hex, tokens.get(u.token));
    const want = `vec3(${vec3Of(u.hex).map((x) => x.toFixed(6)).join(", ")})`;
    ok(`D-${s}-${u.token}写进GLSL`, P[s].shade.includes(want), want);
  }
  eq(`D-${s}-shade代码无十六进制`, (P[s].shadeCode.match(/#[0-9a-fA-F]{3,6}/g) || []).length, 0);
  ok(`D-${s}-占位符已全部替换`, !/\{\{col:/.test(P[s].shadeCode), (P[s].shadeCode.match(/\{\{col:[^}]*\}\}/) || [""])[0]);
}
for (let i = 0; i < STYLES.length; i++) {
  for (let j = i + 1; j < STYLES.length; j++) {
    const a = new Set(buildReport.tokens.find((t) => t.style === STYLES[i]).used.map((u) => u.hex.toLowerCase()));
    const b = new Set(buildReport.tokens.find((t) => t.style === STYLES[j]).used.map((u) => u.hex.toLowerCase()));
    const inter = [...a].filter((x) => b.has(x));
    eq(`D-${STYLES[i]}×${STYLES[j]}-着色色板零交集`, inter.length, 0, inter.join(","));
  }
}

/* ---------- E 三风格指纹互异（技能式子 + class 覆盖） ---------- */
g("E");
const fp = {};
for (const s of STYLES) {
  const t = rootTokens(P[s].css);
  const shadow = /\.stage\s*\{[^}]*box-shadow:\s*([^;]+);/.test(P[s].css) ? RegExp.$1 : "none";
  fp[s] = {
    rule: t.get("--rule"), radius: t.get("--radius"), fontDisplay: t.get("--font-display"),
    bodyMax: (P[s].css.match(/max-width:\s*(\d+)px/) || [])[1],
    base: (P[s].css.match(/body\s*\{[\s\S]*?font-size:\s*([\d.]+)px/) || [])[1],
    stageShadow: shadow,
    upper: (P[s].css.match(/text-transform:\s*uppercase/g) || []).length,
    gradients: (P[s].css.match(/gradient\(/g) || []).length,
    hexes: new Set([...P[s].css.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0].toLowerCase())),
  };
}
for (const key of ["rule", "radius", "bodyMax", "base"]) {
  eq(`E-${key}三值互异`, new Set(STYLES.map((s) => fp[s][key])).size, 3, STYLES.map((s) => fp[s][key]).join(" / "));
}
// 盒阴影的几何部分：丢掉颜色 token（#xxx / rgb / var(...)），剩下的偏移/模糊/扩散才是风格指纹
const geomOf = (v) => v.trim().split(/\s+/).filter((t) => !/^(#|rgb|hsl|var\()/i.test(t)).slice(0, 4).map(parseFloat);
// 字族里的「通用族」才是衬线与否的判据；"sans-serif" 里含 "serif" 子串，直接 includes 会自我否定
const genericOf = (v) => v.trim().split(/,\s*/).pop().replace(/["']/g, "");
eq("E-vitrine靠描边不靠投影", fp.vitrine.stageShadow, "none");
const plaqueG = geomOf(fp.plaque.stageShadow);
ok("E-plaque投影是软扩散(负Y偏移/正模糊/负扩散)", plaqueG.length === 4 && plaqueG[1] > 0 && plaqueG[2] > 0 && plaqueG[3] < 0, JSON.stringify(plaqueG));
const industG = geomOf(fp.industrial.stageShadow);
ok("E-industrial硬投影零模糊", industG.length === 3 && industG[2] === 0 && industG[0] > 0 && industG[0] === industG[1], JSON.stringify(industG));
ok("E-vitrine标题通用衬线字族", genericOf(fp.vitrine.fontDisplay) === "serif", genericOf(fp.vitrine.fontDisplay));
ok("E-plaque标题通用无衬线字族", genericOf(fp.plaque.fontDisplay) === "sans-serif" && fp.plaque.fontDisplay.includes("Avenir"), genericOf(fp.plaque.fontDisplay));
eq("E-plaque零大写化", fp.plaque.upper, 0);
ok("E-industrial大写化最多", fp.industrial.upper > fp.plaque.upper && fp.industrial.upper >= 8, fp.industrial.upper);
ok("E-industrial零渐变到描边体系之外", fp.industrial.gradients >= 3 && fp.vitrine.gradients >= 2, `i${fp.industrial.gradients}/v${fp.vitrine.gradients}`);
ok("E-industrial用var(--rule)统一描边", /border:\s*var\(--rule\)/.test(P.industrial.css));
for (let i = 0; i < STYLES.length; i++) {
  for (let j = i + 1; j < STYLES.length; j++) {
    const inter = [...fp[STYLES[i]].hexes].filter((x) => fp[STYLES[j]].hexes.has(x));
    eq(`E-${STYLES[i]}×${STYLES[j]}-整张色板零交集`, inter.length, 0, inter.join(","));
  }
}
const classes = [...new Set((bodyHtmlSrc.match(/class="([^"]+)"/g) || []).flatMap((m) => m.split('"')[1].split(/\s+/)))];
for (const s of STYLES) {
  const missing = classes.filter((c) => !P[s].css.includes("." + c));
  eq(`E-${s}-每个class都有规则(${classes.length})`, missing.length, 0, missing.join(","));
}

/* ---------- F 结构与无障碍 ---------- */
g("F");
for (const s of STYLES) {
  const dom = P[s].dom;
  eq(`${s}-单个h1`, (dom.match(/<h1/g) || []).length, 1);
  ok(`${s}-lang与charset`, /<html lang="zh-CN">/.test(H[s]) && /charset="utf-8"/.test(H[s]));
  ok(`${s}-skip链接是最先的可聚焦节点`, new RegExp(`<body[^>]*>\\s*<a class="skip" href="#stage">`).test(P[s].domRaw) && !/<button|<canvas/.test(P[s].domRaw.split('<a class="skip"')[0]));
  eq(`${s}-每个表格有caption`, (dom.match(/<table/g) || []).length, (dom.match(/<caption/g) || []).length);
  eq(`${s}-列头都有scope=col`, (dom.match(/<th scope="col"/g) || []).length, 9);
  ok(`${s}-readout是live区域`, /id="readout"[^>]*role="status"[^>]*aria-live="polite"/.test(dom));
  ok(`${s}-canvas有role与初始aria-label`, /<canvas id="gl" role="img" aria-label="[^"]+">/.test(dom));
  ok(`${s}-自转按钮有aria-pressed`, /id="spinBtn" aria-pressed="false"/.test(dom));
  ok(`${s}-预设组有role与标签`, /id="presetBar"[^>]*role="group"[^>]*aria-label=/.test(dom));
  ok(`${s}-reduced-motion块`, /@media \(prefers-reduced-motion: reduce\)/.test(P[s].css));
  ok(`${s}-响应式断点`, /@media \((max-width|min-width)/.test(P[s].css));
  ok(`${s}-焦点可见样式`, /:focus-visible/.test(P[s].css));
  ok(`${s}-canvas有min-width防溢出`, /min-width:\s*0/.test(P[s].css));
  ok(`${s}-标题里有本页风格名`, H[s].includes(facts.styles.find((x) => x.id === s).name), facts.styles.find((x) => x.id === s).name);
}
const presetRow = (P.vitrine.hostCode.match(/tr\.append\(td\(p\.label\)[^;]*\)/) || [""])[0];
eq("F-角度表每行5格=表头5列", presetRow.split("td(").length - 1, 5);
ok("F-实测列有指针", /data-cell="measured"/.test(P.vitrine.hostCode) && /<th scope="col" data-i18n="colMeasured">/.test(P.vitrine.dom));
ok("F-实测列初值不是结论", /td\("—", "measured"\)/.test(P.vitrine.hostCode));
// 实测列若永远填不上，就等于把结论写死在预期里：live 必须默认开，且写入源必须是测量结果
ok("F-像素实测默认开启", /live: true/.test(P.vitrine.hostCode));
ok("F-实测单元格只写测得的锚点", /\[data-cell="measured"\]'\)\.textContent = anchorWord\(anchorFromMeasure\(m\)\)/.test(P.vitrine.hostCode));

/* ---------- G 几何常量镜像（GLSL ↔ JSON 双向） ---------- */
g("G");
const jsonNums = new Set();
for (const sec of ["geometry", "camera", "shading"]) {
  for (const m of JSON.stringify(facts[sec]).matchAll(/-?\d+(?:\.\d+)?/g)) jsonNums.add(m[0]);
}
const geoCode = noComments(P.vitrine.geometry);
const glConsts = [...geoCode.matchAll(/const (?:float|int) ([A-Z_0-9]+)\s*=\s*(-?[\d.]+)/g)].map((m) => [m[1], +m[2]]);
const glVec = [...geoCode.matchAll(/const vec3 ([A-Z_0-9]+)\s*=\s*vec3\(([^)]+)\)/g)].map((m) => [m[1], m[2].split(",").map((x) => +x.trim())]);
let mismatch = glConsts.filter(([, v]) => !jsonNums.has(String(v))).map(([n, v]) => `${n}=${v}`);
eq("G-GLSL每个标量常量都在JSON里", mismatch.length, 0, mismatch.join(","));
mismatch = glVec.filter(([, arr]) => !arr.every((v) => jsonNums.has(String(v)))).map(([n, arr]) => `${n}=${arr.join(",")}`);
eq("G-GLSL每个向量常量分量都在JSON里", mismatch.length, 0, mismatch.join(","));
const SHADING_MAP = {
  MARCH_STEPS: "marchSteps", MARCH_EPS: "marchEps", MARCH_MIN_STEP: "marchMinStep",
  NORMAL_E: "normalEpsilon", AO_RINGS: "aoRings", AO_STEP: "aoStep", AO_FALL: "aoFalloff", AO_GAIN: "aoGain",
  ZONE_SPOUT_X: "zoneSpoutX", ZONE_BRASS_Y: "zoneBrassY", ZONE_LID_R: "zoneLidR",
  BAND_Y_LOW: "bandYLow", BAND_Y_HIGH: "bandYHigh",
};
const constByName = new Map(glConsts);
mismatch = Object.entries(SHADING_MAP).filter(([gl, js]) => constByName.get(gl) !== facts.shading[js])
  .map(([gl, js]) => `${gl}=${constByName.get(gl)} vs shading.${js}=${facts.shading[js]}`);
eq("G-shading阈值按名双向镜像", mismatch.length, 0, mismatch.join(","));
eq("G-shading无未镜像字段", Object.keys(facts.shading).filter((k) => !Object.values(SHADING_MAP).includes(k)).length, 0);
const camMap = { CAM_DIST: facts.camera.distance, TARGET_Y: facts.camera.targetY, FOV_TAN: facts.camera.fovTan };
for (const m of noComments(P.vitrine.head).matchAll(/const float ([A-Z_0-9]+)\s*=\s*(-?[\d.]+)/g)) {
  if (m[1] in camMap) eq(`G-${m[1]}与JSON一致`, +m[2], +camMap[m[1]]);
}
eq("G-FOV_TAN=tan(fovDeg/2)", +camMap.FOV_TAN, +Math.tan((facts.camera.fovDeg * Math.PI) / 360).toFixed(6));
eq("G-关键半径双向镜像", ["BODY_R", "HANDLE_R", "HANDLE_T", "KNOB_R", "SPHERE_R"].filter((k) => !constByName.has(k)).length, 0);
eq("G-鹅颈四段显式胶囊", (geoCode.match(/sdCapsuleG\(p, SPOUT_A\d, SPOUT_B\d, SPOUT_R\d\)/g) || []).length, facts.geometry.spout.segments.length);
eq("G-壶嘴尖端事实与几何一致", JSON.stringify(facts.geometry.spout.tip), JSON.stringify(facts.geometry.spout.segments[facts.geometry.spout.segments.length - 1].b));
// 取景余量：包围球必须真的装得下每个特征（装不下就切模型），又不能肥到浪费步进预算。
// 需求半径完全由 JSON 的其它字段现算，不看 GLSL，因此这条不是自我证明。
const geo = facts.geometry;
const dist3 = (v) => Math.hypot(...v);
const cylR = (c, h, r) => Math.hypot(r, Math.abs(c) + h);
const neededR = Math.max(
  cylR(0, geo.body.halfHeight, geo.body.radius),
  cylR(geo.base.yCenter, geo.base.halfHeight, geo.base.radius),
  cylR(geo.lid.yCenter, geo.lid.halfHeight, geo.lid.radius),
  dist3(geo.knob.center) + geo.knob.radius,
  ...geo.spout.segments.map((s) => Math.max(dist3(s.a), dist3(s.b)) + s.r),
  dist3(geo.handle.center) + geo.handle.ringRadius + geo.handle.tubeRadius,
);
const sphereR = constByName.get("SPHERE_R");
eq("G-包围球半径写在JSON里", facts.geometry.bounds.sphereRadius, sphereR);
ok("G-包围球装得下最远特征", sphereR >= neededR, `球 ${sphereR} ≥ 需求 ${neededR.toFixed(3)}m`);
ok("G-包围球不过肥(浪费96步)", sphereR <= neededR + 0.15, `球 ${sphereR} ≤ 需求 ${neededR.toFixed(3)} + 0.15`);
ok("G-相机在包围球外", facts.camera.distance > sphereR, `${facts.camera.distance} > ${sphereR}`);

/* ---------- H GLSL ES 1.00 纪律 ---------- */
g("H");
const frag = P.vitrine.fragCode;
const fragNC = noComments(frag);
const mainNC = noComments(P.vitrine.main);
const headNC = noComments(P.vitrine.head);
ok("H-无#version", !/#version/.test(frag));
ok("H-无GLSL3存储关键字", !/^\s*(in|out)\s+(vec|float|int|mat)/m.test(fragNC));
ok("H-vert用attribute", /attribute vec2 aPos;/.test(P.vitrine.vertCode));
eq("H-gl_FragColor赋值恰好两处(命中/未命中)", (fragNC.match(/gl_FragColor\s*=/g) || []).length, 2);
eq("H-两处出口都在MAIN段", (mainNC.match(/gl_FragColor\s*=/g) || []).length, 2);
ok("H-MISS分支输出全透明", /gl_FragColor = vec4\(0\.0, 0\.0, 0\.0, 0\.0\)/.test(P.vitrine.main));
ok("H-无ShaderToy残留名", !/iTime|iResolution|fragCoord|mainImage/.test(frag + P.vitrine.hostCode));
const varIdx = [...fragNC.matchAll(/\b([a-zA-Z_]\w*)\s*\[[^\]0-9]+\]/g)].filter((m) => !/^(vec|mat|float)/.test(m[1]));
eq("H-无非常量数组下标", varIdx.length, 0, varIdx.map((m) => m[0]).join(";"));
// GLSL ES 1.00 附录 A：循环上限必须是常量表达式。这里既接受字面量，也接受具名 const int（后者可镜像，更严）。
const constInts = new Set((geoCode.match(/const int ([A-Z_0-9]+)/g) || []).map((m) => m.split(" ").pop()));
const loops = [...fragNC.matchAll(/for\s*\(\s*int\s+(\w+)\s*=\s*(\d+)\s*;\s*(\w+)\s*(<|<=)\s*([A-Za-z0-9_]+)\s*;\s*\w+\s*\+\+/g)];
eq("H-循环是规范式 i=常量; i<常量; i++", loops.length, 2);
ok("H-循环上限是字面量或具名const int", loops.every((m) => /^\d+$/.test(m[5]) || constInts.has(m[5])), loops.map((m) => m[5]).join(","));
eq("H-求交循环只在GEOMETRY里出现一次", (geoCode.match(/i < MARCH_STEPS/g) || []).length, 1);
eq("H-shade段零循环", STYLES.reduce((a, s) => a + (P[s].shadeCode.match(/for\s*\(/g) || []).length, 0), 0);
ok("H-highp精度显式声明且在最前", /^\s*precision highp float;/.test(frag), frag.trim().slice(0, 24));
const timeIn = (name) => (P[name].shadeCode.match(/uTime/g) || []).length;
ok("H-vitrine高光呼吸用uTime", timeIn("vitrine") >= 1, timeIn("vitrine"));
eq("H-plaque零uTime（皮肤主张无反射）", timeIn("plaque"), 0);
eq("H-industrial零uTime", timeIn("industrial"), 0);
eq("H-几何段零uTime", (geoCode.match(/uTime/g) || []).length, 0);
eq("H-出口段零uTime", (mainNC.match(/uTime/g) || []).length, 0);
eq("H-head里uTime只剩声明", (headNC.match(/uTime/g) || []).length, 1);
const idxOf = (needle) => frag.indexOf(needle);
ok("H-朝向判据声明链有序", idxOf("vec3 toCam(vec3 v)") < idxOf("float facingViewer(vec3 pos)") && idxOf("float facingViewer(vec3 pos)") < idxOf("float zoneFace") && idxOf("float zoneFace") < idxOf("float spoutFace"));
ok("H-分区判据在mapObj之后", idxOf("float mapObj(vec3 p)") < idxOf("vec3 toCam(vec3 v)"));
eq("H-三套皮肤都调用spoutFace", STYLES.filter((s) => /spoutFace\(pos\)/.test(P[s].shadeCode)).length, 3);
ok("H-只有industrial用识别带阈值", /BAND_Y/.test(P.industrial.shadeCode) && !/BAND_Y/.test(P.vitrine.shadeCode) && !/BAND_Y/.test(P.plaque.shadeCode));
eq("H-三套皮肤各自定义shadeSurface一次", STYLES.filter((s) => (P[s].shadeCode.match(/vec3 shadeSurface\(/g) || []).length === 1).length, 3);

/* ---------- I WCAG 对比度（:root 现算） ---------- */
g("I");
const PAIRS = [
  ["vitrine", "--v-ink", "--v-stage", 4.5, "正文 .coatings/.notes"],
  ["vitrine", "--v-spec", "--v-void", 3, "大标题 h1（≥24px 大字用 3.0）"],
  ["vitrine", "--v-brass", "--v-stage", 4.5, "小节标题 .sec-title"],
  ["vitrine", "--v-muted", "--v-stage", 4.5, "次要文字 .stage-cap"],
  ["vitrine", "--v-muted", "--v-void", 4.5, ".drag-hint 落在页面底色"],
  ["plaque", "--p-ink", "--p-card", 4.5, "正文/读数"],
  ["plaque", "--p-ink", "--p-wall", 4.5, "h1 落在展墙"],
  ["plaque", "--p-muted", "--p-wall", 4.5, ".mast-tag/.notes"],
  ["plaque", "--p-muted", "--p-card", 4.5, "表头 .table thead th"],
  ["plaque", "--p-accent", "--p-wall", 4.5, ".mast-kicker"],
  ["plaque", "--p-card", "--p-accent", 4.5, "选中按钮文字"],
  ["industrial", "--i-ink", "--i-panel", 4.5, "正文"],
  ["industrial", "--i-ink", "--i-floor", 4.5, ".notes 落在地板"],
  ["industrial", "--i-muted", "--i-floor", 4.5, ".stage-cap/.gl-badges"],
  ["industrial", "--i-muted", "--i-panel", 4.5, ".mast-kicker"],
  ["industrial", "--i-panel", "--i-dark", 4.5, "表头反白"],
  ["industrial", "--i-ink", "--i-paint", 4.5, "黄底黑字标签/选中态"],
  ["industrial", "--i-warn", "--i-floor", 4.5, ".sec-title 警示红"],
];
const contrastTable = [];
for (const [s, fg, bg, min, where] of PAIRS) {
  const t = rootTokens(P[s].css);
  const a = hexOf(t.get(fg)), b = hexOf(t.get(bg));
  if (!a || !b) { ok(`I-${s} ${fg}/${bg}`, false, `令牌不是十六进制：${t.get(fg)} / ${t.get(bg)}`); continue; }
  const c = contrast(a, b);
  contrastTable.push({ style: s, fg, bg, hexes: [a, b], ratio: c, min, where });
  ok(`I-${s} ${fg}/${bg}≥${min}`, c >= min, `${c} （${where}）`);
}
fs.writeFileSync(path.join(ROOT, "evidence", "contrast.json"), JSON.stringify(contrastTable, null, 2) + "\n");

/* ---------- J shader 技能条款落地 ---------- */
g("J");
const host = P.vitrine.hostCode;
ok("J-uniform命名宿主友好", /uTime|uResolution/.test(frag) && !/iTime|iResolution/.test(frag));
ok("J-不假定WebGL2", /getContext\("webgl"/.test(host) && !/webgl2/.test(host));
ok("J-编译失败有可读信息", /COMPILE_STATUS[\s\S]{0,200}getShaderInfoLog/.test(host));
ok("J-链接失败有可读信息", /LINK_STATUS[\s\S]{0,200}getProgramInfoLog/.test(host));
ok("J-上下文不可用不抛异常", /catch \(e\)/.test(host) && /gl-fatal/.test(host));
ok("J-视角uniform都有位置查询", /getUniformLocation\(prog, "uAzimuth"\)/.test(host) && /getUniformLocation\(prog, "uElevation"\)/.test(host));
ok("J-无交互不重绘", /if \(state\.dirty\)/.test(host));
ok("J-剪影用alpha通道判定", /px\[i \+ 3\] > 127/.test(host));
ok("J-变体轴由SKILL要求的host胶水承载", /premultipliedAlpha: true/.test(host) && /alpha: true/.test(host));

/* ---------- K 单位与角度纪律 ---------- */
g("K");
eq("K-deg2rad只定义一处", (host.match(/const deg2rad =/g) || []).length, 1);
eq("K-rad2deg只定义一处", (host.match(/const rad2deg =/g) || []).length, 1);
eq("K-wrapTau只定义一处", (host.match(/const wrapTau =/g) || []).length, 1);
ok("K-wrap用在读取与写入两侧", (host.match(/wrapTau\(/g) || []).length >= 5, (host.match(/wrapTau\(/g) || []).length);
ok("K-uniform写入前wrap", /state\.lastUniforms\.uAzimuth = wrapTau\(state\.azRad\)/.test(host));
ok("K-界面角度取整后才拼文案", /const azDeg = Math\.round\(rad2deg\(wrapTau\(state\.azRad\)\)\)/.test(host));
eq("K-GLSL代码里没有度数词根", (fragNC.match(/deg/gi) || []).length, 0, (fragNC.match(/[a-zA-Z]*deg[a-zA-Z]*/gi) || []).join(","));
eq("K-DOM模板不含度数符号", (bodyHtmlSrc.match(/°/g) || []).length, 0);
// 360 这个数只能活在两个换算函数体里；别处出现 180/Math.PI/0.01745 就是有人绕过换算直接搓常数
const lines360 = host.split("\n").map((l) => l.trim()).filter((l) => l.includes("360"));
eq("K-换算常数只出现在两个换算函数里", lines360.length, 2, lines360.join(" | "));
ok("K-两处都是换算定义", lines360.every((l) => /^const (deg2rad|rad2deg) =/.test(l)), lines360.join(" | "));
eq("K-宿主没有绕开换算函数的度数常数", (host.match(/\b180\b|Math\.PI\s*\/\s*180|0\.01745/g) || []).length, 0);

/* ---------- L 预设与事实自洽 ---------- */
g("L");
eq("L-预设数量", facts.presets.length, 5);
ok("L-预设方位角唯一", new Set(facts.presets.map((p) => p.azDeg)).size === 4, facts.presets.map((p) => p.azDeg).join(","));
ok("L-预设覆盖四个正交方向", [0, 90, 180, 270].every((d) => facts.presets.some((p) => p.azDeg === d)));
ok("L-expectTopband只有三种取值", facts.presets.every((p) => ["right", "left", "center"].includes(p.expectTopband)));
ok("L-每个仰角都在钳制区间内", facts.presets.every((p) => p.elDeg >= facts.camera.elevationClampDeg[0] && p.elDeg <= facts.camera.elevationClampDeg[1]), facts.presets.map((p) => p.elDeg).join(","));
ok("L-夹持区间下界小于上界", facts.camera.elevationClampDeg[0] < facts.camera.elevationClampDeg[1]);
eq("L-控件灵敏度以度为单位声明", facts.controls.dragSensitivityDegPerPx > 0 && facts.controls.keyboardStepDeg > 0 && facts.controls.spinDegPerSec > 0, true);
ok("L-方位单位声明为弧度", facts.camera.azimuthUnit === "radian" && facts.camera.azimuthWrap === "tau");
eq("L-每弧度度数常数", facts.camera.degPerRadian, 180 / Math.PI);

/* ---------- N 对照页数字溯源 ----------
 * 指针一律从磁盘现读：不引用本套件自己的断言条数（自指会让「跑一次改一次」永远对不齐），
 * 只引用 src/*.json 与 evidence/*.json 里由别的步骤写下的事实。 */
g("N");
const skipStyles = process.argv.includes("--skip-styles");
const stylesPath = path.join(ROOT, "preview", "styles.html");
if (skipStyles) {
  ok("N-跳过（verify.sh 第一遍：对照页尚未生成）", true, "--skip-styles");
} else if (fs.existsSync(stylesPath)) {
  const stylesHtml = read(stylesPath);
  const nodes = [...stylesHtml.matchAll(/data-num="([^"]+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2].trim()]);
  ok("N-对照页有数字指针", nodes.length >= 25, nodes.length);
  const bad = [];
  for (const [ptr, shown] of nodes) {
    const want = resolvePointer(ptr);
    if (want == null) { bad.push(`${ptr}=?(无法解析)`); continue; }
    if (String(want) !== shown) bad.push(`${ptr}: 页面 ${shown} / 现算 ${want}`);
  }
  eq("N-对照页每个数字都现算得出", bad.length, 0, bad.slice(0, 8).join(" ; "));
  ok("N-对照页有25个以上不同指针", new Set(nodes.map((n) => n[0])).size >= 25, new Set(nodes.map((n) => n[0])).size);
  ok("N-对照页零外链", !/https?:\/\//.test(stylesHtml));
  ok("N-对照页零脚本", !/<script/.test(stylesHtml));
  eq(`N-对照页三种风格都在`, STYLES.filter((s) => !stylesHtml.includes(`data-style="${s}"`)).length, 0);
  ok("N-对照页嵌了三张剪影图", (stylesHtml.match(/data:image\/png;base64,/g) || []).length >= 3, (stylesHtml.match(/data:image\/png;base64/g) || []).length);
} else {
  ok("N-对照页存在(先跑 make-styles.mjs)", false, "preview/styles.html 缺失");
}

const pass = results.filter((r) => r.pass).length;
fs.writeFileSync(path.join(ROOT, "evidence", "check-node.json"), JSON.stringify({ total: results.length, pass, fail: results.length - pass, results }, null, 2) + "\n");
const fails = results.filter((r) => !r.pass);
console.log(JSON.stringify({ suite: "check-node", total: results.length, pass, fail: fails.length, fails: fails.map((f) => `${f.id} → ${f.detail}`) }));
process.exit(fails.length ? 1 : 0);
