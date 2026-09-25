/**
 * Takes the pre-write-back snapshot of the ledger, i.e. exactly the facts group I of
 * scripts/check-node.mjs later compares against. Run this BEFORE writing state/state.json.
 *   node scripts/ledger-snapshot.mjs
 * The snapshot stores hashes (not copies) of the long arrays so it stays small enough to ship.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = path.resolve(ROOT, '..', '..');
const state = JSON.parse(readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8'));
const log = readFileSync(path.join(LAB, 'records', 'work-log.md'), 'utf8');
const logLines = log.trimEnd().split('\n');

const sha = (v) => createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');
const shaOf = (key) => sha(state[key]);

const snap = {
  capturedAt: new Date().toISOString(),
  round: '20260926-07-frontend-development-admin',
  updated: state.updated,
  triedLen: state.tried.length,
  runsLen: state.runs.length,
  stylesLen: state.used_styles.length,
  envLen: state.environment_notes.length,
  seenLen: state.skills_seen.length,
  logLines: logLines.length,
  logSha: sha(logLines.join('\n') + '\n'),
  triedSha: shaOf('tried'),
  runsSha: shaOf('runs'),
  stylesSha: shaOf('used_styles'),
  envSha: shaOf('environment_notes'),
  usedStyles: state.used_styles,
  candidates: state.next_candidates,
  pristine: {
    tried: shaOf('tried'),
    runs: shaOf('runs'),
    used_styles: shaOf('used_styles'),
    environment_notes: shaOf('environment_notes'),
    skills_seen: shaOf('skills_seen'),
    next_candidates: shaOf('next_candidates'),
  },
};

const out = path.join(ROOT, 'scripts', 'ledger-snapshot.json');
const force = process.argv.includes('--force');
if (!force && existsSync(out)) {
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    previous = null;
  }
  if (previous && previous.triedLen !== snap.triedLen) {
    console.error(
      `refusing to overwrite snapshot: ledger moved since capture (${previous.triedLen} → ${snap.triedLen} tried) — pass --force only if you know why`,
    );
    process.exit(1);
  }
}
writeFileSync(out, JSON.stringify(snap, null, 1) + '\n', 'utf8');
console.log(
  `snapshot written: tried=${snap.triedLen} runs=${snap.runsLen} styles=${snap.stylesLen} env=${snap.envLen} seen=${snap.seenLen} log=${snap.logLines} updated=${snap.updated}`,
);
