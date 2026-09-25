#!/usr/bin/env python3
"""template_audit.py — 审计 ppt-generator templates/charts/：
① charts_index.json 与磁盘的一致性；② 本轮用到的 6 张模板「烧死数据」的算术诚实度；
③ 模板与三风格 design_spec 硬约束的冲突（marker / opacity= / filter）。
输出 scripts/template-audit.json。
"""
import json, re, math
import xml.etree.ElementTree as ET
from pathlib import Path

SK = Path.home() / ".qoder-cn/skills/ppt-generator/ppt-master-assets/templates"
HERE = Path(__file__).resolve().parent.parent

def ang12(x, y):
    return math.degrees(math.atan2(x, -y)) % 360

audit = {"index_vs_disk": {}, "templates": {}, "spec_conflicts": {}}

idx = json.load(open(SK / "charts/charts_index.json", encoding="utf-8"))
svgs = sorted(p.name for p in (SK / "charts").glob("*.svg"))
cats = [c for g in idx["categories"].values() for c in g["charts"]]
look = [c for v in idx["quickLookup"].values() for c in v]
entries = list(idx["charts"].keys())
audit["index_vs_disk"] = {
    "meta_total": idx["meta"]["total"],
    "disk_svg_count": len(svgs),
    "category_refs_missing_on_disk": [c for c in cats if f"{c}.svg" not in svgs],
    "quicklookup_refs_missing": sorted({c for c in look if f"{c}.svg" not in svgs}),
    "charts_entries": len(entries),
    "entries_missing_detail_fields": [k for k in entries
        if not all(f in idx["charts"][k] for f in ("label", "summary", "bestFor", "avoidFor", "keywords"))],
    "disk_not_in_index": sorted({s[:-4] for s in svgs} - set(entries)),
    "viewbox_all_1280x720": all(re.search(r'viewBox="0 0 1280 720"', (SK / "charts" / s).read_text(encoding="utf-8")) for s in svgs),
}

USE = ["bar_chart", "line_chart", "donut_chart", "horizontal_bar_chart", "funnel_chart", "kpi_cards"]

def txt(el):
    return "".join(el.itertext()).strip()

def load(name):
    return ET.fromstring((SK / "charts" / f"{name}.svg").read_text(encoding="utf-8"))

# --- bar_chart：柱高 vs 数值标签（注释：每 100M = 200px → 2px/单位），基线 550
r = load("bar_chart")
bars = []
for rect in r.iter("{http://www.w3.org/2000/svg}rect"):
    if rect.get("x") is None or rect.get("width") is None:
        continue
    x, w = float(rect.get("x")), float(rect.get("width"))
    if w == 50 and float(rect.get("height")) > 50:
        h = float(rect.get("height"))
        v = rect.get("y")
        bars.append((x, float(v), h))
texts = [t for t in r.iter("{http://www.w3.org/2000/svg}text")]
labels = []
for t in texts:
    s = txt(t)
    if s.isdigit() and 50 < int(s) < 200 and float(t.get("font-size")) == 16:
        labels.append((float(t.get("x")), int(s)))
drift = []
for (x, y, h), (lx, v) in zip(sorted(bars), sorted(labels)):
    drift.append({"value": v, "height": h, "expect": v * 2.0, "err_pct": round((h - v * 2.0) / (v * 2.0) * 100, 2), "baseline": y + h})
audit["templates"]["bar_chart"] = {"honest": all(abs(d["err_pct"]) < 1 for d in drift), "bars": drift}

# --- horizontal_bar_chart：宽 vs %（0-100% 映射 900px），x0=300
r = load("horizontal_bar_chart")
hb = []
for rect in r.iter("{http://www.w3.org/2000/svg}rect"):
    if rect.get("height") == "36" and float(rect.get("x")) == 300:
        hb.append(float(rect.get("width")))
pcts = [int(m.group(1)) for m in re.finditer(r'条形\d: [^—\n]+- (\d+)%', (SK / "charts/horizontal_bar_chart.svg").read_text(encoding="utf-8"))]
audit["templates"]["horizontal_bar_chart"] = {
    "widths": hb, "claimed_pct": pcts,
    "expect": [p * 9.0 for p in pcts],
    "honest": all(abs(w - p * 9.0) < 1 for w, p in zip(hb, pcts)),
}

# --- donut_chart：声明角度 vs 由路径端点反推的真实扫角
src = (SK / "charts/donut_chart.svg").read_text(encoding="utf-8")
claims = [(int(m.group(1)), float(m.group(2))) for m in re.finditer(r'(\d+)% \([^)]*\) - 角度: ([\d.]+)°', src)]
r = load("donut_chart")
sectors = []
for pth in r.iter("{http://www.w3.org/2000/svg}path"):
    d = pth.get("d")
    m = re.match(r'M ([\-\d.]+),([\-\d.]+) A 180,180 0 \d,1 ([\-\d.]+),([\-\d.]+)', d)
    if m:
        x0, y0, x1, y1 = map(float, m.groups())
        sectors.append((ang12(x0, y0), ang12(x1, y1)))
meas = [(round((a1 - a0) % 360, 1)) for a0, a1 in sectors]
audit["templates"]["donut_chart"] = {
    "claimed_pct": [c[0] for c in claims],
    "claimed_angle": [c[1] for c in claims],
    "measured_sweep": meas,
    "drift_deg": [round(mm - ca, 1) for mm, (_, ca) in zip(meas, claims)],
    "sum_measured": round(sum(mm * 180 / 180 for mm in meas), 1),
    "honest": all(abs(mm - ca) < 0.5 for mm, (_, ca) in zip(meas, claims)),
}

# --- funnel_chart：占比如实标注，但顶宽是否 ∝ 占比（注释：100%→600px）
srcf = (SK / "charts/funnel_chart.svg").read_text(encoding="utf-8")
cw = [(int(m.group(1).replace(",", "")), float(m.group(2)))
      for m in re.finditer(r'(\d[\d,]*)\s*\(([\d.]+)%\)', srcf)][:5]
r = load("funnel_chart")
tops = []
for pth in r.iter("{http://www.w3.org/2000/svg}path"):
    m = re.match(r'M ([\-\d.]+),\d+ L ([\-\d.]+),\d+', pth.get("d"))
    if m:
        tops.append(float(m.group(2)) - float(m.group(1)))
audit["templates"]["funnel_chart"] = {
    "stage_counts_pct": cw, "measured_top_widths": tops,
    "expect_if_prop": [round(p / 100 * 600, 1) for _, p in cw],
    "honest": all(abs(w - p / 100 * 600) < 5 for w, (_, p) in zip(tops, cw)),
    "note": "实测顶宽 600/510/420/330 —— 等差 −90px，与占比无关",
}

# --- line_chart：x 等距；数据点无标签（诚实性不可判，记录观察）
r = load("line_chart")
pl = [p for p in r.iter("{http://www.w3.org/2000/svg}polyline")]
xs = [float(a.split(",")[0]) for a in pl[0].get("points").split()]
audit["templates"]["line_chart"] = {
    "series": len(pl), "x_gaps": sorted(set(round(b - a) for a, b in zip(xs, xs[1:]))),
    "value_labels_on_points": False,
}

# --- kpi_cards：四卡标题文本左缘是否对齐（模板自称 CRAP 优化版）
r = load("kpi_cards")
cards = []
for rect in r.iter("{http://www.w3.org/2000/svg}rect"):
    if rect.get("width") == "560" and rect.get("height") == "250":
        cards.append((float(rect.get("x")), float(rect.get("y"))))
label_x = {}
for t in r.iter("{http://www.w3.org/2000/svg}text"):
    x, y, fs = float(t.get("x")), float(t.get("y")), t.get("font-size")
    if fs == "18":
        c = min(range(4), key=lambda i: abs(y - (cards[i][1] + 40)) + abs(x - (cards[i][0] + 40)))
        label_x.setdefault(cards[c], []).append(x - cards[c][0])
audit["templates"]["kpi_cards"] = {
    "card_rects": cards,
    "label_x_by_card": {f"{cx},{cy}": sorted(set(v)) for (cx, cy), v in sorted(label_x.items())},
    "all_offsets_equal": len({tuple(sorted(set(v))) for v in label_x.values()}) == 1,
}

# --- 与风格 spec 硬约束的冲突：marker / 非 fill/stroke 的 opacity= / filter / rgba
conf = {}
for name in USE:
    s = (SK / "charts" / f"{name}.svg").read_text(encoding="utf-8")
    conf[name] = {
        "marker": len(re.findall(r"<marker", s)),
        "filter_feGaussianBlur": len(re.findall(r"feGaussianBlur", s)),
        "bare_opacity_attr": len(re.findall(r'\sopacity="', s)),
        "rgba": len(re.findall(r"rgba\(", s)),
        "foreignObject": len(re.findall(r"foreignObject", s)),
    }
audit["spec_conflicts"] = conf
audit["skillmd_charts_mentions"] = {
    "body_mentions": len(re.findall(r"templates/charts|charts_index", (SK.parent.parent / "SKILL.md").read_text(encoding="utf-8"))),
    "description_has_30plus_charts": "30+ charts" in (SK.parent.parent / "SKILL.md").read_text(encoding="utf-8"),
}

out = HERE / "scripts/template-audit.json"
out.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(audit, ensure_ascii=False)[:1500])
