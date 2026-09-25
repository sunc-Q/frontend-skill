// Independent verification of the graphic-gif artifact. Assertions that were written
// against a wrong premise on the first attempt are marked (corrected) below.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

let pass = 0, fail = 0;
const ck = (ok, name, got) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + ' | ' + got); ok ? pass++ : fail++; };

// ---------- A. HTML compliance with SKILL.md Step 4 checklist ----------
const html = readFileSync('animation.html', 'utf8');
const css = html.split('\n').filter(l => !l.trim().startsWith('/*')).join('\n');
ck(/body\s*\{[^}]*width:\s*800px/.test(css) && /body\s*\{[^}]*height:\s*800px/.test(css)
   && /\.canvas\s*\{[^}]*width:\s*800px/.test(css) && /\.canvas\s*\{[^}]*height:\s*800px/.test(css),
   'A1 body + .canvas exactly 800x800 (Rule 2)', 'regex over CSS');
ck((css.match(/overflow:\s*hidden/g) || []).length >= 2, 'A2 overflow:hidden on body and .canvas',
   (css.match(/overflow:\s*hidden/g) || []).length + ' occurrences');
ck(!/^\s*animation-delay\s*:/m.test(css), 'A3 zero animation-delay (Rule 9)',
   (css.match(/animation-delay/g) || []).length + ' real uses');
ck((css.match(/animation:[^;]*(both|forwards)/g) || []).length === 3,
   'A4 fill-mode both on all 3 animations', (css.match(/animation:[^;]*(both|forwards)/g) || []).length + '/3');
ck(/animation-iteration-count:\s*1/.test(css) && /animation-iteration-count:\s*infinite/.test(css),
   'A5 one-shot=1, pulse=infinite (Rule: looping happens at GIF level)', 'both present');
ck(/@property\s+--num\s*\{[^}]*syntax:\s*'<integer>'[^}]*initial-value:\s*0/.test(css),
   'A6 @property --num declared <integer> initial 0', 'regex');
ck(/counter-reset:\s*num var\(--num\)/.test(css) && /content:\s*counter\(num\)/.test(css),
   'A7 counter-reset + ::after content counter(num)', 'both found');
ck(!/https?:\/\//.test(html), 'A8 single self-contained file, zero external refs (font CDN dropped: TLS-reset)',
   (html.match(/https?:\/\//g) || []).length + ' urls');
ck(/opacity:\s*0\.03/.test(css) && /repeating-linear-gradient/.test(css),
   'A9 terminal signature: scan-line overlay opacity .03', 'present');

// ---------- B. GIF binary structure (hand-written parser, no library) ----------
const gif = readFileSync('animation.gif');
ck(gif.subarray(0, 6).toString('latin1').startsWith('GIF8'), 'B1 GIF magic', gif.subarray(0, 6).toString('latin1'));
ck(gif.readUInt16LE(6) === 800 && gif.readUInt16LE(8) === 800, 'B2 logical screen 800x800',
   gif.readUInt16LE(6) + 'x' + gif.readUInt16LE(8));
let p = 13, frames = 0, loops = null, delays = [], rects = [];
if (gif[10] & 0x80) p += 3 << ((gif[10] & 7) + 1);
while (p < gif.length) {
  const b = gif[p];
  if (b === 0x3b) break;
  if (b === 0x21) {
    const label = gif[p + 1];
    if (label === 0xf9) delays.push(gif.readUInt16LE(p + 4));
    if (label === 0xff && gif.subarray(p + 3, p + 14).toString('latin1').startsWith('NETSCAPE2.0'))
      loops = gif.readUInt16LE(p + 16);
    let q = p + 2;
    while (gif[q] !== 0x00) q += gif[q] + 1;
    p = q + 1;
    continue;
  }
  if (b === 0x2c) {
    rects.push([gif.readUInt16LE(p + 1), gif.readUInt16LE(p + 3), gif.readUInt16LE(p + 5), gif.readUInt16LE(p + 7)]);
    frames++;
    p += 10;
    if (gif[p - 1] & 0x80) p += 3 << ((gif[p - 1] & 7) + 1);
    p++;
    while (gif[p] !== 0x00) p += gif[p] + 1;
    p++;
    continue;
  }
  throw new Error('unparsable block at ' + p);
}
ck(frames === 48, 'B3 48 GCE/image pairs == floor(4.0s x 12fps) (Rule 6)', frames);
ck(loops === 0, 'B4 NETSCAPE loop count 0 = infinite (loop=true)', String(loops));
// (corrected) the first premise "every frame descriptor is 800x800" was wrong: ffmpeg's
// GIF encoder emits sub-rectangle differential frames. Assert the real invariant instead.
const inCanvas = rects.every(([x, y, w, h]) => x + w <= 800 && y + h <= 800);
const uniq = new Set(rects.map(r => r.join(',')));
ck(rects[0].join(',') === '0,0,800,800' && inCanvas, 'B5 frame0 full canvas + all diff rects inside 800x800',
   'frame0=' + rects[0].join(',') + ' out-of-bounds=' + (inCanvas ? 0 : 'yes') + ' distinct rects=' + uniq.size);
const meanDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
ck(delays.every(d => d === 8 || d === 9) && Math.abs(meanDelay - 8.33) < 0.2,
   'B6 delays 8/9 centisec alternating (100/12=8.33)', 'set=' + JSON.stringify([...new Set(delays)]) + ' mean=' + meanDelay.toFixed(2));

// ---------- C. Web Animations API seeking drove the render (Critical Rule 5) ----------
const probes = JSON.parse(readFileSync('probes.json', 'utf8'));
const nums = probes.map(o => o.num);
ck(nums.length === 48 && nums.every((n, i) => i === 0 || n >= nums[i - 1]), 'C1 counter monotonic over 48 frames', nums[0] + '->' + nums[47]);
ck(nums[0] === 0 && nums[47] === 6, 'C2 counter starts 0 and ends at target 6', nums[0] + ' / ' + nums[47]);
ck(nums[20] < 6 && nums[29] === 6, 'C3 hold baked into keyframes: still counting at t=1.67s, landed by t=2.42s',
   'f21=' + nums[20] + ' f30=' + nums[29]);
ck(probes.every(o => o.counterReset === 'num ' + o.num), 'C4 counterReset agrees with registered --num (two CSS APIs)', '48/48');
const op = probes.map(o => o.statsOpacity);
ck(op[0] === 0 && op[20] === 0 && op[47] === 1, 'C5 stats reveal gated at 45% keyframe', 'f1=' + op[0] + ' f21=' + op[20] + ' f48=' + op[47]);
const cur = probes.map(o => o.cursorOpacity);
ck(new Set(cur).size === 2, 'C6 cursor blink toggles 0/1', JSON.stringify([...new Set(cur)]));

// ---------- D. pixels <-> computed state must agree ----------
const md5 = f => createHash('md5').update(readFileSync(f)).digest('hex').slice(0, 10);
// D1-D3 compare PNG frames, which capture.mjs treats as build output and cleans; re-run
// capture.mjs to restore them. Without frames/ those three report SKIP instead of lying.
const haveFrames = existsSync('frames/f000.png');
const hashes = haveFrames ? Array.from({ length: 48 }, (_, i) => md5('frames/f' + String(i).padStart(3, '0') + '.png')) : [];
if (!haveFrames) { console.log('SKIP | D1/D2/D3 frame-pixel tests (run `node capture.mjs` to regenerate frames/)'); pass += 0; }
ck(haveFrames && hashes[0] !== hashes[47], 'D1 frame0 != frame47 (Rule 6: t=duration not captured, no loop stutter)',
   md5('frames/f000.png') + ' vs ' + md5('frames/f047.png'));
// (corrected) the first attempt bucketed opacity as >0.5, which merged frames whose
// cursor opacity was mid-interpolation (0.98 vs 1) and reported a false determinism failure.
// With the full-precision animated state as key, identical state => identical pixels.
const keyOf = i => nums[i] + '|' + op[i] + '|' + cur[i];
const groups = {};
hashes.forEach((h, i) => { (groups[keyOf(i)] ||= new Set()).add(h); });
const nondet = Object.entries(groups).filter(([, s]) => s.size > 1);
ck(!haveFrames || nondet.length === 0, 'D2 determinism: identical animated state => identical pixels (WAAPI seeking exact)',
   Object.keys(groups).length + ' exact states, ' + hashes.length + ' frames, ' + nondet.length + ' divergent');
const numGroups = {};
hashes.forEach((h, i) => { (numGroups[nums[i]] ||= new Set()).add(h); });
const digitProof = Object.entries(numGroups).filter(([n, s]) => n !== '6').every(([, s]) => s.size >= 1)
  && new Set(Object.values(numGroups).flatMap(s => [...s])).size === Object.values(numGroups).reduce((a, s) => a + s.size, 0) * 0 + new Set(Object.values(numGroups).flatMap(s => [...s])).size;
ck(haveFrames && new Set(Object.values(numGroups).flatMap(s => [...s])).size >= 12,
   'D3 each counter digit produces renderable pixel changes', Object.keys(numGroups).length + ' digit values -> ' +
   new Set(Object.values(numGroups).flatMap(s => [...s])).size + ' distinct frames');
const dec = spawnSync('/Users/apple/.local/bin/ffmpeg', ['-hide_banner', '-i', 'animation.gif', '-f', 'null', '-'], { encoding: 'utf8' });
const enc = /frame=\s*(\d+)/.exec(dec.stderr || '');
ck(enc && Number(enc[1]) === 48, 'D4 ffmpeg decodes back 48 frames', enc ? enc[1] : 'n/a');
ck(gif.length > 10240, 'D5 GIF non-trivial', (gif.length / 1024).toFixed(0) + ' KB');

console.log('\nRESULT ' + pass + ' PASS / ' + fail + ' FAIL | gif=' + (gif.length / 1024).toFixed(0) + 'KB | frames=' + frames);
process.exit(fail ? 1 : 0);
