#!/usr/bin/env python3
"""generate.py — 第 12 轮：ppt-generator × 中文商务提案（consultant / government_red / 科技蓝商务）。
规范来源全部现读：scripts/spec-audit.json（由 spec_probe.py 从 design_spec.md 与模板 SVG 解析）。
色板 = spec 色板 ∪ 模板色板（22:00 规则）；字号取 spec 字级表；结构常量取 spec∪模板实测值。
所有编码几何（KPI 网格、条形长、甘特段、付款分段）一律从 data.json 现算。
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
D = json.load(open(HERE / "data.json", encoding="utf-8"))
AUD = json.load(open(HERE / "scripts" / "spec-audit.json", encoding="utf-8"))

STYLES = ["consultant", "government_red", "tech_blue"]   # tech_blue = 磁盘目录「科技蓝商务」
DIR_OF = {"consultant": "consultant", "government_red": "government_red", "tech_blue": "科技蓝商务"}

def spec(dstyle):
    e = AUD["styles"][DIR_OF[dstyle]]
    role2hex = {}
    for hexv, roles in e["spec_roles"].items():
        for r in roles:
            role2hex[r] = hexv
    return e, role2hex

def theme(style):
    e, R = spec(style)
    C = lambda role: R[role]
    if style == "consultant":
        return {
            "font": e["spec_font_stack"], "palette": set(e["spec_hex_all"]) | set(e["template_hex_all"]),
            "sz": {"h1": 52, "h2": 36, "h3": 22, "h4": 16, "p": 14, "data": 44, "sub": 12},
            "ink": C("Title Dark Gray"), "body": C("Body Gray"), "aux": C("Auxiliary Gray"),
            "accent": C("Consultant Blue"), "accent2": C("Deep Teal"), "info": C("Info Blue"),
            "hi": C("Data Highlight"), "warn": C("Warning/Issue"), "ok": C("Success/Positive"),
            "line": C("Light Gray Background"), "bg": "#FFFFFF",
            "series": [C("Consultant Blue"), C("Info Blue"), "#4A90A4", C("Data Highlight"), C("Warning/Issue")],
            "panel": C("Light Gray Background"),
            "area": (60, 120, 1220, 640), "topbar": 4, "cover_dark": False, "rx": 4, "dash": None,
        }
    if style == "government_red":
        return {
            "font": e["spec_font_stack"], "palette": set(e["spec_hex_all"]) | set(e["template_hex_all"]),
            "sz": {"h1": 48, "h2": 28, "h3": 24, "p": 18, "data": 36, "sub": 14},
            "ink": C("Primary Text"), "body": C("Secondary Text"), "aux": C("Light Auxiliary"),
            "accent": C("Government Red"), "accent2": C("Government Blue"), "gold": C("Gold Accent"),
            "warn": C("Warning"), "ok": C("Success"), "info": C("Info"),
            "line": C("Border Gray"), "panel": C("Auxiliary Light Gray"), "bg": "#FFFFFF",
            "series": [C("Government Red"), C("Government Blue"), C("Gold Accent"), C("Info"), C("Success")],
            "area": (60, 100, 1220, 660), "topbar": 6, "bottombar": 4, "cover_dark": True, "rx": 8, "dash": None,
            "cover_from": "#003366", "cover_to": "#001A33",   # 后者来自模板 01_cover.svg 实测
        }
    return {  # tech_blue（科技蓝商务）
        "font": e["spec_font_stack"], "palette": set(e["spec_hex_all"]) | set(e["template_hex_all"]),
        "sz": {"h1": 64, "h2": 36, "h3": 24, "p": 20, "data": 36, "sub": 14},
        "ink": C("Body Text Black"), "body": C("Body Text Black"), "aux": C("Caption Gray"),
        "accent": C("Primary Blue"), "accent2": C("Dark Blue"), "cyan": C("Accent Cyan"),
        "warn": C("Alert Red"), "line": C("Border Gray"), "panel": C("Light Gray BG"), "bg": "#FFFFFF",
        "series": [C("Primary Blue"), C("Dark Blue"), C("Accent Cyan"), C("Border Gray"), C("Caption Gray")],
        "area": (80, 170, 1200, 630), "topbar": 0, "cover_dark": True, "rx": 10, "dash": "8,8",
        "cover_from": "#0078D7", "cover_to": "#002E5D",
    }

T = {s: theme(s) for s in STYLES}

# ---------- SVG 基础 ----------
class Doc:
    def __init__(self, t):
        self.t = t
        self.body = []
        self.defs = []
        self.grad_n = 0

    def grad(self, c1, c2, vertical=False):
        self.grad_n += 1
        gid = f"g{self.grad_n}"
        x2, y2 = ("0", "1") if vertical else ("1", "0")
        self.defs.append(
            f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>')
        return f"url(#{gid})"

    def rect(self, x, y, w, h, fill, rx=0, stroke=None, sw=0, dash=None, op=None, sop=None):
        a = f'x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"'
        if rx: a += f' rx="{rx}"'
        if stroke: a += f' stroke="{stroke}" stroke-width="{sw}"'
        if dash: a += f' stroke-dasharray="{dash}"'
        if op is not None: a += f' fill-opacity="{op}"'
        if sop is not None: a += f' stroke-opacity="{sop}"'
        self.body.append(f'<rect {a}/>')

    def line(self, x1, y1, x2, y2, stroke, sw=1, dash=None, op=None):
        a = f'x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"'
        if dash: a += f' stroke-dasharray="{dash}"'
        if op is not None: a += f' stroke-opacity="{op}"'
        self.body.append(f'<line {a}/>')

    def text(self, x, y, size, fill, s, anchor="start", weight="", family=None, op=None, spacing=None):
        f = (family or self.t["font"]).replace('"', "'")
        a = f'x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-family="{f}"'
        if anchor != "start": a += f' text-anchor="{anchor}"'
        if weight: a += f' font-weight="{weight}"'
        if spacing: a += f' letter-spacing="{spacing}"'
        if op is not None: a += f' fill-opacity="{op}"'
        e = str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        self.body.append(f'<text {a}>{e}</text>')

    def poly(self, pts, fill, op=None, stroke=None, sw=0, sop=None):
        a = f'points="{" ".join(f"{x},{y}" for x, y in pts)}" fill="{fill}"'
        if op is not None: a += f' fill-opacity="{op}"'
        if stroke: a += f' stroke="{stroke}" stroke-width="{sw}"'
        if sop is not None: a += f' stroke-opacity="{sop}"'
        self.body.append(f'<polygon {a}/>')

    def path(self, d, fill="none", op=None, stroke=None, sw=0, sop=None):
        a = f'd="{d}" fill="{fill}"'
        if op is not None: a += f' fill-opacity="{op}"'
        if stroke: a += f' stroke="{stroke}" stroke-width="{sw}"'
        if sop is not None: a += f' stroke-opacity="{sop}"'
        self.body.append(f'<path {a}/>')

    def save(self, style, page):
        head = f'<defs>{"".join(self.defs)}</defs>' if self.defs else ""
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">'
               f'{head}{"".join(self.body)}</svg>')
        out = HERE / "svg" / style
        out.mkdir(exist_ok=True)
        (out / f"{page}.svg").write_text(svg, encoding="utf-8")
        return len(svg.encode("utf-8"))

P = D["project"]

# ---------- 通用构件（按风格皮肤分支） ----------
def base(d, t, dark=False):
    d.rect(0, 0, 1280, 720, t["bg"] if not dark else "#FFFFFF")

def chrome_top(d, t):
    """内容页导航：consultant 4px 蓝条；gov 6px 红蓝渐变条 + 底部 4px 红条；techblue 10×40 蓝块前缀"""
    if t is T["consultant"]:
        d.rect(0, 0, 1280, t["topbar"], t["accent"])
    elif t is T["government_red"]:
        g = d.grad(t["accent"], t["accent2"])
        d.rect(0, 0, 1280, 6, g)
        d.rect(0, 716, 1280, 4, t["accent"])
    else:
        d.rect(40, 40, 10, 40, t["accent"])
        d.line(62, 60, 420, 60, t["line"], 1)

def title(d, t, x, y, txt, takeaway="", no="03"):
    if t is T["consultant"]:
        d.text(x, y + 26, t["sz"]["h2"], t["ink"], txt, weight="bold")
        if takeaway:
            d.text(x, y + 56, t["sz"]["h3"], t["body"], takeaway)
    elif t is T["government_red"]:
        d.rect(x, y, 50, 50, t["accent"])                       # spec：节号红方块 50×50
        d.text(x + 25, y + 34, 24, "#FFFFFF", no, anchor="middle", weight="bold")
        d.text(x + 70, y + 36, t["sz"]["h2"], t["ink"], txt, weight="bold")
        if takeaway:
            d.text(x + 70, y + 66, 18, t["aux"], takeaway)
    else:
        d.text(62, 92, t["sz"]["h2"], t["ink"], txt, weight="bold")
        if takeaway:
            d.text(62, 120, t["sz"]["sub"] + 2, t["aux"], takeaway)

def footer(d, t, n):
    x0, _, x1, _ = t["area"]
    d.text(x0, 696, t["sz"]["sub"], t["aux"], f"{n:02d}")
    d.text(x1, 696, t["sz"]["sub"], t["aux"], f'{P["vendor_short"]} · {P["secret"]}', anchor="end")

def card(d, t, x, y, w, h, dashed=False):
    if t is T["tech_blue"]:
        d.rect(x, y, w, h, t["bg"], rx=t["rx"], stroke=t["line"], sw=2, dash=t["dash"] if dashed else None)
    elif t is T["government_red"]:
        d.rect(x, y, w, h, t["panel"], rx=t["rx"])
    else:
        d.rect(x, y, w, h, t["bg"], rx=t["rx"], stroke=t["line"], sw=2)

def outer(d, t):
    """科技蓝商务内容页默认件：圆角虚线大容器（spec §VIII 示例：x60 y140 w1160 h500 dash 8,8 rx10）"""
    if t is T["tech_blue"]:
        d.rect(60, 140, 1160, 500, "none", rx=t["rx"], stroke=t["line"], sw=2, dash=t["dash"])

# ---------- P1 封面 ----------
def cover(style):
    t = T[style]; d = Doc(t)
    if t["cover_dark"]:
        g = d.grad(t["cover_from"], t["cover_to"], vertical=True)
        d.rect(0, 0, 1280, 720, g)
    else:
        base(d, t)
    if style == "consultant":
        d.rect(0, 0, 1280, t["topbar"], t["accent"])
        d.rect(60, 250, 8, 240, t["accent"])
        for pts, op in [([(1040, 120), (1280, 120), (1280, 360)], .05), ([(960, 560), (1220, 420), (1220, 660)], .08)]:
            d.poly(pts, t["accent"], op=op)
        d.line(1080, 500, 1220, 500, t["accent2"], 2)
        d.text(96, 320, t["sz"]["h1"], t["ink"], P["name"], weight="bold")
        d.text(96, 372, t["sz"]["h3"], t["body"], P["subtitle"])
        d.text(60, 600, t["sz"]["p"], t["aux"], f'致：{P["client"]}')
        d.text(60, 626, t["sz"]["p"], t["aux"], f'{P["vendor"]} · {P["date"]}')
        d.text(60, 652, t["sz"]["sub"], t["aux"], f'方案编号 {P["code"]}')
        d.text(1220, 692, t["sz"]["sub"], t["warn"], P["secret"], anchor="end")
    elif style == "government_red":
        g = d.grad(t["accent"], t["accent2"])
        d.rect(0, 0, 1280, 6, g)
        d.rect(0, 714, 1280, 6, t["gold"])
        d.line(580, 388, 700, 388, t["gold"], 2)
        d.text(640, 300, t["sz"]["h1"], "#FFFFFF", P["name"], anchor="middle", weight="bold")
        d.text(640, 352, t["sz"]["h3"], t["gold"], P["subtitle"], anchor="middle")
        d.text(640, 452, 18, "#F5F7FA", f'致：{P["client"]}', anchor="middle")
        d.text(640, 484, 18, "#F5F7FA", f'{P["vendor"]}', anchor="middle")
        d.text(640, 516, 14, "#CBD5E1", f'{P["date"]} · 方案编号 {P["code"]}', anchor="middle")
        d.text(640, 660, 14, t["gold"], P["secret"], anchor="middle")
    else:  # tech_blue：深蓝渐变 + 底部双层波浪 + 六环装饰
        for pts, fill, op in [
            ((640, 520, 1280, 200), t["cyan"], .18), ((0, 600, 1280, 120), t["accent2"], .55)]:
            x, y, w, h = pts
            d.path(f"M{x} {y+h} Q{x+w*0.25} {y+h*0.2} {x+w*0.5} {y+h*0.6} T{x+w} {y+h*0.35} L{x+w} {y+h} Z", fill, op=op)
        for cx, cy, r, op in [(1120, 170, 60, .5), (1120, 170, 92, .28), (1010, 250, 26, .4)]:
            pts = [(cx + r * (1 if a == 0 else (-1 if a == 180 else 0.5 if a in (60, 300) else -0.5)),
                    cy + (0 if a in (0, 180) else (r * 0.87 if a in (240, 300) else -r * 0.87)))
                   for a in (0, 60, 120, 180, 240, 300)]
            d.poly([(round(px, 1), round(py, 1)) for px, py in pts], "none", stroke=t["line"], sw=2, sop=op)
        d.text(80, 300, t["sz"]["h1"], "#FFFFFF", P["name"], weight="bold")
        d.rect(80, 330, 388, 46, t["cyan"], rx=6, op=.92)
        d.text(100, 362, 24, "#002E5D", P["subtitle"], weight="bold")
        d.text(80, 452, 16, "#A0C4E3", f'致：{P["client"]}')
        d.text(80, 480, 16, "#A0C4E3", f'{P["vendor"]} · {P["date"]} · 方案编号 {P["code"]}')
        d.text(80, 660, 14, "#FFFFFF", P["secret"], op=.85)
    return d.save(style, "01_cover")

# ---------- P2 目录 ----------
def toc(style):
    t = T[style]; d = Doc(t); base(d, t)
    chrome_top(d, t)
    x0, y0, x1, y1 = t["area"]
    if style == "tech_blue":
        g = d.grad(t["accent2"], t["accent"], vertical=True)
        d.rect(0, 0, 360, 720, g)
        d.text(60, 320, 36, "#FFFFFF", "目录", weight="bold")
        d.text(60, 356, 14, "#A0C4E3", "CONTENTS")
        d.line(60, 390, 150, 390, "#4CA1E7", 3)
        lx, row0, rh = 420, 168, 96
        for i, item in enumerate(D["toc"]):
            y = row0 + i * rh
            d.rect(lx, y - 15, 12, 12, t["cyan"])
            d.text(lx + 28, y, 24, t["ink"], item["title"], weight="bold")
            d.text(x1, y, 14, t["aux"], item["page"], anchor="end")
            if i < 4:
                d.line(lx, y + 40, x1, y + 40, "#F5F5F7", 2)
    else:
        title_txt = "目录" if style != "consultant" else "Agenda · 目录"
        if style == "consultant":
            d.text(x0, 96, t["sz"]["h2"], t["ink"], title_txt, weight="bold")
            d.line(x0, 116, 220, 116, t["hi"], 4)
        elif style == "government_red":
            d.rect(0, 6, 12, 710, t["accent"])
            d.text(x0 + 12, 100, t["sz"]["h2"], t["ink"], "目录", weight="bold")
        row0, rh = (172, 96) if style == "consultant" else (168, 96)
        for i, item in enumerate(D["toc"]):
            y = row0 + i * rh
            if style == "consultant":
                d.text(x0, y, 36, t["accent"], item["no"], weight="bold")
                d.text(x0 + 70, y, t["sz"]["h3"], t["ink"], item["title"], weight="bold")
                d.text(x1, y, t["sz"]["sub"], t["aux"], item["page"], anchor="end")
                d.line(x0, y + 32, x1, y + 32, t["line"], 1)
            else:
                d.rect(x0, y - 34, 44, 44, t["accent"], rx=0)
                d.text(x0 + 22, y - 2, 20, "#FFFFFF", item["no"], anchor="middle", weight="bold")
                d.text(x0 + 62, y, t["sz"]["h3"], t["ink"], item["title"], weight="bold")
                d.text(x1, y, 14, t["aux"], item["page"], anchor="end")
    footer(d, t, 2)
    return d.save(style, "02_toc")

# ---------- P3 现状与问题 ----------
def status(style):
    t = T[style]; d = Doc(t); base(d, t)
    chrome_top(d, t); outer(d, t)
    title(d, t, 60, 30 if t is T["government_red"] else 40,
          "现状与问题", "事件高位增长、响应近考核基线 3 倍，24 个子系统仅 9 个完成平台化接入", no="01")
    x0, y0, x1, y1 = t["area"]
    W = x1 - x0
    kpis = D["kpis"]
    gap = 20; cw = (W - gap * 3) / 4
    for i, k in enumerate(kpis):
        x = x0 + i * (cw + gap); cy = y0 - 20
        card(d, t, x, cy, cw, 150)
        d.text(x + 20, cy + 36, t["sz"]["h4"] + 2 if t is T["consultant"] else t["sz"]["p"], t["body"], k["label"])
        val = k["value"] if "of" not in k else f'{k["value"]}/{k["of"]}'
        col = (t.get("hi") or t.get("gold") or t["accent"]) if not k.get("bad") else t["warn"]
        vtxt = f'{val:,}' if isinstance(val, int) else str(val)
        d.text(x + 20, cy + 96, t["sz"]["data"], col, vtxt, weight="bold")
        d.text(x + 20, cy + 124, t["sz"]["sub"], t["aux"],
               k["unit"] + ("（已接入 / 应接入）" if "of" in k else " · " + k["note"]))
    # 条形图
    gy = y0 + 175
    card(d, t, x0, gy, W, 250)
    d.text(x0 + 24, gy + 36, t["sz"]["h3"], t["ink"], D["sources"]["title"], weight="bold")
    d.text(x1 - 24, gy + 36, t["sz"]["sub"], t["aux"], f'合计 {D["sources"]["total"]:,} 起', anchor="end")
    items = D["sources"]["items"]; vmax = max(i["value"] for i in items)
    bx = x0 + 200; bw_max = W - 200 - 120; rh = 34
    for i, it in enumerate(items):
        y = gy + 76 + i * rh
        d.text(bx - 16, y + 4, t["sz"]["p"] if t is T["government_red"] else t["sz"]["sub"] + 2, t["body"], it["name"], anchor="end")
        w = round(bw_max * it["value"] / vmax, 1)
        d.rect(bx, y - 13, w, 18, t["series"][i % 5])
        d.text(bx + w + 10, y + 3, t["sz"]["sub"], t["aux"], f'{it["value"]:,}')
    footer(d, t, 3)
    return d.save(style, "03_status")

# ---------- P4 总体架构 ----------
def arch(style):
    t = T[style]; d = Doc(t); base(d, t)
    chrome_top(d, t); outer(d, t)
    title(d, t, 60, 30 if t is T["government_red"] else 40,
          "总体架构设计", "五层 28 个能力模块：一次接入、集中治理、按需编排", no="02")
    x0, y0, x1, y1 = t["area"]
    W = x1 - x0
    layers = D["arch"]["layers"]
    gap = 12; top = y0 + 10
    lh = round((y1 - top - gap * (len(layers) - 1)) / len(layers), 1)
    for li, L in enumerate(layers):
        y = round(top + li * (lh + gap), 1)
        card(d, t, x0, y, W, lh)
        d.rect(x0, y, 120, lh, t["accent"] if li % 2 == 0 else t["accent2"], rx=t["rx"])
        d.text(x0 + 60, y + lh / 2 + 7, t["sz"]["h3"], "#FFFFFF", L["name"], anchor="middle", weight="bold")
        n = len(L["modules"]); gx = 16
        chip_x0 = x0 + 140
        chip_w = (x1 - 24 - chip_x0 - gx * (n - 1)) / n
        for mi, m in enumerate(L["modules"]):
            cx = chip_x0 + mi * (chip_w + gx)
            fill = t.get("panel", "#ECF0F1")
            d.rect(cx, y + (lh - 44) / 2, chip_w, 44, fill, rx=min(t["rx"], 6))
            fs = 12 if n >= 8 else 14
            d.text(cx + chip_w / 2, y + lh / 2 + 5, fs, t["ink"], m, anchor="middle")
        d.text(x1 - 24, y + 14, 12, t["aux"], f'{n} 模块', anchor="end")
    footer(d, t, 4)
    return d.save(style, "04_arch")

# ---------- P5 实施计划与报价 ----------
def plan(style):
    t = T[style]; d = Doc(t); base(d, t)
    chrome_top(d, t); outer(d, t)
    title(d, t, 60, 30 if t is T["government_red"] else 40,
          "实施计划与投资报价", "三期 12 个月、总投资 ¥608 万，分期付款与里程碑验收绑定", no="03")
    x0, y0, x1, y1 = t["area"]
    W = x1 - x0
    pl = D["plan"]; M = pl["months"]
    # 甘特
    gy = y0 + 10; ax = x0 + 240; aw = W - 240 - 24; mw = aw / M
    d.text(x0, gy + 14, t["sz"]["h3"], t["ink"], "分期甘特（12 个月）", weight="bold")
    for m in range(M + 1):
        x = ax + m * mw
        d.line(x, gy + 28, x, gy + 168, t["line"], 1, op=.7)
        if m < M:
            d.text(x + mw / 2, gy + 44, 12, t["aux"], f"M{m+1}", anchor="middle")
    for i, ph in enumerate(pl["phases"]):
        y = gy + 66 + i * 38
        d.text(x0, y + 5, t["sz"]["p"] if t is T["government_red"] else 14, t["body"], ph["name"])
        bx = ax + ph["start_m"] * mw
        bw = ph["months"] * mw
        d.rect(bx, y - 12, bw, 22, t["series"][i], rx=min(t["rx"], 6))
        d.text(bx + 10, y + 4, 12, "#FFFFFF", f'{ph["months"]} 个月 · ¥{ph["price_wan"]} 万')
    # 报价表
    py = y1 - 90
    ty = min(gy + 200, py - 178); rowh = 42
    d.text(x0, ty - 12, t["sz"]["h3"], t["ink"], "投资报价（万元）", weight="bold")
    cols = [("分期", 250), ("时间窗", 240), ("工期", 120), ("金额", 140), ("交付重点", 0)]
    tw = [250, 240, 120, 140, W - 750 - 24]
    d.rect(x0, ty, W, rowh, t["accent"] if t is not T["tech_blue"] else t["accent2"], rx=min(t["rx"], 6))
    cx = x0
    for (cn, _), w in zip(cols, tw):
        d.text(cx + 16, ty + 27, 14, "#FFFFFF", cn, weight="bold"); cx += w
    for i, ph in enumerate(pl["phases"]):
        y = ty + rowh * (i + 1)
        d.rect(x0, y, W, rowh, t["bg"] if i % 2 else t.get("panel", "#ECF0F1"), rx=0)
        cells = [ph["name"], ph["window"], f'{ph["months"]} 个月', f'{ph["price_wan"]:,}', ph["focus"]]
        cx = x0
        for c, w in zip(cells, tw):
            d.text(cx + 16, y + 27, 12 if w < 200 else 14, t["ink"] if c != cells[3] else t["accent"], c); cx += w
    y = ty + rowh * 4
    d.rect(x0, y, W, rowh, t["accent2"], rx=min(t["rx"], 6))
    d.text(x0 + 16, y + 27, 14, "#FFFFFF", "合计", weight="bold")
    d.text(x0 + 610 + 16, y + 27, 16, "#FFFFFF", f'{pl["total_wan"]:,}', weight="bold")
    d.text(x1 - 24, y + 27, 14, "#FFFFFF", "含部署、定制、首年运维", anchor="end")
    # 付款 + 团队（右下）
    d.text(x0, py, t["sz"]["p"], t["ink"], "付款节奏", weight="bold")
    pw = W - 24; acc = x0
    for i, pay in enumerate(pl["payments"]):
        w = round(pw * pay["pct"] / 100, 1)
        d.rect(acc, py + 12, w, 26, t["series"][i % 5], rx=4)
        d.text(acc + 10, py + 30, 12, "#FFFFFF", f'{pay["name"]} {pay["pct"]}%')
        d.text(acc + w / 2, py + 58, 12, t["aux"], f'¥{pay["wan"]} 万', anchor="middle")
        acc += w + 2
    tms = f'驻场团队 {sum(m["n"] for m in pl["team"])} 人：' + " / ".join(f'{m["role"]}×{m["n"]}' for m in pl["team"])
    d.text(x0, py + 88, t["sz"]["sub"], t["aux"], tms)
    footer(d, t, 5)
    return d.save(style, "05_plan")

# ---------- P6 结尾 ----------
def ending(style):
    t = T[style]; d = Doc(t)
    dark = style != "consultant"
    if dark:
        g = d.grad(t["cover_from"], t["cover_to"], vertical=True)
        d.rect(0, 0, 1280, 720, g)
    else:
        base(d, t); d.rect(0, 0, 1280, t["topbar"], t["accent"])
    ink = "#FFFFFF" if dark else t["ink"]
    sub = t["gold"] if style == "government_red" else (t["cyan"] if style == "tech_blue" else t["accent"])
    d.text(640, 190 if dark else 170, {"consultant": 44, "government_red": 48, "tech_blue": 56}[style], ink, "恳请审议 · 期待共建", anchor="middle", weight="bold")
    d.text(640, 240 if dark else 214, t["sz"]["h3"], sub, f'{P["name"]} · {P["subtitle"]}', anchor="middle")
    y0 = 320
    for i, a in enumerate(D["closing"]["asks"]):
        y = y0 + i * 92
        x = 250; w = 780
        if dark:
            d.rect(x, y - 40, w, 72, "#FFFFFF", rx=t["rx"], op=.10)
        else:
            card(d, t, x, y - 40, w, 72)
        if style == "consultant":
            d.text(x + 28, y + 4, t["sz"]["h3"], t["accent"], a["t"], weight="bold")
            d.text(x + 200, y + 4, t["sz"]["p"] + 2, t["body"], a["d"])
        elif style == "government_red":
            d.rect(x + 16, y - 24, 40, 40, t["accent"], rx=0)
            d.text(x + 36, y + 3, 20, "#FFFFFF", f'{i+1:02d}', anchor="middle", weight="bold")
            d.text(x + 76, y + 2, t["sz"]["h3"], ink, a["t"], weight="bold")
            d.text(x + 240, y + 2, t["sz"]["p"], "#CBD5E1", a["d"])
        else:
            d.rect(x + 16, y - 16, 12, 12, t["cyan"])
            d.text(x + 40, y + 4, t["sz"]["h3"], ink, a["t"], weight="bold")
            d.text(x + 220, y + 4, 16, "#A0C4E3", a["d"])
    c = D["closing"]["contact"]
    ct = f'{P["vendor"]} · {c["tel"]} · {c["email"]} · {c["addr"]}'
    d.text(640, 660, t["sz"]["sub"], sub if dark else t["aux"], ct, anchor="middle")
    if style == "government_red":
        d.rect(0, 714, 1280, 6, t["gold"])
    if style == "tech_blue":
        d.path("M0 700 Q320 640 640 690 T1280 660 L1280 720 L0 720 Z", t["accent"], op=.35)
    return d.save(style, "06_ending")

if __name__ == "__main__":
    total = 0
    for s in STYLES:
        sizes = [cover(s), toc(s), status(s), arch(s), plan(s), ending(s)]
        total += sum(sizes)
        print(s, sizes)
    print("TOTAL bytes", total)
