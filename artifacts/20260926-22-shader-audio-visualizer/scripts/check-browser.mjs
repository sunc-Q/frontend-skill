/* 真浏览器取证：Chromium(SwiftShader 软件 GL) 直接打开 file:// 产物，验证
 *   J 启动与运行时锁定（WebGL1 / AnalyserNode 元数据 / 音频真的在跑）
 *   K 两个解析器对账（Chrome 的频谱读数 vs Node 自写 FFT 的真值：相关性、起拍时刻、breakdown 凹陷）
 *   L 消融臂像素判据（frozen × frozen+noaudio 互斥对、mislabel、samevariant、staticspectrum、solid、nogl、noonset、nomouse）
 *   M 三风格指纹（真机 getComputedStyle）+ 无横向溢出
 *   N 零跨源请求 + 控制台零消息
 * 依赖 playwright-core（安装方式见复现报告）。缺失时整组 SKIP 并以 2 退出，不假装通过。
 * 帧差一律在页内算（probe.snapshot / probe.diff）：整块 readPixels 的字节数组不适合跨 evaluate 边界。
 * 输出 evidence/check-browser.json */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");
const STYLES = ["colonnade", "ripple", "thermal"];
const GL_ARGS = [
  "--no-sandbox", "--allow-file-access-from-files",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--disable-features=AudioServiceOutOfProcess"
];

let chromium = null;
for (const dir of [path.join(LAB, ".tmp", "audiobuild"), path.join(LAB, ".tmp", "shader360")]) {
  try { chromium = require(path.join(dir, "node_modules", "playwright-core")).chromium; break; } catch (e) { /* 换下一个候选目录 */ }
}
/* 可执行文件与 playwright-core 期望的 revision 未必同版本（本机只有 chromium-1148），
 * 所以显式给出候选路径并逐个试启：第一个能起出 WebGL1 上下文的就用它。 */
const BROWSER_CANDIDATES = [
  "/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
if (!chromium) {
  console.log("check-browser: SKIP —— 找不到 playwright-core。安装：mkdir -p " + path.join(LAB, ".tmp/audiobuild") +
    " && cd $_ && npm i --registry=https://registry.npmmirror.com playwright-core");
  process.exit(2);
}

const gt = JSON.parse(fs.readFileSync(path.join(ROOT, "evidence", "ground-truth.json"), "utf8"));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "audio-spec.json"), "utf8"));

let pass = 0, fail = 0;
const failures = [], reads = {};
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(name + (detail ? " — " + detail : "")); }
  console.log((cond ? "PASS " : "FAIL ") + name + (detail && !cond ? "  [" + detail + "]" : ""));
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

async function launch() {
  let lastErr = null;
  for (const exe of BROWSER_CANDIDATES) {
    if (!fs.existsSync(exe)) { lastErr = "不存在：" + exe; continue; }
    try {
      const b = await chromium.launch({ executablePath: exe, args: GL_ARGS });
      const probePage = await (await b.newContext()).newPage();
      await probePage.setContent("<canvas id=c></canvas>");
      const ctxOk = await probePage.evaluate(() => {
        const g = document.getElementById("c").getContext("webgl");
        return !!g && g instanceof WebGLRenderingContext;
      });
      await probePage.close();
      if (!ctxOk) { lastErr = exe + " 起得来但没有 WebGL1 上下文"; await b.close(); continue; }
      return { browser: b, exe, webgl1: true };
    } catch (e) { lastErr = String(e.message).split("\n")[0]; }
  }
  throw new Error("没有一个浏览器候选可用（" + lastErr + "）");
}

const { browser, exe: browserExe } = await launch();
const ctx = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 };

async function open(style, probe) {
  const context = await browser.newContext(ctx);
  const page = await context.newPage();
  const msgs = [], reqs = [];
  page.on("console", (m) => msgs.push(m.type() + ": " + m.text().slice(0, 120)));
  page.on("pageerror", (e) => msgs.push("pageerror: " + String(e.message).slice(0, 120)));
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith("file://") && !u.startsWith("data:")) reqs.push(u.slice(0, 60)); });
  const q = probe ? "?probe=" + probe : "";
  await page.goto("file://" + path.join(ROOT, "preview", "visualizer-" + style + ".html") + q, { waitUntil: "load" });
  await page.waitForTimeout(300);
  return {
    page, context, msgs, reqs, style, probe,
    close: () => context.close(),
    call: (fn, arg) => page.evaluate(fn, arg),
    play: async () => {
      const r = await page.evaluate(async () => await window.__shaderProbe.start());
      await page.waitForTimeout(500);
      return r;
    }
  };
}
const bootState = (p) => p.call(() => document.body.getAttribute("data-boot"));

/* ---------- J：每个风格都要过的启动判据 ---------- */
for (const style of STYLES) {
  const p = await open(style, "");
  eq("J1 " + style + " boot 成功（两视口都有 GL 上下文且 uniform 定位无缺失）", await bootState(p), "ok");
  const info = await p.call(() => window.__shaderProbe.info());
  ok("J2 " + style + " 两视口 missing 定位为 0、glError 0",
    info.fx.missing.length === 0 && info.strip.missing.length === 0 && info.fx.glError === 0 && info.strip.glError === 0,
    JSON.stringify({ f: info.fx.missing, s: info.strip.missing, e: [info.fx.glError, info.strip.glError] }));
  eq("J3 " + style + " strip 是三个子视口（一个程序三变体）", info.strip.bands, 3);
  ok("J4 " + style + " 画布缓冲尺寸随 DPR 放大且 strip 宽为 3 的整数倍",
    info.strip.buffer[0] % 3 === 0 && info.strip.buffer[0] > 0 && info.fx.buffer[0] > 0,
    JSON.stringify({ fx: info.fx.buffer, strip: info.strip.buffer }));
  const play = await p.play();
  eq("J5 " + style + " 音频真的在跑（AudioContext running）", play.ctxState, "running");
  const meta = await p.call(() => window.__shaderProbe.audio());
  eq("J6 " + style + " fftSize 锁定 2048", meta.fftSize, 2048);
  eq("J7 " + style + " frequencyBinCount 1024", meta.binCount, 1024);
  eq("J8 " + style + " 跨帧平滑关掉（与 Node 侧同口径，否则两个解析器不可比）", meta.smoothing, 0);
  eq("J9 " + style + " maxDecibels = 共享常量 -10（不是默认的 -30）", meta.maxDecibels, -10);
  eq("J10 " + style + " minDecibels = 共享常量 -100", meta.minDecibels, -100);
  ok("J11 " + style + " 音源是内联 data URI（" + meta.srcPrefix + "）", meta.srcPrefix.indexOf("data:audio/wav;base64") === 0, meta.srcPrefix);
  const t1 = await p.call(() => window.__shaderProbe.audio().currentTime);
  await p.call(() => window.__shaderProbe.warm(1000));
  const a2 = await p.call(() => window.__shaderProbe.audio());
  ok("J12 " + style + " 播放头随墙钟推进（" + t1.toFixed(2) + "s → " + a2.currentTime.toFixed(2) + "s）",
    a2.currentTime - t1 > 0.6 && !a2.paused);
  const f = await p.call(() => ({ fr: window.__shaderProbe.frames(), dr: window.__shaderProbe.draws(), fps: window.__shaderProbe.fps() }));
  ok("J13 " + style + " rAF 在跑、每帧四块视口（frames " + f.fr + "，draws " + f.dr + "，fps " + f.fps.toFixed(1) + "）",
    f.fr > 20 && f.dr === (f.fr + 1) * 4, JSON.stringify(f));
  reads[style + ":boot"] = { info, meta, frames: f };
  await p.close();
}

/* ---------- K：浏览器读数 与 Node 真值 对账 ---------- */
const seriesRows = {};
function median(xs) {
  if (!xs.length) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
async function collectSeries(style, seekTo, ms, step) {
  const p = await open(style, "");
  await p.play();
  await p.call((t) => window.__shaderProbe.seek(t), seekTo);
  const rows = [];
  const n = Math.max(1, Math.floor(ms / step));
  for (let i = 0; i < n; i++) {
    rows.push(await p.call(() => {
      const q = window.__shaderProbe;
      const s = q.audio();
      const x = q.features();
      return { t: s.currentTime, level: x.level, bass: x.bass, mid: x.mid, treble: x.treble, flux: x.flux, bands: x.bands.slice(0, 64), beats: x.beatLog.slice() };
    }));
    await p.call((ms) => window.__shaderProbe.warm(ms), step);
  }
  await p.close();
  return rows;
}
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return NaN;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n, mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sa += x * x; sb += y * y; sab += x * y; }
  return sa > 0 && sb > 0 ? sab / Math.sqrt(sa * sb) : NaN;
}
function nearestNodeFrames(t0, t1) {
  return gt.frames.filter((f) => f.t >= t0 && f.t <= t1);
}
for (const style of STYLES) {
  const rows = await collectSeries(style, 4.0, 9000, 120);
  seriesRows[style] = rows;
  const ts = rows.map((r) => r.t).filter((t) => t > 0);
  const span = [Math.min(...ts), Math.max(...ts)];
  const nf = nearestNodeFrames(span[0] - 0.05, span[1] + 0.05);
  /* 浏览器采样时刻 → Node 真值最近帧（Chrome 的 AnalyserNode 有自己的窗口延迟，
   * 所以先做 ±150ms 的偏移搜索取最优，而不是逐帧硬等——硬等只会把「实现差」误判成「没接线」） */
  function aligned(key, offset) {
    const a = [], b = [];
    for (const r of rows) {
      const t = r.t + offset;
      let best = null, bd = 1e9;
      for (const f of nf) { const d = Math.abs(f.t - t); if (d < bd) { bd = d; best = f; } }
      if (best && bd < 0.06) { a.push(r[key]); b.push(best[key]); }
    }
    return { r: pearson(a, b), n: a.length, a, b };
  }
  let bestOff = 0, bestCorr = { bass: -2, mid: -2, treble: -2 };
  for (const off of [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15]) {
    const c = { bass: aligned("bass", off).r, mid: aligned("mid", off).r, treble: aligned("treble", off).r };
    const score = (isFinite(c.bass) ? c.bass : 0) + (isFinite(c.mid) ? c.mid : 0) + (isFinite(c.treble) ? c.treble : 0);
    const cur = (isFinite(bestCorr.bass) ? bestCorr.bass : 0) + (isFinite(bestCorr.mid) ? bestCorr.mid : 0) + (isFinite(bestCorr.treble) ? bestCorr.treble : 0);
    if (score > cur) { bestOff = off; bestCorr = c; }
  }
  reads[style + ":series"] = { span, offset: bestOff, corr: bestCorr, samples: rows.length };
  ok("K1 " + style + " 浏览器低频读数与 Node 真值相关（r=" + bestCorr.bass.toFixed(3) + " @offset " + bestOff + "s）",
    isFinite(bestCorr.bass) && bestCorr.bass > 0.6);
  ok("K2 " + style + " 中频相关（r=" + bestCorr.mid.toFixed(3) + "）", isFinite(bestCorr.mid) && bestCorr.mid > 0.5);
  ok("K3 " + style + " 高频相关（r=" + bestCorr.treble.toFixed(3) + "）", isFinite(bestCorr.treble) && bestCorr.treble > 0.4);
  const beats = rows.length ? rows[rows.length - 1].beats : [];
  const matched = beats.filter((bt) => gt.summary.onsetTimes.some((o) => Math.abs(o - bt) <= 0.14)).length;
  ok("K4 " + style + " 浏览器起拍与 Node 起拍时刻匹配（" + matched + "/" + beats.length + "）",
    beats.length >= 3 && matched / beats.length >= 0.6, JSON.stringify({ browser: beats, matched }));
  /* 带形状对内容：底鼓时刻能量必须堆在低频段。
   * 绝不在单个时刻点采样：取样步长 120ms 且 warm() 会漂，0.3s 宽的点窗会随机落空
   * （同一份代码第二次跑就报 no row）。改成把 groove 小节里落在任一起拍 ±0.14s 内的行
   * 全聚合起来取中位数，并把「聚合了几行」写进判据文本——样本不足就是真失败，不藏。 */
  const W5 = gt.summary.windows;
  const inGroove = (r) => W5.grooveBars.some((bar) => r.t >= bar * W5.barSec && r.t < (bar + 1) * W5.barSec);
  const nearOnset = rows.filter((r) => inGroove(r) && gt.summary.onsetTimes.some((o) => Math.abs(r.t - o) <= 0.14));
  const bandMean = (r, from, to) => r.bands.slice(from, to).reduce((a, b) => a + b, 0) / (to - from);
  const bassMed = median(nearOnset.map((r) => bandMean(r, 0, 12)));
  const trebMed = median(nearOnset.map((r) => bandMean(r, 40, 64)));
  ok("K5 " + style + " groove 起拍邻域（±0.14s，聚合 " + nearOnset.length + " 行 / groove 共 " +
    rows.filter(inGroove).length + " 行）低频段中位 > 高频段中位（" + bassMed.toFixed(3) + " vs " + trebMed.toFixed(3) + "）",
    nearOnset.length >= 6 && bassMed > trebMed, JSON.stringify({ rows: nearOnset.length }));
}
/* breakdown 凹陷：浏览器侧也必须读出来（不是只有 Node 侧算得出）。
 * 口径与 Node 侧完全相同：按 spec 推导的小节窗口取中位数，而不是在某个时刻点采样——
 * 点采样会踩到 Chrome 的 seek 预卷（seek 后前几百毫秒读到的还是旧位置的光谱），
 * 早先版本就是这样把 0.31 的真凹陷量成了 0.78 的假「实现差」。 */
const winOf = (W) => ({
  groove: (r) => W.grooveBars.some((bar) => r.t >= bar * W.barSec && r.t < (bar + 1) * W.barSec),
  brk: (r) => r.t >= W.breakdownBar * W.barSec + 0.2 && r.t < (W.breakdownBar + 1) * W.barSec - 0.2
});
for (const style of STYLES) {
  const rows = seriesRows[style];
  const W = gt.summary.windows;
  const { groove: inG, brk: inB } = winOf(W);
  const gRows = rows.filter(inG), bRows = rows.filter(inB);
  const gb = median(gRows.map((r) => r.bass)), bb = median(bRows.map((r) => r.bass));
  const node = gt.summary.bassWindowAtCeil;
  reads[style + ":dip"] = {
    samples: [gRows.length, bRows.length],
    browserGroove: Number(gb.toFixed(4)), browserBreak: Number(bb.toFixed(4)),
    browserRatio: Number((bb / gb).toFixed(4)),
    nodeGroove: node.groove.median, nodeBreak: node.breakdown.median, nodeRatio: Number(gt.summary.dips.ratio.toFixed(4))
  };
  ok("K6 " + style + " 浏览器窗口口径读出的 breakdown 低频凹陷（" + gb.toFixed(3) + " → " + bb.toFixed(3) +
    "，比值 " + (bb / gb).toFixed(3) + "，取样 " + gRows.length + "/" + bRows.length + "）",
    gRows.length >= 20 && bRows.length >= 5 && bb < gb * 0.75);
  ok("K7 " + style + " 两个独立解析器对同一事实同向（Node 比值 " + gt.summary.dips.ratio.toFixed(3) +
    " vs 浏览器 " + (bb / gb).toFixed(3) + "；绝对电平差 " + Math.abs(gb - node.groove.median).toFixed(3) + "，只断言方向不断言等值）",
    gt.summary.dips.ratio < 0.75 && bb / gb < 0.75 && Math.abs(gb - node.groove.median) < 0.2);
}

/* ---------- L：消融臂（含互斥对） ---------- */
async function diffArm(style, probe, opts) {
  const p = await open(style, probe);
  await p.play();
  await p.call((t) => window.__shaderProbe.seek(t), opts && opts.seek != null ? opts.seek : 4.0);
  await p.call(() => window.__shaderProbe.warm(500));
  if (opts && opts.freezeTime) await p.call(() => window.__shaderProbe.setPaused(true));
  const r = { style, probe };
  r.time0 = await p.call(() => window.__shaderProbe.time());
  await p.call((tag) => window.__shaderProbe.snapshot(tag, 0), opts.tag || "fx");
  await p.call((ms) => window.__shaderProbe.warm(ms), opts.ms || 700);
  r.diffFx = await p.call((tag) => window.__shaderProbe.diff(tag, 0), opts.tag || "fx");
  r.time1 = await p.call(() => window.__shaderProbe.time());
  r.feat = await p.call(() => { const f = window.__shaderProbe.features(); return { bass: f.bass, level: f.level, bands: f.bands.slice(0, 8), beats: f.beatLog.length }; });
  r.audio = await p.call(() => window.__shaderProbe.audio());
  r.boot = await bootState(p);
  await p.close();
  return r;
}
const armL = {};
for (const style of STYLES) {
  const frozen = await diffArm(style, "frozen", { ms: 900, seek: 4.0 });
  const both = await diffArm(style, "frozen,noaudio", { ms: 900, seek: 4.0 });
  armL[style] = { frozen, both };
  reads["frozen:" + style] = { changedPct: frozen.diffFx.changedPct, meanAbsDelta: frozen.diffFx.meanAbsDelta };
  reads["frozen,noaudio:" + style] = { changed: both.diffFx.changed, pixels: both.diffFx.pixels };
  ok("L1 " + style + " frozen：uTime 恒定（" + frozen.time0.toFixed(2) + "→" + frozen.time1.toFixed(2) + "）",
    frozen.time0 === frozen.time1);
  ok("L2 " + style + " frozen：但音频在跑、画面仍在变（changedPct " + (frozen.diffFx.changedPct * 100).toFixed(1) + "%）",
    !frozen.audio.paused && frozen.diffFx.changedPct > 0.01 && frozen.diffFx.meanAbsDelta > 0.3);
  ok("L3 " + style + " frozen,noaudio：音频读数归零（bass " + both.feat.bass.toFixed(3) + "）",
    both.feat.bass === 0 && both.feat.level === 0 && both.feat.bands.every((v) => v === 0));
  ok("L4 " + style + " frozen,noaudio：画面一像素都不动（changed " + both.diffFx.changed + "/px " + both.diffFx.pixels + "）",
    both.diffFx.changed === 0 && both.diffFx.meanAbsDelta === 0);
  ok("L5 " + style + " 互斥对成立：只拔时钟画面照变、时钟与音频一起拔才静止",
    frozen.diffFx.changedPct > 0.01 && both.diffFx.changed === 0,
    JSON.stringify({ frozen: frozen.diffFx.changedPct, both: both.diffFx.changed }));
}
for (const style of STYLES) {
  const mis = await diffArm(style, "mislabel", { ms: 200, seek: 4.0 });
  reads[style + ":mislabel"] = mis;
  ok("L6 " + style + " mislabel 臂仍能跑通（boot ok 且读数非零）", mis.boot === "ok" && mis.feat.bass > 0);
}
/* 频带映射的三条实测事实，判据是按事实选的（不是反过来）：
 *   1) 「三带读数互不相同」这个口径是废的：浅纸底色的 colonnade 三带均值实测 219.2/218.2/219.7，
 *      而 samevariant（三块都发 uVariant=0）因为视口宽窄不同反而能差到 13 —— 底色与纵横比
 *      主导了均值，筛带只留下零点几 LSB。第一版拿「四舍五入后三个整数互不相同」当判据，
 *      同一条代码上时过时败，就是这个原因。
 *   2) 于是把「uVariant 有没有改这块视口的画面」搬到确定性臂上做：
 *      frozen（冻住 uTime）+ staticspectrum（与音乐无关的斜坡频谱）+ setPaused + 精确 N 次 drawOnce，
 *      画面就只由代码决定。实测同一臂两次独立加载逐带读数差为 0（L7 顺手把这条钉住），
 *      所以差只要非零就是证据，不需要猜噪声门限。
 *   3) 带序反转（mislabel）是沿频带反的：热像条带把 x 轴当时间用，均值对水平平移又是不变量，
 *      确定性臂下实测逐带只有 [+0.00, +1.90, -0.03]（90 次重绘）——「反转后至少一条要变」在
 *      这一页根本没有可观测的分频效应，硬断言就是随机红。所以 L8b 换成对照式判据：
 *      正常 uVariant 的三带 spread 与「把 uVariant 全钉成 0」之后的 spread 之比才是筛带的证据，
 *      反转差只作为实测读数记进 evidence/reads，热像的反转证据落在 L8a（真音频主画面统计）。 */
const quant = (vals, p) => {
  const s = vals.slice().sort((a, b) => a - b);
  return s[Math.max(0, Math.min(s.length - 1, Math.round(p * (s.length - 1))))];
};
const medOf = (vals) => quant(vals, 0.5);
const SAMPLES = 14;
const DET_DRAWS = 140;
async function detMeans(style, probe) {
  const p = await open(style, "frozen," + probe);
  const r = await p.call((n) => {
    const q = window.__shaderProbe;
    q.setPaused(true);
    for (let i = 0; i < n; i++) q.drawOnce();
    return [0, 1, 2].map((b) => q.stats("strip", b).mean);
  }, DET_DRAWS);
  await p.close();
  return r;
}
async function bandStats(style, probe) {
  const p = await open(style, probe);
  await p.play();
  await p.call((t) => window.__shaderProbe.seek(t), 3.6);
  await p.call((ms) => window.__shaderProbe.warm(ms), 500);
  const cols = [[], [], []], fxm = [], fxs = [];
  for (let i = 0; i < SAMPLES; i++) {
    for (const band of [0, 1, 2]) {
      const s = await p.call((b) => window.__shaderProbe.stats("strip", b), band);
      cols[band].push(s.mean);
    }
    const f = await p.call(() => { const s = window.__shaderProbe.stats("fx", 0); return [s.mean, s.sigma]; });
    fxm.push(f[0]); fxs.push(f[1]);
    await p.call((ms) => window.__shaderProbe.warm(ms), 110);
  }
  const rec = await p.call(() => {
    const q = window.__shaderProbe;
    return { strip: q.host("strip").bandRecords().map((r) => r && r.uVariant), fx: q.host("fx").bandRecords().map((r) => r && r.uVariant) };
  });
  await p.close();
  const bands = cols.map((v) => ({ samples: v, median: medOf(v), iqr: quant(v, 0.75) - quant(v, 0.25), mean: medOf(v) }));
  return { bands, fx: { mean: medOf(fxm), sigma: medOf(fxs) }, medians: bands.map((b) => b.median), variants: rec.strip, fxVariants: rec.fx };
}
for (const style of STYLES) {
  const rel = (x) => (Math.abs(x[0] - x[1]) / ((x[0] + x[1]) / 2) * 100).toFixed(1) + "%";
  /* L7 确定性臂：同宽同原点，只换 uVariant，三条视口都必须换画面 */
  const d0 = await detMeans(style, "staticspectrum");
  const d0b = await detMeans(style, "staticspectrum");
  const dSv = await detMeans(style, "staticspectrum,samevariant");
  const dMl = await detMeans(style, "staticspectrum,mislabel");
  const drift = Math.max(...d0.map((v, i) => Math.abs(v - d0b[i])));
  const vDelta = d0.map((v, i) => v - dSv[i]);
  reads[style + ":deterministic"] = { normal: d0, reload: d0b, variantOffDelta: vDelta, mislabelDelta: d0.map((v, i) => v - dMl[i]) };
  ok("L7 " + style + " 确定性臂（frozen+斜坡频谱，" + DET_DRAWS + " 次重绘）两次加载逐带读数逐位相同（最大漂移 " +
    drift.toFixed(6) + "），且只换 uVariant 时三带读数全变（Δ " + vDelta.map((v) => v.toFixed(2)).join(" / ") + "）",
    drift === 0 && vDelta.every((v) => Math.abs(v) > 0.5), JSON.stringify({ d0, d0b, dSv }));
  /* L8a 真音频臂：反转带序必须改掉主画面的统计 */
  const norm = await bandStats(style, "");
  const mis = await bandStats(style, "mislabel");
  const sv = await bandStats(style, "samevariant");
  reads[style + ":bands"] = { norm, mis, samevariant: sv };
  const dm = rel([mis.fx.mean, norm.fx.mean]), ds = rel([mis.fx.sigma, norm.fx.sigma]);
  ok("L8a " + style + " 真音频下反转带序后主画面统计必须变（Δmean " + dm + " / Δsigma " + ds + "）",
    Number(dm.slice(0, -1)) > 1 || Number(ds.slice(0, -1)) > 1,
    JSON.stringify({ norm: norm.fx, mis: mis.fx }));
  /* L8b 确定性臂对照判据：uVariant 生效时三块视口两两相差 ≥0.5 LSB，把 uVariant 全钉成 0 后差必须塌缩 */
  const mDelta = d0.map((v, i) => v - dMl[i]);
  const dSpread = Math.max.apply(null, d0) - Math.min.apply(null, d0);
  const svSpread = Math.max.apply(null, dSv) - Math.min.apply(null, dSv);
  const gaps = [[0, 1], [0, 2], [1, 2]].map((ij) => Math.abs(d0[ij[0]] - d0[ij[1]]));
  const minGap = Math.min.apply(null, gaps);
  ok("L8b " + style + " 确定性臂对照：uVariant=1/2/3 时三带两两相差 ≥0.5 LSB（最小 " + minGap.toFixed(2) +
    "），全钉成 uVariant=0 后 spread 从 " + dSpread.toFixed(2) + " 塌缩到 " + svSpread.toFixed(2) +
    "（残余是视口纵横比/原点，不是筛带）；带序反转的逐带差 " + mDelta.map((v) => v.toFixed(2)).join(" / ") +
    " 原样记录但不入判据——热像条带 x 轴=时间，均值对水平平移不变，反转的证据在 L8a",
    minGap >= 0.5 && svSpread <= Math.max(0.2, dSpread / 8),
    JSON.stringify({ d0, dSv, dSpread, svSpread, gaps, mDelta }));
  ok("L9 " + style + " 逐视口 uVariant 记录值：正常 " + JSON.stringify(norm.variants) +
    " / samevariant " + JSON.stringify(sv.variants) + " / 主画面 " + JSON.stringify(norm.fxVariants) +
    "（真音频三带中位 " + norm.medians.map((v) => v.toFixed(1)).join("/") + "，samevariant " +
    sv.medians.map((v) => v.toFixed(1)).join("/") + "：视口宽窄的残余差比筛带效应还大，所以不用「读数是否相同」立判据）",
    JSON.stringify(norm.variants) === "[1,2,3]" && JSON.stringify(sv.variants) === "[0,0,0]" &&
    norm.fxVariants.every((v) => v === 0) && sv.fxVariants.every((v) => v === 0));
}
/* 静态假频谱臂：读数与音频时刻无关，而且是一条斜坡（常数频谱对筛带/反转都是不变量，喂它什么也测不出） */
{
  const p = await open("thermal", "staticspectrum");
  await p.play();
  await p.call((t) => window.__shaderProbe.seek(t), 4.0);
  await p.call((ms) => window.__shaderProbe.warm(ms), 400);
  const at4 = await p.call(() => window.__shaderProbe.features().bands.slice(0, 4));
  await p.call((t) => window.__shaderProbe.seek(t), 12.0);
  await p.call((ms) => window.__shaderProbe.warm(ms), 400);
  const at12 = await p.call(() => window.__shaderProbe.features().bands.slice(0, 4));
  const top = await p.call(() => window.__shaderProbe.features().bands[63]);
  await p.close();
  ok("L10 staticspectrum：两个不同播放头读数完全相同（假频谱与音乐脱钩），且频谱沿带号单调爬升（" +
    at4.map((v) => v.toFixed(3)).join("→") + " … " + top.toFixed(3) + "）",
    JSON.stringify(at4) === JSON.stringify(at12) && at4[0] === 0.15 && top > 0.84 && top < 0.86,
    JSON.stringify({ at4, at12, top }));
}
/* solid / nogl / noonset / nomouse */
{
  const p = await open("colonnade", "solid");
  const s = await p.call(() => window.__shaderProbe.stats("fx", 0));
  await p.close();
  ok("L11 solid 臂：整幅品红（rgb " + s.meanRgb.map((v) => v.toFixed(0)).join(",") + "）证明绘制通路活着",
    s.meanRgb[0] > 250 && s.meanRgb[1] < 6 && s.meanRgb[2] > 250);
}
{
  const p = await open("colonnade", "nogl");
  const r = await p.call(() => ({ boot: document.body.getAttribute("data-boot"), fb: !document.getElementById("gl-fallback").hidden, fx: getComputedStyle(document.getElementById("fx")).display, frames: window.__shaderProbe.frames() }));
  await p.close();
  ok("L12 nogl 臂：boot=" + r.boot + "、降级提示可见、主画布隐藏、循环仍在跑（页面不空白）",
    r.boot === "nogl" && r.fb && r.fx === "none" && r.frames > 3);
}
{
  const nn = await diffArm("ripple", "noonset", { ms: 900, seek: 4.0 });
  ok("L13 noonset 臂：起拍计数恒 0（uBeat 不该是宿主自带脉冲）", nn.feat.beats === 0 && nn.feat.bass > 0,
    JSON.stringify(nn.feat));
  const p = await open("colonnade", "nomouse");
  await p.play();
  await p.page.mouse.move(200, 300);
  await p.page.mouse.move(900, 600);
  const m = await p.call(() => window.__shaderProbe.mouse());
  await p.close();
  ok("L14 nomouse 臂：移动指针后 uMouse 仍是初值 " + JSON.stringify(m), m[0] === 0.5 && m[1] === 0.5);
}
/* 指针在正常臂下必须真的进 uniform */
{
  const p = await open("colonnade", "");
  await p.play();
  await p.page.mouse.move(1024, 214);
  await p.call(() => window.__shaderProbe.warm(150));
  const r = await p.call(() => ({ mouse: window.__shaderProbe.mouse(), last: window.__shaderProbe.host("fx").lastUniforms() }));
  await p.close();
  ok("L15 正常臂：指针位置写进 uMouse（" + JSON.stringify(r.mouse) + " → uniform " + JSON.stringify(r.last.mouse) + "）",
    Math.abs(r.mouse[0] - 1024 / 1280) < 0.01 && Math.abs(r.last.mouse[0] - r.mouse[0]) < 1e-6);
}
/* uOrigin 逐视口不同：三带的窗口原点必须互异，否则「三条裁片」缺陷会伪装成分频 */
{
  const p = await open("thermal", "");
  await p.play();
  await p.call(() => window.__shaderProbe.warm(400));
  const u = await p.call(() => {
    const h = window.__shaderProbe.host("strip");
    return { last: h.lastUniforms(), size: h.size() };
  });
  await p.close();
  ok("L16 strip 最后一带的 uOrigin.x 等于 2/3 画布宽（视口原点真的逐带写）",
    Math.abs(u.last.uOrigin[0] - Math.floor(u.size[0] / 3) * 2) <= 1, JSON.stringify(u));
}

/* ---------- M：三风格指纹（真机计算样式） ---------- */
const fp = {};
for (const style of STYLES) {
  const p = await open(style, "");
  fp[style] = await p.call(() => {
    const cs = (sel, props) => { const el = document.querySelector(sel); const c = getComputedStyle(el); const o = {}; props.forEach((x) => o[x] = c[x]); return o; };
    return {
      body: cs("body", ["backgroundColor", "color", "fontFamily", "lineHeight"]),
      sec: cs(".sec", ["borderRadius", "borderTopWidth", "borderTopStyle", "boxShadow"]),
      h2: cs(".sec h2", ["textTransform", "letterSpacing"]),
      btn: cs(".btn", ["backgroundColor", "color", "borderRadius", "borderTopWidth"]),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      mastheadH: document.querySelector(".masthead").getBoundingClientRect().height,
      stripVisible: getComputedStyle(document.getElementById("strip")).display !== "none",
      barRows: document.querySelectorAll(".table-score tbody tr").length
    };
  });
  await p.close();
}
reads["fingerprints"] = fp;
ok("M1 三页正文背景色互异（" + STYLES.map((s) => fp[s].body.backgroundColor).join(" / ") + "）",
  new Set(STYLES.map((s) => fp[s].body.backgroundColor)).size === 3);
ok("M2 三页字体主族互异（" + STYLES.map((s) => fp[s].body.fontFamily.split(",")[0]).join(" / ") + "）",
  new Set(STYLES.map((s) => fp[s].body.fontFamily.split(",")[0])).size === 3);
ok("M3 三页圆角取向互异（.sec radius " + STYLES.map((s) => fp[s].sec.borderRadius).join(" / ") + "）",
  fp.ripple.sec.borderRadius !== "0px" && fp.colonnade.sec.borderRadius === "0px" && fp.thermal.sec.borderRadius === "0px");
ok("M4 热像页标签全大写、另两页不是（" + STYLES.map((s) => fp[s].h2.textTransform).join(" / ") + "）",
  fp.thermal.h2.textTransform === "uppercase" && fp.colonnade.h2.textTransform !== "uppercase" && fp.ripple.h2.textTransform !== "uppercase");
ok("M5 描边宽度取向互异（" + STYLES.map((s) => fp[s].sec.borderTopWidth).join(" / ") + "）",
  new Set(STYLES.map((s) => fp[s].sec.borderTopWidth)).size === 3);
STYLES.forEach((s) => {
  ok("M6 " + s + " 1280 视口下无横向溢出（scrollWidth-innerWidth=" + fp[s].overflow + "）", fp[s].overflow <= 0);
  ok("M7 " + s + " 正文与按钮可读：masthead 高 " + Math.round(fp[s].mastheadH) + "px、逐小节表 " + fp[s].barRows + " 行",
    fp[s].mastheadH > 80 && fp[s].barRows === 8);
});
/* 真机合成后的对比度（皮肤里的 rgba 衬底只有浏览器能算准） */
const CONTRAST_JS = String.raw`window.__labLum = function (rgb) {
  var c = rgb.map(function (v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
window.__labCol = function (str) {
  var m = /^rgba?\(([^)]+)\)$/i.exec(String(str).trim());
  if (!m) return null;
  var ps = m[1].trim().split(/[\s,\/]+/).map(parseFloat);
  return { rgb: ps.slice(0, 3), a: ps.length > 3 ? ps[3] : 1 };
};
window.__labOver = function (fg, bg) { return fg.rgb.map(function (v, i) { return v * fg.a + bg.rgb[i] * (1 - fg.a); }); };
/* 逐层往上叠：.status 这类元素自己常常是透明底，只量父一层会把深色页算成「浅字压白底」的假失败 */
window.__labBg = function (el) {
  var stack = [], node = el;
  while (node) {
    var col = window.__labCol(getComputedStyle(node).backgroundColor);
    if (col && col.a > 0) stack.push(col);
    node = node.parentElement;
  }
  var acc = { rgb: [255, 255, 255], a: 1 };
  for (var i = stack.length - 1; i >= 0; i--) acc = { rgb: window.__labOver(stack[i], acc), a: 1 };
  return acc;
};
window.__labContrast = function (a, b) { var l1 = window.__labLum(a), l2 = window.__labLum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };`;
for (const style of STYLES) {
  const p = await open(style, "");
  await p.page.addScriptTag({ content: CONTRAST_JS });
  const r = await p.call(() => {
    const out = {};
    const pairs = [[".lead", "body"], [".btn", "body"], [".status", "body"], [".table th", "body"], [".byline", "body"]];
    pairs.forEach(([sel, anc], i) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const c = getComputedStyle(el);
      /* 从元素自己开始往上叠：.btn 有 --c-btn-bg，从父层开始量会丢掉它自己的底（实测比值退化成 1.0） */
      const bg = window.__labBg(el);
      const fg = window.__labCol(c.color), solid = window.__labOver(fg, bg);
      out[sel] = { ratio: window.__labContrast(solid, bg.rgb), fontPx: parseFloat(c.fontSize) };
    });
    return out;
  });
  await p.close();
  reads["contrast:" + style] = r;
  const bad = Object.entries(r).filter(([, v]) => v.ratio < 4.5).map(([k, v]) => k + " " + v.ratio.toFixed(2));
  ok("M8 " + style + " 真机合成后正文类元素全部过 AA（" + Object.entries(r).map(([k, v]) => k.replace(".", "") + " " + v.ratio.toFixed(1)).join(" · ") + "）",
    Object.keys(r).length >= 4 && bad.length === 0, bad.join(","));
  const tiny = Object.entries(r).filter(([, v]) => v.fontPx < 12).map(([k]) => k);
  ok("M9 " + style + " 检查到的元素字号都不小于 12px", tiny.length === 0, tiny.join(","));
}

/* ---------- N：网络与控制台 ---------- */
{
  const p = await open("colonnade", "");
  await p.play();
  await p.call(() => window.__shaderProbe.warm(1200));
  eq("N1 零跨源请求（file:// 与 data: 之外）", p.reqs.length, 0);
  eq("N2 控制台零 error / warning / pageerror",
    p.msgs.filter((m) => /^(error|warning|pageerror)/.test(m)).length, 0);
  eq("N3 音频时长与合成事实一致", Number((await p.call(() => window.__shaderProbe.audio().duration)).toFixed(2)), spec.synth.durationSec);
  if (p.msgs.length) console.log("   控制台消息：" + JSON.stringify(p.msgs.slice(0, 4)));
  await p.close();
}
/* 小视口不横向溢出（移动档）：三页都量，溢出其实是共用的 base.css 长词撑破轨道，只测一页会漏 */
for (const style of STYLES) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto("file://" + path.join(ROOT, "preview", "visualizer-" + style + ".html"), { waitUntil: "load" });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    gap: document.documentElement.scrollWidth - window.innerWidth,
    bad: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => el.tagName.toLowerCase() + "." + String(el.className).slice(0, 16)).slice(0, 3)
  }));
  await context.close();
  reads["mobile390:" + style] = r;
  ok("M10 " + style + " 移动视口 390px 下无横向溢出（差值 " + r.gap + "，越界元素 " + r.bad.length + " 个）",
    r.gap <= 0 && r.bad.length === 0, JSON.stringify(r));
}

await browser.close();
fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "evidence", "check-browser.json"), JSON.stringify({
  generated_by: "scripts/check-browser.mjs",
  browser: browserExe,
  browserVersion: browser.version(),
  args: GL_ARGS,
  pass, fail, total: pass + fail, failures, reads
}, null, 1));
console.log("\n== check-browser: " + pass + " passed, " + fail + " failed, total " + (pass + fail) + " ==");
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
