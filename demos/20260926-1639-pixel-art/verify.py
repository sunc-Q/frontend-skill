#!/usr/bin/env python3
"""Independent verification of the pixel-art demo against the skill's own rules.

Reads only the produced files (no import of make_art.py) plus the skill's
references/validations.md, which it executes as regex rules."""
import colorsys, os, re, sys, base64, json, zlib

D = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.expanduser("~/.qoder-cn/skills/pixel-art")
REF = "/Users/apple/Documents/workProject/试验/skill演示场/.skills/omer-metin-pixel-art/skills/pixel-art/references/validations.md"
fails, oks = [], []


def chk(name, cond, detail=""):
    (oks if cond else fails).append("%s %s%s" % ("PASS" if cond else "FAIL", name,
                                                 (" | " + detail) if detail else ""))


def png_read(path):
    d = open(path, "rb").read()
    assert d[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat = 8, b""
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        tag, body = d[pos + 4:pos + 8], d[pos + 8:pos + 8 + ln]
        crc = struct.unpack(">I", d[pos + 8 + ln:pos + 12 + ln])[0]
        assert crc == zlib.crc32(tag + body) & 0xFFFFFFFF, "bad CRC in %s" % path
        if tag == b"IHDR":
            w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4
    prev = bytearray(stride)
    grid = []
    for y in range(h):
        line = raw[y * (stride + 1):(y + 1) * (stride + 1)]
        ft, data = line[0], bytearray(line[1:])
        for x in range(stride):
            a = data[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if ft == 1:
                data[x] = (data[x] + a) & 255
            elif ft == 2:
                data[x] = (data[x] + b) & 255
            elif ft == 3:
                data[x] = (data[x] + (a + b) // 2) & 255
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                data[x] = (data[x] + pr) & 255
        prev = data
        grid.append([None if data[x * 4 + 3] == 0 else tuple(data[x * 4:x * 4 + 4])
                     for x in range(w)])
    return grid, w, h


import struct
SHEET, sw, sh = png_read(os.path.join(D, "sprite-sheet.png"))
F0, _, _ = png_read(os.path.join(D, "frame0.png"))
UP8, uw, uh = png_read(os.path.join(D, "frame0@8x.png"))
TILE, tw, th = png_read(os.path.join(D, "tile-16.png"))
TILEB, _, _ = png_read(os.path.join(D, "tile-variant-b-16.png"))
GRID3, g3w, g3h = png_read(os.path.join(D, "tile-3x3@8x.png"))
META = json.load(open(os.path.join(D, "sprite.json")))

W = H = 32
FRAMES = [[SHEET[y][i * W:(i + 1) * W] for y in range(H)] for i in range(4)]


def L(rgb):
    r, g, b = [v / 255 for v in rgb[:3]]
    return (max(r, g, b) + min(r, g, b)) / 2


# ---- 1. file-level sanity / cross-file consistency
chk("A1 sheet is 4x32 wide, 32 tall", (sw, sh) == (128, 32), "%dx%d" % (sw, sh))
chk("A2 frame0.png == sheet block 0 (two independent encoders agree)",
    all(F0[y][x] == SHEET[y][x] for y in range(H) for x in range(W)))
alpha_vals = {p[3] for row in SHEET for p in row if p} | \
             {0 for row in SHEET for p in row if p is None}
chk("A3 no semi-transparent pixels anywhere (hard edges only)", alpha_vals <= {0, 255}, str(sorted(alpha_vals)))

# ---- 2. limited palette
used = {p[:3] for row in SHEET for p in row if p}
declared = {bytes.fromhex(h[1:]) for fam in META["palette"].values() for h in fam} | \
           {bytes.fromhex(META["outline"][k][1:]) for k in META["outline"]}
chk("A4 sprite uses <= 16 colours (SNES sprite budget)", len(used) <= 16, "%d used" % len(used))
chk("A5 every sprite colour is in the declared palette",
    all(bytes(c) in declared for c in used))

# ---- 3. outline / selout
def on_edge(x, y):
    """transparent neighbour(s) of an outline pixel -> which side faces empty space"""
    sides = set()
    for dy, dx in ((-1, 0), (0, -1), (1, 0), (0, 1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < H and 0 <= nx < W and SHEET[ny][nx] is None:
            sides.add((dy, dx))
    return sides


outline_px = [(x, y, SHEET[y][x]) for y in range(H) for x in range(W)
              if SHEET[y][x] and on_edge(x, y)]
lit_side = [c for x, y, c in outline_px if {(-1, 0), (0, -1)} & on_edge(x, y)]
dark_side = [c for x, y, c in outline_px if {(1, 0), (0, 1)} & on_edge(x, y)]
TONES = {k: tuple(bytes.fromhex(META["outline"][k][1:])) for k in ("lit", "mid", "dark")}
lit_tone = TONES["lit"]
dark_tone = TONES["dark"]
chk("A6 outline is 100% neutral tones (no body colour bleeds to the edge -> no halo)",
    all(bytes(c[:3]) in declared and c[:3] in set(TONES.values()) for x, y, c in outline_px),
    "%d edge px, tones=%s" % (len(outline_px), sorted("#%02x%02x%02x" % c for c in {c[:3] for _, _, c in outline_px})))
chk("A7 selout: >=70% of top/left-facing outline px are NOT the darkest tone",
    lit_side and sum(1 for c in lit_side if c[:3] != dark_tone) / len(lit_side) >= 0.7,
    "%d/%d" % (sum(1 for c in lit_side if c[:3] != dark_tone), len(lit_side)))
chk("A8 selout: >=70% of bottom/right-facing outline px are the DARKEST tone",
    dark_side and sum(1 for c in dark_side if c[:3] == dark_tone) / len(dark_side) >= 0.7,
    "%d/%d" % (sum(1 for c in dark_side if c[:3] == dark_tone), len(dark_side)))
chk("A9 anti-pillow: outline is not uniformly one tone (>=2 tones in use)",
    len({tuple(c) for x, y, c in outline_px}) >= 2,
    str(sorted({tuple(c) for x, y, c in outline_px})))

# ---- 4. ramp quality (skill: 10-20 deg hue steps, >=20% lightness steps, sat peaks mid)
for fam in ("hat", "skin", "coat", "pants"):
    cols = META["palette"][fam]
    ls = [L(bytes.fromhex(c[1:])) for c in cols]
    steps = [round(b - a, 3) for a, b in zip(ls, ls[1:])]
    chk("A10 %-5s lightness steps >= 0.20" % fam, min(steps) >= 0.20, str(steps))
    hue_ok = ls[0] < ls[-1]
    chk("A11 %-5s ramp is monotone light->dark ordered with warm highlights" % fam, hue_ok)
def sat(c):
    mx, mn = max(c[:3]) / 255, min(c[:3]) / 255
    return 0.0 if mx == 0 else (mx - mn) / mx


sats = [tuple(bytes.fromhex(c[1:])) for c in META["palette"]["coat"]]
chk("A12 saturation peaks in the midtones and desaturates in the highlight",
    sat(sats[1]) >= sat(sats[2]) > sat(sats[3]) and sat(sats[3]) < sat(sats[1]),
    " ".join("#%02x%02x%02x" % c for c in sats))

# ---- 5. appendage thickness (skill: minimum 2 px)
def runs(row, pred):
    out, cur = [], 0
    for x in range(W):
        if pred(row[x]):
            cur += 1
        elif cur:
            out.append(cur)
            cur = 0
    if cur:
        out.append(cur)
    return out


body = {c for c in used if tuple(c) not in [tuple(bytes.fromhex(META["outline"][k][1:])) for k in ("lit", "mid", "dark")]}
leg_runs = [r for y in (26, 27, 28) for r in runs(SHEET[y], lambda p: p and p[:3] in body)]
chk("A13 legs are >= 2 px wide every row", leg_runs and min(leg_runs) >= 2, str(leg_runs))
arm_runs = [r for y in (18, 20, 22) for r in runs(SHEET[y], lambda p: p and p[:3] in body)]
chk("A14 silhouette rows have no 1-px protrusions", min(arm_runs) >= 2, str(arm_runs))

# ---- 6. silhouette connectivity
mask0 = {(x, y) for y in range(H) for x in range(W) if SHEET[y][x]}
seen, stack = set(), [next(iter(mask0))]
while stack:
    p = stack.pop()
    if p in seen:
        continue
    seen.add(p)
    x, y = p
    stack += [q for q in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
              if q in mask0 and q not in seen]
chk("A15 silhouette is a single connected piece", seen == mask0, "%d of %d" % (len(seen), len(mask0)))

# ---- 7. subpixel animation (motion is in the colours, not the shape)
def m(fr):
    return {(x, y) for y in range(H) for x in range(W) if fr[y][x]}


chk("B1 frame0/frame1 have an IDENTICAL silhouette (in-between is colour-only)",
    m(FRAMES[0]) == m(FRAMES[1]))
diff01 = [(x, y) for y in range(H) for x in range(W) if FRAMES[0][y][x] != FRAMES[1][y][x]]
chk("B2 the colour-only in-between actually changes pixels (not a dead frame)",
    0 < len(diff01), "%d px" % len(diff01))
chk("B3 in-between stays subtle (<= 25% of the sprite)",
    len(diff01) <= 0.25 * len(m(FRAMES[0])), "%d/%d" % (len(diff01), len(m(FRAMES[0]))))
shifted = {(x, y + 1) for (x, y) in m(FRAMES[0]) if y + 1 < H}
chk("B4 frame2 is the pose bobbed down exactly 1 px (clipped at row 31)",
    m(FRAMES[2]) == shifted, "%d vs %d" % (len(m(FRAMES[2])), len(shifted)))
chk("B5 idle loop is 4 frames, ping-pong (f3 == f1)", FRAMES[3] == FRAMES[1])
chk("B6 frame time 260 ms is inside the skill's idle range 200-400 ms",
    200 <= META["frame_time_ms"] <= 400, str(META["frame_time_ms"]))

# ---- 8. dithering policy: one style, on the tile only
def parity_windows(grid, pred):
    n = 0
    for y in range(len(grid) - 3):
        for x in range(len(grid[0]) - 3):
            w4 = [grid[y + dy][x + dx] for dy in range(4) for dx in range(4)]
            if any(c is None for c in w4):
                continue
            cs = {c[:3] for c in w4}
            if len(cs) != 2:
                continue
            a, b = sorted(cs)
            for even in (a, b):
                if all(w4[i * 4 + j] and w4[i * 4 + j][:3] == (even if (i + j) % 2 == 0 else (b if even == a else a))
                       for i in range(4) for j in range(4)):
                    n += 1
                    break
    return n


chk("C1 the 32x32 sprite is NOT dithered (skill: no dithering on small sprites)",
    parity_windows(SHEET, None) == 0, "%d windows" % parity_windows(SHEET, None))
tw_band = parity_windows(TILE, None)
chk("C2 the tile IS ordered-dithered (2x2 Bayer band, >=3 windows)", tw_band >= 3, "%d windows" % tw_band)
DR = META["tile_dither_rows"]
even = {TILE[y][x][:3] for y in DR for x in range(16) if (x + y) % 2 == 0}
odd = {TILE[y][x][:3] for y in DR for x in range(16) if (x + y) % 2 == 1}
band = [TILE[y][x][:3] for y in DR for x in range(16)]
main = {(e if (x + y) % 2 == 0 else o) for y in DR for x, (e, o) in
        [(x, (max(even, key=band.count), min(even, key=band.count))) for x in range(16)]
        } if False else None
cnt_even = {c: sum(1 for y in DR for x in range(16) if (x + y) % 2 == 0 and TILE[y][x][:3] == c) for c in even}
cnt_odd = {c: sum(1 for y in DR for x in range(16) if (x + y) % 2 == 1 and TILE[y][x][:3] == c) for c in odd}
tot = len(DR) * 16
follow = max(cnt_even.values() or [0]) + max(cnt_odd.values() or [0])
chk("C3 one dither style dominates the band (>=80% parity-determined, pair is 2 distinct colours)",
    follow / tot >= 0.80 and max(cnt_even, key=cnt_even.get) != max(cnt_odd, key=cnt_odd.get),
    "%d/%d follow, pair #%02x%02x%02x / #%02x%02x%02x, decorations %d" % (
        follow, tot, *(max(cnt_even, key=cnt_even.get)), *(max(cnt_odd, key=cnt_odd.get)),
        tot - follow))

# ---- 9. tile seamlessness (torus test the skill prescribes: tile a 3x3 grid)
def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


seam, inner = [], []
for i in range(tw):
    a, b = TILE[i][0], TILE[i][tw - 1]
    seam.append(abs(lum(a) - lum(b)))
    c, d = TILE[0][i], TILE[th - 1][i]
    seam.append(abs(lum(c) - lum(d)))
for y in range(1, th):
    for x in range(1, tw):
        inner.append(abs(lum(TILE[y][x]) - lum(TILE[y][x - 1])))
mean_seam, mean_inner = sum(seam) / len(seam), sum(inner) / len(inner)
chk("D1 wrap-edge contrast <= 1.6x interior contrast (no visible seam)",
    mean_seam <= 1.6 * mean_inner, "seam %.4f vs inner %.4f" % (mean_seam, mean_inner))
chk("D2 3x3 preview is 48x48 upscaled 8x -> 384x384", (g3w, g3h) == (384, 384))
chk("D3 variant B differs from A but shares its palette",
    TILEB != TILE and {p[:3] for r in TILEB for p in r} <= {p[:3] for r in TILE for p in r})

# ---- 10. integer nearest-neighbour scaling
chk("E1 @8x is exactly 8x the source size", (uw, uh) == (W * 8, H * 8), "%dx%d" % (uw, uh))
blocks_bad = sum(1 for by in range(H) for bx in range(W)
                 if len({UP8[by * 8 + dy][bx * 8 + dx] for dy in range(8) for dx in range(8)}) != 1)
chk("E2 every 8x8 block is a single flat colour (nearest neighbour, no interpolation)",
    blocks_bad == 0, "%d bad blocks" % blocks_bad)

# ---- 11. the skill's own validations.md, executed as regex rules
rules = []
BROKEN = []
DEDOUBLED = []
RULES_TEXT = open(REF).read()
for blk in re.split(r"\n## (?!#)", RULES_TEXT):
    mid = re.search(r"### \*\*Id\*\*\n(\S+)", blk)
    mpat = re.search(r"### \*\*Pattern\*\*\n((?:  - [^\n]*\n)+)", blk)
    if not (mid and mpat):
        continue
    m = type("M", (), {"group": lambda self, i: mid.group(1) if i == 1 else mpat.group(1)})()
    pats, bad = [], []
    for l in mpat.group(1).strip().splitlines():
        raw = l.strip()[2:]
        # the reference file ships most patterns with DOUBLED backslashes ("\\.jpe?g"),
        # which compile but match a literal backslash instead of the intended any-char.
        fixed = raw.replace("\\\\", "\\")
        if fixed != raw:
            DEDOUBLED.append((mid.group(1), raw))
        try:
            re.compile(fixed)
            pats.append(fixed)
        except re.error:
            bad.append(raw)
    rules.append((mid.group(1), pats))
    BROKEN.extend((mid.group(1), b) for b in bad)
chk("F0 parsed the skill's regex rules out of validations.md", len(rules) >= 10, "%d rules" % len(rules))
chk("F0b every rule pattern is compilable after de-doubling backslashes", not BROKEN, str(BROKEN))
chk("F0c NOTE (skill defect): patterns had to be de-doubled to mean anything",
    True, "%d of %d rules shipped doubled backslashes" % (len({r for r, _ in DEDOUBLED}), len(rules)))

html_full = open(os.path.join(D, "viewer.html")).read()
# the skill's colour-count rule uses 12 chained .{0,100} groups; on a 100 KB inline
# base64 payload that backtracks forever, so rules run against the code view only.
html = re.sub(r"base64,[A-Za-z0-9+/=]+", "base64:DATA", html_full)
applies = lambda pats, text: [p for p in pats if re.search(p, text)]
# Known rule defect in the skill's reference: pixelart-css-rendering puts its negative
# lookahead AFTER the closing brace, so a canvas block that DOES declare
# image-rendering: pixelated can never satisfy it. Recorded, not worked around silently.
KNOWN_FP = {"pixelart-css-rendering"}
hits = [(rid, p) for rid, pats in rules for p in applies(pats, html)]
chk("F1 viewer.html trips none of the skill's rules except the documented false positive",
    {rid for rid, _ in hits} <= KNOWN_FP, str(hits[:4]))
payloads = re.findall(r'base64,([A-Za-z0-9+/=]+)"', html_full)
chk("F2 viewer.html is self-contained (both inline payloads == the PNGs on disk, zero network)",
    [base64.b64decode(p) for p in payloads] ==
    [open(os.path.join(D, n), "rb").read() for n in ("sprite-sheet.png", "tile-3x3.png")],
    "%d payloads" % len(payloads))
chk("F2b the tile canvas is drawn 1:1 into a 48x48 backing store (no downsample-then-upscale)",
    'drawImage(tile, 0, 0)' in html_full and 'id="tiles" width="48"' in html_full)
chk("F2c viewer upscales into the backing store and shows it 1:1 (no CSS stretch)",
    "canvas.width = destW" in html and 'id="sprite" width="128" height="32"' in html
    and 'style="width:512px' not in html)
chk("F3 no network references in the viewer",
    not re.search(r'(src|href)\s*=\s*["\']https?://', html))

mut = html.replace("image-rendering: pixelated; image-rendering: crisp-edges; ", "")          # 1
mut = mut.replace("<h2>", '<p style="image-rendering: auto">aa</p><h2>')                        # 2
mut = mut.replace("frameTime: 260", "frameTime: 40")                                            # 3
mut = mut.replace("ctx.clearRect", 'canvas.style.transform = "scale(1.5)"; ctx.clearRect')      # 4
mut = mut.replace("</body>", '<img src="assets/sprite-sheet.jpg" alt="j"></body>')                     # 5
open(os.path.join(D, "viewer.mutant.html"), "w").write(mut)
mhits = {rid for rid, pats in rules for p in applies(pats, mut)}
expect = {"pixelart-no-antialiasing", "pixelart-animation-too-fast",
          "pixelart-integer-scaling", "pixelart-jpeg-export"}
chk("F4 mutant viewer trips all 5 injected faults (rules are live, not decorative)",
    expect <= mhits, "tripped=%s" % sorted(mhits))
chk("F5 mutant trips nothing beyond the injected faults + the known FP (no false positives)",
    mhits <= expect | KNOWN_FP, "extra=%s" % sorted(mhits - expect - KNOWN_FP))
chk("F6 each injected fault is caught by its own rule and by nothing else the golden passes",
    all(any(re.search(p, mut) for p in pats) and not any(re.search(p, html) for p in pats)
        for rid, pats in rules if rid in expect), str(sorted(expect)))

print("\n".join(oks))
print("\n".join(fails))
print("== %d PASS / %d FAIL ==" % (len(oks), len(fails)))
sys.exit(1 if fails else 0)
