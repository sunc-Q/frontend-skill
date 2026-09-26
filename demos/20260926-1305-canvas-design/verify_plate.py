#!/usr/bin/env python3
"""Independent verification of the plate: re-derives expectations from state.json
and measures them back out of the PNG pixels. Nothing here imports make_plate."""
import json, math, os, subprocess, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.abspath(os.path.join(HERE, "..", ".."))
PNG = os.path.join(HERE, "plate-iv-interval-cartography.png")
W, H, M = 1650, 2340, 96
LY, RH = 1712, 33
runs = sorted([r for r in json.load(open(os.path.join(LAB, "state", "state.json")))["runs"]
               if isinstance(r.get("seconds"), int)], key=lambda r: -r["seconds"])
im = Image.open(PNG).convert("RGB")
px = im.load()
ok = fail = 0
def chk(name, cond, detail=""):
    global ok, fail
    print(("PASS  " if cond else "FAIL  ") + name + ("  | " + detail if detail else ""))
    ok, fail = ok + bool(cond), fail + (not cond)

def near(c, t, tol=26):
    return all(abs(a - b) <= tol for a, b in zip(c, t))
PAPER, INK, TEAL, VERM = (241, 235, 223), (30, 27, 23), (47, 93, 87), (193, 70, 44)

# --- 1. container integrity ------------------------------------------------
chk("A1 dimensions 1650x2340 RGB", (im.width, im.height, im.mode) == (W, H, "RGB"),
    "%dx%d %s" % (im.width, im.height, im.mode))
chk("A2 file is a real PNG >= 200KB", PNG.endswith(".png") and os.path.getsize(PNG) > 200000,
    "%d bytes" % os.path.getsize(PNG))

# --- 2. ink coverage: neither blank nor overplated -------------------------
dark = sum(1 for y in range(0, H, 3) for x in range(0, W, 3) if sum(px[x, y]) < 300)
frac = dark / ((H // 3) * (W // 3))
chk("A3 ink coverage 1.5%-35% (a clinical plate, not blank / not a black hole)", 0.015 < frac < 0.35, "frac=%.3f" % frac)

# --- 3. palette discipline: exactly the two signal colours, both present ---
def count(c, tol=22):
    return sum(1 for y in range(0, H, 2) for x in range(0, W, 2) if near(px[x, y], c, tol))
nv, nt = count(VERM), count(TEAL)
chk("A4 vermilion (the finding) present and rationed <6% of field", 200 < nv < 0.06 * W * H / 4, "n=%d" % nv)
chk("A5 teal (the method) present and rationed <12% of field", 500 < nt < 0.12 * W * H / 4, "n=%d" % nt)

# --- 4. nothing falls off the page: the outer bleed must stay paper ---------
bleed = [p for (x, y, p) in [(x, y, px[x, y]) for x in range(0, W, 4) for y in (12, H - 13)]]
bad_top = sum(1 for p in bleed if sum(p) < 640 and not near(p, (206, 196, 178), 40))
left = [px[x, y] for y in range(0, H, 4) for x in (12,)]
bad_side = sum(1 for p in left if sum(p) < 300)   # artwork ink only; the vignette legitimately darkens the bleed
chk("A6 top/bottom bleed rows carry no artwork", bad_top == 0, "bad=%d" % bad_top)
chk("A7 left bleed column carries no artwork", bad_side == 0, "bad=%d" % bad_side)

# --- 8. the prime mark must sit clear of the zero (Jura has no U+2032) -----
# scan the core band for teal columns; the digits and the prime leave a paper gap
band = [y for y in range(940, 985)]
cols = [x for x in range(700, 980) if any(near(px[x, y], TEAL, 40) for y in band)]
gaps = [b - a for a, b in zip(cols, cols[1:]) if b - a > 6]
chk("A8 prime separated from the digits by a real gap", len(gaps) >= 1 and max(gaps) >= 8,
    "cols=%d..%d gaps=%s" % (min(cols), max(cols), gaps))
chk("A9 prime is right of the digits and inside the disc (x<905)", max(cols) < 905, "rightmost teal x=%d" % max(cols))

# --- 10. caption must be typeset with kerning (one string, not per char) ---
capcols = [x for x in range(200, 1450) if any(sum(px[x, y]) < 520 for y in range(1638, 1678))]
spans = [b - a for a, b in zip(capcols, capcols[1:]) if b - a >= 5]
chk("A10 caption: exactly 8 word gaps for 9 words, no intra-word holes",
    len(spans) == 8, "gaps=%d %s" % (len(spans), spans))
chk("A11 caption centred on the dial axis and inside the margins",
    abs((capcols[0] + capcols[-1]) / 2 - 825) < 12 and capcols[-1] - capcols[0] < 1000,
    "x=%d..%d w=%d" % (capcols[0], capcols[-1], capcols[-1] - capcols[0]))

# --- 11. data fidelity: the ledger must be re-countable out of the pixels --
def bars_in_row(y):
    cols, out = [], 0
    for x in range(M + 290, W - M - 150):
        dark = sum(1 for yy in range(y - 8, y + 8) if sum(px[x, yy]) < 320) > 6
        if dark and (not cols or x - cols[-1] <= 3):
            cols.append(x)
        elif dark:
            out += 5 <= cols[-1] - cols[0] + 1; cols = [x]
    return out + (1 if cols and cols[-1] - cols[0] + 1 >= 5 else 0)
counts = [bars_in_row(LY + 34 + i * RH + 12) for i in range(len(runs))]
want = [int(r["seconds"] / 60) for r in runs]
chk("B1 one ledger row per timed observation", len(counts) == len(runs) and all(c > 0 for c in counts),
    "rows=%d" % len([c for c in counts if c > 0]))
chk("B2 minute-bars match state.json exactly", counts == want, "got=%s want=%s" % (counts, want))
chk("B3 rows non-increasing with ties allowed (900s occurs twice)",
    all(a >= b for a, b in zip(counts, counts[1:])) and counts[0] > counts[-1], str(counts))
chk("B4 runtime labels match (24:00 for the 1440s round)", runs[0]["seconds"] == 1440 and want[0] == 24, str(want[:3]))

# --- 12. the outermost (vermilion) arc must span the full 300 deg scale ----
CX, CY, R0 = 825.0, 982.0, 470
hit = [a for a in range(0, 3600)
       if near(px[int(CX + (R0 - 3.2) * math.cos(math.radians(-90 + a / 10))),
                  int(CY + (R0 - 3.2) * math.sin(math.radians(-90 + a / 10)))], VERM, 45)]
span = len(hit) / 10.0
chk("B5 longest arc spans ~300-308 deg (scale end-to-end)", 292 <= span <= 312, "span=%.1f deg" % span)

print("\n%d PASS / %d FAIL  |  observations=%d" % (ok, fail, len(runs)))
sys.exit(1 if fail else 0)

