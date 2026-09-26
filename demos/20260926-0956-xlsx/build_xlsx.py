"""Round 9 artifact builder: the pipeline's own 8-run ledger as a real .xlsx.

Data facts (bytes / seconds / PASS-FAIL token counts) are measured from disk at
build time by measure.py, not typed from memory.
"""
import json
import os

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
FACTS = json.load(open(os.path.join(HERE, "facts.json")))

ARIAL = "Arial"
INPUT = Font(name=ARIAL, color="0000FF")          # blue = hardcoded input
FORMULA = Font(name=ARIAL, color="000000")        # black = formula
LINK = Font(name=ARIAL, color="008000")           # green = link to another sheet
BOLD = Font(name=ARIAL, bold=True)
HDR = Font(name=ARIAL, bold=True, color="FFFFFF")
HDR_FILL = PatternFill("solid", fgColor="1F3864")
YELLOW = PatternFill("solid", fgColor="FFFF00")
TITLE = Font(name=ARIAL, bold=True, size=14)

wb = Workbook()

# ---------------------------------------------------------------- README
rd = wb.active
rd.title = "README"
rd["A1"] = "Skill 快速验证流水线 · 台账工作簿"
rd["A1"].font = TITLE
notes = [
    ("A3", "生成方式", ".skills/anthropic-skills/skills/xlsx（anthropics/skills）+ openpyxl 3.1.5；脚本 build_xlsx.py"),
    ("A4", "数据口径", "Run Ledger!F 主产物字节＝stat -f%z 实测；K/L 日志 PASS/FAIL 标记数＝grep -c 实测（含中途被推翻的假 FAIL）；H 耗时秒取自 state.json runs[].seconds"),
    ("A5", "编辑指引", "只有蓝色（F/H/K/L/O）与黄色底纹单元格是输入，其余黑色公式与绿色跨表引用请保持不动；改输入后整表自动重算"),
    ("A6", "公式约定", "只用 Excel-2007 时代函数（SUM/SUMIFS/COUNTIF/AVERAGEIF/INDEX/MATCH/IFERROR/MAX/MIN/ROUND），不用 XLOOKUP/FILTER/SORT/UNIQUE，不加 _xlfn 前缀函数"),
    ("A7", "本机限制", "技能自带的 scripts/recalc.py 需要 LibreOffice，本机无 soffice；本文件公式值由纯 Python 引擎 formulas 1.3.4 独立重算核对（见 verify_recalc.py 与 output.log）"),
]
for ref, k, v in notes:
    rd[ref] = k
    rd[ref].font = BOLD
    rd.cell(row=int(ref[1:]), column=2, value=v).font = Font(name=ARIAL)
    rd.cell(row=int(ref[1:]), column=2).alignment = Alignment(wrap_text=True, vertical="top")

rd["A9"] = "图例"
rd["A9"].font = BOLD
legend = [
    ("A10", "蓝色字体 = 硬编码输入", INPUT),
    ("A11", "黑色字体 = 公式", FORMULA),
    ("A12", "绿色字体 = 跨表链接", LINK),
]
for ref, txt, f in legend:
    rd[ref] = txt
    rd[ref].font = f
rd["A13"] = "黄色底纹 = 本工作簿留给读者的待填假设格"
rd["A13"].font = FORMULA
rd["B13"].fill = YELLOW
rd["B13"].font = INPUT
rd["B13"] = 900
rd["C13"] = "预算基准（秒/轮）；来源：本任务提示词「15 分钟内出产物」= 900 秒"
rd["C13"].font = INPUT
rd["A15"] = "示例行（真实数据，展示格式）"
rd["A15"].font = BOLD
rd["B15"] = "2026-09-26"
rd["B15"].number_format = "@"
rd["B15"].font = INPUT
rd["C15"] = 1140
rd["C15"].number_format = "#,##0"
rd["C15"].font = INPUT
rd["D15"] = "=C15/60"
rd["D15"].number_format = "0.0"
rd["D15"].font = FORMULA
rd["E15"] = 0.2
rd["E15"].number_format = "0.0%"
rd["E15"].font = INPUT
for col, w in zip("ABCDE", (26, 34, 26, 26, 20)):
    rd.column_dimensions[col].width = w

# ---------------------------------------------------------------- Ledger
lg = wb.create_sheet("Ledger")
headers = [
    ("轮次", 6), ("日期", 12), ("技能", 24), ("来源", 14), ("产物类别", 30),
    ("主产物 (B)", 14), ("主产物 (KB)", 12), ("耗时 (s)", 10), ("耗时 (min)", 11),
    ("B/s", 10), ("日志 PASS 标记", 12), ("日志 FAIL 标记", 12), ("验证标记合计", 12),
    ("PASS 占比", 10), ("本轮新装技能", 12), ("结论", 16), ("主产物路径", 52),
]
for i, (h, w) in enumerate(headers, start=1):
    c = lg.cell(row=1, column=i, value=h)
    c.font = HDR
    c.fill = HDR_FILL
    c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    lg.column_dimensions[get_column_letter(i)].width = w
lg.freeze_panes = "C2"

for r, row in enumerate(FACTS, start=2):
    lg.cell(row=r, column=1, value=row["run"]).font = INPUT
    d = lg.cell(row=r, column=2, value=row["date"])
    d.font = INPUT
    d.number_format = "@"                       # years as text, never 2,026
    lg.cell(row=r, column=3, value=row["skill"]).font = INPUT
    lg.cell(row=r, column=4, value=row["source"]).font = INPUT
    lg.cell(row=r, column=5, value=row["kind"]).font = INPUT
    b = lg.cell(row=r, column=6, value=row["bytes"])
    b.font = INPUT
    b.number_format = "#,##0;(#,##0);-"
    b.comment = Comment("来源：%s（stat -f%%z 实测，2026-09-26）\n测量脚本：measure.py" % row["path"], "xlsx-skill-run9")
    f = lg.cell(row=r, column=7, value="=F{0}/1024".format(r))
    f.number_format = "#,##0.0;(#,##0.0);-"
    f.font = FORMULA
    s = lg.cell(row=r, column=8, value=row["seconds"] if row["seconds"] else None)
    s.font = INPUT
    s.number_format = "#,##0;(#,##0);-"
    if not row["seconds"]:
        s.comment = Comment("state.json runs[8].seconds 缺记录，留空而不是估算；依赖它的公式用 IFERROR 兜底。", "xlsx-skill-run9")
    m = lg.cell(row=r, column=9, value='=IF(H{0}="","",H{0}/60)'.format(r))
    m.number_format = "0.0;(0.0);-"
    m.font = FORMULA
    m.comment = Comment("空耗时不能写成 =H/60：Excel 与独立引擎都把空单元格当 0，结果得到一个看起来合法的 0.0 而不是空值（第 1 版就踩了，靠 Metrics 分组均值 6.5 vs 真值 13.0 反证）。故显式 IF(H=\"\",…) 守卫。", "xlsx-skill-run9")
    q = lg.cell(row=r, column=10, value="=IFERROR(F{0}/H{0},\"\")".format(r))
    q.number_format = "#,##0;(#,##0);-"
    q.font = FORMULA
    for col, key in ((11, "pass"), (12, "fail")):
        c = lg.cell(row=r, column=col, value=row[key])
        c.font = INPUT
        c.number_format = "#,##0;(#,##0);-"
    lg.cell(row=r, column=11).comment = Comment(
        "口径：grep -c '\\bPASS\\b' 于 %s 下全部 .log/.txt；含中途被推翻的假 FAIL 前置记录，不等于最终判定数。" % row["dir"],
        "xlsx-skill-run9")
    tot = lg.cell(row=r, column=13, value="=K{0}+L{0}".format(r))
    tot.number_format = "#,##0;(#,##0);-"
    tot.font = FORMULA
    pr = lg.cell(row=r, column=14, value="=IFERROR(K{0}/M{0},\"\")".format(r))
    pr.number_format = "0.0%;(0.0%);-"
    pr.font = FORMULA
    ins = lg.cell(row=r, column=15, value=row["installed"])
    ins.font = INPUT
    ins.number_format = "#,##0;(#,##0);-"
    v = lg.cell(row=r, column=16, value=row["verdict"])
    v.font = INPUT
    p = lg.cell(row=r, column=17, value=row["path"])
    p.font = INPUT

LAST = len(FACTS) + 1

# ---------------------------------------------------------------- Metrics
mt = wb.create_sheet("Metrics")
mt["A1"] = "流水线指标看板（全部为公式，随 Ledger 输入自动重算）"
mt["A1"].font = TITLE
mt["A2"] = "蓝色格为唯一手工输入（README!B13 预算基准）；本表无一处硬编码统计值。"
mt["A2"].font = INPUT

blocks = [
    ("总量", None, [
        ("已完成轮次", '=COUNT(Ledger!$A$2:$A${L})', "#,##0"),
        ("主产物合计 (B)", "=SUM(Ledger!$F$2:$F${L})", "#,##0;(#,##0);-"),
        ("主产物合计 (KB)", "=SUM(Ledger!$F$2:$F${L})/1024", "#,##0.0;(#,##0.0);-"),
        ("单轮平均产物 (KB)", "=AVERAGE(Ledger!$G$2:$G${L})", "#,##0.0"),
        ("最大单产物 (KB)", "=MAX(Ledger!$G$2:$G${L})", "#,##0.0"),
        ("最大单产物所属技能", "=INDEX(Ledger!$C$2:$C${L},MATCH(MAX(Ledger!$F$2:$F${L}),Ledger!$F$2:$F${L},0))", "@"),
        ("最小单产物所属技能", "=INDEX(Ledger!$C$2:$C${L},MATCH(MIN(Ledger!$F$2:$F${L}),Ledger!$F$2:$F${L},0))", "@"),
    ]),
    ("耗时与预算", None, [
        ("有耗时记录轮次", "=COUNT(Ledger!$H$2:$H${L})", "#,##0"),
        ("累计耗时 (min)", "=SUM(Ledger!$H$2:$H${L})/60", "#,##0.0"),
        ("平均单轮耗时 (min)", "=IFERROR(SUM(Ledger!$H$2:$H${L})/COUNT(Ledger!$H$2:$H${L})/60,\"\")", "#,##0.0"),
        ("超预算轮数 (>预算基准)", '=COUNTIF(Ledger!$H$2:$H${L},">"&README!$B$13)', "#,##0"),
        ("预算基准 (s)", "=README!$B$13", "#,##0"),
        ("预算利用率", "=IFERROR(SUM(Ledger!$H$2:$H${L})/(COUNT(Ledger!$H$2:$H${L})*README!$B$13),\"\")", "0.0%"),
        ("最慢轮次技能", "=INDEX(Ledger!$C$2:$C${L},MATCH(MAX(Ledger!$H$2:$H${L}),Ledger!$H$2:$H${L},0))", "@"),
    ]),
    ("验证强度", None, [
        ("验证标记合计", "=SUM(Ledger!$M$2:$M${L})", "#,##0"),
        ("PASS 标记合计", "=SUM(Ledger!$K$2:$K${L})", "#,##0"),
        ("FAIL 标记合计", "=SUM(Ledger!$L$2:$L${L})", "#,##0"),
        ("总体 PASS 占比", "=IFERROR(SUM(Ledger!$K$2:$K${L})/SUM(Ledger!$M$2:$M${L}),\"\")", "0.0%"),
        ("每千 KB 产物验证标记", "=IFERROR(SUM(Ledger!$M$2:$M${L})/(SUM(Ledger!$F$2:$F${L})/1024),\"\")", "0.00"),
        ("最高 PASS 占比轮次技能", "=INDEX(Ledger!$C$2:$C${L},MATCH(MAX(Ledger!$N$2:$N${L}),Ledger!$N$2:$N${L},0))", "@"),
    ]),
    ("来源结构", "source", None),
    ("产物类别多样性", "kind", None),
    ("留用结论", None, [
        ("留用轮次", "=COUNTIF(Ledger!$P$2:$P${L},\"留用*\")", "#,##0"),
        ("非留用轮次", "=COUNTIF(Ledger!$P$2:$P${L},\"一般\")+COUNTIF(Ledger!$P$2:$P${L},\"不推荐\")", "#,##0"),
        ("本轮新装技能数", "=SUM(Ledger!$O$2:$O${L})", "#,##0"),
        ("零安装轮次数", "=COUNTIF(Ledger!$O$2:$O${L},0)", "#,##0"),
    ]),
]

def write_metrics_row(r, label, formula, fmt):
    a = mt.cell(row=r, column=1, value=label)
    a.font = FORMULA
    b = mt.cell(row=r, column=2, value=formula.replace("{L}", str(LAST)))
    b.font = LINK
    b.number_format = fmt
    c = mt.cell(row=r, column=3, value=b.value)
    # a doc column that merely *looks* like a formula must not become a live
    # duplicate of the cell it documents
    c.data_type = "s"
    c.font = Font(name=ARIAL, size=9, color="7F7F7F")


def write_group_table(r, title, groupby, col):
    h = mt.cell(row=r, column=1, value="■ " + title)
    h.font = BOLD
    keys = []
    for f in FACTS:
        if f[groupby] not in keys:
            keys.append(f[groupby])
    r += 1
    for j, head in enumerate(["分组", "轮次数", "产物合计 (KB)", "平均耗时 (min)"], start=1):
        c = mt.cell(row=r, column=j, value=head)
        c.font = HDR
        c.fill = HDR_FILL
    for k in keys:
        r += 1
        a = mt.cell(row=r, column=1, value=k)
        a.font = LINK
        for j, tmpl, fmt in (
            (2, '=COUNTIF(Ledger!${c}$2:${c}${L},$A${r})', "#,##0"),
            (3, '=SUMIF(Ledger!${c}$2:${c}${L},$A${r},Ledger!$F$2:$F${L})/1024', "#,##0.0"),
            (4, '=IFERROR(SUMIF(Ledger!${c}$2:${c}${L},$A${r},Ledger!$H$2:$H${L})'
                '/COUNTIFS(Ledger!${c}$2:${c}${L},$A${r},Ledger!$H$2:$H${L},">0")/60,"")', "#,##0.0"),
        ):
            cell = mt.cell(row=r, column=j,
                           value=tmpl.replace("{c}", col).replace("{L}", str(LAST)).replace("{r}", str(r)))
            cell.font = LINK
            cell.number_format = fmt
    return r


GROUPS = {"source": "来源结构", "kind": "产物类别多样性"}
COL_OF = {"source": "D", "kind": "E"}

row = 4
mt["A4"] = "指标"
mt["B4"] = "值"
mt["C4"] = "公式口径（本表所有值均为公式，无一硬编码）"
for c in ("A4", "B4", "C4"):
    mt[c].font = HDR
    mt[c].fill = HDR_FILL

for name, groupby, items in blocks:
    row += 1
    if groupby is None:
        mt.cell(row=row, column=1, value="■ " + name).font = BOLD
        for label, formula, fmt in items:
            row += 1
            write_metrics_row(row, label, formula, fmt)
    else:
        row = write_group_table(row, GROUPS[groupby], groupby, COL_OF[groupby])

chart = BarChart()
chart.type = "col"
chart.title = "各轮主产物体积 (KB)"
chart.y_axis.title = "KB"
chart.x_axis.title = "轮次"
data = Reference(lg, min_col=7, min_row=1, max_row=LAST)
cats = Reference(lg, min_col=1, min_row=2, max_row=LAST)
chart.add_data(data, titles_from_data=True)
chart.set_categories(cats)
chart.height = 8
chart.width = 17
mt.add_chart(chart, "E5")

out = os.path.join(HERE, "skill-showcase-ledger.xlsx")
wb.save(out)
print("wrote", out, os.path.getsize(out), "bytes")
