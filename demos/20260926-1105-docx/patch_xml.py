#!/usr/bin/env python3
"""Place comment markers and tracked changes in unpacked/word/document.xml (in place, no pretty-print)."""
import argparse
import itertools
import re
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("doc", nargs="?", default="unpacked/word/document.xml")
ap.add_argument("--bad", action="store_true", help="reproduce the run-swallowing regex (A/B control)")
a = ap.parse_args()
BAD = a.bad
DOC = Path(a.doc)
AUTHOR = "评审组"
DATE = "2026-09-26T11:20:00Z"
ID = itertools.count(9001)  # every w:ins / w:del needs its own revision id
xml = DOC.read_text(encoding="utf-8")
log = []

PARA = re.compile(r"<w:p(?: [^>]*)?>.*?</w:p>", re.S)
paras = {m.group(0): m for m in PARA.finditer(xml)}


def find_para(needle, want=1):
    hits = [m for m in PARA.finditer(xml) if needle in m.group(0)]
    if len(hits) != want:
        sys.exit(f"ANCHOR NOT UNIQUE ({needle!r} -> {len(hits)} paragraphs, wanted {want})")
    return hits[0]


def starts(vids):
    return "".join(f'<w:commentRangeStart w:id="{v}"/>' for v in vids)


def ends(vids):
    return "".join(f'<w:commentRangeEnd w:id="{v}"/>' for v in reversed(vids))


def refs(vids):
    return "".join(
        '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr>'
        f'<w:commentReference w:id="{v}"/></w:r>' for v in vids)


def wrap_comment(m, vids):
    """Insert commentRangeStart after pPr (or right after <w:p>), End+refs before </w:p>."""
    text = m.group(0)
    head = re.match(r"(<w:p(?: [^>]*)?>(<w:pPr>.*?</w:pPr>)?)", text, re.S).group(0)
    new = head + starts(vids) + text[len(head):-len("</w:p>")] + ends(vids) + refs(vids) + "</w:p>"
    return text, new


# --- comment 0 + reply 1 on the summary paragraph, comment 2 on the risk paragraph
for needle, vids in [
    ("11 轮全部产出", [0, 1]),
    ("交付物中约九成字节", [2]),
]:
    m = find_para(needle)
    old, new = wrap_comment(m, vids)
    xml = xml.replace(old, new, 1)
    log.append(f"markers {vids} anchored on paragraph containing {needle!r}")


# --- tracked replacement: delete a sentence run, insert a corrected one
def track_replace(needle, new_text):
    global xml
    m = find_para(needle)
    text = m.group(0)
    if BAD:
        # naive: lazy .*? across a single-line XML runs past </w:rPr> and swallows the previous run
        pat = r'<w:r>(<w:rPr>.*?</w:rPr>)<w:t xml:space="preserve">' + re.escape(needle) + r"</w:t></w:r>"
    else:
        pat = (r"<w:r>(<w:rPr>(?:(?!</w:rPr>).)*?</w:rPr>)<w:t xml:space=\"preserve\">"
               + re.escape(needle) + r"</w:t></w:r>")
    run = re.search(pat, text, re.S)
    if not run:
        sys.exit(f"RUN NOT FOUND for {needle!r}")
    rpr = run.group(1)
    dele = (f'<w:del w:id="{next(ID)}" w:author="{AUTHOR}" w:date="{DATE}">'
            f'<w:r>{rpr}<w:delText xml:space="preserve">{needle}</w:delText></w:r></w:del>')
    ins = (f'<w:ins w:id="{next(ID)}" w:author="{AUTHOR}" w:date="{DATE}">'
           f'<w:r>{rpr}<w:t xml:space="preserve">{new_text}</w:t></w:r></w:ins>')
    xml = xml.replace(text, text[:run.start()] + dele + ins + text[run.end():], 1)
    log.append(f"tracked del/ins on {needle!r}")


track_replace("该缺陷由第 8 轮安全审计判为「高」，处置方式为在产物旁保留 integrity-manifest 并在下一轮补入 sha256 清单。",
              "该缺陷由第 8 轮安全审计判为「高」（实测两条产物内联占比 97.8% 与 89.2%）；处置方式改为随包提交 integrity-manifest，把每个内联库的 npm 版本与 sha256 一起入库。")

track_replace("本轮同类风险已在第 6 轮真实发生。", "第 6 轮与第 12 轮各命中一次，均已把「装完先 find 核对包内文件清单」写成固定步骤。")

DOC.write_text(xml, encoding="utf-8")
print("\n".join(log))
print("document.xml now %d bytes" % len(xml))
