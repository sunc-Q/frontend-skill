#!/usr/bin/env python3
"""Plate IV — Interval Cartography. Postage-stamp portrait PNG, Pillow only.
Data is read live from ../../state/state.json (round durations)."""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

LAB = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
HERE = os.path.dirname(os.path.abspath(__file__))
# self-contained: the five OFL fonts used are vendored next to this script
FDIR = os.path.join(HERE, "fonts") if os.path.isdir(os.path.join(HERE, "fonts")) \
    else os.path.join(LAB, ".skills", "anthropic-skills", "skills", "canvas-design", "canvas-fonts")
OUT = os.path.join(HERE, "plate-iv-interval-cartography.png")

W, H = 1650, 2340
M = 96
PAPER, PAPER_DEEP = (241, 235, 223), (231, 223, 207)
INK, INK_SOFT = (30, 27, 23), (74, 68, 59)
TEAL, VERM = (47, 93, 87), (193, 70, 44)

def font(name, size):
    return ImageFont.truetype(os.path.join(FDIR, name), size)

F_TITLE, F_CAP = font("Italiana-Regular.ttf", 104), font("InstrumentSerif-Italic.ttf", 34)
F_NUM, F_NUMB = font("Jura-Light.ttf", 30), font("Jura-Medium.ttf", 36)
F_MONO, F_MONOB = font("DMMono-Regular.ttf", 24), font("DMMono-Regular.ttf", 20)
F_CORE = font("Jura-Medium.ttf", 78)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img, "RGB")
boxes = []  # protected layout boxes: (name, x0,y0,x1,y1)

def tracked(x, y, s, f, fill, tracking=0, anchor_y="la"):
    """Letter-spaced text; returns its box."""
    cx, minx, miny, maxx, maxy = x, 1e9, 1e9, -1e9, -1e9
    for ch in s:
        b = d.textbbox((cx, y), ch, font=f, anchor=anchor_y)
        minx, miny = min(minx, b[0]), min(miny, b[1])
        maxx, maxy = max(maxx, b[2]), max(maxy, b[3])
        d.text((cx, y), ch, font=f, fill=fill, anchor=anchor_y)
        cx += d.textlength(ch, font=f) + tracking
    return (minx, miny, maxx, maxy)

def center(cx, cy, s, f, fill, tracking=0):
    wpx = sum(d.textlength(c, font=f) for c in s) + tracking * (len(s) - 1)
    return tracked(cx - wpx / 2, cy, s, f, fill, tracking, "ma")

# ---------- 1. paper: fibre noise + engineering grid + vignette ----------
rnd = random.Random(3060)
for _ in range(150000):
    x, y = rnd.randrange(W), rnd.randrange(H)
    v = rnd.random()
    c = PAPER_DEEP if v < .62 else (247, 243, 234)
    d.point((x, y), fill=c)
grid = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grid)
for gx in range(M, W - M + 1, 30):
    gd.line((gx, M, gx, H - M), fill=(74, 68, 59, 9))
for gy in range(M, H - M + 1, 30):
    gd.line((M, gy, W - M, gy), fill=(74, 68, 59, 9))
for gx in range(M, W - M + 1, 150):
    gd.line((gx, M, gx, H - M), fill=(74, 68, 59, 20))
for gy in range(M, H - M + 1, 150):
    gd.line((M, gy, W - M, gy), fill=(74, 68, 59, 20))
img.paste(grid, (0, 0), grid)
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.ellipse((-W * .28, -H * .2, W * 1.28, H * 1.2), fill=255)
vd.ellipse((-W * .18, -H * .09, W * 1.18, H * 1.09), fill=0)
img = Image.composite(img, Image.new("RGB", (W, H), (206, 196, 178)),
                      vig.filter(ImageFilter.GaussianBlur(210)))
d = ImageDraw.Draw(img, "RGB")

# ---------- 2. data ----------
runs = [r for r in json.load(open(os.path.join(LAB, "state", "state.json")))["runs"]
        if isinstance(r.get("seconds"), int)]
runs.sort(key=lambda r: -r["seconds"])
smax = max(r["seconds"] for r in runs)
N = len(runs)

# ---------- 3. masthead ----------
boxes.append(("frame", M - 26, M - 26, W - M + 26, H - M + 26))
d.rectangle((M - 26, M - 26, W - M + 26, H - M + 26), outline=INK, width=2)
tb = center(W / 2, 196, "INTERVAL CARTOGRAPHY", F_TITLE, INK, tracking=13)
boxes.append(("title", tb[0] - 8, tb[1] - 8, tb[2] + 8, tb[3] + 8))
center(W / 2, 300, "PLATE IV  ·  THE HALF-HOUR OBSERVER", F_MONO, TEAL, tracking=5)
d.line((M, 352, W - M, 352), fill=INK, width=1)
d.line((M, 356, W - M, 356), fill=INK_SOFT, width=1)

# ---------- 4. the dial ----------
CX, CY, R = W / 2, 982, 556
# hour fan (method) — hairlines every 30 min of a day
for i in range(48):
    a = math.radians(-90 + i * 7.5)
    r0 = 118 if i % 2 else 108
    d.line((CX + r0 * math.cos(a), CY + r0 * math.sin(a),
            CX + R * math.cos(a), CY + R * math.sin(a)), fill=PAPER, width=1)
for i in range(48):
    a = math.radians(-90 + i * 7.5)
    inner = R - (34 if i % 4 == 0 else 16)
    d.line((CX + inner * math.cos(a), CY + inner * math.sin(a),
            CX + R * math.cos(a), CY + R * math.sin(a)),
           fill=INK if i % 4 == 0 else INK_SOFT, width=3 if i % 4 == 0 else 1)
d.ellipse((CX - R - 8, CY - R - 8, CX + R + 8, CY + R + 8), outline=INK, width=2)
d.ellipse((CX - (R - 44), CY - (R - 44), CX + (R - 44), CY + (R - 44)), outline=INK_SOFT, width=1)
for h in range(0, 24, 3):  # 8 numerals, 3h apart
    a = math.radians(-90 + h * 15)
    rr = R + 34
    center(CX + rr * math.cos(a), CY + rr * math.sin(a) - 17, "%02d" % h, F_NUMB, INK)
# observation slots on the bezel (14 of 48) — cool = method
ang_step = 360 / 48
for i in range(N):
    a = math.radians(-90 + ((i * 24 + 13) % 48) * ang_step)
    x, y = CX + (R - 22) * math.cos(a), CY + (R - 22) * math.sin(a)
    d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=TEAL)
# duration rings: one per observation, arc = its runtime
for i, r in enumerate(runs):
    rr = 470 - i * 25
    frac = r["seconds"] / smax
    span = 8 + 300 * frac
    col = VERM if i == 0 else (TEAL if i % 3 == 0 else INK)
    d.arc((CX - rr, CY - rr, CX + rr, CY + rr), start=-90, end=-90 + span, fill=col, width=9)
    a = math.radians(-90 + span)
    x, y = CX + rr * math.cos(a), CY + rr * math.sin(a)
    d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=col)
    d.ellipse((CX - rr, CY - rr, CX + rr, CY + rr), outline=(231, 223, 207), width=1)
    # 5-minute graduation ticks along the ring path
    for k in range(1, int(r["seconds"] / 300) + 1):
        ta = math.radians(-90 + 8 + 300 * (k * 300 / smax))
        d.line((CX + (rr - 12) * math.cos(ta), CY + (rr - 12) * math.sin(ta),
                CX + (rr + 12) * math.cos(ta), CY + (rr + 12) * math.sin(ta)), fill=PAPER, width=2)
# core disc
d.ellipse((CX - 112, CY - 112, CX + 112, CY + 112), fill=PAPER_DEEP, outline=INK, width=2)
cw = center(CX - 22, CY - 42, "30", F_CORE, TEAL)          # group shifted left to seat the prime
px = cw[2] + 9                                              # hand-set prime: Jura lacks U+2032
d.line((px, CY - 44, px + 7, CY - 6), fill=TEAL, width=6)
d.line((px, CY - 44, px + 7, CY - 6), fill=TEAL, width=5)
center(CX, CY + 52, "ONE EYE-OPENING", F_MONOB, INK_SOFT, tracking=3)
boxes.append(("dial", CX - R - 46, CY - R - 46, CX + R + 46, CY + R + 46))

# ---------- 5. caption ----------
WORDS = {12: "twelve", 13: "thirteen", 14: "fourteen", 15: "fifteen"}
cap = "the same distance between two appearances, measured %s times" % WORDS.get(N, str(N))
d.text((W / 2, 1654), cap, font=F_CAP, fill=INK_SOFT, anchor="mm")

# ---------- 6. ledger (whisper register) ----------
LY, RH = 1712, 33
d.line((M, LY - 22, W - M, LY - 22), fill=INK, width=1)
center(M + 130, LY + 4, "OBSERVATION", F_MONOB, TEAL, tracking=2)
center(W - M - 60, LY + 4, "RUNTIME", F_MONOB, TEAL, tracking=2)
for i, r in enumerate(runs):
    y = LY + 34 + i * RH
    name = (r["skill"][:15]).lower()
    d.text((M, y), "%02d" % (i + 1), font=F_MONO, fill=INK, anchor="la")
    d.text((M + 52, y), name, font=F_MONO, fill=INK if i else VERM, anchor="la")
    mins = r["seconds"] / 60
    x = M + 300
    d.line((x, y + 12, W - M - 150, y + 12), fill=(216, 206, 188), width=1)
    for k in range(int(mins)):
        xx = x + k * 13
        d.rectangle((xx, y + 3, xx + 6, y + 21), fill=INK if k % 5 else INK_SOFT)
    xend = x + int(mins) * 13
    d.rectangle((xend + 10, y + 3, xend + 13, y + 21), fill=VERM if i == 0 else TEAL)
    mm, ss = divmod(r["seconds"], 60)
    d.text((W - M, y), "%02d:%02d" % (mm, ss), font=F_MONO, fill=VERM if i == 0 else INK, anchor="ra")
    d.line((M, y + RH - 9, W - M, y + RH - 9), fill=(231, 223, 207), width=1)
boxes.append(("ledger", M, LY - 10, W - M, LY + 34 + N * RH))

# ---------- 7. footer + registration marks ----------
FY = H - M - 34
d.line((M, FY - 26, W - M, FY - 26), fill=INK, width=1)
d.text((M, FY), "SKILL DEMONSTRATION FIELD  ·  INTERVAL CARTOGRAPHY  ·  MMXXVI", font=F_MONO, fill=INK_SOFT, anchor="la")
d.text((W - M, FY), "%d × %d PX  ·  PILLOW" % (W, H), font=F_MONO, fill=INK_SOFT, anchor="ra")
for (rx, ry) in [(M - 26, M - 26), (W - M + 26, M - 26), (M - 26, H - M + 26), (W - M + 26, H - M + 26)]:
    d.line((rx - 16, ry, rx + 16, ry), fill=VERM, width=2)
    d.line((rx, ry - 16, rx, ry + 16), fill=VERM, width=2)

img.save(OUT)
json.dump({"boxes": [[b[0], *b[1:]] for b in boxes], "w": W, "h": H,
           "observations": N, "smax": smax}, open(os.path.join(os.path.dirname(OUT), "layout.json"), "w"), indent=1)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
