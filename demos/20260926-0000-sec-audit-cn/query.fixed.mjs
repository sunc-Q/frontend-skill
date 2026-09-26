// 修复版检索 CLI（sec-audit-cn 第 8 轮 PoC-C 的补丁演示）：
// 1) 查询串做长度上限 + FTS5 元字符转义（双写 " 使其成为短语字面量），杜绝语法注入与逻辑改写；
// 2) max 显式校验为 [1,50] 整数，NaN/负数不再进绑定；
// 3) SQLite 异常统一收敛为固定文案 + 退出码 2，不再把源码路径/SQL/栈打到 stderr。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const MAX_LEN = 128, MAX_ROWS_CAP = 50;
const fail = (msg) => { console.log('search failed: ' + msg); process.exit(2); };

const [rawTerm = '安全闸门', rawMax = '5'] = process.argv.slice(2);
if (typeof rawTerm !== 'string' || rawTerm.length === 0) fail('empty query');
if (rawTerm.length > MAX_LEN) fail('query too long');
if (/[\u0000-\u001f\u007f]/.test(rawTerm)) fail('control character in query');
const term = rawTerm.replace(/"/g, '');                       // 短语边界不允许由输入决定
if (!term) fail('query has no searchable characters');

const nmax = Number(rawMax);
if (!Number.isInteger(nmax)) fail('limit must be an integer');
const max = Math.min(Math.max(nmax, 1), MAX_ROWS_CAP);

const db = new DatabaseSync(path.join(import.meta.dirname, 'lab.db'), { readOnly: true });
const trigram = [...term].length >= 3;
const sql = trigram
  ? `SELECT n.src, n.lineno, highlight(notes_tri, 0, '[', ']') AS snip, bm25(notes_tri) AS rank
     FROM notes_tri JOIN notes n ON n.id = notes_tri.rowid
     WHERE notes_tri MATCH ? ORDER BY rank LIMIT ?`
  : `SELECT src, lineno, replace(body, ?, '[' || ? || ']') AS snip, 0 AS rank
     FROM notes WHERE body LIKE ? ORDER BY src, lineno LIMIT ?`;
const phrase = `"${term}"`;                                  // 引号已在前面剥除，这里把输入整体当字面短语，操作符不再有意义
const args = trigram ? [phrase, max] : [term, term, `%${term}%`, max];
let hits;
try { hits = db.prepare(sql).all(...args); }
catch (e) { fail('query engine error'); }                        // e.message 含 SQL/表名/路径，不外泄
console.log(`query="${term}"  engine=${trigram ? 'FTS5 trigram + bm25' : 'LIKE (query <3 chars)'}  hits=${hits.length}`);
for (const h of hits) console.log(`  ${h.src}:${h.lineno}  ${h.snip.slice(0, 190)}`);
