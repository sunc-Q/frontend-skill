/* 风格 / 分层 / 级联 / bundle 断言：
   1) 三页内联 <script> 必须逐字节相同（只换 CSS 不换 JS）
   2) 去 :root 后 CSS 不得残留十六进制色（分层纪律）
   3) 三风格各自招牌特征互不混淆
   4) base → theme 的拼接顺序（级联即优先级）
   5) split 构建里 poster/analytics 是独立 chunk 且首包不含其实现（bundle-* 证据） */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
let pass = 0;
const fails = [];
function ok(name, cond, extra = '') {
  if (cond) pass += 1;
  else fails.push(name + (extra === '' ? '' : ' — ' + extra));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}
const THEMES = ['deco', 'vapor', 'riso'];
const html = (t) => readFileSync(join(root, 'preview', 'activity-' + t + '.html'), 'utf8');

/* --- 1. 内联脚本一致性（用捕获组取脚本体，不手算偏移） --- */
const SCRIPT_RE = /<script>([\s\S]*?)<\/script>/;
const bundleJs = readFileSync(join(root, 'dist', 'soundisle.js'), 'utf8');
const inlineBodies = THEMES.map((t) => html(t).match(SCRIPT_RE)?.[1] ?? '');
ok('bundle: 三页取到内联脚本', inlineBodies.every((s) => s.length > 100000));
ok('bundle: 三页内联脚本逐字节相同', inlineBodies[0] === inlineBodies[1] && inlineBodies[1] === inlineBodies[2], '长度 ' + inlineBodies.map((s) => s.length).join('/'));
// 不变式：内联体必须逐字节等于「对 dist 原文做同一转义」的结果。
// 注意 dist 里 react-dom 自带已转义字面量 `<\/script`，它不该被重复计数，故不做计数比较而是整体比对。
const escaped = bundleJs.replace(/<\/script/gi, () => '<\\/script');
ok('bundle: 内联体 = dist 经转义后的逐字节副本', inlineBodies[0] === escaped,
  '差异首字节 @' + (inlineBodies[0] === escaped ? -1 : firstDiff(inlineBodies[0], escaped)));
const escCount = (bundleJs.match(/<\/script/gi) ?? []).length;
const expectedInline = Buffer.byteLength(bundleJs, 'utf8') + escCount;
ok('bundle: 内联字节 = dist 字节 + 转义字节', Buffer.byteLength(inlineBodies[0], 'utf8') === expectedInline, Buffer.byteLength(inlineBodies[0], 'utf8') + ' vs ' + expectedInline);

/* --- 2. 零外链：行首 script 标签只有内联体；无 http(s) 资源引用 ---
   说明：bundle 里残留的 URL 均为「数据串」而非资源加载——w3.org 命名空间（SVG/MathML/xlink
   的 xmlns 值，浏览器不会请求）与 react.dev 错误码链接（仅出现在报错文案里）。
   真正有约束力的是标签级断言：不存在任何带外链的 link/img/script 标签。 */
const DATA_URL = /^(?:http:\/\/www\.w3\.org\/|https:\/\/react\.dev\/errors\/)/;
for (const t of THEMES) {
  const h = html(t);
  eq(t + ': script 标签均为内联', (h.match(/^<script>/gm) ?? []).length, 2);
  const urls = h.match(/https?:\/\/[^"'<>\\]*/g) ?? [];
  const bad = urls.filter((u) => !DATA_URL.test(u));
  ok(t + ': 无 http(s) 外链（数据串除外）', bad.length === 0, bad.slice(0, 2).join(' | '));
  ok(t + ': 无 link/img/script 外链标签',
    !/<link[^>]+href=/.test(h) && !/<img[^>]+src=/.test(h) && !/<script[^>]+src=/.test(h));
  ok(t + ': data-theme 正确', h.includes('data-theme="' + t + '"'));
}

/* --- 3. 分层纪律：去掉 :root{...} 后不得残留 #hex --- */
const stripRoot = (css) => css.replace(/:root\s*\{[\s\S]*?\}/g, '');
for (const f of ['base.css', 'theme-deco.css', 'theme-vapor.css', 'theme-riso.css']) {
  const rest = stripRoot(readFileSync(join(root, 'src/styles', f), 'utf8'));
  const hits = rest.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  eq('分层: ' + f + ' :root 外零十六进制色', hits.length, 0, hits.join(','));
}
/* 拼接后的 <style> 里同样检查：base+theme 连接处无游离 hex */
for (const t of THEMES) {
  const styleBody = html(t).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const hits = stripRoot(styleBody).match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  eq('级联: preview ' + t + ' 合成样式 :root 外零 hex', hits.length, 0, hits.slice(0, 3).join(','));
}

/* --- 4. 级联顺序：base 结构在前，theme 覆盖在后 --- */
for (const t of THEMES) {
  const styleBody = html(t).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const iBase = styleBody.indexOf('/* 结构层');
  const iTheme = styleBody.indexOf('/* 风格');
  ok(t + ': base 在 theme 之前', iBase !== -1 && iTheme !== -1 && iBase < iTheme, iBase + '/' + iTheme);
}

/* --- 5. 三风格招牌特征互斥 --- */
const deco = readFileSync(join(root, 'src/styles/theme-deco.css'), 'utf8');
const vapor = readFileSync(join(root, 'src/styles/theme-vapor.css'), 'utf8');
const riso = readFileSync(join(root, 'src/styles/theme-riso.css'), 'utf8');
ok('deco 特征: 锥形放射纹章', deco.includes('repeating-conic-gradient') && deco.includes('3px double'));
ok('vapor 特征: 透视网格 + 希腊字 + text-shadow 霓虹', vapor.includes('perspective(') && vapor.includes('ΑΕΡ') && vapor.includes('text-shadow: 2px 2px 0'));
ok('riso 特征: 半调网点 + 双色错位套印 + 硬偏移阴影', riso.includes('radial-gradient(var(--dot-ink)') && riso.includes('text-shadow: 3px 3px 0') && riso.includes('6px 6px 0'));
ok('互斥: deco 不含 vapor/riso 招牌', !deco.includes('perspective(') && !deco.includes('6px 6px 0'));
ok('互斥: vapor 不含 deco/riso 招牌', !vapor.includes('repeating-conic-gradient') && !vapor.includes('3px double'));
ok('互斥: riso 不含 deco/vapor 招牌', !riso.includes('ΑΕΡ') && !riso.includes('backdrop-filter'));
/* 主题字体互不相同 */
const fontOf = (css) => (css.match(/--font-display: ([^;]+)/) ?? ['', ''])[1];
const fonts = new Set([fontOf(deco), fontOf(vapor), fontOf(riso)]);
eq('三主题 display 字体互不相同', fonts.size, 3);

/* --- 6. split 构建：动态模块真在首包之外 --- */
const assetsDir = join(root, 'dist-split', 'assets');
const assets = readdirSync(assetsDir);
const posterChunk = assets.find((f) => f.startsWith('poster-') && f.endsWith('.js'));
const analyticsChunk = assets.find((f) => f.startsWith('analytics-') && f.endsWith('.js'));
const mainChunk = assets.find((f) => f.startsWith('index-') && f.endsWith('.js'));
ok('split: poster 独立 chunk 存在', posterChunk !== undefined);
ok('split: analytics 独立 chunk 存在', analyticsChunk !== undefined);
const mainSrc = readFileSync(join(assetsDir, mainChunk ?? ''), 'utf8');
const posterSrc = readFileSync(join(assetsDir, posterChunk ?? ''), 'utf8');
/* 首包证明的是「poster 实现」被拆走：buildPoster 标识符/票面文案可能因
   Poster 外壳（首屏文案）与动态 import 引用残留在主包，故断言只属于
   poster.ts 实现的字符串不出现在首包。 */
ok('split: 首包不含 poster 实现', !mainSrc.includes('width="640"') && !mainSrc.includes('等 12 组'));
ok('split: poster chunk 含 poster 实现', posterSrc.includes('width="640"') && posterSrc.includes('等 12 组'));
const heroLine = '湘江中央的星屿';
eq('split: 首屏文案在首包', mainSrc.includes(heroLine), true);
ok('split: poster chunk 不含首屏文案', !posterSrc.includes(heroLine) && !posterSrc.includes('把整个秋天'));
const mainB = Buffer.byteLength(mainSrc, 'utf8');
const lazyB = Buffer.byteLength(posterSrc, 'utf8') + Buffer.byteLength(readFileSync(join(assetsDir, analyticsChunk ?? ''), 'utf8'), 'utf8');
console.log('split 首包 ' + mainB + 'B；按需 chunk 合计 ' + lazyB + 'B，占首包 ' + ((lazyB / mainB) * 100).toFixed(1) + '%');
/* 单文件版：一切内联（无 chunk 引用） */
ok('split: index.html 引用 module script', readFileSync(join(root, 'dist-split/index.html'), 'utf8').includes('type="module"'));

/* --- 7. 打印字节数（凡进文档的数字由断言打印） --- */
let total = 0;
for (const t of THEMES) {
  const b = Buffer.byteLength(html(t), 'utf8');
  total += b;
  console.log('preview/activity-' + t + '.html ' + b + ' bytes');
}
console.log('三页合计 ' + total + ' bytes');

console.log('style-check 通过 ' + pass + ' 项 / 失败 ' + fails.length + ' 项');
if (fails.length > 0) {
  for (const f of fails) console.log('  FAIL ' + f);
  process.exitCode = 1;
}
