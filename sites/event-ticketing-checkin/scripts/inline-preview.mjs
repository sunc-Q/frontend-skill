#!/usr/bin/env node
// 把 dist/ 的构建产物压成「一个 HTML 文件」：JS 与 CSS 全部内联。
// 动机：Vite 的 ESM 产物在 file:// 下不执行，单文件版才能被直接双击打开/交付。
//
// 关键实现约束：内联的 JS 里合法含有 `<\/script>` 这类转义串，绝对不能用正则去
// 匹配「脚本区」再拼接；必须先按精确下标定位 <script src=...> 标签，再切片替换。
// 用法：node scripts/inline-preview.mjs <web目录> <API基址>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const webDir = resolve(process.argv[2] ?? '');
const apiBase = process.argv[3] ?? 'http://127.0.0.1:8080/api';
if (!webDir) {
  console.error('用法: node inline-preview.mjs <web目录> [API基址]');
  process.exit(2);
}
const dist = join(webDir, 'dist');
const outDir = resolve(dirname(webDir), 'preview');
const htmlPath = join(dist, 'index.html');
if (!existsSync(htmlPath)) {
  console.error(`找不到 ${htmlPath}，请先执行 vite build`);
  process.exit(2);
}
const THEMES = [
  { id: 'velvet', name: '丝绒影院售票亭' },
  { id: 'nautical', name: '航海图罗盘' },
  { id: 'typewriter', name: '老式打字机稿件' },
];

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};

let html = readFileSync(htmlPath, 'utf8');
// 模板 index.html 上带默认 data-theme；先摘掉，避免与下面注入的主题属性冲突。
html = html.replace(/\s+data-theme="[^"]*"/g, '');

// 1) CSS：外链样式表（本项目 cssCodeSplit:false，通常为空，保留通用处理）
let css = '';
for (;;) {
  const m = /<link[^>]*href="([^"]+\.css)"[^>]*>/.exec(html);
  if (!m) break;
  css += readFileSync(join(dist, m[1].replace(/^\.?\//, '')), 'utf8') + '\n';
  html = html.slice(0, m.index) + html.slice(m.index + m[0].length);
}

// 2) JS 入口：按精确下标定位，不允许出现第二个
const jsMatch = /<script[^>]*\ssrc="([^"]+\.js)"[^>]*><\/script>/.exec(html);
if (!jsMatch) fail('未找到 JS 入口标签');
if (html.slice(jsMatch.index + jsMatch[0].length).includes('.js"></script>')) {
  fail(`期望恰好 1 个 JS 入口，实得多于 1 个`);
}
const js = readFileSync(join(dist, jsMatch[1].replace(/^\.?\//, '')), 'utf8');
// 若产物里出现未转义的 </script>，内联后浏览器会提前闭合标签，必须直接失败而不是产出坏文件。
if (/<\/script\s*>/i.test(js)) fail('JS 产物含未转义 </script>，不能内联');

mkdirSync(outDir, { recursive: true });

for (const t of THEMES) {
  // 用 || 兜底而不是直接赋值：托管服务器（serve-static.mjs）可能已在 <head> 之前
  // 注入 __API_BASE__/__THEME__，注入值优先于文件里的默认值。
  const bootstrap =
    `window.__API_BASE__=window.__API_BASE__||${JSON.stringify(apiBase)};` +
    `window.__THEME__=window.__THEME__||${JSON.stringify(t.id)};` +
    `window.__THEME_FALLBACK=${JSON.stringify(t.name)};`;

  let out = html.replace(/<html([^>]*)>/, (_m, attrs) => `<html${attrs} data-theme=${JSON.stringify(t.id)}>`);
  const scriptTag =
    `<script>${bootstrap}</script>\n    ` +
    (css ? `<style>${css}</style>\n    ` : '') +
    `<script type="module">${js}</script>`;
  // 上面摘除 data-theme 改变了长度，故按标签内容重新定位。
  const orig = jsMatch[0];
  const cut = out.indexOf(orig);
  if (cut < 0) fail('JS 入口标签在写回时定位失败');
  out = out.slice(0, cut) + scriptTag + out.slice(cut + orig.length);

  if (!out.includes(js)) fail('内联失败：JS 未完整写入');
  if (out.indexOf(js) !== out.lastIndexOf(js)) fail('内联失败：JS 重复写入');

  const file = join(outDir, `${t.id}.html`);
  writeFileSync(file, out, 'utf8');
  console.log(`写入 ${file} (${(out.length / 1024).toFixed(1)} KB)`);
}
