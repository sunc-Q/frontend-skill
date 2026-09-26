#!/usr/bin/env python3
"""A/B for the one golden FAIL: reproduce the /favicon.ico 404 deterministically and
check the one-line fix. Trigger turned out to be the download navigation, which is why
the plain-load probe missed it.

  plain  = golden HTML as-is
  fixed  = same HTML + <link rel="icon" href="data:,">
Both are copies under .tmp/serve; the round-3 artefact itself is never edited.
"""
import os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC = "demos/20260925-1810-algorithmic-art/art-index.html"
html = open(SRC, encoding="utf-8").read()
assert html.count("<meta charset=\"UTF-8\">") == 1
FIXED = html.replace("<meta charset=\"UTF-8\">",
                     "<meta charset=\"UTF-8\">\n    <link rel=\"icon\" href=\"data:,\">", 1)

for name, doc in (("ab-plain", html), ("ab-fixed", FIXED)):
    d = ".tmp/serve/" + name
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(doc)
    port = 8151 if name == "ab-plain" else 8152
    log = open("demos/20260926-1037-webapp-testing/access-%s.txt" % name, "w")
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1",
                            "--directory", d], stdout=log, stderr=subprocess.STDOUT)
    time.sleep(1.2)
    errs, dl_ok = [], "no"
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True, executable_path=CHROME, args=["--no-sandbox", "--disable-gpu"])
            pg = b.new_context(viewport={"width": 1000, "height": 800}, accept_downloads=True).new_page()
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.goto("http://127.0.0.1:%d/index.html" % port, wait_until="networkidle")
            pg.wait_for_timeout(500)
            try:
                with pg.expect_download(timeout=20000) as di:
                    pg.evaluate("() => document.querySelector('[onclick=\"downloadPNG()\"]').click()")
                dl_ok = di.value.suggested_filename
            except Exception as e:
                dl_ok = repr(e)[:60]
            pg.wait_for_timeout(2500)
            b.close()
    finally:
        srv.terminate(); srv.wait(); log.close()
    hits404 = [l.strip() for l in open("demos/20260926-1037-webapp-testing/access-%s.txt" % name) if "404" in l]
    print("%-9s download=%-38s console_errors=%d %s server_404=%s"
          % (name, dl_ok, len(errs), errs[:1], hits404[:1] or "none"))
