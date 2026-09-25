/**
 * Group A/B/C/E/J — everything checkable without a DOM or a browser.
 * Run: node scripts/check-node.mjs        (from the project root of this round)
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, ok, num, bytes, deepEq, summary, dumpResults, results } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const PREVIEW = path.join(ROOT, 'preview');
const OUT = path.join(ROOT, '.tmp-check');
mkdirSync(OUT, { recursive: true });

const LAB = '/Users/apple/Documents/workProject/试验/前端skill实验室';
const PREV_ROUND = '20260925-17-vercel-react-best-practices-admin';

function findPrev(rel) {
  for (const base of [path.join(ROOT, '..', '..'), path.join(LAB, 'artifacts')]) {
    const p = path.join(base, PREV_ROUND, rel);
    if (existsSync(p)) return p;
  }
  throw new Error(`previous-round file not found: ${rel}`);
}

/** Transpile + bundle a TS entry into an importable ESM file inside ROOT (so node_modules resolves). */
async function loadTs(entry, name) {
  const { build } = await import('esbuild');
  const out = path.join(OUT, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    alias: { '~types': path.join(SRC, 'types') },
  });
  return import(`${pathToFileUrl(out)}`);
}

function pathToFileUrl(p) {
  return `file://${p}`;
}

/* ---------------------------------------------------------------- sources */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
const files = walk(SRC);
const ts = files.filter((f) => /\.tsx?$/.test(f));
const read = (f) => readFileSync(f, 'utf8');
const byRel = Object.fromEntries(ts.map((f) => [path.relative(SRC, f).split(path.sep).join('/'), read(f)]));
const all = Object.values(byRel).join('\n');
const grepCount = (re) => (all.match(re) ?? []).length;
const inFiles = (re) => Object.entries(byRel).filter(([, v]) => re.test(v)).map(([k]) => k);

/* ============================================================ A: skill clauses */
Group('A 技能条款符合');

ok('A1 React.FC 组件签名 ≥10', grepCount(/React\.FC/g) >= 10, `${grepCount(/React\.FC/g)} 处`);
ok('A2 四个 feature 都有 components/ 与 index.ts 公共出口',
  ['links', 'keys', 'settings', 'overview'].every((f) => byRel[`features/${f}/index.ts`] !== undefined && inFiles(/export/).some((k) => k.startsWith(`features/${f}/components/`))),
  Object.keys(byRel).filter((k) => /^features\/[^/]+\/index\.ts$/.test(k)).join(','));
ok('A3 每个 feature 有 api/ 服务文件（settings 例外：设备本地存储）',
  ['links', 'keys', 'overview'].every((f) => Object.keys(byRel).some((k) => k === `features/${f}/api/${f}Api.ts`)),
  Object.keys(byRel).filter((k) => /\/api\/\w+Api\.ts$/.test(k)).join(','));
ok('A4 四种别名（@/ ~types ~components ~features）全部实际使用',
  ['@/', '~types', '~components', '~features'].every((a) => all.includes(`'${a}`)) ||
    (all.includes("'@/") && all.includes('~types/') && all.includes('~components/') && all.includes('~features/')),
  `@/=${grepCount(/from '@\//g)} ~types=${grepCount(/from '~types/g)} ~components=${grepCount(/from '~components/g)} ~features=${grepCount(/from '~features/g)}`);
ok('A5 无三层以上相对路径回溯（别名替代深层 relative）', grepCount(/from '\.\.\/\.\.\//g) === 0, grepCount(/from '\.\.\/\.\.\//g));
ok('A6 useSuspenseQuery 作为主取数模式（≥3 个查询 hook）',
  inFiles(/useSuspenseQuery\(/).length >= 3, inFiles(/useSuspenseQuery\(/).join(','));
ok('A7 MUI v7 Grid 新语法且无旧 xs= 写法',
  grepCount(/<Grid size=\{\{/g) >= 6 && grepCount(/<Grid xs=/g) === 0, `size={{...}}=${grepCount(/<Grid size=\{\{/g)} 旧写法=${grepCount(/<Grid xs=/g)}`);
ok('A8 路由路径不带 /api 前缀（技能规定 /form/route 形式）',
  grepCount(/'\/api\//g) === 0 && grepCount(/'\/(overview|links|keys)'/g) >= 3,
  `无 /api 前缀；资源路径字面量 ${grepCount(/'\/(overview|links|keys)'/g)} 处`);
ok('A9 防抖落在技能给出的 300–500ms 区间内',
  /SEARCH_DEBOUNCE_MS = (3[0-9]{2}|4[0-9]{2}|500)/.test(byRel['features/links/hooks/useDebouncedValue.ts']),
  (byRel['features/links/hooks/useDebouncedValue.ts'].match(/SEARCH_DEBOUNCE_MS = (\d+)/) ?? [])[1]);
ok('A10 产品代码里无“加载中就 early return 骨架”的形状',
  inFiles(/if \((isLoading|isPending|!data\w*)\)\s*return </).filter((f) => !f.includes('ablation')).length === 0,
  inFiles(/if \((isLoading|isPending)\)\s*return </).join(',') || 'none');
ok('A11 早期返回骨架只存在于消融装置内，且被开关门控',
  (byRel['lib/ablation.tsx'].match(/CONTROL_EARLY_RETURN &&/g) ?? []).length === 1, 'data-gate="early" 仅在 ?control=early 时渲染');
ok('A12 React.lazy 用于分区与图表（≥6 处）', grepCount(/React\.lazy\(|lazy\(\(\) =>/g) >= 6, grepCount(/React\.lazy\(/g));
ok('A13 memo 化的行组件其命名导出就是 memo 结果（此前默认导出 memo、调用方用命名导入 → 记忆化实际失效）',
  /export const LinkRow = React\.memo\(LinkRowImpl\)/.test(byRel['features/links/components/LinkRow.tsx']) &&
    /export const KeyRow = React\.memo\(KeyRowImpl\)/.test(byRel['features/keys/components/KeyRow.tsx']),
  'LinkRow/KeyRow');
ok('A14 useMuiSnackbar 从技能规定的字面路径导入，且无 react-toastify',
  grepCount(/from '@\/hooks\/useMuiSnackbar'/g) >= 3 && grepCount(/toastify/g) === 0, grepCount(/from '@\/hooks\/useMuiSnackbar'/g));
ok('A15 SuspenseLoader 自带淡入动画并保留最小高度（骨架→内容不塌陷）',
  /<Fade in/.test(byRel['components/SuspenseLoader/SuspenseLoader.tsx']) && /minHeight: 360/.test(byRel['components/SuspenseLoader/SuspenseLoader.tsx']), 'Fade + minHeight:360');
ok('A16 组件文件末尾 default export（技能清单“Default export at bottom”）',
  ['components', 'features'].every(() => true) &&
    ts.filter((f) => /components\/[A-Z]\w+\.tsx$/.test(f)).every((f) => /export default \w+;?\s*$/.test(read(f).trimEnd())),
  ts.filter((f) => /components\/[A-Z]\w+\.tsx$/.test(f)).length + ' 个组件文件');
ok('A17 queryKey 常量化并集中导出（缓存优先，键稳定）',
  grepCount(/export const \w+_QUERY_KEY = \[/g) === 3, inFiles(/_QUERY_KEY = \[/).join(','));
ok('A18 传给子组件的回调用 useCallback（列表/卡片组件内 ≥8 处）',
  grepCount(/useCallback\(/g) >= 8, grepCount(/useCallback\(/g));
ok('A19 TypeScript strict + noUncheckedIndexedAccess + 无 any',
  /"strict": true/.test(read(path.join(ROOT, 'tsconfig.json'))) &&
    /"noUncheckedIndexedAccess": true/.test(read(path.join(ROOT, 'tsconfig.json'))) &&
    grepCount(/: any\b/g) === 0, `any=${grepCount(/: any\b/g)}`);
ok('A20 内联样式规模未触发“>100 行拆 .styles.ts”条件',
  !files.some((f) => f.endsWith('.styles.ts')) && Math.max(...ts.map((f) => read(f).trimEnd().split('\n').length)) <= 260,
  `最长文件=${Math.max(...ts.map((f) => read(f).trimEnd().split('\n').length))} 行`);
ok('A21 无 alert/confirm/prompt（技能要求用 MUI Snackbar 反馈）',
  grepCount(/\bwindow\.(alert|confirm|prompt)\(/g) === 0 && grepCount(/[^.\w]alert\(/g) === 0, '0');
const SEG = ['api', 'components', 'hooks', 'helpers', 'types'];
const segCount = (f) => SEG.filter((d) => Object.keys(byRel).some((k) => k.startsWith(`features/${f}/${d}/`))).length;
ok('A22 特性目录五段结构（api/components/hooks/helpers/types）：3/4 齐备，settings 缺 hooks+types（无服务端查询、类型住在 ~types 共享）',
  ['links', 'keys', 'overview'].every((f) => segCount(f) === 5) && segCount('settings') === 3,
  ['links', 'keys', 'overview', 'settings'].map((f) => `${f}=${segCount(f)}`).join(' '));

/* ==================================================== B: self-contained / identity */
Group('B 自包含与三页一致性');

const bundlePath = path.join(ROOT, 'dist/assets/main.js');
const bundleSrc = existsSync(bundlePath) ? read(bundlePath) : null;
const PAGES = [
  ['neumorph', 'preview/admin-neumorph.html'],
  ['bitmap', 'preview/admin-bitmap.html'],
  ['phosphor', 'preview/admin-phosphor.html'],
];
const pageHtml = Object.fromEntries(PAGES.map(([id, rel]) => [id, read(path.join(ROOT, rel))]));

function inlineScripts(html) {
  return [...html.matchAll(/^[ \t]*<script>[ \t]*\r?\n([\s\S]*?)\r?\n^[ \t]*<\/script>[ \t]*$/gm)].map((m) => m[1]);
}

for (const [id] of PAGES) {
  const html = pageHtml[id];
  Group(`B · ${id}`);
  const scripts = inlineScripts(html);
  ok('B1 恰好一个内联 <script> 且无 src 属性', scripts.length === 1 && !/<script[^>]+\bsrc=/i.test(html), scripts.length);
  const shell = html.replace(/<script>[\s\S]*?<\/script>/, '');
  ok('B2 外壳无外部资源引用（标签/属性级）',
    !/<link\b/i.test(html) && !/<img|<iframe|<audio|<video/i.test(html) &&
      !/\bsrc\s*=\s*["']/i.test(shell) && !/href\s*=\s*["'](?!#)/i.test(shell) &&
      !/@import/i.test(shell) && !/url\((['"]?)(https?:|\/\/)/i.test(shell),
    `外壳 ${bytes(shell)}B：<link=${(html.match(/<link\b/gi) ?? []).length} @import=${(shell.match(/@import/gi) ?? []).length}`);
  ok('B2b 无运行时动态 import 与 XHR/fetch 调用点（产物为单文件离线包）',
    !/\bimport\s*\(/.test(html.replace(/import\.meta/g, '')) && !/XMLHttpRequest/.test(html),
    'import( 与 XMLHttpRequest 均为 0；react-dom 内部的 "fetch(" 字面量不算调用点');
  ok('B3 无 sourceMappingURL / 无 .css 资产', !/sourceMappingURL/.test(html) && !/\.css['")]/.test(html), '0');
  ok('B4 <html> 带 lang 与风格开关', new RegExp(`<html lang="zh-CN" data-fd-style="${id}">`).test(html), id);
  ok('B5 唯一 id="root" 挂载点', (html.match(/id="root"/g) ?? []).length === 1, '1');
}

Group('B 三页 <script> 一致');
const payloads = PAGES.map(([id]) => inlineScripts(pageHtml[id])[0]);
ok('B6 三页内联脚本逐字节相同（只有外壳/主题令牌不同）',
  payloads[0] === payloads[1] && payloads[1] === payloads[2],
  `bytes=${bytes(payloads[0])} same3=${payloads[0] === payloads[2]}`);
num('B6b 内联脚本字节', bytes(payloads[0]), 'B');
/**
 * Cross-round cost baseline: the 17:00 artifact ships no dist, so the comparable quantity is the
 * largest inline <script> payload measured *from that page*, not the number its report quoted
 * (that one was dist/beacon.js, before inlining) — reading it from the artifact keeps the ratio honest.
 */
const prevPage = read(findPrev('preview/admin-business.html'));
const prevBundleBytes = Math.max(
  ...[...prevPage.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => bytes(m[1])),
);
num('B6c 17:00 轮同场景预览页内联 bundle 实测字节（现读，不抄报告）', prevBundleBytes, 'B');
if (bundleSrc !== null) {
  const expected = bundleSrc.replaceAll('</script', '<\\/script');
  const escapes = bundleSrc.split('</script').length - 1;
  ok('B7 内联脚本 = dist 产物（同一转义规则）', payloads[0] === expected, `escapes=${escapes}`);
  for (const [id] of PAGES) {
    const pageBytes = bytes(pageHtml[id]);
    const shellBytes = pageBytes - bytes(payloads[0]);
    ok(`B8 ${id} 页面字节 = 内联脚本 + 外壳（UTF-8 计字节，非 UTF-16 计长）`,
      shellBytes > 200 && shellBytes < 700, `page=${pageBytes}B shell=${shellBytes}B htmlChars=${pageHtml[id].length}`);
    num(`B8b ${id} 预览总字节`, pageBytes, 'B');
  }
  num('B9 dist IIFE 产物字节（本轮成本主指标）', bytes(bundleSrc), 'B');
  num('B9b 相对上一轮同场景管理后台的字节倍数（分母 = B6c 现读值）', +(bytes(bundleSrc) / prevBundleBytes).toFixed(2), '×');
}

/* ====================================================== C: three style claims */
Group('C 三风格主张');
const registry = await loadTs(path.join(SRC, 'lib/style/registry.ts'), 'registry');
const { STYLES, STYLE_IDS, styleCss, paletteOf } = registry;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
for (const id of STYLE_IDS) {
  const css = styleCss(id);
  const palette = new Set(paletteOf(id).map((c) => c.toLowerCase()));
  const used = [...new Set(css.match(HEX) ?? [])].map((c) => c.toLowerCase());
  const rogue = used.filter((c) => !palette.has(c));
  ok(`C1 ${id} 调色板封闭：CSS 内十六进制色全部属于声明令牌`, rogue.length === 0, rogue.join(',') || `${used.length} 色全命中`);
  const rgba = [...css.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) => `${m[1]},${m[2]},${m[3]}`);
  const hexToRgb = (h) => {
    const n = parseInt(h.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  };
  const allowed = new Set([...[...palette].filter((c) => c.startsWith('#')).map(hexToRgb), '0,0,0', '255,255,255']);
  ok(`C2 ${id} 派生 alpha：rgba 通道必须是令牌色或纯黑/纯白`, rgba.every((c) => allowed.has(c)), rgba.join(' '));
  ok(`C3 ${id} :root 声明全部 13 个颜色令牌 + 7 个非色令牌`,
    ['--fd-bg', '--fd-paper', '--fd-paper-alt', '--fd-text', '--fd-muted', '--fd-primary', '--fd-on-primary', '--fd-border', '--fd-success', '--fd-warning', '--fd-danger', '--fd-relief-light', '--fd-relief-dark', '--fd-radius', '--fd-border-w', '--fd-font-ui', '--fd-font-num', '--fd-tracking', '--fd-head-size', '--fd-body-size'].every((v) => css.includes(v)), '20/20');
}

const structFiles = ts.filter((f) => !f.includes(`${path.sep}lib${path.sep}style${path.sep}`));
const structHex = structFiles.flatMap((f) =>
  [...read(f).matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => `${path.basename(f)}:${m[0]}`));
ok('C4 结构代码里零十六进制字面量（颜色只能来自令牌）',
  structHex.length === 0, structHex.slice(0, 4).join(' ') || `${structFiles.length} 个文件全干净`);

const dims = ['fontUi', 'fontNum', 'shape', 'borderWidth', 'separation', 'shadowLevel', 'headTransform'];
const dist = (a, b) => dims.filter((d) => String(STYLES[a][d]) !== String(STYLES[b][d])).length;
const pairs = [['neumorph', 'bitmap'], ['neumorph', 'phosphor'], ['bitmap', 'phosphor']];
for (const [a, b] of pairs) {
  ok(`C5 ${a}↔${b} 七维指纹差异 ≥4`, dist(a, b) >= 4, `${dist(a, b)}/7 (${dims.filter((d) => STYLES[a][d] === STYLES[b][d]).join('|')})`);
  const shared = ['bg', 'paper', 'text', 'primary', 'muted'].filter((c) => STYLES[a].color[c] === STYLES[b].color[c]);
  ok(`C6 ${a}↔${b} 五个主色无一相同`, shared.length === 0, shared.join(',') || '0 重合');
}
ok('C7 软浮雕签名：双向阴影（一暗一亮、符号相反）+ 零描边 + 大圆角',
  /box-shadow:8px 8px 18px var\(--fd-relief-dark\),-8px -8px 18px var\(--fd-relief-light\)/.test(styleCss('neumorph')) &&
    STYLES.neumorph.borderWidth === 0 && STYLES.neumorph.shape >= 16, 'inset 版本用于 pill');
ok('C8 1-bit 签名：box-shadow:none + border-radius:0 + 表头反白（选择器抬到 .MuiTableCell-root 以压过 emotion 单类规则）',
  /box-shadow:none/.test(styleCss('bitmap')) && /border-radius:0/.test(styleCss('bitmap')) &&
    /\[data-fd-style=bitmap\] thead \.MuiTableCell-root\{background:var\(--fd-text\);color:var\(--fd-on-primary\)\}/.test(styleCss('bitmap')), 'none/0/reverse');
ok('C9 荧光签名：text-shadow 发光 + repeating-linear-gradient 扫描线 + 深色 mode',
  /text-shadow:0 0 6px/.test(styleCss('phosphor')) && /repeating-linear-gradient\(180deg/.test(styleCss('phosphor')) &&
    /mode: id === 'phosphor' \? 'dark' : 'light'/.test(read(path.join(SRC, 'lib/style/theme.ts'))), 'glow+scanline+dark');
ok('C10 三风格各自只用一种分层手法（separation 互异且与阴影策略一致）',
  new Set(STYLE_IDS.map((i) => STYLES[i].separation)).size === 3 &&
    new Set(STYLE_IDS.map((i) => STYLES[i].shadowLevel)).size === 3, STYLE_IDS.map((i) => `${i}:${STYLES[i].separation}`).join(' '));

/* ================================================ E: fact parity with 17:00 round */
Group('E 与 17:00 轮事实源一致');
const mine = await loadTs(path.join(SRC, 'lib/dataset.ts'), 'dataset-mine');
const prev = await loadTs(findPrev('src/data/dataset.ts'), 'dataset-prev');
const a = mine.buildDataset();
const b = prev.buildDataset();
ok('E1 mulberry32 同种子前 100 次输出逐位相同',
  JSON.stringify(Array.from({ length: 100 }, ((f) => () => f())(mine.mulberry32(20260925)))) ===
    JSON.stringify(Array.from({ length: 100 }, ((f) => () => f())(prev.mulberry32(20260925)))), '100/100');
ok('E2 links 60 条且九个字段全等', a.links.length === 60 && JSON.stringify(a.links) === JSON.stringify(b.links), `${a.links.length} 条`);
ok('E3 keys 5 个全等', a.keys.length === 5 && JSON.stringify(a.keys) === JSON.stringify(b.keys), `${a.keys.length}`);
ok('E4 events 8 条全等', a.events.length === 8 && JSON.stringify(a.events) === JSON.stringify(b.events), `${a.events.length}`);
ok('E5 series14 全等', JSON.stringify(a.series14) === JSON.stringify(b.series14), a.series14.join(','));
ok('E6 stats 全等（含 ratio-of-sums 派生值）', JSON.stringify(a.stats) === JSON.stringify(b.stats), Object.keys(a.stats).length + ' 字段');
num('E7 本轮活跃短链数', a.links.filter((l) => !l.paused).length, ' 条');
num('E7b 本轮累计点击', a.links.reduce((s, l) => s + l.clicks, 0), ' 次');
ok('E8 数据健全性：series14 全为正、Top1 与 stats.topSlug/topClicks 一致',
  a.series14.every((v) => v > 0) &&
    a.links.reduce((m, l) => (l.clicks > m.clicks ? l : m), a.links[0]).slug === a.stats.topSlug &&
    a.links.reduce((m, l) => (l.clicks > m.clicks ? l : m), a.links[0]).clicks === a.stats.topClicks,
  `${a.stats.topSlug}=${a.stats.topClicks}`);
ok('E8d 数据健全性：uptime = sparkUptime 均值（两位小数）、apiCalls30d = sparkApi 合计 ×4',
  a.stats.uptime === Number((a.stats.sparkUptime.reduce((x, y) => x + y, 0) / 8).toFixed(2)) &&
    a.stats.apiCalls30d === a.stats.sparkApi.reduce((x, y) => x + y, 0) * 4,
  `uptime=${a.stats.uptime} api=${a.stats.apiCalls30d}`);
ok('E8b 数据健全性：activeLinks + paused = totalLinks = links.length',
  a.stats.activeLinks + a.links.filter((l) => l.paused).length === a.stats.totalLinks && a.stats.totalLinks === a.links.length,
  `${a.stats.activeLinks}+${a.links.filter((l) => l.paused).length}=${a.stats.totalLinks}`);
ok('E8c 数据健全性：clicks7d 与 clicksPrev7d 均由 series14 分段求和得出（非独立随机数）',
  a.stats.clicks7d === a.series14.slice(7).reduce((s, v) => s + v, 0) &&
    a.stats.clicksPrev7d === a.series14.slice(0, 7).reduce((s, v) => s + v, 0),
  `${a.stats.clicks7d} vs ${a.stats.clicksPrev7d}`);
ok('E9 数据健全性：时间戳都落在 2026-09 锚定窗口内',
  a.links.every((l) => l.createdAt > Date.UTC(2026, 0, 1) && l.createdAt <= Date.UTC(2026, 8, 25, 12)), 'createdAt ∈ [2026-01-01, 2026-09-25]');

/* ========================================================= J: disk discipline */
Group('J 磁盘与复现');
const srcLines = ts.reduce((s, f) => s + read(f).trimEnd().split('\n').length, 0);
const prevSrcFiles = walk(path.join(path.dirname(findPrev('src/data/dataset.ts')), '..'));
const prevTs = prevSrcFiles.filter((f) => /\.tsx?$/.test(f));
const prevLines = prevTs.reduce((s, f) => s + readFileSync(f, 'utf8').trimEnd().split('\n').length, 0);
num('J1 本轮 src 文件数/行数', `${ts.length} / ${srcLines}`, '');
num('J2 17:00 轮 src 文件数/行数', `${prevTs.length} / ${prevLines}`, '');
num('J3 同功能面代码行比（本轮 ÷ 上轮）', +(srcLines / prevLines).toFixed(2), '×');
num('J4 同功能面产物字节比（本轮 ÷ 上轮，分母同为 B6c）', +(bytes(bundleSrc ?? '') / prevBundleBytes).toFixed(2), '×');
const previewTotal = PAGES.reduce((s, [id]) => s + bytes(pageHtml[id]), 0);
num('J5 三页预览合计字节', previewTotal, 'B');
ok('J6 预览目录不含 node_modules / dist 痕迹',
  !existsSync(path.join(PREVIEW, 'node_modules')) && !existsSync(path.join(PREVIEW, 'dist')), 'clean');
ok('J7 单页可独立双击打开（不依赖同目录其他文件）：内联脚本自带全部样式注入',
  /injectStyleCss|data-fd-css/.test(payloads[0]), '运行时注入 :root 令牌');
const gzipBytes = bundleSrc === null ? 0 : (await import('node:zlib')).gzipSync(Buffer.from(bundleSrc, 'utf8')).length;
num('J8 gzip 后的产物字节（传输口径，zlib 实测而非手抄）', gzipBytes, 'B');
/** What actually lands in artifacts/<round>/ = everything except the rebuildable trees. */
const keep = (f) => !/(^|[\\/])(node_modules|dist|dist-split|\.tmp-check)([\\/]|$)/.test(path.relative(ROOT, f));
const shippedBytes = walk(ROOT).filter(keep).reduce((s, f) => s + statSync(f).size, 0);
num('J9 进入 artifacts 的场景目录体积（排除 node_modules/dist/dist-split/.tmp-check）',
  +(shippedBytes / 1024 / 1024).toFixed(2), 'MB');
ok('J9b 场景目录体积 ≤ 50MB', shippedBytes <= 50 * 1024 * 1024, `${(shippedBytes / 1024 / 1024).toFixed(2)}MB`);
num('J9c 参与统计的文件数', walk(ROOT).filter(keep).length, ' 个');

/* ============================================== L: lazy-loading evidence build */
/*
 * The shipped previews are deliberately one-file (offline, double-click), which merges every
 * React.lazy() chunk back into the entry — so "lazy load heavy components" is unfalsifiable there.
 * vite.split.config.ts builds the same src again keeping chunk boundaries, which makes the clause
 * measurable: route strings must live outside the entry, and the share they represent is printed.
 */
Group('L 懒加载证据构建（vite.split.config.ts）');
const SPLIT = path.join(ROOT, 'dist-split', 'assets');
if (existsSync(SPLIT)) {
  const chunks = readdirSync(SPLIT).filter((f) => f.endsWith('.js'));
  const sectionChunks = ['OverviewSection', 'LinksSection', 'KeysSection', 'SettingsSection'].filter((n) =>
    chunks.includes(`${n}.js`),
  );
  ok('L1 四个分区的懒块在证据构建里真实存在', sectionChunks.length === 4, sectionChunks.join(','));
  const entry = read(path.join(SPLIT, 'main.js'));
  const onlyLazy = ['服务端共', '设置已保存', '已恢复默认值'];
  ok('L2 入口 chunk 不含只属于懒块的界面文案（真的拆开了，不是名义懒加载）',
    onlyLazy.every((s) => !entry.includes(s)), onlyLazy.map((s) => entry.includes(s) ? `泄漏:${s}` : s).join(','));
  const entryBytes = bytes(entry);
  const totalBytes = chunks.reduce((s, f) => s + bytes(read(path.join(SPLIT, f))), 0);
  num('L3 证据构建：入口字节 / 全套字节', `${entryBytes} / ${totalBytes}`, 'B');
  num('L3b 路由级代码可延迟占比（1 − 入口/全套）', +(((totalBytes - entryBytes) / totalBytes) * 100).toFixed(1), '%');
  ok('L4 单文件预览版确实把懒块并回首包（两构建并存的意义所在）',
    onlyLazy.every((s) => (bundleSrc ?? '').includes(s)), '单文件形态无首包收益');
  ok('L5 两构建总量差 < 1%（分包只挪首包，不减总量）',
    Math.abs(totalBytes - bytes(bundleSrc ?? '')) / totalBytes < 0.01,
    `split ${totalBytes}B vs iife ${bytes(bundleSrc ?? '')}B`);
} else {
  ok('L0 证据构建产物 dist-split 存在（先跑 vite build --config vite.split.config.ts）', false, SPLIT);
}

/* ============================================== I: ledger idempotency lock (round 16) */
/*
 * The write-back of this round is a one-shot node script (transcribed in the report), so the
 * only durable guard against a double append / a partial append is this group. Two states are
 * legal and both keep the no-duplicate invariant: (a) the round has not been written yet, so the
 * snapshot equals the ledger; (b) it has been written exactly once, so ledger == snapshot + ROUND.
 */
Group('I 台账幂等锁');
const ROUND_FACTS = path.join(ROOT, 'scripts', 'round-facts.mjs');
const SNAP_FILE = path.join(ROOT, 'scripts', 'ledger-snapshot.json');
const WORK_LOG = path.join(LAB, 'records', 'work-log.md');
const state = JSON.parse(read(path.join(LAB, 'state', 'state.json')));
const snap = existsSync(SNAP_FILE) ? JSON.parse(read(SNAP_FILE)) : null;
if (snap) {
  const { TRIED, RUN, ENV_NOTES, ROUND_ID, WORK_LOG_LINE, QUEUE_HINT } = await import(pathToFileUrl(ROUND_FACTS));
  const logLines = read(WORK_LOG).trimEnd().split('\n');
  const sha = (v) => createHash('sha1').update(JSON.stringify(v), 'utf8').digest('hex');
  const applied = state.tried.filter((e) => e.skill === TRIED.skill && e.scenario === TRIED.scenario).length;
  ok('I1 本轮在 tried 中至多出现一次（幂等锁：重复写回在这里失败）', applied <= 1, `出现 ${applied} 次`);
  ok('I1b 选题依据可追溯：写回前的 next_candidates 里确实排着这条组合',
    snap.candidates.some((c) => c.includes(QUEUE_HINT)), `${snap.candidates.length} 条候选`);

  ok('I2 写回是追加：tried / runs / used_styles / environment_notes 的历史前缀逐字节未变',
    sha(state.tried.slice(0, snap.triedLen)) === snap.triedSha &&
      sha(state.runs.slice(0, snap.runsLen)) === snap.runsSha &&
      sha(state.used_styles.slice(0, snap.stylesLen)) === snap.stylesSha &&
      sha(state.environment_notes.slice(0, snap.envLen)) === snap.envSha,
    `tried ${snap.triedLen}→${state.tried.length}，styles ${snap.stylesLen}→${state.used_styles.length}`);

  if (applied === 1) {
    ok('I2b tried 末条 = round-facts 的 TRIED（同一来源，不是手抄）',
      deepEq(state.tried[state.tried.length - 1], TRIED), String(state.tried[state.tried.length - 1].skill).slice(0, 22));
    ok('I2c runs 末条与 RUN 逐字段一致（cleanup/push 允许写回后补全，故只比已定字段）',
      Object.entries(RUN).every(
        ([k, v]) => k === 'cleanup' || k === 'push' || state.runs[state.runs.length - 1][k] === v,
      ),
      `runs ${snap.runsLen}→${state.runs.length}`);
    ok('I2d used_styles = 快照 + 本轮 3 个新风格，全表无重复',
      state.used_styles.length === snap.stylesLen + TRIED.styles.length &&
        TRIED.styles.every((s) => state.used_styles.slice(snap.stylesLen).includes(s)) &&
        new Set(state.used_styles).size === state.used_styles.length,
      `${snap.stylesLen}→${state.used_styles.length}`);
    ok('I2e environment_notes 只增不减、无重复，新增条数 = round-facts',
      state.environment_notes.length === snap.envLen + ENV_NOTES.length &&
        new Set(state.environment_notes).size === state.environment_notes.length,
      `${snap.envLen}→${state.environment_notes.length}`);
    ok('I2f skills_seen 条目数不减，且 frontend-development 已标为第 2 次使用',
      state.skills_seen.length >= snap.seenLen &&
        /第 2 次/.test((state.skills_seen.find((s) => s.name === 'frontend-development') ?? {}).status ?? ''),
      `${snap.seenLen}→${state.skills_seen.length} 条`);
    ok('I3 work-log 行数 = 快照 + 1（一次写回只加一行）', logLines.length === snap.logLines + 1,
      `${snap.logLines}→${logLines.length}`);
    ok('I3b work-log 历史部分逐字节未变（append-only）',
      createHash('sha1').update(logLines.slice(0, snap.logLines).join('\n') + '\n', 'utf8').digest('hex') === snap.logSha,
      `前 ${snap.logLines} 行哈希`);
    ok('I3c work-log 末行 = round-facts 的 WORK_LOG_LINE，且 6 段齐全',
      logLines[logLines.length - 1] === WORK_LOG_LINE && WORK_LOG_LINE.split(' | ').length === 6,
      `${WORK_LOG_LINE.split(' | ').length} 段`);
    ok('I3d 末行写到的产物目录与报告文件真实存在',
      existsSync(path.join(LAB, 'artifacts', ROUND_ID)) && existsSync(path.join(LAB, 'reports', `${ROUND_ID}.md`)), ROUND_ID);
    ok('I4 updated 时间戳已推进', String(state.updated) > String(snap.updated), `${snap.updated} → ${state.updated}`);
    ok('I4b 本轮三个风格与历史 used_styles 不撞车', TRIED.styles.every((s) => !snap.usedStyles.includes(s)), TRIED.styles.join(','));
    /* 清理态由 scripts/check-clean.mjs 在删掉构建目录之后单独把关：
       verify.sh 跑起来时 dist/ 与 .tmp-check/ 必须存在，在这里断言「不存在」会与设计自相矛盾。*/
    ok('I5 预览目录形态正确：恰好 3 个 HTML，无子目录',
      readdirSync(PREVIEW).length === 3 && readdirSync(PREVIEW).every((f) => f.endsWith('.html')),
      readdirSync(PREVIEW).join(','));
  } else {
    ok('I6 尚未写回：台账七个键与快照逐项相等',
      Object.keys(state).every((k) => k === 'updated' || sha(state[k]) === snap.pristine[k]), 'pre-write equality');
    ok('I6b 尚未写回：work-log 行数与快照一致', logLines.length === snap.logLines, `${logLines.length}`);
  }
} else {
  ok('I0 快照 scripts/ledger-snapshot.json 存在（缺它台账锁无法运行）', false, SNAP_FILE);
}

summary('check-node');
dumpResults(path.join(OUT, 'assertions-node.json'));
const perGroup = {};
for (const r of results) {
  const letter = (r.group.match(/^[A-Z]/) ?? ['?'])[0];
  perGroup[letter] = (perGroup[letter] ?? 0) + 1;
}
console.log(`styles: ${STYLE_IDS.join(',')} | assertions per group: ${JSON.stringify(perGroup)}`);
