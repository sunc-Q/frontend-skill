precision mediump float;

/* 声纹热力脊：滚动色谱。历史纹理由宿主每帧推进，uTime 只给当前列加一条呼吸线。 */
uniform vec2 uResolution;
uniform vec2 uOrigin;
uniform float uTime;
uniform float uVariant;
uniform float uLevel;
uniform float uTreb;
uniform sampler2D uSpectrum;
uniform sampler2D uHistory;

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
  /* x = 时间轴（右端为最新），y = 频带轴 */
  float bandF = uv.y * (BANDS - 1.0);
  float bandIdx = floor(bandF);
  float heat = texture2D(uHistory, vec2(uv.x, uv.y)).r * bandMask(bandIdx);

  /* 三段热力调色：冷 → 中 → 热 */
  vec3 cold = mix(uPaper, uInk, 0.35);
  vec3 color = mix(cold, uLow, smoothstep(0.05, 0.38, heat));
  color = mix(color, uMid3, smoothstep(0.38, 0.66, heat));
  color = mix(color, uHigh, smoothstep(0.66, 0.88, heat));
  color = mix(color, uAccent, smoothstep(0.88, 1.0, heat));

  /* 右端当前频谱线：热图之上叠一条即时读数 */
  float head = smoothstep(0.985, 1.0, uv.x);
  float live = texture2D(uSpectrum, vec2((bandIdx + 0.5) / BANDS, 0.5)).r * bandMask(bandIdx);
  color = mix(color, uAccent, head * step(abs(uv.y - live), 0.012));

  /* 高频毛刺带 + 呼吸线：uTreb 决定右侧毛刺高度，uTime 只负责线的位置 */
  if (uv.x > 0.992 && uv.y < uTreb) color = uHigh;
  float scan = fract(uTime * 0.11);
  if (abs(uv.x - scan) < 0.0035) color = mix(color, uAccent, 0.5 + 0.5 * uLevel);

  gl_FragColor = vec4(color, 1.0);
}
