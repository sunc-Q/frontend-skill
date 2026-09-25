#!/usr/bin/env python3
"""spec_probe.py — 开工前置探针：把「技能自带规范」全部现读到 JSON，供 generate.py 与 check.py 消费。
教训来源：22:00/00:00 轮——结构常量不可手抄（kpi 卡 x=640 vs 实际 660）、色板必须由脚本解析而非手抄、
索引与磁盘必须互查（layouts_index meta_total=20 vs 磁盘 13）。
产出 scripts/spec-audit.json：
  A. layouts_index vs 磁盘差集（缺列/虚列/零 SVG）
  B. 三风格 design_spec.md 解析：色板（全部十六进制色 + 角色表）、字级表、画布安全区、栅格基线、页面结构常量
  C. 三风格 5 张模板 SVG 解析：出现色集合、与 spec 色板交集（复测 22:00 结论「模板色板 ∩ spec = 0」）、
     顶栏/底栏 rect 几何、封面背景是否深色、内容页容器 rx / dasharray 等指纹
  D. SKILL.md 声称 vs design_spec 实际（ai_ops「full dark」等）
"""
import json, re
from pathlib import Path

SKILL = Path.home() / ".qoder-cn/skills/ppt-generator"
L = SKILL / "ppt-master-assets/templates/layouts"
OUT = Path(__file__).resolve().parent / "spec-audit.json"

HEX = re.compile(r"#[0-9A-Fa-f]{6}\b")

def spec_colors(style):
    txt = (L / style / "design_spec.md").read_text(encoding="utf-8")
    cols = {}
    for m in re.finditer(r"\*\*(.+?)\*\*\s*\|\s*`(#[0-9A-Fa-f]{6})`", txt):
        cols.setdefault(m.group(2).upper(), []).append(m.group(1))
    return txt, cols

def font_table(txt):
    rows = []
    for m in re.finditer(r"^\|\s*(H1|H2|H3|H4|P|Data|Sub|High|Caption)\s*\|(.+?)\|(\s*[\d\-]+\s*)px[^|]*\|([^|]*)\|", txt, re.M):
        rows.append({"level": m.group(1), "usage": m.group(2).strip(), "size": m.group(3).strip(), "weight": m.group(4).strip()})
    return rows

def font_stack(txt):
    m = re.search(r"\*\*Font Stack\*\*:\s*`(.+?)`", txt)
    return m.group(1) if m else ""

def svg_palette(d):
    cols = {}
    for f in sorted(d.glob("*.svg")):
        for c in HEX.findall(f.read_text(encoding="utf-8")):
            cols.setdefault(c.upper(), set()).add(f.name)
    return {k: sorted(v) for k, v in cols.items()}

def svg_geom(d):
    g = {}
    for f in sorted(d.glob("*.svg")):
        src = f.read_text(encoding="utf-8")
        rects = []
        for m in re.finditer(r"<rect ([^>]*?)/>", src):
            a = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
            try:
                rects.append({k: float(a[k]) for k in ("x", "y", "width", "height") if k in a})
            except ValueError:
                pass
        bg = max(rects, key=lambda r: r.get("width", 0) * r.get("height", 0)) if rects else {}
        full_w_bars = [r for r in rects if r.get("width", 0) >= 1270 and r.get("height", 0) <= 12]
        g[f.name] = {
            "texts": len(re.findall(r"<text[ >]", src)),
            "gradients": len(re.findall(r"<linearGradient", src)),
            "rx_values": sorted({float(m) for m in re.findall(r'rx="([\d.]+)"', src)}),
            "dasharray": sorted(set(re.findall(r'stroke-dasharray="([^"]+)"', src))),
            "font_families": sorted(set(re.findall(r'font-family="([^"]+)"', src))),
            "font_sizes": sorted({float(m) for m in re.findall(r'font-size="([\d.]+)"', src)}),
            "max_rect": bg,
            "full_width_bars": full_w_bars,
            "hex_bg_first": (re.search(r'fill="(#[0-9A-Fa-f]{6})"', src).group(1).upper()
                              if re.search(r'<rect[^>]*fill="(#[0-9A-Fa-f]{6})"', src) else ""),
        }
    return g

STYLES = ["consultant", "government_red", "科技蓝商务"]
audit = {"skill_scripts_note": "create_pptx_with_native_svg in ppt-master-assets/scripts"}

# A. index vs disk
idx = json.loads((L / "layouts_index.json").read_text(encoding="utf-8"))
disk = sorted(p.name for p in L.iterdir() if p.is_dir())
indexed = sorted(idx["layouts"].keys())
audit["index_audit"] = {
    "meta_total": idx["meta"]["total"], "indexed": len(indexed), "on_disk": len(disk),
    "indexed_but_missing": [x for x in indexed if x not in disk],
    "on_disk_but_unindexed": [x for x in disk if x not in indexed],
    "disk_svg_counts": {d: len(list((L / d).glob("*.svg"))) for d in disk},
}

# B+C per style
audit["styles"] = {}
for s in STYLES:
    txt, cols = spec_colors(s)
    spec_hex = {c.upper() for c in HEX.findall(txt)}
    pal = svg_palette(L / s)
    inter = sorted(set(pal) & spec_hex)
    audit["styles"][s] = {
        "spec_font_stack": font_stack(txt),
        "spec_font_table": font_table(txt),
        "spec_roles": {c: v for c, v in cols.items()},
        "spec_hex_all": sorted(spec_hex),
        "template_hex_all": sorted(pal),
        "template_hex_count": len(pal),
        "template_intersection_with_spec": inter,
        "template_only_colors": sorted(set(pal) - spec_hex),
        "geometry": svg_geom(L / s),
    }

# D. SKILL.md claims vs spec（表：| # | Style | Directory | Background |）
skill_md = (SKILL / "SKILL.md").read_text(encoding="utf-8")
rows = re.findall(r"^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$", skill_md, re.M)
claims = {d: {"label": lbl, "bg_claim": bg} for lbl, d, bg in rows}
audit["skill_md_table"] = claims
audit["theme_mode_claims"] = {}
for s in ["ai_ops", "cloud_orange", "consultant", "tech_blue", "科技蓝商务", "government_red"]:
    p = L / s / "design_spec.md"
    tm = ""
    if p.exists():
        m = re.search(r"\*\*Theme Mode\*\*\s*\|\s*([^|]+)\|", p.read_text(encoding="utf-8"))
        tm = m.group(1).strip() if m else ""
    audit["theme_mode_claims"][s] = {"skill_md": claims.get(s, {}).get("bg_claim", "（SKILL.md 表中无此目录名）"),
                                     "design_spec": tm or "（design_spec.md 不在盘上）"}

OUT.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
print("written", OUT)
print(json.dumps(audit["index_audit"], ensure_ascii=False, indent=1))
for s in STYLES:
    e = audit["styles"][s]
    print(s, "| spec colors:", len(e["spec_hex_all"]), "| template colors:", e["template_hex_count"],
          "| intersection:", e["template_intersection_with_spec"])
