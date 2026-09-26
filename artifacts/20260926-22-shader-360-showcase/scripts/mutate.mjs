/* 变异臂：验证的不是页面，而是「验证本身」。每个臂只改一个字节级事实，
 * 然后要求指定的那条判据必须变红——红在别处不算抓住，红在该判据才算它有牙。
 * 用法：node scripts/mutate.mjs   （只在 .tmp 副本里动手，产物目录零污染） */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const LAB = path.resolve(ROOT, "..", "..");
const STYLES = ["vitrine", "plaque", "industrial"];

const ARMS = [
  {
    id: "M-hardcoded-number", stage: "src", suite: "node",
    file: "src/body.html",
    from: '<figcaption class="stage-cap" data-i18n="stageCaption"></figcaption>',
    to: '<figcaption class="stage-cap" data-i18n="stageCaption">700ml</figcaption>',
    expect: "DOM文本节点零数字", note: "把数字写进 DOM 骨架 → 单一事实源断言必须红",
  },
  {
    id: "M-face-shift", stage: "src", suite: "node",
    file: "src/shaders/geometry.glsl",
    from: "const float ZONE_SPOUT_X = 0.600000;",
    to: "const float ZONE_SPOUT_X = 0.550000;",
    expect: "G/G-GLSL每个标量常量都在JSON里", note: "分区阈值挪到 JSON 之外 → 镜像断言必须红",
  },
  {
    id: "M-shared-geometry", stage: "built", suite: "node",
    file: "preview/showcase-plaque.html",
    from: "const float BODY_R = 0.580000;",
    to: "const float BODY_R = 0.600000;",
    expect: "C-geometry三页相同", note: "偷偷改一皮肤的几何 → 逐字节共用断言必须红",
  },
  {
    id: "M-time-leak", stage: "built", suite: "node",
    file: "preview/showcase-vitrine.html",
    from: "t += max(d, MARCH_MIN_STEP);",
    to: "t += max(d, MARCH_MIN_STEP) * (1.0 + 0.02 * uTime);",
    expect: "H-几何段零uTime", note: "让动画相位污染求交 → 冻结时钟断言必须红",
  },
  {
    id: "M-shading-frozen", stage: "src", suite: "browser",
    file: "src/shaders/geometry.glsl",
    from: "float spoutFace(vec3 pos) { return zoneFace(pos) * step(ZONE_SPOUT_X, pos.x); }",
    to: "float spoutFace(vec3 pos) { return 1.0; }",
    expect: "分区色心跟随壶嘴面", blind: "分区常亮（不随视角转）",
    note: "把朝向门控整个去掉：着色不再随方位变化。色心/色和判据全绿 = 只测了「分了区」，没测「分区在转」。",
  },
  {
    id: "M-facing-half-turn", stage: "src", suite: "browser",
    file: "src/shaders/geometry.glsl",
    from: "float ca = cos(uAzimuth), sa = sin(uAzimuth);",
    to: "float ca = cos(uAzimuth + 3.14159265), sa = sin(uAzimuth + 3.14159265);",
    expect: "分区色心跟随壶嘴面", blind: "朝向相位反 180°（镀色面长在背面）",
    note: "剪影/几何一个像素都不动，只有着色翻到背面。全绿即证明 alpha 类判据看不见着色手性。",
  },
  {
    id: "M-plaque-shimmers", stage: "src", suite: "browser",
    file: "src/shaders/shade-plaque.glsl",
    from: "vec3 col = base * (0.34 + 0.52 * ndl + 0.14 * up) * ao;",
    to: "vec3 col = base * (0.34 + 0.52 * ndl + 0.14 * up) * ao * (1.0 + 0.05 * sin(uTime));",
    expect: "uTime 完全无影响", note: "哑光石膏皮肤偷偷长出呼吸高光 → 冻结时钟下换 uTime 像素必须不动，这条浏览器判据必须红（证明着色像素确实在被看）",
  },
  {
    id: "M-fake360", stage: "built", suite: "browser",
    file: "preview/showcase-vitrine.html",
    from: "gl.uniform1f(loc.uAzimuth, state.lastUniforms.uAzimuth);",
    to: "gl.uniform1f(loc.uAzimuth, 0.0);",
    expect: "实测锚点=声明锚点", note: "假 360°：读数在动、像素不动 → 三向核对必须红",
  },
];

const results = [];
for (const arm of ARMS) {
  const dir = path.join(LAB, ".tmp", `mutate-${arm.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  for (const sub of ["src", "scripts", "preview", "shots", "evidence"]) {
    const from = path.join(ROOT, sub);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, sub), { recursive: true });
  }
  const target = path.join(dir, arm.file);
  const orig = fs.readFileSync(target, "utf8");
  if (!orig.includes(arm.from)) { results.push({ id: arm.id, blind: arm.blind || null, caught: false, why: "变异锚点未命中：" + arm.from }); continue; }
  fs.writeFileSync(target, orig.replace(arm.from, arm.to));
  // src 级变异要重建才进得了产物；built 级变异本身就是产物，重建会把手改的东西冲掉
  if (arm.stage === "src") {
    const b = spawnSync("node", ["scripts/build.mjs"], { cwd: dir, encoding: "utf8" });
    if (b.status !== 0) { results.push({ id: arm.id, caught: false, why: "构建在变异后失败：" + b.stderr.slice(0, 120) }); continue; }
  }
  const suite = arm.suite === "node" ? "check-node" : "check-browser";
  const args = [`scripts/${suite}.mjs`, ...(suite === "check-node" ? ["--skip-styles"] : [])];
  const run = spawnSync("node", args, { cwd: dir, encoding: "utf8", maxBuffer: 64e6 });
  let out = null;
  try { out = JSON.parse(run.stdout.trim().split("\n").pop()); } catch { /* 下面按未捕获处理 */ }
  const failedIds = out ? out.fails.map((f) => f.split(" → ")[0]) : [];
  const caught = Boolean(out) && out.fail > 0 && failedIds.some((f) => f.includes(arm.expect));
  results.push({
    id: arm.id, suite, expect: arm.expect, note: arm.note, blind: arm.blind || null,
    caught, exitStatus: run.status, failedCount: out ? out.fail : -1,
    firstFails: failedIds.slice(0, 3),
  });
  console.log(`${arm.blind ? (caught ? "BLIND-BUT-CAUGHT" : "gap    ") : caught ? "caught " : "MISSED "}  ${arm.id}  [${suite}]  红 ${out ? out.fail : "?"} 条，命中「${arm.expect}」${caught || arm.blind ? "" : " ✗"}`);
}
// 变异副本只活在 .tmp 里，逐个臂清干净；playwright 的 node_modules 由收尾步骤统一处理
for (const arm of ARMS) {
  const dir = path.join(LAB, ".tmp", `mutate-${arm.id}`);
  if (dir.startsWith(path.join(LAB, ".tmp")) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
const caught = results.filter((r) => r.caught).length;
// blind 臂是「已知判据够不着」的缺口，故意留着：它们必须仍然漏，漏了才算把边界写在账上；
// 哪天补上了能抓的判据，这条臂就该摘掉 blind 标签转成常规臂。
const gaps = results.filter((r) => r.blind);
const badMissed = results.filter((r) => !r.caught && !r.blind).map((r) => r.id);
const staleBlind = gaps.filter((r) => r.caught).map((r) => r.id);
fs.writeFileSync(path.join(ROOT, "evidence", "mutation-report.json"),
  JSON.stringify({ arms: ARMS.length, caught, gaps: gaps.length,
    blindArms: gaps.map((r) => ({ id: r.id, gap: r.blind, caught: r.caught })), results }, null, 2) + "\n");
console.log(JSON.stringify({ suite: "mutate", arms: ARMS.length, caught, gaps: gaps.map((r) => r.id), badMissed, staleBlind }));
process.exit(badMissed.length === 0 && staleBlind.length === 0 ? 0 : 1);
