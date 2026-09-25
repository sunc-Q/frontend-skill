/* The comparison page a human opens first: three styles, one game, side by side.
   Nothing here is typed — the cards, the palette chips and the provenance rows are read out of
   src/themes.js, so the page cannot drift away from what the build actually uses.
   Run from LAB root:
     node artifacts/20260926-05-build-game-reference-driven/scripts/gen-index.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const { THEMES } = await import(pathToFileURL(path.join(SCENE, 'src/themes.js')).href);
const MAP = JSON.parse(fs.readFileSync(path.join(SCENE, 'scripts/reference-map.json'), 'utf8'));
const check = fs.existsSync(path.join(SCENE, 'scripts/check-result.json'))
  ? JSON.parse(fs.readFileSync(path.join(SCENE, 'scripts/check-result.json'), 'utf8')) : null;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const shot = (t, kind) => `shots/${t.id}-${kind}.png`;
const exists = (p) => fs.existsSync(path.join(SCENE, p));

const card = (t) => {
  const d = MAP.refs.find((r) => r.id === t.id).derived;
  const chips = t.declaredColors.map((h) => `<i style="background:${h}" title="${h}"></i>`).join('');
  const rows = t.mapping.map(([slot, formula, note]) =>
    `<tr><td>${esc(slot)}</td><td>${esc(formula)}</td><td>${esc(note)}</td></tr>`).join('');
  return `<section class="style">
  <h2>${esc(t.label)} <small>${esc(t.game)} · ${esc(t.sub)}</small></h2>
  <p class="why">${esc(t.hint)}</p>
  <div class="shots">
    ${exists(shot(t, 'world')) ? `<a href="${shot(t, 'world')}"><img src="${shot(t, 'world')}" alt="${t.id} 游戏中"></a>` : ''}
    ${exists(shot(t, 'title')) ? `<a href="${shot(t, 'title')}"><img src="${shot(t, 'title')}" alt="${t.id} 标题"></a>` : ''}
  </div>
  <p class="chips">${chips}<span class="chipnote">${t.declaredColors.length} 个声明色，全部由 ${esc(t.refFile)} 推出</span></p>
  <p class="nums">参考图亮度 L*均值 ${(d.mean_luma * 255).toFixed(0)} · 色相族 ${d.family_count} · 情绪 ${d.mood} ·
     曝光 ${t.post.exposure} · 环境光 ${t.lights.ambient.intensity} · 主光强度 ${t.lights.key.intensity} ·
     散布 ${t.scatter.count} 个 ${esc(t.scatter.kind)} · 光尘色 ${t.colors.moteHexes.join(' ')}</p>
  <p class="go"><a class="play" href="${t.id}.html">▶ 进入这一风格</a>
     <a href="references/${esc(t.refFile.split('/').pop())}">参考图</a></p>
  <details><summary>推导表（${t.mapping.length} 行，每个屏幕颜色都能追到这里）</summary>
    <table><thead><tr><th>用途</th><th>公式</th><th>代入</th></tr></thead><tbody>${rows}</tbody></table></details>
</section>`;
};

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>拾光谷 · 三种参考图驱动的 3D 风格对照</title>
<style>
 body{margin:0;padding:32px 24px 64px;background:#101215;color:#e8eaee;font:15px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
 header{max-width:1180px;margin:0 auto 26px}
 h1{font-size:26px;margin:0 0 6px;letter-spacing:.02em}
 header p{margin:4px 0;color:#9aa3ad;max-width:80ch}
 main{max-width:1180px;margin:0 auto;display:grid;gap:22px}
 .style{background:#171a1e;border:1px solid #262b31;border-radius:10px;padding:18px 20px}
 h2{font-size:19px;margin:0}
 h2 small{font-weight:400;color:#8d97a2;letter-spacing:.06em;margin-left:8px}
 .why{color:#b9c2cc;margin:6px 0 12px}
 .shots{display:grid;grid-template-columns:1fr 1fr;gap:10px}
 .shots img{width:100%;display:block;border-radius:6px;border:1px solid #2a3037}
 .chips{margin:12px 0 4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
 .chips i{width:22px;height:22px;border-radius:3px;display:inline-block;border:1px solid rgba(255,255,255,.14)}
 .chipnote{color:#7f8892;font-size:12px;margin-left:8px}
 .nums{color:#9aa3ad;font-size:13px;margin:6px 0}
 .go{margin:10px 0 0;display:flex;gap:12px;align-items:center}
 .go a{color:#9ecbff;text-decoration:none;font-size:13px}
 .play{background:#2f6feb;color:#fff;padding:7px 14px;border-radius:6px;font-size:14px}
 details{margin-top:12px;color:#aab3bd}
 table{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:8px}
 th,td{border-bottom:1px solid #242a31;padding:5px 8px;text-align:left;vertical-align:top}
 th{color:#8d97a2;font-weight:600}
 td:nth-child(2){white-space:nowrap;color:#e3b341}
 footer{max-width:1180px;margin:26px auto 0;color:#7f8892;font-size:12.5px}
 code{background:#1f242a;padding:1px 5px;border-radius:3px}
</style></head><body>
<header>
  <h1>拾光谷 · GLEAMHOLLOW — 同一份玩法，三张参考图，三种世界</h1>
  <p>build-game 技能的 Phase&nbsp;1B「参考图驱动」流程：先用 <code>scripts/extract-reference.mjs</code> 从每张 PNG 里量出
     亮度、色相族、地平线/天顶、太阳位置、情绪值，再由 <code>scripts/gen-themes.mjs</code> 把这些量代入公式生成
     <code>src/themes.js</code>。页面里出现的每一个颜色都能回溯到某张照片的某个像素集合，没有一个是手打的十六进制。</p>
  <p>三张卡片用的是同一份 <code>src/engine.js</code>、同一个布局种子 ${THEMES[0].seed}：换风格只换主题对象，
     所以「差异」全部来自参考图本身。</p>
  ${check ? `<p>验证：<code>scripts/check.mjs</code> 最近一次 ${check.pass}/${check.pass + check.fail} 条断言通过（${check.at.slice(0, 16).replace('T', ' ')}）。</p>` : ''}
</header>
<main>${THEMES.map(card).join('\n')}</main>
<footer>重新生成：从「前端skill实验室」目录依次执行
  <code>node artifacts/20260926-05-build-game-reference-driven/scripts/extract-reference.mjs</code> →
  <code>…/gen-themes.mjs</code> → <code>…/build.mjs</code> → <code>…/smoke.mjs</code> → <code>…/check.mjs</code> →
  <code>…/gen-index.mjs</code>。三个 <code>*.html</code> 各自内联了全部代码与 three.js，双击即可离线游玩。</footer>
</body></html>`;

fs.writeFileSync(path.join(SCENE, 'index.html'), html);
console.log('index.html', fs.statSync(path.join(SCENE, 'index.html')).size, 'bytes;',
  THEMES.length, 'styles;', THEMES.reduce((a, t) => a + t.mapping.length, 0), 'provenance rows');
