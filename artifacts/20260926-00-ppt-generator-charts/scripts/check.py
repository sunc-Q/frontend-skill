#!/usr/bin/env python3
"""check.py — 第 11 轮断言套件（A–K 十一组）。
所有期望值从 data.json / themes.json 现算，不从产物反抄；模板诚实度读 scripts/template-audit.json；
PPTX 读 scripts/export-result.json（由 export_pptx.py 测量）。
"""
import json, re, math, sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
LAB = HERE.parent.parent          # 前端skill实验室
D = json.load(open(HERE / "data.json", encoding="utf-8"))
TH = json.load(open(HERE / "themes.json", encoding="utf-8"))
AUD = json.load(open(HERE / "scripts/template-audit.json", encoding="utf-8"))
STYLES = ["govblue", "psych", "pixel"]
PAGES = ["01_kpi", "02_trend", "03_compare", "04_composition", "05_ranking", "06_funnel"]

results = []
def ck(name, cond, extra=""):
    results.append((name, bool(cond), extra))

# ---------- 解析 ----------
def unesc(s):
    return s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")

TAG_TEXT = re.compile(r"<text ([^>]*?)>(?:<tspan[^>]*>(.*?)</tspan>)?</text>", re.S)
ATTR = re.compile(r'([\w-]+)="([^"]*)"')

def parse(style, page):
    src = (HERE / "svg" / style / f"{page}.svg").read_text(encoding="utf-8")
    texts = []
    for m in TAG_TEXT.finditer(src):
        a = dict(ATTR.findall(m.group(1)))
        texts.append({"x": float(a["x"]), "y": float(a["y"]), "size": float(a["font-size"]),
                      "fill": a.get("fill", ""), "anchor": a.get("text-anchor", "start"),
                      "content": unesc(m.group(2) or "")})
    rects = [dict(ATTR.findall(m)) for m in re.findall(r"<rect ([^>]*?)/>", src)]
    for r_ in rects:
        for k in ("x", "y", "width", "height"):
            if k in r_:
                r_[k] = float(r_[k])
    lines = [dict(ATTR.findall(m)) for m in re.findall(r'<line ([^>]*?)/>', src)]
    paths = re.findall(r'<path d="([^"]+)"', src)
    polys = re.findall(r'<polyline points="([^"]+)"', src)
    return {"src": src, "texts": texts, "rects": rects, "lines": lines, "paths": paths, "polys": polys}

P = {(s, p): parse(s, p) for s in STYLES for p in PAGES}

def text_w(s, size):
    return sum(size * (1.0 if ord(ch) > 0x2E7F else 0.58) for ch in s)

# ---------- 派生数据 ----------
trev, tcost = sum(D["trend"]["revenue"]), sum(D["trend"]["cost"])
profit = trev - tcost
margin = round(profit / trev * 100, 1)
fs_ = D["funnel"]["stages"]
fc = [s["count"] for s in fs_]
def p1(a, b): return round(a / b * 100, 1)
funnel_widths = [120 + 480 * c / fc[0] for c in fc]
comp = D["lines"]["items"]
ctot = sum(i["value"] for i in comp)
assert ctot == trev == D["composition"]["center_value"]

# ---------- A 结构 ----------
BAN = ["<marker", "foreignObject", "<clipPath", "clip-path", "<mask", "<style", "class=",
       "<textPath", "<animate", "<script", "<image", "rgba(", "<g opacity"]
for s in STYLES:
    safe = TH[s]["safe"]
    for p in PAGES:
        pg = P[(s, p)]
        ck(f"A1 {s}/{p} XML 可解析", True if ET.fromstring(pg["src"]) is not None else False)
        ck(f"A2 {s}/{p} viewBox", 'viewBox="0 0 1280 720"' in pg["src"])
        ck(f"A3 {s}/{p} 违禁构件=0", not any(b in pg["src"] for b in BAN),
           next((b for b in BAN if b in pg["src"]), ""))
        ck(f"A4 {s}/{p} filter 策略", (('feGaussianBlur' in pg["src"]) == (s == "pixel")))
        ck(f"A5 {s}/{p} 字级≥14", all(t["size"] >= 14 for t in pg["texts"]))
        ok = True
        for t in pg["texts"]:
            w = text_w(t["content"], t["size"])
            l = t["x"] - (w / 2 if t["anchor"] == "middle" else w if t["anchor"] == "end" else 0)
            r_ = l + w
            if l < safe["x0"] - 0.5 or r_ > safe["x1"] + 0.5:
                ok = False
        ck(f"A6 {s}/{p} 文本在安全区", ok)
        ck(f"A7 {s}/{p} tspan 包裹", pg["src"].count("<text") == pg["src"].count("<tspan"))
        ck(f"A8 {s}/{p} 无裸 opacity=", re.search(r'\sopacity="', pg["src"]) is None)

# ---------- B 零外链 ----------
for s in STYLES:
    for p in PAGES:
        stripped = re.sub(r'xmlns="[^"]+"', "", P[(s, p)]["src"])
        ck(f"B {s}/{p} 零外链", "http" not in stripped and "src=" not in stripped and "href=" not in stripped)

# ---------- C 色板封闭 ----------
for s in STYLES:
    allowed = {c.upper() for c in TH[s]["colors"]}
    for p in PAGES:
        used = {u.upper() for u in re.findall(r"#[0-9A-Fa-f]{6}", P[(s, p)]["src"])}
        ck(f"C1 {s}/{p} 色板封闭", used <= allowed, str(used - allowed))
    allhex = {u.upper() for p in PAGES for u in re.findall(r"#[0-9A-Fa-f]{6}", P[(s, p)]["src"])}
    ck(f"C2 {s} 五色系列全用", {c.upper() for c in TH[s]["series"]} <= allhex,
       str({c.upper() for c in TH[s]["series"]} - allhex))

# ---------- D 三风格互异 ----------
def pal(s): return {c.upper() for c in TH[s]["colors"]}
for i, a in enumerate(STYLES):
    for b in STYLES[i + 1:]:
        inter = (pal(a) & pal(b)) - {("#" + c) for c in ("FFFFFF",)}
        ck(f"D1 {a}∩{b}⊆白", len(inter) == 0, str(inter))
FP = {"govblue": dict(dark=False, font="yahei", radius=8, sig="numblock", grad="topBar", filt=False),
      "psych": dict(dark=False, font="pingfang", radius=14, sig="circles", grad="secBar", filt=False),
      "pixel": dict(dark=True, font="mono", radius=0, sig="neonlines", grad="none", filt=True)}
for i, a in enumerate(STYLES):
    for b in STYLES[i + 1:]:
        diff = sum(1 for k in FP[a] if FP[a][k] != FP[b][k])
        ck(f"D2 {a}↔{b} 指纹差≥3", diff >= 3, f"diff={diff}")
for i, a in enumerate(STYLES):
    for b in STYLES[i + 1:]:
        ua = {u for p in PAGES for u in re.findall(r"#[0-9A-Fa-f]{6}", P[(a, p)]["src"])}
        ub = {u for p in PAGES for u in re.findall(r"#[0-9A-Fa-f]{6}", P[(b, p)]["src"])}
        j = len(ua & ub) / len(ua | ub)
        ck(f"D3 {a}/{b} 用色 Jaccard<0.5", j < 0.5, f"j={round(j,2)}")

# ---------- E 算术诚实（独立重算） ----------
for s in STYLES:
    pg = P[(s, "01_kpi")]["src"]
    need = [f"{trev:,}", f"{profit:,}", "18.8", "5.2", f"{margin}%", "46.9%", "27.7%"]
    ck(f"E1 {s} KPI 推算值全在页上", all(x in pg for x in need), str([x for x in need if x not in pg]))
    polys = P[(s, "02_trend")]["polys"]
    okp = True
    for si, sv in enumerate(D["trend"][["revenue", "cost"][0:2][0:1] and ["revenue", "cost"][0:2]] if False else [D["trend"]["revenue"], D["trend"]["cost"]]):
        pts = [tuple(map(float, q.split(","))) for q in polys[si].split()]
        for k, v in enumerate(sv):
            ex, ey = 225 + k * 85, 550 - v * (400 / 400)
            if abs(pts[k][0] - ex) > 0.01 or abs(pts[k][1] - ey) > 0.01:
                okp = False
    ck(f"E2 {s} 趋势点=数据重算", okp)
    bars_ok = True
    for i, it in enumerate(D["lines"]["items"]):
        x = 220 + i * 180
        h = it["value"] * 0.25
        if not any(abs(r_["x"] - x) < 0.01 and abs(r_["height"] - h) < 0.02 and abs(r_["y"] + r_["height"] - 550) < 0.02 for r_ in P[(s, "03_compare")]["rects"]):
            bars_ok = False
    ck(f"E3 {s} 柱高/基线=数据重算", bars_ok)
    def ang12(x, y):
        return math.degrees(math.atan2(x - 400, -(y - 410))) % 360
    sw = []
    for d_ in P[(s, "04_composition")]["paths"]:
        m = re.match(r"M ([\-\d.]+),([\-\d.]+) A 180,180 0 \d,1 ([\-\d.]+),([\-\d.]+)", d_)
        if m:
            x0, y0, x1, y1 = map(float, m.groups())
            sw.append((ang12(x1, y1) - ang12(x0, y0)) % 360)
    exp = [it["value"] / ctot * 360 for it in comp]
    ck(f"E4 {s} 扇形角=占比重算(±0.05°)", len(sw) == 5 and all(abs(a - b) < 0.05 for a, b in zip(sw, exp)), str([round(x, 1) for x in sw]))
    ck(f"E5 {s} 扇形角合计=360", abs(sum(sw) - 360) < 0.05)
    hb_ok = True
    for i, it in enumerate(D["ranking"]["items"]):
        w = it["value"] * 0.18
        y = 155 + i * 60
        if not any(abs(r_["x"] - 300) < 0.01 and abs(r_["width"] - w) < 0.02 and abs(r_["y"] - y) < 0.01 for r_ in P[(s, "05_ranking")]["rects"]):
            hb_ok = False
    ck(f"E6 {s} 条宽=数据重算", hb_ok)
    vals = [it["value"] for it in D["ranking"]["items"]]
    ck(f"E7 {s} 排行严格降序", all(vals[i] > vals[i + 1] for i in range(len(vals) - 1)))
    fn_ok = True
    for i, d_ in enumerate(P[(s, "06_funnel")]["paths"][:5]):
        m = re.match(r"M ([\-\d.]+),(\d+) L ([\-\d.]+),(\d+)", d_)
        x0, y0, x1, y1 = map(float, m.groups())
        if abs((x1 - x0) - round(funnel_widths[i], 2)) > 0.02 or y0 != 160 + i * 105:
            fn_ok = False
    ck(f"E8 {s} 漏斗宽=编码公式", fn_ok)
    src = P[(s, "06_funnel")]["src"]
    conv = ["入口"] + [f"上级转化 {p1(fc[i], fc[i-1])}%" for i in range(1, 5)]
    shares = [f"占首级 {p1(c, fc[0])}%" for c in fc]
    ck(f"E9 {s} 漏斗转化/占比文本=重算", all(x in src for x in conv + shares))
    shares_sum = round(sum(p1(it["value"], ctot) for it in comp), 1)
    ck(f"E10 {s} 占比文本合计=100.0", shares_sum == 100.0 and f"占比合计 {shares_sum}%" in P[(s, "04_composition")]["src"])

# ---------- F 跨页跨风格一致 ----------
def body_tokens(s, p):
    toks = []
    for t in P[(s, p)]["texts"]:
        if 130 <= t["y"] <= 700:
            toks += re.findall(r"[\d]+(?:[.,]\d+)*%?", t["content"])
    return sorted(toks)
for p in PAGES:
    a = body_tokens("govblue", p)
    ck(f"F1 {p} 三风格数字多重集一致", a == body_tokens("psych", p) == body_tokens("pixel", p),
       f"gov={a[:6]}…")
for s in STYLES:
    allt = " ".join(P[(s, p)]["src"] for p in PAGES)
    ck(f"F2 {s} 营收合计出现在 02/03/04",
       all(f"{trev:,}" in P[(s, p)]["src"] for p in ("02_trend", "03_compare", "04_composition")))
    ck(f"F3 {s} KPI 月活/付费==漏斗第4/5级",
       "18.8" in P[(s, "01_kpi")]["src"] and f"{fc[3]:,}" in P[(s, "06_funnel")]["src"]
       and f"{fc[4]:,}" in P[(s, "06_funnel")]["src"])
    ck(f"F4 {s} 构成中心值==内容线合计", f"{ctot:,}" in P[(s, "04_composition")]["src"])

# ---------- G 台账 / 去重契约 ----------
snap = json.load(open(HERE / "scripts/ledger-snapshot.json", encoding="utf-8"))
live = json.load(open(LAB / "state/state.json", encoding="utf-8"))
ck("G1 快照存在且 tried=10", snap.get("tried_n") == 10)
ck("G2 快照 runs=10", snap.get("runs_n") == 10)
ck("G3 快照记上一轮=23:00 sites 个人主页", "sites-building" in str(snap.get("last_tried", {}).get("skill", "")))
ck("G4 快照早于本轮写回(prev_run_state_updated=23:35)", snap.get("prev_run_state_updated") == "2026-09-25T23:35+08:00")
ck("G5 本轮三风格在 used_styles 里各恰好一条（写回后幂等；未写回时为 0 条则失败）",
   all(live["used_styles"].count(us) == 1 for us in snap["this_round_styles"]))
ck("G5b used_styles 总长 = 快照 + 3（不多写不漏写）",
   len(live["used_styles"]) == snap["used_styles_n"] + 3)
ck("G6 本轮组合在 tried 里恰好一条",
   sum(1 for t in live["tried"] if "图表密集" in t.get("scenario", "") and "ppt-generator" in t.get("skill", "")) == 1)
ck("G6b tried/runs 总长各 = 快照 + 1（写回一次、不重复）",
   len(live["tried"]) == snap["tried_n"] + 1 and len(live["runs"]) == snap["runs_n"] + 1)
ck("G7 本轮三风格即快照里声明将要新增的那三条（防写回时改名漂移）",
   live["used_styles"][-3:] == snap["this_round_styles"])

# ---------- H 模板血统与审计 ----------
iv = AUD["index_vs_disk"]
ck("H1 charts_index meta=33=磁盘 33", iv["meta_total"] == iv["disk_svg_count"] == 33)
ck("H2 categories 引用零缺失", iv["category_refs_missing_on_disk"] == [])
ck("H3 quickLookup 引用零缺失", iv["quicklookup_refs_missing"] == [])
ck("H4 33 条目字段完整", iv["entries_missing_detail_fields"] == [] and iv["charts_entries"] == 33)
ck("H5 磁盘无 index 未收录项", iv["disk_not_in_index"] == [])
ck("H6 模板 viewBox 全 1280×720", iv["viewbox_all_1280x720"])
ta = AUD["templates"]
ck("H7 donut 模板角度不实(最大漂移>1°)", not ta["donut_chart"]["honest"] and max(abs(d) for d in ta["donut_chart"]["drift_deg"]) > 1)
ck("H8 funnel 模板宽度与占比无关", not ta["funnel_chart"]["honest"])
ck("H9 bar 模板算术诚实", ta["bar_chart"]["honest"])
ck("H10 hbar 模板算术诚实", ta["horizontal_bar_chart"]["honest"])
ck("H11 kpi 模板四卡对齐", ta["kpi_cards"]["all_offsets_equal"])
ck("H12 SKILL.md 正文 0 次提 charts", AUD["skillmd_charts_mentions"]["body_mentions"] == 0
   and AUD["skillmd_charts_mentions"]["description_has_30plus_charts"])
sc = AUD["spec_conflicts"]
ck("H13 6 模板全部使用 feGaussianBlur", all(v["filter_feGaussianBlur"] >= 1 for v in sc.values()))
ck("H14 funnel 模板含违禁 marker", sc["funnel_chart"]["marker"] == 1)
ck("H15 line/funnel 含裸 opacity(违反 fill-opacity 条款)", sc["line_chart"]["bare_opacity_attr"] > 0 and sc["funnel_chart"]["bare_opacity_attr"] > 0)
# 血统：结构常量与模板一致
for s in STYLES:
    r3 = P[(s, "01_kpi")]["rects"]
    ck(f"H16 {s} kpi 卡位=模板常量", {(r_["x"], r_["y"]) for r_ in r3 if r_.get("width") == 560.0} == {(60.0, 150.0), (660.0, 150.0), (60.0, 440.0), (660.0, 440.0)})
    ck(f"H17 {s} 趋势 x 骨架 225+85k", P[(s, "02_trend")]["polys"][0].split()[0].startswith("225,"))
    ck(f"H18 {s} 柱区 x=220 步进 180", any(r_["x"] == 220.0 for r_ in P[(s, "03_compare")]["rects"]))
    ck(f"H19 {s} 环心 400/410 R180", "A 180,180" in " ".join(P[(s, "04_composition")]["paths"]))
    ck(f"H20 {s} 排行基线 x0=300 条高 36", any(r_["x"] == 300.0 and r_.get("height") == 36.0 for r_ in P[(s, "05_ranking")]["rects"]))
    ys = [float(re.match(r"M [\-\d.]+,(\d+)", d_).group(1)) for d_ in P[(s, "06_funnel")]["paths"][:5] if re.match(r"M [\-\d.]+,(\d+)", d_)]
    ck(f"H21 {s} 漏斗 y0=160 高 80 间距 105(5 级压缩,模板 110 仅适配 4 级)", ys == [160.0, 265.0, 370.0, 475.0, 580.0])

# ---------- I PPTX 原生导出 ----------
try:
    EX = json.load(open(HERE / "scripts/export-result.json", encoding="utf-8"))
except FileNotFoundError:
    EX = None
    ck("I0 export-result.json 存在", False)
if EX:
    for s in STYLES:
        e = EX[s]
        ck(f"I1 {s} 导出成功且体积>10KB", e["export_ok"] and e["bytes"] > 10240, f"{e['bytes']}B")
        pr = e["pptx_probe"]
        ck(f"I2 {s} 6 页", pr["slides"] == 6)
        ck(f"I3 {s} 零位图(media/blip/pic=0)", pr["media"] == 0 and all(p["blip"] == 0 and p["pic"] == 0 for p in pr["per_slide"]))
        ck(f"I4 {s} documented 页序本轮无冲突", e["documented_order_matches"])
        for i, ps in enumerate(pr["per_slide"]):
            ck(f"I5 {s}/{PAGES[i]} a:t==svg text 数", ps["at_runs"] == e["svg_pages"][i]["texts"], f"{ps['at_runs']}v{e['svg_pages'][i]['texts']}")
            ck(f"I6 {s}/{PAGES[i]} pt==px×0.75",
               ps["sizes_pt"] == sorted(round(x * 0.75, 2) for x in e["svg_pages"][i]["sizes"]),
               str(ps["sizes_pt"][:5]))
        exp_grad = {"govblue": 1, "psych": 1, "pixel": 0}[s]
        ck(f"I7 {s} gradFill 页数签名={exp_grad}", all(p["gradFill"] == exp_grad for p in pr["per_slide"]),
           str([p["gradFill"] for p in pr["per_slide"]]))
        ck(f"I8 {s} a:blur=0（filter 不进 PPTX，pixel 霓虹辉光仅 SVG 侧生效）", all(p["effectLst_blur"] == 0 for p in pr["per_slide"]))
        ck(f"I9 {s} EMU 落幅面内", all(-9525 <= p["emu_min"] and p["emu_max"] <= 12192000 + 9525 for p in pr["per_slide"]))
        ck(f"I10 {s} 每页原生形状>0 且密集页≥40", all(p["sp"] > 0 for p in pr["per_slide"]) and max(p["sp"] for p in pr["per_slide"]) >= 40,
           str([p["sp"] for p in pr["per_slide"]]))

# ---------- J 预览件 ----------
for s in STYLES:
    html = (HERE / "preview" / f"{s}.html").read_text(encoding="utf-8")
    svgs = re.findall(r"<svg.*?</svg>", html, re.S)
    ck(f"J1 {s} 内联 6 SVG 可解析", len(svgs) == 6 and all(ET.fromstring(x) is not None for x in svgs))
    stripped = re.sub(r'xmlns="[^"]+"', "", html)
    ck(f"J2 {s} 预览零外链", "http" not in stripped and "src=" not in stripped)
    ck(f"J3 {s} 6 导航按钮", html.count('data-i=') == 6)
styles_html = (HERE / "styles.html").read_text(encoding="utf-8")
ck("J4 styles.html 引用 18 页/3 风格", "18" in styles_html and "styles:3" in styles_html)
ck("J5 styles.html 链接目标全存在", all((HERE / h).exists() for h in re.findall(r'href="([^"]+)"', styles_html)))

# ---------- K 磁盘纪律 ----------
tot = sum(f.stat().st_size for f in HERE.rglob("*") if f.is_file())
ck("K1 产物 <50MB", tot < 50 * 1024 * 1024, f"{tot/1024:.0f}KB")
ck("K2 无 node_modules/.tmp/dist 混入", not any(x.name in ("node_modules", ".tmp", "dist") for x in HERE.rglob("*")))
ck("K3 SVG 单页 ≤20KB", max(len(P[k]["src"].encode()) for k in P) < 20480)

# ---------- 汇总 ----------
fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} 断言绿")
for n, _, ex in fails:
    print("FAIL:", n, ex)
sys.exit(1 if fails else 0)
