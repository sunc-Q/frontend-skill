// ============================================================
// GEOMETRY-BEGIN  （三套着色器共用的几何块，构建时逐字节注入，禁止手改任一份）
// 数值来源：src/product.json 的 geometry 段，由 build.mjs 现读代入。
// 单位=米；world +x = 壶嘴侧；壶盖钮是唯一的回转体特征。
// ============================================================
const float BODY_H = 0.300000;
const float BODY_R = 0.580000;
const float BODY_F = 0.160000;
const float BASE_Y = -0.420000;
const float BASE_H = 0.060000;
const float BASE_R = 0.460000;
const float LID_Y = 0.400000;
const float LID_H = 0.050000;
const float LID_R = 0.300000;
const float LID_F = 0.050000;
const vec3 KNOB_C = vec3(0.000000, 0.520000, 0.000000);
const float KNOB_R = 0.065000;
const vec3 SPOUT_A0 = vec3(0.420000, -0.120000, 0.000000);
const vec3 SPOUT_B0 = vec3(0.700000, 0.100000, 0.000000);
const float SPOUT_R0 = 0.075000;
const vec3 SPOUT_A1 = vec3(0.700000, 0.100000, 0.000000);
const vec3 SPOUT_B1 = vec3(0.800000, 0.400000, 0.000000);
const float SPOUT_R1 = 0.062000;
const vec3 SPOUT_A2 = vec3(0.800000, 0.400000, 0.000000);
const vec3 SPOUT_B2 = vec3(0.720000, 0.620000, 0.000000);
const float SPOUT_R2 = 0.050000;
const vec3 SPOUT_A3 = vec3(0.720000, 0.620000, 0.000000);
const vec3 SPOUT_B3 = vec3(0.600000, 0.700000, 0.000000);
const float SPOUT_R3 = 0.040000;
const vec3 HANDLE_C = vec3(-0.520000, 0.120000, 0.000000);
const float HANDLE_R = 0.300000;
const float HANDLE_T = 0.050000;
const float HANDLE_CUT = -0.060000;
const float SPHERE_R = 1.120000;
// 分区阈值：壶嘴/黄铜件在物体空间里的归属面。阈值都在 Z=0 平面上取值，
// 而本模型对 z→-z 严格对称，于是「分区面可见 ⟺ 该特征朝向观众」成为可断言的等价式。
const float ZONE_SPOUT_X = 0.600000;
const float ZONE_BRASS_Y = 0.470000;
const float ZONE_LID_R = 0.320000;
const float BAND_Y_LOW = 0.020000;
const float BAND_Y_HIGH = 0.160000;
// 求交与遮蔽预算：三套皮肤共用，像素差异因此只可能来自着色手法。
// 以下每个常量的数字面在 src/product.json 的 shading 段各出现一次，由 check-node G 组双向核对。
const int MARCH_STEPS = 96;
const float MARCH_EPS = 0.0009;
const float MARCH_MIN_STEP = 0.0035;
const float NORMAL_E = 0.0012;
const int AO_RINGS = 4;
const float AO_STEP = 0.016;
const float AO_FALL = 0.72;
const float AO_GAIN = 2.2;

float sdSphereG(vec3 p, float r) { return length(p) - r; }

float sdCapsuleG(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdCylY(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
}

// 圆角竖圆柱：q.x 是到轴心的水平距离，q.y 是到中线的竖直距离
float sdRoundCylY(vec3 p, float h, float r, float f) {
  vec2 q = vec2(length(p.xz) - (r - f), abs(p.y) - h);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - f;
}

// 轴为 z 的圆环
float sdTorusZ(vec3 p, float bigR, float tube) {
  vec2 d = vec2(length(p.xy) - bigR, p.z);
  return length(d) - tube;
}

float sminG(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float mapBody(vec3 p) {
  float body = sdRoundCylY(p, BODY_H, BODY_R, BODY_F);
  float base = sdCylY(p - vec3(0.0, BASE_Y, 0.0), BASE_H, BASE_R);
  float lid = sdRoundCylY(p - vec3(0.0, LID_Y, 0.0), LID_H, LID_R, LID_F);
  float d = sminG(body, base, 0.045);
  d = sminG(d, lid, 0.028);
  return d;
}

float mapObj(vec3 p) {
  float d = mapBody(p);
  d = sminG(d, sdCapsuleG(p, SPOUT_A0, SPOUT_B0, SPOUT_R0), 0.045);
  d = sminG(d, sdCapsuleG(p, SPOUT_A1, SPOUT_B1, SPOUT_R1), 0.040);
  d = sminG(d, sdCapsuleG(p, SPOUT_A2, SPOUT_B2, SPOUT_R2), 0.036);
  d = min(d, sdCapsuleG(p, SPOUT_A3, SPOUT_B3, SPOUT_R3));
  vec3 hp = p - HANDLE_C;
  float ring = sdTorusZ(hp, HANDLE_R, HANDLE_T);
  d = min(d, max(ring, -(hp.x - HANDLE_CUT)));
  d = min(d, sdSphereG(p - KNOB_C, KNOB_R));
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 h = vec2(1.0, -1.0) * 0.5773 * NORMAL_E;
  return normalize(h.xyy * mapObj(p + h.xyy) + h.yyx * mapObj(p + h.yyx) +
                   h.yxy * mapObj(p + h.yxy) + h.xxx * mapObj(p + h.xxx));
}

// 环境光遮蔽：沿法线采样几层，把手与壶身接缝处自然变暗
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 1; i <= AO_RINGS; i++) {
    float hr = AO_STEP * float(i * i);
    float dd = mapObj(p + n * hr);
    occ += -(dd - hr) * sca;
    sca *= AO_FALL;
  }
  return clamp(1.0 - AO_GAIN * occ, 0.0, 1.0);
}

// 视线先与包围球求交，把步进锁在球内；96 步与 eps 三套着色器共用，
// 于是「同一件商品」在像素层是可比的：剪影差异只可能来自几何，不来自求交预算。
vec2 sphereBounds(vec3 ro, vec3 rd) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - SPHERE_R * SPHERE_R;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0, -2.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec2 rayMarch(vec3 ro, vec3 rd) {
  vec2 sb = sphereBounds(ro, rd);
  float t = max(sb.x, 0.0);
  float tmax = sb.y;
  float hit = 0.0;
  if (t > tmax) return vec2(0.0, 0.0);
  for (int i = 0; i < MARCH_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = mapObj(p);
    if (d < MARCH_EPS) { hit = 1.0; break; }
    t += max(d, MARCH_MIN_STEP);
    if (t > tmax) break;
  }
  return vec2(t, hit);
}

// 朝向判据：相机在物体空间的水平方位 = uAzimuth，故某条母线（pos.x/pos.z 决定）
// 是否朝向观众 = 把它旋到相机空间取 z 分量。三套着色器共用这一份实现，
// 于是「同角度看同一件商品」在源码层是恒等式，而不是两边各抄一遍常数。
vec3 toCam(vec3 v) {
  float ca = cos(uAzimuth), sa = sin(uAzimuth);
  return vec3(v.x * ca - v.z * sa, v.y, v.x * sa + v.z * ca);
}

float facingViewer(vec3 pos) { return toCam(vec3(pos.x, 0.0, pos.z)).z; }

// 1=该分区完全迎向观众，0=完全转走（0.5 是侧向 90°）
float zoneFace(vec3 pos) { return clamp(0.5 + 3.2 * facingViewer(pos), 0.0, 1.0); }
// 壶嘴面：只认 x >= ZONE_SPOUT_X 的那段外壳
float spoutFace(vec3 pos) { return zoneFace(pos) * step(ZONE_SPOUT_X, pos.x); }
// GEOMETRY-END
