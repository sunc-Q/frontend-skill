#!/usr/bin/env node
// 三风格对照入口页 preview/styles.html。
// 本页每一个数字都从 facts.json / .tmp-check/build-meta.json / .tmp-check/assertions-*.json 现读，
// 脚本里不写死任何计数；缺哪个读数就如实显示"未生成"。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLES, stats, cells } from '../src/render.mjs';

const ROUND = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = (p) => (existsSync(join(ROUND, p)) ? JSON.parse(readFileSync(join(ROUND, p), 'utf8')) : null);
const f = readJSON('facts.json');
const meta = readJSON('.tmp-check/build-meta.json');
if (!f || !meta) { console.error('先跑 facts.mjs 与 build.mjs'); process.exit(1); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const total = stats(f.lanes.flatMap((l) => l.tasks));

/* 各风格 .md 的汇总表末格：bar 字段 + 一个空格 + NN% */
function summaryRows(key) {
  const text = readFileSync(join(ROUND, STYLES[key].file), 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const parts = line.slice(1, -1).split('|');
    if (parts.length !== 6) continue;
    const nums = parts.slice(2, 5).map((p) => (/^\s*\d+\s*$/.test(p) ? +p : NaN));
    if (nums.some(Number.isNaN)) continue;
    const cell = parts[5].replace(/^\s/, '').replace(/\s+$/, '');
    const m = cell.match(/(\d{1,3})%$/);
    if (!m) continue;
    rows.push({ lane: parts[0].trim(), total: nums[0], done: nums[1], blocked: nums[2], bar: cell.slice(0, m.index).replace(/\s$/, ''), pct: +m[1] });
  }
  return rows;
}
const rows = Object.fromEntries(Object.keys(STYLES).map((k) => [k, summaryRows(k)]));
const laneMatch = (rowLane, l) => rowLane === l.name || rowLane.toUpperCase().includes(l.name_ascii) || rowLane.replace(/^\p{Extended_Pictographic}\s*/u, '') === l.name;

const cards = ['node', 'mutate', 'clean', 'browser']
  .map((k) => ({ k, d: readJSON(`.tmp-check/assertions-${k}.json`) }))
  .filter((c) => c.d);

const CSS = `
:root{--bg:#101318;--fg:#dfe6ee;--acc:#66d9a8;--warn:#ff8b6b;--rule:#232b36;--font:"SFMono-Regular",Menlo,Consolas,"Noto Sans Mono",monospace}
*{box-sizing:border-box}
body{margin:0;padding:26px 18px 70px;background:var(--bg);color:var(--fg);font-family:var(--font);line-height:1.5}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:18px;margin:0 0 2px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--acc);margin:26px 0 8px;border-bottom:1px solid var(--rule);padding-bottom:6px}
p.sub{font-size:12px;color:#8fa0b3;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.card{border:1px solid var(--rule);border-radius:4px;padding:12px;background:#0c0f14}
.card h3{margin:0 0 6px;font-size:13px}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--rule)}
th{color:#8fa0b3;font-weight:400;text-transform:uppercase;font-size:10px;letter-spacing:.6px}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.bad{color:var(--warn)}
.good{color:var(--acc)}
pre{margin:0;font-size:12px;white-space:pre}
.kv{display:flex;justify-content:space-between;font-size:12px;border-bottom:1px dotted var(--rule);padding:2px 0}
footer{margin-top:26px;font-size:11px;color:#6f7f90}`;

const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const barHtml = (key, r) => `<pre>${esc(r.bar)} ${r.pct}%</pre>`;

const styleCards = Object.keys(STYLES).map((k) => {
  const st = STYLES[k]; const m = meta.styles[k];
  return `<div class="card"><h3>${esc(st.title)}</h3>
<p class="sub">${esc(st.note)}</p>
<div class="kv"><span>Markdown 看板</span><a href="../${esc(st.file)}">${esc(st.file)}</a></div>
<div class="kv"><span>单文件预览</span><a href="${esc(k)}.html">preview/${esc(k)}.html</a></div>
<div class="kv"><span>md / html 字节</span><span class="n">${m.md_bytes} / ${m.html_bytes}</span></div>
<div class="kv"><span>行数</span><span class="n">${m.lines}</span></div>
<div class="kv"><span>版式区最宽 / 预算</span><span class="n">${m.art_max_cells} / ${m.width_budget} 列</span></div>
<div class="kv"><span>emoji / 块字符 / 盲文 / 盒线 / CJK</span><span class="n">${m.emoji} / ${m.blocks.heavy + m.blocks.full} / ${m.blocks.braille} / ${m.blocks.box} / ${m.cjk}</span></div>
<div class="kv"><span>歧义宽度字符数</span><span class="n ${m.ambiguous ? 'bad' : 'good'}">${m.ambiguous}</span></div>
<div class="kv"><span>最大码点</span><span class="n">U+${m.maxCodePoint.toString(16)}</span></div>
</div>`;
}).join('');

const matrix = `<table><thead><tr><th>泳道</th>${Object.keys(STYLES).map((k) => `<th>${esc(k)}</th>`).join('')}<th class="n">现算 done/total</th><th class="n">阻塞</th></tr></thead><tbody>
${f.lanes.map((l) => `<tr><td>${esc(l.name)}</td>${Object.keys(STYLES).map((k) => {
  const r = rows[k].find((x) => laneMatch(x.lane, l));
  return `<td>${r ? barHtml(k, r) : '<span class="bad">未解出</span>'}</td>`;
}).join('')}<td class="n">${stats(l.tasks).done}/${stats(l.tasks).total}</td><td class="n">${stats(l.tasks).blocked}</td></tr>`).join('')}
<tr><td><b>合计</b></td>${Object.keys(STYLES).map((k) => {
  const r = rows[k].find((x) => /合计|TOTAL/i.test(x.lane));
  return `<td>${r ? barHtml(k, r) : ''}</td>`;
}).join('')}<td class="n">${total.done}/${total.total}</td><td class="n">${total.blocked}</td></tr>
</tbody></table>`;

const sameCheck = (() => {
  const sig = (k) => {
    const all = rows[k];
    const named = f.lanes.map((l) => {
      const r = all.find((x) => laneMatch(x.lane, l));
      return r ? `${l.key}:${r.done}/${r.total}=${r.pct}` : `${l.key}:未解出`;
    });
    const t = all.find((x) => /合计|TOTAL/i.test(x.lane));
    return [...named, t ? `TOTAL:${t.done}/${t.total}=${t.pct}` : 'TOTAL:未解出'].join('|');
  };
  const s = Object.keys(STYLES).map(sig);
  return { same: new Set(s).size === 1, sample: s[0] };
})();

const cardTable = cards.length ? `<table><thead><tr><th>校验卡</th><th class="n">通过/总数</th><th>失败项</th><th class="n">落盘时刻</th></tr></thead><tbody>
${cards.map(({ k, d }) => {
  const fail = d.rows.filter((r) => !r.pass);
  return `<tr><td><a href="#">assertions-${esc(k)}.json</a></td><td class="n ${fail.length ? 'bad' : 'good'}">${d.rows.length - fail.length}/${d.rows.length}（${pctOf(d.rows.length - fail.length, d.rows.length)}%）</td><td class="${fail.length ? 'bad' : ''}">${esc(fail.map((r) => r.id).join(' ') || '—')}</td><td class="n">${esc(d.printed_at)}</td></tr>`;
}).join('')}</tbody></table>` : '<p class="bad">未找到任何 .tmp-check/assertions-*.json，校验卡尚未运行。</p>';

const inv = Object.entries(meta.styles).map(([k, m]) => `<tr><td>${esc(k)}</td><td class="n">${m.md_bytes}</td><td class="n">${m.lines}</td><td class="n">${m.art_max_cells}</td><td class="n">${m.ambiguous}</td><td class="n">${m.emoji}</td><td class="n">${m.cjk}</td><td class="n">${m.lanes.map((x) => `${x.done}/${x.total}`).join(' ')}</td></tr>`).join('');

// 浏览器卡读数（本机 Chrome 无头实测）。缺文件就如实说没跑，不编数字。
const bmeta = readJSON('.tmp-check/browser-meta.json');
const fontSection = !bmeta ? '<p class="bad">未找到 .tmp-check/browser-meta.json —— 浏览器卡未运行，字体口径为未验项。</p>' : (() => {
  const mono = bmeta.monoPx;
  const clsRows = Object.entries(bmeta.classes).flatMap(([k, cls]) => Object.entries(cls).map(([c, v]) => {
    const tight = Math.abs(v.fixed - v.target * mono) <= 0.03 * mono;
    return `<tr><td>${esc(k)}</td><td>${esc(c)}</td><td class="n">${(v.raw / mono).toFixed(3)}</td><td class="n">${v.target}</td><td class="n">${(v.fixed / mono).toFixed(3)}</td><td class="${tight ? 'good' : 'bad'}">${tight ? '已贴合' : '偏差'}</td></tr>`;
  }));
  const alRows = Object.entries(bmeta.align).map(([k, a]) => `<tr><td>${esc(k)}</td><td class="n">${a.critChars}</td><td class="n">${a.groups}</td><td class="n ${a.fixedSpreadPx <= 0.6 ? 'good' : 'bad'}">${a.fixedSpreadPx}px</td><td class="n ${a.rawSpreadPx >= 2 ? 'bad' : ''}">${a.rawSpreadPx}px</td><td>${a.hasScript ? '内联脚本 + span' : '无需校正（纯 ASCII）'}</td></tr>`).join('');
  const cjkRaw = bmeta.charPx.matrix['项'], emoRaw = bmeta.charPx.matrix['✅'];
  return `<p class="sub">技能说 "Assume monospace font (10 characters = 10 characters)"，但没说什么字体成立。本机 Chrome 无头实测（<code>${esc(bmeta.font)}</code> @ ${esc(bmeta.fontSize)}，等宽步进 ${mono}px）：
  条形与框线字符实测就是 1 列（BB2），而 CJK 只有 <b>${(cjkRaw / mono).toFixed(3)}</b> 列（恰好等于 1 个 font-size），emoji 是 <b>${(emoRaw / mono).toFixed(3)}</b> 列——「CJK=2 列」是 CJK locale 终端的性质，不是浏览器的性质（BB3/BB3b）。</p>
<p class="sub">预览层的处置：宽字符按类包 <code>&lt;span class="fx-*"&gt;</code>，页内内联脚本现量步进后用 <code>letter-spacing</code> 补回 cells() 的列数；不跑 JS 就退化成未校正原样，看板照样可读。下面两组数字都是 Chrome 量出来的：</p>
<table><thead><tr><th>风格</th><th>类</th><th class="n">校正前（列）</th><th class="n">目标（cells）</th><th class="n">校正后（列）</th><th>结论</th></tr></thead><tbody>${clsRows.join('')}</tbody></table>
<table><thead><tr><th>风格</th><th class="n">列临界字符</th><th class="n">同列组数</th><th class="n">校正后跨行跨度</th><th class="n">不校正跨行跨度</th><th>校正手段</th></tr></thead><tbody>${alRows}</tbody></table>
<p class="sub">「不校正」那一列是把交付 HTML 里的内联脚本删掉后重测的同一条判据（BB5）：矩阵风格 3 列分隔符跨行散开 <b>${bmeta.align.matrix.rawSpreadPx}px</b>、稠密风格盒线右边界散开 <b>${bmeta.align.dense.rawSpreadPx}px</b>，校正后都收回 1px 内；
  条形物理宽度 ${Object.entries(bmeta.barPx).map(([k, v]) => `${k}=${v}px`).join(' ')}，与 8×等宽步进（${(8 * mono).toFixed(2)}px）一致，说明校正没碰到条（BB6）。</p>`;
})();

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>三风格对照 · 前端 Skill 验证流水线进度看板</title>
<style>${CSS}</style></head><body><div class="wrap">
<h1>三风格对照 · ASCII 项目进度看板</h1>
<p class="sub">同一份事实源（facts.json，state_sha=${esc(f.ledger.state_sha1)} worklog_sha=${esc(f.ledger.worklog_sha1)}）驱动三种呈现；
本页所有数字由 scripts/index-page.mjs 现读现算。共 ${total.total} 项任务、完成 ${total.done}、阻塞 ${total.blocked}，整体 ${total.pct}%。</p>
<div class="grid">${styleCards}</div>
<h2>同构核对：三张表的泳道数字必须完全一致</h2>
<p class="sub">结论：<span class="${sameCheck.same ? 'good' : 'bad'}">${sameCheck.same ? '三份 .md 反解出的「泳道→done/total/pct」签名逐条相同（含合计行）' : '三份 .md 的泳道数字出现分歧（异常）'}</span>；口径样例 <code>${esc(sameCheck.sample)}</code></p>
${matrix}
<h2>校验卡读数</h2>
${cardTable}
<h2>字体实测（本机 Chrome 无头）</h2>
${fontSection}
<h2>逐风格清单</h2>
<table><thead><tr><th>风格</th><th class="n">md 字节</th><th class="n">行数</th><th class="n">版式最宽</th><th class="n">歧义宽度</th><th class="n">emoji</th><th class="n">CJK</th><th>各泳道 done/total</th></tr></thead><tbody>${inv}</tbody></table>
<h2>本轮规程进度（Sprint）</h2>
<table><thead><tr><th>步骤</th><th>说明</th><th>状态</th></tr></thead><tbody>
${f.sprint.groups[0].items.map((i) => `<tr><td>${esc(i.text)}</td><td>${esc(i.note || '')}</td><td class="${i.done ? 'good' : ''}">${i.done ? 'done' : 'todo'}</td></tr>`).join('')}
</tbody></table>
<footer>零依赖：无 <code>node_modules</code>；三份预览单文件自包含、双击即看，其中矩阵/稠密两份含一段内联字体度量校正脚本（无外链、无 src，禁用 JS 时退化为未校正原样）。<br>生成于 ${esc(new Date().toISOString())} · 事实源现读自 ${esc(f.round.id)} 的 facts.json · 断言读数 ${cards.map((c) => esc(`${c.k}:${c.d.rows.length}`)).join(' ') || '无'}</footer>
</div></body></html>
`;
writeFileSync(join(ROUND, 'preview', 'styles.html'), html);
console.log(`styles.html written: ${Buffer.byteLength(html)}B, cards=${cards.map((c) => `${c.k}:${c.d.rows.filter((r) => r.pass).length}/${c.d.rows.length}`).join(' ')} same=${sameCheck.same}`);
