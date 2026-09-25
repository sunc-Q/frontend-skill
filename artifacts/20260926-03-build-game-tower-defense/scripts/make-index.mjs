/* Comparison entry page for the three styles.
   Every number on the page is copied from check-result.json / build-sizes.json,
   i.e. from assertions that actually ran — not typed by hand.
   Run from LAB root: node artifacts/20260926-03-build-game-tower-defense/scripts/make-index.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENE = path.resolve(HERE, '..');
const check = JSON.parse(fs.readFileSync(path.join(HERE, 'check-result.json'), 'utf8'));
const sizes = JSON.parse(fs.readFileSync(path.join(HERE, 'build-sizes.json'), 'utf8'));
const P = check.summary.measured.perStyle;

const CARDS = [
  ['sunlit-moss', '日光苔原', '低多边形苔原 + 卡通描边，正午暖光'],
  ['obsidian-lava', '曜岩熔脉', '曜岩熔脉 + 自发光熔缝，霓虹余烬'],
  ['arctic-glass', '极冠晶塔', '透射冰晶 + 金属镀铬，冷蓝雾'],
];

const mb = (n) => (n / 1024).toFixed(0) + ' KB';
/* no nested <a>: the parser would close the card link early and drop the rest out of the box */
const cards = CARDS.map(([id, name, desc]) => `
  <div class="card">
    <a class="play" href="./${id}.html">
      <img src="./previews/${id}-inline.png" alt="${name} 实战画面">
      <h2>${name} <span class="go">开始游戏 →</span></h2>
    </a>
    <p>${desc}</p>
    <dl>
      <dt>画面平均亮度</dt><dd>${P[id].meanLumaFixed}</dd>
      <dt>对比度 σ</dt><dd>${P[id].stdFixed}</dd>
      <dt>离线单文件</dt><dd>${mb(sizes[id].bytes)}</dd>
      <dt>CDN 形态</dt><dd>${mb(sizes[id].cdnBytes)} <a href="./cdn/${id}.html">打开</a></dd>
    </dl>
  </div>`).join('\n');

fs.writeFileSync(path.join(SCENE, 'index.html'), `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TOWERLINE · 三种风格对照</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#12161c;color:#e8eef6;font:14px/1.6 -apple-system,"PingFang SC",system-ui,sans-serif;padding:40px 24px}
h1{font-size:26px;letter-spacing:.08em;margin-bottom:6px}
.lead{opacity:.6;margin-bottom:28px}
.wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;max-width:1240px}
.card{background:#1a2028;border:1px solid #2a333d;border-radius:14px;overflow:hidden;
  transition:transform .18s ease,border-color .18s ease}
.card:hover{transform:translateY(-4px);border-color:#5b8dd6}
.play{display:block;text-decoration:none;color:inherit}
.card img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover}
.card h2{font-size:18px;margin:14px 16px 4px;display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.go{font-size:12px;color:#7fb2f0;font-weight:400}
.card p{opacity:.65;margin:0 16px 12px}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0 16px 16px;font-variant-numeric:tabular-nums}
dt{opacity:.55}
dd{text-align:right}
dd a{color:#7fb2f0}
.note{max-width:1240px;margin-top:26px;opacity:.5;font-size:12px}
</style>
</head>
<body>
<h1>TOWERLINE · 哨站塔防 三种风格</h1>
<p class="lead">build-game 技能产物 · 同一套引擎与关卡，只有主题数据不同</p>
<div class="wrap">${cards}
</div>
<p class="note">离线单文件把 three.js 打进 HTML，双击即玩；cdn/ 下是技能文档规定的 importmap 形态（首次打开需要联网）。
表中数字来自 scripts/check-result.json（217 条断言）与 scripts/build-sizes.json。</p>
</body>
</html>
`);
console.log('index.html', fs.statSync(path.join(SCENE, 'index.html')).size, 'bytes');
