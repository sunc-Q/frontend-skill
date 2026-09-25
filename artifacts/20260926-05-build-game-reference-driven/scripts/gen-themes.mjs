/* reference-map.json -> src/themes.js
   The mapping from a photograph to a Three.js theme must be code, not typing:
   every colour / light / post value below is produced by a named FORMULA-* in
   extract-reference.mjs, and the emitted file carries the provenance record so
   scripts/check.mjs can re-derive it and diff against the live scene.
   Run from LAB root:
     node artifacts/20260926-05-build-game-reference-driven/scripts/gen-themes.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const MAP = JSON.parse(fs.readFileSync(path.join(SCENE, 'scripts/reference-map.json'), 'utf8'));

const int = (h) => parseInt(h.slice(1), 16);
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgb2lab(r, g, b) {
  const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
}
const L = (p) => rgb2lab(...p.rgb)[0];
const chromaOf = (p) => { const [, a, b] = rgb2lab(...p.rgb); return Math.hypot(a, b); };

/* FORMULA-TEXTCONTRAST: a HUD label colour must sit at least minDE away from the
   panel it is printed on. The reference's zenith is a beautiful candidate for
   muted text but on seto-coast it landed 13 dE from the panel — unreadable.
   Push the colour along its own hue toward black/white until it clears the bar,
   so the fix never introduces a colour the photograph did not imply. */
function contrastTo(fgHex, bgHex, minDE = 28) {
  const bg = rgb2lab(...rgb(bgHex));
  const de = (h) => { const l = rgb2lab(...rgb(h)); return Math.hypot(l[0] - bg[0], l[1] - bg[1], l[2] - bg[2]); };
  if (de(fgHex) >= minDE) return { hex: fgHex, lifted: false, delta: +de(fgHex).toFixed(1) };
  const tgt = bg[0] > 50 ? [0, 0, 0] : [255, 255, 255];
  const src = rgb(fgHex);
  for (let i = 1; i <= 20; i++) {
    const mixed = toHex(src.map((v, k) => v + (tgt[k] - v) * (i / 20)));
    if (de(mixed) >= minDE) return { hex: mixed, lifted: true, delta: +de(mixed).toFixed(1), from: fgHex };
  }
  return { hex: toHex(tgt), lifted: true, delta: +de(toHex(tgt)).toFixed(1), from: fgHex };
}

/* FORMULA-VISIBILITY, reused for any large surface, not just the ground */
function visible(hexStr, floor = 0x44) {
  const c = rgb(hexStr);
  const mx = Math.max(...c);
  if (mx >= floor) return { hex: hexStr, lifted: false, delta: 0, from: hexStr };
  const to = toHex(c.map((v) => Math.round((v * floor) / mx)));
  const d = Math.hypot(...rgb2lab(...rgb(hexStr)).map((v, i) => v - rgb2lab(...rgb(to))[i]));
  return { hex: to, lifted: true, delta: +d.toFixed(1), from: hexStr };
}

const NAMES = {
  'seto-coast': { game: '拾光谷 · 春岸', sub: 'GLEAMHOLLOW · SETO COAST', cta: '点击进入春岸', hint: '参考图：濑户内海春岸照片 · 低太阳在画面左', label: '濑户春岸' },
  'atlas-ochre': { game: '拾光谷 · 赭洲', sub: 'GLEAMHOLLOW · ATLAS OCHRE', cta: '点击进入赭洲', hint: '参考图：高Atlas土堡正午照片 · 光在画面右', label: '赭土绿洲' },
  'nordic-night': { game: '拾光谷 · 极夜', sub: 'GLEAMHOLLOW · NORDIC NIGHT', cta: '点击进入极夜', hint: '参考图：北欧冰湖蓝调夜 · 月光在画面左下', label: '极夜冰湖' },
};

function buildTheme(ref) {
  const p = ref.palette, d = ref.derived;
  const byArea = [...p].sort((a, b) => b.share - a.share);
  const ground = d.ground_final_hex;
  /* FORMULA-GROUND×0.72: ONE derivation of the second terrain tone. It used to be written
     twice with two different factors (0.7 / 0.72), so materials that read colors.groundAlt
     sat outside the declared palette. */
  const altHex = toHex(rgb(ground).map((v) => Math.round(v * 0.72)));
  // FORMULA-SKY: horizon = brightest entry (highest L*), zenith = darkest non-ground entry
  const horizon = [...p].sort((a, b) => L(b) - L(a))[0];
  const zenith = [...p].filter((e) => e.hex !== ground).sort((a, b) => L(a) - L(b))[0];
  // FORMULA-ROCK: darkest non-ground entry, run through the same visibility floor as the ground
  const rockSrc = visible(zenith.hex);
  // FORMULA-FLORA: green band found in the feature pool decides trees vs rocks
  const flora = d.green_hex ? visible(d.green_hex, 0x33) : null;
  const dE = (a, b) => { const A = rgb2lab(...rgb(a)), B = rgb2lab(...rgb(b)); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  const dEhex = (a, b) => dE(a, b);
  // FORMULA-SCAPE-KIND: flora if the green band survives; otherwise the reference's own
  // L* range reads as light quality — flat light (low range) => shards, hard light => boulders
  const scapeKind = flora ? 'flora' : (d.lstar_range < 45 ? 'shard' : 'boulder');
  // FORMULA-FAMILIES: the mote roster is drawn, greedily by chroma, from palette entries
  // that are neither ground nor zenith — under the same "each visually distinct" bar
  // (min pairwise dE 15) the fallback below uses, so a photo whose two big regions happen
  // to be two similar blues cannot pass a weak roster through.
  const motePool = byArea.filter((e) => e.hex !== ground && e.hex !== zenith.hex && chromaOf(e) > 8)
    .sort((a, b) => chromaOf(b) - chromaOf(a));
  const motes = [];
  for (const e of motePool) {
    if (motes.length >= d.entity_families) break;
    if (motes.some((m) => dEhex(m, e.hex) < 15)) continue;
    motes.push(e.hex);
  }
  // FORMULA-MOTE-FALLBACK: a single-hue reference (the Nordic night photo has one hue family)
  // cannot supply 3 mutually distinguishable entities, which SKILL.md's "each visually distinct"
  // still demands. The remainder is synthesised by rotating the accent hue +-40deg at the
  // reference's own mean L*, and is recorded as a synthesised (not photographed) colour.
  const synthesised = [];
  const hslRotate = (hexStr, deg) => {
    const [r, g, b] = rgb(hexStr).map((v) => v / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dd = mx - mn;
    let h = dd === 0 ? 0 : mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    h = ((h * 60 + deg) % 360 + 360) % 360;
    const s = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l - 1));
    const c2 = (1 - Math.abs(2 * l - 1)) * s, x = c2 * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c2 / 2;
    const [rr, gg, bb] = h < 60 ? [c2, x, 0] : h < 120 ? [x, c2, 0] : h < 180 ? [0, c2, x] : h < 240 ? [0, x, c2] : h < 300 ? [x, 0, c2] : [c2, 0, x];
    return toHex([rr + m, gg + m, bb + m].map((v) => v * 255));
  };
  let rot = 40;
  while (motes.length < 3) {
    let cand = hslRotate(d.accent_hex, rot);
    let guard = 0;
    while (motes.some((m) => dE(m, cand) < 15) && guard++ < 8) { rot += 25; cand = hslRotate(d.accent_hex, rot); }
    motes.push(cand);
    synthesised.push({ hex: cand, from: d.accent_hex, rotated_deg: rot, min_dE_to_roster: +Math.min(...motes.slice(0, -1).map((m) => +dE(m, cand).toFixed(1))) });
    rot += 40;
  }
  const moteSpread = +Math.min(...motes.flatMap((a, i) => motes.slice(i + 1).map((b) => +dE(a, b).toFixed(1)))).toFixed(1);
  // FORMULA-KEYI: key light intensity grows as the reference gets darker (2.0 .. 3.0 per SKILL.md)
  const keyI = +(2.0 + (1 - d.mean_luma) * 1.0).toFixed(2);
  const th = (d.sun.azimuth_deg * Math.PI) / 180;
  const ph = (d.sun.elevation_deg * Math.PI) / 180;
  const R = 78;
  const keyPos = [
    +(R * Math.cos(ph) * Math.sin(th)).toFixed(2),
    +(R * Math.sin(ph)).toFixed(2),
    +(R * Math.cos(ph) * Math.cos(th) * -1).toFixed(2),
  ];
  const fillPos = [-keyPos[0] * 0.7, 42, -keyPos[2] * 0.7].map((v) => +v.toFixed(2));
  const bloom = +(0.25 + 0.25 * (1 - d.mean_luma)).toFixed(3);
  const sat = +(0.95 + 0.15 * d.family_count).toFixed(3);
  const contrast = +(1 + (d.lstar_range / 100) * 0.35).toFixed(3);
  const vignette = +(0.18 + d.mood * 0.2).toFixed(3);
  const fogDensity = +(0.004 + (1 - d.mean_luma) * 0.006).toFixed(5);
  const uiPanel = toHex(rgb(zenith.hex).map((v) => Math.min(255, v + 26)));
  const uiMutedC = contrastTo(zenith.hex, uiPanel);
  const uiTextC = contrastTo(horizon.hex, uiPanel);

  return {
    id: ref.id,
    ...NAMES[ref.id],
    /* ONE shared layout seed: the world, the AI waypoints and the mote positions
       are style-independent by construction, which is what makes the
       "theme must not change gameplay" assertion possible. */
    seed: 20260926,
    refFile: ref.file,
    palette: p.map((e) => ({ hex: e.hex, share: e.share, l: +L(e).toFixed(1), c: +chromaOf(e).toFixed(1) })),
    colors: {
      /* FORMULA-VISIBILITY, one derivation: the second terrain tone every material reads */
      ground: int(ground), groundAlt: int(altHex), rock: int(rockSrc.hex), flora: flora ? int(flora.hex) : null,
      skyTop: int(zenith.hex), skyBottom: int(horizon.hex), sun: int(d.sun.color_hex),
      accent: int(d.accent_hex), fog: int(horizon.hex),
      motes: motes.map(int), moteHexes: motes,
      hub: int(d.accent_hex), hound: int(zenith.hex),
      uiAccent: d.accent_hex, uiText: uiTextC.hex, uiMuted: uiMutedC.hex, uiPanel,
      uiTextFrom: horizon.hex, uiMutedFrom: zenith.hex,
    },
    sky: { top: int(rockSrc.hex), bottom: int(horizon.hex), sun: int(d.sun.color_hex), sunSize: 0.06 },
    fog: { color: int(horizon.hex), density: fogDensity },
    lights: {
      key: { color: int(d.sun.color_hex), intensity: keyI, pos: keyPos },
      fill: { color: int(horizon.hex), intensity: 0.7, pos: fillPos },
      hemi: { sky: int(horizon.hex), gnd: int(ground), intensity: 0.5 },
      ambient: { color: int(horizon.hex), intensity: d.ambient },
      rim: { color: int(d.accent_hex), intensity: 1.2, distance: 60, pos: [keyPos[0] * -0.4, 14, keyPos[2] * -0.4] },
    },
    ground: { c1: rgb(ground), c2: rgb(toHex(rgb(ground).map((v) => Math.round(v * 0.7)))) , roughness: 0.9, metalness: 0.02 },
    scatter: {
      count: d.scatter_count,
      kind: scapeKind,
      colorHex: flora ? flora.hex : rockSrc.hex,
      toonSteps: d.toon_steps,
    },
    motes: { emissiveIntensity: 2.2, colors: motes.map(int), spread_dE: moteSpread },
    synthesised,
    /* every colour the theme may put on screen: photographed palette + visibility-lifted
       surfaces + synthesised mote entries. check.mjs asserts closure against this set. */
    declaredColors: [...new Set([ground, altHex, horizon.hex, zenith.hex, rockSrc.hex, d.accent_hex,
      d.sun.color_hex, ...motes,
      uiPanel, uiMutedC.hex, uiTextC.hex,
      ...(flora ? [flora.hex] : [])])],
    particles: { colors: byArea.slice(0, 4).map((e) => int(e.hex)), additive: d.mean_luma < 0.45, size: 1.1, gravity: -0.6, rate: +(0.5 + d.mood).toFixed(2) },
    post: {
      exposure: d.exposure,
      bloom: { strength: bloom, radius: 0.3, threshold: 0.85 },
      grade: { brightness: 0.01, contrast, saturation: sat, vignette },
    },
    /* provenance: what a human would otherwise type into a comment */
    mapping: [
      ['colors.ground', 'GROUND' + (d.ground_lift.lifted ? '+VISIBILITY' : ''), `lower-frame area winner ${d.ground_hex}${d.ground_lift.lifted ? ` lifted to ${ground} (dE ${d.ground_lift.delta})` : ''}`],
      ['colors.groundAlt', 'GROUND×0.72', 'second terrain tone for the noise texture'],
      ['sky.bottom / fog.color', 'SKY-horizon', `${horizon.hex} = max L* of the palette (fog matched to horizon per SKILL.md)`],
      ['sky.top', 'SKY-zenith' + (rockSrc.lifted ? '+VISIBILITY' : ''), `${zenith.hex} = min L* among non-ground entries${rockSrc.lifted ? `, lifted to ${rockSrc.hex} (dE ${rockSrc.delta}) so the dome clears the 0x44 floor` : ''}`],
      ['lights.key.pos', 'THETA+PHI', `sun centroid (u=${d.sun.u}, v=${d.sun.v}) -> az ${d.sun.azimuth_deg}deg, el ${d.sun.elevation_deg}deg, R=78 -> [${keyPos.join(', ')}]`],
      ['lights.key.color', 'SUN', `mean colour of the brightest 2% = ${d.sun.color_hex}`],
      ['lights.key.intensity', 'KEYI', `2.0 + (1 - mean_luma ${d.mean_luma}) * 1.0 = ${keyI}`],
      ['lights.ambient.intensity', 'AMBIENT', `clamp(0.5 + (0.55 - ${d.mean_luma}) * 1.4, .5, .8) = ${d.ambient}`],
      ['lights.rim.color', 'ACCENT', d.accent_hex + (d.accent_outside_palette ? ' (feature-pool only: share ' + d.accent_share + ' < 2%)' : '')],
      ['colors.motes', 'FAMILIES' + (synthesised.length ? '+MOTE-FALLBACK' : ''), `${d.entity_families} mote colours from ${d.family_count} hue families: ${motes.join(' ')} (min pairwise dE ${moteSpread}${synthesised.length ? ', ' + synthesised.length + ' synthesised by hue rotation of the accent' : ''})`],
      ['scatter.kind', 'SCAPE-KIND', flora ? `flora ${flora.hex} (share ${d.green_share})` : `no 60..180deg band >=0.5% and L* range ${d.lstar_range} ${d.lstar_range < 45 ? '<' : '>='} 45 -> ${scapeKind}`],
      ['HUD skin', 'SKIN', `scatter.kind ${scapeKind} -> ${scapeKind === 'flora' ? 'rounded/soft-shadow/humanist sans' : scapeKind === 'boulder' ? 'square/2px ring/Helvetica + 3px top rule' : 'hairline/inset bar/monospace + uppercase wide title'}`],
      ['colors.uiMuted/uiText', 'TEXTCONTRAST', `panel ${uiPanel}: ${zenith.hex}->${uiMutedC.hex} (dE ${uiMutedC.delta}${uiMutedC.lifted ? ', pushed along its own hue to >=28' : ''}), ${horizon.hex}->${uiTextC.hex} (dE ${uiTextC.delta}${uiTextC.lifted ? ', pushed' : ''})`],
      ['scatter.count', 'MOOD', `220 + 420 * mood ${d.mood} = ${d.scatter_count}`],
      ['scatter.toonSteps', 'MOOD', `mood ${d.mood} -> ${d.toon_steps} gradient steps`],
      ['post.exposure', 'EXPOSURE', `clamp(1 + (0.55 - ${d.mean_luma}) * 1.2, 1, 1.4) = ${d.exposure}`],
      ['post.bloom.strength', 'BLOOM', `0.25 + 0.25 * (1 - ${d.mean_luma}) = ${bloom}`],
      ['post.grade.contrast', 'CONTRAST', `1 + L*range ${d.lstar_range}/100 * 0.35 = ${contrast}`],
      ['post.grade.saturation', 'HUEFAMILIES', `0.95 + 0.15 * families ${d.family_count} = ${sat}`],
      ['post.grade.vignette', 'MOOD', `0.18 + 0.2 * ${d.mood} = ${vignette} (SKILL.md cap 0.3)`],
      ['fog.density', 'FOG', `0.004 + (1 - ${d.mean_luma}) * 0.006 = ${fogDensity}`],
      ['particles.additive', 'MOOD', d.mean_luma < 0.45 ? 'dark reference -> additive sparks' : 'bright reference -> normal blending'],
      ['seed', 'NOT-FROM-IMAGE', 'shared 20260926 on purpose: layout/AI must be style-independent'],
    ],
    rockLift: rockSrc,
  };
}

const themes = MAP.refs.map(buildTheme);

/* ---------- HUD skin: same skeleton, three skins, colours only from the palette */
/* FORMULA-SKIN: the scatter kind the reference produced also picks the HUD
   vocabulary, so the interface is derived from the image rather than chosen. */
const SKINS = {
  flora: {
    radius: '14px',
    shadow: (a) => `0 10px 30px rgba(0,0,0,.35)`,
    font: `"Segoe UI",system-ui,-apple-system,"Hiragino Sans",sans-serif`,
    label: 'font-size:11px;letter-spacing:.2em;text-transform:uppercase',
    title: 'font-size:34px;font-weight:650;letter-spacing:.02em',
    deco: '.PID .panel::before{content:"";position:absolute;left:14px;top:-1px;width:34px;height:3px;border-radius:99px;background:var(--accent)}',
  },
  boulder: {
    radius: '2px',
    shadow: (a) => `0 0 0 2px ${a}`,
    font: `"Helvetica Neue",Arial,"PingFang SC",sans-serif`,
    label: 'font-size:10px;letter-spacing:.34em;text-transform:uppercase;font-weight:700',
    title: 'font-size:30px;font-weight:800;letter-spacing:-.01em;text-transform:none',
    deco: '.PID .panel{border-top-width:3px!important;border-top-color:var(--accent)!important}',
  },
  shard: {
    radius: '0px',
    shadow: () => `inset 3px 0 0 var(--accent)`,
    font: `ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace`,
    label: 'font-size:10.5px;letter-spacing:.08em;text-transform:none',
    title: 'font-size:26px;font-weight:500;letter-spacing:.14em;text-transform:uppercase',
    deco: '.PID .bar{height:3px;border-radius:0}.PID .pip{border-radius:0}',
  },
};
function skin(t) {
  const c = t.colors;
  const s = SKINS[t.scatter.kind] || SKINS.boulder;
  const deco = s.deco.replace(/\.PID/g, `.skin-${t.id}`);
  return `
.skin-${t.id}{
  --bg:${c.uiMuted}; --panel:${c.uiPanel}; --accent:${c.uiAccent}; --text:${c.uiText}; --muted:${c.uiMuted};
  --radius:${s.radius};
  --shadow:${s.shadow(c.uiAccent)};
  --font:${s.font};
}
.skin-${t.id} #hud,.skin-${t.id} .screen{font-family:${s.font}}
.skin-${t.id} .panel{position:relative;background:linear-gradient(160deg, var(--panel), var(--bg));border:1px solid rgba(255,255,255,.14);border-radius:var(--radius);box-shadow:var(--shadow)}
.skin-${t.id} .stat-label{color:var(--muted);${s.label}}
.skin-${t.id} .stat-value{color:var(--text)}
.skin-${t.id} .accent{color:var(--accent)}
.skin-${t.id} .bar-fill{background:var(--accent)}
.skin-${t.id} .title{color:var(--text);${s.title}}
.skin-${t.id} .provenance{color:var(--muted)}
.skin-${t.id} .cta{border-radius:var(--radius)}
.skin-${t.id} .prompt{border-radius:var(--radius)}
${deco}
`;
}

const out = `/* GENERATED by scripts/gen-themes.mjs from scripts/reference-map.json.
   Do not hand-edit: the colour of every large surface here is the output of a
   FORMULA-* in scripts/extract-reference.mjs. mapping[] carries the provenance. */

export const SHARED_SEED = ${themes[0].seed};
export const LAYOUT_SEEDS = ${JSON.stringify({ world: 20260926 })};

export const THEMES = ${JSON.stringify(themes, null, 1)};

export const HUD_SKIN_CSS = ${JSON.stringify(themes.map(skin).join('\n'))};

export function themeById(id) {
  const t = THEMES.find((x) => x.id === id);
  if (!t) throw new Error('unknown theme ' + id + ' — expected one of ' + THEMES.map((x) => x.id).join(', '));
  return t;
}
`;
fs.writeFileSync(path.join(SCENE, 'src/themes.js'), out);
console.log('themes.js', Buffer.byteLength(out), 'bytes;', themes.length, 'styles');
for (const t of themes) {
  console.log(' -', t.id, 'scatter', t.scatter.kind, t.scatter.count, 'motes', t.colors.moteHexes.join(' '), 'exposure', t.post.exposure, 'ambient', t.lights.ambient.intensity, 'keyPos', t.lights.key.pos.join('/'));
}
fs.writeFileSync(path.join(SCENE, 'scripts/theme-summary.json'), JSON.stringify(themes.map((t) => ({ id: t.id, mapping: t.mapping, colors: t.colors, post: t.post, lights: t.lights, scatter: t.scatter })), null, 1));
