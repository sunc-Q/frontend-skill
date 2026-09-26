# skill-showcase-ledger-mcp-server

stdio MCP server that exposes the lab's own run ledger (`../../../state/state.json`) as
four read-only tools. Built with the `mcp-builder` skill (Anthropic skills repo),
following its TypeScript-guide conventions in ESM JavaScript.

## Tools

| tool | args | annotations |
|------|------|-------------|
| `ledger_get_summary` | – | read-only, idempotent |
| `ledger_list_runs` | `limit` 1-100, `offset`, `response_format` markdown\|json | read-only, paginated, truncating |
| `ledger_get_run` | `skill` (substring ok) | read-only; unknown key → actionable `isError` |
| `ledger_search_skills` | `query`, `kept_only`, `limit`, `offset`, `response_format` | read-only |

## Reproduce from scratch

```sh
cd skill演示场/demos/20260926-1306-mcp-builder
npm i @modelcontextprotocol/sdk zod --registry=https://registry.npmmirror.com --no-audit --no-fund
cd skill-showcase-ledger-mcp-server
python3 gen_eval.py        # writes evaluation.xml (answers computed independently in Python)
node verify.mjs            # 32 assertions over a real stdio JSON-RPC session -> exit 0
```

Point it at another ledger with `LEDGER_STATE_PATH=/abs/path/state/state.json`.

To register it in a real MCP client, the command is
`node <abs path>/index.mjs` over stdio.

## Artifacts in this directory

- `index.mjs` — the server
- `verify.mjs` + `output.log` — 32 assertions, golden 32/32 plus three mutants each red on exactly one
- `evaluation.xml` + `gen_eval.py` — Phase 4 evaluation, 10 stable read-only qa_pairs
- `protocol-transcript.log` — raw JSON-RPC frames, no SDK client involved
- `mutants.sh` — regenerates the three negative controls (they are not kept on disk)

Note: `state.json` is append-only, so `ledger_get_summary`'s totals change every round;
the evaluation questions were deliberately anchored to immutable head-of-history facts
for that reason (see the round report).
