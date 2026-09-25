#!/usr/bin/env python3
"""第 9 轮（ppt-generator × 演示汇报页）导出脚本。

两种模式：
  documented —— 完全照 SKILL.md Phase 3 的代码（sorted(glob)）
  intended   —— 修正页序后的显式顺序（cover → toc → chapter → content → ending）
"""
import sys, json
from pathlib import Path

SKILL_SCRIPTS = Path.home() / ".qoder-cn/skills/ppt-generator/ppt-master-assets/scripts"
sys.path.insert(0, str(SKILL_SCRIPTS))
from svg_to_pptx import create_pptx_with_native_svg  # noqa: E402

HERE = Path(__file__).resolve().parent.parent          # artifacts/20260925-22-ppt-generator-deck
SVG = HERE / "svg"
OUT = HERE / "pptx"
STYLES = ["exhibit", "academic_defense", "smart_red"]
INTENDED = ["01_cover.svg", "02_toc.svg", "02_chapter.svg", "03_content.svg", "04_ending.svg"]
COMPAT = {"exhibit": True, "academic_defense": False, "smart_red": True}

result = {}
for style in STYLES:
    files = sorted((SVG / style).glob("*.svg"))
    ordered = [SVG / style / n for n in INTENDED]
    missing = [str(p) for p in ordered if not p.exists()]
    if missing:
        result[style] = {"error": f"missing pages: {missing}"}
        continue
    entry = {"documented_order": [p.name for p in files], "intended_order": INTENDED}
    for mode, lst in (("documented", files), ("intended", ordered)):
        out = OUT / f"{style}-{mode}.pptx"
        ok = create_pptx_with_native_svg(
            lst, out,
            canvas_format="ppt169",
            use_native_shapes=True,
            use_compat_mode=COMPAT[style],
            verbose=False,
        )
        entry[f"{mode}_ok"] = bool(ok)
        entry[f"{mode}_bytes"] = out.stat().st_size if out.exists() else 0
    entry["compat_mode"] = COMPAT[style]
    result[style] = entry

print(json.dumps(result, ensure_ascii=False, indent=2))
