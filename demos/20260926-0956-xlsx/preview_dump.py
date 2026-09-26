"""Dump the recalculated workbook to text so it is readable without Excel,
plus a raw OOXML well-formedness check (the file is a zip of XML parts)."""
import re, sys, xml.etree.ElementTree as ET, zipfile
import formulas
import openpyxl

XL = "skill-showcase-ledger.xlsx"
sol = formulas.ExcelModel().loads(XL).finish().calculate()
vals = {}
pat = re.compile(r"^\'\[([^\]]+)\](\w+)\'!(\w+\d+)$")
for k, v in sol.items():
    m = pat.match(k)
    if not m:
        continue
    try:
        val = v.value
    except Exception:
        continue
    if hasattr(val, "reshape"):
        val = val.reshape(-1)[0] if val.size else None
    vals[(m.group(2).upper(), m.group(3).upper())] = val

wb = openpyxl.load_workbook(XL)
for sheet in ("Ledger", "Metrics"):
    ws = wb[sheet]
    print("== %s ==" % sheet)
    for row in ws.iter_rows():
        line = []
        for c in row:
            if c.value is None:
                continue
            if isinstance(c.value, str) and c.value.startswith("="):
                got = vals.get((sheet.upper(), c.coordinate))
                line.append("%s=%s→%s" % (c.coordinate, c.value[:46], got))
            else:
                line.append("%s=%r" % (c.coordinate, c.value if not isinstance(c.value, str) else c.value[:34]))
        if line:
            print("  " + " | ".join(line))
z = zipfile.ZipFile(XL)
bad = []
for n in z.namelist():
    if n.endswith(".xml") or n.endswith(".rels"):
        try:
            ET.fromstring(z.read(n))
        except Exception as e:
            bad.append((n, str(e)[:60]))
print("== OOXML 部件 ==", len(z.namelist()), "个文件；XML 非良构:", bad)
print("chart1.xml 含 barChart:", b"barChart" in z.read("xl/charts/chart1.xml"),
      "含数值引用:", b"c:numRef" in z.read("xl/charts/chart1.xml"))
