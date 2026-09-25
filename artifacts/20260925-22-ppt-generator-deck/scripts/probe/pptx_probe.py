"""Probe the PPTX parts produced by ppt-generator's own svg_to_pptx converter."""
import json
import re
import sys
import zipfile
from pathlib import Path

LAB = Path("/Users/apple/Documents/workProject/试验/前端skill实验室")
ART = LAB / "artifacts" / "20260925-22-ppt-generator-deck"
PPTX = ART / "pptx"
SVG = ART / "svg"

CANVAS_W_EMU = 12192000  # ppt169 16:9 width
CANVAS_H_EMU = 6858000


def titles_in_order(zf):
    names = [n for n in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    names.sort(key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
    out = []
    for n in names:
        xml = zf.read(n).decode("utf-8", "replace")
        texts = re.findall(r"<a:t>(.*?)</a:t>", xml, re.S)
        out.append({
            "part": n,
            "sp_count": xml.count("<p:sp>"),
            "pic_count": xml.count("<p:pic>"),
            "graphic_count": xml.count("<p:graphicFrame>"),
            "txtbox_count": xml.count('type="textbox"'),
            "gradfill_count": xml.count("<a:gradFill"),
            "solidfill_count": xml.count("<a:solidFill"),
            "grp_count": xml.count("<p:grpSp>"),
            "blip_count": xml.count("<a:blip "),
            "first_texts": texts[:3],
            "text_total": len(texts),
        })
    return out


def off_bounds(zf):
    """Return shapes whose offset+extent escapes the slide, and total extCnt."""
    bad = []
    total = 0
    names = sorted((n for n in zf.namelist()
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                   key=lambda n: int(re.search(r"slide(\d+)", n).group(1)))
    for n in names:
        xml = zf.read(n).decode("utf-8", "replace")
        for m in re.finditer(r"<a:off x=\"(-?\d+)\" y=\"(-?\d+)\"/>"
                             r"<a:ext cx=\"(\d+)\" cy=\"(\d+)\"/>", xml):
            x, y, cx, cy = (int(v) for v in m.groups())
            total += 1
            if x < -10000 or y < -10000 or x + cx > CANVAS_W_EMU + 10000 or y + cy > CANVAS_H_EMU + 10000:
                bad.append({"slide": n, "x": x, "y": y, "cx": cx, "cy": cy,
                            "right": x + cx, "bottom": y + cy})
    return total, bad


rows = {}
for p in sorted(PPTX.glob("*.pptx")):
    with zipfile.ZipFile(p) as zf:
        names = zf.namelist()
        slides = titles_in_order(zf)
        total, bad = off_bounds(zf)
        rows[p.name] = {
            "bytes": p.stat().st_size,
            "parts": len(names),
            "media": [n for n in names if n.startswith("ppt/media/")],
            "slide_count": len(slides),
            "slides": slides,
            "ext_bounds_checked": total,
            "ext_out_of_bounds": bad[:5],
            "ext_out_of_bounds_n": len(bad),
        }

print(json.dumps(rows, ensure_ascii=False, indent=1))

# same-size comparison documented vs intended
for style in ("exhibit", "academic_defense", "smart_red"):
    a = PPTX / f"{style}-documented.pptx"
    b = PPTX / f"{style}-intended.pptx"
    same = a.read_bytes() == b.read_bytes() if a.exists() and b.exists() else None
    print(f"bytes_equal {style}: {same}  ({a.stat().st_size} vs {b.stat().st_size})")

# slide-2 evidence: which page type landed second
for style in ("exhibit", "academic_defense", "smart_red"):
    for mode in ("documented", "intended"):
        key = f"{style}-{mode}.pptx"
        s2 = rows[key]["slides"][1]
        print(f"{key} slide2 -> {s2['first_texts']}")

# reference: what the source SVGs actually say on each page
print("\n-- svg slide titles --")
for style in ("exhibit", "academic_defense", "smart_red"):
    for f in sorted((SVG / style).glob("*.svg")):
        xml = f.read_text()
        big = re.findall(r'font-size="(2[0-9]|[3-9][0-9])"[^>]*>([^<]{4,40})<', xml)
        print(f"{style}/{f.name}: {big[:2]}")
sys.exit(0)
