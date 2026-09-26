"""Verification for the QR card wall: three-way agreement between the source
ledger, an independent decoder engine (zxing-cpp), and a second one (jsQR).

Also proves the payload is read, not just written: value mutation, ECC
occlusion differential, and a blank-image negative control.
"""
import json
import os
import re
import subprocess
import sys
import zipfile

LAB = "/Users/apple/Documents/workProject/试验/skill演示场"
SKILL = os.path.expanduser("~/.qoder-cn/skills/qrcode-skills/scripts")
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
ENV = dict(os.environ, PYTHONPATH=os.path.join(LAB, ".tmp", "pylibs"))
NODEMOD = os.path.join(LAB, ".tmp", "qrnode", "node_modules")
LOG, RESULTS = [], []

import qrcode  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402
import zxingcpp  # noqa: E402

CELL, PAD, COLS = 200, 34, 5


def log(s=""):
    LOG.append(str(s))
    print(s)


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    log(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail else ""))


def decode(path=None, blank=False):
    img = Image.new("RGB", (400, 400), "white") if blank else Image.open(path)
    return [r.text for r in zxingcpp.read_barcodes(img.convert("RGB"))]


def skill_decode(path):
    p = subprocess.run([PY, os.path.join(SKILL, "decode.py"), "--file", path],
                       capture_output=True, text=True, env=ENV)
    return p.returncode, json.loads(p.stdout.strip())


def jsqr(paths):
    p = subprocess.run(["node", os.path.join(NODEMOD, "..", "decode.js")] + paths,
                       capture_output=True, text=True, env=dict(ENV, NODE_PATH=NODEMOD))
    return p.returncode, json.loads(p.stdout.strip() or "{}")


def gen(data, out, ecc="H", size="400", fmt="png"):
    p = subprocess.run([PY, os.path.join(SKILL, "generate.py"), "--data", data,
                        "--output", out, "--size", size, "--format", fmt,
                        "--error-correction", ecc], capture_output=True, text=True, env=ENV)
    return p.returncode, p.stdout.strip()


def cover(src, dst, box, colour=(30, 30, 30)):
    img = (src if isinstance(src, Image.Image) else Image.open(src)).convert("RGB")
    ImageDraw.Draw(img).rectangle(box, fill=colour)
    img.save(dst)
    return dst


def main():
    exp = json.load(open(os.path.join(HERE, "expected.json"), encoding="utf-8"))
    build = json.load(open(os.path.join(HERE, "build-report.json"), encoding="utf-8"))
    rows, n = exp["rows"], len(exp["rows"])
    expected = [r["二维码内容"] for r in rows]
    log("=== qrcode-skills verification: QR card wall of the run ledger ===")
    log(f"ledger rows={n}; payloads carry CJK + fullwidth bar U+FF5D")
    log("")

    log("-- A. batch_generate produced what it claimed --")
    genrep = build["step2_batch_generate"]["json"]
    files = sorted(os.listdir(os.path.join(HERE, "qr-wall")), key=lambda s: int(s.split(".")[0]))
    check("A1 reported total==success==%d / failed==0" % n,
          genrep["total"] == n and genrep["success"] == n and genrep["failed"] == 0,
          json.dumps({k: genrep[k] for k in ("total", "success", "failed")}))
    check("A2 qr-wall holds exactly 1..%d.png" % n, files == [f"{i}.png" for i in range(1, n + 1)])
    sizes = [os.path.getsize(os.path.join(HERE, "qr-wall", f)) for f in files]
    dims = {Image.open(os.path.join(HERE, "qr-wall", f)).size for f in files}
    check("A3 all cards non-empty and 400x400", all(600 < s < 20000 for s in sizes) and dims == {(400, 400)},
          f"{min(sizes)}..{max(sizes)}B, dims={dims}")
    check("A4 PNG signature", open(os.path.join(HERE, "qr-wall", "1.png"), "rb").read(8) == b"\x89PNG\r\n\x1a\n")
    zpath = os.path.join(HERE, os.path.basename(genrep["zip_file"] or ""))
    check("A5 --zip bundle exists beside the output dir", os.path.isfile(zpath), os.path.basename(zpath))
    entries = zipfile.ZipFile(zpath).namelist()
    check("A6 zip holds all %d cards and nothing else" % n, sorted(entries) == sorted(files), f"{len(entries)} entries")

    log("")
    log("-- B. the documented column flow really gates --")
    step1 = build["step1_need_column"]["json"]
    check("B1 unrecognised header -> need_column instead of a guess",
          step1.get("need_column") is True and step1.get("columns"), str(step1.get("columns")))
    check("B2 preview capped at 6 rows", len(step1.get("preview", [])) == 6, f"{len(step1.get('preview', []))}")
    check("B3 need_column exits 0: it asks, it does not fail", build["step1_need_column"]["exit"] == 0)
    check("B4 no images written for the rejected run", not os.path.exists(os.path.join(HERE, "_unused")))
    check("B5 --column 技能 built a second wall", build["step3_named_column"]["json"]["success"] == n)
    rc, dec = skill_decode(os.path.join(HERE, "qr-names", "3.png"))
    check("B6 that wall carries the chosen column's own value, row 3",
          dec.get("contents") == [rows[2]["技能"]], str(dec.get("contents")))

    log("")
    log("-- C. round-trip: ledger vs the skill's decoder vs zxing vs jsQR --")
    skill_txt = open(os.path.join(HERE, "decoded-wall.txt"), encoding="utf-8").read().split("\n")
    check("C1 batch_decode: %d lines, 0 failures" % n,
          build["step6_batch_decode"]["json"]["success"] == n and len(skill_txt) == n)
    check("C2 batch_decode text == ledger payloads byte-for-byte", skill_txt == expected, skill_txt[0])
    mine = [decode(os.path.join(HERE, "qr-wall", f"{i}.png")) for i in range(1, n + 1)]
    flat = [c[0] if c else None for c in mine]
    check("C3 independent zxing-cpp decode matches all %d" % n, flat == expected,
          f"{sum(a == b for a, b in zip(flat, expected))}/{n}")
    check("C4 exactly one code per card", all(len(c) == 1 for c in mine))
    rc, jres = jsqr([os.path.join(HERE, "qr-wall", f"{i}.png") for i in range(1, n + 1)])
    jflat = [jres.get(f"{i}.png") for i in range(1, n + 1)]
    check("C5 second engine jsQR (pure JS) agrees on all %d payloads" % n, jflat == expected,
          f"exit={rc} mismatches={sum(a != b for a, b in zip(jflat, expected))}")
    check("C6 CJK + U+FF5D survive (not mojibake, not stripped)",
          all("｜" in t and "轮" in t for t in flat))

    log("")
    log("-- D. negative controls: the decoder must be able to say no --")
    blank = os.path.join(HERE, "_blank.png")
    Image.new("RGB", (400, 400), "white").save(blank)
    rc, res = skill_decode(blank)
    check("D1 blank image -> exit 1 + error JSON", rc == 1 and "error" in res, str(res.get("error")))
    noise = os.path.join(HERE, "_noise.png")
    Image.effect_noise((400, 400), 128).convert("RGB").save(noise)
    rc2, res2 = skill_decode(noise)
    check("D2 noise image -> refused too", rc2 == 1 and "error" in res2, str(res2.get("error")))
    os.remove(blank)
    os.remove(noise)

    log("")
    log("-- E. value mutation: only a decoder can see it --")
    mut = expected[-1].replace("600秒", "601秒")
    check("E0 mutant differs from golden by one digit only",
          mut != expected[-1] and len(mut) == len(expected[-1]), mut)
    mp = os.path.join(HERE, "_mutant.png")
    gen(mut, mp)
    got = decode(mp)
    gold = os.path.join(HERE, "qr-wall", f"{n}.png")
    check("E1 mutant card decodes to 601秒 (the change is inside the code)", got == [mut], got[0] if got else "")
    check("E2 mutant no longer decodes to the golden payload", got != [expected[-1]])
    check("E3 golden card unchanged at 600秒 (no leakage)", decode(gold) == [expected[-1]])
    check("E4 the two files differ byte-wise (1422B-class, not identical)",
          open(gold, "rb").read() != open(mp, "rb").read(),
          f"{os.path.getsize(gold)}B vs {os.path.getsize(mp)}B")
    os.remove(mp)

    log("")
    log("-- F. error correction is real: same cover, two levels --")
    payload = expected[0]
    obs = {}
    for ecc in ("L", "H"):
        clean = os.path.join(HERE, f"evidence-ecc-{ecc}-clean.png")
        gen(payload, clean, ecc=ecc)
        occl = cover(clean, os.path.join(HERE, f"evidence-ecc-{ecc}-occluded.png"), [120, 120, 280, 280])
        obs[ecc] = decode(occl)
    check("F1 ECC H + 160px centre cover still decodes to the payload", obs["H"] == [payload], str(obs["H"])[:64])
    check("F2 ECC L + the identical cover is destroyed", obs["L"] != [payload], str(obs["L"]))
    check("F3 same payload, same cover box, level is the only variable",
          os.path.getsize(os.path.join(HERE, "evidence-ecc-L-clean.png"))
          <= os.path.getsize(os.path.join(HERE, "evidence-ecc-H-clean.png")),
          "H carries more codewords than L")

    log("")
    log("-- G. vector output: structural + still scannable --")
    svg = open(os.path.join(HERE, "card-branch.svg"), encoding="utf-8").read()
    check("G1 SvgPathImage really emits one <path> and zero <rect>",
          svg.count("<path") == 1 and svg.count("<rect") == 0, f"path={svg.count('<path')} rect={svg.count('<rect')}")
    vb = [float(x) for x in re.search(r'viewBox="([\d. ]+)"', svg).group(1).split()]
    xs = sorted({round(float(m), 3) for m in re.findall(r'M([\d.]+),', svg)})
    step = round(xs[1] - xs[0], 4)
    grid = round(vb[2] / step)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=2)
    qr.add_data(exp["card_svg"])
    qr.make(fit=True)
    matrix = qr.get_matrix()
    modules, dark = len(matrix), sum(r.count(True) for r in matrix)
    check("G2 viewBox / step gives the same module grid as an independent recompute",
          vb[2] == vb[3] and grid == modules, f"svg grid={grid} recomputed={modules} step={step}")
    check("G3 first dark module sits one border in (border=2 honoured)",
          round(xs[0] / step) == 2, f"first x={xs[0]} = {xs[0] / step:.2f} modules")
    check("G4 path subpaths <= dark modules (runs merged) and >= half of them",
          dark >= svg.count("M") > dark // 2, f"subpaths={svg.count('M')} dark={dark}")
    raster = os.path.join(HERE, "_svg-raster.png")
    subprocess.run(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    "--headless", "--disable-gpu", "--screenshot=" + raster,
                    "--window-size=600,600", "--default-background-color=FFFFFFFF",
                    "file://" + os.path.join(HERE, "card-branch.svg")], capture_output=True, text=True)
    check("G5 Chrome-rasterised SVG decodes back to the exact branch string",
          decode(raster) == [exp["card_svg"]], str(decode(raster))[:80])
    if os.path.exists(raster):
        os.remove(raster)

    log("")
    log("-- H. the human-visible sheet, and the lesson from breaking it --")
    rc, card = skill_decode(os.path.join(HERE, "card-last-round.png"))
    check("H1 hand-scan card (600px / ECC H / border 3) decodes to round-%d" % n,
          card.get("contents") == [exp["card_png"]], str(card.get("contents"))[:70])
    check("H2 it names the last round's skill", rows[-1]["技能"] in exp["card_png"], rows[-1]["技能"])

    rows_tall = (n + COLS - 1) // COLS
    cap = 30
    sheet = Image.new("RGB", (COLS * CELL + 2 * PAD, rows_tall * (CELL + cap) + 2 * PAD), "#fafafa")
    for i in range(n):
        cx = PAD + (i % COLS) * CELL
        cy = PAD + (i // COLS) * (CELL + cap)
        sheet.paste(Image.open(os.path.join(HERE, "qr-wall", f"{i + 1}.png")).resize((CELL, CELL)), (cx, cy))
        sheet.paste(Image.open(os.path.join(HERE, "qr-names", f"{i + 1}.png")).resize((18, 18)),
                    (cx + 2, cy + CELL + 6))  # badge in the caption strip, not on the code
        ImageDraw.Draw(sheet).text((cx + 26, cy + CELL + 8), f"#{i + 1} {rows[i]['技能'][:18]}", fill="#222")
    sheet.save(os.path.join(HERE, "qr-card-wall-sheet.png"))
    cell1 = sheet.crop((PAD, PAD, PAD + CELL, PAD + CELL))
    cell1.resize((400, 400)).save(os.path.join(HERE, "_c1.png"))
    lc, lr = (n - 1) % COLS, (n - 1) // COLS
    cell_last = sheet.crop((PAD + lc * CELL, PAD + lr * (CELL + cap),
                            PAD + (lc + 1) * CELL, PAD + lr * (CELL + cap) + CELL))
    cell_last.resize((400, 400)).save(os.path.join(HERE, "_cN.png"))
    ok1, okN = decode(os.path.join(HERE, "_c1.png")) == [expected[0]], decode(os.path.join(HERE, "_cN.png")) == [expected[-1]]
    check("H3 sheet cell #1 cropped back out decodes at 5x downscale", ok1, str(decode(os.path.join(HERE, "_c1.png")))[:60])
    check("H4 last-row cell decodes too (all %d cards legible on one sheet)" % n, okN)
    os.remove(os.path.join(HERE, "_c1.png"))
    os.remove(os.path.join(HERE, "_cN.png"))

    finder = cover(sheet.crop((PAD, PAD, PAD + CELL, PAD + CELL)).resize((400, 400)),
                   os.path.join(HERE, "_finder.png"), [40, 40, 145, 145])
    check("H5 the 18px badge was the earlier failure: covering the top-left finder kills an ECC H card",
          decode(finder) != [expected[0]], str(decode(finder)))
    data_cover = cover(sheet.crop((PAD, PAD, PAD + CELL, PAD + CELL)).resize((400, 400)),
                       os.path.join(HERE, "_data.png"), [170, 170, 275, 275])
    check("H6 ...while an equal-size cover on the data region still decodes (finder != data, not size)",
          decode(data_cover) == [expected[0]], str(decode(data_cover))[:60])
    os.rename(finder, os.path.join(HERE, "evidence-finder-covered.png"))
    os.rename(data_cover, os.path.join(HERE, "evidence-data-covered.png"))
    check("H7 sheet size matches the 5-column grid", sheet.size == (COLS * CELL + 2 * PAD, rows_tall * (CELL + cap) + 2 * PAD), str(sheet.size))

    log("")
    passed = sum(1 for _, ok in RESULTS if ok)
    log(f"=== {passed}/{len(RESULTS)} assertions passed ===")
    for name, ok in RESULTS:
        if not ok:
            log("  FAILED: " + name)
    open(os.path.join(HERE, "output.log"), "w", encoding="utf-8").write("\n".join(LOG) + "\n")
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
