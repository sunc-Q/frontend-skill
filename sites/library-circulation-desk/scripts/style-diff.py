#!/usr/bin/env python3
"""三风格计算样式判定：双指标 —— 互斥性 + 同构性。

用法：
  python3 scripts/style-diff.py /tmp/lcd-probe.json
  python3 scripts/style-diff.py probe-lego.json probe-riso.json probe-decon.json

输入由 scripts/style-probe.js 采集：既接受 style-shoot.mjs 产出的合并 JSON
（{主题: 探针对象}），也接受每主题单独成文（browser-use evaluate_script 会把
返回值再包一层 JSON 字符串，这里一并兼容）。

为什么两个指标都要：
  · 只量互斥性，会出现「三套风格其实是三个不同页面」——结构漂移没人发现；
  · 只量同构性，会出现「三套 CSS 其实没区别」——宣称的多风格成了空话。
本项目的承诺是「同一份 DOM + 同一份 JS，只换 CSS」，所以两者必须同时成立。
"""
import itertools
import json
import sys

# 会随风格变化的计算样式分组（互斥性按这些属性两两比对）
STYLE_GROUPS = (
    "shell", "brand", "kpi", "label", "value", "head", "row",
    "btn", "input", "badge", "gap", "bar", "fill", "status", "stamp",
)
# 结构字段：三主题必须全等，否则「只换 CSS」的前提被破坏
STRUCT = (
    "rowCount", "kpiCount", "badgeCount", "copyCount", "tabCount",
    "inlineScripts", "inlineStyles", "external",
)
# 内容与稳定性字段：三主题必须全等且非空（空壳页面骗不过这一项）
CONTENT = ("firstKpi", "firstBadge")
CLEAN = ("consoleErrors",)


def load(paths):
    out = {}
    for p in paths:
        raw = open(p, encoding="utf-8").read().strip()
        if raw.startswith('"'):
            raw = json.loads(raw)
        o = json.loads(raw) if isinstance(raw, str) else raw
        if "theme" in o:
            if o["theme"] in out:
                raise SystemExit(f"{p}: 主题 {o['theme']} 重复出现，探针可能跑错了页面")
            out[o["theme"]] = o
        else:
            for k, v in o.items():
                out[k] = v
    missing = [t for t, v in out.items() if "kpi" not in v]
    if missing:
        raise SystemExit(f"以下主题缺 kpi 探针分组，形状不是 style-probe.js：{missing}")
    return out


def main(paths):
    if not paths:
        raise SystemExit(__doc__)
    raw = load(paths)
    if len(raw) < 2:
        raise SystemExit(f"至少需要两个主题，当前只有 {list(raw)}")
    names = sorted(raw)
    props = [(g, k) for g in STYLE_GROUPS for k in sorted(raw[names[0]][g])]
    print(f"探针主题：{', '.join(names)}；比较计算样式属性 {len(props)} 项")
    bad = 0

    print("\n① 互斥性：每对主题至少 3 项计算样式不同")
    for a, b in itertools.combinations(names, 2):
        diffs = [(g, k) for g, k in props
                 if str(raw[a].get(g, {}).get(k)) != str(raw[b].get(g, {}).get(k))]
        ok = len(diffs) >= 3
        bad += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'} {a} vs {b}：{len(diffs)} 项不同 -> "
              + ", ".join(f"{g}.{k}" for g, k in diffs[:9]))

    print("\n② 同构性：结构字段必须全等（同一份 DOM + 同一份 JS，只换 CSS）")
    for key in STRUCT:
        vals = {t: raw[t].get(key) for t in names}
        uniq = {json.dumps(v, sort_keys=True, ensure_ascii=False) for v in vals.values()}
        if len(uniq) != 1:
            print(f"FAIL {key} 不一致：{vals}")
            bad += 1
        else:
            print(f"ok   {key} 全等：{list(vals.values())[0]}")
    for key in CONTENT:
        vals = {t: raw[t].get(key) for t in names}
        uniq = set(vals.values())
        if len(uniq) != 1 or "" in uniq or None in uniq:
            print(f"FAIL {key} 不一致或为空：{vals}")
            bad += 1
        else:
            print(f"ok   {key} 全等且非空：{list(vals.values())[0]!r}")
    for key in CLEAN:
        for t in names:
            v = raw[t].get(key) or []
            if v:
                print(f"FAIL {t}.{key} 非空：{v[:3]}")
                bad += 1
            else:
                print(f"ok   {t}.{key} 为空")
    if any(raw[t].get("external") for t in names):
        print("FAIL 存在外部资源链接（要求零外链）")
        bad += 1

    print("\n③ 内容取样（页面确实从接口取到了数）")
    for t in names:
        print(f"  {t}: 行={raw[t].get('rowCount')} KPI={raw[t].get('kpiCount')} "
              f"徽标={raw[t].get('badgeCount')} 首KPI={raw[t].get('firstKpi')!r} "
              f"首徽标={raw[t].get('firstBadge')!r}")

    print(f"\n失败项：{bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
