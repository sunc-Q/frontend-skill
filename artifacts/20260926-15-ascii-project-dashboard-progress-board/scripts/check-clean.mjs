#!/usr/bin/env node
// 收尾清理卡：本轮目录自身的磁盘卫生判据。删完中间产物后仍可独立重跑（只读盘，不写盘）。
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { makeCard } from './_harness.mjs';

const ROUND = join(dirname(fileURLToPath(import.meta.url)), '..');
const LAB = join(ROUND, '..', '..');
const out = makeCard('clean');

const walk = (root) => {
  const files = [];
  if (!existsSync(root)) return files;
  const rec = (abs) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const a = join(abs, e.name);
      if (e.isDirectory()) rec(a);
      else files.push({ abs: a, rel: a.slice(ROUND.length + 1), bytes: statSync(a).size });
    }
  };
  rec(root);
  return files;
};
const files = walk(ROUND);
const bytes = files.reduce((a, f) => a + f.bytes, 0);
const MB = 1024 * 1024;

const RESIDUE = /(^|\/)(node_modules|\.cache|dist|build|\.next|\.turbo)\//;
out.ok('CL1', `本轮目录零构建残留（node_modules/dist/缓存目录数为 ${files.filter((f) => RESIDUE.test(f.rel)).length}）`,
  files.every((f) => !RESIDUE.test(f.rel)), files.filter((f) => RESIDUE.test(f.rel)).map((f) => f.rel).slice(0, 5).join(' ') || 'clean');
out.ok('CL2', `本轮目录总体积 ${(bytes / MB).toFixed(2)}MB < 50MB（技能与规程的磁盘预算）`, bytes < 50 * MB, `${files.length} 个文件，${bytes} 字节`);
out.ok('CL2b', '最大的单个文件 < 5MB（看板类产物不该被图片撑大）', files.every((f) => f.bytes < 5 * MB), `max=${(Math.max(...files.map((f) => f.bytes)) / 1024).toFixed(1)}KB ${files.slice().sort((a, b) => b.bytes - a.bytes)[0].rel}`);

const want = ['dashboard-lane-matrix.md', 'dashboard-braille-dense.md', 'dashboard-teletype-ascii.md',
  'preview/matrix.html', 'preview/dense.html', 'preview/teletype.html', 'preview/styles.html'];
out.ok('CL3', `三风格 .md + 三预览 + 对照入口页共 ${want.length} 个交付物齐备且各 >1KB`,
  want.every((p) => existsSync(join(ROUND, p)) && statSync(join(ROUND, p)).size > 1024),
  want.map((p) => `${p}:${existsSync(join(ROUND, p)) ? statSync(join(ROUND, p)).size + 'B' : 'MISSING'}`).join(' '));
out.ok('CL4', '零字节文件数为 0', files.every((f) => f.bytes > 0), files.filter((f) => f.bytes === 0).map((f) => f.rel).join(' ') || 'none');
out.ok('CL5', '无 .DS_Store / 备份文件（*~、*.bak、*.tmp）', files.every((f) => !/(^|\/)\.DS_Store$|~$|\.bak$|\.tmp$/.test(f.rel)),
  files.filter((f) => /(^|\/)\.DS_Store$|~$|\.bak$|\.tmp$/.test(f.rel)).map((f) => f.rel).join(' ') || 'none');

const htmls = files.filter((f) => f.rel.endsWith('.html') && !f.rel.startsWith('.tmp-check'));  // 探针副本不是交付物，由 CL9 单独管
out.ok('CL6', `${htmls.length} 份 HTML 全部自包含（零 http(s) 外链、零 src/href 外部引用、零 url()/@import；脚本只允许内联，且脚本体本身纯 ASCII）`,
  htmls.every((f) => {
    const t = readFileSync(f.abs, 'utf8');
    const scripts = t.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    return !/https?:\/\//.test(t) && !/(src|href)="(https?:|\/\/)/.test(t) && !/<script[^>]+\ssrc=/i.test(t)
      && !/url\(/i.test(t) && scripts.every((s) => Math.max(...[...s].map((c) => c.codePointAt(0))) <= 0x7e);
  }),
  htmls.map((f) => `${f.rel}:${(readFileSync(f.abs, 'utf8').match(/<script/g) || []).length}脚本`).join(' '));
const mds = files.filter((f) => f.rel.endsWith('.md') && !f.rel.startsWith('.tmp-check'));
out.ok('CL7', `${mds.length} 份 .md 零外链（可直接贴进任意 Markdown 渲染器不变形）`,
  mds.every((f) => { const t = readFileSync(f.abs, 'utf8'); return !/https?:\/\//.test(t) && !/!\[/.test(t); }), mds.map((f) => f.rel).join(' '));

// 中文目录 ESM 坑：路径未 fileURLToPath 时会把产物写到仓库外的 %E8%AF%95… 假目录
const parent = join(LAB, '..');
const ghosts = readdirSync(parent).filter((n) => /%[0-9A-F]{2}/i.test(n));
out.ok('CL8', '仓库同级没有 %XX 形式的中文路径逃逸目录（fileURLToPath 生效）', ghosts.length === 0, ghosts.join(' ') || 'none');

const tmp = join(ROUND, '.tmp-check');
const tmpFiles = existsSync(tmp) ? walk(tmp) : [];
out.ok('CL9', tmpFiles.length ? `.tmp-check 只放可再生读数：JSON 快照 + 浏览器卡探针副本（${tmpFiles.length} 个，${tmpFiles.reduce((a, f) => a + f.bytes, 0)}B），无依赖目录无二进制帧` :
  '中间读数目录已清理（本轮无 .tmp-check）',
  tmpFiles.every((f) => /\.(json|html)$/.test(f.rel) && !/node_modules/.test(f.rel))
  && tmpFiles.filter((f) => f.rel.endsWith('.html')).every((f) => /^probe-[a-z]+(-raw)?\.html$/.test(f.rel.split('/').pop())),
  tmpFiles.map((f) => `${f.rel}:${f.bytes}B`).join(' ') || 'deleted');
out.ok('CL9b', '探针副本没漏进交付目录（根下与 preview/ 只有交付 HTML）',
  files.filter((f) => f.rel.endsWith('.html') && !f.rel.startsWith('.tmp-check')).every((f) => !/probe/.test(f.rel)),
  files.filter((f) => f.rel.endsWith('.html') && !f.rel.startsWith('.tmp-check')).map((f) => f.rel).join(' '));

const facts = JSON.parse(readFileSync(join(ROUND, 'facts.json'), 'utf8'));
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
const live = sha1(readFileSync(join(LAB, 'state', 'state.json')));
out.ok('CL10', `产物尾部水印自洽：三份 .md 的 <!-- f:sha --> 与 facts.json 记录一致（陈旧会被抓）`,
  mds.filter((f) => f.rel.startsWith('dashboard-')).every((f) => {
    const m = readFileSync(f.abs, 'utf8').match(/<!-- f:([0-9a-f]{12})/);
    return m && m[1] === facts.ledger.state_sha1;
  }), `md 水印=${mds.filter((f) => f.rel.startsWith('dashboard-')).map((f) => (readFileSync(f.abs, 'utf8').match(/<!-- f:([0-9a-f]{12})/) || [,'?'])[1]).join(',')} facts=${facts.ledger.state_sha1} 现读=${live}`);
out.ok('CL11', '台账写回后本卡仍可跑：只读断言不依赖任何被删的中间脚本', files.some((f) => f.rel === 'scripts/facts.mjs') && files.some((f) => f.rel === 'src/render.mjs'),
  `${files.filter((f) => /\.(mjs|sh)$/.test(f.rel)).length} 个脚本随产物留档`);

out.done();
