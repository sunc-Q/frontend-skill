// skill §7.1 Pattern 5 (idle-time maintenance) run on the finished artifact db
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const p = fileURLToPath(new URL('./lab.db', import.meta.url));
const before = fs.statSync(p).size;
const db = new DatabaseSync(p);
db.exec('PRAGMA optimize');
const freelist = db.prepare('PRAGMA freelist_count').get().freelist_count;
db.exec('VACUUM');
db.exec('PRAGMA journal_mode = WAL');
db.close();
console.log(`size ${before} -> ${fs.statSync(p).size} bytes, freelist_count=${freelist}, journal_mode 重新确认为 WAL`);
