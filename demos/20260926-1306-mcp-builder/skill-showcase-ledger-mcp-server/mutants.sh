#!/bin/sh
# Regenerate the three negative controls, then run verify.mjs against each.
# Each mutant must turn exactly one assertion red (M1->B5, M2->D1, M3->D8).
set -e
cd "$(dirname "$0")"
export LEDGER_STATE_PATH="$(cd ../../.. && pwd)/state/state.json"
mkdir -p .mut
node --input-type=module -e '
import {readFileSync,writeFileSync} from "node:fs";
const src = readFileSync("index.mjs","utf8");
writeFileSync(".mut/m1-no-annotations.mjs", src.replace(/annotations: \{[\s\S]*?\n    \},\n/g, ""));
writeFileSync(".mut/m2-offset-ignored.mjs", src
  .replace("const slice = items.slice(offset, offset + limit);","const slice = items.slice(0, limit);")
  .replace("const rows = runs.slice(offset, offset + limit).map","const rows = runs.slice(0, limit).map"));
writeFileSync(".mut/m3-empty-no-structured.mjs", src.replace(
  "      const output = { query, total: 0, count: 0, offset, has_more: false, matches: [] };\n      return {\n        structuredContent: output,","      return {"));
'
for m in m1-no-annotations m2-offset-ignored m3-empty-no-structured; do
  echo "=== $m ==="
  MCP_SERVER_PATH="$PWD/.mut/$m.mjs" node verify.mjs | grep -E "^FAIL|^# [0-9]" || true
done
