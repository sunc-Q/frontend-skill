#!/usr/bin/env node
// 渲染层：三套风格共用同一份 facts.json，只换呈现。本文件里不允许出现任何任务数/百分比字面量。
/* ---------- 显示宽度模型（技能只说 "10 chars = 10 chars"，这里把它显式化并单独测它） ---------- */
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x2600, 0x27bf], [0x1f000, 0x1f0ff], [0x20000, 0x3fffd],
];
// 窄终端算 1 列、CJK locale 算 2 列的「歧义宽度」字符：技能的排版建议对它们沉默
const AMBIGUOUS = [
  [0x2190, 0x21ff], [0x2500, 0x257f], [0x25a0, 0x25ff], [0x2800, 0x28ff], [0x2b00, 0x2bff], [0xfffd, 0xfffd],
];
const ZERO = new Set([0xfe0f, 0x200d]);
const inRanges = (cp, rs) => rs.some(([a, b]) => cp >= a && cp <= b);

export function cells(s) {
  let n = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (ZERO.has(cp)) continue;
    n += inRanges(cp, WIDE) ? 2 : 1;
  }
  return n;
}
export function ambiguousCount(s) {
  let n = 0;
  for (const ch of String(s)) if (inRanges(ch.codePointAt(0), AMBIGUOUS)) n++;
  return n;
}
/* 逐字符归类。浏览器回退字体里 CJK 的步进是 1 个 em 而不是 2 个等宽格（check-browser.mjs 实测），
   所以 HTML 预览层要按类包 span、用 letter-spacing 把步进校正回 cells() 的口径。.md 原生载体不掺和。 */
export function charClass(ch) {
  const cp = ch.codePointAt(0);
  if (ZERO.has(cp)) return 'zero';
  if (cp <= 0x7e) return 'ascii';
  if (inRanges(cp, [[0x2800, 0x28ff]])) return 'braille';
  if (inRanges(cp, [[0x1f000, 0x1faff], [0x2600, 0x27bf]])) return 'emoji';
  if (inRanges(cp, [[0x2500, 0x257f]])) return 'box';
  if (inRanges(cp, [[0x2580, 0x259f]])) return 'block';
  if (inRanges(cp, [[0x25a0, 0x25ff], [0x2b00, 0x2bff]])) return 'shape';
  if (inRanges(cp, WIDE)) return 'cjk';
  if (inRanges(cp, AMBIGUOUS)) return 'ambiguous';
  return 'other';
}
// 需要校正的类 → cells() 认为它占几列（box/block 实测就是 1 列，不掺和；shape 类如 ● 被回退字体画成 1em）
export const WIDE_FIX = { cjk: 2, emoji: 2, braille: 1, shape: 1 };
export function wideRuns(s) {
  const out = [];
  for (const ch of String(s)) {
    const cls = charClass(ch);
    const target = WIDE_FIX[cls];
    if (target) {
      if (out.length && out.at(-1)[0] === cls) out.at(-1)[1] += ch;
      else out.push([cls, ch]);
      continue;
    }
    out.push(['t', ch]);
  }
  return out;
}
export const padR = (s, w) => String(s) + ' '.repeat(Math.max(0, w - cells(s)));
export const padL = (s, w) => ' '.repeat(Math.max(0, w - cells(s))) + String(s);
export const center = (s, w) => {
  const gap = Math.max(0, w - cells(s));
  const l = Math.floor(gap / 2);
  return ' '.repeat(l) + s + ' '.repeat(gap - l);
};
export const maxCells = (lines) => lines.reduce((a, l) => Math.max(a, cells(l)), 0);
// 技能给了排版建议却没给「装不下怎么办」——这里显式补两条：折行与截断（截断即记账，检查卡会因它失败）
export const truncations = [];
export function fit(s, w, where) {
  if (cells(s) <= w) return padR(s, w);
  truncations.push({ where, cells: cells(s), w, text: s });
  let out = '';
  for (const ch of s) { if (cells(out + ch) > w - 1) break; out += ch; }
  return out + '…';
}
export function wrapCells(text, w, indent = '  ') {
  const words = String(text).split(/(?<=[\s，、；])|(?=[，、；])/).filter((x) => x !== '');
  const lines = [];
  let cur = '';
  for (const wd of words) {
    if (cur && cells(cur) + cells(wd) > w) { lines.push(cur.trimEnd()); cur = indent + wd; }
    else cur += wd;
  }
  if (cur.trimEnd()) lines.push(cur.trimEnd());
  return lines;
}

/* ---------- 算术：唯一取数处 ---------- */
export function stats(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const doing = tasks.filter((t) => t.status === 'doing').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, doing, blocked, todo: total - done - doing - blocked, pct };
}
const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
// 技能原文 filledBlocks = Math.round(pct / 10)：96% 会画成满格（本轮 CLEAN 泳道 22/23 就是活例）。
// 满格只允许出现在真·全完成时，其余钳到 9/10；dense 同理钳到 79/80 个八分度。
export function filledBlocks(pct, done, total) {
  const naive = Math.round(pct / 10);
  return done === total ? 10 : Math.min(9, naive);
}
export function eighths(pct, done, total) {
  const naive = Math.round((pct / 100) * 80);
  return done === total ? 80 : Math.min(79, naive);
}

/* ---------- 风格定义 ---------- */
export const STYLES = {
  matrix: {
    key: 'matrix', file: 'dashboard-lane-matrix.md', title: '泳道矩阵 lane-matrix',
    note: '技能原生形态：emoji 图标 + ▓░ 十格条 + 横向泳道（Pattern A）+ Markdown 汇总表 + 待办表 + 里程碑时间线（Pattern C）',
    width: 118, filled: '▓', empty: '░',
    statuses: { done: '✅', doing: '🔄', blocked: '🚫', todo: '⬜' },
    legend: '  图例：▓ 已完成格  ░ 未完成格  ✅ 完成  🔄 进行中  🚫 阻塞  ⬜ 待办  ● 里程碑  ○ 未来  🎯 本轮',
  },
  dense: {
    key: 'dense', file: 'dashboard-braille-dense.md', title: '盲文密排 braille-dense',
    note: '零 emoji、不借矩阵风格的明暗块条：盒线框 + 八分度块条（█ 整格、▏▎▍▌▋▊▉ 分数、▒ 余量）+ 盲文点字体积曲线 + 纵向泳道（Pattern B，窄终端）',
    width: 78, filled: '█', empty: '▒',
    statuses: { done: '完成', doing: '进行', blocked: '阻塞', todo: '待办' },
    legend: '  图例：█ 整格 ▏▎▍▌▋▊▉ 八分度 ▒ 余量 ｜ 状态字：完成/进行/阻塞/待办 ｜ ⣿ 系列为盲文点字体积曲线',
  },
  teletype: {
    key: 'teletype', file: 'dashboard-teletype-ascii.md', title: '电传稿 teletype-ascii',
    note: 'STRICT 7-BIT ASCII: #/. BARS, +--+ FRAMES, [x]/[!] TICKETS, UPPERCASE LATIN LABELS',
    width: 80, filled: '#', empty: '.',
    statuses: { done: '[x]', doing: '[>]', blocked: '[!]', todo: '[ ]' },
    legend: '  LEGEND: # done  . todo  [x] done [ ] todo [!] blocked [>] doing  x milestone  o future  * this round',
  },
};

const isAscii = (st) => st.key === 'teletype';
const label = (st, zh, en) => (isAscii(st) ? en : zh);
const bar = (st, s) => {
  if (st.key === 'dense') {
    const e = eighths(s.pct, s.done, s.total);
    const whole = Math.floor(e / 8), rem = e % 8;
    return '█'.repeat(whole) + (rem ? EIGHTHS[rem - 1] : '') + '▒'.repeat(10 - whole - (rem ? 1 : 0));
  }
  const f = filledBlocks(s.pct, s.done, s.total);
  return st.filled.repeat(f) + st.empty.repeat(10 - f);
};
const pctLabel = (st, s) => padL(`${s.pct}%`, isAscii(st) ? 5 : 4);
const statusToken = (st, k) => st.statuses[k] || st.statuses.todo;
const LANE_NAME = (st, l) => label(st, l.name, l.name_ascii.toUpperCase());
const LANE_SUB = (st, l) => label(st, l.subtitle, l.subtitle_ascii);

/* ---------- 泳道头：三风格三种排布 ---------- */
const centerFit = (s, w, where) => center(fit(s, w, where).trimEnd(), w);
function headerMatrix(f, st) {
  const out = [];
  const rows = f.lanes.map((l) => ({ l, s: stats(l.tasks) }));
  const cols = 3, w = 36;
  for (let i = 0; i < rows.length; i += cols) {
    const row = rows.slice(i, i + cols);
    out.push(row.map(({ l, s }) => centerFit(`${l.emoji} ${l.name} ${s.done}/${s.total}`, w, `${st.key}:name`)).join('|'));
    out.push(row.map(({ l }) => centerFit(l.subtitle, w, `${st.key}:subtitle`)).join('|'));
    out.push(row.map(() => center('-'.repeat(22), w)).join('+'));
    out.push(row.map(({ s }) => centerFit(`${bar(st, s)} ${s.pct}%`, w, `${st.key}:bar`)).join('|'));
  }
  return out;
}
function headerDense(f, st) {
  const rows = f.lanes.map((l) => ({ l, s: stats(l.tasks) }));
  const nameW = Math.max(...rows.map(({ l }) => cells(l.name)));
  const body = rows.map(({ l, s }) => padR(l.name, nameW) + ' ' + bar(st, s) + ' ' + padL(`${s.done}/${s.total}`, 6) + ' ' + pctLabel(st, s) + ' ' + padL(`${s.blocked}阻塞`, 7));
  const inner = Math.max(maxCells(body), cells('项目进度看板 · 纵向泳道 Pattern B'));
  return ['╔' + '═'.repeat(inner + 2) + '╗',
    '║ ' + center('项目进度看板 · 纵向泳道 Pattern B', inner) + ' ║',
    '╟' + '─'.repeat(inner + 2) + '╢',
    ...body.map((b) => '║ ' + padR(b, inner) + ' ║'),
    '╚' + '═'.repeat(inner + 2) + '╝'];
}
function headerTeletype(f, st) {
  const out = [];
  const rows = f.lanes.map((l) => ({ l, s: stats(l.tasks) }));
  const cols = 3, w = 24;
  for (let i = 0; i < rows.length; i += cols) {
    const row = rows.slice(i, i + cols);
    out.push(row.map(({ l }) => centerFit(LANE_NAME(st, l), w, `${st.key}:name`)).join('|'));
    out.push(row.map(() => '-'.repeat(w)).join('+'));
    out.push(row.map(({ s }) => centerFit(`${s.done}/${s.total} tasks`, w, `${st.key}:count`)).join('|'));
    out.push(row.map(({ s }) => centerFit(`${bar(st, s)} ${s.pct}%`, w, `${st.key}:bar`)).join('|'));
  }
  return out;
}
const HEADER = { matrix: headerMatrix, dense: headerDense, teletype: headerTeletype };

/* ---------- 其余分节 ---------- */
function summaryTable(f, st) {
  const rows = f.lanes.map((l) => ({ l, s: stats(l.tasks) }));
  const total = stats(f.lanes.flatMap((l) => l.tasks));
  const out = [`| ${label(st, '泳道', 'LANE')} | ${label(st, '焦点', 'FOCUS')} | Tasks | Done | Block | ${label(st, '进度条', 'BAR')} |`,
    '| ---- | ---- | ----- | ---- | ----- | ------------ |'];
  for (const { l, s } of rows) {
    const nm = st.key === 'matrix' ? `${l.emoji} ${l.name}` : LANE_NAME(st, l);
    out.push(`| ${nm} | ${LANE_SUB(st, l)} | ${s.total} | ${s.done} | ${s.blocked} | ${bar(st, s)} ${s.pct}% |`);
  }
  out.push(`| ${label(st, '**合计**', '**TOTAL**')} | ${label(st, '全部泳道', 'ALL LANES')} | ${total.total} | ${total.done} | ${total.blocked} | ${bar(st, total)} ${total.pct}% |`);
  return out;
}
function backlog(st, l) {
  const s = stats(l.tasks);
  const out = [`#### ${st.key === 'matrix' ? l.emoji + ' ' : ''}${LANE_NAME(st, l)} (${s.done}/${s.total})`, '',
    `| ID | ${label(st, '任务', 'TASK')} | ${label(st, '状态', 'STATE')} | ${label(st, '备注', 'NOTE')} |`,
    '| ---- | ---- | ---- | ---- |'];
  for (const t of l.tasks) {
    out.push(`| ${t.id} | ${isAscii(st) ? t.label_ascii : t.label} | ${statusToken(st, t.status)} | ${isAscii(st) ? (t.note_ascii || '--') : (t.note || label(st, '—', '--'))} |`);
  }
  out.push('');
  return out;
}
function timeline(f, st) {
  const node = isAscii(st) ? 'x' : st.key === 'dense' ? '◆' : '●';
  const future = isAscii(st) ? '*' : st.key === 'dense' ? '◇' : '🎯';
  const link = isAscii(st) ? '-' : st.key === 'dense' ? '═' : '─';
  const line = ['  '], tags = ['  '], dates = ['  '];
  for (const m of f.milestones) {
    line.push((m.status === 'target' ? future : node) + link.repeat(4));
    tags.push(center(m.tag, 5));
    dates.push(center(m.date, 5));
  }
  return [line.join(''), tags.join(''), dates.join('')];
}
function brailleSeries(values, width) {
  const ramp = ['⠀', '⠤', '⠆', '⠒', '⠲', '⠦', '⠶', '⠿'];
  const max = Math.max(...values), min = Math.min(...values);
  const step = Math.max(1, Math.ceil(values.length / width));
  const picked = values.filter((_, i) => i % step === 0).slice(0, width);
  return picked.map((v) => ramp[max === min ? ramp.length - 1 : Math.round(((v - min) / (max - min)) * (ramp.length - 1))]).join('');
}
function sprintBox(f, st) {
  const out = [`### ${label(st, '本轮 Sprint', 'SPRINT')} ${f.sprint.version}`, ''];
  for (const g of f.sprint.groups) {
    out.push(`#### ${label(st, g.title, g.title.toUpperCase())}`);
    for (const it of g.items) {
      const box = st.key === 'matrix' ? (it.done ? '✅' : '⬜') : st.key === 'dense' ? (it.done ? '[完成]' : '[待办]') : it.done ? '[x]' : '[ ]';
      out.push(`- ${box} ${isAscii(st) ? it.text_ascii : it.text}${it.note ? ` ${isAscii(st) ? '-' : '—'} ${isAscii(st) ? it.note_ascii : it.note}` : ''}`);
    }
    out.push('');
  }
  return out;
}
const PROV_KEYS = {
  'facts 摘要': 'FACTS SHA', 'work-log 摘要': 'WORKLOG SHA', '台账 updated': 'LEDGER UPDATED',
  'tried / runs': 'TRIED / RUNS', '产物目录 / 报告': 'DIRS / REPORTS', 'artifacts 体积': 'ARTIFACT BYTES',
  '环境注记 / 候选': 'NOTES / CANDIDATES', 'git': 'GIT HEAD', '生成时刻': 'GENERATED AT',
};
function provenance(f, st) {
  const L = f.ledger, D = f.disk, G = f.git;
  const rows = [
    ['facts 摘要', L.state_sha1], ['work-log 摘要', L.worklog_sha1], ['台账 updated', L.updated],
    ['tried / runs', `${L.tried_len} / ${L.runs_len}`], ['产物目录 / 报告', `${D.artifact_dirs} / ${D.reports}`],
    ['artifacts 体积', `${Math.round(D.artifacts_bytes / 1048576 * 10) / 10}MB`],
    ['环境注记 / 候选', `${L.notes_len} / ${L.candidates_len} (+${L.candidates_star} star)`],
    ['git', `${G.branch}@${G.head}`], ['生成时刻', f.generated_at],
  ];
  if (isAscii(st)) {
    const w = 50;
    return ['+' + '-'.repeat(w) + '+',
      ...rows.map(([k, v]) => '| ' + padR(PROV_KEYS[k] || k, 26) + padL(String(v), 22) + ' |'),
      '+' + '-'.repeat(w) + '+'];
  }
  return [`| ${label(st, '键', 'KEY')} | ${label(st, '值', 'VALUE')} |`, '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | \`${v}\` |`)];
}

/* ---------- 主渲染 ---------- */
export function render(styleKey, f) {
  const st = STYLES[styleKey];
  truncations.length = 0;
  const L = [];
  L.push(`# ${label(st, '前端 Skill 验证流水线 · 进度看板', 'FRONTEND SKILL LAB / PROGRESS BOARD')}`);
  L.push(...wrapCells(`  ${st.note}`, st.width));
  L.push('');
  // 版式区必须进代码围栏：技能模板里三张示例看板都写在 ``` 里，裸写的对齐块会被 Markdown 渲染器折叠成段落
  L.push('```');
  L.push(...HEADER[st.key](f, st));
  if (st.key === 'dense') {
    const kb = f.lanes.find((x) => x.key === 'clean').tasks.map((t) => Number(String(t.label).match(/(\d+)KB/)?.[1] || 0));
    L.push('');
    L.push(`  ${label(st, '历史轮产物体积 /KB', 'ARTIFACT KB PER ROUND')} ${brailleSeries(kb, 24)}`);
  }
  L.push('```');
  L.push('');
  L.push(`## ${label(st, '汇总表', 'SUMMARY TABLE')}`);
  L.push('');
  L.push(...summaryTable(f, st));
  L.push('');
  L.push(`## ${label(st, '各泳道待办', 'BACKLOG BY LANE')}`);
  L.push('');
  for (const l of f.lanes) L.push(...backlog(st, l));
  L.push(`## ${label(st, '里程碑时间线（末 10 轮 + 本轮）', 'MILESTONE TIMELINE (LAST 10 ROUNDS)')}`);
  L.push('');
  L.push('```');
  L.push(...timeline(f, st));
  L.push('```');
  L.push(...wrapCells(st.legend, st.width));
  L.push('');
  L.push(...sprintBox(f, st));
  L.push(`## ${label(st, '数据出处（本页每个数字均由脚本现算，非手抄）', 'PROVENANCE (ALL NUMBERS COMPUTED, NONE COPIED)')}`);
  L.push('');
  L.push(...provenance(f, st));
  L.push('');
  L.push(`<!-- f:${f.ledger.state_sha1} w:${f.ledger.worklog_sha1} s:${st.key} -->`);
  return L.join('\n') + '\n';
}
