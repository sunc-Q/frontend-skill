#!/usr/bin/env python3
"""Integrity check for every PNG kept in this round -- pure stdlib (no Pillow, no
playwright): signature, IHDR dimensions, per-chunk CRC32, IEND present.
Also asserts the two headline facts the report leans on:
  * golden shots/02 and shots/03 DIFFER  (cadence was live)
  * mutant shots-mutant-wiring/02 is byte-identical to .../03 in that run -- we only kept
    01 and 03, so instead assert golden/02 sha == mutant-wiring/03 sha (the inert redraw)
"""
import binascii, hashlib, os, struct, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
EXPECT = {
    "download-golden.png": (1200, 1200),
    "shots/01-baseline.png": None, "shots/02-color1-red.png": None,
    "shots/03-cadence0.png": None, "shots/04-cadence1.png": None,
    "shots-mutant-wiring/01-baseline.png": None, "shots-mutant-wiring/03-cadence0.png": None,
}
fails = []
digests = {}
for rel, want in EXPECT.items():
    path = os.path.join(ROOT, rel)
    blob = open(path, "rb").read()
    ok = blob[:8] == b"\x89PNG\r\n\x1a\n"
    pos, chunks, bad_crc = 8, [], 0
    while pos + 8 <= len(blob) and ok:
        ln = struct.unpack(">I", blob[pos:pos + 4])[0]
        typ = blob[pos + 4:pos + 8].decode("latin-1")
        data = blob[pos + 8:pos + 8 + ln]
        crc = struct.unpack(">I", blob[pos + 8 + ln:pos + 12 + ln])[0]
        if crc != binascii.crc32(typ.encode("latin-1") + data) & 0xFFFFFFFF:
            bad_crc += 1
        chunks.append(typ)
        if typ == "IHDR":
            w, h = struct.unpack(">II", data[:8])
        pos += 12 + ln
    done = chunks[-1] == "IEND"
    ok = ok and bad_crc == 0 and done
    dims = (w, h) if "IHDR" in chunks else None
    if want and dims != want:
        fails.append("%s dims %s != %s" % (rel, dims, want))
    if not done or bad_crc:
        fails.append("%s crc_bad=%d iend=%s" % (rel, bad_crc, done))
    digests[rel] = hashlib.sha256(blob).hexdigest()
    print("%-38s %dx%-5d %9dB chunks=%-3d(%s) crc_fail=%d sha=%s"
          % (rel, dims[0], dims[1], len(blob), len(chunks), ",".join(chunks[1:-1]), bad_crc, digests[rel][:8]))

G02 = digests["shots/02-color1-red.png"]
G03 = digests["shots/03-cadence0.png"]
M03 = digests["shots-mutant-wiring/03-cadence0.png"]
M01 = digests["shots-mutant-wiring/01-baseline.png"]
G01 = digests["shots/01-baseline.png"]
checks = [
    ("golden cadence0 differs from colour1-red (redraw happened)", G02 != G03),
    ("mutant_wiring cadence0 == golden colour1-red (redraw was inert)", M03 == G02),
    ("baseline identical across golden and mutant (mutation is elsewhere)", M01 == G01),
    ("download PNG sha256 matches the 4-run digest 9740465f..", digests["download-golden.png"].startswith("9740465f")),
]
for name, okc in checks:
    print("[%s] %s" % ("PASS" if okc else "FAIL", name))
    if not okc:
        fails.append(name)
print("PNG integrity + %d cross-run facts: %s" % (len(checks), "ALL PASS" if not fails else fails))
sys.exit(1 if fails else 0)
