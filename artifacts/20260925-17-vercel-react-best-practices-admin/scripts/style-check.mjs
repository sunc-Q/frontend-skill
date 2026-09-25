import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

function vars(file) {
  const html = readFileSync(file, 'utf8');
  const dom = new JSDOM(html);
  const d = dom.window.document;
  const theme = d.documentElement.getAttribute('data-theme');
  const sheets = [...d.styleSheets];
  const out = {};
  for (const sh of sheets) {
    let rules;
    try { rules = sh.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.selectorText === ':root' && r.style) {
        for (const p of r.style) {
          if (p.startsWith('--')) out[p] = r.style.getPropertyValue(p).trim();
        }
      }
    }
  }
  return { theme, vars: out, styleTags: d.querySelectorAll('style').length, scripts: d.querySelectorAll('script').length };
}

const files = ['business', 'mono', 'win95'].map((t) => `preview/admin-${t}.html`);
const got = files.map(vars);
let fail = 0;
const key = (o, k) => o.vars[k];
const expect = (name, cond, extra) => { if (!cond) { fail++; console.log('FAIL ' + name + ' :: ' + String(extra)); } else console.log('PASS ' + name); };

for (const g of got) {
  expect(g.theme + ' 变量表可读', Object.keys(g.vars).length > 30, Object.keys(g.vars).length);
  expect(g.theme + ' 只有一个 style 标签', g.styleTags === 1, g.styleTags);
  expect(g.theme + ' 两个 script（bundle + mount）', g.scripts === 2, g.scripts);
}

const [b, m, w] = got;
expect('三主题底色互不相同', new Set([key(b, '--bg'), key(m, '--bg'), key(w, '--bg')]).size === 3, [key(b, '--bg'), key(m, '--bg'), key(w, '--bg')].join(' | '));
expect('三主题主字体互不相同', new Set([key(b, '--font-sans'), key(m, '--font-sans'), key(w, '--font-sans')]).size === 3);
expect('三主题强调色互不相同', new Set([key(b, '--accent'), key(m, '--accent'), key(w, '--accent')]).size === 3, [key(b, '--accent'), key(m, '--accent'), key(w, '--accent')].join(' | '));
expect('商务白为浅色底', key(b, '--bg') === '#eef1f6');
expect('单色暗为深色底且强调色即前景色（无彩色）', key(m, '--bg') === '#0d0d0d' && key(m, '--accent') === '#e8e8e8');
expect('单色暗圆角为 0', key(m, '--radius') === '0');
expect('95 桌面用灰底 + navy 强调', key(w, '--bg') === '#c0c0c0' && key(w, '--accent') === '#000080');
expect('95 桌面 KPI 不做全大写（--kpi-caps:none）', key(w, '--kpi-caps') === 'none');
expect('商务白保留大写标签与圆角', key(b, '--kpi-caps') === 'uppercase' && key(b, '--radius') === '6px');
expect('三主题 KPI 字号各不相同', new Set([key(b, '--fs-kpi'), key(m, '--fs-kpi'), key(w, '--fs-kpi')]).size === 3, [key(b, '--fs-kpi'), key(m, '--fs-kpi'), key(w, '--fs-kpi')].join(' | '));
expect('三主题字距主张不同（单色暗最宽）', parseFloat(key(m, '--ls-h1')) > parseFloat(key(b, '--ls-h1')) && parseFloat(key(b, '--ls-h1')) > parseFloat(key(w, '--ls-h1')));
expect('toast 底色三页各异', new Set([key(b, '--toast-bg'), key(m, '--toast-bg'), key(w, '--toast-bg')]).size === 3);

/* 级联顺序回归：主题层必须排在结构层之后，否则同特异性下被 base 覆盖
   （曾导致 mono 的 radius:0 / 2px 左边框与 win95 的斜角边框全部失效） */
const baseCss = readFileSync('src/styles/base.css', 'utf8').trim();
for (const [file, theme] of [['preview/admin-business.html', 'business'], ['preview/admin-mono.html', 'mono'], ['preview/admin-win95.html', 'win95']]) {
  const pageCss = readFileSync(file, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  const themeCss = readFileSync(`src/styles/theme-${theme}.css`, 'utf8').trim();
  expect(theme + ' 的 CSS 拼接顺序为 base 在前、theme 在后', pageCss.trimStart().startsWith(baseCss) && pageCss.trimEnd().endsWith(themeCss));
}

console.log('风格变量：');
for (const g of got) console.log(' ', g.theme.padEnd(9), 'bg=' + key(g, '--bg'), 'accent=' + key(g, '--accent'), 'radius=' + key(g, '--radius'), 'kpi=' + key(g, '--fs-kpi'), 'font=' + key(g, '--font-sans').slice(0, 18));
console.log(fail === 0 ? 'ALL STYLE ASSERTIONS PASS' : 'STYLE FAILURES=' + fail);
process.exit(fail === 0 ? 0 : 1);
