// Implementation layer for graphic-gif Step 5 (the market package ships only SKILL.md:
// scripts/export-gif.sh + capture-and-encode.mjs referenced by SKILL.md do not exist).
// Follows SKILL.md Critical Rule 5: pause via Web Animations API and SEEK each frame
// (no setTimeout loops, no animation-delay), and Rule 6: capture floor(duration*fps)
// frames, never the frame at t=duration (it duplicates t=0).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HERE = process.cwd();
const HTML = path.join(HERE, 'animation.html');
const FRAMES = path.join(HERE, 'frames');
const DURATION_S = 4.0, FPS = 12, W = 800, H = 800;
const N = Math.floor(DURATION_S * FPS);          // Rule 6 -> 48
const STEP = 1000 / FPS;                         // 83.333ms
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

mkdirSync(FRAMES, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars',
         '--force-color-profile=srgb', '--font-render-hinting=none',
         '--disable-lcd-text', '--default-background-color=00000000'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto('file://' + HTML, { waitUntil: 'load' });

// every animation must exist and be pausable before seeking
const before = await page.evaluate(() => document.getAnimations().map(a => ({
  name: a.animationName, time: a.currentTime, playing: a.playSpeed,
})));
console.log('animations found:', JSON.stringify(before));

const probes = [];
for (let i = 0; i < N; i++) {
  const t = i * STEP;
  await page.evaluate((ms) => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  }, t);
  await page.screenshot({ path: path.join(FRAMES, `f${String(i).padStart(3, '0')}.png`) });
  probes.push(await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.counter'));
    return {
      // getComputedStyle(el,'::after').content returns the literal "counter(num)" in Chrome --
      // the registered @property value is the readable ground truth for the animated counter.
      num: parseInt(cs.getPropertyValue('--num'), 10),
      counterReset: cs.counterReset,
      statsOpacity: parseFloat(getComputedStyle(document.querySelector('.stats')).opacity),
      cursorOpacity: parseFloat(getComputedStyle(document.querySelector('.cursor')).opacity),
    };
  }));
}
await browser.close();
writeFileSync(path.join(HERE, 'probes.json'), JSON.stringify(probes, null, 1));
console.log('captured frames:', N);

// Step 5 / Option B documented two-pass palette (ffmpeg), loop=true
const ff = '/Users/apple/.local/bin/ffmpeg';
const run = (args) => execFileSync(ff, args, { encoding: 'utf8' });
run(['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', 'frames/f%03d.png',
     '-vf', `scale=${W}:${H}:flags=lanczos,palettegen=stats_mode=diff`, 'palette.png']);
run(['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', 'frames/f%03d.png',
     '-i', 'palette.png', '-lavfi',
     `scale=${W}:${H}:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
     '-loop', '0', 'animation.gif']);
console.log('gif written');
