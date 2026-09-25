// 校验脚本：把 sites:sites-building 对个人主页场景的条款转成可机检断言
// 运行：node scripts/check.mjs   （零依赖，只读三页 HTML）
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, "..");
const PAGES = {
  ukiyo: path.join(SCENE, "ukiyo/index.html"),
  astro: path.join(SCENE, "astro/index.html"),
  pixel: path.join(SCENE, "pixel-console/index.html"),
};

let pass = 0, fail = 0;
const fails = [];
function ok(group, id, msg) {
  pass++;
  if (process.env.VERBOSE) console.log(`  ✓ [${group}] ${id} — ${msg}`);
}
function no(group, id, msg, detail) {
  fail++;
  fails.push(`[${group}] ${id} — ${msg}${detail ? " :: " + detail : ""}`);
  console.log(`  ✗ [${group}] ${id} — ${msg}${detail ? " :: " + detail : ""}`);
}
function assert(cond, group, id, msg, detail) {
  cond ? ok(group, id, msg) : no(group, id, msg, detail);
}

const src = {};
const bytes = {};
for (const [k, p] of Object.entries(PAGES)) {
  src[k] = fs.readFileSync(p, "utf8");
  bytes[k] = Buffer.byteLength(src[k]);
}

// ── 共用事实（三页必须讲同一件事，变的只是设计主张）────────────────
const FACTS = {
  name: "柯屿",
  latin: "KE YU",
  mail: "hey@keyu.example",
  projects: ["潮汐", "TideNote", "光斑", "Lumen", "汉字谱", "Typeface Atlas", "字节盒", "Bytebox", "漫游", "Roamer"],
  notes: ["2025-08-14", "2025-05-02", "2024-11-19", "2024-06-07"],
  noteTitles: ["为什么我把设置存成纯文本", "一次重构留下的三个坑", "中文字体的行高怎么调才不抖", "一个人做产品的节奏"],
  visits: "2418",
  since: "2019",
};

// ══ A 组：自包含与零外链（实验室硬约束 + 技能「用 HTML/CSS/SVG 画几何」）
for (const [k, html] of Object.entries(src)) {
  const stripped = html.replace(/xmlns(:xlink)?="[^"]*"/g, "");
  assert(!/<(link|img)\b[^>]*\b(src|href)\s*=\s*["'](?!#)/i.test(stripped), "A", k + "-no-ext-tags", "无外链资源标签（link/img）", (stripped.match(/<(link|img)\b[^>]*/i) || [""])[0]);
  assert(!/<script[^>]+\bsrc=/i.test(html), "A", k + "-no-ext-script", "无外部 script");
  assert(!/\burl\(\s*['"]?(https?:|data:image)/i.test(html), "A", k + "-no-url-asset", "CSS 不引用远程或 base64 位图");
  assert(!/<(iframe|embed|object|video|audio|source)\b/i.test(html), "A", k + "-no-media", "无多媒体外链容器");
  assert(!/@import/i.test(html), "A", k + "-no-import", "无 @import（含 CDN 字体）");
  assert(!/https?:\/\//i.test(stripped), "A", k + "-no-http", "剥掉 xmlns 后正文零 http(s)", (stripped.match(/https?:\/\/\S{0,40}/i) || [""])[0]);
  assert(/<!DOCTYPE html>/i.test(html) && /^<html lang="zh-CN"/m.test(html.replace(/^\s*/, "")), "A", k + "-doctype-lang", "HTML5 doctype + lang=zh-CN");
  const styleBlocks = html.match(/<style>/g) || [];
  const scriptBlocks = html.match(/<script>/g) || [];
  assert(styleBlocks.length === 1 && scriptBlocks.length <= 1, "A", k + "-block-count", "单 <style> + 至多一个内联 <script>", `${styleBlocks.length}/${scriptBlocks.length}`);
  assert(bytes[k] < 40000, "A", k + "-size", "单页 < 40KB", bytes[k] + "B");
}

// ══ B 组：一个连贯的视觉主张（技能：Before the first edit choose ONE visual thesis）
// 做法：每页声明自己的色板，页内出现的任何十六进制色必须属于该色板。
const PALETTES = {
  ukiyo: ["#f4ede2", "#ece2d3", "#e2d5c2", "#2a2521", "#5f5449", "#b8342a", "#3a5a78", "#c9b99f"],
  astro: ["#070b16", "#0b1220", "#e2e6ee", "#949db1", "#c9a24a", "#6fd3e0", "#ff7a6b"],
  pixel: ["#d9d6cd", "#c3bfb3", "#3a3b3c", "#0f380f", "#306230", "#8bac0f", "#9bbc0f", "#e53d2a"],
};
for (const [k, html] of Object.entries(src)) {
  const css = (html.match(/<style>([\s\S]*?)<\/style>/i) || [, ""])[1];
  const hexes = new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()));
  const allowed = new Set(PALETTES[k]);
  for (const a of allowed) {
    for (let i = 4; i <= 7; i++) allowed.add(a.slice(0, i)); // #f4ede2 允许写作 #f4e 形式？仅允许前缀相同的短写
  }
  const rogue = [...hexes].filter((h) => !allowed.has(h) && !isPrefixOfAny(h, PALETTES[k]));
  assert(rogue.length === 0, "B", k + "-palette-closed", "页内十六进制色全部落在声明色板内", rogue.join(","));
  // 主张层面：三页各自的核心手法必须出现且只出现在该页
  const thesis = {
    ukiyo: /writing-mode:\s*vertical-rl/.test(css),
    astro: /radial-gradient\(\s*1px 1px/.test(css) && /border-collapse/.test(css),
    pixel: /box-shadow:\s*\d+px \d+px 0/.test(css) && !/border-radius:\s*[1-9]/.test(css),
  };
  assert(thesis[k], "B", k + "-thesis-signature", "该风格签名手法在场");
}
function isPrefixOfAny(h, palette) {
  return palette.some((p) => p.toLowerCase().startsWith(h) && h.length >= 4);
}
// 三页不得只是换色：字族栈、栅格、分隔手法至少两项互异
const cssOf = (k) => (src[k].match(/<style>([\s\S]*?)<\/style>/i) || [, ""])[1];
const fingerprint = (k) => ({
  font: (cssOf(k).match(/--(?:sans|serif|mono):[^;]+/) || [""])[0].replace(/\s+/g, ""),
  grid: (cssOf(k).match(/grid-template-columns:[^;]+/g) || []).join("|").replace(/\s+/g, ""),
  radius: (cssOf(k).match(/border-radius:[^;]+/g) || []).join("|"),
  family: (cssOf(k).match(/font-family:[^;]+/g) || []).join("|").replace(/\s+/g, ""),
  table: /<table/.test(src[k]),
  vertical: /writing-mode:\s*vertical/.test(src[k]),
  blocks: /class="blocks"/.test(src[k]),
});
const FP = { ukiyo: fingerprint("ukiyo"), astro: fingerprint("astro"), pixel: fingerprint("pixel") };
const pairDiff = (a, b) => ["grid", "family", "radius", "table", "vertical", "blocks"].filter((key) => String(FP[a][key]) !== String(FP[b][key]));
for (const [a, b] of [["ukiyo", "astro"], ["ukiyo", "pixel"], ["astro", "pixel"]]) {
  const d = pairDiff(a, b);
  assert(d.length >= 3, "B", `diff-${a}-${b}`, "两风格在版式/字族/结构上至少 3 处不同", d.join(","));
}
for (const k of Object.keys(FP)) {
  for (const m of Object.keys(PALETTES)) {
    if (k === m) continue;
    const inter = PALETTES[k].filter((c) => PALETTES[m].includes(c));
    assert(inter.length === 0, "B", `palette-disjoint-${k}-${m}`, "两色板零交集", inter.join(","));
  }
}

// ══ C 组：排版底线（技能：正文 ≥16px、标签约 14px、更小只留给次要元数据）
for (const [k, html] of Object.entries(src)) {
  const css = cssOf(k);
  const body = (css.match(/body\{[\s\S]*?\}/) || [""])[0];
  const bs = parseFloat((body.match(/font-size:\s*([\d.]+)px/) || [, "0"])[1]);
  assert(bs >= 16, "C", k + "-body-16", "body 字号 ≥16px", bs + "px");
  const sizes = (css.match(/font-size:\s*([\d.]+)px/g) || []).map((s) => parseFloat(s.match(/[\d.]+/)[0]));
  const sub12 = sizes.filter((s) => s < 12);
  assert(sub12.length === 0, "C", k + "-no-tiny", "无小于 12px 的字号", sub12.join(","));
  assert(/line-height:\s*1\.[5-9]|line-height:\s*[2-9]/.test(css), "C", k + "-leading", "行高 ≥1.5 或绝对值 ≥20");
  assert(/-webkit-text-size-adjust:\s*100%/.test(css), "C", k + "-textsize", "保留文字缩放（不用 px 锁死）");
  const pxCount = (css.match(/\d+px/g) || []).length;
  const remCount = (css.match(/[\d.]+rem/g) || []).length;
  assert(remCount >= 10, "C", k + "-relative", "用相对单位承载间距（rem 出现 ≥10 次）", `rem=${remCount} px=${pxCount}`);
}

// ══ D 组：可访问性与键盘行为（技能：accessible labels / keyboard / meaningful focus）
for (const [k, html] of Object.entries(src)) {
  const css = cssOf(k);
  assert(/:focus-visible/.test(css), "D", k + "-focus", "有独立于验证工具的 focus-visible 样式");
  assert(/class="skip"/.test(html) && /#main/.test(html), "D", k + "-skip", "跳转正文的 skip link");
  assert(/<header[\s>]/.test(html) && /<main[\s>]/.test(html) && /<footer[\s>]/.test(html), "D", k + "-landmarks", "header/main/footer 地标");
  assert(/<time datetime="\d{4}-\d{2}-\d{2}"/.test(html), "D", k + "-time", "日期用 <time datetime>");
  assert(/<title>[^<]{6,}</.test(html) && /name="description" content="[^"]{20,}/.test(html), "D", k + "-meta", "真实的 title 与 description（非模板占位）");
  assert(/<meta name="viewport"/.test(html), "D", k + "-viewport", "viewport 声明");
  const svgs = html.match(/<svg\b[^>]*>/g) || [];
  const bad = svgs.filter((s) => !/aria-hidden="true"/.test(s) && !/role="img"/.test(s));
  assert(bad.length === 0, "D", k + "-svg-announced", "每个内联 SVG 要么装饰性隐藏要么 role=img（无 SVG 亦通过）", bad.join(" "));
  if (/<svg[^>]*role="img"/.test(html)) assert(/aria-label="[^"]+"/.test(html), "D", k + "-svg-label", "信息型 SVG 带 aria-label");
  const btn = html.match(/<button[\s\S]*?<\/button>/g) || [];
  assert(btn.every((b) => /type="button"/.test(b) && /[一-龥A-Za-z]/.test(b.replace(/<[^>]+>/g, ""))), "D", k + "-button", "按钮有 type 与可读文本");
  if (/<table/.test(html)) {
    assert(/<caption>/.test(html) && /<th scope="col"/.test(html), "D", k + "-table-a11y", "表格有 caption 与 th scope");
  }
  assert(/@media/.test(css), "D", k + "-responsive", "有窄屏媒体查询");
  assert(/<svg\b/.test(html) || k === "pixel", "D", k + "-geometry", "几何/装饰用内联 SVG 或纯 CSS，不用位图");
  assert(/prefers-reduced-motion/.test(css) || !/animation|transition:/.test(css), "D", k + "-motion", "动效受限偏好已尊重（或本就无动效）");
}

// ══ E 组：内容事实一致（三种设计讲同一份事实，防「换皮时改数据」）
for (const [k, html] of Object.entries(src)) {
  const norm = html.replace(/,/g, "");
  for (const f of [FACTS.name, FACTS.mail, FACTS.since]) assert(norm.includes(f), "E", `${k}-fact-${f}`, "共用事实在场：" + f);
  for (const p of FACTS.projects) assert(norm.includes(p), "E", `${k}-proj-${p}`, "项目名在场：" + p);
  for (const d of FACTS.notes) assert(norm.includes(d), "E", `${k}-date-${d}`, "日志日期在场：" + d);
  for (const t of FACTS.noteTitles) assert(norm.includes(t), "E", `${k}-title`, "日志标题在场：" + t);
  assert(norm.includes("2418"), "E", k + "-visits", "访问量数字三页一致", "");
  assert((norm.match(/hey@keyu\.example/g) || []).length >= 2, "E", k + "-mail-twice", "mailto 与复制用的邮箱同源");
}
// 卡带格数必须与标注小时数自洽（技能：不要把示例数据呈现成真实后端结果，且不得硬编码派生值）
{
  const pixel = src.pixel;
  const rows = [...pixel.matchAll(/<div class="gauge">[\s\S]*?class="blocks"[^>]*>([\s\S]*?)<\/span><span>([\d.]+)h\/周/g)];
  assert(rows.length === 5, "E", "pixel-gauge-rows", "五张卡带都有格数与小时", String(rows.length));
  const bad = rows.filter(([, blocks, h]) => {
    const on = (blocks.match(/class="on"/g) || []).length;
    return on !== Math.min(5, Math.max(0, Math.round(parseFloat(h) / 5)));
  });
  assert(bad.length === 0, "E", "pixel-gauge-math", "格数 = round(每周小时 / 5)", bad.map((b) => b[2] + "h").join(","));
}

// ══ F 组：反功能膨胀（技能：Polished 不授权额外的路由/表单/搜索/分享/鉴权/持久化）
for (const [k, html] of Object.entries(src)) {
  assert(!/<form[\s>]/i.test(html), "F", k + "-no-form", "无表单");
  assert(!/<(input|select|textarea)\b/i.test(html), "F", k + "-no-field", "无输入控件");
  assert(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), "F", k + "-no-store", "无浏览器存储持久化");
  assert(!/\bfetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/.test(html), "F", k + "-no-net", "无网络请求");
  assert(!/<(h1)[^>]*>[\s\S]*?<h1/i.test(html), "F", k + "-one-h1", "唯一 h1");
  const ids = html.match(/\bid="[^"]+"/g) || [];
  assert(new Set(ids).size === ids.length, "F", k + "-unique-id", "id 不重复");
  assert((html.match(/<button/g) || []).length <= 1, "F", k + "-one-control", "至多一个交互控件（个人主页不需要更多）");
}
// 内联 JS 必须能解析（历轮教训：语法错误会让整页静默空白）
for (const [k, html] of Object.entries(src)) {
  const m = html.match(/[ \t]*<script>([\s\S]*?)<\/script>/);
  if (m) {
    let err = null;
    try { new vm.Script(m[1], { filename: k + ".inline.js" }); } catch (e) { err = e; }
    assert(!err, "F", k + "-js-syntax", "内联脚本语法有效", err && err.message);
    assert(!/document\.write|innerHTML\s*=/.test(m[1]), "F", k + "-no-sink", "无 document.write / innerHTML 写入");
  } else {
    assert(false, "F", k + "-js-syntax", "取到了内联脚本");
  }
}

// ══ G 组：示例数据显式标注（技能：Label local sample data clearly）
for (const [k, html] of Object.entries(src)) {
  assert(/虚构|演示|示例/.test(html), "G", k + "-fiction", "声明本页为虚构演示");
  assert(/示例邮箱|不可送达/.test(html), "G", k + "-mail-labeled", "邮箱标注为示例、不可送达");
  assert(/演示数据|均属示例|均为示例/.test(html), "G", k + "-fixture-labeled", "数值区标注演示数据");
  assert(!/真实|官方合作|已上线\s*\d+\s*万/.test(html), "G", k + "-no-overclaim", "不把 fixture 说成真实结果");
}

// ══ H 组：横向溢出防线（无浏览器时能静态查的部分）
for (const [k, html] of Object.entries(src)) {
  const css = cssOf(k);
  const repeats = css.match(/grid-template-columns:[^;]+/g) || [];
  const loose = repeats.filter((r) => /repeat\(/.test(r) && !/minmax\(\s*0/.test(r));
  assert(loose.length === 0, "H", k + "-grid-min0", "所有 repeat() 栅格用 minmax(0,…) 防长词撑破", loose.join(" | "));
  assert(!/width:\s*[5-9]\d\d px|width:\s*[5-9]\d\dpx/.test(css), "H", k + "-no-wide-fixed", "无 500px 以上固定宽度");
  assert(/max-width/.test(css), "H", k + "-max-width", "容器用 max-width 收口");
  const long = (css.match(/white-space:\s*nowrap/g) || []).length;
  assert(long <= 6, "H", k + "-nowrap-budget", "nowrap 使用有预算（窄屏折行风险）", String(long));
}

// ══ I 组：对照入口存在
{
  const entry = path.join(SCENE, "styles.html");
  assert(fs.existsSync(entry), "I", "entry-exists", "styles.html 对照入口存在");
  if (fs.existsSync(entry)) {
    const e = fs.readFileSync(entry, "utf8");
    for (const p of ["ukiyo/index.html", "astro/index.html", "pixel-console/index.html"]) assert(e.includes(p), "I", "entry-" + p, "入口链到该风格");
    assert(/<iframe/.test(e) === false, "I", "entry-no-iframe", "入口不用 iframe（保持 file:// 可用）");
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log("字节数：" + Object.entries(bytes).map(([k, v]) => `${k}=${v.toLocaleString("en-US")}B`).join("  "));
if (fail) { console.log("\n失败明细：\n" + fails.join("\n")); process.exit(1); }
