/* TOWERLINE — 3D tower defense. Shared engine, theme-agnostic.
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
  GRID_W: 12,
  GRID_H: 8,
  CELL: 4,
  FRUSTUM: 44,
  CAM_Y: 52,
  CAM_Z: 30,
  START_GOLD: 220,
  START_LIVES: 20,
  SELL_REFUND: 0.7,
  SAVE_KEY: 'towerline_save_v1',
  SAVE_VERSION: 1,
  PATH_WIDTH: 2.2,
  BASE_HP_DRAIN: 2,
  WAVE_BOUNTY: 45,
  FIRST_WAVE_DELAY: 2.0,
  WAVE_GAP: 4.0,
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.05,
  PROJ_POOL: 48,
  MAX_PARTICLES: 900,
  MAX_ATTACKABLE: 60,
  /* graphics-quality.md prescribes kernelRadius 16 / minDistance 0.005 / maxDistance 0.1;
     with this ortho rig (near .1, far 2000) that measures meanLuma 0 — the whole frame goes
     black. These are scaled to the depth range instead (~1-8 world units of occlusion). */
  SSAO: { kernelRadius: 2, minDistance: 0.0002, maxDistance: 0.004 },
};

const TOWER_TYPES = {
  ballista: { name: '弩炮 Ballista', cost: 60, range: 15, dps_rate: 0.75, damage: 17, splash: 0, slow: 0, kind: 'shoot' },
  frost: { name: '霜环 Frostline', cost: 85, range: 11.5, dps_rate: 1.15, damage: 5, splash: 0, slow: 0.5, kind: 'pulse' },
  mortar: { name: '熔炉 Mortar', cost: 125, range: 21, dps_rate: 2.1, damage: 34, splash: 5.2, slow: 0, kind: 'lob' },
};

/* ========================================================= 3. DATA DEFS */
const WAVES = [
  { n: 6, hp: 42, speed: 2.6, gap: 1.1, reward: 8, type: 'runner' },
  { n: 9, hp: 58, speed: 2.7, gap: 1.0, reward: 8, type: 'runner' },
  { n: 10, hp: 84, speed: 2.5, gap: 0.95, reward: 9, type: 'brute' },
  { n: 13, hp: 96, speed: 2.9, gap: 0.85, reward: 9, type: 'runner' },
  { n: 12, hp: 150, speed: 2.4, gap: 0.9, reward: 12, type: 'brute' },
  { n: 16, hp: 132, speed: 3.1, gap: 0.7, reward: 11, type: 'swift' },
  { n: 15, hp: 215, speed: 2.5, gap: 0.8, reward: 13, type: 'brute' },
  { n: 20, hp: 190, speed: 3.2, gap: 0.6, reward: 12, type: 'swift' },
  { n: 18, hp: 330, speed: 2.6, gap: 0.7, reward: 16, type: 'brute' },
  { n: 1, hp: 2600, speed: 2.0, gap: 1, reward: 90, type: 'titan' },
];

const PATH_CELLS = [
  [-1, 2], [2, 2], [2, 5], [6, 5], [6, 1], [9, 1], [9, 4], [12, 4],
];

/* ========================================================== 4. GAME STATE */
const MODES = { TITLE: 'title', PLAYING: 'playing', GAMEOVER: 'gameover', VICTORY: 'victory' };

/* ====================================================== 5. SAVE/LOAD */
function saveGame(state) {
  try {
    localStorage.setItem(
      CONSTANTS.SAVE_KEY,
      JSON.stringify({
        version: CONSTANTS.SAVE_VERSION,
        timestamp: Date.now(),
        bestWave: state.bestWave,
        wins: state.wins,
        buildCount: state.buildCount,
      })
    );
  } catch (e) {
    /* storage disabled */
  }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(CONSTANTS.SAVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || p.version !== CONSTANTS.SAVE_VERSION) return null;
    return p;
  } catch (e) {
    return null;
  }
}

/* ========================================================= helpers */
function mulberry32(a) {
  let t = a >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const cellToWorld = (c) =>
  new THREE.Vector3(
    (c[0] - (CONSTANTS.GRID_W - 1) / 2) * CONSTANTS.CELL,
    0,
    (c[1] - (CONSTANTS.GRID_H - 1) / 2) * CONSTANTS.CELL
  );
/* Range is a board-plane measure. Using 3D distance instead lets the cosmetic
   walk-bob (and the per-theme rng stream behind it) decide who gets shot. */
const xzDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function isOnPath(cx, cz) {
  const pts = PATH_CELLS.map(cellToWorld);
  const p = cellToWorld([cx, cz]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ab = new THREE.Vector3().subVectors(b, a);
    const len2 = ab.lengthSq();
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
    const proj = new THREE.Vector3().copy(a).addScaledVector(ab, t);
    if (proj.distanceTo(p) < CONSTANTS.CELL * 0.95) return true;
  }
  return false;
}

/* ================================== procedural audio (21. AUDIO SYSTEM) */
function createAudio(theme) {
  let ctx = null;
  let master = null;
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    return ctx;
  }
  function blip(freq, dur, type, gain, slideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(Math.max(0.0001, gain || 0.12), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }
  return {
    ensure,
    get context() { return ctx; },
    shoot: () => blip(theme.snd.shoot, 0.09, 'square', 0.12, theme.snd.shoot * 0.55),
    hit: () => blip(theme.snd.hit, 0.07, 'triangle', 0.14),
    kill: () => blip(theme.snd.kill, 0.22, 'sawtooth', 0.16, theme.snd.kill * 2.2),
    build: () => blip(theme.snd.build, 0.16, 'sine', 0.18, theme.snd.build * 1.5),
    wave: () => blip(theme.snd.wave, 0.4, 'sine', 0.2, theme.snd.wave * 1.33),
    leak: () => blip(theme.snd.leak, 0.3, 'sawtooth', 0.2, theme.snd.leak * 0.5),
    over: () => blip(180, 0.9, 'triangle', 0.22, 60),
  };
}

/* ============================================================ main entry */
export function createGame(theme, domTarget) {
  let rng = mulberry32(theme.seed);
  const audio = createAudio(theme);

  /* ---------------------------------------------- 6. SCENE SETUP */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sky.bottom);
  scene.fog = new THREE.FogExp2(theme.fog.color, theme.fog.density);

  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    (-CONSTANTS.FRUSTUM * aspect) / 2, (CONSTANTS.FRUSTUM * aspect) / 2,
    CONSTANTS.FRUSTUM / 2, -CONSTANTS.FRUSTUM / 2, 0.1, 2000
  );
  camera.position.set(0, CONSTANTS.CAM_Y, CONSTANTS.CAM_Z);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = theme.post.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  (domTarget || document.body).appendChild(renderer.domElement);

  /* lighting rig — 4 lights minimum */
  const keyLight = new THREE.DirectionalLight(theme.lights.key.color, theme.lights.key.intensity);
  keyLight.position.fromArray(theme.lights.key.pos);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(4096, 4096);
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.bias = -0.0005;
  const sc = keyLight.shadow.camera;
  sc.left = -46; sc.right = 46; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  sc.updateProjectionMatrix();
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(theme.lights.fill.color, theme.lights.fill.intensity);
  fillLight.position.fromArray(theme.lights.fill.pos);
  scene.add(fillLight);
  const hemiLight = new THREE.HemisphereLight(theme.lights.hemi.sky, theme.lights.hemi.gnd, theme.lights.hemi.intensity);
  scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(theme.lights.ambient.color, theme.lights.ambient.intensity);
  scene.add(ambientLight);
  const rimLight = new THREE.PointLight(theme.lights.rim.color, theme.lights.rim.intensity, theme.lights.rim.distance, 2);
  rimLight.position.fromArray(theme.lights.rim.pos);
  scene.add(rimLight);

  /* -------------------------------------- sky dome + PMREM env map */
  function createSkyDome(topColor, bottomColor, sunColor, sunDir) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(topColor) },
        bottomColor: { value: new THREE.Color(bottomColor) },
        sunColor: { value: new THREE.Color(sunColor) },
        sunDir: { value: sunDir.clone().normalize() },
        sunSize: { value: theme.sky.sunSize },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topColor, bottomColor, sunColor, sunDir; uniform float sunSize; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(bottomColor, topColor, pow(h, 0.75));
          float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * pow(sd, 1.0 / max(sunSize, 0.001)) * 1.2;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(600, 32, 32), mat);
  }
  const sunDir = new THREE.Vector3().fromArray(theme.lights.key.pos).normalize();
  const skyDome = createSkyDome(theme.sky.top, theme.sky.bottom, theme.sky.sun, sunDir);
  scene.add(skyDome);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  envScene.add(createSkyDome(theme.sky.top, theme.sky.bottom, theme.sky.sun, sunDir));
  const envMap = pmrem.fromScene(envScene, 0.04).texture;
  scene.environment = envMap;
  pmrem.dispose();

  /* --------------------------------------- 7. POST-PROCESSING */
  const composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  const addPass = (pass, label) => {
    pass.label = label;
    composer.addPass(pass);
    return pass;
  };
  addPass(new RenderPass(scene, camera), 'RenderPass');
  const ssaoPass = addPass(new SSAOPass(scene, camera, window.innerWidth, window.innerHeight), 'SSAOPass');
  ssaoPass.kernelRadius = CONSTANTS.SSAO.kernelRadius;
  ssaoPass.minDistance = CONSTANTS.SSAO.minDistance;
  ssaoPass.maxDistance = CONSTANTS.SSAO.maxDistance;
  const bloomPass = addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    theme.post.bloom.strength, theme.post.bloom.radius, theme.post.bloom.threshold
  ), 'UnrealBloomPass');
  /* Deviation from skill docs: OutputPass inserted here (see report §4). */
  addPass(new OutputPass(), 'OutputPass');
  const gradingShader = {
    uniforms: {
      tDiffuse: { value: null },
      brightness: { value: theme.post.grade.brightness },
      contrast: { value: theme.post.grade.contrast },
      saturation: { value: theme.post.grade.saturation },
      vignetteIntensity: { value: theme.post.grade.vignette },
      vignetteRoundness: { value: 1.0 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float brightness, contrast, saturation, vignetteIntensity, vignetteRoundness;
      varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        c.rgb += brightness;
        c.rgb = (c.rgb - 0.5) * contrast + 0.5;
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, saturation);
        vec2 p = (vUv - 0.5) * vec2(1.0, 1.0);
        float v = 1.0 - pow(clamp(length(p) * 1.42, 0.0, 1.0), 2.0 * vignetteRoundness) * vignetteIntensity;
        gl_FragColor = vec4(c.rgb * clamp(v, 0.0, 1.0), c.a);
      }`,
  };
  const gradePass = addPass(new ShaderPass(gradingShader), 'ColorGradePass');
  const fxaaPass = addPass(new ShaderPass(FXAAShader), 'FXAAPass');
  fxaaPass.material.uniforms['resolution'].value.set(
    1 / (window.innerWidth * renderer.getPixelRatio()),
    1 / (window.innerHeight * renderer.getPixelRatio())
  );

  /* ------------------------------------- 8. ASSET FACTORIES */
  const mats = theme.materials(THREE, scene.environment);

  function part(geo, mat, x, y, z, rx, ry, rz, s) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    if (s) m.scale.setScalar(s);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  /* tower: base ring + pedestal + 4 struts + housing + 3 rotating parts + core + 4 accents */
  function createTower(kind) {
    const g = new THREE.Group();
    const M = mats.tower[kind];
    g.add(part(new THREE.CylinderGeometry(1.55, 1.8, 0.35, 12), M.stone, 0, 0.18, 0));
    g.add(part(new THREE.CylinderGeometry(1.05, 1.25, 0.9, 10), M.stone, 0, 0.8, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.add(part(new THREE.BoxGeometry(0.26, 1.5, 0.26), M.frame, Math.cos(a) * 1.15, 0.75, Math.sin(a) * 1.15, 0, -a, 0));
      g.add(part(new THREE.SphereGeometry(0.16, 8, 6), M.core, Math.cos(a) * 1.15, 1.55, Math.sin(a) * 1.15));
    }
    const head = new THREE.Group();
    head.position.y = 1.85;
    head.add(part(new THREE.CylinderGeometry(0.85, 0.95, 0.5, 10), M.frame, 0, 0.1, 0));
    if (kind === 'ballista') {
      head.add(part(new THREE.BoxGeometry(0.3, 0.26, 2.6), M.barrel, 0, 0.5, 0.7));
      head.add(part(new THREE.BoxGeometry(1.9, 0.16, 0.3), M.barrel, 0, 0.55, 1.6, 0, 0, 0.35));
      head.add(part(new THREE.BoxGeometry(1.9, 0.16, 0.3), M.barrel, 0, 0.55, 1.6, 0, 0, -0.35));
      head.add(part(new THREE.TorusGeometry(0.5, 0.13, 6, 12), M.core, 0, 0.5, 2.0, Math.PI / 2));
    } else if (kind === 'frost') {
      head.add(part(new THREE.OctahedronGeometry(0.85, 0), M.crystal, 0, 0.95, 0));
      head.add(part(new THREE.TorusGeometry(1.15, 0.1, 6, 18), M.core, 0, 0.95, 0, Math.PI / 2));
      head.add(part(new THREE.TorusGeometry(0.8, 0.08, 6, 18), M.core, 0, 1.35, 0, Math.PI / 2.4));
      head.add(part(new THREE.SphereGeometry(0.26, 8, 6), M.glow, 0, 1.78, 0));
      head.add(part(new THREE.ConeGeometry(0.3, 0.6, 6), M.crystal, 0.75, 0.7, 0.4, 0.4));
      head.add(part(new THREE.ConeGeometry(0.3, 0.6, 6), M.crystal, -0.75, 0.7, 0.4, 0.4));
    } else {
      head.add(part(new THREE.CylinderGeometry(0.55, 0.72, 1.7, 10), M.barrel, 0, 1.15, 0, 0.5));
      head.add(part(new THREE.TorusGeometry(0.62, 0.12, 6, 14), M.core, 0, 1.9, 0.55, Math.PI / 2 - 0.5));
      head.add(part(new THREE.SphereGeometry(0.34, 10, 8), M.glow, 0, 2.15, 0.9));
      head.add(part(new THREE.CylinderGeometry(0.9, 1.0, 0.28, 10), M.stone, 0, 0.42, 0));
      head.add(part(new THREE.TorusGeometry(0.72, 0.1, 6, 14), M.core, 0, 0.5, 0, Math.PI / 2));
    }
    g.add(head);
    g.userData.head = head;
    g.userData.kind = 'tower';
    g.userData.towerKind = kind;
    return g;
  }

  /* enemy: head + body + 2 eyes + 4 legs + 2 accents + shell/fin = 15..20 parts */
  function createEnemy(type) {
    const g = new THREE.Group();
    const M = mats.enemy[type];
    const scale = type === 'titan' ? 1.9 : type === 'brute' ? 1.25 : type === 'swift' ? 0.82 : 1;
    const bodyGeo = type === 'brute' || type === 'titan'
      ? new THREE.DodecahedronGeometry(0.95, 0)
      : new THREE.CapsuleGeometry(0.55, 0.7, 4, 8);
    g.add(part(bodyGeo, M.hide, 0, 0.95, 0));
    g.add(part(new THREE.SphereGeometry(0.46, 12, 10), M.hide2, 0, 1.6, 0.25));
    g.add(part(new THREE.SphereGeometry(0.14, 8, 6), M.eye, -0.2, 1.7, 0.6));
    g.add(part(new THREE.SphereGeometry(0.14, 8, 6), M.eye, 0.2, 1.7, 0.6));
    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? -0.42 : 0.42;
      const sz = i % 2 === 0 ? 0.42 : -0.42;
      g.add(part(new THREE.CylinderGeometry(0.12, 0.1, 0.9, 6), M.limb, sx, 0.45, sz));
    }
    for (let i = 0; i < 3; i++) {
      g.add(part(new THREE.ConeGeometry(0.18 - i * 0.03, 0.4, 5), M.fin || M.shell, 0, 1.1 + i * 0.18, -0.55 - i * 0.28, -0.9));
    }
    g.add(part(new THREE.BoxGeometry(0.28, 0.24, 0.3), M.shell, -0.62, 1.35, 0.05));
    g.add(part(new THREE.BoxGeometry(0.28, 0.24, 0.3), M.shell, 0.62, 1.35, 0.05));
    if (type === 'runner' || type === 'swift') {
      g.add(part(new THREE.ConeGeometry(0.3, 0.75, 8), M.fin, 0, 1.35, -0.75, -0.6));
      g.add(part(new THREE.ConeGeometry(0.18, 0.5, 6), M.fin, -0.3, 1.3, -0.6, -0.5));
    } else {
      g.add(part(new THREE.IcosahedronGeometry(0.55, 0), M.shell, 0, 1.15, -0.6));
      g.add(part(new THREE.BoxGeometry(0.16, 0.6, 0.16), M.shell, -0.45, 1.5, -0.5, 0.3, 0, 0.2));
      g.add(part(new THREE.BoxGeometry(0.16, 0.6, 0.16), M.shell, 0.45, 1.5, -0.5, 0.3, 0, -0.2));
    }
    if (type === 'titan') {
      g.add(part(new THREE.OctahedronGeometry(0.42, 0), M.glow, 0, 2.3, 0));
      g.add(part(new THREE.TorusGeometry(0.9, 0.1, 6, 16), M.glow, 0, 2.1, 0, Math.PI / 2));
    } else {
      g.add(part(new THREE.SphereGeometry(0.2, 8, 6), M.glow, 0, 0.95, 0.62));
    }
    g.scale.setScalar(scale);
    g.userData.kind = 'enemy';
    g.userData.enemyType = type;
    return g;
  }

  function createBase() {
    const g = new THREE.Group();
    const M = mats.base;
    g.add(part(new THREE.CylinderGeometry(2.6, 3.1, 0.5, 12), M.stone, 0, 0.25, 0));
    g.add(part(new THREE.CylinderGeometry(1.5, 2.0, 2.4, 10), M.stone, 0, 1.5, 0));
    g.add(part(new THREE.OctahedronGeometry(1.0, 0), M.crystal, 0, 3.5, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      g.add(part(new THREE.ConeGeometry(0.4, 1.5, 6), M.stone, Math.cos(a) * 2.2, 1.2, Math.sin(a) * 2.2));
      g.add(part(new THREE.SphereGeometry(0.22, 8, 6), M.glow, Math.cos(a) * 2.2, 2.1, Math.sin(a) * 2.2));
    }
    g.userData.kind = 'base';
    return g;
  }

  /* --------------------------------------- 9. ENVIRONMENT */
  function createNoiseTexture(size, scale, c1, c2) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g2 = cv.getContext('2d');
    const img = g2.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = 0.5 + 0.5 * Math.sin(x / scale) * Math.cos(y / (scale * 1.3)) + (rng() - 0.5) * 0.5;
        const t = Math.max(0, Math.min(1, n));
        const i = (y * size + x) * 4;
        img.data[i] = c1[0] + (c2[0] - c1[0]) * t;
        img.data[i + 1] = c1[1] + (c2[1] - c1[1]) * t;
        img.data[i + 2] = c1[2] + (c2[2] - c1[2]) * t;
        img.data[i + 3] = 255;
      }
    }
    g2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function createNoiseNormalMap(size, bump) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g2 = cv.getContext('2d');
    const h = new Float32Array(size * size);
    for (let i = 0; i < h.length; i++) h[i] = rng();
    for (let p = 0; p < 2; p++) {
      const o = new Float32Array(h.length);
      for (let y = 1; y < size - 1; y++)
        for (let x = 1; x < size - 1; x++) {
          let s = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += h[(y + dy) * size + x + dx];
          o[y * size + x] = s / 9;
        }
      h.set(o);
    }
    const img = g2.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ddX = (h[y * size + Math.min(size - 1, x + 1)] - h[y * size + Math.max(0, x - 1)]) * bump;
        const ddY = (h[Math.min(size - 1, y + 1) * size + x] - h[Math.max(0, y - 1) * size + x]) * bump;
        const len = Math.sqrt(ddX * ddX + ddY * ddY + 1);
        const i = (y * size + x) * 4;
        img.data[i] = ((-ddX / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((-ddY / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = (1 / len) * 255;
        img.data[i + 3] = 255;
      }
    }
    g2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  const groundTex = createNoiseTexture(256, 18, theme.ground.c1, theme.ground.c2);
  groundTex.repeat.set(26, 18);
  const groundNormal = createNoiseNormalMap(128, 2.0);
  groundNormal.repeat.set(26, 18);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 110),
    new THREE.MeshStandardMaterial({
      map: groundTex,
      normalMap: groundNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: theme.ground.roughness,
      metalness: theme.ground.metalness,
      color: theme.ground.tint,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.kind = 'decor';
  scene.add(ground);

  /* buildable plate */
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(CONSTANTS.GRID_W * CONSTANTS.CELL, 0.4, CONSTANTS.GRID_H * CONSTANTS.CELL),
    new THREE.MeshStandardMaterial({ color: theme.ground.plate, roughness: 0.85, metalness: 0.05 })
  );
  plate.position.y = 0.2;
  plate.receiveShadow = true;
  plate.userData.kind = 'decor';
  scene.add(plate);

  /* path ribbon from waypoints. The curve stays at y=0 and the mesh is lifted instead:
     scaling a mesh whose vertices already sit at y=0.45 scales that offset too and buries
     the whole road under the plate (top of plate = 0.4). */
  const wps = PATH_CELLS.map(cellToWorld).map((v) => v.clone().setY(0));
  const curve = new THREE.CatmullRomCurve3(wps, false, 'catmullrom', 0.15);
  const pathLen = curve.getLength();
  const pathMesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 160, CONSTANTS.PATH_WIDTH * 0.5, 8, false),
    new THREE.MeshStandardMaterial({ color: theme.path.color, roughness: theme.path.roughness, metalness: theme.path.metalness, emissive: new THREE.Color(theme.path.emissive || 0x000000), emissiveIntensity: theme.path.emissiveIntensity || 0 })
  );
  pathMesh.scale.y = 0.12;
  pathMesh.position.y = 0.47;
  pathMesh.receiveShadow = true;
  pathMesh.userData.kind = 'decor';
  scene.add(pathMesh);

  /* grid helper of build pads (instanced) */
  const padGeo = new THREE.BoxGeometry(CONSTANTS.CELL * 0.86, 0.12, CONSTANTS.CELL * 0.86);
  const pads = [];
  for (let cx = 0; cx < CONSTANTS.GRID_W; cx++)
    for (let cz = 0; cz < CONSTANTS.GRID_H; cz++) if (!isOnPath(cx, cz)) pads.push([cx, cz]);
  const padMesh = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ color: theme.ground.pad, roughness: 0.9 }), pads.length);
  const dummy = new THREE.Object3D();
  pads.forEach((c, i) => {
    const w = cellToWorld(c);
    dummy.position.set(w.x, 0.46, w.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    padMesh.setMatrixAt(i, dummy.matrix);
  });
  padMesh.instanceMatrix.needsUpdate = true;
  padMesh.userData.kind = 'decor';
  scene.add(padMesh);

  /* theme scatter: instanced biome detail (>=10 per skill rule) */
  const scatterCount = theme.scatter.count;
  const scatterMesh = new THREE.InstancedMesh(theme.scatter.geometry(THREE), theme.scatter.material(THREE), scatterCount);
  scatterMesh.castShadow = true;
  scatterMesh.receiveShadow = true;
  for (let i = 0; i < scatterCount; i++) {
    const cx = Math.floor(rng() * CONSTANTS.GRID_W);
    const cz = Math.floor(rng() * CONSTANTS.GRID_H);
    if (isOnPath(cx, cz)) { i--; continue; }
    const w = cellToWorld([cx, cz]);
    dummy.position.set(w.x + (rng() - 0.5) * 2.6, 0.5, w.z + (rng() - 0.5) * 2.6);
    dummy.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.2);
    const s = 0.8 + rng() * 0.4;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    scatterMesh.setMatrixAt(i, dummy.matrix);
  }
  scatterMesh.instanceMatrix.needsUpdate = true;
  scatterMesh.userData.kind = 'decor';
  scene.add(scatterMesh);

  const baseMesh = createBase();
  const endW = wps[wps.length - 1].clone().setZ(wps[wps.length - 1].z + 1);
  baseMesh.position.set(endW.x + 4, 0.4, endW.z);
  scene.add(baseMesh);

  /* ghost preview + range ring */
  const ghost = createTower('ballista');
  ghost.traverse((o) => { if (o.isMesh) o.visible = false; });
  ghost.userData.kind = 'ghost';
  scene.add(ghost);
  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.05, 48),
    new THREE.MeshBasicMaterial({ color: theme.ui.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.visible = false;
  rangeRing.userData.kind = 'decor';
  scene.add(rangeRing);

  /* ------------------------------------------ 10. PLAYER / INPUT SYSTEM */
  const state = {
    mode: MODES.TITLE,
    gold: CONSTANTS.START_GOLD,
    lives: CONSTANTS.START_LIVES,
    wave: 0,
    waveActive: false,
    toSpawn: 0,
    spawnTimer: 0,
    waveTimer: CONSTANTS.FIRST_WAVE_DELAY,
    time: 0,
    selected: 'ballista',
    shake: 0,
    bestWave: 0,
    wins: 0,
    buildCount: 0,
    killed: 0,
    leaked: 0,
    spawned: 0,
    hpSpawned: 0,
    hpLeaked: 0,
    spent: 0,
    earned: CONSTANTS.START_GOLD,
    damageDealt: 0,
    grid: new Map(),
  };
  const meta = loadGame() || {};
  state.bestWave = meta.bestWave || 0;
  state.wins = meta.wins || 0;

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.46);
  const hitPoint = new THREE.Vector3();
  function worldFromEvent(ev) {
    pointer.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(groundPlane, hitPoint) ? hitPoint : null;
  }
  function snapCell(p) {
    const cx = Math.round((p.x / CONSTANTS.CELL + (CONSTANTS.GRID_W - 1) / 2));
    const cz = Math.round((p.z / CONSTANTS.CELL + (CONSTANTS.GRID_H - 1) / 2));
    if (cx < 0 || cz < 0 || cx >= CONSTANTS.GRID_W || cz >= CONSTANTS.GRID_H) return null;
    return [cx, cz];
  }
  function canBuild(cell) {
    if (!cell) return false;
    const k = cell[0] + ',' + cell[1];
    if (state.grid.has(k)) return false;
    return !isOnPath(cell[0], cell[1]);
  }

  /* ------------------------------------------- 11. ENTITY SYSTEM (FSM) */
  const enemies = [];
  const towers = [];
  function spawnEnemy(waveDef) {
    const g = createEnemy(waveDef.type);
    const hp = waveDef.hp;
    g.position.copy(wps[0]);
    g.userData.kind = 'enemy';
    scene.add(g);
    enemies.push({
      obj: g, hp, maxHp: hp, speed: waveDef.speed, slow: 0, slowT: 0,
      t: 0, dist: 0, aiState: 'walk', reward: waveDef.reward, alive: true,
      bob: rng() * 6.28, drain: waveDef.type === 'titan' ? 5 : waveDef.type === 'brute' ? 2 : 1,
    });
    state.spawned++;
    state.hpSpawned += hp;
  }

  /* ---------------------------------------------- 12. COMBAT SYSTEM */
  function damageEnemy(e, amount) {
    if (!e.alive) return;
    const dealt = Math.min(e.hp, amount);
    e.hp -= dealt;
    state.damageDealt += dealt;
    if (e.hp <= 0) {
      e.alive = false;
      e.aiState = 'dying';
      state.killed++;
      state.gold += e.reward;
      state.earned += e.reward;
      audio.kill();
      particles.emit(e.obj.position.clone().setY(1.2), 14, 7, 0.7);
      flashKill(e);
    }
  }
  function towerFire(tw, dt) {
    tw.cd -= dt;
    const def = TOWER_TYPES[tw.kind];
    let best = null, bestDist = -1;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = xzDist(e.obj.position, tw.obj.position);
      if (d <= def.range && e.dist > bestDist) { best = e; bestDist = e.dist; }
    }
    tw.target = best;
    if (best) {
      const a = Math.atan2(best.obj.position.x - tw.obj.position.x, best.obj.position.z - tw.obj.position.z);
      tw.head.rotation.y += (a - tw.head.rotation.y) * Math.min(1, dt * 9);
    }
    if (tw.cd <= 0 && best) {
      tw.cd = def.dps_rate;
      tw.pulse = 1;
      if (def.kind === 'pulse') {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (xzDist(e.obj.position, tw.obj.position) <= def.range) {
            damageEnemy(e, def.damage);
            e.slow = Math.max(e.slow, def.slow);
            e.slowT = 2.0;
          }
        }
        particles.emit(tw.obj.position.clone().setY(2.4), 10, 4, 0.5);
        audio.hit();
      } else {
        const mesh = projectiles.get();
        const p = projData.get(mesh);
        p.kind = def.kind;
        p.from0.copy(tw.obj.position).setY(2.6);
        p.target = best;
        p.damage = def.damage;
        p.splash = def.splash;
        p.speed = def.kind === 'lob' ? 16 : 34;
        p.t = 0;
        p.to0.copy(best.obj.position).setY(1);
        p.dist = p.from0.distanceTo(p.to0);
        mesh.position.copy(p.from0);
        audio.shoot();
      }
    }
  }

  /* --------------------------------------------- 17. PROJECTILE SYSTEM */
  class ObjectPool {
    constructor(factory, initialSize) {
      this.factory = factory;
      this.pool = [];
      this.active = [];
      this.created = 0;
      for (let i = 0; i < initialSize; i++) {
        const o = factory();
        o.visible = false;
        this.pool.push(o);
        this.created++;
      }
    }
    get() {
      const o = this.pool.pop() || null;
      if (!o) {
        const n = this.factory();
        this.created++;
        this.active.push(n);
        return n;
      }
      o.visible = true;
      this.active.push(o);
      return o;
    }
    release(o) {
      const i = this.active.indexOf(o);
      if (i >= 0) this.active.splice(i, 1);
      o.visible = false;
      this.pool.push(o);
    }
  }
  const projData = new Map();
  const projectiles = new ObjectPool(() => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 8, 6),
      mats.projectile.mesh
    );
    m.castShadow = true;
    m.userData.kind = 'decor';
    scene.add(m);
    projData.set(m, { to0: new THREE.Vector3(), from0: new THREE.Vector3(), kind: 'shoot', t: 0, damage: 0, splash: 0, speed: 1, dist: 1, target: null });
    return m;
  }, CONSTANTS.PROJ_POOL);

  function updateProjectiles(dt) {
    for (const mesh of [...projectiles.active]) {
      const d = projData.get(mesh);
      if (!d.target || !d.target.alive) { projectiles.release(mesh); continue; }
      d.to0.copy(d.target.obj.position).setY(1);
      d.t += (dt * d.speed) / Math.max(0.5, d.dist);
      if (d.kind === 'lob') {
        mesh.position.lerpVectors(d.from0, d.to0, Math.min(1, d.t));
        mesh.position.y += Math.sin(Math.min(1, d.t) * Math.PI) * (d.dist * 0.28);
      } else {
        mesh.position.lerpVectors(d.from0, d.to0, Math.min(1, d.t));
      }
      if (d.t >= 1) {
        if (d.splash > 0) {
          for (const e of enemies) {
            if (!e.alive) continue;
            if (xzDist(e.obj.position, d.to0) <= d.splash) damageEnemy(e, d.damage);
          }
          particles.emit(d.to0.clone(), 18, 6, 0.6);
          state.shake = Math.min(0.55, state.shake + 0.28);
        } else {
          damageEnemy(d.target, d.damage);
          particles.emit(d.to0.clone(), 6, 4, 0.35);
        }
        audio.hit();
        projectiles.release(mesh);
      }
    }
  }

  /* --------------------------------------------- 19. PARTICLE SYSTEM */
  const particles = (() => {
    const max = CONSTANTS.MAX_PARTICLES;
    const pos = new Float32Array(max * 3);
    const vel = new Float32Array(max * 3);
    const ages = new Float32Array(max).fill(-1);
    const lifeArr = new Float32Array(max);
    const sizes = new Float32Array(max);
    const cols = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: theme.particles.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAge;
        uniform float uPixelRatio; varying vec3 vColor; varying float vAge;
        void main(){
          vColor = aColor; vAge = aAge;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAge;
        void main(){
          if (vAge < 0.0) discard;
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.06, length(d)) * clamp(1.0 - vAge, 0.0, 1.0);
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.userData.kind = 'decor';
    scene.add(pts);
    let cursor = 0;
    const palette = theme.particles.colors.map((c) => new THREE.Color(c));
    return {
      obj: pts,
      emit(origin, count, speed, lifetime) {
        for (let k = 0; k < count; k++) {
          const i = cursor % max;
          cursor++;
          const c = palette[Math.floor(rng() * palette.length) % palette.length];
          pos[i * 3] = origin.x + (rng() - 0.5) * 0.6;
          pos[i * 3 + 1] = origin.y + (rng() - 0.5) * 0.6;
          pos[i * 3 + 2] = origin.z + (rng() - 0.5) * 0.6;
          vel[i * 3] = (rng() - 0.5) * speed;
          vel[i * 3 + 1] = rng() * speed * 0.9 + 0.4;
          vel[i * 3 + 2] = (rng() - 0.5) * speed;
          ages[i] = 0;
          lifeArr[i] = lifetime * (0.7 + rng() * 0.6);
          sizes[i] = theme.particles.size * (0.6 + rng() * 0.8);
          cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
        }
      },
      ambient(dt) {
        if (!theme.particles.ambient) return;
        if (rng() < theme.particles.ambient.rate * dt) {
          const w = cellToWorld([Math.floor(rng() * CONSTANTS.GRID_W), Math.floor(rng() * CONSTANTS.GRID_H)]);
          this.emit(new THREE.Vector3(w.x, 8 + rng() * 4, w.z), 1, theme.particles.ambient.speed, 3.2);
        }
      },
      update(dt) {
        const g = theme.particles.gravity;
        for (let i = 0; i < max; i++) {
          if (ages[i] < 0) continue;
          ages[i] += dt / Math.max(0.1, lifeArr[i]);
          if (ages[i] >= 1) { ages[i] = -1; pos[i * 3 + 1] = -999; continue; }
          vel[i * 3 + 1] += g * dt;
          pos[i * 3] += vel[i * 3] * dt;
          pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
          pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aAge.needsUpdate = true;
        geo.attributes.aColor.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
      },
      count() {
        let n = 0;
        for (let i = 0; i < max; i++) if (ages[i] >= 0) n++;
        return n;
      },
    };
  })();

  /* -------------------------------------------------- 18. COLLISION / ZONES */
  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
      if (!e.alive) {
        e.obj.rotation.z += dt * 6;
        e.obj.position.y -= dt * 3;
        e.deathT = (e.deathT || 0) + dt;
        if (e.deathT > 0.45) {
          scene.remove(e.obj);
          e.obj.traverse((o) => { if (o.isMesh) o.geometry.dispose?.(); });
          enemies.splice(i, 1);
        }
        continue;
      }
      const sp = e.speed * (1 - e.slow);
      e.dist += sp * dt;
      const u = Math.min(1, e.dist / pathLen);
      const p = curve.getPointAt(u);
      const tan = curve.getTangentAt(u);
      e.obj.position.set(p.x, 0.62 + Math.abs(Math.sin(e.bob + e.dist * 2)) * 0.18, p.z);
      e.obj.rotation.y = Math.atan2(tan.x, tan.z);
      if (u >= 1) {
        e.aiState = 'reached';
        state.lives = Math.max(0, state.lives - e.drain);
        state.leaked++;
        state.hpLeaked += e.hp;
        audio.leak();
        state.shake = Math.min(0.9, state.shake + 0.4);
        hud.damageFlash();
        scene.remove(e.obj);
        enemies.splice(i, 1);
        if (state.lives <= 0) endGame(false);
      }
    }
  }

  /* ------------------------------------------------ 20. HUD UPDATE (DOM) */
  const hud = buildHud(theme, domTarget);
  function flashKill(e) {
    hud.killFeed(`${e.obj.userData.enemyType} 已击破 +${e.reward}◈`);
  }

  /* ------------------------------------------------ 23/24 SCREENS, FLOW */
  function startRun() {
    state.mode = MODES.PLAYING;
    hud.hide('title');
    hud.show('playing');
    hud.setGold(state.gold, true);
    hud.announce(`WAVE ${state.wave + 1}`, `${WAVES[state.wave].n} 个目标接近`);
  }
  function restart() {
    for (const tw of towers) scene.remove(tw.obj);
    towers.length = 0;
    state.grid.clear();
    for (const e of enemies) scene.remove(e.obj);
    enemies.length = 0;
    for (const p of [...projectiles.active]) projectiles.release(p);
    Object.assign(state, {
      gold: CONSTANTS.START_GOLD, lives: CONSTANTS.START_LIVES, wave: 0, waveActive: false,
      toSpawn: 0, spawnTimer: 0, waveTimer: CONSTANTS.FIRST_WAVE_DELAY, time: 0, killed: 0,
      leaked: 0, spawned: 0, spent: 0, hpSpawned: 0, hpLeaked: 0,
      earned: CONSTANTS.START_GOLD, damageDealt: 0, shake: 0,
    });
    rng = mulberry32(theme.seed);
    hud.clearFeed();
    hud.setGold(state.gold, true);
    hud.setLives(state.lives);
    hud.setWave(0);
    hud.hide('over');
    startRun();
  }
  function endGame(won) {
    state.mode = won ? MODES.VICTORY : MODES.GAMEOVER;
    if (won) state.wins++;
    state.bestWave = Math.max(state.bestWave, state.wave);
    saveGame(state);
    audio.over();
    hud.showOver(won, {
      wave: state.wave, killed: state.killed, leaked: state.leaked,
      gold: state.gold, time: state.time, bestWave: state.bestWave, wins: state.wins,
    });
  }

  function updateWaves(dt) {
    if (state.mode !== MODES.PLAYING) return;
    if (!state.waveActive) {
      state.waveTimer -= dt;
      if (state.waveTimer <= 0 && state.wave < WAVES.length) {
        const wv = WAVES[state.wave];
        state.wave++;
        state.waveActive = true;
        state.toSpawn = wv.n;
        state.spawnTimer = 0;
        hud.announce(`WAVE ${state.wave}`, `${wv.n} × ${wv.type.toUpperCase()}`);
        hud.setWave(state.wave);
        audio.wave();
      }
      return;
    }
    const wv = WAVES[state.wave - 1];
    if (state.toSpawn > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        state.spawnTimer = wv.gap;
        spawnEnemy(wv);
        state.toSpawn--;
      }
    } else if (enemies.length === 0) {
      state.waveActive = false;
      state.gold += CONSTANTS.WAVE_BOUNTY;
      state.earned += CONSTANTS.WAVE_BOUNTY;
      if (state.wave >= WAVES.length) { endGame(true); return; }
      state.waveTimer = CONSTANTS.WAVE_GAP;
      hud.toast(`第 ${state.wave} 波清空 +${CONSTANTS.WAVE_BOUNTY}◈`, 'success');
      saveGame(state);
    }
  }

  function buildTower(cell) {
    const kind = state.selected;
    const def = TOWER_TYPES[kind];
    if (!canBuild(cell)) { hud.toast('该地块无法建造', 'warn'); return false; }
    if (state.gold < def.cost) { hud.toast(`金币不足，需要 ${def.cost}◈`, 'error'); return false; }
    const obj = createTower(kind);
    const w = cellToWorld(cell);
    obj.position.set(w.x, 0.46, w.z);
    scene.add(obj);
    const tw = { kind, obj, head: obj.userData.head, cd: 0.2, cell, invested: def.cost, pulse: 0, target: null, shots: 0 };
    towers.push(tw);
    state.grid.set(cell[0] + ',' + cell[1], tw);
    state.gold -= def.cost;
    state.spent += def.cost;
    state.buildCount++;
    audio.build();
    particles.emit(obj.position.clone().setY(1.2), 10, 3, 0.5);
    hud.setGold(state.gold);
    return true;
  }
  function sellTower(cell) {
    const k = cell[0] + ',' + cell[1];
    const tw = state.grid.get(k);
    if (!tw) return false;
    const refund = Math.floor(tw.invested * CONSTANTS.SELL_REFUND);
    state.gold += refund;
    state.earned += refund;
    scene.remove(tw.obj);
    towers.splice(towers.indexOf(tw), 1);
    state.grid.delete(k);
    hud.setGold(state.gold);
    hud.toast(`拆除 +${refund}◈`, 'info');
    return true;
  }

  /* ---------------------------------------------------- 25. MAIN LOOP */
  let last = 0;
  let accum = 0;
  function update(dt) {
    if (state.mode !== MODES.PLAYING) return;
    state.time += dt;
    updateWaves(dt);
    updateEnemies(dt);
    for (const tw of towers) {
      towerFire(tw, dt);
      if (tw.pulse > 0) tw.pulse = Math.max(0, tw.pulse - dt * 4);
    }
    updateProjectiles(dt);
    particles.ambient(dt);
    particles.update(dt);
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.2);
    hud.tick(state, dt);
    hud.setGold(state.gold);
    hud.setLives(state.lives);
  }
  function render() {
    const sh = state.shake;
    camera.position.x = sh > 0 ? (rng() - 0.5) * sh * 1.6 : 0;
    camera.position.y = sh > 0 ? (rng() - 0.5) * sh * 1.2 : 0;
    camera.position.set(camera.position.x + camBase.x, camera.position.y + camBase.y, camBase.z);
    camera.updateProjectionMatrix();
    for (const tw of towers) {
      if (tw.head) tw.head.position.y = 1.85 + tw.pulse * 0.16;
    }
    baseMesh.children[2].rotation.y += 0.01;
    composer.render();
  }
  const camBase = camera.position.clone();
  function frame(nowMs) {
    const now = nowMs / 1000;
    const dt = Math.min(CONSTANTS.MAX_FRAME_DT, last ? now - last : CONSTANTS.FIXED_DT);
    last = now;
    accum += dt;
    let guard = 0;
    while (accum >= CONSTANTS.FIXED_DT && guard < 6) {
      update(CONSTANTS.FIXED_DT);
      accum -= CONSTANTS.FIXED_DT;
      guard++;
    }
    if (guard >= 6) accum = 0;
    render();
    raf = requestAnimationFrame(frame);
  }
  let raf = 0;

  /* ------------------------------------------ 26. EVENT LISTENERS */
  function onResize() {
    const a = window.innerWidth / window.innerHeight;
    camera.left = (-CONSTANTS.FRUSTUM * a) / 2;
    camera.right = (CONSTANTS.FRUSTUM * a) / 2;
    camera.top = CONSTANTS.FRUSTUM / 2;
    camera.bottom = -CONSTANTS.FRUSTUM / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    ssaoPass.setSize(window.innerWidth, window.innerHeight);
    bloomPass.setSize(window.innerWidth, window.innerHeight);
    fxaaPass.material.uniforms['resolution'].value.set(
      1 / (window.innerWidth * renderer.getPixelRatio()),
      1 / (window.innerHeight * renderer.getPixelRatio())
    );
  }
  function onPointerMove(ev) {
    if (state.mode !== MODES.PLAYING) return;
    const p = worldFromEvent(ev);
    if (!p) return;
    const cell = snapCell(p);
    if (!cell) { ghost.visible = false; rangeRing.visible = false; return; }
    const w = cellToWorld(cell);
    const ok = canBuild(cell) && state.gold >= TOWER_TYPES[state.selected].cost;
    ghost.position.set(w.x, 0.46, w.z);
    ghost.visible = true;
    ghost.traverse((o) => { if (o.isMesh) o.visible = true; });
    ghost.traverse((o) => {
      if (o.isMesh && o.material && 'opacity' in o.material) { /* keep */ }
    });
    ghost.userData.valid = ok;
    setGhostTint(ok);
    rangeRing.visible = true;
    rangeRing.position.set(w.x, 0.6, w.z);
    const r = TOWER_TYPES[state.selected].range;
    rangeRing.scale.setScalar(r);
  }
  let ghostMatsPatched = false;
  function setGhostTint(ok) {
    if (!ghostMatsPatched) {
      ghost.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.transparent = true;
          o.material.opacity = 0.5;
        }
      });
      ghostMatsPatched = true;
    }
    ghost.traverse((o) => {
      if (o.isMesh && o.material.emissive) {
        o.material.emissive.setHex(ok ? theme.ui.ok : theme.ui.bad);
        o.material.emissiveIntensity = 0.5;
      }
    });
    rangeRing.material.color.setHex(ok ? theme.ui.ok : theme.ui.bad);
  }
  function onPointerDown(ev) {
    audio.ensure();
    if (state.mode === MODES.TITLE) { startRun(); return; }
    if (state.mode === MODES.GAMEOVER || state.mode === MODES.VICTORY) { restart(); return; }
    if (ev.target && ev.target.closest && ev.target.closest('.hud-panel, .screen, .palette')) return;
    const p = worldFromEvent(ev);
    if (!p) return;
    const cell = snapCell(p);
    if (!cell) return;
    if (state.grid.has(cell[0] + ',' + cell[1])) sellTower(cell);
    else buildTower(cell);
  }
  function onKey(ev) {
    if (ev.key === '1') selectKind('ballista');
    else if (ev.key === '2') selectKind('frost');
    else if (ev.key === '3') selectKind('mortar');
  }
  function selectKind(k) {
    state.selected = k;
    hud.markPalette(k, TOWER_TYPES[k]);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKey);
  function cleanup() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKey);
  }

  hud.buildPalette(TOWER_TYPES, state.selected, (k) => {
    selectKind(k);
    audio.ensure();
  });
  hud.markPalette(state.selected, TOWER_TYPES[state.selected]);
  if (state.bestWave > 0) hud.toast(`存档载入：最佳第 ${state.bestWave} 波`, 'info');
  raf = requestAnimationFrame(frame);

  /* ------------------------------------------------- 27. DEBUG HOOKS */
  window.render_game_to_text = () =>
    JSON.stringify({
      mode: state.mode,
      wave: state.wave,
      gold: state.gold,
      lives: state.lives,
      alive: enemies.filter((e) => e.alive).length,
      towers: towers.length,
      score: state.killed,
      time: +state.time.toFixed(2),
      particles: particles.count(),
    });
  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) update(CONSTANTS.FIXED_DT);
  };
  window.__diag = () => ({
    threeRevision: THREE.REVISION,
    theme: theme.id,
    lights: scene.children.filter((o) => o.isLight).map((l) => ({
      type: l.type, intensity: +l.intensity.toFixed(3),
      color: '#' + l.color.getHexString().toUpperCase(), castShadow: !!l.castShadow,
    })),
    renderer: {
      toneMapping: renderer.toneMapping === THREE.ACESFilmicToneMapping ? 'ACESFilmic' : String(renderer.toneMapping),
      exposure: renderer.toneMappingExposure,
      outputColorSpace: renderer.outputColorSpace,
      shadowType: renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoft' : String(renderer.shadowMap.type),
      shadowEnabled: renderer.shadowMap.enabled,
      pixelRatio: renderer.getPixelRatio(),
      size: [renderer.domElement.width, renderer.domElement.height],
    },
    passes: composer.passes.map((p) => p.label || p.constructor.name),
    bloom: { strength: bloomPass.strength, radius: bloomPass.radius, threshold: bloomPass.threshold },
    ssao: { kernelRadius: ssaoPass.kernelRadius, min: ssaoPass.minDistance, max: ssaoPass.maxDistance },
    vignette: gradePass.uniforms.vignetteIntensity.value,
    grade: {
      brightness: gradePass.uniforms.brightness.value,
      contrast: gradePass.uniforms.contrast.value,
      saturation: gradePass.uniforms.saturation.value,
    },
    shadow: { mapSize: keyLight.shadow.mapSize.width, normalBias: keyLight.shadow.normalBias, bias: keyLight.shadow.bias },
    envMap: !!scene.environment,
    skyDome: !!skyDome,
    fog: { color: '#' + scene.fog.color.getHexString().toUpperCase(), density: scene.fog.density },
    sceneColors: (() => {
      const out = [];
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const mm = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mm || !mm.color) return;
        const hex = mm.color.getHex(THREE.SRGBColorSpace);
        out.push({
          kind: o.userData.kind || o.parent?.userData?.kind || 'unknown',
          r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255,
          hex: '#' + hex.toString(16).padStart(6, '0').toUpperCase(),
          matType: mm.type, basic: mm.type === 'MeshBasicMaterial',
          emissive: mm.emissive ? mm.emissive.getHex(THREE.SRGBColorSpace) : 0,
          emissiveIntensity: mm.emissiveIntensity === undefined ? 0 : mm.emissiveIntensity,
          castShadow: !!o.castShadow,
        });
      });
      return out;
    })(),
    counts: (() => {
      const parts = (root) => {
        let n = 0;
        root.traverse((o) => { if (o !== root && o.isMesh) n++; });
        return n;
      };
      return {
        towerParts: Object.fromEntries(Object.keys(TOWER_TYPES).map((k) => [k, parts(createTower(k))])),
        enemyParts: Object.fromEntries(['runner', 'brute', 'swift', 'titan'].map((t) => [t, parts(createEnemy(t))])),
        scatter: scatterCount,
        scatterGeo: scatterMesh.geometry.type,
        pads: pads.length,
        projectileCreated: projectiles.created,
        projectileActive: projectiles.active.length,
        poolFloor: CONSTANTS.PROJ_POOL,
      };
    })(),
    state,
    pathLen: +pathLen.toFixed(2),
  });
  window.__game = {
    state, enemies, towers, scene, camera, renderer, composer, buildTower, sellTower,
    canBuild, isOnPath, WAVES, TOWER_TYPES, CONSTANTS, cleanup, particles, restart, startRun,
    wps, curve, cellToWorld, pathLen, THREE,
  };

  return { state, scene, renderer, composer, hud, cleanup };
}

/* ============================ 20. HUD DOM (built from theme skin) ===== */
function buildHud(theme, domTarget) {
  const root = domTarget || document.body;
  const wrap = document.createElement('div');
  wrap.innerHTML = theme.hudHtml;
  while (wrap.firstChild) root.appendChild(wrap.firstChild);
  const $ = (s) => document.querySelector(s);
  const goldEl = $('#gold-value');
  const livesEl = $('#lives-value');
  const waveEl = $('#wave-value');
  const hpFill = $('#lives-bar-fill');
  const vign = $('#damage-vignette');
  const feed = $('#kill-feed');
  const toasts = $('#toast-container');
  const ann = $('#announcement');
  const paletteEl = $('#build-palette');
  let shownGold = 0;
  let annTimer = null;
  const api = {
    setGold(v, snap) {
      if (shownGold === v) return;
      if (snap) shownGold = v;
      shownGold += Math.sign(v - shownGold) * Math.max(1, Math.ceil(Math.abs(v - shownGold) * 0.25));
      if (Math.abs(shownGold - v) <= 1) shownGold = v;
      goldEl.textContent = shownGold.toLocaleString('en-US');
    },
    setLives(v) {
      livesEl.textContent = Math.max(0, v);
      const pct = Math.max(0, Math.min(100, (v / CONSTANTS.START_LIVES) * 100));
      hpFill.style.width = pct.toFixed(1) + '%';
      hpFill.style.background = pct > 60 ? 'linear-gradient(90deg,#22c55e,#4ade80)'
        : pct > 30 ? 'linear-gradient(90deg,#eab308,#fbbf24)' : 'linear-gradient(90deg,#dc2626,#ef4444)';
    },
    setWave(n) { waveEl.textContent = n + ' / ' + WAVES.length; },
    killFeed(text) {
      const d = document.createElement('div');
      d.className = 'kill-entry';
      d.textContent = text;
      feed.appendChild(d);
      while (feed.children.length > 5) feed.removeChild(feed.firstChild);
      setTimeout(() => { if (d.parentNode) d.remove(); }, 3200);
    },
    clearFeed() { feed.innerHTML = ''; },
    toast(text, type) {
      const d = document.createElement('div');
      d.className = 'toast toast-' + (type || 'info');
      d.textContent = text;
      toasts.appendChild(d);
      setTimeout(() => d.classList.add('show'), 16);
      setTimeout(() => { d.classList.remove('show'); setTimeout(() => d.remove(), 340); }, 1900);
    },
    announce(t, sub) {
      $('#announce-text').textContent = t;
      $('#announce-sub').textContent = sub || '';
      ann.classList.add('show');
      clearTimeout(annTimer);
      annTimer = setTimeout(() => ann.classList.remove('show'), 1900);
    },
    damageFlash() {
      if (!vign) return;
      vign.classList.add('hit');
      setTimeout(() => vign.classList.remove('hit'), 260);
    },
    show(which) { document.querySelectorAll('[data-screen="' + which + '"]').forEach((e) => e.classList.add('on')); },
    hide(which) { document.querySelectorAll('[data-screen="' + which + '"]').forEach((e) => e.classList.remove('on')); },
    showOver(won, s) {
      api.hide('title');
      api.show('over');
      $('#over-title').textContent = won ? '哨站守住了' : '防线崩溃';
      $('#over-stats').innerHTML = `
        <span>抵达波次<b>${s.wave}/${WAVES.length}</b></span>
        <span>击破<b>${s.killed}</b></span>
        <span>泄漏<b>${s.leaked}</b></span>
        <span>剩余金币<b>${s.gold}</b></span>
        <span>用时<b>${s.time.toFixed(0)}s</b></span>
        <span>历史最佳<b>第 ${s.bestWave} 波</b></span>
        <span>累计胜场<b>${s.wins}</b></span>`;
    },
    buildPalette(types, selected, onPick) {
      paletteEl.innerHTML = '';
      for (const [k, def] of Object.entries(types)) {
        const b = document.createElement('button');
        b.className = 'palette';
        b.dataset.kind = k;
        b.innerHTML = `<span class="pk">${k === 'ballista' ? '1' : k === 'frost' ? '2' : '3'}</span>
          <span class="pn">${def.name}</span><span class="pc" data-cost="${def.cost}">${def.cost}◈</span>
          <span class="pd">射程 ${def.range} · ${def.kind === 'pulse' ? '减速' : '伤害 ' + def.damage}</span>`;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); onPick(k); });
        paletteEl.appendChild(b);
      }
    },
    markPalette(k) {
      document.querySelectorAll('.palette').forEach((b) => b.classList.toggle('sel', b.dataset.kind === k));
    },
    tick() {},
  };
  api.setLives(CONSTANTS.START_LIVES);
  api.setWave(0);
  return api;
}
