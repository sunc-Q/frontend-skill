#!/usr/bin/env python3
"""三风格计算样式判定：双指标——互斥性（每对 ≥3 项不同）+ 同构性（结构完全一致）。

用法：
  python3 scripts/style-diff.py /tmp/hs-probe.json
  python3 scripts/style-diff.py probe-a.json probe-b.json probe-c.json   # 也可逐主题给

输入由 scripts/style-probe.js 采集：要么是一个 {主题: 探针对象} 的合并 JSON，
要么是每份探针单独成文件（browser-use evaluate_script 会再包一层 JSON 字符串，这里兼容）。
同构性是本项目的核心承诺：三风格 = 同一份 DOM + 同一份 JS，只换 CSS，
所以结构字段（元素数量、外链数量、内联样式表数量）必须三主题全等。
"""
import itertools
import json
import sys

GROUPS = (
    "gap", "kpi", "label", "value", "head", "btn", "input",
    "badge", "panel", "cal", "calPrice", "calDate", "legend", "grid",
)
# 结构字段：必须三主题一致，否则说明「只换 CSS」被破坏。
STRUCT = ("kpiCount", "rowCount", "calCellCount", "rowCountCal", "inlineStyles", "inlineScripts", "external")
# 必须为空/为零的健康字段（不一致即真出错，不算风格差异）。
CLEAN = ("consoleErrors",)


def load(paths):
    out = {}
    for p in paths:
        raw = open(p, encoding="utf-8").read().strip()
        if raw.startswith('"'):          # evaluate_script 会把返回值再包一层 JSON 字符串
            raw = json.loads(raw)
        o = json.loads(raw) if isinstance(raw, str) else raw
        if "theme" not in o and len(GROUPS) and all(g in o for g in ("kpi", "label")):
            raise SystemExit(f"{p} 缺 theme 字段，无法归并主题")
        if "theme" in o:
            out[o["theme"]] = o
        else:                            # 合并文件：{skeuo: {...}, iso: {...}, acid: {...}}
            for k, v in o.items():
                out[k] = v
    return out


def main(paths):
    if not paths:
        raise SystemExit(__doc__)
    raw = load(paths)
    if len(raw) < 2:
        raise SystemExit(f"至少需要两个主题，当前只有 {list(raw)}")
    first = raw[sorted(raw)[0]]
    props = [(g, k) for g in GROUPS for k in sorted(first[g])]
    print(f"比较属性数：{len(props)}（探针主题：{', '.join(sorted(raw))}）")
    bad = 0

    print("\n① 互斥性：每对主题至少 3 项计算样式不同")
    for a, b in itertools.combinations(sorted(raw), 2):
        diffs = [(g, k) for g, k in props if str(raw[a][g][k]) != str(raw[b][g][k])]
        ok = len(diffs) >= 3
        bad += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'} {a} vs {b}：{len(diffs)} 项不同 -> "
              + ", ".join(f"{g}.{k}" for g, k in diffs[:8]))

    print("\n② 同构性：结构字段三主题必须全等（同一份 DOM + 同一份 JS）")
    for key in STRUCT:
        vals = {t: raw[t].get(key) for t in raw}
        uniq = {json.dumps(v, sort_keys=True, ensure_ascii=False) for v in vals.values()}
        if len(uniq) != 1:
            print(f"FAIL {key} 不一致：{vals}")
            bad += 1
        else:
            print(f"ok   {key} 三主题一致：{list(vals.values())[0]}")
    for key in CLEAN:
        for t in sorted(raw):
            v = raw[t].get(key) or []
            if v:
                print(f"FAIL {t}.{key} 非空：{v[:3]}")
                bad += 1
            else:
                print(f"ok   {t}.{key} 为空")
    if any(raw[t].get("external") for t in raw):
        print("FAIL 存在外部资源链接（要求零外链）")
        bad += 1

    print("\n③ 内容取样（证明页面真的从接口取到了数，而不是空壳）")
    for t in sorted(raw):
        print(f"  {t}: kpi={raw[t].get('kpiText')!r} cal={raw[t].get('calText')!r} theme={raw[t].get('theme')}")

    print(f"\n失败项：{bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
