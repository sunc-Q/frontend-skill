precision highp float;
// ============================================================
// HEAD-BEGIN  （三套着色器共用，逐字节相同）
// 视角轴只有两个 uniform：uAzimuth / uElevation，一律弧度。
// 宿主写入前必须 wrapAzimuth()，见 src/host.js 的 writeView()。
// uTime 只进高光呼吸项，绝不进 mapObj()/rayMarch() —— 于是「换角度」
// 的像素判据不会被动画相位污染（18:00 轮的冻结时钟式子在此是结构性免除）。
// ============================================================
uniform vec2 uResolution;
uniform float uTime;
uniform float uAzimuth;
uniform float uElevation;

const float CAM_DIST = 3.200000;
const float TARGET_Y = 0.050000;
const float FOV_TAN = 0.305731;
const vec3 KEY_DIR = vec3(0.349128, 0.847883, 0.399004);
// HEAD-END
