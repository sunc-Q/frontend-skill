/* Three visual styles. Same geometry, same HUD skeleton, same data —
   only palette / materials / lighting rig / biome scatter / particles /
   post preset / HUD skin differ. Positions are [x,y,z] arrays so this file
   stays pure data (no THREE import needed). */
import { hudHtml, HUD_BASE_CSS } from './hud.js';

function toon(THREE, color, steps) {
  const cv = document.createElement('canvas');
  cv.width = steps;
  cv.height = 1;
  const g = cv.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const v = Math.round((255 * (i + 1)) / steps);
    g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    g.fillRect(i, 0, 1, 1);
  }
  const grad = new THREE.CanvasTexture(cv);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  return new THREE.MeshToonMaterial({ color, gradientMap: grad });
}
const std = (THREE, o) => new THREE.MeshStandardMaterial(o);
const phy = (THREE, o) => new THREE.MeshPhysicalMaterial(o);
// hex is fine here: Material.setValues() calls Color.set() on the emissive slot
const em = (color, i) => ({ emissive: color, emissiveIntensity: i });
function mkAll(hide, hide2, eye, limb, shell, glow) {
  const one = { hide, hide2, eye, limb, shell, fin: shell, glow };
  return { runner: one, swift: one, brute: one, titan: one };
}

/* ============================================================== A. SUNLIT */
export const sunlitMoss = {
  id: 'sunlit-moss',
  seed: 1337,
  label: '日光苔原',
  titleText: '苔原哨站',
  subText: 'SUNLIT MOSS · TOWERLINE',
  ctaText: '点击开始布防',
  hintText: '日光苔原 · 低多边形 + 卡通描边',
  brand: 'sunlit-moss preset · build-game',
  sky: { top: 0x2f7bd0, bottom: 0xd7f0e2, sun: 0xfff4c8, sunSize: 0.05 },
  fog: { color: 0x9fc8d8, density: 0.0055 },
  lights: {
    key: { color: 0xfff2d6, intensity: 2.6, pos: [60, 92, 42] },
    fill: { color: 0xbfd4ff, intensity: 0.7, pos: [-52, 44, -32] },
    hemi: { sky: 0x9fd4ff, gnd: 0x4a7c3f, intensity: 0.5 },
    ambient: { color: 0x44506a, intensity: 0.55 },
    rim: { color: 0xfff0c0, intensity: 1.2, distance: 90, pos: [0, 18, -26] },
  },
  ground: { c1: [74, 124, 63], c2: [52, 100, 44], roughness: 0.88, metalness: 0.02, tint: 0x4a7c3f, plate: 0x5f8a4a, pad: 0x7fb069 },
  path: { color: 0x8b6f47, roughness: 0.95, metalness: 0.0, emissive: 0x000000, emissiveIntensity: 0 },
  scatter: {
    count: 260,
    geometry: (T) => new T.ConeGeometry(0.55, 2.1, 5),
    material: (T) => toon(T, 0x2d5a1e, 4),
  },
  particles: { colors: [0xffd93d, 0xff6b9d, 0x6bcb77, 0xffffff], additive: false, size: 1.2, gravity: -0.9, ambient: { rate: 0.7, speed: 0.4 } },
  ui: { accent: '#2f8f5b', ok: 0x22c55e, bad: 0xef4444 },
  post: {
    exposure: 1.32,
    bloom: { strength: 0.35, radius: 0.3, threshold: 0.9 },
    grade: { brightness: 0.02, contrast: 1.08, saturation: 1.22, vignette: 0.15 },
  },
  snd: { shoot: 640, hit: 340, kill: 250, build: 300, wave: 220, leak: 170 },
  materials(THREE) {
    const leaf = toon(THREE, 0x6fae5a, 4);
    const bark = std(THREE, { color: 0x8b6f47, roughness: 0.85 });
    const iron = std(THREE, { color: 0x77839a, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.2 });
    const sap = std(THREE, { color: 0xffd166, roughness: 0.4, ...em(0xffd166, 0.6) });
    const glass = phy(THREE, { color: 0xffffff, transmission: 0.7, thickness: 1.4, ior: 1.35, roughness: 0.12, metalness: 0, envMapIntensity: 1.4 });
    const mk = (a, b, c) => ({ stone: a, frame: b, barrel: c, core: sap, crystal: glass, glow: sap });
    return {
      tower: { ballista: mk(leaf, iron, bark), frost: mk(glass, iron, leaf), mortar: mk(bark, iron, leaf) },
      enemy: mkAll(
        toon(THREE, 0xe07a5f, 3), toon(THREE, 0x8a5a3b, 3), sap,
        toon(THREE, 0x6b4a32, 3), toon(THREE, 0xf2cc8f, 3), toon(THREE, 0x4f772d, 3)
      ),
      base: { stone: leaf, crystal: glass, glow: sap },
      projectile: { mesh: std(THREE, { color: 0xfff3b0, roughness: 0.3, ...em(0xffd166, 1.4) }) },
    };
  },
  cssVars: '--ink:#1e2a22; --gold:#8a5a12; --accent:#2f8f5b; --accent-soft:#cfe8d6;' +
    ' --glass:rgba(255,255,255,.62); --glass-line:rgba(31,61,42,.2); --radius:14px;' +
    ' --panel-shadow:0 8px 24px rgba(31,61,42,.16); --sel-glow:0 6px 18px rgba(47,143,91,.22);' +
    ' --feed-bg:rgba(255,255,255,.72); --toast-bg:rgba(255,255,255,.8); --chip-bg:rgba(255,255,255,.6);' +
    ' --screen-bg:rgba(215,240,226,.66); --dmg-tint:rgba(180,40,40,.5);' +
    ' --announce-shadow:0 4px 0 rgba(31,61,42,.25);',
  skinCss: '#gold-value{text-shadow:0 1px 0 rgba(255,255,255,.7)} .palette{font-weight:600}' +
    ' #announce-text{font-family:"Trebuchet MS",system-ui;text-transform:uppercase}',
};

/* ============================================================ B. OBSIDIAN */
export const obsidianLava = {
  id: 'obsidian-lava',
  seed: 4242,
  label: '曜岩熔脉',
  titleText: '熔脉哨站',
  subText: 'OBSIDIAN LAVA · TOWERLINE',
  ctaText: '点击开始布防',
  hintText: '曜岩熔脉 · 自发光熔缝 + 霓虹余烬',
  brand: 'obsidian-lava preset · build-game',
  sky: { top: 0x4a2338, bottom: 0xd1441f, sun: 0xff8a3a, sunSize: 0.09 },
  fog: { color: 0x8a3a22, density: 0.0085 },
  lights: {
    key: { color: 0xffb07a, intensity: 2.6, pos: [44, 66, -52] },
    fill: { color: 0x7fb8ff, intensity: 0.7, pos: [-40, 40, 44] },
    hemi: { sky: 0xff8a4a, gnd: 0x6a4034, intensity: 0.6 },
    ambient: { color: 0x6a5a86, intensity: 0.8 },
    rim: { color: 0xff4a12, intensity: 2.2, distance: 80, pos: [-10, 12, 20] },
  },
  ground: { c1: [140, 74, 56], c2: [96, 50, 40], roughness: 0.72, metalness: 0.18, tint: 0x8a4a34, plate: 0x96543a, pad: 0x6e4038 },
  path: { color: 0x6b3f2a, roughness: 0.5, metalness: 0.35, emissive: 0xff2e00, emissiveIntensity: 2.2 },
  scatter: {
    count: 170,
    geometry: (T) => new T.DodecahedronGeometry(0.85, 0),
    material: (T) => std(T, { color: 0x5a2a1e, roughness: 0.75, metalness: 0.2, ...em(0x330a00, 0.9) }),
  },
  particles: { colors: [0xff6b35, 0xffd166, 0xff2e00, 0xffa06b], additive: true, size: 1.35, gravity: 1.0, ambient: { rate: 1.6, speed: 0.5 } },
  ui: { accent: '#ff6b35', ok: 0x2fd06a, bad: 0xff2e5b },
  post: {
    exposure: 1.35,
    bloom: { strength: 0.5, radius: 0.45, threshold: 0.72 },
    grade: { brightness: 0.03, contrast: 1.08, saturation: 1.06, vignette: 0.28 },
  },
  snd: { shoot: 340, hit: 190, kill: 140, build: 170, wave: 120, leak: 90 },
  materials(THREE) {
    const rock = std(THREE, { color: 0x6b4a3a, roughness: 0.8, metalness: 0.15 });
    const steel = std(THREE, { color: 0x8a6f5a, roughness: 0.22, metalness: 1.0, envMapIntensity: 1.6 });
    const slab = std(THREE, { color: 0x6a5f7a, roughness: 0.45, metalness: 0.6 });
    const lava = std(THREE, { color: 0x6b3a1a, roughness: 0.5, ...em(0xff2200, 2.4) });
    const neon = std(THREE, { color: 0x4a3a5a, roughness: 0.3, ...em(0xffd700, 3.0) });
    const mk = (a, b, c) => ({ stone: a, frame: b, barrel: c, core: lava, crystal: neon, glow: lava });
    return {
      tower: { ballista: mk(rock, steel, slab), frost: mk(neon, steel, rock), mortar: mk(slab, steel, rock) },
      enemy: mkAll(
        std(THREE, { color: 0x7a3b2a, roughness: 0.6, ...em(0x4a1200, 1.0) }),
        std(THREE, { color: 0x9a5230, roughness: 0.55 }),
        std(THREE, { color: 0x4a3a2a, roughness: 0.4, ...em(0xffdd55, 3.0) }),
        std(THREE, { color: 0x6b4636, roughness: 0.7 }),
        std(THREE, { color: 0x8c5a3c, roughness: 0.5, metalness: 0.3 }),
        std(THREE, { color: 0x5a2a22, roughness: 0.4, ...em(0xff5522, 2.5) })
      ),
      base: { stone: rock, crystal: neon, glow: lava },
      projectile: { mesh: std(THREE, { color: 0xffa06b, roughness: 0.3, ...em(0xff6b35, 3.0) }) },
    };
  },
  cssVars: '--ink:#f6e9dd; --gold:#ffb703; --accent:#ff6b35; --accent-soft:rgba(255,107,53,.24);' +
    ' --glass:rgba(28,16,18,.5); --glass-line:rgba(255,107,53,.32); --radius:10px;' +
    ' --panel-shadow:0 10px 30px rgba(0,0,0,.45); --sel-glow:0 0 22px rgba(255,107,53,.35);' +
    ' --feed-bg:rgba(28,16,18,.6); --toast-bg:rgba(28,16,18,.7); --chip-bg:rgba(28,16,18,.55);' +
    ' --screen-bg:rgba(30,12,10,.62); --dmg-tint:rgba(255,60,20,.55);' +
    ' --announce-shadow:0 0 26px rgba(255,107,53,.8),0 3px 0 rgba(0,0,0,.6);',
  skinCss: '.hud-label{opacity:.8} #build-palette .palette:hover{transform:translateY(-2px) skewX(-1deg)}' +
    ' #announce-text{font-family:Impact,"Arial Black",system-ui;text-transform:uppercase;letter-spacing:.04em}',
};

/* ============================================================== C. ARCTIC */
export const arcticGlass = {
  id: 'arctic-glass',
  seed: 9091,
  label: '极冠晶塔',
  titleText: '极冠哨站',
  subText: 'ARCTIC GLASS · TOWERLINE',
  ctaText: '点击开始布防',
  hintText: '极冠晶塔 · 透射冰晶 + 金属镀铬',
  brand: 'arctic-glass preset · build-game',
  sky: { top: 0x4a7ab8, bottom: 0xc6dcef, sun: 0xffffff, sunSize: 0.04 },
  fog: { color: 0x6f8aa8, density: 0.0075 },
  lights: {
    key: { color: 0xf2f7ff, intensity: 2.2, pos: [-30, 88, 52] },
    fill: { color: 0xa8c8ff, intensity: 0.55, pos: [48, 36, -28] },
    hemi: { sky: 0xdfefff, gnd: 0x5f7898, intensity: 0.42 },
    ambient: { color: 0x4a5f92, intensity: 0.5 },
    rim: { color: 0x88ddff, intensity: 1.8, distance: 100, pos: [10, 16, 26] },
  },
  ground: { c1: [170, 186, 212], c2: [126, 142, 172], roughness: 0.55, metalness: 0.06, tint: 0x8098b4, plate: 0x7f94b4, pad: 0x4e6480 },
  path: { color: 0x2b5a86, roughness: 0.25, metalness: 0.2, emissive: 0x1e6fa8, emissiveIntensity: 0.7 },
  scatter: {
    count: 210,
    geometry: (T) => new T.OctahedronGeometry(1.0, 0),
    material: (T) => phy(T, { color: 0xbcd4ee, roughness: 0.14, metalness: 0.05, envMapIntensity: 1.4 }),
  },
  particles: { colors: [0xffffff, 0xdff0ff, 0xbfd9ff, 0xeaf4ff], additive: false, size: 1.05, gravity: -1.2, ambient: { rate: 3.0, speed: 0.3 } },
  ui: { accent: '#3a7bd5', ok: 0x2fbf8f, bad: 0xe0507a },
  post: {
    exposure: 1.06,
    bloom: { strength: 0.35, radius: 0.35, threshold: 0.85 },
    grade: { brightness: -0.02, contrast: 1.22, saturation: 1.08, vignette: 0.26 },
  },
  snd: { shoot: 880, hit: 520, kill: 420, build: 600, wave: 400, leak: 300 },
  materials(THREE) {
    const ice = phy(THREE, { color: 0xeaf4ff, roughness: 0.16, metalness: 0.02, transmission: 0.35, thickness: 1.2, ior: 1.31, envMapIntensity: 1.5 });
    const frost = std(THREE, { color: 0xd8e6f5, roughness: 0.5, metalness: 0.1 });
    const chrome = std(THREE, { color: 0x9ab4d0, roughness: 0.06, metalness: 1.0, envMapIntensity: 1.8 });
    const aurora = phy(THREE, { color: 0x9fe8ff, roughness: 0.1, metalness: 0.1, ...em(0x44ddff, 2.2), transmission: 0.5, thickness: 1.5, ior: 1.4 });
    const quartz = phy(THREE, { color: 0xffffff, transmission: 0.9, thickness: 1.6, ior: 1.45, roughness: 0.05, envMapIntensity: 1.6 });
    const mk = (a, b, c) => ({ stone: a, frame: b, barrel: c, core: aurora, crystal: quartz, glow: aurora });
    return {
      tower: { ballista: mk(frost, chrome, ice), frost: mk(quartz, chrome, frost), mortar: mk(ice, chrome, frost) },
      enemy: mkAll(
        phy(THREE, { color: 0xcfe4ff, roughness: 0.2, metalness: 0.05, transmission: 0.4, thickness: 1.0, ior: 1.3 }),
        std(THREE, { color: 0xa8c8ee, roughness: 0.4, metalness: 0.1 }),
        std(THREE, { color: 0x445577, roughness: 0.2, ...em(0x66eaff, 2.6) }),
        std(THREE, { color: 0x8fb0d8, roughness: 0.35, metalness: 0.2 }),
        phy(THREE, { color: 0xeaf4ff, roughness: 0.1, transmission: 0.6, thickness: 0.9, ior: 1.35 }),
        std(THREE, { color: 0xbfd9ff, roughness: 0.3, ...em(0x88ccff, 1.6) })
      ),
      base: { stone: frost, crystal: quartz, glow: aurora },
      projectile: { mesh: std(THREE, { color: 0xdff0ff, roughness: 0.2, ...em(0x88ddff, 2.0) }) },
    };
  },
  cssVars: '--ink:#16233a; --gold:#1c5fa8; --accent:#3a7bd5; --accent-soft:#d3e6fb;' +
    ' --glass:rgba(255,255,255,.5); --glass-line:rgba(22,35,58,.16); --radius:22px;' +
    ' --panel-shadow:0 12px 32px rgba(30,60,110,.18); --sel-glow:0 8px 24px rgba(58,123,213,.26);' +
    ' --feed-bg:rgba(255,255,255,.62); --toast-bg:rgba(255,255,255,.72); --chip-bg:rgba(255,255,255,.55);' +
    ' --screen-bg:rgba(226,240,252,.7); --dmg-tint:rgba(40,80,160,.45);' +
    ' --announce-shadow:0 2px 14px rgba(58,123,213,.5);',
  skinCss: '.hud-panel{border-radius:22px 8px 22px 8px} .palette{border-radius:18px 6px 18px 6px}' +
    ' #announce-text{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-style:italic;letter-spacing:.02em}',
};

export const BASE_CSS = HUD_BASE_CSS;
export const THEMES = [sunlitMoss, obsidianLava, arcticGlass];
