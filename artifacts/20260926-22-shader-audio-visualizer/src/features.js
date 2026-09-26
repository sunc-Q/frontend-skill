/* 共享特征层：带聚合、dB→字节口径、起拍（onset）检测器。
 * Node 侧分析器 import 这份文件，浏览器宿主由 build.mjs 把本文件正文原样内联——
 * 于是「两个解析器」的差只留在真正要比的地方（FFT 实现与被测对象），
 * 而不是两边各自抄一遍阈值。 */
import { bandEdges, COARSE, coarseOf, BAND_COUNT } from "./bands.js";

export const DB_FLOOR = -100;           /* 对齐 AnalyserNode 默认 minDecibels */
export const DB_CEIL = -10;             /* 故意不用默认的 -30：底鼓会把低频带顶满（见 saturation 反事实读数） */

/* 与浏览器 getByteFrequencyData 同一刻度：把 dB 线性映射到 0..255 再归一。
 * floor/ceil 可传参，是为了让分析器能用同一条公式算出「若用默认 -30 会饱和多少」的反事实读数，
 * 而不是另抄一份映射——两口径之差必须只来自窗口参数。 */
export function dbToUnit(db, floor = DB_FLOOR, ceil = DB_CEIL) {
  const v = (255 * (db - floor)) / (ceil - floor);
  return Math.max(0, Math.min(255, Math.round(v))) / 255;
}

export function binsToUnits(magnitudes, floor, ceil) {
  const out = new Float32Array(magnitudes.length);
  for (let i = 0; i < magnitudes.length; i++) {
    out[i] = dbToUnit(20 * Math.log10(Math.max(magnitudes[i], 1e-9)), floor, ceil);
  }
  return out;
}

/* 1024 个 bin 的字节刻度值（0..1）→ 64 个对数带（带内取均值）。
 * 两边必须是同一个「带内取均值」口径，否则差异就来自配方而不是解析器本身：
 *   Node 侧 = 自解 WAV + 自写 radix-2 FFT + Hann，逐 bin 走 dbToUnit 后传进来；
 *   浏览器  = Chrome 的 AnalyserNode.getByteFrequencyData（另一套 FFT、Blackman、且采样率被重采样过），
 *            每 bin 除以 255 后传进来。 */
export function aggregateBands(binUnits, binWidth, edges) {
  const e = edges || bandEdges();
  const out = new Array(e.length - 1).fill(0);
  for (let b = 0; b < out.length; b++) {
    const lo = Math.max(0, Math.floor(e[b] / binWidth));
    const hi = Math.min(binUnits.length - 1, Math.ceil(e[b + 1] / binWidth));
    let s = 0, n = 0;
    for (let i = lo; i <= hi; i++) { s += binUnits[i]; n++; }
    out[b] = n > 0 ? s / n : 0;
  }
  return out;
}

export function coarseFromBands(bands) {
  return coarseOf(bands, COARSE);
}

export const ONSET_WINDOW = 30;
export const ONSET_FACTOR = 1.35;
export const ONSET_FLOOR = 0.012;
export const ONSET_GAP = 0.12;

/* 通量门限起拍检测器：flux > 均值×系数 + 下限，且与上一拍间隔够大 */
export function createOnsetDetector() {
  const hist = [];
  let lastBeat = -1;
  return {
    push(flux, timeSec) {
      hist.push(flux);
      if (hist.length > ONSET_WINDOW) hist.shift();
      let mean = 0;
      for (const v of hist) mean += v;
      mean /= hist.length;
      const threshold = mean * ONSET_FACTOR + ONSET_FLOOR;
      const beat = flux > threshold && (lastBeat < 0 || timeSec - lastBeat >= ONSET_GAP) && hist.length >= 8;
      if (beat) lastBeat = timeSec;
      return { beat, threshold, meanFlux: mean, warm: hist.length >= 8 };
    },
    reset() { hist.length = 0; lastBeat = -1; }
  };
}

/* 帧间通量：只取上升沿，与宿主一致 */
export function fluxOf(prev, cur) {
  let s = 0;
  for (let i = 0; i < cur.length; i++) {
    const d = cur[i] - (prev ? prev[i] : 0);
    if (d > 0) s += d;
  }
  return s / cur.length;
}

export function bandCount() { return BAND_COUNT; }
