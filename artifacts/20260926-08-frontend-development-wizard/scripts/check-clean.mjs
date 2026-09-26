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

const banned = ['node_modules', 'dist', 'dist-plain', 'dist-split', '.tmp-check'];
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
const stray = allFiles.filter((f) => {
  const b = path.basename(f);
  return /\.(log|dbg\d*\.mjs)$/.test(b) || b.startsWith('.tmp-') || /(^|\/)\.(dbg|smoke|probe)/.test(path.relative(ROOT, f));
});
chk('C2 无日志与临时探针残留（探针内容应已转写进报告）', stray.length === 0, stray.join(','));
chk('C3 预览形态：3 个单文件 HTML', readdirSync(path.join(ROOT, 'preview')).length === 3, readdirSync(path.join(ROOT, 'preview')).join(','));
for (const p of meta.pages) {
  const f = path.join(ROOT, p.file);
  chk(`C4 ${p.file} 仍存在且字节与 build-inline-meta 一致`, existsSync(f) && statSync(f).size === p.bytes,
    `${existsSync(f) ? statSync(f).size : 'missing'} vs ${p.bytes}`);
}
const total = allFiles.reduce((s, f) => s + statSync(f).size, 0);
chk('C5 场景目录 ≤50MB', total <= 50 * 1024 * 1024, `${(total / 1024 / 1024).toFixed(2)}MB / ${allFiles.length} 文件`);
/* No index.html here on purpose: all three builds take src/main.tsx as the Vite input, so the
   root HTML file is the generated comparison page and a rerun of verify.sh cannot overwrite it. */
chk('C6 复现所需文件齐备（配置 + lock + 校验脚本 + 台账锁）',
  ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vite.control.config.ts', 'vite.split.config.ts', 'styles.html', '.npmrc']
    .every((f) => existsSync(path.join(ROOT, f))), 'root files');
for (const s of ['verify.sh', 'check-node.mjs', 'check-dom.mjs', 'check-browser.mjs', 'make-styles.mjs', 'round-facts.mjs', 'ledger-snapshot.json', 'build-inline.mjs', 'verify-ledger.mjs', 'ledger-refill.mjs']) {
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
chk('C8 源码完整（35 个 .ts/.tsx，与 J1 的文件数一致）', srcTs.length === 35, `${srcTs.length} 个`);

/* every script that survives cleanup must be reachable: either verify.sh names it (as a step or as
   one of the post-cleanup / ledger cards) or another script imports it. This caught verify.sh's cards
   lagging behind verify-ledger.mjs and ledger-refill.mjs — a round can only be reproduced if the
   rebuild document lists every card, including the ones that cannot run in the same pass. */
const verifySh = readFileSync(path.join(ROOT, 'scripts', 'verify.sh'), 'utf8');
// verify.sh is the card itself; it cannot name itself
const scriptFiles = readdirSync(path.join(ROOT, 'scripts')).filter((f) => /\.(mjs|sh)$/.test(f) && f !== 'verify.sh');
const importedElsewhere = (f) =>
  scriptFiles.some((g) => g !== f && readFileSync(path.join(ROOT, 'scripts', g), 'utf8').includes(`./${f}`));
const orphans = scriptFiles.filter((f) => !verifySh.includes(`scripts/${f}`) && !importedElsewhere(f));
chk('C9 无孤儿脚本（每个保留脚本都被 verify.sh 的某张卡点名或被其它脚本 import）', orphans.length === 0,
  `共 ${scriptFiles.length} 个脚本，孤儿：${orphans.join(', ') || '无'}`);

const failed = rows.filter((r) => !r.cond);
console.log(`check-clean: ${rows.length - failed.length}/${rows.length} assertions passed`);
if (failed.length) process.exit(1);
