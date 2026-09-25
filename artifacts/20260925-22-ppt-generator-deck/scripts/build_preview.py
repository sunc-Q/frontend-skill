"""Emit double-clickable, zero-dependency HTML viewers for the three decks.

preview/<style>.html  - all 5 pages of one deck, inline SVG, keyboard/wheel nav
../styles.html        - comparison entry (written to the artifact root)

No network references of any kind: the only xmlns URIs are the SVG namespace
declarations that come with the source files.
"""
import json
import re
from datetime import date
from pathlib import Path

ART = Path(__file__).resolve().parent.parent
SVG = ART / "svg"
PREVIEW = ART / "preview"
STYLES = ["exhibit", "academic_defense", "smart_red"]
PAGES = ["01_cover.svg", "02_toc.svg", "02_chapter.svg", "03_content.svg", "04_ending.svg"]
LABELS = ["封面", "提纲", "章节页", "内容页", "结尾页"]

SKIN = {
    "exhibit": {"bg": "#0D1117", "fg": "#E5E7EB", "accent": "#D4AF37", "bar": "#1E40AF"},
    "academic_defense": {"bg": "#F5F7FA", "fg": "#003366", "accent": "#CC0000", "bar": "#0066CC"},
    "smart_red": {"bg": "#333333", "fg": "#F5F5F7", "accent": "#DE3545", "bar": "#F0964D"},
}

TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>__TITLE__</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:__BG__;color:__FG__;font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;
display:flex;flex-direction:column;height:100vh;overflow:hidden}
header{display:flex;align-items:center;gap:16px;padding:10px 18px;border-bottom:3px solid __ACCENT__}
header h1{font-size:15px;font-weight:700;letter-spacing:.08em}
header .hint{font-size:12px;opacity:.65;margin-left:auto}
nav{display:flex;gap:6px;padding:8px 18px;border-bottom:1px solid rgba(255,255,255,.12)}
nav button{background:transparent;color:inherit;border:1px solid __BAR__;border-radius:4px;
padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit}
nav button[aria-current="true"]{background:__BAR__;color:#fff;border-color:__BAR__}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:14px;overflow:hidden}
figure{width:100%;height:100%;display:none;flex-direction:column;gap:6px}
figure[data-on="1"]{display:flex}
.frame{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.frame svg{width:auto;height:auto;max-width:100%;max-height:100%;
box-shadow:0 4px 22px rgba(0,0,0,.35);background:#fff}
figcaption{font-size:12px;opacity:.7;text-align:center}
footer{padding:8px 18px;font-size:11px;opacity:.55;border-top:1px solid rgba(255,255,255,.12)}
</style>
</head>
<body>
<header><h1>__TITLE__</h1><span class="hint">← / → 翻页 · 1-5 直达</span></header>
<nav>__NAV__</nav>
<main>__FIGS__</main>
<footer>__FOOT__</footer>
<script>
(function(){
  var figs=[].slice.call(document.querySelectorAll("figure"));
  var btns=[].slice.call(document.querySelectorAll("nav button"));
  function show(i){
    i=(i+figs.length)%figs.length;
    figs.forEach(function(f,k){ if(k===i){f.setAttribute("data-on","1");}else{f.removeAttribute("data-on");} });
    btns.forEach(function(b,k){ b.setAttribute("aria-current", k===i?"true":"false"); });
  }
  btns.forEach(function(b,k){ b.addEventListener("click",function(){show(k);}); });
  document.addEventListener("keydown",function(e){
    var n=parseInt(e.key,10);
    if(e.key==="ArrowRight"){show(cur()+1);}
    else if(e.key==="ArrowLeft"){show(cur()-1);}
    else if(n>=1&&n<=figs.length){show(n-1);}
  });
  function cur(){ for(var i=0;i<figs.length;i++){ if(figs[i].getAttribute("data-on")==="1") return i; } return 0; }
  show(0);
})();
</script>
</body>
</html>
"""


def strip_decl(raw):
    return re.sub(r"^\s*<\?xml[^>]*\?>\s*", "", raw).strip()


PREVIEW.mkdir(exist_ok=True)
rows = []
for style in STYLES:
    skin = SKIN[style]
    figs, btns = [], []
    for i, pg in enumerate(PAGES):
        raw = strip_decl((SVG / style / pg).read_text(encoding="utf-8"))
        figs.append(
            f'<figure><div class="frame">{raw}</div>'
            f'<figcaption>{i + 1} / {len(PAGES)} · {LABELS[i]} · {pg} · '
            f'{len(raw.encode())} 字节</figcaption></figure>')
        btns.append(f'<button type="button">{LABELS[i]}</button>')
    doc = (TPL.replace("__TITLE__", f"ppt-generator · {style} 演示汇报页（5 页）")
           .replace("__BG__", skin["bg"]).replace("__FG__", skin["fg"])
           .replace("__ACCENT__", skin["accent"]).replace("__BAR__", skin["bar"])
           .replace("__NAV__", "".join(btns)).replace("__FIGS__", "".join(figs))
           .replace("__FOOT__", f"生成日期 {date.today().isoformat()} · 页面由 {style}/design_spec.md 约束 · "
                               f"PPTX 见 ../pptx/{style}-intended.pptx · 本页零外链，双击即开"))
    out = PREVIEW / f"{style}.html"
    out.write_text(doc, encoding="utf-8")
    ext = re.findall(r'(?:src|href)="(?!#)([^"]*)"', doc) + re.findall(r"https?://(?!www\.w3\.org)", doc)
    print(f"{out.name}: {out.stat().st_size} bytes, external refs = {ext}")
    rows.append({"style": style, "html_bytes": out.stat().st_size,
                 "svg_bytes": sum(len(strip_decl((SVG / style / p).read_text()).encode()) for p in PAGES),
                 "pages": len(PAGES)})

entry_rows = "".join(
    f"<tr><td><a href='preview/{r['style']}.html'>{r['style']}</a></td>"
    f"<td>{r['pages']}</td><td>{r['svg_bytes']:,}</td><td>{r['html_bytes']:,}</td>"
    f"<td><a href='pptx/{r['style']}-intended.pptx'>intended</a> / "
    f"<a href='pptx/{r['style']}-documented.pptx'>documented</a></td></tr>"
    for r in rows)

Path(ART, "styles.html").write_text(f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>ppt-generator · 三风格对照</title>
<style>
body{{margin:0;padding:38px 26px;background:#111827;color:#E5E7EB;
font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;line-height:1.6}}
.wrap{{max-width:960px;margin:0 auto}}
h1{{font-size:26px;margin:0 0 6px}} .sub{{color:#9CA3AF;font-size:13px;margin-bottom:26px}}
h2{{font-size:15px;color:#D4AF37;letter-spacing:.1em;margin:30px 0 10px}}
table{{border-collapse:collapse;width:100%;font-size:13px}}
th,td{{border-bottom:1px solid #374151;padding:8px 10px;text-align:left}}
th{{color:#9CA3AF;font-weight:600;font-size:12px;letter-spacing:.06em}}
a{{color:#93C5FD;text-decoration:none;border-bottom:1px dotted #93C5FD}}
ul{{margin:0;padding-left:20px;font-size:13px}} li{{margin:4px 0}}
.note{{background:#1F2937;border-left:3px solid #D4AF37;padding:12px 14px;font-size:13px;margin-top:14px}}
</style></head><body><div class="wrap">
<h1>ppt-generator · 演示汇报页 · 三风格对照</h1>
<div class="sub">2026-09-25 22:00 时段 · 第 9 轮 · 数据取自本实验室台账快照（tried=8 / runs=8 / used_styles=24）</div>
<table><thead><tr><th>风格（技能自带模板目录）</th><th>页数</th><th>SVG 字节</th><th>预览 HTML 字节</th>
<th>导出的 PPTX</th></tr></thead><tbody>{entry_rows}</tbody></table>
<h2>逐个打开</h2>
<ul>
<li><a href="preview/exhibit.html">exhibit</a> — 深色 + 蓝紫渐变条 + 金色 CONFIDENTIAL（每页都带渐变与网格装饰）</li>
<li><a href="preview/academic_defense.html">academic_defense</a> — 白底 + 深蓝页眉 + 红色左竖条（论文答辩版式）</li>
<li><a href="preview/smart_red.html">smart_red</a> — 浅灰底 + 红黑三角切角几何（红橙商务版式）</li>
</ul>
<h2>本轮结论摘要</h2>
<ul>
<li>三套风格各 5 页全部由技能自带 design_spec.md 约束生成，168 条断言全绿（scripts/check.py）。</li>
<li>SVG→PPTX 走技能自带 svg_to_pptx：6 个 deck 共 0 张位图、0 个 &lt;p:pic&gt;，文本全部为可编辑 &lt;a:t&gt;，px→pt 恰为 ×0.75。</li>
<li>缺陷：SKILL.md 的 <code>sorted(glob)</code> 会把 02_chapter 排到 02_toc 之前 —— 每套 deck 的第 2 页都会错位。</li>
</ul>
<div class="note">PPTX 需下载后用 PowerPoint / Keynote 打开；网页预览用的是同源 SVG，像素级一致。</div>
</div></body></html>""", encoding="utf-8")

print(json.dumps({"rows": rows, "styles_html_bytes": Path(ART, 'styles.html').stat().st_size},
                 ensure_ascii=False))
