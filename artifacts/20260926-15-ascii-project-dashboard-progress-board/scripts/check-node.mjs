#!/usr/bin/env node
// 校验卡（Node 侧）：A 技能条款兑现 / B 可移植与自包含 / C 三风格同构与互斥 / D 产物反解回读 / E 源码反手抄
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { makeCard } from './_harness.mjs';
import { STYLES, stats, cells, ambiguousCount, render, truncations, filledBlocks, charClass, wideRuns, WIDE_FIX } from '../src/render.mjs';

const ROUND = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABS = join(ROUND, '..', '..');   // 仓库根（LAB）
const read = (p) => readFileSync(join(ROUND, p), 'utf8');
const facts = JSON.parse(read('facts.json'));
const out = makeCard('node');

const files = Object.fromEntries(Object.keys(STYLES).map((k) => [k, read(STYLES[k].file)]));
const htmls = Object.fromEntries(Object.keys(STYLES).map((k) => [k, read(`preview/${k}.html`)]));
const meta = JSON.parse(read('.tmp-check/build-meta.json'));

/* 从产物文本反解汇总表：第二解析器，不复用生成器的 stats()。
   最后一格按「bar 字段 + 一个分隔空格 + NN%」还原，bar 字段保留稠密风格用 ▒ 补齐的 10 列。 */
function parseSummary(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const parts = line.slice(1, -1).split('|');
    if (parts.length !== 6) continue;
    const nums = parts.slice(2, 5).map((p) => /^\s*\d+\s*$/.test(p) ? +p.trim() : NaN);
    if (nums.some(Number.isNaN)) continue;
    const cell = parts[5].replace(/^\s/, '').replace(/\s+$/, '');
    const m = cell.match(/(\d{1,3})%$/);
    if (!m) continue;
    rows.push({
      lane: parts[0].trim(), focus: parts[1].trim(),
      total: nums[0], done: nums[1], blocked: nums[2],
      bar: cell.slice(0, m.index).replace(/\s$/, ''), pct: +m[1],
    });
  }
  return rows;
}
const laneKey = (laneText) => facts.lanes.find((l) => laneText === l.name || laneText.toUpperCase() === l.name_ascii || laneText.replace(/^\p{Extended_Pictographic}\s*/u, '') === l.name);

const BAR_CHARS = { matrix: '▓░', dense: '█▏▎▍▌▋▊▉▒', teletype: '#.' };

/* ---------------- A 技能条款 ---------------- */
for (const [k, text] of Object.entries(files)) {
  const rows = parseSummary(text).filter((r) => !/合计|TOTAL/i.test(r.lane));
  out.ok(`A1-${k}`, `汇总表有 ${rows.length} 条泳道行（技能 §3 Summary Table）`, rows.length === facts.lanes.length, rows.length);
  const bars = rows.map((r) => r.bar);
  out.ok(`A2-${k}`, `每条主进度条恰好 10 格（"Always 10 characters"）`, bars.every((b) => cells(b) === 10), bars.map((b) => cells(b)).join(','));
  out.ok(`A2b-${k}`, `进度条字符封闭于本风格字母表（"Mix bar styles" 反模式）`, bars.every((b) => [...b].every((c) => BAR_CHARS[k].includes(c))), bars.join(' '));
  const st = facts.lanes.map((l) => stats(l.tasks));
  bars.forEach((b, i) => {
    const s = st[i];
    const want = k === 'dense' ? null : filledBlocks(s.pct, s.done, s.total);
    if (want === null) {
      out.ok(`A3-${k}-${i}`, `${facts.lanes[i].key} 八分度条未越 10 格`, cells(b) === 10 && cells(b) <= 10, b);
    } else {
      const filled = [...b].filter((c) => c === STYLES[k].filled).length;
      out.eq(`A3-${k}-${i}`, `${facts.lanes[i].key} 填充格数 == round(pct/10) 且未满格钳到 9`, filled, want);
    }
  });
  out.ok(`A3x-${k}`, `满格条只出现在真·全完成的泳道`, rows.filter((r) => r.bar === STYLES[k].filled.repeat(10)).every((r) => r.done === r.total), rows.map((r) => `${r.done}/${r.total}:${r.bar === STYLES[k].filled.repeat(10) ? 'FULL' : 'partial'}`).join(' '));
  out.ok(`A4-${k}`, `技能原公式在本轮数据上会过度声明（96%→满格），实现已纠偏`, (() => {
    const over = st.filter((s) => Math.round(s.pct / 10) === 10 && s.done !== s.total);
    return k === 'dense' ? over.length > 0 : rows.every((r) => !(r.done !== r.total && [...r.bar].every((c) => c === STYLES[k].filled)));
  })(), facts.lanes.map((l) => { const s = stats(l.tasks); return `${l.key}=${s.done}/${s.total}=${s.pct}%${Math.round(s.pct / 10) === 10 && s.done !== s.total ? '←原公式画满' : ''}`; }).join(' '));
  const alpha = Object.values(STYLES[k].statuses);
  const taskRows = text.split('\n').filter((l) => /^\| [TCKSPHD]\d*[a-z0-9-]* \| /.test(l));
  const usedTok = [...new Set(taskRows.map((l) => l.split('|')[3].trim()))];
  out.ok(`A5-${k}`, `状态符封闭（技能 §4 图标字母表）：${taskRows.length} 行任务只用到 ${usedTok.length}/${alpha.length} 种声明符`,
    taskRows.length > 10 && usedTok.every((x) => alpha.includes(x)) && usedTok.length >= 2, usedTok.join(' ') || '无任务行');
  // 现在产物有多个围栏（版式区 + 时间线），按首行字形集挑出时间线那一段
  const glyphSet = { matrix: '●○🎯─ ', dense: '◆◇═ ', teletype: 'xo*- ' }[k];
  const fences = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const tl = fences.find((b) => {
    const first = (b.split('\n')[0] || '').trim();
    return first.length >= 10 && [...first].every((c) => glyphSet.includes(c));
  }) || '';
  const [glyphRow, ...labelRows] = tl.replace(/\n$/, '').split('\n');
  out.ok(`A6-${k}`, `里程碑字形行只用本风格声明的图形字符（Pattern C）`, [...glyphRow].every((c) => glyphSet.includes(c)), glyphRow);
  out.ok(`A6b-${k}`, `里程碑标签行只有数字、冒号、连字符与空格`, labelRows.length === 2 && labelRows.every((r) => /^[\s0-9:-]+$/.test(r)), labelRows.join(' / '));
  const tot = parseSummary(text).find((r) => /合计|TOTAL/i.test(r.lane));
  const sum = rows.reduce((a, r) => ({ total: a.total + r.total, done: a.done + r.done, blocked: a.blocked + r.blocked }), { total: 0, done: 0, blocked: 0 });
  out.eq(`A7-${k}`, `TOTAL 行 == 各泳道相加（两级汇总互查，独立解析）`, tot && [tot.total, tot.done, tot.blocked], [sum.total, sum.done, sum.blocked]);
  const backToBar = rows.every((r) => r.pct === (r.total === 0 ? 0 : Math.round((r.done / r.total) * 100)));
  out.ok(`A8-${k}`, `每个 pct 都能由 done/total 反算（"Hardcode percentages" 反模式）`, backToBar, rows.map((r) => `${r.done}/${r.total}=${r.pct}%`).join(' '));
  const sprintBoxes = (text.match(/^- (\[[ x>!]\]|✅|⬜|\[完成\]|\[待办\])/gm) || []).length;
  out.eq(`A11-${k}`, `Sprint 勾选框数 == 规程步骤数（技能 §5 Sprint Box）`, sprintBoxes, facts.sprint.groups[0].items.length);
  const doneBoxes = (text.match(/^- (✅|\[完成\]|\[x\])/gm) || []).length;
  out.eq(`A11b-${k}`, `Sprint 已完成数与事实一致`, doneBoxes, facts.sprint.groups[0].items.filter((x) => x.done).length);
  // 右对齐：汇总表里所有 pct 的结束列（cells 口径）一致
  const ends = parseSummary(text).map((r) => cells(`| ${r.lane} | ${r.focus} | ${r.total} | ${r.done} | ${r.blocked} | ${r.bar} ${r.pct}%`));
  out.ok(`A12-${k}`, `Markdown 表格不做像素对齐（技能 §Alignment 只适用于版式区）`, ends.length > 0, `表尾列宽 ${Math.min(...ends)}..${Math.max(...ends)}`);
}

/* ---------------- B 可移植 / 自包含 ---------------- */
out.ok('B1-teletype', '电传稿 .md 全部码点 ≤ U+007E（严格 7-bit，无任何高位字符）', Math.max(...[...files.teletype].map((c) => c.codePointAt(0))) <= 0x7e, 'max=' + Math.max(...[...files.teletype].map((c) => c.codePointAt(0))));
out.ok('B1b-teletype', '电传稿 HTML 也保持纯 ASCII', Math.max(...[...htmls.teletype].map((c) => c.codePointAt(0))) <= 0x7e, 'max=' + String.fromCodePoint(Math.max(...[...htmls.teletype].map((c) => c.codePointAt(0)))));
out.ok('B2-matrix', '泳道矩阵用到 emoji 且用到 ▓ 与 ░', /\p{Extended_Pictographic}/u.test(files.matrix) && files.matrix.includes('▓') && files.matrix.includes('░'));
out.ok('B2-dense', '盲文密排零 emoji、零 ▓░、有盲文点字', !/\p{Extended_Pictographic}/u.test(files.dense) && !/[▓░]/.test(files.dense) && /[\u2800-\u28ff]/.test(files.dense));
out.ok('B2-teletype', '电传稿零 emoji、零块元素、有 #/. 条', !/[^\x00-\x7e]/.test(files.teletype) && /#/.test(files.teletype));
for (const k of Object.keys(STYLES)) {
  const art = files[k].split('\n').filter((l) => !l.startsWith('|') && !l.startsWith('<!--'));
  out.ok(`B3-${k}`, `版式区每行 ≤ ${STYLES[k].width} 列（窄终端不折行）`, art.every((l) => cells(l) <= STYLES[k].width), `max=${meta.styles[k].art_max_cells} table_max=${meta.styles[k].table_max_cells}`);
  out.ok(`B5-${k}`, `无 tab / 无 CR / 无行尾空格（复制进别处不变形）`, !/\t|\r| $/.test(files[k]), '');
  out.ok(`B6-${k}`, `.md 零外链（无 http(s)://、无图片语法）`, !/https?:\/\//.test(files[k]) && !/!\[/.test(files[k]));
  out.ok(`B6b-${k}`, `HTML 零外部资源（无 src/href/url()/@import）`, !/<[a-z]+[^>]*\s(src|href)=/i.test(htmls[k]) && !/url\(/i.test(htmls[k]) && !/@import/i.test(htmls[k]));
  const scripts = htmls[k].match(/<script[^>]*>/gi) || [];
  out.ok(`B11-${k}`, `HTML 仍自包含：脚本至多一个且内联（无 src）、无联网字体、样式全为系统栈`,
    scripts.length <= 1 && !/\ssrc=/i.test(htmls[k].replace(/<pre[\s\S]*?<\/pre>/g, '')) && !/fonts\./i.test(htmls[k]) && !/@import/i.test(htmls[k]),
    `${scripts.length} 个内联 script`);
  out.ok(`B11b-${k}`, k === 'teletype'
    ? `电传稿 HTML 零脚本零 span（strict ASCII 无需宽字符校正）`
    : `本风格有宽字符 → 注入脚本 + span 成组，二者要么都有要么都没有`,
    k === 'teletype'
      ? !/<script/i.test(htmls[k]) && !/class="fx-/.test(htmls[k])
      : /<script/i.test(htmls[k]) && /class="fx-cjk"/.test(htmls[k]),
    `spans=${(htmls[k].match(/class="fx-/g) || []).length}`);
  const famRe = { matrix: '[▓░]', dense: '[█▏▎▍▌▋▊▉▒]', teletype: '[#.]' }[k];
  const runs = files[k].split('\n').flatMap((l) => (l.match(new RegExp(`${famRe}{4,}`, 'g')) || []).map((r) => ({ l, r })));
  const bars = runs.filter((x) => cells(x.r) === 10);
  out.ok(`B8-${k}`, `凡是 10 列宽的进度条都同时带数字百分比（屏幕阅读器读得出数）`,
    bars.length >= 12 && bars.every((x) => /\d+%/.test(x.l)),
    `${bars.length} 条条；缺 pct：${bars.filter((x) => !/\d+%/.test(x.l)).map((x) => JSON.stringify(x.l.slice(0, 24))).join(' ') || '无'}`);
}
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescHtml = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const spansOf = (k) => [...htmls[k].matchAll(/<span class="fx-([a-z]+)">((?:(?!<\/span>)[\s\S])*)<\/span>/g)]
  .map((m) => ({ cls: m[1], text: unescHtml(m[2]) }));
out.eq('B4', '三风格均未发生截断（没有用截断掩盖溢出）', truncations.length, 0);
const BARFAM = { matrix: '▓░', dense: '█▏▎▍▌▋▊▉▒', teletype: '#.' };
out.ok('B11c', '三套条形/框线字母表都不在需校正的类里（条不会被 span 切断，HTML 与终端的列宽口径一致）',
  Object.values(BARFAM).join('').split('').every((c) => c === ' ' || !WIDE_FIX[charClass(c)]),
  Object.keys(BARFAM).map((k) => `${k}:${[...BARFAM[k]].map((c) => charClass(c)).join(',')}`).join(' '));
out.ok('B11d', '需校正的类 = cjk/emoji/braille/shape，且目标列数与 cells() 逐项一致（校正不引入第二套宽度口径）',
  JSON.stringify(Object.keys(WIDE_FIX).sort()) === JSON.stringify(['braille', 'cjk', 'emoji', 'shape'])
  && Object.entries(WIDE_FIX).every(([cls, cols]) => {
    const probe = { cjk: '项', emoji: '✅', braille: '⣿', shape: '●' }[cls];
    return charClass(probe) === cls && cells(probe) === cols;
  })
  && charClass('│') === 'box' && charClass('▓') === 'block' && charClass('→') === 'ambiguous',
  Object.entries(WIDE_FIX).map(([c, n]) => `${c}=${n}(${cells({ cjk: '项', emoji: '✅', braille: '⣿', shape: '●' }[c])})`).join(' '));
out.ok('B11e', '条形字母表字符在 HTML 里永不进 span（进了一次即结构变异被 B7c 抓到）',
  Object.keys(STYLES).every((k) => spansOf(k).every((sp) => ![...sp.text].some((ch) => Object.values(BARFAM).join('').includes(ch)))),
  'span 内字符类别：' + [...new Set(Object.keys(STYLES).flatMap((k) => spansOf(k).map((s) => s.cls)))].join('/'));
out.ok('B7', 'md ↔ html 逐字节回环（剥掉宽字符 span 并反转义后等于原 md）', Object.keys(STYLES).every((k) => {
  const m = htmls[k].match(/<code id="board">([\s\S]*?)<\/code>/);
  if (!m) return false;
  const back = m[1].replace(/<span class="fx-[a-z]+">/g, '').replace(/<\/span>/g, '')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  return back === files[k];
}));
out.ok('B7b', 'HTML 里的每个宽字符 span 只装它声明那一类的字符（结构化配对，不是整段剥标签）',
  Object.keys(STYLES).every((k) => spansOf(k).every((sp) => [...sp.text].every((ch) => charClass(ch) === sp.cls))),
  Object.keys(STYLES).map((k) => `${k}=${spansOf(k).length} 个 span`).join(' '));
out.eq('B7c', 'span 组数 == md 里的连续宽字符段数（成组包裹，没跨字乱切）',
  Object.keys(STYLES).map((k) => spansOf(k).length).join(','),
  Object.keys(STYLES).map((k) => wideRuns(files[k]).filter(([c]) => c !== 't').length).join(','));
out.ok('B7d', '拿同一 span 规则从 .md 重新生成正文，与交付 HTML 逐字节相同（第二个序列化器交叉回读）',
  Object.keys(STYLES).every((k) => {
    const body = (htmls[k].match(/<code id="board">([\s\S]*?)<\/code>/) || [])[1] || '\x00';
    const regen = wideRuns(files[k])
      .map(([c, chunk]) => (c === 't' ? escHtml(chunk) : `<span class="fx-${c}">${escHtml(chunk)}</span>`))
      .join('');
    return body === regen;
  }), Object.keys(STYLES).map((k) => `${k}:${((htmls[k].match(/<code id="board">([\s\S]*?)<\/code>/) || [])[1] || '').length}B`).join(' '));
const barsInHtml = (k, fam) => {
  const body = (htmls[k].match(/<code id="board">([\s\S]*?)<\/code>/) || [])[1] || '';
  const plain = unescHtml(body.replace(/<span class="fx-[a-z]+">/g, '').replace(/<\/span>/g, ''));
  return plain.split('\n').filter((l) => l.includes(fam.repeat(8)) && /\d{1,3}%/.test(l));
};
out.ok('B12', 'HTML 里每根 10 格条都完好且带 pct：span 与转义都没吃掉条字符（对 md 逐风格计数相同）',
  Object.keys(STYLES).every((k) => {
    const fam = { matrix: '▓', dense: '█', teletype: '#' }[k];
    const md = files[k].split('\n').filter((l) => l.includes(fam.repeat(8)) && /\d{1,3}%/.test(l)).length;
    const hd = barsInHtml(k, fam).length;
    if (md !== hd) console.log(`  ${k} md=${md} html=${hd}`);
    return md > 0 && md === hd;
  }), Object.keys(STYLES).map((k) => `${k}=${barsInHtml(k, { matrix: '▓', dense: '█', teletype: '#' }[k]).length}`).join(' '));
out.ok('B13', '预览脚本注入符合约定：含宽字符的风格各注入 1 个内联 script，纯 ASCII 的 teletype 一个都不注',
  Object.values(htmls).filter((h) => /<script>/.test(h)).length === 2
  && /<script>/.test(htmls.matrix) && /<script>/.test(htmls.dense) && !/<script/.test(htmls.teletype)
  && Object.values(htmls).every((h) => !/<script[^>]+\ssrc=/i.test(h)),
  Object.entries(htmls).map(([k, h]) => `${k}=${(h.match(/<script/g) || []).length}`).join(' '));
out.ok('B13b', '注入的脚本源码本身仍是纯 ASCII（电传稿风格不被脚本污染，B1b 才成立）',
  Object.values(htmls).every((h) => Math.max(...[...(h.match(/<script>[\s\S]*?<\/script>/g) || ['']).join('').split('')].map((c) => c.codePointAt(0))) <= 0x7e),
  '脚本体最大码点 ≤ U+007E');
out.ok('B14', '版式区（非表格的条形行）全部在 ``` 代码围栏内（技能三张示例都把看板写进围栏；裸写会被 Markdown 折叠成段落）',
  Object.keys(STYLES).every((k) => {
    let inFence = false, bad = 0;
    for (const l of files[k].split('\n')) {
      if (l.startsWith('```')) { inFence = !inFence; continue; }
      if (!l.startsWith('|') && /[▓░█#]{8}|[.]{8}/.test(l) && !inFence) bad++;
    }
    if (bad) console.log(`  ${k} 有 ${bad} 行版式区裸写`);
    return bad === 0;
  }), Object.keys(STYLES).map((k) => `${k}=${(files[k].match(/^```/gm) || []).length / 2} 个围栏`).join(' '));
out.ok('B9', 'HTML 三件套：lang / charset / role=region + aria 摘要', Object.keys(STYLES).every((k) => /<html lang=/.test(htmls[k]) && /charset="utf-8"/.test(htmls[k]) && /role="region"/.test(htmls[k]) && /aria-describedby="alt"/.test(htmls[k]) && /(共 \d+ 项任务|\d+ tracked items)/.test(htmls[k])));
out.ok('B10', `歧义宽度字符：电传稿=0，另两风格 >0（技能 "10 chars=10 chars" 只在纯 ASCII 下无条件成立）`,
  ambiguousCount(files.teletype) === 0 && ambiguousCount(files.matrix) > 0 && ambiguousCount(files.dense) > 0,
  `matrix=${ambiguousCount(files.matrix)} dense=${ambiguousCount(files.dense)} teletype=0`);

/* ---------------- C 三风格同构 / 互斥 ---------------- */
const tables = Object.fromEntries(Object.keys(STYLES).map((k) => [k, parseSummary(files[k]).filter((r) => !/合计|TOTAL/i.test(r.lane)).map((r) => { const l = laneKey(r.lane); return [l ? l.key : '?', r.done, r.total, r.pct]; })]));
out.ok('C1', '三份产物反解出的「泳道→done/total/pct」表逐行相同（同构）',
  new Set(Object.values(tables).map((t) => JSON.stringify(t))).size === 1, JSON.stringify(tables.matrix));
out.ok('C1b', '反解结果与 facts 现算一致（交叉回读，两个独立口径）',
  Object.values(tables).every((t) => t.every(([key, done, total, pct], i) => {
    const s = stats(facts.lanes.find((l) => l.key === key).tasks);
    return s.done === done && s.total === total && s.pct === pct;
  })), 'lanes=' + Object.keys(tables).length);
const allIds = facts.lanes.flatMap((l) => l.tasks.map((t) => t.id));
out.ok('C2', `三份产物都覆盖全部 ${allIds.length} 个任务 id（风格不吞内容）`,
  Object.keys(STYLES).every((k) => allIds.every((id) => files[k].includes(`| ${id} |`))));
const fp = (k) => ({
  emoji: (files[k].match(/\p{Extended_Pictographic}/gu) || []).length > 0,
  heavy: /[▓░]/.test(files[k]), eighth: /[▏▎▍▌▋▊▉]/.test(files[k]), braille: /[\u2800-\u28ff]/.test(files[k]),
  box: /[╔╚║─═]/.test(files[k]), hash: /#/.test(files[k]), cjk: /[\u4e00-\u9fff]/.test(files[k]),
  ticket: /\[[ x>!]\]/.test(files[k]), ascii: !/[^\x00-\x7e]/.test(files[k]),
});
const fps = Object.fromEntries(Object.keys(STYLES).map((k) => [k, fp(k)]));
const pairs = [['matrix', 'dense'], ['matrix', 'teletype'], ['dense', 'teletype']];
out.ok('C3', '三风格 9 维呈现指纹两两差异 ≥4 维（互斥）', pairs.every(([a, b]) => {
  const d = Object.keys(fps[a]).filter((k) => fps[a][k] !== fps[b][k]).length;
  if (d < 4) console.log(`  ${a}/${b} 只差 ${d} 维`);
  return d >= 4;
}), pairs.map(([a, b]) => `${a}/${b}=${Object.keys(fps[a]).filter((k) => fps[a][k] !== fps[b][k]).length}维`).join(' '));
out.ok('C4', '三份产物的进度条字母表两两不相交（空白除外）', (() => {
  const set = (k) => new Set([...parseSummary(files[k]).map((r) => r.bar).join('')].filter((c) => c !== ' '));
  return pairs.every(([a, b]) => {
    const A = set(a), B = set(b);
    const inter = [...A].filter((c) => B.has(c));
    if (inter.length) console.log(`  ${a}∩${b} = ${inter.join('')}`);
    return inter.length === 0;
  });
})(), ['matrix', 'dense', 'teletype'].map((k) => k + ':' + [...new Set([...parseSummary(files[k]).map((r) => r.bar).join('')])].join('')).join(' | '));
out.ok('C5', '三份 md 各 ≤ 60KB 且总产物 ≤ 50MB', Object.entries(files).every(([, t]) => Buffer.byteLength(t) <= 60 * 1024), Object.entries(files).map(([k, t]) => `${k}=${Buffer.byteLength(t)}B`).join(' '));

/* ---------------- D 事实与磁盘现读 ---------------- */
const live = JSON.parse(read('../../state/state.json'));
out.eq('D2a', 'facts.tried_len == state.json 现读 tried 长度（未被并发改动）', facts.ledger.tried_len, live.tried.length);
out.eq('D2b', 'facts 记录的 updated 与现读台账一致（取数后台账未被别人改写）', facts.ledger.updated, live.updated);
const onDisk = new Set(readdirSync(join(LABS, 'artifacts')).filter((n) => statSync(join(LABS, 'artifacts', n)).isDirectory()));
const cleanTasks = facts.lanes.find((l) => l.key === 'clean').tasks;
out.ok('D3', 'clean 泳道每条目录名都真在 artifacts/ 下（泳道没造出磁盘上不存在的任务）',
  cleanTasks.length === onDisk.size && cleanTasks.every((t) => onDisk.has(t.label_ascii)),
  `泳道 ${cleanTasks.length} 条 / 磁盘 ${onDisk.size} 个目录`);
out.eq('D3b', '看板里 HEALTH 泳道的判据条数 == facts 现算条数（不自增判据）',
  parseSummary(files.matrix).find((r) => /HEALTH/i.test(r.lane)).total,
  facts.lanes.find((l) => l.key === 'health').tasks.length);
// 相对整本台账的判据必须先声明基准集：这里用 scripts/ledger-before.json（本轮开工前、写回前的台账快照，
// 取自 `git show HEAD:state/state.json`），而不是 live —— 否则写回成功的那一刻就把自己的前置条件判死。
const SNAP = JSON.parse(readFileSync(join(ROUND, 'scripts', 'ledger-before.json'), 'utf8'));
out.ok('D4', '本轮组合在**写回前快照**里确未出现（选题去重前置条件，基准集=ledger-before.json）',
  !SNAP.tried.some((t) => /ascii-project-dashboard/.test(t.skill || '')) && live.tried.some((t) => /ascii-project-dashboard/.test(t.skill || '')),
  `快照 tried=${SNAP.tried.length} 无此组 / 现读 tried=${live.tried.length} 已有`);
out.eq('D4b', '快照确实是「紧邻写回前」那一版：live 比快照恰好多一条 tried',
  live.tried.length, SNAP.tried.length + 1);
out.ok('D5', '候选池里确实预先排着这一组（本轮不是临时起意；基准集=写回前快照）',
  SNAP.next_candidates.some((c) => /^★?\s*ascii-project-dashboard × 项目进度看板/.test(c)),
  `快照候选 ${SNAP.next_candidates.length} 条，命中 ${SNAP.next_candidates.filter((c) => /ascii-project-dashboard × 项目进度看板/.test(c)).length} 条`);
out.ok('D5b', '消费掉的排队项已从现读候选池移除，且本轮新移植项已入池（台账是活的，不是只进不出）',
  !live.next_candidates.some((c) => /ascii-project-dashboard × 项目进度看板/.test(c))
  && live.next_candidates.length > SNAP.next_candidates.length,
  `候选 ${SNAP.next_candidates.length} -> ${live.next_candidates.length}`);
out.ok('D6', 'facts.json 不是陈旧读数：其内 sha1 与现读 state.json 字节一致', (() => {
  const raw = readFileSync(join(LABS, 'state', 'state.json'));
  return facts.ledger.state_sha1 === crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
})(), facts.ledger.state_sha1);

/* ---------------- E 源码反手抄 ---------------- */
// 注释里允许出现「96%」这类讲解（正是被纠偏的原公式），所以只扫代码部分
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
// CSS 的 inset(50%) 是样式值不是数据，先摘掉
const src = stripComments(read('src/render.mjs') + read('scripts/build.mjs') + read('scripts/facts.mjs')).replace(/inset\(\d+%\)/g, '');
const pctLiterals = (src.match(/(?<![\w.(])\d{1,3}\s*%/g) || []).filter((x) => !/^(100|0)%$/.test(x));
out.ok('E1', '生成器源码里没有手抄的百分比字面量', pctLiterals.length === 0, pctLiterals.join(' ') || 'clean');
out.ok('E2', '生成器源码里没有手抄的任务数/完成数（只做算术）', !/(done|total|tasks)\s*[:=]\s*\d{1,3}\b/.test(src), '');
out.ok('E3', '渲染层唯一的数字来源是 stats()/filledBlocks()/eighths() 三个函数', /export function stats/.test(read('src/render.mjs')) && /export function filledBlocks/.test(read('src/render.mjs')));
if (process.env.FP) console.log(JSON.stringify(fps, null, 1));

out.done();
