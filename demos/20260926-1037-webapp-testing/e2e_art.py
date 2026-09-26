#!/usr/bin/env python3
"""e2e regression for the round-3 generative-art page, run under webapp-testing's
with_server.py (server lifecycle handled by the skill's bundled script).

Modes: golden | mutant_seed | mutant_wiring  (last two = deliberate breakages used
to prove the assertions are not vacuous).
"""
import argparse, json, os, sys, time
from playwright.sync_api import sync_playwright

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

STATS_JS = """() => {
  const c = document.querySelector('#canvas-container canvas');
  if (!c) return null;
  const W = 240, H = 240;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d', {willReadFrequently: true});
  ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const bg = [d[0], d[1], d[2]];
  let ink = 0, sum = 0, red = 0, blue = 0;
  const uniq = new Set();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = d[i], g = d[i+1], b = d[i+2];
      sum += r + g + b;
      uniq.add((r >> 3 << 10) | (g >> 3 << 5) | (b >> 3));
      if (Math.abs(r-bg[0]) + Math.abs(g-bg[1]) + Math.abs(b-bg[2]) > 30) ink++;
      if (r > 170 && g < 90 && b < 90) red++;
      if (b > 150 && r < 120) blue++;
    }
  }
  return {w: c.width, h: c.height, ink: ink, sum: sum, uniq: uniq.size, red: red, blue: blue};
}"""

# one-step-at-a-time param writes: dispatch a real 'input' event so the page's
# inline oninput= handler runs (no direct calls to page functions)
SET_RANGE_JS = """([id, v]) => {
  const el = document.getElementById(id);
  el.value = String(v);
  el.dispatchEvent(new Event('input', {bubbles: true}));
  return el.value;
}"""

results = []


def rec(cid, name, ok, detail):
    results.append({"id": cid, "name": name, "ok": bool(ok), "detail": detail})
    print("[%s] %-5s %-46s %s" % ("PASS" if ok else "FAIL", cid, name, detail))
    sys.stdout.flush()
    return ok


def sig(st):
    return (st["ink"], st["sum"], st["uniq"], st["red"], st["blue"]) if st else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--mode", default="golden")
    ap.add_argument("--shots", default="shots")
    ap.add_argument("--download-dir", default=".")
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    t0 = time.time()
    console_errors, page_errors, requests, nonlocal_reqs, bad_resp = [], [], [], [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME,
                                    args=["--no-sandbox", "--disable-gpu", "--hide-scrollbars"])
        ctx = browser.new_context(viewport={"width": 1000, "height": 800},
                                  accept_downloads=True)
        page = ctx.new_page()
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("request", lambda r: (requests.append(r.url),
                                      nonlocal_reqs.append(r.url) if not r.url.startswith("http://127.0.0.1:81") and not r.url.startswith("data:") else None))
        page.on("response", lambda r: bad_resp.append("%d %s" % (r.status, r.url)) if r.status >= 400 else None)
        resp = page.goto(args.url, wait_until="networkidle")
        page.wait_for_timeout(300)

        # G1 page served over http
        rec("G1", "served over http + title", resp.status == 200 and "Cron Organicism" in page.title(),
            "status=%s title=%r" % (resp.status, page.title()[:40]))

        # G4 reconnaissance: discover the live control inventory (nothing hardcoded)
        disc = page.evaluate("""() => {
          const q = s => Array.from(document.querySelectorAll(s));
          return {
            ranges: q('input[type=range]').map(e => ({id: e.id, min: e.min, max: e.max, step: e.step, value: e.value})),
            colors: q('input[type=color]').map(e => ({id: e.id, value: e.value})),
            numbers: q('input[type=number]').map(e => ({id: e.id, value: e.value})),
            buttons: q('button').map(e => ({id: e.id, label: (e.textContent||'').trim().slice(0,20), fn: (e.getAttribute('onclick')||'').split('(')[0]})),
            links: q('a').length
          };
        }""")
        ok4 = (len(disc["ranges"]) == 5 and len(disc["colors"]) == 3 and len(disc["numbers"]) == 1
               and all(r["id"] and r["min"] and r["max"] for r in disc["ranges"]))
        rec("G4", "element discovery (5 range/3 color/1 num)", ok4,
            "ranges=%s colors=%s seed=%s buttons=%s" % ([r["id"] for r in disc["ranges"]],
            [c["value"] for c in disc["colors"]], disc["numbers"][0]["value"],
            [b["fn"] for b in disc["buttons"]]))
        defaults = {r["id"]: r["value"] for r in disc["ranges"]}
        defaults.update({c["id"]: c["value"] for c in disc["colors"]})
        defaults["seed-input"] = disc["numbers"][0]["value"]

        # G5 canvas drawn
        st_base = page.evaluate(STATS_JS)
        rec("G5", "canvas 1200x1200 and non-blank", st_base and st_base["w"] == 1200 and st_base["ink"] > 3000,
            json.dumps(st_base))
        page.locator("#canvas-container canvas").screenshot(path=os.path.join(args.shots, "01-baseline.png"))

        # cheap-ify: perLane -> min (also first wiring evidence)
        st_low = sig(page.evaluate(STATS_JS))
        page.evaluate(SET_RANGE_JS, ["perLane", 400])
        page.wait_for_timeout(1200)
        st_after = page.evaluate(STATS_JS)
        rec("G11a", "wiring: perLane 1600->400 changes drawing", sig(st_after) != st_low,
            "ink %s -> %s" % (st_low[0], st_after["ink"]))

        # G7 determinism: regenerate twice at identical state
        page.click("#btn-regenerate")
        page.wait_for_timeout(1200)
        s1 = sig(page.evaluate(STATS_JS))
        page.click("#btn-regenerate")
        page.wait_for_timeout(1200)
        s2 = sig(page.evaluate(STATS_JS))
        rec("G7", "determinism: regenerate twice -> identical", s1 == s2 and s1 is not None,
            "%s == %s" % (list(s1), list(s2)))

        # G8/G9 seed navigation round trip
        page.evaluate("() => document.querySelector('[onclick=\"nextSeed()\"]').click()")
        page.wait_for_timeout(1200)
        s_next = sig(page.evaluate(STATS_JS))
        seed_now = page.input_value("#seed-input")
        rec("G8", "nextSeed changes drawing + input", s_next != s2 and seed_now == "20260926",
            "seed=%s sig %s -> %s" % (seed_now, list(s2), list(s_next)))
        page.evaluate("() => document.querySelector('[onclick=\"previousSeed()\"]').click()")
        page.wait_for_timeout(1200)
        s_prev = sig(page.evaluate(STATS_JS))
        rec("G9", "previousSeed restores exact state", s_prev == s2 and page.input_value("#seed-input") == "20260925",
            "seed=%s sig==baseline-seed-sig: %s" % (page.input_value("#seed-input"), s_prev == s2))

        # G10 invalid seed is rejected and reverted.
        # page.fill() refuses input[type=number] ("Cannot type text"), so write the
        # raw value and fire the same 'change' event the browser would.
        page.eval_on_selector("#seed-input", "el => { el.value = 'abc'; }")
        page.dispatch_event("#seed-input", "change")
        page.wait_for_timeout(600)
        s_bad = sig(page.evaluate(STATS_JS))
        rec("G10", "invalid seed reverts, drawing untouched",
            page.input_value("#seed-input") == "20260925" and s_bad == s2,
            "input=%s sig unchanged: %s" % (page.input_value("#seed-input"), s_bad == s2))

        # G11b passes slider lowers deposit density
        page.evaluate(SET_RANGE_JS, ["passes", 40])
        page.wait_for_timeout(900)
        s_p40 = page.evaluate(STATS_JS)
        page.evaluate(SET_RANGE_JS, ["passes", 220])
        page.wait_for_timeout(2500)
        s_p220 = page.evaluate(STATS_JS)
        rec("G11b", "wiring: passes 40 -> 220 monotonically inks more",
            s_p220["ink"] > s_p40["ink"] and s_p220["uniq"] >= s_p40["uniq"],
            "ink %s -> %s, uniq %s -> %s" % (s_p40["ink"], s_p220["ink"], s_p40["uniq"], s_p220["uniq"]))

        # G12 colour picker feeds the palette
        page.evaluate("""() => { const el=document.getElementById('color1'); el.value='#ff0000';
                                  el.dispatchEvent(new Event('input',{bubbles:true}));
                                  el.dispatchEvent(new Event('change',{bubbles:true})); }""")
        page.wait_for_timeout(1500)
        s_red = page.evaluate(STATS_JS)
        rec("G12", "wiring: color1=#ff0000 raises strong-red pixels",
            s_red["red"] > s_p220["red"], "red %s -> %s" % (s_p220["red"], s_red["red"]))
        page.locator("#canvas-container canvas").screenshot(path=os.path.join(args.shots, "02-color1-red.png"))

        # G14 cadence extremes (documented: 0 dissolves banding, 1 pins lanes)
        page.evaluate(SET_RANGE_JS, ["cadence", 0])
        page.wait_for_timeout(1500)
        s_c0 = sig(page.evaluate(STATS_JS))
        page.locator("#canvas-container canvas").screenshot(path=os.path.join(args.shots, "03-cadence0.png"))
        page.evaluate(SET_RANGE_JS, ["cadence", 1])
        page.wait_for_timeout(1500)
        s_c1 = sig(page.evaluate(STATS_JS))
        page.locator("#canvas-container canvas").screenshot(path=os.path.join(args.shots, "04-cadence1.png"))
        rec("G14", "cadence 0 vs 1 produce different drawings", s_c0 != s_c1 and s_c0 is not None,
            "%s vs %s" % (list(s_c0), list(s_c1)))

        # G13 reset restores every discovered default
        page.evaluate("() => document.querySelector('[onclick=\"resetParameters()\"]').click()")
        page.wait_for_timeout(2000)
        now = page.evaluate("""() => { const o={};
            document.querySelectorAll('input[type=range],input[type=color]').forEach(e=>o[e.id]=e.value);
            o['seed-input']=document.getElementById('seed-input').value; return o; }""")
        bad = {k: (v, now.get(k)) for k, v in defaults.items() if str(now.get(k)) != str(v)}
        rec("G13", "resetParameters restores all %d defaults" % len(defaults), not bad,
            "mismatch=%s" % json.dumps(bad))

        # G15 the p5 download button really produces a PNG file
        try:
            with page.expect_download(timeout=15000) as di:
                page.evaluate("() => document.querySelector('[onclick=\"downloadPNG()\"]').click()")
            dl = di.value
            dest = os.path.join(args.download_dir, "download" + ("-%s.png" % args.mode))
            dl.save_as(dest)
            with open(dest, "rb") as f:
                head = f.read(33)
            size = os.path.getsize(dest)
            ok15 = head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR" and size > 50000
            import struct
            w, h = struct.unpack(">II", head[16:24])
            rec("G15", "downloadPNG -> real 1200x1200 PNG", ok15 and (w, h) == (1200, 1200),
                "%s %dx%d %dB suggested=%r" % (os.path.basename(dest), w, h, size, dl.suggested_filename))
        except Exception as e:
            rec("G15", "downloadPNG -> real PNG", False, repr(e)[:160])

        # G2/G3 error surfaces
        rec("G2", "zero uncaught page errors", not page_errors, "; ".join(page_errors)[:200] or "0")
        rec("G3", "zero console errors", not console_errors,
            ("console=%s | http=%s" % (console_errors[:2], bad_resp[:2]))[:200] or "0")
        # G6 network hygiene
        rec("G6", "all %d requests stay same-origin" % len(requests), not nonlocal_reqs,
            "urls=%s offsite=%s" % ([u.split("//", 1)[-1] for u in requests][:4], nonlocal_reqs[:3] or "none"))
        browser.close()

    out = {"mode": args.mode, "url": args.url, "seconds": round(time.time() - t0, 1),
           "passed": sum(1 for r in results if r["ok"]), "failed": sum(1 for r in results if not r["ok"]),
           "defaults": defaults, "results": results}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    with open(os.path.join(args.download_dir, "result-%s.json" % args.mode), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
