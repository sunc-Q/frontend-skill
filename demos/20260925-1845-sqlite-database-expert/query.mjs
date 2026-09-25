// Search CLI over this lab's records: node query.mjs "关键词" [max]
// Picks the tokenizer by query length (trigram needs >=3 chars) and falls back to LIKE,
// prints source:line + highlighted snippet, ranked by FTS5 bm25.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const [term = '安全闸门', argMax = '5'] = process.argv.slice(2);
const max = Number(argMax);
const db = new DatabaseSync(path.join(import.meta.dirname, 'lab.db'), { readOnly: true });
const trigram = [...term].length >= 3;
const sql = trigram
  ? `SELECT n.src, n.lineno, highlight(notes_tri, 0, '[', ']') AS snip, bm25(notes_tri) AS rank
     FROM notes_tri JOIN notes n ON n.id = notes_tri.rowid
     WHERE notes_tri MATCH ? ORDER BY rank LIMIT ?`
  : `SELECT src, lineno, replace(body, ?, '[' || ? || ']') AS snip, 0 AS rank
     FROM notes WHERE body LIKE ? ORDER BY src, lineno LIMIT ?`;
const args = trigram ? [`"${term}"`, max] : [term, term, `%${term}%`, max];
const hits = db.prepare(sql).all(...args);
console.log(`query="${term}"  engine=${trigram ? 'FTS5 trigram + bm25' : 'LIKE (query <3 chars)'}  hits=${hits.length}`);
for (const h of hits) console.log(`  ${h.src}:${h.lineno}  ${h.snip.slice(0, 190)}`);
