/* Node 侧「第二解析器」：自己解 WAV 容器、自己做 radix-2 FFT、自己按共享口径聚合 64 带。
 * 它不给浏览器看，只用来产出一条与画面完全无关的对照真值（evidence/ground-truth.json）。
 * 浏览器里那份是 Chrome 的 AnalyserNode（另一套 FFT、另一套重采样后的采样率），
 * 两边只在 features.js 的聚合与起拍算法上同源 —— 对得上才算「音频读数是真的」。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bandEdges, COARSE } from "../src/bands.js";
import { DB_FLOOR, DB_CEIL, binsToUnits, aggregateBands, coarseFromBands, createOnsetDetector, fluxOf } from "../src/features.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const FFT_SIZE = 2048;
const HOP = 256;
const CF_DB_CEIL = -30;              /* AnalyserNode 的默认上限，用来算反事实读数 */

/* ---- WAV 解码（自带，不用任何库） ---- */
function decodeWav(file) {
  const b = fs.readFileSync(file);
  const riff = b.toString("ascii", 0, 4);
  const wave = b.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let fmt = null, dataOffset = 0, dataLength = 0, p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") {
      fmt = {
        audioFormat: b.readUInt16LE(p + 8),
        channels: b.readUInt16LE(p + 10),
        sampleRate: b.readUInt32LE(p + 12),
        byteRate: b.readUInt32LE(p + 16),
        blockAlign: b.readUInt16LE(p + 20),
        bitsPerSample: b.readUInt16LE(p + 22)
      };
    } else if (id === "data") {
      dataOffset = p + 8;
      dataLength = size;
    }
    p += 8 + size + (size % 2);
  }
  if (!fmt || !dataLength) throw new Error("missing fmt/data chunk");
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16 || fmt.channels !== 1) {
    throw new Error("expected 16-bit mono PCM, got " + JSON.stringify(fmt));
  }
  const n = Math.floor(dataLength / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = b.readInt16LE(dataOffset + i * 2) / 32768;
  return { fmt, samples, headerBytes: dataOffset };
}

/* ---- radix-2 FFT（迭代、原位） ---- */
const REV = new Uint16Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let r = 0;
  for (let k = 0; k < 11; k++) r = (r << 1) | ((i >> k) & 1);
  REV[i] = r;
}
const hann = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);

function fftMagnitudes(window) {
  for (let i = 0; i < FFT_SIZE; i++) {
    re[i] = window[i] * hann[i];
    im[i] = 0;
  }
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = REV[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < FFT_SIZE; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const half = FFT_SIZE / 2;
  const out = new Float32Array(half);
  /* 归一：满刻度正弦在其 bin 上约 0 dB（与 Chrome 的约定不必完全相等，偏移量本身是一个读数） */
  const scale = 2 / (FFT_SIZE * 0.42);        /* 0.42 ≈ Hann 的相干增益 */
  for (let i = 0; i < half; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * scale;
    out[i] = mag;
  }
  return out;
}

/* ---- 逐帧特征 ---- */
/* 反事实口径：AnalyserNode 的默认 maxDecibels（文件顶部 CF_DB_CEIL）。我们不用它，但必须能
 * 证明「不用」的理由，所以同一次 FFT 再走一遍 -30 的 dB→字节映射——只有窗口参数不同，
 * FFT / 带边界 / 带内均值全部共享，两口径之差就是纯窗口之差。 */
const { fmt, samples } = decodeWav(path.join(ROOT, "audio", "track.wav"));
const binWidth = fmt.sampleRate / FFT_SIZE;
const edges = bandEdges();
const frames = [];
const cfRows = [];
let prevBands = null;
const detector = createOnsetDetector();
const onsetTimes = [];

for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP) {
  const view = samples.subarray(start, start + FFT_SIZE);
  let sumSq = 0, peak = 0;
  for (let i = 0; i < view.length; i++) { sumSq += view[i] * view[i]; peak = Math.max(peak, Math.abs(view[i])); }
  const mags = fftMagnitudes(view);
  /* 量化到 1/255：浏览器那侧是 getByteFrequencyData 的整数，Node 不量化就会多出一层系统性平滑 */
  const units = binsToUnits(mags);
  for (let i = 0; i < units.length; i++) units[i] = Math.round(units[i] * 255) / 255;
  const dbBands = aggregateBands(units, binWidth, edges);
  /* 同一份 FFT，只把 dB 窗口换成 AnalyserNode 默认上限，得到反事实带 */
  const cfUnits = binsToUnits(mags, DB_FLOOR, CF_DB_CEIL);
  for (let i = 0; i < cfUnits.length; i++) cfUnits[i] = Math.round(cfUnits[i] * 255) / 255;
  const cfBands = aggregateBands(cfUnits, binWidth, edges);
  const flux = fluxOf(prevBands, dbBands);
  const t = (start + FFT_SIZE / 2) / fmt.sampleRate;
  cfRows.push({ t, bands: cfBands });
  const res = detector.push(flux, t);
  if (res.beat) onsetTimes.push(Number(t.toFixed(4)));
  let argmax = 0;
  for (let i = 1; i < dbBands.length; i++) if (dbBands[i] > dbBands[argmax]) argmax = i;
  const coarse = coarseFromBands(dbBands);
  frames.push({
    t: Number(t.toFixed(5)),
    level: Math.sqrt(sumSq / view.length),
    peak,
    flux: Number(flux.toFixed(6)),
    bass: coarse.bass, mid: coarse.mid, treble: coarse.treble,
    argmaxBand: argmax,
    bands: dbBands.map(v => Number(v.toFixed(4)))
  });
  prevBands = dbBands;
}

/* ---- 汇总读数 ---- */
function median(xs) { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function windowStats(t0, t1, key) {
  const xs = frames.filter(f => f.t >= t0 && f.t < t1).map(f => f[key]);
  return { n: xs.length, median: median(xs), max: Math.max(...xs) };
}

/* 小节窗口从合成清单推导，不写死秒数：groove 小节被 breakdown 打断，
 * 写死 [4,10) 会悄悄漏掉第 07/08 小节——这类「手写死的区间」是历轮记过的坑。 */
const specJson = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "audio-spec.json"), "utf8"));
const barSec = specJson.synth.durationSec / specJson.synth.bars;
const grooveBars = specJson.facts.grooveBars;
const breakdownBar = specJson.facts.breakdownBar;
const inGroove = (t) => grooveBars.some((b) => t >= b * barSec && t < (b + 1) * barSec);
const inBreakdown = (t) => t >= breakdownBar * barSec + 0.2 && t < (breakdownBar + 1) * barSec - 0.2;
const grooveMedianBass = median(frames.filter(f => inGroove(f.t)).map(f => f.bass));
const breakdownMedianBass = median(frames.filter(f => inBreakdown(f.t)).map(f => f.bass));

/* 饱和率：字节刻度顶到 1.0 的 texel 占比。这是「着色器还能不能分辨两个时刻」的前置条件——
 * 一片恒等于 1.0 的频谱，任何音频驱动断言都会自我证明（历轮「退化输入上恒等式自证」的同族）。
 * 顶部/底部各算一次，并单独算低频 12 带（底鼓最容易被顶满）。 */
function saturationRate(rows, where, from, to) {
  let full = 0, zero = 0, total = 0;
  for (const f of rows) {
    if (!where(f.t)) continue;
    for (let i = from; i < to; i++) {
      total++;
      if (f.bands[i] >= 0.9999) full++;
      if (f.bands[i] <= 0.0001) zero++;
    }
  }
  return { total, full, fullRate: Number((full / total).toFixed(4)), zeroRate: Number((zero / total).toFixed(4)) };
}
const ALL = () => true;
const SATS = (rows) => ({
  wholeTrack: saturationRate(rows, ALL, 0, 64),
  bassBands: saturationRate(rows, ALL, 0, 12),
  grooveBass: saturationRate(rows, inGroove, 0, 12),
  breakdownBass: saturationRate(rows, inBreakdown, 0, 12)
});

/* 低频 12 带的中位数序列，两个口径各算一次。
 * 判据不是「响段与静段的差」——那个差在 -30 下反而更大（顶到 1.0 了当然更响）；
 * 真正的判据是「响段内部还分不分得出层次」：底鼓/贝斯的动态一旦被夹到 1.0，
 * groove 小节就退化成一条常数线，任何「画面随音乐变」的断言都在这里自我证明。 */
function bassSeries(rows, where) {
  return rows.filter(f => where(f.t)).map(f => median(f.bands.slice(0, 12)));
}
function seriesStats(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length);
  const uniq = new Set(xs.map(v => v.toFixed(4))).size;
  const pinned = xs.filter(v => v >= 0.9999).length;
  return {
    n: xs.length,
    median: Number(median(xs).toFixed(4)),
    mean: Number(mean.toFixed(4)),
    sd: Number(sd.toFixed(4)),
    uniqueValues: uniq,
    pinnedAtOne: Number((pinned / xs.length).toFixed(4))
  };
}
const stGroove = seriesStats(bassSeries(frames, inGroove));
const stBreak = seriesStats(bassSeries(frames, inBreakdown));
const stCfGroove = seriesStats(bassSeries(cfRows, inGroove));
const stCfBreak = seriesStats(bassSeries(cfRows, inBreakdown));

const summary = {
  container: { sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bitsPerSample, samples: samples.length, durationSec: samples.length / fmt.sampleRate, headerBytes: 44 },
  frameCount: frames.length,
  fftSize: FFT_SIZE,
  hop: HOP,
  binWidthHz: Number(binWidth.toFixed(4)),
  bandEdges: { count: edges.length - 1, lo: Number(edges[0].toFixed(3)), hi: Number(edges[edges.length - 1].toFixed(1)) },
  coarse: COARSE,
  scale: { dbFloor: DB_FLOOR, dbCeil: DB_CEIL },
  saturation: SATS(frames),
  /* 反事实：把上限换成 AnalyserNode 默认的 -30，其余完全相同（同一批帧、同一套带边界） */
  counterfactualCeilMinus30: {
    dbCeil: CF_DB_CEIL,
    saturation: SATS(cfRows),
    bassSeriesGroove: stCfGroove,
    bassSeriesBreakdown: stCfBreak,
    grooveBreakdownGap: Number(Math.abs(stCfGroove.median - stCfBreak.median).toFixed(4))
  },
  bassWindowAtCeil: {
    ceil: DB_CEIL,
    groove: stGroove,
    breakdown: stBreak,
    grooveBreakdownGap: Number(Math.abs(stGroove.median - stBreak.median).toFixed(4))
  },
  windows: { barSec, grooveBars, breakdownBar },
  onsets: onsetTimes.length,
  onsetTimes,
  dips: {
    grooveMedianBass: Number(grooveMedianBass.toFixed(4)),
    breakdownMedianBass: Number(breakdownMedianBass.toFixed(4)),
    ratio: Number((breakdownMedianBass / (grooveMedianBass || 1)).toFixed(4))
  },
  perBar: Array.from({ length: 8 }, (_, bar) => ({
    bar,
    level: windowStats(bar * barSec, (bar + 1) * barSec, "level"),
    bass: windowStats(bar * barSec, (bar + 1) * barSec, "bass"),
    mid: windowStats(bar * barSec, (bar + 1) * barSec, "mid"),
    treble: windowStats(bar * barSec, (bar + 1) * barSec, "treble")
  }))
};

const evidenceDir = path.join(ROOT, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "ground-truth.json"), JSON.stringify({ summary, frames }, null, 1));
fs.writeFileSync(path.join(evidenceDir, "ground-truth-frames.csv"),
  "t,level,bass,mid,treble,flux,argmax\n" + frames.map(f =>
    [f.t, f.level.toFixed(5), f.bass.toFixed(4), f.mid.toFixed(4), f.treble.toFixed(4), f.flux.toFixed(5), f.argmaxBand].join(",")).join("\n"));

console.log("frames", frames.length, "binWidth", binWidth.toFixed(2) + "Hz",
  "onsets", onsetTimes.length, "bass groove/breakdown",
  summary.dips.grooveMedianBass, "/", summary.dips.breakdownMedianBass, "ratio", summary.dips.ratio);
console.log("bass @ceil", DB_CEIL, "sat.fullRate", summary.saturation.grooveBass.fullRate,
  "sd/uniq", stGroove.sd, stGroove.uniqueValues,
  "| @ceil", CF_DB_CEIL, "sat.fullRate", summary.counterfactualCeilMinus30.saturation.grooveBass.fullRate,
  "sd/uniq/pinned", stCfGroove.sd, stCfGroove.uniqueValues, stCfGroove.pinnedAtOne);
