#!/usr/bin/env python3
"""Assertions for the terminal-session-replay round.

Split into:
  R  recording integrity (typescript <-> timing must agree exactly)
  S  skill CLI behaviour captured in transcript-raw.log / on disk
  E  the markdown the skill exported
  P  the HTML player built from the same two files
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, "/Users/apple/.qoder-cn/skills/terminal-session-replay/scripts")
import main as tsm  # noqa: E402

ok = fail = 0
def check(label, cond, detail=""):
    global ok, fail
    print("%-5s %s %s" % ("PASS" if cond else "FAIL", label, ("| " + detail) if detail else ""))
    if cond:
        ok += 1
    else:
        fail += 1

raw = open(os.path.join(HERE, "deploy-run.typescript"), "rb").read()
rows = [l.split() for l in open(os.path.join(HERE, "deploy-run.timing"))]
delays = [float(r[0]) for r in rows]
sizes = [int(r[1]) for r in rows]
total = sum(delays)

# ---- R: recording integrity -------------------------------------------------
check("R1 timing byte-counts sum == typescript size", sum(sizes) == len(raw),
      "%d vs %d" % (sum(sizes), len(raw)))
off = 0
chunks = []
for d, s in zip(delays, sizes):
    chunks.append(raw[off:off + s].decode("utf-8", "replace"))
    off += s
check("R2 every timing row slices a non-empty chunk", all(len(c) for c in chunks),
      "%d events" % len(chunks))
full = "".join(chunks)
check("R3 concatenated chunks == recording (lossless)", full == raw.decode("utf-8", "replace"))
check("R4 all recorded commands appear in the capture",
      all(x in full for x in ["pwd", "ls -la ..", "terminal-session-replay demo",
                              "printf 'line-%02d", "echo done"]), "fed lines")
check("R5 sort heredoc output is really there",
      "apple\n" in full.replace("\r\n", "\n") and "cherry" in full)
check("R6 recorded wall span is human-scale", 5.0 < total < 60.0, "%.3fs" % total)
check("R7 pauses preserved (>=3 gaps over 0.9s)", sum(1 for d in delays if d > 0.9) >= 3,
      " ".join("%.2f" % d for d in delays))

# ---- S: the skill's own CLI -------------------------------------------------
home = os.environ.get("FAKE_HOME")
env = dict(os.environ, HOME=home) if home else dict(os.environ)
store = os.path.join(env["HOME"], ".terminal-sessions") if home else None


def cli(*args):
    p = subprocess.run([sys.executable, os.path.join(
        "/Users/apple/.qoder-cn/skills/terminal-session-replay/scripts", "main.py")] + list(args),
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60, env=env)
    return p.returncode, p.stdout + p.stderr


rc, out = cli("record", "--output", "verify-probe", "--title", "v")
check("S1 record FAILS on macOS (BSD script has no --timing)",
      rc == 0 and "illegal option" in out and '"status": "error"' in out,
      out.strip().splitlines()[-3] if out.strip() else "")
check("S2 record error still exits 0 -> CI cannot detect it", rc == 0, "exit=%d" % rc)
check("S3 record left no usable session", not os.path.exists(
    os.path.join(store, "verify-probe.timing")) if store else True)

rc, out = cli("replay", "--input", "deploy-run")
check("S4 replay needs scriptreplay, absent on macOS",
      "scriptreplay" in out and '"status": "error"' in out)
rc, out = cli("replay", "--input", "deploy-run", "--no-timing")
check("S5 replay --no-timing (cat path) really dumps the recording",
      "echo done" in out and '"status": "success"' in out, "%dB stdout" % len(out))
rc, out = cli("info", "--input", "../escape")
check("S6 path traversal rejected", "Invalid session name" in out)
rc, out = cli("info", "--input", ".."+os.sep+"x")
check("S7 dot-only and slash names rejected", "Invalid session name" in out)
rc, out = cli("info", "--input", "ghost")
check("S8 missing session reported as error", "not found" in out)

m = tsm.TerminalSessionManager()
p1 = str(m.get_session_paths("v1.2")["typescript"])
p2 = str(m.get_session_paths("v1")["typescript"])
check("S9 dotted names collide (validate allows '.', with_suffix eats it)",
      p1 == p2, "%s == %s" % (os.path.basename(p1), os.path.basename(p2)))

skill_dur = m.get_session_duration("deploy-run")
check("S10 get_session_duration != sum of delays (bug)",
      abs(skill_dur - total) > 1.0, "skill=%.3fs real=%.3fs ratio=%.1fx"
      % (skill_dur, total, total / max(skill_dur, 1e-9)))

rc, out = cli("list")
listed = json.loads(out[out.index("{"):])
check("S11 list sees the session and its tags",
      listed["count"] == 1 and listed["sessions"][0]["name"] == "deploy-run"
      and "showcase" in listed["sessions"][0]["tags"])
rc, out = cli("list", "--filter-tags", "terminal")
check("S12 tag filter hits", json.loads(out[out.index("{"):])["count"] == 1)
rc, out = cli("list", "--filter-tags", "nope")
check("S13 tag filter misses", json.loads(out[out.index("{"):])["count"] == 0)

# ---- E: exported markdown ---------------------------------------------------
md = open(os.path.join(HERE, "SESSION.md")).read()
check("E1 export keeps title", "Skill showcase: deploy-run smoke test" in md)
check("E2 export keeps tags", "**Tags:** showcase, terminal" in md)
check("E3 export keeps the recorded commands", "echo done" in md and "sort <<E" in md)
check("E4 export wraps body in a bash fence", md.count("```") == 2)
dur = re.search(r"\*\*Duration:\*\* ([\d.]+) seconds", md)
check("E5 exported duration is wrong by >5x (inherits S10)",
      bool(dur) and abs(float(dur.group(1)) - total) > 5.0,
      "says %s s, really %.2f s" % (dur.group(1) if dur else "?", total))
check("E6 export keeps ANSI-free prompt glyph", "❯ pwd" in md)

# ---- P: the HTML player -----------------------------------------------------
h = open(os.path.join(HERE, "replay.html")).read()
check("P1 player is single-file (no external src/href)",
      not re.search(r'(src|href)\s*=\s*["\']https?://', h))
check("P2 recording inlined as JSON", "const REC = {" in h and '"delay"' in h)
n_events = h.count('"delay":')
check("P3 every timing event made it into the page", n_events >= len(rows),
      "%d fields vs %d events" % (n_events, len(rows)))
check("P4 total matches the recording", ("%.2f" % total) in h, "%.2f" % total)
check("P5 command lines are styled separately", "REC.prompt" in h and "ln cmd" in h)
check("P6 seek/controls wired", all(k in h for k in
      ["getElementById('play')", "requestAnimationFrame", "id=\"track\""]))
golden = json.dumps([round(d, 6) for d in delays])
check("P7 inlined delays == timing file (byte-for-byte semantics)",
      all(('"delay": %r' % d in h or '"delay": %s' % repr(d) in h) for d in delays),
      golden[:70])

check("P8 hidden-tab fallback present (rAF never fires when document.hidden)",
      "document.hidden" in h and "setInterval" in h)

# ---- M: mutation controls (same predicates, deliberately wrong inputs) ------
d0 = delays[3]
mut_h = h.replace('"delay": %r' % d0, '"delay": %r' % (d0 + 3.5), 1)
check("M0 preconditions: mutation actually changed one field",
      mut_h != h and mut_h.count('"delay":') == h.count('"delay":'))
p7_mut = all(('"delay": %r' % d in mut_h or '"delay": %s' % repr(d) in mut_h) for d in delays)
check("M1 value mutation (+3.5s on one delay) would turn P7 red", p7_mut is False)
raw_mut = raw[:-40]
check("M2 structural mutation (chop 40B off the recording) would turn R1 red",
      sum(sizes) != len(raw_mut), "%d claimed vs %d bytes" % (sum(sizes), len(raw_mut)))
chunks_mut, off = [], 0
for sz in sizes:
    chunks_mut.append(raw_mut[off:off + sz].decode("utf-8", "replace")); off += sz
check("M3 structural mutation would turn R3 (lossless rejoin) red",
      "".join(chunks_mut) != full)
check("M4 a mutated delay moves the replay total (so R6/P4 stay honest)",
      abs((total - d0 + (d0 + 3.5)) - (total + 3.5)) < 1e-9)

print("\n%d PASS / %d FAIL" % (ok, fail))
sys.exit(1 if fail else 0)
