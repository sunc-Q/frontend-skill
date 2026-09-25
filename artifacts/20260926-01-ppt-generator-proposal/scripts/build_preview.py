#!/usr/bin/env python3
"""build_preview.py — 每风格一个可双击的 6 页翻页预览（内联 SVG，零外链）。皮肤 chrome 色取自风格主色。"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
PAGES = ["01_cover", "02_toc", "03_status", "04_arch", "05_plan", "06_ending"]
TITLES = {"01_cover": "封面", "02_toc": "目录", "03_status": "现状与问题", "04_arch": "总体架构",
          "05_plan": "实施与报价", "06_ending": "结尾"}
SKIN = {  # 预览外壳用风格自己的 accent/ink/bg，风格不串味
    "consultant": {"chrome": "#FFFFFF", "ink": "#2C3E50", "btnbg": "#ECF0F1", "btnline": "#ECF0F1",
                   "accent": "#005587", "acink": "#FFFFFF", "rx": 4, "bg": "#FAFAFA"},
    "government_red": {"chrome": "#003366", "ink": "#FFFFFF", "btnbg": "#002244", "btnline": "#003366",
                       "accent": "#8B0000", "acink": "#FFFFFF", "rx": 8, "bg": "#F5F7FA"},
    "tech_blue": {"chrome": "#002E5D", "ink": "#FFFFFF", "btnbg": "#002E5D", "btnline": "#0078D7",
                  "accent": "#0078D7", "acink": "#FFFFFF", "rx": 10, "bg": "#F5F5F7"},
}
TPL = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{title} · {proj}</title>
<style>
body{{margin:0;background:{bg};font-family:'PingFang SC','Microsoft YaHei',sans-serif}}
header{{display:flex;gap:8px;align-items:center;padding:10px 16px;background:{chrome};color:{ink}}}
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
</script></body></html>"""

PROJ = "澄区智慧运管中心建设项目 · 技术方案与投资建议书"
out = HERE / "preview"
out.mkdir(exist_ok=True)
for st, sk in SKIN.items():
    buttons = "".join(f'<button data-i="{i}">{TITLES[p]}</button>' for i, p in enumerate(PAGES))
    pages = "".join(
        f'<section class="page" data-page="{p}">'
        + (HERE / "svg" / st / f"{p}.svg").read_text(encoding="utf-8").replace("</svg>", "</svg>")
        + "</section>" for p in PAGES)
    html = TPL.format(title=TITLES["01_cover"] + " · 全 6 页", proj=PROJ, buttons=buttons, pages=pages, **sk)
    f = out / f"{st}.html"
    f.write_text(html, encoding="utf-8")
    print(f.name, len(html.encode("utf-8")), "bytes, svg count:", html.count("<svg"))
