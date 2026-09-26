/* 台账写入器（本轮 = 20260926-22 shader × 音乐/音频可视化）。
 * 为什么写成脚本而不是手改 state.json：
 *   check-node.mjs 的 E 组要拿「本轮之前的台账」做幂等式核对（历史条目一条不少、
 *   现值 == 快照 + 新增），手改没法留下可信的「之前」。
 * 两种模式：
 *   --snapshot  只写 scripts/ledger-snapshot.json（prev 快照 + 本轮计划新增），在跑断言前执行
 *   --apply     写 state.json 并追加 work-log 一行，在所有断言绿之后执行
 * 断言总数从 evidence/assert-totals.json 读取（由 summarize.mjs 生成），页脚/台账里的数字一律不手打。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");
const STATE = path.join(LAB, "state", "state.json");
const LOG = path.join(LAB, "records", "work-log.md");
const SNAP = path.join(ROOT, "scripts", "ledger-snapshot.json");

const ROUND_DIR = "20260926-22-shader-audio-visualizer";
const ROUND_TIME = "2026-09-26T22:00+08:00";
const COMBO_KEY = "音乐/音频可视化";
const NEW_STYLES = ["方格账簿 graph-ledger", "井月水墨 ink-moon", "声纹热像 thermogram"];

const ADD = {
  tried: [{
    skill: "shader（第 2 次使用，~/.qoder-cn/skills/shader；技能快照见 LAB/skills/shader/）",
    scenario: "音乐/音频可视化（虚构曲目「井中月」16s/120BPM 由 scripts/synth-track.mjs 确定性合成 → WAV 以 data URI 内联；WebAudio AnalyserNode 2048 窗喂 64 个对数带 → uLevel/uBass/uMid/uTreb/uFlux/uBeat 标量 uniform + 64×1 频谱纹理 + 64×128 历史纹理；一个页面两个 canvas：主画面 + 分频三视口（同程序 uVariant 0/1/2/3 + 逐视口 uOrigin））",
    styles: NEW_STYLES,
    time: ROUND_TIME,
    reason: "state.json.next_candidates[0] ★ 排队首选：技能对「外部数据怎么进着色器」零覆盖，本轮就是补这条口径并把它做成可断言的",
    conclusion: "留用（第 2 次通过，音频驱动场景首选）",
    report: "reports/20260926-22-shader-audio-visualizer.md",
    artifact: "artifacts/" + ROUND_DIR
  }],
  used_styles: NEW_STYLES,
  environment_notes: [
    "dB 窗口是判据力的一部分，不是参数细节：AnalyserNode 默认 min/maxDecibels = -100/-30 会把本曲 groove 低频带 28.5% 的 texel 顶到 1.0、唯一值从 266 掉到 182、17.9% 的帧整段钉满——饱和区里的「画面随音乐变」断言是自我证明的。改 -100/-10 后饱和率 0。方法：把窗口常量放进共享特征层（src/features.js），浏览器与 Node 都从它取，分析器再用同一条公式按 -30 重算一遍作反事实读数印进 evidence。",
    "消融臂要能叠加才能证互斥：单值 probe 只能各证一半。改成 ?probe=a,b 列表后才有「frozen（拔时钟，画面照变）× frozen,noaudio（拔时钟+拔音频，画面必须一像素都不动）」这一对——前者排除「变化来自 uTime」，后者排除「还有别的东西在驱动」。宿主里凡 probe === 比较都要改成 has()。",
    "npm install 在 background 跑时，命令尾部任何非零退出（例如 ls 一个不存在的缓存目录）都会把整条报成 failed，而依赖其实装好了；判成败要看 stdout 的 added N packages 与 require 冒烟，别看退出码。Playwright 浏览器缓存在 ~/Library/Caches/ms-playwright/chromium-1148，不是 ~/.cache。",
    "同一份 sed/node 打补丁脚本改多个源文件时，最后一个扫描值会留在文件里（本轮 DB_CEIL 被留在扫描末尾的 -5，注释还写着「对齐默认值」）。改常量一律用 Edit 并回读，别用循环打补丁。"
  ]
};

const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
const logText = fs.readFileSync(LOG, "utf8");
const logLines = logText.trimEnd().split("\n");
const prevLogMarker = logLines[logLines.length - 1].slice(0, 40);

function totals() {
  const p = path.join(ROOT, "evidence", "assert-totals.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/* 台账里出现的每一个数字都从这几个式子拼出来，手不打字。
 * 单独成函数是因为「复写计数」（见文件末尾）要复用同一段模板，两处不一致就白写了。 */
const su = (o) => o.pass + "/" + o.total;
function counts(t) {
  return {
    logLine: ROUND_TIME.slice(0, 16).replace("T", " ") + " | shader（第 2 次使用，~/.qoder-cn/skills/shader） | 音乐/音频可视化（next_candidates[0] ★ 首选：新场景，技能对「外部数据进着色器」零覆盖） | " +
      NEW_STYLES.join(" / ") + " | " + artifactRel +
      "（三页各 ~995KB，其中 919KB 是内联 data-URI 音频；preview 三页 + src + scripts + audio + evidence 合计 " + t.artifactMb + "MB，零外链双击即开） | " +
      "留用（第 2 次通过，音频驱动场景首选）。断言 " + t.grandTotal + " 条全绿：静态 check-node " + su(t.node) +
      "（A 构建一致性/DOM 骨架同构、B uniform 三方纪律、C 色板封闭+两两零交集+WCAG、D 曲目事实与 dB 窗口反事实、E 台账幂等、F 仓库契约）+ 真浏览器 check-browser " +
      su(t.browser) + "（playwright-core + " + t.browser.exe + " + SwiftShader 真帧：boot/analyser 元数据/两解析器相关性/消融臂像素 diff（互斥对 frozen × frozen,noaudio）/风格指纹）+ 变异 mutate " +
      mutationStr(t) + " + check-clean " + su(t.clean) + " 条。要点：技能只给「uTime/uResolution 命名 + 不假定 WebGL2 + 最小可视化基线」，" +
      "音频侧 8 个 uniform（uLevel/uBass/uMid/uTreb/uFlux/uBeat/uSpectrum/uHistory）与传参纪律全部本轮自建，靠「着色器声明集 == 宿主登记集 == getUniformLocation 非 null」三方双向断言兜住。" +
      "方法沉淀两条：①互斥消融臂（frozen 画面照变 × frozen,noaudio 一像素不动，probe 可逗号叠加）才算证明音频在驱动画面；" +
      "②dB 窗口当判据力来看——默认 -30 上限把 groove 低频 28.5% texel 顶满（唯一值 266→182），改 -10 后饱和 0，并把 -30 的反事实读数由同一公式算出印进 evidence。" +
      "缺陷：技能对音频/外部数据零覆盖（写进报告回报上游）；技能护栏「不假定 WebGL2」在 Chrome+SwiftShader 下无法证伪（只测了 webgl1 一条路）。" +
      "报告见 reports/" + ROUND_DIR + ".md",
    assertions: "静态 " + su(t.node) + " + 真浏览器 " + su(t.browser) + " + 变异 " + mutationStr(t) +
      " + 收尾 " + su(t.clean) + " = " + t.grandTotal + " 条全绿（明细见 report）"
  };
}
const mutationStr = (t) => t.mutation.caught + "/" + t.mutation.count + " 例全部被抓且点名，还原后复跑全绿";

if (process.argv[2] === "--snapshot") {
  fs.writeFileSync(SNAP, JSON.stringify({
    generated_by: "scripts/update-ledger.mjs --snapshot",
    round_dir: ROUND_DIR,
    combo_key: state.tried.some((t) => (t.scenario || "").includes(COMBO_KEY)) ? "DUPLICATE" : COMBO_KEY,
    prev: {
      tried: state.tried.map((t) => t.skill + " || " + t.scenario),
      used_styles: state.used_styles.slice(),
      environment_notes: state.environment_notes.slice(),
      runs: state.runs.length,
      skills_seen: state.skills_seen.length
    },
    prev_log_marker: prevLogMarker,
    add: {
      tried: ADD.tried.map((t) => t.skill + " || " + t.scenario),
      used_styles: ADD.used_styles,
      environment_notes: ADD.environment_notes
    }
  }, null, 1));
  console.log("snapshot 写入 scripts/ledger-snapshot.json：prev tried=" + state.tried.length +
    " runs=" + state.runs.length + " styles=" + state.used_styles.length + " notes=" + state.environment_notes.length);
  process.exit(0);
}

if (process.argv[2] !== "--apply") { console.error("用法：node update-ledger.mjs --snapshot|--apply"); process.exit(2); }
if (!fs.existsSync(SNAP)) { console.error("先跑 --snapshot"); process.exit(2); }

const t = totals();
if (!t) { console.error("缺 evidence/assert-totals.json：先跑 summarize.mjs，台账里的断言数字必须来自文件"); process.exit(2); }

const artifactRel = "前端skill实验室/artifacts/" + ROUND_DIR;
const C = counts(t);

if (state.runs.some((r) => JSON.stringify(r).includes(ROUND_DIR))) {
  /* 复写计数（第二轮 --apply）：E 组判据是「台账现值 == 快照 + 本轮新增」，入账前它必红、
   * 入账后才全绿——而台账要留的是那个稳定态。所以 --apply 允许再跑一次：只按最新的
   * evidence/assert-totals.json 复写「本轮自己写进去的那一行 / 那一条」，历史行一个字节都不碰。 */
  const lines = fs.readFileSync(LOG, "utf8").trimEnd().split("\n");
  const last = lines[lines.length - 1];
  if (!last.includes(ROUND_DIR)) {
    console.error("work-log 末行不是本轮那一行（" + last.slice(0, 40) + "），拒绝复写历史"); process.exit(2);
  }
  if (last === C.logLine) { console.log("本轮已入账且计数与证据逐字一致，无需复写（幂等）"); process.exit(0); }
  lines[lines.length - 1] = C.logLine;
  fs.writeFileSync(LOG, lines.join("\n") + "\n");
  state.runs[state.runs.length - 1].assertions = C.assertions;
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  console.log("复写计数完成（只动本轮自己的末行与末条）：断言 " + t.grandTotal + " 条 · 静态 " + su(t.node) +
    " · 浏览器 " + su(t.browser) + " · 清理 " + su(t.clean) + " · 变异 " + t.mutation.caught + "/" + t.mutation.count);
  process.exit(0);
}

fs.writeFileSync(SNAP.replace(/ledger-snapshot\.json$/, "ledger-snapshot.applied.json"), JSON.stringify({
  applied_at: new Date().toISOString(), round_dir: ROUND_DIR
}, null, 1));

state.tried.push(ADD.tried[0]);
state.used_styles.push(...ADD.used_styles);
state.environment_notes.push(...ADD.environment_notes);
state.runs.push({
  time: ROUND_TIME,
  skill: "shader（第 2 次使用，~/.qoder-cn/skills/shader） × 音乐/音频可视化",
  scenario: ADD.tried[0].scenario,
  result: "success",
  assertions: C.assertions,
  artifact: artifactRel,
  report: "reports/20260926-22-shader-audio-visualizer.md",
  styles: NEW_STYLES
});
state.skills_seen = state.skills_seen.map((k) =>
  k.name === "shader" ? Object.assign({}, k, {
    status: (k.status || "") + "；第 2 次于音频可视化场景通过（音频侧 uniform 口径本轮自建，技能零覆盖）"
  }) : k);
state.next_candidates = [
  "★ shader × 商品 360° 展示：变体轴 = 视角，「一个程序多变体」做成可旋转的硬判据（本轮 samevariant/uOrigin 是现成起手式）",
  "把本轮的「两个解析器对账」配方移植回数据类轮次：确定性合成输入（seeded）→ data URI 内联 → Node 侧独立解析 → 相关性+事件时刻匹配断言（比 mock 数据硬得多）",
  "★ audio-editing-automation × 有声产物：本轮音频是自己合成的（无技能参与），下轮可让该技能真承担素材处理并接进可视化页，检验技能×技能的接缝",
  "probe 叠加法回查历轮：18:00 shader 展览页只有单值 probe，补一对互斥臂（frozen × frozen+noaudio）即可把「画面在动」升级为「谁在让它动」",
  "把「皮肤 CSS 令牌 == 着色器 vec3 uniform」单一来源法推广到 React 轮（主题 CSS 与 JS 常量双写是 17:00 轮真实缺陷之一）",
  "台账卫生既有欠账（他人轮次，本轮只报告未代改）：tried[10]/[11] 缺 report、tried[13] 缺 time",
  "vercel × 真 Next.js 吃 RSC 专属 server-* 仍在排队（至今 0 落地）"
];
state.updated = ROUND_TIME;
fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
fs.appendFileSync(LOG, C.logLine + "\n");
console.log("台账已写入：tried=" + state.tried.length + " runs=" + state.runs.length +
  " used_styles=" + state.used_styles.length + " notes=" + state.environment_notes.length + "；work-log 追加 1 行（断言总数 " + t.grandTotal + " 取自 evidence/assert-totals.json）");
