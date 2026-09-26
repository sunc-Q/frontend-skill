/* 写回台账 *之前* 拍一份快照，供 check-node I 组做幂等式断言。
 * 历轮教训：查「现值」的自反断言会在写回成功那一刻自毁，必须查写回前的快照。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LAB = path.resolve(ROOT, "..", "..");
const live = JSON.parse(fs.readFileSync(path.join(LAB, "state", "state.json"), "utf8"));
const log = fs.readFileSync(path.join(LAB, "records", "work-log.md"), "utf8");

const snap = {
  taken_at: new Date().toISOString(),
  tried: live.tried.length,
  runs: live.runs.length,
  used_styles: live.used_styles.length,
  environment_notes: (live.environment_notes || []).length,
  tried_skills: live.tried.map((t) => `${(t.skill || "").split("（")[0]} × ${(t.scenario || "").slice(0, 12)}`),
  used_styles_all: live.used_styles,
  my_log_lines: log.split("\n").filter((l) => l.includes("20260926-18-shader-exhibit") || l.includes("| shader（")).length,
  this_round_styles: ["liquid-chrome", "crt-plasma", "silk-aurora"],
  // 既有台账欠账（他人轮次字段缺失）与 reports/ 目录形态：本轮只要求「不新增」，不改他人条目。
  ledger_debt: live.tried
    .map((t, i) => ({ i, miss: ["time", "scenario", "styles", "report", "artifacts"].filter((k) => !t[k]) }))
    .filter((x) => x.miss.length)
    .map((x) => `tried[${x.i}]:${x.miss.join("/")}`),
  report_dirs: fs
    .readdirSync(path.join(LAB, "reports"))
    .filter((f) => fs.statSync(path.join(LAB, "reports", f)).isDirectory()).length,
};
fs.writeFileSync(path.join(ROOT, "scripts", "ledger-snapshot.json"), JSON.stringify(snap, null, 2));
console.log(JSON.stringify({ tried: snap.tried, runs: snap.runs, used_styles: snap.used_styles, my_log_lines: snap.my_log_lines, ledger_debt: snap.ledger_debt, report_dirs: snap.report_dirs }));
