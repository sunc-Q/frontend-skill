/* Functional smoke: does the game actually play?  Drives one style through
   camera-relative movement -> mote flee -> night -> pickup -> deposit ->
   dialogue -> win, and separately a death, printing state deltas so a failure
   names the system that broke.
   Run from LAB root:
     node artifacts/20260926-05-build-game-reference-driven/scripts/smoke-play.mjs
*/
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
const pw = req(req.resolve('playwright-core', { paths: [path.resolve(process.cwd(), '.tmp/refbuild/node_modules')] }));
const EXEC = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const log = (...a) => console.log(...a);

async function main() {
  const browser = await pw.chromium.launch({ executablePath: EXEC, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(pathToFileURL(path.join(SCENE, 'seto-coast.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const step = async (name, fn) => {
    let r;
    try { r = await page.evaluate(fn); } catch (e) { r = { THREW: e.message.slice(0, 200) }; }
    log(`  ${name}:`, JSON.stringify(r));
    return r;
  };

  await step('pause-clock', () => { window.__setPaused(true); return { paused: true }; });
  await step('boot-title', () => {
    const g = window.__game;
    return { mode: g.state.mode, passes: window.__diag().passes, lights: g.scene.children.filter((o) => o.isLight).length };
  });
  await step('start', () => {
    const g = window.__game; g.startRun();
    return { mode: g.state.mode, lives: g.state.lives, quest: g.state.questIndex, cap: g.state.satchelCap };
  });

  /* CRITICAL skill rule: WASD is camera-relative. Rotate the rig and the W
     delta must rotate with it, not stay on a world axis. */
  await step('camera-relative-W', () => {
    const g = window.__game;
    const out = {};
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      g.player.x = 0; g.player.z = 14; g.player.vx = 0; g.player.vz = 0; g.camRig.yaw = yaw;
      for (let i = 0; i < 60; i++) g.update(1 / 60); /* let the orbit rig settle: it lerps at 13%/frame */
      const f = g.cameraBasis().fwd;
      g.setKey('KeyW', true);
      for (let i = 0; i < 10; i++) g.update(1 / 60);
      g.setKey('KeyW', false);
      const dx = g.player.x, dz = g.player.z - 14, len = Math.hypot(dx, dz) || 1;
      const dot = (dx / len) * f.x + (dz / len) * f.z;
      out['yaw=' + yaw.toFixed(2)] = { moved: +len.toFixed(2), cosToCamForward: +dot.toFixed(3), fwd: [+f.x.toFixed(2), +f.z.toFixed(2)], cam: g.camera.position.toArray().map((v) => +v.toFixed(1)), pl: [+g.player.x.toFixed(1), +g.player.z.toFixed(1)] };
    }
    return out;
  });
  await step('strafe-A', () => {
    const g = window.__game;
    g.player.x = 0; g.player.z = 14; g.player.vx = g.player.vz = 0; g.camRig.yaw = 0.6;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const f = g.cameraBasis().fwd, r = g.cameraBasis().right;
    g.setKey('KeyA', true);
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    g.setKey('KeyA', false);
    const dx = g.player.x, dz = g.player.z - 14, len = Math.hypot(dx, dz) || 1;
    return { cosToRight: +(((dx / len) * r.x + (dz / len) * r.z)).toFixed(3), right: [+r.x.toFixed(2), +r.z.toFixed(2)] };
  });

  /* mote FSM: idle -> flee purely from xz distance */
  await step('mote-flee', () => {
    const g = window.__game;
    g.startRun();
    const m = g.motes.find((x) => !x.ember);
    g.player.x = m.x; g.player.z = m.z;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const fled = m.state === 'flee' || m.transitions.flee > 0;
    const dist = Math.hypot(m.x - g.player.x, m.z - g.player.z);
    return { state: m.state, transitions: m.transitions, fled, escapedBy: +dist.toFixed(2) };
  });

  /* hound FSM: patrol -> chase -> contact -> stunned -> return -> patrol */
  await step('hound-fsm', () => {
    const g = window.__game;
    g.startRun();
    const h = g.hounds[0];
    const seen = [];
    h.x = g.player.x + 5; h.z = g.player.z; h.state = 'patrol';
    g.state.lives = 99;
    for (let i = 0; i < 900; i++) {
      g.update(1 / 60);
      if (seen[seen.length - 1] !== h.state) seen.push(h.state);
      if (h.hits > 0 && seen.includes('patrol')) break;
    }
    return { seen: seen.join('->'), hits: h.hits, chases: h.chases, lives: g.state.lives };
  });

  /* day/night: embers only exist in the dark half */
  await step('night-and-embers', () => {
    const g = window.__game;
    g.startRun();
    g.state.lives = 999;
    const dayEmbersVisible = g.motes.filter((m) => m.ember && m.group.visible).length;
    g.state.time = 50;
    for (let i = 0; i < 5; i++) g.update(1 / 60);
    const nightEmbersVisible = g.motes.filter((m) => m.ember && m.group.visible).length;
    return { dayEmbersVisible, night: g.state.night, nightEmbersVisible, mix: +g.nightMix().toFixed(2), nightCount: g.state.nightCount };
  });

  await step('pickup-deposit-quest', () => {
    const g = window.__game;
    g.startRun();
    const got = [];
    for (let k = 0; k < 3; k++) {
      const m = g.motes.find((x) => !x.ember && !x.held && !x.deposited);
      g.player.x = m.x; g.player.z = m.z;
      got.push(g.tryPickup());
    }
    const satchel = g.state.satchel;
    g.player.x = 0.6; g.player.z = 0.6;
    const dep = g.depositAtHub();
    return { got, satchel, dep, deposited: g.state.motesDeposited, quest: g.state.questIndex, need: g.QUESTS[0].need };
  });

  await step('dialogue-full', () => {
    const g = window.__game;
    g.startRun();
    g.openDialogue();
    const trace = [];
    for (let i = 0; i < 6 && g.state.mode === 'dialogue'; i++) {
      if (g.dialogue.awaitingChoice) { g.chooseDialogue(0); trace.push('choose0'); }
      g.advanceDialogue();
      trace.push(g.dialogue.node + ':' + g.dialogue.line);
    }
    return { trace: trace.join('|'), talked: g.state.talked, lantern: g.state.lantern, cap: g.state.satchelCap, mode: g.state.mode, quest: g.state.questIndex };
  });

  await step('win-path', () => {
    const g = window.__game;
    g.startRun();
    g.state.motesDeposited = 99; g.state.embersDeposited = 99; g.state.talked = true;
    g.player.x = 1; g.player.z = 1;
    const m = g.motes.find((x) => !x.held && !x.deposited);
    m.held = true; g.state.satchel = 1;
    g.depositAtHub();
    return { quest: g.state.questIndex, of: g.QUESTS.length, mode: g.state.mode, won: g.state.won };
  });

  await step('lose-path', () => {
    const g = window.__game;
    g.startRun();
    g.state.lives = 1; g.state.invuln = 0;
    const h = g.hounds[0];
    h.x = g.player.x; h.z = g.player.z; h.state = 'chase'; h.timer = 0;
    g.update(1 / 60);
    return { lives: g.state.lives, mode: g.state.mode, flash: +g.state.hitFlash.toFixed(2) };
  });

  await step('save-roundtrip', () => {
    const g = window.__game;
    const rec = g.saveGame({ won: true, time: 12.5, deposits: 7 });
    const back = g.loadSave();
    return { written: rec, back, version: back && back.version };
  });

  await step('determinism-1200-steps', () => {
    const g = window.__game;
    g.startRun();
    g.state.lives = 999;
    const run = () => {
      g.startRun(); g.state.lives = 999;
      const keys = ['KeyW', 'KeyD', 'KeyW', 'KeyA', 'KeyS'];
      for (let i = 0; i < 1200; i++) {
        g.setKey('KeyW', false); g.setKey('KeyA', false); g.setKey('KeyS', false); g.setKey('KeyD', false);
        g.setKey(keys[(i / 60 | 0) % 5], true);
        g.camRig.yaw = i * 0.001;
        g.update(1 / 60);
      }
      return {
        p: [+g.player.x.toFixed(6), +g.player.z.toFixed(6)],
        motes: g.motes.map((m) => [+m.x.toFixed(6), +m.z.toFixed(6), m.state]).join(';'),
        hounds: g.hounds.map((h) => [+h.x.toFixed(6), +h.z.toFixed(6), h.state, h.chases, h.hits]).join(';'),
        s: [g.state.time, g.state.satchel, g.state.motesDeposited, g.state.nightCount].join(','),
      };
    };
    const a = run(), b = run();
    return { equal: JSON.stringify(a) === JSON.stringify(b), sig: a.s, pos: a.p };
  });
  await step('text-hook', () => JSON.parse(window.render_game_to_text()));

  log('errors:', errs.length);
  errs.slice(0, 10).forEach((e) => log('  !', e.slice(0, 300)));
  await browser.close();
  process.exit(errs.length ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
