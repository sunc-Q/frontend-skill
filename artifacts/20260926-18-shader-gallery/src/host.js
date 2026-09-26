/* 共享宿主：由 scripts/build.mjs 原样内联进三个风格页面（三页此段逐字节相同）
 * 运行时锁定：WebGL1（getContext("webgl")，不用 webgl2、不用 #version 300 es）
 * uniform 命名遵循技能护栏：uTime / uResolution / uMouse / uScroll / uVariant
 * 消融开关（同一份源码，只换 query）：
 *   ?probe=solid        —— 黑屏检查表第 1 步：把着色器换成常量品红，证明绘制通路是活的
 *   ?probe=frozen       —— uTime 不再更新（用来证明「动画存活」断言真的有牙）
 *   ?probe=nomouse      —— uMouse 只在初始化时写一次
 *   ?probe=noscroll     —— uScroll 恒为 0
 *   ?probe=samevariant  —— uVariant 恒为 0（用来打「三视口必须互异」）
 *   ?probe=noscrim      —— 移除文字衬底（用来打对比度断言）
 *   ?probe=nogl         —— 强制走无 WebGL 分支
 *   ?probe=nopause      —— 去掉暂停分支
 */
(function () {
  "use strict";

  var STYLE = {
    name: "{{STYLE_NAME}}",
    palette: {{PALETTE_JSON}},
    fragmentSource: {{SHADER_SOURCE_JSON}}
  };

  /* ==SHARED-HOST-BOUNDARY== 从这一行起三个风格页面逐字节相同 */

  var VERTEX_SOURCE = [
    "attribute vec2 position;",
    "void main() {",
    "  gl_Position = vec4(position, 0.0, 1.0);",
    "}"
  ].join("\n");

  /* uOrigin 是每个视口自己的窗口原点（只有 strip 会非零），着色器用它把三带对齐 */
  var SOLID_SOURCE = [
    "precision mediump float;",
    "void main() {",
    "  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);",
    "}"
  ].join("\n");

  var QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  var params = new URLSearchParams(window.location.search);
  var probe = params.get("probe") || "";

  var fxCanvas = document.getElementById("fx");
  var stripCanvas = document.getElementById("strip");
  var fallback = document.getElementById("gl-fallback");
  var toggle = document.getElementById("motion-toggle");

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (probe === "noscrim") document.body.classList.add("probe-noscrim");

  var hostFx = makeHost(fxCanvas, "fx");
  var hostStrip = makeHost(stripCanvas, "strip");

  var state = {
    time: 0,
    last: 0,
    frames: 0,
    draws: 0,
    frameMs: 0,
    paused: false,
    hidden: false,
    mouse: [0.5, 0.5],
    scroll: 0,
    raf: 0
  };
  var started = Date.now();

  function makeHost(canvas, tag) {
    var gl = null;
    var log = "";
    var glError = 0;
    if (probe === "nogl") {
      canvas.style.display = "none";
      fallback.hidden = false;
      return {
        tag: tag, gl: null, ok: false,
        locations: { uTime: null, uResolution: null, uMouse: null, uScroll: null, uVariant: null, uOrigin: null },
        draw: function () {}, sample: function () { return null; }, size: function () { return [0, 0]; },
        stats: function () { return { ok: false, reason: "nogl" }; }
      };
    }
    try {
      gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
    } catch (e) {
      gl = null;
    }
    if (!gl) {
      canvas.style.display = "none";
      fallback.hidden = false;
      return {
        tag: tag, gl: null, ok: false,
        locations: { uTime: null, uResolution: null, uMouse: null, uScroll: null, uVariant: null, uOrigin: null },
        draw: function () {}, sample: function () { return null; }, size: function () { return [0, 0]; },
        stats: function () { return { ok: false, reason: "no-context" }; }
      };
    }

    var fsrc = probe === "solid" ? SOLID_SOURCE : STYLE.fragmentSource;
    var vs = compile(gl.VERTEX_SHADER, VERTEX_SOURCE);
    var fs = compile(gl.FRAGMENT_SHADER, fsrc);
    var compiled = { vertex: !!vs, fragment: !!fs };
    if (!vs || !fs) {
      return {
        tag: tag, gl: gl, ok: false, compile: function () { return compiled; },
        linked: function () { return false; }, log: function () { return log.trim(); },
        glError: function () { return 0; },
        locations: { uTime: null, uResolution: null, uMouse: null, uScroll: null, uVariant: null, uOrigin: null },
        lastUniforms: function () { return null; },
        draw: function () {}, sampleBand: function () { return null; },
        size: function () { return [canvas.width, canvas.height]; },
        cssSize: function () { return [canvas.clientWidth, canvas.clientHeight]; },
        dpr: function () { return Math.min(window.devicePixelRatio || 1, 2); },
        resize: function () { return [canvas.width, canvas.height]; },
        stats: function () { return { ok: false, reason: "compile-failed" }; }
      };
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    var link = !!gl.getProgramParameter(program, gl.LINK_STATUS);
    log = (gl.getShaderInfoLog(fs) || "") + (gl.getProgramInfoLog(program) || "");
    gl.useProgram(program);

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    var position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    var locations = {
      uTime: gl.getUniformLocation(program, "uTime"),
      uResolution: gl.getUniformLocation(program, "uResolution"),
      uMouse: gl.getUniformLocation(program, "uMouse"),
      uScroll: gl.getUniformLocation(program, "uScroll"),
      uVariant: gl.getUniformLocation(program, "uVariant"),
      uOrigin: gl.getUniformLocation(program, "uOrigin")
    };

    var lastUniforms = { uTime: null, uResolution: [0, 0], uMouse: null, uScroll: null, uVariant: null, uOrigin: null };
    var bands = tag === "strip" ? 3 : 1;

    function compile(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        log += "\n" + (gl.getShaderInfoLog(shader) || "compile failed");
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      /* 多视口画布：把宽度凑成 bands 的整数倍，三带才拿到同一份 uResolution，
       * 否则「同一程序三变体」的亮度差异里混进了几何差异。 */
      if (bands > 1) w = Math.max(bands, Math.floor(w / bands) * bands);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return [w, h];
    }

    function drawBand(index, total, values) {
      var size = resize();
      var w = size[0];
      var h = size[1];
      var bandW = Math.floor(w / total);
      var x = index * bandW;
      var width = index === total - 1 ? w - x : bandW;
      gl.viewport(x, 0, width, h);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(locations.uTime, values.uTime);
      gl.uniform2f(locations.uResolution, width, h);
      gl.uniform2f(locations.uMouse, values.uMouse[0], values.uMouse[1]);
      gl.uniform1f(locations.uScroll, values.uScroll);
      gl.uniform1f(locations.uVariant, values.uVariant);
      /* gl_FragCoord 是整块画布的窗口坐标；把视口原点交给着色器减掉，
       * 三个视口才真的只差一个 uVariant（见作品 IV 的「同一程序三变体」）。 */
      gl.uniform2f(locations.uOrigin, x, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      lastUniforms = { uTime: values.uTime, uResolution: [width, h], uMouse: [values.uMouse[0], values.uMouse[1]], uScroll: values.uScroll, uVariant: values.uVariant, uOrigin: [x, 0] };
      glError = gl.getError();
    }

    return {
      tag: tag,
      gl: gl,
      ok: compiled.vertex && compiled.fragment && link && glError === 0,
      compile: function () { return compiled; },
      linked: function () { return link; },
      log: function () { return log.trim(); },
      glError: function () { return glError; },
      locations: locations,
      lastUniforms: function () { return lastUniforms; },
      bands: bands,
      size: function () { return [canvas.width, canvas.height]; },
      cssSize: function () { return [canvas.clientWidth, canvas.clientHeight]; },
      dpr: function () { return Math.min(window.devicePixelRatio || 1, 2); },
      resize: resize,
      draw: function (values) {
        for (var i = 0; i < bands; i++) {
          drawBand(i, bands, tag === "strip" ? variantValues(values, i) : values);
        }
      },
      sampleBand: function (index, maxPoints) {
        var size = resize();
        var w = size[0];
        var h = size[1];
        var bandW = Math.floor(w / bands);
        var x = Math.min(index * bandW, Math.max(0, w - 1));
        var width = Math.min(bandW, w - x);
        if (width < 1 || h < 1) return null;
        var px = new Uint8Array(width * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(x, 0, width, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var err = gl.getError();
        if (err !== gl.NO_ERROR) return null;
        return analyze(px, width, h, maxPoints || 4000);
      },
      /* CSS 视口坐标 → 画布像素：宿主是 position:fixed; inset:0，两套坐标只差一个 DPR 比例。
       * readPixels 的原点在左下，CSS 的原点在左上，所以 y 要翻一次。 */
      sampleRect: function (cssX, cssY, cssW, cssH, maxPoints) {
        var size = resize();
        var w = size[0];
        var h = size[1];
        var cw = Math.max(1, canvas.clientWidth);
        var chh = Math.max(1, canvas.clientHeight);
        var x = Math.max(0, Math.min(w - 1, Math.floor((cssX * w) / cw)));
        var width = Math.max(1, Math.min(w - x, Math.ceil((cssW * w) / cw)));
        var yTop = Math.max(0, Math.min(chh - 1, Math.floor((cssY * h) / chh)));
        var height = Math.max(1, Math.min(h - yTop, Math.ceil((cssH * h) / chh)));
        var y = h - yTop - height;
        var px = new Uint8Array(width * height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (gl.getError() !== gl.NO_ERROR) return null;
        var a = analyze(px, width, height, maxPoints || 1200);
        a.rect = [x, y, width, height];
        return a;
      },
      stats: function () { return { ok: true }; }
    };
  }

  function variantValues(values, index) {
    var v = probe === "samevariant" ? 0 : index;
    var copy = { uTime: values.uTime, uMouse: values.uMouse, uScroll: values.uScroll, uVariant: v };
    return copy;
  }

  function analyze(px, width, height, maxPoints) {
    var step = Math.max(1, Math.floor((width * height) / maxPoints));
    var lumas = [];
    var samples = [];
    var sum = 0;
    var sumSq = 0;
    var rgb = [0, 0, 0];
    for (var i = 0; i < width * height; i += step) {
      var o = i * 4;
      var r = px[o], g = px[o + 1], b = px[o + 2];
      var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumas.push(l);
      samples.push([r, g, b]);
      sum += l;
      sumSq += l * l;
      rgb[0] += r; rgb[1] += g; rgb[2] += b;
    }
    var n = lumas.length;
    lumas.sort(function (a, b) { return a - b; });
    var mean = sum / n;
    return {
      points: n,
      width: width,
      height: height,
      mean: mean,
      sigma: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
      p05: lumas[Math.floor(n * 0.005)],
      p50: lumas[Math.floor(n * 0.5)],
      p995: lumas[Math.min(n - 1, Math.floor(n * 0.995))],
      min: lumas[0],
      max: lumas[n - 1],
      meanRgb: [rgb[0] / n, rgb[1] / n, rgb[2] / n],
      samples: samples.filter(function (_, idx) { return idx % Math.max(1, Math.floor(samples.length / 200)) === 0; })
    };
  }

  function frameValues() {
    return {
      uTime: state.time,
      uMouse: state.mouse,
      uScroll: state.scroll,
      uVariant: 0
    };
  }

  function drawFrame() {
    var t0 = Date.now();
    var values = frameValues();
    hostFx.draw(values);
    hostStrip.draw(values);
    state.draws += (hostFx.bands || 0) + (hostStrip.bands || 0);
    state.frameMs = state.frameMs ? state.frameMs * 0.7 + (Date.now() - t0) * 0.3 : Date.now() - t0;
  }

  function loop(now) {
    if (!state.last) state.last = now;
    var dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    if (probe !== "frozen" && !state.paused && !state.hidden) {
      state.time += dt;
    }
    state.frames += 1;
    drawFrame();
    state.raf = window.requestAnimationFrame(loop);
  }

  if (probe === "nopause") {
    toggle.hidden = true;
  } else {
    toggle.addEventListener("click", function () {
      state.paused = !state.paused;
      toggle.setAttribute("aria-pressed", state.paused ? "true" : "false");
      toggle.textContent = state.paused ? "恢复画面" : "暂停画面";
    });
  }

  if (probe !== "nomouse") {
    window.addEventListener("pointermove", function (ev) {
      var x = ev.clientX / Math.max(1, window.innerWidth);
      var y = 1 - ev.clientY / Math.max(1, window.innerHeight);
      state.mouse = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
    }, { passive: true });
  }

  if (probe !== "noscroll") {
    window.addEventListener("scroll", function () {
      var span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      state.scroll = Math.min(1, Math.max(0, window.scrollY / span));
    }, { passive: true });
  }

  document.addEventListener("visibilitychange", function () {
    state.hidden = document.hidden;
  });

  if (reduced) {
    state.time = 12;
    state.paused = true;
    toggle.hidden = true;
    drawFrame();
    state.frames = 1;
    var hint = document.createElement("p");
    hint.className = "reduced-hint";
    hint.id = "reduced-hint";
    hint.textContent = "已按系统「减少动态效果」偏好停在单帧。";
    document.querySelector(".hero-actions").after(hint);
  } else {
    drawFrame();
    state.raf = window.requestAnimationFrame(loop);
  }

  window.__shaderProbe = {
    style: STYLE.name,
    palette: STYLE.palette,
    probe: probe,
    reduced: reduced,
    glVersion: "webgl1",
    frames: function () { return state.frames; },
    draws: function () { return state.draws; },
    fps: function () { return state.frames / Math.max(0.001, (Date.now() - started) / 1000); },
    frameMs: function () { return state.frameMs; },
    viewport: function () { return [window.innerWidth, window.innerHeight]; },

    time: function () { return state.time; },
    paused: function () { return state.paused; },
    hiddenFlag: function () { return state.hidden; },
    mouse: function () { return state.mouse.slice(); },
    scroll: function () { return state.scroll; },
    host: function (tag) { return tag === "strip" ? hostStrip : hostFx; },
    info: function () {
      function pack(h) {
        var locs = h.locations || {};
        return {
          tag: h.tag,
          ok: !!h.ok,
          compiled: h.compile ? h.compile() : { vertex: false, fragment: false },
          linked: h.linked ? h.linked() : false,
          log: h.log ? h.log() : "no-context",
          glError: h.glError ? h.glError() : -1,
          nullLocations: Object.keys(locs).filter(function (k) { return locs[k] === null; }),
          lastUniforms: h.lastUniforms ? h.lastUniforms() : null,
          buffer: h.size(),
          css: h.cssSize ? h.cssSize() : [0, 0],
          dpr: h.dpr ? h.dpr() : 0
        };
      }
      return { fx: pack(hostFx), strip: pack(hostStrip) };
    },
    stats: function (tag, band) {
      var h = tag === "strip" ? hostStrip : hostFx;
      if (!h.gl) return null;
      h.draw(frameValues());
      return h.sampleBand(band || 0, 6000);
    },
    rect: function (tag, x, y, w, hh) {
      var h = tag === "strip" ? hostStrip : hostFx;
      if (!h.gl || !h.sampleRect) return null;
      h.draw(frameValues());
      return h.sampleRect(x, y, w, hh, 1200);
    },
    forceDraw: function () { drawFrame(); },
    setPaused: function (v) { state.paused = !!v; },
    setHidden: function (v) { state.hidden = !!v; }
  };
})();
