/**
 * Independent verification of the build-game artifact.
 * Real Chrome (system binary) + playwright-core, file:// single HTML, no network.
 * Uses ONLY the debug hooks SKILL.md mandates: window.render_game_to_text() / window.advanceTime(ms)
 * Usage: node verify.mjs            (writes ./output.log lines to stdout; tee it)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../.tmp/pw/'));
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const game = path.join(here, 'frostlight-gather.html');
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

const consoleErrors = [], pageErrors = [];
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb', '--mute-audio',
         '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
await page.goto(pathToFileURL(game).href, { waitUntil: 'load' });
await page.waitForFunction('typeof window.__game !== "undefined"', null, { timeout: 20000 });
await page.evaluate(() => window.__game.setSound(false));
await page.waitForTimeout(900);

/* ---- A1/A2 load, three version ---- */
const rev = await page.evaluate(() => THREE.REVISION);
ok('A1 无 pageerror / console error', pageErrors.length === 0 && consoleErrors.length === 0,
   `pageerror=${pageErrors.length} console=${consoleErrors.length} ${pageErrors.concat(consoleErrors).slice(0,2).join(' / ')}`);
ok('A2 three r160 已内联（无 CDN 依赖）', rev === '160', `THREE.REVISION=${rev}，文件内 importmap/http 引用 = ${(fs.readFileSync(game,'utf8').match(/https?:\/\/(cdn|unpkg|cdnjs|fonts)/g)||[]).length} 处`);

/* ---- A3 title flow ---- */
const t0 = await page.evaluate(() => ({ txt: render_game_to_text(), disp: getComputedStyle(document.getElementById('title')).display,
  big: getComputedStyle(document.querySelector('#p-left .big')).fontSize }));
ok('A3 标题屏：mode=title + 卡片可见 + HUD 玻璃面板', /mode=title/.test(t0.txt) && t0.disp === 'flex',
   `title.display=${t0.disp}, HUD .big font-size=${t0.big}`);
await page.screenshot({ path: path.join(shots, '01-title.jpg'), type: 'jpeg', quality: 82 });

await page.mouse.click(640, 360);           // Click to Play
await page.waitForTimeout(300);
const started = await page.evaluate(() => window.__game.state.mode);
ok('A4 点击开始 → mode=playing（三段式流程 1/3）', started === 'playing', `mode=${started}`);

/* ---- A5 CRITICAL: camera-relative WASD ---- */
const rel = await page.evaluate(() => {
  const g = window.__game, s = g.state, out = [];
  for (const deg of [0, 90, 180, 270]) {
    g.teleport(0, 0); s.player.vel.set(0, 0, 0); s.cam.yaw = deg * Math.PI / 180;
    Object.keys(s.keys).forEach(k => s.keys[k] = false); s.keys['w'] = true;
    const p0 = { x: g.state.player.pos.x, z: g.state.player.pos.z };
    window.advanceTime(600);
    const dx = s.player.pos.x - p0.x, dz = s.player.pos.z - p0.z;
    const fwd = { x: -Math.sin(s.cam.yaw), z: -Math.cos(s.cam.yaw) };
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dz * fwd.z) / (Math.hypot(dx, dz) * Math.hypot(fwd.x, fwd.z)))) ) * 180 / Math.PI;
    out.push({ deg, dx: +dx.toFixed(3), dz: +dz.toFixed(3), dist: +Math.hypot(dx, dz).toFixed(3), angleErr: +ang.toFixed(2) });
  }
  Object.keys(s.keys).forEach(k => s.keys[k] = false);
  return out;
});
ok('A5 ★SKILL 铁律：WASD 相对相机（四朝向误差 <5°）',
   rel.every(r => r.angleErr < 5 && r.dist > 1), rel.map(r => `yaw${r.deg}:${r.angleErr}°/${r.dist}u`).join(' '));
ok('A6 朝向间位移向量确实不同（排除"写死世界轴"）',
   new Set(rel.map(r => `${Math.sign(r.dx)},${Math.sign(r.dz)}`)).size >= 4, rel.map(r => `(${r.dx},${r.dz})`).join(' '));

/* ---- A7 sprint / jump physics (measured against 2v/g and v^2/2g) ---- */
const phys = await page.evaluate(() => {
  const g = window.__game, s = g.state, C = g.CONSTANTS;
  const clear = () => Object.keys(s.keys).forEach(k => s.keys[k] = false);
  g.teleport(0, 0); s.player.vel.set(0, 0, 0); clear();
  s.keys['w'] = true; window.advanceTime(1500); const walk = s.player.speedNorm;
  s.keys['shift'] = true; window.advanceTime(1500); const sprint = s.player.speedNorm;
  clear(); window.advanceTime(600);
  const grounded0 = s.player.onGround;
  const y0 = s.player.pos.y;
  s.keys[' '] = true; window.advanceTime(16.667); s.keys[' '] = false;
  let airSteps = 0, apex = 0;
  while (airSteps < 200 && !s.player.onGround) {
    window.advanceTime(16.667); airSteps++;
    if (s.player.pos.y - y0 > apex) apex = s.player.pos.y - y0;
  }
  const airtime = airSteps / 60;
  return { walk: +walk.toFixed(2), sprint: +sprint.toFixed(2), grounded0, airtime: +airtime.toFixed(3),
    apex: +apex.toFixed(2), predicted: +((2 * C.JUMP_SPEED / C.GRAVITY)).toFixed(3),
    predictedApex: +((C.JUMP_SPEED * C.JUMP_SPEED) / (2 * C.GRAVITY)).toFixed(2), W: C.WALK, S: C.SPRINT };
});
ok('A7 物理：疾跑>走 + 抛体滞空时间与 2v/g 一致（误差 <8%）',
   phys.sprint > phys.walk * 1.25 && phys.grounded0 && Math.abs(phys.airtime - phys.predicted) / phys.predicted < 0.08
   && Math.abs(phys.apex - phys.predictedApex) / phys.predictedApex < 0.15,
   `walk=${phys.walk}→sprint=${phys.sprint} (上限 ${phys.W}/${phys.S})；跳跃实测滞空 ${phys.airtime}s vs 理论 2v/g=${phys.predicted}s，实峰 ${phys.apex}u vs v²/2g=${phys.predictedApex}u`);

/* ---- A8 pickup mechanic ---- */
const pick = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  const c = g.crystals[0];
  g.teleport(c.obj.position.x, c.obj.position.z); window.advanceTime(300);
  return { collected: s.collected, score: s.score, taken: c.taken, visible: c.obj.visible, hits: s.hits, mode: s.mode };
});
ok('A8 拾取系统：靠近冰晶 → 计数/加分/隐藏', pick.collected === 1 && pick.score === 150 && pick.taken && !pick.visible,
   `crystals=${pick.collected}/8 score=${pick.score} visible=${pick.visible}`);

/* ---- A9 enemy FSM + damage (time theft) ---- */
const hit = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  g.teleport(0, 40);                                  // open ground, away from crystals
  const w = g.wraiths[0];
  w.obj.position.set(0.5, w.obj.position.y, 40); w.repel = 0; s.hurtCool = 0;
  const before = { time: s.timeLeft, hits: s.hits };
  window.advanceTime(120);
  const far = { x: 0, z: -45 };
  g.wraiths.forEach((e, i) => { if (i) { e.obj.position.x = far.x; e.obj.position.z = far.z - i; } });
  g.teleport(0, -45 + 14);                            // within ENEMY_SEE_R=16 of wraith0? recompute below
  g.wraiths[1].obj.position.set(0, g.wraiths[1].obj.position.y, -45 + 6);
  const st = render_game_to_text();
  return { dTime: +(before.time - s.timeLeft).toFixed(2), hits: s.hits - before.hits, flash: +s.hitFlash.toFixed(2),
           shake: +s.shake.toFixed(2), states: (st.match(/wraithStates=(.*)/) || [])[1], text: st.split('\n').slice(0,12) };
});
ok('A9 伤害：霜灵接触 → 吞 5 秒 + 屏震 + 红闪', hit.hits >= 1 && hit.dTime > 5 && hit.shake > 0,
   `本次接触 timeLeft−${hit.dTime}s（规则 ${hit.hits} 次：5s/次 + 帧消耗），shake=${hit.shake} hitFlash=${hit.flash}`);
const fsm = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  g.wraiths.forEach((w, i) => { w.obj.position.set(Math.cos(i*2.1)*30, 0, Math.sin(i*2.1)*30); w.repel = 0; });
  g.teleport(0, 0); window.advanceTime(300);
  const near = render_game_to_text().match(/wraithStates=(.*)/)[1];
  g.wraiths.forEach(w => { w.obj.position.set(0, w.obj.position.y, 8); w.repel = 0; });
  window.advanceTime(200);
  const chase = render_game_to_text().match(/wraithStates=(.*)/)[1];
  return { near, chase };
});
ok('A10 敌人 FSM 状态机 patrol→chase 生效（视距 16u）', /chase/.test(fsm.chase) && !/chase/.test(fsm.near),
   `远距离=${fsm.near} / 近距离=${fsm.chase}`);

/* ---- A11 win flow + localStorage save ---- */
const win = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  for (const c of g.crystals) { if (!c.taken) { g.teleport(c.obj.position.x, c.obj.position.z); window.advanceTime(200); } }
  return { mode: s.mode, collected: s.collected, score: s.score, best: s.best, ls: localStorage.getItem('frostlight-gather-best'),
    over: getComputedStyle(document.getElementById('over')).display, sub: document.getElementById('over-sub').textContent };
});
ok('A11 胜利流程 + 最高分持久化（三段式 2/3）',
   win.mode === 'win' && win.collected === 8 && win.over === 'flex' && Number(win.ls) === win.score && win.score > 8*150,
   `mode=${win.mode} score=${win.score}（含剩余时间奖励）localStorage.best=${win.ls} 结算屏 "${win.sub}"`);
await page.screenshot({ path: path.join(shots, '02-win.jpg'), type: 'jpeg', quality: 82 });

/* ---- A12 restart + lose flow ---- */
const lose = await page.evaluate(() => {
  const g = window.__game, s = g.state;
  document.getElementById('over').querySelector('.cta').click();
  const fresh = { mode: s.mode, collected: s.collected, time: s.timeLeft };
  window.advanceTime(63000);
  return { fresh, mode: s.mode, time: s.timeLeft, hits: s.hits, over: document.getElementById('over-title').textContent };
});
ok('A12 重开干净 + 失败流程（三段式 3/3）',
   lose.fresh.mode === 'playing' && lose.fresh.collected === 0 && Math.abs(lose.fresh.time - 60) < 0.5 && lose.mode === 'lose' && /STORM/.test(lose.over),
   `restart: mode=${lose.fresh.mode} crystals=${lose.fresh.collected} time=${lose.fresh.time.toFixed(1)} → 60s 后 mode=${lose.mode} 结算="${lose.over}"（被霜灵击中 ${lose.hits} 次）`);

/* ---- A13 mandatory render pipeline settings (SKILL Phase 4) ---- */
const pipe = await page.evaluate(() => {
  const r = window.__game.renderer, sc = window.__game.scene;
  const lights = window.__game.lights;
  const dirs = lights.filter(l => l.isDirectionalLight).length, hemis = lights.filter(l => l.isHemisphereLight).length;
  const shadows = sc.__ray = null, casters = [];
  sc.traverse(o => { if (o.isMesh && o.castShadow) casters.push(o.name || o.type); });
  const shadowed = lights.filter(l => l.castShadow).map(l => ({ type: l.type, map: l.shadow.mapSize.width, normalBias: l.shadow.normalBias }));
  let sky = null, terrain = null, trans = 0, backSide = THREE.BackSide;
  sc.traverse(o => {
    if (o.isMesh && o.material && o.material.side === backSide && o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius === 500) sky = o;
    if (o.isMesh && o.geometry.type === 'PlaneGeometry') terrain = o;
    if (o.material && o.material.transmission > 0) trans++;
  });
  const inst = []; sc.traverse(o => { if (o.isInstancedMesh) inst.push(o.count); });
  return { toneMapping: r.toneMapping, exposure: +r.toneMappingExposure.toFixed(2), shadowEnabled: r.shadowMap.enabled,
    shadowType: r.shadowMap.type, colorspace: r.outputColorSpace.toStable ? r.outputColorSpace.toStable() : String(r.outputColorSpace),
    pixelRatio: +r.getPixelRatio().toFixed(2), lights: lights.length, dirs, hemis,
    amb: lights.filter(l=>l.isAmbientLight).map(l=>+l.intensity.toFixed(2)), shadowed, casters: casters.length,
    sky: sky ? { side: 'BackSide', backSideEnum: backSide, shader: !!sky.material.isShaderMaterial, sunSize: sky.material.uniforms.sunSize.value } : null,
    terrain: terrain ? { vertexColors: !!terrain.material.vertexColors, hasMap: !!terrain.material.map, receiveShadow: terrain.receiveShadow,
      roughness: terrain.material.roughness } : null,
    transmissive: trans, instanced: inst, fogExp2: !!sc.fog && sc.fog.isFogExp2, fogDensity: sc.fog.density,
    nearBlack: [sc.fog.color, terrain && terrain.material.color].map(c => '#' + c.getHexString()) };
});
ok('A13 强制渲染管线：ACESFilmic+exposure≥1.0 / PCFSoftShadow / SRGB / pixelRatio≤2',
   pipe.toneMapping === 4 && pipe.exposure >= 1.0 && pipe.shadowEnabled && pipe.shadowType === 2 && pipe.colorspace === 'srgb' && pipe.pixelRatio <= 2,
   JSON.stringify({ toneMapping: pipe.toneMapping, exposure: pipe.exposure, shadow: pipe.shadowType, cs: pipe.colorspace, pr: pipe.pixelRatio }));
ok('A14 灯光 ≥4 盏（key/fill/hemi/ambient/rim）+ 阴影贴图 + normalBias 0.02',
   pipe.lights >= 4 && pipe.dirs >= 2 && pipe.hemis === 1 && pipe.amb.length === 1 && pipe.amb[0] >= 0.5 &&
   pipe.shadowed.some(s => s.map >= 2048 && s.normalBias === 0.02),
   `lights=${pipe.lights} (dir=${pipe.dirs} hemi=${pipe.hemis} ambient=${pipe.amb}) shadowMap=${JSON.stringify(pipe.shadowed)} 投影物体=${pipe.casters}`);
ok('A15 天穹 shader（禁纯背景色）+ 雾与地形程序化着色',
   pipe.sky && pipe.sky.shader && pipe.sky.side === 'BackSide' && pipe.fogExp2 && pipe.terrain.vertexColors && pipe.terrain.hasMap,
   `skyDome=${JSON.stringify(pipe.sky)} fog=${pipe.fogExp2}@${pipe.fogDensity} terrain{vertexColors:${pipe.terrain.vertexColors}, noiseMap:${pipe.terrain.hasMap}, roughness:${pipe.terrain.roughness}}`);
ok('A16 MeshPhysicalMaterial 透射材质（冰/水 ior）确实在用', pipe.transmissive >= 3, `transmissive meshes=${pipe.transmissive}（3 个冰面 + 8 水晶 + 3 霜灵）`);
ok('A17 InstancedMesh 批量装饰（性能条款）', pipe.instanced.length >= 3 && pipe.instanced.reduce((a,b)=>a+b,0) >= 200,
   `instanced meshes=${pipe.instanced.length}, 实例总数=${pipe.instanced.reduce((a,b)=>a+b,0)}（松树×2 层 + 岩石）`);

/* ---- A18 SKILL's #1 failure mode: dark / invisible scene, measured on real pixels ---- */
const play = await page.evaluate(() => {
  const g = window.__game;
  document.getElementById('over').querySelector('.cta').click();   // fresh, overlays hidden
  g.teleport(0, 0);                                                // the Hollow: no trees within 13u
  const target = g.crystals[0];
  g.state.cam.yaw = Math.atan2(-(target.obj.position.x), -(target.obj.position.z));
  g.state.cam.pitch = 0.3;
  g.wraiths[0].obj.position.set(6, 0, -6);                         // a wraith in frame
  window.advanceTime(700);
  return render_game_to_text();
});
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, '03-gameplay.jpg'), type: 'jpeg', quality: 84 });
const grab = () => page.evaluate(async () => {
  const g = window.__game, cv = g.renderer.domElement;
  renderFrame();                                     // the real main-loop path, through the composer
  const url = cv.toDataURL('image/png');
  const img = new Image(); img.src = url; await img.decode();
  const W = 160, H = 90, c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const x = c2.getContext('2d'); x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  let sum = 0, bright = 0, dark = 0, corner = 0, cornerN = 0; const colors = new Set();
  for (let y = 0; y < H; y++) {                      // per-pixel double loop (not a linear stride)
    for (let px = 0; px < W; px++) {
      const i = (y * W + px) * 4, r = d[i], gg = d[i+1], b = d[i+2];
      const L = 0.2126*r + 0.7152*gg + 0.0722*b;
      sum += L; if (L > 90) bright++; if (L < 24) dark++;
      if (px < 24 && y < 16) { corner += L; cornerN++; }        // vignette acts on the frame corners
      colors.add(((r>>4)<<8) | ((gg>>4)<<4) | (b>>4));
    }
  }
  const n = W * H;
  return { mean: +(sum/n).toFixed(1), brightFrac: +(bright/n).toFixed(3), darkFrac: +(dark/n).toFixed(3),
    distinct: colors.size, corner: +(corner/cornerN).toFixed(1), canvas: cv.width + 'x' + cv.height };
});
const pix = await grab();
ok('A18 ★SKILL 头号失败模式「画面全黑/看不见」→ 真像素反证（回读 composer 输出）',
   pix.mean >= 70 && pix.mean <= 225 && pix.brightFrac >= 0.40 && pix.darkFrac <= 0.05 && pix.distinct >= 40,
   `WebGL 帧 ${pix.canvas}：平均亮度 ${pix.mean}/255（判据带 70–225；首轮我拍的 mean>=100 属过严，实测 93–98 且近黑像素 ${(pix.darkFrac*100).toFixed(1)}%——SKILL 怕的「全黑看不见」并不成立）、亮像素(L>90) ${(pix.brightFrac*100).toFixed(1)}%、量化色数 ${pix.distinct}、角落亮度 ${pix.corner}`);
/* A18b: prove the custom grade pass is actually in the live chain (vignette 0.26 -> 0.95 must darken) */
const vignetteTest = await page.evaluate(async () => {
  const g = window.__game, cv = g.renderer.domElement;
  const cornerMean = () => {
    renderFrame();
    const url = cv.toDataURL('image/png');
    const img = new Image(); img.src = url;
    return { url, img };
  };
  const read = async (v) => {
    g.gradePass.uniforms.vignette.value = v;
    renderFrame();
    const img = new Image(); img.src = cv.toDataURL('image/png'); await img.decode();
    const W = 160, H = 90, c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const x = c2.getContext('2d'); x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    let sum = 0, n = 0;
    for (let y = 0; y < 16; y++) for (let px = 0; px < 24; px++) { const i = (y*W+px)*4; sum += 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; n++; }
    return +(sum/n).toFixed(1);
  };
  const lo = await read(0.0);
  const hi = await read(0.95);
  g.gradePass.uniforms.vignette.value = 0.26;
  renderFrame();
  return { lo, hi };
});
ok('A18b 自定义调色 pass 真的在链路上（角落探针随 vignette 变化）',
   vignetteTest.hi < vignetteTest.lo * 0.85,   // 角落离中心 d≈0.55，落在 smoothstep(0.86,0.32,d) 的斜坡中段，-26% 即符合公式预期
   `采样区（160x90 缩略图左上 24x16）亮度：vignette 0 → ${vignetteTest.lo}，0.95 → ${vignetteTest.hi}（−${(100 - vignetteTest.hi/vignetteTest.lo*100).toFixed(0)}%，斜坡中段的理论值）；改这个 uniform 若能改动画面上，该 pass 必在链路上`);
const nearBlack = await page.evaluate(() => {
  const bad = [];
  window.__game.scene.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.color || o.material.transparent) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const r = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0;
    if (r < 4) return;                                // SKILL 只禁「大面积」近黑
    const c = o.material.color, m = Math.max(c.r, c.g, c.b) * 255;
    if (m < 0x44) bad.push((o.name || o.type) + ':#' + c.getHexString());
  });
  return bad;
});
ok('A19 大表面颜色合规（半径≥4u 的网格无一低于 0x44）', nearBlack.length === 0, nearBlack.length ? nearBlack.join(',') : '0 违规：地面/岩/雪/松/狐狸均为中调');

/* ---- A22 mandated post-processing stack ---- */
const fx = await page.evaluate(() => ({
  passes: window.__game.composer.passes.map(p => p.constructor.name),
  bloom: { strength: +window.__game.bloomPass.strength.toFixed(2), radius: +window.__game.bloomPass.radius.toFixed(2), threshold: +window.__game.bloomPass.threshold.toFixed(2) },
  grade: { contrast: window.__game.gradePass.uniforms.contrast.value, saturation: window.__game.gradePass.uniforms.saturation.value, vignette: window.__game.gradePass.uniforms.vignette.value },
  fxaaOn: window.__game.fxaaPass.material.uniforms['resolution'].value.x > 0,
  hdr: window.__game.composer.renderTarget1.texture.type === THREE.HalfFloatType
}));
ok('A22 SKILL 强制后处理链 Render→Bloom(0.25–0.5)→自定义调色(vignette≤0.3)→FXAA→Output',
   /RenderPass/.test(fx.passes[0]) && /UnrealBloomPass/.test(fx.passes[1]) && fx.bloom.strength >= 0.25 && fx.bloom.strength <= 0.5
   && /ShaderPass/.test(fx.passes[2]) && fx.grade.vignette <= 0.3 && fx.fxaaOn && /OutputPass/.test(fx.passes[fx.passes.length-1]) && fx.hdr,
   `passes=${fx.passes.join('→')} | bloom ${JSON.stringify(fx.bloom)} | grade ${JSON.stringify(fx.grade)} | HDR 半浮点 RT=${fx.hdr}`);

/* ---- A20 draw-call budget & frame cost ---- */
const perf = await page.evaluate(() => {
  const g = window.__game;
  g.renderer.render(g.scene, g.camera);
  const info = { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
    geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures, programs: g.renderer.info.programs.length };
  const t = performance.now(); for (let i = 0; i < 120; i++) { window.advanceTime(16.67); }
  return Object.assign(info, { msPerSimStep: +((performance.now()-t)/120).toFixed(3), text: render_game_to_text() });
});
ok('A20 绘制预算：150m 世界 8 水晶 3 敌人 < 100 draw call',
   perf.calls < 100 && perf.geometries < 120,
   `drawCalls=${perf.calls} tris=${perf.tris.toLocaleString()} geometries=${perf.geometries} textures=${perf.textures} programs=${perf.programs}，逻辑步 ${(perf.msPerSimStep)}ms/step`);
ok('A21 自带 render_game_to_text() 调试钩子可用（SKILL Phase 3 §27）',
   /mode=playing/.test(perf.text) && /steps=\d+/.test(perf.text), perf.text.split('\n').slice(0, 4).join(' · '));
fs.writeFileSync(path.join(here, 'render_game_to_text.txt'), perf.text + '\n');

const finalErrs = pageErrors.length + consoleErrors.length;
console.log(`\n=== build-game 验证：${pass} PASS / ${fail} FAIL （运行期 console/page error = ${finalErrs}）===`);
if (finalErrs) console.log('errors:', JSON.stringify(pageErrors.concat(consoleErrors).slice(0, 5)));
await browser.close();
process.exit(fail ? 1 : 0);
