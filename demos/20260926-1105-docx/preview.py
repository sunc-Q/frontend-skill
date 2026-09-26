#!/usr/bin/env python3
"""Export a readable markdown preview of the .docx (no Word / pandoc / LibreOffice on this box)."""
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
NS15 = "{http://schemas.microsoft.com/office/word/2012/wordml}"
A = Path(__file__).parent
zf = zipfile.ZipFile(A / "skill-showcase-review.docx")
root = ET.fromstring(zf.read("word/document.xml"))


def runs_text(p):
    """Return (accepted, deleted, inserted) text of a paragraph."""
    acc, dele, ins = [], [], []

    def walk(e, mode):
        if e.tag == W + "ins":
            mode = "i"
        elif e.tag == W + "del":
            mode = "d"
        if e.tag == W + "t" and mode != "d":
            acc.append(e.text or "")
            if mode == "i":
                ins.append(e.text or "")
        if e.tag == W + "delText":
            acc.append("")
            dele.append(e.text or "")
        for c in e:
            walk(c, mode)

    walk(p, "")
    return "".join(acc), "".join(dele), "".join(ins)


out = ["# skill-showcase-review.docx — 纯文本预览（非渲染稿）",
       "",
       "> Word 版式无法在本机渲染（缺 LibreOffice/pandoc/pdftopmm），此文件按 document.xml 顺序导出：",
       "> 【批注 N】= 该段挂有批注锚点；~~删除线~~ = 修订删除；**加粗下划线样式在此用 ⟦+…⟧ 表示修订插入**。", ""]

comments = ET.fromstring(zf.read("word/comments.xml"))
by_id = {c.get(W + "id"): (c.get(W + "author"), "".join(t.text or "" for t in c.iter(W + "t"))) for c in comments}
ext = {e.get(f"{NS15}paraId"): e.get(f"{NS15}paraIdParent") for e in ET.fromstring(zf.read("word/commentsExtended.xml"))}

body = root.find(W + "body")
for el in body:
    if el.tag == W + "tbl":
        rows = list(el.iter(W + "tr"))
        hdr = [ "".join(t.text or "" for t in tc.iter(W + "t")) for tc in rows[0].iter(W + "tc")]
        out.append("| " + " | ".join(hdr) + " |")
        out.append("|" + "|".join(["---"] * len(hdr)) + "|")
        for tr in rows[1:]:
            out.append("| " + " | ".join("".join(t.text or "" for t in tc.iter(W + "t")) for tc in tr.iter(W + "tc")) + " |")
        out.append("")
        continue
    if el.tag != W + "p":
        continue
    style = el.find(f"{W}pPr/{W}pStyle")
    sid = style.get(W + "val") if style is not None else ""
    txt, dele, ins = runs_text(el)
    pre = {"Heading1": "\n## ", "Heading2": "\n### ", "Title": "\n# "}.get(sid, "")
    bullets = el.find(f"{W}pPr/{W}numPr") is not None
    mark = "- " if bullets else ""
    line = (pre + mark + txt).rstrip()
    tags = [c.get(W + "id") for c in el.iter(W + "commentReference")]
    for i in tags:
        a, t = by_id[i]
        line += f"\n    〔批注 {i} · {a}〕{t}"
    if dele:
        line = line.replace(txt, (f"~~{dele}~~ " if dele else "") + txt)
    if ins:
        line += f"\n    ⟦修订插入：{ins}⟧"
    if "w:ptab" in ET.tostring(el, encoding="unicode"):
        line = line.replace("\t", " ") + "   ⟨点前导⟩"
    if "br" in sid.lower() or el.find(f"{W}pPr/{W}pageBreakBefore") is not None:
        line = "\n--- 分页符 ---\n" + line
    if el.find(f".//{W}drawing") is not None or el.find(f".//{{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}}inline") is not None:
        line += "\n    [图片：chart.png 720×320，显示尺寸 480×213 px]"
    if txt or sid:
        out.append(line)

out.append("\n## 批注线程（commentsExtended）")
for i, (a, t) in sorted(by_id.items(), key=lambda kv: int(kv[0])):
    out.append(f"- id={i} 作者={a}：{t}")
for pid, parent in ext.items():
    if parent:
        out.append(f"- 线程：paraId={pid} 是 paraId={parent} 的回复")

(A / "doc-preview.md").write_text("\n".join(out) + "\n", encoding="utf-8")
print("doc-preview.md %d bytes, %d lines" % ((A / "doc-preview.md").stat().st_size, len(out)))
