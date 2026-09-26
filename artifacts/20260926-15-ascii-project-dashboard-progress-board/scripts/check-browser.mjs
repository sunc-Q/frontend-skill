#!/usr/bin/env node
// 浏览器卡：技能写「Assume monospace font (10 characters = 10 characters)」，却没说这句话在谁身上成立。
// 本卡把三份 preview/*.html 真渲染（本机 Chrome 无头 --dump-dom，零依赖），逐列量像素，回答三件事：
//   1) 等宽步进：条形/框线字符是不是真的 1 字符 = 1 列；
//   2) 宽字符：CJK/emoji 在浏览器回退字体里到底几列（实测既不是 1 也不是稳定的 2）；
//   3) 预览层的 span + letter-spacing 校正有没有把列宽口径拉回 cells()，以及它有没有碰到条形。
// 判据打在交付物本身（只在副本上追加探针），所以「产物可直接双击预览」这句话是被量过的。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeCard } from './_harness.mjs';
import { STYLES, cells, WIDE_FIX, charClass } from '../src/render.mjs';

const ROUND = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROUND, '.tmp-check');
const out = makeCard('browser');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const keys = Object.keys(STYLES);
// Chrome 在 profile 里建 Unix socket，路径上限约 104 字节；本仓库路径含中文，profile 只能放系统临时目录
const profile = join(tmpdir(), `ascii-board-ch-${process.pid}`);
const mdOf = (k) => readFileSync(join(ROUND, STYLES[k].file), 'utf8');
const htmlOf = (k) => readFileSync(join(ROUND, 'preview', `${k}.html`), 'utf8');

if (!existsSync(CHROME)) {
  out.ok('BB0', '本机存在 Google Chrome（不存在则本卡整体记为未验项，不伪绿）', false, `未找到 ${CHROME}`);
  out.done();
  process.exit(1);
}
mkdirSync(TMP, { recursive: true });
mkdirSync(profile, { recursive: true });
process.on('exit', () => { try { rmSync(profile, { recursive: true, force: true }); } catch { } });

/* ---------- 列临界字符：竖线 / 角 / 十字——只有它们需要跨行对齐 ---------- */
const CRIT = '|+│║├┤╠╣┌┐└┘╔╗╚╝';
function critTargets(md) {
  const lines = md.split('\n');
  const rows = [];
  let base = 0, inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inFence = !inFence; base += line.length + 1; continue; }
    if (inFence) {
      let ci = 0;
      for (const ch of line) {
        if (CRIT.includes(ch)) rows.push({ off: base + ci, col: cells(line.slice(0, ci)) });
        ci += ch.length;
      }
    }
    base += line.length + 1;
  }
  const byCol = new Map();
  for (const r of rows) {
    if (!byCol.has(r.col)) byCol.set(r.col, []);
    byCol.get(r.col).push(r.off);
  }
  return { rows, groups: [...byCol.entries()].filter(([, v]) => v.length >= 2) };
}

const PROBE_CHAR = {
  matrix: ['▓', '░', '─', '✅', '项'],
  dense: ['█', '▉', '▒', '║', '═', '⣿', '项'],
  teletype: ['#', '.', '+', '|', '-', ' ', '0'],
};
const FAM = { matrix: '▓', dense: '█', teletype: '#' };
// 若「换个等宽字体就能满足技能的等宽前提」成立，这些字族里至少该有一族的 CJK:ASCII 步进比 ≈ 2。
const FAMILIES = ['monospace', 'Menlo', 'Monaco', 'SFMono-Regular', 'Courier New',
  'PingFang SC', 'Heiti SC', 'Songti SC', 'STSong', 'Kaiti SC',
  'Noto Sans Mono CJK SC', 'Source Han Mono SC', 'Sarasa Mono SC', 'Microsoft YaHei Mono'];

/* ---------- 探针脚本：追加到副本上，量完写进 #probe-out ---------- */
const probeScript = (offs, chars, famChar) => `<div id="probe-out"></div><script>
(function(){ try {
 var board=document.getElementById('board'); if(!board) throw new Error('no #board');
 var cs=getComputedStyle(board);
 function mk(cls,fam){var s=document.createElement('span');
  s.style.cssText='position:absolute;left:0;top:-9999px;white-space:pre;line-height:normal;font-family:'
   +(fam||cs.fontFamily)+';font-size:'+cs.fontSize+';font-weight:'+cs.fontWeight;
  if(cls) s.className='fx-'+cls;
  document.body.appendChild(s); return s;}
 function adv(ch,cls,n,fam){var s=mk(cls,fam);s.textContent=new Array(n+1).join(ch);
  var w=s.getBoundingClientRect().width/n;s.remove();return +w.toFixed(3);}
 function xAt(root,off){var walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),n,o=0;
  while((n=walk.nextNode())){var L=n.nodeValue.length;
   if(off<=o+L){var r=document.createRange();r.setStart(n,off-o);r.collapse(true);
    var b=r.getBoundingClientRect(),bb=root.getBoundingClientRect();return +(b.left-bb.left).toFixed(2);}
   o+=L;}
  return null;}
 var mono=adv('M',null,40), x0=xAt(board,0);
 var advs={};${JSON.stringify(chars)}.forEach(function(c){advs[c]=adv(c,null,30);});
 var families={};${JSON.stringify(FAMILIES)}.forEach(function(fs){
  var m=adv('M',null,40,fs),c=adv('\\u9879',null,40,fs);
  families[fs]={ascii:m,cjk:c,ratio:+(c/m).toFixed(3)};});
 var want=${JSON.stringify(WIDE_FIX)}, cls={};
 var probes={cjk:'\\u9879',emoji:'\\u2705',braille:'\\u28bf',shape:'\\u25cf'};
 Object.keys(want).forEach(function(k){ if(!document.querySelector('.fx-'+k)) return;
  cls[k]={raw:adv(probes[k],null,30),fixed:adv(probes[k],k,30),target:want[k]};});
 var bar=(function(){var t=board.textContent,r=new Array(9).join(${JSON.stringify(famChar)}),i=t.indexOf(r);
  if(i<0) return null; return {start:xAt(board,i),end:xAt(board,i+8)};})();
 var xs=${JSON.stringify(offs)}.map(function(o){return xAt(board,o);});
 var pre=board.parentElement;
 document.getElementById('probe-out').textContent=JSON.stringify({
  mono:mono,x0:x0,chars:board.textContent.length,lines:board.textContent.split('\\n').length,
  advs:advs,cls:cls,xs:xs,bar:bar,fx:board.getAttribute('data-fx')||'',families:families,
  scroll:{w:pre.scrollWidth,c:pre.clientWidth},font:cs.fontFamily,size:cs.fontSize});
} catch (err) {
 document.getElementById('probe-out').textContent=JSON.stringify({error:String(err&&err.message||err)});
}
})();
</script>`;

const runChrome = (file) => new Promise((resolve) => {
  const p = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=5000', '--dump-dom', 'file://' + encodeURI(file),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let s = '', e = '', settled = false;
  const finish = () => { if (settled) return; settled = true; try { p.kill('SIGKILL'); } catch { } resolve({ out: s, err: e }); };
  p.stdout.on('data', (b) => { s += b.toString(); if (s.includes('</html>')) finish(); });
  p.stderr.on('data', (b) => { e += b.toString(); });
  p.on('error', (err) => { e = String(err); finish(); });
  p.on('exit', finish);
  setTimeout(finish, 45000);
});
const parse = (dump) => {
  const m = dump.match(/<div id="probe-out">(\{[\s\S]*?\})<\/div>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

const R = {};
for (const k of keys) {
  const md = mdOf(k);
  const { rows, groups } = critTargets(md);
  const offs = rows.map((r) => r.off);
  const html = htmlOf(k);
  const hasScript = /<script>/.test(html);
  const rawHtml = hasScript ? html.replace(/<script>[\s\S]*?<\/script>/, '') : html;
  const page = join(TMP, `probe-${k}.html`);
  const pageRaw = join(TMP, `probe-${k}-raw.html`);
  writeFileSync(page, html.replace('</body>', probeScript(offs, PROBE_CHAR[k], FAM[k]) + '</body>'));
  writeFileSync(pageRaw, rawHtml.replace('</body>', probeScript(offs, PROBE_CHAR[k], FAM[k]) + '</body>'));
  const fixed = parse((await runChrome(page)).out);
  const raw = parse((await runChrome(pageRaw)).out);
  R[k] = { md, rows, offs, cols: rows.map((r) => r.col), groups, fixed, raw, hasScript };
}

/* ---------- BB1 渲染本身成立吗 ---------- */
const got = keys.every((k) => R[k].fixed && R[k].fixed.mono > 0 && R[k].fixed.chars > 3000);
out.ok('BB1', `三份预览都被 Chrome 真渲染（正文字符 ${keys.map((k) => `${k}=${(R[k].fixed || {}).chars || 'ERR'}`).join(' ')}）`,
  got, `字体=${(R.matrix.fixed || {}).font || '-'} ${(R.matrix.fixed || {}).size || ''}`);
if (!got) {
  out.ok('BB1b', 'Chrome 输出可解析（失败时本卡记为未验项，不给伪绿）', false,
    keys.map((k) => `${k}:${(R[k].fixed && (R[k].fixed.error || 'ok')) || 'no metrics'}`).join(' '));
  out.done();
  process.exit(1);
}

/* ---------- BB2 等宽步进：条形/框线字符 = 1 列 ---------- */
for (const k of keys) {
  const { mono, advs } = R[k].fixed;
  const plain = PROBE_CHAR[k].filter((c) => !WIDE_FIX[charClass(c)]);
  const rs = plain.map((c) => ({ c, r: +(advs[c] / mono).toFixed(4) }));
  out.ok(`BB2-${k}`, `${k} 的条形与框线字符实测步进 = 等宽步进（±2%）：技能 "10 chars = 10 cols" 的字面前提成立`,
    rs.length >= 3 && rs.every((x) => Math.abs(x.r - 1) <= 0.02), rs.map((x) => `${x.c}=${x.r}`).join(' '));
}

/* ---------- BB3 宽字符：浏览器给几列 ---------- */
{
  const mono = R.matrix.fixed.mono;
  const sizePx = parseFloat(R.matrix.fixed.size);
  const rawCjk = R.matrix.fixed.advs['项'];
  out.ok('BB3', `CJK 在浏览器回退字体里是 ${(rawCjk / mono).toFixed(3)} 列而不是 2 列：技能那句排版前提在浏览器侧先天不成立`,
    rawCjk / mono > 1.5 && rawCjk / mono < 1.8, `cjk=${rawCjk.toFixed(2)}px mono=${mono.toFixed(2)}px 比率=${(rawCjk / mono).toFixed(3)}`);
  out.ok('BB3b', `实测 CJK 步进恰为 1 个 font-size（回退到 PingFang 一类比例字体的 em 宽），所以「CJK=2 列」只在 CJK locale 终端成立`,
    Math.abs(rawCjk - sizePx) <= sizePx * 0.02, `cjk=${rawCjk.toFixed(2)}px font-size=${sizePx}px`);
}
for (const k of keys) {
  const cls = R[k].fixed.cls;
  const names = Object.keys(cls);
  if (!names.length) {
    out.ok(`BB3c-${k}`, `${k} 无宽字符 → 不注脚本、不包 span（strict ASCII 不需要校正）`, !R[k].hasScript && !names.length, `cls=0 hasScript=${R[k].hasScript}`);
    continue;
  }
  out.ok(`BB3c-${k}`, `${k} 的 span 校正把每类宽字符拉到 cells() 的列数（±3%）：${names.map((c) => `${c} ${(cls[c].raw / R[k].fixed.mono).toFixed(2)}→${(cls[c].fixed / R[k].fixed.mono).toFixed(2)} 列`).join('，')}`,
    names.every((c) => Math.abs(cls[c].fixed - cls[c].target * R[k].fixed.mono) <= 0.03 * R[k].fixed.mono),
    names.map((c) => `${c}: target=${cls[c].target} raw=${(cls[c].raw / R[k].fixed.mono).toFixed(3)} fixed=${(cls[c].fixed / R[k].fixed.mono).toFixed(3)}`).join(' '));
}

/* ---------- BB4/BB5 列预测与「不校正会怎样」的对照 ---------- */
function residuals(e, reading) {
  if (!reading || !reading.xs) return { max: Infinity, spread: 0, groups: 0 };
  const mono = reading.mono;
  const byCol = new Map();
  e.rows.forEach((r, i) => {
    const x = reading.xs[i];
    if (x === null) return;
    if (!byCol.has(r.col)) byCol.set(r.col, []);
    byCol.get(r.col).push(x);
  });
  const pred = e.rows.map((r, i) => Math.abs(reading.xs[i] - r.col * mono));
  const multi = [...byCol.values()].filter((v) => v.length >= 2);
  return {
    n: pred.length,
    max: +Math.max(0, ...pred).toFixed(2),
    spread: +(multi.length ? Math.max(...multi.map((v) => Math.max(...v) - Math.min(...v))) : 0).toFixed(2),
    groups: multi.length,
  };
}
for (const k of keys) {
  const e = R[k];
  const f = residuals(e, e.fixed);
  const r = residuals(e, e.raw);
  out.ok(`BB4-${k}`, `${k} 修正后：${f.n} 个列临界字符（竖线/角）的实测 x 与 cells() 预测一致（最大残差 ${f.max}px ≤ 1.2px），${f.groups} 组同列字符跨行贴合（组内跨度 ${f.spread}px ≤ 0.6px）`,
    f.n >= 8 && f.max <= 1.2 && f.groups >= 2 && f.spread <= 0.6, `残差≤${f.max}px 组内≤${f.spread}px 组数=${f.groups}`);
  if (e.hasScript) {
    out.ok(`BB5-${k}`, `${k} 同一份看板去掉校正脚本立刻露馅：同列字符跨行最大跨度 ${r.spread}px（≥2px）——校正不是摆设`,
      r.spread >= 2 && r.spread > f.spread * 3, `raw=${r.spread}px fixed=${f.spread}px；raw 预测残差≤${r.max}px`);
  } else {
    out.ok(`BB5-${k}`, `${k} 无脚本可信：纯 ASCII 本来就不需要校正（同列跨行跨度 ${r.spread}px，与修正版同图）`,
      r.spread <= 0.6 && !e.hasScript, `raw=${r.spread}px fixed=${f.spread}px`);
  }
  out.ok(`BB6-${k}`, `${k} 条形未被校正碰到：${FAM[k]}×8 实测 ${(e.fixed.bar.end - e.fixed.bar.start).toFixed(2)}px == 8×等宽（±1px），raw/fixed 两版同宽`,
    e.fixed.bar && Math.abs((e.fixed.bar.end - e.fixed.bar.start) - 8 * e.fixed.mono) <= 1
    && e.raw && Math.abs((e.raw.bar.end - e.raw.bar.start) - (e.fixed.bar.end - e.fixed.bar.start)) <= 0.2,
    `bar=${(e.fixed.bar.end - e.fixed.bar.start).toFixed(2)}px vs ${(8 * e.fixed.mono).toFixed(2)}px`);
}

/* ---------- BB7~BB10 结构与产物独立性 ---------- */
for (const k of keys) {
  const e = R[k];
  out.ok(`BB7-${k}`, `${k} 渲染行数 == .md 行数（<pre> 没吞行，span 没换行）`,
    e.fixed.lines === e.md.split('\n').length, `${e.fixed.lines} 行`);
  out.ok(`BB8-${k}`, `${k} 预览区横向可滚而非裁切（scrollWidth ${e.fixed.scroll.w} ≥ clientWidth ${e.fixed.scroll.c}）`,
    e.fixed.scroll.w >= e.fixed.scroll.c && e.fixed.scroll.c > 200, `需横向滚动 ${Math.max(0, e.fixed.scroll.w - e.fixed.scroll.c)}px`);
}
out.ok('BB9', 'Chrome 侧记账：data-fx 只在含宽字符的两份里出现，且记录的正是被校正的类',
  /cjk/.test(R.matrix.fixed.fx || '') && /braille/.test(R.dense.fixed.fx || '') && R.teletype.fixed.fx === '',
  `matrix fx=${R.matrix.fixed.fx || '-'} dense fx=${R.dense.fixed.fx || '-'} teletype fx=-`);
out.ok('BB10', '探针只写在 .tmp-check 副本上，交付 HTML 未被改写（删掉 .tmp-check 三份产物照旧可双击）',
  existsSync(join(ROUND, 'preview', 'matrix.html')) && htmlOf('matrix') === readFileSync(join(ROUND, 'preview', 'matrix.html'), 'utf8')
  && R.matrix.hasScript && /probe-out/.test(readFileSync(join(TMP, 'probe-matrix.html'), 'utf8')) && !/probe-out/.test(htmlOf('matrix')),
  keys.map((k) => `probe-${k}.html+probe-${k}-raw.html`).join(' '));
const FAMS = R.matrix.fixed.families || {};
const famList = Object.entries(FAMS).map(([n, v]) => `${n}=${v.ratio}`).join(' ');
out.ok('BB11a', '字族扫描本身有效：各字族的 ASCII 步进并非全同（若全同说明 font-family 没生效，BB11 就成了空转）',
  new Set(Object.values(FAMS).map((v) => v.ascii)).size >= 3, [...new Set(Object.values(FAMS).map((v) => v.ascii))].join(' '));
out.ok('BB11', `${FAMILIES.length} 个候选字族（含中文字族与 Noto/Source Han/Sarasa 三款宣称等宽的 CJK 字体）里，无一族的 CJK:ASCII 步进比接近 2 —— 换字体救不了这条前提，校正必须由预览层自己做`,
  FAMILIES.every((n) => Number.isFinite(FAMS[n]?.ratio)) && Object.values(FAMS).every((v) => v.ratio < 1.9),
  `实测比率 ${famList}`);
console.log('[browser] Chrome 实测：mono=' + R.matrix.fixed.mono + 'px，条形族步进 ' + JSON.stringify(R.matrix.fixed.advs));
// 把读数落盘，供 preview/styles.html 入口页引用（免得入口页重述一遍数字）
writeFileSync(join(TMP, 'browser-meta.json'), JSON.stringify({
  chrome: 'Google Chrome（无头 --dump-dom）',
  font: R.matrix.fixed.font, fontSize: R.matrix.fixed.size,
  monoPx: R.matrix.fixed.mono,
  families: FAMS,
  charPx: { matrix: R.matrix.fixed.advs, dense: R.dense.fixed.advs, teletype: R.teletype.fixed.advs },
  classes: Object.fromEntries(keys.map((k) => [k, R[k].fixed.cls])),
  align: Object.fromEntries(keys.map((k) => [k, {
    critChars: R[k].rows.length, groups: residuals(R[k], R[k].fixed).groups,
    fixedSpreadPx: residuals(R[k], R[k].fixed).spread, rawSpreadPx: residuals(R[k], R[k].raw).spread,
    fixedPredMaxPx: residuals(R[k], R[k].fixed).max, hasScript: R[k].hasScript,
  }])),
  barPx: Object.fromEntries(keys.map((k) => [k, +(R[k].fixed.bar.end - R[k].fixed.bar.start).toFixed(2)])),
  printed_at: new Date().toISOString(),
}, null, 1));
out.done();
