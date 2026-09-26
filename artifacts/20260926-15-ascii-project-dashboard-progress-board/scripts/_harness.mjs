#!/usr/bin/env node
// 断言小工具：每条断言都有 id/组/文案，读数落 .tmp-check/assertions-<card>.json，供 styles.html 与报告现取。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUND = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(ROUND, '.tmp-check'), { recursive: true });

export function makeCard(card) {
  const rows = [];
  const api = {
    ok(id, desc, cond, detail = '') {
      rows.push({ id, desc, pass: !!cond, detail: String(detail).slice(0, 400) });
      return api;
    },
    eq(id, desc, got, want) {
      const pass = JSON.stringify(got) === JSON.stringify(want);
      rows.push({ id, desc, pass, detail: pass ? `= ${JSON.stringify(got)}` : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}` });
      return api;
    },
    done() {
      const fail = rows.filter((r) => !r.pass);
      for (const r of rows) {
        process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'} ${r.id.padEnd(7)} ${r.desc}${r.detail ? '  [' + r.detail + ']' : ''}\n`);
      }
      writeFileSync(join(ROUND, '.tmp-check', `assertions-${card}.json`), JSON.stringify({ card, rows, printed_at: new Date().toISOString() }, null, 1));
      console.log(`\n[${card}] ${rows.length - fail.length}/${rows.length} 通过`);
      if (fail.length) {
        console.log(`[${card}] 失败：${fail.map((f) => f.id).join(' ')}`);
        process.exitCode = 1;
      }
      return rows;
    },
  };
  return api;
}
