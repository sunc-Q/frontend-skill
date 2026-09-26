// 作品 II「栅格磷光」/ 风格 crt-plasma
// 技法：像素量化（技能 snippet: pixelate）+ plasma + 扫描线（snippet: scanline）+ 光栅掩膜
//      指针命中处叠加环形波（snippet: ripple）
// 运行时：GLSL ES 1.0 / WebGL1
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uScroll;
uniform float uVariant;
uniform vec2 uOrigin;  // 本视口的窗口原点（strip 才有非零值）

// snippet: pixelate —— 量化 UV（原文签名保留）
vec2 pixelateUv(vec2 uv, vec2 pixelSize) {
  return floor(uv * pixelSize) / pixelSize;
}

// snippet: scanline —— 屏幕空间条带调制（原文签名保留）
float scanlineMask(float coord, float time, float density, float strength) {
  float scan = 0.5 + 0.5 * sin(coord * density + time * 6.0);
  return mix(1.0 - strength, 1.0, scan);
}

// snippet: ripple —— 径向环（原文签名保留）
float rippleRing(vec2 uv, float time) {
  vec2 p = uv * 2.0 - 1.0;
  float dist = length(p);
  float wave = sin(dist * 24.0 - time * 4.0);
  return smoothstep(0.2, 0.21, wave) - smoothstep(0.21, 0.22, wave);
}

float plasma(vec2 p, float t) {
  float v = sin(p.x * 3.1 + t);
  v += sin((p.y * 2.7 - t * 0.7) * 1.3);
  v += sin((p.x + p.y * 0.6) * 2.2 + t * 0.45);
  v += sin(1.0 + length(p * 1.9) * 3.0 - t * 0.8);
  return v * 0.25;
}

void main() {
  vec2 fc = gl_FragCoord.xy - uOrigin; // 视口内坐标：三带才在像素级可比
  vec2 uv = fc / max(uResolution.xy, vec2(1.0));
  float variant = floor(uVariant + 0.5);

  // 单元格尺寸随滚动与变体变化：34 -> 58 列
  float cells = 34.0 + variant * 8.0 + uScroll * 16.0;
  vec2 grid = vec2(cells, cells * (uResolution.y / max(uResolution.x, 1.0)));
  vec2 q = pixelateUv(uv, grid);

  vec2 p = (q * 2.0 - 1.0);
  p.x *= uResolution.x / max(uResolution.y, 1.0);
  p += (uMouse - 0.5) * 0.8; // 指针整体推移等离子场（环波之外的低频影响）

  float t = uTime * 0.55 + variant * 2.1;
  float field = plasma(p, t);

  vec3 off = vec3(0.016, 0.055, 0.035);
  vec3 phosphor = vec3(0.42, 1.0, 0.62);
  vec3 amber = vec3(1.0, 0.62, 0.16);
  float lvl = smoothstep(-0.35, 0.75, field);
  vec3 color = off + phosphor * lvl * 0.62 + amber * pow(lvl, 6.0) * 0.55;

  // 指针环波：只在光标附近叠加
  vec2 beam = vec2(uv.x, 1.0 - uv.y) - uMouse;
  beam.x *= uResolution.x / max(uResolution.y, 1.0);
  float ring = rippleRing(beam * 3.0 + 0.5, uTime * 0.8);
  color += vec3(0.55, 0.95, 0.75) * ring * 0.5;

  // 荫罩：按设备像素做 R/G/B 栅格
  float grille = mod(fc.x, 3.0);
  float g = grille < 1.0 ? 0.86 : (grille < 2.0 ? 1.0 : 0.9);
  color *= vec3(g, 1.0, g) ;

  float scan = scanlineMask(fc.y, uTime, 0.9, 0.22 + 0.1 * uScroll);
  color *= scan;

  // 滚动亮带（CRT 场回扫）
  float roll = fract(uv.y + uTime * 0.06);
  color += phosphor * smoothstep(0.985, 1.0, roll) * 0.5;

  // 暗角
  float vig = 1.0 - 0.45 * dot(uv - 0.5, uv - 0.5) * 2.2;
  color *= clamp(vig, 0.35, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
