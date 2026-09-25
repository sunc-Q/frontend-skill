#!/usr/bin/env python3
"""export_pptx.py — 三风格 × 6 页导出原生 PPTX，并把 OOXML 测量结果写进 scripts/export-result.json
供 check.py 断言（图表是否仍是可编辑原生形状 / 滤镜是否被忽略 / 渐变是否保真）。
页序显式列表（22:00 轮教训：不用 sorted(glob)；本轮文件名无前缀冲突，双模式仅作对照）。
"""
import json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SKILL_SCRIPTS = Path.home() / ".qoder-cn/skills/ppt-generator/ppt-master-assets/scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from svg_to_pptx import create_pptx_with_native_svg  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
SVG = HERE / "svg"
OUT = HERE / "pptx"
OUT.mkdir(exist_ok=True)
ORDER = ["01_kpi", "02_trend", "03_compare", "04_composition", "05_ranking", "06_funnel"]
NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

def svg_counts(path):
    src = path.read_text(encoding="utf-8")
    texts = re.findall(r"<text [^>]*>", src)
    sizes = sorted({float(m.group(1)) for m in (re.search(r'font-size="([\d.]+)"', t) for t in texts) if m})
    return {"texts": len(texts), "sizes": sizes}

def probe(pptx):
    z = zipfile.ZipFile(pptx)
    slides = sorted(n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n))
    r = {"slides": len(slides),
         "media": len([n for n in z.namelist() if n.startswith("ppt/media/")]),
         "per_slide": []}
    for n in slides:
        x = z.read(n).decode("utf-8")
        szs = sorted({float(m.group(1)) / 100 for m in re.finditer(r'sz="(\d+)"', x)})
        offs = []
        for m in re.finditer(r'<a:(?:off|ext) x="(-?\d+)" y="(-?\d+)"(?: cx="(-?\d+)" cy="(-?\d+)")?', x):
            for g in m.groups():
                if g is not None:
                    offs.append(int(g))
        r["per_slide"].append({
            "at_runs": x.count("<a:t>"),
            "sp": len(re.findall(r"<p:sp>", x)),
            "pic": x.count("<p:pic>"), "blip": x.count("<a:blip"),
            "gradFill": x.count("<a:gradFill"), "effectLst_blur": len(re.findall(r"<a:blur", x)),
            "solidFill": x.count("<a:solidFill"), "custGeom": x.count("<a:custGeom"),
            "alpha": len(re.findall(r"<a:alpha", x)),
            "sizes_pt": szs,
            "emu_min": min(offs) if offs else 0, "emu_max": max(offs) if offs else 0,
        })
    return r

result = {}
for style in ("govblue", "psych", "pixel"):
    files = [SVG / style / f"{p}.svg" for p in ORDER]
    out = OUT / f"echoisle-2025-{style}.pptx"
    ok = create_pptx_with_native_svg(files, out, canvas_format="ppt169",
                                     use_native_shapes=True, use_compat_mode=True,
                                     verbose=False)
    svgmeta = [dict(svg_counts(f), name=f.name) for f in files]
    result[style] = {"export_ok": bool(ok), "pptx": str(out.relative_to(HERE)),
                     "bytes": out.stat().st_size if out.exists() else 0,
                     "svg_pages": svgmeta, "pptx_probe": probe(out) if out.exists() else None}
    # documented 对照：sorted(glob) 顺序是否与显式一致（本轮文件名无 02_toc/02_chapter 冲突）
    result[style]["documented_order_matches"] = [p.name for p in sorted((SVG / style).glob("*.svg"))] == [f.name for f in files]

(HERE / "scripts/export-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({k: {"bytes": v["bytes"], "slides": v["pptx_probe"]["slides"],
                      "media": v["pptx_probe"]["media"], "docmatch": v["documented_order_matches"]}
                  for k, v in result.items()}, ensure_ascii=False))
