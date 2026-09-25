import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = fileURLToPath(new URL('.', import.meta.url));
void SH;
const bundle = readFileSync(path.join(root, 'dist/assets/main.js'), 'utf8');

const PAGES = [
  { id: 'neumorph', file: 'admin-neumorph.html', title: '软浮雕', note: '同底色浮起、零描边、双向阴影塑形' },
  { id: 'bitmap', file: 'admin-bitmap.html', title: '1-bit 系统', note: '两色位图、1px 实线网格、零圆角零阴影' },
  { id: 'phosphor', file: 'admin-phosphor.html', title: '监护仪荧光', note: '近黑青底、磷绿读数、琥珀告警' },
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
<title>Beacon 信标 · 管理后台 · ${p.title}</title>
<meta name="description" content="frontend-development 技能验证产物：同一份源码、同一份事实源的三种风格。${p.note}">
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

const meta = { bundleBytes: Buffer.byteLength(bundle, 'utf8'), scriptEscapes: escapes, pages: results };
writeFileSync(path.join(root, 'scripts', 'build-inline-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(meta));
