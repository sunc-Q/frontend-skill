#!/usr/bin/env python3
"""Repair the dangling style table docx-js leaves behind.

docx-js emits `w:basedOn w:val="Normal"` and `w:basedOn w:val="DefaultParagraphFont"`
without ever defining either of those two default styles, and comment.py's markers
reference a `CommentReference` character style nobody defines. The XSD validator is
syntax-only, so it stays green while every unstyled paragraph resolves to no style at
all (python-docx returns paragraph.style is None). This step injects the four missing
style definitions into unpacked/word/styles.xml.
"""
import re
import sys
from pathlib import Path

STYLES = Path(sys.argv[1] if len(sys.argv) > 1 else "unpacked/word/styles.xml")
ADD = (
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
    '<w:name w:val="Normal"/><w:qFormat/></w:style>'
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">'
    '<w:name w:val="Default Paragraph Font"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    '<w:style w:type="character" w:styleId="CommentReference">'
    '<w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/>'
    '<w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>'
    '<w:style w:type="paragraph" w:styleId="CommentText">'
    '<w:name w:val="annotation text"/><w:basedOn w:val="Normal"/>'
    '<w:link w:val="CommentTextChar"/><w:semiHidden/><w:unhideWhenUsed/>'
    '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    '<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
    '<w:style w:type="character" w:styleId="CommentTextChar">'
    '<w:name w:val="Comment Text Char"/><w:basedOn w:val="DefaultParagraphFont"/>'
    '<w:link w:val="CommentText"/><w:semiHidden/><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
)

xml = STYLES.read_text(encoding="utf-8")
if "w:styleId=\"Normal\"" in xml:
    print("styles.xml already carries the default styles; nothing to do")
    sys.exit(0)
ANCHOR = "</w:docDefaults>"
if xml.count(ANCHOR) != 1:
    sys.exit(f"anchor {ANCHOR!r} found {xml.count(ANCHOR)} times, expected 1")
xml = xml.replace(ANCHOR, ANCHOR + ADD, 1)
STYLES.write_text(xml, encoding="utf-8")

defined = set(re.findall(r'w:styleId="([^"]+)"', xml))
refs = set(re.findall(r'<w:(?:p|r)Style w:val="([^"]+)"', (STYLES.parent / "document.xml").read_text(encoding="utf-8")))
refs |= set(re.findall(r'<w:(?:p|r)Style w:val="([^"]+)"', (STYLES.parent / "comments.xml").read_text(encoding="utf-8")))
based = set(re.findall(r'<w:basedOn w:val="([^"]+)"', xml)) | set(re.findall(r'<w:link w:val="([^"]+)"', xml))
print("styles.xml %d bytes | defined %d | dangling references: %s | dangling basedOn/link: %s"
      % (len(xml), len(defined), sorted(refs - defined) or "none", sorted(based - defined) or "none"))
