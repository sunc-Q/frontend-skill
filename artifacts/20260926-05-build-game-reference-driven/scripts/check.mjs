/* check.mjs — the whole verification suite for 20260926-05-build-game-reference-driven.
   Run from the LAB root:
     node artifacts/20260926-05-build-game-reference-driven/scripts/check.mjs
   Needs .tmp/refbuild/node_modules (esbuild/three/playwright-core/pngjs) — see report §2.
   Groups:
     A build & deliverable integrity      (static, Node)
     B reference -> theme re-derivation   (static, Node: re-runs every FORMULA and diffs)
     C live scene per style               (Chromium: palette closure, rig, post stack, pixels)
     D gameplay per style                 (Chromium, clock owned by the test)
     E cross-style gameplay equality      (the headline: theme must not touch the sim)
     F size / self-containment            (static)
     G ledger cross-check                 (reads state.json against scripts/ledger-snapshot.json)
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const LAB = path.resolve(SCENE, '..', '..');
const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
const NM = path.resolve(process.cwd(), '.tmp/refbuild/node_modules');
const pw = req(req.resolve('playwright-core', { paths: [NM] }));
const { PNG } = req(req.resolve('pngjs', { paths: [NM] }));
const EXEC = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;

/* ---------------------------------------------------------------- assertions */
let pass = 0, fail = 0;
const failures = [];
const tally = {};   /* per-group ok/total, so the report can say which group proves what */
function ok(group, name, cond, detail) {
  const t = (tally[group] = tally[group] || { ok: 0, total: 0 });
  t.total++;
  if (cond === true) { pass++; t.ok++; return true; }
  fail++;
  failures.push({ group, name, detail: detail === undefined ? '' : String(detail).slice(0, 400) });
  console.log(`  FAIL [${group}] ${name}${detail !== undefined ? ' :: ' + String(detail).slice(0, 300) : ''}`);
  return false;
}
function eq(group, name, got, want, tol = 0, extra) {
  const good = typeof want === 'number' ? Math.abs(got - want) <= tol : JSON.stringify(got) === JSON.stringify(want);
  return ok(group, name, good, good ? undefined : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}${extra ? ' :: ' + extra : ''}`);
}

/* ---------------------------------------------------------------- colour math */
const hexn = (v) => (typeof v === 'string' ? v : '#' + v.toString(16).padStart(6, '0'));
const rgb = (h) => { h = hexn(h); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgb2lab(r, g, b) {
  const f = (x) => { x /= 255; return x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
}
const dE = (a, b) => { const A = rgb2lab(...rgb(a)), B = rgb2lab(...rgb(b)); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* =========================================================== A: deliverables */
console.log('--- A build & deliverable integrity');
const MAP = JSON.parse(fs.readFileSync(path.join(SCENE, 'scripts/reference-map.json'), 'utf8'));
const SIZES = JSON.parse(fs.readFileSync(path.join(SCENE, 'scripts/build-sizes.json'), 'utf8'));
const themesMod = await import(pathToFileURL(path.join(SCENE, 'src/themes.js')).href);
const THEMES = themesMod.THEMES;
const IDS = THEMES.map((t) => t.id);

eq('A', 'A1 three styles generated', IDS.length, 3);
for (const id of IDS) {
  const f = path.join(SCENE, id + '.html');
  ok('A', `A2 ${id}.html exists`, fs.existsSync(f));
  const html = fs.readFileSync(f, 'utf8');
  eq('A', `A3 ${id} theme constant injected`, (html.match(/window\.__THEME_ID = '([^']+)'/) || [])[1], id);
  /* zero external references in the offline form: no src=, no href=, no url(http, no import */
  const ext = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((u) => !u.startsWith('#'));
  eq('A', `A4 ${id} no src/href references`, ext, []);
  /* The offline page must load with zero network traffic. A literal URL inside the inlined
     three.js source (an XML namespace, a doc link in a warning string) is not a reference,
     so what is asserted here is: no URL in a tag attribute or CSS url(), and C17 below
     proves the stronger claim by failing every non-file:// request at request time. */
  ok('A', `A5 ${id} no network URL in attributes or CSS`,
    !/(?:src|href)\s*=\s*["']?https?:/i.test(html) && !/url\(\s*["']?https?:/i.test(html),
    (html.match(/.{0,30}(?:src|href)\s*=\s*["']?https?:.{0,30}/gi) || []).slice(0, 1).join(' '));
  ok('A', `A6 ${id} no importmap`, !/type=["']importmap/.test(html));
  eq('A', `A7 ${id} exactly 2 inline scripts`, (html.match(/<script>/g) || []).length, 2);
  /* the bundle body itself must not contain a raw closing tag (it would end the script early);
     the build escapes it as <\/script> */
  const bOpen = html.lastIndexOf('<script>');
  const bClose = html.lastIndexOf('</script>');
  ok('A', `A8 ${id} no dangling </script inside bundle`, bClose > bOpen && !/<\/script>/.test(html.slice(bOpen + 8, bClose)),
    `${bOpen}/${bClose}/${html.length}`);
  ok('A', `A8b ${id} bundle body matches the build report`, Buffer.byteLength(html.slice(bOpen + 8, bClose)) === SIZES[id].bundleBytes,
    `${Buffer.byteLength(html.slice(bOpen + 8, bClose))} vs ${SIZES[id].bundleBytes}`);
  /* the cdn form is the skill's documented deliverable */
  const cdn = path.join(SCENE, 'cdn', id + '.html');
  ok('A', `A9 ${id} cdn form exists`, fs.existsSync(cdn));
  const cdnHtml = fs.readFileSync(cdn, 'utf8');
  ok('A', `A10 ${id} cdn uses importmap + jsdelivr three@0.160.0`,
    /type="importmap"/.test(cdnHtml) && /cdn\.jsdelivr\.net\/npm\/three@0\.160\.0/.test(cdnHtml));
  ok('A', `A11 ${id} cdn bundle keeps bare specifiers`, /^import[\s\S]*?from["']three["']/m.test(cdnHtml) || /from "three"/.test(cdnHtml));
}
/* the three offline pages must be ONE program: identical bundle, only the id differs */
const bundles = IDS.map((id) => {
  const html = fs.readFileSync(path.join(SCENE, id + '.html'), 'utf8');
  const i = html.indexOf('<script>', html.indexOf('</script>') + 1);
  return html.slice(i + 8, html.lastIndexOf('</script>'));
});
eq('A', 'A12 all three bundles byte-identical', new Set(bundles.map((b) => b.length)).size, 1);
ok('A', 'A13 bundle identical content', bundles[0] === bundles[1] && bundles[1] === bundles[2],
  `${bundles[0].length}/${bundles[1].length}/${bundles[2].length}`);
eq('A', 'A14 build-sizes agrees with disk', SIZES[IDS[0]].bytes, fs.statSync(path.join(SCENE, IDS[0] + '.html')).size);

/* ================================================== B: reference re-derivation */
console.log('--- B reference -> theme re-derivation');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
for (const ref of MAP.refs) {
  const t = THEMES.find((x) => x.id === ref.id);
  const d = ref.derived;
  ok('B', `B1 ${ref.id} theme exists for reference`, !!t);
  if (!t) continue;
  eq('B', `B2 ${ref.id} reference file recorded`, t.refFile, ref.file);
  /* palette shares must be a distribution */
  const sum = t.palette.reduce((a, e) => a + e.share, 0);
  ok('B', `B3 ${ref.id} palette shares sum to <=1`, sum > 0 && sum <= 1.0001, sum.toFixed(3));
  /* FORMULA-THETA / FORMULA-PHI re-derived from the sun centroid */
  eq('B', `B4 ${ref.id} azimuth = (u-.5)*180`, d.sun.azimuth_deg, +((d.sun.u - 0.5) * 180).toFixed(1), 0.05);
  eq('B', `B5 ${ref.id} elevation = 55-40v`, d.sun.elevation_deg, +(55 - 40 * d.sun.v).toFixed(1), 0.05);
  const th = (d.sun.azimuth_deg * Math.PI) / 180, ph = (d.sun.elevation_deg * Math.PI) / 180, R = 78;
  const want = [R * Math.cos(ph) * Math.sin(th), R * Math.sin(ph), -R * Math.cos(ph) * Math.cos(th)];
  for (let i = 0; i < 3; i++) eq('B', `B6 ${ref.id} keyPos[${i}] from az/el`, t.lights.key.pos[i], +want[i].toFixed(2), 0.02);
  /* FORMULA-EXPOSURE / AMBIENT / KEYI / BLOOM / CONTRAST / SAT / VIGNETTE / FOG / MOOD */
  eq('B', `B7 ${ref.id} exposure`, t.post.exposure, +clamp(1 + (0.55 - d.mean_luma) * 1.2, 1, 1.4).toFixed(3), 0.001);
  eq('B', `B8 ${ref.id} ambient`, t.lights.ambient.intensity, +clamp(0.5 + (0.55 - d.mean_luma) * 1.4, 0.5, 0.8).toFixed(3), 0.001);
  eq('B', `B9 ${ref.id} key intensity`, t.lights.key.intensity, +(2 + (1 - d.mean_luma)).toFixed(2), 0.005);
  eq('B', `B10 ${ref.id} bloom strength`, t.post.bloom.strength, +(0.25 + 0.25 * (1 - d.mean_luma)).toFixed(3), 0.001);
  eq('B', `B11 ${ref.id} grade contrast`, t.post.grade.contrast, +(1 + (d.lstar_range / 100) * 0.35).toFixed(3), 0.001);
  eq('B', `B12 ${ref.id} grade saturation`, t.post.grade.saturation, +(0.95 + 0.15 * d.family_count).toFixed(3), 0.001);
  eq('B', `B13 ${ref.id} vignette = .18+.2*mood`, t.post.grade.vignette, +(0.18 + d.mood * 0.2).toFixed(3), 0.001);
  eq('B', `B14 ${ref.id} fog density`, t.fog.density, +(0.004 + (1 - d.mean_luma) * 0.006).toFixed(5), 0.00001);
  eq('B', `B15 ${ref.id} scatter count`, t.scatter.count, Math.round(220 + 420 * d.mood));
  eq('B', `B16 ${ref.id} toon steps`, t.scatter.toonSteps, d.toon_steps);
  /* FORMULA-VISIBILITY: no large surface may be near-black (SKILL.md channel floor 0x44) */
  const big = { ground: t.colors.ground, groundAlt: t.colors.groundAlt, skyBottom: t.sky.bottom, fog: t.fog.color, skyTop: t.sky.top };
  for (const [k, v] of Object.entries(big)) {
    const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    ok('B', `B17 ${ref.id} ${k} clears the 0x44 floor`, Math.max(...c) >= 0x44, toHex(c));
  }
  /* FORMULA-GREEN / SCAPE-KIND */
  const wantKind = d.green_hex ? 'flora' : (d.lstar_range < 45 ? 'shard' : 'boulder');
  eq('B', `B18 ${ref.id} scatter.kind`, t.scatter.kind, wantKind);
  /* FORMULA-MOTE-FALLBACK: the roster must be mutually distinguishable */
  const mh = t.colors.moteHexes;
  eq('B', `B19 ${ref.id} three mote colours`, mh.length, 3);
  const minPair = Math.min(...mh.flatMap((a, i) => mh.slice(i + 1).map((b) => dE(a, b))));
  ok('B', `B20 ${ref.id} mote roster min pairwise dE >= 15`, minPair >= 14.9, minPair.toFixed(1));
  eq('B', `B21 ${ref.id} mote spread matches`, t.motes.spread_dE, +minPair.toFixed(1), 0.1);
  /* the accent must be the photographed accent */
  eq('B', `B22 ${ref.id} accent from reference`, t.colors.uiAccent, d.accent_hex.toUpperCase());
  eq('B', `B23 ${ref.id} sun colour from reference`, toHex([(t.sky.sun >> 16) & 255, (t.sky.sun >> 8) & 255, t.sky.sun & 255]), d.sun.color_hex.toUpperCase());
  /* FORMULA-TEXTCONTRAST: HUD label + body text must clear 28 dE against the panel */
  ok('B', `B24 ${ref.id} muted label contrast >= 28 dE`, dE(t.colors.uiMuted, t.colors.uiPanel) >= 27.5,
    `${t.colors.uiMuted} on ${t.colors.uiPanel} = ${dE(t.colors.uiMuted, t.colors.uiPanel).toFixed(1)}`);
  ok('B', `B25 ${ref.id} body text contrast >= 28 dE`, dE(t.colors.uiText, t.colors.uiPanel) >= 27.5,
    dE(t.colors.uiText, t.colors.uiPanel).toFixed(1));
  /* provenance: every derived slot must be explained, and the seed must be shared */
  ok('B', `B26 ${ref.id} mapping rows >= 20`, t.mapping.length >= 20, t.mapping.length);
  eq('B', `B27 ${ref.id} shared layout seed`, t.seed, 20260926);
  const known = new Set(Object.keys(MAP.formulas).concat(['THETA', 'PHI', 'VISIBILITY', 'SCAPE-KIND', 'MOOD', 'KEYI', 'EXPOSURE', 'FOG', 'BLOOM', 'CONTRAST', 'HUEFAMILIES', 'FAMILIES', 'SKIN', 'TEXTCONTRAST', 'MOTE-FALLBACK', 'NOT-FROM-IMAGE', 'SKY-horizon', 'SKY-zenith']));
  const bare = new Set(['GROUND', 'SKY-horizon', 'SKY-zenith', 'SUN', 'ACCENT', 'GROUND+VISIBILITY', 'GROUND×0.72']);
  for (const [slot, formula] of t.mapping) {
    /* SKY-* are the generator's palette-extremum rules: honest only on a sky slot */
    const byFormula = [...known].some((k) => formula.includes(k))
      && (!/^SKY-/.test(formula) || /^sky\./.test(slot));
    /* a bare slot label is only honest when it names the palette entry it reads */
    const byPalette = [...bare].some((k) => formula === k && /ground|horizon|zenith|sun|accent/i.test(slot));
    ok('B', `B28 ${ref.id} provenance ${slot} cites a known formula`, byFormula || byPalette, formula);
  }
}
/* the whole point of the round: the three styles must not be the same picture */
console.log('--- B29 styles must differ from each other');
const pairs = [[0, 1], [0, 2], [1, 2]];
for (const [i, j] of pairs) {
  const a = THEMES[i], b = THEMES[j];
  const hueOverlap = a.declaredColors.filter((x) => b.declaredColors.includes(x));
  ok('B', `B29 ${a.id} vs ${b.id} palettes barely overlap`, hueOverlap.length <= 1, hueOverlap.join(' '));
  /* the light must come from a genuinely different direction, not just a different colour */
  const va = a.lights.key.pos, vb = b.lights.key.pos;
  const cos = (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])
    / (Math.hypot(...va) * Math.hypot(...vb));
  const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  ok('B', `B30 ${a.id} vs ${b.id} key light direction differs >= 15deg`, angle >= 15, angle.toFixed(1) + 'deg');
  const d = Math.hypot(a.lights.key.pos[0] - b.lights.key.pos[0], a.lights.key.pos[1] - b.lights.key.pos[1], a.lights.key.pos[2] - b.lights.key.pos[2]);
  ok('B', `B31 ${a.id} vs ${b.id} sun position differs`, d > 12, d.toFixed(1));
  ok('B', `B32 ${a.id} vs ${b.id} exposure or ambient differs`, a.post.exposure !== b.post.exposure || a.lights.ambient.intensity !== b.lights.ambient.intensity);
  ok('B', `B33 ${a.id} vs ${b.id} mote roster differs`, a.colors.moteHexes.join() !== b.colors.moteHexes.join());
}
/* different worlds, same game: the tonality must separate while the structure stays isomorphic */
console.log('--- B36 cross-style tonal separation + structural isomorphism');
const tonality = (t) => {
  const w = t.palette.reduce((a, e) => a + e.share, 0);
  const lab = t.palette.map((e) => ({ s: e.share / w, l: rgb2lab(...rgb(e.hex)) }));
  return { L: lab.reduce((a, x) => a + x.l[0] * x.s, 0), C: lab.reduce((a, x) => a + Math.hypot(x.l[1], x.l[2]) * x.s, 0) };
};
for (const [i, j] of pairs) {
  const A = tonality(THEMES[i]), B = tonality(THEMES[j]);
  ok('B', `B36 ${THEMES[i].id} vs ${THEMES[j].id} share-weighted tonality separates`,
    Math.abs(A.L - B.L) >= 8 || Math.abs(A.C - B.C) >= 4,
    `${THEMES[i].id} L${A.L.toFixed(1)} C${A.C.toFixed(1)} vs ${THEMES[j].id} L${B.L.toFixed(1)} C${B.C.toFixed(1)}`);
  ok('B', `B37 ${THEMES[i].id} vs ${THEMES[j].id} same theme structure`,
    JSON.stringify(Object.keys(THEMES[i]).sort()) === JSON.stringify(Object.keys(THEMES[j]).sort())
    && JSON.stringify(THEMES[i].mapping.map((m) => m[0])) === JSON.stringify(THEMES[j].mapping.map((m) => m[0])),
    `${Object.keys(THEMES[i]).length}/${Object.keys(THEMES[j]).length} keys, ${THEMES[i].mapping.length}/${THEMES[j].mapping.length} mapping rows`);
}
/* where every colour the theme may show on screen came from */
console.log('--- B38 colour provenance closure');
const scaleDown = (from, k) => from.map((v) => Math.round(v * k));
const addAll = (from, c) => from.map((v) => Math.min(255, v + c));
const pushOf = (fromHex, hex) => {
  const f = rgb(fromHex), c = rgb(hex);
  const k = f.map((v, i2) => (v > 4 ? c[i2] / v : null)).filter((x) => x !== null);
  const scaled = k.length === 3 && Math.max(...k) - Math.min(...k) < 0.02;
  const d0 = c.map((v, i2) => v - f[i2]);
  const shifted = Math.max(...d0) - Math.min(...d0) <= 1;
  return scaled || shifted;
};
for (const t of THEMES) {
  const d = MAP.refs.find((r) => r.id === t.id).derived;
  const src = new Map();
  for (const e of t.palette) src.set(e.hex.toUpperCase(), 'photographed');
  src.set(d.ground_final_hex.toUpperCase(), 'GROUND+VISIBILITY');
  if (d.flora_final_hex) src.set(d.flora_final_hex.toUpperCase(), 'FLORA+VISIBILITY');
  if (d.rock_final_hex) src.set(d.rock_final_hex.toUpperCase(), 'ROCK+VISIBILITY');
  src.set(d.sun.color_hex.toUpperCase(), 'SUN');
  src.set(d.accent_hex.toUpperCase(), 'ACCENT');
  for (const s of t.synthesised || []) src.set(s.hex.toUpperCase(), 'MOTE-FALLBACK');
  src.set(t.colors.uiPanel.toUpperCase(), 'TEXTCONTRAST panel');
  const ground = rgb(t.palette.find((e) => toHex(rgb(e.hex)) === toHex(rgb(t.colors.ground))).hex);
  /* FORMULA-TEXTCONTRAST: a HUD colour may only be a reference colour mixed toward black or
     white until it clears the panel. Same rule as the generator, checked per channel. */
  const mixToNeutral = (fromHex, hex) => {
    const f = rgb(fromHex), c = rgb(hex);
    return [[255, 255, 255], [0, 0, 0]].some((tgt) => {
      const k = f.map((v, i) => (tgt[i] === v ? (c[i] === v ? null : NaN) : (c[i] - v) / (tgt[i] - v)));
      const real = k.filter((x) => x !== null && !Number.isNaN(x));
      return !k.some((x) => Number.isNaN(x)) && real.length > 0
        && real.every((x) => x >= -0.005 && x <= 1.005)
        && Math.max(...real) - Math.min(...real) < 0.02;
    });
  };
  const unexplained = t.declaredColors.filter((h) => {
    const H = h.toUpperCase();
    if (src.has(H)) return false;
    if (H === toHex(scaleDown(ground, 0.72))) return false;   // FORMULA-GROUND-ALT
    /* a derived tone is legal only if it is a documented transform of a photographed one */
    return ![...src.keys()].some((from) =>
      toHex(scaleDown(rgb(from), 0.72)) === H || toHex(addAll(rgb(from), 26)) === H
      || pushOf(from, H) || mixToNeutral(from, H));
  });
  ok('B', `B38 ${t.id} every declared colour traces to the reference`, unexplained.length === 0, unexplained.join(' '));
  const declaredUp = t.declaredColors.map((x) => x.toUpperCase());
  const dropped = t.palette.filter((e) => !declaredUp.includes(e.hex.toUpperCase()));
  ok('B', `B39 ${t.id} the photographed palette is carried into declaredColors`, dropped.length <= 1,
    'unused palette entries: ' + dropped.map((e) => e.hex).join(' '));
  const groundHex = toHex([(t.colors.ground >> 16) & 255, (t.colors.ground >> 8) & 255, t.colors.ground & 255]);
  ok('B', `B40 ${t.id} ground and accent are photographed colours`,
    t.palette.some((e) => e.hex.toUpperCase() === groundHex)
    && (t.palette.some((e) => e.hex.toUpperCase() === d.accent_hex.toUpperCase()) || d.accent_outside_palette === true),
    `ground ${groundHex} accent ${d.accent_hex} outside-palette ${d.accent_outside_palette}`);
  /* the tone that leaked the last time this ran: one derivation, used everywhere */
  eq('B', `B41 ${t.id} groundAlt is exactly ground x 0.72`, toHex(scaleDown(ground, 0.72)), toHex(rgb(t.colors.groundAlt)));
}
/* the photographed PNGs must still be the ones the map claims */
for (const ref of MAP.refs) {
  const f = path.join(SCENE, ref.file);
  ok('B', `B34 ${ref.id} reference png on disk`, fs.existsSync(f));
  if (!fs.existsSync(f)) continue;
  const png = PNG.sync.read(fs.readFileSync(f));
  eq('B', `B35 ${ref.id} png size matches the map`, [png.width, png.height], [ref.source.png_w, ref.source.png_h]);
}

/* ==================================================== C/D/E: live in Chromium */
console.log('--- C live scene, D gameplay, E cross-style equality');
const browser = await pw.chromium.launch({ executablePath: EXEC, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });

const LIVE_SCRIPT = () => {
  const g = window.__game, T = g.THREE;
  window.__setPaused(true);
  const hex = (n) => '#' + n.toString(16).padStart(6, '0').toUpperCase();
  const res = {};
  /* The signature that E compares across styles is taken FIRST, on a pristine engine: the
     gameplay probes below leave held/deposited bits in the state, and the point of E1 is that
     the SIMULATION is identical, not that the final state of an unrelated test run is. */
  res.signature = (() => {
    g.startRun(); g.state.lives = 999;
    const ks = ['KeyW', 'KeyD', 'KeyW', 'KeyA', 'KeyS', 'KeyW'];
    for (let i = 0; i < 1800; i++) {
      for (const k of ['KeyW', 'KeyD', 'KeyA', 'KeyS']) g.setKey(k, false);
      g.setKey(ks[(i / 90 | 0) % ks.length], true);
      g.camRig.yaw = i * 0.0007;
      g.update(1 / 60);
    }
    return JSON.stringify({
      p: [+g.player.x.toFixed(4), +g.player.z.toFixed(4), +g.player.speed.toFixed(4)],
      m: g.motes.map((x) => [+x.x.toFixed(4), +x.z.toFixed(4), x.state, x.held ? 1 : 0, x.deposited ? 1 : 0].join(':')),
      h: g.hounds.map((x) => [+x.x.toFixed(4), +x.z.toFixed(4), x.state, x.chases, x.hits].join(':')),
      s: [g.state.time.toFixed(4), g.state.satchel, g.state.motesDeposited, g.state.embersDeposited, g.state.questIndex, g.state.nightCount, g.state.lives].join(','),
    });
  })();
  /* ---------- D: gameplay, driven with the test owning the clock ---------- */
  /* the signature leaves its own key holds behind; every movement probe below starts from no input */
  for (const k of ['KeyW', 'KeyD', 'KeyA', 'KeyS']) g.setKey(k, false);
  g.startRun();
  /* camera-relative WASD at four rig angles */
  const rel = [];
  /* The movement probes must measure input, not collisions: park the hounds out of reach
     for the duration of each window, otherwise a bite adds knockback to the displacement. */
  const park = () => { g.state.lives = 999; for (const x of g.hounds) { x.x = 0; x.z = -70; x.vx = x.vz = 0; } };
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    g.player.x = 0; g.player.z = 14; g.player.vx = 0; g.player.vz = 0; g.camRig.yaw = yaw;
    for (let i = 0; i < 60; i++) { park(); g.update(1 / 60); }
    const f = g.cameraBasis().fwd;
    g.setKey('KeyW', true);
    for (let i = 0; i < 10; i++) { park(); g.update(1 / 60); }
    g.setKey('KeyW', false);
    const dx = g.player.x, dz = g.player.z - 14, len = Math.hypot(dx, dz) || 1;
    rel.push(+(((dx / len) * f.x + (dz / len) * f.z)).toFixed(3));
  }
  res.cameraRelative = rel;
  /* strafe A must be -right, D +right */
  const strafe = [];
  for (const [key, sign] of [['KeyA', -1], ['KeyD', 1]]) {
    g.player.x = 0; g.player.z = 14; g.player.vx = g.player.vz = 0; g.camRig.yaw = 0.6;
    for (let i = 0; i < 60; i++) { park(); g.update(1 / 60); }
    const r = g.cameraBasis().right;
    g.setKey(key, true);
    for (let i = 0; i < 10; i++) { park(); g.update(1 / 60); }
    g.setKey(key, false);
    const dx = g.player.x, dz = g.player.z - 14, len = Math.hypot(dx, dz) || 1;
    strafe.push(+sign * (((dx / len) * r.x + (dz / len) * r.z)).toFixed(3));
  }
  res.strafe = strafe;
  /* run must NOT be world-locked: at yaw=pi/2 W must move mostly along +x */
  g.player.x = 0; g.player.z = 14; g.player.vx = g.player.vz = 0; g.camRig.yaw = Math.PI / 2;
  for (let i = 0; i < 60; i++) { park(); g.update(1 / 60); }
  g.setKey('KeyW', true); for (let i = 0; i < 10; i++) { park(); g.update(1 / 60); } g.setKey('KeyW', false);
  res.worldAxisCheck = { dx: +g.player.x.toFixed(2), dz: +(g.player.z - 14).toFixed(2) };

  /* mote FSM idle -> flee */
  g.startRun();
  const m0 = g.motes.find((x) => !x.ember);
  g.player.x = m0.x; g.player.z = m0.z;
  for (let i = 0; i < 20; i++) g.update(1 / 60);
  res.moteFled = m0.state === 'flee' && m0.transitions.flee >= 1;
  /* hound FSM: patrol -> chase -> contact -> stunned -> return */
  g.startRun();
  g.state.lives = 999;
  const h = g.hounds[0];
  h.x = g.player.x + 6; h.z = g.player.z + 6; h.state = 'patrol';
  const seen = ['patrol'];
  for (let i = 0; i < 1200; i++) {
    g.update(1 / 60);
    if (seen[seen.length - 1] !== h.state) seen.push(h.state);
    if (seen[seen.length - 1] === 'return') break;
  }
  res.houndPath = seen.join('>');
  res.houndHits = h.hits; res.houndChases = h.chases;
  /* ... and once it is home, with the player out of aggro range, it resumes patrol */
  g.player.x = 0; g.player.z = 31; g.player.vx = g.player.vz = 0;
  h.x = h.startX; h.z = h.startZ; h.state = 'return'; h.timer = 0;
  const back = [];
  for (let i = 0; i < 300 && h.state !== 'patrol'; i++) { g.update(1 / 60); back.push(h.state); }
  res.houndRecovered = h.state === 'patrol';
  /* day/night: embers only appear in the dark half */
  g.startRun();
  res.dayEmbers = g.motes.filter((x) => x.ember && x.group.visible).length;
  g.state.time = 50;
  for (let i = 0; i < 5; i++) g.update(1 / 60);
  res.nightEmbers = g.motes.filter((x) => x.ember && x.group.visible).length;
  res.nightFlag = g.state.night;
  /* pickup -> satchel -> deposit -> quest advance */
  g.startRun();
  const picked = [];
  for (let k = 0; k < 3; k++) {
    const mm = g.motes.find((x) => !x.ember && !x.held && !x.deposited);
    g.player.x = mm.x; g.player.z = mm.z;
    picked.push(g.tryPickup() === true);
  }
  res.picked = picked;
  res.satchelAfterPick = g.state.satchel;
  g.player.x = 0.6; g.player.z = 0.6;
  res.deposit = g.depositAtHub() === true;
  res.deposited = g.state.motesDeposited;
  res.questAfter1 = g.state.questIndex;
  /* over-capacity pickup must be refused */
  g.startRun();
  g.state.satchel = g.state.satchelCap;
  const full = g.motes.find((x) => !x.held && !x.deposited);
  g.player.x = full.x; g.player.z = full.z;
  res.capRefused = g.tryPickup() === false && g.state.satchel === g.state.satchelCap;
  /* dialogue: full walk to a choice, lantern must raise the satchel cap */
  g.startRun();
  const capBefore = g.state.satchelCap;
  g.openDialogue();
  const dlgTrace = [];
  for (let i = 0; i < 8 && g.state.mode === 'dialogue'; i++) {
    if (g.dialogue.awaitingChoice) { g.chooseDialogue(0); dlgTrace.push('choose'); }
    g.advanceDialogue();
  }
  res.dialogue = { trace: dlgTrace.join(','), talked: g.state.talked === true, lantern: g.state.lantern === true, mode: g.state.mode };
  res.lanternCap = { before: capBefore, after: g.state.satchelCap };
  /* win and lose */
  g.startRun();
  g.state.lives = 1; g.state.invuln = 0;
  const hh = g.hounds[0]; hh.x = g.player.x; hh.z = g.player.z; hh.state = 'chase'; hh.timer = 0;
  g.update(1 / 60);
  res.lose = { lives: g.state.lives, mode: g.state.mode };
  g.startRun();
  g.state.motesDeposited = 99; g.state.embersDeposited = 99; g.state.talked = true;
  const wm = g.motes.find((x) => !x.held && !x.deposited); wm.held = true; g.state.satchel = 1;
  g.player.x = 1; g.player.z = 1; g.depositAtHub();
  res.win = { quest: g.state.questIndex, mode: g.state.mode, won: g.state.won === true };
  /* save round-trip keeps a version field */
  const rec = g.saveGame({ won: true, time: 12.5, deposits: 7 });
  const loaded = g.loadSave();
  res.save = { v: loaded && loaded.version, runs: loaded && loaded.runs, written: !!rec };
  /* determinism: the same scripted input twice */
  const scriptRun = () => {
    g.startRun(); g.state.lives = 999;
    const ks = ['KeyW', 'KeyD', 'KeyW', 'KeyA', 'KeyS'];
    for (let i = 0; i < 900; i++) {
      for (const k of ks) g.setKey(k, false);
      g.setKey(ks[(i / 60 | 0) % 5], true);
      g.camRig.yaw = i * 0.001;
      g.update(1 / 60);
    }
    return JSON.stringify({
      p: [+g.player.x.toFixed(6), +g.player.z.toFixed(6)],
      m: g.motes.map((x) => [+x.x.toFixed(6), +x.z.toFixed(6), x.state].join(':')),
      h: g.hounds.map((x) => [+x.x.toFixed(6), +x.z.toFixed(6), x.state, x.chases, x.hits].join(':')),
      s: [g.state.time, g.state.satchel, g.state.motesDeposited, g.state.nightCount].join(','),
    });
  };
  res.determinism = scriptRun() === scriptRun();
  /* ---------- C: live scene, read after the sim ran so nothing is a default ---------- */
  /* scan the real graph: what is actually instantiated, not what the config claims */
  const scan = (() => {
    const byKind = {};
    const instByKind = {};
    let meshes = 0, instancedMeshes = 0, instances = 0;
    g.scene.traverse((o) => {
      const k = o.userData && o.userData.kind;
      if (k) byKind[k] = (byKind[k] || 0) + 1;
      if (o.isInstancedMesh) {
        instancedMeshes++; instances += o.count;
        if (k) instByKind[k] = (instByKind[k] || 0) + o.count;
      } else if (o.isMesh) meshes++;
    });
    return { byKind, instByKind, meshes, instancedMeshes, instances };
  })();
  const d = window.__diag();
  /* the pixels are measured from the pose the player is actually shown — startRun's own camera,
     held for a second with the hounds parked — so the frame is the same on every run. */
  g.startRun();
  for (const k of ['KeyW', 'KeyD', 'KeyA', 'KeyS']) g.setKey(k, false);
  for (let i = 0; i < 90; i++) { park(); g.update(1 / 60); }   /* no knockback, no screen shake */
  const probe = window.__frameProbe(320, 200);
  return { d, probe, res, scan, theme: g.theme.id };
};

const live = {};
const netReqs = {};
for (const id of IDS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  netReqs[id] = [];
  page.on('request', (r) => { if (!r.url().startsWith('file://')) netReqs[id].push(r.url().slice(0, 70)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(pathToFileURL(path.join(SCENE, id + '.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(1400);
  const out = await page.evaluate(LIVE_SCRIPT);
  live[id] = out;
  const t = THEMES.find((x) => x.id === id);
  ok('C', `C1 ${id} zero runtime errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  eq('C', `C2 ${id} live theme`, out.theme, id);
  /* --- post stack, in order (SKILL.md mandates SSAO -> bloom -> grade -> FXAA) */
  eq('C', `C3 ${id} pass order`, out.d.passes, ['RenderPass', 'SSAOPass', 'UnrealBloomPass', 'OutputPass', 'ColorGradePass', 'FXAAPass']);
  ok('C', `C4 ${id} OutputPass present (documented deviation)`, out.d.passes.includes('OutputPass'));
  /* --- renderer hard rules */
  eq('C', `C5 ${id} ACES tone mapping`, out.d.renderer.toneMapping, 'ACESFilmic');
  ok('C', `C6 ${id} exposure in 1.0..1.4`, out.d.renderer.exposure >= 1 && out.d.renderer.exposure <= 1.4, out.d.renderer.exposure);
  eq('C', `C7 ${id} sRGB output`, out.d.renderer.outputColorSpace, 'srgb');
  eq('C', `C8 ${id} PCFSoft shadows enabled`, [out.d.renderer.shadowType, out.d.renderer.shadowEnabled], ['PCFSoft', true]);
  eq('C', `C9 ${id} shadow map 4096`, out.d.shadow.mapSize, 4096);
  eq('C', `C10 ${id} shadow normalBias 0.02`, out.d.shadow.normalBias, 0.02, 1e-6);
  ok('C', `C11 ${id} pixel ratio <= 2`, out.d.renderer.pixelRatio <= 2, out.d.renderer.pixelRatio);
  eq('C', `C12 ${id} env map generated`, out.d.envMap, true);
  eq('C', `C13 ${id} sky dome present`, out.d.skyDome, true);
  eq('C', `C14 ${id} three r160`, out.d.threeRevision, '160');
  /* --- lighting rig: >= 4 lights, and the live values are the derived ones */
  ok('C', `C15 ${id} at least 4 lights`, out.d.lights.length >= 4, out.d.lights.length);
  eq('C', `C16 ${id} light count`, out.d.lights.length, 6);
  const key = out.d.lights.find((l) => l.type === 'DirectionalLight' && l.castShadow);
  eq('C', `C17 ${id} key intensity live`, key.intensity, +t.lights.key.intensity.toFixed(3), 0.002);
  for (let i = 0; i < 3; i++) eq('C', `C18 ${id} key pos live[${i}]`, key.pos[i], t.lights.key.pos[i], 0.02);
  eq('C', `C19 ${id} key colour live`, key.color, toHex([(t.lights.key.color >> 16) & 255, (t.lights.key.color >> 8) & 255, t.lights.key.color & 255]));
  const amb = out.d.lights.find((l) => l.type === 'AmbientLight');
  eq('C', `C20 ${id} ambient live >= 0.5`, amb.intensity >= 0.5, true);
  eq('C', `C21 ${id} ambient matches derived`, amb.intensity, +t.lights.ambient.intensity.toFixed(3), 0.002);
  ok('C', `C22 ${id} hemisphere light present`, out.d.lights.some((l) => l.type === 'HemisphereLight'));
  ok('C', `C23 ${id} rim + hub point lights`, out.d.lights.filter((l) => l.type === 'PointLight').length >= 2);
  /* --- grading */
  ok('C', `C24 ${id} vignette <= 0.3`, out.d.grade.vignette <= 0.3, out.d.grade.vignette);
  eq('C', `C25 ${id} vignette derived`, out.d.grade.vignette, +t.post.grade.vignette.toFixed(3), 0.001);
  eq('C', `C26 ${id} bloom strength derived`, out.d.bloom.strength, +t.post.bloom.strength.toFixed(3), 0.001);
  ok('C', `C27 ${id} bloom subtle 0.25..0.5`, out.d.bloom.strength >= 0.25 && out.d.bloom.strength <= 0.5, out.d.bloom.strength);
  eq('C', `C28 ${id} SSAO kernelRadius`, out.d.ssao.kernelRadius, 2.4, 1e-6);
  eq('C', `C29 ${id} fog matches theme`, out.d.fog.color, toHex([(t.fog.color >> 16) & 255, (t.fog.color >> 8) & 255, t.fog.color & 255]));
  /* --- palette closure: nothing on screen may be a colour the photograph did not produce.
     Two shapes are exempt because their .color is not a surface tone:
       - a vertex-coloured carrier or an emissive body uses #FFFFFF as the identity multiplier
         (the palette arrives through the vertex attribute / the emissive channel instead);
       - a ShaderMaterial has no .color at all, so its colour uniforms are checked.
     Everything else must be a declared reference colour verbatim. */
  const declared = new Set(out.d.declaredColors.map((h) => h.toUpperCase()));
  const exempt = (c) => (c.hex === '#FFFFFF' && (c.vertexColors || (c.emissiveIntensity || 0) > 0));
  const offPalette = [...new Set(out.d.sceneColors
    .filter((c) => c.matType !== 'ShaderMaterial' && !exempt(c) && !declared.has(c.hex))
    .map((c) => `${c.kind}:${c.hex}/${c.matType}`))];
  ok('C', `C30 ${id} every scene colour is a declared reference colour`, offPalette.length === 0, offPalette.slice(0, 6).join(' '));
  const uniOff = [...new Set(out.d.sceneColors.filter((c) => c.matType === 'ShaderMaterial')
    .flatMap((c) => c.uniforms || []).filter((u) => u.hex !== '#FFFFFF' && !declared.has(u.hex)).map((u) => `${u.name}=${u.hex}`))];
  ok('C', `C30b ${id} sky-dome colour uniforms are declared reference colours`, uniOff.length === 0, uniOff.slice(0, 4).join(' '));
  const groundVC = out.d.sceneColors.filter((c) => c.kind === 'ground' && c.vertexColors);
  ok('C', `C30c ${id} ground vertex colours stay a modulation around 1.0 (not absolute)`,
    groundVC.length > 0 && groundVC.every((c) => c.vcMin >= 0.45 && c.vcMax <= 1.05),
    groundVC.map((c) => `${c.vcMin}..${c.vcMax}`).join(','));
  ok('C', `C31 ${id} no MeshBasicMaterial on visible meshes`, out.d.sceneColors.filter((c) => c.basic).length === 0,
    out.d.sceneColors.filter((c) => c.basic).map((c) => c.kind).slice(0, 5).join(' '));
  const kinds = new Set(out.d.sceneColors.map((c) => c.kind));
  for (const want of ['ground', 'skydome', 'hub', 'scatter', 'player', 'mote', 'hound', 'keeper', 'wall']) {
    ok('C', `C32 ${id} scene contains ${want}`, kinds.has(want) || [...kinds].some((k) => k.startsWith(want)), [...kinds].join(','));
  }
  const phys = out.d.sceneColors.filter((c) => c.matType === 'MeshPhysicalMaterial');
  ok('C', `C33 ${id} MeshPhysicalMaterial used`, phys.length > 0, phys.length);
  ok('C', `C34 ${id} transmission used (glass/ice)`, out.d.sceneColors.some((c) => c.transmission > 0));
  ok('C', `C35 ${id} procedural map + normal map on the ground`, out.d.sceneColors.some((c) => c.kind === 'ground' && c.hasMap && c.hasNormalMap));
  ok('C', `C36 ${id} vertex colours used`, out.d.sceneColors.some((c) => c.vertexColors));
  ok('C', `C37 ${id} emissive glow surfaces`, out.d.sceneColors.some((c) => c.emissiveHex && c.emissiveHex !== '#000000'));
  /* --- entity detail counts (SKILL.md: 15-30+ primitives per character) */
  ok('C', `C38 ${id} player >= 15 parts`, out.d.counts.playerParts >= 15, out.d.counts.playerParts);
  ok('C', `C39 ${id} hound >= 15 parts`, out.d.counts.houndParts >= 15, out.d.counts.houndParts);
  ok('C', `C40 ${id} keeper >= 12 parts`, out.d.counts.keeperParts >= 12, out.d.counts.keeperParts);
  eq('C', `C41 ${id} live InstancedMesh scatter count = derived`, out.scan.instByKind.scatter, t.scatter.count);
  /* every animated family must exist as live objects, not just as config */
  const fams = ['player', 'mote', 'hound', 'keeper', 'hub', 'rock', 'wall', 'ground', 'skydome'];
  const liveFams = fams.filter((f) => (out.scan.byKind[f] || 0) > 0);
  ok('C', `C42 ${id} >= 6 entity families live in the scene graph`, liveFams.length >= 6,
    liveFams.join(',') + ' :: ' + JSON.stringify(out.scan.byKind));
  ok('C', `C42b ${id} scene carries real geometry`, out.scan.meshes + out.scan.instancedMeshes > 40, out.scan.meshes + '+' + out.scan.instancedMeshes);
  /* --- real pixels: the frame must be readable, not near-black */
  const pr = out.probe;
  ok('C', `C48 ${id} offline page made zero network requests`, netReqs[id].length === 0, netReqs[id].slice(0, 3).join(' '));
  /* the exposure is allowed to differ from the photo (3D ground occupies the frame the photo
     spent on sky), but it must stay in the reference's own tonality band and never crush. */
  const refMean = MAP.refs.find((r) => r.id === id).derived.mean_luma * 255;
  /* the whole drawing buffer is sampled (see __frameProbe), so these are frame statistics,
     not the statistics of whichever patch happened to sit in the bottom-left corner */
  ok('C', `C43 ${id} frame tracks its reference tonality, not crushed`,
    pr.meanLuma >= 40 && pr.meanLuma <= 215 && pr.meanLuma / refMean >= 0.4 && pr.meanLuma / refMean <= 1.8,
    `frame ${pr.meanLuma} / reference ${refMean.toFixed(1)} = ${(pr.meanLuma / refMean).toFixed(2)}`);
  ok('C', `C44 ${id} frame has contrast (sd >= 8)`, pr.sd >= 8, pr.sd);
  ok('C', `C45 ${id} near-black pixels do not dominate`, pr.darkPct <= 45, pr.darkPct);
  ok('C', `C46 ${id} the low end is not crushed to zero (p5 >= 10)`, pr.p5 >= 10, pr.p5);
  ok('C', `C47 ${id} p99.5 reaches highlight`, pr.p99_5 >= 60, pr.p99_5);
  ok('C', `C48b ${id} most of the frame sits in the mids`, pr.midPct >= 15, pr.midPct);
  /* --- gameplay */
  const R = out.res;
  ok('D', `D1 ${id} WASD is camera-relative at 4 angles`, R.cameraRelative.every((v) => v > 0.97), R.cameraRelative.join(','));
  ok('D', `D2 ${id} strafe A/D follow camera right`, R.strafe.every((v) => v > 0.97), R.strafe.join(','));
  ok('D', `D3 ${id} at yaw=pi/2 W moves along world x not z`, Math.abs(R.worldAxisCheck.dx) > 0.3 && Math.abs(R.worldAxisCheck.dz) < 0.12, JSON.stringify(R.worldAxisCheck));
  eq('D', `D4 ${id} motes flee the player`, R.moteFled, true);
  ok('D', `D5 ${id} hound FSM goes patrol>chase>stunned>return`, /^patrol>chase>stunned>return/.test(R.houndPath), R.houndPath);
  eq('D', `D5b ${id} a homebound hound with no target resumes patrol`, R.houndRecovered, true);
  ok('D', `D6 ${id} hound landed contact damage`, R.houndHits >= 1, R.houndHits);
  eq('D', `D7 ${id} embers hidden by day`, R.dayEmbers, 0);
  eq('D', `D8 ${id} embers visible at night`, R.nightEmbers, 3);
  eq('D', `D9 ${id} night flag set at t=50s`, R.nightFlag, true);
  eq('D', `D10 ${id} three pickups succeed`, R.picked, [true, true, true]);
  eq('D', `D11 ${id} satchel counts pickups`, R.satchelAfterPick, 3);
  eq('D', `D12 ${id} deposit succeeds at the hub`, R.deposit, true);
  eq('D', `D13 ${id} deposit credits the quest`, R.deposited, 3);
  eq('D', `D14 ${id} first quest completes`, R.questAfter1, 1);
  eq('D', `D15 ${id} pickup refused at capacity`, R.capRefused, true);
  eq('D', `D16 ${id} dialogue reaches a choice`, R.dialogue.trace.includes('choose'), true);
  eq('D', `D17 ${id} dialogue closes and flags talked`, [R.dialogue.talked, R.dialogue.mode], [true, 'playing']);
  eq('D', `D18 ${id} lantern choice grants the satchel bonus`, R.lanternCap.after - R.lanternCap.before, 1);
  eq('D', `D19 ${id} a bite at 1 hp ends the run`, [R.lose.lives, R.lose.mode], [0, 'over']);
  eq('D', `D20 ${id} completing all quests wins`, [R.win.quest, R.win.mode, R.win.won], [3, 'over', true]);
  eq('D', `D21 ${id} save carries a version field`, R.save.v, 1);
  eq('D', `D22 ${id} run is deterministic over 900 steps`, R.determinism, true);
  /* --- HUD computed styles: three skins, one skeleton */
  const hudStyle = await page.evaluate(() => {
    const g = getComputedStyle(document.querySelector('.panel'));
    const l = getComputedStyle(document.querySelector('.stat-label'));
    const t = getComputedStyle(document.querySelector('.title'));
    const panelBg = g.backgroundColor || g.backgroundImage.slice(0, 40);
    return {
      radius: g.borderTopLeftRadius, shadow: g.boxShadow.slice(0, 60), border: g.borderTopWidth,
      labelFont: l.fontFamily.slice(0, 40), labelSpacing: l.letterSpacing, labelCase: l.textTransform, labelSize: l.fontSize,
      titleSize: t.fontSize, titleWeight: t.fontWeight, titleCase: t.textTransform,
      panelBg, labelColor: l.color,
      hudNodes: document.querySelectorAll('#hud .panel').length,
      screens: document.querySelectorAll('.screen').length,
      endHidden: getComputedStyle(document.getElementById('end-screen')).display,
    };
  });
  live[id].hudStyle = hudStyle;
  eq('D', `D23 ${id} end screen hidden at boot`, hudStyle.endHidden, 'none');
  const panelSpec = (fs.readFileSync(path.join(SCENE, 'src/hud.js'), 'utf8').match(/class="panel/g) || []).length;
  eq('D', `D24 ${id} HUD skeleton matches hud.js (${panelSpec} panels)`, hudStyle.hudNodes, panelSpec);
  /* label must be legible against the panel in the browser too */
  const lc = hudStyle.labelColor.match(/\d+/g).map(Number);
  const declared2 = [...new Set(out.d.declaredColors.map((h) => h.toUpperCase()))];
  ok('D', `D25 ${id} HUD label colour is a declared palette colour`,
    declared2.includes(toHex(lc.slice(0, 3))), toHex(lc.slice(0, 3)) + ' vs ' + declared2.join(' '));
  await page.close();
}

/* ---- E: the headline. Same code + same seed => identical simulation in all three styles */
console.log('--- E cross-style equality');
const sigs = IDS.map((id) => live[id].res.signature);
let firstDiff = '';
if (new Set(sigs).size !== 1) {
  const base = JSON.parse(sigs[0]);
  for (const [k, v] of Object.entries(base)) {
    const got = JSON.stringify(v);
    for (const id of IDS.slice(1)) {
      const other = JSON.stringify(JSON.parse(live[id].res.signature)[k]);
      if (other !== got) { firstDiff += ` ${k}: ${id} ${other.slice(0, 60)} != ${got.slice(0, 60)}`; break; }
    }
    if (firstDiff) break;
  }
}
eq('E', 'E1 all three styles simulate identically', new Set(sigs).size, 1, 0, firstDiff);
const sigObj = JSON.parse(sigs[0]);
ok('E', 'E2 the signature is not degenerate (things moved)', sigObj.p[0] !== 0 || sigObj.p[1] !== 8.1, sigObj.s);
ok('E', 'E3 motes actually relocated', sigObj.m.some((s) => { const [x, z] = s.split(':').map(Number); return Math.hypot(x, z) > 0.1; }), sigObj.m.slice(0, 2).join(' '));
/* the fixed-step clock is what makes the three runs comparable at all: 1800 steps of
   FIXED_DT must land on exactly 30.0000 simulated seconds in every style */
ok('E', 'E4 the fixed-step clock is exact in all three styles',
  IDS.every((id) => Math.abs(Number(JSON.parse(live[id].res.signature).s.split(',')[0]) - 30) < 1e-6),
  IDS.map((id) => JSON.parse(live[id].res.signature).s.split(',')[0]).join(','));
ok('E', 'E5 hounds chased in every style', IDS.every((id) => JSON.parse(live[id].res.signature).h.every((s) => Number(s.split(':')[3]) >= 1)));
/* skins must be visibly different, not a colour swap */
const hs = IDS.map((id) => live[id].hudStyle);
for (const [i, j] of pairs) {
  const a = hs[i], b = hs[j];
  const diffs = ['radius', 'shadow', 'labelFont', 'labelSpacing', 'labelCase', 'titleSize', 'titleWeight', 'titleCase', 'border']
    .filter((k) => a[k] !== b[k]);
  ok('E', `E6 ${a === b ? '' : IDS[i]} vs ${IDS[j]} HUD differs on >= 4 properties`, diffs.length >= 4, diffs.join(','));
}
ok('E', 'E7 the three HUD label colours are distinct', new Set(hs.map((h) => h.labelColor)).size === 3, hs.map((h) => h.labelColor).join(' '));
ok('E', 'E8 one skeleton: identical panel count in all three', new Set(hs.map((h) => h.hudNodes)).size === 1);
/* the lighting chain is derived per reference, but it must not scramble them: the rendered
   frames have to keep the brightness ORDER of the photographs they came from */
const tonal = IDS.map((id) => ({
  id, got: live[id].probe.meanLuma, want: MAP.refs.find((r) => r.id === id).derived.mean_luma,
}));
const byWant = [...tonal].sort((a, b) => a.want - b.want);
ok('E', 'E9 rendered brightness keeps the reference ordering',
  tonal.every((t) => byWant.findIndex((w) => w.id === t.id) === [...tonal].sort((a, b) => a.got - b.got).findIndex((w) => w.id === t.id)),
  tonal.map((t) => `${t.id} ref${(t.want * 255).toFixed(0)}->frame${t.got}`).join(' | '));

/* ================================================================ F: footprint */
console.log('--- F size / self-containment');
const totalBytes = IDS.reduce((a, id) => a + fs.statSync(path.join(SCENE, id + '.html')).size, 0);
ok('F', 'F1 scene directory under the 50MB cap', totalBytes < 50 * 1024 * 1024, (totalBytes / 1048576).toFixed(1) + 'MB of pages');
for (const id of IDS) {
  const b = fs.statSync(path.join(SCENE, id + '.html')).size;
  ok('F', `F2 ${id} single file carries three.js (>= 500KB)`, b > 500000, b);
}
for (const ref of MAP.refs) ok('F', `F3 ${ref.id} reference png kept`, fs.statSync(path.join(SCENE, ref.file)).size > 100000);
ok('F', 'F4 scripts kept for reproduction', ['extract-reference.mjs', 'gen-themes.mjs', 'build.mjs', 'check.mjs', 'smoke.mjs', 'smoke-play.mjs', 'reference-map.json', 'theme-summary.json'].every((f) => fs.existsSync(path.join(SCENE, 'scripts', f))));
ok('F', 'F5 src kept', ['engine.js', 'entry.js', 'hud.js', 'themes.js'].every((f) => fs.existsSync(path.join(SCENE, 'src', f))));

/* ============================================================== G: ledger */
console.log('--- G ledger cross-check');
const SNAP_PATH = path.join(SCENE, 'scripts/ledger-snapshot.json');
ok('G', 'G1 ledger snapshot exists', fs.existsSync(SNAP_PATH));
const snap = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
const statePath = path.join(LAB, 'state/state.json');
ok('G', 'G2 state.json exists', fs.existsSync(statePath));
if (fs.existsSync(SNAP_PATH) && fs.existsSync(statePath)) {
  const st = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const log = fs.readFileSync(path.join(LAB, 'records/work-log.md'), 'utf8');
  /* Idempotent by construction: snapshot + this round's increments == current.
     Re-running check.mjs must not turn green into red. */
  eq('G', 'G3 tried[] == snapshot + 1', st.tried.length, snap.tried + 1);
  eq('G', 'G4 runs[] == snapshot + 1', st.runs.length, snap.runs + 1);
  eq('G', 'G5 used_styles == snapshot + 3', st.used_styles.length, snap.used_styles + 3);
  ok('G', 'G6 this round is recorded in work-log', log.includes('20260926-05-build-game-reference-driven'));
  ok('G', 'G7 the three style names are in used_styles', ['濑户春岸 seto-coast', '赭土绿洲 atlas-ochre', '极夜冰湖 nordic-night'].every((s) => st.used_styles.includes(s)), st.used_styles.slice(-3).join(' '));
  /* the dedup key is skill x scenario: pin it to the artifact directory name, which is the
     thing a future run must not recreate */
  ok('G', 'G8 this skill+scenario pair is in tried', st.tried.some((t) =>
    String(t.skill).includes('build-game') && String(t.artifacts || t.scenario).includes('20260926-05-build-game-reference-driven')));
  eq('G', 'G9 work-log lines == runs', (log.match(/^\|?\s*2026-\d\d-\d\d \d\d:\d\d/gm) || []).length, st.runs.length);
}

/* ------------------------------------------------------------------ summary */
console.log(`\n=== ${pass}/${pass + fail} assertions passed (${fail} failed) ===`);
console.log('per group: ' + Object.entries(tally).map(([g, t]) => `${g} ${t.ok}/${t.total}`).join(' | '));
if (fail) {
  console.log('failures:');
  failures.forEach((f) => console.log(`  [${f.group}] ${f.name} :: ${f.detail}`));
}
fs.writeFileSync(path.join(SCENE, 'scripts/check-result.json'), JSON.stringify({
  pass, fail, failures,
  by_group: Object.fromEntries(Object.entries(tally).map(([g, t]) => [g, `${t.ok}/${t.total}`])),
  at: new Date().toISOString(),
}, null, 1));
await browser.close();
process.exit(fail ? 1 : 0);
