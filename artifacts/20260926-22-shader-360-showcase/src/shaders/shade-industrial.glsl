// ============================================================
// SHADE-BEGIN industrial · brushed-safety（工业配置器：拉丝钢 + 安全黄喷涂）
// 分区主张：壶嘴面整片喷涂安全黄（与 vitrine/plaque 同一个 spoutFace()），
// 腹部一条 20–160 mm 的黄色识别带（视角不变），机身其余为拉丝钢。
// 拉丝 = 沿 y 的高频调制，specular 被它打散成横纹；这是本风格独有的着色手法，
// 因此在「同剪影」判据之外还提供一条独立的皮肤互异证据。
// ============================================================
const vec3 I_STEEL = {{col:--i-steel}};
const vec3 I_PAINT = {{col:--i-paint}};
const vec3 I_DARK = {{col:--i-dark}};

vec3 shadeSurface(vec3 pos, vec3 n, vec3 rd) {
  vec3 v = -rd;
  vec3 h = normalize(KEY_DIR + v);
  float ndl = max(dot(n, KEY_DIR), 0.0);
  float ao = calcAO(pos, n);
  float brushed = 0.78 + 0.22 * (0.5 + 0.5 * sin(pos.y * 320.0));
  float spec = pow(max(dot(n, h), 0.0), 26.0) * brushed;
  float seam = 1.0 - 0.55 * step(0.985, abs(fract(pos.y * 3.2) - 0.5) * 2.0);
  float panel = spoutFace(pos) * step(pos.y, LID_Y);
  float stripe = step(BAND_Y_LOW, pos.y) * step(pos.y, BAND_Y_HIGH);
  float brass = step(ZONE_BRASS_Y, pos.y) * step(length(pos.xz), ZONE_LID_R);
  vec3 base = mix(I_STEEL, I_PAINT, clamp(panel + stripe * (1.0 - panel), 0.0, 1.0));
  base = mix(base, I_DARK, brass);
  vec3 col = base * (0.22 + 0.74 * ndl) * seam * ao;
  col += vec3(1.0, 1.0, 1.0) * spec * 0.55;
  return clamp(col, 0.0, 1.0);
}
// SHADE-END
