// ============================================================
// MAIN-BEGIN  （三套着色器共用，逐字节相同）
// 唯一的 gl_FragColor 出口：命中=不透明着色，未命中=全透明，
// 于是页面底色从 canvas 后面透上来，剪影可以直接由 alpha 通道量出来。
// ============================================================
void main() {
  // uv ∈ [-1,1]（竖直方向），于是 FOV_TAN 就是「半视角正切」，与 facts.camera.fovDeg
  // 及宿主 projectTip() 的 NDC 式子同一口径。曾用 / uResolution.y 让 uv 只到 ±0.5，
  // 视野被腰斩、商品溢出整幅画布（alpha 剪影铺满 176400/176400），三向核对当场抓不到
  // ——因为解析投影是对的、着色器是错的，两者本来就差一个 2。
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / (0.5 * uResolution.y);
  float ce = cos(uElevation), se = sin(uElevation);
  vec3 tgt = vec3(0.0, TARGET_Y, 0.0);
  vec3 eye = tgt + vec3(ce * sin(uAzimuth), se, ce * cos(uAzimuth)) * CAM_DIST;
  vec3 fw = normalize(tgt - eye);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw + rt * (uv.x * FOV_TAN) + up * (uv.y * FOV_TAN));
  vec2 m = rayMarch(eye, rd);
  if (m.y < 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }
  vec3 pos = eye + rd * m.x;
  vec3 nor = calcNormal(pos);
  gl_FragColor = vec4(shadeSurface(pos, nor, rd), 1.0);
}
// MAIN-END
