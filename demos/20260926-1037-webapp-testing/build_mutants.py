#!/usr/bin/env python3
"""Build the two deliberately-broken copies used to prove the e2e assertions bite.

M1 mutant_seed   : nextSeed's arithmetic becomes a no-op  -> G8/G9 must FAIL
M2 mutant_wiring : updateParam stops redrawing            -> G11a/G11b must FAIL
                   while G7 (button determinism) still PASSES
Golden artefact is never modified; mutants land in LAB/.tmp/serve/.
"""
import os, sys

SRC = "demos/20260925-1810-algorithmic-art/art-index.html"
OUT = ".tmp/serve"

MUT = [
    ("mutant_seed.html", "params.seed = params.seed + 1;", "params.seed = params.seed + 0;"),
    ("mutant_wiring.html",
     "document.getElementById(paramName + '-value');\n            if (disp) disp.textContent = value;\n            initializeSystem();",
     "document.getElementById(paramName + '-value');\n            if (disp) disp.textContent = value;"),
]

html = open(SRC, encoding="utf-8").read()
os.makedirs(OUT, exist_ok=True)
for name, old, new in MUT:
    n = html.count(old)
    if n != 1:
        sys.exit("anchor %r appears %d times in golden -- refusing to guess" % (old[:40], n))
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(html.replace(old, new, 1))
    print("wrote %s (%d bytes, 1 mutation)" % (os.path.join(OUT, name), len(html)))
print("golden untouched: %s %d bytes" % (SRC, len(html)))
