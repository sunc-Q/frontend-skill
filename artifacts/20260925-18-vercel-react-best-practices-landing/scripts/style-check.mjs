/* 风格层断言：结构层是否真的与主题无关、三套主题是否互不混淆、
   以及最要命的「拼接顺序」——主题 CSS 必须排在 base 之后，否则同特异性规则被反向覆盖。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = process.cwd();
const PAGES = ['wabi', 'construct', 'memphis'];

let total = 0;
const failures = [];
function ok(cond, label) {
  total += 1;
  if (!cond) failures.push(label);
}

const LABELS = { wabi: '侘寂留白', construct: '构成主义', memphis: '孟菲斯' };

/* 每个主题必须出现的签名规则（缺一条就说明这套风格不成立） */
const SIGNATURES = {
  wabi: [/\.hero-title em\s*\{[^}]*border-bottom/, /\.card,[\s\S]*?background:\s*transparent/, /\.btn--primary\s*\{[^}]*background:\s*transparent/],
  construct: [
    /\.hero-visual::before\s*\{[^}]*width:\s*var\(--px/,
    /\.plan--on\s*\{[^}]*background:\s*#17161a/,
    /\.hero-title\s*\{[^}]*text-transform:\s*uppercase/,
  ],
  memphis: [/body\s*\{[^}]*background-image:\s*radial-gradient/, /\.faq-mark\s*\{[^}]*border-radius:\s*50%/, /\.plan--on\s*\{[^}]*box-shadow:\s*8px 8px 0 #ff5fa2/],
};

/* 主题之间不得互相串色 */
const FOREIGN = {
  wabi: ['#d1372a', '#ff5fa2'],
  construct: ['#ff5fa2', '#ffd447'],
  memphis: ['#d1372a', '#6f7a5f'],
};

const VAR_KEYS = ['--bg', '--accent', '--radius', '--border-w', '--sec-pad', '--font-display', '--shadow', '--gap', '--cell-h'];

function rootVars(css, selector) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return {};
  const body = css.slice(at, css.indexOf('}', at));
  const out = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*;?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const perThemeVars = {};
const bundleOf = {};
const baseCss = readFileSync(join(root, 'src/styles/base.css'), 'utf8');

/* ---------- 结构层自检 ---------- */
const baseNoRoot = baseCss.replace(/:root\s*\{[\s\S]*?\}/, '');
ok(!/#[0-9a-fA-F]{3,8}/.test(baseNoRoot), '结构层 :root 之外没有任何硬编码十六进制色');
ok((baseCss.match(/content-visibility:\s*auto/g) ?? []).length === 1, '结构层只有一处 content-visibility（长列表 .wall）');
ok(!/!important/.test(baseCss), '结构层无 !important');
ok(/\.is-in\s*\{[^}]*animation/.test(baseCss) && /\[data-reveal\]\s*\{[^}]*opacity:\s*1/.test(baseCss), '进场动画是加法：漏标元素不会永久不可见');

for (const id of PAGES) {
  const html = readFileSync(join(root, 'preview', `landing-${id}.html`), 'utf8');
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const themeCss = readFileSync(join(root, `src/styles/theme-${id}.css`), 'utf8');
  const tag = '[' + id + '/' + LABELS[id] + ']';

  bundleOf[id] = html.match(/^<script>([\s\S]*?)<\/script>/m)[1];

  /* ---------- 拼接顺序（上一轮踩过：主题排在 base 前面会静默失效） ---------- */
  const iBase = style.indexOf('结构层');
  const iTheme = style.indexOf('主题');
  ok(iBase >= 0 && iTheme > iBase, tag + ' <style> 内顺序 = 结构层 → 主题层');
  ok(style.indexOf(':root {') < style.indexOf(`:root[data-theme='${id}'] {`), tag + ' :root 默认值在主题覆盖之前');
  ok(style.includes(themeCss.trim().slice(0, 60)), tag + ' 主题 CSS 完整出现在页面里');

  /* ---------- 外链与注入 ---------- */
  ok(!/<link|<script[^>]*\ssrc=|@import|url\(https?:|@font-face/.test(html), tag + ' 零外链：无 link/script src/@import/远程字体');
  ok(!/!important/.test(themeCss), tag + ' 主题层无 !important');
  ok((html.match(/^<script>/gm) ?? []).length === 2, tag + ' 恰好两个真内联脚本标签（bundle + 显式 mount）');
  ok(html.includes(`ShiguangLanding.mount(document.getElementById('root'))`), tag + ' lib-IIFE 显式挂载调用存在');
  ok(html.includes(`data-theme="${id}"`), tag + ' html data-theme 与文件名一致');

  /* ---------- 串色检查 ---------- */
  ok(FOREIGN[id].every((c) => !themeCss.includes(c)), tag + ' 未混入其他主题的标志色 ' + FOREIGN[id].join('/'));

  /* ---------- 签名规则 ---------- */
  SIGNATURES[id].forEach((re, i) => ok(re.test(themeCss), tag + ' 签名规则 #' + (i + 1) + ' 存在'));

  /* ---------- 指针变量必须被真正消费 ---------- */
  ok(/var\(--px/.test(themeCss) && /var\(--py/.test(themeCss), tag + ' 消费了 --px/--py（JS 只写这两个变量）');

  /* ---------- 变量覆盖广度 ---------- */
  const vars = rootVars(themeCss, `:root[data-theme='${id}']`);
  perThemeVars[id] = vars;
  const baseVars = rootVars(baseCss, ':root');
  const covered = Object.keys(vars).filter((k) => k in baseVars).length;
  ok(covered >= 12, tag + ' 覆盖了 ' + covered + ' 个结构层变量（≥12）');
  ok(Object.keys(vars).every((k) => /^--/.test(k)), tag + ' 主题 :root 块内只声明自定义属性（' + Object.keys(vars).length + ' 个）');
}

/* ---------- 三页必须共用同一份 JS（风格差异只能来自 CSS） ---------- */
const sizes = PAGES.map((p) => bundleOf[p].length);
ok(new Set(PAGES.map((p) => bundleOf[p])).size === 1, '三页 <script> 逐字节相同（' + sizes[0] + ' 字节）');
ok(sizes[0] > 200000, '共用 bundle 体积 ' + Math.round(sizes[0] / 1024) + 'KB');

/* ---------- 三套主题必须两两可辨 ---------- */
for (const k of VAR_KEYS) {
  const vals = PAGES.map((p) => String(perThemeVars[p][k] ?? 'MISSING'));
  ok(new Set(vals).size === 3, '变量 ' + k + ' 三套主题互不相同：' + vals.join(' | '));
}

/* ---------- jsdom CSSOM 能读到主题变量（证明不是纯字符串拼接） ---------- */
const probe = new JSDOM(`<!doctype html><html data-theme="memphis"><head><style>${baseCss}\n${readFileSync(join(root, 'src/styles/theme-memphis.css'), 'utf8')}</style></head><body></body></html>`);
const sheet = probe.window.document.styleSheets[0];
let foundRadius = '';
for (const rule of sheet.cssRules) {
  if (rule.selectorText === `:root[data-theme='memphis']`) {
    foundRadius = rule.style.getPropertyValue('--radius').trim();
  }
}
ok(foundRadius === '20px', 'CSSOM 可读到 memphis 的 --radius=20px（实际 ' + (foundRadius || '空') + '）');
probe.window.close();

console.log('风格断言 ' + total + ' 项，失败 ' + failures.length + ' 项');
for (const f of failures) console.log('  ✗ ' + f);
process.exit(failures.length === 0 ? 0 : 1);
