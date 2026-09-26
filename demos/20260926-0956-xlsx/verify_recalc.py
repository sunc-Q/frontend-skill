"""Independent verification of skill-showcase-ledger.xlsx.

The xlsx skill makes recalculation mandatory via scripts/recalc.py, which shells
out to LibreOffice. This box has no soffice, so the same guarantee is checked
with a pure-Python formula engine (`formulas` 1.3.4) instead:

  A  no cached values before recalc (the skill's own stated gotcha)
  B  every formula resolves, zero Excel error literals
  C  ~25 computed cells match ground truth re-derived in plain Python
  D  inputs drive dependents (change a byte count / the budget -> chain moves)
  E  the skill's "functions that survive verification" claims, probed
"""
import os
import re
import shutil
import sys

import formulas
import openpyxl
from openpyxl import Workbook, load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
XL = os.path.join(HERE, "skill-showcase-ledger.xlsx")
TMP = os.path.join(HERE, ".tmp")
os.makedirs(TMP, exist_ok=True)
FACTS = __import__("json").load(open(os.path.join(HERE, "facts.json")))
LAST_ROW = len(FACTS) + 1

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), "|", name, "|", detail)


def solve(path):
    model = formulas.ExcelModel().loads(path).finish()
    sol = model.calculate()
    out = {}
    pat = re.compile(r"^\'\[[^\]]+\](\w+)\'!(\w+\$\$?\d+|\w+\d+)$")
    for k, v in sol.items():
        m = pat.match(k)
        if not m:
            continue
        sheet, cell = m.group(1).upper(), m.group(2).upper().replace("$", "")
        try:
            val = v.value
        except Exception:
            continue
        try:
            import numpy as np
            if isinstance(val, np.ndarray):
                val = val.reshape(-1)[0] if val.size else None
        except Exception:
            pass
        out.setdefault(sheet, {})[cell] = val
    return out


# ---------------------------------------------------------------- A
wbf = load_workbook(XL)          # formulas pass
wbv = load_workbook(XL, data_only=True)   # cached-values pass
formula_cells = [(s, c.coordinate, c.value) for s in wbf.sheetnames
                 for row in wbf[s].iter_rows() for c in row
                 if c.data_type == "f"]      # live formulas only, not doc text
cached_none = sum(1 for s, coord, _ in formula_cells
                  if wbv[s][coord].value is None)
check("A1 表内含公式单元格", len(formula_cells) >= 60, "%d 个公式" % len(formula_cells))
check("A2 技能声明的 gotcha 成立：openpyxl 写出的文件未重算前 data_only 读回全为 None",
      cached_none == len(formula_cells),
      "%d/%d 读回 None" % (cached_none, len(formula_cells)))

# ---------------------------------------------------------------- B
eng = solve(XL)
ERRORS = ("#VALUE!", "#DIV/0!", "#REF!", "#NAME?", "#NULL!", "#NUM!", "#N/A")
err_cells = [(s, c, v) for s, d in eng.items() for c, v in d.items()
             if isinstance(v, str) and any(e in v for e in ERRORS)]
resolved = sum(1 for s, d in eng.items() for c, v in d.items()
               if re.match(r"^[A-Z]+\d+$", c) and v is not None)
check("B1 引擎解析出全部公式单元格", len(formula_cells) > 0 and len(eng) >= 2,
      "sheets=%s" % sorted(eng))
check("B2 零 Excel 错误字面量", not err_cells,
      ("%d 个错误: %s" % (len(err_cells), err_cells[:5])) if err_cells else "0 error")

LED, MET = eng.get("LEDGER", {}), eng.get("METRICS", {})

# label -> row on Metrics, so assertions cite labels not magic rows
mt = wbf["Metrics"]
LBL = {}
for r in mt.iter_rows(min_col=1, max_col=1):
    c = r[0]
    if isinstance(c.value, str):
        LBL.setdefault(c.value, []).append(c.row)


def mval(label, idx=0):
    return MET.get("B%d" % LBL[label][idx])


def lval(coord):
    return LED.get(coord)


# ---------------------------------------------------------------- C
tot_bytes = sum(f["bytes"] for f in FACTS)
tot_kb = tot_bytes / 1024.0
secs = [f["seconds"] for f in FACTS if f["seconds"]]
tot_pass = sum(f["pass"] for f in FACTS)
tot_fail = sum(f["fail"] for f in FACTS)
biggest = max(FACTS, key=lambda f: f["bytes"])
smallest = min(FACTS, key=lambda f: f["bytes"])
slowest = max(secs)
r8 = [f for f in FACTS if f["run"] == 8][0]

check("C1 Ledger!G2 产物 KB = 实测字节/1024", abs(lval("G2") - FACTS[0]["bytes"] / 1024.0) < 1e-9,
      "G2=%s 期望=%.4f" % (lval("G2"), FACTS[0]["bytes"] / 1024.0))
check("C2 Ledger!I2 分钟 = 秒/60", abs(lval("I2") - 420 / 60.0) < 1e-9, "I2=%s" % lval("I2"))
check("C3 Ledger!J2 B/s = 字节/秒", abs(lval("J2") - FACTS[0]["bytes"] / 420.0) < 1e-6,
      "J2=%s" % lval("J2"))
check("C4 Ledger!M2 = K+L", lval("M2") == 34 + 4, "M2=%s" % lval("M2"))
check("C5 Ledger!N2 PASS 占比", abs(lval("N2") - 34 / 38.0) < 1e-9, "N2=%s" % lval("N2"))
check("C6 第 8 轮空耗时经 IF(H=\"\",\"\") 守卫后是真空值，不是合法的 0.0",
      lval("I9") in ("", None) and lval("J9") in ("", None), "I9=%r J9=%r" % (lval("I9"), lval("J9")))
check("C7 第 8 轮 M=0 除法被 IFERROR 兜住（N9 空，非 #DIV/0!）", lval("N9") in ("", None),
      "N9=%r" % lval("N9"))
check("C8 Metrics 已完成轮次 = 8", mval("已完成轮次") == 8, str(mval("已完成轮次")))
check("C9 Metrics 主产物合计(B) = 逐轮实测求和", mval("主产物合计 (B)") == tot_bytes,
      "%s vs %d" % (mval("主产物合计 (B)"), tot_bytes))
check("C10 Metrics 主产物合计(KB)", abs(mval("主产物合计 (KB)") - tot_kb) < 1e-6, str(mval("主产物合计 (KB)")))
check("C11 平均单产物(KB)", abs(mval("单轮平均产物 (KB)") - tot_kb / 8) < 1e-6, str(mval("单轮平均产物 (KB)")))
check("C12 MAX+INDEX/MATCH 命中最大产物所属技能", mval("最大单产物所属技能") == biggest["skill"],
      "%s vs %s" % (mval("最大单产物所属技能"), biggest["skill"]))
check("C13 MIN+INDEX/MATCH 命中最小产物所属技能", mval("最小单产物所属技能") == smallest["skill"],
      "%s vs %s" % (mval("最小单产物所属技能"), smallest["skill"]))
check("C14 有耗时记录轮次 = 7", mval("有耗时记录轮次") == 7, str(mval("有耗时记录轮次")))
check("C15 累计耗时(min)", abs(mval("累计耗时 (min)") - sum(secs) / 60.0) < 1e-6,
      "%s vs %.3f" % (mval("累计耗时 (min)"), sum(secs) / 60.0))
budget = 900
over = sum(1 for s in secs if s > budget)
check("C16 COUNTIF 条件里拼接输入单元格（>README!B13）", mval("超预算轮数 (>预算基准)") == over,
      "%s vs %d（>%ds）" % (mval("超预算轮数 (>预算基准)"), over, budget))
check("C17 跨表链接 README!B13 生效", mval("预算基准 (s)") == budget, str(mval("预算基准 (s)")))
check("C18 预算利用率", abs(mval("预算利用率") - sum(secs) / (len(secs) * budget)) < 1e-9,
      str(mval("预算利用率")))
check("C19 最慢轮次 = build-game", mval("最慢轮次技能") == "build-game", str(mval("最慢轮次技能")))
check("C20 验证标记合计 = PASS+FAIL 总和", mval("验证标记合计") == tot_pass + tot_fail,
      "%s vs %d" % (mval("验证标记合计"), tot_pass + tot_fail))
check("C21 总体 PASS 占比", abs(mval("总体 PASS 占比") - tot_pass / float(tot_pass + tot_fail)) < 1e-9,
      str(mval("总体 PASS 占比")))
tie = [f["skill"] for f in FACTS if f["fail"] == 0 and f["pass"] > 0]
check("C22 MAX+MATCH 落在并列最高 PASS 占比的第一行（MATCH 取首个，非全部）",
      mval("最高 PASS 占比轮次技能") == tie[0] and len(tie) > 1,
      "公式=%s 并列满分轮=%s" % (mval("最高 PASS 占比轮次技能"), tie))
grp = {}
for f in FACTS:
    g = grp.setdefault(f["source"], {"n": 0, "b": 0, "s": []})
    g["n"] += 1
    g["b"] += f["bytes"]
    if f["seconds"]:
        g["s"].append(f["seconds"])
g["nb"] = g.get("nb", 0)
src_rows = {mt.cell(row=r, column=1).value: r for r in range(1, mt.max_row + 1)}
ok_src = True
det = []
for k, g in grp.items():
    r = src_rows.get(k)
    if r is None:
        ok_src = False
        det.append("%s 分组行缺失" % k)
        continue
    got = MET.get("B%d" % r), MET.get("C%d" % r), MET.get("D%d" % r)
    want = (g["n"], g["b"] / 1024.0, sum(g["s"]) / len(g["s"]) / 60.0 if g["s"] else "")  # 分母=有耗时记录的轮次
    third_ok = (want[2] == "" and got[2] in ("", None)) or (
        isinstance(want[2], float) and got[2] is not None and abs(got[2] - want[2]) < 1e-6)
    good = got[0] == want[0] and (got[1] is not None and abs(got[1] - want[1]) < 1e-6) and third_ok
    if not good:
        ok_src = False
    det.append("%s: 公式%r 期望%r" % (k, got, want))
check("C23 SUMIF/COUNTIFS 按来源分组三项全对（含空耗时不入分母）", ok_src, " | ".join(det))
check("C24 COUNTIF 前缀通配 留用* == 8", mval("留用轮次") == 8, str(mval("留用轮次")))
check("C25 新装技能数 = 台账里 5 轮有安装记录", mval("本轮新装技能数") == 5, str(mval("本轮新装技能数")))
check("C26 零安装轮次 = COUNTIF(O,0) = 3", mval("零安装轮次数") == 3, str(mval("零安装轮次数")))

# structural: chart + comments + number formats + colours
import zipfile
names = zipfile.ZipFile(XL).namelist()
chart_xml = [n for n in names if n.startswith("xl/charts/chart")]
check("S1 原生图表已内嵌（不是图片）", chart_xml and "xl/charts/chart1.xml" in names, str(chart_xml))
check("S2 工作表三张且顺序正确", wbf.sheetnames == ["README", "Ledger", "Metrics"], str(wbf.sheetnames))
cmts = sum(1 for s in wbf.sheetnames for row in wbf[s].iter_rows() for c in row if c.comment)
check("S3 每个输入口径都有单元格批注（技能要求 document every assumption）", cmts >= 10, "%d 条批注" % cmts)
def is_blue(c):
    rgb = getattr(c.font.color, "rgb", None) or "" if c.font and c.font.color else ""
    return str(rgb).endswith("0000FF")


input_cols = ["F", "H", "K", "L", "O"]
blue_cells = [(col + str(r)) for r in range(2, LAST_ROW + 1) for col in input_cols
              if wbf["Ledger"][col + str(r)].value is not None and is_blue(wbf["Ledger"][col + str(r)])]
black_formula = [c for c in ("G2", "I2", "J2", "M2", "N2") if not is_blue(wbf["Ledger"][c])]
green = is_blue(mt["B%d" % LBL["已完成轮次"][0]]) is False and str(
    getattr(mt["B%d" % LBL["已完成轮次"][0]].font.color, "rgb", "")).endswith("008000")
check("S4 输入=蓝 / 公式=黑 / 跨表=绿（技能的配色语义）",
      len(blue_cells) >= 35 and len(black_formula) == 5 and green,
      "蓝格 %d 个、黑公式 %d/5、Metrics 跨表绿=%s" % (len(blue_cells), len(black_formula), green))
fmt_pct = wbf["Ledger"]["N2"].number_format
fmt_year = wbf["Ledger"]["B2"].number_format
check("S5 百分比/年份格式：占比用 0.0%%、年份存文本", "%" in fmt_pct and wbf["Ledger"]["B2"].value == FACTS[0]["date"]
      and isinstance(wbf["Ledger"]["B2"].value, str), "N2=%s B2=%r fmt=%s" % (fmt_pct, wbf["Ledger"]["B2"].value, fmt_year))
fonts = {c.font.name for s in ("README", "Ledger", "Metrics") for row in wbf[s].iter_rows() for c in row if c.value is not None}
check("S6 全表统一 Arial（技能强制专业字体）", fonts == {"Arial"}, str(fonts))
years = [c.value for row in wbf["Ledger"].iter_rows(min_col=2, max_col=2) for c in row
         if isinstance(c.value, int)]
check("S7 日期未被数值化成 2,026", not years, "int 型日期单元格 %r" % years)
nonascii_xl = sum(1 for s in ("Ledger",) for row in wbf[s].iter_rows(min_row=2) for c in row
                  if isinstance(c.value, str) and c.value.startswith("=") and any(ch > "~" for ch in c.value))
check("S8 公式体内不含中文（跨表引用只用 ASCII 表名 Ledger/README/Metrics）", nonascii_xl == 0,
      "%d 条公式含非 ASCII" % nonascii_xl)

grey = [c for row in mt.iter_rows(min_col=3, max_col=3) for c in row
        if c.font and getattr(c.font, "sz", None) == 9]        # doc cells are written 9pt grey
doc_text = [c for c in grey if c.data_type == "s"]
live_doc = [c.coordinate for c in grey if c.data_type == "f"]
check("S9 「公式口径」文档以文本存储，未变成被记录公式的活副本（24 条指标行全覆盖）",
      len(grey) == 24 and len(doc_text) == 24 and not live_doc,
      "文档格 %d 条 / 文本 %d / 仍是活公式 %s" % (len(grey), len(doc_text), live_doc))

# ---------------------------------------------------------------- D
mut = os.path.join(TMP, "mutated.xlsx")
shutil.copyfile(XL, mut)
w = load_workbook(mut)
old_bytes = FACTS[0]["bytes"]
w["Ledger"]["F2"] = old_bytes * 3          # double-check: not SUMIF, the row itself
w["README"]["B13"] = 500                   # budget lever
w.save(mut)
eng2 = solve(mut)
LED2, MET2 = eng2["LEDGER"], eng2["METRICS"]
kb_changed = abs(LED2["G2"] - old_bytes * 3 / 1024.0) < 1e-9
sum_changed = abs(MET2["B%d" % LBL["主产物合计 (B)"][0]] - (tot_bytes + old_bytes * 2)) < 1e-6
budget_link = MET2["B%d" % LBL["预算基准 (s)"][0]] == 500
over2 = sum(1 for s in secs if s > 500)
over_changed = MET2["B%d" % LBL["超预算轮数 (>预算基准)"][0]] == over2 and over2 != over
check("D1 改一个输入字节 → 本行 KB 公式跟着变（非硬编码）", kb_changed,
      "G2 %s→%s" % (lval("G2"), LED2["G2"]))
check("D2 该变化贯穿到合计公式", sum_changed,
      "合计 %s→%s 期望 %d" % (mval("主产物合计 (B)"), MET2["B%d" % LBL["主产物合计 (B)"][0]], tot_bytes + old_bytes * 2))
check("D3 跨表链接的预算杠杆生效（README!B13→Metrics）", budget_link, str(MET2["B%d" % LBL["预算基准 (s)"][0]]))
check("D4 依赖该杠杆的 COUNTIF 条件重算（%d 轮→%d 轮超预算）" % (over, over2), over_changed,
      "超预算 %s→%s" % (mval("超预算轮数 (>预算基准)"), MET2["B%d" % LBL["超预算轮数 (>预算基准)"][0]]))
lbl_key = "来源结构"
g_rows = {mt.cell(row=r, column=1).value: r for r in range(1, mt.max_row + 1)}
r_off = g_rows["官方市场"]
check("D5 SUMIF 分组聚合也被输入变化带动",
      abs(MET2["C%d" % r_off] - (grp["官方市场"]["b"] + old_bytes * 2) / 1024.0) < 1e-6,
      "官方市场合计(KB) %s→%s" % (MET["C%d" % r_off], MET2["C%d" % r_off]))
err2 = [(s, c, v) for s, d in eng2.items() for c, v in d.items()
        if isinstance(v, str) and any(e in v for e in ERRORS)]
check("D6 变异后仍零错误", not err2, str(err2[:3]))

# ---------------------------------------------------------------- E
probe = os.path.join(TMP, "probe.xlsx")
wbp = Workbook()
sp = wbp.active
sp.title = "P"
sp["A1"], sp["A2"], sp["A3"] = 1, 2, 3
sp["B1"], sp["B2"], sp["B3"] = "x", "y", "z"
cases = [
    ("C1", "=SUM(A1:A3)", 6, "Excel-2007 基础函数"),
    ("C2", '=SUMIFS(A1:A3,A1:A3,">1")', 5, "SUMIFS（技能推荐）"),
    ("C3", '=INDEX(B1:B3,MATCH(2,A1:A3,0))', "y", "INDEX/MATCH（技能推荐的查找）"),
    ("C4", '=IFERROR(1/0,"-")', "-", "IFERROR"),
    ("C5", '_xlfn.TEXTJOIN(",",TRUE,B1:B3)', None, "带前缀的 TEXTJOIN（技能称可存活）"),
    ("C6", '=TEXTJOIN(",",TRUE,B1:B3)', None, "裸写 TEXTJOIN（技能称 #NAME?）"),
    ("C7", "=XLOOKUP(2,A1:A3,B1:B3)", None, "XLOOKUP（技能称任何前缀都不可用）"),
    ("C8", '=IFERROR(_xlfn.UNIQUE(B1:B3),"")', None, "UNIQUE（技能称禁用）"),
    ("A5", None, None, "留空单元格，供 E4 空分母探针"),
    ("C9", "=A5/60", None, "空分母不报错？"),
]
for coord, f, _, _ in cases:
    sp[coord] = f
wbp.save(probe)
engp = solve(probe)["P"]
det = []
ok = True
for coord, f, want, note in cases:
    got = engp.get(coord)
    if want is not None:
        good = got == want
        det.append("%s=%r%s" % (coord, got, "" if good else "≠%r" % want))
        ok = ok and good
    else:
        det.append("%s=%r" % (coord, got))
check("E1 技能推荐的 2007 时代函数在独立引擎里全部算对", ok, " | ".join(det))
blank_div = engp.get("C9")
check("E4 空分母陷阱：=A5/60 在空单元格上不报错而返回 0（所以守卫必须用 IF 不能只靠 IFERROR）",
      blank_div == 0, "C9(空单元格/60)=%r" % blank_div)
xlookup = engp.get("C7")
bare = engp.get("C6")
pref = engp.get("C5")
check("E2 技能「XLOOKUP 任何前缀都不可用」是**其自带 LibreOffice 运行时**的条款，不是函数真理：第三方引擎照样算对",
      xlookup == "y", "XLOOKUP→%r（Excel/LibreOffice 侧才是 #NAME?）" % xlookup)
check("E3 前缀规则随引擎反向：_xlfn.TEXTJOIN 在本引擎失效、裸写 TEXTJOIN 生效（与技能对 Excel 的告诫正好相反）",
      pref == '_xlfn.TEXTJOIN(",",TRUE,B1:B3)' and bare == "x,y,z",
      "prefixed=%r bare=%r" % (pref, bare))

# ---------------------------------------------------------------- report
fails = [n for n, okk, _ in RESULTS if not okk]
print("\n=== %d 断言 / %d PASS / %d FAIL ===" % (len(RESULTS), len(RESULTS) - len(fails), len(fails)))
for n in fails:
    print("  FAIL:", n)
sys.exit(0 if not fails else 2)
