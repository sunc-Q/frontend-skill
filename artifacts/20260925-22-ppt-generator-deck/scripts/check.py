"""Round 9 (2026-09-25 22:00) assertion suite for ppt-generator x 演示汇报页.

Groups:
  A  SVG structural validity + spec hard rules
  B  Zero external references (double-click openable)
  C  Per-style fidelity to that style's design_spec.md
  D  The three styles are mutually distinguishable
  E  Cross-deck data equality (same numbers in all three decks)
  F  Geometry / chart arithmetic / table arithmetic
  G  Ledger cross-check (numbers in the deck vs records/state on disk)
  H  PPTX export structure (native shapes, order defect, unit conversion)

Every number printed comes from an assertion, never from a recollection.
"""
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ART = Path(__file__).resolve().parent.parent
SVG = ART / "svg"
PPTX = ART / "pptx"
LAB = Path("/Users/apple/Documents/workProject/试验/前端skill实验室")

PAGES = ["01_cover.svg", "02_toc.svg", "02_chapter.svg", "03_content.svg", "04_ending.svg"]
STYLES = ["exhibit", "academic_defense", "smart_red"]

# palettes transcribed from each design_spec.md sections III
PALETTES = {
    "exhibit": {
        "0D1117", "FFFFFF", "1E40AF", "7C3AED", "D4AF37", "6366F1",
        "FFFFFF", "9CA3AF", "6B7280", "111827", "1F2937", "E5E7EB", "374151",
    },
    "academic_defense": {
        "003366", "0066CC", "CC0000", "E8F4FC", "FFFFFF", "333333",
        "666666", "999999", "F5F7FA", "D0D7E0", "28A745", "FFA500", "17A2B8",
    },
    "smart_red": {
        "DE3545", "F0964D", "333333", "F5F5F7", "E0E0E0", "666666", "FFFFFF",
    },
}
# minimum text size each spec allows (design_spec IV / X rules)
MIN_TYPE = {"exhibit": 12, "academic_defense": 12, "smart_red": 14}
SAFE_X = {"exhibit": (40, 1240), "academic_defense": (40, 1240), "smart_red": (60, 1220)}

BANNED = ["foreignObject", "clipPath", "mask", "textPath", "marker-end",
          "marker>", "<script", "feGaussianBlur", "<image"]
BANNED_RE = [r"<style[\s>]", r"\sclass\s*=", r"\banimate(-\w+)?\s*=",
             r"rgba\(", r"<g[^>]*\sopacity\s*=", r"xlink:href"]

# the SVG namespace declaration is a protocol URI by definition, not a network
# reference; strip it before any "no external refs" claim (lesson from 20:00 round)
XMLNS = re.compile(r'\sxmlns(:\w+)?="https?://[^"]*"')


def code(t):
    """file text with the xmlns declarations removed"""
    return XMLNS.sub("", t)


def body(t):
    """element markup only: comments and the xml declaration removed"""
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"<\?.*?\?>", "", t, flags=re.S)
    return t


# colour authority: design_spec.md declares some of them, the shipped
# reference templates use the rest. Anything outside both is a real violation.
SKILL_LAYOUTS = Path.home() / ".qoder-cn/skills/ppt-generator/ppt-master-assets/templates/layouts"


def template_colors(style):
    out = set()
    for p in (SKILL_LAYOUTS / style).glob("*.svg"):
        out |= {c.upper() for c in re.findall(r"#([0-9A-Fa-f]{6})", p.read_text())}
    return out


TEMPLATE = {s: template_colors(s) for s in STYLES}


results = []
n_pass = n_fail = 0


def check(gid, name, ok, detail=""):
    global n_pass, n_fail
    results.append((gid, name, bool(ok), detail))
    if ok:
        n_pass += 1
    else:
        n_fail += 1
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {gid} {name}" + (f" :: {detail}" if detail else ""))


def read(p):
    return p.read_text(encoding="utf-8")


files = {}
for s in STYLES:
    for pg in PAGES:
        files[(s, pg)] = read(SVG / s / pg)

# ---------------- A: structure + hard rules ----------------
check("A0", "15 SVG pages present", len(files) == 15, f"{len(files)} files")
for (s, pg), txt in sorted(files.items()):
    m = re.search(r'viewBox="([^"]+)"', txt)
    check("A1", f"{s}/{pg} viewBox 0 0 1280 720", m and m.group(1) == "0 0 1280 720",
          m.group(1) if m else "missing")
    try:
        ET.fromstring(txt)
        ok = True
        err = ""
    except ET.ParseError as e:
        ok, err = False, str(e)
    check("A2", f"{s}/{pg} well-formed XML", ok, err)
    hits = [b for b in BANNED if b in body(txt)] + \
        [r for r in BANNED_RE if re.search(r, body(txt))]
    check("A3", f"{s}/{pg} no banned constructs", not hits, ", ".join(hits))
    check("A4", f"{s}/{pg} text-wrap via tspan only", "<foreignObject" not in txt)

# ---------------- B: zero external references ----------------
for (s, pg), txt in sorted(files.items()):
    c = code(txt)
    urls = re.findall(r'https?://[^\s"\']+', c)
    hrefs = re.findall(r'(?:xlink:href|href)="([^"]+)"', c)
    fn = re.findall(r'url\(([^)]*)\)', c)
    local = [f for f in fn if f.strip().startswith("#")]
    external = urls + hrefs + [f for f in fn if f not in local]
    check("B1", f"{s}/{pg} zero external refs", not external,
          f"external={external} local_url()={local}")

# ---------------- C: spec fidelity ----------------
for s in STYLES:
    used = set()
    sizes = []
    fams = set()
    for pg in PAGES:
        txt = files[(s, pg)]
        used |= {c.upper() for c in re.findall(r"fill=\"#([0-9A-Fa-f]{6})\"", txt)}
        used |= {c.upper() for c in re.findall(r"stroke=\"#([0-9A-Fa-f]{6})\"", txt)}
        sizes += [int(v) for v in re.findall(r'font-size="(\d+(?:\.\d+)?)"', txt)]
        fams |= {f for f in re.findall(r'font-family="([^"]+)"', txt)}
    off = sorted(used - PALETTES[s] - TEMPLATE[s])
    check("C1", f"{s} every colour traces to design_spec.md or its own templates",
          not off, f"{len(used)} colors used, unreachable={off}")
    spec_only = sorted(PALETTES[s] - TEMPLATE[s])
    undeclared = sorted(TEMPLATE[s] - PALETTES[s])
    print(f"    · spec-vs-template divergence [{s}]: declared-but-unused-by-templates={spec_only} "
          f"templates-use-but-undeclared={len(undeclared)} {undeclared}")
    check("C2", f"{s} fill-opacity used instead of rgba",
          all("rgba(" not in files[(s, pg)] for pg in PAGES))
    mins = min(sizes)
    check("C3", f"{s} min font size >= spec {MIN_TYPE[s]}px", mins >= MIN_TYPE[s],
          f"min={mins}px n_text={len(sizes)}")
    check("C4", f"{s} every page declares a font stack",
          all(re.search(r'font-family="', files[(s, pg)]) for pg in PAGES),
          f"stacks={len(fams)}")
    # safe area: horizontal containment of every positioned <text>
    viol = []
    for pg in PAGES:
        for m in re.finditer(r'<text[^>]*x="([\d.]+)"[^>]*', files[(s, pg)]):
            x = float(m.group(1))
            lo, hi = SAFE_X[s]
            if not (lo - 0.01 <= x <= hi + 0.01):
                viol.append(f"{pg}:{x}")
    check("C5", f"{s} text x inside safe area {SAFE_X[s]}", not viol, ", ".join(viol[:6]))

# ---------------- D: styles mutually distinct ----------------
def fingerprint(txt):
    return tuple(len(re.findall(f"<{tag}[ >]", txt)) for tag in
                 ("rect", "text", "line", "circle", "polygon", "path", "tspan"))


sig = {}
for s in STYLES:
    allc = set()
    for pg in PAGES:
        allc |= {c.upper() for c in re.findall(r"#([0-9A-Fa-f]{6})", files[(s, pg)])}
    sig[s] = allc
for i, a in enumerate(STYLES):
    for b in STYLES[i + 1:]:
        inter, union = sig[a] & sig[b], sig[a] | sig[b]
        check("D1", f"{a} vs {b} palettes differ (jaccard < 0.5)",
              len(inter) / len(union) < 0.5,
              f"jaccard={len(inter)/len(union):.2f} shared={sorted(inter)}")
        fa = [fingerprint(files[(a, p)]) for p in PAGES]
        fb = [fingerprint(files[(b, p)]) for p in PAGES]
        same = sum(1 for x, y in zip(fa, fb) if x == y)
        check("D2", f"{a} vs {b} page structure fingerprints differ", same <= 1,
              f"identical pages={same} {a}={fa[3]} {b}={fb[3]}")
# signature devices actually present
check("D3", "exhibit: gradient bar + CONFIDENTIAL label on every page",
      all("linearGradient" in files[("exhibit", p)] for p in PAGES)
      and all("CONFIDENTIAL" in files[("exhibit", p)] for p in PAGES))
check("D4", "academic_defense: dark-blue header + red left bar",
      all(re.search(r'fill="#003366"', files[("academic_defense", p)]) and
          'CC0000' in files[("academic_defense", p)] for p in PAGES[1:4]))


def tri_count(txt):
    """closed 3-vertex shapes: <polygon> with 3 points, or 3-line closed paths"""
    n = sum(1 for pts in re.findall(r'<polygon points="([^"]+)"', txt)
            if len(pts.split()) == 3)
    n += sum(1 for d in re.findall(r'<path d="([^"]*Z)"', txt)
             if d.count("L") == 2)
    return n


check("D5", "smart_red: triangular geometric cutouts (spec V.1) on cover and ending",
      tri_count(files[("smart_red", "01_cover.svg")]) >= 4
      and tri_count(files[("smart_red", "04_ending.svg")]) >= 2,
      f"cover={tri_count(files[('smart_red', '01_cover.svg')])} "
      f"ending={tri_count(files[('smart_red', '04_ending.svg')])}")
check("D6", "smart_red: spec's orange accent #F0964D actually used (templates never use it)",
      any("F0964D" in sig["smart_red"] for _ in [0]),
      f"templates_use_F0964D={'F0964D' in TEMPLATE['smart_red']}")

# ---------------- E: cross-deck data equality ----------------
KEYS = ["8", "4", "1,203", "1.1MB", "50MB"]
for k in KEYS:
    present = [s for s in STYLES if any(k in files[(s, pg)] for pg in PAGES)]
    check("E1", f"figure {k} appears in all 3 decks", len(present) == 3, str(present))
CHART = [36, 141, 345, 398, 205, 78]
for s in STYLES:
    txt = files[(s, "03_content.svg")]
    got = [int(v) for v in re.findall(r">(\d{2,3})</text>", txt)]
    check("E2", f"{s} chart labels carry the 6 per-round counts",
          all(v in got for v in CHART), f"labels={got}")

# ---------------- F: geometry + arithmetic ----------------
check("F1", "1,203 == sum of the 6 recorded assertion counts",
      sum(CHART) == 1203, f"sum={sum(CHART)}")

RECT = re.compile(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*?fill="(#[0-9A-Fa-f]{6})"')
TEXT = re.compile(r'<text x="([\d.]+)" y="([\d.]+)"[^>]*?font-size="(\d+)"[^>]*?>([^<]+)</text>')


def bar_geometry(txt):
    """map each plotted value to the rect behind its data label"""
    rects = [(float(a), float(b), float(c), float(d), e)
             for a, b, c, d, e in RECT.findall(txt)]
    out = {}
    for m in TEXT.finditer(txt):
        x, y, size, label = float(m.group(1)), float(m.group(2)), int(m.group(3)), m.group(4).strip()
        if not re.fullmatch(r"\d{2,3}", label):
            continue
        v = int(label)
        cand = [r for r in rects if r[0] <= x <= r[0] + r[2] and r[1] - 14 <= y <= r[1]]
        if v in CHART and cand:
            out[v] = min(cand, key=lambda r: abs((r[0] + r[2] / 2) - x))
    return out


for s in STYLES:
    bars = bar_geometry(files[(s, "03_content.svg")])
    check("F2", f"{s} all 6 bars resolved from label->rect pairing",
          set(bars) == set(CHART), f"found={sorted(bars)}")
    if set(bars) != set(CHART):
        continue
    heights = {v: bars[v][3] for v in CHART}
    scales = {v: round(heights[v] / v, 3) for v in CHART}
    bases = {round(bars[v][1] + bars[v][3], 1) for v in CHART}
    asc = sorted(CHART)
    monotone = all(heights[asc[i]] < heights[asc[i + 1]] for i in range(len(asc) - 1))
    check("F3", f"{s} bar height is strictly increasing with its value",
          monotone, f"heights_by_value={{ {', '.join(f'{v}:{heights[v]:.0f}' for v in asc)} }}")
    check("F4", f"{s} single linear scale (no truncated axis)",
          max(scales.values()) - min(scales.values()) <= 0.05 * min(scales.values()),
          f"scale≈{sum(scales.values())/6:.3f}px per assertion; per-bar={scales}")
    check("F5", f"{s} one shared baseline for all bars", len(bases) == 1, f"bases={bases}")
    check("F6", f"{s} skill-row table footnotes the 9-vs-8 overlap",
          "9" in files[(s, "03_content.svg")] and "叠加" in files[(s, "03_content.svg")])

# every text stays inside the canvas once its own width is estimated
CJK = re.compile(r"[\u3000-\u9fff\uff00-\uffef，。：、（）]")
TEXT_TAG = re.compile(r"<text ([^>]*)>([^<]+)</text>")
esc = []
for (s, pg), txt in files.items():
    for attrs, label in TEXT_TAG.findall(txt):
        if 'x="' not in attrs or 'font-size="' not in attrs:
            continue
        x = float(re.search(r'x="([\d.\-]+)"', attrs).group(1))
        size = float(re.search(r'font-size="([\d.]+)"', attrs).group(1))
        anchor_m = re.search(r'text-anchor="(\w+)"', attrs)
        anchor = anchor_m.group(1) if anchor_m else "start"
        cjk = len(CJK.findall(label))
        w = cjk * size + (len(label) - cjk) * size * 0.56
        lo, hi = {"start": (x, x + w), "middle": (x - w / 2, x + w / 2),
                  "end": (x - w, x)}[anchor]
        if lo < -1 or hi > 1281:
            esc.append(f"{s}/{pg} {label[:12]}({anchor}@{x:.0f}) {lo:.0f}-{hi:.0f}")
check("F7", "no text overflows the 1280 canvas (width estimated from glyph classes)",
      not esc, "; ".join(esc[:6]))

# ---------------- G: ledger cross-check ----------------
snap = json.loads(read(ART / "scripts" / "ledger-snapshot.json"))
log = read(LAB / "records" / "work-log.md")
state = json.loads(read(LAB / "state" / "state.json"))
check("G1", "deck's '8 轮已试组合' == snapshot.tried, and this round is now recorded as the 9th",
      snap["tried"] == 8 and snap["runs"] == 8
      and len(state["tried"]) == 9 and len(state["runs"]) == 9
      and state["tried"][-1]["skill"] == "ppt-generator"
      and state["runs"][-1]["time"].startswith("2026-09-25T22:00"),
      f"snap={snap['tried']}/{snap['runs']} live={len(state['tried'])}/{len(state['runs'])}")
distinct = set()
for t in snap["tried_skills"]:
    for part in t.replace("（叠加）", "").split("+"):
        distinct.add(part.strip())
check("G2", "deck's '4 skills already reviewed' == distinct skills in prior 8 rounds",
      len(distinct) == 4, f"distinct={sorted(distinct)}")
check("G2b", "of those, 1 built-in + 3 user-installed",
      sum(1 for d in distinct if d.startswith("sites:")) == 1
      and sum(1 for d in distinct if not d.startswith("sites:")) == 3,
      f"{sorted(distinct)}")
check("G3", "snapshot is exactly one round behind the live ledger (write-back done)",
      snap["tried"] == len(state["tried"]) - 1 and snap["runs"] == len(state["runs"]) - 1
      and snap["used_styles"] == len(state["used_styles"]) - 3
      and snap["skills_seen"] == len(state["skills_seen"]) - 1,
      f"snap={snap['tried']}/{snap['runs']}/{snap['used_styles']}/{snap['skills_seen']} "
      f"live={len(state['tried'])}/{len(state['runs'])}/{len(state['used_styles'])}/{len(state['skills_seen'])}")

# per-round assertion counts the bar chart plots, recovered from the work-log text itself
rec = {
    "16:00": [int(x) for x in re.findall(r"Node (\d+) 项断言", log)],
    "17:00": [int(x) for x in re.findall(r"(\d+) 断言 ×3 页全绿", log)] +
             [int(x) for x in re.findall(r"风格/级联 (\d+) 断言", log)],
    "18:00": [int(x) for x in re.findall(r"断言 (\d+) 交互 \+ (\d+) 风格", log)[0]] if
             re.findall(r"断言 (\d+) 交互 \+ (\d+) 风格", log) else [],
    "19:00": [int(x) for x in re.findall(r"(\d+) 条断言全绿", log)],
    "20:00": [int(x) for x in re.findall(r"(\d+)/\d+ 断言绿", log)][:1],
    "21:00": [int(x) for x in re.findall(r"(\d+)/\d+ 断言绿", log)][-1:],
}
derived = {"16:00": 36, "17:00": 141, "18:00": 345, "19:00": 398, "20:00": 205, "21:00": 78}
for k, parts in rec.items():
    total = (parts[0] * 3 + parts[1]) if k == "17:00" and len(parts) == 2 else sum(parts)
    check("G4", f"work-log {k} parts {parts} -> {derived[k]} plotted in the chart",
          bool(parts) and total == derived[k], f"computed={total}")
check("G5", "deck's 1,203 == sum of the 6 rounds that recorded counts",
      sum(derived.values()) == 1203, f"sum={sum(derived.values())}")
check("G6", "24 styles used before this round (deck's zero-repeat claim)",
      snap["used_styles"] == 24 and len(state["used_styles"]) == 27)
# this round's 3 styles must be recorded (with a distinguishing prefix) and be new
chosen = {"exhibit", "academic_defense", "smart_red"}
recorded = [u for u in state["used_styles"] if any(t in u for t in chosen)]
check("G7", "this round's 3 styles are recorded in used_styles and were new before it",
      len(recorded) == 3 and len(state["used_styles"]) == snap["used_styles"] + 3,
      f"recorded={recorded}")

# ---------------- H: PPTX export ----------------
INT_ORDER = PAGES
COMPAT = {"exhibit": True, "academic_defense": False, "smart_red": True}
EMU_PER_PX = 9525
for s in STYLES:
    doc = PPTX / f"{s}-documented.pptx"
    intd = PPTX / f"{s}-intended.pptx"
    check("H1", f"{s} both exports exist", doc.exists() and intd.exists())
    with zipfile.ZipFile(intd) as z:
        names = z.namelist()
        media = [n for n in names if n.startswith("ppt/media/")]
        slides = sorted((n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                        key=lambda n: int(re.search(r"(\d+)", n.split("/")[-1]).group(1)))
        xmls = [z.read(n).decode() for n in slides]
    check("H2", f"{s} 5 slides, zero rasterized media (native shapes only)",
          len(slides) == 5 and not media, f"slides={len(slides)} media={len(media)} compat={COMPAT[s]}")
    sp = sum(x.count("<p:sp>") for x in xmls)
    pic = sum(x.count("<p:pic>") for x in xmls)
    check("H3", f"{s} shape count > 100 and no <p:pic>", sp > 100 and pic == 0, f"sp={sp} pic={pic}")
    txt_runs = sum(len(re.findall(r"<a:t>", x)) for x in xmls)
    svg_texts = sum(len(re.findall(r"<text", files[(s, p)])) for p in PAGES)
    check("H4", f"{s} every SVG <text> became an <a:t> run", txt_runs == svg_texts,
          f"runs={txt_runs} svg_texts={svg_texts}")
    # font-size px -> pt conversion
    bad_sz = 0
    for i, pg in enumerate(PAGES):
        want = sorted({round(int(v) * 0.75, 2) for v in
                       re.findall(r'font-size="(\d+)"', files[(s, pg)])})
        got = sorted({round(float(v) / 100, 2) for v in re.findall(r'sz="(\d+)"', xmls[i])})
        if want != got:
            bad_sz += 1
    check("H5", f"{s} pt sizes == px*0.75 on all 5 slides", bad_sz == 0, f"bad={bad_sz}")
    # EMU bounds
    oob = 0
    checked = 0
    for x in xmls:
        for m in re.finditer(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', x):
            ox, oy, cx, cy = map(int, m.groups())
            checked += 1
            if ox < -EMU_PER_PX or oy < -EMU_PER_PX or ox + cx > 12192000 + EMU_PER_PX or oy + cy > 6858000 + EMU_PER_PX:
                oob += 1
    check("H6", f"{s} no shape extent escapes the slide", oob == 0, f"checked={checked} oob={oob}")
    with zipfile.ZipFile(doc) as z:
        d_names = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                         key=lambda n: int(re.search(r"(\d+)", n.split("/")[-1]).group(1)))
        d2 = z.read(d_names[1]).decode()
    i2 = xmls[1]
    d_first = re.findall(r"<a:t>(.*?)</a:t>", d2)[:1]
    i_first = re.findall(r"<a:t>(.*?)</a:t>", i2)[:1]
    check("H7", f"{s} documented order puts the chapter page at slide 2 (defect reproduced)",
          d_first == ["02"] and i_first != ["02"],
          f"documented slide2 starts {d_first} / intended slide2 starts {i_first}")
    check("H8", f"{s} same page set -> same byte size both orders",
          doc.stat().st_size == intd.stat().st_size,
          f"{doc.stat().st_size} vs {intd.stat().st_size}")

# gradient + group conversion (exhibit is the style that ships both)
with zipfile.ZipFile(PPTX / "exhibit-intended.pptx") as z:
    x1 = z.read("ppt/slides/slide1.xml").decode()
check("H9", "exhibit cover: <linearGradient> -> <a:gradFill> with both stops",
      "<a:gradFill" in x1 and "1E40AF" in x1 and "7C3AED" in x1)
check("H10", "exhibit cover: <g> -> <p:grpSp>, stroke-opacity 0.3 -> alpha 30000",
      "<p:grpSp>" in x1 and '<a:alpha val="30000"/>' in x1)
with zipfile.ZipFile(PPTX / "smart_red-intended.pptx") as z:
    r1 = z.read("ppt/slides/slide1.xml").decode()
freeforms = re.findall(r"<p:sp>.*?</p:sp>", r1, re.S)
tri = [s for s in freeforms if "<a:close/>" in s and s.count("<a:lnTo>") == 2]
check("H11", "smart_red cover: closed 3-point <path> -> native freeform custGeom",
      len(tri) >= 4, f"freeform shapes={len(tri)} of {len(freeforms)} sp on slide 1")
check("H12", "smart_red cover: triangle keeps its fill and gets no outline",
      any('val="DE3545"' in t and "<a:ln><a:noFill/></a:ln>" in t for t in tri))
# text-anchor="middle" must become centered alignment, not left-aligned drift
mid_src = len(re.findall(r'text-anchor="middle"', read(SVG / "exhibit" / "02_toc.svg")))
end_src = len(re.findall(r'text-anchor="end"', read(SVG / "exhibit" / "02_toc.svg")))
with zipfile.ZipFile(PPTX / "exhibit-intended.pptx") as z:
    t2 = z.read("ppt/slides/slide2.xml").decode()
check("H13", "text-anchor -> a:pPr algn (middle=ctr, end=r) carried over",
      len(re.findall(r'algn="ctr"', t2)) == mid_src and len(re.findall(r'algn="r"', t2)) == end_src,
      f"svg middle={mid_src}/end={end_src} pptx ctr={len(re.findall('algn=.ctr.', t2))}/r={len(re.findall('algn=.r.', t2))}")

# ---------------- I: double-clickable previews ----------------
PREVIEW = ART / "preview"
for s in STYLES:
    h = PREVIEW / f"{s}.html"
    check("I1", f"{s} preview exists", h.exists(), f"{h.stat().st_size if h.exists() else 0} bytes")
    doc = h.read_text(encoding="utf-8")
    svgs = re.findall(r'<svg[^>]*viewBox="0 0 1280 720"', doc)
    check("I2", f"{s} preview embeds all 5 pages", len(svgs) == 5, f"embedded_svgs={len(svgs)}")
    bad_xml = []
    for frag in re.findall(r"(<svg[\s\S]*?</svg>)", doc):
        try:
            ET.fromstring(frag)
        except ET.ParseError as e:
            bad_xml.append(str(e))
    check("I3", f"{s} preview: every embedded SVG still parses", not bad_xml, "; ".join(bad_xml[:2]))
    ext = [u for u in re.findall(r'(?:src|href)="([^"#][^"]*)"', doc) if not u.startswith("pptx/")] + \
          re.findall(r"https?://(?!www\.w3\.org)", doc) + re.findall(r"<link\b|<img\b|@import", doc)
    check("I4", f"{s} preview has zero external dependencies", not ext, f"refs={ext}")
    check("I5", f"{s} preview has 5 nav buttons + key handler",
          doc.count("<button") == 5 and "ArrowRight" in doc and "ArrowLeft" in doc,
          f"buttons={doc.count('<button')}")
entry = read(ART / "styles.html")
targets = re.findall(r"href='([^']+)'", entry)
missing = [t for t in targets if not (ART / t).exists()]
check("I6", "styles.html links all resolve on disk", not missing,
      f"{len(targets)} links, missing={missing}")

# ---------------- summary ----------------
print("\n--- group tallies ---")
tally = {}
for gid, *_ in results:
    tally[gid] = tally.get(gid, 0) + 1
print(" ".join(f"{k}={v}" for k, v in sorted(tally.items())))
print(f"TOTAL assertions = {len(results)}  PASS = {n_pass}  FAIL = {n_fail}")
print(f"SVG bytes total  = {sum(len(read(SVG/s/p).encode()) for s in STYLES for p in PAGES)}")
print(f"PPTX bytes total = {sum(p.stat().st_size for p in sorted(PPTX.glob('*.pptx')))}")
for p in sorted(PPTX.glob("*.pptx")):
    print(f"  {p.name}: {p.stat().st_size}")
if n_fail:
    print("\n--- failures ---")
    for gid, name, ok, detail in results:
        if not ok:
            print(f"  {gid} {name} :: {detail}")
    raise SystemExit(1)
