/* Does the skill's documented deliverable form (importmap + jsDelivr) work on this host?
   Run from LAB root: node artifacts/20260926-03-build-game-tower-defense/scripts/cdn-form-probe.mjs
   Writes scripts/cdn-probe.json, which check.mjs asserts against. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
const NM = path.resolve(process.cwd(), '.tmp/build/node_modules');
const { chromium } = req(path.join(NM, 'playwright-core'));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXE = process.env.PW_CHROMIUM ||
  '/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
const failures = [];
page.on('requestfailed', (r) => failures.push(r.url().slice(0, 90) + ' :: ' + (r.failure() || {}).errorText));
const logs = [];
page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text().slice(0, 160)));
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message.slice(0, 160)));

await page.goto('file://' + path.join(HERE, 'cdn-form.html'));
await page.waitForFunction(() => window.__probe !== undefined, null, { timeout: 90000 }).catch(() => {});
const probe = await page.evaluate(() => window.__probe || null);

/* same URL, same machine, different client: curl is reset while Chromium is served */
let curl = { exit: null, note: '' };
try {
  execFileSync('curl', ['-sS', '-o', '/dev/null', '--max-time', '12',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/package.json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  curl = { exit: 0, note: 'curl succeeded' };
} catch (e) {
  curl = { exit: e.status === undefined ? 'spawn-failed' : e.status, note: String(e.stderr || e.message).trim().slice(0, 120) };
}

const out = {
  when: new Date().toISOString(),
  form: 'SKILL.md Phase 3 verbatim: importmap -> https://cdn.jsdelivr.net/npm/three@0.160.0',
  threeLoaded: probe ? probe.threeLoaded : false,
  revision: probe ? probe.revision : null,
  err: probe ? probe.err : 'window.__probe never set (module never executed)',
  curl,
  requestFailures: failures.slice(0, 6),
  console: logs.slice(0, 6),
};
fs.writeFileSync(path.join(HERE, 'cdn-probe.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
await browser.close();
