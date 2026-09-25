/* Reference-image -> visual-quantity extractor (build-game SKILL.md Phase 1B).
   The skill says: "Read/view any provided image files ... Extract key visual
   elements: colors, proportions, distinctive features, style/mood" and
   "translate visual references into Three.js primitive recipes".
   It does NOT say how, so this file makes the step deterministic and auditable:
   every number that ends up in the theme is produced here by a named formula
   and recorded in reference-map.json together with the formula text.

   Run from LAB root:
     node artifacts/20260926-05-build-game-reference-driven/scripts/extract-reference.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REQ = createRequire(path.resolve(process.cwd(), '.tmp/refbuild/node_modules/x'));
const { PNG } = REQ('pngjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const SAMPLE_W = 220; // downsample target (keeps quantisation cheap and stable)
const K_BUCKETS = 10;
const MIN_SHARE = 0.02;
const PALETTE_MAX = 6;

const REFS = [
  { id: 'seto-coast', zh: '濑户春岸', file: 'references/ref-seto-spring.png' },
  { id: 'atlas-ochre', zh: '赭土绿洲', file: 'references/ref-atlas-ochre.png' },
  { id: 'nordic-night', zh: '极夜冰湖', file: 'references/ref-nordic-night.png' },
];

/* ---------------------------------------------------------------- colour maths */
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}
function rgb2xyz(r, g, b) {
  const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  return [R * 0.4124 + G * 0.3576 + B * 0.1805, R * 0.2126 + G * 0.7152 + B * 0.0722, R * 0.0193 + G * 0.1192 + B * 0.9505];
}
function rgb2lab(r, g, b) {
  const [x, y, z] = rgb2xyz(r, g, b);
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / 0.95047), fy = f(y), fz = f(z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE(c1, c2) {
  const a = rgb2lab(c1[0], c1[1], c1[2]), b = rgb2lab(c2[0], c2[1], c2[2]);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const intHex = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);

/* ---------------------------------------------------------------- decoding */
function readPng(file) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SCENE, file)));
  const step = Math.max(1, Math.round(png.width / SAMPLE_W));
  const px = [];
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const i = (y * png.width + x) * 4;
      px.push([png.data[i], png.data[i + 1], png.data[i + 2], x / png.width, y / png.height]);
    }
  }
  return { px, step, w: png.width, h: png.height };
}

/* median cut: repeatedly split the box with the largest RGB *volume* along its
   longest axis, at the median pixel. (Splitting the box with the most pixels —
   the naive version first written here — makes every bucket share exactly 1/k
   and throws away the area weighting the whole extraction depends on.) */
function medianCut(px, k) {
  const boxOf = (idx) => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const i of idx) for (let ax = 0; ax < 3; ax++) {
      lo[ax] = Math.min(lo[ax], px[i][ax]); hi[ax] = Math.max(hi[ax], px[i][ax]);
    }
    return { idx, lo, hi, vol: (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]) };
  };
  let boxes = [boxOf(px.map((_, i) => i))];
  while (boxes.length < k) {
    const big = boxes.filter((b) => b.idx.length > 4).sort((a, b) => b.vol - a.vol)[0];
    if (!big) break;
    let axis = 0, span = -1;
    for (let ax = 0; ax < 3; ax++) if (big.hi[ax] - big.lo[ax] > span) { span = big.hi[ax] - big.lo[ax]; axis = ax; }
    const idx = [...big.idx].sort((a, b) => px[a][axis] - px[b][axis]);
    const half = idx.length >> 1;
    boxes = boxes.filter((b) => b !== big);
    boxes.push(boxOf(idx.slice(0, half)), boxOf(idx.slice(half)));
  }
  return boxes
    .filter((b) => b.idx.length)
    .map((b) => {
      let r = 0, g = 0, bl = 0;
      for (const i of b.idx) { r += px[i][0]; g += px[i][1]; bl += px[i][2]; }
      const n = b.idx.length;
      return { mean: [r / n, g / n, bl / n], share: n / px.length, idx: b.idx };
    })
    .sort((a, b) => b.share - a.share);
}

/* ---------------------------------------------------------------- per-reference extraction */
function extract(ref) {
  const { px, w, h } = readPng(ref.file);
  const buckets = medianCut(px, K_BUCKETS);
  // merge buckets closer than 10 ΔE (a 10-way median cut routinely yields two
  // near-identical entries, which would inflate palette_slots without adding colour)
  const merge = (list) => {
    const out = [];
    for (const b of list) {
      if (out.some((m) => deltaE(m.mean, b.mean) < 10)) continue;
      out.push(b);
    }
    return out;
  };
  const byArea = [...buckets].sort((a, b) => b.share - a.share);
  // FORMULA-PALETTE: the closed palette is what the frame must show — share >= 2%, top 6
  const kept = merge(byArea.filter((b) => b.share >= MIN_SHARE)).slice(0, PALETTE_MAX);
  // FORMULA-FEATURE: "distinctive features" in SKILL.md 1B are allowed to be small —
  // accent and flora are scanned over a 0.5% pool, so one palm cluster still counts.
  const featurePool = merge(byArea.filter((b) => b.share >= 0.005));
  const palette = kept.map((b) => {
    const [r, g, bl] = b.mean;
    const m = rgb2hsl(r, g, bl);
    return { hex: hex(b.mean), rgb: b.mean.map(Math.round), share: +b.share.toFixed(4), hsl: { h: +m.h.toFixed(1), s: +m.s.toFixed(3), l: +m.l.toFixed(3) } };
  });

  const featHsl = (b) => rgb2hsl(...b.mean);
  // chroma in CIE Lab, not HSL saturation: HSL reports near-white sand as "saturated"
  // (its denominator collapses as L->1), which made the accent pick the brightest blob.
  const chroma = (b) => { const [, a2, b2] = rgb2lab(...b.mean); return Math.hypot(a2, b2); };
  const lStar = (b) => rgb2lab(...b.mean)[0];
  // FORMULA-ACCENT: the most chromatic *visible* entry of the feature pool.
  // L* window 40..95 rejects both silhouettes and blown-out sky/sand.
  const accentCands = featurePool.filter((b) => chroma(b) >= 12 && lStar(b) >= 40 && lStar(b) <= 95);
  const accent = (accentCands.length ? accentCands : featurePool).sort((a, b) => chroma(b) - chroma(a))[0];
  // FORMULA-GROUND: largest bucket whose centroid sits in the lower 45% of the frame
  const lowerIdx = new Set();
  for (let i = 0; i < px.length; i++) if (px[i][4] > 0.55) lowerIdx.add(i);
  const groundBuckets = kept.map((b, bi) => ({
    bi,
    share: b.idx.filter((i) => lowerIdx.has(i)).length / (lowerIdx.size || 1),
  })).sort((a, b) => b.share - a.share);
  const ground = palette[groundBuckets[0].bi];
  // FORMULA-SUN: centroid of the brightest 2% of pixels -> light direction
  const byLum = [...px.keys()].sort((a, b) => lum(px[b][0], px[b][1], px[b][2]) - lum(px[a][0], px[a][1], px[a][2]));
  const top = byLum.slice(0, Math.max(8, Math.round(px.length * 0.02)));
  let cu = 0, cv = 0, cr = 0, cg = 0, cb = 0;
  for (const i of top) { cu += px[i][3]; cv += px[i][4]; cr += px[i][0]; cg += px[i][1]; cb += px[i][2]; }
  const sunU = cu / top.length, sunV = cv / top.length;
  const sunColor = [cr / top.length, cg / top.length, cb / top.length];
  // FORMULA-THETA: azimuth = (u-0.5)*180deg (u<0.5 => light from -x / frame left)
  const azimuth = (sunU - 0.5) * 180;
  // FORMULA-PHI: elevation = 55deg at the top edge down to 15deg at the bottom edge
  const elevation = 55 - 40 * sunV;
  // FORMULA-EXPOSURE / FORMULA-AMBIENT: tone mapping and the ambient safety net
  // compensate the reference's own brightness instead of the base colours being darkened.
  const meanLuma = px.reduce((a, p) => a + lum(p[0], p[1], p[2]), 0) / px.length / 255;
  const exposure = +Math.max(1.0, Math.min(1.4, 1.0 + (0.55 - meanLuma) * 1.2)).toFixed(3);
  const ambient = +Math.max(0.5, Math.min(0.8, 0.5 + (0.55 - meanLuma) * 1.4)).toFixed(3);
  // FORMULA-HUEFAMILIES: distinct hue families with saturation>0.12 and share>=3%
  const families = new Set(palette.filter((p) => p.hsl.s > 0.12 && p.share >= 0.03)
    .map((p) => Math.round(p.hsl.h / 30) % 12));
  // FORMULA-GREEN: any feature-pool entry in the 60..180 hue band => flora present
  const green = featurePool.map((b) => ({ b, m: featHsl(b) })).find(
    ({ m }) => m.h >= 60 && m.h <= 180 && m.s > 0.15 && m.l < 0.62) || null;
  // FORMULA-FRAME: bucket count drives how many visually distinct entity families the world gets
  const entityFamilies = Math.max(3, Math.min(5, families.size));
  // FORMULA-CONTRAST: p99.5-p0.5 of luma (lab L*) spread inside the palette
  const Ls = palette.map((p) => rgb2lab(...p.rgb)[0]).sort((a, b) => a - b);
  const lStarRange = +(Ls[Ls.length - 1] - Ls[0]).toFixed(1);

  // FORMULA-VISIBILITY (the skill's own CRITICAL rule: no near-black on large surfaces):
  // a derived ground colour must have at least one channel >= 0x44, otherwise it is
  // lifted along its own hue and the lift is recorded as an explicit deviation.
  const groundLift = (() => {
    const c = [...ground.rgb];
    if (Math.max(...c) >= 0x44) return { lifted: false, from: ground.hex, to: ground.hex, delta: 0 };
    const k = 0x44 / Math.max(...c);
    const to = c.map((v) => Math.round(v * k));
    return { lifted: true, from: ground.hex, to: hex(to), delta: +deltaE(c, to).toFixed(1) };
  })();
  const groundFinal = groundLift.lifted
    ? hex(ground.rgb.map((v) => Math.round(v * (0x44 / Math.max(...ground.rgb)))))
    : ground.hex;

  // FORMULA-MOOD: share-weighted Lab chroma (C*ab / 60, clamped) => toon gradient steps + scatter count
  const wsum = palette.reduce((a, p) => a + p.share, 0);
  const meanChromaAb = palette.reduce((a, p) => a + chroma({ mean: p.rgb }) * p.share, 0) / wsum;
  const mood = Math.max(0, Math.min(1, meanChromaAb / 60));
  const toonSteps = mood > 0.5 ? 4 : mood > 0.28 ? 3 : 2;
  const scatterCount = Math.round(220 + mood * 420);

  return {
    id: ref.id,
    zh: ref.zh,
    file: ref.file,
    source: { png_w: w, png_h: h, sampled_px: px.length, quantizer: 'median-cut k=10 min_share=2%', palette_slots: palette.length },
    palette,
    derived: {
      accent_hex: hex(accent.mean),
      accent_share: +accent.share.toFixed(4),
      accent_outside_palette: !palette.some((p) => deltaE(p.rgb, accent.mean) < 12),
      ground_hex: ground.hex,
      ground_final_hex: groundFinal,
      ground_lift: groundLift,
      sun: { u: +sunU.toFixed(4), v: +sunV.toFixed(4), azimuth_deg: +azimuth.toFixed(1), elevation_deg: +elevation.toFixed(1), color_hex: hex(sunColor) },
      exposure,
      ambient,
      mean_luma: +meanLuma.toFixed(4),
      hue_families: [...families].sort((a, b) => a - b),
      family_count: families.size,
      entity_families: entityFamilies,
      green_hex: green ? hex(green.b.mean) : null,
      green_share: green ? +green.b.share.toFixed(4) : null,
      lstar_range: lStarRange,
      mood: +mood.toFixed(3),
      mean_chroma_ab: +meanChromaAb.toFixed(2),
      toon_steps: toonSteps,
      scatter_count: scatterCount,
    },
  };
}

const FORMULAS = {
  'PALETTE': 'closed palette = median-cut(k=10) on a 220px resample, dE76 merge, share>=2%, top 6 by area',
  'FEATURE': 'accent/flora are scanned over a 0.5% "feature pool" — SKILL.md 1B asks for distinctive features, which in a photo are small (one palm cluster, one lantern)',
  'ACCENT': 'accent = max(chroma) entry of the feature pool',
  'GROUND': 'ground = palette entry with the largest share of pixels whose v>0.55 (lower 45% of the frame)',
  'VISIBILITY': 'if max(channel(ground)) < 0x44 lift it by 0x44/max(channel) — SKILL.md "never near-black on large surfaces"',
  'SUN': 'sun = centroid (u,v) of the brightest 2% of pixels by Rec.709 luma',
  'THETA': 'key-light azimuth = (u - 0.5) * 180deg, i.e. u<0.5 puts the sun on the -x side',
  'PHI': 'key-light elevation = 55deg - 40deg * v',
  'EXPOSURE': 'toneMappingExposure = clamp(1.0 + (0.55 - mean_luma) * 1.2, 1.0, 1.4) — dark references get more light back',
  'AMBIENT': 'ambient intensity = clamp(0.5 + (0.55 - mean_luma) * 1.4, 0.5, 0.8) — the skill\'s "safety net that prevents dark scenes" is sized off the reference too',
  'MERGE': 'median-cut boxes are merged when their means are closer than 10 dE76, then share>=2% and top-6 by area',
  'HUEFAMILIES': 'family_count = distinct round(hue/30) among entries with saturation>0.12 and share>=3%',
  'GREEN': 'flora colour = first palette entry with 60<=hue<=180 and saturation>0.15 and lightness<0.62; none => rocks instead of trees',
  'FAMILIES': 'entity_families = clamp(family_count, 3, 5) — how many visually distinct mote/hound families the world carries',
  'MOOD': 'mood = clamp(share-weighted Lab C*ab / 60, 0, 1) => toon gradient steps (2/3/4) and scatter instance count (220 + 420*mood)',
};

function main() {
  const out = { generated_by: 'scripts/extract-reference.mjs', sample_w: SAMPLE_W, k_buckets: K_BUCKETS, formulas: FORMULAS, refs: REFS.map(extract) };
  fs.writeFileSync(path.join(SCENE, 'scripts', 'reference-map.json'), JSON.stringify(out, null, 1));
  for (const r of out.refs) {
    console.log(r.id, r.palette.map((p) => `${p.hex}(${(p.share * 100).toFixed(1)}%)`).join(' '));
    console.log('   ground', r.derived.ground_final_hex, 'lift?', r.derived.ground_lift.lifted,
      'sun', r.derived.sun.azimuth_deg + 'deg/' + r.derived.sun.elevation_deg + 'deg',
      'exposure', r.derived.exposure, 'families', r.derived.family_count, 'flora', r.derived.green_hex, 'scatter', r.derived.scatter_count);
  }
}
main();
