/* HUD skeleton + base CSS (structure shared by all three styles;
   each theme contributes only its own skin block). */

export const HUD_BASE_CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { overflow:hidden; background:#000; height:100%; }
canvas { display:block; }
#hud { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:10;
  font-family:'Segoe UI', system-ui, -apple-system, sans-serif;
  color:var(--ink); font-variant-numeric:tabular-nums; user-select:none;
  opacity:0; transition:opacity .45s ease; }
#hud.on { opacity:1; }
#hud, .screen { user-select:none; }
.hud-panel { position:absolute; background:var(--glass); backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px); border:1px solid var(--glass-line);
  border-radius:var(--radius); padding:12px 16px;
  box-shadow:var(--panel-shadow); transition:transform .3s ease, border-color .3s ease; }
.hud-tl { top:16px; left:16px; display:flex; gap:24px; align-items:flex-end; }
.hud-label { display:block; font-size:11px; letter-spacing:.14em; text-transform:uppercase;
  opacity:.62; margin-bottom:2px; }
.hud-value { display:block; font-size:clamp(20px, 2.2vw, 28px); font-weight:700; line-height:1.1; }
#gold-value { color:var(--gold); }
#gold-value.pop { animation:pop .32s ease-out; }
@keyframes pop { 0%{transform:scale(1)} 40%{transform:scale(1.14)} 100%{transform:scale(1)} }
.lives-wrap { width:180px; }
#lives-bar { position:relative; height:12px; border-radius:6px; overflow:hidden;
  background:rgba(0,0,0,.45); border:1px solid var(--glass-line); margin-top:4px; }
#lives-bar-fill { position:absolute; inset:0 auto 0 0; width:100%;
  transition:width .28s ease-out; }
#build-palette { position:absolute; left:16px; bottom:16px; display:flex; gap:8px;
  background:transparent; border:0; padding:0; backdrop-filter:none; box-shadow:none; }
.palette { pointer-events:auto; cursor:pointer; text-align:left; width:184px;
  display:grid; grid-template-columns:22px 1fr; grid-template-areas:"pk pn" "pk pc" "pd pd";
  gap:0 8px; padding:10px 12px; border-radius:var(--radius);
  background:var(--glass); border:1px solid var(--glass-line); color:var(--ink);
  backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
  transition:transform .2s ease, border-color .2s ease, background .2s ease; }
.palette:hover { transform:translateY(-3px); border-color:var(--accent); }
.palette.sel { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset, var(--sel-glow); }
.pk { grid-area:pk; align-self:center; width:22px; height:22px; border-radius:6px;
  display:grid; place-items:center; background:var(--accent-soft); font-size:12px; font-weight:700; }
.pn { grid-area:pn; font-size:13px; font-weight:600; }
.pc { grid-area:pc; font-size:13px; color:var(--gold); font-weight:700; }
.pd { grid-area:pd; font-size:11px; opacity:.6; margin-top:2px; }
.hud-tr { top:16px; right:16px; text-align:right; min-width:172px; }
#wave-value { font-size:clamp(18px,1.8vw,24px); }
.hint { font-size:11px; opacity:.55; margin-top:6px; line-height:1.5; }
#kill-feed { position:absolute; right:16px; bottom:16px; display:flex; flex-direction:column;
  gap:6px; align-items:flex-end; }
.kill-entry { font-size:12px; padding:6px 10px; border-radius:8px;
  background:var(--feed-bg); border:1px solid var(--glass-line);
  animation:feedIn .3s ease-out; transition:opacity .3s ease; }
@keyframes feedIn { from{transform:translateX(24px);opacity:0} to{transform:none;opacity:1} }
#toast-container { position:absolute; left:50%; bottom:104px; transform:translateX(-50%);
  display:flex; flex-direction:column; gap:8px; align-items:center; }
.toast { font-size:13px; padding:8px 14px; border-radius:999px; opacity:0;
  background:var(--toast-bg); border:1px solid var(--glass-line);
  transition:opacity .3s ease, transform .3s ease; transform:translateY(8px); }
.toast.show { opacity:1; transform:none; }
.toast-success { color:#4ade80; } .toast-warn { color:#fbbf24; }
.toast-error { color:#ef4444; } .toast-info { color:var(--accent); }
#announcement { position:absolute; left:50%; top:26%; transform:translate(-50%,-14px);
  text-align:center; opacity:0; transition:opacity .5s ease, transform .5s ease; }
#announcement.show { opacity:1; transform:translate(-50%,0); }
#announce-text { display:block; font-size:clamp(34px,6vw,68px); font-weight:800;
  letter-spacing:.1em; color:var(--accent); text-shadow:var(--announce-shadow); }
#announce-sub { display:block; font-size:14px; letter-spacing:.28em; text-transform:uppercase; opacity:.75; }
#damage-vignette { position:absolute; inset:0; z-index:9; opacity:0; pointer-events:none;
  background:radial-gradient(ellipse at center, transparent 52%, var(--dmg-tint) 100%);
  transition:opacity .3s ease; }
#damage-vignette.hit { opacity:.85; }
.screen { position:fixed; inset:0; z-index:20; display:none; place-content:center;
  align-items:center; justify-content:center; text-align:center; pointer-events:auto;
  background:var(--screen-bg); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  color:var(--ink); font-family:'Segoe UI', system-ui, sans-serif; user-select:none; }
.screen.on { display:grid; }
.screen h1 { font-size:clamp(40px,7vw,86px); font-weight:800; letter-spacing:.06em;
  color:var(--accent); }
.screen .sub { font-size:15px; letter-spacing:.3em; text-transform:uppercase; opacity:.7; margin:8px 0 24px; }
.screen .cta { font-size:18px; margin-bottom:22px; }
.screen .keys { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width:640px; }
.screen .keys span { font-size:12px; padding:6px 10px; border-radius:8px;
  background:var(--chip-bg); border:1px solid var(--glass-line); }
#over-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  gap:8px 20px; max-width:660px; margin:0 auto 24px; text-align:left; font-size:13px; }
#over-stats span { display:flex; justify-content:space-between; gap:16px;
  padding:6px 0; border-bottom:1px dashed var(--glass-line); opacity:.9; }
#over-stats b { color:var(--gold); font-weight:700; }
.brand { font-size:12px; letter-spacing:.4em; text-transform:uppercase; opacity:.5; margin-top:18px; }
`;

export function hudHtml(cfg) {
  return `
<div id="hud" data-screen="playing">
  <div class="hud-panel hud-tl">
    <div><span class="hud-label">金币 Gold</span><span class="hud-value" id="gold-value">0</span></div>
    <div class="lives-wrap"><span class="hud-label">哨站完整度</span>
      <span class="hud-value" id="lives-value">20</span>
      <div id="lives-bar"><div id="lives-bar-fill"></div></div></div>
  </div>
  <div class="hud-panel hud-tr">
    <span class="hud-label">波次 Wave</span><span class="hud-value" id="wave-value">0 / 10</span>
    <div class="hint">${cfg.hint}</div>
  </div>
  <div id="build-palette"></div>
  <div id="kill-feed"></div>
  <div id="toast-container"></div>
  <div id="announcement"><span id="announce-text"></span><span id="announce-sub"></span></div>
  <div id="damage-vignette"></div>
</div>
<div class="screen on" data-screen="title">
  <div>
    <h1>${cfg.title}</h1>
    <div class="sub">${cfg.subtitle}</div>
    <div class="cta">${cfg.cta}</div>
    <div class="keys"><span>1 / 2 / 3 选择塔种</span><span>点击地块建造</span><span>点击已建塔拆除（返还 70%）</span><span>守住 10 波</span></div>
    <div class="brand">${cfg.brand}</div>
  </div>
</div>
<div class="screen" data-screen="over">
  <div>
    <h1 id="over-title">—</h1>
    <div class="sub">点击重新开始</div>
    <div id="over-stats"></div>
  </div>
</div>`;
}
