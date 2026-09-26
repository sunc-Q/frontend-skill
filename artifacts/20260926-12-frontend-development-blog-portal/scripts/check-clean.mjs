/**
 * Post-cleanup lock (run AFTER verify.sh and after node_modules, the five dist* trees, .tmp-check
 * and the esbuild fact bundle are deleted).
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

const banned = [
  'node_modules', 'dist', 'dist-nomemo', 'dist-novirtual', 'dist-unstablekey', 'dist-split',
  '.tmp-check', '.npm-install.log', path.join('scripts', '.facts.mjs'), path.join('scripts', '.facts-entry.mjs'),
];
chk('C1 目录内无构建/依赖/事实源桥中间物', banned.every((d) => !existsSync(path.join(ROOT, d))),
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
/* Seven HTML files survive, and each has a different job: three are the deliverable skins
   (double-clickable, IIFE, zero external references), three are the ablation arms used by group N,
   one is the ES-module host that group G loads over http:// with the real chunk graph. */
const preview = readdirSync(path.join(ROOT, 'preview')).sort();
const DELIVERABLE = ['portal-clay-stop.html', 'portal-topo-tactical.html', 'portal-vinyl-crate.html'];
const ARMS = ['arm-nomemo.html', 'arm-novirtual.html', 'arm-unstablekey.html'];
chk('C3a 三个交付页仍在且形态未变（单文件 HTML）', DELIVERABLE.every((f) => preview.includes(f)), preview.join(','));
chk('C3b 消融臂宿主与证据构建宿主各自在位（N/G 两组要能重放）', [...ARMS, 'split-host.html'].every((f) => preview.includes(f)), preview.join(','));
chk('C3c preview 目录恰好 7 个文件（没有多余的构建残留物混进来）', preview.length === 7, `${preview.length}：${preview.join(',')}`);
for (const p of meta.pages) {
  const f = path.join(ROOT, p.file);
  chk(`C4 ${p.file} 仍存在且字节与 build-inline-meta 一致`, existsSync(f) && statSync(f).size === p.bytes,
    `${existsSync(f) ? statSync(f).size : 'missing'} vs ${p.bytes}`);
}
for (const p of meta.armPages ?? []) {
  const f = path.join(ROOT, p.file);
  chk(`C4b ${p.file} 仍存在且字节与 build-inline-meta 一致`, existsSync(f) && statSync(f).size === p.bytes,
    `${existsSync(f) ? statSync(f).size : 'missing'} vs ${p.bytes}`);
}
const total = allFiles.reduce((s, f) => s + statSync(f).size, 0);
chk('C5 场景目录 ≤50MB', total <= 50 * 1024 * 1024, `${(total / 1024 / 1024).toFixed(2)}MB / ${allFiles.length} 文件`);
/* No index.html here on purpose: all five builds take src/main.tsx as the Vite input, so the
   root HTML file is the generated comparison page and a rerun of verify.sh cannot overwrite it.
   There is no .css file either — every rule ships as a string from src/lib/style/registry.ts,
   which is what lets the skin swap happen at runtime instead of at build time. */
chk('C6 复现所需文件齐备（配置 + lock + mock origin + 样式注册表 + 校验脚本 + 台账锁）',
  ['package.json', 'package-lock.json', 'tsconfig.json', '.npmrc', 'styles.html',
    'vite.config.ts', 'vite.ablation.config.ts', 'vite.split.config.ts', 'server/mock-api.mjs',
    'src/main.tsx', 'src/App.tsx', 'src/routes/router.ts', 'src/lib/style/registry.ts', 'src/lib/facts.ts']
    .every((f) => existsSync(path.join(ROOT, f))), 'root files');
for (const s of ['verify.sh', 'check-node.mjs', 'check-dom.mjs', 'check-browser.mjs', 'check-clean.mjs', 'make-styles.mjs', 'dump-facts.mjs', 'round-facts.mjs', 'ledger-snapshot.mjs', 'ledger-snapshot.json', 'ledger-apply.mjs', 'ledger-refill.mjs', 'build-inline.mjs', 'verify-ledger.mjs', '_harness.mjs']) {
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
chk('C8 源码完整（44 个 .ts/.tsx，与 J1 记下的文件数一致；src 里没有第四个非代码文件）', srcTs.length === 44, `${srcTs.length} 个`);

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
/* The size readout prints even when C5 is green: round-facts and the report both promise 「C5 现算并
   打印真实体积」, and a check that only speaks on failure cannot be the source of a recorded number. */
console.log(`check-clean: ${rows.length - failed.length}/${rows.length} assertions passed`);
console.log(`C5 实测体积：${total}B / ${(total / 1024 / 1024).toFixed(2)}MB / ${allFiles.length} 个文件（上限 ${50}MB，本轮台账 artifact_size 即取此值）`);
if (failed.length) process.exit(1);
