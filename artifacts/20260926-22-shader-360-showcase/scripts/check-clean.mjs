/* 磁盘纪律 + 密钥体检（本轮产物目录自己的收尾闸，跑在清理之后）。
 * 四件事：
 *   1) 目录里只留「双击能打开的东西 + 复现它所需的源与证据」，不许留构建残渣与一次性探针脚本；
 *   2) 三个页面产物都是真单文件：零外链、零脚本引用、引用的本地路径全部可达；
 *   3) 体积上限 50MB（任务硬要求），并报告「可直接打开的页面」这一类的实际占比；
 *   4) 全目录扫一遍凭据形状——任务铁律是「命令与文件里都不得出现任何 token 或密钥」。
 * 用法：node scripts/check-clean.mjs */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const results = [];
const ok = (id, cond, actual) => results.push({ id, pass: !!cond, actual: actual === undefined ? "" : String(actual).slice(0, 240) });

const files = [];
const dirs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (e.isDirectory()) { dirs.push(rel); walk(abs); }
    else files.push({ rel, bytes: fs.statSync(abs).size });
  }
})(ROOT);

const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
ok("clean/under-50mb", totalBytes < 50 * 1024 * 1024, `${(totalBytes / 1024).toFixed(1)}KB / ${files.length} 个文件`);

const junk = files.filter((f) => /(^|\/)(node_modules|dist|build|\.cache|\.DS_Store|\.tmp)(\/|$)|\.(log|tmp|orig|bak)$/.test(f.rel)).map((f) => f.rel);
ok("clean/no-build-residue", junk.length === 0, "残渣：" + junk.join(" ; "));
// 一次性探针（smoke/cli-probe 之类）用完即删，代码抄进报告；留在目录里就是「没人能解释的第二套判据」
const oneOff = files.filter((f) => /scripts\/(smoke|probe|debug|scratch|once)[-a-z]*\.mjs$/.test(f.rel)).map((f) => f.rel);
ok("clean/no-oneoff-probes", oneOff.length === 0, "一次性探针：" + oneOff.join(" ; "));
const emptyDirs = dirs.filter((d) => fs.readdirSync(path.join(ROOT, d)).length === 0);
ok("clean/no-empty-dirs", emptyDirs.length === 0, "空目录：" + emptyDirs.join(" ; "));

/* 白名单：不在这些形状里的文件就是「没人能解释的东西」，收尾时要么删掉要么补进这里（并说明为什么）。 */
const ALLOW = [
  /^preview\/showcase-[a-z]+\.html$/,
  /^preview\/styles\.html$/,
  /^src\/(body\.html|host\.js|labels\.json|product\.json)$/,
  /^src\/skins\/[a-z-]+\.css$/,
  /^src\/shaders\/[a-z-]+\.glsl$/,
  /^scripts\/[a-z-]+\.mjs$/,
  /^scripts\/verify\.sh$/,
  /^scripts\/ledger-snapshot\.json$/,
  /^evidence\/[a-z-]+\.json$/,
  /^shots\/stage-[a-z-]+\.png$/,
];
const unexplained = files.filter((f) => !ALLOW.some((re) => re.test(f.rel))).map((f) => f.rel);
ok("clean/all-files-explained", unexplained.length === 0, "白名单之外：" + unexplained.join(" ; "));

const pages = files.filter((f) => f.rel.startsWith("preview/"));
ok("clean/页面产物齐三张加对照页", new Set(pages.map((p) => p.rel)).size, 4, pages.map((p) => p.rel).join(" ; "));
/* 三张产物页必须真单文件：零外链、连本地相对引用也不许有（file:// 下一起丢）。
 * 对照页 styles.html 是「入口」，它按设计要链到三张产物页——那些引用只要求可达，不要求为零。 */
const badRefs = [];
const external = [];
for (const f of pages) {
  const html = fs.readFileSync(path.join(ROOT, f.rel), "utf8");
  const selfContained = /showcase-/.test(f.rel);
  const base = path.dirname(path.join(ROOT, f.rel));
  for (const m of html.matchAll(/(?:href|src|action|xlink:href)="([^"]*)"/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref)) external.push(`${f.rel} → ${ref.slice(0, 60)}`);
    else if (!ref || ref.startsWith("#") || ref.startsWith("data:")) continue;
    else if (selfContained) badRefs.push(`${f.rel} → ${ref}（产物页不许引用任何东西）`);
    else if (!fs.existsSync(path.resolve(base, ref.split("#")[0]))) badRefs.push(`${f.rel} → ${ref}`);
  }
}
ok("clean/零外链", external.length === 0, "外链：" + external.join(" ; "));
ok("clean/产物页零引用且对照页链接可达", badRefs.length === 0, "问题：" + badRefs.join(" ; "));

/* 凭据形状扫描：宁可误报也不漏报，命中只贴文件名与前缀（不贴全文，避免二次泄露）。 */
const SECRET_PATTERNS = [
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer", /\b[Aa]uthorization\s*[:=]\s*(Bearer\s+)?[A-Za-z0-9._\-]{16,}/],
  ["token-assignment", /\b(?:token|secret|password|api[_-]?key|access[_-]?key)\b\s*[:=]\s*["'][^"'\s]{12,}["']/i],
  ["jwt", /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{8,}\b/],
  ["ssh-or-netrc", /(^|\/)(id_rsa|id_ed25519|\.netrc|\.npmrc|\.pypirc)$/],
];
const hits = [];
for (const f of files) {
  if (f.bytes > 4 * 1024 * 1024) continue;
  const text = fs.readFileSync(path.join(ROOT, f.rel), "utf8");
  for (const [name, re] of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(`${f.rel} 命中 ${name}：${m[0].slice(0, 14)}…`);
  }
}
ok("clean/no-secrets", hits.length === 0, "命中：" + hits.slice(0, 6).join(" ; "));

const failed = results.filter((r) => !r.pass);
console.log(JSON.stringify({ suite: "check-clean", total: results.length, pass: results.length - failed.length,
  fail: failed.length, bytes: totalBytes, fails: failed.map((f) => `${f.id} → ${f.detail || f.actual}`) }));
process.exit(failed.length ? 1 : 0);
