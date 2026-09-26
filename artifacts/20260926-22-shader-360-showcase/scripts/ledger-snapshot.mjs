/* 台账对账：写回 *之前* 拍快照，写回 *之后* 拿快照对账。
 * 为什么要两份：历轮教训是「查现值的自反断言会在写回成功那一刻自毁」，
 * 所以「本轮组合此前不存在」只能由写回前的快照来证明，「写回没把别人的记录冲掉」只能由写回后来证明。
 * 并发还体现在另一个会话上：同一小时里 ★#1（shader × 音频）也在写这份 state.json，
 * 对账要求「只增不减」，谁覆盖了谁当场露馅。
 * 用法：node scripts/ledger-snapshot.mjs          # 写回前拍快照 → scripts/ledger-snapshot.json
 *       node scripts/ledger-snapshot.mjs --verify # 写回后对账 → evidence/ledger.json（红了就别提交） */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LAB = path.resolve(ROOT, "..", "..");
const ART = "artifacts/20260926-22-shader-360-showcase";
const REPORT = "reports/20260926-22-shader-360-showcase.md";
const STYLES = ["射灯橱窗 vitrine", "展签美术馆 plaque", "工业配置器 industrial"];
/* 组合的身份由两部分定死：技能名 + 场景关键词。写回时 tried 条目必须同时含这两者。 */
const SKILL_KEY = "shader";
const SCENARIO_KEY = "商品 360°";

const live = () => JSON.parse(fs.readFileSync(path.join(LAB, "state", "state.json"), "utf8"));
const logText = () => fs.readFileSync(path.join(LAB, "records", "work-log.md"), "utf8");
// 日志不是 markdown 表格：一行一轮，形如「2026-09-26 22:00 | skill | 场景 | 风格 | 产物路径 | 结论」
const roundLines = (log) => log.split("\n").filter((l) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \|/.test(l));
const hasCombo = (s) => s.tried.filter((t) => `${t.skill || ""}|${t.scenario || ""}`.includes(SKILL_KEY) && `${t.skill || ""}|${t.scenario || ""}`.includes(SCENARIO_KEY));
const debtOf = (s) => s.tried.map((t, i) => ({ i, miss: ["time", "scenario", "styles", "report"].filter((k) => !t[k]) })).filter((x) => x.miss.length)
  .map((x) => `tried[${x.i}]:${x.miss.join("/")}`);

if (process.argv.includes("--verify")) {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ledger-snapshot.json"), "utf8"));
  const s = live();
  const log = logText();
  const myLines = log.split("\n").filter((l) => l.includes(ART));
  const results = [];
  const eq = (id, actual, expected) => results.push({ id, pass: actual === expected, detail: `实际 ${actual} / 期望 ${expected}` });
  const ok = (id, cond, detail = "") => results.push({ id, pass: !!cond, detail });

  eq("写回前·本轮组合不在台账", snap.combo_before, 0);
  eq("写回前·三种风格未被占用", snap.styles_before, 0);
  eq("写回后·本轮组合入台账恰好 1 条", hasCombo(s).length, 1);
  ok("写回后·台账条目带结论与产物路径", (() => { const t = hasCombo(s)[0]; return t && t.conclusion && (t.artifacts || t.artifact) && t.report; })());
  eq("写回后·三种风格都在 used_styles", STYLES.filter((x) => !s.used_styles.includes(x)).length, 0);
  eq("写回后·工作日志本轮恰好一行", myLines.length, 1);
  // 一行六个字段：时间 | skill | 场景 | 风格 | 产物路径 | 结论
  ok("写回后·日志行字段齐全且带三种风格名", myLines.length === 1 && myLines[0].split("|").length >= 6 && STYLES.every((x) => myLines[0].includes(x.split(" ")[0])), myLines[0] ? myLines[0].slice(0, 90) : "缺行");
  ok("写回后·报告文件已落盘", fs.existsSync(path.join(LAB, REPORT)));
  ok("写回后·产物目录已落盘", fs.existsSync(path.join(LAB, ART, "preview", "showcase-vitrine.html")));
  // 并发闸：同一个 state.json 有两个会话在写，任何一项计数倒退都说明有人被覆盖
  ok("并发·tried 只增不减", s.tried.length >= snap.tried + 1, `${snap.tried} → ${s.tried.length}`);
  ok("并发·used_styles 只增不减", s.used_styles.length >= snap.used_styles + 3, `${snap.used_styles} → ${s.used_styles.length}`);
  ok("并发·runs 只增不减", s.runs.length >= snap.runs + 1, `${snap.runs} → ${s.runs.length}`);
  ok("并发·environment_notes 只增不减", s.environment_notes.length >= snap.environment_notes, `${snap.environment_notes} → ${s.environment_notes.length}`);
  ok("并发·历史日志行未被动过", (() => { const keep = roundLines(log).length; return keep >= snap.log_round_lines + 1; })(), `轮次行 ${roundLines(log).length} / 快照 ${snap.log_round_lines}（写回后至少多一行）`);
  const debtNew = debtOf(s).filter((x) => !snap.ledger_debt.includes(x));
  eq("本轮不新增台账欠账", debtNew.length, 0, debtNew.join(" ; "));

  const fail = results.filter((r) => !r.pass);
  fs.writeFileSync(path.join(ROOT, "evidence", "ledger.json"),
    JSON.stringify({ snapshot: snap, verified_at: new Date().toISOString(), total: results.length, pass: results.length - fail.length, results }, null, 2) + "\n");
  console.log(JSON.stringify({ suite: "ledger", total: results.length, pass: results.length - fail.length, fails: fail.map((f) => `${f.id} → ${f.detail}`) }));
  process.exit(fail.length ? 1 : 0);
}

const s = live();
const log = logText();
const snap = {
  taken_at: new Date().toISOString(),
  combo_before: hasCombo(s).length,
  styles_before: STYLES.filter((x) => s.used_styles.includes(x)).length,
  tried: s.tried.length,
  runs: s.runs.length,
  used_styles: s.used_styles.length,
  environment_notes: (s.environment_notes || []).length,
  skills_seen: (s.skills_seen || []).length,
  log_round_lines: roundLines(log).length,
  my_log_lines: log.split("\n").filter((l) => l.includes(ART)).length,
  shader_uses_before: s.tried.filter((t) => (t.skill || "").startsWith("shader（")).length,
  // 既有台账欠账（他人轮次字段缺失）：本轮只要求「不新增」，不改他人条目
  ledger_debt: debtOf(s),
};
fs.writeFileSync(path.join(ROOT, "scripts", "ledger-snapshot.json"), JSON.stringify(snap, null, 2) + "\n");
console.log(JSON.stringify(snap));
