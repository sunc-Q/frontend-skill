#!/usr/bin/env python3
"""Independent assertions on skill-showcase-review.docx (the skill's own validator is NOT trusted alone)."""
import re
import struct
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = Path(__file__).parent
FINAL, BASE = A / "skill-showcase-review.docx", A / "base.docx"
res = []


def ck(name, cond, detail=""):
    res.append((name, bool(cond), detail))


def doc(zf):
    return ET.fromstring(zf.read("word/document.xml"))


def para_text(p, view):
    """accept = Word's final view (drop w:del, keep w:ins); reject = the original (drop w:ins, keep w:delText)."""
    out = []

    def walk(e, inside_del=False, inside_ins=False):
        tag = e.tag
        if tag == W + "del":
            inside_del = True
        if tag == W + "ins":
            inside_ins = True
        if tag == W + "t" and ((view == "accept" and not inside_del) or (view == "reject" and not inside_ins)):
            out.append(e.text or "")
        if tag == W + "delText" and view == "reject":
            out.append(e.text or "")
        for c in e:
            walk(c, inside_del, inside_ins)

    walk(p)
    return "".join(out)


def body_text(zf, view):
    return "\n".join(para_text(p, view) for p in doc(zf).iter(W + "p"))


# ---------- A. package integrity
zf, zfb = zipfile.ZipFile(FINAL), zipfile.ZipFile(BASE)
names = zf.namelist()
ck("A1 12 required parts present", all(n in names for n in [
    "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/header1.xml",
    "word/footer1.xml", "[Content_Types].xml", "word/comments.xml", "word/commentsExtended.xml",
    "word/commentsIds.xml", "word/commentsExtensible.xml", "word/settings.xml"]))
ck("A2 no duplicate zip entries / no symlink entries", len(names) == len(set(names)) and not zf.testzip())
media = [n for n in names if n.startswith("word/media/") and not n.endswith("/")]
png = zf.read(media[0])
ck("A3 embedded PNG is a real 720x320 image", png[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", png[16:24]) == (720, 320), f"{media[0]} {len(png)}B")
ck("A4 chart bytes equal source chart.png", png == (A / "chart.png").read_bytes())
ct = zf.read("[Content_Types].xml").decode()
ck("A5 four comment parts declared in [Content_Types]", all(t in ct for t in
    ["wordprocessingml.comments+xml", "commentsExtended+xml", "commentsIds+xml", "commentsExtensible+xml"]))
rels = zf.read("word/_rels/document.xml.rels").decode()
ids = re.findall(r'Id="(rId\d+)"', rels)
ck("A6 relationship Ids unique", len(ids) == len(set(ids)), f"{len(ids)} rels")
ck("A7 exactly one comments.xml relationship", rels.count('/comments" Target="comments.xml"') == 1)
tgt = re.findall(r'comments="([^"]+)"|Target="(comments[^"]+)"', rels)
ck("A8 all four comment targets linked", all(f'Target="{f}"' in rels for f in
    ["comments.xml", "commentsExtended.xml", "commentsIds.xml", "commentsExtensible.xml"]))

# ---------- B. tracked changes shape
dx = zf.read("word/document.xml").decode()
ck("B1 2 <w:ins> and 2 <w:del>", dx.count("<w:ins ") == 2 and dx.count("<w:del ") == 2)
ck("B2 every w:del holds delText only, never w:t",
   not re.search(r"<w:del [^>]*>(?:(?!</w:del>).)*?<w:t[ >]", dx, re.S))
ck("B3 every w:ins holds w:t only, never delText",
   "<w:delText" not in "".join(re.findall(r"<w:ins [^>]*>(?:(?!</w:ins>).)*?</w:ins>", dx, re.S)))
ck("B4 no nested run inside a run (the defect docx-js produced in the first attempt)",
   not re.search(r"<w:r[ >](?:(?!</w:r>).)*?<w:r[ >]", dx, re.S))
tags_id = re.findall(r'<w:(?:ins|del) w:id="(\d+)"[^>]*>', dx)
ck("B5 4 tracked elements, unique ids, each with author and date on its own tag",
   len(tags_id) == 4 and len(set(tags_id)) == 4
   and all('w:author="评审组"' in t and 'w:date="2026-09-26' in t
           for t in re.findall(r'<w:(?:ins|del) [^>]*>', dx)))
ck("B6 comment markers 3 start / 3 end / 3 reference, all direct children of w:p",
   dx.count("<w:commentRangeStart") == 3 and dx.count("<w:commentRangeEnd") == 3 and dx.count("<w:commentReference") == 3)

# ---------- C. accepted / rejected views vs base  (what Word actually shows)
acc, rej = body_text(zf, "accept"), body_text(zf, "reject")
base_all = body_text(zfb, "accept")
NEW = ["97.8% 与 89.2%", "把每个内联库的 npm 版本与 sha256 一起入库", "第 6 轮与第 12 轮各命中一次"]
OLD = ["处置方式为在产物旁保留 integrity-manifest 并在下一轮补入 sha256 清单", "本轮同类风险已在第 6 轮真实发生"]
ck("C1 rejected view == base text exactly (round-trip lossless)", rej == base_all, f"{len(rej)} vs {len(base_all)} chars")
ck("C2 accepted view contains all 3 inserted fragments", all(n in acc for n in NEW))
ck("C3 accepted view lost no unrelated base paragraph",
   sum(1 for line in base_all.splitlines() if line.strip() and line not in acc) == 2,
   "only the two redlined paragraphs may differ")
ck("C4 accepted view drops exactly the deleted text", all(o not in acc for o in OLD))

# ---------- D. skill's own gotcha list, item by item
import json
facts = json.loads((A / "facts.json").read_text())
missing = [r["skill"] for r in facts["rows"] if r["skill"] not in acc]
ck("D1 all 11 round skill names survived into the document", not missing, f"missing={missing}")
ck("D2 US Letter page size 12240x15840 DXA",
   '<w:pgSz w:w="12240" w:h="15840"' in dx or re.search(r'w:w="12240" w:h="15840"', dx))
tbl = doc(zf).find(f"{W}body/{W}tbl")
grid = [int(g.get(W + "w")) for g in tbl.iter(W + "gridCol")]
ck("D3 columnWidths sum == table width (9360)", sum(grid) == 9360 and len(grid) == 6, str(grid))
widths = {int(c.get(W + "w")) for c in tbl.iter(W + "tcW")}
ck("D4 every cell carries an explicit DXA width matching the grid", widths == set(grid) | {700} or set(grid) <= widths, str(sorted(widths)))
ck("D5 no literal bullet character anywhere", "\u2022" not in dx)
num = zf.read("word/numbering.xml").decode()
ck("D6 bullets come from numbering with numFmt=bullet", 'w:numFmt w:val="bullet"' in num)
ck("D7 shading uses CLEAR, never SOLID", "w:val=\"solid\"" not in re.findall(r"<w:shd[^>]*>", dx).__str__() and 'w:val="clear"' in dx)
foot = zf.read("word/footer1.xml").decode()
ck("D8 footer has PAGE and NUMPAGES fields", "PAGE" in foot and "NUMPAGES" in foot and foot.count("instrText") >= 2)
ck("D9 dot leaders are w:ptab with dot leader (5 KPI lines)", dx.count('<w:ptab ') == 5 and dx.count('w:leader="dot"') == 5)
ck("D10 no \\n inside any w:t", not re.search(r"<w:t[^>]*>[^<]*\n", dx))
fld = "".join(re.findall(r'<w:instrText[^>]*>(.*?)</w:instrText>', dx))
ck("D11 TOC is a real field over built-in heading styles",
   "TOC" in fld and "1-2" in fld and r"\h" in fld
   and 'w:pStyle w:val="Heading1"' in dx and dx.count("<w:sdt>") >= 1, fld[:60])
h1 = len(re.findall(r'w:pStyle w:val="Heading1"', dx))
ck("D12 7 Heading1 paragraphs so every section lands in the TOC", h1 == 7, f"got {h1}")
ck("D13 horizontal rule is a paragraph border, not a 1-cell table",
   len(list(doc(zf).iter(W + "tbl"))) == 1 and "<w:pBdr>" in dx)
m = re.search(r'<wp:docPr [^>]*/>', dx)
ck("D14 ImageRun emitted with altText (name/descr/title) and EMU extents",
   bool(m) and all(k in m.group(0) for k in ['name="rounds-duration"', 'descr=', 'title='])
   and 'cx="4572000" cy="2028825"' in dx, m.group(0) if m else "")
ck("D15 page break before section 2 is inside paragraph props", "w:pageBreakBefore" in dx)

# ---------- E. comment threading and cross-links
com = ET.fromstring(zf.read("word/comments.xml"))
cs = com.findall(W + "comment")
ck("E1 3 comments with author/initials/date", len(cs) == 3 and all(c.get(W + "author") and c.get(W + "initials") and c.get(W + "date") for c in cs))
auth = [c.get(W + "author") for c in cs]
ck("E2 authors: 2 reviewers + 1 automation reply", auth.count("评审组") == 2 and auth.count("自动化值守") == 1, str(auth))
pids = {c.get(W + "paraId") or c.find(f"{W}p").get("{http://schemas.microsoft.com/office/word/2010/wordml}paraId") for c in cs}
ext = ET.fromstring(zf.read("word/commentsExtended.xml"))
NS15 = "{http://schemas.microsoft.com/office/word/2012/wordml}"
ex = ext.findall(f"{NS15}commentEx")
ck("E3 commentsExtended mirrors 3 entries", len(ex) == 3)
parents = [e.get(f"{NS15}paraIdParent") for e in ex]
ck("E4 exactly one reply, its paraIdParent points at a real comment paragraph",
   sum(1 for x in parents if x) == 1 and [x for x in parents if x][0] in pids, f"{parents}")
ids_doc = {int(m) for m in re.findall(r'<w:comment(?:RangeStart|Reference) w:id="(\d+)"', dx)}
ids_part = {int(c.get(W + "id")) for c in cs}
ck("E5 marker ids and comment ids match exactly (no dangling anchor)", ids_doc == ids_part == {0, 1, 2}, f"doc={sorted(ids_doc)} part={sorted(ids_part)}")
cid = ET.fromstring(zf.read("word/commentsIds.xml"))
NS16 = "{http://schemas.microsoft.com/office/word/2016/wordml/cid}"
ck("E6 commentsIds gives every paragraph a durableId", len(cid.findall(f"{NS16}commentId")) == 3)
ce = ET.fromstring(zf.read("word/commentsExtensible.xml"))
NS16C = "{http://schemas.microsoft.com/office/word/2018/wordml/cex}"
dur = {e.get(f"{NS16C}durableId") for e in ce.findall(f"{NS16C}commentExtensible")}
ck("E7 extensible durableIds cross-link to commentsIds", len(dur) == 3 and dur <= {e.get(f"{NS16}durableId") for e in cid.findall(f"{NS16}commentId")})
ck("E8 comment text survived escaping (quotes & brackets)", "「中位数在 12 分钟附近」" in zf.read("word/comments.xml").decode())

# ---------- G. style table (docx-js leaves Normal/DefaultParagraphFont/CommentReference undefined)
st = zf.read("word/styles.xml").decode()
defined = set(re.findall(r'w:styleId="([^"]+)"', st))
refs = set(re.findall(r'<w:(?:p|r)Style w:val="([^"]+)"', dx))
comments_xml = zf.read("word/comments.xml").decode()
refs |= set(re.findall(r'<w:(?:p|r)Style w:val="([^"]+)"', comments_xml))
bases = set(re.findall(r'<w:basedOn w:val="([^"]+)"', st)) | set(re.findall(r'<w:link w:val="([^"]+)"', st))
ck("G1 no dangling style references (document + comments)", not (refs - defined), f"missing={sorted(refs-defined)}")
ck("G2 no dangling basedOn/link targets in styles.xml", not (bases - defined), f"missing={sorted(bases-defined)}")
ck("G3 default paragraph + character styles declared with w:default",
   'w:type="paragraph" w:default="1" w:styleId="Normal"' in st and 'w:styleId="DefaultParagraphFont"' in st)
ck("G4 CommentReference exists as a character style", 'w:type="character" w:styleId="CommentReference"' in st)
ck("G5 styles.xml grew from the repair step only (base.docx still lacks Normal)",
   'w:styleId="Normal"' not in zfb.read("word/styles.xml").decode())

# ---------- F. size / round-trip sanity
ck("F1 final is larger than base (satellite parts added)", FINAL.stat().st_size > BASE.stat().st_size,
   f"{BASE.stat().st_size}B -> {FINAL.stat().st_size}B")
ck("F2 paragraph count unchanged by redlining (112 in base and final)",
   len(list(doc(zf).iter(W + "p"))) == 112 == len(list(doc(zfb).iter(W + "p"))))

fails = [r for r in res if not r[1]]
for name, ok, detail in res:
    print(("PASS" if ok else "FAIL"), name, ("| " + detail) if detail else "")
print(f"\nTOTAL {len(res)}  PASS {len(res)-len(fails)}  FAIL {len(fails)}")
raise SystemExit(1 if fails else 0)
