// ASCII Project Dashboard · 三实验室无人值守流水线看板
// 复现： node render-dashboard.js   → dashboard.txt（按终端显示宽度补位）+ dashboard-naive.txt（按 JS 码点数补位，技能原文口径）
// 零依赖，只读三个实验室的 state/state.json，所有百分比由 done/total 现场计算
const fs = require('fs');
const path = require('path');
const ROOT = '/Users/apple/Documents/workProject/试验';
const LABS = ['前端skill实验室', '业务网站实验室', 'skill演示场'];
const HERE = __dirname;

const WIDE = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f000, 0x1faff],
  [0x2600, 0x27bf], [0x2b00, 0x2bff]];
const dwidth = s => [...s].reduce((w, ch) => {
  const cp = ch.codePointAt(0);
  if (cp === 0xfe0f || cp === 0x200d) return w;
  return w + (WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1);
}, 0);
const cwidth = s => s.length; // UTF-16 码单元数：技能原文「10 chars = 10 chars」的口径
let MEASURE = dwidth;
const pad = (s, col) => s + ' '.repeat(Math.max(0, col - MEASURE(s)));
const rpad = (s, col) => ' '.repeat(Math.max(0, col - MEASURE(s))) + s;

const states = LABS.map(name => ({ name, j: JSON.parse(fs.readFileSync(path.join(ROOT, name, 'state/state.json'), 'utf8')) }));
const runs = states.flatMap(({ name, j }) => (j.runs || []).map(r => ({ lab: name, ...r })));
const seen = states.flatMap(({ j }) => j.skills_seen || []);
const tried = [...new Set(states.flatMap(({ j }) => (j.tried || []).map(t => t.skill)))];
const cands = [...new Set(states.flatMap(({ j }) => (j.next_candidates || []).map(String)))];

const calc = (d, t) => {
  const percentage = Math.round((d / t) * 100);
  const blocks = Math.round(percentage / 10);
  return { d, t, percentage, bar: '▓'.repeat(blocks) + '░'.repeat(10 - blocks) };
};
const settled = s => /installed_used|blocked|needs_user_confirm|unreachable/.test(s.status);
const laneData = () => [
  { icon: '📥', name: 'DISCOVER', scope: '来源已定性/来源条目', ...calc(seen.filter(settled).length, seen.length) },
  { icon: '🏗', name: 'BUILD', scope: '成功轮次/总轮次', ...calc(runs.filter(r => r.result === 'success').length, runs.length) },
  { icon: '🧹', name: 'CLEANUP', scope: '清理留痕/总轮次', ...calc(runs.filter(r => r.cleanup).length, runs.length) },
  { icon: '🚀', name: 'DELIVER', scope: '推送留痕/总轮次', ...calc(runs.filter(r => r.push).length, runs.length) },
];

const COL = 22, CELL = COL - 1, INDENT = '  ';
const stamp = t => (t.match(/T\d{2}:\d{2}/) || ['', 'T??:??'])[0].slice(1) || '??';
const shortLab = n => n.replace('实验室', '').replace('skill', '');

// 布局每次按当前 MEASURE 重建（否则切换口径不生效）
const build = () => {
  const L = laneData();
  const totD = L.reduce((s, l) => s + l.d, 0), totT = L.reduce((s, l) => s + l.t, 0);
  const tot = calc(totD, totT);
  const rowA = cells => (INDENT + cells.map(c => pad(c, CELL)).join(' ')).replace(/\s+$/, '');
  const A = [
    rowA(L.map(l => `${l.icon} ${l.name}`)),
    rowA(L.map(l => l.scope)),
    INDENT + L.map(() => '─'.repeat(CELL)).join(' ').replace(/\s+$/, ''),
    rowA(L.map(l => `${l.bar} ${l.percentage}%`)),
  ];
  const B = L.map(l => `${l.icon} ${pad(l.name, 9)}${l.bar} ${rpad(l.percentage + '%', 4)}`);
  const C = [
    runs.map((r, i) => (i ? '────' : '') + `${stamp(r.time)} ${r.result === 'success' ? '●' : '○'}`).join('') + '────○',
    '图例: ' + LABS.map(n => shortLab(n) + '×' + runs.filter(r => r.lab === n).length).join(' · ') + '  (●=成功轮次)'
  ];
  const rows = [['Lane', 'Focus', 'Tasks', 'Done', 'Progress'],
    ...L.map(l => [`${l.icon} ${l.name}`, l.scope, String(l.t), String(l.d), `${l.bar} ${l.percentage}%`]),
    ['TOTAL', 'All lanes', String(totT), String(totD), `${tot.bar} ${tot.percentage}%`]];
  const W = rows[0].map((_, i) => Math.max(...rows.map(r => MEASURE(r[i]))));
  const hr = ch => '+' + W.map(w => ch.repeat(w + 2)).join('+') + '+';
  const body = r => '|' + r.map((c, k) => ' ' + pad(c, W[k]) + ' ').join('|') + '|';
  const box = [hr('-'), body(rows[0]), hr('='), ...rows.slice(1).map(body), hr('-')];
  const back = [['| Lab | Skill | Result | Clean | Push |', '| --- | ----- | ------ | ----- | ---- |',
    ...runs.map(r => `| ${shortLab(r.lab)} | ${r.skill || '(未选定)'} | ${r.result === 'success' ? '✅' : '🚫'} | ${r.cleanup ? '✅' : '⬜'} | ${r.push ? '✅' : '⬜'} |`)]];
  return { L, A, B, C, box, back: back[0], tot };
};

const render = () => {
  const { L, A, B, C, box, back, tot } = build();
  return [
    'ASCII PROJECT DASHBOARD · 无人值守 Skill 验证流水线（三实验室合计）',
    `generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `来源: 各实验室 state/state.json（只读）· 已试技能 ${tried.length} · 候选池 ${cands.length} · 已跑轮次 ${runs.length} · 来源条目 ${seen.length}`,
    '',
    '### Pattern A — Horizontal Lanes (宽屏)',
    '```', ...A, '```',
    '',
    '### Pattern B — Vertical Lanes (窄终端 <=40 列)',
    '```', ...B, '```',
    '',
    '### Pattern C — Milestone Timeline (已跑轮次，○=下一轮)',
    '```', ...C, '```',
    '',
    '### Summary',
    '```', ...box, '```',
    '',
    '### Task Backlog — 跨实验室轮次留痕',
    ...back,
    '',
    `TOTAL ${tot.d}/${tot.t} = ${tot.percentage}%`,
    '注: pct = round(done/total*100)，bar = ▓×round(pct/10) + ░×余量，全部由本脚本现场算出；',
    '    列对齐按终端显示宽度补位（CJK 与 emoji 记 2 列），不是 JS 字符串长度。',
    '',
  ].join('\n');
};

MEASURE = cwidth;
fs.writeFileSync(path.join(HERE, 'dashboard-naive.txt'), render());
MEASURE = dwidth;
fs.writeFileSync(path.join(HERE, 'dashboard.txt'), render());

const L = laneData();
console.log('written: dashboard.txt (display-width) + dashboard-naive.txt (code-point)');
L.forEach(l => console.log(`  ${l.name}: ${l.d}/${l.t} -> ${l.percentage}% ${l.bar}`));
