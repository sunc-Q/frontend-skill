// ============================================================
// SHADE-BEGIN plaque · matte-plaster（展签美术馆：哑光石膏 + 软遮蔽）
// 分区主张：与 vitrine 用同一个 spoutFace() 判据，只是把「镀黄铜」换成「深色修复补块」——
// 于是两套皮肤在同一角度上的剪影、分区边界必须完全相同，只有反照率不同。
// 高光是零：皮肤主张「无反射」，所以 uTime 在本块一次都不出现（这是可机检的）。
// ============================================================
const vec3 P_BODY = {{col:--p-body}};
const vec3 P_PATCH = {{col:--p-patch}};
const vec3 P_AMBIENT = {{col:--p-ambient}};

vec3 shadeSurface(vec3 pos, vec3 n, vec3 rd) {
  float ndl = max(dot(n, KEY_DIR), 0.0);
  float ao = calcAO(pos, n);
  float up = 0.5 + 0.5 * n.y;
  float patch = max(spoutFace(pos) * step(pos.y, LID_Y),
                    step(ZONE_BRASS_Y, pos.y) * step(length(pos.xz), ZONE_LID_R));
  vec3 base = mix(P_BODY, P_PATCH, patch);
  vec3 col = base * (0.34 + 0.52 * ndl + 0.14 * up) * ao;
  col += P_AMBIENT * (0.10 + 0.06 * up);
  return clamp(col, 0.0, 1.0);
}
// SHADE-END
