/* 用 dist 的 IIFE bundle + 各主题 CSS 生成三个可直接双击打开的单文件页面。
   关键顺序：base.css 在前、theme css 在后 —— 同特异性时后写者胜。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const js = readFileSync(join(root, 'dist/shiguang.js'), 'utf8');
const baseCss = readFileSync(join(root, 'src/styles/base.css'), 'utf8');

const THEMES = [
  ['wabi', '侘寂留白'],
  ['construct', '构成主义'],
  ['memphis', '孟菲斯'],
];

mkdirSync(join(root, 'preview'), { recursive: true });

for (const [id, label] of THEMES) {
  const themeCss = readFileSync(join(root, `src/styles/theme-${id}.css`), 'utf8');
  // 只需打断 </script：bundle 里 react-dom 的字符串常量含 <script>，但不会提前终止标签
  const body = js.replace(/<\/script/gi, (_m) => '<\\/script');
  const html = `<!doctype html>
<html lang="zh-CN" data-theme="${id}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>拾光 Shiguang · 端侧相册整理 · ${label}</title>
<style>
${baseCss}
${themeCss}
</style>
</head>
<body>
<div id="root"></div>
<script>${body}</script>
<script>ShiguangLanding.mount(document.getElementById('root'));</script>
</body>
</html>
`;
  writeFileSync(join(root, 'preview', `landing-${id}.html`), html);
  console.log('preview/landing-' + id + '.html', (html.length / 1024).toFixed(1) + 'KB');
}
