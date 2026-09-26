/* 汇总断言总量 → evidence/assert-totals.json。
 * 复现报告与工作台账里写的「多少条断言」必须由这个文件给出，不允许手抄数字
 * （历轮教训：被写进文档的断言计数一旦含条件性项目就会跳变）。
 * 本脚本只读四个校验脚本自己留下的 JSON，不重跑任何东西——重跑会把顺序依赖绕回成环。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function readJson(p) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) throw new Error("缺少 " + p + "：先把对应校验跑完（顺序见 scripts/verify.sh）");
  return JSON.parse(fs.readFileSync(full, "utf8"));
}
function dirBytes(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return total;
}

const nodeJ = readJson("evidence/check-node.json");
const browserJ = readJson("evidence/check-browser.json");
const cleanJ = readJson("evidence/check-clean.json");
const mutation = readJson("evidence/mutation-strict.json");

const mk = (name, o) => ({ name, pass: o.pass, fail: o.fail, total: o.total });
const artifactBytes = dirBytes(ROOT);
const totals = {
  generated_by: "scripts/summarize.mjs",
  node: { ...mk("check-node", nodeJ), failures: nodeJ.failures || [] },
  browser: { ...mk("check-browser", browserJ), exe: path.basename(String(browserJ.browser || "?")),
    version: browserJ.browserVersion, failures: browserJ.failures || [] },
  clean: { ...mk("check-clean", cleanJ), failures: cleanJ.failures || [] },
  mutation: { kind: "对抗性变异", count: mutation.count, caught: mutation.caught,
    escaped: mutation.count - mutation.caught, restored_identical: mutation.restored_identical },
  mutationExplore: fs.existsSync(path.join(ROOT, "evidence", "mutation-explore.json"))
    ? (() => { const e = readJson("evidence/mutation-explore.json");
        return { count: e.count, caught: e.caught, escaped_names: e.mutations.filter((m) => !m.ok).map((m) => m.id) }; })()
    : null,
  grandTotal: nodeJ.total + browserJ.total + cleanJ.total,
  grandPass: nodeJ.pass + browserJ.pass + cleanJ.pass,
  artifactBytes,
  artifactMb: Number((artifactBytes / 1048576).toFixed(2)),
  budgetMb: 50
};
fs.writeFileSync(path.join(ROOT, "evidence", "assert-totals.json"), JSON.stringify(totals, null, 2));
console.log("assert-totals: 静态 " + totals.node.pass + "/" + totals.node.total +
  " · 浏览器 " + totals.browser.pass + "/" + totals.browser.total +
  " · 清理 " + totals.clean.pass + "/" + totals.clean.total +
  " · 合计 " + totals.grandPass + "/" + totals.grandTotal +
  " · 变异抓住 " + totals.mutation.caught + "/" + totals.mutation.count +
  " · 产物 " + totals.artifactMb + "MB");
if (nodeJ.fail || browserJ.fail || cleanJ.fail || mutation.caught !== mutation.count || !mutation.restored_identical) {
  console.log("存在未通过项：" + JSON.stringify({ node: nodeJ.failures, browser: browserJ.failures,
    clean: cleanJ.failures,
    escaped: mutation.mutations.filter((m) => !m.ok).map((m) => m.id) }));
  process.exit(1);
}
