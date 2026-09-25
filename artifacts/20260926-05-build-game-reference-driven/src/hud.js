/* HUD markup + framework CSS. The three skins live in themes.js (generated);
   this file is style-agnostic on purpose so that "same skeleton, three skins"
   is checkable by comparing DOM structure across the three deliverables. */

export function hudHtml({ title, sub, cta, hint, brand }) {
  return `
<div id="hud">
  <div class="hud-top">
    <div class="panel quest-panel" data-hud="quest">
      <div class="stat-label" id="quest-kicker">当前目标</div>
      <div class="quest-title" id="quest-title">—</div>
      <div class="quest-desc" id="quest-desc">—</div>
      <div class="bar"><div class="bar-fill" id="quest-bar" style="width:0%"></div></div>
      <div class="quest-progress" id="quest-progress">0 / 0</div>
    </div>
    <div class="panel clock-panel" data-hud="clock">
      <div class="stat-label">昼夜</div>
      <div class="phase-value" id="phase-value">白昼</div>
      <div class="stat-label">已用 <span class="accent" id="time-value">0:00</span></div>
      <div class="bar"><div class="bar-fill" id="day-bar" style="width:0%"></div></div>
    </div>
  </div>
  <div class="hud-left">
    <div class="panel life-panel" data-hud="lives">
      <div class="stat-label">体力</div>
      <div class="life-pips" id="life-pips"></div>
    </div>
    <div class="panel satchel-panel" data-hud="satchel">
      <div class="stat-label">光囊</div>
      <div class="satchel-pips" id="satchel-pips"></div>
      <div class="satchel-note" id="satchel-note">回中央光柱交付</div>
    </div>
  </div>
  <div class="hud-bottom">
    <div class="panel hint-panel" data-hud="hint"><span class="accent">WASD</span> 移动 · <span class="accent">拖动鼠标</span> 转视角 · <span class="accent">E</span> 交互/对话 · <span class="accent">Shift</span> 疾行</div>
  </div>
  <div id="toast-container"></div>
  <div id="dialogue" class="panel" data-hud="dialogue" hidden>
    <div class="dlg-speaker" id="dlg-speaker">流萤</div>
    <div class="dlg-line" id="dlg-line"></div>
    <div class="dlg-choices" id="dlg-choices"></div>
    <div class="dlg-hint" id="dlg-hint">按 1 / 2 选择，E 继续</div>
  </div>
  <div id="prompt" class="prompt" hidden></div>
  <div id="damage-vignette"></div>
  <div id="announce"></div>
</div>
<div id="title-screen" class="screen">
  <div class="screen-inner panel">
    <div class="kicker">${brand}</div>
    <h1 class="title">${title}</h1>
    <div class="subtitle">${sub}</div>
    <p class="blurb">夜里会浮出灰烬碎片。天黑前把光囊交给光柱，天黑后去寻那些只有暗处才亮的东西。</p>
    <div class="cta" id="start-cta">${cta}</div>
    <div class="controls">${hint}</div>
    <div class="record" id="record-line">尚无记录</div>
    <div class="provenance" id="provenance"></div>
  </div>
</div>
<div id="end-screen" class="screen" hidden>
  <div class="screen-inner panel">
    <div class="kicker" id="end-kicker">结算</div>
    <h2 class="title" id="end-title">—</h2>
    <div class="stats-grid" id="end-stats"></div>
    <div class="cta" id="restart-cta">点击再来一次</div>
  </div>
</div>`;
}

export const HUD_BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:#05070a}
canvas{display:block}
#hud{position:fixed;inset:0;pointer-events:none;z-index:10;font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif;color:#f4f6fa}
.hud-top{position:absolute;top:18px;left:18px;right:18px;display:flex;gap:14px;justify-content:space-between}
.hud-left{position:absolute;top:120px;left:18px;display:flex;flex-direction:column;gap:12px}
.hud-bottom{position:absolute;bottom:18px;left:50%;transform:translateX(-50%)}
.panel{padding:12px 16px;min-width:220px;backdrop-filter:blur(6px)}
.quest-panel{max-width:340px}
.stat-label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.72}
.quest-title{font-size:19px;font-weight:650;margin-top:2px}
.quest-desc{font-size:12.5px;opacity:.8;margin-top:3px;line-height:1.45}
.quest-progress{font-size:11px;margin-top:5px;font-variant-numeric:tabular-nums;opacity:.85}
.bar{height:5px;background:rgba(255,255,255,.16);margin-top:8px;overflow:hidden;border-radius:99px}
.bar-fill{height:100%;width:0%;transition:width .25s ease}
.clock-panel{text-align:right;min-width:150px}
.phase-value{font-size:22px;font-weight:700;letter-spacing:.04em}
.life-pips,.satchel-pips{display:flex;gap:5px;margin-top:6px}
.pip{width:16px;height:16px;border:1px solid rgba(255,255,255,.4);border-radius:4px;background:rgba(255,255,255,.06)}
.pip.on{background:currentColor;border-color:transparent}
.satchel-note{font-size:11px;opacity:.7;margin-top:6px}
.hint-panel{font-size:12px;letter-spacing:.03em;opacity:.9}
#toast-container{position:absolute;right:18px;bottom:18px;display:flex;flex-direction:column;align-items:flex-end;gap:7px}
.toast{padding:8px 13px;font-size:12.5px;border-radius:8px;background:rgba(10,14,20,.82);border:1px solid rgba(255,255,255,.16);animation:toastIn .28s ease both}
.toast.out{animation:toastOut .5s ease both}
@keyframes toastIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes toastOut{to{opacity:0;transform:translateY(-6px)}}
#dialogue{position:absolute;left:50%;bottom:74px;transform:translateX(-50%);width:min(560px,86vw);pointer-events:auto}
.dlg-speaker{font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.75}
.dlg-line{font-size:15.5px;line-height:1.55;margin-top:5px;min-height:44px}
.dlg-choices{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.dlg-choice{font-size:13.5px;padding:6px 9px;border:1px solid rgba(255,255,255,.24);border-radius:7px;cursor:pointer;pointer-events:auto}
.dlg-choice[sel="1"]{border-color:currentColor;background:rgba(255,255,255,.08)}
.dlg-hint{font-size:11px;opacity:.6;margin-top:7px}
.prompt{position:absolute;left:50%;top:58%;transform:translateX(-50%);font-size:13px;padding:6px 12px;border-radius:99px;background:rgba(8,12,18,.78);border:1px solid rgba(255,255,255,.2)}
#damage-vignette{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 42%,rgba(190,40,40,.62) 100%);transition:opacity .35s ease}
#announce{position:absolute;left:50%;top:32%;transform:translateX(-50%);font-size:30px;font-weight:700;letter-spacing:.08em;opacity:0;text-shadow:0 4px 24px rgba(0,0,0,.6);white-space:nowrap}
#announce.show{animation:ann 1.6s ease both}
@keyframes ann{0%{opacity:0;transform:translateX(-50%) scale(.94)}14%{opacity:1;transform:translateX(-50%) scale(1)}78%{opacity:1}100%{opacity:0}}
.screen{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(4,6,10,.72),rgba(4,6,10,.9));font-family:"Segoe UI",system-ui,sans-serif;color:#f4f6fa}
.screen[hidden]{display:none}
.screen-inner{max-width:560px;width:86vw;padding:26px 30px;pointer-events:auto}
.kicker{font-size:11px;letter-spacing:.22em;text-transform:uppercase;opacity:.62}
.title{font-size:34px;font-weight:750;letter-spacing:.01em;margin-top:6px}
.subtitle{font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-top:3px}
.blurb{font-size:13.5px;line-height:1.62;opacity:.86;margin-top:13px}
.cta{margin-top:17px;display:inline-block;font-size:14px;letter-spacing:.06em;padding:9px 17px;border:1px solid currentColor;border-radius:9px;cursor:pointer}
.controls{font-size:12px;opacity:.66;margin-top:11px}
.record{font-size:12px;margin-top:9px;opacity:.8;font-variant-numeric:tabular-nums}
.provenance{font-size:10.5px;line-height:1.7;opacity:.52;margin-top:14px;border-top:1px solid rgba(255,255,255,.14);padding-top:9px;font-variant-numeric:tabular-nums;white-space:normal}
.provenance b{font-weight:600;opacity:.9}
.stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px;font-size:13px}
.stats-grid div{display:flex;justify-content:space-between;border-bottom:1px dashed rgba(255,255,255,.16);padding-bottom:4px}
.stats-grid span{font-variant-numeric:tabular-nums}
`;
