"""Measure the pipeline's own 8 finished rounds from disk + state.json.

Nothing here is typed from memory: bytes come from os.path.getsize, PASS/FAIL
token counts from regex over each round's output logs, seconds/installed/verdict
from state.json runs[].
"""
import json
import os
import re

LAB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ARTIFACTS = {
    1: "demos/20260925-1723-drafter/skill-lab-pipeline-blueprint.html",
    2: "demos/20260925-1737-ascii-project-dashboard/dashboard.txt",
    3: "demos/20260925-1810-algorithmic-art/art-index.html",
    4: "demos/20260925-1845-sqlite-database-expert/lab.db",
    5: "demos/20260925-1906-ppt-generator/skill-showcase-pixel-retro.pptx",
    6: "demos/20260925-1950-graphic-gif/animation.gif",
    7: "demos/20260925-2332-build-game/frostlight-gather.html",
    8: "demos/20260926-0000-sec-audit-cn/SECURITY-AUDIT.md",
}
SOURCE = {1: "官方市场", 2: "官方市场", 3: "外部仓库", 4: "本机已装",
          5: "官方市场", 6: "官方市场", 7: "官方市场", 8: "本机已装"}
KIND = {1: "工程图纸 HTML", 2: "终端 ASCII 看板", 3: "生成艺术 HTML",
        4: "SQLite 检索库", 5: "幻灯片 PPTX", 6: "动画 GIF",
        7: "3D 游戏 HTML", 8: "审计报告 MD"}

state = json.load(open(os.path.join(LAB, "state", "state.json")))
runs = state["runs"]
tried = state["tried"]

facts = []
for i, (n, path) in enumerate(sorted(ARTIFACTS.items()), start=1):
    run = runs[i - 1]
    t = tried[i - 1]
    skill = run["skill"]
    assert t["skill"] == skill, (n, skill, t["skill"])
    full = os.path.join(LAB, path)
    logdir = os.path.dirname(full)
    blob = ""
    for dp, _, files in os.walk(logdir):
        for fn in files:
            if fn.endswith((".log", ".txt")):
                blob += open(os.path.join(dp, fn), errors="ignore").read()
    verdict = t.get("verdict") or ""
    facts.append({
        "run": n,
        "date": run["time"][:10],
        "skill": skill,
        "source": SOURCE[n],
        "kind": KIND[n],
        "bytes": os.path.getsize(full),
        "seconds": run.get("seconds"),
        "pass": len(re.findall(r"\bPASS\b", blob)),
        "fail": len(re.findall(r"\bFAIL\b", blob)),
        # runs[] lost installed_by_this_task from round 5 on; tried[] still has it
        "installed": len(t.get("installed_by_this_task") or []),
        "verdict": "留用·强推荐" if "强推荐" in verdict else ("留用" if "留用" in verdict else "一般"),
        "path": path,
        "dir": os.path.basename(logdir),
    })

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "facts.json")
json.dump(facts, open(out, "w"), ensure_ascii=False, indent=1)
for f in facts:
    print(f)
print("wrote", out)
