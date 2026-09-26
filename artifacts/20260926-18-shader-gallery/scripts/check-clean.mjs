/* 磁盘纪律 + 密钥体检（本轮产物目录自己的收尾闸，跑在清理之后）。
 * 三件事：
 *   1) 目录里只留「双击能打开的东西 + 复现它所需的源与证据」，不许留构建残渣；
 *   2) 页面里引用到的每个本地路径都要存在，且不得引用任何外链资源（产物必须单文件自足）；
 *   3) 全目录扫一遍凭据形状的字符串——任务铁律是「命令与文件里都不得出现任何 token 或密钥」。
 * 用法：node scripts/check-clean.mjs */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const results = [];
const ok = (id, cond, actual) => results.push({ id, pass: !!cond, actual: actual === undefined ? "" : String(actual).slice(0, 240) });

const files = [];
const dirs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (e.isDirectory()) {
      dirs.push(rel);
      walk(abs);
    } else files.push({ rel, bytes: fs.statSync(abs).size });
  }
})(ROOT);

const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
ok("clean/under-50mb", totalBytes < 50 * 1024 * 1024, `${(totalBytes / 1024).toFixed(1)}KB / ${files.length} 个文件`);

const junk = files.filter((f) => /(^|\/)(node_modules|dist|\.cache|\.DS_Store)(\/|$)|\.log$|\.tmp$|\.patch\d*\.mjs$|^\.patch/.test(f.rel)).map((f) => f.rel);
ok("clean/no-build-residue", junk.length === 0, "残渣：" + junk.join(" ; "));
const emptyDirs = dirs.filter((d) => fs.readdirSync(path.join(ROOT, d)).length === 0);
ok("clean/no-empty-dirs", emptyDirs.length === 0, "空目录：" + emptyDirs.join(" ; "));

/* 白名单：不在这些形状里的文件就是「没人能解释的东西」，收尾时要么删掉要么补进这里（并说明为什么）。 */
const ALLOW = [
  /^preview\/exhibit-[a-z-]+\.html$/,
  /^styles\.html$/,
  /^src\/(facts\.json|host\.js|template\.html)$/,
  /^src\/css\/(base|skin-[a-z-]+)\.css$/,
  /^src\/shaders\/[a-z-]+\.glsl$/,
  /^scripts\/[a-z-]+\.mjs$/,
  /^scripts\/verify\.sh$/,
  /^scripts\/(build-sizes|ledger-snapshot)\.json$/,
  /^evidence\/(cli-probe|check-node|check-browser|mutation|styles-numbers|styles-regions)\.json$/,
];
const unexplained = files.filter((f) => !ALLOW.some((re) => re.test(f.rel))).map((f) => f.rel);
ok("clean/all-files-explained", unexplained.length === 0, "白名单之外：" + unexplained.join(" ; "));

/* 产物与对照页里的引用必须全部落在本地且存在；外链资源一律不许（单文件自足是这轮的硬要求）。 */
const htmlFiles = files.filter((f) => f.rel.endsWith(".html"));
const badRefs = [];
const external = [];
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(ROOT, f.rel), "utf8");
  const base = path.dirname(path.join(ROOT, f.rel));
  for (const m of html.matchAll(/(?:href|src|action)="([^"]*)"/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || /^(data|mailto|javascript):/.test(ref)) {
      if (!/^(https?:)?\/\//.test(ref)) continue;
      external.push(`${f.rel} → ${ref.slice(0, 60)}`);
    } else if (ref && !ref.startsWith("#")) {
      const target = path.resolve(base, ref.split("#")[0]);
      if (!fs.existsSync(target)) badRefs.push(`${f.rel} → ${ref}`);
    }
  }
}
ok("clean/refs-resolve", badRefs.length === 0, "断链：" + badRefs.join(" ; "));
ok("clean/no-external-refs", external.length === 0, "外链：" + external.join(" ; "));

/* 凭据形状扫描：宁可误报也不漏报，命中的话把文件名与前缀贴出来（不贴全文，避免二次泄露）。 */
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
console.log(`check-clean: ${results.length - failed.length}/${results.length} PASS`);
for (const f of failed) console.log(`  FAIL ${f.id}  ${f.actual}`);
process.exit(failed.length ? 1 : 0);
