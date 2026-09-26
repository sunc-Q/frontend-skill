#!/usr/bin/env node
// 重新生成 skills/MANIFEST.json：清单数字一律由脚本现读，不手工抄写。
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const LAB = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(LAB, 'skills');
const STATE = JSON.parse(readFileSync(join(LAB, 'state', 'state.json'), 'utf8'));

const SOURCES = {
  'sites-building': '/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building',
  'build-game': '~/.qoder-cn/skills/build-game',
  'drafter': '~/.qoder-cn/skills/drafter',
  'graphic-gif': '~/.qoder-cn/skills/graphic-gif',
  'vercel-react-best-practices': '~/.qoder-cn/skills/vercel-react-best-practices',
  'frontend-development': '~/.qoder-cn/skills/frontend-development',
  'ppt-generator': '~/.qoder-cn/skills/ppt-generator',
  'ascii-project-dashboard': '~/.qoder-cn/skills/ascii-project-dashboard',
};

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__pycache__' || e.name === '.DS_Store' || e.name.endsWith('.pyc')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const o = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(name|version|category|description):\s*(.*)$/);
    if (kv) o[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return o;
}

// 从台账 tried 里反查每个 skill 被用于哪些轮次；叠加轮（如 "A + B"）同时记给两个 skill
const roundsBySkill = {};
for (const t of STATE.tried) {
  const keys = Object.keys(SOURCES).filter((k) => (t.skill || '').includes(k) || (k === 'sites-building' && t.skill?.includes('sites:sites-building')));
  const label = t.time
    ? `${t.time.slice(0, 10)} ${t.time.slice(11, 16)}`
    : `tried[${String(t.artifacts ?? '?').replace(/^artifacts\//, '').split(/[（(\/]/)[0]}]`;
  for (const key of keys) (roundsBySkill[key] ??= new Set()).add(label);
}

const entries = [];
for (const [name, src] of Object.entries(SOURCES)) {
  const dir = join(SKILLS, name);
  if (!existsSync(dir)) { entries.push({ name, missing: true }); continue; }
  const files = walk(dir);
  const bytes = files.reduce((s, f) => s + statSync(f).size, 0);
  const skillMd = join(dir, 'SKILL.md');
  const md = existsSync(skillMd) ? readFileSync(skillMd) : Buffer.from('');
  const fm = frontmatter(md.toString('utf8'));
  let installedVersion = null;
  const metaPath = join(dir, '_meta.json');
  if (existsSync(metaPath)) {
    try { installedVersion = JSON.parse(readFileSync(metaPath, 'utf8'))?.latest?.version ?? null; } catch {}
  }
  entries.push({
    name,
    source_path: src,
    version_in_skillmd: fm.version ?? null,
    version_in_meta: installedVersion,
    skill_sha1: crypto.createHash('sha1').update(md).digest('hex').slice(0, 12),
    files: files.length,
    bytes,
    used_in_rounds: [...(roundsBySkill[name] ?? [])].sort(),
  });
}

const attributed = new Set();
for (const e of entries) for (const r of e.used_in_rounds ?? []) attributed.add(r);
const unattributed = STATE.tried.filter((t) => {
  const label = t.time
    ? `${t.time.slice(0, 10)} ${t.time.slice(11, 16)}`
    : `tried[${String(t.artifacts ?? '?').replace(/^artifacts\//, '').split(/[（(\/]/)[0]}]`;
  return !attributed.has(label);
}).map((t) => (t.skill || '').slice(0, 40));

const SECRET_RE = /sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}/;
const secretHits = [];
for (const name of Object.keys(SOURCES)) {
  const dir = join(SKILLS, name);
  if (!existsSync(dir)) continue;
  for (const f of walk(dir)) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const line = text.split('\n').findIndex((l) => SECRET_RE.test(l));
    if (line >= 0) secretHits.push(`${relative(LAB, f)}:${line + 1}`);
  }
}

const manifest = {
  generated_at: new Date().toISOString(),
  generated_by: 'scripts/gen-skills-manifest.mjs（数字由脚本现读，禁止手抄）',
  purpose: 'skills/ 是每小时前端 Skill 验证实验室所用技能的本机只读快照，让零上下文的后续运行与仓库读者能核对产物当时依据的技能条款。',
  sync_recipe: "rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store' <source_path>/ skills/<name>/ && node scripts/gen-skills-manifest.mjs",
  skills: entries,
 台账_tried_total: STATE.tried.length,
  unattributed_tried: unattributed,
  secret_scan: { pattern: SECRET_RE.source, hits: secretHits },
};
writeFileSync(join(SKILLS, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

const totalBytes = entries.reduce((s, e) => s + (e.bytes || 0), 0);
const totalFiles = entries.reduce((s, e) => s + (e.files || 0), 0);
const rows = entries
  .map((e) => `| \`${e.name}/\` | ${e.version_in_meta ?? e.version_in_skillmd ?? '—'} | ${e.files} / ${(e.bytes / 1024).toFixed(0)}KB | ${e.used_in_rounds.length} | ${e.source_path} |`)
  .join('\n');

const skillReadme = `# skills/ —— 技能快照目录（与产物分开放）

本目录存放本实验室**用过的技能包的本机只读快照**，与 \`artifacts/\`（产物）、\`reports/\`（复现文档）分开。
放这里的目的：产物是「依据哪些条款做出来的」的证据，技能原文必须随仓库一起可核对，否则后续运行与读者只能靠台账转述。

- 共 ${entries.length} 个技能、${totalFiles} 个文件、${(totalBytes / 1024 / 1024).toFixed(2)}MB（已排除 \`__pycache__\`、\`*.pyc\`、\`.DS_Store\`）。
- **快照为只读**：实验室规程禁止修改本目录之外的技能源，技能迭代通过 Qoder 市场 / \`skill-push\`（Gitee \`giteesunc/agent-work-record\`）完成，不在这里改。
- 逐条机器可读清单见 \`MANIFEST.json\`（含每个技能被用于哪些轮次、文件数、字节数、SKILL.md sha1 前 12 位）。
- 本文件与 \`MANIFEST.json\` 由 \`scripts/gen-skills-manifest.mjs\` 现读磁盘生成，**数字不手抄**。

| 目录 | 版本 | 文件数 / 体积 | 用于轮次 | 本机源路径 |
| --- | --- | --- | --- | --- |
${rows}

## 重新同步某个技能

\`\`\`sh
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store' \\
  "<上表源路径>/" "skills/<目录名>/"
node scripts/gen-skills-manifest.mjs   # 重生成 MANIFEST.json 与本 README 的数字
\`\`\`

新增一轮用了新技能：把它的源路径加进 \`scripts/gen-skills-manifest.mjs\` 的 \`SOURCES\`，再跑一次上面两条命令。

## 密钥纪律

快照入仓前由 \`scripts/gen-skills-manifest.mjs\` 逐个文件扫常见凭据形态（\`sk-…\` / \`ghp_…\` / \`AKIA…\` / PEM 私钥头 / Slack token），
本轮扫描结果：**${secretHits.length === 0 ? '0 命中' : secretHits.length + ' 命中 → ' + secretHits.join(', ')}**。
技能包内出现的 \`api_key\` / \`token\` 等字样均为**环境变量名**（如 ppt-generator 的图像后端脚本读 \`os.environ\`），不含真实值。
任何凭据一律不得进入本目录；命中即须先排除该文件再重新生成清单。
`;
writeFileSync(join(SKILLS, 'README.md'), skillReadme);

const rootReadme = `# 前端 Skill 实验室（frontend-skill）

每小时自动运行一轮：选一个未试过的「skill × 场景」组合，用该技能产出 3 种互不混淆、且从未用过的风格页面，写断言校验、写复现文档、写回台账后推送本仓库 main。

## 目录约定

| 目录 | 放什么 |
| --- | --- |
| \`skills/\` | **技能快照**——本轮所用技能包原文（只读，与产物分开）。清单见 \`skills/README.md\` 与 \`skills/MANIFEST.json\` |
| \`artifacts/<YYYYMMDD-HH>-<skill>-<场景>/\` | **产物**——可直接双击打开的单文件页面 + 校验脚本，单场景 <50MB，不含 \`node_modules\`/\`dist\` |
| \`reports/<同名片段>.md\` | 复现文档：断言构成、踩坑、未验项 |
| \`records/work-log.md\` | 跨运行工作日志，每轮追加一行，零上下文续跑靠它 |
| \`state/state.json\` | 机器台账：\`tried\`（去重）、\`used_styles\`、\`skills_seen\`、\`environment_notes\`、\`next_candidates\` |
| \`scripts/\` | 仓库级工具（当前：\`gen-skills-manifest.mjs\` 生成技能清单与上述两个 README） |

\`.gitignore\` 排除 \`node_modules/\`、\`.tmp/\`、\`*.log\`、\`.DS_Store\`、\`.single/\`、\`dist/\`。
推送走 SSH（本机 github.com HTTPS 会被 TLS 重置），提交用内联身份，不改任何全局 git 配置；命令与文件里不出现任何 token 或密钥。
`;
writeFileSync(join(LAB, 'README.md'), rootReadme);

console.log(`MANIFEST.json + skills/README.md + README.md written: ${entries.length} skills, ${totalBytes} bytes snapshot total, unattributed tried=${unattributed.length}`);
for (const u of unattributed) console.log('  UNATTRIBUTED:', u);
