// 作品 III「丝绸极光」/ 风格 silk-aurora
// 技法：fbm 丝带（到扭曲曲线的距离场）+ 余弦调色板 + 加法干涉，亮底低对比
// 运行时：GLSL ES 1.0 / WebGL1
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uScroll;
uniform float uVariant;
uniform vec2 uOrigin;  // 本视口的窗口原点（strip 才有非零值）

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(269.5, 183.3))) * 32729.1237111);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 4; i++) {
    value += amp * vnoise(p);
    p = p * 2.11 + vec2(4.3, 2.8);
    amp *= 0.52;
  }
  return value;
}

vec3 silkPalette(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (vec3(0.98, 0.86, 0.72) * t + vec3(0.06, 0.34, 0.52)));
}

// 一条随时间摆动、被指针拉弯的丝带
float ribbon(vec2 p, float bend, float phase, float width) {
  float spine = 0.30 * sin(p.x * 1.6 + phase) + 0.16 * sin(p.x * 3.3 - phase * 0.7);
  float d = abs(p.y - spine + bend);
  return exp(-d * d / (width * width));
}

void main() {
  vec2 fc = gl_FragCoord.xy - uOrigin; // 视口内坐标：三带才在像素级可比
  vec2 uv = fc / max(uResolution.xy, vec2(1.0));
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);

  float variant = floor(uVariant + 0.5);
  float t = uTime * 0.16 + uScroll * 1.2;

  vec2 warp = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(8.2, 2.4) - t * 0.8));
  vec2 s = p + 0.42 * warp - (uMouse - 0.5) * vec2(0.9, 0.6);

  float band = 0.0;
  band += ribbon(s, 0.34 + variant * 0.06, t * 1.00, 0.26) * 1.00;
  band += ribbon(s, -0.18 - variant * 0.05, t * 1.37 + 2.1, 0.20) * 0.82;
  band += ribbon(s, 0.05, t * 0.81 + 4.2 + variant, 0.32) * 0.60;

  float grain = fbm(p * 6.5 - warp * 1.2 + vec2(0.0, t * 0.5));

  vec3 bone = vec3(0.937, 0.922, 0.882);
  vec3 color = bone;
  color = mix(color, silkPalette(0.10 * variant + band * 0.7 + t * 0.28), clamp(band * 0.62, 0.0, 0.92));
  color += (grain - 0.5) * 0.055;
  color += vec3(0.30, 0.34, 0.42) * pow(clamp(band - 0.72, 0.0, 1.0), 1.6) * 0.5;

  float edge = 1.0 - 0.22 * dot(uv - 0.5, uv - 0.5) * 2.0;
  color *= clamp(edge, 0.72, 1.0);

  gl_FragColor = vec4(color, 1.0);
}
