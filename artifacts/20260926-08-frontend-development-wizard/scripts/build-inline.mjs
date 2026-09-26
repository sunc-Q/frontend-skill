import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = readFileSync(path.join(root, 'dist/assets/main.js'), 'utf8');

const PAGES = [
  { id: 'paper-grid', file: 'wizard-paper-grid.html', title: '方格信笺', note: '格纹纸底、衬线标题、虚线焦点框' },
  { id: 'pcb-green', file: 'wizard-pcb-green.html', title: 'PCB 阻焊绿', note: '深绿阻焊底、全等宽字、45° 走线纹与发光焦点' },
  { id: 'concrete-rose', file: 'wizard-concrete-rose.html', title: '清水混凝土玫瑰金', note: '灰混凝土底、大写字重标题、硬偏移阴影与衬线数字' },
];

const escaped = bundle.replaceAll('</script', '<\\/script');
const escapes = bundle.split('</script').length - 1;

mkdirSync(path.join(root, 'preview'), { recursive: true });

const results = PAGES.map((p) => {
  const html = `<!doctype html>
<html lang="zh-CN" data-fd-style="${p.id}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>潮汐社开店向导 · frontend-development × 表单密集多步向导 · ${p.title}</title>
<meta name="description" content="frontend-development 技能验证产物：四步 22 字段向导，同一份源码、同一份事实源的三种风格。${p.note}">
</head>
<body>
<div id="root"></div>
<script>
${escaped}
</script>
</body>
</html>
`;
  const out = path.join(root, 'preview', p.file);
  writeFileSync(out, html, 'utf8');
  return { id: p.id, file: `preview/${p.file}`, bytes: Buffer.byteLength(html, 'utf8') };
});

/* The ablation arm is a second build of identical source; keep its size for the cost group. */
const plainPath = path.join(root, 'dist-plain/assets/main.js');
let plainBytes = 0;
try {
  plainBytes = Buffer.byteLength(readFileSync(plainPath, 'utf8'), 'utf8');
} catch {
  plainBytes = 0;
}

const meta = {
  bundleBytes: Buffer.byteLength(bundle, 'utf8'),
  plainBundleBytes: plainBytes,
  scriptEscapes: escapes,
  pages: results,
};
writeFileSync(path.join(root, 'scripts', 'build-inline-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(meta));
