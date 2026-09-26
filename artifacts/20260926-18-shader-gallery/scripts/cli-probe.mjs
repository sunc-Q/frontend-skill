/* 探测 shader 技能自带 CLI 与资产清单，全部读数落 evidence/cli-probe.json
 * 用法：node scripts/cli-probe.mjs [SKILL_DIR]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SKILL = process.argv[2] || path.join(os.homedir(), ".qoder-cn", "skills", "shader");
const CLI = path.join(SKILL, "scripts", "shader.js");

function run(args) {
  try {
    const out = execFileSync(process.execPath, [CLI].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { args, code: 0, out: out.trim() };
  } catch (e) {
    return { args, code: e.status === undefined ? -1 : e.status, out: String(e.stdout || "").trim(), err: String(e.stderr || e.message).trim() };
  }
}

function runJson(args) {
  const r = run(args.concat(["--json"]));
  if (r.code !== 0) return { ...r, json: null };
  try {
    return { ...r, json: JSON.parse(r.out) };
  } catch (e) {
    return { ...r, json: null, parseError: String(e.message) };
  }
}

const skillMd = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");

// 1. SKILL.md 的资产清单 vs 磁盘
function listedUnder(heading) {
  const idx = skillMd.indexOf(heading);
  if (idx < 0) return [];
  const rest = skillMd.slice(idx + heading.length);
  const stop = rest.search(/\n#{2,3}\s|^\w[\w ]*:\s*$/m);
  const block = stop < 0 ? rest : rest.slice(0, stop);
  return [...block.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

const listed = {
  templates: listedUnder("Bundled templates:"),
  snippets: listedUnder("Bundled snippets:"),
  references: listedUnder("## References"),
};
const manifest = {};
for (const [group, files] of Object.entries(listed)) {
  manifest[group] = files.map((f) => ({ path: f, exists: fs.existsSync(path.join(SKILL, f)) }));
}
function walk(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(SKILL, dir), { withFileTypes: true })) {
    const rel = path.join(base || "", entry.name);
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel.replace(/\\/g, "/"));
  }
  return out;
}
const onDisk = { assets: walk("assets"), references: walk("references"), scripts: walk("scripts") };
const listedAll = new Set([...listed.templates, ...listed.snippets, ...listed.references]);
const unlisted = {
  assets: onDisk.assets.filter((f) => !listedAll.has("assets/" + f) && !listedAll.has(f)),
  references: onDisk.references.filter((f) => !listedAll.has("references/" + f) && !listedAll.has(f)),
  scripts: onDisk.scripts,
};

// 2. 文档里给出的示例命令逐条照跑
const docCommands = [...skillMd.matchAll(/node \{baseDir\}\/scripts\/shader\.js ([^\n`]+)\n/g)].map((m) =>
  m[1].replace(/^intake\s+"([^"]*)"$/, 'intake "$1"').trim(),
);
const docRuns = docCommands.map((line) => {
  const args = [];
  let cur = "";
  let quote = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === " ") {
      if (cur) { args.push(cur); cur = ""; }
    } else cur += ch;
  }
  if (cur) args.push(cur);
  const r = run(args);
  return { line, args, code: r.code, first: r.out.split("\n")[0] || "", stderr: r.err };
});

// 3. 路由矩阵：5 个 target × 8 个 effect 各选哪个模板
const EFFECTS = ["gradient", "noise", "fbm", "fresnel", "dissolve", "ripple", "scanline", "pixelate"];
const TARGETS = ["webgl", "three", "r3f", "postprocess", "screen", "shadertoy", "unknown-target"];
const matrix = [];
for (const target of TARGETS) {
  for (const effect of EFFECTS) {
    const r = runJson(["demo", target, effect]);
    const start = r.json ? r.json.items[0] : "";
    const file = start.replace(/^Start from:\s*/, "");
    matrix.push({ target, effect, file, exists: file ? fs.existsSync(path.join(SKILL, file)) : false, why: r.json ? r.json.items[1] : "" });
  }
}
const scaffoldMatrix = [];
for (const effect of EFFECTS) {
  const r = runJson(["scaffold", "webgl", effect]);
  scaffoldMatrix.push({
    effect,
    demo: r.json ? r.json.items[0].replace(/^Start from:\s*/, "") : null,
    boilerplate: r.json ? r.json.items[1].replace(/^Closest boilerplate:\s*/, "") : null,
    snippet: r.json ? r.json.items[2].replace(/^Closest snippet:\s*/, "") : null,
  });
}

// 4. effects 清单与 boilerplate / snippet 的可用面对齐
const effectList = runJson(["effects"]);
const names = (effectList.json || []).map((pair) => pair[0]);
const coverage = { effects: names, boilerplate: {}, snippet: {} };
for (const name of names) {
  coverage.boilerplate[name] = run(["boilerplate", name]).code;
  coverage.snippet[name] = run(["snippet", name]).code;
}
for (const kind of ["black-screen", "compile", "uniform", "varyings", "uv"]) coverage["debug_" + kind] = run(["debug", kind]).code;
coverage.debug_unknown = run(["debug", "color-space"]).code;
coverage.unknown_command = run(["nope"]).code;
coverage.no_args = run(["demo", "webgl"]).code;

// 5. snippet 正文（喂给浏览器真编译）
const snippets = {};
for (const name of ["fresnel", "dissolve", "ripple", "scanline", "pixelate", "vertex-wobble"]) {
  const md = fs.readFileSync(path.join(SKILL, "assets", "snippets", `${name}.md`), "utf8");
  const blocks = [...md.matchAll(/```glsl\n([\s\S]*?)```/g)].map((m) => m[1]);
  snippets[name] = { blocks, signatures: blocks.join("\n").match(/^(float|vec2|vec3)\s+\w+\(/gm) || [] };
}

// 6. 参考文档里可机检的条款（GLSL 快速参考的关键行）
const refs = {};
for (const f of onDisk.references) {
  refs[f] = fs.readFileSync(path.join(SKILL, "references", f), "utf8");
}
const cliSource = fs.readFileSync(CLI, "utf8");
const deadTernary = /normalizedTarget === "webgl"\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/.exec(cliSource);

const evidence = {
  skill_dir: SKILL,
  cli: { bytes: fs.statSync(CLI).size, lines: cliSource.split("\n").length },
  manifest,
  on_disk: onDisk,
  unlisted,
  doc_runs: docRuns,
  matrix,
  scaffold_matrix: scaffoldMatrix,
  coverage,
  snippets,
  dead_ternary: deadTernary ? { left: deadTernary[1], right: deadTernary[2], same: deadTernary[1] === deadTernary[2] } : null,
  meta: JSON.parse(fs.readFileSync(path.join(SKILL, "_meta.json"), "utf8")),
  skill_md_bytes: Buffer.byteLength(skillMd),
};

fs.mkdirSync(path.join(ROOT, "evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "evidence", "cli-probe.json"), JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify(
    {
      templates: manifest.templates.length,
      templates_missing: manifest.templates.filter((t) => !t.exists).length,
      references: manifest.references.length,
      references_missing: manifest.references.filter((t) => !t.exists).length,
      snippets: manifest.snippets.length,
      snippets_missing: manifest.snippets.filter((t) => !t.exists).length,
      doc_runs_failed: docRuns.filter((d) => d.code !== 0).map((d) => d.line),
      matrix_webgl_fullscreen_hits: matrix.filter((m) => m.file.indexOf("webgl-fullscreen") >= 0).length,
      matrix_missing_files: matrix.filter((m) => !m.exists).map((m) => [m.target, m.effect, m.file]),
      boilerplate_exitcodes: coverage.boilerplate,
      snippet_exitcodes: coverage.snippet,
      dead_ternary: evidence.dead_ternary,
      unlisted_assets: unlisted.assets,
      unlisted_scripts: unlisted.scripts,
    },
    null,
    2,
  ),
);
