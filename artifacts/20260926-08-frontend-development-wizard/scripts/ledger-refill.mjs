/**
 * Refills the three fields that can only be known after the build outputs are deleted
 * (artifact_size / cleanup / push) into the ledger row this round already wrote, and rewrites
 * this round's own work-log line, both straight from scripts/round-facts.mjs.
 *
 *   node scripts/ledger-refill.mjs
 *
 * ledger-apply.mjs refuses to run twice, so without this card the only way to 补记 would be
 * hand-editing JSON — and V3 of scripts/verify-ledger.mjs deep-compares state.runs[-1] against
 * RUN field by field, including exactly these three. History above this round's line is never
 * touched: the work-log rewrite is bounded to the last line, and the array splice to index -1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN, TRIED, WORK_LOG_LINE } from './round-facts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const STATE = path.join(LAB, 'state', 'state.json');
const LOG = path.join(LAB, 'records', 'work-log.md');

const state = JSON.parse(readFileSync(STATE, 'utf8'));
const last = state.runs[state.runs.length - 1];
if (last.time !== RUN.time || last.skill !== RUN.skill || last.scenario !== RUN.scenario) {
  console.error('last runs[] entry is not this round — refusing to refill someone else\'s row');
  process.exit(1);
}
state.runs[state.runs.length - 1] = RUN;
if (state.tried[state.tried.length - 1].skill !== TRIED.skill) {
  console.error('last tried[] entry is not this round — refusing to rewrite its conclusion');
  process.exit(1);
}
state.tried[state.tried.length - 1] = TRIED;
writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');

const lines = readFileSync(LOG, 'utf8').replace(/\n+$/, '').split('\n');
if (!lines[lines.length - 1]?.includes(TRIED.artifacts)) {
  console.error('work-log last line is not this round\'s — refusing to rewrite history');
  process.exit(1);
}
lines[lines.length - 1] = WORK_LOG_LINE;
writeFileSync(LOG, lines.join('\n') + '\n', 'utf8');
console.log(
  `refilled: runs[-1] ← RUN (artifact_size/cleanup/push), tried[-1] ← TRIED, work-log last line rewritten (${WORK_LOG_LINE.split(' | ').length} segments)`,
);
