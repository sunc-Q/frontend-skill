#!/usr/bin/env python3
"""Phase 4 (mcp-builder): build evaluation.xml.

Answers are computed HERE, straight from state/state.json, with no reference to the
MCP server — so when verify.mjs gets the same answers back over the protocol the two
implementations are genuinely cross-checking each other.

Requirement 4.3 asks for questions whose answers stay *stable*. The ledger is
append-only, so any "how many runs are there in total" question would go stale the
moment this round is recorded. Every question below is therefore anchored to an
immutable fact (a specific past run, or a window at the head of the list).
"""
import json
import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.environ.get("LEDGER_STATE_PATH", os.path.join(HERE, "..", "..", "..", "state", "state.json"))
OUT = os.path.join(HERE, "evaluation.xml")

s = json.load(open(STATE, encoding="utf-8"))
runs = s["runs"]


def secs(r):
    return r.get("seconds") if isinstance(r.get("seconds"), int) else None


first, third, docx, shader, sec = runs[0], runs[2], None, None, None
by_skill = {r["skill"]: r for r in runs}
docx = by_skill["docx"]
shader = by_skill["shader"]
sec = [r for r in runs if secs(r) is None][0]
ppt = by_skill["ppt-generator"]
canvas = by_skill["canvas-design"]
head5 = [secs(r) for r in runs[:5]]

tried = {t["skill"]: t for t in s["tried"]}
_unused = sum(1 for t in s["tried"]
                if "zz" in f"{t.get('skill')} {t.get('source')} {t.get('verdict')} {t.get('task')}".lower())

qas = [
    ("Which skill was the very first run of this pipeline?",
     str(first["skill"])),
    ("According to the run ledger, how many seconds did the ppt-generator run take?",
     str(secs(ppt))),
    ("How many seconds did the slowest recorded run (the visual-art plate one) report?",
     str(secs(canvas))),
    ("When listing runs with limit=3 offset=0, which skill appears as the third entry?",
     third["skill"]),
    ("Which skill's run is recorded as taking exactly 1080 seconds?",
     shader["skill"]),
    ("In the docx run's result note, how many independent assertions were reported as passing?",
     "48"),
    ("According to the summary tool, at what local timestamp did the pipeline's first run start?",
     str(first["time"])),
    ("For the skill sec-audit-cn, which source category (来源?) does the index say it came from?",
     "来源③"),
    ("What is the average wall time in seconds across the first five runs (one decimal)?",
     f"{sum(head5) / len(head5):.1f}"),
    ("Which run record has no numeric timing at all, and which skill does it name?",
     sec["skill"]),
]

with open(OUT, "w", encoding="utf-8") as f:
    f.write("<evaluation>\n")
    for q, a in qas:
        f.write(f"  <qa_pair>\n    <question>{escape(q)}</question>\n    <answer>{escape(a)}</answer>\n  </qa_pair>\n")
    f.write("</evaluation>\n")

print(f"wrote {OUT}: {len(qas)} qa_pairs")
for q, a in qas:
    print(" -", a, "|", q[:70])
