/* Build both deliverable forms of the three reference-driven styles.
   Requires: esbuild + three@0.160.0 (install command in report §2).
     form 1 <id>.html      — offline single file (three bundled in from npmmirror); this is
                             the form that must work from file:// with no network.
     form 2 cdn/<id>.html  — the skill's documented shape: importmap + jsDelivr.
   Titles/ids come from src/themes.js, i.e. from the generated file, never hand-typed here.
   Run from LAB root:
     node artifacts/20260926-05-build-game-reference-driven/scripts/build.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const THREE_PKG = process.env.THREE_PKG || '.tmp/refbuild/node_modules/three';

function loadEsbuild() {
  const req = createRequire(path.resolve(process.cwd(), 'noop.js'));
  let p;
  try {
    p = req.resolve('esbuild', { paths: [path.resolve(process.cwd(), path.dirname(THREE_PKG))] });
  } catch (e) {
    console.error('esbuild not found next to ' + THREE_PKG + ' — reinstall (report §2). ' + e.message);
    process.exit(2);
  }
  return req(p);
}

async function main() {
  const esbuild = loadEsbuild();
  const { THEMES } = await import(pathToFileURL(path.join(SCENE, 'src', 'themes.js')).href);
  fs.mkdirSync(path.join(SCENE, 'cdn'), { recursive: true });
  const alias = {
    three: path.resolve(process.cwd(), THREE_PKG, 'build/three.module.js'),
    'three/addons': path.resolve(process.cwd(), THREE_PKG, 'examples/jsm'),
  };
  const sizes = {};
  for (const t of THEMES) {
    const title = `${t.game} ${t.label}`;
    /* ---- form 1: offline single file ---- */
    const res = await esbuild.build({
      entryPoints: [path.join(SCENE, 'src', 'entry.js')],
      bundle: true, format: 'iife', target: ['es2020'], minify: true, write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      alias,
    });
    let js = res.outputFiles[0].text;
    const escCount = (js.match(/<\/script/gi) || []).length;
    js = js.replace(/<\/script/gi, '<\\/script');
    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;overflow:hidden}canvas{display:block}</style>
</head>
<body>
<script>window.__THEME_ID = '${t.id}';</script>
<script>${js}</script>
</body>
</html>
`;
    fs.writeFileSync(path.join(SCENE, t.id + '.html'), html);
    sizes[t.id] = { bytes: Buffer.byteLength(html), bundleBytes: Buffer.byteLength(js), escapedScriptClose: escCount };

    /* ---- form 2: the skill's documented deliverable (importmap + CDN) ---- */
    const res2 = await esbuild.build({
      entryPoints: [path.join(SCENE, 'src', 'entry.js')],
      bundle: true, format: 'esm', target: ['es2020'], minify: false, write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      external: ['three', 'three/addons/*'], alias: {},
    });
    const esm = res2.outputFiles[0].text;
    const cdnHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
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
    sizes[t.id].cdnImports = [...esm.matchAll(/^import\s/gm)].length;
    console.log(t.id, JSON.stringify(sizes[t.id]));
  }
  fs.writeFileSync(path.join(SCENE, 'scripts', 'build-sizes.json'), JSON.stringify(sizes, null, 1));
}
main();
