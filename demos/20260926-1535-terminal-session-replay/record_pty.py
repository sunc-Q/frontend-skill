#!/usr/bin/env python3
"""Record a real interactive terminal session through a pty.

Emits the two files terminal-session-replay expects in ~/.terminal-sessions:
  <name>.typescript  raw output bytes
  <name>.timing      util-linux format: "<delay_seconds> <byte_count>" per read
"""
import os
import pty
import select
import signal
import sys
import time

name = sys.argv[1]
outdir = sys.argv[2]
lines_file = sys.argv[3]

with open(lines_file) as f:
    feed = [ln.rstrip("\n") for ln in f if ln.strip()]

# Optional per-command pause, one float per feed line (keeps the demo reproducible).
pace_path = lines_file.replace("feed.txt", "pace.txt")
pace = []
if os.path.exists(pace_path):
    pace = [float(x) for x in open(pace_path).read().split()]

os.makedirs(outdir, exist_ok=True)
ts_path = os.path.join(outdir, name + ".typescript")
tm_path = os.path.join(outdir, name + ".timing")

pid, fd = pty.fork()
if pid == 0:
    os.environ["PS1"] = "❯ "
    os.environ["PS2"] = ""
    os.environ["TERM"] = "dumb"
    os.environ.pop("PROMPT_COMMAND", None)
    os.execvp("/bin/sh", ["/bin/sh", "-i"])

ts = open(ts_path, "wb")
tm = open(tm_path, "w")
last = time.monotonic()
pending = list(feed)
deadline = time.time() + 45

while True:
    now = time.monotonic()
    if time.time() > deadline:
        break
    r, _, _ = select.select([fd], [], [], 0.05)
    if r:
        try:
            data = os.read(fd, 4096)
        except OSError:
            data = b""
        if not data:
            break
        delay = now - last
        last = now
        ts.write(data)
        tm.write("%.6f %d\n" % (delay, len(data)))
        tm.flush()
        continue
    if not pending:
        if time.monotonic() - last > 1.0:
            break
        continue
    cmd = pending.pop(0)
    try:
        os.write(fd, (cmd + "\n").encode())
    except OSError:
        break
    # Human cadence: the pause lands on the *next* read, which is exactly what
    # the util-linux timing format records.
    time.sleep(float(pace.pop(0)) if pace else 0.5)

try:
    os.write(fd, b"exit\n")
except OSError:
    pass
ts.close()
tm.close()

# An interactive /bin/sh ignores SIGHUP, so escalate TERM -> KILL and never
# block forever in waitpid().
def _reap(sig):
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        pass
    for _ in range(20):
        if os.waitpid(pid, os.WNOHANG)[0]:
            return True
        time.sleep(0.1)
    return False

for _ in range(10):
    if os.waitpid(pid, os.WNOHANG)[0]:
        break
    time.sleep(0.1)
else:
    _reap(signal.SIGTERM) or _reap(signal.SIGKILL)
print("recorded %s -> %s" % (name, ts_path))
