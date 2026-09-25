// 独立复核：不复用渲染脚本的补位逻辑，自己实现显示宽度，并从三个 state.json 反算百分比
const fs = require('fs');
const path = require('path');
const WIDE = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f000, 0x1faff],
  [0x2600, 0x27bf], [0x2b00, 0x2bff]];
const width = s => [...s].reduce((w, ch) => {
  const cp = ch.codePointAt(0);
  if (cp === 0xfe0f || cp === 0x200d) return w;
  return w + (WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1);
}, 0);
const charAtCol = (row, target) => {
  let col = 0;
  for (const ch of row) {
    if (col === target) return ch;
    const cp = ch.codePointAt(0);
    col += (cp === 0xfe0f || cp === 0x200d) ? 0 : (WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1);
  }
  return '';
};
const file = process.argv[2] || 'dashboard.txt';
const lines = fs.readFileSync(file, 'utf8').split('\n');
const sec = t => lines.findIndex(l => l.includes(t));
const block = start => {
  let i = start + 1;
  while (lines[i] !== undefined && lines[i] !== '```' && !lines[i].startsWith('|')) i++;
  if (lines[i] === undefined) return [];
  if (lines[i].startsWith('|')) { const out = []; for (let k = i; k < lines.length && lines[k].startsWith('|'); k++) out.push(lines[k]); return out; }
  const out = [];
  for (let k = i + 1; k < lines.length && lines[k] !== '```'; k++) out.push(lines[k]);
  return out;
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const A = block(sec('Pattern A'));
const rule = A.find(l => l.includes('\u2500')) || '';
const laneCols = [];
{
  let col = 0, run = false, runStart = 0;
  for (const ch of rule) {
    const w = width(ch);
    if (ch === '\u2500') { if (!run) { run = true; runStart = col; } }
    else { if (run) { laneCols.push(runStart); run = false; } }
    col += w;
  }
  if (run) laneCols.push(runStart);
}
const contentRows = A.filter(l => !l.includes('\u2500'));
const misplaced = [];
contentRows.forEach((row, r) => laneCols.forEach((c, k) => {
  const ch = charAtCol(row, c);
  if (!ch || ch === ' ') misplaced.push(`row${r} lane${k} @col${c} got="${ch}"`);
}));
ok(`Pattern A ${contentRows.length} 行 x ${laneCols.length} 泳道列首对齐（分隔线段起点 ${laneCols.join('/')}）`,
  laneCols.length === 4 && misplaced.length === 0, misplaced.join(' ; ') || 'all hit');
const bars = A.join(' ').match(/[░▓]{2,}/g) || [];
ok('进度条恒为 10 格（规范 Always 10 characters）', bars.length === 4 && bars.every(b => b.length === 10), bars.join(' '));
ok('未混用其它条形字符（Anti-Pattern: Mix bar styles）', !/[█▉▊■]/.test(lines.join('')));
const B = block(sec('Pattern B'));
ok('Pattern B 行数=泳道数且 <=40 列（窄终端可读）', B.length === 4 && Math.max(...B.map(width)) <= 40, `max=${Math.max(...B.map(width))}`);
const pctA = (A[A.length - 1].match(/(\d+)%/g) || []).map(s => s.slice(0, -1)).join(',');
const pctB = B.map(l => (l.match(/(\d+)%/) || [])[1]).join(',');
ok('A/B 两版式百分比一致', pctA === pctB && !!pctA, `${pctA} vs ${pctB}`);
const box = block(sec('Summary'));
const boxW = [...new Set(box.map(width))];
ok('汇总框每行显示宽度一致（框线闭合）', boxW.length === 1, 'widths=' + boxW.join(','));
const C = block(sec('Pattern C'));
ok('时间线仅用规范符号 ● ○ ─', /^[●○─\d: ]+$/.test(C[0]), C[0]);
const backlog = block(sec('Task Backlog')).filter(l => l.startsWith('|') && !l.includes('---') && !/\| Lab \|/.test(l));
ok('Backlog 每轮留痕图标限定 ✅/🔄/⬜/🚫', backlog.length > 0 && backlog.every(l => /[✅🔄⬜🚫]/.test(l)), `${backlog.length} 行`);
const ROOT = '/Users/apple/Documents/workProject/试验';
const states = ['前端skill实验室', '业务网站实验室', 'skill演示场']
  .map(n => JSON.parse(fs.readFileSync(path.join(ROOT, n, 'state/state.json'), 'utf8')));
const runs = states.flatMap(j => j.runs || []);
const seen = states.flatMap(j => j.skills_seen || []);
const settled = s => /installed_used|blocked|needs_user_confirm|unreachable/.test(s.status);
const exp = [
  Math.round(seen.filter(settled).length / seen.length * 100),
  Math.round(runs.filter(r => r.result === 'success').length / runs.length * 100),
  Math.round(runs.filter(r => r.cleanup).length / runs.length * 100),
  Math.round(runs.filter(r => r.push).length / runs.length * 100),
].join(',');
ok('产物百分比 == 独立反算值（未硬编码）', pctA === exp, `artifact=${pctA} recomputed=${exp}`);
const maxw = Math.max(...lines.map(width));
ok('全文 <=100 列（宽终端一屏读完）', maxw <= 100, `max=${maxw}`);
console.log(`\n${file}: ${pass} PASS / ${fail} FAIL · lines=${lines.length}`);
process.exit(fail ? 1 : 0);
