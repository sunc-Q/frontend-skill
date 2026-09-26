// ============================================================
// SHADE-BEGIN vitrine · glossy-ceramic（射灯橱窗：暗场 + 抛铜高光）
// 分区主张：壶嘴面（x>ZONE_SPOUT_X 且朝向观众的那半壳）镀黄铜，
// 其余为暗场釉面；盖钮恒为黄铜（回转体，视角不变量）。
// 所有彩色分量都必须来自 {{col:...}} 令牌，令牌值来自同风格 CSS 的 :root —— 由 build 代入、由 check 复算。
// ============================================================
const vec3 V_SHELL = {{col:--v-shell}};
const vec3 V_SHELL_DEEP = {{col:--v-shell-deep}};
const vec3 V_BRASS = {{col:--v-brass}};
const vec3 V_RIM = {{col:--v-rim}};
const vec3 V_SPEC = {{col:--v-spec}};

vec3 shadeSurface(vec3 pos, vec3 n, vec3 rd) {
  vec3 v = -rd;
  vec3 h = normalize(KEY_DIR + v);
  float ndl = max(dot(n, KEY_DIR), 0.0);
  float ao = calcAO(pos, n);
  float spec = pow(max(dot(n, h), 0.0), 72.0);
  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.6);
  float brass = max(spoutFace(pos) * step(pos.y, LID_Y),
                    step(ZONE_BRASS_Y, pos.y) * step(length(pos.xz), ZONE_LID_R));
  vec3 base = mix(V_SHELL, V_SHELL_DEEP, clamp(0.5 - 0.8 * n.y, 0.0, 1.0));
  base = mix(base, V_BRASS, brass);
  vec3 col = base * (0.18 + 0.86 * ndl) * ao;
  col += V_RIM * rim * 0.62;
  col += V_SPEC * spec * (0.58 + 0.16 * sin(uTime * 0.7));
  return clamp(col, 0.0, 1.0);
}
// SHADE-END
