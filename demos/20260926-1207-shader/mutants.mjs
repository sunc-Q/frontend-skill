import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const W = 640, H = 400, GRID = 10, GGRID = 16;
const GOLDEN = JSON.parse(fs.readFileSync(path.join(DIR, 'golden-pixels.json'), 'utf8'));
const lum = p => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) for (let c = 0; c < 3; c++) s += Math.abs(a[i][c] - b[i][c]); return s / (a.length * 3); };

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://' + path.join(DIR, 'shader-showcase.html') + `?w=${W}&h=${H}&t=0`);
await page.waitForFunction(() => window.__shaderReady === true, { timeout: 15000 });
const call = cfg => page.evaluate(c => window.__shaderProbe(c), cfg);

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function analyticRatio(rn, n) {
  const R = Math.min(W, H) / 2;
  return rn.map(r => {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      acc += 1 - 0.88 * ss(0.16, 0.52, Math.hypot((Math.cos(a) * r * R / W) * 0.62, Math.sin(a) * r * R / H));
    }
    return acc / n;
  });
}

async function detectors() {
  const z0 = await call({ t: 0, speed: 0, grid: GRID });
  const z6 = await call({ t: 6, speed: 0, grid: GRID });
  const mC = await call({ t: 0, mouse: [0.5, 0.5], grid: GRID });
  const mK = await call({ t: 0, mouse: [0.12, 0.12], grid: GRID });
  const w0 = await call({ t: 0, warp: 0, grid: GRID });
  const w1 = await call({ t: 0, warp: 1.6, grid: GRID });
  const gold = await call({ t: 0, grid: GGRID, speed: 1, warp: 0.85, hue: 0.58, scan: 0.14, mouse: [0.5, 0.5] });
  const ghash = crypto.createHash('sha256').update(JSON.stringify(gold.pixels)).digest('hex');
  const red = await page.evaluate(() => {
    const src = window.__shaderFragSource
      .replace('vec3 col = palette(shade);', 'vec3 col = vec3(0.62);')
      .replace('col += 0.16 * clamp(length(r) - 0.42, 0.0, 1.0);', '');
    const stripped = src !== window.__shaderFragSource;
    return { stripped: stripped, swap: window.__shaderSwapFragment(src) };
  });
  let meas = null;
  if (red.swap && red.swap.ok) {
    const rr = await page.evaluate(c => window.__shaderRadial(c), { t: 0, radii: [0.15, 0.78], angles: 32, mouse: [2.5, 2.5], scan: 0 });
    meas = rr.rings[0].meanLum / rr.rings[1].meanLum;
    await page.evaluate(() => window.__shaderRestoreFragment());
  }
  const an = analyticRatio([0.15, 0.78], 32);
  const relErr = meas === null ? 1 : Math.abs(meas / (an[0] / an[1]) - 1);
  return {
    flags: {
      a7_speedWired: mad(z0.pixels, z6.pixels) === 0,
      a8_mouseWired: mad(mC.pixels, mK.pixels) > 1.5,
      a16_warpWired: mad(w0.pixels, w1.pixels) > 4,
      a11_vignetteAnalytic: red.stripped && !!red.swap && red.swap.ok && meas !== null && relErr < 0.08,
      a18_goldenHash: ghash === GOLDEN.hash,
    },
    num: {
      speedFreezeDiff: mad(z0.pixels, z6.pixels), mouseDiff: mad(mC.pixels, mK.pixels),
      warpDiff: mad(w0.pixels, w1.pixels), vignetteRelErr: relErr, goldenHash: ghash.slice(0, 12),
    },
  };
}

const FMT = o => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Number(v.toFixed(4)) : v])));

const base = await detectors();
const baseGreen = Object.values(base.flags).every(Boolean);
console.log(`GOLDEN baseline | allGreen=${baseGreen} | ${FMT(base.flags)} | ${FMT(base.num)}`);
if (!baseGreen) { console.log('!! baseline not green — mutation results meaningless'); await browser.close(); process.exit(2); }

const MUTANTS = [
  ['M1 value: uSpeed dropped from time term', 'float t = uTime * uSpeed;', 'float t = uTime;', 'a7_speedWired'],
  ['M2 structural: radial distance hardcoded', 'float d = length(md);', 'float d = 0.5;', 'a8_mouseWired'],
  ['M3 structural: warp path 1 zeroed', 'uWarp * 2.4 * q', '0.0 * q', 'a16_warpWired'],
  ['M3b structural: warp path 2 zeroed', 'uWarp * 2.0 * r', '0.0 * r', 'a16_warpWired'],
  ['M4 structural: vignette removed', 'col *= 1.0 - 0.88 * smoothstep(0.16, 0.52, length(cc));', 'col *= 1.0;', 'a11_vignetteAnalytic'],
  ['M5 structural: fbm octave step decorrelation broken', 'p = p * 2.03 + vec2(1.7, 9.2);', 'p = p + vec2(0.0001, 0.0);', 'a16_warpWired'],
  ['M6 value: palette hue offset ignored', 'vec3 d = vec3(0.00, 0.28, 0.55) + uHue;', 'vec3 d = vec3(0.00, 0.28, 0.55);', 'a18_goldenHash'],
];

const rows = [];
for (const [name, from, to, semanticKey] of MUTANTS) {
  const ap = await page.evaluate(([f, t]) => {
    const mutated = window.__shaderFragSource.replace(f, t);
    if (mutated === window.__shaderFragSource) return { spliced: false };
    return { spliced: true, swap: window.__shaderSwapFragment(mutated) };
  }, [from, to]);
  if (!ap.spliced) { rows.push(`SKIP    | ${name} | splice target absent`); await page.evaluate(() => window.__shaderRestoreFragment()); continue; }
  if (!ap.swap.ok) { rows.push(`BAD     | ${name} | mutant did not compile: ${String(ap.swap.infoLog).slice(0, 70)}`); await page.evaluate(() => window.__shaderRestoreFragment()); continue; }
  const d = await detectors();
  const broken = Object.entries(d.flags).filter(([, v]) => !v).map(([k]) => k);
  const semanticCaught = !d.flags[semanticKey];
  const goldenCaught = !d.flags.a18_goldenHash;
  const caught = broken.length > 0;
  rows.push(`${caught ? 'CAUGHT  ' : 'SURVIVED'} | ${name} | semantic=${semanticCaught ? 'yes' : 'NO'} golden=${goldenCaught ? 'yes' : 'NO'} | broken=[${broken.join(',')}] | ${FMT(d.num)}`);
  await page.evaluate(() => window.__shaderRestoreFragment());
}
const after = await detectors();
rows.forEach(r => console.log(r));
console.log(`RESTORE check | allGreen=${Object.values(after.flags).every(Boolean)} | ${FMT(after.flags)}`);
console.log(`MUTATION SCORE ${rows.filter(r => r.startsWith('CAUGHT')).length}/${MUTANTS.length} | console/page errors=${errors.length}${errors.length ? ' :: ' + errors.slice(0, 2).join(' | ') : ''}`);
console.log('LESSON: per-warp-path mutants (M3/M3b) leave the aggregate uWarp assertion green — only the golden-pixel hash catches them.');
await browser.close();
