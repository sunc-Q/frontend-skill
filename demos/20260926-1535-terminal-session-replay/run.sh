#!/usr/bin/env bash
# Reproduce this round from scratch. Everything stays inside the lab: HOME is
# redirected so the skill's hard-coded ~/.terminal-sessions never touches $HOME.
set -u
# Importing the skill's main.py otherwise drops __pycache__ into the read-only global skill dir.
export PYTHONDONTWRITEBYTECODE=1
HERE="$(cd "$(dirname "$0")" && pwd)"
LAB="$(cd "$HERE/../.." && pwd)"
SANDBOX="$LAB/.tmp/t21-home"
STORE="$SANDBOX/.terminal-sessions"
SKILL="/Users/apple/.qoder-cn/skills/terminal-session-replay"

rm -rf "$SANDBOX"
mkdir -p "$STORE"
cd "$HERE" || exit 1

echo "== 1. record a real session through a pty (the skill's own record is Linux-only) =="
env HOME="$SANDBOX" python3 record_pty.py deploy-run "$STORE" feed.txt || exit 1

echo "== 2. write the metadata file the skill's record() would have written =="
env HOME="$SANDBOX" python3 - <<'PY'
import datetime, json, os, sys
sys.path.insert(0, "/Users/apple/.qoder-cn/skills/terminal-session-replay/scripts")
import main as tsm
m = tsm.TerminalSessionManager()
p = m.get_session_paths("deploy-run")
json.dump({"created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "title": "Skill showcase: deploy-run smoke test",
           "description": "Recorded through a real pty because the skill record path needs util-linux script.",
           "tags": ["showcase", "terminal"],
           "command": "script --quiet --timing <timing> <typescript>"},
          open(p["meta"], "w"), indent=2)
print("meta ->", p["meta"])
PY

echo "== 3. drive every CLI sub-command of the skill for real =="
env HOME="$SANDBOX" python3 run-transcript.py "$HERE" > transcript-raw.log 2>&1
tail -16 transcript-raw.log

echo "== 4. reuse the recording + the exported markdown =="
cp "$STORE"/deploy-run.typescript "$STORE"/deploy-run.timing "$STORE"/deploy-run.meta.json "$HERE/"

echo "== 5. build the browser player and verify =="
python3 build_player.py deploy-run "$HERE" replay.html
env HOME="$SANDBOX" python3 verify.py > output.log 2>&1
rc=$?
tail -3 output.log
echo "verify exit=$rc"
exit $rc
