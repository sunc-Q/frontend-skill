#!/usr/bin/env python3
"""build_preview.py — 每个风格生成一个可双击的 6 页翻页预览（内联 SVG，零外链）。"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
TH = json.load(open(HERE / "themes.json", encoding="utf-8"))
PAGES = ["01_kpi", "02_trend", "03_compare", "04_composition", "05_ranking", "06_funnel"]
TITLES = {"01_kpi": "年度核心指标", "02_trend": "月度趋势", "03_compare": "内容线对比",
          "04_composition": "营收构成", "05_ranking": "TOP8 排行", "06_funnel": "转化漏斗"}

TPL = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{title} · 回声岛 Echo Isle 2025 年度分析</title>
<style>
body{{margin:0;background:{chrome};font-family:'PingFang SC','Microsoft YaHei',sans-serif}}
header{{display:flex;gap:8px;align-items:center;padding:10px 16px;color:{ink}}}
button{{background:{btnbg};color:{ink};border:1px solid {btnline};padding:6px 10px;cursor:pointer;font-size:13px;border-radius:{rx}px}}
button[aria-current="true"]{{background:{accent};color:{acink}}}
main{{max-width:1320px;margin:0 auto}}
.page{{display:none}}.page[data-on="1"]{{display:block}}
svg{{display:block;width:100%;height:auto}}
</style></head><body>
<header><strong>{title}</strong>{buttons}<span id="pos"></span></header>
<main>{pages}</main>
<script>
(function(){{
  var pages=[].slice.call(document.querySelectorAll('.page'));
  var btns=[].slice.call(document.querySelectorAll('button[data-i]'));
  var n=0;
  function show(i){{n=(i+pages.length)%pages.length;
    pages.forEach(function(p,k){{p.setAttribute('data-on',k===n?'1':'0');}});
    btns.forEach(function(b,k){{b.setAttribute('aria-current',k===n?'true':'false');}});
    document.getElementById('pos').textContent=(n+1)+' / '+pages.length;}}
  btns.forEach(function(b,k){{b.addEventListener('click',function(){{show(k);}});}});
  document.addEventListener('keydown',function(e){{
    if(e.key==='ArrowRight')show(n+1); if(e.key==='ArrowLeft')show(n-1);}});
  show(0);
}})();
</script></body></html>
"""

def chrome_for(key, th):
    dark = key == "pixel"
    return dict(
        chrome="#0A0C10" if dark else "#E8E8E8",
        ink=th["roles"]["body"] if not dark else "#E6EDF3",
        btnbg=th["roles"]["card"] if dark else th["background"],
        btnline=th["roles"]["card_stroke"],
        accent=th["series"][0],
        acink="#0D1117" if dark else "#FFFFFF",
        rx=th["radius"] if th["radius"] else 0,
    )

out = HERE / "preview"
out.mkdir(exist_ok=True)
for key in ("govblue", "psych", "pixel"):
    th = TH[key]
    buttons = "".join(f'<button data-i="{i}" aria-current="false">{TITLES[p]}</button>' for i, p in enumerate(PAGES))
    pages = "".join(f'<div class="page" data-on="0">{(HERE / "svg" / key / f"{p}.svg").read_text(encoding="utf-8")}</div>' for p in PAGES)
    html = TPL.format(title=f"{th['display_zh']} · 图表密集分析", buttons=buttons, pages=pages, **chrome_for(key, th))
    (out / f"{key}.html").write_text(html, encoding="utf-8")
    print(key, len(html.encode("utf-8")), "B")
