/* 用 dist 的 IIFE bundle + 各主题 CSS 生成三个可直接双击打开的单文件页面 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const js = readFileSync(join(root, 'dist/beacon.js'), 'utf8');
const baseCss = readFileSync(join(root, 'src/styles/base.css'), 'utf8');
const themes = [
  ['business', '商务白'],
  ['mono', '单色暗'],
  ['win95', '95 桌面'],
];

mkdirSync(join(root, 'preview'), { recursive: true });

for (const [id, label] of themes) {
  const themeCss = readFileSync(join(root, `src/styles/theme-${id}.css`), 'utf8');
  const html = `<!doctype html>
<html lang="zh-CN" data-theme="${id}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Beacon 短链服务 · 运营后台 · ${label}</title>
<style>
${baseCss}
${themeCss}
</style>
</head>
<body>
<div id="root"></div>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
<script>BeaconAdmin.mount(document.getElementById('root'));</script>
</body>
</html>
`;
  writeFileSync(join(root, 'preview', `admin-${id}.html`), html);
  console.log(id, (html.length / 1024).toFixed(1) + 'KB');
}
