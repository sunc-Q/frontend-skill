/* build-game 校验：把 SKILL.md 的强制条款转成运行时断言 + 游戏逻辑守恒断言。
   Run from LAB root:
     node artifacts/20260926-03-build-game-tower-defense/scripts/check.mjs
   Needs playwright-core (see report §2). Writes scripts/check-result.json. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
const NM = path.resolve(process.cwd(), '.tmp/build/node_modules');
const { chromium } = req(path.join(NM, 'playwright-core'));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const EXE =
  process.env.PW_CHROMIUM ||
  '/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const STYLES = ['sunlit-moss', 'obsidian-lava', 'arctic-glass'];
const R = [];
const results = {};
let group = 'A';
function assert(id, cond, detail) {
  const ok = !!cond;
  R.push({ group, id, ok, detail: detail === undefined ? '' : String(detail).slice(0, 300) });
  results[group] = results[group] || { pass: 0, fail: 0 };
  results[group][ok ? 'pass' : 'fail']++;
  if (!ok) console.log('FAIL', group, id, JSON.stringify(detail));
  return ok;
}

/* --------------------------------------------------------------- helpers */
function inlineScripts(html) {
  // a lazy /[\s\S]*?<\/script>\n<\/body>/ would swallow the theme-select tag into the bundle
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}
function inlineScript(html) {
  const all = inlineScripts(html);
  return all.length ? all.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}
const inter = (a, b) => [...a].filter((x) => b.has(x));

/* ------------------------------------------------------------- page evals */
const PROBE = () => {
  // serialised to source and re-created in the page: must not close over Node-side helpers
  const hexSet = (text) => {
    const out = new Set();
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) out.add(m[0].toLowerCase());
    return out;
  };
  const g = window.__game;
  const d = window.__diag();
  const gl = g.renderer.getContext();
  function luma() {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4 * w * h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0, sq = 0, bright = 0, dark = 0, clip = 0, hi = 0, mid = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      s += l;
      sq += l * l;
      if (l > 60) bright++;
      if (l < 12) dark++;
      if (l > 250) clip++;
      if (l > 150) hi++;
      if (l > 60 && l < 205) mid++;
    }
    return {
      meanLuma: +(s / n).toFixed(2), brightPct: +((100 * bright) / n).toFixed(2),
      darkPct: +((100 * dark) / n).toFixed(2), clippedPct: +((100 * clip) / n).toFixed(2),
      hiPct: +((100 * hi) / n).toFixed(2), midPct: +((100 * mid) / n).toFixed(2),
      std: +Math.sqrt(Math.max(0, sq / n - (s / n) * (s / n))).toFixed(2),
    };
  }
  g.composer.render();
  const fixed = luma();
  const idx = g.composer.passes.findIndex((p) => p.label === 'OutputPass');
  let docForm = null;
  if (idx >= 0) {
    const removed = g.composer.passes.splice(idx, 1);
    g.composer.passes.forEach((p, i) => (p.renderToScreen = i === g.composer.passes.length - 1));
    g.composer.render();
    docForm = luma();
    g.composer.passes.splice(idx, 0, removed[0]);
    g.composer.passes.forEach((p, i) => (p.renderToScreen = i === g.composer.passes.length - 1));
    g.composer.render();
  }
  /* the skill's literal documented SSAO constants, applied to this ortho rig */
  const ssaoIdx = g.composer.passes.findIndex((p) => p.label === 'SSAOPass');
  const ssao = g.composer.passes[ssaoIdx];
  const saved = { kr: ssao.kernelRadius, mn: ssao.minDistance, mx: ssao.maxDistance };
  Object.assign(ssao, { kernelRadius: 16, minDistance: 0.005, maxDistance: 0.1 });
  g.composer.render();
  const docSsao = luma();
  Object.assign(ssao, saved);
  g.composer.render();
  /* what the pass costs, and whether it changes a single pixel.
     renderer.info resets on every internal render, so accumulate explicitly. */
  const count = () => {
    g.renderer.info.autoReset = false;
    g.renderer.info.reset();
    g.composer.render();
    const v = { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
    g.renderer.info.autoReset = true;
    return v;
  };
  const infoOn = count();
  const all = [...g.composer.passes];
  g.composer.passes = all.filter((p) => p !== ssao);
  g.composer.passes[g.composer.passes.length - 1].renderToScreen = true;
  const noSsao = (() => { g.composer.render(); return luma(); })();
  const infoOff = count();
  g.composer.passes = all;
  all.forEach((p, i) => (p.renderToScreen = i === all.length - 1));
  g.composer.render();
  /* HUD computed styles (fingerprints) */
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  const rootVars = (() => {
    const st = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const m = st.match(/:root\{([\s\S]*?)\}/);
    return m ? m[1] : '';
  })();
  const skeleton = [...document.querySelectorAll('body *')]
    .filter((e) => e.tagName !== 'CANVAS' && !e.closest('script'))
    .map((e) => {
      let p = e, chain = [];
      while (p && p.tagName && p.tagName !== 'BODY') { chain.push(p.tagName); p = p.parentElement; }
      return chain.join('>');
    })
    .sort()
    .join('|');
  return {
    diag: d,
    luma: { fixed, docForm, docSsao, noSsao, infoOn, infoOff },
    hud: {
      radius: cs('.hud-panel', 'borderRadius'),
      glass: cs('.hud-panel', 'backgroundColor'),
      announceFont: cs('#announce-text', 'fontFamily'),
      accent: cs('#announce-text', 'color'),
      goldColor: cs('#gold-value', 'color'),
      paletteBorder: cs('.palette', 'borderRadius'),
      panelCount: document.querySelectorAll('.hud-panel').length,
      backdrop: cs('.hud-panel', 'backdropFilter') || cs('.hud-panel', '-webkit-backdrop-filter'),
      pointerHud: cs('#hud', 'pointerEvents'),
      pointerPalette: cs('.palette', 'pointerEvents'),
      tabular: cs('#gold-value', 'fontVariantNumeric'),
      transition: cs('.palette', 'transitionDuration'),
      vignetteZ: cs('#damage-vignette', 'zIndex'),
      hudZ: cs('#hud', 'zIndex'),
      screenZ: cs('.screen', 'zIndex'),
      userSelect: cs('#hud', 'userSelect'),
    },
    rootVars,
    skeleton,
    board: (() => {
      const C = g.CONSTANTS;
      let pathCells = 0, leftBuild = 0, rightBuild = 0;
      const cols = new Set();
      for (let cx = 0; cx < C.GRID_W; cx++)
        for (let cz = 0; cz < C.GRID_H; cz++) {
          if (g.isOnPath(cx, cz)) { pathCells++; continue; }
          cols.add(cx);
          if (cx < C.GRID_W / 2) leftBuild++; else rightBuild++;
        }
      /* heights matter: a road buried under the plate top is invisible at every theme */
      let plateTop = null, roadTop = null, roadY = null;
      g.scene.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh) return;
        const p = o.geometry.parameters;
        if (o.geometry.type === 'BoxGeometry' && p.height === 0.4) plateTop = o.position.y + p.height / 2;
        if (o.geometry.type === 'TubeGeometry') {
          roadY = o.position.y;
          roadTop = o.position.y + Math.abs(o.scale.y) * p.radius;
        }
      });
      return { pathCells, leftBuild, rightBuild, cols: cols.size, total: C.GRID_W * C.GRID_H, plateTop, roadTop, roadY };
    })(),
    styleHex: [...hexSet([...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'))],
    rootHex: [...hexSet(rootVars)],
  };
};

const SIM = (cfg) => {
  const g = window.__game;
  const S = g.state;
  g.cleanup();
  g.startRun();
  const cands = [];
  for (let cx = 0; cx < g.CONSTANTS.GRID_W; cx++) {
    for (let cz = 0; cz < g.CONSTANTS.GRID_H; cz++) {
      if (g.isOnPath(cx, cz)) continue;
      const w = g.cellToWorld([cx, cz]);
      let d = 1e9;
      for (let u = 0; u <= 1.0001; u += 0.02) {
        const p = g.curve.getPointAt(Math.min(1, u));
        d = Math.min(d, Math.hypot(p.x - w.x, p.z - w.z));
      }
      cands.push({ cx, cz, d });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.cx - b.cx || a.cz - b.cz);
  const trace = [];
  let ci = 0;
  const kinds = cfg.kinds;
  let ki = 0;
  const steps = cfg.seconds;
  for (let s = 0; s < steps; s++) {
    if (cfg.build) {
      for (let tries = 0; tries < 4 && ci < cands.length; tries++) {
        const c = cands[ci];
        const kind = kinds[ki % kinds.length];
        const cost = g.TOWER_TYPES[kind].cost;
        if (S.gold >= cost) {
          S.selected = kind;
          if (g.buildTower([c.cx, c.cz])) { ci++; ki++; } else ci++;
        }
      }
    }
    window.advanceTime(1000);
    trace.push({
      t: s, mode: S.mode, wave: S.wave, gold: S.gold, lives: S.lives,
      alive: g.enemies.length, towers: S.grid.size, spawned: S.spawned, killed: S.killed, leaked: S.leaked,
    });
    if (S.mode === 'gameover' || S.mode === 'victory') break;
  }
  const liveHp = g.enemies.reduce((a, e) => a + e.hp, 0);
  return {
    trace,
    final: JSON.parse(window.render_game_to_text()),
    S: {
      gold: S.gold, spent: S.spent, earned: S.earned, damageDealt: +S.damageDealt.toFixed(3),
      hpSpawned: S.hpSpawned, hpLeaked: +S.hpLeaked.toFixed(3), liveHp: +liveHp.toFixed(3),
      spawned: S.spawned, killed: S.killed, leaked: S.leaked, wave: S.wave, lives: S.lives,
      mode: S.mode, buildCount: S.buildCount, time: +S.time.toFixed(2), bestWave: S.bestWave, wins: S.wins,
    },
    pool: { created: window.__diag().counts.projectileCreated, active: window.__diag().counts.projectileActive },
    snap: window.render_game_to_text(),
  };
};

/* ------------------------------------------------------------------ main */
const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
const page = await ctx.newPage();
page.setDefaultTimeout(180000);

const pages = {};
for (const id of STYLES) {
  const logs = [];
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto('file://' + path.join(SCENE, id + '.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  // group 0: never let a dead page travel downstream as a wall of crashes
  assert('boot/ready/' + id, await page.evaluate(() => window.__ready === true), { logs: logs.slice(0, 4) });
  assert('boot/hooks/' + id, await page.evaluate(() =>
    !!window.__game && typeof window.__diag === 'function' &&
    typeof window.render_game_to_text === 'function' && typeof window.advanceTime === 'function'),
    await page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__'))));
  const p = await page.evaluate(PROBE);
  p.logs = logs;
  pages[id] = p;
}

/* ============================================== A. 技能强制条款（运行时） */
group = 'A';
for (const id of STYLES) {
  const d = pages[id].diag;
  assert('A/flags/' + id, d.renderer.toneMapping === 'ACESFilmic' && d.renderer.outputColorSpace === 'srgb', d.renderer);
  assert('A/shadowtype/' + id, d.renderer.shadowType === 'PCFSoft' && d.renderer.shadowEnabled, d.renderer.shadowType);
  assert('A/exposure/' + id, d.renderer.exposure >= 1.0 && d.renderer.exposure <= 1.4, d.renderer.exposure);
  assert('A/pixelratio/' + id, d.renderer.pixelRatio <= 2, d.renderer.pixelRatio);
  assert('A/mapsize/' + id, d.shadow.mapSize === 4096 && d.shadow.normalBias === 0.02, d.shadow);
  assert('A/lights/' + id, d.lights.length >= 4, d.lights.length);
  const byType = {};
  for (const l of d.lights) byType[l.type.replace('Light', '')] = l.intensity;
  const dirs = d.lights.filter((l) => l.type === 'DirectionalLight').map((l) => l.intensity).sort((a, b) => b - a);
  assert('A/keyint/' + id, dirs.length >= 2 && dirs[0] >= 2.0 && dirs[0] <= 3.0, d.lights.map((l) => [l.type, l.intensity]));
  assert('A/ambint/' + id, byType.Ambient >= 0.5 && byType.Ambient <= 0.8, byType.Ambient);
  assert('A/hemiint/' + id, byType.Hemisphere >= 0.4 && byType.Hemisphere <= 0.6, byType.Hemisphere);
  assert('A/fillint/' + id, dirs[1] >= 0.5 && dirs[1] <= 1.0, dirs);
  assert('A/keyshadow/' + id, d.lights.some((l) => l.type === 'DirectionalLight' && l.castShadow), d.lights);
  assert('A/bloom/' + id, d.bloom.strength >= 0.25 && d.bloom.strength <= 0.5, d.bloom);
  assert('A/vignette/' + id, d.vignette <= 0.3, d.vignette);
  const names = d.passes;
  assert('A/passes/' + id,
    ['RenderPass', 'SSAOPass', 'UnrealBloomPass', 'OutputPass', 'ColorGradePass', 'FXAAPass'].every((x, i) => names[i] === x),
    names);
  assert('A/envmap/' + id, d.envMap === true && d.threeRevision === '160', { env: d.envMap, rev: d.threeRevision });
  assert('A/skydome/' + id, d.skyDome === true, d.skyDome);
}

/* ================================================= B. 可见性与色彩条款 */
group = 'B';
for (const id of STYLES) {
  const d = pages[id].diag;
  const viol = d.sceneColors.filter((c) => c.basic === false && Math.max(c.r, c.g, c.b) < 0x44);
  assert('B/midtone/' + id, viol.length === 0, viol.slice(0, 4));
  const fogv = parseInt(d.fog.color.slice(1, 3), 16);
  assert('B/fog/' + id, Math.max(...[1, 3, 5].map((i) => parseInt(d.fog.color.slice(i, i + 2), 16))) >= 0x44, d.fog);
  assert('B/density/' + id, d.fog.density > 0.002 && d.fog.density <= 0.02, d.fog.density);
  const ground = d.sceneColors.find((c) => c.kind === 'decor' && Math.max(c.r, c.g, c.b) > 0);
  assert('B/groundvisible/' + id, !!ground, null);
  const basic = d.sceneColors.filter((c) => c.basic === true);
  assert('B/nobasic/' + id, basic.length <= 1, basic.map((b) => b.kind));
}

/* ==================================================== C. 资产与性能条款 */
group = 'C';
for (const id of STYLES) {
  const d = pages[id].diag;
  const tp = Object.values(d.counts.towerParts);
  const ep = Object.values(d.counts.enemyParts);
  assert('C/towerparts/' + id, tp.every((n) => n >= 15 && n <= 30), d.counts.towerParts);
  assert('C/enemyparts/' + id, ep.every((n) => n >= 15 && n <= 30), d.counts.enemyParts);
  assert('C/scatter/' + id, d.counts.scatter >= 100 && d.counts.pads > 0, { s: d.counts.scatter, p: d.counts.pads });
  const shadowed = d.sceneColors.filter((c) => c.kind === 'tower' || c.kind === 'enemy');
  assert('C/castshadow/' + id, d.sceneColors.filter((c) => c.castShadow).length >= 10, shadowed.length);
  /* 走廊必须是网格上的一条窄带：两侧都要有可建造格，否则玩家只能单边布防。
     isOnPath 曾把格子坐标当世界坐标比，53/96 格被误判成路径、左半区一格都建不了。 */
  const bd = pages[id].board;
  assert('C/corridorIsNarrow/' + id,
    bd.pathCells >= 15 && bd.pathCells <= 35 && bd.leftBuild > 5 && bd.rightBuild > 5 && bd.cols === 12,
    bd);
  assert('C/padsMatchMask/' + id, d.counts.pads === bd.total - bd.pathCells,
    { pads: d.counts.pads, mask: bd.total - bd.pathCells });
  /* 路面必须露出底板：mesh.scale.y 会连 y 偏移一起压扁，曾把整条路埋进板子里 */
  assert('C/roadAbovePlate/' + id,
    bd.roadTop > bd.plateTop + 0.05 && bd.roadTop < bd.plateTop + 0.35,
    { plateTop: bd.plateTop, roadTop: bd.roadTop, roadY: bd.roadY });
}

/* ============================================ D. 交付形态与零外链条款 */
group = 'D';
const htmlText = {};
const urlCounts = {};
const docUrls = {};
for (const id of STYLES) htmlText[id] = fs.readFileSync(path.join(SCENE, id + '.html'), 'utf8');
for (const id of STYLES) {
  const t = htmlText[id];
  const tags = [...t.matchAll(/<(script|link|img)[^>]*\s(src|href)="([^"]*)"/g)]
    .map((m) => m[3])
    .filter((u) => !u.startsWith('data:'));
  assert('D/noResourceTags/' + id, tags.length === 0, tags);
  assert('D/noImportmap/' + id, !/importmap/.test(t), null);
  assert('D/noCdnHost/' + id, !/cdn\.jsdelivr|unpkg\.com/.test(t), null);
  // a bare "http…" anywhere is not a violation: three's own source carries doc URLs in
  // strings and comments. The real constraint is that nothing LOADABLE points off-box.
  const loadable = [...t.matchAll(/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|fetch\(\s*["']https?:|import\(\s*["']https?:/g)].map((m) => m[0]);
  assert('D/noLoadableRemote/' + id, loadable.length === 0, loadable);
  const incidental = [...t.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]).filter((u) => !/w3\.org/.test(u));
  urlCounts[id] = incidental.length;
  docUrls[id] = incidental;
}
assert('D/docUrlsIdentical', urlCounts[STYLES[0]] === urlCounts['obsidian-lava'] && urlCounts['obsidian-lava'] === urlCounts['arctic-glass'], urlCounts);
/* 内联字节 = dist 字节 + 每处 </script 转义的 2 字节；数字必须由断言打印，不能靠脚本自报 */
const buildSizes = JSON.parse(fs.readFileSync(path.join(HERE, 'build-sizes.json'), 'utf8'));
for (const id of STYLES) {
  const b = buildSizes[id];
  assert('D/sizeAccounting/' + id,
    Buffer.byteLength(htmlText[id]) === b.bytes &&
    Buffer.byteLength(inlineScript(htmlText[id])) === b.bundleBytes + 2 * b.escapedScriptClose,
    { html: Buffer.byteLength(htmlText[id]), json: b.bytes, inline: Buffer.byteLength(inlineScript(htmlText[id])), bundle: b.bundleBytes, esc: b.escapedScriptClose });
}
/* 技能文档形态（importmap + jsDelivr）在本机的实测：见 cdn-form.html / cdn-probe.json */
const cdnProbe = fs.existsSync(path.join(HERE, 'cdn-probe.json'))
  ? JSON.parse(fs.readFileSync(path.join(HERE, 'cdn-probe.json'), 'utf8'))
  : null;
assert('D/cdnFormEvidenceFresh', cdnProbe && cdnProbe.form.includes('cdn.jsdelivr.net') &&
  typeof cdnProbe.threeLoaded === 'boolean' && cdnProbe.curl && cdnProbe.when, cdnProbe);
/* 同一台机器、同一个 URL：curl 被 TLS 重置（exit 35），Chromium 拿到 200 —— 所以离线内联
   是便利而非妥协，而文档形态仍然可用。断言的是"浏览器这一侧到底能不能跑"。 */
assert('D/cdnFormUsableInBrowser', cdnProbe && cdnProbe.threeLoaded === true && cdnProbe.revision === '160',
  { browser: cdnProbe && cdnProbe.threeLoaded, curl: cdnProbe && cdnProbe.curl.exit });
const cdnBoot = {};
for (const id of STYLES) {
  await page.goto('file://' + path.join(SCENE, 'cdn', id + '.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  cdnBoot[id] = await page.evaluate(() => {
    const g = window.__game;
    if (!g) return { ready: false };
    g.composer.render();
    const gl = g.renderer.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const px = new Uint8Array(4 * w * h);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = 0;
    for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const d = window.__diag();
    g.startRun();
    window.advanceTime(2000);
    return {
      ready: true, rev: d.threeRevision, passes: d.passes.join(','),
      meanLuma: +(s / (px.length / 4)).toFixed(2), after: JSON.parse(window.render_game_to_text()),
    };
  });
  assert('D/cdnBootsAndRenders/' + id,
    cdnBoot[id].ready === true && cdnBoot[id].rev === '160' && cdnBoot[id].after.time > 0 &&
    cdnBoot[id].passes === 'RenderPass,SSAOPass,UnrealBloomPass,OutputPass,ColorGradePass,FXAAPass',
    cdnBoot[id]);
  /* the two deliverable forms must produce the same frame, not just the same DOM */
  assert('D/cdnFrameMatchesInline/' + id,
    Math.abs(cdnBoot[id].meanLuma - pages[id].luma.fixed.meanLuma) < 3,
    { cdn: cdnBoot[id].meanLuma, inline: pages[id].luma.fixed.meanLuma });
}
assert('D/cdnFormSmallerThanInline',
  STYLES.every((id) => buildSizes[id].cdnBytes * 8 < buildSizes[id].bytes),
  Object.fromEntries(STYLES.map((id) => [id, buildSizes[id].cdnBytes + 'B vs ' + buildSizes[id].bytes + 'B'])));
assert('D/cdnFormKeepsBareImports',
  STYLES.every((id) => buildSizes[id].cdnModuleGraph >= 5),
  Object.fromEntries(STYLES.map((id) => [id, buildSizes[id].cdnModuleGraph])));

/* ============================================ E. 三风格互异（不是只换配色） */
group = 'E';
const js = {};
for (const id of STYLES) js[id] = inlineScript(htmlText[id]);
assert('E/scriptIdentical', js['sunlit-moss'] && js['sunlit-moss'] === js['obsidian-lava'] && js['obsidian-lava'] === js['arctic-glass'],
  Object.fromEntries(STYLES.map((s) => [s, js[s] ? crypto.createHash('sha1').update(js[s]).digest('hex').slice(0, 12) + '/' + Buffer.byteLength(js[s]) : null])));
const skel = STYLES.map((s) => crypto.createHash('sha1').update(pages[s].skeleton).digest('hex').slice(0, 10));
assert('E/domSkeletonIdentical', skel[0] === skel[1] && skel[1] === skel[2], skel);
for (const id of STYLES) {
  const need = ['--ink', '--gold', '--accent', '--accent-soft', '--glass', '--glass-line', '--radius', '--panel-shadow', '--screen-bg', '--dmg-tint'];
  const missing = need.filter((v) => !pages[id].rootVars.includes(v));
  assert('E/rootVarsComplete/' + id, missing.length === 0 && /--ink:#[0-9a-f]{6}/i.test(pages[id].rootVars), missing);
}
const emissiveOf = (p) => p.diag.sceneColors.filter((c) => c.emissive !== 0 && c.emissiveIntensity >= 1.5);
const pairs = [];
for (let i = 0; i < STYLES.length; i++)
  for (let j = i + 1; j < STYLES.length; j++) pairs.push([STYLES[i], STYLES[j]]);
for (const [a, b] of pairs) {
  const A = pages[a], B = pages[b];
  const sharedRoot = inter(new Set(A.rootHex), new Set(B.rootHex));
  assert('E/rootDisjoint/' + a + '~' + b, sharedRoot.length <= 1, sharedRoot);
  const sharedAny = inter(new Set(A.styleHex), new Set(B.styleHex)).filter((h) => h !== '#ffffff' && h !== '#000000');
  assert('E/styleHexDisjoint/' + a + '~' + b, sharedAny.length <= 4, sharedAny.slice(0, 6));
  const fp = [];
  const push = (name, va, vb) => { const diff = String(va) !== String(vb); fp.push(diff); return diff; };
  push('fog', A.diag.fog.color, B.diag.fog.color);
  push('exposure', A.diag.renderer.exposure, B.diag.renderer.exposure);
  push('bloom', A.diag.bloom.strength, B.diag.bloom.strength);
  push('gradeSat', A.diag.grade.saturation, B.diag.grade.saturation);
  push('vignette', A.diag.vignette, B.diag.vignette);
  push('ambientColor', (A.diag.lights.find((l) => l.type === 'AmbientLight') || {}).color, (B.diag.lights.find((l) => l.type === 'AmbientLight') || {}).color);
  push('keyColor', (A.diag.lights.find((l) => l.type === 'DirectionalLight') || {}).color, (B.diag.lights.find((l) => l.type === 'DirectionalLight') || {}).color);
  push('matTypes', [...new Set(A.diag.sceneColors.map((c) => c.matType))].sort().join(), [...new Set(B.diag.sceneColors.map((c) => c.matType))].sort().join());
  push('emissiveCount', emissiveOf(A).length, emissiveOf(B).length);
  push('panelRadius', A.hud.radius, B.hud.radius);
  push('glass', A.hud.glass, B.hud.glass);
  push('announceFont', A.hud.announceFont, B.hud.announceFont);
  push('accent', A.hud.accent, B.hud.accent);
  push('goldColor', A.hud.goldColor, B.hud.goldColor);
  push('scatterGeo', A.diag.counts.scatterGeo, B.diag.counts.scatterGeo);
  const n = fp.filter(Boolean).length;
  assert('E/fingerprints>=' + 5 + '/' + a + '~' + b, n >= 5, { diff: n, total: fp.length });
}
/* 每种风格各自的材料主张 */
const matOf = (id) => [...new Set(pages[id].diag.sceneColors.map((c) => c.matType))];
assert('E/sunlitToon', matOf('sunlit-moss').includes('MeshToonMaterial'), matOf('sunlit-moss'));
assert('E/arcticTransmission',
  (() => {
    const t = pages['arctic-glass'].diag.sceneColors.filter((c) => c.matType === 'MeshPhysicalMaterial');
    return t.length >= 5 && t.every((c) => c.matType === 'MeshPhysicalMaterial');
  })(), { physical: matOf('arctic-glass'), n: pages['arctic-glass'].diag.sceneColors.filter((c) => c.matType === 'MeshPhysicalMaterial').length });
assert('E/lavaEmissive',
  emissiveOf(pages['obsidian-lava']).length >= 5 &&
  emissiveOf(pages['obsidian-lava']).length > emissiveOf(pages['sunlit-moss']).length &&
  emissiveOf(pages['obsidian-lava']).length > emissiveOf(pages['arctic-glass']).length,
  Object.fromEntries(STYLES.map((s) => [s, emissiveOf(pages[s]).length])));
/* 唯一允许的非 CSS 差异：主题选择脚本里的 theme id */
const smallScripts = {};
for (const id of STYLES) smallScripts[id] = inlineScripts(htmlText[id]).filter((s) => s !== js[id]);
assert('E/onlyThemeIdDiffers',
  STYLES.every((id) => smallScripts[id].length === 1 && smallScripts[id][0].indexOf('window.__THEME_ID = ') === 0) &&
  new Set(STYLES.map((id) => smallScripts[id][0].replace(/= '[^']*'/, "= 'X'"))).size === 1,
  Object.fromEntries(STYLES.map((id) => [id, (smallScripts[id][0] || '').trim()])));

/* ============================================ F. 游戏逻辑：守恒与确定性 */
group = 'F';
const simCache = {};
for (const id of STYLES) {
  await page.goto('file://' + path.join(SCENE, id + '.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  simCache[id + '_1'] = await page.evaluate(SIM, { seconds: 400, build: true, kinds: ['ballista', 'ballista', 'mortar', 'frost'] });
  await page.goto('file://' + path.join(SCENE, id + '.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  simCache[id + '_2'] = await page.evaluate(SIM, { seconds: 400, build: true, kinds: ['ballista', 'ballista', 'mortar', 'frost'] });
  await page.goto('file://' + path.join(SCENE, id + '.html'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  simCache[id + '_bare'] = await page.evaluate(SIM, { seconds: 200, build: false, kinds: [] });
}
for (const id of STYLES) {
  const s = simCache[id + '_1'];
  assert('F/determinism/' + id, s.snap === simCache[id + '_2'].snap, { a: s.snap, b: simCache[id + '_2'].snap });
  const { gold, spent, earned } = s.S;
  assert('F/goldConservation/' + id, Math.abs(earned - spent - gold) < 0.001, { earned, spent, gold });
  const bal = s.S.hpSpawned - (s.S.damageDealt + s.S.liveHp + s.S.hpLeaked);
  assert('F/hpConservation/' + id, Math.abs(bal) < 0.01, { spawned: s.S.hpSpawned, dealt: s.S.damageDealt, live: s.S.liveHp, leaked: s.S.hpLeaked, bal: +bal.toFixed(4) });
  assert('F/winPolicy/' + id, s.S.mode === 'victory' && s.S.wave === 10, s.S);
  assert('F/killAccounting/' + id, s.S.killed + s.S.leaked === s.S.spawned, s.S);
  const b = simCache[id + '_bare'];
  assert('F/loseWithoutTowers/' + id, b.S.mode === 'gameover' && b.S.lives <= 0 && b.S.killed === 0, b.S);
  /* 空局布防的 trace 里哨站完整度一度为 -1：泄漏扣血没夹下限，HUD 会直接显示负数 */
  assert('F/livesNeverNegative/' + id,
    s.trace.every((t) => t.lives >= 0) && b.trace.every((t) => t.lives >= 0),
    { minBuilt: Math.min(...s.trace.map((t) => t.lives)), minBare: Math.min(...b.trace.map((t) => t.lives)) });
  assert('F/wavesDefined/' + id, s.trace.some((t) => t.wave >= 2) && s.S.time > 60, s.S.time);
  const pool = s.pool;
  assert('F/poolNoGrowth/' + id, pool.created <= 48 + 8 && pool.active < 48, pool);
}
/* 玩法快照必须逐字节相同；particles 是唯一允许的差异项（每风格的天气/环境粒子不同） */
const playFields = (snap) => { const o = JSON.parse(snap); delete o.particles; return JSON.stringify(o); };
assert('F/scenarioSameAcrossStyles',
  STYLES.every((id) => playFields(simCache[id + '_1'].snap) === playFields(simCache['sunlit-moss_1'].snap)),
  Object.fromEntries(STYLES.map((id) => [id, playFields(simCache[id + '_1'].snap)])));
assert('F/ambientParticlesDiffer',
  new Set(STYLES.map((id) => JSON.parse(simCache[id + '_1'].snap).particles)).size > 1 &&
  STYLES.every((id) => JSON.parse(simCache[id + '_1'].snap).particles >= 0),
  Object.fromEntries(STYLES.map((id) => [id, JSON.parse(simCache[id + '_1'].snap).particles])));
assert('F/bareLoseSameAcrossStyles',
  STYLES.every((id) => playFields(simCache[id + '_bare'].snap) === playFields(simCache['sunlit-moss_bare'].snap)),
  STYLES.map((id) => simCache[id + '_bare'].final));

/* ============================= G. 台账契约（幂等式：快照 + 增量 == 现值） */
group = 'G';
const snap = JSON.parse(fs.readFileSync(path.join(HERE, 'ledger-snapshot.json'), 'utf8'));
const led = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'state/state.json'), 'utf8'));
assert('G/triedPlus1', led.tried.length === snap.tried_len + 1, { snap: snap.tried_len, now: led.tried.length });
assert('G/runsPlus1', led.runs.length === snap.runs_len + 1, { snap: snap.runs_len, now: led.runs.length });
assert('G/stylesPlus3', led.used_styles.length === snap.used_styles_len + 3, { snap: snap.used_styles_len, now: led.used_styles.length });
assert('G/lastStylesAreMine', JSON.stringify(led.used_styles.slice(-3)) === JSON.stringify(snap.this_round_styles), led.used_styles.slice(-3));
assert('G/lastTriedIsBuildGame', led.tried[led.tried.length - 1].skill.indexOf(snap.this_round_skill) === 0, led.tried[led.tried.length - 1].skill);
assert('G/prevTriedUnchanged', led.tried[snap.tried_len - 1].skill === snap.last_tried_skill, led.tried[snap.tried_len - 1].skill);
assert('G/noStyleCollision', snap.this_round_styles.every((s) => led.used_styles.filter((u) => u === s).length === 1), led.used_styles.slice(-6));
assert('G/envNotesGrew', led.environment_notes.length > snap.env_notes_len, { snap: snap.env_notes_len, now: led.environment_notes.length });

/* =============================== H. 渲染真实性（含技能文档形态的实测退化） */
group = 'H';
for (const id of STYLES) {
  const L = pages[id].luma;
  assert('H/renders/' + id, L.fixed.meanLuma > 25 && L.fixed.brightPct > 12, L.fixed);
  assert('H/notBlack/' + id, L.fixed.darkPct < 92, L.fixed);
  const ratio = L.docForm ? +(L.docForm.meanLuma / L.fixed.meanLuma).toFixed(3) : 1;
  assert('H/docFormDegrades/' + id, L.docForm && ratio < 0.95 && L.docForm.hiPct < L.fixed.hiPct,
    { fixed: L.fixed, docFormNoOutputPass: L.docForm, ratio });
  /* 两端都不能压死：暗部/高光像素占比 > 10% 说明曝光或调色把细节裁掉了 */
  assert('H/exposureEnds/' + id, L.fixed.clippedPct < 10 && L.fixed.darkPct < 10,
    { clippedPct: L.fixed.clippedPct, darkPct: L.fixed.darkPct });
  /* 对比度：极冠风格初版整屏泛白（meanLuma 217、std 23），塔和敌人糊成一片 */
  assert('H/contrast/' + id, L.fixed.std > 30 && L.fixed.midPct > 10,
    { std: L.fixed.std, midPct: L.fixed.midPct, meanLuma: L.fixed.meanLuma });
  /* 技能参考文档写死的 SSAO 常数（16 / 0.005 / 0.1）在本正交顶视机位下的实测 */
  assert('H/docSsaoBlacksOut/' + id, L.docSsao.meanLuma < 6 && L.docSsao.brightPct < 1, L.docSsao);
  assert('H/shippedSsaoStaysBright/' + id, L.fixed.meanLuma > 25 && L.fixed.brightPct > 12, L.fixed);
  assert('H/ssaoCostsDraws/' + id,
    L.infoOff.tris > 0 && L.infoOn.tris >= L.infoOff.tris * 1.3,
    { on: L.infoOn, off: L.infoOff, triRatio: +(L.infoOn.tris / L.infoOff.tris).toFixed(2),
      callRatio: +(L.infoOn.calls / L.infoOff.calls).toFixed(2) });
  assert('H/ssaoChangesNothingAtThisScale/' + id,
    Math.abs(L.fixed.meanLuma - L.noSsao.meanLuma) < 1.5,
    { withSsao: L.fixed.meanLuma, withoutSsao: L.noSsao.meanLuma });
}
assert('H/distinctRenders', new Set(STYLES.map((id) => pages[id].luma.fixed.meanLuma)).size === 3,
  Object.fromEntries(STYLES.map((id) => [id, pages[id].luma.fixed.meanLuma])));

/* ================================================ I. 交互与 HUD 条款 */
group = 'I';
await page.goto('file://' + path.join(SCENE, 'sunlit-moss.html'));
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
const hudCompliance = await page.evaluate(() => {
  const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
  return {
    pointerHud: cs('#hud', 'pointerEvents'), pointerPalette: cs('.palette', 'pointerEvents'),
    tabular: cs('#gold-value', 'fontVariantNumeric'), userSelect: cs('#hud', 'userSelect'),
    transition: cs('.palette', 'transitionDuration'),
    zHud: cs('#hud', 'zIndex'), zVign: cs('#damage-vignette', 'zIndex'), zScreen: cs('.screen', 'zIndex'),
    glassCount: document.querySelectorAll('.hud-panel, .palette').length,
    backdropPanels: [...document.querySelectorAll('.hud-panel, .palette, .screen')]
      .filter((e) => (getComputedStyle(e).backdropFilter || 'none') !== 'none').length,
    titleOn: !!document.querySelector('.screen[data-screen="title"].on'),
    audioBeforeGesture: !!(window.__game && true),
  };
});
assert('I/pointerEventsHud', hudCompliance.pointerHud === 'none', hudCompliance.pointerHud);
assert('I/pointerEventsPalette', hudCompliance.pointerPalette === 'auto', hudCompliance.pointerPalette);
assert('I/tabularNums', /tabular-nums/.test(hudCompliance.tabular || ''), hudCompliance.tabular);
assert('I/userSelectNone', hudCompliance.userSelect === 'none', hudCompliance.userSelect);
assert('I/transitionsEase', hudCompliance.transition && hudCompliance.transition !== '0s', hudCompliance.transition);
assert('I/zIndexContract', +hudCompliance.zVign < +hudCompliance.zHud && +hudCompliance.zHud < +hudCompliance.zScreen, hudCompliance);
assert('I/titleVisible', hudCompliance.titleOn === true, null);
assert('I/announceWave', STYLES.every((id) => simCache[id + '_1'].trace.some((t) => t.wave > 0)), null);

const interact = await page.evaluate(async () => {
  const g = window.__game;
  const out = {};
  document.querySelector('.screen[data-screen="title"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 300 }));
  out.modeAfterClick = g.state.mode;
  const before = g.state.grid.size;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  out.selected2 = g.state.selected;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
  out.selected3 = g.state.selected;
  /* build via synthetic pointer on a known free cell */
  const target = (() => {
    for (let cx = 0; cx < g.CONSTANTS.GRID_W; cx++)
      for (let cz = 0; cz < g.CONSTANTS.GRID_H; cz++) if (!g.isOnPath(cx, cz)) return [cx, cz];
  })();
  g.state.gold = 500;
  const towerCost = g.TOWER_TYPES[g.state.selected].cost;
  const w = g.cellToWorld(target);
  const vec = new (Object.getPrototypeOf(g.camera.position).constructor)();
  vec.copy(w).setY(0.46).project(g.camera);
  const sx = (vec.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-vec.y * 0.5 + 0.5) * window.innerHeight;
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: sx, clientY: sy }));
  out.ghostVisible = document.querySelectorAll('[data-screen]') && g.scene.children.find((o) => o.userData && o.userData.kind === 'ghost') ? true : false;
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy }));
  out.built = g.state.grid.size - before;
  out.cost = towerCost;
  /* sell by clicking the same cell */
  const goldAfterBuild = g.state.gold;
  window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy }));
  out.refund = g.state.gold - goldAfterBuild;
  out.expectedRefund = Math.floor(towerCost * g.CONSTANTS.SELL_REFUND);
  out.toastCount = document.querySelectorAll('.toast').length;
  out.killFeedMax = (() => { const f = document.querySelector('#kill-feed'); return f ? f.children.length : -1; })();
  out.storageKey = Object.keys(localStorage).filter((k) => /towerline/.test(k))[0] || null;
  out.storagePayload = out.storageKey ? JSON.parse(localStorage.getItem(out.storageKey)) : null;
  return out;
});
assert('I/clickStartsGame', interact.modeAfterClick === 'playing', interact.modeAfterClick);
assert('I/keysSelectTower', interact.selected2 === 'frost' && interact.selected3 === 'mortar', interact);
assert('I/clickBuilds', interact.built === 1, interact);
assert('I/clickSellsWithRefund', interact.refund === interact.expectedRefund, interact);
assert('I/saveShape', interact.storagePayload && interact.storagePayload.version === 1 && typeof interact.storagePayload.timestamp === 'number' && typeof interact.storagePayload.bestWave === 'number', interact.storagePayload);
for (const id of STYLES) {
  const fatal = pages[id].logs.filter((l) => /pageerror|\[error\]/.test(l) && !/favicon|net::ERR_FILE_NOT_FOUND.*favicon/i.test(l));
  assert('I/noConsoleErrors/' + id, fatal.length === 0, fatal.slice(0, 3));
}

/* ==================================================== J. 磁盘与体积纪律 */
group = 'J';
const sceneBytes = (() => {
  let n = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else n += fs.statSync(p).size;
    }
  };
  walk(SCENE);
  return n;
})();
assert('J/sceneUnder50MB', sceneBytes < 50 * 1024 * 1024, sceneBytes);
assert('J/singleFilesInline', STYLES.every((id) => Buffer.byteLength(htmlText[id]) < 1024 * 1024), Object.fromEntries(STYLES.map((id) => [id, Buffer.byteLength(htmlText[id])])));
assert('J/noNodeModulesInScene', !fs.existsSync(path.join(SCENE, 'node_modules')) && !fs.existsSync(path.join(SCENE, 'dist')), null);
assert('J/everyPageOpensAlone', STYLES.every((id) => htmlText[id].includes('</html>')), null);

/* ------------------------------------------------------------- summarize */
const summary = {
  total: R.length,
  pass: R.filter((r) => r.ok).length,
  fail: R.filter((r) => !r.ok).length,
  groups: results,
  measured: {
    sceneBytes,
    perStyle: Object.fromEntries(STYLES.map((id) => [
      id,
      {
        htmlBytes: Buffer.byteLength(htmlText[id]),
        bundleBytes: inlineScript(htmlText[id]).length,
        meanLumaFixed: pages[id].luma.fixed.meanLuma,
        clippedPctFixed: pages[id].luma.fixed.clippedPct,
        darkPctFixed: pages[id].luma.fixed.darkPct,
        hiPctFixed: pages[id].luma.fixed.hiPct,
        stdFixed: pages[id].luma.fixed.std,
        midPctFixed: pages[id].luma.fixed.midPct,
        hiPctDocForm: pages[id].luma.docForm && pages[id].luma.docForm.hiPct,
        meanLumaDocForm: pages[id].luma.docForm && pages[id].luma.docForm.meanLuma,
        passes: pages[id].diag.passes,
        exposure: pages[id].diag.renderer.exposure,
        bloom: pages[id].diag.bloom.strength,
        vignette: pages[id].diag.vignette,
        lights: pages[id].diag.lights.length,
        towerParts: pages[id].diag.counts.towerParts,
        enemyParts: pages[id].diag.counts.enemyParts,
        sim: simCache[id + '_1'].S,
        bare: simCache[id + '_bare'].S,
        determinismEqual: simCache[id + '_1'].snap === simCache[id + '_2'].snap,
      },
    ])),
    fingerprintMatrix: pairs.map(([a, b]) => ({
      pair: a + '~' + b,
      rootShared: inter(new Set(pages[a].rootHex), new Set(pages[b].rootHex)),
      hexSharedNonTrivial: inter(new Set(pages[a].styleHex), new Set(pages[b].styleHex)).filter((h) => h !== '#ffffff' && h !== '#000000'),
    })),
    inlineScriptSha1: Object.fromEntries(STYLES.map((id) => [id, crypto.createHash('sha1').update(inlineScript(htmlText[id])).digest('hex')])),
  },
};
fs.writeFileSync(path.join(HERE, 'check-result.json'), JSON.stringify({ summary, assertions: R }, null, 1));
console.log('\n== ' + summary.total + ' assertions: ' + summary.pass + ' pass / ' + summary.fail + ' fail');
console.log(JSON.stringify(summary.groups));
for (const id of STYLES) {
  console.log(id, 'luma fixed', summary.measured.perStyle[id].meanLumaFixed, 'docForm', summary.measured.perStyle[id].meanLumaDocForm,
    'std', summary.measured.perStyle[id].stdFixed, 'mid%', summary.measured.perStyle[id].midPctFixed);
}
await browser.close();
process.exit(summary.fail ? 1 : 0);
