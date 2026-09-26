#!/usr/bin/env python3
"""Transcript driver: exercise every terminal-session-replay CLI sub-command for real.

HOME points at a sandbox inside the lab so the skill's hard-coded
~/.terminal-sessions never touches the real home directory.
"""
import json
import os
import subprocess
import sys

SKILL = "/Users/apple/.qoder-cn/skills/terminal-session-replay"
MAIN = os.path.join(SKILL, "scripts", "main.py")
SESSION = "deploy-run"
results = {}


def run(argv, key):
    print("\n$ " + " ".join(argv))
    p = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                       text=True, timeout=60)
    print((p.stdout + p.stderr).rstrip())
    print("[exit=%d]" % p.returncode)
    results[key] = p.returncode
    return p.returncode, p.stdout + p.stderr


def main():
    os.chdir(sys.argv[1])
    print("HOME = %s" % os.environ["HOME"])

    run([sys.executable, MAIN, "record", "--output", "probe-only", "--title", "probe"], "record")
    run([sys.executable, MAIN, "list"], "list")
    run([sys.executable, MAIN, "info", "--input", SESSION], "info")
    run([sys.executable, MAIN, "list", "--filter-tags", "terminal"], "list_hit")
    run([sys.executable, MAIN, "list", "--filter-tags", "nope"], "list_miss")
    run([sys.executable, MAIN, "replay", "--input", SESSION, "--speed", "2.0"], "replay")
    run([sys.executable, MAIN, "replay", "--input", SESSION, "--no-timing"], "replay_cat")
    run([sys.executable, MAIN, "export", "--input", SESSION, "--output", "SESSION.md",
         "--include-timing"], "export")
    run([sys.executable, MAIN, "info", "--input", "../escape"], "traversal")
    run([sys.executable, MAIN, "info", "--input", "ghost"], "missing")

    # Collision probe: validate_session_name() accepts '.', but
    # get_session_paths() builds names with Path.with_suffix(), which silently
    # replaces everything after the last dot.
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import main as tsm
    m = tsm.TerminalSessionManager()
    print("\n$ python3 -c 'dotted session names -> resolved paths'")
    for n in ("v1.2", "v1", SESSION):
        p = m.get_session_paths(n)
        print("  %-11s -> %s" % (n, os.path.basename(p["typescript"])))
    same = m.get_session_paths("v1.2")["typescript"] == m.get_session_paths("v1")["typescript"]
    print("  collision(v1.2, v1) = %s" % same)
    results["collision"] = 0 if same else 1

    print("\n=== exit codes ===")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
