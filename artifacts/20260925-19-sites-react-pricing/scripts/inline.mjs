/* 用 dist 的 IIFE bundle + 各主题 CSS 生成三个可直接双击打开的单文件页面。
   关键顺序：base.css 在前、theme css 在后 —— 同特异性时后写者胜。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const js = readFileSync(join(root, 'dist/songta.js'), 'utf8');
const baseCss = readFileSync(join(root, 'src/styles/base.css'), 'utf8');

const THEMES = [
  ['bauhaus', '包豪斯构件'],
  ['chrome', '千禧镀铬'],
  ['blueprint', '工程蓝图'],
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
<title>松塔 Songta · 定价 · ${label}</title>
<meta name="description" content="按席位阶梯计价的反馈管理平台定价页（${label}风格，单文件可离线打开）" />
<style>
${baseCss}
${themeCss}
</style>
</head>
<body>
<div id="root"></div>
<script>${body}</script>
<script>SongtaPricing.mount(document.getElementById('root'));</script>
</body>
</html>
`;
  writeFileSync(join(root, 'preview', `pricing-${id}.html`), html);
  // html.length 是 UTF-16 码元数，与文件字节数差 2% 以上（中文文案多）——报表只认字节
  const bytes = Buffer.byteLength(html, 'utf8');
  console.log('preview/pricing-' + id + '.html', bytes + ' bytes (' + (bytes / 1000).toFixed(1) + 'KB)');
}
