/* Build both deliverable forms of the three styles.
   Requires: esbuild + three@0.160.0 (see report §2 for the install command).
   form 1 <id>.html        — offline single file, three bundled in from npmmirror.
   form 2 cdn/<id>.html    — the skill's documented shape (importmap + jsDelivr).
     It does load here: curl gets a TLS reset on that host but Chromium gets 200,
     so the offline form is a convenience, not a workaround (report §3).
   Run from LAB root:  node artifacts/20260926-03-build-game-tower-defense/scripts/build.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const THREE_PKG = process.env.THREE_PKG || '.tmp/build/node_modules/three';
const THEMES = [
  { id: 'sunlit-moss', title: '苔原哨站 TOWERLINE · 日光苔原' },
  { id: 'obsidian-lava', title: '熔脉哨站 TOWERLINE · 曜岩熔脉' },
  { id: 'arctic-glass', title: '极冠哨站 TOWERLINE · 极冠晶塔' },
];

function loadEsbuild() {
  const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
  let p;
  try {
    p = req.resolve('esbuild', { paths: [path.resolve(process.cwd(), '.tmp/build/node_modules')] });
  } catch (e) {
    console.error('esbuild not found at .tmp/build/node_modules — reinstall (report §2). ' + e.message);
    process.exit(2);
  }
  return req(p);
}

async function main() {
  const esbuild = loadEsbuild();
  fs.mkdirSync(path.join(SCENE, 'cdn'), { recursive: true });
  const sizes = {};
  const alias = {
    three: path.resolve(process.cwd(), THREE_PKG, 'build/three.module.js'),
    'three/addons': path.resolve(process.cwd(), THREE_PKG, 'examples/jsm'),
  };
  for (const t of THEMES) {
    /* form 1 — offline single file: three is bundled in, no network at open time */
    const res = await esbuild.build({
      entryPoints: [path.join(SCENE, 'src', 'entry.js')],
      bundle: true,
      format: 'iife',
      target: ['es2020'],
      minify: true,
      write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      alias,
    });
    let js = res.outputFiles[0].text;
    /* inlining safety: a literal </script> inside the bundle would end the tag */
    const escCount = (js.match(/<\/script/gi) || []).length;
    js = js.replace(/<\/script/gi, '<\\/script');
    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>window.__THEME_ID = '${t.id}';</script>
<script>${js}</script>
</body>
</html>
`;
    const out = path.join(SCENE, t.id + '.html');
    fs.writeFileSync(out, html);
    sizes[t.id] = {
      bytes: Buffer.byteLength(html),
      bundleBytes: Buffer.byteLength(js),
      escapedScriptClose: escCount,
    };

    /* form 2 — the skill's documented deliverable: importmap + bare 'three' specifiers */
    const res2 = await esbuild.build({
      entryPoints: [path.join(SCENE, 'src', 'entry.js')],
      bundle: true,
      format: 'esm',
      target: ['es2020'],
      minify: false,
      write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      external: ['three', 'three/addons/*'],
      alias: {},
    });
    const esm = res2.outputFiles[0].text;
    const cdnHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;overflow:hidden}canvas{display:block}</style>
<script type="importmap">
{
    "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
}
</script>
</head>
<body>
<script>window.__THEME_ID = '${t.id}';</script>
<script type="module">${esm}</script>
</body>
</html>
`;
    fs.writeFileSync(path.join(SCENE, 'cdn', t.id + '.html'), cdnHtml);
    sizes[t.id].cdnBytes = Buffer.byteLength(cdnHtml);
    sizes[t.id].cdnModuleGraph = [...esm.matchAll(/^import .*?;$/gm)].length;
    console.log(t.id, JSON.stringify(sizes[t.id]));
  }
  fs.writeFileSync(path.join(SCENE, 'scripts', 'build-sizes.json'), JSON.stringify(sizes, null, 1));
}
main();
