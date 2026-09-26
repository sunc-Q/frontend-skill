#!/usr/bin/env python3
"""Build a single-file HTML replay player from a recorded session.

Reads the util-linux style pair (<name>.typescript, <name>.timing) that
terminal-session-replay stores, and emits replay.html with the recording and
every event's delay inlined (file:// must not need fetch()).

Playback uses scriptreplay semantics: wait `delay`, then dump the whole chunk.
"""
import html
import json
import os
import sys

name = sys.argv[1]
store = sys.argv[2]
outfile = sys.argv[3]

with open(os.path.join(store, name + ".typescript"), "rb") as f:
    raw = f.read()
sizes = []
with open(os.path.join(store, name + ".timing")) as f:
    for line in f:
        parts = line.split()
        sizes.append((float(parts[0]), int(parts[1])))

events = []
offset = 0
for delay, size in sizes:
    chunk = raw[offset:offset + size].decode("utf-8", "replace")
    offset += size
    text = chunk.replace("\x1b\\[?2004[lh]", "").replace("\x07", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    events.append({"delay": delay, "text": text})

cursor = 0
for ev in events:
    ev["t"] = cursor
    cursor += ev["delay"]
total = cursor

PROMPT = "❯ "
lines_html = []
pos = 0
timeline = []
for i, ev in enumerate(events):
    timeline.append({"i": i, "start": pos, "end": pos + len(ev["text"]),
                     "t": ev["t"], "delay": ev["delay"]})
    pos += len(ev["text"])

full = "".join(ev["text"] for ev in events)
assert pos == len(full), "timeline does not cover the recording"

payload = {
    "name": name,
    "total": total,
    "bytes": len(raw),
    "events": events,
    "prompt": PROMPT,
}

data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

TEMPLATE = r"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>__TITLE__ — terminal session replay</title>
<style>
  :root{--bg:#0d1117;--panel:#161b22;--ink:#c9d1d9;--dim:#6e7681;--cmd:#3fb950;--accent:#58a6ff;--amber:#d29922;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
       display:flex;flex-direction:column;align-items:center;padding:24px 16px}
  h1{font-size:15px;font-weight:600;margin:0 0 2px;color:var(--ink)}
  .sub{color:var(--dim);font-size:12px;margin-bottom:14px}
  .term{width:min(880px,100%);background:var(--panel);border:1px solid #30363d;border-radius:8px;overflow:hidden;
        box-shadow:0 12px 40px rgba(0,0,0,.5)}
  .bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#010409;border-bottom:1px solid #30363d}
  .dot{width:11px;height:11px;border-radius:50%}
  .r{background:#ff5f56}.y{background:#ffbd2e}.g{background:#27c93f}
  .ttl{margin-left:8px;color:var(--dim);font-size:12px}
  pre#screen{margin:0;padding:14px 16px;min-height:420px;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px}
  .ln{display:block}
  .cmd{color:var(--cmd);font-weight:600}
  .out{color:var(--ink)}
  .cur{display:inline-block;width:8px;height:15px;background:var(--accent);vertical-align:-2px;animation:bl 1s steps(1,end) infinite}
  @keyframes bl{50%{opacity:0}}
  .ctl{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--panel);border-top:1px solid #30363d;font-size:12px}
  button{background:#21262d;color:var(--ink);border:1px solid #30363d;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit;font-size:12px}
  button:hover{border-color:var(--accent)}
  button.on{border-color:var(--accent);color:var(--accent)}
  #track{flex:1;height:6px;background:#0d1117;border:1px solid #30363d;border-radius:4px;position:relative;cursor:pointer}
  #fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent);width:0%}
  #clock{color:var(--dim);min-width:96px;text-align:right;font-variant-numeric:tabular-nums}
  .evts{width:min(880px,100%);margin-top:14px;border:1px solid #30363d;border-radius:8px;background:var(--panel);max-height:220px;overflow:auto}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{padding:5px 10px;text-align:left;border-bottom:1px solid #21262d}
  th{color:var(--dim);font-weight:500;position:sticky;top:0;background:var(--panel)}
  tr{cursor:pointer}tr:hover td{color:var(--accent)}
  td.n{color:var(--dim);font-variant-numeric:tabular-nums}
  td.preview{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px}
  .note{color:var(--dim);font-size:11px;margin-top:10px;width:min(880px,100%)}
</style></head><body>
<h1>__TITLE__</h1>
<div class="sub">__META__</div>
<div class="term">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
    <span class="ttl">__NAME__.typescript — recorded on macOS, replayed from raw timing data</span></div>
  <pre id="screen"></pre>
  <div class="ctl">
    <button id="play">Play</button>
    <button id="restart">Restart</button>
    <span class="speed"><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button></span>
    <div id="track"><div id="fill"></div></div>
    <span id="clock">0.00 / __TOTAL__s</span>
  </div>
</div>
<div class="evts"><table><thead><tr><th>#</th><th>at</th><th>wait</th><th>bytes</th><th>chunk</th></tr></thead><tbody id="evt"></tbody></table></div>
<div class="note">Playback follows <code>scriptreplay</code> semantics: sleep for the recorded delay, then write the whole chunk.
Click a row to seek. Data inlined — this file works over file:// with no network.</div>
<script>
const REC = __DATA__;
const screen=document.getElementById('screen'), fill=document.getElementById('fill'),
      clock=document.getElementById('clock'), playBtn=document.getElementById('play');
let speed=1, elapsed=0, playing=false, last=0, shown=0;

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function renderChars(n){
  const text=REC.events.slice(0,n).map(e=>e.text).join('');
  const lines=text.split('\n');
  screen.innerHTML=lines.map(l=>{
    const c=l.startsWith(REC.prompt)?'ln cmd':'ln out';
    return '<span class="'+c+'">'+(l.length?esc(l):'&nbsp;')+'</span>';
  }).join('')+'<span class="cur"></span>';
  screen.scrollTop=screen.scrollHeight;
}
function seek(n){shown=n;renderChars(n);const t=n>0?REC.events[n-1].t+REC.events[n-1].delay:0;setClock(t);}
function setClock(t){
  elapsed=t;fill.style.width=Math.min(100,t/REC.total*100)+'%';
  clock.textContent=t.toFixed(2)+' / '+REC.total.toFixed(2)+'s';
}
function step(ts){
  if(!playing)return;
  if(last)elapsed+=(ts-last)/1000*speed;
  last=ts;
  if(elapsed>=REC.total){seek(REC.events.length);playing=false;playBtn.textContent='Play';last=0;return;}
  let n=0;while(n<REC.events.length&&REC.events[n].t+0.000001<=elapsed)n++;
  if(n!==shown)renderChars(n);shown=n;
  fill.style.width=Math.min(100,elapsed/REC.total*100)+'%';
  clock.textContent=elapsed.toFixed(2)+' / '+REC.total.toFixed(2)+'s';
  requestAnimationFrame(step);
}
playBtn.onclick=()=>{playing=!playing;playBtn.textContent=playing?'Pause':'Play';last=0;
  if(playing){if(shown>=REC.events.length)seek(0);requestAnimationFrame(step);}};
// A hidden tab never fires requestAnimationFrame, so replay would silently
// freeze. The interval keeps wall-clock progress coming when the page is in the
// background; step() re-reads the clock so running both is harmless.
setInterval(()=>{if(playing&&document.hidden)step(performance.now());},200);
document.getElementById('restart').onclick=()=>{playing=false;playBtn.textContent='Play';last=0;seek(0);setClock(0);};
document.querySelectorAll('.speed button').forEach(b=>b.onclick=()=>{
  speed=+b.dataset.s;document.querySelectorAll('.speed button').forEach(x=>x.classList.toggle('on',x===b));});
document.getElementById('track').onclick=e=>{
  const r=e.currentTarget.getBoundingClientRect();
  const t=(e.clientX-r.left)/r.width*REC.total;
  let n=0;while(n<REC.events.length&&REC.events[n].t<=t)n++;
  seek(n);setClock(n?REC.events[n-1].t+REC.events[n-1].delay:0);};
const tb=document.getElementById('evt');
REC.events.forEach((ev,i)=>{
  const tr=document.createElement('tr');
  const one=ev.text.split('\n').filter(Boolean)[0]||'';
  tr.innerHTML='<td class="n">'+i+'</td><td class="n">'+ev.t.toFixed(2)+'s</td>'+
    '<td class="n">'+ev.delay.toFixed(2)+'s</td><td class="n">'+ev.text.length+'</td>'+
    '<td class="preview">'+esc(one.slice(0,80))+'</td>';
  tr.onclick=()=>{seek(i+1);setClock(ev.t+ev.delay);};
  tb.appendChild(tr);});
seek(0);setClock(0);
window.__REPLAY__={get shown(){return shown;},get total(){return REC.total;},get events(){return REC.events.length;},seek:seek};
</script></body></html>
"""

title = "deploy-run — recorded terminal session"
meta = "%d read events · %.2f s recorded · %d bytes of raw output" % (len(events), total, len(raw))
out = (TEMPLATE.replace("__TITLE__", html.escape(title))
               .replace("__META__", html.escape(meta))
               .replace("__NAME__", html.escape(name))
               .replace("__TOTAL__", "%.2f" % total)
               .replace("__DATA__", data))
with open(outfile, "w") as f:
    f.write(out)
print("events=%d total=%.3fs bytes=%d -> %s (%dB)"
      % (len(events), total, len(raw), outfile, os.path.getsize(outfile)))
