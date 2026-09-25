// graphic-gif 技能 Step5 的本地替代实现：技能引用的 scripts/export-gif.sh 在本机安装中缺失，
// 此处按 SKILL.md 规则 5/6（Web Animations API 逐帧寻位、帧数=floor(duration*fps)、不捕获 t=duration）重建。
// 依赖装在 LAB/.tmp/node_modules（收尾会删除）：playwright-core gifenc pngjs，
// 复现：cd 前端skill实验室/.tmp && npm i --registry=https://registry.npmmirror.com playwright-core@1.48.2 gifenc pngjs
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// 相对 mjs 文件本身回溯四级：file→scripts→场景目录→artifacts→LAB/.tmp
const require = createRequire(path.join(fileURLToPath(import.meta.url), '../../../../.tmp/noop.js'));
const { chromium } = require('playwright-core');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { PNG } = require('pngjs');

const EXE = process.env.CHROME_EXE ||
  '/Users/apple/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const htmlPath = path.resolve(arg('html'));
const outGif = path.resolve(arg('out'));
const samplesDir = path.resolve(arg('samples', path.join(path.dirname(outGif), 'samples')));
const width = Number(arg('width', 800));
const height = Number(arg('height', 800));
const duration = Number(arg('duration', 3.0));
const fps = Number(arg('fps', 12));
const maxColors = Number(arg('max-colors', 256));
const frameCount = Math.floor(duration * fps); // 技能规则 6
const stepMs = 1000 / fps;
const delayCs = Math.round(100 / fps); // GIF 延时粒度=1/100s

mkdirSync(samplesDir, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('PAGEERROR', e.message); process.exitCode = 5; });
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
const fontInfo = await page.evaluate(async () => {
  await document.fonts.ready;
  const loaded = [];
  for (const fam of ['Inter', 'IBM Plex Mono', 'Anton', 'Space Mono']) {
    try { if (document.fonts.check(`16px "${fam}"`)) loaded.push(fam); } catch {}
  }
  return { loaded, count: document.fonts.size };
});
await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));

const frames = [];
for (let i = 0; i < frameCount; i++) {
  const t = i * stepMs; // t=duration 那一帧刻意不采（与 t=0 重复，会造成环缝卡顿）
  await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), t);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  const png = PNG.sync.read(buf);
  frames.push(png.data);
  if (png.width !== width || png.height !== height) {
    console.error('FRAME SIZE MISMATCH', png.width, png.height); process.exit(6);
  }
  if ([0, Math.floor(frameCount / 2), frameCount - 1].includes(i)) {
    const out = new PNG({ width, height });
    out.data = png.data;
    writeFileSync(path.join(samplesDir, `frame-${String(i).padStart(2, '0')}.png`), PNG.sync.write(out));
  }
}
// 末帧终值探针（页面仍停在 t=最后帧）：一次性动画必须在最后一帧呈现目标值（技能规则 6 的终值缺陷回归）
const finalState = await page.evaluate(() => {
  const c = document.querySelector('.counter');
  const tw = document.querySelector('.tw');
  const m = document.querySelector('.meter i');
  return {
    num: c ? getComputedStyle(c).getPropertyValue('--num').trim() : null,
    twWidth: tw ? Number(getComputedStyle(tw).width.replace('px', '')).toFixed(1) : null,
    meterScale: m ? getComputedStyle(m).transform : null,
  };
}).catch(() => null);
await browser.close();

const gif = GIFEncoder();
const perFrameColors = [];
for (let i = 0; i < frames.length; i++) {
  const palette = quantize(frames[i], maxColors);
  perFrameColors.push(palette.length);
  const index = applyPalette(frames[i], palette, 'rgb5');
  // gifenc 的 delay 单位是毫秒，内部 Math.round(delay/10) 化成厘秒（GIF 粒度=1/100s）
  gif.writeFrame(index, width, height, { palette, delay: stepMs, repeat: 0 });
}
gif.finish();
const bytes = Buffer.from(gif.bytes());
writeFileSync(outGif, bytes);

// 帧间度量：环缝（首末帧差）与逐帧变化量，供 check 断言使用
const lum = (rgba, px) => 0.2126 * rgba[px] + 0.7152 * rgba[px + 1] + 0.0722 * rgba[px + 2];
function meanLum(f) {
  let s = 0;
  for (let p = 0; p < f.length; p += 4) s += lum(f, p);
  return s / (f.length / 4);
}
function meanAbsDiff(a, b) {
  let s = 0;
  for (let p = 0; p < a.length; p += 4) s += Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]);
  return s / ((a.length / 4) * 3);
}
const metrics = {
  html: path.basename(htmlPath),
  gif: path.basename(outGif),
  bytes: bytes.length, // Buffer.byteLength 口径（教训：不要用 String.length 当字节数）
  width, height, duration, fps, frameCount, delayCs,
  effective_fps: 100 / delayCs,
  final_state: finalState,
  fonts: fontInfo,
  palette_sizes: perFrameColors,
  mean_lum_per_frame: frames.map((f) => Number(meanLum(f).toFixed(2))),
  diff_f0_f1: Number(meanAbsDiff(frames[0], frames[1]).toFixed(3)),
  diff_f0_last: Number(meanAbsDiff(frames[0], frames[frames.length - 1]).toFixed(3)),
  diff_last_pair: Number(meanAbsDiff(frames[frames.length - 2], frames[frames.length - 1]).toFixed(3)),
};
writeFileSync(path.join(path.dirname(outGif), 'gif-metrics.json'), JSON.stringify(metrics, null, 1) + '\n');
console.log(JSON.stringify(metrics, null, 1));
