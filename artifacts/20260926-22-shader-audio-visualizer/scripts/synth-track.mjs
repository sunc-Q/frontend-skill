/* 确定性合成一首 16 秒的曲子，直接落 16-bit 单声道 WAV + 一份事实源 JSON。
 * 为什么自己合成而不找现成音频：
 *   1) 无人值守任务不能依赖外链（本任务硬约束「零外链」，音频也必须内联进页面）；
 *   2) 只有已知内容的信号，才能给「着色器真的被音频驱动」提供与画面无关的对照真值
 *      —— 每一脚底鼓、每一串噪声的时刻与频率都是写死的事实，浏览器读数要能对上。
 * 同一脚本两次运行必须逐字节相同（无 Math.random，噪声走带种子的 LCG）。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export const SR = 22050;
export const BPM = 120;
export const BEAT = 60 / BPM;          /* 0.5 s */
export const BAR = BEAT * 4;           /* 2.0 s */
export const BARS = 8;
export const DUR = BAR * BARS;         /* 16.0 s */
export const N = Math.round(DUR * SR);

/* 带种子的线性同余噪声源：可复现，故 WAV 的 sha 稳定 */
function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;      /* -1..1 */
  };
}

const rnd = lcg(20260926);
const noiseCache = new Float32Array(N);
for (let i = 0; i < N; i++) noiseCache[i] = rnd();

const buf = new Float32Array(N);
const events = [];                      /* 每一次发声：类型/时刻/标称频率 */

function addKick(t) {
  const i0 = Math.floor(t * SR);
  const len = Math.floor(0.30 * SR);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const u = i / SR;
    const f = 48 + 82 * Math.exp(-u / 0.028);          /* 130 → 48 Hz 扫频 */
    const env = Math.exp(-u / 0.11);
    buf[i0 + i] += Math.sin(2 * Math.PI * f * u) * env * 0.62;
  }
  events.push({ kind: "kick", t, hz: 48, bandHint: "bass" });
}

function addSnare(t) {
  const i0 = Math.floor(t * SR);
  const len = Math.floor(0.20 * SR);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const u = i / SR;
    const env = Math.exp(-u / 0.055);
    const nz = noiseCache[i0 + i] * env * 0.20;
    const tone = Math.sin(2 * Math.PI * 196 * u) * Math.exp(-u / 0.03) * 0.12;
    buf[i0 + i] += nz + tone;
  }
  events.push({ kind: "snare", t, hz: 196, bandHint: "mid" });
}

function addHat(t, open) {
  const i0 = Math.floor(t * SR);
  const decay = open ? 0.11 : 0.035;
  const len = Math.floor((open ? 0.28 : 0.10) * SR);
  for (let i = 1; i < len && i0 + i < N; i++) {
    const u = i / SR;
    const x = noiseCache[i0 + i];
    const hp = x - noiseCache[i0 + i - 1];             /* 一阶差分 = 高通，能量落在高频 */
    buf[i0 + i] += hp * Math.exp(-u / decay) * 0.16;
  }
  events.push({ kind: open ? "hat-open" : "hat", t, hz: 7600, bandHint: "treble" });
}

function addBass(t, hz) {
  const i0 = Math.floor(t * SR);
  const len = Math.floor(0.24 * SR);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const u = i / SR;
    buf[i0 + i] += Math.sin(2 * Math.PI * hz * u) * Math.exp(-u / 0.13) * 0.26;
  }
  events.push({ kind: "bass", t, hz, bandHint: "bass" });
}

function addLead(t, hz, durSec) {
  const i0 = Math.floor(t * SR);
  const len = Math.floor(durSec * SR);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const u = i / SR;
    const env = Math.min(1, u / 0.012) * Math.exp(-u / (durSec * 0.55));
    buf[i0 + i] += (Math.sin(2 * Math.PI * hz * u) + 0.28 * Math.sin(2 * Math.PI * hz * 2 * u)) * env * 0.13;
  }
  events.push({ kind: "lead", t, hz, bandHint: hz > 700 ? "treble-edge" : "mid" });
}

/* 铺底：Am 和弦（A3/C4/E4），整曲在响，给出稳定的中频底 */
const PAD = [220, 261.63, 329.63];
for (let i = 0; i < N; i++) {
  const u = i / SR;
  const swell = Math.min(1, u / 0.6);
  let v = 0;
  for (let k = 0; k < PAD.length; k++) {
    v += Math.sin(2 * Math.PI * PAD[k] * u + k * 0.7) * (0.05 - 0.008 * k);
  }
  buf[i] += v * swell;
}

const LEAD_PATTERN = [440, 523.25, 659.25, 587.33, 523.25, 440, 392, 440];
const GROOVE = new Set([2, 3, 4, 6, 7]);       /* 有鼓组的 bar 序号（0 基） */

for (let bar = 0; bar < BARS; bar++) {
  const barT = bar * BAR;
  if (bar === 5) {                             /* breakdown：无鼓、无贝斯，只有一条上升的扫频噪声 */
    const i0 = Math.floor(barT * SR);
    const len = Math.floor(BAR * SR);
    for (let i = 1; i < len && i0 + i < N; i++) {
      const u = (i0 + i) / SR;
      const ramp = i / len;
      const x = noiseCache[i0 + i];
      buf[i0 + i] += (x - noiseCache[i0 + i - 1] * 0.4) * ramp * 0.09;
      buf[i0 + i] += Math.sin(2 * Math.PI * (200 + 1000 * ramp) * u) * ramp * 0.05;
    }
    events.push({ kind: "riser", t: barT, hz: 600, bandHint: "mid", sec: BAR });
    continue;
  }
  if (bar >= 1) {                              /*  hats：第 2 小节起进入，八分音符 */
    for (let e = 0; e < 8; e++) {
      const t = barT + e * (BEAT / 2);
      addHat(t, e === 7 && (bar === 4 || bar === 7));
    }
  }
  if (!GROOVE.has(bar)) continue;
  const octaveUp = bar >= 6;
  for (let b = 0; b < 4; b++) {
    const t = barT + b * BEAT;
    addKick(t);
    if (b === 1 || b === 3) addSnare(t);
    addBass(t, b % 2 === 0 ? 55 : 82.41);
    addBass(t + BEAT / 2, b % 2 === 0 ? 82.41 : 55);
    for (let s = 0; s < 2; s++) {
      const idx = (b * 2 + s) % LEAD_PATTERN.length;
      const hz = LEAD_PATTERN[idx] * (octaveUp ? 2 : 1);
      addLead(t + s * (BEAT / 2), hz, BEAT / 2);
    }
  }
  if (bar === 7) addTom(barT + 3.75 * BEAT);
}

function addTom(t) {
  const i0 = Math.floor(t * SR);
  const len = Math.floor(0.22 * SR);
  for (let i = 0; i < len && i0 + i < N; i++) {
    const u = i / SR;
    buf[i0 + i] += Math.sin(2 * Math.PI * (150 * Math.exp(-u / 0.08) + 90) * u) * Math.exp(-u / 0.1) * 0.3;
  }
  events.push({ kind: "tom", t, hz: 120, bandHint: "bass" });
}

/* 归一到峰值 0.85，再收 8 ms 首尾包络，避免爆音与循环咔哒 */
let rawPeak = 0;
for (let i = 0; i < N; i++) rawPeak = Math.max(rawPeak, Math.abs(buf[i]));
const gain = 0.85 / rawPeak;
for (let i = 0; i < N; i++) {
  let g = gain;
  const t = i / SR;
  if (t < 0.008) g *= t / 0.008;
  if (DUR - t < 0.03) g *= Math.max(0, (DUR - t) / 0.03);
  buf[i] = Math.max(-1, Math.min(1, buf[i] * g));
}

/* ---- WAV 编码 ---- */
function encodeWav(samples, sr) {
  const bytesPerSample = 2;
  const dataLen = samples.length * bytesPerSample;
  const out = Buffer.alloc(44 + dataLen);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataLen, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);                    /* PCM */
  out.writeUInt16LE(1, 22);                    /* mono */
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * bytesPerSample, 28);
  out.writeUInt16LE(bytesPerSample, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    out.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  }
  return out;
}

const wav = encodeWav(buf, SR);
const audioDir = path.join(ROOT, "audio");
fs.mkdirSync(audioDir, { recursive: true });
fs.writeFileSync(path.join(audioDir, "track.wav"), wav);

/* ---- 事实源 ---- */
const byKind = {};
for (const e of events) byKind[e.kind] = (byKind[e.kind] || 0) + 1;

const kickTimes = events.filter(e => e.kind === "kick").map(e => Number(e.t.toFixed(4)));
const snareTimes = events.filter(e => e.kind === "snare").map(e => Number(e.t.toFixed(4)));

const bars = [];
for (let bar = 0; bar < BARS; bar++) {
  const i0 = Math.round(bar * BAR * SR);
  const i1 = Math.min(N, Math.round((bar + 1) * BAR * SR));
  let sumSq = 0, peak = 0;
  for (let i = i0; i < i1; i++) { const v = buf[i]; sumSq += v * v; peak = Math.max(peak, Math.abs(v)); }
  bars.push({
    index: bar,
    from: Number((bar * BAR).toFixed(4)),
    to: Number(((bar + 1) * BAR).toFixed(4)),
    role: bar === 0 ? "pad" : bar === 1 ? "pad+hat" : bar === 5 ? "breakdown" : "groove",
    rms: Math.sqrt(sumSq / (i1 - i0)),
    peak
  });
}

let totalSq = 0, globalPeak = 0, clipped = 0;
for (let i = 0; i < N; i++) {
  totalSq += buf[i] * buf[i];
  globalPeak = Math.max(globalPeak, Math.abs(buf[i]));
  /* 削顶判据取量化后的整数值：只有写到 ±满刻度才算真削顶，0.9999 这种浮点阈值查不出问题 */
  const q = Math.round(buf[i] * 32767);
  if (q >= 32767 || q <= -32768) clipped++;
}

const spec = {
  generated_by: "scripts/synth-track.mjs",
  synth: { sampleRate: SR, channels: 1, bitDepth: 16, bpm: BPM, beatsPerBar: 4, bars: BARS, durationSec: DUR, peakTarget: 0.85, noiseSeed: 20260926 },
  facts: {
    samples: N,
    globalPeak,
    peakDbfs: 20 * Math.log10(globalPeak),
    rmsOverall: Math.sqrt(totalSq / N),
    clippedSamples: clipped,
    counts: byKind,
    kickTimes,
    snareTimes,
    bars,
    leadPatternHz: LEAD_PATTERN,
    padHz: PAD,
    grooveBars: [...GROOVE].sort((a, b) => a - b),
    breakdownBar: 5
  },
  events: events.map(e => ({ ...e, t: Number(e.t.toFixed(4)) }))
};

fs.writeFileSync(path.join(ROOT, "src", "audio-spec.json"), JSON.stringify(spec, null, 2));

console.log("track.wav", wav.length, "bytes; peak", globalPeak.toFixed(6),
  "; events", JSON.stringify(byKind), "; clipped", clipped);
