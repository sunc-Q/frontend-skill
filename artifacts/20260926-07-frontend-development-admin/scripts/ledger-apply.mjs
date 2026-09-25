/**
 * One-shot ledger write-back for this round, driven entirely by scripts/round-facts.mjs.
 *   node scripts/ledger-apply.mjs
 * Refuses to run twice: the moment this round's entry is present in state.tried it exits non-zero,
 * so an accidental re-run cannot duplicate a work-log line. scripts/check-node.mjs group I is the
 * read-side lock that proves the same thing after the fact.
 *
 * UPDATED / SEEN_STATUS are the two values only known at write time, hence CLI-injected;
 * everything else comes from round-facts.mjs.
 */
const UPDATED = process.env.FD_LEDGER_UPDATED;
const SEEN_STATUS = process.env.FD_SEEN_STATUS;
if (!UPDATED || !SEEN_STATUS) {
  console.error('FD_LEDGER_UPDATED and FD_SEEN_STATUS must both be set (see reports/*.md §台账 for the exact strings)');
  process.exit(1);
}
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIED, RUN, ENV_NOTES, WORK_LOG_LINE, QUEUE_HINT } from './round-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const STATE = path.join(LAB, 'state', 'state.json');
const LOG = path.join(LAB, 'records', 'work-log.md');

if (!existsSync(path.join(ROOT, 'scripts', 'ledger-snapshot.json'))) {
  console.error('run scripts/ledger-snapshot.mjs first (the write-back must be snapshot-guarded)');
  process.exit(1);
}
const state = JSON.parse(readFileSync(STATE, 'utf8'));
if (state.tried.some((e) => e.skill === TRIED.skill && e.scenario === TRIED.scenario)) {
  console.error('already applied — refusing to append a second copy');
  process.exit(1);
}
for (const s of TRIED.styles) {
  if (state.used_styles.includes(s)) {
    console.error(`style ${s} is not new — dedup contract broken before write`);
    process.exit(1);
  }
}

const seen = state.skills_seen.find((s) => s.name === 'frontend-development');
if (!seen) {
  console.error('skills_seen has no frontend-development entry — update the status text by hand');
  process.exit(1);
}
seen.status = SEEN_STATUS;

const candidatesBefore = state.next_candidates.length;
state.tried.push(TRIED);
state.runs.push(RUN);
state.used_styles.push(...TRIED.styles);
state.environment_notes.push(...ENV_NOTES);
state.next_candidates = state.next_candidates.filter((c) => !c.startsWith(QUEUE_HINT));
state.updated = UPDATED;

writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
appendFileSync(LOG, WORK_LOG_LINE + '\n', 'utf8');
console.log(
  `applied: tried ${state.tried.length - 1}→${state.tried.length}, runs ${state.runs.length - 1}→${state.runs.length}, ` +
    `styles +${TRIED.styles.length}, env +${ENV_NOTES.length}, candidates ${candidatesBefore}→${state.next_candidates.length}, log +1`,
);
