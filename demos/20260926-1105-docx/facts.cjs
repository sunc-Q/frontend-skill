#!/usr/bin/env node
// Collect facts for the review memo from the pipeline's own ledger (read-only).
const fs = require('fs');
const path = require('path');

const LAB = path.resolve(__dirname, '..', '..');
const st = JSON.parse(fs.readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8'));

const RUNS = [
  { skill: 'drafter', slug: 'drafter', artifact: 'HTML 工程图纸', kind: 'html' },
  { skill: 'ascii-project-dashboard', slug: 'ascii-project-dashboard', artifact: 'ASCII 终端看板', kind: 'txt' },
  { skill: 'algorithmic-art', slug: 'algorithmic-art', artifact: 'p5 生成艺术', kind: 'html' },
  { skill: 'SQLite-Database-Expert', slug: 'sqlite-database-expert', artifact: 'SQLite FTS5 检索库', kind: 'db' },
  { skill: 'ppt-generator', slug: 'ppt-generator', artifact: 'PPTX 幻灯片', kind: 'pptx' },
  { skill: 'graphic-gif', slug: 'graphic-gif', artifact: '循环 GIF', kind: 'gif' },
  { skill: 'build-game', slug: 'build-game', artifact: '3D 网页游戏', kind: 'html' },
  { skill: 'sec-audit-cn', slug: 'sec-audit-cn', artifact: '分级安全审计报告', kind: 'md' },
  { skill: 'xlsx', slug: 'xlsx', artifact: 'Excel 台账', kind: 'xlsx' },
  { skill: 'golang-testing', slug: 'golang-testing', artifact: 'Go 测试 + 覆盖率', kind: 'go' },
  { skill: 'webapp-testing', slug: 'webapp-testing', artifact: '端到端回归 + 真截图', kind: 'png' },
];

const triedBySkill = {};
for (const t of st.tried) triedBySkill[t.skill] = t;

const rows = RUNS.map((r, i) => {
  const run = st.runs[i];
  const t = triedBySkill[r.skill] || {};
  const demoDir = path.join(LAB, 'demos', fs.readdirSync(path.join(LAB, 'demos')).find((d) => d.endsWith('-' + r.slug)) || '');
  let bytes = 0;
  try {
    for (const f of listFiles(demoDir)) bytes += fs.statSync(path.join(demoDir, f)).size;
  } catch (e) { /* dir missing -> 0 */ }
  const log = path.join(demoDir, 'output.log');
  let pass = null, fail = null;
  if (fs.existsSync(log)) {
    const s = fs.readFileSync(log, 'utf8');
    pass = (s.match(/\bPASS\b/g) || []).length;
    fail = (s.match(/\bFAIL\b/g) || []).length;
  }
  return {
    n: i + 1,
    skill: r.skill,
    artifact: r.artifact,
    kind: r.kind,
    minutes: run.seconds != null ? Math.round(run.seconds / 60 * 10) / 10 : null,
    verdict: (t.verdict || '').split('。')[0].replace(/\*\*/g, ''),
    bytes,
    pass,
    fail,
    installed: Array.isArray(run.installed_by_this_task) ? run.installed_by_this_task.length : 0,
  };
});

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) for (const sub of listFiles(p)) out.push(path.join(e.name, sub));
    else out.push(e.name);
  }
  return out;
}

function localStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) +
    '（本地 UTC' + (off >= 0 ? '+' : '-') + pad(Math.abs(off) / 60) + '）';
}

const facts = {
  generated: localStamp(),
  rounds: rows.length,
  rows,
  totals: {
    tried: st.tried.length,
    seen: st.skills_seen.length,
    runs: st.runs.length,
    demoBytes: rows.reduce((a, r) => a + r.bytes, 0),
    installedGlobal: rows.reduce((a, r) => a + r.installed, 0),
    minutesKnown: rows.filter((r) => r.minutes != null).length,
  },
  sourceOfTruth: 'LAB/state/state.json (tried[] x runs[]) + du of each demos/<run> + grep of each output.log',
};
fs.writeFileSync(path.join(__dirname, 'facts.json'), JSON.stringify(facts, null, 1));
console.log('facts.json written: rounds=' + rows.length + ' demoBytes=' + facts.totals.demoBytes +
  ' minutes=' + JSON.stringify(rows.map((r) => r.minutes)));
for (const r of rows) console.log(' r' + String(r.n).padStart(2, '0') + ' ' + r.skill.padEnd(24) +
  r.bytes + 'B  PASS-in-log=' + r.pass + ' FAIL-in-log=' + r.fail);
