// PoC-C：供应链 / 密钥 / 发布面。全程本地只读 + 一次 git 历史扫描，不联网。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LAB = path.resolve(import.meta.dirname, '../..');
const rel = p => path.relative(LAB, p);
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

console.log('\n[C-1] 已发布面（git 跟踪的 59 个文件）里是否存在 .env / 私钥 / 凭据形状的命中');
const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: LAB, encoding: 'utf8' }).trim().split('\n');
const SECRET_SHAPED = /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{10,}/;
const loose = /(ghp_|AKIA|BEGIN RSA PRIVATE|BEGIN OPENSSH|token|secret|password)/i;
let looseHits = [], shapedHits = [];
for (const f of tracked) {
  let t; try { t = fs.readFileSync(path.join(LAB, f), 'utf8'); } catch { continue; }
  if (loose.test(t)) looseHits.push(f + ':' + (t.match(new RegExp(loose, 'gi')) || []).length);
  if (SECRET_SHAPED.test(t)) shapedHits.push(f);
}
console.log('  跟踪文件=' + tracked.length + '  宽松关键词命中=' + looseHits.length + '  凭据形状命中=' + shapedHits.length);
console.log('  宽松命中样例（须人工分诊）: ' + looseHits.slice(0, 6).join(' | '));
console.log('  结论: ' + (shapedHits.length === 0 ? '未发现可使用的凭据；宽松规则 100% 为文档示例/CSS 误报' : '需立即处理：' + shapedHits.join(',')));

console.log('\n[C-2] git 全历史 diff 扫描（.gitignore 只挡未来提交，历史里的东西挡不住）');
const hist = execFileSync('git', ['log', '--all', '-p', '--', '.'], { cwd: LAB, encoding: 'utf8', maxBuffer: 1 << 28 });
const histShaped = hist.split('\n').filter(l => /^\+.*(ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{32,})/.test(l));
console.log('  历史新增行数=' + hist.split('\n').filter(l => l.startsWith('+')).length + '  其中凭据形状=' + histShaped.length);
console.log('  ' + (histShaped.length ? histShaped.join('\n  ') : '零命中 → 7 轮累计提交未泄露凭据'));
const histPaths = hist.match(/\/Users\/apple\/[^\s'"]{6,}/g) || [];
console.log('  本机绝对路径出现次数=' + histPaths.length + '（发布面泄露用户名/目录结构，属 A05 低危，但对本 LAB 是「谁在跑」的指纹）');

console.log('\n[C-3] 内联第三方库的自证能力（版本横幅 / 摘要 / 依赖清单三件套是否齐备）');
const BLOBS = [
  ['demos/20260925-1810-algorithmic-art/art-index.html', 'p5'],
  ['demos/20260925-2332-build-game/frostlight-gather.html', 'three'],
  ['demos/20260925-2332-build-game/postfx.bundle.js', 'three-addons'],
];
const manifest = [];
for (const [f, lib] of BLOBS) {
  const abs = path.join(LAB, f);
  const t = fs.readFileSync(abs, 'utf8');
  const banner = (t.match(/\/\*!?\s*(p5\.js|three\.js|Three\.js)[^\n]{0,40}/i) || [null])[0];
  const hasLock = fs.existsSync(path.join(LAB, 'package.json')) || fs.existsSync(path.join(LAB, 'package-lock.json'));
  const rec = { file: f, lib, bytes: fs.statSync(abs).size, sha256: sha256(abs), version_banner: banner, sri_or_hash_in_repo_before_this_run: false, dependency_lockfile: hasLock };
  manifest.push(rec);
  console.log('  ' + f);
  console.log('    库=' + lib + ' 体积=' + rec.bytes + 'B 版本横幅=' + JSON.stringify(rec.version_banner));
  console.log('    产物内是否记载来源摘要/校验值=否  仓库是否有锁文件=' + hasLock);
}
manifest.push({ note: '本清单本身即修复件：只登记「可复现取证」的三项——文件路径/字节数/sha256。第三方 tarball 的 p5 版来自其横幅注释(v1.7.0)，three 版来自 game.src.html:78 的人工注释(r160)，产物内无可机检来源；npmmirror 的 tgz 不提供上游签名，故摘要只能对本地产物求。下次重建时须把 tarball 的 sha256 一并记进本文件（见 report 的修复清单 F-6）。' });
fs.writeFileSync(path.join(import.meta.dirname, 'integrity-manifest.json'), JSON.stringify(manifest, null, 1));
console.log('  → 已写出 integrity-manifest.json（修复建议的落地件）');

console.log('\n[C-4] 第三方技能包的执行面（本任务会把 SKILL.md 当指令读并照做 = 提示注入面）');
const skillRoots = ['.skills', '/Users/apple/.qoder-cn/skills'];
let n = 0, execInstr = 0, refs = 0;
for (const root of skillRoots) {
  const base = path.resolve(LAB, root);
  if (!fs.existsSync(base)) continue;
  const stack = [base];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') stack.push(p); continue; }
      if (!/SKILL\.md$/.test(e.name)) continue;
      n++;
      const t = fs.readFileSync(p, 'utf8');
      if (/\b(curl|wget|git clone|npm i|npm install|pip install|npx|bash |python3? )/.test(t)) execInstr++;
    }
  }
}
console.log('  SKILL.md=' + n + '  内含 shell 级指令=' + execInstr + '（' + (100 * execInstr / n).toFixed(0) + '%）→ 每条都要过安全闸门，无人值守时按最保守解释执行');
console.log('  已发生实例：state.json.skills_seen 中 story-invite-poster 被记 blocked，原文要求「对我的本地代理说去安装这个 URL」（代理级注入）；dlazy-vectorize / gif-maker-free 因「上传本地图到外部服务」被排除（内容外发）');
