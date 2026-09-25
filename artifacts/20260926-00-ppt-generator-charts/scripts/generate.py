#!/usr/bin/env python3
"""generate.py — 数据驱动图表页生成器（第 11 轮：ppt-generator × 图表密集分析页）

图表骨架（坐标系/间距/条宽/圆心半径）取自 ppt-generator templates/charts/*.svg 的结构常量，
颜色/字体/字级/安全区取自各风格 design_spec.md（经 themes.json 固化），数值与几何一律由本脚本
从 data.json 计算 —— 不允许任何手画的「凭印象坐标」。
"""
import json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
D = json.load(open(HERE / "data.json", encoding="utf-8"))
TH = json.load(open(HERE / "themes.json", encoding="utf-8"))

# ---------- 模板骨架常量（H 组断言与 templates/charts/*.svg 互查，同源抄录于此） ----------
TPL = {
    "bar":     {"axis": [140, 1160, 150, 550], "grid_step": 100, "bar_w": 50, "pitch": 180, "x0": 220},
    "line":    {"axis": [140, 1160, 150, 550], "x0": 225, "pitch": 85, "dot_r": 5},
    "donut":   {"cx": 400, "cy": 410, "R": 180, "r": 100},
    "hbar":    {"x0": 300, "x1": 1200, "top": 140, "bottom": 620, "grid_step": 180,
                "bar_h": 36, "pitch": 60, "y0": 155, "label_x": 290},
    "funnel":  {"cx": 640, "h": 80, "y0": 160, "pitch": 105, "pitch_note": 110},
    "kpi":     {"cards": [(60, 150, 560, 250), (660, 150, 560, 250), (60, 440, 560, 250), (660, 440, 560, 250)],
                "pad_x": 40, "indicator": [16, 20, 8, 70]},
}

# ---------- 工具 ----------
def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def r2(v):
    s = round(v + 0.0, 2)
    return int(s) if abs(s - round(s)) < 1e-9 else s

def fnum(v):
    return f"{v:,}"

def pct1(a, b):
    return round(a / b * 100, 1)

def text_w(s, size):
    w = 0.0
    for ch in str(s):
        w += size * (1.0 if ord(ch) > 0x2E7F else 0.58)
    return w

# ---------- SVG 基本件 ----------
def T(x, y, size, fill, content, *, anchor="start", weight=None, font="body",
      opacity=None, fam=None):
    a = [f'x="{r2(x)}"', f'y="{r2(y)}"', f'font-size="{size}"', f'fill="{fill}"']
    if anchor != "start":
        a.append(f'text-anchor="{anchor}"')
    if weight:
        a.append(f'font-weight="{weight}"')
    if opacity is not None:
        a.append(f'fill-opacity="{r2(opacity)}"')
    family = fam or ""
    if family:
        a.append(f'font-family="{family}"')
    inner = "".join(f'<tspan x="{r2(x)}" dy="{d}">{esc(c)}</tspan>'
                    for c, d in [(content, 0)])
    return f"<text {' '.join(a)}>{inner}</text>"

class Page:
    def __init__(self, th):
        self.th = th
        self.body = []
    def add(self, s):
        self.body.append(s)
    # 便捷：按风格主体/标题字体
    def t(self, x, y, size, fill, content, *, font="body", **kw):
        fam = self.th["font_title"] if font == "title" else self.th["font_body"]
        return T(x, y, size, fill, content, fam=fam, **kw)
    def rect(self, x, y, w, h, fill, *, rx=0, stroke=None, sw=1, opacity=None):
        a = [f'x="{r2(x)}"', f'y="{r2(y)}"', f'width="{r2(w)}"', f'height="{r2(h)}"', f'fill="{fill}"']
        if rx:
            a.append(f'rx="{rx}"')
        if stroke:
            a.append(f'stroke="{stroke}" stroke-width="{sw}"')
        if opacity is not None:
            a.append(f'fill-opacity="{r2(opacity)}"')
        return f'<rect {" ".join(a)}/>'

def render(th, defs, body, page_no, title):
    head = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">']
    if defs:
        head.append(f"<defs>{defs}</defs>")
    head.append(TPL_NOTE)
    head.extend(body)
    head.append(f"</svg>")
    return "\n".join(head)

TPL_NOTE = '<!-- skeleton from ppt-generator/templates/charts (structure constants in generate.py TPL) -->'

# ---------- 页头 / 页脚（三种风格的签名构件） ----------
def header(th, key, idx, zh, en, sub):
    P = Page(th)
    bg = P.rect(0, 0, 1280, 720, th["background"])
    P.add(bg)
    R, S = th["roles"], th["sizes"]
    defs = ""
    if key == "govblue":
        defs = ('<linearGradient id="topBar" x1="0%" y1="0%" x2="100%" y2="0%">'
                '<stop offset="0%" style="stop-color:#00B4D8;stop-opacity:1"/>'
                '<stop offset="100%" style="stop-color:#0050B3;stop-opacity:1"/></linearGradient>')
        P.add('<rect x="0" y="0" width="1280" height="6" fill="url(#topBar)"/>')
        P.add(P.rect(60, 30, 50, 50, R["block"]))
        P.add(P.t(85, 63, 24, R["on_dark"], f"{idx:02d}", anchor="middle", weight="bold", font="title"))
        P.add(P.t(130, 62, S["h2"], R["title"], zh, weight="bold", font="title"))
        P.add(P.t(130, 84, S["sub"], R["muted"], sub))
        P.add(P.t(1220, 62, S["sub"], R["muted"], D["product"]["name_zh"] + " · " + D["product"]["period"], anchor="end"))
    elif key == "psych":
        defs = ('<linearGradient id="secBar" x1="0%" y1="0%" x2="100%" y2="0%">'
                '<stop offset="0%" style="stop-color:#1E3A5F;stop-opacity:1"/>'
                '<stop offset="100%" style="stop-color:#3D8B7A;stop-opacity:1"/></linearGradient>')
        for cxx, rr, so in [(1200, 44, 0.15), (1200, 28, 0.25), (1200, 12, 0.35)]:
            P.add(f'<circle cx="{cxx}" cy="70" r="{rr}" fill="none" stroke="{R["english"]}" stroke-opacity="{so}" stroke-width="1.5"/>')
        P.add(P.t(40, 95, S["h2"], R["title"], zh, weight="bold", font="title"))
        P.add(P.t(40, 116, S["sub"], R["english"], en))
        P.add('<rect x="40" y="126" width="64" height="4" fill="url(#secBar)"/>')
        P.add(P.t(1240, 95, S["sub"], R["muted"], sub, anchor="end"))
    else:  # pixel
        defs = ('<filter id="glowGreen" x="-50%" y="-50%" width="200%" height="200%">'
                '<feGaussianBlur stdDeviation="3" result="blur"/>'
                '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>')
        P.add(P.rect(0, 0, 1280, 4, R["neon"]))
        P.add(P.rect(0, 6, 1280, 2, R["neon"], opacity=0.35))
        tt = P.t(60, 64, S["h2"], R["title"], en, weight="bold", font="title")
        P.add(tt.replace("<text ", '<text filter="url(#glowGreen)" ', 1))
        P.add(P.t(60, 90, S["sub"], R["muted"], zh + " · " + sub))
        for dx, ss, oo in [(1198, 10, 1), (1214, 8, 0.6), (1230, 6, 0.3)]:
            P.add(P.rect(dx, 20, ss, ss, R["neon"], opacity=oo))
    return defs, "\n".join(P.body)

def footer(th, key, idx):
    P = Page(th)
    R, S = th["roles"], th["sizes"]
    note = D["product"]["footer_note"]
    if key == "govblue":
        P.add(P.rect(0, 716, 1280, 4, R["block"]))
        P.add(P.t(60, 692, S["sub"], R["muted"], note))
        P.add(P.t(1220, 692, S["sub"], R["muted"], f"{idx:02d} / 06", anchor="end"))
    elif key == "psych":
        P.add(P.t(40, 668, S["sub"], R["english"], note))
        P.add(P.t(1240, 668, S["sub"], R["muted"], f"{idx:02d} / 06", anchor="end"))
    else:
        P.add(P.rect(0, 712, 1280, 2, R["neon"], opacity=0.35))
        P.add(P.rect(0, 716, 1280, 4, R["neon"]))
        P.add(P.t(60, 692, S["sub"], R["muted"], note))
        P.add(P.t(1220, 692, S["sub"], R["muted"], f"{idx:02d} / 06", anchor="end"))
    return "\n".join(P.body)

# ---------- 六类图表（几何全部现算） ----------
def grid_axes(th, P, y_max, y_step, x0=140, x1=1160, ya=150, yb=550, unit=""):
    R, S = th["roles"], th["sizes"]
    scale = (yb - ya) / y_max
    for k in range(0, int(y_max / y_step) + 1):
        v = k * y_step
        y = yb - v * scale
        if v > 0:
            P.add(f'<line x1="{x0}" y1="{r2(y)}" x2="{x1}" y2="{r2(y)}" stroke="{R["grid"]}" stroke-width="1" stroke-dasharray="4,4"/>')
        P.add(P.t(x0 - 15, y + 5, S["sub"], R["muted"], fnum(v), anchor="end"))
    P.add(f'<line x1="{x0}" y1="{ya}" x2="{x0}" y2="{yb}" stroke="{R["axis"]}" stroke-width="2"/>')
    P.add(f'<line x1="{x0}" y1="{yb}" x2="{x1}" y2="{yb}" stroke="{R["axis"]}" stroke-width="2"/>')
    return scale

def chart_kpi(th, key):
    P = Page(th)
    trev, tcost = sum(D["trend"]["revenue"]), sum(D["trend"]["cost"])
    profit = trev - tcost
    margin = pct1(profit, trev)
    f = D["funnel"]["stages"]
    rate_mau = pct1(f[3]["count"], f[2]["count"])
    rate_subs = pct1(f[4]["count"], f[3]["count"])
    vals = {"revenue": fnum(trev), "profit": fnum(profit),
            "mau": str(round(f[3]["count"] / 10000, 1)), "subs": str(round(f[4]["count"] / 10000, 1))}
    subs = {"revenue": margin and f"利润率 {margin}% · 12 个月合计", "profit": f"营收 {fnum(trev)} − 成本 {fnum(tcost)}",
            "mau": f"{fnum(f[3]['count'])} 人", "subs": f"{fnum(f[4]['count'])} 人"}
    eng = {"revenue": "ANNUAL REVENUE", "profit": "NET PROFIT", "mau": "MONTHLY ACTIVE", "subs": "PAID SUBSCRIBERS"}
    fills = {"up": th["roles"]["good"], "down": th["roles"]["bad"], "flat": th["roles"]["flat"]}
    R, S = th["roles"], th["sizes"]
    for i, card in enumerate(D["kpi"]["given"]):
        x, y, w, h = TPL["kpi"]["cards"][i]
        tx = x + TPL["kpi"]["pad_x"]
        P.add(P.rect(x, y, w, h, "#FFFFFF" if key != "pixel" else R["card"], rx=th["radius"],
                     stroke=R["card_stroke"]))
        ind = TPL["kpi"]["indicator"]
        P.add(P.rect(x + ind[0], y + ind[1], ind[2], ind[3], TH["card_slot"][card["key"]][key], rx=0 if key == "pixel" else 4))
        P.add(P.t(tx, y + 40, S["body"], R["title"], card["label_zh"], weight="600"))
        P.add(P.t(tx, y + 63, S["sub"], R["muted"], eng[card["key"]]))
        val = (card.get("value_prefix", "") + vals[card["key"]])
        P.add(P.t(tx, y + 135, S["data"], R["title"], val, weight="bold"))
        ux = tx + text_w(val, S["data"]) + 8
        if card.get("value_suffix"):
            P.add(P.t(ux, y + 135, S["h3"], R["body"], card["value_suffix"]))
        P.add(P.t(tx, y + 199 - 22, S["sub"], R["muted"], subs[card["key"]]))
        dt = (card["delta_text"].replace("{margin}", str(margin))
              .replace("{rate_mau}", str(rate_mau)).replace("{rate_subs}", str(rate_subs)))
        tri = {"up": f"M {tx},{y + 186} l 6,-9 l 6,9 Z", "down": f"M {tx},{y + 177} l 6,9 l 6,-9 Z"}.get(card["delta_kind"])
        if tri:
            P.add(f'<path d="{tri}" fill="{fills[card["delta_kind"]]}"/>')
            P.add(P.t(tx + 18, y + 186, 16, fills[card["delta_kind"]], dt))
        else:
            P.add(P.rect(tx, y + 178, 12, 6, fills["flat"]))
            P.add(P.t(tx + 18, y + 186, 16, fills["flat"], dt))
        P.add(P.t(tx, y + 224, S["sub"], R["muted"], card["note"]))
    return P.body

def chart_trend(th, key):
    P = Page(th)
    C = TPL["line"]
    trev, tcost = sum(D["trend"]["revenue"]), sum(D["trend"]["cost"])
    scale = grid_axes(th, P, D["trend"]["y_max"], D["trend"]["y_step"])
    R, S = th["roles"], th["sizes"]
    for k, m in enumerate(D["trend"]["months"]):
        x = C["x0"] + k * C["pitch"]
        P.add(P.t(x, 580, S["sub"], R["muted"], m, anchor="middle"))
    series = [D["trend"]["revenue"], D["trend"]["cost"]]
    for si, sv in enumerate(series):
        color = th["series"][si]
        pts = [(C["x0"] + k * C["pitch"], 550 - v * scale) for k, v in enumerate(sv)]
        P.add(f'<polyline points="{" ".join(f"{r2(x)},{r2(y)}" for x, y in pts)}" '
              f'fill="none" stroke="{color}" stroke-width="3"/>')
        for x, y in pts:
            P.add(f'<circle cx="{r2(x)}" cy="{r2(y)}" r="{C["dot_r"]}" fill="{color}"/>')
    last = pts[-1]
    P.add(P.t(last[0] - 8, last[1] - 12, 16, R["title"], fnum(sv[-1]), anchor="end", weight="600"))
    for si, name in enumerate(D["trend"]["series_names"]):
        lx = 950 + si * 110
        P.add(P.rect(lx, 122, 14, 14, th["series"][si], rx=0 if key == "pixel" else 3))
        P.add(P.t(lx + 22, 134, 16, R["body"], name))
    P.add(P.t(140, 630, S["sub"], R["muted"],
              f"利润 = 营收合计 {fnum(trev)} − 成本合计 {fnum(tcost)} = {fnum(trev - tcost)}（万元）"))
    return P.body

def chart_compare(th, key):
    P = Page(th)
    C = TPL["bar"]
    items = D["lines"]["items"]
    scale = grid_axes(th, P, D["lines"]["y_max"], D["lines"]["y_step"])
    R, S = th["roles"], th["sizes"]
    for i, it in enumerate(items):
        x = C["x0"] + i * C["pitch"]
        h = it["value"] * scale
        P.add(P.rect(x, 550 - h, C["bar_w"], h, th["series"][i % len(th["series"])], rx=4 if key != "pixel" else 0))
        P.add(P.t(x + C["bar_w"] / 2, 550 - h - 14, 16, R["title"], fnum(it["value"]), anchor="middle", weight="600"))
        P.add(P.t(x + C["bar_w"] / 2, 580, 16, R["body"], it["label"], anchor="middle"))
    tot = sum(it["value"] for it in items)
    P.add(P.t(140, 630, S["sub"], R["muted"], f"五条内容线合计 {fnum(tot)} 万元 · 单位：万元"))
    return P.body

def chart_composition(th, key):
    P = Page(th)
    C = TPL["donut"]
    items = D["lines"]["items"]
    tot = D["composition"]["center_value"]
    assert tot == sum(it["value"] for it in items)
    R, S = th["roles"], th["sizes"]
    ang = 0.0
    segs = []
    for i, it in enumerate(items):
        sweep = it["value"] / tot * 360
        a0, a1 = ang, ang + sweep
        ang = a1
        def pt(rr, aa):
            t = math.radians(aa)
            return (C["cx"] + rr * math.sin(t), C["cy"] - rr * math.cos(t))
        x0, y0 = pt(C["R"], a0); x1, y1 = pt(C["R"], a1)
        ix0, iy0 = pt(C["r"], a0); ix1, iy1 = pt(C["r"], a1)
        large = 1 if sweep > 180 else 0
        d = (f"M {r2(x0)},{r2(y0)} A {C['R']},{C['R']} 0 {large},1 {r2(x1)},{r2(y1)} "
             f"L {r2(ix1)},{r2(iy1)} A {C['r']},{C['r']} 0 {large},0 {r2(ix0)},{r2(iy0)} Z")
        P.add(f'<path d="{d}" fill="{th["series"][i]}"/>')
        segs.append((a0, a1, it))
    P.add(f'<circle cx="{C["cx"]}" cy="{C["cy"]}" r="{C["r"]}" fill="{th["background"]}"/>')
    P.add(P.t(C["cx"], C["cy"] - 8, S["data"], R["title"], fnum(tot), anchor="middle", weight="bold"))
    P.add(P.t(C["cx"], C["cy"] + 22, S["sub"], R["muted"], D["composition"]["center_label"] + "（万元）", anchor="middle"))
    for i, (a0, a1, it) in enumerate(segs):
        ly = 200 + i * 70
        P.add(P.rect(720, ly - 14, 18, 18, th["series"][i], rx=0 if key == "pixel" else 4))
        share = pct1(it["value"], tot)
        P.add(P.t(750, ly, 18, R["title"], it["label"], weight="600"))
        P.add(P.t(750, ly + 24, 16, R["muted"], f"{share}% · {fnum(it['value'])} 万元 · 扇形 {round(it['value']/tot*360,1)}°"))
    ps = sum(pct1(it["value"], tot) for it in items)
    P.add(P.t(720, 570, S["sub"], R["muted"], f"占比合计 {round(ps,1)}% · 角度合计 {round(ang,1)}°"))
    return P.body

def chart_ranking(th, key):
    P = Page(th)
    C = TPL["hbar"]
    items = D["ranking"]["items"]
    scale = (C["x1"] - C["x0"]) / D["ranking"]["x_max"]
    R, S = th["roles"], th["sizes"]
    for k in range(0, int(D["ranking"]["x_max"] / D["ranking"]["x_step"]) + 1):
        v = k * D["ranking"]["x_step"]
        x = C["x0"] + v * scale
        if v > 0:
            P.add(f'<line x1="{r2(x)}" y1="{C["top"]}" x2="{r2(x)}" y2="{C["bottom"]}" stroke="{R["grid"]}" stroke-width="1" stroke-dasharray="4,4"/>')
        P.add(P.t(x, 650, S["sub"], R["muted"], fnum(v), anchor="middle"))
    P.add(f'<line x1="{C["x0"]}" y1="{C["top"]}" x2="{C["x0"]}" y2="{C["bottom"]}" stroke="{R["axis"]}" stroke-width="2"/>')
    P.add(f'<line x1="{C["x0"]}" y1="{C["bottom"]}" x2="{C["x1"]}" y2="{C["bottom"]}" stroke="{R["axis"]}" stroke-width="2"/>')
    prev = None
    for i, it in enumerate(items):
        y = C["y0"] + i * C["pitch"]
        w = it["value"] * scale
        assert prev is None or it["value"] <= prev
        prev = it["value"]
        P.add(P.t(C["label_x"], y + 24, 16, R["body"], it["label"], anchor="end"))
        P.add(P.rect(C["x0"], y, w, C["bar_h"], th["series"][0], rx=4 if key != "pixel" else 0))
        vtxt = fnum(it["value"])
        est_r = C["x0"] + w + 10 + text_w(vtxt, 16)
        if est_r > th["safe"]["x1"]:
            ink = th["background"] if key == "pixel" else "#FFFFFF"
            P.add(P.t(C["x0"] + w - 8, y + 24, 16, ink, vtxt, anchor="end", weight="600"))
        else:
            P.add(P.t(C["x0"] + w + 10, y + 24, 16, R["title"], vtxt, weight="600"))
    P.add(P.t(300, 672 - 8, S["sub"], R["muted"], "单位：万次 · 降序"))
    return P.body

def chart_funnel(th, key):
    P = Page(th)
    C = TPL["funnel"]
    st = D["funnel"]["stages"]
    base, span, vmax = C.get("w_base", 120), 480, 600
    base, span = D["funnel"]["w_base"], D["funnel"]["w_span"]
    R, S = th["roles"], th["sizes"]
    widths = [base + span * s["count"] / st[0]["count"] for s in st]
    ink_dark = {"pixel": {3}}
    for i, s in enumerate(st):
        y = C["y0"] + i * C["pitch"]
        wt, wb = widths[i], widths[i + 1] if i + 1 < len(st) else widths[i]
        d = (f"M {r2(C['cx'] - wt / 2)},{y} L {r2(C['cx'] + wt / 2)},{y} "
             f"L {r2(C['cx'] + wb / 2)},{y + C['h']} L {r2(C['cx'] - wb / 2)},{y + C['h']} Z")
        P.add(f'<path d="{d}" fill="{th["series"][i]}"/>')
        ink = th["background"] if i in ink_dark["pixel"] and key == "pixel" else "#FFFFFF"
        P.add(P.t(C["cx"], y + 34, 20, ink, f"{s['label']} · {fnum(s['count'])} 人", anchor="middle", weight="bold"))
        share = pct1(s["count"], st[0]["count"])
        conv = "入口" if i == 0 else f"上级转化 {pct1(s['count'], st[i-1]['count'])}%"
        P.add(P.t(C["cx"], y + 58, 16, ink, f"占首级 {share}% · {conv}", anchor="middle"))
    P.add(P.t(60, 662, S["sub"], R["muted"],
              f"宽度编码：120 + 480 × 占首级比例（含基线宽度，防末级不可读）· 首→末 {pct1(st[-1]['count'], st[0]['count'])}%"))
    return P.body

CHARTS = {
    "01_kpi": (chart_kpi, "年度核心指标", "KPI OVERVIEW", "四项指标 · 两项由趋势与漏斗数据推算"),
    "02_trend": (chart_trend, "月度营收与成本趋势", "MONTHLY TREND", "单位：万元 · 12 个月"),
    "03_compare": (chart_compare, "各内容线年度营收", "REVENUE BY LINE", "单位：万元 · 五条内容线"),
    "04_composition": (chart_composition, "营收构成占比", "REVENUE MIX", "五项构成 · 角度与占比同源计算"),
    "05_ranking": (chart_ranking, "节目播放量 TOP8", "TOP PROGRAMS", "单位：万次 · 降序"),
    "06_funnel": (chart_funnel, "用户转化漏斗", "CONVERSION FUNNEL", "五级 · 单位：人"),
}

def main():
    out = HERE / "svg"
    for key, th in [(k, TH[k]) for k in ("govblue", "psych", "pixel")]:
        d = out / key
        d.mkdir(parents=True, exist_ok=True)
        for idx, (fname, (fn, zh, en, sub)) in enumerate(CHARTS.items(), 1):
            defs, hbody = header(th, key, idx, zh, en, sub)
            body = fn(th, key)
            fbody = footer(th, key, idx)
            svg = render(th, defs, [hbody] + [b for b in body] + [fbody], idx, zh)
            (d / f"{fname}.svg").write_text(svg, encoding="utf-8")
            print(f"{key}/{fname}.svg {len(svg.encode('utf-8'))}B")

if __name__ == "__main__":
    main()
