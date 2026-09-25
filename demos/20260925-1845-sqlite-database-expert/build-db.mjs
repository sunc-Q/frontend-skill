// Builds lab.db: a SQLite database over THIS lab's own records (state.json runs + work-log/report lines),
// with a migration runner, FTS5 (two tokenizers for comparison), FK constraints and WAL.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const LAB = path.resolve(import.meta.dirname, '../..');
const DB = path.join(import.meta.dirname, 'lab.db');
for (const f of ['', '-wal', '-shm']) if (fs.existsSync(DB + f)) fs.unlinkSync(DB + f);

const db = new DatabaseSync(DB);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

const now = () => new Date().toISOString();

// ---- migration runner (skill §4.5) ----
db.exec(`CREATE TABLE IF NOT EXISTS _migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)`);
const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));

const migrations = [
  {
    name: '001_runs',
    up: () => db.exec(`
      CREATE TABLE runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill TEXT NOT NULL,
        source TEXT NOT NULL,
        task TEXT NOT NULL,
        verdict TEXT NOT NULL,
        artifact TEXT NOT NULL UNIQUE,
        at TEXT NOT NULL,
        seconds INTEGER CHECK(seconds > 0),
        push TEXT,
        CHECK(length(skill) > 0));
      CREATE INDEX idx_runs_skill ON runs(skill);`),
    down: () => db.exec('DROP TABLE IF EXISTS runs'),
  },
  {
    name: '002_notes_fts',
    up: () => db.exec(`
      CREATE TABLE notes(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc TEXT NOT NULL,
        src TEXT NOT NULL,
        lineno INTEGER NOT NULL,
        body TEXT NOT NULL,
        run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
        UNIQUE(src, lineno));
      CREATE VIRTUAL TABLE notes_tri USING fts5(
        body, content=notes, content_rowid=id, tokenize='trigram');
      CREATE VIRTUAL TABLE notes_u61 USING fts5(
        body, content=notes, content_rowid=id);
      CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_tri(rowid, body) VALUES (new.id, new.body);
        INSERT INTO notes_u61(rowid, body) VALUES (new.id, new.body);
      END;
      CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_tri(notes_tri, rowid, body) VALUES('delete', old.id, old.body);
        INSERT INTO notes_u61(notes_u61, rowid, body) VALUES('delete', old.id, old.body);
      END;
      CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_tri(notes_tri, rowid, body) VALUES('delete', old.id, old.body);
        INSERT INTO notes_tri(rowid, body) VALUES (new.id, new.body);
        INSERT INTO notes_u61(notes_u61, rowid, body) VALUES('delete', old.id, old.body);
        INSERT INTO notes_u61(rowid, body) VALUES (new.id, new.body);
      END;`),
    down: () => db.exec(`DROP TABLE IF EXISTS notes_u61; DROP TABLE IF EXISTS notes_tri;
                         DROP TABLE IF EXISTS notes;`),
  },
];

for (const m of migrations) {
  if (applied.has(m.name)) continue;
  db.exec('BEGIN');
  m.up();
  db.prepare('INSERT INTO _migrations(name, applied_at) VALUES(?,?)').run(m.name, now());
  db.exec('COMMIT');
  console.log(`applied ${m.name}`);
}

// ---- seed runs from state.json ----
const st = JSON.parse(fs.readFileSync(path.join(LAB, 'state/state.json'), 'utf8'));
const insRun = db.prepare(`INSERT INTO runs(skill,source,task,verdict,artifact,at,seconds,push)
  VALUES(?,?,?,?,?,?,?,?)`);
const byTime = new Map(st.runs.map((r) => [r.time, r]));
for (const t of st.tried) {
  const r = byTime.get(t.time) || {};
  insRun.run(t.skill, t.source, t.task || '', t.verdict || '',
    t.artifact, t.time, r.seconds || null, r.push ? 'yes' : null);
}
console.log(`seeded runs = ${db.prepare('SELECT count(*) c FROM runs').get().c}`);

// ---- seed notes from records/ and reports/ ----
let n = 0;
const insNote = db.prepare('INSERT OR IGNORE INTO notes(doc,src,lineno,body,run_id) VALUES(?,?,?,?,NULL)');
for (const [doc, rel] of [['worklog', 'records/work-log.md'],
  ...fs.readdirSync(path.join(LAB, 'reports')).filter((f) => f.endsWith('.md'))
    .map((f) => ['report', 'reports/' + f])]) {
  const p = path.join(LAB, rel);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (line.trim().length < 4) return;
    insNote.run(doc, rel, i + 1, line);
    n++;
  });
}
console.log(`seeded notes = ${n} / rows = ${db.prepare('SELECT count(*) c FROM notes').get().c}`);
console.log(`journal_mode = ${db.prepare('PRAGMA journal_mode').get().journal_mode}`);
db.close();
console.log('BUILD OK');
