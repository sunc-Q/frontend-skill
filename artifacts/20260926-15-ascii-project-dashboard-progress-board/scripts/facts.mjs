#!/usr/bin/env node
// 事实源：看板里每一个数字都必须由本脚本现算，渲染层不得出现任何字面任务数/百分比。
// 口径来源只有三处：state/state.json（台账）、磁盘（artifacts/ reports/ skills/）、git（提交历史）。
// 每个中文字段配一条 *_ascii 投影：纯 ASCII 风格只能用它——这就是「文本能到哪儿，看板就到哪儿」的代价。
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const HERE = fileURLToPath(import.meta.url);
const ROUND = join(HERE, '..', '..');          // artifacts/20260926-15-...
export const LAB = join(ROUND, '..', '..');    // 仓库根
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

const stateRaw = readFileSync(join(LAB, 'state', 'state.json'));
const S = JSON.parse(stateRaw.toString('utf8'));
const logRaw = readFileSync(join(LAB, 'records', 'work-log.md'));

export const ROUND_ID = '20260926-15-ascii-project-dashboard-progress-board';
export const ROUND_TIME = process.env.ROUND_TIME || '2026-09-26T15:00+08:00';

const dir = (p) => existsSync(join(LAB, p)) && statSync(join(LAB, p)).isDirectory();
const fileBytes = (p) => (existsSync(join(LAB, p)) ? statSync(join(LAB, p)).size : -1);

function walkAll(root) {
  const out = [];
  if (!existsSync(join(LAB, root))) return out;
  const rec = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const a = join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) rec(a, r);
      else out.push({ abs: a, rel: r, bytes: statSync(a).size });
    }
  };
  rec(join(LAB, root), '');
  return out;
}

const slug = (artifacts) => (Array.isArray(artifacts) ? artifacts[0] : String(artifacts || ''))
  .replace(/^artifacts\//, '').split(/[（(/]/)[0].trim();

const reportFiles = readdirSync(join(LAB, 'reports'));
// 台账里 2 条早期 tried 没有 report 字段（H9 记为缺陷），按目录名回退匹配同名片段
const reportOf = (t, s) => {
  const declared = typeof t.report === 'string' ? t.report.replace(/^reports\//, '') : '';
  if (declared && reportFiles.includes(declared)) return { rel: declared, drift: '', drift_ascii: '' };
  const byDir = reportFiles.find((f) => f.startsWith(s + '.md'));
  if (byDir) {
    return {
      rel: byDir,
      drift: declared ? '字段路径与磁盘不符' : '台账缺 report 字段',
      drift_ascii: declared ? 'declared path not on disk' : 'report field absent',
    };
  }
  return { rel: '', drift: '报告文件不存在', drift_ascii: 'report file absent' };
};
const BOUNDARY = '2026-09-26T14:00+08:00'; // 本轮开工时刻：之后写的产物算在制品
// tried[13] 缺 time（早期轮漏记），用 runs[i] 的配对时间回填，否则时间线会渲染出 "undefined"
const timeOf = (t) => t.time || String((S.runs[S.tried.indexOf(t)] || {}).time || '');
const pastRuns = S.tried.filter((t) => timeOf(t) < BOUNDARY);
const inflight = S.tried.filter((t) => timeOf(t) >= BOUNDARY);

const allArtifactDirs = readdirSync(join(LAB, 'artifacts')).filter((n) =>
  statSync(join(LAB, 'artifacts', n)).isDirectory()
);
const knownSlugs = new Set([...pastRuns, ...inflight].map((t) => slug(t.artifacts)));
const orphans = allArtifactDirs.filter((d) => !knownSlugs.has(d));

// 技能族：把 tried[].skill 的写法归一到 skills/ 快照目录名
const FAMILIES = [
  ['sites-building', /sites-building/],
  ['vercel-react-best-practices', /vercel-react/],
  ['frontend-development', /frontend-development/],
  ['drafter', /drafter/],
  ['ppt-generator', /ppt-generator/],
  ['graphic-gif', /graphic-gif/],
  ['build-game', /build-game/],
  ['ascii-project-dashboard', /ascii-project-dashboard/],
];
const familyOf = (skillStr) => (FAMILIES.find(([, re]) => re.test(skillStr || '')) || [null])[0];

function laneTrace() {
  const tasks = pastRuns.map((t, i) => {
    const s = slug(t.artifacts);
    const { rel, drift, drift_ascii } = reportOf(t, s);
    const rb = rel ? fileBytes(join('reports', rel)) : -1;
    const noDir = !dir(join('artifacts', s));
    const ok = !noDir && rb > 1000;
    return {
      id: `T${i + 1}`,
      label: `${s.slice(8)} · 报告 ${rb > 0 ? rb + 'B' : '缺失'}`,
      label_ascii: s,
      status: ok ? 'done' : 'blocked',
      note: ok ? drift : noDir ? '产物目录缺失' : (drift || '报告 <1KB'),
      note_ascii: ok ? drift_ascii : noDir ? 'artifact dir absent' : (drift_ascii || 'report under 1KB'),
    };
  });
  return {
    key: 'trace', name: '留痕 TRACE', name_ascii: 'TRACE',
    subtitle: '每轮产物目录 + 复现报告是否都在盘上', subtitle_ascii: 'artifact dir + report on disk',
    emoji: '🧱', tasks,
  };
}

function laneClean() {
  const tasks = allArtifactDirs.map((d) => {
    const files = walkAll(join('artifacts', d));
    const bytes = files.reduce((a, f) => a + f.bytes, 0);
    const residue = files.filter((f) => /(^|\/)(node_modules|dist[^/]*|\.tmp-check)\//.test(f.rel)).length;
    const html = files.filter((f) => f.rel.endsWith('.html')).length;
    const inFlight = d === ROUND_ID || orphans.includes(d);
    const ok = bytes < 50 * 1024 * 1024 && residue === 0 && html > 0;
    const note = ok ? '' : `bytes=${bytes} residue=${residue} html=${html}`;
    return {
      id: `K${d.slice(0, 10)}`,
      label: `${d.slice(8)} · ${Math.round(bytes / 1024)}KB · 残留${residue} · ${html} 页`,
      label_ascii: d,
      status: inFlight && !ok ? 'doing' : ok ? 'done' : 'blocked',
      note, note_ascii: note,
    };
  });
  return {
    key: 'clean', name: '收尾 CLEAN', name_ascii: 'CLEAN',
    subtitle: '单场景 <50MB、无残留、可双击', subtitle_ascii: 'under 50MB, no build residue, openable page',
    emoji: '🧹', tasks,
  };
}

function laneSource() {
  let manifest = { skills: [] };
  try { manifest = JSON.parse(readFileSync(join(LAB, 'skills', 'MANIFEST.json'), 'utf8')); } catch { }
  const listed = new Set((manifest.skills || []).map((x) => x.name));
  const usedFamilies = [...new Set(S.tried.map((t) => familyOf(t.skill)).filter(Boolean))];
  const tasks = FAMILIES.map(([name], i) => {
    const snapOk = dir(join('skills', name));
    const used = usedFamilies.includes(name);
    const inManifest = listed.has(name);
    const ok = !used || (snapOk && inManifest);
    return {
      id: `S${i + 1}`,
      label: `${name} · 快照${snapOk ? '在' : '缺'} · 清单${inManifest ? '收' : '漏'}`,
      label_ascii: name,
      status: ok ? 'done' : used && snapOk && !inManifest ? 'doing' : 'blocked',
      note: used ? (ok ? '' : '快照在但清单未登记') : '未被任何轮次使用',
      note_ascii: used ? (ok ? '' : 'snapshot present, manifest missing') : 'family never used',
    };
  });
  return {
    key: 'source', name: '快照 SOURCE', name_ascii: 'SOURCE',
    subtitle: '技能原文随仓库可核对', subtitle_ascii: 'used skill sources vendored + listed',
    emoji: '📚', tasks,
  };
}

function laneDedup() {
  const used = S.used_styles || [];
  const tasks = pastRuns.map((t, i) => {
    const others = used.filter((s) => !(t.styles || []).includes(s));
    const clashes = (t.styles || []).filter((s) => others.includes(s));
    const unregistered = (t.styles || []).filter((s) => !used.includes(s));
    return {
      id: `D${i + 1}`,
      label: `${slug(t.artifacts).slice(8)} · ${(t.styles || []).length} 风格 · 撞车${clashes.length} · 未登记${unregistered.length}`,
      label_ascii: slug(t.artifacts),
      status: clashes.length || unregistered.length ? 'blocked' : 'done',
      note: clashes.length ? `重复：${clashes.join('/')}` : unregistered.length ? `未登记：${unregistered.join('/')}` : '',
      note_ascii: clashes.length ? `style also used by another round: ${clashes.length}`
        : unregistered.length ? `styles missing from used_styles: ${unregistered.length}` : '',
    };
  });
  return {
    key: 'dedup', name: '去重 DEDUP', name_ascii: 'DEDUP',
    subtitle: '同风格不复用；每轮三风格均已登记', subtitle_ascii: 'no style reused; all three registered',
    emoji: '🎨', tasks,
  };
}

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: LAB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}

function lanePush() {
  const tasks = allArtifactDirs.map((d) => {
    const t = pastRuns.find((x) => slug(x.artifacts) === d);
    const ti = t ? S.tried.indexOf(t) : -1;
    const claim = ti >= 0 ? String((S.runs[ti] || {}).push ?? '') : '';
    const inHistory = git('log', '--format=%H', '--', join('artifacts', d)).trim().split('\n').filter(Boolean).length;
    const tracked = git('ls-files', join('artifacts', d)).trim().length > 0;
    const declared = claim.startsWith('已提交并推送') || claim.startsWith('已推送');
    const reason = !tracked ? ['未跟踪（在制品或未推送）', 'untracked: in-flight or unpushed']
      : !declared ? (claim ? ['runs.push 措辞不含「已提交并推送」', 'runs.push wording differs']
        : ['runs 缺 push 字段（早期轮未记）', 'runs entry has no push field (early round)'])
        : ['', ''];
    return {
      id: `P${d.slice(0, 10)}`,
      label: `${d.slice(8)} · 提交 ${inHistory} 次${declared ? ' · 台账已声明' : ''}`,
      label_ascii: d,
      status: !reason[0] ? 'done' : d === ROUND_ID ? 'doing' : 'blocked',
      note: reason[0], note_ascii: reason[1],
    };
  });
  return {
    key: 'push', name: '推送 PUSH', name_ascii: 'PUSH',
    subtitle: '产物进过 origin/main 且台账有声明', subtitle_ascii: 'on origin/main and declared in ledger',
    emoji: '🚀', tasks,
  };
}

function laneHealth() {
  const used = S.used_styles || [];
  const flat = S.tried.reduce((a, t) => a + (t.styles || []).length, 0);
  const logLines = logRaw.toString('utf8').split('\n').filter((l) => /^\|?\s*20\d\d-\d\d-\d\d /.test(l)).length;
  const lastTried = timeOf(pastRuns.at(-1)) || '';
  const seenFams = new Set((S.skills_seen || []).map((x) => familyOf(x.name)));
  const checks = [
    ['H1', 'tried 与 runs 等长', 'tried and runs same length', S.tried.length === S.runs.length, `tried=${S.tried.length} runs=${S.runs.length}`],
    ['H2', '每轮风格均已登记进 used_styles', 'every round style is in used_styles', S.tried.every((t) => (t.styles || []).every((s) => used.includes(s))), `mismatched=${S.tried.reduce((a, t) => a + (t.styles || []).filter((s) => !used.includes(s)).length, 0)}`],
    ['H3', 'used_styles 长度 == tried 展开长度', 'used_styles length equals expanded length', used.length === flat, `used=${used.length} flat=${flat}`],
    ['H4', '每轮产物目录在盘', 'every round has an artifact dir', S.tried.every((t) => dir(join('artifacts', slug(t.artifacts)))), `dirs=${allArtifactDirs.length}`],
    ['H5', 'work-log 轮次行数 >= tried 数', 'work-log round lines at least tried count', logLines >= S.tried.length, `log=${logLines} tried=${S.tried.length}`],
    ['H6', 'state.updated 不早于末轮 time', 'state.updated not older than the last round', String(S.updated) >= lastTried, `updated=${S.updated} last=${lastTried}`],
    ['H7', '每个技能族都出现在 skills_seen', 'every used family appears in skills_seen', S.tried.map((t) => familyOf(t.skill)).filter(Boolean).every((x) => seenFams.has(x)), `seen=${S.skills_seen.length}`],
    ['H8', '无孤儿产物目录', 'no artifact dir outside tried', orphans.length === 0, `orphans=${orphans.length}`],
    ['H9', '每条 tried 都有字符串 report 字段', 'every tried entry has a report string', S.tried.every((t) => typeof t.report === 'string'), `missing=${S.tried.filter((t) => typeof t.report !== 'string').length}`],
    ['H10', 'tried[].artifacts 全为字符串', 'every artifacts field is a string', S.tried.every((t) => typeof t.artifacts === 'string'), `nonstring=${S.tried.filter((t) => typeof t.artifacts !== 'string').length}`],
    ['H11', 'runs[i] 与 tried[i] 同轮', 'runs[i] and tried[i] share a timestamp', S.runs.every((r, i) => S.tried[i] && String(r.time).slice(0, 13) === timeOf(S.tried[i]).slice(0, 13)), `pairs=${S.runs.length}`],
    ['H12', 'reports/ 下无与产物目录同名的子目录', 'reports/ holds no dir shadowing artifacts/', reportFiles.every((x) => !allArtifactDirs.includes(x)), `nonmd_in_reports=${reportFiles.filter((x) => !x.endsWith('.md')).length}`],
    ['H13', '每条 tried 自带 time（无需 runs 回填）', 'every tried entry carries its own time', S.tried.every((t) => typeof t.time === 'string'), `missing=${S.tried.filter((t) => typeof t.time !== 'string').length}`],
  ];
  return {
    key: 'health', name: '自检 HEALTH', name_ascii: 'HEALTH',
    subtitle: '台账自身的一致性判据', subtitle_ascii: 'ledger invariants, count computed',
    emoji: '🩺',
    tasks: checks.map(([id, zh, en, ok, note]) => ({
      id, label: `${zh} · ${note}`, label_ascii: `${id} ${en}`,
      status: ok ? 'done' : 'blocked', note, note_ascii: note,
    })),
  };
}

export function collect() {
  const lanes = [laneTrace(), laneClean(), laneSource(), laneDedup(), lanePush(), laneHealth()];
  const milestones = pastRuns.slice(-10).map((t) => ({
    tag: timeOf(t).slice(11, 16) || '--:--',
    date: timeOf(t).slice(5, 10) || '----',
    label: slug(t.artifacts),
    status: 'done',
  }));
  milestones.push({ tag: ROUND_TIME.slice(11, 16), date: ROUND_TIME.slice(5, 10), label: ROUND_ID, status: 'target' });

  const specSteps = [
    ['读取工作记录与台账', 'READ work-log and state.json', true, '两本账读完才选题', 'read both ledgers before picking'],
    ['选题未试组合', 'PICK an untried skill and scenario', true, 'tried 里没有这一组', 'not present in tried'],
    ['按技能流程产出三风格', 'BUILD three distinct styles', false, '渲染层见 src/render.mjs', 'renderer: src/render.mjs'],
    ['断言与变异复核', 'ASSERT plus mutation arms', false, 'node/mutate/browser 三张卡', 'cards: node, mutate, browser'],
    ['清理中间产物', 'CLEAN intermediate files', false, '本轮零 node_modules', 'no node_modules this round'],
    ['写复现文档到 reports', 'WRITE the reproduction report', false, '与产物同名片段', 'same slug as artifacts dir'],
    ['写回台账与工作日志', 'WRITE BACK ledger and work-log', false, 'tried/runs/notes 全部追加', 'append-only to tried, runs, notes'],
    ['提交并推送到 origin', 'PUSH to origin main over SSH', false, 'HTTPS 被重置故走 SSH', 'HTTPS reset by TLS, so SSH'],
  ];
  return {
    generated_at: new Date().toISOString(),
    round: { id: ROUND_ID, time: ROUND_TIME, boundary: BOUNDARY },
    ledger: {
      state_sha1: sha1(stateRaw).slice(0, 12),
      worklog_sha1: sha1(logRaw).slice(0, 12),
      updated: S.updated, tried_len: S.tried.length, runs_len: S.runs.length,
      styles_len: (S.used_styles || []).length, notes_len: (S.environment_notes || []).length,
      candidates_len: (S.next_candidates || []).length,
      candidates_star: (S.next_candidates || []).filter((c) => c.startsWith('★')).length,
      skills_seen_len: (S.skills_seen || []).length,
    },
    disk: {
      artifact_dirs: allArtifactDirs.length,
      orphans,
      artifacts_bytes: allArtifactDirs.reduce((a, d) => a + walkAll(join('artifacts', d)).reduce((b, f) => b + f.bytes, 0), 0),
      reports: reportFiles.length,
    },
    git: {
      head: git('rev-parse', '--short', 'HEAD').trim(),
      branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim(),
      untracked_dirs: git('status', '--porcelain').split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3)),
    },
    sprint: {
      version: ROUND_ID.slice(0, 10),
      title: '每小时 Skill 验证 · 本轮规程',
      groups: [{
        title: 'Spec steps',
        items: specSteps.map(([text, text_ascii, done, note, note_ascii]) => ({
          text, text_ascii, done, note, note_ascii,
        })),
      }],
    },
    milestones,
    lanes,
  };
}

if (process.argv[1] === HERE) {
  const out = collect();
  writeFileSync(join(ROUND, 'facts.json'), JSON.stringify(out, null, 1));
  console.log('lanes:', out.lanes.map((l) => `${l.key}=${l.tasks.length}`).join(' '));
  console.log('done:', out.lanes.map((l) => `${l.key}:${l.tasks.filter((x) => x.status === 'done').length}`).join(' '));
  const bad = out.lanes.flatMap((l) => l.tasks)
    .filter((t) => /[^\x00-\x7e]/.test(t.note_ascii || '') || /[^\x00-\x7e]/.test(t.label_ascii))
    .map((t) => t.id);
  console.log('ASCII 投影不纯的任务:', bad.join(' ') || '(none)');
  const badStep = out.sprint.groups[0].items
    .filter((x) => /[^\x00-\x7e]/.test(x.text_ascii) || /[^\x00-\x7e]/.test(x.note_ascii))
    .map((x) => x.text_ascii);
  console.log('Sprint ASCII 投影不纯:', badStep.join(' | ') || '(none)');
  console.log('orphans:', out.disk.orphans.join(' ') || '(none)');
}
