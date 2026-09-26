#!/usr/bin/env node
// Drive the MCP server over real stdio JSON-RPC and assert the protocol surface.
// Sections A..E are contract checks, F runs the Phase-4 evaluation.xml end to end.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHARACTER_LIMIT = 25000;

const results = [];
const ok = (id, pass, detail) => {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} — ${detail}`);
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.MCP_SERVER_PATH ?? path.join(DIR, "index.mjs")],
  cwd: DIR,
  env: { ...process.env, LEDGER_STATE_PATH: process.env.LEDGER_STATE_PATH ?? "" },
});
const client = new Client({ name: "verify-client", version: "1.0.0" });

const t0 = Date.now();
await client.connect(transport);
console.log(`# connected in ${Date.now() - t0}ms (node ${process.version})\n`);

const call = async (name, args) => client.callTool({ name, arguments: args ?? {} });
const textOf = (r) => (r.content ?? []).map((c) => c.text ?? "").join("\n");

// ---- A. handshake ---------------------------------------------------------
const init = await client.getServerCapabilities();
const info = client.getServerVersion();
ok("A1 server identity", info?.name === "skill-showcase-ledger-mcp-server",
  `serverInfo.name=${info?.name} version=${info?.version}`);
ok("A2 stdio + tools capability", !!init?.tools && !init?.resources && !init?.prompts,
  `capabilities=${JSON.stringify(init)}`);

// ---- B. tool contract -----------------------------------------------------
const { tools } = await client.listTools();
ok("B1 four tools, service-prefixed snake_case", tools.length === 4 &&
  tools.every((t) => /^ledger_[a-z_]+$/.test(t.name)),
  tools.map((t) => t.name).join(", "));
ok("B2 explicit title + description on every tool",
  tools.every((t) => t.title && t.description && t.description.length > 60),
  tools.map((t) => `${t.name}:${t.description?.length ?? 0}B`).join(" "));
ok("B3 JSON-RPC schema carries inputSchema.properties",
  tools.filter((t) => Object.keys(t.inputSchema?.properties ?? {}).length > 0).length === 3 &&
  tools.find((t) => t.name === "ledger_get_summary").inputSchema.type === "object",
  tools.map((t) => `${t.name}(${Object.keys(t.inputSchema?.properties ?? {}).length})`).join(" "));
ok("B4 every tool declares outputSchema",
  tools.every((t) => t.outputSchema && Object.keys(t.outputSchema.properties ?? {}).length > 0),
  tools.map((t) => `${t.name}:${Object.keys(t.outputSchema?.properties ?? {}).length}f`).join(" "));
ok("B5 all four annotations set, all read-only",
  tools.every((t) => t.annotations && typeof t.annotations.readOnlyHint === "boolean" &&
    typeof t.annotations.destructiveHint === "boolean" &&
    typeof t.annotations.idempotentHint === "boolean" &&
    typeof t.annotations.openWorldHint === "boolean" &&
    t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false),
  tools.map((t) => `${t.name}:${JSON.stringify(t.annotations)}`).join(" "));
const descWithGuidance = tools.filter((t) => /Use when|use when|Don't use when/.test(t.description)).length;
ok("B6 descriptions carry Use/Don't-use routing", descWithGuidance >= 3,
  `${descWithGuidance}/4 tool descriptions contain routing text`);
ok("B7 limits documented in parameter descriptions",
  tools.some((t) => /1-100/.test(JSON.stringify(t.inputSchema))),
  "limit param description states the 1-100 range");

// ---- C. data correctness vs an independent recomputation ------------------
const statePath = process.env.LEDGER_STATE_PATH ||
  fileURLToPath(new URL("../../../state/state.json", import.meta.url));
const st = JSON.parse(readFileSync(statePath, "utf8"));
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").match(/\d+/)?.[0] ?? NaN));
const rs = st.runs;
const timed = rs.map((r) => num(r.seconds)).filter(Number.isFinite);
const slowest = rs[rs.findIndex((r) => num(r.seconds) === Math.max(...timed))];
const exp = {
  runs_total: rs.length,
  skills_kept: st.tried.filter((t) => String(t.verdict).includes("留用")).length,
  total_seconds: timed.reduce((a, b) => a + b, 0),
  average_seconds: Number((timed.reduce((a, b) => a + b, 0) / timed.length).toFixed(1)),
  slowest_skill: String(slowest.skill),
  artifact_kinds: st.used_artifact_kinds.length,
  first_run_time: rs[0].time,
  last_run_time: rs[rs.length - 1].time,
};
const sumRes = await call("ledger_get_summary");
const sum = sumRes.structuredContent;
ok("C1 structuredContent matches independent recompute",
  Object.entries(exp).every(([k, v]) => JSON.stringify(sum[k]) === JSON.stringify(v)),
  `expected=${JSON.stringify(exp)} actual=${JSON.stringify(sum)}`);
ok("C2 text and structuredContent agree",
  textOf(sumRes).includes(String(sum.runs_total)) && sumRes.structuredContent.runs_success ===
  rs.filter((r) => /success|pass|成功/i.test(String(r.result))).length,
  `text runs=${sum.runs_total} success=${sum.runs_success}`);

// ---- D. pagination / truncation / errors ---------------------------------
const p1 = (await call("ledger_list_runs", { limit: 3, offset: 0 })).structuredContent;
const p2 = (await call("ledger_list_runs", { limit: 3, offset: 3 })).structuredContent;
ok("D1 pagination window is disjoint and contiguous",
  p1.count === 3 && p2.count === 3 && p1.has_more === true && p1.next_offset === 3 &&
  p2.offset === 3 && p2.runs[0].index === 3 &&
  !p1.runs.some((r) => p2.runs.some((q) => q.skill === r.skill)),
  `page1=${p1.runs.map((r) => r.skill)} page2=${p2.runs.map((r) => r.skill)}`);
const big = await call("ledger_list_runs", { limit: 100, response_format: "json" });
ok("D2 the real ledger is small enough that truncation must NOT fire",
  textOf(big).length <= CHARACTER_LIMIT && big.structuredContent.truncated === false &&
  big.structuredContent.runs.length === big.structuredContent.total,
  `text=${textOf(big).length}B truncated=${big.structuredContent.truncated} ` +
  `items=${big.structuredContent.runs.length}/${big.structuredContent.total}`);

// Truncation is dead code unless something big enough exists, so exercise it against
// a synthetic fat ledger (300 runs x long notes) rather than trusting the branch.
const fatPath = path.join(DIR, ".fat-state.json");
const fat = {
  runs: Array.from({ length: 300 }, (_, i) => ({
    time: `2026-01-01T00:0${i % 10}+08:00`,
    skill: `fat-skill-${String(i).padStart(3, "0")}`,
    result: "success（留用）。" + "很长的结论 ".repeat(40),
    seconds: 600 + i,
    artifact_size: "n/a",
    cleanup: "n/a",
    push: "n/a",
    notes: "踩坑记录 ".repeat(60),
  })),
  tried: [],
  used_artifact_kinds: [],
};
writeFileSync(fatPath, JSON.stringify(fat));
const fatTransport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.MCP_SERVER_PATH ?? path.join(DIR, "index.mjs")],
  cwd: DIR,
  env: { ...process.env, LEDGER_STATE_PATH: fatPath },
});
const fatClient = new Client({ name: "fat-client", version: "1.0.0" });
await fatClient.connect(fatTransport);
const fatRes = await fatClient.callTool({ name: "ledger_list_runs", arguments: { limit: 100, response_format: "json" } });
const fatText = textOf(fatRes);
const fatOut = fatRes.structuredContent;
ok("D3 truncation fires and stays under CHARACTER_LIMIT on an oversized result",
  fatOut.truncated === true && fatText.length <= CHARACTER_LIMIT &&
  fatOut.runs.length < fatOut.total && fatOut.runs.length >= 1,
  `text=${fatText.length}B items kept=${fatOut.runs.length}/${fatOut.total}`);
ok("D4 truncation message is actionable (names offset/limit)",
  /offset|limit/.test(fatOut.truncation_message ?? "") &&
  /25000/.test(fatOut.truncation_message ?? ""),
  fatOut.truncation_message ?? "n/a");
const fatPage = await fatClient.callTool({ name: "ledger_list_runs", arguments: { limit: 3, offset: 0, response_format: "json" } });
ok("D5 small pages never truncate and keep has_more/next_offset",
  fatPage.structuredContent.truncated === false && fatPage.structuredContent.has_more === true &&
  fatPage.structuredContent.next_offset === 3,
  `count=${fatPage.structuredContent.count} total=${fatPage.structuredContent.total}`);
await fatClient.close();
unlinkSync(fatPath);

const miss = await call("ledger_get_run", { skill: "definitely-not-a-skill" });
const missText = textOf(miss);
ok("D6 unknown key returns isError with closest matches + next step",
  miss.isError === true && /Closest matches|Known skills/.test(missText) &&
  /ledger_list_runs/.test(missText),
  missText.slice(0, 160).replace(/\n/g, " "));

const badLimit = await client.callTool({ name: "ledger_list_runs", arguments: { limit: 999 } })
  .catch((e) => ({ isError: true, content: [{ type: "text", text: String(e.message) }] }));
const badText = textOf(badLimit);
ok("D7 out-of-range input is rejected before the handler runs",
  badLimit.isError === true && /limit|too_big|invalid/i.test(badText),
  badText.slice(0, 160).replace(/\n/g, " "));

const emptySearch = await call("ledger_search_skills", { query: "zzzz-no-such-thing" });
ok("D8 empty result is not an error, still satisfies outputSchema",
  emptySearch.isError === undefined && /No skills found/.test(textOf(emptySearch)) &&
  emptySearch.structuredContent?.total === 0 && Array.isArray(emptySearch.structuredContent?.matches),
  `structuredContent=${JSON.stringify(emptySearch.structuredContent)} text="${textOf(emptySearch).slice(0, 70)}"`);

// ---- E. idempotency claim -------------------------------------------------
const a = await call("ledger_get_run", { skill: "xlsx" });
const b = await call("ledger_get_run", { skill: "xlsx" });
ok("E1 idempotentHint:true holds byte-for-byte",
  JSON.stringify(a.structuredContent) === JSON.stringify(b.structuredContent) &&
  a.structuredContent.seconds === 720,
  `xlsx seconds=${a.structuredContent.seconds}`);

// ---- F. Phase 4 evaluation ------------------------------------------------
const xml = readFileSync(path.join(DIR, "evaluation.xml"), "utf8");
const pairs = [...xml.matchAll(/<question>([\s\S]*?)<\/question>\s*<answer>([\s\S]*?)<\/answer>/g)]
  .map((m) => [m[1], m[2]]);
ok("F0 evaluation.xml parses with 10 read-only qa_pairs", pairs.length === 10, `${pairs.length} pairs`);

const solve = [
  async () => (await call("ledger_list_runs", { limit: 1, offset: 0 })).structuredContent.runs[0],
  async () => (await call("ledger_get_run", { skill: "ppt-generator" })).structuredContent,
  async () => (await call("ledger_get_run", { skill: "canvas-design" })).structuredContent,
  async () => (await call("ledger_list_runs", { limit: 3, offset: 0 })).structuredContent.runs[2],
  async () => (await call("ledger_list_runs", { limit: 100 })).structuredContent.runs.find((r) => r.seconds === 1080),
  async () => (await call("ledger_get_run", { skill: "docx" })).structuredContent,
  async () => (await call("ledger_get_summary")).structuredContent,
  async () => (await call("ledger_search_skills", { query: "sec-audit-cn" })).structuredContent.matches[0],
  async () => {
    const r = (await call("ledger_list_runs", { limit: 5, offset: 0 })).structuredContent.runs;
    return { average_seconds: (r.reduce((s, x) => s + x.seconds, 0) / r.length).toFixed(1) };
  },
  async () => (await call("ledger_list_runs", { limit: 100 })).structuredContent.runs
    .find((r) => r.seconds === null),
];

let evalPass = 0;
for (let i = 0; i < pairs.length; i++) {
  const [q, expected] = pairs[i];
  let got;
  try {
    got = JSON.stringify(await solve[i]());
  } catch (e) {
    got = "ERROR " + e.message;
  }
  const hit = got.includes(expected);
  if (hit) evalPass++;
  ok(`F${i + 1} ${q.slice(0, 52)}…`, hit, `expected '${expected}' in tool result ${hit ? "" : `got: ${got.slice(0, 200)}`}`);
}
ok("F11 all 10 evaluation answers reachable through the server alone",
  evalPass === 10, `${evalPass}/10 solved via MCP tools only`);

await client.close();

const pass = results.filter((r) => r.pass).length;
console.log(`\n# ${pass}/${results.length} PASS, ${results.length - pass} FAIL, ${Date.now() - t0}ms total`);
process.exit(pass === results.length ? 0 : 1);
