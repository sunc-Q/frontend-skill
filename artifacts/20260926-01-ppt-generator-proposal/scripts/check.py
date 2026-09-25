#!/usr/bin/env python3
"""check.py — 第 12 轮断言（A-K 十一组）：ppt-generator × 中文商务提案。
期望值全部现算自 data.json / spec-audit.json / 磁盘产物；不抄产物数字（历轮教训）。
A 规范符合性 | B 数据算术与几何反推 | C 三风格指纹与色板互斥 | D 安全区 | E 跨风格事实一致
F 技能台账与声称复测 | G 产物与体积 | H 预览零外链 | I PPTX OOXML 复核 | J SVG 硬约束 | K 台账幂等互查
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
D = json.load(open(HERE / "data.json", encoding="utf-8"))
AUD = json.load(open(HERE / "scripts" / "spec-audit.json", encoding="utf-8"))
DIR_OF = {"consultant": "consultant", "government_red": "government_red", "tech_blue": "科技蓝商务"}
STYLES = list(DIR_OF)
PAGES = ["01_cover", "02_toc", "03_status", "04_arch", "05_plan", "06_ending"]
AREA = {"consultant": (60, 120, 1220, 640), "government_red": (60, 100, 1220, 660), "tech_blue": (80, 170, 1200, 630)}

R = []
def ck(name, cond, extra=""):
    R.append((name, bool(cond), extra))

# ---------- 解析 ----------
ATTR = re.compile(r'([\w-]+)="([^"]*)"')
TAG_TEXT = re.compile(r"<text ([^>]*?)>(.*?)</text>", re.S)

def unesc(s):
    return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")

def parse(style, page):
    src = (HERE / "svg" / style / f"{page}.svg").read_text(encoding="utf-8")
    texts = []
    for m in TAG_TEXT.finditer(src):
        a = dict(ATTR.findall(m.group(1)))
        texts.append({"x": float(a["x"]), "y": float(a["y"]), "size": float(a["font-size"]),
                      "fill": a.get("fill", ""), "anchor": a.get("text-anchor", "start"),
                      "family": a.get("font-family", ""), "content": unesc(m.group(2))})
    rects = []
    for m in re.finditer(r"<rect ([^>]*?)/>", src):
        a = dict(ATTR.findall(m.group(1)))
        try:
            rects.append({k: float(a[k]) for k in ("x", "y", "width", "height") if k in a} |
                         {k: a[k] for k in ("fill", "rx", "stroke", "stroke-dasharray", "fill-opacity") if k in a})
        except ValueError:
            pass
    grads = re.findall(r"<linearGradient", src)
    hexes = {c.upper() for c in re.findall(r"#[0-9A-Fa-f]{6}", src)}
    fams = {m.replace('"', "'") for m in re.findall(r'font-family="([^"]*)"', src)}
    sizes = {float(m) for m in re.findall(r'font-size="([\d.]+)"', src)}
    return {"src": src, "texts": texts, "rects": rects, "grads": len(grads), "hexes": hexes,
            "families": fams, "sizes": sizes, "bytes": len(src.encode("utf-8"))}

P = {(s, p): parse(s, p) for s in STYLES for p in PAGES}

def spec_e(s):
    return AUD["styles"][DIR_OF[s]]

def allowed_sizes(s):
    e = spec_e(s); a = set()
    for row in e["spec_font_table"]:
        for tok in row["size"].split("-"):
            a.add(float(tok))
    for g in e["geometry"].values():
        a |= set(g["font_sizes"])
    return a

def allowed_families(s):
    e = spec_e(s)
    fams = {e["spec_font_stack"].replace('"', "'")}
    for g in e["geometry"].values():
        fams |= {f.replace('"', "'") for f in g["font_families"]}
    return fams

def palette(s):
    e = spec_e(s)
    return {h.upper() for h in e["spec_hex_all"]} | {h.upper() for h in e["template_hex_all"]}

def find_text(doc, sub):
    return [t for t in doc["texts"] if sub in t["content"]]

# ---------- A 规范符合性 ----------
for s in STYLES:
    e = spec_e(s)
    pal = palette(s)
    szok, famok = allowed_sizes(s), allowed_families(s)
    for p in PAGES:
        d = P[(s, p)]
        ck(f"A/{s}/{p}/viewBox+bg", 'viewBox="0 0 1280 720"' in d["src"]
           and any(r.get("width") == 1280 and r.get("height") == 720 for r in d["rects"]))
        ck(f"A/{s}/{p}/palette", d["hexes"] <= pal, str(sorted(d["hexes"] - pal)))
        ck(f"A/{s}/{p}/sizes∈spec∪模板", d["sizes"] <= szok, str(sorted(d["sizes"] - szok)))
        ck(f"A/{s}/{p}/families∈spec∪模板", d["families"] <= famok, str(sorted(d["families"] - famok)))
    # chrome 指纹：内容页导航
    for p in PAGES[1:5]:
        d = P[(s, p)]
        if s == "consultant":
            ck(f"A/consultant/{p}/topbar4px",
               any(r.get("width") == 1280 and r.get("height") == 4 and r["y"] == 0 for r in d["rects"]))
            ck(f"A/consultant/{p}/footer", len(find_text(d, "机密")) >= 1)
        if s == "government_red":
            ck(f"A/gov/{p}/topbar6px渐变", any(r.get("width") == 1280 and r.get("height") == 6 and r["y"] == 0
                                              and str(r.get("fill", "")).startswith("url(") for r in d["rects"]))
            ck(f"A/gov/{p}/bottom4px红", any(r.get("width") == 1280 and r.get("height") == 4 and r["y"] == 716
                                            and r.get("fill") == "#8B0000" for r in d["rects"]))
            if p != "02_toc":
                ck(f"A/gov/{p}/标题红方块50", any(r.get("width") == 50 and r.get("height") == 50
                                                and r.get("fill") == "#8B0000" for r in d["rects"]))
            else:
                ck("A/gov/02_toc/红章44编号块", sum(1 for r in d["rects"] if r.get("width") == 44
                                                   and r.get("fill") == "#8B0000") == 5)
        if s == "tech_blue":
            if p != "02_toc":
                ck(f"A/techblue/{p}/虚线大容器", any(r.get("stroke-dasharray") == "8,8"
                                                    and float(r.get("rx", -1)) == 10
                                                    and r.get("width") == 1160 and r.get("fill") == "none"
                                                    for r in d["rects"]))
            else:
                ck("A/techblue/02_toc/深色目录侧栏", any(r.get("width") == 360 and str(r.get("fill")).startswith("url(")
                                                       for r in d["rects"]))
            ck(f"A/techblue/{p}/标题前缀蓝块", any(r.get("width") == 10 and r.get("height") == 40 and r.get("x") == 40
                                                and r.get("y") == 40 for r in d["rects"]))
    # 封面主题模式：consultant 白底浅封面；gov/techblue 深蓝渐变暗封面（spec「Theme Mode」）
    cov = P[(s, "01_cover")]
    first_fill = cov["rects"][0]["fill"]
    if s == "consultant":
        ck("A/consultant/cover-light", first_fill == "#FFFFFF")
    else:
        ck(f"A/{s}/cover-dark-gradient", str(first_fill).startswith("url("), first_fill)
    if s == "tech_blue":
        ck("A/techblue/cover-waves+hex", cov["src"].count("<path") >= 2 and cov["src"].count("<polygon") >= 3)

# ---------- B 数据算术 + 几何反推 ----------
src_items = D["sources"]["items"]
ck("B/sources-sum==total", sum(i["value"] for i in src_items) == D["sources"]["total"],
   str(sum(i["value"] for i in src_items)))
ck("B/phases-sum==total", sum(p["price_wan"] for p in D["plan"]["phases"]) == D["plan"]["total_wan"])
ck("B/phase-months==12", sum(p["months"] for p in D["plan"]["phases"]) == D["plan"]["months"])
ck("B/payments-pct==100", sum(p["pct"] for p in D["plan"]["payments"]) == 100)
ck("B/payments-wan==total", abs(sum(p["wan"] for p in D["plan"]["payments"]) - D["plan"]["total_wan"]) < 1e-6)
ck("B/payment-wan==pct*total", all(abs(p["wan"] - D["plan"]["total_wan"] * p["pct"] / 100) < 0.05
                                   for p in D["plan"]["payments"]))
ck("B/team-sum", sum(m["n"] for m in D["plan"]["team"]) == 13)
ck("B/modules-sum==28", sum(len(L["modules"]) for L in D["arch"]["layers"]) == 28)
ck("B/kpi-has-bad-flag", sum(1 for k in D["kpis"] if k.get("bad")) == 1)

for s in STYLES:
    x0, y0, x1, y1 = AREA[s]
    W = x1 - x0
    vmax = max(i["value"] for i in src_items)
    bw_max = W - 200 - 120
    st = P[(s, "03_status")]
    bars = [r for r in st["rects"] if r.get("height") == 18 and r.get("x") == x0 + 200]
    ck(f"B/{s}/bars-count5", len(bars) == 5, str(len(bars)))
    for i, (it, r) in enumerate(zip(src_items, bars)):
        est = r["width"] / bw_max * vmax
        ck(f"B/{s}/bar{i}-geometry-implies-value", abs(est - it["value"]) / it["value"] < 0.005,
           f'{est:.0f} vs {it["value"]}')
        lab = find_text(st, f'{it["value"]:,}')
        ck(f"B/{s}/bar{i}-value-labeled", bool(lab))
    # 甘特
    pl = P[(s, "05_plan")]
    ax, aw = x0 + 240, W - 240 - 24
    mw = aw / 12
    for i, ph in enumerate(D["plan"]["phases"]):
        seg = [r for r in pl["rects"] if abs(r.get("x", -9) - round(ax + ph["start_m"] * mw, 10)) < 0.11
               and r.get("height") == 22]
        ck(f"B/{s}/gantt{i}-start", bool(seg))
        if seg:
            ck(f"B/{s}/gantt{i}-months∝width", abs(seg[0]["width"] - ph["months"] * mw) < 0.6,
               f'{seg[0]["width"]} vs {ph["months"] * mw}')
    # 付款分段
    pw = W - 24
    acc = x0
    for i, pay in enumerate(D["plan"]["payments"]):
        w = round(pw * pay["pct"] / 100, 1)
        seg = [r for r in pl["rects"] if r.get("height") == 26 and abs(r["x"] - acc) < 0.11]
        ck(f"B/{s}/pay{i}-width∝pct", bool(seg) and abs(seg[0]["width"] - w) < 0.6)
        acc += w + 2
    # 架构芯片数=模块数
    ar = P[(s, "04_arch")]
    chips = [r for r in ar["rects"] if r.get("height") == 44]
    ck(f"B/{s}/arch-chips==28", len(chips) == 28, str(len(chips)))
    for li, L in enumerate(D["arch"]["layers"]):
        ck(f"B/{s}/arch-{L['name']}-labeled", bool(find_text(ar, f'{len(L["modules"])} 模块')))
    for it in src_items:
        ck(f"B/{s}/source-{it['name']}", bool(find_text(st, it["name"])))
    for ph in D["plan"]["phases"]:
        ck(f"B/{s}/phase-{ph['name']}", bool(find_text(pl, ph["name"])))

# ---------- C 风格指纹与色板互斥 ----------
used = {s: set().union(*(P[(s, p)]["hexes"] for p in PAGES)) for s in STYLES}
for a in STYLES:
    for b in STYLES:
        if a < b:
            inter = used[a] & used[b]
            ck(f"C/palette-intersection⊆白/{a}×{b}", inter <= {"#FFFFFF"}, str(sorted(inter)))

def fingerprint(s):
    d2, d5 = P[(s, "02_toc")], P[(s, "05_plan")]
    fam = list(d2["families"])[0]
    return {
        "font": "Arial" if fam.startswith("Arial") else ("YaHei+微软雅黑四重" if "SimHei" in fam else "YaHei+PingFang"),
        "topbar": ("4px实线" if s == "consultant" else "6px红蓝渐变" if s == "government_red" else "10×40前缀块"),
        "bottom": ("无" if s != "government_red" else "4px红条y716"),
        "gradient": sum(P[(s, p)]["grads"] for p in PAGES),
        "rx": sorted({r.get("rx") for p in PAGES for r in P[(s, p)]["rects"] if "rx" in r}),
        "dashed": any("stroke-dasharray" in r for p in PAGES for r in P[(s, p)]["rects"]),
        "darkpages": sum(1 for p in ("01_cover", "06_ending") if P[(s, p)]["rects"][0]["fill"] != "#FFFFFF"),
    }

FP = {s: fingerprint(s) for s in STYLES}
for a in STYLES:
    for b in STYLES:
        if a < b:
            diff = sum(1 for k in FP[a] if FP[a][k] != FP[b][k])
            ck(f"C/fingerprint-diff≥3/{a}×{b}", diff >= 3, f"diff={diff} {FP[a]} || {FP[b]}")

# ---------- D 安全区（锚点估宽，历轮有效式） ----------
def text_w(s, size):
    return sum(size * (1.0 if ord(ch) > 0x2E7F else 0.58) for ch in s)

for s in STYLES:
    for p in PAGES:
        bad = []
        for t in P[(s, p)]["texts"]:
            w = text_w(t["content"], t["size"])
            x0 = t["x"] - (w / 2 if t["anchor"] == "middle" else w if t["anchor"] == "end" else 0)
            if x0 < -2 or x0 + w > 1282 or t["y"] < 8 or t["y"] > 712:
                bad.append((t["content"][:14], round(x0, 1), round(x0 + w, 1), t["y"]))
        ck(f"D/{s}/{p}/safe-zone", not bad, str(bad[:3]))

# ---------- E 跨风格事实一致 ----------
FACTS = ["12,860", "2,140", "608", "CQ-IOC-2026-017", "28 个能力模块", "182.4", "243.2", "13 人"]
for s in STYLES:
    allt = "".join(t["content"] for p in PAGES for t in P[(s, p)]["texts"])
    for f in FACTS:
        ck(f"E/{s}/fact-{f}", f in allt)
    for item in D["toc"]:
        ck(f"E/{s}/toc-{item['title']}", item["title"] in allt)

# ---------- F 技能台账与声称复测（本轮研究问题的机检部分） ----------
ia = AUD["index_audit"]
ck("F/index-meta20-vs-disk13", ia["meta_total"] == 20 and ia["on_disk"] == 13)
ck("F/index-unindexed==3(含本轮consultant)", ia["on_disk_but_unindexed"] == ["cloud_orange", "consultant", "dark_warm"],
   str(ia["on_disk_but_unindexed"]))
ck("F/index-10虚列(品牌族)", len(ia["indexed_but_missing"]) == 10)
ck("F/cloud_orange零SVG", ia["disk_svg_counts"]["cloud_orange"] == 0)
amc = AUD["theme_mode_claims"]
ck("F/ai_ops声称Dark但spec为Light", "Dark" in amc["ai_ops"]["skill_md"] and amc["ai_ops"]["design_spec"].startswith("Light"))
ck("F/government_red不在SKILL菜单表", amc["government_red"]["skill_md"].startswith("（"))
for s in STYLES:
    e = spec_e(s)
    ck(f"F/layouts模板∩spec非空/{s}", len(e["template_intersection_with_spec"]) >= 7,
       f'{len(e["template_intersection_with_spec"])}/{len(e["spec_hex_all"])}')

# ---------- G 产物与体积 ----------
tot = 0
for s in STYLES:
    for p in PAGES:
        n = P[(s, p)]["bytes"]
        ck(f"G/{s}/{p}/size", 1000 < n < 120000, str(n))
        tot += n
ck("G/svg-total<2MB", tot < 2_000_000, str(tot))
for s in STYLES:
    files = sorted(x.name for x in (HERE / "svg" / s).glob("*.svg"))
    ck(f"G/{s}/页序=显式ORDER", files == [p + ".svg" for p in PAGES], str(files))

# ---------- J SVG 硬约束（spec §X + SKILL.md） ----------
FORBID = ["<foreignObject", "<style", "class=", "clipPath", "<mask", "textPath", "<animate", "<script",
          "marker-end", "rgba(", "<![CDATA["]
for s in STYLES:
    for p in PAGES:
        src = P[(s, p)]["src"]
        hits = [f for f in FORBID if f in src]
        ck(f"J/{s}/{p}/forbidden", not hits, str(hits))

# ---------- H 预览 + I PPTX（文件在时） ----------
prev = HERE / "preview"
for s in STYLES:
    f = prev / f"{s}.html"
    if f.exists():
        h = f.read_text(encoding="utf-8")
        ck(f"H/{s}/6页内联", h.count("<svg") == 6, str(h.count("<svg")))
        ck(f"H/{s}/零外链", not re.search(r'<(link|img|script)[^>]+(href|src)=', h))
    else:
        ck(f"H/{s}/exists", False)
exp = HERE / "scripts" / "export-result.json"
if exp.exists():
    ER = json.load(open(exp, encoding="utf-8"))
    for s in STYLES:
        r = ER[s]
        ck(f"I/{s}/slides6", r["slides"] == 6)
        ck(f"I/{s}/media0", r["media"] == 0, str(r["media"]))
        ck(f"I/{s}/no-blip", sum(x["blip"] for x in r["per_slide"]) == 0)
        svg_texts = [len(P[(s, p)]["texts"]) for p in PAGES]
        ck(f"I/{s}/at_runs==svg_texts", [x["at_runs"] for x in r["per_slide"]] == svg_texts,
           f'{[x["at_runs"] for x in r["per_slide"]]} vs {svg_texts}')
        for i, x in enumerate(r["per_slide"]):
            ck(f"I/{s}/slide{i}-emu-in-bounds", 0 <= x["emu_min"] and x["emu_max"] <= 12192000)
            uniq = sorted({t["size"] for t in P[(s, PAGES[i])]["texts"]})
            ck(f"I/{s}/slide{i}-pt-px075-exact", all(abs(sz - ps * 0.75) < 0.02 for sz, ps in zip(x["sizes_pt"], uniq)),
               f'{x["sizes_pt"]} vs {uniq}')
        ck(f"I/{s}/grads-kept", all(x["gradFill"] > 0 for x in r["per_slide"][0:1]) if s != "consultant" else True)
        ck(f"I/{s}/alpha-kept", sum(x["alpha"] for x in r["per_slide"]) > 0)
else:
    ck("I/export-result.json-exists(先跑 export_pptx.py)", False)

# ---------- K 台账幂等互查 ----------
snap_f = HERE / "scripts" / "ledger-snapshot.json"
if snap_f.exists():
    SNAP = json.load(open(snap_f, encoding="utf-8"))
    ST = json.loads((HERE.parents[1] / "state" / "state.json").read_text(encoding="utf-8"))
    ck("K/tried+1", len(ST["tried"]) == SNAP["tried_count"] + 1)
    ck("K/runs+1", len(ST["runs"]) == SNAP["runs_count"] + 1)
    ck("K/used_styles+=3", len(ST["used_styles"]) == SNAP["used_styles_count"] + 3)
    ck("K/本轮三风格已入 used_styles", ST["used_styles"][-3:] == SNAP["this_round_styles"],
       f'{ST["used_styles"][-3:]} vs {SNAP["this_round_styles"]}')
else:
    ck("K/ledger-snapshot.json 缺失（收尾前生成）", False)

# ---------- 汇总 ----------
fails = [x for x in R if not x[1]]
for name, okx, extra in fails:
    print("FAIL", name, extra)
print(f"PASS {len(R) - len(fails)}/{len(R)}")
print("bytes/page:", {f"{s}/{p}": P[(s, p)]["bytes"] for s in STYLES[:1] for p in PAGES})
print("fingerprint:", json.dumps(FP, ensure_ascii=False))
sys.exit(1 if fails else 0)
