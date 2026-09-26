#!/usr/bin/env python3
"""Falsify the single golden FAIL (G3): is the 404 the missing favicon?

Same HTML, two directories -- one with a favicon.ico next to it. If G3's console
error disappears only in the second, the failure is the page having no icon
declaration, not anything inlined by round 3.
"""
import os, sys, shutil
from playwright.sync_api import sync_playwright

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC = "demos/20260925-1810-algorithmic-art/art-index.html"
A, B = ".tmp/serve/nofavicon", ".tmp/serve/withfavicon"
for d in (A, B):
    os.makedirs(d, exist_ok=True)
    shutil.copyfile(SRC, os.path.join(d, "index.html"))
# 1x1 transparent ICO (header + ICONDIRENTRY + 1px BMP), 22 bytes
ico = bytes.fromhex("000001000100010100000100180016000000160000000100")
open(os.path.join(B, "favicon.ico"), "wb").write(ico)

for d, port in ((A, 8141), (B, 8142)):
    srv = os.spawnv(os.P_NOWAIT, sys.executable, [sys.executable, "-m", "http.server", str(port),
                  "--bind", "127.0.0.1", "--directory", d])
    import time; time.sleep(1.2)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, executable_path=CHROME, args=["--no-sandbox", "--disable-gpu"])
            pg = b.new_context(viewport={"width": 1000, "height": 800}).new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.goto("http://127.0.0.1:%d/index.html" % port, wait_until="networkidle")
            pg.wait_for_timeout(2500)
            print("%-12s port=%d console_errors=%d %s" % (os.path.basename(d), port, len(errs), errs[:2]))
            b.close()
    finally:
        os.kill(srv, 15)
