// Builds the composition JSON from this lab's own run ledger (state.json).
// Round duration (seconds) -> C-major pentatonic pitch; nothing here writes MIDI.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, '..', '..');
const runs = JSON.parse(fs.readFileSync(path.join(LAB, 'state', 'state.json'), 'utf8')).runs;

const STEPS = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'G6', 'A6'];
const known = runs.filter((r) => typeof r.seconds === 'number').map((r) => r.seconds);
const lo = Math.min(...known);
const hi = Math.max(...known);
const GAP = 'C5'; // the one round whose duration was never recorded

const melody = runs.map((r) => {
  if (typeof r.seconds !== 'number') return { pitch: GAP, duration: '4', _gap: true };
  const idx = Math.min(STEPS.length - 1, Math.floor(((r.seconds - lo) / (hi - lo)) * STEPS.length));
  return { pitch: STEPS[idx], duration: '4', _gap: false };
});

// Chord bed: I-vi-IV-V-I over rounds 1-4 | 5-8 | 9-12 | 13-16 | 17-18 (4+4+4+4+2 = 18 beats).
// One voice per track, because generate_midi.py runs each track's notes sequentially.
const GROUPS = [
  { end: 4, dur: '1', root: 'C3', fifth: 'G3', bass: 'C2' },
  { end: 8, dur: '1', root: 'A2', fifth: 'E3', bass: 'A2' },
  { end: 12, dur: '1', root: 'F3', fifth: 'C4', bass: 'F2' },
  { end: 16, dur: '1', root: 'G3', fifth: 'D4', bass: 'G2' },
  { end: 18, dur: '2', root: 'C3', fifth: 'G3', bass: 'C2' },
];
const seq = (key) => GROUPS.map((g) => ({ pitch: g[key], duration: g.dur }));

const composition = {
  title: 'skill-showcase-run-ledger-sonified',
  bpm: 96,
  tracks: [
    { instrument: 'celesta', notes: melody.map(({ pitch, duration }) => ({ pitch, duration })) },
    { instrument: 'string-ensemble-1', notes: seq('root') },
    { instrument: 'string-ensemble-1', notes: seq('fifth') },
    { instrument: 'acoustic-bass', notes: seq('bass') },
  ],
};

fs.writeFileSync(path.join(HERE, 'composition.json'), JSON.stringify(composition, null, 2) + '\n');
fs.writeFileSync(
  path.join(HERE, 'mapping.json'),
  JSON.stringify(
    {
      lo,
      hi,
      steps: STEPS,
      gapNote: GAP,
      groups: GROUPS.map((g, i) => ({
        no: i + 1,
        rounds: `${i === 0 ? 1 : GROUPS[i - 1].end + 1}-${g.end}`,
        root: g.root,
        fifth: g.fifth,
        bass: g.bass,
      })),
      rounds: runs.map((r, i) => ({ no: i + 1, skill: r.skill, seconds: r.seconds ?? null, pitch: melody[i].pitch, gap: !!melody[i]._gap })),
    },
    null,
    2
  ) + '\n'
);
console.log(`wrote composition.json: ${melody.length} melody notes over seconds ${lo}..${hi}, ${composition.tracks.length} tracks`);
