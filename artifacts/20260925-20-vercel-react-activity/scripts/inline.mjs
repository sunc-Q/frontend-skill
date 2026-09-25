/* 用 dist 的 IIFE bundle + base.css + 主题 CSS 生成三个可双击打开的单文件页面。
   顺序即层叠：base.css 在前、theme css 在后（同特异性后写者胜）。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const js = readFileSync(join(root, 'dist/soundisle.js'), 'utf8');
const baseCss = readFileSync(join(root, 'src/styles/base.css'), 'utf8');

const THEMES = [
  ['deco', '装饰艺术 Art Deco'],
  ['vapor', '蒸汽波 Vaporwave'],
  ['riso', '孔版印刷 Risograph'],
];

mkdirSync(join(root, 'preview'), { recursive: true });

const sizes = [];
for (const [id, label] of THEMES) {
  const themeCss = readFileSync(join(root, `src/styles/theme-${id}.css`), 'utf8');
  // 只打断 </script：react-dom 字符串常量里有 <script 字面量，但不能提前终止标签
  const body = js.replace(/<\/script/gi, (_m) => '<\\/script');
  const html = `<!doctype html>
<html lang="zh-CN" data-theme="${id}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>星屿·声浪岛音乐节 · ${label}</title>
<meta name="description" content="活动营销页（${label}风格）：真实取数架构的 file:// 单文件版，数据由同一资源层的 fixture 传输提供" />
<style>
${baseCss}
${themeCss}
</style>
</head>
<body>
<div id="root"></div>
<script>${body}</script>
<script>SoundIsleActivity.mount(document.getElementById('root'));</script>
</body>
</html>
`;
  writeFileSync(join(root, 'preview', `activity-${id}.html`), html);
  // 只认字节数（Buffer.byteLength），html.length 是 UTF-16 码元数会偏小
  const bytes = Buffer.byteLength(html, 'utf8');
  sizes.push([id, bytes]);
  console.log('preview/activity-' + id + '.html ' + bytes + ' bytes (' + (bytes / 1000).toFixed(1) + 'KB)');
}
