#!/usr/bin/env node
// 产物：三种风格的看板 .md（技能原生载体）+ 各自单文件 HTML 预览 + 三风格对照 styles.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, STYLES, stats, cells, maxCells, ambiguousCount, wideRuns, WIDE_FIX } from '../src/render.mjs';

const HERE = fileURLToPath(import.meta.url);
const ROUND = join(HERE, '..', '..');
const factsPath = process.env.FACTS || join(ROUND, 'facts.json');
const outDir = process.env.OUT_DIR || ROUND;
const f = JSON.parse(readFileSync(factsPath, 'utf8'));

mkdirSync(join(outDir, 'preview'), { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

const CSS = (st) => `
:root{--bg:${st.key === 'matrix' ? '#f6f4ee' : st.key === 'dense' ? '#0d1117' : '#efe9dc'};--fg:${st.key === 'dense' ? '#c8e6c1' : '#1c1a17'};--acc:${st.key === 'matrix' ? '#b4453a' : st.key === 'dense' ? '#5ee0a8' : '#7a2f1d'};--rule:${st.key === 'matrix' ? '#d8d2c4' : st.key === 'dense' ? '#233a2c' : '#c9bfa8'};--font:"SFMono-Regular",Menlo,Consolas,"Noto Sans Mono",monospace}
*{box-sizing:border-box}
body{margin:0;padding:28px 18px 60px;background:var(--bg);color:var(--fg);font-family:var(--font);line-height:1.45}
.wrap{max-width:${st.key === 'matrix' ? '1280px' : '900px'};margin:0 auto}
h1{font-size:19px;margin:0 0 4px;letter-spacing:${st.key === 'teletype' ? '1px' : '0'}}
.meta{font-size:12px;color:var(--acc);margin:0 0 14px;border-bottom:1px solid var(--rule);padding-bottom:10px;white-space:pre-wrap}
pre{font-family:var(--font);font-size:12.5px;margin:0;white-space:pre;overflow-x:auto;padding:12px;background:${st.key === 'matrix' ? '#fffdf7' : st.key === 'dense' ? '#091019' : '#f7f2e7'};border:1px solid var(--rule);border-radius:${st.key === 'dense' ? '3px' : '2px'};box-shadow:${st.key === 'matrix' ? '0 1px 0 var(--rule)' : 'none'}}
table{border-collapse:collapse;font-size:12.5px;margin:0}
.mark{display:inline-block;margin-top:14px;font-size:11px;color:var(--acc);text-transform:uppercase;letter-spacing:.5px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.fx-cjk{letter-spacing:var(--fx-cjk,0)}
.fx-emoji{letter-spacing:var(--fx-emoji,0)}
.fx-braille{letter-spacing:var(--fx-braille,0)}
.fx-shape{letter-spacing:var(--fx-shape,0)}
a{color:var(--acc)}`;

// 宽字符按类包 span；校正脚本现量等宽步进与各类实际步进，用 letter-spacing 补回 cells() 的列数口径。
// 没跑 JS 就退化成未校正的原样，看板照样读——浏览器实测见 check-browser.mjs 的 BB3/BB11/BB12。
const wrapHtml = (s) => wideRuns(s)
  .map(([cls, chunk]) => (cls === 't' ? esc(chunk) : `<span class="fx-${cls}">${esc(chunk)}</span>`))
  .join('');

const FIX_SCRIPT = `<script>
(function(){
 var board=document.getElementById('board'); if(!board) return;
 var cs=getComputedStyle(board);
 function adv(ch,cls,n){
  var s=document.createElement('span');
  s.style.cssText='position:absolute;left:0;top:-9999px;white-space:pre;line-height:normal;font-family:'
   +cs.fontFamily+';font-size:'+cs.fontSize+';font-weight:'+cs.fontWeight;
  if(cls) s.className='fx-'+cls;
  document.body.appendChild(s); s.textContent=new Array(n+1).join(ch);
  var w=s.getBoundingClientRect().width/n; s.remove(); return w;
 }
 var mono=adv('M',null,40); if(!(mono>0)) return;
 var want=${JSON.stringify(WIDE_FIX)};
 var root=document.documentElement.style, done={};
 Object.keys(want).forEach(function(k){
  if(!document.querySelector('.fx-'+k)) return;
  var probe={cjk:'\\u9879',emoji:'\\u2705',braille:'\\u28bf',shape:'\\u25cf'}[k];
  var a=adv(probe,k,40); if(!(a>0)) return;
  root.setProperty('--fx-'+k,(want[k]*mono-a).toFixed(3)+'px'); done[k]=+(want[k]*mono-a).toFixed(2);
 });
 board.setAttribute('data-fx-mono',mono.toFixed(4));
 board.setAttribute('data-fx',JSON.stringify(done));
})();
</script>`;

const html = (st, text) => {
  const en = st.key === 'teletype';
  const fixed = wideRuns(text).some(([c]) => c !== 't');
  const perLane = f.lanes.map((l) => { const s = stats(l.tasks); return `${en ? l.name_ascii : l.name} ${s.done}/${s.total}`; });
  const total = stats(f.lanes.flatMap((l) => l.tasks));
  const summary = en
    ? `${total.total} tracked items across ${f.lanes.length} lanes: ${total.done} done, ${total.blocked} blocked, ${total.doing} in progress. Overall ${total.pct} percent. Per lane: ${perLane.join('; ')}.`
    : `共 ${total.total} 项任务，完成 ${total.done} 项，阻塞 ${total.blocked} 项，进行中 ${total.doing} 项，整体 ${total.pct}%。分泳道：${perLane.join('；')}。`;
  return `<!doctype html>
<html lang="${en ? 'en' : 'zh-CN'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(en ? 'FRONTEND SKILL LAB / PROGRESS BOARD' : `前端 Skill 验证流水线 · 进度看板 · ${st.title}`)}</title>
<style>${CSS(st)}</style></head>
<body><div class="wrap">
<h1>${esc(label2(st))}</h1>
<p class="meta">${esc(st.note)}</p>
<p class="vh" id="alt">${esc(summary)}</p>
<div role="region" aria-labelledby="alt" tabindex="0">
<pre aria-describedby="alt"><code id="board">${fixed ? wrapHtml(text) : esc(text)}</code></pre>
</div>
<span class="mark">style=${st.key} | bytes=${Buffer.byteLength(text)} | lines=${text.split('\n').length} | maxcells=${maxCells(text.split('\n'))} | ambiguous=${ambiguousCount(text)} | facts=${f.ledger.state_sha1}${fixed ? ' | fix=cjk+emoji+braille' : ' | fix=none'}</span>
${fixed ? FIX_SCRIPT : ''}
</div></body></html>
`;
};
const label2 = (st) => (st.key === 'teletype' ? 'FRONTEND SKILL LAB / PROGRESS BOARD' : '前端 Skill 验证流水线 · 进度看板');

const out = { styles: {}, facts_sha: f.ledger.state_sha1 };
for (const key of Object.keys(STYLES)) {
  const st = STYLES[key];
  const text = render(key, f);
  writeFileSync(join(outDir, st.file), text);
  const h = html(st, text);
  writeFileSync(join(outDir, 'preview', `${key}.html`), h);
  const lines = text.split('\n');
  // 版式区（非表格行）才受对齐预算约束；Markdown 表格行由渲染器重排
  const art = lines.filter((l) => !l.startsWith('|'));
  const tbl = lines.filter((l) => l.startsWith('|'));
  out.styles[key] = {
    file: st.file, md_bytes: Buffer.byteLength(text), html_bytes: Buffer.byteLength(h),
    lines: lines.length, art_max_cells: maxCells(art), table_max_cells: maxCells(tbl),
    art_lines: art.length, width_budget: st.width,
    ambiguous: ambiguousCount(text),
    emoji: (text.match(/\p{Extended_Pictographic}/gu) || []).length,
    blocks: { full: (text.match(/█/g) || []).length, heavy: (text.match(/[▓░]/g) || []).length, hash: (text.match(/[#]/g) || []).length, braille: (text.match(/[\u2800-\u28ff]/gu) || []).length, box: (text.match(/[\u2500-\u257f]/gu) || []).length },
    cjk: (text.match(/[\u4e00-\u9fff]/g) || []).length,
    maxCodePoint: Math.max(...Array.from(text).map((c) => c.codePointAt(0))),
    lanes: f.lanes.map((l) => ({ key: l.key, ...stats(l.tasks) })),
  };
}
writeFileSync(join(outDir, '.tmp-check', 'build-meta.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.styles)) {
  console.log(`${k.padEnd(9)} md=${v.md_bytes}B html=${v.html_bytes}B lines=${v.lines} art=${v.art_max_cells}/${v.width_budget}cells table=${v.table_max_cells} emoji=${v.emoji} ambig=${v.ambiguous} maxCP=U+${v.maxCodePoint.toString(16)}`);
}
