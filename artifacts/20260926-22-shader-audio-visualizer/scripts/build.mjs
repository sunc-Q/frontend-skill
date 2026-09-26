/* 把 src/ 组装成 preview/visualizer-<style>.html：
 *   三份页面 = 同一份 DOM 模板 + 同一份宿主 + 同一份内联音频，只有 <style> 与 STYLE 令牌块不同。
 * 「不同」只允许发生在皮肤层，于是三页宿主载荷中「哨兵 ==SHARED-HOST-BOUNDARY== 之后」的段落
 * 必须逐字节相同（A 组断言）；哨兵之前的 STYLE 块本来就各自不同，不该拿整段 <script> 比。
 * 皮肤里的 --gl-* 十六进制令牌会被解析成着色器的 vec3 uniform：一份颜色同时管 CSS 与画面，
 * 谁改了其中一边，A 组的「色板 == 令牌」断言就会红。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { bandEdges, COARSE, BAND_COUNT } from "../src/bands.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ---------- 浏览器侧特征层：把 bands.js + features.js 剥掉模块语法包成一个 IIFE ---------- */
const FEATURE_NAMES = [
  "SAMPLE_HINT", "BAND_COUNT", "BAND_LO", "BAND_HI", "bandEdges", "COARSE", "coarseOf",
  "DB_FLOOR", "DB_CEIL", "dbToUnit", "binsToUnits", "aggregateBands", "coarseFromBands",
  "ONSET_WINDOW", "ONSET_FACTOR", "ONSET_FLOOR", "ONSET_GAP", "createOnsetDetector", "fluxOf", "bandCount"
];

function toBrowserFeatureSource() {
  const body = ["src/bands.js", "src/features.js"].map((file) => read(file)
    .split("\n")
    .filter((line) => !/^import\s|^\s*export default/.test(line))
    .map((line) => line.replace(/^export\s+/, ""))
    .join("\n")).join("\n");
  const dup = body.match(/^(?:const|function)\s+(\w+)/gm);
  const seen = new Set();
  (dup || []).forEach((d) => {
    const n = d.split(/\s+/)[1];
    if (seen.has(n)) throw new Error("模块合并后出现重名顶层标识符：" + n);
    seen.add(n);
  });
  return "(function () {\n" + body + "\n  return { " + FEATURE_NAMES.join(", ") + " };\n})()";
}

/* ---------- 皮肤：CSS :root 里的 --gl-* 就是着色器 vec3 ---------- */
const GL_TOKENS = {
  "--gl-ink": "uInk", "--gl-paper": "uPaper", "--gl-accent": "uAccent",
  "--gl-low": "uLow", "--gl-mid3": "uMid3", "--gl-high": "uHigh"
};

function hexToVec3(hex) {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => Number((parseInt(full.slice(i, i + 2), 16) / 255).toFixed(5)));
}

function parseSkin(cssFile) {
  const css = read(cssFile);
  const start = css.indexOf(":root");
  if (start < 0) throw new Error(cssFile + " 没有 :root 令牌块");
  const rootBlock = css.slice(start, css.indexOf("}", start));
  const vec = {}, hexes = {};
  Object.entries(GL_TOKENS).forEach(([token, uniform]) => {
    const m = new RegExp(token + "\\s*:\\s*(#[0-9a-fA-F]{3,6})").exec(rootBlock);
    if (!m) throw new Error(cssFile + " 缺少令牌 " + token + "（着色器需要 " + uniform + "）");
    vec[uniform] = hexToVec3(m[1]);
    hexes[uniform] = m[1].toLowerCase();
  });
  const palette = [...new Set((css.match(/#[0-9a-fA-F]{3,6}\b/g) || []).map((s) => s.toLowerCase()))];
  return { css, vec, hexes, palette };
}

/* ---------- 消融臂：页面第 4 节的清单与宿主的 has("…") 必须是同一份名单 ----------
 * 名单写在这里、由构建同时校验源码与页面，是为了让「文档漂移」变成构建期错误：
 * 加一臂忘了写进页面，或页面列了一宿主干脆没有的臂，都会在这里抛。 */
const ABLATIONS = [
  { arm: "frozen", what: "冻住 uTime，音频照跑", want: "画面仍在变（变化只能来自音频）" },
  { arm: "frozen,noaudio", what: "时钟与音频一起拔掉", want: "画面完全静止（changedPct 必须为 0）" },
  { arm: "noaudio", what: "音频读数清零、频谱与历史纹理不再更新", want: "音频驱动的分量全部停住" },
  { arm: "staticspectrum", what: "喂一条与音乐无关的固定斜坡频谱", want: "画面不随音乐变" },
  { arm: "mislabel", what: "64 带顺序反转后再上传", want: "低频段跑到画幅另一侧，带映射真在生效" },
  { arm: "samevariant", what: "三个子视口都用 uVariant=0", want: "分频三带失去差异" },
  { arm: "noonset", what: "起拍检测器不喂数据", want: "uBeat 恒 0，弹圈/闪烁带消失" },
  { arm: "nomouse", what: "uMouse 只在初始化写一次", want: "移动指针不再影响画面" },
  { arm: "solid", what: "着色器换成常量品红", want: "证明绘制通路活着（黑屏检查表第 1 步）" },
  { arm: "nogl", what: "强制走无 WebGL 分支", want: "显示降级提示而不是空白" }
];
const SKINS = {
  colonnade: {
    label: "频谱柱廊 · 方格账簿",
    cssFile: "src/css/skin-colonnade.css",
    shader: "src/shaders/colonnade.glsl",
    uniforms: ["uResolution", "uOrigin", "uMouse", "uVariant", "uLevel", "uFlux", "uBeat", "uSpectrum"],
    howLead: "主画面刻意没有 uTime：着色器里不存在任何自带时钟，所以「柱廊在动」只能来自音频。每根柱子按列号去 64×1 的频谱纹理里取自己那一格，再量化成十级——读数感来自量化，不来自滤镜。"
  },
  ripple: {
    label: "涟漪井月 · 水墨径向",
    cssFile: "src/css/skin-ripple.css",
    shader: "src/shaders/ripple.glsl",
    uniforms: ["uResolution", "uOrigin", "uMouse", "uTime", "uVariant", "uLevel", "uBass", "uMid", "uTreb", "uBeat", "uSpectrum"],
    howLead: "角度映射到频带、半径映射到能量：uBass 压下水面半径、uMid 决定环的密度、uTreb 只喂月盘亮度。uTime 在这里是存在的，但它只负责波的行进——把 uTime 冻住（?probe=frozen），画面照变。"
  },
  thermal: {
    label: "声纹热像 · 滚动色谱",
    cssFile: "src/css/skin-thermal.css",
    shader: "src/shaders/thermal-ridge.glsl",
    uniforms: ["uResolution", "uOrigin", "uTime", "uVariant", "uLevel", "uTreb", "uSpectrum", "uHistory"],
    howLead: "前两页吃的是「此刻」，这一页吃的是「历史」：宿主每帧把 64 带推进一张 64×128 的 luminance 纹理，着色器按 x=时间、y=频带采样。所以拔掉音频之后它连滚动都会停（?probe=noaudio）。"
  }
};

const spec = JSON.parse(read("src/audio-spec.json"));
const gt = JSON.parse(read("evidence/ground-truth.json")).summary;
const baseCss = read("src/css/base.css");
const template = read("src/template.html");
const hostTemplate = read("src/host.js");
ABLATIONS.forEach((a) => {
  a.arm.split(",").forEach((one) => {
    if (!hostTemplate.includes(`has("${one}")`)) throw new Error("消融清单里有 " + one + "，但宿主源码没有 has(\"" + one + "\") 分支");
  });
});
/* 反方向：宿主管子里冒出来的臂必须全部登记在清单上（否则页面少写一臂，无人发现） */
const listedAtoms = new Set(ABLATIONS.flatMap((a) => a.arm.split(",")));
const hostAtoms = [...hostTemplate.matchAll(/has\("([a-z]+)"\)/g)].map((m) => m[1]);
const unlisted = [...new Set(hostAtoms)].filter((a) => !listedAtoms.has(a));
if (unlisted.length) throw new Error("宿主里有未登记的消融臂：" + unlisted.join(","));
const ablationRows = ABLATIONS.map((a) =>
  `      <li><code>?probe=${a.arm}</code> ${a.what} —— ${a.want}</li>`).join("\n");

/* uniform 说明表：行由「着色器实际声明的名字」生成，不是手写清单。
 * 于是「页面写着本页有 uTime，着色器其实没声明」这类文案漂移会在构建期抛（缺 metadata 分支）。 */
const UNIFORM_SPEC = {
  uTime: ["float", "宿主累加的帧时（frozen 臂下不再累加）", "0 – ∞ 秒"],
  uResolution: ["vec2", "当前子视口的画布像素", "宽 × 高"],
  uOrigin: ["vec2", "该视口在整块画布里的原点", "0 – 宽"],
  uMouse: ["vec2", "指针位置（归一，y 向上）", "0 – 1"],
  uVariant: ["float", "子视口编号：0 全带 / 1 低 / 2 中 / 3 高", "0 – 3"],
  uLevel: ["float", "64 带均方根", "0 – 1"],
  uBass: ["float", "带 0–11（%BASS%）均值", "0 – 1"],
  uMid: ["float", "带 12–33（%MID%）均值", "0 – 1"],
  uTreb: ["float", "带 34–63（%TREBLE%）均值", "0 – 1"],
  uFlux: ["float", "帧间频谱上升通量", "0 – 1"],
  uBeat: ["float", "起拍检测后的衰减脉冲", "0 – 1"],
  uSpectrum: ["sampler2D", "64 × 1 luminance 纹理（当前频谱）", "0 – 1 / texel"],
  uHistory: ["sampler2D", "64 × 128 luminance 纹理（滚动历史）", "0 – 1 / texel"],
  uInk: ["vec3", "皮肤 CSS 令牌 --gl-ink", "sRGB 0 – 1"],
  uPaper: ["vec3", "皮肤 CSS 令牌 --gl-paper", "sRGB 0 – 1"],
  uAccent: ["vec3", "皮肤 CSS 令牌 --gl-accent", "sRGB 0 – 1"],
  uLow: ["vec3", "皮肤 CSS 令牌 --gl-low（低频段配色）", "sRGB 0 – 1"],
  uMid3: ["vec3", "皮肤 CSS 令牌 --gl-mid3（中频段配色）", "sRGB 0 – 1"],
  uHigh: ["vec3", "皮肤 CSS 令牌 --gl-high（高频段配色）", "sRGB 0 – 1"]
};
const UNIFORM_ORDER = Object.keys(UNIFORM_SPEC);
function uniformRows(declaredNames) {
  const unknown = declaredNames.filter((n) => !UNIFORM_ORDER.includes(n));
  if (unknown.length) throw new Error("着色器声明了未登记的 uniform：" + unknown.join(",") + "（说明表会与代码漂移）");
  const names = UNIFORM_ORDER.filter((n) => declaredNames.includes(n));
  if (names.length !== declaredNames.length) throw new Error("uniform 去重后数量与声明数不符");
  return names.map((n) => {
    const [type, src, range] = UNIFORM_SPEC[n];
    const source = src.replace("%BASS%", BASS).replace("%MID%", MID).replace("%TREBLE%", TREBLE);
    return `        <tr><th scope="row">${n}</th><td>${type}</td><td>${source}</td><td>${range}</td></tr>`;
  }).join("\n");
}
const featuresExpr = toBrowserFeatureSource();
const wav = fs.readFileSync(path.join(ROOT, "audio/track.wav"));
const audioUri = "data:audio/wav;base64," + wav.toString("base64");

const edges = bandEdges();
const rangeText = (from, to) => Math.round(edges[from]) + "–" + Math.round(edges[to - 1]) + " Hz";
const BASS = rangeText(COARSE[0].from, COARSE[0].to);
const MID = rangeText(COARSE[1].from, COARSE[1].to);
const TREBLE = rangeText(COARSE[2].from, COARSE[2].to);

const barRoleLabel = { pad: "铺底", "pad+hat": "铺底 + 踩镲", groove: "全编制", breakdown: "breakdown（无低频）" };
const counts = spec.facts.counts;

const barRows = spec.facts.bars.map((b, i) => {
  const g = gt.perBar[i];
  return `        <tr><th scope="row">${String(b.index + 1).padStart(2, "0")}</th>` +
    `<td>${b.from.toFixed(1)}–${b.to.toFixed(1)} s</td>` +
    `<td>${barRoleLabel[b.role]}</td>` +
    `<td>${g.level.median.toFixed(3)}</td>` +
    `<td>${g.bass.median.toFixed(3)}</td>` +
    `<td>${g.mid.median.toFixed(3)}</td>` +
    `<td>${g.treble.median.toFixed(3)}</td></tr>`;
}).join("\n");

const TEXT = {
  KICKER: "WebAudio 频谱驱动的 WebGL 着色器 · 示例站点",
  TRACK_TITLE: "井中月",
  TRACK_SUB: "WELL MOON — DF-07",
  BYLINE: "虚构电子乐企划「暗河 Dark River」。曲子由仓库里的 scripts/synth-track.mjs 确定性合成，不是外部素材：" +
    "每一脚底鼓、每一串噪声的时刻和频率都是已知事实，页面读数才有东西可以对照。",
  BASS_RANGE: BASS, MID_RANGE: MID, TREBLE_RANGE: TREBLE,
  SPLIT_LEAD: "同一份着色器源码，三个子视口只有 uVariant 不同：0 全带、1 只留低频段、2 只留中频段、3 只留高频段。" +
    "三块视口共用一条画布带，所以 uOrigin 必须每块各给一次——gl_FragCoord 是整块画布的窗口坐标，" +
    "不减掉原点，三个视口只是同一张图的三条裁片。",
  SCORE_LEAD: `${spec.facts.samples.toLocaleString("en-US")} 个采样、峰值 ${spec.facts.peakDbfs.toFixed(2)} dBFS。` +
    `全曲 ${counts.kick} 次底鼓、${counts.snare} 次军鼓、${counts.hat + counts["hat-open"]} 次踩镲（其中 ${counts["hat-open"]} 次开镲）、` +
    `${counts.bass} 个贝斯音、${counts.lead} 个主旋律音、1 段上升噪声、1 次落地嗵鼓。第 06 小节是 breakdown：底鼓与贝斯全部缺席。`,
  BAR_ROWS: barRows,
  EVENT_NOTE: "表里的响度/低/中/高四列由 scripts/analyze-node.mjs 独立解析同一份 PCM 得到（自写 radix-2 FFT、Hann 窗），" +
    "与浏览器里 Chrome 的 AnalyserNode 不是同一套实现——两边只在「64 带边界」与「带内取均值」这两个口径上同源，" +
    "两份口径都写在 src/bands.js 与 src/features.js 里，不是两边各抄一遍。",
  BPM: spec.synth.bpm,
  DURATION: spec.synth.durationSec.toFixed(2),
  BARS: spec.synth.bars,
  SAMPLE_RATE: (spec.synth.sampleRate / 1000).toFixed(2) + "k",
  PEAK_DBFS: spec.facts.peakDbfs.toFixed(2),
  CLIPPED: spec.facts.clippedSamples,
  FFT_SIZE: 2048,
  BIN_WIDTH: gt.binWidthHz.toFixed(2),
  BAND_COUNT: BAND_COUNT,
  PROOF_LEAD: "「页面会动」从来不是判据——rAF 自己就会动。本轮把 audio 与 time 拆成两条独立开关，" +
    `每条消融臂只换 query 字符串、不换源码；同一份代码在 ${ABLATIONS.length} 个臂下必须表现出下面这些不同结果，` +
    "否则就说明音频读数根本没进到像素里。",
  ABLATION_ROWS: ablationRows,
  ABLATION_ROWS: ablationRows,
  ABLATION_NOTE: "两条互斥臂必须同向才算数：单独 frozen 画面照变（排除时钟），frozen,noaudio 画面完全静止（排除「还有别的东西在驱动」）。" +
    "只证前者会放过「宿主自己有个隐藏循环」，只证后者会放过「音频其实没接线」——这是本轮唯一不允许只跑一条的判据。",
  DEMO_NOTE: "曲目、企划、文案全部虚构；音频由本仓库脚本合成并以 data URI 内联，页面没有任何外部请求，也没有任何真实投递。" +
    "着色器读数只在本机 headless Chrome + SwiftShader 下取得，不构成任何性能或兼容性主张。",
  FOOT_LINE: `shader × 音频可视化 · 示例产物 · 音频 ${spec.synth.sampleRate} Hz / ${spec.synth.durationSec}s ` +
    `/ 峰值 ${spec.facts.peakDbfs.toFixed(2)} dBFS · 起拍阈值 = 30 帧通量均值 × 1.35 + 0.012`
};

fs.mkdirSync(path.join(ROOT, "preview"), { recursive: true });
const sizes = [];

Object.entries(SKINS).forEach(([name, skin]) => {
  const parsed = parseSkin(skin.cssFile);
  const shader = read(skin.shader);

  /* 双向纪律：着色器声明的非 vec3 uniform 必须都在 SKIN.uniforms 里，反之也是；
   * vec3 令牌由 CSS 提供，不在 uniforms 清单里重复登记。 */
  const declaredNonVec3 = [...shader.matchAll(/uniform\s+(?:float|vec2|sampler2D)\s+(\w+)\s*;/g)].map((m) => m[1]);
  const declaredVec3 = [...shader.matchAll(/uniform\s+vec3\s+(\w+)\s*;/g)].map((m) => m[1]);
  declaredNonVec3.forEach((u) => {
    if (!skin.uniforms.includes(u)) throw new Error(name + "：着色器声明了 " + u + " 但皮肤清单里没有");
  });
  skin.uniforms.forEach((u) => {
    if (!declaredNonVec3.includes(u)) throw new Error(name + "：皮肤清单登记了 " + u + " 但着色器没声明（会被编译器裁掉 → 定位符恒为 null）");
  });
  declaredVec3.forEach((u) => {
    if (!(u in parsed.vec)) throw new Error(name + "：着色器声明了 " + u + " 但皮肤 CSS 没有对应 --gl-* 令牌");
  });

  const bandSpec = { count: BAND_COUNT, edges, coarse: COARSE };
  const host = hostTemplate
    .replace('"{{STYLE_NAME}}"', JSON.stringify(name))
    .replace("{{PALETTE_JSON}}", JSON.stringify(parsed.vec))
    .replace("{{UNIFORM_LIST_JSON}}", JSON.stringify(skin.uniforms))
    .replace("{{SHADER_SOURCE_JSON}}", JSON.stringify(shader))
    .replace("{{BAND_SPEC_JSON}}", JSON.stringify(bandSpec))
    .replace("{{FEATURES_INLINE_EXPR}}", featuresExpr);
  if (/\{\{[A-Z_]+\}\}/.test(host)) throw new Error(name + "：宿主占位符没被替换干净");

  let html = template;
  /* 一律用 replacer 函数：替换串里的 $' / $& 会被当成模式（历轮踩过「文档自我复制」） */
  Object.entries(TEXT).forEach(([key, val]) => { html = html.replaceAll("{{" + key + "}}", () => String(val)); });
  html = html
    .replaceAll("{{UNIFORM_ROWS}}", () => uniformRows(declaredNonVec3.concat(declaredVec3)))
    .replaceAll("{{HOW_LEAD}}", () => skin.howLead)
    .replaceAll("{{BASE_CSS}}", () => baseCss)
    .replaceAll("{{SKIN_CSS}}", () => parsed.css)
    .replaceAll("{{STYLE_NAME}}", () => name)
    .replaceAll("{{STYLE_LABEL}}", () => skin.label)
    .replaceAll("{{TITLE}}", () => "井中月 · " + skin.label)
    .replaceAll("{{AUDIO_DATA_URI}}", () => audioUri)
    .replaceAll("{{HOST_SOURCE}}", () => host);
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) throw new Error(name + "：页面占位符残留 " + leftover.join(","));

  /* 内联脚本里若出现 </script 必须转义，否则 HTML 解析器提前闭合（历轮踩过） */
  const scriptStart = html.indexOf("<script>");
  const payload = html.slice(scriptStart + 8, html.lastIndexOf("</script>"));
  if (/<\/script/i.test(payload)) throw new Error(name + "：内联脚本载荷里有裸 </script，会提前闭合");

  const out = path.join(ROOT, "preview", "visualizer-" + name + ".html");
  fs.writeFileSync(out, html);
  sizes.push({
    style: name,
    label: skin.label,
    file: "preview/visualizer-" + name + ".html",
    bytes: Buffer.byteLength(html),
    scriptPayloadBytes: Buffer.byteLength(payload),
    shaderBytes: Buffer.byteLength(shader),
    skinCssBytes: Buffer.byteLength(parsed.css),
    hostBytes: Buffer.byteLength(host),
    declaredNonVec3,
    declaredVec3,
    glHexes: parsed.hexes,
    skinPalette: parsed.palette
  });
});

fs.writeFileSync(path.join(ROOT, "scripts", "build-sizes.json"), JSON.stringify({
  generated_by: "scripts/build.mjs",
  wavSha256: crypto.createHash("sha256").update(wav).digest("hex"),
  wavBytes: wav.length,
  audioUriBytes: Buffer.byteLength(audioUri),
  featuresBytes: Buffer.byteLength(featuresExpr),
  bandEdges: { count: BAND_COUNT, lo: Number(edges[0].toFixed(3)), hi: Number(edges[edges.length - 1].toFixed(1)) },
  coarseRanges: { bass: BASS, mid: MID, treble: TREBLE },
  ablations: ABLATIONS,
  styles: sizes
}, null, 2));

console.log(sizes.map((s) => `${s.style} ${s.bytes}B script=${s.scriptPayloadBytes}B`).join("  |  ") +
  `\nfeatures IIFE ${Buffer.byteLength(featuresExpr)}B  audio data-uri ${Buffer.byteLength(audioUri)}B`);
