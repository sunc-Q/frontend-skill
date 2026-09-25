"""Independent checks on the generated .pptx: is it really a native, editable deck?"""
import zipfile, re, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
PPTX = HERE / "skill-showcase-pixel-retro.pptx"

R = []
def check(name, cond, detail=""):
    R.append((bool(cond), name, detail))
    print(("PASS " if cond else "FAIL ") + name + (("  :: " + detail) if detail else ""))

raw = PPTX.read_bytes()
zf = zipfile.ZipFile(PPTX)
names = zf.namelist()
slide_xmls = sorted([n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)])
check("zip 完整且可解", zf.testzip() is None, "%d entries" % len(names))
check("5 页 slide XML", len(slide_xmls) == 5, ", ".join(slide_xmls))
check("无 media 图片(=不是整页贴图)", not any(n.startswith("ppt/media/") for n in names),
      "media=%s" % [n for n in names if n.startswith("ppt/media/")])

total_sp = total_pic = total_tf = 0
for i, sn in enumerate(slide_xmls, 1):
    x = zf.read(sn).decode("utf-8")
    total_sp += x.count("<p:sp>")
    total_pic += x.count("<p:pic>")
    total_tf += x.count("<a:t>")

check("每页都是原生 shape（无 <p:pic>）", total_pic == 0 and total_sp > 150,
      "sp=%d pic=%d a:t=%d" % (total_sp, total_pic, total_tf))

from pptx import Presentation
prs = Presentation(str(PPTX))
check("python-pptx 能打开（合法 OOXML）", len(prs.slides) == 5, "slides=%d" % len(prs.slides))
check("画布 16:9 12192000x6858000 EMU", prs.slide_width == 12192000 and prs.slide_height == 6858000,
      "%dx%d EMU = %.2f:%.2f" % (prs.slide_width, prs.slide_height,
                                 prs.slide_width/12192000*16, prs.slide_height/6858000*9))

texts = []
for s in prs.slides:
    for sh in s.shapes:
        if sh.has_text_frame:
            for p in sh.text_frame.paragraphs:
                texts.append("".join(r.text for r in p.runs))
blob = "\n".join(texts)
check("文本可编辑：能读回中文标题", "只有生成艺术那一轮超时" in blob and "四种产物，四条不同的发现" in blob,
      "text runs=%d" % len(texts))
check("文本可编辑：真实数值在文本框内", all(v in blob for v in ["420", "600", "1140", "780", "5 / 5", "900s"]),
      "抽样 420/1140/5 / 5")
check("无占位符残留（{{...}} 全部替换）", "{{" not in blob and "PLACEHOLDER" not in blob,
      "残留=%s" % re.findall(r"\{\{[A-Z_]+\}\}", blob)[:5])

s3 = list(prs.slides)[2]
# 柱体与它 10px 高的顶部高光条同为 130px 宽，故再按高度 >50px 只留柱体
bars = [sh for sh in s3.shapes
        if sh.shape_type == 1 and getattr(sh, "width", None)
        and abs(sh.width - 130*9525) < 20000 and sh.height > 50*9525]
check("柱状图 4 根柱体作为独立形状存在", len(bars) == 4, "bars=%d" % len(bars))
if len(bars) == 4:
    hs = [round(b.height / 9525, 1) for b in bars]
    exp = [115.3, 137.9, 300.0, 205.3]
    check("柱高与真实秒数成正比(比例尺 300px/1140s)",
          all(abs(a-e) < 1.5 for a, e in zip(hs, exp)), "px=%s exp=%s" % (hs, exp))

# font colour fidelity: cover title must be neon green
x1 = zf.read(slide_xmls[0]).decode("utf-8")
check("霓虹绿 #39FF14 已进入 srgbClr", 'val="39FF14"' in x1, "count=%d" % x1.count('val="39FF14"'))

# notes capability without notes files
notes = [n for n in names if re.match(r"ppt/notesSlides/notesSlide\d+\.xml$", n)]
# 转换器日志写着 "Speaker notes: Enabled (no notes files found)"，却仍逐页写出 notesSlideN.xml
notetext = "".join(zf.read(n).decode("utf-8") for n in notes)
has_content = re.findall(r"<a:t>([^<]*)</a:t>", notetext)
check("空 notesSlide 不夹带脏文本", len(notes) == 5 and all(t.strip() == "" for t in has_content),
      "notesSlide=%d 文本=%s" % (len(notes), has_content[:3]))

print("\nTOTAL %d/%d PASS" % (sum(1 for ok, *_ in R if ok), len(R)))
sys.exit(0 if all(ok for ok, *_ in R) else 1)
