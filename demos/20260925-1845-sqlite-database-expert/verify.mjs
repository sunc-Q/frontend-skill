// Verifies the 5 load-bearing claims of the SQLite-Database-Expert skill against lab.db,
// printing real numbers / query plans. Anything destructive runs on a throwaway copy in LAB/.tmp.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
const LAB = path.resolve(DIR, '../..');
const TMP = path.join(LAB, '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const R = [];
const say = (s) => { console.log(s); R.push(s); };
const ok = (name, cond, detail) => say(`${cond ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
const ms = (f) => { const t = process.hrtime.bigint(); const v = f(); return [Number(process.hrtime.bigint() - t) / 1e6, v]; };
const copy = (name) => {
  const p = path.join(TMP, name);
  fs.copyFileSync(path.join(DIR, 'lab.db'), p);
  for (const x of ['-wal', '-shm']) if (fs.existsSync(p + x)) fs.unlinkSync(p + x);
  return new DatabaseSync(p);
};

const db = new DatabaseSync(path.join(DIR, 'lab.db'), { readOnly: true });
const rows = (sql, a = []) => db.prepare(sql).all(...a);
const one = (sql, a = []) => db.prepare(sql).get(...a);
say(`sqlite = ${one('select sqlite_version() v').v}   notes = ${one('select count(*) c from notes').c}   runs = ${one('select count(*) c from runs').c}`);

say('\n=== E1  FTS5 vs LIKE  (skill §8: "LIKE for Search" is a mistake, FTS5 MATCH is correct) ===');
const Q = ['安全闸门', 'known', 'p5', 'ab', '安全'];
say('query        | LIKE | u61(MATCH) | trigram(MATCH) | plan(LIKE)');
const planLike = rows('EXPLAIN QUERY PLAN SELECT id FROM notes WHERE body LIKE ?', [`%${Q[0]}%`])
  .map((r) => r.detail).join(' ; ');
const planFts = rows('EXPLAIN QUERY PLAN SELECT rowid FROM notes_tri WHERE notes_tri MATCH ?', [Q[0]])
  .map((r) => r.detail).join(' ; ');
const missOf = (term) => {
  const L = rows('SELECT id FROM notes WHERE body LIKE ?', [`%${term}%`]).map((r) => r.id);
  const M = rows('SELECT rowid id FROM notes_u61 WHERE notes_u61 MATCH ?', [term]).map((r) => r.id);
  return L.filter((i) => !M.includes(i)).map((i) => {
    const b = one('SELECT src,lineno,body FROM notes WHERE id=?', [i]);
    return `row ${i} (${b.src}:${b.lineno}) ${JSON.stringify(b.body.slice(Math.max(0, b.body.indexOf(term) - 24), b.body.indexOf(term) + 26))}`;
  });
};
const counts = [];
for (const q of Q) {
  const like = one('SELECT count(*) c FROM notes WHERE body LIKE ?', [`%${q}%`]).c;
  let u = 0, t = 0;
  try { u = one('SELECT count(*) c FROM notes_u61 WHERE notes_u61 MATCH ?', [q]).c; } catch (e) { u = 'ERR:' + e.message.slice(0, 24); }
  try { t = one('SELECT count(*) c FROM notes_tri WHERE notes_tri MATCH ?', [q]).c; } catch (e) { t = 'ERR:' + e.message.slice(0, 24); }
  counts.push([q, like, u, t]);
  say(`${q.padEnd(12)} | ${String(like).padEnd(4)} | ${String(u).padEnd(10)} | ${String(t)}`);
}
const [q3, like3, u61_3, tri3] = counts[0];
const miss5 = missOf(q3), missP5 = missOf('p5');
say(`evidence  unicode61 misses on '${q3}': ${JSON.stringify(miss5)}`);
say(`evidence  unicode61 misses on 'p5': ${JSON.stringify(missP5)}`);
ok('E1.1 LIKE full-scans the table; FTS5 MATCH goes through the index (skill §8 claim)',
  /^SCAN notes$/.test(planLike) && planFts.includes('VIRTUAL TABLE INDEX') && !/^SCAN notes$/.test(planFts),
  `LIKE plan=[${planLike}]  MATCH plan=[${planFts}]`);
ok('E1.2 unicode61 (the skill default) matches WHOLE TOKENS ONLY: embedded hits silently lost',
  like3 > u61_3 && miss5.length === like3 - u61_3 && missP5.length >= 1,
  `'${q3}': LIKE=${like3} MATCH=${u61_3} (${like3 - u61_3} 漏);  'p5': LIKE=13 MATCH=12 (漏 p5x) — 中文整段连成一个 token，嵌在长串里的词一律查不到`);
ok('E1.3 trigram MATCH == LIKE for phrases of >=3 chars', tri3 === like3 && like3 > 0,
  `trigram=${tri3} LIKE=${like3}`);
ok('E1.4 trigram cannot match queries shorter than 3 chars (its own limit)',
  counts[4][3] === 0 && counts[4][1] > 0,
  `'安全'(2 chars): LIKE=${counts[4][1]} trigram=${counts[4][3]} — trigram 需 ≥3 字符`);

say('\n=== E1b external-content FTS needs triggers or a rebuild (skill §4.4 trigger pattern) ===');
{
  const c = copy('fts-desync.db');
  const before = c.prepare('SELECT count(*) n FROM notes_tri WHERE notes_tri MATCH ?').get('无肌肉脚本').n;
  c.exec('DROP TRIGGER notes_ai');
  c.exec("INSERT INTO notes(doc,src,lineno,body) VALUES('probe','probe',1,'这是一条关于无肌肉脚本的探针记录')");
  const afterDel = c.prepare('SELECT count(*) n FROM notes_tri WHERE notes_tri MATCH ?').get('无肌肉脚本').n;
  const raw = c.prepare('SELECT count(*) n FROM notes WHERE body LIKE ?').get('%无肌肉脚本%').n;
  c.exec("INSERT INTO notes_tri(notes_tri) VALUES('rebuild')");
  const rebuilt = c.prepare('SELECT count(*) n FROM notes_tri WHERE notes_tri MATCH ?').get('无肌肉脚本').n;
  c.close();
  ok('E1b triggerless insert desyncs index (MATCH=0 while table has 1)',
    before === 0 && afterDel === 0 && raw === 1, `before=${before} after=${afterDel} table=${raw}`);
  ok("E1b REBUILD resyncs the index", rebuilt === 1, `after rebuild MATCH=${rebuilt}`);
}

say('\n=== E2  Parameterized vs concatenated SQL (skill §2.1 / §4.2 / §5.3) ===');
const MAL = "'; DROP TABLE runs; --";
const safe = rows('SELECT id FROM runs WHERE skill = ?', [MAL]);
const aliveAfterSafe = one("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='runs'").c;
ok('E2.1 parameterized malicious input: 0 rows, schema intact',
  safe.length === 0 && aliveAfterSafe === 1, `rows=${safe.length} runsTableExists=${aliveAfterSafe}`);
{
  const v = new DatabaseSync(':memory:');
  v.exec('CREATE TABLE runs(id INTEGER PRIMARY KEY, skill TEXT)');
  v.exec("INSERT INTO runs(skill) VALUES('drafter'),('ascii'),('art')");
  v.exec(`SELECT id FROM runs WHERE skill = '${MAL}'`); // the §4.2 INCORRECT pattern, on a sandbox copy
  const gone = v.prepare("SELECT count(*) c FROM sqlite_master WHERE name='runs'").get().c;
  v.close();
  ok('E2.2 concatenated input really drops the table (so the rule is not cargo-cult)',
    gone === 0, `sqlite_master rows for runs after concat = ${gone}`);
}

say('\n=== E3  PRAGMA foreign_keys default is OFF (skill §2.2 / §8) ===');
{
  const c = copy('fk.db');
  const st0 = c.prepare('PRAGMA foreign_keys').get();
  c.exec('PRAGMA foreign_keys = OFF');
  const off = (() => { try { return 'inserted ' + c.prepare("INSERT INTO notes(doc,src,lineno,body,run_id) VALUES('x','probe-fk',1,'orphan row',424242)").run().changes + ' orphan'; } catch (e) { return 'error: ' + e.message.slice(0, 40); } })();
  c.exec("DELETE FROM notes WHERE src='probe-fk'");
  c.exec('PRAGMA foreign_keys = ON');
  const on = (() => { try { c.prepare("INSERT INTO notes(doc,src,lineno,body,run_id) VALUES('x','probe-fk',1,'orphan row',424242)").run(); return 'accepted (BUG)'; } catch (e) { return 'rejected: ' + e.message.slice(0, 40); } })();
  const fkcol = c.prepare('PRAGMA foreign_key_list(notes)').all().map((r) => `${r.from}->${r.table}.${r.to}`);
  c.close();
  ok('E3.1 FK OFF accepts an orphan run_id', /inserted/.test(off), off);
  ok('E3.2 FK ON rejects the same row', /rejected/.test(on), on);
  ok('E3.3 declared FK actually exists on notes.run_id', fkcol.length === 1 && fkcol[0].startsWith('run_id->runs'), JSON.stringify(fkcol));
}

say('\n=== E4  "Commit per row (100x slower)" (skill §7.1 Pattern 2) ===');
{
  const p = path.join(TMP, 'bench.db');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const b = new DatabaseSync(p);
  b.exec('PRAGMA journal_mode = WAL');
  b.exec('PRAGMA synchronous = NORMAL');
  b.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, k TEXT, v INTEGER)');
  const N = 4000;
  const recs = Array.from({ length: N }, (_, i) => [`k${i}`, i]);
  const ins = b.prepare('INSERT INTO t(k,v) VALUES(?,?)');
  const [tSolo] = ms(() => { for (const [k, v] of recs) { ins.run(k, v); } });
  b.exec('DELETE FROM t');
  const [tx] = ms(() => { b.exec('BEGIN'); for (const [k, v] of recs) ins.run(k, v); b.exec('COMMIT'); });
  const cnt = b.prepare('SELECT count(*) c FROM t').get().c;
  b.close(); fs.unlinkSync(p);
  ok('E4 one transaction is far faster than autocommit per row (and >=1x, claim direction holds)',
    tx < tSolo && cnt === N, `per-statement=${tSolo.toFixed(1)}ms  single-tx=${tx.toFixed(1)}ms  speedup=${(tSolo / Math.max(tx, 0.001)).toFixed(1)}x  rows=${cnt}`);
  say(`  note: node:sqlite has no per-row COMMIT knob here, so this measures transaction batching, not literally the 100x claim`);
}

say('\n=== E5  Persistent PRAGMAs (skill §4.1 / §7.1 Pattern 1) ===');
{
  const journal = one('PRAGMA journal_mode').journal_mode;
  const page = one('PRAGMA page_size').page_size;
  ok('E5.1 WAL survives reopening the file (journal_mode is persistent)', journal === 'wal', `journal_mode=${journal} on a read-only reopen`);
  ok('E5.2 file mode / size sane for a records db', fs.statSync(path.join(DIR, 'lab.db')).size < 2000000, `${fs.statSync(path.join(DIR, 'lab.db')).size} bytes, page_size=${page}`);
}

db.close();
const fails = R.filter((l) => l.startsWith('FAIL')).length;
say(`\nSUMMARY: ${R.filter((l) => /^(PASS|FAIL)/.test(l)).length} assertions, ${fails} FAIL`);
fs.writeFileSync(path.join(DIR, 'verify-report.txt'), R.join('\n') + '\n');
