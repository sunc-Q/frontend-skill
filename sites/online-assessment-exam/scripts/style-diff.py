#!/usr/bin/env python3
"""三风格计算样式互斥性判定：读入若干探针 JSON，逐对比较 39 个计算属性。

用法：python3 scripts/style-diff.py probe-glass.json probe-construct.json probe-journal.json
判定：每对主题至少 3 项不同（口径来自任务规范），且三方全同的属性只能是结构性属性。
探针 JSON 由 scripts/style-probe.js 经 browser-use evaluate_script 采集后原样落盘。
"""
import itertools
import json
import sys

GROUPS = ("gap", "kpi", "label", "value", "head", "btn", "input", "badge")


def load(paths):
    out = {}
    for p in paths:
        raw = open(p, encoding="utf-8").read().strip()
        if raw.startswith('"'):          # evaluate_script 会把返回值再包一层 JSON 字符串
            raw = json.loads(raw)
        o = json.loads(raw) if isinstance(raw, str) else raw
        out[o["t"]] = o
    return out


def main(paths):
    raw = load(paths)
    props = [(g, k) for g in GROUPS for k in sorted(raw[list(raw)[0]][g])]
    print(f"比较属性数：{len(props)}（探针主题：{', '.join(sorted(raw))}）")
    bad = 0
    for a, b in itertools.combinations(sorted(raw), 2):
        diffs = [(g, k) for g, k in props if str(raw[a][g][k]) != str(raw[b][g][k])]
        ok = len(diffs) >= 3
        bad += 0 if ok else 1
        mark = "ok  " if ok else "FAIL"
        print(f"{mark} {a} vs {b}：{len(diffs)} 项不同 -> " + ", ".join(f"{g}.{k}" for g, k in diffs[:10]))
    same = [(g, k) for g, k in props if len({str(raw[t][g][k]) for t in raw}) == 1]
    print(f"三方全同属性（结构性，允许）：{same}")
    for key in ("kpiCount", "rowCount", "swatches", "external"):
        vals = {t: raw[t].get(key) for t in raw}
        if len({json.dumps(v, sort_keys=True) for v in vals.values()}) != 1:
            print(f"FAIL {key} 在三主题间不一致：{vals}")
            bad += 1
        else:
            print(f"ok   {key} 三主题一致：{list(vals.values())[0]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
