#!/usr/bin/env node
// skill-showcase-ledger-mcp-server — stdio MCP server over the lab's own run ledger.
// Implemented in ESM JavaScript (no TS toolchain in this sandbox); follows the
// mcp-builder guide conventions: registerTool + Zod input/outputSchema + annotations
// + structuredContent + pagination + truncation + actionable errors.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const STATE_PATH = process.env.LEDGER_STATE_PATH ||
  fileURLToPath(new URL("../../../state/state.json", import.meta.url));
const CHARACTER_LIMIT = 25000;

const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));

const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").match(/\d+/)?.[0] ?? NaN));

const runs = (state.runs || []).map((r, i) => ({
  index: i,
  time: r.time ?? null,
  skill: r.skill ?? null,
  result: r.result ?? null,
  seconds: num(r.seconds),
  artifact_size: r.artifact_size ?? null,
  cleanup: r.cleanup ?? null,
  push: r.push ?? null,
  notes: r.notes ?? null,
}));

const tried = (state.tried || []).map((t, i) => ({
  index: i,
  skill: t.skill ?? null,
  source: t.source ?? null,
  skill_path: t.skill_path ?? null,
  task: t.task ?? null,
  verdict: t.verdict ?? null,
  time: t.time ?? null,
  artifact: t.artifact ?? null,
  report: t.report ?? null,
}));

const artifactKinds = state.used_artifact_kinds || [];

// ---- shared helpers -------------------------------------------------------

function paginate(items, limit, offset) {
  const slice = items.slice(offset, offset + limit);
  const hasMore = items.length > offset + slice.length;
  return {
    total: items.length,
    count: slice.length,
    offset,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + slice.length } : {}),
  };
}

function fit(text, items, rebuild) {
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  let keep = Math.max(1, Math.floor(items.length / 2));
  let out = rebuild(keep);
  while (out.length > CHARACTER_LIMIT && keep > 1) {
    keep = Math.max(1, Math.floor(keep / 2));
    out = rebuild(keep);
  }
  return { text: out, truncated: keep < items.length };
}

function notFound(label, names, hintTool) {
  const near = names
    .filter((n) => n && (n.toLowerCase().includes(label.toLowerCase()) ||
      label.toLowerCase().includes(n.toLowerCase())))
    .slice(0, 5);
  return `Error: ${label ? `No run found for skill '${label}'.` : "Skill name is required."} ` +
    (near.length
      ? `Closest matches in the ledger: ${near.join(", ")}. `
      : `Known skills: ${names.slice(0, 5).join(", ")}. `) +
    `Call '${hintTool}' with response_format='json' to see the full list.`;
}

const ResponseFormat = { MARKDOWN: "markdown", JSON: "json" };

// ---- server ---------------------------------------------------------------

const server = new McpServer({ name: "skill-showcase-ledger-mcp-server", version: "1.0.0" });

const PagedInput = {
  limit: z.number().int().min(1).max(100).default(20)
    .describe("Maximum results to return, 1-100 (default 20)."),
  offset: z.number().int().min(0).default(0)
    .describe("Number of results to skip for pagination (default 0)."),
  response_format: z.enum(["markdown", "json"]).default("markdown")
    .describe("Output shape. Use 'json' for machine-readable structured results."),
};

server.registerTool(
  "ledger_get_summary",
  {
    title: "Ledger Summary",
    description: `One-shot statistics for the skill-showcase experiment pipeline.

Returns:
  {
    "runs_total": number,
    "runs_success": number,
    "success_rate": number,      // 0-1
    "skills_kept": number,       // verdict contains 留用
    "total_seconds": number,
    "average_seconds": number,
    "slowest_skill": string,
    "artifact_kinds": number,
    "first_run_time": string,
    "last_run_time": string
  }

Use when: you need overall counts before drilling into individual runs.
Don't use when: you want per-run detail (use ledger_list_runs).`,
    inputSchema: {},
    outputSchema: z.object({
      runs_total: z.number(),
      runs_success: z.number(),
      success_rate: z.number(),
      skills_kept: z.number(),
      total_seconds: z.number(),
      average_seconds: z.number(),
      slowest_skill: z.string().nullable(),
      artifact_kinds: z.number(),
      first_run_time: z.string().nullable(),
      last_run_time: z.string().nullable(),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const ok = runs.filter((r) => /success|pass|成功/i.test(String(r.result || "")));
    const timed = runs.filter((r) => Number.isFinite(r.seconds));
    const slowest = timed.slice().sort((a, b) => b.seconds - a.seconds)[0] || null;
    const summary = {
      runs_total: runs.length,
      runs_success: ok.length,
      success_rate: runs.length ? Number((ok.length / runs.length).toFixed(4)) : 0,
      skills_kept: tried.filter((t) => String(t.verdict || "").includes("留用")).length,
      total_seconds: timed.reduce((s, r) => s + r.seconds, 0),
      average_seconds: timed.length
        ? Number((timed.reduce((s, r) => s + r.seconds, 0) / timed.length).toFixed(1)) : 0,
      slowest_skill: slowest ? String(slowest.skill) : null,
      artifact_kinds: artifactKinds.length,
      first_run_time: runs.length ? String(runs[0].time) : null,
      last_run_time: runs.length ? String(runs[runs.length - 1].time) : null,
    };
    const text = [
      "# Skill Showcase Ledger Summary",
      "",
      `- Runs: ${summary.runs_total} (${summary.runs_success} successful, ${summary.success_rate})`,
      `- Skills kept for reuse: ${summary.skills_kept} of ${tried.length} tried`,
      `- Wall time: ${summary.total_seconds}s total, ${summary.average_seconds}s average`,
      `- Slowest run: ${summary.slowest_skill ?? "n/a"}`,
      `- Distinct artifact kinds: ${summary.artifact_kinds}`,
      `- Span: ${summary.first_run_time ?? "n/a"} → ${summary.last_run_time ?? "n/a"}`,
    ].join("\n");
    return { content: [{ type: "text", text }], structuredContent: summary };
  }
);

server.registerTool(
  "ledger_list_runs",
  {
    title: "List Runs",
    description: `Paginated list of pipeline runs, newest last.

Returns (json): { total, count, offset, runs[], has_more, next_offset }
Each run: { index, time, skill, result, seconds, artifact_size, push }

Use when: scanning history, computing per-run numbers.
Don't use when: you already know the skill name (use ledger_get_run).`,
    inputSchema: PagedInput,
    outputSchema: z.object({
      total: z.number(),
      count: z.number(),
      offset: z.number(),
      has_more: z.boolean(),
      next_offset: z.number().optional(),
      truncated: z.boolean(),
      truncation_message: z.string().optional(),
      runs: z.array(z.object({
        index: z.number(),
        time: z.string().nullable(),
        skill: z.string().nullable(),
        result: z.string().nullable(),
        seconds: z.number().nullable(),
      }).strict()),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ limit, offset, response_format }) => {
    const page = paginate(runs, limit, offset);
    const rows = runs.slice(offset, offset + limit).map((r) => ({
      index: r.index,
      time: r.time,
      skill: r.skill,
      result: r.result,
      seconds: Number.isFinite(r.seconds) ? r.seconds : null,
    }));
    const output = { ...page, runs: rows, truncated: false };

    if (response_format === ResponseFormat.MARKDOWN) {
      const lines = [
        `# Runs (${page.total} total, showing ${page.count} from offset ${page.offset})`,
        "",
        "| # | time | skill | seconds |",
        "|---|------|-------|---------|",
        ...rows.map((r) => `| ${r.index} | ${r.time ?? "-"} | ${r.skill ?? "-"} | ${r.seconds ?? "-"} |`),
      ];
      if (page.has_more) lines.push("", `More: call again with offset=${page.next_offset}`);
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }

    const rebuild = (k) => JSON.stringify({ ...output, runs: rows.slice(0, k) }, null, 2);
    const full = rebuild(rows.length);
    const fitRes = fit(full, rows, rebuild);
    if (fitRes.truncated) {
      output.truncated = true;
      output.runs = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
      output.truncation_message =
        `Response truncated from ${rows.length} to ${output.runs.length} items to stay under ` +
        `${CHARACTER_LIMIT} characters. Narrow it with offset/limit.`;
    }
    return { content: [{ type: "text", text: fitRes.text }], structuredContent: output };
  }
);

server.registerTool(
  "ledger_get_run",
  {
    title: "Get Run Detail",
    description: `Full record for one run, looked up by skill name (case-insensitive, substring ok).

Returns: { skill, time, result, seconds, artifact_size, cleanup, push, notes }
Errors are actionable and list the closest known skill names.`,
    inputSchema: {
      skill: z.string().min(1).max(60).describe("Skill name, e.g. 'xlsx' or 'canvas'. Substring match is allowed."),
    },
    outputSchema: z.object({
      skill: z.string(),
      time: z.string().nullable(),
      result: z.string().nullable(),
      seconds: z.number().nullable(),
      artifact_size: z.string().nullable(),
      cleanup: z.string().nullable(),
      push: z.string().nullable(),
      notes: z.string().nullable(),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ skill }) => {
    const names = runs.map((r) => String(r.skill));
    const exact = runs.find((r) => String(r.skill).toLowerCase() === skill.toLowerCase());
    const hit = exact || runs.find((r) => String(r.skill).toLowerCase().includes(skill.toLowerCase()));
    if (!hit) return { content: [{ type: "text", text: notFound(skill, names, "ledger_list_runs") }], isError: true };
    const structured = {
      skill: String(hit.skill),
      time: hit.time,
      result: hit.result,
      seconds: Number.isFinite(hit.seconds) ? hit.seconds : null,
      artifact_size: hit.artifact_size,
      cleanup: hit.cleanup,
      push: hit.push,
      notes: hit.notes,
    };
    const text = [
      `# ${structured.skill}`,
      "",
      `- time: ${structured.time ?? "-"}`,
      `- seconds: ${structured.seconds ?? "-"}`,
      `- result: ${structured.result ?? "-"}`,
      `- artifact size: ${structured.artifact_size ?? "-"}`,
      "",
      "## notes",
      structured.notes ?? "-",
    ].join("\n");
    return { content: [{ type: "text", text }], structuredContent: structured };
  }
);

server.registerTool(
  "ledger_search_skills",
  {
    title: "Search Tried Skills",
    description: `Free-text search over the ledger's kept/rejected verdicts and sources.

Returns: { total, count, offset, matches[], has_more, next_offset }
Each match: { index, skill, source, kept, verdict_excerpt }

Use when: "has a similar skill already been tried?" or "which runs were kept?"
Don't use when: you need run timings (use ledger_list_runs).`,
    inputSchema: {
      ...PagedInput,
      query: z.string().min(1).max(80).describe("Substring to look for in skill name, source and verdict text, e.g. 'xlsx' or '不推荐'."),
      kept_only: z.boolean().default(false).describe("Only return skills whose verdict says 留用 (kept)."),
    },
    outputSchema: z.object({
      total: z.number(),
      count: z.number(),
      offset: z.number(),
      has_more: z.boolean(),
      next_offset: z.number().optional(),
      query: z.string(),
      matches: z.array(z.object({
        index: z.number(),
        skill: z.string().nullable(),
        source: z.string().nullable(),
        kept: z.boolean(),
        verdict_excerpt: z.string(),
      }).strict()),
    }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, kept_only, limit, offset, response_format }) => {
    const q = query.toLowerCase();
    const pool = tried
      .filter((t) => `${t.skill} ${t.source} ${t.verdict} ${t.task}`.toLowerCase().includes(q))
      .filter((t) => !kept_only || String(t.verdict || "").includes("留用"))
      .map((t) => ({
        index: t.index,
        skill: t.skill,
        source: t.source,
        kept: String(t.verdict || "").includes("留用"),
        verdict_excerpt: String(t.verdict || "").slice(0, 220),
      }));
    if (!pool.length) {
      const output = { query, total: 0, count: 0, offset, has_more: false, matches: [] };
      return {
        structuredContent: output,
        content: [{
          type: "text",
          text: `No skills found matching '${query}'.` +
            (kept_only ? " Retry with kept_only=false (rejected skills are also indexed)." : "") +
            ` Try a shorter query; ${tried.length} skills are indexed.`,
        }],
      };
    }
    const page = paginate(pool, limit, offset);
    const rows = pool.slice(offset, offset + limit);
    const output = { query, ...page, matches: rows };
    const text = [
      `# Search '${query}' — ${page.total} match(es), showing ${page.count}`,
      "",
      ...rows.map((m) => `## ${m.skill} (#${m.index}) ${m.kept ? "[KEPT]" : "[not marked kept]"}` +
        `\n- source: ${String(m.source).slice(0, 90)}\n- verdict: ${m.verdict_excerpt}\n`),
      ...(page.has_more ? [`More: call again with offset=${page.next_offset}`] : []),
    ].join("\n");
    return { content: [{ type: "text", text }], structuredContent: output };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
