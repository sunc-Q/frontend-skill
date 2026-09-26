/* 变异套件：一套「只会被真判据抓住」的故意破坏。
 * 为什么需要它：全绿的断言集只证明「我写的那些字面量和我自己抄的那些字面量相等」。
 * 这里对同一份产物做三类破坏，每一类都必须被指名的那条断言抓住，然后原样还原：
 *   value      —— 改一个数（常数/数据/转录精度）：只有golden类断言能抓
 *   structural —— 破坏一条纪律（少登记一个 uniform、把叠加臂退回单值比较、跨皮肤共享色值）：
 *                 只有不变量/构建期双向核对能抓
 *   semantic   —— 只改文案、数据不动（导语里的小节号、有没有 uTime 的陈述）：
 *                 这两条最初「无人抓住」（探索模式 MUT_EXPLORE=1 会复现这个事实），
 *                 因此补了 D37 与 B16 两条断言；本脚本负责证明它们现在真的在挡。
 * 用法：node scripts/mutate.mjs            # 正式模式，要求每条都被抓住
 *       MUT_EXPLORE=1 node scripts/mutate.mjs   # 探索模式：允许语义变异逃逸（用来发现判据缺口）
 * 退出码 0 = 变异集与判据一一对应且还原后与基线完全一致 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EXPLORE = process.env.MUT_EXPLORE === "1";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);

const MUTATIONS = [
  /* ---------- A 类：改一个数 ---------- */
  { id: "V1", kind: "value", file: "src/features.js", build: true,
    from: "export const DB_CEIL = -10;", to: "export const DB_CEIL = -12;",
    expect: ["D16"], note: "换窗口上限却不动反事实证据" },
  { id: "V2", kind: "value", file: "src/features.js", build: true,
    from: "export const ONSET_FACTOR = 1.35;", to: "export const ONSET_FACTOR = 1.5;",
    expect: ["D25", "D26"], note: "改阈值常数，页面脚注还写着 1.35" },
  { id: "V3", kind: "value", file: "src/bands.js", build: true,
    from: '{ name: "mid", from: 12, to: 34 },', to: '{ name: "mid", from: 12, to: 35 },',
    expect: ["D12"], note: "粗带边界挪一格，Node 真值里的划分没跟着挪" },
  { id: "V4", kind: "value", file: "src/audio-spec.json", build: true,
    from: '      "kick": 20,', to: '      "kick": 18,',
    expect: ["D6"], note: "手抄的打击乐计数与时刻数组脱钩" },
  { id: "V5", kind: "value", file: "evidence/ground-truth.json", build: true,
    from: '"frameCount": 1371', to: '"frameCount": 1400',
    expect: ["D9"], note: "解析帧数被改，而 hop/FFT/时长推出的是 1371" },
  { id: "V6", kind: "value", file: "scripts/build.mjs", build: true,
    from: "`<td>${g.bass.median.toFixed(3)}</td>`", to: "`<td>${g.bass.median.toFixed(2)}</td>`",
    expect: ["D29"], note: "逐小节表少写一位小数（肉眼看不出，对账看得出）" },

  /* ---------- B 类：破坏一条纪律 ---------- */
  { id: "S1", kind: "structural", file: "src/shaders/colonnade.glsl", build: true,
    from: "uniform sampler2D uSpectrum;", to: "uniform sampler2D uSpectrum;\nuniform float uUnused;",
    expectBuild: true, note: "着色器声明了宿主没登记的 uniform（会被编译器裁掉 → 定位符 null）" },
  { id: "S2", kind: "structural", file: "src/host.js", build: true,
    from: 'if (has("staticspectrum")) {', to: 'if (probe === "staticspectrum") {',
    expectBuild: true, note: "消融臂退回单值比较：构建期的「臂清单 == 宿主 has() 集」双向核对当场就炸（B13/B14 是第二层）" },
  { id: "S3", kind: "structural", file: "src/host.js", build: true,
    from: "gl.uniform2f(locations.uOrigin, x, 0);", to: "gl.uniform2f(locations.uOrigin, 0, 0);",
    expect: ["B12"], note: "三块子视口共用原点 → 只是同一张图的三条裁片" },
  { id: "S4", kind: "structural", file: "src/css/skin-ripple.css", build: true,
    from: "--gl-ink: #050a12;", to: "--gl-ink: #23281f;",
    expect: ["C4"], note: "两页共享一个色值 → 「换皮」而不是「换风格」" },
  { id: "S5", kind: "structural", file: "src/css/base.css", build: true,
    from: "@media (max-width: 720px) {", to: ".mutant { color: #123456; }\n@media (max-width: 720px) {",
    expect: ["C2"], note: "结构层混进字面颜色 → 皮肤令牌不再是唯一色源" },
  { id: "S6", kind: "structural", file: "scripts/build.mjs", build: true,
    from: '  uLevel: ["float", "64 带均方根", "0 – 1"],\n', to: "",
    expectBuild: true, note: "页面 uniform 表少一行（表与代码漂移）" },
  { id: "S7", kind: "structural", file: "src/host.js", build: true,
    from: 'if (has("noaudio")) return;                 /* 拔掉音频：历史不推进，画面必须停 */',
    to: "/* 变异：拔掉守卫，历史照推进 */",
    expect: [], expectBrowser: "L4",
    note: "只拔音频不拔历史：静态判据全无反应，只有互斥消融臂（frozen,noaudio 像素必须零变化）能抓" },
  { id: "S8", kind: "structural", file: "src/host.js", build: true,
    from: "function has(name) { return probes.indexOf(name) >= 0; }",
    to: "function has(name) { return probes[0] === name; }",
    expect: EXPLORE ? [] : ["B13"], expectBrowser: "L3/L4",
    note: "叠加臂退回「只认第一个」：?probe=frozen,noaudio 里 noaudio 静默失效。补强 B13（把 has() 的函数体形状也锁上）之前，静态判据毫无反应" },

  /* ---------- C 类：只改文案（语义变异） ---------- */
  { id: "X1", kind: "semantic", file: "scripts/build.mjs", build: true,
    from: "第 06 小节是 breakdown", to: "第 03 小节是 breakdown",
    expect: EXPLORE ? [] : ["D37"], note: "导语指错小节：结构校验全绿，事实核对才抓得住" },
  { id: "X2", kind: "semantic", file: "scripts/build.mjs", build: true,
    from: "主画面刻意没有 uTime", to: "主画面刻意有 uTime",
    expect: EXPLORE ? [] : ["B16"], note: "陈述与着色器实际声明相反（colonnade 根本没有 uTime）" }
];

function run(script) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function failIds(out) {
  return new Set(out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => /^FAIL ([A-F]\d+)/.exec(l)[1]));
}
function firstError(out) {
  const m = /Error: (.+)/.exec(out);
  return m ? m[1].slice(0, 140) : out.split("\n").filter(Boolean).slice(-1)[0].slice(0, 140);
}

console.log("模式：" + (EXPLORE ? "探索（允许语义变异逃逸，用来发现判据缺口）" : "正式（每条变异都必须被指名抓住）"));
console.log("== 基线 ==");
const baseNode = run("check-node.mjs");
const baseline = failIds(baseNode.out);
console.log("check-node 基线失败项：" + ([...baseline].join(",") || "无") + "（E 组在台账写回前本就该红）");

const results = [];
let restoreChanged = false;
for (const m of MUTATIONS) {
  const original = read(m.file);
  const hits = original.split(m.from).length - 1;
  if (hits !== 1) {
    results.push({ id: m.id, ok: false, why: "锚点在 " + m.file + " 里出现 " + hits + " 次（变异脚本自身失效，不能假设抓住）" });
    console.log("FAIL " + m.id + " 锚点不唯一（" + hits + "）");
    continue;
  }
  write(m.file, original.replace(m.from, () => m.to));
  let caughtBy = [], okFlag = false, buildErr = "";
  if (m.build) {
    const b = run("build.mjs");
    if (b.code !== 0) {
      buildErr = firstError(b.out);
      caughtBy = ["build:throw"];
    }
  }
  if (!caughtBy.length) {
    const c = run("check-node.mjs");
    const delta = [...failIds(c.out)].filter((x) => !baseline.has(x));
    caughtBy = delta;
  }
  if (m.expectBuild) okFlag = caughtBy[0] === "build:throw";
  else if (m.expect.length === 0) okFlag = m.expectBrowser ? caughtBy.length === 0 : caughtBy.length > 0;
  else okFlag = m.expect.every((x) => caughtBy.includes(x));
  write(m.file, original);
  if (read(m.file) !== original) restoreChanged = true;
  if (m.build) { const b = run("build.mjs"); if (b.code !== 0) restoreChanged = true; }
  results.push({
    id: m.id, kind: m.kind, file: m.file, note: m.note,
    expected: m.expectBuild ? ["build:throw"] : (m.expect.length ? m.expect : (m.expectBrowser ? ["(静态无反应) → " + m.expectBrowser] : ["任何新增失败"])),
    caughtBy, buildErr, ok: okFlag
  });
  console.log((okFlag ? "PASS " : "FAIL ") + m.id + " [" + m.kind + "] " + m.note +
    " → " + (caughtBy.length ? caughtBy.join(",") : (m.expectBrowser ? "静态判据无反应（预期，由 check-browser " + m.expectBrowser + " 挡）" : "无人抓住")));
}

console.log("\n== 还原后复跑 ==");
const after = run("check-node.mjs");
const afterFails = [...failIds(after.out)].sort();
const sameSet = afterFails.sort().join() === [...baseline].sort().join();
console.log("还原后失败项：" + (afterFails.join(",") || "无"));
console.log("与基线一致：" + (sameSet && !restoreChanged ? "是" : "否"));

const bad = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(ROOT, "evidence", "mutation-" + (EXPLORE ? "explore" : "strict") + ".json"), JSON.stringify({
  generated_by: "scripts/mutate.mjs",
  mode: EXPLORE ? "explore" : "strict",
  baseline_fails: [...baseline],
  restored_fails: afterFails,
  restored_identical: sameSet && !restoreChanged,
  count: results.length,
  caught: results.filter((r) => r.ok).length,
  mutations: results
}, null, 2));
console.log("\n== mutate: " + results.length + " 个变异，抓住 " + results.filter((r) => r.ok).length + "，漏 " + bad.length + " ==");
if (bad.length) { console.log(bad.map((r) => " - " + r.id + " 期望 " + JSON.stringify(r.expected) + " 实得 " + JSON.stringify(r.caughtBy)).join("\n")); process.exit(1); }
if (!(sameSet && !restoreChanged)) { console.log("还原后状态与基线不一致，视为失败"); process.exit(1); }
