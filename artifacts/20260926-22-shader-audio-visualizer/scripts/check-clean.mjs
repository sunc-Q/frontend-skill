/* 清理与磁盘纪律（H 组）：产物必须「拿来就能开、放着不占地、不外连」。
 * 这一组刻意只看目录与文件本身，不重复 A/B/C/D 的内容判据。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(name + (detail ? " — " + detail : "")); }
  console.log((cond ? "PASS " : "FAIL ") + name + (detail && !cond ? "  [" + detail + "]" : ""));
}

function dirBytes(dir, skip) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip && skip.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return total;
}

const junk = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (["node_modules", "dist", ".tmp", ".cache", ".next"].includes(e.name)) {
      junk.push(path.relative(ROOT, path.join(dir, e.name)));
      continue;
    }
    if (e.name.startsWith(".")) continue;
    walk(path.join(dir, e.name));
  }
})(ROOT);
ok("H1 场景目录里没有 node_modules/dist/.tmp 之类的可再生垃圾", junk.length === 0, junk.join(","));

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const pages = fs.readdirSync(path.join(ROOT, "preview")).filter((f) => f.endsWith(".html")).sort();
ok("H2 preview/ 恰好三份可直接打开的单文件页面", pages.length === 3 &&
  pages.every((f) => /visualizer-[a-z]+\.html/.test(f)), pages.join(","));
ok("H3 根目录有总览页 index.html", files.includes("index.html"), files.join(","));

const big = pages.map((f) => ({ f, b: fs.statSync(path.join(ROOT, "preview", f)).size }));
ok("H4 单页 ≤ 1.5MB（内联音频占大头，仍然双击就开）", big.every((x) => x.b > 900000 && x.b < 1500000),
  big.map((x) => x.f + " " + (x.b / 1048576).toFixed(2) + "MB").join(" · "));

const totalBytes = dirBytes(ROOT);
ok("H5 本场景产物合计 " + (totalBytes / 1048576).toFixed(2) + "MB ≤ 50MB 限额", totalBytes <= 50 * 1048576);

/* 外链：产物里不允许出现任何 http(s) 资源地址（w3.org 命名空间字样出现在 SVG 声明里也不算引用） */
const extRefs = [];
[...pages.map((f) => path.join(ROOT, "preview", f)), path.join(ROOT, "index.html")].forEach((f) => {
  if (!fs.existsSync(f)) return;
  const t = fs.readFileSync(f, "utf8");
  [...t.matchAll(/(?:src|href|xlink:href)\s*=\s*["'](https?:\/\/[^"']+)/g)].forEach((m) => extRefs.push(path.basename(f) + ":" + m[1].slice(0, 50)));
  [...t.matchAll(/url\((['"]?)https?:\/\/[^)]*\)/g)].forEach((m) => extRefs.push(path.basename(f) + ":css " + m[0].slice(0, 50)));
  [...t.matchAll(/\bfetch\s*\(\s*["'`]https?:/g)].forEach((m) => extRefs.push(path.basename(f) + ":" + m[0]));
});
ok("H6 四份页面零外部引用（没有 http(s) 资源、没有远程 fetch）", extRefs.length === 0, extRefs.slice(0, 4).join(","));

const need = ["evidence/ground-truth.json", "evidence/ground-truth-frames.csv", "evidence/check-browser.json",
  "evidence/mutation-strict.json", "evidence/mutation-explore.json", "scripts/verify.sh", "src/audio-spec.json",
  "audio/track.wav"];
const miss = need.filter((p) => !fs.existsSync(path.join(ROOT, p)));
ok("H7 复现所需的最小文件集齐备", miss.length === 0, miss.join(","));

const snap = path.join(LAB, "skills");
const skillDirs = fs.existsSync(snap) ? fs.readdirSync(snap).filter((d) => /shader/i.test(d)) : [];
ok("H8 所用技能在 LAB/skills/ 下有只读快照", skillDirs.length >= 1, skillDirs.join(","));

/* 中间脚本别留在场景目录里：一次性调试脚本要么删掉、要么把内容抄进复现报告 */
const strays = fs.readdirSync(path.join(ROOT, "scripts")).filter((f) => /^(tmp|scratch|debug|probe)-/i.test(f));
ok("H9 scripts/ 里没有一次性调试脚本", strays.length === 0, strays.join(","));

const wav = fs.readFileSync(path.join(ROOT, "audio", "track.wav"));
const csv = fs.readFileSync(path.join(ROOT, "evidence", "ground-truth-frames.csv"), "utf8").trim().split("\n");
ok("H10 逐帧真值表与解析器同源（" + (csv.length - 1) + " 帧 · " + wav.length + "B WAV）",
  csv.length - 1 === JSON.parse(fs.readFileSync(path.join(ROOT, "evidence", "ground-truth.json"), "utf8")).summary.frameCount);

fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "evidence", "check-clean.json"), JSON.stringify({
  generated_by: "scripts/check-clean.mjs", pass, fail, total: pass + fail, failures,
  artifactBytes: totalBytes, artifactMb: Number((totalBytes / 1048576).toFixed(2))
}, null, 2));
console.log("\n== check-clean: " + pass + " passed, " + fail + " failed, total " + (pass + fail) + " ==");
if (fail) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
