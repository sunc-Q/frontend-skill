/* 共享频谱口径：一份定义，Node 与浏览器两个独立实现都从这里取带边界。
 * 放在 src/bands.js，构建脚本把它 JSON 化注入宿主（三页逐字节相同），
 * Node 侧分析器 import 同一个文件 —— 于是「带边界」不是两边各自抄一遍的常数。 */

export const SAMPLE_HINT = 22050;

/* 64 个对数分布频带：40 Hz → 11000 Hz */
export const BAND_COUNT = 64;
export const BAND_LO = 40;
export const BAND_HI = 11000;

export function bandEdges(count = BAND_COUNT, lo = BAND_LO, hi = BAND_HI) {
  const edges = [];
  for (let i = 0; i <= count; i++) {
    edges.push(lo * Math.pow(hi / lo, i / count));
  }
  return edges;
}

/* 三条粗带（宿主与 Node 都用同一函数从 64 带聚合，省得两边各写一遍边界） */
export const COARSE = [
  { name: "bass", from: 0, to: 12 },
  { name: "mid", from: 12, to: 34 },
  { name: "treble", from: 34, to: 64 }
];

export function coarseOf(bandValues, spec = COARSE) {
  const out = {};
  for (const c of spec) {
    let s = 0;
    for (let i = c.from; i < c.to; i++) s += bandValues[i];
    out[c.name] = s / (c.to - c.from);
  }
  return out;
}

export default { SAMPLE_HINT, BAND_COUNT, BAND_LO, BAND_HI, bandEdges, COARSE, coarseOf };
