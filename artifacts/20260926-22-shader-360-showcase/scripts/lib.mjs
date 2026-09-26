/* 共用取段工具：把产物 HTML 切成「变体段」与「共用段」。
 * check-node / mutate / make-styles 三处共用一份切法，避免各写一份口径导致互相比不出差异。
 * 变体区只有两处：<style> 与 frag 内的 SHADE 段；其余必须逐字节相同。 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
export const read = (p) => fs.readFileSync(p, "utf8");
export const bytes = (s) => Buffer.byteLength(s);

/** 剥掉注释：条款核对一律针对代码本体，否则「注释里提到 uTime」会让 uTime 归零断言假失败 */
export function noComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** 取 <script> 区里的正文（区段本身带着 script 标签） */
export function scriptBody(regionText) {
  const m = regionText.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("区里没有 <script> 标签");
  return m[1];
}


export function region(html, name) {
  const m = html.match(new RegExp(`<!--@${name}:BEGIN-->([\\s\\S]*?)<!--@${name}:END-->`));
  if (!m) throw new Error(`缺少 @${name} 段`);
  return m[1];
}

export function shadeOf(frag) {
  const m = frag.match(/\/\/ SHADE-BEGIN[\s\S]*?\/\/ SHADE-END/);
  if (!m) throw new Error("frag 里没有 SHADE 段");
  return m[0];
}

/** 把 frag 里的变体段换成定长占位，剩下的就是「共用几何/视角/出口」 */
export function fragShared(frag) {
  return frag.replace(/\/\/ SHADE-BEGIN[\s\S]*?\/\/ SHADE-END/, "// SHADE-VARIANT");
}

/** DOM 区里唯一合法的变体是 <body data-skin="...">，归一化后才能逐字节比 */
export function domNormalized(bodyRegion) {
  return bodyRegion.replace(/data-skin="[a-z]+"/, 'data-skin="X"');
}

/** :root 令牌表（保序），并解引用 var() */
export function rootTokens(css) {
  const block = css.match(/:root\s*\{([^}]*)\}/);
  if (!block) throw new Error("CSS 缺 :root 块");
  const raw = new Map();
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) raw.set(m[1], m[2].trim());
  const out = new Map();
  const resolve = (v, depth = 0) => {
    if (depth > 6) return v;
    return v.replace(/var\((--[a-z0-9-]+)\)/g, (_, k) => (raw.has(k) ? resolve(raw.get(k), depth + 1) : `var(${k})`));
  };
  for (const [k, v] of raw) out.set(k, resolve(v));
  return out;
}

export function hexOf(cssValue) {
  const m = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(cssValue);
  return m ? m[0] : null;
}

export function toRgb(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
}

export function vec3Of(hex) {
  return toRgb(hex).map((x) => +(x / 255).toFixed(6));
}

export function relLum([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(hexA, hexB) {
  const la = relLum(toRgb(hexA)), lb = relLum(toRgb(hexB));
  return +((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(2);
}

/** 页面的 style 段（去掉外层标签） */
export function styleOf(html) {
  const r = region(html, "STYLE");
  const m = r.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("@STYLE 区里没有 <style>");
  return m[1];
}

/** 产物切段：一次拿全七块，供 check / mutate / make-styles 共用 */export function parts(html) {
  const css = styleOf(html);
  const m = html.match(/<body[^>]*>[\s\S]*?(?=<script id="facts")/);
  if (!m) throw new Error("找不到 body → facts 之间的 DOM 区");
  const frag = region(html, "FRAG");
  const shade = shadeOf(frag);
  return {
    css,
    domRaw: m[0],
    dom: domNormalized(m[0]),
    vert: region(html, "VERT"),
    vertCode: scriptBody(region(html, "VERT")),
    frag,
    fragCode: scriptBody(frag),
    shade,
    shadeCode: noComments(shade),
    fragShared: fragShared(frag),
    host: region(html, "HOST"),
    hostCode: noComments(scriptBody(region(html, "HOST"))),
    head: frag.match(/\/\/ HEAD-BEGIN[\s\S]*?\/\/ HEAD-END/)[0],
    geometry: frag.match(/\/\/ GEOMETRY-BEGIN[\s\S]*?\/\/ GEOMETRY-END/)[0],
    main: frag.match(/\/\/ MAIN-BEGIN[\s\S]*?\/\/ MAIN-END/)[0],
  };
}

/* ---------- 数字指针：对照页与三套页面里的每个数字都由「指针 → 现算」得到 ----------
 * 生成侧（make-styles / build）与校验侧（check-node 的 N 组）必须用同一个解析器，
 * 否则两边各写一份口径，页面数字与事实的对应关系就成了不可证伪的声明。
 * 一切从磁盘现读：evidence/*.json 是各套件的落盘结果，src/*.json 是唯一事实源。 */
const jsonAt = (obj, ptr) => String(ptr).split("/").filter(Boolean)
  .reduce((a, k) => (a == null ? a : a[/^\d+$/.test(k) ? +k : k]), obj);
export function makeResolver(ROOT, styles) {
  const file = (rel) => path.join(ROOT, rel);
  const json = (rel) => JSON.parse(fs.readFileSync(file(rel), "utf8"));
  const previewBytes = () => styles.reduce((a, s) => a + Buffer.byteLength(read(file(`preview/showcase-${s}.html`))), 0);
  const minRatio = (s) => {
    const rows = json("evidence/contrast.json").filter((c) => c.style === s);
    return String(Math.min(...rows.map((c) => c.ratio)));
  };
  return function resolvePointer(ptr) {
    const colon = ptr.indexOf(":");
    const kind = ptr.slice(0, colon);
    const arg = ptr.slice(colon + 1);
    try {
      if (kind === "bytes") return fs.existsSync(file(arg)) ? Buffer.byteLength(read(file(arg))) : null;
      if (kind === "sha1") return fs.existsSync(file(arg)) ? sha1(read(file(arg))).slice(0, 12) : null;
      if (kind === "json") {
        const [rel, jptr] = arg.split("#");
        const v = jsonAt(json(rel), jptr);
        return v == null ? null : v;
      }
      if (kind === "count") {
        const [rel, jptr] = arg.split("#");
        const v = jsonAt(json(rel), jptr);
        return Array.isArray(v) || (v && typeof v === "object") ? String(Object.keys(v).length) : null;
      }
      if (kind === "css") {
        const [style, token] = arg.split(":");
        const v = rootTokens(read(file(`src/skins/${style}.css`))).get(token);
        return v == null ? null : v;
      }
      if (kind === "calc") {
        if (arg === "previewTotalBytes") return String(previewBytes());
        if (arg.startsWith("minRatio.")) return minRatio(arg.slice(9));
        if (arg === "mirrorWidth") return String(json("src/product.json").controls.backingStorePx - 1);
        if (arg === "sweepCount") return String(json("evidence/browser-report.json").evidence.sweep[styles[0]].length);
        if (arg.startsWith("shotBytes.")) return fs.existsSync(file(`shots/${arg.slice(10)}.png`)) ? String(Buffer.byteLength(fs.readFileSync(file(`shots/${arg.slice(10)}.png`)))) : null;
        // 镜像恒等式的左边：两个方位的顶带重心之和，由 evidence 现算，页面上只是把结果写出来
        if (arg.startsWith("bandCxSum.")) {
          const [, style, idx] = arg.split(".");
          const sw = json("evidence/browser-report.json").evidence.sweep[style];
          const a = sw[+idx];
          const b = sw.find((r) => r.az === (((180 - a.az) % 360) + 360) % 360);
          return a && b && a.bandCx != null && b.bandCx != null ? +(a.bandCx + b.bandCx).toFixed(2) : null;
        }
        return null;
      }
      return null;
    } catch { return null; }
  };
}

