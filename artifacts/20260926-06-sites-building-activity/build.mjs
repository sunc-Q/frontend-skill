/* 构建器：零依赖、零打包器。把 src/ 的四个片段拼进 src/page.html 的三个占位符，
   产出三份「双击即开」的单文件页面 + 一份三风格对照入口。
   占位符替换一律用 replacer 函数（历轮踩过：替换串里的 $' / $& 会被展开导致文档自我复制）。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'preview');
const read = (p) => readFileSync(join(SRC, p), 'utf8');

const STYLES = [
  { slug: 'papercut', css: 'theme-papercut.css', label: '剪纸层叠', note: '暖米纸 + 番茄红/芥末黄的厚剪纸条，大圆角双层硬偏移影，日程被打散成剪纸条目' },
  { slug: 'ticket', css: 'theme-ticket.css', label: '票据存根', note: '等宽字 + 零圆角 + 齿孔撕口 + 斑马纹严格表格 + 红色骑缝章，全程无阴影' },
  { slug: 'isometric', css: 'theme-isometric.css', label: '等距轴测', note: '深空底 + serif 斜体标题 + 竖排舞台标签 + 透视压台 + 霓虹发光描边' },
];

const appJs = [
  '"use strict";',
  '(function () {',
  read('content.js'),
  read('svc.js'),
  read('app.js'),
  '})();',
].join('\n');

const baseCss = read('base.css');
mkdirSync(OUT, { recursive: true });

const made = [];
for (const st of STYLES) {
  const html = read('page.html')
    .replace('/*__BASE__*/', () => '\n' + baseCss + '\n')
    .replace('/*__THEME__*/', () => '\n' + read(st.css) + '\n')
    .replace('/*__APP__*/', () => '\n' + appJs + '\n');
  if (/\/\*__(BASE|THEME|APP)__\*\//.test(html)) throw new Error('占位符未替换：' + st.slug);
  const out = join(OUT, 'activity-' + st.slug + '.html');
  writeFileSync(out, html);
  made.push({ slug: st.slug, label: st.label, note: st.note, bytes: Buffer.byteLength(html), file: 'activity-' + st.slug + '.html' });
}

const index = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>声浪岛报名页 · 三风格对照（零框架 sites-building）</title>
<style>
:root{--ink:#1b1b1b;--paper:#f4f1ea;--line:#c9c2b2;--accent:#2b4c7e}
*{box-sizing:border-box}body{margin:0;padding:38px 22px;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,"PingFang SC",sans-serif}
main{max-width:940px;margin:0 auto}h1{font-size:27px;margin:0 0 6px}p.sub{color:#5b564c;margin:0 0 26px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:14px}
a{display:block;padding:18px 20px;border:1px solid var(--line);background:#fff;color:var(--ink);text-decoration:none}
a:hover{border-color:var(--accent)}b{font-size:19px}span{display:block;color:#5b564c;font-size:14px;margin-top:4px}
em{font-style:normal;font-family:ui-monospace,Menlo,monospace;font-size:13px;color:var(--accent)}
footer{margin-top:26px;font-size:13px;color:#5b564c}
</style></head><body><main>
<h1>星屿·声浪岛音乐节 · 活动报名页</h1>
<p class="sub">sites:sites-building（Simple site 静态路径）· 零框架零构建单文件 · 同一份 DOM 与逐字节相同的脚本，仅换 CSS 主题层</p>
<ul>${made.map((m) => `<li><a href="${m.file}"><b>${m.label}</b><em>${m.file} · ${(m.bytes / 1024).toFixed(1)} KB</em><span>${m.note}</span></a></li>`).join('')}</ul>
<footer>数据为固定样例，页面内 <code>svc.js</code> 模拟取数延迟与风控规则，不连接真实票务服务。校验：<code>bash scripts/verify.sh</code></footer>
</main></body></html>
`;
writeFileSync(join(OUT, 'styles.html'), index);
const meta = { built: new Date().toISOString(), styles: made, appJsBytes: Buffer.byteLength(appJs), baseCssBytes: Buffer.byteLength(baseCss) };
writeFileSync(join(ROOT, '.build-meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(JSON.stringify(meta, null, 2));
