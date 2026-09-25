/* Headless smoke: boot each style in real Chromium, read __diag + frame probe.
   Run from LAB root. */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
const pw = req(req.resolve('playwright-core', { paths: [path.resolve(process.cwd(), '.tmp/refbuild/node_modules')] }));
const EXEC = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;

const IDS = ['seto-coast', 'atlas-ochre', 'nordic-night'];

async function main() {
  const browser = await pw.chromium.launch({ executablePath: EXEC, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  for (const id of IDS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.goto(pathToFileURL(path.join(SCENE, id + '.html')).href, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const diag = await page.evaluate(() => (window.__diag ? window.__diag() : { MISSING: 'no __diag' }));
    const probe = await page.evaluate(() => (window.__frameProbe ? window.__frameProbe(320, 200) : null));
    console.log('====', id, 'errors:', errs.length);
    errs.slice(0, 6).forEach((e) => console.log('   !', e.slice(0, 300)));
    console.log('   theme:', diag.theme, '| lights:', diag.lights && diag.lights.length, '| passes:', (diag.passes || []).join('>'));
    console.log('   counts:', JSON.stringify(diag.counts));
    console.log('   probe:', JSON.stringify(probe));
    await page.screenshot({ path: path.join(SCENE, 'shots', `${id}-title.png`) }).catch((e) => console.log('   shot fail', e.message));
    /* the same style while it is actually being played: title dismissed, a couple of
       simulated seconds in, so the world shots show the HUD wired to live state */
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(400);
    await page.evaluate(() => window.advanceTime(2600));
    await page.waitForTimeout(300);
    const played = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    console.log('   played:', JSON.stringify(played));
    await page.screenshot({ path: path.join(SCENE, 'shots', `${id}-world.png`) }).catch((e) => console.log('   shot fail', e.message));
    await page.close();
  }
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
