precision mediump float;

/* 频谱柱廊：刻意不声明 uTime —— 这一页的一切运动都必须来自音频，
 * 「没有 uTime 的着色器」让 ?probe=noaudio 消融臂成为最硬的判据：
 * 拔掉音频后两帧若逐像素相同，就说明画面里没有任何自带时钟。 */
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform vec2 uMouse;
uniform float uVariant;
uniform float uLevel;
uniform float uFlux;
uniform float uBeat;
uniform sampler2D uSpectrum;

uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uAccent;
uniform vec3 uLow;
uniform vec3 uMid3;
uniform vec3 uHigh;

#define BANDS 64.0
#define STEPS 10.0

float bandMask(float idx) {
  /* uVariant：0 全带（主画面）/ 1 低频段 / 2 中频段 / 3 高频段（分频子视口） */
  if (uVariant < 0.5) return 1.0;
  if (uVariant < 1.5) return idx < 12.0 ? 1.0 : 0.0;
  if (uVariant < 2.5) return (idx >= 12.0 && idx < 34.0) ? 1.0 : 0.0;
  return idx >= 34.0 ? 1.0 : 0.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uOrigin) / uResolution;
  float col = floor(uv.x * BANDS);
  float value = texture2D(uSpectrum, vec2((col + 0.5) / BANDS, 0.5)).r * bandMask(col);

  /* 十级量化：柱廊要的是读数，不是连续光带 */
  float q = floor(value * STEPS) / STEPS;
  float h = 0.04 + q * 0.80 + uBeat * 0.06 * bandMask(col);

  float bandColor = col / BANDS;
  vec3 tint = mix(uLow, uMid3, smoothstep(0.10, 0.34, bandColor));
  tint = mix(tint, uHigh, smoothstep(0.48, 0.80, bandColor));

  vec3 color = uPaper;
  if (uv.y < h) {
    float cell = mod(uv.x * BANDS, 1.0);
    float fill = (cell > 0.14 && cell < 0.86) ? 1.0 : 0.28;
    color = mix(uPaper, tint, fill);
    if (uv.y > h - 0.02) color = uAccent;
  }
  if (uv.y < 0.014) color = uInk;

  /* uMouse.x = 探针列：把游标所在柱提亮，证明鼠标 uniform 真的到了片元 */
  float probeCol = floor(uMouse.x * BANDS);
  if (abs(col - probeCol) < 0.5 && uv.y < h) color = mix(color, uInk, 0.45);

  /* 顶部响度条：频谱之外的整体读数 */
  if (uv.y > 0.945 && uv.x < 0.03 + uLevel * 0.94) color = uAccent;
  if (uv.y > 0.945) color = mix(color, uInk, 0.10);
  /* 起拍闪烁：只作用于最上一条刻度带 */
  if (uv.y > 0.925 && uv.y < 0.94) color = mix(color, uAccent, uFlux * 2.2);

  gl_FragColor = vec4(color, 1.0);
}
