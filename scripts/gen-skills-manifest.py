"""Generate skills/manifest.json from the read-only skill snapshots actually on disk.

Numbers are never hand-copied: file counts, byte totals and sha256 prefixes are
read from the files themselves, and the ledger decides which rounds should have
a snapshot present.
"""
import hashlib
import json
import os

LAB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(LAB, "skills")


def main():
    state = json.load(open(os.path.join(LAB, "state", "state.json"), encoding="utf-8"))
    used = [r.get("skill") for r in state["runs"] if r.get("skill")]

    entries = []
    for name in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, name)
        if not os.path.isdir(d):
            continue
        files = []
        for dirpath, _, names in os.walk(d):
            for f in sorted(names):
                p = os.path.join(dirpath, f)
                files.append({
                    "path": os.path.relpath(p, d),
                    "bytes": os.path.getsize(p),
                    "sha256": hashlib.sha256(open(p, "rb").read()).hexdigest()[:16],
                })
        files.sort(key=lambda e: e["path"])
        entries.append({
            "skill": name,
            "files": len(files),
            "total_bytes": sum(f["bytes"] for f in files),
            "read_only": not os.access(d, os.W_OK),
            "manifest": files,
        })

    have = {e["skill"] for e in entries}
    out = {
        "generated_by": "scripts/gen-skills-manifest.py",
        "generated_from": "skills/ as found on disk",
        "snapshots": entries,
        "rounds_recorded": len(used),
        "skills_with_snapshot": sorted(have),
        "rounds_missing_snapshot": sorted({s for s in used if s not in have}),
        "note": ("第 1–19 轮的技能包落在 LAB/.skills/（被 .gitignore 排除），只有第 20 轮起"
                 "把所用技能快照放进 skills/ 入仓；缺失项列在 rounds_missing_snapshot，"
                 "不做补抄，需要时按 reports/*.md 里的确切命令重新获取。"),
    }
    json.dump(out, open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"{len(entries)} snapshot(s) / {sum(e['files'] for e in entries)} files; "
          f"rounds={out['rounds_recorded']}; missing snapshots={len(out['rounds_missing_snapshot'])}")


if __name__ == "__main__":
    main()
