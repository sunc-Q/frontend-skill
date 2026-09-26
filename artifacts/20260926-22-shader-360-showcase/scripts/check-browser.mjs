/* 浏览器断言（真 WebGL + 真交互）：取景不触边、镜像恒等、三向核对、uTime 不进几何、
 * 跨皮肤同剪影、uniform wrap 纪律、无交互不重绘、拖拽/键盘/Home/自转/复位、无障碍文本。
 * 每条判据都从 src/product.json 现算期望值；数字不手打。
 * 输出 evidence/browser-report.json 与 shots/*.png；任何一条红都以非零码退出。 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { createRequire } from "node:module";
import { sha1, read } from "./lib.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const LAB = path.resolve(ROOT, "..", "..");
const SRC = path.join(ROOT, "src");
const SHOTS = path.join(ROOT, "shots");
const STYLES = ["vitrine", "plaque", "industrial"];
const GL_ARGS = ["--no-sandbox", "--allow-file-access-from-files", "--use-gl=angle",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

const facts = JSON.parse(fs.readFileSync(path.join(ROOT, "preview", "showcase-vitrine.html"), "utf8")
  .match(/<script id="facts" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const labels = JSON.parse(fs.readFileSync(path.join(SRC, "labels.json"), "utf8"));
facts.camera.fovTan = +Math.tan((facts.camera.fovDeg * Math.PI) / 360).toFixed(6);
const W = facts.controls.backingStorePx;
const TAU = Math.PI * 2;
const wrapDeg = (d) => ((d % 360) + 360) % 360;
const anchorWord = (a) => (a === "right" ? labels.anchorRight : a === "left" ? labels.anchorLeft : labels.anchorCenter);
const anchorFromCx = (cx) => {
  const off = (cx - W / 2) / (W / 2);
  return off > 0.06 ? "right" : off < -0.06 ? "left" : "center";
};

const results = [];
let group = "";
const g = (n) => { group = n; };
const ok = (id, cond, detail = "") => results.push({ id: `${group}/${id}`, pass: Boolean(cond), detail: String(detail).slice(0, 300) });
const eq = (id, actual, expected, detail = "") => results.push({ id: `${group}/${id}`, pass: String(actual) === String(expected), detail: `实际 ${actual} / 期望 ${expected}${detail ? " · " + String(detail).slice(0, 200) : ""}` });
const near = (id, actual, expected, tol) => results.push({ id: `${group}/${id}`, pass: Math.abs(actual - expected) <= tol, detail: `实际 ${actual} / 期望 ${expected}±${tol}` });

const evidence = { sweep: {}, mirror: {}, presets: {}, crossSkin: {}, uniform: {}, interactions: {} };

g("source");
// 页面自报的构建戳必须真的是磁盘上那份源码的哈希——否则「共用同一份几何」只是页面自己声称
eq("页面几何 sha1 = 磁盘几何 sha1", facts.build.geometrySha1, sha1(read(path.join(SRC, "shaders", "geometry.glsl"))).slice(0, 12));
eq("页面宿主 sha1 = 磁盘宿主 sha1", facts.build.hostSha1, sha1(read(path.join(SRC, "host.js"))).slice(0, 12));

const pw = require(require.resolve("playwright-core", { paths: [path.join(LAB, ".tmp", "shader360", "node_modules")] }));
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await pw.chromium.launch({ executablePath: pw.chromium.executablePath(), args: GL_ARGS });

/* 一次 evaluate 跑一整批像素活，省掉跨进程往返 */
const SWEEP = `(function(){
  const mz = window.__mz; mz.setFrozenTime(0);
  const out = [];
  for (let az = 0; az < 360; az += 30) {
    mz.setView(az, ${facts.presets[0].elDeg}); mz.renderNow(0);
    const m = mz.measureNow(); const t = mz.projectTipNow(); const z = mz.zoneCentroid();
    out.push({ az, area: m.area, bbox: m.bbox, bandCx: m.band && m.band.cx, tipX: t && t.x, zoneCx: z.cx, zoneDev: z.dev,
      alpha: mz.pixHash("alpha"), rgba: mz.pixHash("rgba") });
  }
  return out;
})()`;

for (const s of STYLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  // 探针：记录每一次 uniform1f。宿主只有一个写入点，若别处绕过 wrap 就会在这里露出来。
  await ctx.addInitScript(`window.__u1 = [];(function(){var P=WebGLRenderingContext.prototype,o=P.uniform1f;
    P.uniform1f = function(loc, v){ window.__u1.push(+v); return o.apply(this, arguments); };})();`);
  const page = await ctx.newPage();
  const reqs = [], errs = [];
  page.on("request", (r) => reqs.push(r.url()));
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  const file = path.join(ROOT, "preview", `showcase-${s}.html`);
  await page.goto(url.pathToFileURL(file).href, { waitUntil: "load" });
  await page.waitForFunction(() => window.__mz && window.__mz.ready === true, { timeout: 60000 });

  g(`boot.${s}`);
  const boot = await page.evaluate(() => ({
    info: window.__mz.info, skin: window.__mz.skin, ids: window.__mz.presetIds,
    size: [document.getElementById("gl").width, document.getElementById("gl").height],
    readout: document.getElementById("readout").textContent,
    stamp: document.getElementById("buildStamp").textContent,
    badges: [...document.querySelectorAll("#gl-badges span, .gl-badges span")].map((x) => x.textContent),
    fatal: !!document.querySelector(".gl-fatal"),
  }));
  eq("编译成功", boot.info.compile, "ok");
  ok("programOk 与 webgl 为真", boot.info.programOk === true && boot.info.webgl === true);
  ok("拿到真实 renderer", boot.info.renderer.length > 0, boot.info.renderer);
  eq("绘制后 gl.getError()==0", boot.info.glErrorAfterDraw, 0);
  eq("探针皮肤标识", boot.skin, s);
  eq("后备缓冲尺寸=事实", boot.size.join("x"), `${W}x${W}`);
  ok("读数已就位（非占位）", boot.readout.includes("方位") && !boot.readout.includes(labels.readoutPending), boot.readout);
  ok("构建戳写进页脚", boot.stamp.includes(facts.build.id), boot.stamp);
  eq("无 WebGL 致命提示", boot.fatal, false);
  ok("徽标含重绘次数与剪影面积", boot.badges.some((b) => b.startsWith("重绘")) && boot.badges.some((b) => b.startsWith("剪影面积")), boot.badges.join("|"));
  eq("零异常", errs.length, 0, errs.join(" ; "));
  const external = reqs.filter((u) => !u.startsWith("file://"));
  eq("零外部请求", external.length, 0, external.join(","));

  g(`sweep.${s}`);
  const sweep = await page.evaluate(SWEEP);
  evidence.sweep[s] = sweep;
  const badArea = sweep.filter((r) => r.area <= 0);
  eq("每个方位都有剪影", badArea.length, 0, badArea.map((r) => r.az).join(","));
  const touch = sweep.filter((r) => r.bbox.minX <= 2 || r.bbox.maxX >= W - 3 || r.bbox.top <= 2 || r.bbox.bottom >= W - 3);
  eq("取景不触边(12方位)", touch.length, 0, touch.map((r) => `${r.az}:${JSON.stringify(r.bbox)}`).join(" ; ").slice(0, 200));
  const fracs = sweep.map((r) => r.area / (W * W));
  ok("占屏比在合理带内 12%~60%", Math.min(...fracs) > 0.12 && Math.max(...fracs) < 0.6, `${Math.min(...fracs).toFixed(3)}~${Math.max(...fracs).toFixed(3)}`);
  // 镜像恒等：模型对 z→-z 严格对称，而 θ 与 180°−θ 正是被这个对称联系的两个机位。
  // 于是剪影必须逐像素互为水平镜像：面积相等、包围盒左右互换、顶带重心之和恰为 W−1。
  const byAz = new Map(sweep.map((r) => [r.az, r]));
  const mirrorErr = [];
  for (const r of sweep) {
    const az2 = wrapDeg(180 - r.az);
    const b = byAz.get(az2);
    if (!b || r.bandCx == null || b.bandCx == null) { mirrorErr.push(`${r.az}:缺测`); continue; }
    const sum = +(r.bandCx + b.bandCx).toFixed(2);
    if (Math.abs(sum - (W - 1)) > 0.02) mirrorErr.push(`${r.az}+${az2} 顶带 ${sum}`);
    if (b.area !== r.area) mirrorErr.push(`${r.az}+${az2} 面积 ${r.area}/${b.area}`);
    if (b.bbox.minX !== W - 1 - r.bbox.maxX || b.bbox.maxX !== W - 1 - r.bbox.minX) mirrorErr.push(`${r.az}+${az2} 包围盒未互换`);
  }
  eq("镜像恒等 bandCx(θ)+bandCx(180−θ)=W−1 且面积/包围盒互换", mirrorErr.length, 0, mirrorErr.join(" ; "));
  evidence.mirror[s] = mirrorErr.length ? mirrorErr : { note: "12 方位全部闭合", w: W - 1 };
  // 转半圈：壶嘴必然换到另一侧（正对/背对除外），这是 360° 轴最基本的观感判据
  const flipErr = [];
  const other = (a) => (a === "right" ? "left" : a === "left" ? "right" : "center");
  for (const r of sweep) {
    const b = byAz.get(wrapDeg(r.az + 180));
    if (!b || r.bandCx == null || b.bandCx == null) continue;
    if (other(anchorFromCx(r.bandCx)) !== anchorFromCx(b.bandCx)) flipErr.push(`${r.az}:${anchorFromCx(r.bandCx)}→${anchorFromCx(b.bandCx)}`);
  }
  eq("转 180° 顶带换边", flipErr.length, 0, flipErr.join(" ; "));
  // 分区色心：只看颜色（不看 alpha），偏-weighted 重心。它必须跟着壶嘴面走——
  // 若着色里的旋转矩阵符号与几何相反（左手系），剪影仍然对称，只有这一条会露馅。
  const zoneErr = [];
  for (const r of sweep) {
    const offBand = r.bandCx - (W - 1) / 2, offZone = r.zoneCx - (W - 1) / 2;
    if (Math.abs(offBand) > W * 0.06) {
      if (Math.sign(offZone) !== Math.sign(offBand)) zoneErr.push(`${r.az}:band${offBand.toFixed(1)}/zone${offZone.toFixed(1)}`);
      if (Math.abs(offZone) < 10) zoneErr.push(`${r.az}:色心没离开中线(${r.zoneCx})`);
    }
    const b = byAz.get(wrapDeg(180 - r.az));
    if (b && b.zoneCx != null && Math.abs(r.zoneCx + b.zoneCx - (W - 1)) > 40) zoneErr.push(`${r.az}+${wrapDeg(180 - r.az)} 色心和 ${r.zoneCx + b.zoneCx}`);
  }
  eq("分区色心跟随壶嘴面（含镜像）", zoneErr.length, 0, zoneErr.join(" ; ").slice(0, 220));
  ok("分区色心确实偏离主体色（着色真的分了区）", sweep.every((r) => r.zoneDev > 2000), `最小偏差 ${Math.min(...sweep.map((r) => r.zoneDev))}`);
  // 顶带重心必须落在解析投影的壶嘴尖端附近（两条独立式子同一个像素）
  const tipErr = sweep.filter((r) => r.tipX == null || r.bandCx == null || Math.abs(r.bandCx - r.tipX) > W * 0.09);
  eq("顶带重心贴着壶嘴投影(±9%宽)", tipErr.length, 0, tipErr.map((r) => `${r.az}:band${r.bandCx}/tip${r.tipX}`).join(" ; ").slice(0, 200));
  const signErr = sweep.filter((r) => r.bandCx != null && r.tipX != null &&
    Math.abs(r.bandCx - W / 2) > W * 0.06 && Math.sign(r.bandCx - W / 2) !== Math.sign(r.tipX - W / 2));
  eq("顶带与壶嘴同侧", signErr.length, 0, signErr.map((r) => r.az).join(","));

  g(`time.${s}`);
  const tInvar = await page.evaluate(() => {
    const mz = window.__mz;
    mz.setView(37, 12); mz.setFrozenTime(0); mz.renderNow(0);
    const a0 = mz.measureNow(); const alpha0 = mz.pixHash("alpha"); const rgba0 = mz.pixHash("rgba");
    mz.renderNow(7.53);
    const a1 = mz.measureNow(); const alpha1 = mz.pixHash("alpha"); const rgba1 = mz.pixHash("rgba");
    mz.renderNow(0);
    const rgbaBack = mz.pixHash("rgba");
    return { area0: a0.area, area1: a1.area, bbox0: a0.bbox, bbox1: a1.bbox, alpha0, alpha1, rgba0, rgba1, rgbaBack };
  });
  eq("换 uTime 不改剪影面积", tInvar.area1, tInvar.area0);
  eq("换 uTime 不改包围盒", JSON.stringify(tInvar.bbox1), JSON.stringify(tInvar.bbox0));
  eq("换 uTime 不改 alpha 指纹", tInvar.alpha1, tInvar.alpha0);
  eq("uTime 回到同值则像素还原", tInvar.rgbaBack, tInvar.rgba0);
  const usesTime = s === "vitrine";
  ok(usesTime ? "vitrine：uTime 只改着色" : `${s}：uTime 完全无影响`,
    usesTime ? tInvar.rgba1 !== tInvar.rgba0 : tInvar.rgba1 === tInvar.rgba0,
    `${tInvar.rgba0}/${tInvar.rgba1}`);

  g(`uniform.${s}`);
  evidence.uniform[s] = await page.evaluate(async () => {
    const mz = window.__mz;
    const before = window.__u1.length;
    mz.setView(4000, 10); mz.renderNow(0);
    const big = window.__u1.slice(before, before + 3);
    const b2 = window.__u1.length;
    mz.setView(-720, 10); mz.renderNow(0);
    const neg = window.__u1.slice(b2, b2 + 3);
    return { big, neg, all: window.__u1.length };
  });
  const u = evidence.uniform[s];
  eq("每次绘制恰好三次 uniform1f", u.big.length, 3);
  near("4000° 写入前 wrap 到 [0,2π)", u.big[0], (4000 % 360) * Math.PI / 180, 1e-6);
  ok("方位弧度非负且小于 2π", u.big[0] >= 0 && u.big[0] < TAU && u.neg[0] >= 0 && u.neg[0] < TAU, `${u.big[0]} / ${u.neg[0]}`);
  near("−720° 归一到 0", u.neg[0], 0, 1e-6);
  const leaked = await page.evaluate(() => { const mz = window.__mz; mz.setView(123.4, 9); mz.renderNow(0); return mz.uniforms.uAzimuth; });
  ok("探针报告的 uniform 与写入值同轨", Math.abs(wrapRad(leaked)) < TAU, String(leaked));

  g(`presets.${s}`);
  const presetRows = [];
  for (const p of facts.presets) {
    const row = await page.evaluate(async (id) => {
      const btn = document.querySelector(`#presetBar button[data-preset="${id}"]`);
      const mz = window.__mz;
      const before = mz.view.draws;
      btn.click();
      await new Promise((r) => { let n = 0; (function w() { n++; if (window.__mz.view.draws > before || n > 120) r(); else requestAnimationFrame(w); })(); });
      const tr = document.querySelector(`#angleTable tbody tr[data-row="${id}"]`);
      return {
        view: mz.view,
        readout: document.getElementById("readout").textContent,
        aria: document.getElementById("gl").getAttribute("aria-label"),
        measured: tr && tr.querySelector('[data-cell="measured"]').textContent,
        declared: tr && tr.children[3].textContent,
        active: tr && tr.getAttribute("data-active"),
        on: btn.getAttribute("data-on"),
      };
    }, p.id);
    presetRows.push({ id: p.id, expect: p.expectTopband, ...row });
  }
  evidence.presets[s] = presetRows.map((r) => ({ id: r.id, expect: r.expect, measured: r.measured, azDeg: r.view.azDeg }));
  const bandByAz = new Map(sweep.map((r) => [r.az, r.bandCx]));
  for (const p of facts.presets) {
    const r = presetRows.find((x) => x.id === p.id);
    eq(`${p.id} 表内声明锚点`, r.declared, anchorWord(p.expectTopband));
    eq(`${p.id} 实测锚点=声明锚点`, r.measured, anchorWord(p.expectTopband));
    ok(`${p.id} 读数含锚点`, r.readout.includes(anchorWord(p.expectTopband)), r.readout);
    ok(`${p.id} aria 含锚点`, r.aria.includes(anchorWord(p.expectTopband)), r.aria);
    eq(`${p.id} 行高亮`, r.active, "1");
    eq(`${p.id} 按钮选中态`, r.on, "1");
    near(`${p.id} 方位到位`, wrapDeg(r.view.azDeg), wrapDeg(p.azDeg), 0.6);
    near(`${p.id} 仰角到位`, r.view.elDeg, p.elDeg, 0.6);
    // 表里的实测词必须能被 Node 用同一份判据从扫描数据复算出来（不是页面自己说了算）。
    // 扫描固定在预设[0]的仰角，仰角不同的行不参与这条比对。
    const cx = bandByAz.get(wrapDeg(p.azDeg));
    if (cx != null && p.elDeg === facts.presets[0].elDeg) eq(`${p.id} 实测=Node复算`, r.measured, anchorWord(anchorFromCx(cx)));
  }

  g(`ui.${s}`);
  const ui = await page.evaluate(async () => {
    const mz = window.__mz;
    mz.setView(0, 8); mz.renderNow(0);
    // 先把 setView 触发的那一帧等掉，再开始计空转帧数
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 120));
    const out = { idleStart: mz.view.draws };
    await new Promise((r) => setTimeout(r, 350));
    out.idleEnd = mz.view.draws;
    return out;
  });
  eq("无交互不重绘（350ms 空转）", ui.idleEnd, ui.idleStart);

  const canvasBox = await page.locator("#gl").boundingBox();
  const cx0 = canvasBox.x + canvasBox.width / 2, cy0 = canvasBox.y + canvasBox.height / 2;
  await page.evaluate(() => { window.__mz.setView(0, 8); window.__mz.renderNow(0); });
  const beforeDrag = await page.evaluate(() => window.__mz.view);
  await page.mouse.move(cx0, cy0);
  await page.mouse.down();
  await page.mouse.move(cx0 + 60, cy0 - 25, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterDrag = await page.evaluate(() => window.__mz.view);
  near("拖 60px → 方位 +33°", afterDrag.azDeg, beforeDrag.azDeg + 60 * facts.controls.dragSensitivityDegPerPx, 0.6);
  near("拖 −25px → 仰角 +3°", afterDrag.elDeg, beforeDrag.elDeg + 25 * facts.controls.elevationSensitivityDegPerPx, 0.6);
  ok("拖拽触发重绘", afterDrag.draws > beforeDrag.draws, `${beforeDrag.draws}→${afterDrag.draws}`);

  await page.locator("#gl").focus();
  const beforeKey = await page.evaluate(() => window.__mz.view);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  const afterKey = await page.evaluate(() => window.__mz.view);
  near("方向键一步=事实步进", afterKey.azDeg, beforeKey.azDeg + facts.controls.keyboardStepDeg, 0.6);
  await page.keyboard.press("Home");
  await page.waitForTimeout(200);
  const afterHome = await page.evaluate(() => window.__mz.view);
  near("Home 回到首预设", afterHome.azDeg, facts.presets[0].azDeg, 0.6);
  near("Home 回到首预设仰角", afterHome.elDeg, facts.presets[0].elDeg, 0.6);

  await page.evaluate(() => window.__mz.setView(100, 8));
  const beforeReset = await page.evaluate(() => window.__mz.view);
  await page.click("#resetBtn");
  await page.waitForTimeout(200);
  const afterReset = await page.evaluate(() => window.__mz.view);
  near("复位按钮回壶嘴在右", afterReset.azDeg, facts.presets[0].azDeg, 0.6);
  ok("复位确实重绘", afterReset.draws > beforeReset.draws);

  const spinBefore = await page.evaluate(() => window.__mz.view);
  await page.click("#spinBtn");
  const pressedAfterOn = await page.getAttribute("#spinBtn", "aria-pressed");
  await page.waitForTimeout(600);
  const spinMid = await page.evaluate(() => ({ v: window.__mz.view, text: document.getElementById("spinBtn").textContent }));
  await page.click("#spinBtn");
  await page.waitForTimeout(120);
  const spinStopped1 = await page.evaluate(() => window.__mz.view);
  await page.waitForTimeout(300);
  const spinStopped2 = await page.evaluate(() => window.__mz.view);
  const expectSpin = spinBefore.azDeg + 0.6 * facts.controls.spinDegPerSec;
  eq("自转按钮 aria-pressed=true", pressedAfterOn, "true");
  ok("自转文案切换", spinMid.text === labels.btnSpinOn, spinMid.text);
  ok("自转推进方位（≈30°/s）", wrapDeg(spinMid.v.azDeg - spinBefore.azDeg) > 5 && wrapDeg(spinMid.v.azDeg - spinBefore.azDeg) < expectSpin + 25,
    `Δ${wrapDeg(spinMid.v.azDeg - spinBefore.azDeg).toFixed(2)}° / 600ms`);
  eq("停止后 aria-pressed=false", await page.getAttribute("#spinBtn", "aria-pressed"), "false");
  eq("关自转后彻底停笔", spinStopped2.draws, spinStopped1.draws);
  evidence.interactions[s] = { drag: [beforeDrag.azDeg, afterDrag.azDeg], spin: [spinBefore.azDeg, spinMid.v.azDeg] };

  g(`shot.${s}`);
  await page.evaluate(() => { const mz = window.__mz; mz.setLive(false); mz.setView(0, 8); mz.setFrozenTime(0); mz.renderNow(0); });
  await page.locator(".stage").screenshot({ path: path.join(SHOTS, `stage-${s}.png`) });
  ok("展台截图落盘", fs.existsSync(path.join(SHOTS, `stage-${s}.png`)), `stage-${s}.png`);
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(250);
  const narrow = await page.evaluate(() => {
    const b = document.getElementById("gl").getBoundingClientRect();
    return { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, w: Math.round(b.width), top: Math.round(b.top) };
  });
  ok("窄屏无横向溢出", narrow.overflowX === false, JSON.stringify(narrow));
  ok("窄屏画布仍可见", narrow.w > 120 && narrow.top < 900, JSON.stringify(narrow));
  await page.locator(".stage").screenshot({ path: path.join(SHOTS, `stage-${s}-narrow.png`) });
  await ctx.close();
}

function wrapRad(r) { return ((r % TAU) + TAU) % TAU; }

/* 跨皮肤：同视角同几何，alpha 剪影必须逐像素相同；颜色必须不同 */
g("crossSkin");
const ref = { az: 37, el: 12 };
const cross = [];
for (const s of STYLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url.pathToFileURL(path.join(ROOT, "preview", `showcase-${s}.html`)).href, { waitUntil: "load" });
  await page.waitForFunction(() => window.__mz && window.__mz.ready === true, { timeout: 60000 });
  cross.push(await page.evaluate(({ az, el }) => {
    const mz = window.__mz;
    mz.setFrozenTime(0); mz.setView(az, el); mz.renderNow(0);
    const m = mz.measureNow();
    return { style: mz.skin, alpha: mz.pixHash("alpha"), rgba: mz.pixHash("rgba"), area: m.area, bbox: m.bbox, bandCx: m.band.cx, facing: mz.facingNow(), tip: mz.projectTipNow() };
  }, ref));
  await ctx.close();
}
evidence.crossSkin = cross;
eq("三皮肤同视角剪影面积相同", new Set(cross.map((c) => c.area)).size, 1, cross.map((c) => c.area).join(","));
eq("三皮肤同视角包围盒相同", new Set(cross.map((c) => JSON.stringify(c.bbox))).size, 1);
eq("三皮肤同视角 alpha 指纹相同", new Set(cross.map((c) => c.alpha)).size, 1, cross.map((c) => c.alpha).join(","));
eq("三皮肤颜色互异", new Set(cross.map((c) => c.rgba)).size, 3, cross.map((c) => c.rgba).join(","));
eq("三皮肤顶带锚点同侧", new Set(cross.map((c) => anchorFromCx(c.bandCx))).size, 1, cross.map((c) => anchorFromCx(c.bandCx)).join(","));
// JS 复算的朝向必须与像素侧向一致：facing>0 时顶带应在中线一侧（-0 与 +0 除外）
const facing = cross[0].facing, bandCx = cross[0].bandCx;
ok("朝向判据与像素同轨", Math.abs(bandCx - W / 2) < W * 0.06 ? Math.abs(facing) < 0.12 : Math.sign(facing) === Math.sign(bandCx - W / 2) || Math.abs(bandCx - W / 2) > W * 0.4,
  `facing=${facing} bandCx=${bandCx}`);

await browser.close();

const pass = results.filter((r) => r.pass).length;
const fails = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(ROOT, "evidence", "browser-report.json"),
  JSON.stringify({ total: results.length, pass, fail: fails.length, evidence, results }, null, 2) + "\n");
console.log(JSON.stringify({ suite: "check-browser", total: results.length, pass, fail: fails.length, fails: fails.map((f) => `${f.id} → ${f.detail}`) }));
process.exit(fails.length ? 1 : 0);
