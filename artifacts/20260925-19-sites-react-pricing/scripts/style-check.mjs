/* 静态断言：产物一致性、分层纪律、以及「性能规范是否真的落到源码里」。
   需要 ./node_modules/.bin/vite build 与 vite build --config vite.split.config.ts 都跑过。 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const THEMES = ['bauhaus', 'chrome', 'blueprint'];
let pass = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) pass += 1;
  else fails.push(name + (extra === '' ? '' : ' — ' + extra));
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expected));
}
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ---------- 1. 三页共用同一份 JS（逐字节） ---------- */
const pages = THEMES.map((t) => read('preview/pricing-' + t + '.html'));
// 取标签内的正文：偏移量手算会连 '<script>' 一起切进来，差 7 个字符还看不出来
const scripts = pages.map((html) => /^<script>([\s\S]*?)<\/script>/m.exec(html)[1]);
const rawBundle = read('dist/songta.js');
const esc = (rawBundle.match(/<\/script/gi) || []).length;
eq('内联脚本标签各页 2 个（bundle + 挂载）', pages.every((h) => (h.match(/^<script>/gm) || []).length === 2), true);
eq('三页 <script> 完全一致', scripts[0] === scripts[1] && scripts[1] === scripts[2], true);
// 报告里的 bundle 字节数以断言为准，不靠手抄：内联唯一的改动是把 </script 打断，每处 +1 字节
eq('内联 = dist bundle + 每处 </script 一个转义字节', Buffer.byteLength(scripts[0], 'utf8'), Buffer.byteLength(rawBundle, 'utf8') + esc);
console.log('  bundle: ' + Buffer.byteLength(scripts[0], 'utf8') + ' bytes (dist ' + Buffer.byteLength(rawBundle, 'utf8') + ' + ' + esc + ' 处转义) · 单页: ' + pages.map((h) => Buffer.byteLength(h)).join(' / ') + ' bytes');
eq('挂载调用指向本项目全局', pages.every((h) => h.includes('SongtaPricing.mount')), true);

/* ---------- 2. 零外链 ---------- */
for (let i = 0; i < THEMES.length; i += 1) {
  const html = pages[i];
  eq(THEMES[i] + ' 无 http(s) 资源引用', /(?:src|href|url\()=["']?https?:/.test(html), false);
  eq(THEMES[i] + ' 无 @import', html.includes('@import'), false);
  eq(THEMES[i] + ' 无 <link> 外链', /<link[^>]+href/.test(html), false);
  ok(THEMES[i] + ' 带 lang / title / description', html.includes('lang="zh-CN"') && html.includes('<title>') && html.includes('name="description"'));
  eq(THEMES[i] + ' data-theme 与文件名一致', html.includes('data-theme="' + THEMES[i] + '"'), true);
}
eq('三页 title 互不相同', new Set(pages.map((h) => h.match(/<title>([^<]+)<\/title>/)[1])).size, 3);

/* ---------- 3. 拼接顺序（上轮踩过：主题层必须在结构层之后） ---------- */
for (const theme of THEMES) {
  const html = read('preview/pricing-' + theme + '.html');
  const baseAt = html.indexOf('结构层（base.css）');
  const themeAt = html.indexOf('主题层 · ');
  ok(theme + ' base.css 在主题 CSS 之前', baseAt !== -1 && themeAt !== -1 && baseAt < themeAt, baseAt + ' vs ' + themeAt);
  eq(theme + ' 只内联一份结构层', (html.match(/结构层（base\.css）/g) || []).length, 1);
}

/* ---------- 4. 分层纪律：十六进制色只允许出现在 :root ---------- */
function hexOutsideRoot(css) {
  const stripped = css.replace(/:root\s*\{[^}]*\}/g, '');
  return stripped.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
}
eq('base.css 在 :root 之外无硬编码色', hexOutsideRoot(read('src/styles/base.css')).length, 0);
for (const theme of THEMES) {
  eq('theme-' + theme + '.css 在 :root 之外无硬编码色', hexOutsideRoot(read('src/styles/theme-' + theme + '.css')).length, 0);
}
const REQUIRED_TOKENS = ['--bg', '--bg-2', '--panel', '--ink', '--ink-2', '--muted', '--line', '--accent', '--accent-ink', '--radius', '--font-body', '--font-display', '--title-size', '--hero-size', '--price-size'];
for (const theme of THEMES) {
  const css = read('src/styles/theme-' + theme + '.css');
  const missing = REQUIRED_TOKENS.filter((t) => !new RegExp('\\' + 's*' + ':').test('') && !css.includes(t + ':'));
  eq(theme + ' 覆盖了全部结构层令牌', missing.length, 0, missing.join(','));
}
eq('结构层不含主题专属选择器', /data-hue|data-selected-label|▸/.test(read('src/styles/base.css').replace(/attr\(data-selected-label\)/g, '')), false);

/* ---------- 5. 三主题取值互不相同 ---------- */
function token(css, name) {
  const m = css.match(new RegExp(name + ':\\s*([^;]+);'));
  return m === null ? null : m[1].trim();
}
const themeCss = THEMES.map((t) => read('src/styles/theme-' + t + '.css'));
const dims = ['--radius', '--font-display', '--shadow', '--accent', '--bg', '--track', '--title-size'];
for (let a = 0; a < 3; a += 1) {
  for (let b = a + 1; b < 3; b += 1) {
    const diff = dims.filter((d) => token(themeCss[a], d) !== token(themeCss[b], d));
    ok(THEMES[a] + ' 与 ' + THEMES[b] + ' 至少在 4 个视觉维度上不同', diff.length >= 4, diff.join(','));
  }
}
ok('chrome 为深色方案、bauhaus 为浅色方案', token(themeCss[1], 'color-scheme') === 'dark' && (token(themeCss[0], 'color-scheme') || '').includes('light'));

/* ---------- 6. 规则落地扫描 ---------- */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(root, dir))) {
    const p = join(dir, entry);
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    if (statSync(join(root, p)).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const srcFiles = walk('src').filter((p) => /\.(ts|tsx)$/.test(p));
const srcOf = (p) => read(p);
const allSrc = srcFiles.map(srcOf).join('\n');
const grep = (re) => srcFiles.filter((p) => re.test(srcOf(p)));
const hits = (re) => (allSrc.match(new RegExp(re.source, 'g')) || []).length;

/* bundle-* */
eq('无 barrel 文件（index.ts/ts 转发）', srcFiles.filter((p) => /src\/(components|lib)\/index\.(ts|tsx)$/.test(p)).length, 0);
eq('无跨目录整包导入', /\} from '\.\.\/(lib|components)'/.test(allSrc), false);
eq('React 具名直导（无 * as React 全量命名空间）', /import \* as React/.test(allSrc), false);
const splitDir = join(root, 'dist-split/assets');
ok('存在代码分割构建产物目录', existsSync(splitDir));
const chunks = existsSync(splitDir) ? readdirSync(splitDir).filter((f) => f.endsWith('.js')) : [];
const quoteChunk = chunks.find((f) => f.startsWith('QuoteSheet'));
const teleChunk = chunks.find((f) => f.startsWith('telemetry'));
const entryChunk = chunks.find((f) => f.startsWith('index'));
ok('拆出 QuoteSheet chunk', quoteChunk !== undefined, chunks.join(','));
ok('拆出 telemetry chunk', teleChunk !== undefined);
const entryJs = read(join('dist-split/assets', entryChunk));
const quoteJs = read(join('dist-split/assets', quoteChunk));
const teleJs = read(join('dist-split/assets', teleChunk));
eq('入口 chunk 不含报价单文案', entryJs.includes('打印或存 PDF'), false);
eq('入口 chunk 不含分析模块内部标记', entryJs.includes('songta-analytics://queue-v1'), false);
eq('报价单 chunk 含自身文案', quoteJs.includes('打印或存 PDF'), true);
eq('分析 chunk 含自身标记', teleJs.includes('songta-analytics://queue-v1'), true);
const lazyBytes = statSync(join(splitDir, quoteChunk)).size + statSync(join(splitDir, teleChunk)).size;
const entryBytes = statSync(join(splitDir, entryChunk)).size;
ok('按需部分只占首包 < 5%（首包因此被真正做小）', lazyBytes / entryBytes < 0.05, (lazyBytes / entryBytes).toFixed(4));
eq('报价单模块走 lazy()', /lazy\(\(\) => import\('\.\/components\/QuoteSheet'\)\)/.test(srcOf('src/App.tsx')), true);
ok('分析模块经动态 import 引入（2 处调用点）', hits(/import\('\.\/lib\/telemetry'\)/) === 2, String(hits(/import\('\.\/lib\/telemetry'\)/)));

ok('悬停/聚焦预加载按需模块', /onPointerEnter=\{preloadQuote\}/.test(srcOf('src/App.tsx')) && /onFocus=\{preloadQuote\}/.test(srcOf('src/App.tsx')));
ok('函数结果按原始值键缓存', /const LIST_CACHE = new Map<string, number>\(\)/.test(srcOf('src/lib/pricing.ts')) && /LIST_CACHE\.get\(cacheKey\)/.test(srcOf('src/lib/pricing.ts')));

/* client-* / advanced-* */
eq('localStorage API 调用只出现在 storage.ts', grep(/window\.localStorage\./).length, 1);
eq('存储键带版本前缀', /const STORAGE_KEY = 'songta\.pricing'/.test(srcOf('src/lib/storage.ts')) && /version: 2/.test(srcOf('src/lib/storage.ts')), true);
eq('存储读取走模块缓存', /let cached: PricingPrefs \| null = null;/.test(srcOf('src/lib/storage.ts')), true);
ok('window 监听都带 passive 或 once', (allSrc.match(/window\.addEventListener\(/g) || []).length === 3 && (allSrc.match(/\{ passive: true \}|\{ once: true, passive: true \}/g) || []).length === 3);
ok('监听器都有对称的移除', (allSrc.match(/window\.removeEventListener\(/g) || []).length === 2);
eq('事件回调存进 ref', /useRef\(handler\)/.test(srcOf('src/lib/hooks.ts')), true);
eq('每页只初始化一次（done ref 守卫）', /done\.current/.test(srcOf('src/lib/hooks.ts')), true);

/* rerender-* */
eq('函数式 setState（不依赖闭包旧值）', (allSrc.match(/set\w+\(\(prev\)/g) || []).length >= 4, true);
ok('memo 化组件 >= 2 个', hits(/= memo\(/) >= 2, String(hits(/= memo\(/)));
eq('effect 依赖表只出现原始值或稳定引用', /useEffect\(\(\) => \{\n\s+writePrefs/.test(srcOf('src/App.tsx')), true);
ok('派生值在渲染期算完，不用 effect 回写', /const picked = useMemo\(\(\) => new Set\(addOns\)/.test(srcOf('src/App.tsx')) && /const quote = useMemo/.test(srcOf('src/App.tsx')));
eq('不把交互逻辑塞进 effect 同步', /useEffect\(\(\) => \{\s*set[A-Z]/.test(allSrc), false);
eq('简单布尔表达式不套 memo', /useMemo\(\(\) => \w+ === /.test(allSrc), false);
eq('瞬态指针值走 ref + CSS 变量，不进 state', /setProperty\('--px'/.test(srcOf('src/lib/hooks.ts')) && /usePointerVars\(shellRef\)/.test(srcOf('src/App.tsx')), true);
eq('过渡态用 useTransition 的 isPending', /useTransition\(\)/.test(srcOf('src/App.tsx')) && !/const \[isPending, setIsPending\] = useState/.test(allSrc), true);

/* rendering-* */
ok('静态 JSX 提到组件外', (srcOf('src/components/Frame.tsx').match(/^const (LOGO_MARK|FOOTER_COLS)/m) || []).length >= 1 && /const TICK = \(/.test(srcOf('src/components/TierCard.tsx')));
eq('条件渲染一律三元，不用 && 输出', /&&\s*</.test(allSrc), false);
ok('长列表用 content-visibility', /\.crow \{[^}]*content-visibility: auto/.test(read('src/styles/base.css')) && /\.faq-item \{[^}]*content-visibility: auto/.test(read('src/styles/base.css')));
eq('进场动画基态可见（漏标不会空白）', /\.reveal \{\s*opacity: 1;?\s*\}/.test(read('src/styles/base.css')), true);

/* js-* */
eq('正则不在函数里现造', /new RegExp\(|\.match\(\/(?!.*module)/.test(allSrc.replace(/hexOutsideRoot[\s\S]*?\n}/g, '')), false);
eq('不使用 Array#sort（要排序用 toSorted）', /\.sort\(/.test(allSrc), false);
ok('toSorted 用于不可变排序', /FAQS\.toSorted\(/.test(srcOf('src/components/Faq.tsx')));
ok('重复查表用 Map（>=2 处）', hits(/new Map\(/) >= 2, String(hits(/new Map\(/)));
ok('成员判断用 Set（>=4 处）', hits(/new Set\(/) >= 4, String(hits(/new Set\(/)));
ok('循环里不重复取属性 / 提前返回', /if \(remaining <= 0\) return total;/.test(srcOf('src/lib/pricing.ts')) && /if \(budgetCny <= 0\) return 0;/.test(srcOf('src/lib/pricing.ts')));
eq('min/max 用循环不用 sort', /if \(monthly < best\)/.test(srcOf('src/lib/pricing.ts')), true);
eq('滚动 CSS 变更成组写入', /classList\.toggle\('is-scrolled'/.test(srcOf('src/lib/hooks.ts')), true);

/* ---------- 7. 体积与磁盘 ---------- */
const totalBytes = pages.reduce((a, h) => a + Buffer.byteLength(h), 0);
ok('三页合计 < 2MB', totalBytes < 2 * 1024 * 1024, (totalBytes / 1024 / 1024).toFixed(2) + 'MB');
ok('单页 < 800KB', Math.max(...pages.map((h) => Buffer.byteLength(h))) < 800 * 1024);

console.log('style-check: ' + pass + ' 通过 / ' + (pass + fails.length) + ' 断言');
if (fails.length > 0) {
  console.log('失败：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
