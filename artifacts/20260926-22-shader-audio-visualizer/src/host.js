/* 共享宿主：由 scripts/build.mjs 原样内联进三个风格页面（哨兵之后的段落三页逐字节相同）
 * 运行时锁定：WebGL1 + postprocess 式全屏 quad（技能护栏：不假定 WebGL2、不自造内置量）
 * uniform 命名沿用技能主张：uTime / uResolution / uMouse / uVariant / uOrigin；
 * 本技能完全没写「外部数据怎么进着色器」，uLevel/uBass/uMid/uTreb/uFlux/uBeat/uSpectrum/uHistory
 * 这 8 个是本轮自建的口径 —— 传参纪律靠 A 组「声明集 == 提供集 == 定位集」双向断言兜住。
 * 消融开关（同一份源码，只换 query；逗号可叠加，例如 ?probe=frozen,noaudio）：
 *   solid          —— 常量品红，证明绘制通路活着（黑屏检查表第 1 步）
 *   frozen         —— uTime 冻结、音频照跑（用来证明「画面变化来自音频」不是来自时钟）
 *   noaudio        —— 音频读数一律置零、频谱/历史纹理不更新（打「其实音频根本没进着色器」）
 *   staticspectrum —— 喂一条与音乐无关的固定斜坡频谱（打「变化来自宿主自己的循环」）
 *   mislabel       —— 64 带顺序反转后再上传（打「频带映射根本没生效」）
 *   samevariant    —— uVariant 恒 0（打「分频子视口其实是一个东西」）
 *   nomouse        —— uMouse 只在初始化写一次
 *   noonset        —— 起拍检测器不喂数据（uBeat 恒 0）
 *   nogl           —— 强制走无 WebGL 分支
 * 互斥对：frozen（画面必须仍变）×frozen,noaudio（画面必须完全静止）——
 * 两臂同向才说明「变化来自音频」而不是「变化来自任何还在跑的东西」。
 */
(function () {
  "use strict";

  var STYLE = {
    name: "{{STYLE_NAME}}",
    palette: {{PALETTE_JSON}},
    uniforms: {{UNIFORM_LIST_JSON}},
    fragmentSource: {{SHADER_SOURCE_JSON}},
    bands: {{BAND_SPEC_JSON}}
  };

  /* ==SHARED-HOST-BOUNDARY== 从这一行起三个风格页面逐字节相同 */

  var FEATURES_INLINE = {{FEATURES_INLINE_EXPR}};

  var VERTEX_SOURCE = [
    "attribute vec2 position;",
    "void main() {",
    "  gl_Position = vec4(position, 0.0, 1.0);",
    "}"
  ].join("\n");

  var SOLID_SOURCE = [
    "precision mediump float;",
    "void main() {",
    "  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);",
    "}"
  ].join("\n");

  var QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  var HISTORY_ROWS = 128;
  var params = new URLSearchParams(window.location.search);
  /* 消融臂可叠加（逗号分隔）：互斥判据必须能同时按下两个开关——
   * frozen+noaudio（时钟与音频一起拔掉，画面必须彻底静止）
   * 与单独 frozen（只拔时钟，画面照变，于是变化只能来自音频）。 */
  var probes = (params.get("probe") || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  function has(name) { return probes.indexOf(name) >= 0; }
  var probe = probes.join(",");

  var fxCanvas = document.getElementById("fx");
  var stripCanvas = document.getElementById("strip");
  var fallback = document.getElementById("gl-fallback");
  var audioEl = document.getElementById("track");
  var playBtn = document.getElementById("play-toggle");
  var statusEl = document.getElementById("readout-status");

  var boot = { ok: false, stage: "init", error: "", webgl: "webgl1" };
  var state = {
    time: 0, last: 0, frames: 0, draws: 0, frameMs: 0,
    paused: false, hidden: false, mouse: [0.5, 0.5], raf: 0,
    audioReady: false, ctxState: "none",
    bands: new Array(64).fill(0), prevBands: null,
    level: 0, bass: 0, mid: 0, treble: 0, flux: 0, beat: 0,
    beatLog: [], drawLog: [], history: [], pulse: 0
  };
  var detector = FEATURES_INLINE.createOnsetDetector();
  var started = Date.now();

  var audioCtx = null, analyser = null, freqBytes = null, srcNode = null;

  var hostFx = makeHost(fxCanvas, "fx", 1);
  var hostStrip = makeHost(stripCanvas, "strip", 3);

  function compile(type, source, gl, logRef) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      logRef.text += "\n" + (gl.getShaderInfoLog(shader) || "compile failed");
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function makeHost(canvas, tag, bands) {
    var gl = null;
    var log = { text: "" };
    var dead = {
      tag: tag, gl: null, ok: false, bands: bands,
      locations: {}, missing: [], declared: [],
      draw: function () {}, sample: function () { return null; },
      size: function () { return [0, 0]; }, cssSize: function () { return [0, 0]; },
      lastUniforms: function () { return null; },
      bandRecords: function () { return []; }
    };
    if (has("nogl")) {
      canvas.style.display = "none";
      fallback.hidden = false;
      boot.stage = "nogl";
      return dead;
    }
    try {
      gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
    } catch (e) {
      gl = null;
    }
    if (!gl) {
      canvas.style.display = "none";
      fallback.hidden = false;
      boot.stage = "no-context";
      return dead;
    }

    var fsrc = has("solid") ? SOLID_SOURCE : STYLE.fragmentSource;
    var vs = compile(gl.VERTEX_SHADER, VERTEX_SOURCE, gl, log);
    var fs = compile(gl.FRAGMENT_SHADER, fsrc, gl, log);
    if (!vs || !fs) {
      boot.stage = "compile-failed";
      boot.error = log.text.trim();
      return dead;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    var link = !!gl.getProgramParameter(program, gl.LINK_STATUS);
    log.text += gl.getProgramInfoLog(program) || "";
    if (!link) {
      boot.stage = "link-failed";
      boot.error = log.text.trim();
      return dead;
    }
    gl.useProgram(program);

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    var position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    /* 声明集：直接从片元源码里读 uniform 声明，不看宿主自己的清单 */
    var declared = (function () {
      var names = {};
      var re = /uniform\s+(?:float|vec2|vec3|vec4|sampler2D)\s+(\w+)\s*;/g;
      var m;
      while ((m = re.exec(STYLE.fragmentSource)) !== null) names[m[1]] = true;
      return Object.keys(names);
    })();

    var locations = {};
    var missing = [];
    declared.forEach(function (name) {
      var loc = gl.getUniformLocation(program, name);
      if (loc === null) missing.push(name);
      locations[name] = loc;
    });

    var spectrumTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, spectrumTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var historyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, historyTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var lastUniforms = null;
    var bandRecords = [];
    var glError = 0;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (bands > 1) w = Math.max(bands, Math.floor(w / bands) * bands);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return [w, h];
    }

    function uploadTextures(values) {
      var bytes = new Uint8Array(64);
      var b = values.bands;
      for (var i = 0; i < 64; i++) {
        var src = has("mislabel") ? 63 - i : i;
        bytes[i] = Math.max(0, Math.min(255, Math.round(b[src] * 255)));
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, spectrumTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);

      var rows = state.history.length ? state.history : [new Array(64).fill(0)];
      var pad = HISTORY_ROWS - rows.length;
      var hist = new Uint8Array(64 * HISTORY_ROWS);
      for (var r = 0; r < HISTORY_ROWS; r++) {
        var row = r < pad ? null : rows[r - pad];
        for (var c = 0; c < 64; c++) {
          var idx = r * 64 + c;
          hist[idx] = row ? Math.max(0, Math.min(255, Math.round((has("mislabel") ? row[63 - c] : row[c]) * 255))) : 0;
        }
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, historyTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 64, HISTORY_ROWS, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, hist);
    }

    function drawBand(index, total, values) {
      var size = resize();
      var w = size[0], h = size[1];
      var bandW = Math.floor(w / total);
      var x = index * bandW;
      var width = index === total - 1 ? w - x : bandW;
      gl.viewport(x, 0, width, h);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      var record = {
        uTime: null, uResolution: [width, h], uOrigin: [x, 0], uVariant: null,
        uLevel: null, uBass: null, uMid: null, uTreb: null, uFlux: null, uBeat: null,
        uSpectrum: null, uHistory: null, mouse: null
      };
      if (locations.uMouse) record.mouse = values.mouse.slice();

      if (locations.uTime !== undefined && locations.uTime !== null) { gl.uniform1f(locations.uTime, values.time); record.uTime = values.time; }
      if (locations.uResolution) gl.uniform2f(locations.uResolution, width, h);
      if (locations.uOrigin) gl.uniform2f(locations.uOrigin, x, 0);
      if (locations.uMouse) gl.uniform2f(locations.uMouse, values.mouse[0], values.mouse[1]);
      /* 每个视口用同一个 uVariant 编号规则：主画布 0（全带），条带 1/2/3（分频隔离） */
      if (locations.uVariant) {
        var v = has("samevariant") ? 0 : (tag === "fx" ? 0 : index + 1);
        gl.uniform1f(locations.uVariant, v);
        record.uVariant = v;
      }

      /* 音频量 → float uniform：只有着色器声明过的才写，且写之前记下要写的值（A 组据此核对） */
      var scalars = {
        uLevel: values.level, uBass: values.bass, uMid: values.mid,
        uTreb: values.treble, uFlux: values.flux, uBeat: values.beat
      };
      Object.keys(scalars).forEach(function (name) {
        if (locations[name]) {
          var val = Number.isFinite(scalars[name]) ? Math.max(0, Math.min(1, scalars[name])) : 0;
          gl.uniform1f(locations[name], val);
          record[name] = val;
        }
      });

      if (locations.uSpectrum) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, spectrumTex);
        gl.uniform1i(locations.uSpectrum, 0);
        record.uSpectrum = "texture0";
      }
      if (locations.uHistory) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, historyTex);
        gl.uniform1i(locations.uHistory, 1);
        record.uHistory = "texture1";
      }
      Object.keys(values.palette).forEach(function (name) {
        if (locations[name]) gl.uniform3fv(locations[name], values.palette[name]);
      });

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      glError = gl.getError();
      record.drawIndex = state.draws;
      record.audioTime = audioEl ? Number(audioEl.currentTime) : -1;
      lastUniforms = record;
      bandRecords[index] = record;
      if (tag === "fx" && state.drawLog.length < 400) state.drawLog.push(record);
    }

    return {
      tag: tag, gl: gl, ok: glError === 0, bands: bands,
      declared: declared, missing: missing, locations: locations, log: function () { return log.text.trim(); },
      glError: function () { return glError; },
      lastUniforms: function () { return lastUniforms; },
      bandRecords: function () { return bandRecords; },
      size: function () { return [canvas.width, canvas.height]; },
      cssSize: function () { return [canvas.clientWidth, canvas.clientHeight]; },
      draw: function (values) {
        uploadTextures(values);
        for (var i = 0; i < bands; i++) drawBand(i, bands, values);
      },
      sampleRegion: function (index, maxPoints) {
        var size = resize();
        var w = size[0], h = size[1];
        var bandW = Math.floor(w / bands);
        var x = Math.min(index * bandW, Math.max(0, w - 1));
        var width = Math.min(bandW, w - x);
        if (width < 1 || h < 1) return null;
        var px = new Uint8Array(width * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(x, 0, width, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (gl.getError() !== gl.NO_ERROR) return null;
        return analyze(px, width, h, maxPoints || 4000);
      },
      sampleRaw: function (index) {
        var size = resize();
        var w = size[0], h = size[1];
        var bandW = Math.floor(w / bands);
        var x = Math.min(index * bandW, Math.max(0, w - 1));
        var width = Math.min(bandW, w - x);
        var px = new Uint8Array(width * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(x, 0, width, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return { width: width, height: h, x: x, audioTime: Number(audioEl.currentTime) || 0, bytes: Array.prototype.slice.call(px) };
      }
    };
  }

  function analyze(px, width, height, maxPoints) {
    var step = Math.max(1, Math.floor((width * height) / maxPoints));
    var lumas = [], sum = 0, sumSq = 0, rgb = [0, 0, 0], n = 0;
    for (var i = 0; i < width * height; i += step) {
      var o = i * 4;
      var l = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
      lumas.push(l); sum += l; sumSq += l * l; n++;
      rgb[0] += px[o]; rgb[1] += px[o + 1]; rgb[2] += px[o + 2];
    }
    lumas.sort(function (a, b) { return a - b; });
    var mean = sum / n;
    return {
      points: n, mean: mean, sigma: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
      p05: lumas[Math.floor(n * 0.005)], p50: lumas[Math.floor(n * 0.5)],
      p995: lumas[Math.min(n - 1, Math.floor(n * 0.995))],
      meanRgb: [rgb[0] / n, rgb[1] / n, rgb[2] / n]
    };
  }

  /* ---------- 音频通路：AnalyserNode → 64 带 → 粗带/通量/起拍 ---------- */
  function initAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !audioEl) return false;
    audioCtx = new AC();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;      /* 与 Node 侧「不做跨帧平滑」对齐，否则两个解析器不可比 */
    analyser.minDecibels = FEATURES_INLINE.DB_FLOOR;
    analyser.maxDecibels = FEATURES_INLINE.DB_CEIL;
    freqBytes = new Uint8Array(analyser.frequencyBinCount);
    try {
      srcNode = audioCtx.createMediaElementSource(audioEl);
      srcNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (e) {
      boot.error = (boot.error ? boot.error + " / " : "") + "media-element-source: " + e.message;
    }
    state.ctxState = audioCtx.state;
    state.audioReady = true;
    return true;
  }

  function readFeatures() {
    if (has("noaudio")) {
      return { bands: new Array(64).fill(0), level: 0, bass: 0, mid: 0, treble: 0, flux: 0, beat: 0 };
    }
    if (has("staticspectrum")) {
      /* 斜坡而不是常数：常数频谱在「沿频带筛带」和「沿频带反转带序」两种改动下都是不变量，
       * 喂进去什么也测不出来；单调斜坡让每一条带都有可预期的唯一取值，判据才有牙齿。 */
      var fake = new Array(64);
      for (var i = 0; i < 64; i++) fake[i] = 0.15 + 0.7 * (i / 63);
      var coarseS = FEATURES_INLINE.coarseFromBands(fake);
      return { bands: fake, level: 0.55, bass: coarseS.bass, mid: coarseS.mid, treble: coarseS.treble, flux: 0, beat: 0 };
    }
    if (!analyser) return { bands: state.bands.slice(), level: 0, bass: 0, mid: 0, treble: 0, flux: 0, beat: 0 };
    analyser.getByteFrequencyData(freqBytes);
    var units = new Float32Array(freqBytes.length);
    for (var k = 0; k < freqBytes.length; k++) units[k] = freqBytes[k] / 255;
    var binWidth = audioCtx.sampleRate / analyser.fftSize;
    var bands = FEATURES_INLINE.aggregateBands(units, binWidth, STYLE.bands.edges);
    var coarse = FEATURES_INLINE.coarseFromBands(bands);
    var flux = FEATURES_INLINE.fluxOf(state.prevBands, bands);
    var t = Number(audioEl.currentTime) || 0;
    var det = has("noonset") ? { beat: false, threshold: 0, meanFlux: 0, warm: false } : detector.push(flux, t);
    if (det.beat) {
      state.beatLog.push(Number(t.toFixed(4)));
      state.pulse = 1;
    }
    state.pulse = Math.max(0, state.pulse - 0.06);
    state.prevBands = bands;
    var level = 0;
    for (var q = 0; q < bands.length; q++) level += bands[q] * bands[q];
    level = Math.sqrt(level / bands.length);
    return {
      bands: bands, level: level, bass: coarse.bass, mid: coarse.mid, treble: coarse.treble,
      flux: flux, beat: state.pulse
    };
  }

  function frameValues(feats) {
    var pal = {};
    Object.keys(STYLE.palette).forEach(function (key) {
      if (key === "name") return;
      pal[key] = STYLE.palette[key];
    });
    return {
      time: state.time, mouse: state.mouse, bands: feats.bands,
      level: feats.level, bass: feats.bass, mid: feats.mid, treble: feats.treble,
      flux: feats.flux, beat: feats.beat, palette: pal
    };
  }

  function pushHistory(feats) {
    if (has("noaudio")) return;                 /* 拔掉音频：历史不推进，画面必须停 */
    state.history.push(feats.bands.slice());
    if (state.history.length > HISTORY_ROWS) state.history.shift();
  }

  function drawFrame(feats) {
    var t0 = Date.now();
    var f = feats || readFeatures();
    pushHistory(f);
    var values = frameValues(f);
    hostFx.draw(values);
    hostStrip.draw(values);
    state.draws += 4;
    state.frameMs = state.frameMs ? state.frameMs * 0.7 + (Date.now() - t0) * 0.3 : Date.now() - t0;
    state.bands = f.bands;
    state.level = f.level; state.bass = f.bass; state.mid = f.mid; state.treble = f.treble;
    state.flux = f.flux; state.beat = f.beat;
    if (statusEl) {
      statusEl.textContent = "响度 " + f.level.toFixed(3) + " · 低 " + f.bass.toFixed(3) +
        " · 中 " + f.mid.toFixed(3) + " · 高 " + f.treble.toFixed(3) +
        " · 起拍 " + state.beatLog.length + " 次 · 播放头 " + (Number(audioEl && audioEl.currentTime) || 0).toFixed(2) + "s";
    }
  }

  function loop(now) {
    if (!state.last) state.last = now;
    var dt = Math.min(0.05, (now - state.last) / 1000);
    state.last = now;
    if (!has("frozen") && !state.paused && !state.hidden) state.time += dt;
    state.frames += 1;
    drawFrame();
    state.raf = window.requestAnimationFrame(loop);
  }

  if (!has("nomouse")) {
    window.addEventListener("pointermove", function (ev) {
      var x = ev.clientX / Math.max(1, window.innerWidth);
      var y = 1 - ev.clientY / Math.max(1, window.innerHeight);
      state.mouse = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
    }, { passive: true });
  }
  document.addEventListener("visibilitychange", function () { state.hidden = document.hidden; });

  if (playBtn) {
    playBtn.addEventListener("click", function () {
      if (!state.audioReady) initAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      if (audioEl.paused) { audioEl.play(); playBtn.textContent = "暂停"; playBtn.setAttribute("aria-pressed", "true"); }
      else { audioEl.pause(); playBtn.textContent = "播放"; playBtn.setAttribute("aria-pressed", "false"); }
      state.ctxState = audioCtx ? audioCtx.state : "none";
    });
  }

  /* 首帧：先画一次，让「没点播放」的打开者也能看到画面 */
  drawFrame();
  state.raf = window.requestAnimationFrame(loop);

  window.__shaderProbe = {
    style: STYLE.name,
    probe: probe,
    boot: boot,
    palette: STYLE.palette,
    uniforms: STYLE.uniforms,
    bandEdges: STYLE.bands.edges,
    featuresApi: Object.keys(FEATURES_INLINE).sort(),
    frames: function () { return state.frames; },
    draws: function () { return state.draws; },
    fps: function () { return state.frames / Math.max(0.001, (Date.now() - started) / 1000); },
    time: function () { return state.time; },
    mouse: function () { return state.mouse.slice(); },
    host: function (tag) { return tag === "strip" ? hostStrip : hostFx; },
    audio: function () {
      return {
        ready: state.audioReady,
        ctxState: audioCtx ? audioCtx.state : "none",
        sampleRate: audioCtx ? audioCtx.sampleRate : 0,
        fftSize: analyser ? analyser.fftSize : 0,
        binCount: analyser ? analyser.frequencyBinCount : 0,
        smoothing: analyser ? analyser.smoothingTimeConstant : -1,
        minDecibels: analyser ? analyser.minDecibels : 0,
        maxDecibels: analyser ? analyser.maxDecibels : 0,
        currentTime: Number(audioEl.currentTime) || 0,
        duration: Number(audioEl.duration) || 0,
        paused: audioEl.paused,
        srcPrefix: audioEl.currentSrc ? audioEl.currentSrc.slice(0, 24) : ""
      };
    },
    features: function () {
      return {
        level: state.level, bass: state.bass, mid: state.mid, treble: state.treble,
        flux: state.flux, beat: state.pulse, bands: state.bands.slice(),
        beatLog: state.beatLog.slice(), historyRows: state.history.length,
        historyHead: state.history.length ? state.history[state.history.length - 1].slice(0, 8) : null,
        drawLog: state.drawLog.slice()
      };
    },
    /* 帧差留在页内算：整块 readPixels 的字节数组（~3.7MB）不适合跨 evaluate 边界 */
    snapshot: function (tag, band) {
      var h = tag === "strip" ? hostStrip : hostFx;
      if (!h.gl) return null;
      h.draw(frameValues(readFeatures()));
      var raw = h.sampleRaw(band || 0);
      state.snap = state.snap || {};
      var key = tag + ":" + (band || 0);
      state.snap[key] = raw;
      return { width: raw.width, height: raw.height, pixels: raw.width * raw.height };
    },
    diff: function (tag, band) {
      var key = tag + ":" + (band || 0);
      var h = tag === "strip" ? hostStrip : hostFx;
      if (!h.gl || !state.snap || !state.snap[key]) return null;
      h.draw(frameValues(readFeatures()));
      var cur = h.sampleRaw(band || 0);
      var prev = state.snap[key];
      if (cur.width !== prev.width || cur.height !== prev.height) return { mismatch: true };
      var changed = 0, totalAbs = 0, pixels = cur.width * cur.height, maxAbs = 0;
      for (var i = 0; i < pixels; i++) {
        var o = i * 4;
        var d = Math.abs(cur.bytes[o] - prev.bytes[o]) + Math.abs(cur.bytes[o + 1] - prev.bytes[o + 1]) + Math.abs(cur.bytes[o + 2] - prev.bytes[o + 2]);
        if (d > 6) changed++;                 /* 6/765 ≈ 0.8%：软件 GL 的抖动下限 */
        totalAbs += d; if (d > maxAbs) maxAbs = d;
      }
      return {
        pixels: pixels, changed: changed, changedPct: changed / pixels,
        meanAbsDelta: totalAbs / (pixels * 3), maxAbsDelta: maxAbs,
        audioTimePrev: prev.audioTime, audioTimeNow: cur.audioTime
      };
    },
    info: function () {
      function pack(h) {
        return {
          tag: h.tag, ok: !!h.ok, bands: h.bands,
          declared: h.declared, missing: h.missing,
          provided: STYLE.uniforms,
          log: h.log ? h.log() : "",
          glError: h.glError ? h.glError() : -1,
          lastUniforms: h.lastUniforms ? h.lastUniforms() : null,
          buffer: h.size(), css: h.cssSize()
        };
      }
      return { fx: pack(hostFx), strip: pack(hostStrip) };
    },
    stats: function (tag, band) {
      var h = tag === "strip" ? hostStrip : hostFx;
      if (!h.gl) return null;
      h.draw(frameValues(readFeatures()));
      return h.sampleRegion(band || 0, 6000);
    },
    raw: function (tag, band) {
      var h = tag === "strip" ? hostStrip : hostFx;
      if (!h.gl) return null;
      h.draw(frameValues(readFeatures()));
      return h.sampleRaw(band || 0);
    },
    start: function () {
      if (!state.audioReady) initAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      return audioEl.play().then(function () {
        state.ctxState = audioCtx ? audioCtx.state : "none";
        return { played: true, ctxState: audioCtx ? audioCtx.state : "none", currentTime: Number(audioEl.currentTime) };
      }).catch(function (e) {
        boot.error = (boot.error ? boot.error + " / " : "") + "play: " + e.name;
        return { played: false, error: String(e && e.name) };
      });
    },
    pauseAudio: function () { audioEl.pause(); return { paused: true, currentTime: Number(audioEl.currentTime) }; },
    seek: function (t) { return new Promise(function (resolve) {      audioEl.currentTime = t;
      var done = function () {
        audioEl.removeEventListener("seeked", done);
        if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
        if (audioEl.paused) audioEl.play().catch(function () {});
        resolve(Number(audioEl.currentTime));
      };
      audioEl.addEventListener("seeked", done);
    }); },
    warm: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
    setPaused: function (v) { state.paused = !!v; },
    stopLoop: function () { cancelAnimationFrame(state.raf); state.raf = 0; },
    drawOnce: function () { drawFrame(); }
  };

  boot.ok = !!(hostFx.gl && hostStrip.gl && hostFx.missing.length === 0 && hostStrip.missing.length === 0);
  if (!boot.ok && boot.stage === "init") boot.stage = "uniform-missing";
  document.body.setAttribute("data-boot", boot.ok ? "ok" : boot.stage);
})();
