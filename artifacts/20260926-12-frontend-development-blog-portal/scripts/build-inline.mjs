import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'dist/assets/main.js');
const bundle = readFileSync(bundlePath, 'utf8');

/* The three ids must stay in sync with src/lib/style/registry.ts (assertion C1 checks it). */
const PAGES = [
  { id: 'topo-tactical', file: 'portal-topo-tactical.html', title: '等高线战术图', note: '卡其底、正交细网、全直角、等宽大写标签、行首红条' },
  { id: 'clay-stop', file: 'portal-clay-stop.html', title: '黏土定格动画', note: '奶白底、26px 大圆角、粗描边、硬偏移阴影、标签贴纸化' },
  { id: 'vinyl-crate', file: 'portal-vinyl-crate.html', title: '黑胶唱片架', note: '深棕底、刻纹背景、窄体大写、琥珀主色、反色标签' },
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
<title>灰度通讯 · frontend-development × 博客内容门户 · ${p.title}</title>
<meta name="description" content="frontend-development 技能验证产物：240 篇虚构文章的三路由内容门户，同一份源码与同一份事实源的三种外观。${p.note}">
</head>
<body>
<div id="root"></div>
<noscript>本站是技能验证用的静态产物，需要 JavaScript 才能渲染；页面数据不来自任何网络请求。</noscript>
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

/*
 * A module host for the split build: group K navigates the real chunk graph over http, which the
 * inlined single-file previews cannot show (their dynamic imports were folded away at build time).
 */
const splitEntry = 'dist-split/assets/main.js';
if (existsSync(path.join(root, splitEntry))) {
  const html = `<!doctype html>
<html lang="zh-CN" data-fd-style="topo-tactical">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>灰度通讯 · 分包证据构建（ES modules）</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/${splitEntry}"></script>
</body>
</html>
`;
  writeFileSync(path.join(root, 'preview', 'split-host.html'), html, 'utf8');
}

/*
 * Verification-only hosts for the ablation arms (group G counts their requests over real HTTP).
 * Same shell, same style, only the baked-in __FD_ARM__ constant differs — which is the point.
 */
const ARM_HOSTS = [
  ['dist-nomemo', 'arm-nomemo.html', '消融臂：关掉 React.memo 行组件'],
  ['dist-novirtual', 'arm-novirtual.html', '消融臂：关掉虚拟滚动'],
  ['dist-unstablekey', 'arm-unstablekey.html', '消融臂：queryKey 每次渲染都变'],
];
const armPages = [];
for (const [dir, file, note] of ARM_HOSTS) {
  const entry = path.join(root, dir, 'assets/main.js');
  if (!existsSync(entry)) continue;
  const src = readFileSync(entry, 'utf8').replaceAll('</script', '<\\/script');
  const html = `<!doctype html>
<html lang="zh-CN" data-fd-style="topo-tactical">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>灰度通讯 · ${note}</title>
<meta name="description" content="${note}。仅用于验证，不是交付页面。">
</head>
<body>
<div id="root"></div>
<script>
${src}
</script>
</body>
</html>
`;
  writeFileSync(path.join(root, 'preview', file), html, 'utf8');
  armPages.push({ file: `preview/${file}`, bytes: Buffer.byteLength(html, 'utf8'), note });
}

const ARMS = ['dist', 'dist-nomemo', 'dist-novirtual', 'dist-unstablekey', 'dist-split'];
const sizes = {};
for (const a of ARMS) {
  const f = path.join(root, `${a}/assets/main.js`);
  sizes[a] = existsSync(f) ? statSync(f).size : 0;
}

const meta = {
  bundleBytes: Buffer.byteLength(bundle, 'utf8'),
  scriptEscapes: escapes,
  armBytes: sizes,
  pages: results,
  armPages,
};
writeFileSync(path.join(root, 'scripts', 'build-inline-meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(meta));
