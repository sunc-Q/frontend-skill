#!/usr/bin/env python3
"""export_pptx.py — 三风格 × 6 页导出原生 PPTX，并把 OOXML 测量写进 scripts/export-result.json。
页序显式列表（22:00 教训：sorted(glob) 会让 02_chapter 排在 02_toc 前）。
运行需要 python-pptx/lxml/Pillow：PYTHONPATH=LAB/.tmp/pylibs（pypi 走 mirrors.aliyun.com，见 environment_notes）。
"""
import json, re, sys, zipfile
from pathlib import Path

SKILL_SCRIPTS = Path.home() / ".qoder-cn/skills/ppt-generator/ppt-master-assets/scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from svg_to_pptx import create_pptx_with_native_svg  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
SVG, OUT = HERE / "svg", HERE / "pptx"
OUT.mkdir(exist_ok=True)
ORDER = ["01_cover", "02_toc", "03_status", "04_arch", "05_plan", "06_ending"]

def probe(pptx):
    z = zipfile.ZipFile(pptx)
    slides = sorted((n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                    key=lambda n: int(re.search(r"(\d+)", n).group(1)))
    r = {"slides": len(slides), "media": len([n for n in z.namelist() if n.startswith("ppt/media/")]),
         "bytes": pptx.stat().st_size, "per_slide": []}
    for n in slides:
        x = z.read(n).decode("utf-8")
        szs = sorted({float(m.group(1)) / 100 for m in re.finditer(r'sz="(\d+)"', x)})
        offs = [int(g) for m in re.finditer(r'<a:(?:off|ext) x="(-?\d+)" y="(-?\d+)"(?: cx="(-?\d+)" cy="(-?\d+)")?', x)
                for g in m.groups() if g is not None]
        r["per_slide"].append({
            "at_runs": x.count("<a:t>"), "sp": len(re.findall(r"<p:sp>", x)),
            "pic": x.count("<p:pic>"), "blip": x.count("<a:blip"),
            "gradFill": x.count("<a:gradFill"), "blur": len(re.findall(r"<a:blur", x)),
            "solidFill": x.count("<a:solidFill"), "custGeom": x.count("<a:custGeom"),
            "alpha": len(re.findall(r"<a:alpha", x)), "prstGeom": x.count("<a:prstGeom"),
            "sizes_pt": szs, "emu_min": min(offs) if offs else 0, "emu_max": max(offs) if offs else 0,
        })
    return r

result = {}
for style in ("consultant", "government_red", "tech_blue"):
    files = [SVG / style / f"{p}.svg" for p in ORDER]
    out = OUT / f"chengxi-ioc-proposal-{style}.pptx"
    ok = create_pptx_with_native_svg(files, out, canvas_format="ppt169",
                                     use_native_shapes=True, use_compat_mode=True, verbose=False)
    assert ok and out.exists(), style
    result[style] = probe(out)
    print(style, "slides", result[style]["slides"], "media", result[style]["media"],
          "runs", [s["at_runs"] for s in result[style]["per_slide"]])
(HERE / "scripts" / "export-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
