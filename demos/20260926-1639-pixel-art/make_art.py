#!/usr/bin/env python3
"""Pixel-art skill demo: build a 32x32 SNES-style chibi-wanderer idle sprite
(4 frames, selout outline, hue-shifted ramps, subpixel in-between), a seamless
16x16 tile + 3x3 test grid, a palette card, and a pixelated HTML viewer.

Follows ~/.qoder-cn/skills/pixel-art (references/patterns.md)."""
import colorsys, os, struct, zlib, base64, json

OUT = os.path.dirname(os.path.abspath(__file__))
W = H = 32

# ---------------------------------------------------------------- palette
def hsl(h, s, l):
    h = (h % 360) / 360.0
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))

def ramp(base_hue, name):
    """4-step directional ramp: shadows shift cool, highlights warm,
    saturation peaks in midtones, lightness steps 0.22 (> skill's 20% floor).
    hue step = 10 deg per step (skill: 'each step is 10-20 degrees')."""
    out = []
    for i, L in enumerate([0.16, 0.38, 0.60, 0.82]):
        hue = base_hue + 18 - i * 10
        sat = [0.55, 0.62, 0.55, 0.40][i]
        out.append({"name": "%s%d" % (name, i), "rgb": hsl(hue, sat, L),
                    "h": hue, "s": sat, "l": L})
    return out

PAL = {}
PAL["hat"] = ramp(350, "hat")      # crimson hood/hat
PAL["skin"] = ramp(30, "skin")     # base near the skill's skin example
PAL["coat"] = ramp(190, "coat")    # teal coat
PAL["pants"] = ramp(265, "pants")  # violet-grey trousers
GRAY = [{"name": "neutral%d" % i, "rgb": c, "h": 0.0, "s": 0.0, "l": l}
        for i, (c, l) in enumerate([(hsl(0, 0, 0.08), 0.08), (hsl(220, 0.10, 0.42), 0.42),
                                    (hsl(40, 0.14, 0.72), 0.72)])]
PAL["gray"] = GRAY
EYE = GRAY[0]["rgb"]
IDX = {}
for fam in ("hat", "skin", "coat", "pants"):
    for i, e in enumerate(PAL[fam]):
        IDX[e["name"]] = e["rgb"]
for e in GRAY:
    IDX[e["name"]] = e["rgb"]
RGB2NAME = {v: k for k, v in IDX.items()}
OUTLINE = {"dark": GRAY[0]["rgb"], "mid": GRAY[1]["rgb"], "lit": GRAY[2]["rgb"]}

# ---------------------------------------------------------------- shape
G = [[None] * W for _ in range(H)]          # family id per pixel

def fill(x0, x1, y0, y1, fam, skip=()):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x, y) in skip:
                continue
            G[y][x] = fam

fill(9, 22, 2, 6, "hat", skip=((9, 2), (22, 2)))            # crown
fill(7, 24, 7, 8, "hat", skip=((7, 7), (24, 7)))            # brim
fill(11, 20, 9, 15, "skin")                                  # head
for x in range(11, 21):                                      # hairline under brim
    G[9][x] = "hairline"
fill(13, 14, 12, 13, "eye")
fill(17, 18, 12, 13, "eye")
fill(10, 21, 16, 24, "coat")                                 # torso
fill(7, 9, 16, 23, "coat")                                   # arms
fill(22, 24, 16, 23, "coat")
fill(7, 9, 24, 24, "skin")                                   # hands
fill(22, 24, 24, 24, "skin")
fill(10, 21, 25, 25, "gray")                                 # belt
fill(12, 14, 26, 28, "hat")                                  # legs
fill(17, 19, 26, 28, "hat")
fill(11, 15, 29, 30, "hat")                                   # boots
fill(16, 20, 29, 30, "hat")
for y in range(H):                                     # keep row 31 free for the bob frame
    if G[y][31] is not None:
        raise SystemExit("column 31 occupied at y=%d, no room for the bob" % y)

def fam_of(c):
    if c == "hairline":
        return "hat"
    if c == "eye":
        return None
    return c

# ---------------------------------------------------------------- shading
def same(G, y, x, cell):
    return 0 <= y < H and 0 <= x < W and G[y][x] == cell

def colorize(base):
    """base[y][x] -> rgb, directional shading (light from top-left) + selout outline."""
    art = [[None] * W for _ in range(H)]
    meta = [[None] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            c = base[y][x]
            if c is None:
                continue
            if c == "eye":
                art[y][x] = EYE
                meta[y][x] = {"role": "detail", "fam": None, "rung": 0}
                continue
            fam = fam_of(c)
            top = not same(base, y - 1, x, c)
            left = not same(base, y, x - 1, c)
            bot = not same(base, y + 1, x, c)
            right = not same(base, y, x + 1, c)
            score = (top + left) - (bot + right)             # -2..+2
            rung = {2: 3, 1: 2, 0: 2, -1: 1, -2: 0}[score] if c != "hairline" else 0
            idx = {0: 0, 1: 1, 2: 1, 3: 2}[rung] if fam == "gray" else rung
            art[y][x] = PAL[fam][idx]["rgb"]
            meta[y][x] = {"role": "body", "fam": fam, "rung": rung,
                          "top": top, "left": left, "bot": bot, "right": right}
    # selout: outline tone depends on which side of the sprite the empty space is
    solid = [[a is not None for a in row] for row in art]
    DIRS = ((-1, 0, "dark"), (0, -1, "dark"), (-1, -1, "dark"),
            (1, 0, "lit"), (0, 1, "lit"), (1, 1, "lit"))
    for y in range(H):
        for x in range(W):
            if solid[y][x]:
                continue
            lit = dark = False
            for dy, dx, kind in DIRS:
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and solid[ny][nx]:
                    if kind == "lit":
                        lit = True
                    else:
                        dark = True
            if not (lit or dark):
                continue
            tone = "dark" if (dark and not lit) else ("lit" if (lit and not dark) else "mid")
            art[y][x] = OUTLINE[tone]
            meta[y][x] = {"role": "outline", "tone": tone}
    return art, meta

def shift_down(art):
    out = [[None] * W for _ in range(H)]
    for y in range(1, H):
        out[y] = list(art[y - 1])
    return out

def lighten_outline(art, meta):
    """Subpixel in-between: silhouette untouched, only the outline tones move."""
    a2 = [row[:] for row in art]
    n = 0
    for y in range(H):
        for x in range(W):
            m = meta[y][x]
            if m and m["role"] == "outline":
                t = m["tone"]
                a2[y][x] = {"dark": OUTLINE["mid"], "mid": OUTLINE["lit"],
                            "lit": OUTLINE["lit"]}[t]
                n += 1
    return a2, n

artA, metaA = colorize(G)
artB = shift_down(artA)
artC, outline_px = lighten_outline(artA, metaA)
FRAMES = [artA, artC, artB, artC]           # ping-pong idle, 4 frames

# ---------------------------------------------------------------- tile (16x16, seamless on a torus)
TS = 16
DITHER_Y = (7, 8, 9, 10)

def wrap_put(t, x, y, c):
    t[y % TS][x % TS] = c

def build_tile(variant):
    t = [[PAL["coat"][2]["rgb"]] * TS for _ in range(TS)]
    for y in range(TS):
        for x in range(TS):
            if y in DITHER_Y:
                bayer = ((x % 2) ^ (y % 2))                    # one style: ordered 2x2
                t[y][x] = PAL["coat"][2]["rgb"] if bayer else PAL["coat"][1]["rgb"]
    speck = [(1, 6), (5, 9), (9, 12), (13, 7), (3, 14), (11, 4)]
    for i, (x, y) in enumerate(speck):
        c = GRAY[1]["rgb"] if (i + variant) % 2 else PAL["pants"][1]["rgb"]
        for dx, dy in ((0, 0), (1, 0), (0, 1)):                 # 2px blobs, wrap-safe
            wrap_put(t, x + dx, y + dy, c)
    if variant:
        for x, y in ((7, 11), (8, 11), (7, 12)):
            wrap_put(t, x, y, PAL["pants"][1]["rgb"])
    return t

TILES = [build_tile(v) for v in (0, 1)]

def tile_seam_grid(tile, n=3):
    return [[tile[y % TS][x % TS] for x in range(TS * n)] for y in range(TS * n)]

# ---------------------------------------------------------------- png io
def png(path, pixels, scale=1):
    h = len(pixels)
    w = len(pixels[0])
    bh, bw = h * scale, w * scale
    rows = []
    for y in range(bh):
        row = bytearray([0])
        sy = y // scale
        for x in range(bw):
            c = pixels[sy][x // scale]
            if c is None:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((c[0], c[1], c[2], 255))
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + \
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", bw, bh, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))
    return os.path.getsize(path)

def png_read(path):
    """Independent minimal decoder (filter 0..4) -> [[ (r,g,b,a) | None ]]."""
    d = open(path, "rb").read()
    assert d[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos, idat, w, h = 8, b"", None, None
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        tag = d[pos + 4:pos + 8]
        body = d[pos + 8:pos + 8 + ln]
        crc = struct.unpack(">I", d[pos + 8 + ln:pos + 12 + ln])[0]
        assert crc == zlib.crc32(tag + body) & 0xFFFFFFFF, "crc mismatch %s" % tag
        if tag == b"IHDR":
            w, h, depth, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", body)
            assert (depth, ctype, inter) == (8, 6, 0), "expected rgba8 non-interlaced"
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
        row = []
        for x in range(w):
            r, g, b2, al = data[x * 4:x * 4 + 4]
            row.append(None if al == 0 else (r, g, b2))
        grid.append(row)
    return grid

# ---------------------------------------------------------------- emit
os.makedirs(OUT, exist_ok=True)
sheet = [[None] * (W * 4) for _ in range(H)]
for i, fr in enumerate(FRAMES):
    for y in range(H):
        for x in range(W):
            sheet[y][i * W + x] = fr[y][x]
sizes = {}
sizes["sprite-sheet.png"] = png(os.path.join(OUT, "sprite-sheet.png"), sheet)
sizes["sprite-idle-4x.png"] = png(os.path.join(OUT, "sprite-idle-4x.png"), sheet, 4)
for i, fr in enumerate(FRAMES):
    sizes["frame%d.png" % i] = png(os.path.join(OUT, "frame%d.png" % i), fr)
    sizes["frame%d@8x.png" % i] = png(os.path.join(OUT, "frame%d@8x.png" % i), fr, 8)
sizes["tile-16.png"] = png(os.path.join(OUT, "tile-16.png"), TILES[0])
sizes["tile-variant-b-16.png"] = png(os.path.join(OUT, "tile-variant-b-16.png"), TILES[1])
sizes["tile-3x3@8x.png"] = png(os.path.join(OUT, "tile-3x3@8x.png"), tile_seam_grid(TILES[0]), 8)
sizes["tile-3x3.png"] = png(os.path.join(OUT, "tile-3x3.png"), tile_seam_grid(TILES[0]))

def palette_card():
    cells = []
    for fam in ("hat", "skin", "coat", "pants", "gray"):
        for e in PAL[fam]:
            cells.append((e["name"], e["rgb"]))
    cw, chh, pad = 34, 26, 4
    wdt = len(cells) * (cw + pad) + pad
    grid = [[(12, 12, 14)] * wdt for _ in range(chh + 2 * pad)]
    for i, (nm, rgb) in enumerate(cells):
        x0 = pad + i * (cw + pad)
        for y in range(pad, pad + chh):
            for x in range(x0, x0 + cw):
                grid[y][x] = rgb
    return grid, cells

pcard, CELLS = palette_card()
sizes["palette-card.png"] = png(os.path.join(OUT, "palette-card.png"), pcard)

b64 = lambda p: base64.b64encode(open(os.path.join(OUT, p), "rb").read()).decode()
SHEET64, TILE64 = b64("sprite-sheet.png"), b64("tile-3x3.png")
viewer = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Lantern Wanderer - pixel art idle</title>
<style>
  body { background:#0b0b0f; color:#cfd3da; font:12px/1.5 ui-monospace,Menlo,monospace; margin:18px; }
  canvas { image-rendering: pixelated; image-rendering: crisp-edges; border:1px solid #2a2a33; background:#1a2b33; }
  .row { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; }
  button { background:#1d1d26; color:#cfd3da; border:1px solid #3a3a48; font:inherit; padding:3px 9px; }
  #meta { color:#8b9099; max-width:640px; }
</style></head><body>
<h2>Lantern Wanderer &mdash; 32x32 / 4-frame subpixel idle / 14 colors</h2>
<div class="row">
  <div><canvas id="sprite" width="128" height="32"></canvas>
    <p>scale <button id="s1">1x</button><button id="s2">2x</button><button id="s3">4x</button>
       <button id="s5">8x</button> &nbsp; frame time
       <button id="tSlow">400ms</button><button id="tIdle">260ms</button><button id="tFast">150ms</button></p>
  </div>
  <div><canvas id="tiles" width="48" height="48" style="width:384px;height:384px;image-rendering:pixelated"></canvas>
    <p>16x16 tile painted 3x3 (48x48 source, CSS-upscaled 8x) &mdash; seam check</p></div>
</div>
<p id="meta">Integer scaling only, nearest-neighbour (no smoothing). Outline uses selective
outlining for light from the top-left; the in-between frame changes outline tones, not the
silhouette (subpixel animation). One dither style (ordered 2x2) and only on the tile, never on
the 32x32 sprite.</p>
<script id="app">
const SHEET = "data:image/png;base64,__SHEET__";
const TILE  = "data:image/png;base64,__TILE__";
const FRAME_W = 32, FRAME_H = 32, FRAME_COUNT = 4;
let ctx = document.getElementById("sprite").getContext("2d");
ctx.imageSmoothingEnabled = false;
const tctx = document.getElementById("tiles").getContext("2d");
tctx.imageSmoothingEnabled = false;
const state = { frame: 0, scale: 4, frameTime: 260 };
let img = new Image(), tile = new Image();
function drawSprite() {
  const canvas = document.getElementById("sprite");
  const destW = FRAME_W * state.scale, destH = FRAME_H * state.scale;
  // upscale into the backing store with nearest neighbour, then 1:1 in CSS,
  // so the pixels on screen are exactly `scale` device pixels wide
  canvas.width = destW; canvas.height = destH;
  canvas.style.width = destW + "px"; canvas.style.height = destH + "px";
  ctx = canvas.getContext("2d"); ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, destW, destH);
  ctx.drawImage(img, state.frame * FRAME_W, 0, FRAME_W, FRAME_H, 0, 0, destW, destH);
  document.getElementById("meta").dataset.frame = state.frame;
  document.getElementById("meta").dataset.buffer = destW + "x" + destH;
}
function step() {
  state.frame = (state.frame + 1) % FRAME_COUNT;
  drawSprite();
  timer = setTimeout(step, state.frameTime);
}
let timer = null;
img.onload = () => { drawSprite(); timer = setTimeout(step, state.frameTime); };
tile.onload = () => {
  tctx.drawImage(tile, 0, 0);            // 1:1 into the 48x48 backing store; CSS does the 8x
};
function setScale(n) { state.scale = Math.floor(n); drawSprite(); }
document.getElementById("s1").onclick = () => setScale(1);
document.getElementById("s2").onclick = () => setScale(2);
document.getElementById("s3").onclick = () => setScale(4);
document.getElementById("s5").onclick = () => setScale(8);
document.getElementById("tSlow").onclick = () => { state.frameTime = 400; };
document.getElementById("tIdle").onclick = () => { state.frameTime = 260; };
document.getElementById("tFast").onclick = () => { state.frameTime = 150; };
img.src = SHEET; tile.src = TILE;
</script></body></html>
"""
viewer = viewer.replace("__SHEET__", SHEET64).replace("__TILE__", TILE64)
open(os.path.join(OUT, "viewer.html"), "w").write(viewer)

json.dump({"frames": 4, "tile_dither_rows": list(DITHER_Y), "frame_px": [W, H], "frame_time_ms": 260,
           "palette": {k: ["#%02x%02x%02x" % tuple(e["rgb"]) for e in v] for k, v in PAL.items()},
           "outline": {k: "#%02x%02x%02x" % tuple(v) for k, v in OUTLINE.items()},
           "files": sizes, "unique_colors_rgba_nonspecific": len(set(
               c for fr in FRAMES for row in fr for c in row if c))},
          open(os.path.join(OUT, "sprite.json"), "w"), indent=1)

with open(os.path.join(OUT, "output.log"), "w") as f:
    f.write("generated files:\n")
    for k, v in sorted(sizes.items()):
        f.write("  %-26s %8d B\n" % (k, v))
    f.write("  %-26s %8d B\n" % ("viewer.html", os.path.getsize(os.path.join(OUT, "viewer.html"))))
    f.write("\nsprite frame 0, ASCII (. =transparent, @ =lit outline, O =mid outline, * =darkest: shadow outline + eyes, # =body colour):\n")
    sym = {GRAY[0]["rgb"]: "o", GRAY[1]["rgb"]: "O", GRAY[2]["rgb"]: "@", EYE: "*"}
    for y in range(H):
        row = artA[y]
        f.write("  " + "".join("." if row[x] is None else sym.get(row[x], "#")
                               for x in range(W)) + "\n")
print("ok", len(sizes), "files")
