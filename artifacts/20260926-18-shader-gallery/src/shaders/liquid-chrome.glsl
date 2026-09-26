// 作品 I「潮汐刻度」/ 风格 liquid-chrome
// 技法：value noise -> 三层域扭曲 fbm -> 余弦调色板的铬面高光
// 运行时：GLSL ES 1.0 / WebGL1（不使用 #version 300 es、不使用 in/out 内置）
// 宿主约定：uniform 一律 u 前缀；iTime/iResolution/fragCoord 等 ShaderToy 内置已全部换形
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;    // 0..1，y 由上向下
uniform float uScroll;  // 0..1 页面进度
uniform float uVariant; // 0/1/2 变体条
uniform vec2 uOrigin;  // 本视口的窗口原点（strip 才有非零值）

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return value;
}

vec3 chromePalette(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.62, 0.74, 0.92)));
}

mat2 rot2(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 fc = gl_FragCoord.xy - uOrigin; // 视口内坐标：三带才在像素级可比
  vec2 uv = fc / max(uResolution.xy, vec2(1.0));
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);

  float variant = floor(uVariant + 0.5);
  p = rot2(variant * 0.7854) * p;

  vec2 mouse = uMouse * 2.0 - 1.0;
  float t = uTime * 0.12 + uScroll * 1.6;

  // 三层域扭曲：q1 -> q2 -> f
  vec2 q = vec2(fbm(p * 1.4 + vec2(0.0, t)), fbm(p * 1.4 + vec2(5.2, 1.3) - t * 0.6));
  vec2 r = vec2(fbm(p * 1.7 + 2.2 * q + mouse * 0.35 + t * 0.3),
                fbm(p * 1.7 + 2.2 * q + vec2(3.7, 8.1) - t * 0.25));
  float f = fbm(p * 2.0 + 2.6 * r);

  float band = smoothstep(0.28, 0.86, f + 0.18 * length(q));
  float spec = pow(clamp(1.0 - abs(f - 0.52) * 2.6, 0.0, 1.0), 3.0);

  vec3 deep = vec3(0.020, 0.031, 0.062);
  vec3 mid = vec3(0.094, 0.176, 0.310);
  vec3 color = mix(deep, mid, band);
  color += chromePalette(0.18 * variant + band * 0.9 + t * 0.35) * spec * 0.72;
  color += vec3(0.74, 0.82, 0.96) * pow(spec, 2.4) * 0.35;

  float vig = 1.0 - 0.34 * dot(uv - 0.5, uv - 0.5) * 2.0;
  color *= clamp(vig, 0.55, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
