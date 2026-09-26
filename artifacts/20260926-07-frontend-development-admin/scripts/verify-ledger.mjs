/**
 * Post-cleanup / post-补记 ledger lock (run any time, needs no build output):
 *   node scripts/verify-ledger.mjs
 *
 * scripts/check-node.mjs group I asserts the same invariants, but it also runs groups B/B6c/L/J,
 * which need dist/, dist-split/ and .tmp-check/ — i.e. it can only pass BEFORE cleanup. After the
 * cleanup and after the 补记 commit (which rewrites state.runs[-1].push / cleanup / artifact_size and
 * the matching WORK_LOG_LINE text) this is the check that still proves the ledger is exactly
 * snapshot + this round, appended once, with history byte-identical.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const { TRIED, RUN, ENV_NOTES, ROUND_ID, WORK_LOG_LINE, QUEUE_HINT } = await import(
  pathToFileURL(path.join(ROOT, 'scripts', 'round-facts.mjs'))
);
const state = JSON.parse(readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8'));
const logLines = readFileSync(path.join(LAB, 'records', 'work-log.md'), 'utf8').trimEnd().split('\n');
const sha = (v) => createHash('sha1').update(JSON.stringify(v), 'utf8').digest('hex');
const shaStr = (v) => createHash('sha1').update(v, 'utf8').digest('hex');
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const rows = [];
const chk = (id, cond, detail) => {
  rows.push({ id, cond: cond === true, detail: String(detail) });
  if (cond !== true) console.log(`FAIL ${id} ${detail}`);
};

const snap = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'ledger-snapshot.json'), 'utf8'));
const applied = state.tried.filter((e) => e.skill === TRIED.skill && e.scenario === TRIED.scenario);
const lastRun = state.runs[state.runs.length - 1];

chk('V1 本轮在 tried 中恰好出现一次（写回一次、不多不少）', applied.length === 1, `出现 ${applied.length} 次`);
chk('V2 tried 末条 = round-facts 的 TRIED（同一来源，不是手抄）', deepEq(applied[0], TRIED), TRIED.skill.slice(0, 24));
chk('V3 runs 末条 = RUN，含 补记 回填的 push / cleanup / artifact_size（全字段，不留豁免）',
  deepEq(lastRun, RUN), `push=${String(RUN.push).slice(0, 46)}`);
chk('V4 写回是追加：四个历史列表的前缀逐字节未变',
  sha(state.tried.slice(0, snap.triedLen)) === snap.triedSha &&
    sha(state.runs.slice(0, snap.runsLen)) === snap.runsSha &&
    sha(state.used_styles.slice(0, snap.stylesLen)) === snap.stylesSha &&
    sha(state.environment_notes.slice(0, snap.envLen)) === snap.envSha,
  `tried ${snap.triedLen}→${state.tried.length}，runs ${snap.runsLen}→${state.runs.length}`);
chk('V5 used_styles = 快照 + 本轮 3 个新风格且全表无重复',
  state.used_styles.length === snap.stylesLen + TRIED.styles.length &&
    TRIED.styles.every((s) => state.used_styles.slice(snap.stylesLen).includes(s)) &&
    new Set(state.used_styles).size === state.used_styles.length &&
    TRIED.styles.every((s) => !snap.usedStyles.includes(s)),
  `${snap.stylesLen}→${state.used_styles.length}`);
chk('V6 environment_notes 只增不减、无重复、新增条数 = round-facts',
  state.environment_notes.length === snap.envLen + ENV_NOTES.length &&
    new Set(state.environment_notes).size === state.environment_notes.length,
  `${snap.envLen}→${state.environment_notes.length}`);
chk('V7 work-log 行数 = 快照 + 1 且历史前 29 行逐字节未变（append-only）',
  logLines.length === snap.logLines + 1 &&
    shaStr(logLines.slice(0, snap.logLines).join('\n') + '\n') === snap.logSha,
  `${snap.logLines}→${logLines.length}`);
chk('V8 work-log 末行 = round-facts 的 WORK_LOG_LINE（6 段齐全）',
  logLines[logLines.length - 1] === WORK_LOG_LINE && WORK_LOG_LINE.split(' | ').length === 6,
  `${Buffer.byteLength(WORK_LOG_LINE, 'utf8')}B`);
chk('V9 末行写到的产物目录与报告文件真实存在',
  existsSync(path.join(LAB, 'artifacts', ROUND_ID)) && existsSync(path.join(LAB, `reports/${ROUND_ID}.md`)), ROUND_ID);
chk('V10 updated 时间戳已推进且 push 已回填（补记 完成，否则本轮未收尾）',
  String(state.updated) > String(snap.updated) && /^[^<]+/.test(String(RUN.push)) && RUN.push.includes('..'),
  `${snap.updated} → ${state.updated}`);
chk('V11 排队项已消费且未静默丢候选：写回前排在队里的这条组合已出队，快照里其余每一条仍在（新轮可继续追加，但谁也不许被无痕删掉）',
  !state.next_candidates.some((c) => c.includes(QUEUE_HINT)) &&
    snap.candidates.filter((c) => !c.includes(QUEUE_HINT)).every((c) => state.next_candidates.includes(c)) &&
    state.next_candidates.length >= snap.candidates.length - 1,
  `快照 ${snap.candidates.length} 条 → 现 ${state.next_candidates.length} 条（含 补记 后排入的新候选）`);

const failed = rows.filter((r) => !r.cond);
console.log(`verify-ledger: ${rows.length - failed.length}/${rows.length} assertions passed`);
if (failed.length) process.exit(1);
