#!/usr/bin/env python3
"""Cross-check the artifact with a second, independent parser (python-docx) — not docx-js, not ElementTree-by-hand."""
from pathlib import Path
from docx import Document

D = Path(__file__).parent
doc = Document(str(D / "skill-showcase-review.docx"))
paras = [p.text for p in doc.paragraphs]
table_paras = [c.text for t in doc.tables for r in t.rows for c in r.cells]
# python-docx exposes tracked-change content only through the XML, never through .text,
# so the accepted view is rebuilt from the element tree here.
body = "\n".join(paras + table_paras)
print("paragraphs:", len(paras), "| tables:", len(doc.tables),
      "| table shape:", len(doc.tables[0].rows), "x", len(doc.tables[0].columns))
sh = doc.inline_shapes[0]
print("inline images:", len(doc.inline_shapes), "-> display",
      round(sh.width / 914400, 2), "in x", round(sh.height / 914400, 2), "in",
      "| EMU", sh.width, sh.height)
sec = doc.sections[0]
print("page:", sec.page_width.inches, "x", sec.page_height.inches, "in | margins",
      sec.left_margin.inches, sec.right_margin.inches)
heads = [(p.style.name, p.text) for p in doc.paragraphs if p.style.name.startswith(("Heading", "Title"))]
print("styled headings:", len(heads))
for s, t in heads:
    print("   %-9s %s" % (s, t[:34]))
print("last ledger row:", [c.text for c in doc.tables[0].rows[-1].cells])
xml = doc.element.xml
print("revision elements seen by python-docx: ins=%d del=%d commentReference=%d" % (
    xml.count("<w:ins "), xml.count("<w:del "), xml.count("<w:commentReference")))
print("footer field:", "PAGE" in sec.footer.paragraphs[0]._p.xml, "| header text:",
      sec.header.paragraphs[0].text)
probes = ["97.8% 与 89.2%", "已验证技能数", "11 轮全部产出", "webapp-testing", "图 1", "第 6 轮与第 12 轮各命中一次"]
for pr in probes:
    print("  probe %-28s -> %s" % (repr(pr), pr in body))
print("--- what python-docx's .text hides (documented here, not a defect in the file) ---")
print("  webapp-testing in doc.paragraphs text:", "webapp-testing" in "\n".join(paras),
      "| in table cells:", "webapp-testing" in "\n".join(table_paras))
for frag in ["97.8% 与 89.2%", "第 6 轮与第 12 轮各命中一次", "处置方式为在产物旁保留 integrity-manifest"]:
    print("  %-30s in .text: %-5s | in document XML: %s" % (repr(frag[:14]), frag in body, frag in xml))

gone = ["该缺陷由第 8 轮安全审计判为「高」，处置方式为在产物旁保留", "本轮同类风险已在第 6 轮真实发生。"]
for g in gone:
    print("  deleted-from-accepted-view %-40s -> %s" % (repr(g[:20]), g not in body))
