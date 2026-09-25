"""Reproduce the ppt-generator skill's Phase 3: SVG -> native editable PPTX.

Run:
  SKILL=$HOME/.qoder-cn/skills/ppt-generator
  python3 -m pip install --target ../../.tmp/pylibs --index-url https://pypi.tuna.tsinghua.edu.cn/simple python-pptx
  PYTHONPATH=../../.tmp/pylibs python3 build_pptx.py
"""
import sys, os
from pathlib import Path

SKILL = Path(os.path.expanduser("~/.qoder-cn/skills/ppt-generator/ppt-master-assets/scripts"))
sys.path.insert(0, str(SKILL))
from svg_to_pptx import create_pptx_with_native_svg  # noqa: E402

HERE = Path(__file__).resolve().parent
svgs = sorted((HERE / "svg_slides").glob("*.svg"))
out = HERE / "skill-showcase-pixel-retro.pptx"
create_pptx_with_native_svg(svgs, out, canvas_format="ppt169",
                            use_native_shapes=True, verbose=True)
print("SLIDES:", len(svgs))
print("OUTPUT:", out, os.path.getsize(out), "bytes")
