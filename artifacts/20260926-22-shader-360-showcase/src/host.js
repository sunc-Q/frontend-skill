/* HOST-COMMON-BEGIN
 * 展台宿主：三套页面共用同一份字节（构建时逐份注入，check-node 比对）。
 * 单位纪律：界面只说「度」，着色器只收「弧度」，换算只发生在 deg2rad 这一处；
 * 写进 uniform 前一律 wrapTau。uTime 只喂给着色的呼吸项，不进几何与求交。
 * HOST-COMMON-END */
(function () {
  "use strict";
  const FACTS = JSON.parse(document.getElementById("facts").textContent);
  const LBL = JSON.parse(document.getElementById("labels").textContent);
  const TAU = Math.PI * 2;
  const G = FACTS.geometry, CAM = FACTS.camera, CTL = FACTS.controls;

  const deg2rad = (d) => (d * TAU) / 360;
  const rad2deg = (r) => (r * 360) / TAU;
  const wrapTau = (r) => ((r % TAU) + TAU) % TAU;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---- 界面文案与事实渲染（页面里没有一个手写数字） ---- */
  const pick = (obj, dotted) => dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  const fill = (tpl, map) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (map[k] == null ? "" : String(map[k])));
  function renderStatic() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const v = LBL[key];
      if (v == null) { throw new Error("label key missing: " + key); }
      el.textContent = v;
    });
    document.querySelectorAll("[data-fact]").forEach((el) => {
      const raw = pick(FACTS, el.getAttribute("data-fact"));
      const mode = el.getAttribute("data-fact-render");
      if (mode === "volume") el.textContent = fill(LBL.volume, { v: raw, price: FACTS.product.priceCny, material: FACTS.product.bodyMaterial });
      else if (mode === "date") el.textContent = fill(LBL.date, { date: raw });
      else el.textContent = String(raw);
    });
    const ul = document.getElementById("coatingList");
    ul.textContent = "";
    FACTS.product.coatingOptions.forEach((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      ul.appendChild(li);
    });
    const spec = document.querySelector("#specTable tbody");
    spec.textContent = "";
    FACTS.specTable.forEach((row) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = row.k;
      const td = document.createElement("td");
      td.textContent = row.v + (row.note ? " " + row.note : "");
      tr.append(th, td);
      spec.appendChild(tr);
    });
    const parts = document.querySelector("#partsTable tbody");
    parts.textContent = "";
    let total = 0;
    FACTS.parts.forEach((p) => {
      total += p.massG;
      const tr = document.createElement("tr");
      tr.append(td(p.no), td(p.name), td(p.material), td(p.massG + " g"));
      parts.appendChild(tr);
    });
    document.getElementById("partsTotalCell").textContent = total + " g";
    const bar = document.getElementById("presetBar");
    bar.textContent = "";
    const atbody = document.querySelector("#angleTable tbody");
    atbody.textContent = "";
    FACTS.presets.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p.label;
      b.setAttribute("data-az-deg", String(p.azDeg));
      b.setAttribute("data-el-deg", String(p.elDeg));
      b.setAttribute("data-preset", p.id);
      b.setAttribute("aria-label", fill(LBL.presetAria, { label: p.label }));
      b.addEventListener("click", () => applyPreset(p, b));
      bar.appendChild(b);
      const tr = document.createElement("tr");
      tr.setAttribute("data-row", p.id);
      tr.append(td(p.label), td(p.azDeg + "°"), td(p.elDeg + "°"), td(anchorWord(p.expectTopband)), td("—", "measured"));
      atbody.appendChild(tr);
    });
  }
  const td = (txt, cls) => {
    const c = document.createElement("td");
    c.textContent = txt;
    if (cls) c.setAttribute("data-cell", cls);
    return c;
  };
  const anchorWord = (a) => (a === "right" ? LBL.anchorRight : a === "left" ? LBL.anchorLeft : LBL.anchorCenter);

  /* ---- WebGL ---- */
  const canvas = document.getElementById("gl");
  const state = {
    azRad: deg2rad(FACTS.presets[0].azDeg),
    elRad: deg2rad(clampEl(FACTS.presets[0].elDeg)),
    dirty: true,
    spinning: false,
    draws: 0,
    lastUniforms: { uAzimuth: null, uElevation: null, uTime: null },
    freezeTime: null,
    // live=true 才有 readPixels 实测：读数与「实测」列在正常浏览路径上就是活的，
    // 探针可以关掉它来单测像素判据。代价只在 dirty 帧上发生（无交互不重绘，也就不实测）。
    live: true,
  };
  function clampEl(d) { return clamp(d, CAM.elevationClampDeg[0], CAM.elevationClampDeg[1]); }
  let gl = null, prog = null, loc = null;
  const info = { webgl: false, renderer: "", compile: "", programOk: false, glErrorAfterDraw: 0 };

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || "compile failed");
    }
    return s;
  }
  function initGL() {
    gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { info.compile = "no-webgl"; return false; }
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    info.renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    info.webgl = true;
    try {
      const vs = shader(gl.VERTEX_SHADER, document.getElementById("vert").textContent);
      const fs = shader(gl.FRAGMENT_SHADER, document.getElementById("frag").textContent);
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
      info.programOk = true;
      info.compile = "ok";
      gl.useProgram(prog);
      loc = {
        uResolution: gl.getUniformLocation(prog, "uResolution"),
        uTime: gl.getUniformLocation(prog, "uTime"),
        uAzimuth: gl.getUniformLocation(prog, "uAzimuth"),
        uElevation: gl.getUniformLocation(prog, "uElevation"),
        aPos: gl.getAttribLocation(prog, "aPos"),
      };
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.disable(gl.DEPTH_TEST);
    } catch (e) {
      info.compile = String(e.message).slice(0, 400);
      return false;
    }
    return true;
  }

  function resize() {
    const px = CTL.backingStorePx;
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /* 唯一的 uniform 写入点：任何绕过这里直接 gl.uniform* 的写法都会在 I 组探针里露出来 */
  function writeView(tSec) {
    state.lastUniforms.uAzimuth = wrapTau(state.azRad);
    state.lastUniforms.uElevation = state.elRad;
    state.lastUniforms.uTime = tSec;
    gl.uniform1f(loc.uAzimuth, state.lastUniforms.uAzimuth);
    gl.uniform1f(loc.uElevation, state.lastUniforms.uElevation);
    gl.uniform1f(loc.uTime, tSec);
  }
  function draw(tSec) {
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.uResolution, canvas.width, canvas.height);
    writeView(tSec);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    state.draws += 1;
    info.glErrorAfterDraw = gl.getError();
  }

  /* ---- 剪影与分区锚点测量（alpha 通道即剪影，无需第二遍渲染） ---- */
  const readBuf = { u8: null, size: 0 };
  function readPixels() {
    const n = canvas.width * canvas.height * 4;
    if (!readBuf.u8 || readBuf.size !== n) { readBuf.u8 = new Uint8Array(n); readBuf.size = n; }
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, readBuf.u8);
    return readBuf.u8;
  }
  function measure() {
    const W = canvas.width, H = canvas.height, px = readPixels();
    let area = 0, sx = 0, top = H, bottom = -1, minX = W, maxX = -1;
    for (let y = 0; y < H; y++) {
      const rowTop = H - 1 - y;  // GL 自下往上 → 转成屏幕行号
      for (let x = 0; x < W; x++) {
        const i = (rowTop * W + x) * 4;
        if (px[i + 3] > 127) { area++; sx += x; if (y < top) top = y; if (y > bottom) bottom = y; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      }
    }
    if (!area) return { area: 0 };
    const bandHi = top + Math.max(1, Math.round((bottom - top) * 0.16));
    let bArea = 0, bsx = 0, bMinX = W, bMaxX = -1;
    for (let y = top; y <= bandHi; y++) {
      const rowTop = H - 1 - y;
      for (let x = minX; x <= maxX; x++) {
        const i = (rowTop * W + x) * 4;
        if (px[i + 3] > 127) { bArea++; bsx += x; if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x; }
      }
    }
    return {
      area,
      cx: +(sx / area).toFixed(2),
      bbox: { top, bottom, minX, maxX, w: maxX - minX + 1, h: bottom - top + 1 },
      band: { area: bArea, hi: bandHi, cx: bArea ? +(bsx / bArea).toFixed(2) : null, minX: bMinX, maxX: bMaxX },
      W, H,
    };
  }
  /* 壶嘴尖端的解析投影：与着色器里的相机式子独立实现一遍，两条式子必须落在同一个像素上 */
  function projectTip() {
    const el = state.elRad, az = wrapTau(state.azRad);
    const ce = Math.cos(el), se = Math.sin(el);
    const tgt = [0, CAM.targetY, 0];
    const eye = [tgt[0] + ce * Math.sin(az) * CAM.distance, tgt[1] + se * CAM.distance, tgt[2] + ce * Math.cos(az) * CAM.distance];
    const f = [tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]];
    const fl = Math.hypot(f[0], f[1], f[2]);
    const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
    const cr = [fw[1] * 0 - fw[2] * 1, fw[2] * 0 - fw[0] * 0, fw[0] * 1 - fw[1] * 0];
    const cl = Math.hypot(cr[0], cr[1], cr[2]);
    const rt = [cr[0] / cl, cr[1] / cl, cr[2] / cl];
    const up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    const tip = G.spout.tip;
    const d = [tip[0] - eye[0], tip[1] - eye[1], tip[2] - eye[2]];
    const zc = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    if (zc <= 0) return null;
    const xc = d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2];
    const yc = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const fovScale = CAM.fovTan;
    const ndcX = (xc / zc) / fovScale, ndcY = (yc / zc) / fovScale;
    const W = canvas.width, H = canvas.height;
    return { x: +((ndcX * 0.5 + 0.5) * W - 0.5).toFixed(2), y: +((1 - (ndcY * 0.5 + 0.5)) * H - 0.5).toFixed(2),
      facing: +(tip[0] * Math.sin(az) + tip[2] * Math.cos(az)).toFixed(4) };
  }
  /* 同一份朝向式子在 JS 里的第二实现：>0 即壶嘴面此刻朝向观众 */
  const facingNow = () => {
    const az = wrapTau(state.azRad);
    return G.spout.tip[0] * Math.sin(az) + G.spout.tip[2] * Math.cos(az);
  };

  function anchorFromMeasure(m) {
    if (!m || !m.band || m.band.cx == null) return "center";
    const off = (m.band.cx - m.W / 2) / (m.W / 2);
    return off > 0.06 ? "right" : off < -0.06 ? "left" : "center";
  }

  /* ---- 读数与无障碍 ---- */
  function updateReadout(m) {
    const azDeg = Math.round(rad2deg(wrapTau(state.azRad)));
    const elDeg = Math.round(rad2deg(state.elRad));
    const anchor = anchorWord(anchorFromMeasure(m || { band: null }));
    const p = document.getElementById("readout");
    if (p) p.textContent = fill(LBL.readout, { az: String(azDeg).padStart(3, "0"), el: String(elDeg).padStart(2, "0"), anchor });
    if (canvas) {
      canvas.setAttribute("aria-label", fill(LBL.readoutAria, { az: azDeg, el: elDeg, anchor }));
      canvas.setAttribute("data-az-deg", String(azDeg));
    }
    const badges = document.getElementById("glBadges");
    if (badges) {
      badges.textContent = "";
      const add = (k, v) => { const s = document.createElement("span"); const b = document.createElement("b"); b.textContent = v; s.append(k + " ", b); badges.appendChild(s); };
      add(LBL.glReady, info.compile);
      add(LBL.glRenderer, info.renderer.slice(0, 26));
      add(LBL.glUniform, state.lastUniforms.uAzimuth == null ? "—" : state.lastUniforms.uAzimuth.toFixed(4));
      add(LBL.glDraws, String(state.draws));
      if (m && m.area) add(LBL.glArea, String(m.area));
      if (m && m.band && m.band.cx != null) add(LBL.glAnchor, (m.band.cx - m.W / 2).toFixed(1) + "px");
    }
    document.querySelectorAll("#angleTable tbody tr").forEach((tr) => {
      const p2 = FACTS.presets.find((x) => x.id === tr.getAttribute("data-row"));
      const on = p2 && Math.abs(wrapTau(deg2rad(p2.azDeg)) - wrapTau(state.azRad)) < deg2rad(0.5) && Math.abs(p2.elDeg - rad2deg(state.elRad)) < 0.5;
      tr.setAttribute("data-active", on ? "1" : "0");
      if (on && state.live && m && m.band && m.band.cx != null) {
        tr.querySelector('[data-cell="measured"]').textContent = anchorWord(anchorFromMeasure(m));
      }
    });
  }

  /* ---- 帧循环：无交互不重绘 ---- */
  let rafId = 0, lastT = 0;
  function loop(now) {
    rafId = 0;
    const t = state.freezeTime != null ? state.freezeTime : now / 1000;
    if (state.spinning) {
      const dt = lastT ? (now - lastT) / 1000 : 0;
      state.azRad += deg2rad(CTL.spinDegPerSec * dt);
      state.dirty = true;
    }
    lastT = now;
    if (state.dirty) {
      state.dirty = false;
      draw(t);
      updateReadout(state.live ? measure() : null);
    }
    if (state.spinning) schedule();
  }
  function schedule() { if (!rafId) rafId = requestAnimationFrame(loop); }

  function applyPreset(p, btn) {
    state.azRad = deg2rad(p.azDeg);
    state.elRad = deg2rad(clampEl(p.elDeg));
    state.spinning = false;
    const sp = document.getElementById("spinBtn");
    if (sp) { sp.setAttribute("aria-pressed", "false"); sp.textContent = LBL.btnSpin; }
    document.querySelectorAll("#presetBar button").forEach((b) => b.removeAttribute("data-on"));
    if (btn) btn.setAttribute("data-on", "1");
    state.dirty = true;
    schedule();
  }

  /* ---- 交互 ---- */
  function bindControls() {
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      state.spinning = false;
      const sp = document.getElementById("spinBtn");
      if (sp) { sp.setAttribute("aria-pressed", "false"); sp.textContent = LBL.btnSpin; }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      state.azRad += deg2rad(dx * CTL.dragSensitivityDegPerPx);
      state.elRad = deg2rad(clampEl(rad2deg(state.elRad) - dy * CTL.elevationSensitivityDegPerPx));
      state.dirty = true;
      schedule();
    });
    const end = () => { drag = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("keydown", (e) => {
      const step = CTL.keyboardStepDeg;
      let used = true;
      if (e.key === "ArrowRight") state.azRad += deg2rad(step);
      else if (e.key === "ArrowLeft") state.azRad -= deg2rad(step);
      else if (e.key === "ArrowUp") state.elRad = deg2rad(clampEl(rad2deg(state.elRad) + step));
      else if (e.key === "ArrowDown") state.elRad = deg2rad(clampEl(rad2deg(state.elRad) - step));
      else if (e.key === "Home") applyPreset(FACTS.presets[0], document.querySelector('#presetBar button[data-preset="' + FACTS.presets[0].id + '"]'));
      else used = false;
      if (used) { e.preventDefault(); state.dirty = true; schedule(); }
    });
    const spin = document.getElementById("spinBtn");
    spin.textContent = LBL.btnSpin;
    spin.addEventListener("click", () => {
      state.spinning = !state.spinning;
      spin.setAttribute("aria-pressed", state.spinning ? "true" : "false");
      spin.textContent = state.spinning ? LBL.btnSpinOn : LBL.btnSpin;
      lastT = 0;
      if (state.spinning) schedule();
    });
    document.getElementById("resetBtn").addEventListener("click", () => {
      applyPreset(FACTS.presets[0], document.querySelector('#presetBar button[data-preset="' + FACTS.presets[0].id + '"]'));
    });
    canvas.setAttribute("tabindex", "0");
  }

  /* ---- 探针 ---- */
  function buildProbe() {
    window.__mz = {
      info,
      get view() { return { azRad: state.azRad, elRad: state.elRad, azDeg: +rad2deg(wrapTau(state.azRad)).toFixed(3), elDeg: +rad2deg(state.elRad).toFixed(3), draws: state.draws, spinning: state.spinning }; },
      get uniforms() { return Object.assign({}, state.lastUniforms); },
      setView(azDeg, elDeg) {
        state.azRad = deg2rad(azDeg);
        state.elRad = deg2rad(clampEl(elDeg == null ? rad2deg(state.elRad) : elDeg));
        state.dirty = true;
        schedule();
      },
      setFrozenTime(t) { state.freezeTime = t; },
      setLive(v) { state.live = !!v; },
      renderNow(t) { draw(t == null ? (state.freezeTime == null ? 0 : state.freezeTime) : t); },
      measureNow() { return measure(); },
      /* 分区色心：顶带内以「离主色桶最远」的偏差加权求重心。主色桶 = 像素数最多的 5bit 色桶（器身）。
       * 不认具体色值，因此三套皮肤同一口径；它只能证明「着色确实分了区」，
       * 证不了分区的朝向手性——壶嘴在任意方位都探出器身，色心始终跟着剪影走，
       * 这个盲区是变异测试（把 toCam 的朝向相位反 180°）打出来的，见报告。 */
      zoneCentroid() {
        const m = measure();
        if (!m.band) return { cx: null };
        const px = readPixels();
        const W = canvas.width;
        const at = (x, y) => ((W - 1 - y) * W + x) * 4;
        const hist = new Map();
        for (let y = m.bbox.top; y <= m.band.hi; y++) {
          for (let x = m.bbox.minX; x <= m.bbox.maxX; x++) {
            const i = at(x, y);
            if (px[i + 3] <= 127) continue;
            const k = ((px[i] >> 3) << 9) | ((px[i + 1] >> 3) << 6) | ((px[i + 2] >> 3) << 3);
            hist.set(k, (hist.get(k) || 0) + 1);
          }
        }
        let base = [0, 0, 0], best = -1;
        for (const [k, n] of hist) if (n > best) { best = n; base = [((k >> 9) & 31) * 8 + 4, ((k >> 6) & 31) * 8 + 4, ((k >> 3) & 31) * 8 + 4]; }
        let dev = 0, sx = 0;
        for (let y = m.bbox.top; y <= m.band.hi; y++) {
          for (let x = m.bbox.minX; x <= m.bbox.maxX; x++) {
            const i = at(x, y);
            if (px[i + 3] <= 127) continue;
            const d = Math.abs(px[i] - base[0]) + Math.abs(px[i + 1] - base[1]) + Math.abs(px[i + 2] - base[2]);
            dev += d; sx += d * x;
          }
        }
        return { cx: dev ? +(sx / dev).toFixed(2) : null, base, dev, hi: m.band.hi };
      },
      // 像素指纹：alpha 用于比剪影（几何），rgba 用于比着色（皮肤）。FNV-1a 足够做等值判定。
      pixHash(mode) {
        const px = readPixels();
        let h = 0x811c9dc5 >>> 0;
        const step = mode === "alpha" ? 4 : 1;
        for (let i = mode === "alpha" ? 3 : 0; i < px.length * 4; i += step) {
          h = (h ^ px[i]) >>> 0;
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
      },
      projectTipNow() { return projectTip(); },
      facingNow() { return facingNow(); },
      presetIds: FACTS.presets.map((p) => p.id),
      skin: document.body.getAttribute("data-skin"),
    };
  }

  function boot() {
    renderStatic();
    const ok = initGL();
    buildProbe();
    if (!ok) {
      const p = document.createElement("p");
      p.className = "gl-fatal";
      p.setAttribute("role", "alert");
      p.textContent = LBL.glHint;
      document.querySelector(".stage").prepend(p);
      window.__mz.bootError = info.compile;
      return;
    }
    bindControls();
    applyPreset(FACTS.presets[0], document.querySelector('#presetBar button[data-preset="' + FACTS.presets[0].id + '"]'));
    document.getElementById("buildStamp").textContent = fill(LBL.buildStamp, { id: FACTS.build.id, sha: FACTS.build.geometrySha1 });
    window.__mz.ready = true;
  }
  boot();
})();
