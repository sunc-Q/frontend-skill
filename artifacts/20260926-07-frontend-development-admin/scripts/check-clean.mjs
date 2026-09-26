/**
 * Post-cleanup lock (run AFTER verify.sh and after node_modules/dist/dist-split/.tmp-check are deleted).
 *   node scripts/check-clean.mjs
 * It exists because the verification checks *need* their build outputs, so "the shipped scene
 * directory carries no intermediates" cannot be asserted in the same pass — this is the second half.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'build-inline-meta.json'), 'utf8'));
const rows = [];
const chk = (id, cond, detail) => {
  rows.push({ id, cond: cond === true, detail: String(detail) });
  if (cond !== true) console.log(`FAIL ${id} ${detail}`);
};

const banned = ['node_modules', 'dist', 'dist-split', '.tmp-check'];
chk('C1 目录内无构建/依赖中间物', banned.every((d) => !existsSync(path.join(ROOT, d))),
  banned.filter((d) => existsSync(path.join(ROOT, d))).join(',') || 'clean');

const allFiles = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else allFiles.push(f);
  }
};
walk(ROOT);
const stray = allFiles.filter((f) => /\.(log|dbg\d*\.mjs)$/.test(path.basename(f)) || /(^|\/)\.(dbg|smoke|probe)/.test(path.relative(ROOT, f)));
chk('C2 无日志与临时探针残留（探针内容应已转写进报告）', stray.length === 0, stray.join(','));
chk('C3 预览形态：3 个单文件 HTML', readdirSync(path.join(ROOT, 'preview')).length === 3, readdirSync(path.join(ROOT, 'preview')).join(','));
for (const p of meta.pages) {
  const f = path.join(ROOT, p.file);
  chk(`C4 ${p.file} 仍存在且字节与 build-inline-meta 一致`, existsSync(f) && statSync(f).size === p.bytes,
    `${existsSync(f) ? statSync(f).size : 'missing'} vs ${p.bytes}`);
}
const total = allFiles.reduce((s, f) => s + statSync(f).size, 0);
chk('C5 场景目录 ≤50MB', total <= 50 * 1024 * 1024, `${(total / 1024 / 1024).toFixed(2)}MB / ${allFiles.length} 文件`);
chk('C6 复现所需文件齐备（配置 + lock + 校验脚本 + 台账锁）',
  ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vite.split.config.ts', 'index.html', '.npmrc']
    .every((f) => existsSync(path.join(ROOT, f))), 'root files');
for (const s of ['verify.sh', 'check-node.mjs', 'check-dom.mjs', 'check-browser.mjs', 'make-styles.mjs', 'round-facts.mjs', 'ledger-snapshot.json', 'build-inline.mjs', 'verify-ledger.mjs']) {
  chk(`C7 scripts/${s} 在位`, existsSync(path.join(ROOT, 'scripts', s)), s);
}
const srcTs = [];
const walkSrc = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(f);
    else if (/\.tsx?$/.test(e.name)) srcTs.push(f);
  }
};
walkSrc(path.join(ROOT, 'src'));
chk('C8 源码完整（50 个 .ts/.tsx）', srcTs.length === 50, `${srcTs.length} 个`);

const failed = rows.filter((r) => !r.cond);
console.log(`check-clean: ${rows.length - failed.length}/${rows.length} assertions passed`);
if (failed.length) process.exit(1);
