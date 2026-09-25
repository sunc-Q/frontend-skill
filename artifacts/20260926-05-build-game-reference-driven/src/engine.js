/* GLEAMHOLLOW 拾光谷 — third-person collection/exploration game.
   One engine, three styles: the theme object only carries colours / lights /
   post / scatter, never layout or numbers that touch gameplay (see seed note in
   themes.js and the F-group assertions in scripts/check.mjs).
   Section order follows build-game SKILL.md "Code Structure" 1..27. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ============================================================ 2. CONSTANTS */
export const CONSTANTS = {
  ARENA_R: 33,
  HUB_R: 3.6,
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.05,
  WALK_ACCEL: 34,
  RUN_ACCEL: 52,
  MAX_SPEED: 6.4,
  RUN_SPEED: 9.2,
  FRICTION: 9.0,
  PLAYER_R: 0.55,
  CAM_DIST: 9.2,
  CAM_PITCH: 0.42,
  CAM_LERP: 8.5,
  DAY_LEN: 45,
  NIGHT_LEN: 35,
  MOTE_COUNT: 12,
  MOTE_FLEE_R: 4.2,
  MOTE_GRAB_R: 1.25,
  MOTE_FLEE_SPEED: 3.1,
  MOTE_WANDER_R: 2.2,
  HOUND_COUNT: 3,
  HOUND_PATROL_SPEED: 1.9,
  HOUND_CHASE_SPEED: 4.4,
  AGGRO_DAY: 8.0,
  AGGRO_NIGHT: 10.5,
  HOUND_HIT_R: 1.35,
  HOUND_STUN: 2.5,
  INVULN: 2.0,
  START_LIVES: 3,
  SATCHEL_BASE: 4,
  SATCHEL_BONUS: 1,
  DEPOSIT_R: 3.0,
  TALK_R: 3.2,
  QUEST_MOTES: 3,
  QUEST_EMBERS: 2,
  EMBER_COUNT: 3,
  SAVE_KEY: 'gleamhollow_save_v1',
  SAVE_VERSION: 1,
  OBSTACLES: 14,
  MAX_PARTICLES: 700,
  /* graphics-quality.md prescribes kernelRadius 16 / min .005 / max .1; those are
     normalised-depth constants for a perspective rig at this scale and were already
     shown (round 03:00) to black out an ortho scene. Perspective here, but the same
     depth range would smear AO across the whole arena, so scaled to ~1-3 world units. */
  SSAO: { kernelRadius: 2.4, minDistance: 0.0004, maxDistance: 0.006 },
};

/* ========================================================= 3. DATA DEFINITIONS */
export const QUESTS = [
  { id: 'gather', title: '收拢流萤', desc: '在荒地里拾取 3 枚光萤，带回中央光柱交付。', need: CONSTANTS.QUEST_MOTES, kind: 'motes' },
  { id: 'ask', title: '问一问守塔人', desc: '靠近光柱旁的守塔人，按 E 听完她的话。', need: 1, kind: 'talk' },
  { id: 'dusk', title: '趁夜色拾烬', desc: '入夜后荒地上会浮出灰烬碎片，交付 2 枚。', need: CONSTANTS.QUEST_EMBERS, kind: 'embers' },
];

export const DIALOGUE = {
  start: {
    speaker: '守塔人·阿栌',
    text: '光柱快熄了。你囊里那些流萤，放下三枚就能再撑一阵。',
    next: 'ask',
  },
  ask: {
    speaker: '守塔人·阿栌',
    text: '入夜以后才有灰烬碎片浮出来。它们只在暗处亮，别嫌黑。',
    choices: [
      { id: 'lantern', text: '讨一盏提灯再走。', set: { lantern: true } },
      { id: 'brave', text: '不必，摸黑也认得路。', set: { lantern: false } },
    ],
    next: 'close',
  },
  close: {
    speaker: '守塔人·阿栌',
    text: '那就天黑见。碎片够两枚，光柱就能撑过这一夜。',
    line2: '她朝林子深处努了努嘴，把手里那盏灯往你怀里推了半寸。',
  },
};

export const MOTE_KINDS = ['wisp', 'shard', 'emberling'];

/* ============================================================= 4. GAME STATE */
function freshState() {
  return {
    mode: 'title',
    time: 0,
    lives: CONSTANTS.START_LIVES,
    satchel: 0,
    satchelCap: CONSTANTS.SATCHEL_BASE,
    motesCollected: 0,
    motesDeposited: 0,
    embersCollected: 0,
    embersDeposited: 0,
    questIndex: 0,
    questDone: [false, false, false],
    talked: false,
    lantern: false,
    night: false,
    nightCount: 0,
    lost: false,
    won: false,
    invuln: 0,
    hitFlash: 0,
    shake: 0,
    deposits: 0,
  };
}

/* ============================================================ 5. SAVE / LOAD */
function saveGame(state) {
  try {
    const raw = localStorage.getItem(CONSTANTS.SAVE_KEY);
    const prev = raw ? JSON.parse(raw) : {};
    const rec = {
      version: CONSTANTS.SAVE_VERSION,
      runs: (prev.runs || 0) + 1,
      wins: (prev.wins || 0) + (state.won ? 1 : 0),
      bestTime: state.won
        ? (prev.bestTime == null ? +state.time.toFixed(2) : Math.min(prev.bestTime, +state.time.toFixed(2)))
        : (prev.bestTime == null ? null : prev.bestTime),
      bestDeposits: Math.max(prev.bestDeposits || 0, state.deposits),
      lastLantern: !!state.lantern,
    };
    localStorage.setItem(CONSTANTS.SAVE_KEY, JSON.stringify(rec));
    return rec;
  } catch (e) { return { error: String(e && e.message) }; }
}
export function loadSave() {
  try {
    const raw = localStorage.getItem(CONSTANTS.SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.version === CONSTANTS.SAVE_VERSION ? p : null;
  } catch (e) { return null; }
}

/* ================================================================ helpers */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const xzDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ================================================= 21. PROCEDURAL AUDIO */
function createAudio(theme) {
  let ctx = null;
  const freqs = {
    grab: 720, deposit: 420, hurt: 150, night: 240, dawn: 520,
    win: 660, lose: 110, talk: 300, step: 90, ui: 480,
  };
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function blip(freq, dur, type, gain, slideTo) {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), c.currentTime + dur);
    f.type = 'lowpass';
    f.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(gain == null ? 0.05 : gain, c.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(f); f.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  }
  const sfx = {
    grab: () => blip(freqs.grab, 0.16, 'triangle', 0.05, freqs.grab * 1.6),
    deposit: () => blip(freqs.deposit, 0.3, 'sine', 0.06, freqs.deposit * 2),
    hurt: () => blip(freqs.hurt, 0.28, 'sawtooth', 0.07, 60),
    night: () => blip(freqs.night, 0.7, 'sine', 0.04, 150),
    dawn: () => blip(freqs.dawn, 0.6, 'sine', 0.04, 780),
    win: () => { blip(freqs.win, 0.4, 'triangle', 0.06, 990); setTimeout(() => blip(880, 0.5, 'sine', 0.05, 1320), 180); },
    lose: () => blip(freqs.lose, 0.8, 'sawtooth', 0.06, 48),
    talk: () => blip(freqs.talk, 0.09, 'square', 0.028),
    ui: () => blip(freqs.ui, 0.07, 'sine', 0.03),
  };
  return { sfx, ensure, get ctx() { return ctx; } };
}

/* ============================================================= main entry */
export function createGame(theme, domTarget) {
  const T = THREE;
  const state = freshState();
  const rng = mulberry32(theme.seed);
  const audio = createAudio(theme);

  /* ------------------------------------------------------ 6. SCENE SETUP */
  const scene = new T.Scene();
  scene.background = new T.Color(theme.sky.bottom);
  scene.fog = new T.FogExp2(theme.fog.color, theme.fog.density);

  const camera = new T.PerspectiveCamera(58, Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight), 0.1, 900);
  camera.position.set(0, 7, 14);

  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = theme.post.exposure;
  renderer.outputColorSpace = T.SRGBColorSpace;
  (domTarget || document.body).appendChild(renderer.domElement);

  /* lighting rig: key / fill / hemi / ambient / rim = 5 lights */
  const keyLight = new T.DirectionalLight(theme.lights.key.color, theme.lights.key.intensity);
  keyLight.position.fromArray(theme.lights.key.pos);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(4096, 4096);
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.bias = -0.0005;
  const sc = keyLight.shadow.camera;
  sc.left = -44; sc.right = 44; sc.top = 44; sc.bottom = -44; sc.near = 1; sc.far = 220;
  sc.updateProjectionMatrix();
  scene.add(keyLight);
  const fillLight = new T.DirectionalLight(theme.lights.fill.color, theme.lights.fill.intensity);
  fillLight.position.fromArray(theme.lights.fill.pos);
  scene.add(fillLight);
  const hemiLight = new T.HemisphereLight(theme.lights.hemi.sky, theme.lights.hemi.gnd, theme.lights.hemi.intensity);
  scene.add(hemiLight);
  const ambientLight = new T.AmbientLight(theme.lights.ambient.color, theme.lights.ambient.intensity);
  scene.add(ambientLight);
  const rimLight = new T.PointLight(theme.lights.rim.color, theme.lights.rim.intensity, theme.lights.rim.distance, 2);
  rimLight.position.fromArray(theme.lights.rim.pos);
  scene.add(rimLight);
  const hubLight = new T.PointLight(theme.colors.accent, 2.2, 26, 2);
  hubLight.position.set(0, 4.2, 0);
  scene.add(hubLight);

  const LIGHT_BASE = {
    key: keyLight.intensity, fill: fillLight.intensity, hemi: hemiLight.intensity,
    ambient: ambientLight.intensity, rim: rimLight.intensity, bg: theme.sky.bottom, fog: theme.fog.color,
  };

  /* ------------------------------------------------- sky dome + env map */
  function createSkyDome(topColor, bottomColor, sunColor, sunDir, sunSize) {
    const mat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new T.Color(topColor) },
        bottomColor: { value: new T.Color(bottomColor) },
        sunColor: { value: new T.Color(sunColor) },
        sunDir: { value: sunDir.clone().normalize() },
        sunSize: { value: sunSize },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topColor, bottomColor, sunColor, sunDir; uniform float sunSize; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottomColor, topColor, pow(h, 0.72));
          float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * pow(sd, 1.0 / max(sunSize, 0.001)) * 1.25;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    return new T.Mesh(new T.SphereGeometry(600, 32, 24), mat);
  }
  const sunDir = new T.Vector3().fromArray(theme.lights.key.pos).normalize();
  const skyDome = createSkyDome(theme.sky.top, theme.sky.bottom, theme.sky.sun, sunDir, theme.sky.sunSize);
  skyDome.userData.kind = 'skydome';
  scene.add(skyDome);

  const pmrem = new T.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new T.Scene();
  envScene.add(createSkyDome(theme.sky.top, theme.sky.bottom, theme.sky.sun, sunDir, theme.sky.sunSize));
  const envMap = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envMap;
  pmrem.dispose();

  /* ------------------------------------------------- 7. POST-PROCESSING */
  const composer = new EffectComposer(renderer);
  composer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
  const addPass = (pass, label) => { pass.label = label; composer.addPass(pass); return pass; };
  addPass(new RenderPass(scene, camera), 'RenderPass');
  const ssaoPass = addPass(new SSAOPass(scene, camera, Math.max(1, window.innerWidth), Math.max(1, window.innerHeight)), 'SSAOPass');
  ssaoPass.kernelRadius = CONSTANTS.SSAO.kernelRadius;
  ssaoPass.minDistance = CONSTANTS.SSAO.minDistance;
  ssaoPass.maxDistance = CONSTANTS.SSAO.maxDistance;
  const bloomPass = addPass(new UnrealBloomPass(
    new T.Vector2(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight)),
    theme.post.bloom.strength, theme.post.bloom.radius, theme.post.bloom.threshold
  ), 'UnrealBloomPass');
  /* Deviation from graphics-quality.md: that recipe omits OutputPass, and without it
     the composer's linear buffer ships to a linear framebuffer and the frame reads
     3-6x too dark (measured in round 03:00). Kept after bloom, before grading. */
  addPass(new OutputPass(), 'OutputPass');
  const gradePass = addPass(new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      brightness: { value: theme.post.grade.brightness },
      contrast: { value: theme.post.grade.contrast },
      saturation: { value: theme.post.grade.saturation },
      vignetteIntensity: { value: theme.post.grade.vignette },
      nightMix: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float brightness, contrast, saturation, vignetteIntensity, nightMix;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        c.rgb += brightness;
        c.rgb = (c.rgb - 0.5) * contrast + 0.5;
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation);
        c.rgb = mix(c.rgb, c.rgb * vec3(0.66, 0.76, 1.05), nightMix * 0.75);
        vec2 p = vUv - 0.5;
        float v = 1.0 - pow(clamp(length(p) * 1.42, 0.0, 1.0), 2.0) * vignetteIntensity;
        gl_FragColor = vec4(c.rgb * clamp(v, 0.0, 1.0), c.a);
      }`,
  }), 'ColorGradePass');
  const fxaaPass = addPass(new ShaderPass(FXAAShader), 'FXAAPass');
  const sizeFxaa = () => fxaaPass.material.uniforms.resolution.value.set(
    1 / (Math.max(1, window.innerWidth) * renderer.getPixelRatio()),
    1 / (Math.max(1, window.innerHeight) * renderer.getPixelRatio())
  );
  sizeFxaa();

  /* ------------------------------------------------ 8. ASSET FACTORIES */
  function toon(color, steps) {
    const cv = document.createElement('canvas');
    cv.width = steps; cv.height = 1;
    const g = cv.getContext('2d');
    for (let i = 0; i < steps; i++) {
      const v = Math.round((255 * (i + 1)) / steps);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(i, 0, 1, 1);
    }
    const tex = new T.CanvasTexture(cv);
    tex.minFilter = tex.magFilter = T.NearestFilter;
    tex.generateMipmaps = false;
    return new T.MeshToonMaterial({ color, gradientMap: tex });
  }
  const std = (o) => new T.MeshStandardMaterial(o);
  const phy = (o) => new T.MeshPhysicalMaterial(o);

  const MATS = {
    cloth: toon(theme.colors.ground, theme.scatter.toonSteps),
    cloak: std({ color: theme.colors.groundAlt, roughness: 0.78, metalness: 0.04 }),
    skin: std({ color: theme.colors.sun, roughness: 0.65 }),
    metal: std({ color: theme.colors.rock, roughness: 0.32, metalness: 0.92, envMapIntensity: 1.35 }),
    wood: std({ color: theme.colors.groundAlt, roughness: 0.85, metalness: 0.02 }),
    stone: toon(theme.colors.rock, theme.scatter.toonSteps),
    flora: toon(theme.colors.flora == null ? theme.colors.rock : theme.colors.flora, theme.scatter.toonSteps),
    crystal: phy({
      color: theme.colors.motes[0], roughness: 0.12, metalness: 0, transmission: 0.55,
      thickness: 1.1, ior: 1.42, envMapIntensity: 1.5,
    }),
    glow: std({ color: theme.colors.accent, roughness: 0.35, emissive: theme.colors.accent, emissiveIntensity: 2.4 }),
    moteA: std({ color: theme.colors.motes[0], roughness: 0.3, emissive: theme.colors.motes[0], emissiveIntensity: 2.2 }),
    moteB: std({ color: theme.colors.motes[1], roughness: 0.3, emissive: theme.colors.motes[1], emissiveIntensity: 2.2 }),
    moteC: std({ color: theme.colors.motes[2], roughness: 0.3, emissive: theme.colors.motes[2], emissiveIntensity: 2.2 }),
    ember: std({ color: theme.colors.accent, roughness: 0.28, emissive: theme.colors.accent, emissiveIntensity: 3.0 }),
    houndHide: toon(theme.colors.hound, theme.scatter.toonSteps),
    houndEye: std({ color: 0xffffff, roughness: 0.2, emissive: theme.colors.accent, emissiveIntensity: 3.2 }),
    ground: std({ color: theme.colors.ground, roughness: theme.ground.roughness, metalness: theme.ground.metalness }),
  };
  const MOTE_MATS = [MATS.moteA, MATS.moteB, MATS.moteC];

  function part(geo, mat, x, y, z, rx, ry, rz, s) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    if (s) m.scale.setScalar(s);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  const countParts = (root) => { let n = 0; root.traverse((o) => { if (o !== root && o.isMesh) n++; }); return n; };

  /* The gatherer: cloak, hood, satchel, staff lantern — 22 primitives */
  function createGatherer() {
    const g = new T.Group();
    g.add(part(new T.CapsuleGeometry(0.34, 0.72, 6, 12), MATS.cloth, 0, 1.02, 0));
    g.add(part(new T.CylinderGeometry(0.46, 0.62, 0.86, 12, 1, true), MATS.cloak, 0, 0.92, -0.02));
    g.add(part(new T.SphereGeometry(0.27, 16, 12), MATS.skin, 0, 1.66, 0.02));
    g.add(part(new T.SphereGeometry(0.33, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), MATS.cloak, 0, 1.7, -0.02));
    g.add(part(new T.BoxGeometry(0.3, 0.09, 0.2), MATS.wood, 0, 1.6, 0.22));
    g.add(part(new T.CapsuleGeometry(0.09, 0.38, 4, 8), MATS.cloth, -0.36, 1.06, 0.04, 0, 0, 0.22));
    g.add(part(new T.CapsuleGeometry(0.09, 0.38, 4, 8), MATS.cloth, 0.36, 1.06, 0.04, 0, 0, -0.22));
    g.add(part(new T.SphereGeometry(0.11, 10, 8), MATS.skin, -0.4, 0.8, 0.08));
    g.add(part(new T.SphereGeometry(0.11, 10, 8), MATS.skin, 0.4, 0.8, 0.08));
    g.add(part(new T.CapsuleGeometry(0.12, 0.4, 4, 8), MATS.cloak, -0.15, 0.36, 0));
    g.add(part(new T.CapsuleGeometry(0.12, 0.4, 4, 8), MATS.cloak, 0.15, 0.36, 0));
    g.add(part(new T.BoxGeometry(0.17, 0.08, 0.29), MATS.metal, -0.15, 0.1, 0.04));
    g.add(part(new T.BoxGeometry(0.17, 0.08, 0.29), MATS.metal, 0.15, 0.1, 0.04));
    g.add(part(new T.SphereGeometry(0.24, 12, 10), MATS.wood, 0.42, 0.92, -0.28));
    g.add(part(new T.TorusGeometry(0.2, 0.035, 6, 14), MATS.metal, 0.42, 1.14, -0.28, Math.PI / 2));
    g.add(part(new T.CylinderGeometry(0.035, 0.035, 1.5, 8), MATS.wood, -0.46, 1.16, 0.12, 0.1));
    const lantern = part(new T.OctahedronGeometry(0.17, 0), MATS.glow, -0.5, 1.9, 0.2);
    lantern.userData.kind = 'lantern';
    g.add(lantern);
    g.add(part(new T.BoxGeometry(0.34, 0.05, 0.34), MATS.metal, 0, 1.36, -0.3));
    g.add(part(new T.ConeGeometry(0.1, 0.26, 8), MATS.metal, 0, 1.98, -0.06));
    g.add(part(new T.SphereGeometry(0.07, 8, 6), MATS.glow, 0, 1.72, 0.24, 0, 0, 0, 1));
    g.add(part(new T.TorusGeometry(0.3, 0.03, 6, 16), MATS.metal, 0, 0.06, 0, Math.PI / 2));
    g.add(part(new T.BoxGeometry(0.5, 0.05, 0.36), MATS.cloak, 0, 0.72, -0.36, -0.22));
    g.userData.kind = 'player';
    return g;
  }

  /* A glow-mote: faceted core + three shells + ring + two wings = 8 meshes */
  function createMote(ci) {
    const g = new T.Group();
    const mat = MOTE_MATS[ci % MOTE_MATS.length];
    g.add(part(new T.OctahedronGeometry(0.2, 0), mat, 0, 0, 0));
    g.add(part(new T.IcosahedronGeometry(0.31, 0), MATS.crystal, 0, 0, 0));
    g.add(part(new T.TorusGeometry(0.4, 0.025, 5, 16), mat, 0, 0, 0, Math.PI / 2));
    g.add(part(new T.TorusGeometry(0.34, 0.02, 5, 16), mat, 0, 0, 0, 0, Math.PI / 3));
    g.add(part(new T.SphereGeometry(0.07, 8, 6), mat, 0.3, 0.1, 0));
    g.add(part(new T.SphereGeometry(0.06, 8, 6), mat, -0.26, -0.12, 0.14));
    g.add(part(new T.ConeGeometry(0.08, 0.24, 5), mat, 0, 0.3, 0));
    g.add(part(new T.ConeGeometry(0.08, 0.24, 5), mat, 0, -0.3, 0, Math.PI));
    g.userData.kind = 'mote';
    return g;
  }

  /* A dusk-hound: skull, jaw, ribs, four legs, tail, spine ridge = 17 meshes */
  function createHound() {
    const g = new T.Group();
    g.add(part(new T.CapsuleGeometry(0.3, 0.85, 5, 10), MATS.houndHide, 0, 0.78, 0, 0, 0, Math.PI / 2));
    g.add(part(new T.BoxGeometry(0.62, 0.36, 0.9), MATS.houndHide, 0, 0.98, 0));
    g.add(part(new T.BoxGeometry(0.34, 0.3, 0.42), MATS.houndHide, 0, 1.02, 0.72));
    g.add(part(new T.BoxGeometry(0.22, 0.13, 0.2), MATS.houndHide, 0, 0.87, 0.94));
    g.add(part(new T.SphereGeometry(0.06, 8, 6), MATS.houndEye, 0.1, 1.06, 0.93));
    g.add(part(new T.SphereGeometry(0.06, 8, 6), MATS.houndEye, -0.1, 1.06, 0.93));
    g.add(part(new T.ConeGeometry(0.11, 0.28, 5), MATS.houndHide, 0.16, 1.28, 0.6));
    g.add(part(new T.ConeGeometry(0.11, 0.28, 5), MATS.houndHide, -0.16, 1.28, 0.6));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(part(new T.CapsuleGeometry(0.1, 0.5, 4, 8), MATS.houndHide, sx * 0.26, 0.33, sz * 0.42));
      g.add(part(new T.BoxGeometry(0.17, 0.07, 0.24), MATS.metal, sx * 0.26, 0.06, sz * 0.42 + 0.03));
    }
    g.add(part(new T.CylinderGeometry(0.07, 0.02, 0.62, 6), MATS.houndHide, 0, 1.0, -0.78, 1.15));
    g.add(part(new T.SphereGeometry(0.09, 8, 6), MATS.glow, 0, 1.05, -1.05));
    for (let i = 0; i < 3; i++) {
      g.add(part(new T.ConeGeometry(0.07, 0.2, 4), MATS.metal, 0, 1.22 + i * 0.01, 0.36 - i * 0.42));
    }
    g.userData.kind = 'hound';
    return g;
  }

  /* The keeper NPC: robe, head, shawl, hands, held lamp = 15 meshes */
  function createKeeper() {
    const g = new T.Group();
    g.add(part(new T.ConeGeometry(0.56, 1.6, 12), MATS.cloak, 0, 0.8, 0));
    g.add(part(new T.CylinderGeometry(0.3, 0.42, 0.5, 12), MATS.cloth, 0, 1.5, 0));
    g.add(part(new T.SphereGeometry(0.22, 14, 10), MATS.skin, 0, 1.86, 0.01));
    g.add(part(new T.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), MATS.cloak, 0, 1.9, -0.02));
    g.add(part(new T.BoxGeometry(0.52, 0.1, 0.24), MATS.metal, 0, 1.34, 0.16));
    g.add(part(new T.CapsuleGeometry(0.075, 0.34, 4, 8), MATS.cloth, -0.3, 1.32, 0.06, 0, 0, 0.3));
    g.add(part(new T.CapsuleGeometry(0.075, 0.34, 4, 8), MATS.cloth, 0.3, 1.32, 0.06, 0, 0, -0.3));
    g.add(part(new T.SphereGeometry(0.09, 8, 6), MATS.skin, -0.36, 1.1, 0.1));
    g.add(part(new T.SphereGeometry(0.09, 8, 6), MATS.skin, 0.36, 1.1, 0.1));
    g.add(part(new T.CylinderGeometry(0.028, 0.028, 0.9, 6), MATS.wood, 0.42, 1.16, 0.22, 0.2));
    g.add(part(new T.OctahedronGeometry(0.15, 0), MATS.glow, 0.44, 1.66, 0.31));
    g.add(part(new T.TorusGeometry(0.13, 0.02, 5, 12), MATS.metal, 0.44, 1.66, 0.31, Math.PI / 2));
    g.add(part(new T.BoxGeometry(0.3, 0.06, 0.34), MATS.wood, 0, 0.03, 0));
    g.add(part(new T.SphereGeometry(0.06, 8, 6), MATS.glow, 0, 2.12, 0));
    g.add(part(new T.CylinderGeometry(0.16, 0.2, 0.12, 10), MATS.metal, 0, 0.1, 0.1));
    g.userData.kind = 'keeper';
    return g;
  }

  function createHub() {
    const g = new T.Group();
    g.add(part(new T.CylinderGeometry(CONSTANTS.HUB_R, CONSTANTS.HUB_R + 0.35, 0.4, 30), MATS.stone, 0, 0.2, 0));
    g.add(part(new T.CylinderGeometry(CONSTANTS.HUB_R - 0.7, CONSTANTS.HUB_R - 0.5, 0.18, 24), MATS.metal, 0, 0.46, 0));
    g.add(part(new T.CylinderGeometry(0.5, 0.78, 4.2, 12), MATS.stone, 0, 2.4, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.add(part(new T.BoxGeometry(0.22, 3.2, 0.22), MATS.metal, Math.cos(a) * 1.05, 2.3, Math.sin(a) * 1.05, 0, a, 0.1 * (i % 2 ? 1 : -1)));
    }
    const flame = part(new T.OctahedronGeometry(0.72, 0), MATS.glow, 0, 5.0, 0);
    flame.userData.kind = 'beacon';
    g.add(flame);
    g.add(part(new T.TorusGeometry(1.0, 0.06, 6, 22), MATS.metal, 0, 5.0, 0, Math.PI / 2));
    g.add(part(new T.TorusGeometry(1.35, 0.05, 6, 24), MATS.metal, 0, 4.5, 0, Math.PI / 2.6));
    g.add(part(new T.CylinderGeometry(0.95, 1.15, 0.3, 14), MATS.stone, 0, 0.62, 0));
    g.userData.kind = 'hub';
    return g;
  }

  /* ------------------------------------------- procedural ground textures */
  function createNoiseTexture(size, c1, c2, scale) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const img = g.createImageData(size, size);
    const r = mulberry32(9);
    const grid = [];
    for (let i = 0; i < 64; i++) grid.push(r());
    const sample = (x, y) => {
      const gx = (x / size) * 8, gy = (y / size) * 8;
      const x0 = Math.floor(gx) & 7, y0 = Math.floor(gy) & 7;
      const x1 = (x0 + 1) & 7, y1 = (y0 + 1) & 7;
      const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return lerp(lerp(grid[y0 * 8 + x0], grid[y0 * 8 + x1], sx), lerp(grid[y1 * 8 + x0], grid[y1 * 8 + x1], sx), sy);
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let n = 0, amp = 0.5, f = scale || 1;
      for (let o = 0; o < 4; o++) { n += sample(x * f / 4, y * f / 4) * amp; amp *= 0.5; f *= 2; }
      const i = (y * size + x) * 4;
      img.data[i] = lerp(c1[0], c2[0], n);
      img.data[i + 1] = lerp(c1[1], c2[1], n);
      img.data[i + 2] = lerp(c1[2], c2[2], n);
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function createNoiseNormalMap(size, bump) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const img = g.createImageData(size, size);
    const r = mulberry32(23);
    const h = new Float32Array(size * size);
    for (let i = 0; i < h.length; i++) h[i] = r();
    for (let pass = 0; pass < 2; pass++) {
      const n = new Float32Array(h.length);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          s += h[((y + dy + size) % size) * size + ((x + dx + size) % size)]; c++;
        }
        n[y * size + x] = s / c;
      }
      h.set(n);
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const ddX = (h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)]) * bump;
      const ddY = (h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x]) * bump;
      const len = Math.hypot(-ddX, -ddY, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-ddX / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-ddY / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }

  /* --------------------------------------------------- 9. ENVIRONMENT */
  const groundTex = createNoiseTexture(256, theme.ground.c1, theme.ground.c2, 2);
  groundTex.repeat.set(9, 9);
  const groundNrm = createNoiseNormalMap(128, 2.4);
  groundNrm.repeat.set(14, 14);
  const groundMat = new T.MeshStandardMaterial({
    map: groundTex, normalMap: groundNrm, normalScale: new T.Vector2(0.65, 0.65),
    roughness: theme.ground.roughness, metalness: theme.ground.metalness,
  });
  const groundGeo = new T.CircleGeometry(CONSTANTS.ARENA_R + 6, 72, 0, Math.PI * 2);
  {
    const pos = groundGeo.attributes.position;
    const cols = [];
    const cA = new T.Color(theme.colors.ground), cB = new T.Color(theme.colors.groundAlt);
    /* Vertex colours MULTIPLY the map, which already carries the ground colour:
       writing absolute colours here squares the base and reads ~4x too dark
       (measured: mean luma 42 vs 125 for the texture alone). Store the tint as a
       modulation around 1.0 instead, so the rim darkens toward groundAlt. */
    const mod = [cB.r / Math.max(cA.r, 1e-4), cB.g / Math.max(cA.g, 1e-4), cB.b / Math.max(cA.b, 1e-4)]
      .map((v) => (Number.isFinite(v) ? clamp(v, 0, 2) : 1));
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      const t = clamp((r - CONSTANTS.ARENA_R * 0.6) / (CONSTANTS.ARENA_R * 0.6), 0, 1);
      cols.push(1 + (mod[0] - 1) * t, 1 + (mod[1] - 1) * t, 1 + (mod[2] - 1) * t);
    }
    groundGeo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
  }
  groundMat.vertexColors = true;
  const ground = new T.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.kind = 'ground';
  scene.add(ground);

  const hub = createHub();
  scene.add(hub);
  const keeper = createKeeper();
  keeper.position.set(CONSTANTS.HUB_R + 1.5, 0, 1.2);
  keeper.rotation.y = -Math.PI / 3;
  scene.add(keeper);

  /* obstacles + boundary ring from the SHARED layout seed */
  const layoutRng = mulberry32(CONSTANTS.OBSTACLES * 7919 + theme.seed);
  const obstacles = [];
  for (let i = 0; i < CONSTANTS.OBSTACLES; i++) {
    const a = (i / CONSTANTS.OBSTACLES) * Math.PI * 2 + layoutRng() * 0.5;
    const rad = 9 + layoutRng() * 19;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const r = 1.1 + layoutRng() * 1.1;
    obstacles.push({ x, z, r });
  }
  const rockGeo = new T.DodecahedronGeometry(1, 0);
  const rockMesh = new T.InstancedMesh(rockGeo, MATS.stone, obstacles.length);
  rockMesh.castShadow = rockMesh.receiveShadow = true;
  {
    const m = new T.Matrix4();
    obstacles.forEach((o, i) => {
      m.compose(new T.Vector3(o.x, o.r * 0.62, o.z), new T.Quaternion().setFromEuler(new T.Euler(0, i * 1.7, 0)), new T.Vector3(o.r, o.r * 0.9, o.r));
      rockMesh.setMatrixAt(i, m);
    });
    rockMesh.instanceMatrix.needsUpdate = true;
  }
  rockMesh.userData.kind = 'rock';
  scene.add(rockMesh);

  const wallGeo = new T.TorusGeometry(CONSTANTS.ARENA_R + 1.4, 0.85, 6, 64);
  const wall = new T.Mesh(wallGeo, MATS.stone);
  wall.rotation.x = Math.PI / 2;
  wall.position.y = 0.5;
  wall.castShadow = wall.receiveShadow = true;
  wall.userData.kind = 'wall';
  scene.add(wall);

  /* scatter: flora (trunk+cone) vs shard vs boulder — geometry from the photo's own green band */
  const SCATTER = [];
  {
    const srng = mulberry32(theme.seed ^ 0x5f3a);
    const n = theme.scatter.count;
    const trunkGeo = new T.CylinderGeometry(0.13, 0.2, 1.5, 6);
    const crownGeo = new T.ConeGeometry(0.85, 2.3, 7);
    const shardGeo = new T.OctahedronGeometry(0.75, 0);
    const boulderGeo = new T.IcosahedronGeometry(0.7, 0);
    const scatterMat = theme.scatter.kind === 'flora' ? MATS.flora : MATS.stone;
    const trunks = new T.InstancedMesh(trunkGeo, MATS.wood, theme.scatter.kind === 'flora' ? n : 0);
    const crowns = new T.InstancedMesh(theme.scatter.kind === 'flora' ? crownGeo : (theme.scatter.kind === 'shard' ? shardGeo : boulderGeo), scatterMat, n);
    trunks.castShadow = crowns.castShadow = true;
    trunks.receiveShadow = crowns.receiveShadow = true;
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3(), p = new T.Vector3();
    for (let i = 0; i < n; i++) {
      const a = srng() * Math.PI * 2;
      const rad = 6 + Math.sqrt(srng()) * (CONSTANTS.ARENA_R - 6.5);
      p.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      const sc = 0.55 + srng() * 0.85;
      e.set(0, srng() * Math.PI * 2, theme.scatter.kind === 'shard' ? (srng() - 0.5) * 0.5 : 0);
      q.setFromEuler(e);
      if (theme.scatter.kind === 'flora') {
        m.compose(p.clone().setY(0.72 * sc), q, s.set(sc, sc, sc));
        trunks.setMatrixAt(i, m);
        m.compose(p.clone().setY(1.55 * sc + 0.9 * sc), q, s.set(sc, sc * (0.85 + srng() * 0.4), sc));
      } else if (theme.scatter.kind === 'shard') {
        m.compose(p.clone().setY(0.85 * sc), q, s.set(sc * 0.5, sc * 1.6, sc * 0.5));
      } else {
        m.compose(p.clone().setY(0.45 * sc), q, s.set(sc * 1.2, sc * 0.75, sc * 1.05));
      }
      crowns.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    crowns.userData.kind = 'scatter';
    trunks.userData.kind = 'scatter-trunk';
    scene.add(trunks, crowns);
    SCATTER.push(crowns);
  }

  /* ------------------------------------------------- 10. PLAYER SYSTEM */
  const playerObj = createGatherer();
  scene.add(playerObj);
  const player = {
    x: 0, z: CONSTANTS.HUB_R + 4.5, y: 0, vx: 0, vz: 0, yaw: Math.PI, speed: 0,
    bob: 0, group: playerObj, anim: { legPhase: 0 },
  };
  const camRig = { yaw: Math.PI, pitch: CONSTANTS.CAM_PITCH, dist: CONSTANTS.CAM_DIST, shake: 0 };
  const beacon = hub.children.find((o) => o.userData.kind === 'beacon');
  const lantern = playerObj.children.find((o) => o.userData.kind === 'lantern');
  const KEEPER_POS = { x: keeper.position.x, z: keeper.position.z };

  const keys = Object.create(null);
  const setKey = (code, down) => { keys[code] = !!down; };

  function cameraBasis() {
    const fwd = new T.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    return { fwd, right };
  }

  /* third-person rule from SKILL.md: WASD is CAMERA relative, never world axis */
  function updatePlayer(dt) {
    const { fwd, right } = cameraBasis();
    let ix = 0, iz = 0;
    if (keys.KeyW) iz += 1;
    if (keys.KeyS) iz -= 1;
    if (keys.KeyD) ix += 1;
    if (keys.KeyA) ix -= 1;
    const running = !!(keys.ShiftLeft || keys.ShiftRight);
    const accel = running ? CONSTANTS.RUN_ACCEL : CONSTANTS.WALK_ACCEL;
    const maxSpeed = running ? CONSTANTS.RUN_SPEED : CONSTANTS.MAX_SPEED;
    const dirX = fwd.x * iz + right.x * ix;
    const dirZ = fwd.z * iz + right.z * ix;
    const mag = Math.hypot(dirX, dirZ);
    if (mag > 0.0001) {
      player.vx += (dirX / mag) * accel * dt;
      player.vz += (dirZ / mag) * accel * dt;
      player.yaw = Math.atan2(dirX, dirZ);
    }
    if (mag <= 0.0001) { const damp = Math.exp(-CONSTANTS.FRICTION * dt); player.vx *= damp; player.vz *= damp; }
    const sp = Math.hypot(player.vx, player.vz);
    if (sp > maxSpeed) { player.vx = (player.vx / sp) * maxSpeed; player.vz = (player.vz / sp) * maxSpeed; }
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    resolveObstacles(player, CONSTANTS.PLAYER_R);
    const rr = Math.hypot(player.x, player.z);
    if (rr > CONSTANTS.ARENA_R) { player.x = (player.x / rr) * CONSTANTS.ARENA_R; player.z = (player.z / rr) * CONSTANTS.ARENA_R; }
    player.speed = Math.hypot(player.vx, player.vz);
    player.bob += dt * (2 + player.speed * 1.6);
    playerObj.position.set(player.x, Math.sin(player.bob * 2.2) * 0.045 * Math.min(1, player.speed / 3), player.z);
    playerObj.rotation.y = lerpAngle(playerObj.rotation.y, player.yaw, 1 - Math.exp(-12 * dt));
    const swing = Math.sin(player.bob * 3.4) * Math.min(1, player.speed / 5) * 0.5;
    playerObj.children[9].rotation.x = swing;
    playerObj.children[10].rotation.x = -swing;
  }
  const lerpAngle = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  };
  function resolveObstacles(ent, radius) {
    for (const o of obstacles) {
      const dx = ent.x - o.x, dz = ent.z - o.z;
      const d = Math.hypot(dx, dz), need = o.r + radius;
      if (d < need && d > 1e-5) {
        ent.x = o.x + (dx / d) * need;
        ent.z = o.z + (dz / d) * need;
      }
    }
    /* the hub plinth is solid: push the entity back out to its rim */
    const hb = Math.hypot(ent.x, ent.z);
    const keep = CONSTANTS.HUB_R + radius;
    if (hb < keep) {
      if (hb < 1e-5) { ent.x = keep; ent.z = 0; }
      else { ent.x = (ent.x / hb) * keep; ent.z = (ent.z / hb) * keep; }
    }
  }

  function rigPosition() {
    return [
      player.x - Math.sin(camRig.yaw) * camRig.dist * Math.cos(camRig.pitch),
      1.6 + camRig.dist * Math.sin(camRig.pitch),
      player.z - Math.cos(camRig.yaw) * camRig.dist * Math.cos(camRig.pitch),
    ];
  }
  function snapCamera() {
    camera.position.fromArray(rigPosition());
    camera.lookAt(player.x, 1.25, player.z);
    camera.updateMatrixWorld();
  }
  function updateCamera(dt) {
    const [wantX, wantY, wantZ] = rigPosition();
    const k = 1 - Math.exp(-CONSTANTS.CAM_LERP * dt);
    camera.position.set(lerp(camera.position.x, wantX, k), lerp(camera.position.y, wantY, k), lerp(camera.position.z, wantZ, k));
    if (camRig.shake > 0.001) {
      const s = camRig.shake;
      camera.position.x += Math.sin(state.time * 61) * s * 0.35;
      camera.position.y += Math.sin(state.time * 47) * s * 0.28;
      camRig.shake = Math.max(0, camRig.shake - dt * 2.4);
    }
    camera.lookAt(player.x, 1.25, player.z);
  }

  /* --------------------------------- 11. ENTITY SYSTEM (motes + hounds, FSM) */
  const motes = [];
  const mrng = mulberry32(theme.seed ^ 0x1234);
  for (let i = 0; i < CONSTANTS.MOTE_COUNT; i++) {
    const a = (i / CONSTANTS.MOTE_COUNT) * Math.PI * 2 + mrng() * 0.6;
    const rad = 11 + mrng() * 19;
    const m = {
      id: i, kind: MOTE_KINDS[i % MOTE_KINDS.length], colorIndex: i % 3,
      ax: Math.cos(a) * rad, az: Math.sin(a) * rad, x: Math.cos(a) * rad, z: Math.sin(a) * rad,
      state: 'idle', timer: 0, phase: i * 0.37, held: false, deposited: false, ember: i >= CONSTANTS.MOTE_COUNT - CONSTANTS.EMBER_COUNT,
      transitions: { flee: 0, idle: 0 }, group: null,
    };
    m.group = createMote(m.colorIndex);
    m.group.position.set(m.x, 1.0, m.z);
    m.group.visible = !m.ember;
    m.group.traverse((o) => { if (o.isMesh) o.userData.kind = 'mote'; });
    scene.add(m.group);
    motes.push(m);
  }

  const hounds = [];
  const hrng = mulberry32(theme.seed ^ 0x99aa);
  for (let i = 0; i < CONSTANTS.HOUND_COUNT; i++) {
    const wps = [];
    for (let w = 0; w < 4; w++) {
      const a = (w / 4) * Math.PI * 2 + hrng() * 0.9;
      const rad = 12 + hrng() * 16;
      wps.push({ x: Math.cos(a) * rad, z: Math.sin(a) * rad });
    }
    const h = {
      id: i, x: wps[0].x, z: wps[0].z, startX: wps[0].x, startZ: wps[0].z, state: 'patrol', timer: 0, wp: 1, wps,
      vx: 0, vz: 0, yaw: 0, hits: 0, chases: 0, group: createHound(),
    };
    h.group.position.set(h.x, 0, h.z);
    h.group.traverse((o) => { if (o.isMesh) o.userData.kind = 'hound'; });
    scene.add(h.group);
    hounds.push(h);
  }

  function moteVisible(m) {
    if (!m.ember) return !m.held && !m.deposited;
    return state.night && !m.held && !m.deposited;
  }

  function updateMotes(dt) {
    for (const m of motes) {
      if (m.held || m.deposited) { m.group.visible = false; continue; }
      m.group.visible = moteVisible(m);
      if (!moteVisible(m)) continue;
      const dp = Math.hypot(player.x - m.x, player.z - m.z);
      /* FSM: idle <-> flee, driven purely by xz distance to the player */
      if (m.state === 'idle' && dp < CONSTANTS.MOTE_FLEE_R) { m.state = 'flee'; m.timer = 1.1; m.transitions.flee++; }
      else if (m.state === 'flee') {
        m.timer -= dt;
        if (m.timer <= 0 && dp > CONSTANTS.MOTE_FLEE_R * 1.5) { m.state = 'idle'; m.transitions.idle++; }
      }
      let tx = m.ax, tz = m.az;
      if (m.state === 'flee') {
        const dx = m.x - player.x, dz = m.z - player.z, d = Math.max(0.001, Math.hypot(dx, dz));
        tx = m.x + (dx / d) * 6; tz = m.z + (dz / d) * 6;
      } else {
        m.phase += dt * 0.8;
        tx = m.ax + Math.cos(m.phase) * CONSTANTS.MOTE_WANDER_R;
        tz = m.az + Math.sin(m.phase * 1.3) * CONSTANTS.MOTE_WANDER_R;
      }
      const k = 1 - Math.exp(-(m.state === 'flee' ? CONSTANTS.MOTE_FLEE_SPEED : 1.1) * dt * 1.6);
      m.x = lerp(m.x, tx, k); m.z = lerp(m.z, tz, k);
      const rr = Math.hypot(m.x, m.z);
      if (rr > CONSTANTS.ARENA_R - 1) { m.x = (m.x / rr) * (CONSTANTS.ARENA_R - 1); m.z = (m.z / rr) * (CONSTANTS.ARENA_R - 1); }
      m.group.position.set(m.x, 1.0 + Math.sin(state.time * 2.1 + m.phase) * 0.22, m.z);
      m.group.rotation.y += dt * 1.4;
      m.group.children[2].rotation.z += dt * 2.2;
    }
  }

  function grabMote(m) {
    m.held = true;
    state.satchel += 1;
    if (m.ember) state.embersCollected++; else state.motesCollected++;
    burst(m.x, 1.1, m.z, theme.colors.motes[m.colorIndex], 26);
    audio.sfx.grab();
  }

  function updateHounds(dt) {
    const aggro = state.night ? CONSTANTS.AGGRO_NIGHT : CONSTANTS.AGGRO_DAY;
    for (const h of hounds) {
      const dp = xzDist(h, player);
      if (h.state === 'stunned') {
        h.timer -= dt;
        if (h.timer <= 0) { h.state = 'return'; }
      } else if (h.state === 'patrol') {
        if (dp < aggro && !state.lost && state.mode === 'playing') { h.state = 'chase'; h.chases++; }
      } else if (h.state === 'chase') {
        if (dp > aggro * 1.6) { h.state = 'return'; }
      } else if (h.state === 'return') {
        if (dp < aggro * 0.7) { h.state = 'chase'; h.chases++; }
        else {
          const w = houndsWaypoint(h);
          if (Math.hypot(h.x - w.x, h.z - w.z) < 0.9) { h.state = 'patrol'; }
        }
      }
      let target = null, speed = CONSTANTS.HOUND_PATROL_SPEED;
      if (h.state === 'chase') { target = player; speed = CONSTANTS.HOUND_CHASE_SPEED; }
      else if (h.state === 'return') target = houndsWaypoint(h);
      else if (h.state === 'patrol') {
        const w = houndsWaypoint(h);
        target = w;
        if (Math.hypot(h.x - w.x, h.z - w.z) < 0.8) { h.wp = (h.wp + 1) % 4; }
      }
      if (target && h.state !== 'stunned') {
        const dx = target.x - h.x, dz = target.z - h.z, d = Math.max(0.001, Math.hypot(dx, dz));
        h.vx = lerp(h.vx, (dx / d) * speed, 1 - Math.exp(-4 * dt));
        h.vz = lerp(h.vz, (dz / d) * speed, 1 - Math.exp(-4 * dt));
        h.yaw = Math.atan2(dx, dz);
      } else { h.vx *= Math.exp(-6 * dt); h.vz *= Math.exp(-6 * dt); }
      h.x += h.vx * dt; h.z += h.vz * dt;
      resolveObstacles(h, 0.7);
      const rr = Math.hypot(h.x, h.z);
      if (rr > CONSTANTS.ARENA_R) { h.x = (h.x / rr) * CONSTANTS.ARENA_R; h.z = (h.z / rr) * CONSTANTS.ARENA_R; }
      h.group.position.set(h.x, Math.abs(Math.sin(state.time * 6 + h.id)) * 0.06 * Math.min(1, Math.hypot(h.vx, h.vz) / 3), h.z);
      h.group.rotation.y = lerpAngle(h.group.rotation.y, h.yaw, 1 - Math.exp(-9 * dt));
      /* contact damage: xz only, never y (a walking bob must not decide who gets bitten) */
      if (h.state === 'chase' && dp < CONSTANTS.HOUND_HIT_R && state.invuln <= 0 && !state.lost) bitePlayer(h);
      h.group.children[4].visible = h.group.children[5].visible = h.state !== 'stunned';
    }
  }
  function houndsWaypoint(h) {
    if (h.state === 'return') return { x: h.startX, z: h.startZ };
    return h.wps[h.wp];
  }

  /* --------------------------------------------------- 12. COMBAT / DAMAGE */
  function bitePlayer(h) {
    state.lives -= 1;
    state.invuln = CONSTANTS.INVULN;
    state.hitFlash = 1;
    state.shake = 1;
    camRig.shake = 0.55;
    h.hits++;
    h.state = 'stunned';
    h.timer = CONSTANTS.HOUND_STUN;
    const dx = player.x - h.x, dz = player.z - h.z, d = Math.max(0.001, Math.hypot(dx, dz));
    player.vx = (dx / d) * 9; player.vz = (dz / d) * 9;
    burst(player.x, 1.1, player.z, 0xffffff, 18);
    audio.sfx.hurt();
    hud.toast(`被灰犬撞上，体力 -1（剩 ${state.lives}）`, 'bad');
    if (state.lives <= 0) endRun(false);
  }

  /* --------------------------------------- 14/16. INVENTORY + QUEST SYSTEM */
  function depositAtHub() {
    if (state.satchel <= 0) return false;
    const carried = motes.filter((m) => m.held);
    let embers = 0, wisps = 0;
    for (const m of carried) { m.held = false; m.deposited = true; if (m.ember) embers++; else wisps++; }
    state.deposits++;
    state.satchel = 0;
    if (wisps) state.motesDeposited += wisps;
    if (embers) state.embersDeposited += embers;
    burst(0, 4.6, 0, theme.colors.accent, 60);
    hubPulse = 1;
    audio.sfx.deposit();
    hud.toast(`交付 ${wisps + embers} 枚`, 'ok');
    checkQuests();
    return true;
  }
  function checkQuests() {
    let guard = 0;
    while (state.questIndex < QUESTS.length && guard++ < 8) {
      const q = QUESTS[state.questIndex];
      const prog = questProgress(q);
      if (prog >= q.need) {
        state.questDone[state.questIndex] = true;
        state.questIndex++;
        hud.announce(`目标达成 · ${q.title}`);
        audio.sfx.win();
      } else break;
    }
    if (state.questIndex >= QUESTS.length && !state.won) endRun(true);
  }
  function questProgress(q) {
    if (!q) return 0;
    if (q.kind === 'motes') return state.motesDeposited;
    if (q.kind === 'embers') return state.embersDeposited;
    if (q.kind === 'talk') return state.talked ? 1 : 0;
    return 0;
  }

  /* ---------------------------------------------- 15. DIALOGUE / INTERACTION */
  const dialogue = { open: false, node: null, choiceIndex: 0, awaitingChoice: false, line: 0 };
  function openDialogue() {
    dialogue.open = true;
    dialogue.node = 'start';
    dialogue.line = 0;
    state.mode = 'dialogue';
    audio.sfx.talk();
    hud.showDialogue(DIALOGUE.start, dialogue);
  }
  function advanceDialogue() {
    if (!dialogue.open) return;
    const n = DIALOGUE[dialogue.node];
    if (n.line2 && dialogue.line === 0) { dialogue.line = 1; hud.showDialogue(n, dialogue); return; }
    if (n.choices && !dialogue.awaitingChoice) {
      dialogue.awaitingChoice = true;
      dialogue.choiceIndex = 0;
      hud.showDialogue(n, dialogue);
      return;
    }
    if (dialogue.awaitingChoice) {
      const c = n.choices[dialogue.choiceIndex];
      Object.assign(state, c.set);
      if (c.id === 'lantern') state.satchelCap += CONSTANTS.SATCHEL_BONUS;
      dialogue.awaitingChoice = false;
      state.talked = true;
      hud.toast(c.id === 'lantern' ? '借到提灯：光囊 +1' : '婉拒提灯：夜里的光萤更暗', 'info');
      if (n.next) { dialogue.node = n.next; dialogue.line = 0; hud.showDialogue(DIALOGUE[dialogue.node], dialogue); }
      else closeDialogue();
      checkQuests();
      return;
    }
    if (n.next) { dialogue.node = n.next; dialogue.line = 0; hud.showDialogue(DIALOGUE[dialogue.node], dialogue); }
    else closeDialogue();
  }
  function chooseDialogue(i) {
    if (!dialogue.awaitingChoice) return;
    dialogue.choiceIndex = clamp(i, 0, DIALOGUE[dialogue.node].choices.length - 1);
    hud.showDialogue(DIALOGUE[dialogue.node], dialogue);
    audio.sfx.ui();
  }
  function closeDialogue() {
    dialogue.open = false;
    dialogue.node = null;
    state.mode = 'playing';
    hud.hideDialogue();
    state.talked = true;
    checkQuests();
  }

  /* ------------------------------------------------------ 17/18. PICKUP + ZONES */
  function tryPickup() {
    for (const m of motes) {
      if (m.held || m.deposited || !moteVisible(m)) continue;
      if (Math.hypot(player.x - m.x, player.z - m.z) < CONSTANTS.MOTE_GRAB_R + 0.9) {
        if (state.satchel >= state.satchelCap) { hud.toast('光囊已满，先回光柱交付', 'bad'); return false; }
        grabMote(m);
        return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------- 19. PARTICLE SYSTEM */
  const particles = (() => {
    const max = CONSTANTS.MAX_PARTICLES;
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
    const siz = new Float32Array(max), alp = new Float32Array(max);
    const vel = new Float32Array(max * 3), life = new Float32Array(max), decay = new Float32Array(max);
    let head = 0, live = 0;
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('pcolor', new T.BufferAttribute(col, 3));
    geo.setAttribute('psize', new T.BufferAttribute(siz, 1));
    geo.setAttribute('palpha', new T.BufferAttribute(alp, 1));
    const mat = new T.ShaderMaterial({
      uniforms: { pxScale: { value: window.innerHeight * 0.5 } },
      transparent: true,
      depthWrite: false,
      blending: theme.particles.additive ? T.AdditiveBlending : T.NormalBlending,
      vertexShader: `
        attribute float psize; attribute float palpha; attribute vec3 pcolor;
        varying float vA; varying vec3 vC; uniform float pxScale;
        void main(){ vA = palpha; vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * pxScale / max(0.001, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if(r>0.25) discard;
          gl_FragColor = vec4(vC, vA * (1.0 - r * 4.0)); }`,
    });
    const points = new T.Points(geo, mat);
    points.frustumCulled = false;
    points.userData.kind = 'particles';
    scene.add(points);
    const c = new T.Color();
    function spawn(x, y, z, color, vx, vy, vz, size, ttl) {
      const i = head; head = (head + 1) % max;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      c.set(color); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      siz[i] = size; alp[i] = 1; life[i] = ttl; decay[i] = 1 / ttl;
      if (live < max) live++;
    }
    function update(dt) {
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) { if (alp[i] !== 0) alp[i] = 0; continue; }
        life[i] -= dt;
        alp[i] = Math.max(0, life[i] * decay[i]);
        vel[i * 3 + 1] += theme.particles.gravity * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (life[i] <= 0) { alp[i] = 0; live = Math.max(0, live - 1); }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.palpha.needsUpdate = true;
      geo.attributes.pcolor.needsUpdate = true;
      geo.attributes.psize.needsUpdate = true;
    }
    return {
      spawn, update, points,
      count: () => Array.from(life).filter((v) => v > 0).length,
      reset: () => { life.fill(0); alp.fill(0); head = 0; live = 0; },
    };
  })();
  function burst(x, y, z, color, n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, r = 1.4 + (i % 5) * 0.35;
      particles.spawn(x, y, z, color, Math.cos(a) * r, 1.5 + (i % 3) * 0.6, Math.sin(a) * r,
        theme.particles.size * (0.03 + (i % 4) * 0.012), 0.7 + (i % 5) * 0.09);
    }
  }
  let ambientAcc = 0;
  function ambientParticles(dt) {
    ambientAcc += dt * theme.particles.rate * 22;
    while (ambientAcc >= 1) {
      ambientAcc -= 1;
      const a = (particles.count() * 0.618) % 1 * Math.PI * 2;
      const rad = 5 + ((particles.count() * 7919) % 100) / 100 * (CONSTANTS.ARENA_R - 6);
      particles.spawn(Math.cos(a) * rad, 0.4 + ((particles.count() * 31) % 40) / 12, Math.sin(a) * rad,
        theme.particles.colors[particles.count() % theme.particles.colors.length],
        0.2, 0.25, -0.15, 0.045, 3.4);
    }
  }

  /* ------------------------------------------------- day / night cycle */
  let hubPulse = 0;
  const CYCLE = CONSTANTS.DAY_LEN + CONSTANTS.NIGHT_LEN;
  function cycleT() { return state.time % CYCLE; }
  function isNightAt(t) { return (t % CYCLE) >= CONSTANTS.DAY_LEN; }
  function nightMix() {
    const t = cycleT();
    if (t < CONSTANTS.DAY_LEN - 4) return 0;
    if (t < CONSTANTS.DAY_LEN) return (t - (CONSTANTS.DAY_LEN - 4)) / 4;
    if (t < CYCLE - 4) return 1;
    return 1 - (t - (CYCLE - 4)) / 4;
  }
  function updateDayNight(dt) {
    const wasNight = state.night;
    state.night = isNightAt(state.time);
    const mix = nightMix();
    keyLight.intensity = lerp(LIGHT_BASE.key, LIGHT_BASE.key * 0.16, mix);
    fillLight.intensity = lerp(LIGHT_BASE.fill, LIGHT_BASE.fill * 0.3, mix);
    hemiLight.intensity = lerp(LIGHT_BASE.hemi, 0.42, mix);
    ambientLight.intensity = lerp(LIGHT_BASE.ambient, Math.max(0.45, LIGHT_BASE.ambient * 0.8), mix);
    rimLight.intensity = lerp(LIGHT_BASE.rim, 2.2, mix);
    hubLight.intensity = lerp(1.4, 3.6, mix) * (1 + hubPulse);
    gradePass.uniforms.nightMix.value = mix;
    scene.fog.density = theme.fog.density * (1 + mix * 0.7);
    skyDome.material.uniforms.topColor.value.set(theme.sky.top).multiplyScalar(lerp(1, 0.32, mix));
    if (state.night !== wasNight) {
      if (state.night) {
        state.nightCount++;
        hud.announce('夜幕落下 · 灰烬碎片浮出');
        audio.sfx.night();
        for (const m of motes) if (m.ember) { m.held = false; m.deposited = false; m.x = m.ax; m.z = m.az; }
      } else {
        hud.announce('天光回来了');
        audio.sfx.dawn();
      }
    }
    hubPulse = Math.max(0, hubPulse - dt * 1.6);
    beacon.rotation.y += dt * 0.9;
    beacon.scale.setScalar(1 + Math.sin(state.time * 3.1) * 0.06 + hubPulse * 0.35);
    MATS.glow.emissiveIntensity = 2.4 + hubPulse * 0.9 + (state.night ? (state.lantern ? 2.2 : 0.9) : 0);
    lantern.scale.setScalar(1 + (state.night ? (state.lantern ? 0.55 : 0.2) : 0));
  }

  /* --------------------------------------------------------------- 20. HUD */
  const hud = buildHud(theme, KEEPER_POS);

  /* ---------------------------------------------------- 23/24. SCREEN FLOW */
  function startRun() {
    Object.assign(state, freshState());
    state.invuln = 0;
    for (const m of motes) { m.held = false; m.deposited = false; m.state = 'idle'; m.timer = 0; m.x = m.ax; m.z = m.az; m.phase = m.id * 0.37; m.transitions.flee = 0; m.transitions.idle = 0; }
    for (const h of hounds) {
      h.wp = 1;
      h.x = h.wps[0].x; h.z = h.wps[0].z;
      h.startX = h.wps[0].x; h.startZ = h.wps[0].z;
      h.vx = h.vz = 0; h.yaw = 0; h.state = 'patrol'; h.hits = 0; h.chases = 0; h.timer = 0;
    }
    /* Every field the simulation reads must be restored here, or a second run
       from the same seed is not the same run (the determinism assertion caught
       m.phase and player.bob leaking across restarts). */
    player.x = 0; player.z = CONSTANTS.HUB_R + 4.5; player.vx = player.vz = 0;
    player.yaw = Math.PI; player.bob = 0; player.speed = 0;
    particles.reset();
    camRig.yaw = Math.PI; camRig.pitch = CONSTANTS.CAM_PITCH; camRig.shake = 0;
    /* Snap the camera onto the orbit rig instead of leaving it wherever the last
       run ended: updateCamera lerps, so a stale position makes the first frames'
       camera-relative basis depend on history and breaks restart determinism. */
    snapCamera();
    cameraBasis();
    hud.hideScreen('title-screen'); hud.hideScreen('end-screen');
    state.mode = 'playing';
    hud.announce('拾光开始');
    audio.ensure();
  }
  function endRun(won) {
    if (state.mode === 'over') return;
    state.mode = 'over';
    state.won = won;
    state.lost = !won;
    if (won) hud.announce('光柱重新亮起来');
    else hud.announce('你在夜色里倒下');
    audio.sfx[won ? 'win' : 'lose']();
    const rec = saveGame(state);
    hud.showEnd(won, state, rec);
  }

  /* --------------------------------------------------------- 25. MAIN LOOP */
  let acc = 0, last = performance.now(), raf = 0;
  function interact() {
    const nearKeeper = Math.hypot(player.x - keeper.position.x, player.z - keeper.position.z) < CONSTANTS.TALK_R;
    if (nearKeeper) { if (!dialogue.open) openDialogue(); else advanceDialogue(); return true; }
    if (Math.hypot(player.x, player.z) < CONSTANTS.DEPOSIT_R + CONSTANTS.HUB_R && state.satchel > 0) return depositAtHub();
    return tryPickup();
  }
  function update(dt) {
    if (state.mode === 'playing') {
      state.time += dt;
      if (state.invuln > 0) state.invuln = Math.max(0, state.invuln - dt);
      updatePlayer(dt);
      updateMotes(dt);
      updateHounds(dt);
      updateDayNight(dt);
      ambientParticles(dt);
      particles.update(dt);
      updateCamera(dt);
      state.hitFlash = Math.max(0, state.hitFlash - dt * 2.2);
      state.shake = Math.max(0, state.shake - dt * 2.4);
      hud.sync(state, motes, dialogue, player);
    } else if (state.mode === 'dialogue') {
      updateDayNight(dt);
      particles.update(dt);
      updateCamera(dt);
      hud.sync(state, motes, dialogue, player);
    } else {
      /* title / over: keep the world alive so the frame is a real scene */
      state.time += dt * 0.35;
      updateCamera(dt);
      updateDayNight(dt);
      ambientParticles(dt);
      particles.update(dt);
      hud.sync(state, motes, dialogue, player);
    }
  }
  function render() { composer.render(); }
  /* Tests must own the clock: while rAF kept stepping, a manual update() loop was
     racing the live one and the orbit camera lagged a frame behind the rig, which
     made the camera-relative movement probe read the WRONG forward vector. */
  let paused = false;
  window.__setPaused = (v) => { paused = !!v; last = performance.now(); acc = 0; };
  function frame(nowMs) {
    raf = requestAnimationFrame(frame);
    if (paused) return;
    let dt = (nowMs - last) / 1000;
    last = nowMs;
    if (!(dt > 0)) dt = 0;
    acc += Math.min(dt, CONSTANTS.MAX_FRAME_DT);
    let steps = 0;
    while (acc >= CONSTANTS.FIXED_DT && steps++ < 6) { update(CONSTANTS.FIXED_DT); acc -= CONSTANTS.FIXED_DT; }
    if (steps === 6) acc = 0;
    render();
  }

  /* ------------------------------------------------------- 26. EVENTS */
  function onResize() {
    camera.aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    composer.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    bloomPass.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    ssaoPass.setSize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    sizeFxaa();
  }
  let dragging = false, lastX = 0, lastY = 0;
  function onPointerDown(ev) {
    if (state.mode === 'title') { startRun(); return; }
    if (state.mode === 'over') { startRun(); return; }
    dragging = true; lastX = ev.clientX; lastY = ev.clientY;
  }
  function onPointerMove(ev) {
    if (!dragging) return;
    camRig.yaw -= (ev.clientX - lastX) * 0.006;
    camRig.pitch = clamp(camRig.pitch + (ev.clientY - lastY) * 0.004, 0.12, 1.15);
    lastX = ev.clientX; lastY = ev.clientY;
  }
  function onPointerUp() { dragging = false; }
  function onKey(ev) {
    if (ev.type === 'keydown') setKey(ev.code, true);
    if (ev.type === 'keyup') setKey(ev.code, false);
    if (ev.type !== 'keydown') return;
    if (ev.code === 'KeyE') { if (state.mode === 'title' || state.mode === 'over') startRun(); else interact(); }
    if (state.mode === 'dialogue' && (ev.code === 'Digit1' || ev.code === 'Digit2')) chooseDialogue(ev.code === 'Digit1' ? 0 : 1);
    if (ev.code === 'Escape' && state.mode === 'dialogue') closeDialogue();
    if (ev.code === 'Space' && state.mode === 'playing') { ev.preventDefault(); tryPickup(); }
  }
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.dispose();
  }

  /* initial paint: title screen shows the live world behind it */
  hud.showProvenance();
  const saved = loadSave();
  hud.showRecord(saved);
  playerObj.position.set(player.x, 0, player.z);
  snapCamera();
  window.render_game_to_text = () => JSON.stringify({
    mode: state.mode, theme: theme.id, time: +state.time.toFixed(2),
    lives: state.lives, satchel: state.satchel, cap: state.satchelCap,
    quest: state.questIndex, motesDeposited: state.motesDeposited,
    embersDeposited: state.embersDeposited, night: state.night,
    flees: motes.reduce((a, m) => a + m.transitions.flee, 0),
    chases: hounds.reduce((a, h) => a + h.chases, 0),
    particles: particles.count(),
  });
  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) update(CONSTANTS.FIXED_DT);
  };
  window.__setKey = setKey;
  window.__keys = keys;
  /* Read the WHOLE drawing buffer and stride-sample it. Sampling a pw×ph corner rectangle instead
     would judge the exposure off one patch of ground, which is how a washed-out sky and a
     crushed ground both managed to look "fine". */
  window.__frameProbe = (w, h) => {
    const gl = renderer.getContext();
    const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
    const buf = new Uint8Array(bw * bh * 4);
    renderer.render(scene, camera);
    gl.readPixels(0, 0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const sx = Math.max(1, Math.round(bw / (w || 220))), sy = Math.max(1, Math.round(bh / (h || 220)));
    let sum = 0, sum2 = 0; const hist = new Array(8).fill(0);
    let mn = 255, mx = 0, n = 0;
    const sorted = [];
    for (let y = 0; y < bh; y += sy) {
      for (let x = 0; x < bw; x += sx) {
        const i = (y * bw + x) * 4;
        const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
        sum += l; sum2 += l * l; mn = Math.min(mn, l); mx = Math.max(mx, l);
        sorted.push(l); n++;
        hist[Math.min(7, Math.floor(l / 32))]++;
      }
    }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    sorted.sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(n - 1, Math.floor(p * n))];
    return {
      meanLuma: +mean.toFixed(2), sd: +sd.toFixed(2), min: +mn.toFixed(1), max: +mx.toFixed(1),
      p0_5: +q(0.005).toFixed(1), p5: +q(0.05).toFixed(1), p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1), p99_5: +q(0.995).toFixed(1),
      midPct: +(sorted.filter((v) => v >= 60 && v <= 200).length / n * 100).toFixed(2),
      brightPct: +(hist[7] / n * 100).toFixed(2), darkPct: +(hist[0] / n * 100).toFixed(2),
    };
  };
  window.__diag = () => ({
    threeRevision: T.REVISION,
    theme: theme.id,
    seed: theme.seed,
    lights: scene.children.filter((o) => o.isLight).map((l) => ({
      type: l.type, intensity: +l.intensity.toFixed(3),
      color: '#' + l.color.getHex(T.SRGBColorSpace).toString(16).padStart(6, '0').toUpperCase(),
      pos: [+l.position.x.toFixed(2), +l.position.y.toFixed(2), +l.position.z.toFixed(2)],
      castShadow: !!l.castShadow,
    })),
    renderer: {
      toneMapping: renderer.toneMapping === T.ACESFilmicToneMapping ? 'ACESFilmic' : String(renderer.toneMapping),
      exposure: +renderer.toneMappingExposure.toFixed(3),
      outputColorSpace: renderer.outputColorSpace,
      shadowType: renderer.shadowMap.type === T.PCFSoftShadowMap ? 'PCFSoft' : String(renderer.shadowMap.type),
      shadowEnabled: renderer.shadowMap.enabled, pixelRatio: renderer.getPixelRatio(),
      size: [renderer.domElement.width, renderer.domElement.height],
    },
    passes: composer.passes.map((p) => p.label),
    bloom: { strength: bloomPass.strength, radius: bloomPass.radius, threshold: bloomPass.threshold },
    ssao: { kernelRadius: ssaoPass.kernelRadius, min: ssaoPass.minDistance, max: ssaoPass.maxDistance },
    grade: {
      contrast: gradePass.uniforms.contrast.value, saturation: gradePass.uniforms.saturation.value,
      vignette: gradePass.uniforms.vignetteIntensity.value, brightness: gradePass.uniforms.brightness.value,
    },
    shadow: { mapSize: keyLight.shadow.mapSize.width, normalBias: keyLight.shadow.normalBias },
    envMap: !!scene.environment, skyDome: !!skyDome,
    fog: { color: '#' + scene.fog.color.getHex(T.SRGBColorSpace).toString(16).padStart(6, '0').toUpperCase(), density: +scene.fog.density.toFixed(5) },
    sceneColors: (() => {
      const out = [];
      const ext = (geo, pick) => {
        const a = geo?.attributes?.color?.array;
        if (!a) return null;
        let v = pick === 'min' ? Infinity : -Infinity;
        for (let i = 0; i < a.length; i++) v = pick === 'min' ? Math.min(v, a[i]) : Math.max(v, a[i]);
        return +v.toFixed(3);
      };
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const mm = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mm) return;
        const isToon = mm.type === 'MeshToonMaterial';
        const base = mm.color ? mm.color.getHex(T.SRGBColorSpace) : 0;
        /* a ShaderMaterial carries no .color: its palette lives in the colour uniforms */
        const uni = [];
        if (mm.uniforms) {
          for (const [name, u] of Object.entries(mm.uniforms)) {
            const cv = u && u.value;
            if (cv && cv.isColor) uni.push({ name, hex: '#' + cv.getHex(T.SRGBColorSpace).toString(16).padStart(6, '0').toUpperCase() });
          }
        }
        out.push({
          kind: o.userData.kind || o.parent?.userData?.kind || 'unknown',
          hex: '#' + base.toString(16).padStart(6, '0').toUpperCase(),
          r: (base >> 16) & 255, g: (base >> 8) & 255, b: base & 255,
          matType: mm.type,
          uniforms: uni,
          basic: mm.type === 'MeshBasicMaterial',
          emissiveHex: mm.emissive ? '#' + mm.emissive.getHex(T.SRGBColorSpace).toString(16).padStart(6, '0').toUpperCase() : null,
          emissiveIntensity: mm.emissiveIntensity === undefined ? null : mm.emissiveIntensity,
          transmission: mm.transmission === undefined ? null : mm.transmission,
          vertexColors: !!mm.vertexColors, hasMap: !!mm.map, hasNormalMap: !!mm.normalMap,
          /* vertex colours here are modulations around 1.0, not palette entries: expose the
             extremes so a regression to absolute colours is catchable */
          vcMin: mm.vertexColors ? ext(o.geometry, 'min') : null,
          vcMax: mm.vertexColors ? ext(o.geometry, 'max') : null,
          castShadow: !!o.castShadow, isInstanced: !!o.isInstancedMesh,
        });
        void isToon;
      });
      return out;
    })(),
    counts: {
      playerParts: countParts(playerObj),
      moteParts: countParts(motes[0].group),
      houndParts: countParts(hounds[0].group),
      keeperParts: countParts(keeper),
      hubParts: countParts(hub),
      scatter: theme.scatter.count,
      obstacles: obstacles.length,
      motesTotal: motes.length,
      embers: motes.filter((m) => m.ember).length,
    },
    fsm: {
      motes: motes.map((m) => ({ id: m.id, kind: m.kind, state: m.state, ember: m.ember, visible: m.group.visible, held: m.held, deposited: m.deposited, transitions: { ...m.transitions } })),
      hounds: hounds.map((h) => ({ id: h.id, state: h.state, chases: h.chases, hits: h.hits, x: +h.x.toFixed(2), z: +h.z.toFixed(2) })),
    },
    camera: {
      pos: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
      forwardXZ: (() => { const b = cameraBasis(); return [+b.fwd.x.toFixed(4), +b.fwd.z.toFixed(4)]; })(),
      yaw: +camRig.yaw.toFixed(4), pitch: +camRig.pitch.toFixed(4),
    },
    player: { x: +player.x.toFixed(3), z: +player.z.toFixed(3), speed: +player.speed.toFixed(3), yaw: +player.yaw.toFixed(3) },
    cycle: { DAY_LEN: CONSTANTS.DAY_LEN, NIGHT_LEN: CONSTANTS.NIGHT_LEN, t: +cycleT().toFixed(2), night: state.night, mix: +nightMix().toFixed(3) },
    mapping: theme.mapping,
    palette: theme.palette,
    declaredColors: theme.declaredColors,
    state,
  });
  window.__game = {
    state, scene, camera, renderer, composer, hud, player, motes, hounds, obstacles, keys,
    camRig, cameraBasis, setKey, startRun, restart: startRun, endRun, cleanup, dialogue, interact, depositAtHub,
    tryPickup, openDialogue, advanceDialogue, chooseDialogue, closeDialogue, checkQuests, CONSTANTS, QUESTS,
    DIALOGUE, theme, THREE: T, particles, burst, isNightAt, nightMix, saveGame, loadSave, update,
  };
  raf = requestAnimationFrame(frame);
  return { state, scene, renderer, composer, hud, update, cleanup };
}

/* ============================== 20. HUD DOM (built from theme skin) ====== */
function buildHud(theme, keeperPos) {
  const $ = (s) => document.querySelector(s);
  const els = {
    questKicker: $('#quest-kicker'), questTitle: $('#quest-title'), questDesc: $('#quest-desc'),
    questBar: $('#quest-bar'), questProg: $('#quest-progress'), phase: $('#phase-value'),
    time: $('#time-value'), dayBar: $('#day-bar'), lives: $('#life-pips'), satchel: $('#satchel-pips'),
    satchelNote: $('#satchel-note'), toasts: $('#toast-container'), dialogue: $('#dialogue'),
    dlgSpeaker: $('#dlg-speaker'), dlgLine: $('#dlg-line'), dlgChoices: $('#dlg-choices'),
    dlgHint: $('#dlg-hint'), prompt: $('#prompt'), vignette: $('#damage-vignette'),
    announce: $('#announce'), title: $('#title-screen'), end: $('#end-screen'),
    endTitle: $('#end-title'), endStats: $('#end-stats'), endKicker: $('#end-kicker'),
    provenance: $('#provenance'), record: $('#record-line'),
  };
  let lastSatchel = -1, lastLives = -1, lastQuest = -1, lastPhase = null;

  function pips(host, n, total, cls) {
    if (host.childElementCount !== total) {
      host.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const s = document.createElement('i');
        s.className = 'pip';
        host.appendChild(s);
      }
    }
    [...host.children].forEach((c, i) => c.classList.toggle('on', i < n));
    host.style.color = cls || theme.colors.uiAccent;
  }

  function sync(state, motes, dialogue, player) {
    const q = QUESTS[state.questIndex];
    if (state.questIndex !== lastQuest) {
      lastQuest = state.questIndex;
      els.questKicker.textContent = q ? `目标 ${state.questIndex + 1} / ${QUESTS.length}` : '全部目标已完成';
      els.questTitle.textContent = q ? q.title : '活下来了';
      els.questDesc.textContent = q ? q.desc : '把最后一批灰烬交给光柱。';
    }
    const prog = q ? questProgressOf(state, q) : (state.won ? 1 : 0);
    const need = q ? q.need : 1;
    els.questBar.style.width = `${Math.min(100, (prog / need) * 100).toFixed(1)}%`;
    els.questProg.textContent = `${Math.min(prog, need)} / ${need}`;
    if (state.satchel !== lastSatchel || lastSatchelCap !== state.satchelCap) {
      lastSatchel = state.satchel; lastSatchelCap = state.satchelCap;
      pips(els.satchel, state.satchel, state.satchelCap);
    }
    if (state.lives !== lastLives) {
      lastLives = state.lives;
      pips(els.lives, Math.max(0, state.lives), CONSTANTS.START_LIVES, state.lives === 1 ? '#e0664a' : undefined);
    }
    const secs = Math.floor(state.time);
    els.time.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    els.phase.textContent = state.night ? '夜晚' : '白昼';
    if (lastPhase !== state.night) { lastPhase = state.night; els.phase.style.color = state.night ? theme.colors.uiMuted : theme.colors.uiText; }
    els.dayBar.style.width = `${(state.night ? 1 : 0.2 + 0.8 * (state.time % CONSTANTS.DAY_LEN) / CONSTANTS.DAY_LEN) * 100}%`;
    els.vignette.style.opacity = String(Math.min(0.85, state.hitFlash * 0.8 + (state.invuln > 0 ? 0.18 : 0)));
    if (state.mode === 'playing') {
      const nearKeeper = Math.hypot(player.x - keeperPos.x, player.z - keeperPos.z) < CONSTANTS.TALK_R;
      const atHub = Math.hypot(player.x, player.z) < CONSTANTS.DEPOSIT_R + CONSTANTS.HUB_R;
      let txt = '';
      if (nearKeeper) txt = state.talked ? 'E · 再听一句' : 'E · 与守塔人交谈';
      else if (atHub && state.satchel > 0) txt = 'E · 把光囊交给光柱';
      else if (state.satchel >= state.satchelCap) txt = '光囊已满 · 回光柱';
      if (txt) { els.prompt.hidden = false; els.prompt.textContent = txt; }
      else els.prompt.hidden = true;
    } else els.prompt.hidden = true;
    void motes; void dialogue;
  }
  let lastSatchelCap = -1;
  function questProgressOf(state, q) {
    if (q.kind === 'motes') return state.motesDeposited;
    if (q.kind === 'embers') return state.embersDeposited;
    if (q.kind === 'talk') return state.talked ? 1 : 0;
    return 0;
  }
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind || 'info';
    el.textContent = msg;
    el.style.borderColor = kind === 'bad' ? '#e0664a' : kind === 'ok' ? '#5fbf8a' : 'rgba(255,255,255,.18)';
    els.toasts.appendChild(el);
    while (els.toasts.childElementCount > 4) els.toasts.removeChild(els.toasts.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 520); }, 2100);
  }
  function announce(text) {
    els.announce.textContent = text;
    els.announce.classList.remove('show');
    void els.announce.offsetWidth;
    els.announce.classList.add('show');
  }
  function showDialogue(n, d) {
    els.dialogue.hidden = false;
    els.dlgSpeaker.textContent = n.speaker;
    els.dlgLine.textContent = d.line === 1 && n.line2 ? n.line2 : n.text;
    els.dlgChoices.innerHTML = '';
    if (n.choices) {
      n.choices.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'dlg-choice';
        el.textContent = `${i + 1}. ${c.text}`;
        el.setAttribute('sel', d.awaitingChoice && d.choiceIndex === i ? '1' : '0');
        el.style.pointerEvents = 'auto';
        el.addEventListener('click', () => { d.choiceIndex = i; window.__game && window.__game.chooseDialogue(i); });
        els.dlgChoices.appendChild(el);
      });
      els.dlgHint.textContent = d.awaitingChoice ? '按 1 / 2 选择，再按 E 确认' : '按 E 作出选择';
    } else {
      els.dlgHint.textContent = n.next || n.line2 ? '按 E 继续' : '按 E 结束对话';
    }
  }
  function hideDialogue() { els.dialogue.hidden = true; }
  function showProvenance() {
    if (!els.provenance) return;
    const rows = theme.mapping.slice(0, 8).map(([slot, formula, note]) =>
      `<div><b>${slot}</b> ← ${formula} · ${note}</div>`).join('');
    els.provenance.innerHTML =
      `<div><b>参考图</b> ${theme.refFile} · ${theme.palette.length} 个量色</div>` + rows +
      `<div><b>合成色</b> ${theme.synthesised.length ? theme.synthesised.map((s) => s.hex).join(' ') : '无'}</div>`;
  }
  function showRecord(rec) {
    if (!els.record) return;
    els.record.textContent = rec
      ? `历史：${rec.runs} 次 · ${rec.wins} 成 · 最快 ${rec.bestTime == null ? '—' : rec.bestTime.toFixed(1) + 's'} · 最多交付 ${rec.bestDeposits}`
      : '尚无记录';
  }
  function hideScreen(id) { const el = document.getElementById(id); if (el) el.hidden = true; }
  function showEnd(won, state, rec) {
    els.end.hidden = false;
    els.endKicker.textContent = won ? '这一夜守住了' : '光柱暗了下去';
    els.endTitle.textContent = won ? '拾光圆满' : '夜色取胜';
    const mins = Math.floor(state.time / 60), secs = Math.floor(state.time % 60);
    const rows = [
      ['用时', `${mins}:${String(secs).padStart(2, '0')}`],
      ['交付光萤', String(state.motesDeposited)],
      ['交付灰烬', String(state.embersDeposited)],
      ['完成目标', `${state.questIndex} / ${QUESTS.length}`],
      ['经历夜晚', String(state.nightCount)],
      ['剩余体力', String(Math.max(0, state.lives))],
      ['提灯', state.lantern ? '借到了' : '没借'],
      ['历史最快', rec && rec.bestTime != null ? rec.bestTime.toFixed(1) + 's' : '—'],
    ];
    els.endStats.innerHTML = rows.map(([k, v]) => `<div>${k}<span>${v}</span></div>`).join('');
  }
  return { sync, toast, announce, showDialogue, hideDialogue, showProvenance, showRecord, showEnd, hideScreen, els };
}
