precision mediump float;

/* 涟漪井月：径向频谱 + 低频驱动的同心波。uTime 只负责波的行进，
 * 半径、亮度、环数全部吃音频量 —— ?probe=frozen 冻掉 uTime 后画面仍在变。 */
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform vec2 uMouse;
uniform float uTime;
uniform float uVariant;
uniform float uLevel;
uniform float uBass;
uniform float uMid;
uniform float uTreb;
uniform float uBeat;
uniform sampler2D uSpectrum;

uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uAccent;
uniform vec3 uLow;
uniform vec3 uMid3;
uniform vec3 uHigh;

#define BANDS 64.0

float bandMask(float idx) {
  if (uVariant < 0.5) return 1.0;
  if (uVariant < 1.5) return idx < 12.0 ? 1.0 : 0.0;
  if (uVariant < 2.5) return (idx >= 12.0 && idx < 34.0) ? 1.0 : 0.0;
  return idx >= 34.0 ? 1.0 : 0.0;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uOrigin) / uResolution;
  vec2 aspect = vec2(uResolution.x / max(1.0, uResolution.y), 1.0);
  /* uMouse 把圆心推离正中：证明指针 uniform 与音频 uniform 走同一条通路 */
  vec2 c = (uv - 0.5) * aspect;
  c -= (uMouse - vec2(0.5, 0.5)) * aspect * 0.28;
  float r = length(c);
  float ang = atan(c.y, c.x);

  /* 该方向上的频谱值（按角度映射到 64 带），再乘分频掩码 */
  float bandIdx = floor(fract(ang / 6.2831853 + 0.5) * BANDS);
  float spec = texture2D(uSpectrum, vec2((bandIdx + 0.5) / BANDS, 0.5)).r * bandMask(bandIdx);

  /* 低频决定水面被压下去的半径；中高频决定环的密度 */
  float horizon = 0.06 + uBass * 0.42;
  float rings = sin((r - uTime * 0.16) * (26.0 + uMid * 44.0) - spec * 9.0);
  float band = smoothstep(0.55, 0.95, rings) * (1.0 - smoothstep(horizon, horizon + 0.34, r));

  /* 起拍：一圈从中心弹出的高亮 */
  float pulse = smoothstep(0.02, 0.0, abs(r - uBeat * 0.5)) * uBeat;

  vec3 tint = mix(uLow, uMid3, smoothstep(0.0, 0.45, spec));
  tint = mix(tint, uHigh, smoothstep(0.45, 0.9, spec));

  vec3 color = mix(uPaper, uInk, smoothstep(0.75, 0.0, r) * 0.35);
  color = mix(color, tint, band * (0.35 + 0.65 * uLevel));
  color = mix(color, uAccent, pulse * 0.9);
  /* 月盘：亮度只跟 uTreb 走 */
  float moon = smoothstep(0.115, 0.10, r);
  color = mix(color, mix(uAccent, uHigh, uTreb), moon * (0.25 + 0.75 * uTreb));
  /* 外圈噪点带（高频专用） */
  color = mix(color, uHigh, smoothstep(0.62, 0.66, r) * uTreb * bandMask(40.0) * 0.8);

  gl_FragColor = vec4(color, 1.0);
}
