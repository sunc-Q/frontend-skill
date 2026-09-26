// Independent Standard MIDI File parser + assertions against the composition the skill was fed.
// Also renders piano-roll.svg so the result is visible without a synth.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../../.skills/midi-agent-skill');
const MID_SRC = path.join(SKILL, 'output/skill-showcase-run-ledger-sonified.mid');
const ART = path.join(HERE, 'skill-showcase-run-ledger-sonified.mid');
const comp = JSON.parse(fs.readFileSync(path.join(HERE, 'composition.json'), 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(HERE, 'mapping.json'), 'utf8'));
const gm = JSON.parse(fs.readFileSync(path.join(HERE, 'gm-programs.json'), 'utf8'));

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const nameToMidi = (s) => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const midiToName = (m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
const nameToFreq = (s) => 440 * Math.pow(2, (nameToMidi(s) - 69) / 12);
const DUR = { 1: 4, 2: 2, d2: 3, 4: 1, d4: 1.5, 8: 0.5, d8: 0.75, 16: 0.25 };

function parse(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'MThd') throw new Error('no MThd');
  const headerLen = b.readUInt32BE(4);
  const format = b.readUInt16BE(8);
  const ntracks = b.readUInt16BE(10);
  const division = b.readUInt16BE(12);
  const tracks = [];
  let p = 8 + headerLen;
  for (let t = 0; t < ntracks; t++) {
    if (b.toString('ascii', p, p + 4) !== 'MTrk') throw new Error('no MTrk at track ' + t);
    const tlen = b.readUInt32BE(p + 4);
    const end = p + 8 + tlen;
    let q = p + 8;
    let tick = 0;
    let running = 0;
    const open = new Map();
    const notes = [];
    let name = '';
    let program = null;
    let tempo = null;
    while (q < end) {
      let delta = 0;
      let byte;
      do {
        byte = b[q++];
        delta = (delta << 7) | (byte & 0x7f);
      } while (byte & 0x80);
      tick += delta;
      let st = b[q];
      if (st < 0x80) st = running;
      else q++;
      running = st;
      const kind = st & 0xf0;
      if (st === 0xff) {
        const meta = b[q++];
        let l = 0;
        do {
          byte = b[q++];
          l = (l << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        const d = b.subarray(q, q + l);
        q += l;
        if (meta === 0x51 && l === 3) tempo = d.readUIntBE(0, 3);
        if (meta === 0x03) name = d.toString('latin1');
      } else if (st === 0xf0 || st === 0xf7) {
        let l = 0;
        do {
          byte = b[q++];
          l = (l << 7) | (byte & 0x7f);
        } while (byte & 0x80);
        q += l;
      } else if (kind === 0xc0) {
        program = b[q++];
      } else if (kind === 0x90 || kind === 0x80) {
        const pitch = b[q++];
        const val = b[q++];
        const ch = st & 0x0f;
        if (kind === 0x90 && val > 0) open.set(ch + ':' + pitch, { tick, velocity: val, ch });
        else {
          const o = open.get(ch + ':' + pitch);
          if (o) {
            notes.push({ midi: pitch, startTick: o.tick, endTick: tick, channel: ch, velocity: o.velocity });
            open.delete(ch + ':' + pitch);
          }
        }
      } else if (kind === 0xa0 || kind === 0xb0 || kind === 0xd0 || kind === 0xe0) {
        q += 2;
      }
    }
    notes.sort((x, y) => x.startTick - y.startTick || x.midi - y.midi);
    tracks.push({ name, notes, program, channel: notes.length ? notes[0].channel : null, tempo });
    p = end;
  }
  return { format, ntracks, division, tracks, bytes: b.length, sha: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16) };
}

// all simultaneous cross-track pairs whose semitone distance is exactly 1
function semitonePairs(f) {
  const ev = [];
  f.tracks.forEach((t, ti) => t.notes.forEach((n) => ev.push({ ...n, ti })));
  const bad = [];
  for (let i = 0; i < ev.length; i++)
    for (let j = i + 1; j < ev.length; j++) {
      const a = ev[i], b = ev[j];
      if (a.ti === b.ti) continue;
      const ov = Math.min(a.endTick, b.endTick) - Math.max(a.startTick, b.startTick);
      if (ov > 0 && Math.abs(a.midi - b.midi) === 1) bad.push([midiToName(a.midi), midiToName(b.midi), a.ti]);
    }
  return bad;
}

const music = (x) => x.tracks.filter((t) => t.notes.length);
const R = [];
const ok = (id, msg, pass, detail = '') => R.push({ id, msg, pass: !!pass, detail });

const f = parse(MID_SRC);
// midiutil prepends its own tempo-only track, so music tracks are the ones carrying notes
const M = f.tracks.filter((t) => t.notes.length);
const tempoTrack = f.tracks.find((t) => t.tempo !== null);
const beats = (t) => t / f.division;

ok('A1', `SMF header parsed by hand: format=${f.format} ntracks=${f.ntracks} division=${f.division} bytes=${f.bytes}`, f.format === 1 && f.ntracks === 5 && f.division === 960 && M.length === 4 && tempoTrack !== undefined);
ok('A2', `track names carried the instrument ids: ${M.map((t) => t.name).join(' | ')}`, M[0].name === 'celesta' && M[1].name === 'string-ensemble-1' && M[3].name === 'acoustic-bass');
const chans = M.map((t) => t.channel);
ok('A3', `channels ${chans.join(',')} all distinct and none is 9 (GM drums)`, new Set(chans).size === 4 && !chans.includes(9));
const progs = M.map((t) => t.program);
const wantProgs = comp.tracks.map((t) => gm[t.instrument]);
ok('A4', `GM program changes ${progs.join(',')} == skill resolver output ${wantProgs.join(',')}`, JSON.stringify(progs) === JSON.stringify(wantProgs));

const mel = M[0].notes;
const wantMel = comp.tracks[0].notes.map((n, i) => ({ midi: nameToMidi(n.pitch), start: i, dur: DUR[n.duration] }));
const melGood = mel.length === wantMel.length && mel.every((n, i) => n.midi === wantMel[i].midi && beats(n.startTick) === wantMel[i].start && beats(n.endTick - n.startTick) === wantMel[i].dur);
ok('A5', `melody: ${mel.length} notes == 18 lab rounds, each pitch/start/length matches mapping.json (pentatonic ladder ${map.lo}s..${map.hi}s -> ${map.steps[0]}..${map.steps[map.steps.length - 1]})`, melGood, melGood ? '' : JSON.stringify({ got: mel.map((n) => [n.midi, beats(n.startTick)]), want: wantMel.map((n) => [n.midi, n.start]) }));
const gapIdx = map.rounds.findIndex((r) => r.gap);
const gapRound = map.rounds[gapIdx];
ok('A6', `the one round with no recorded seconds (#${gapRound.no} ${gapRound.skill}) sits on the gap note ${gapRound.pitch} = MIDI ${mel[gapIdx].midi}, velocity ${mel[gapIdx].velocity}`, gapRound.pitch === map.gapNote && mel[gapIdx].midi === nameToMidi(map.gapNote) && mel[gapIdx].velocity === 100);

const bed = M.slice(1).map((t) => t.notes.map((n) => ({ midi: n.midi, dur: beats(n.endTick - n.startTick) })));
ok('A7', `3 accompaniment tracks x ${bed[0].length} chord-group notes, beat lengths ${bed[0].map((n) => n.dur).join('/')}`, bed.every((b) => b.length === 5 && JSON.stringify(b.map((n) => n.dur)) === JSON.stringify([4, 4, 4, 4, 2])));
const totalBeats = Math.max(...M.map((t) => Math.max(...t.notes.map((n) => beats(n.endTick)))));
const usq = M[0].tempo ?? tempoTrack.tempo; // midiutil also emits its own tempo track
ok('A8', `tempo meta=${usq} us/beat = ${(60000000 / usq).toFixed(0)} BPM, piece ${totalBeats} beats = ${((totalBeats * usq) / 1000000).toFixed(2)}s`, usq === 625000 && totalBeats === 18);

const bad = semitonePairs(f);
ok('A9', `skill rule 1 (never 1 semitone apart): ${bad.length} simultaneous semitone pairs across ${M.length} tracks / ${mel.length + bed.flat().length} notes`, bad.length === 0, JSON.stringify(bad.slice(0, 3)));

const bassNotes = M[3].notes;
const roots = M[1].notes;
const fifths = M[2].notes;
const bassBad = bassNotes.map((n, i) => (n.midi % 12 === roots[i].midi % 12 || n.midi % 12 === fifths[i].midi % 12 ? null : i)).filter((x) => x !== null);
ok('A10', `skill rule 2 (bass = root or fifth): bass ${bassNotes.map((n) => midiToName(n.midi)).join(',')} over chords ${roots.map((n, i) => midiToName(n.midi) + '+' + midiToName(fifths[i].midi)).join(' / ')}`, bassBad.length === 0);
const rootFifthBad = roots.map((r, i) => ([0, 7].includes((fifths[i].midi - r.midi + 12) % 12) ? null : i)).filter((x) => x !== null);
ok('A11', `each chord bed is an exact root+fifth dyad (intervals ${roots.map((r, i) => (fifths[i].midi - r.midi)).join(',')})`, rootFifthBad.length === 0);

const pairs = [];
M[0].notes.forEach((m) => {
  M.slice(1).forEach((t) => {
    t.notes.forEach((a) => {
      const ov = Math.min(m.endTick, a.endTick) - Math.max(m.startTick, a.startTick);
      if (ov > 0) pairs.push({ d: m.midi - a.midi, a: midiToName(a.midi), m: midiToName(m.midi) });
    });
  });
});
const minSpread = Math.min(...pairs.map((p) => p.d));
const tightest = pairs.find((p) => p.d === minSpread);
ok('A12', `skill rule 3 (spread voices): ${pairs.length} simultaneous melody/accompaniment pairs, closest = ${minSpread} semitones (${tightest.a} under ${tightest.m}); melody register C5-A6 vs accompaniment C2-D4`, minSpread >= 4, JSON.stringify(tightest));

// ---------- piano roll SVG ----------
const W = 1180, ROWH = 30, TOP = 52, LEFT = 66;
const loMidi = Math.min(...M.flatMap((t) => t.notes.map((n) => n.midi)));
const hiMidi = Math.max(...M.flatMap((t) => t.notes.map((n) => n.midi)));
const H = TOP + (hiMidi - loMidi + 1) * ROWH + 78;
const xOf = (bb) => LEFT + (bb / totalBeats) * (W - LEFT - 26);
const yOf = (m) => TOP + (hiMidi - m) * ROWH;
const COL = ['#c9463d', '#2f5d8a', '#5b8bb0', '#1b1b1d'];
const LEG = ['celesta: seconds per round', 'strings root', 'strings fifth', 'bass'];
const rows = [];
for (let m = hiMidi; m >= loMidi; m--) {
  const pc = m % 12;
  rows.push(`<rect x="0" y="${yOf(m)}" width="${W}" height="${ROWH}" fill="${[1, 3, 6, 8, 10].includes(pc) ? '#e7e0d3' : '#f6f1e7'}"/><text x="10" y="${yOf(m) + ROWH - 9}" font-size="11" fill="#8c8474">${midiToName(m)}</text><line x1="${LEFT}" y1="${yOf(m) + ROWH}" x2="${W}" y2="${yOf(m) + ROWH}" stroke="#ded6c6"/>`);
}
const bars = Array.from({ length: totalBeats + 1 }, (_, i) => `<line x1="${xOf(i)}" y1="${TOP}" x2="${xOf(i)}" y2="${H - 62}" stroke="${i % 4 === 0 ? '#a89e8a' : '#e0d8c8'}" stroke-width="${i % 4 === 0 ? 1.6 : 1}"/>`).join('');
const roundLabels = map.rounds.map((r, i) => `<text x="${xOf(i) + 5}" y="${H - 46}" font-size="10" fill="#6f6858">#${i + 1}${r.seconds ? ':' + r.seconds : ':n/a'}</text>`).join('');
const rects = M
  .flatMap((t, ti) => t.notes.map((n) => `<rect x="${xOf(beats(n.startTick))}" y="${yOf(n.midi) + 3}" width="${Math.max(6, xOf(beats(n.endTick)) - xOf(beats(n.startTick)) - 4)}" height="${ROWH - 6}" rx="5" fill="${COL[ti]}" opacity="${ti === 0 ? 1 : 0.75}"/>`))
  .join('');
const legend = LEG.map((l, i) => `<rect x="${LEFT + i * 250}" y="${H - 28}" width="15" height="15" fill="${COL[i]}"/><text x="${LEFT + i * 250 + 21}" y="${H - 16}" font-size="12" fill="#1b1b1d">${l}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, Menlo, monospace">
<rect width="${W}" height="${H}" fill="#f6f1e7"/>
<text x="18" y="24" font-size="18" fill="#1b1b1d">Skill Showcase 18 runs sonified &#183; 96 BPM &#183; 18 beats &#183; C pentatonic</text>
<text x="18" y="42" font-size="12" fill="#6f6858">round #N:seconds under each beat &#183; generated by midi-agent-skill from composition.json</text>
${rows.join('')}${bars}${roundLabels}${rects}${legend}</svg>`;
fs.writeFileSync(path.join(HERE, 'piano-roll.svg'), svg);
const rectCount = (svg.match(/rx="5"/g) || []).length;
ok('A13', `piano-roll.svg: ${rectCount} note rects (== ${mel.length + bed.flat().length} parsed notes), range ${midiToName(loMidi)}..${midiToName(hiMidi)}, ${W}x${H}`, rectCount === mel.length + bed.flat().length);

const r15 = map.rounds.find((r) => r.seconds === map.hi);
const r18 = map.rounds.find((r) => r.seconds === map.lo);
ok('A14', `pitch order sanity: longest round #${r15.no} (${r15.seconds}s, ${r15.skill}) = ${r15.pitch} ${nameToFreq(r15.pitch).toFixed(2)}Hz > shortest #${r18.no} (${r18.seconds}s, ${r18.skill}) = ${r18.pitch} ${nameToFreq(r18.pitch).toFixed(2)}Hz`, nameToMidi(r15.pitch) > nameToMidi(r18.pitch));

// ---------- mutations ----------
function regen(mutator, tag) {
  const c = JSON.parse(JSON.stringify(comp));
  mutator(c);
  const tmp = path.join(HERE, `.mut-${tag}.json`);
  fs.writeFileSync(tmp, JSON.stringify(c));
  execFileSync('python3', [path.join(HERE, 'gen.py'), SKILL, tmp], { stdio: 'pipe' });
  fs.unlinkSync(tmp);
  return parse(MID_SRC);
}
const m1 = regen((c) => { c.tracks[0].notes[9].pitch = 'A5'; }, 'M1');
const m1diff = music(m1)[0].notes.map((n, i) => (n.midi === wantMel[i].midi ? null : i)).filter((x) => x !== null);
ok('M1', `mutation "round #10 pitch -> A5": bytes ${m1.bytes} (golden ${f.bytes}), sha ${m1.sha}, differs at melody idx ${JSON.stringify(m1diff)} and nowhere else; A5 catches it`, m1diff.length === 1 && m1diff[0] === 9 && m1.sha !== f.sha);
const m2 = regen((c) => { c.tracks[3].notes[0].pitch = 'C#3'; }, 'M2');
const bad2 = semitonePairs(m2);
ok('M2', `mutation "bass of chord group 1 -> C#3" (a semitone under the strings root C3): detector now reports ${bad2.length} (${JSON.stringify(bad2)}) so A9 is falsifiable`, bad2.length > 0);
const m3 = regen((c) => { c.bpm = 90; }, 'M3');
ok('M3', `mutation "bpm 96 -> 90": parsed tempo meta ${(m3.tracks.find((t) => t.tempo !== null) || { tempo: null }).tempo} us (golden ${usq}) so A8 is falsifiable`, ((m3.tracks.find((t) => t.tempo !== null) || { tempo: null }).tempo) !== usq);
const golden = regen(() => {}, 'restore');
ok('R1', `regenerated golden reproduces byte-identical file: sha ${golden.sha} == ${f.sha}`, golden.sha === f.sha && golden.bytes === f.bytes);
fs.copyFileSync(MID_SRC, ART);
ok('A15', `artifact archived into demos/: ${path.basename(ART)} ${fs.statSync(ART).size}B sha256:${crypto.createHash('sha256').update(fs.readFileSync(ART)).digest('hex').slice(0, 16)}`, fs.statSync(ART).size === f.bytes);

const pass = R.filter((r) => r.pass).length;
const log = R.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id.padEnd(4)} ${r.msg}${r.pass || !r.detail ? '' : '\n     got ' + r.detail}`).join('\n');
fs.writeFileSync(
  path.join(HERE, 'output.log'),
  `midi-generation verification — 2026-09-26\ninput composition.json (4 tracks / ${mel.length + bed.flat().length} notes, 96 BPM) -> skill scripts skills/{normalize,refine,generate}_*.py -> ${path.basename(ART)} ${f.bytes}B\n\n${log}\n\n${pass}/${R.length} PASS, ${R.length - pass} FAIL\n`
);
console.log(log + `\n\n${pass}/${R.length} PASS`);
process.exit(pass === R.length ? 0 : 1);
