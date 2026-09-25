# 20260926-00 · ppt-generator × 图表密集分析页 · 第 11 轮复现文档

- 时段：排程 2026-09-26 00:00（第 11 轮；系统钟开工时为 09-25 23:01，上一轮目录已占用 `-23` 槽位，故本轮按排程槽命名 `-00`，与台账 `prev_run_state_updated=23:35` 的关系已在 `scripts/ledger-snapshot.json` 留证）
- 技能：`ppt-generator`（`~/.qoder-cn/skills/ppt-generator/`，SVG→原生 DrawingML PPTX 生成器；本轮首次动用其 `templates/charts/` 33 张图模板 —— 台账 ★ 首选候选）
- 场景：**图表密集分析页（新场景）** —— 虚构内容平台「回声岛 Echo Isle」2025 年度经营分析：每风格 6 页（KPI / 趋势 / 对比 / 构成 / 排行 / 漏斗），三风格同数据同版式，只有规范驱动的外观不同
- 风格：`government_blue 政务蓝` / `psychology_attachment 疗愈蓝绿` / `pixel_retro 霓虹像素` —— 均为技能自带 layouts 规范，与台账 30 个已用风格零重叠，两两色板交集 ⊆ {#FFFFFF}
- 判定：**留用（升级为「图表类汇报件」首选路径）**。核心成果：①「SVG 图模板 → 数据驱动可编辑图表」的距离被量化为可复现配方；②抓到模板库自身的算术不诚实（donut/funnel）并全部现算绕开；③实测 PPTX 导出丢弃一切滤镜（技能文档级验证）
- 断言：**353/353 全绿**（`scripts/check.py`，A–K 十一组）
- 产物：`artifacts/20260926-00-ppt-generator-charts/` 合计 **490,790 B ≈ 479KB**（限额 50MB）

---

## 1. 选题与去重依据

开工前读 `records/work-log.md`（10 行）与 `state/state.json`（tried=10 / runs=10 / used_styles=30 / skills_seen=17 / environment_notes=56 / next_candidates=27），快照落 `scripts/ledger-snapshot.json`（显式快照，G1–G4 断言引用）。next_candidates 中 ★ 首选即「ppt-generator × 图表密集分析页：33 张 charts 模板至今未真用，SKILL.md 正文只字未提」——22:00 报告 §7-7 与 §10 未验项直接指向它。

去重核对：`tried` 无该组合（G6）；三风格未见于 `used_styles`（G5，含旧别名「和纸浮世绘 ukiyo」等 30 项逐一比对）；风格命名带「图表件」后缀防字面撞车（21:00 教训）。

## 2. 本轮要回答的三个问题与答案

1. **charts_index.json 与磁盘是否像 layouts_index 一样不符？** —— **完全相符**（H1–H6）：meta.total=33 == 磁盘 33 == 条目 33；categories 与 quickLookup 的全部引用在盘上存在；33 条目五个字段（label/summary/bestFor/avoidFor/keywords）齐全；33 张全部 viewBox `0 0 1280 720`。这是该技能资产索引第一次全绿，也是 22:00「index 与磁盘大面积不符」结论的**反例**：问题只在 SKILL.md 正文——它 0 次提及 `templates/charts`（H12），只有 frontmatter description 写着「30+ charts」；索引文件自己说「AI/程序化优先读 charts_index.json」，但按 SKILL.md 走流程的 Agent 永远不会知道它存在。
2. **模板烧死的样例数据可信吗？** —— **一半可信，一半是雷**（`scripts/template-audit.py` 逐项反推，结论存 `scripts/template-audit.json`）：
   - `bar_chart`：诚实。6 柱高 = 值×2px、同基线 550，逐柱误差 0.00%。
   - `horizontal_bar_chart`：诚实。8 条宽 = %×9px 精确（92%→828）。
   - `donut_chart`：**不诚实**。声明 35%/28%/20%/12%/5%（角度 126/100.8/72/43.2/18°），但由路径端点反推的实测扫角是 **119.4/104.1/63.0/55.9/17.6°**，漂移 −6.6/+3.3/−9.0/+12.7/−0.4°——合计仍恰好 360°（所以肉眼和「加总校验」都发现不了），最大一片扇形画多了 29%。照抄模板路径 = 复刻一张假图。
   - `funnel_chart`：**不诚实**。顶宽实测 600/510/420/330 —— 等差 −90px，与占比（100/45/18/6.5%）毫无关系；若如实编码应得 600/270/108/39。
   - `line_chart`：x 间距恒 85px 但**数据点无任何数值标注**，诚实性不可判；`kpi_cards` 四卡（x=60/660, y=150/440, 560×250）标签左缘偏移全部 40px —— 结构对齐是好的（我第一版凭把 660 记成 640 出了错，见 §8-1）。
   - 与风格规范的冲突：6/6 模板全部使用 `feGaussianBlur` 阴影；`funnel_chart` 含 1 个 `<marker>`（三风格 spec 硬禁，规则 6/7）；`line/funnel` 用裸 `opacity=`（spec 要求 fill-opacity）。
3. **SVG 图模板 → 原生可编辑 PPTX 图表的距离？** —— 见 §5/§6：距离=「用生成器现算几何」这一层薄纱，导出端零位图、文本逐页保真。

## 3. 配方（如何从零重建这 3×6 页）

```bash
cd 前端skill实验室/artifacts/20260926-00-ppt-generator-charts
python3 scripts/template_audit.py     # 审计 33 模板与 index（读技能目录，不写）
python3 scripts/generate.py           # data.json + themes.json → svg/<style>/0X_*.svg ×18
python3 scripts/build_preview.py      # → preview/<style>.html ×3（内联 SVG 翻页）
# PPTX 导出（需 pypi 镜像装依赖，收尾要删）：
cd ../.. && python3 -m pip install --target .tmp/pylibs \
  --index-url https://mirrors.aliyun.com/pypi/simple/ --cache-dir .tmp/pipcache \
  python-pptx lxml Pillow
PYTHONPATH="$PWD/.tmp/pylibs" python3 artifacts/.../scripts/export_pptx.py   # → pptx/×3 + export-result.json
cd artifacts/20260926-00-ppt-generator-charts && python3 scripts/check.py    # 353 条断言（写回台账前后均全绿，见 §5 G 行）
rm -rf ../../.tmp                                                             # 收尾
```

设计要点：
- **`data.json` 是唯一事实源**，`themes.json` 逐项固化三份 design_spec（色板/字级/字体栈/安全区/圆角/槽位）。
- **`generate.py` 的 `TPL` 常量 = 模板结构骨架**（轴 140–1160/150–550、柱宽 50 距 180、趋势 x=225+85k、环心 400,410 R180/r100、条 300..1200 高 36 距 60、漏斗 cx640 高 80、KPI 卡 60/660×150/440 560×250、文本左缘 +40）；H16–H21 断言保证「骨架承自模板」。唯一显式偏离：漏斗 5 级把模板间距 110 压到 105（110 会顶穿 y=680 页脚），偏离写进代码注释与 H21。
- **所有几何现算**：柱高 v×0.25px/万、条宽 v×0.18、扇形角 v/3846×360（弧端点由 `sin/cos` 生成，E4 反解实测 ±0.05°）、漏斗宽 = `120 + 480×占首级比`（含基线宽度防末级 11px 不可读，编码公式印在页脚并由 E8 逐点核对）。
- **换色两级制**：模板 Material 色板（#2196F3 系，与任何 layouts spec 交集为 0）整体弃用，图表槽位改指风格 series 五色 —— 这是 22:00「spec ∪ 模板」规则的反向操作（风格优先）。
- **像素风格用 filter 霓虹辉光**，政务蓝/疗愈蓝绿零 filter（A4 断言 filter 出现 ⟺ pixel）；辉光**只承诺 SVG 侧生效**——见 §6。

## 4. 数据集与派生闭环（全部机检）

12 个月营收 [248..389] 合计 **3,846 万**；成本合计 3,258 → 利润 **588**、利润率 **15.3%**；五内容线 [1286,864,712,603,381] 合计 3,846（=环形中心值=趋势合计=柱图合计，F2/F4）；占比 [33.4,22.5,18.5,15.7,9.9] 和恰 100.0（E10）；漏斗 2,860,000→1,543,000→401,000→188,000→52,000，KPI 卡的「月活 18.8 万 / 付费 5.2 万」直接取自第 4/5 级（F3），delta 文本 46.9%/27.7% 由上级转化率现算（E1/E9）。TOP8 严格降序（E7）。

## 5. 断言分组（353 条全绿）

| 组 | 条数 | 内容 | 关键结果 |
|---|---|---|---|
| A | 144 | 18 页 ×8：XML/viewBox/违禁构件/filter 策略/字级≥14/**文本安全区（锚点感知估宽）**/tspan 包裹/零裸 opacity | 全过；安全区首跑抓出 2 类溢出（§8-4） |
| B | 18 | 零外链（剥 xmlns 后无 http/src/href） | 0 |
| C | 21 | 色板封闭（页内十六进制 ⊆ spec 色板）+ 每风格 5 系列色全用 | 发明色 0；首轮兑现 23:00「色板封闭」式子 |
| D | 9 | 三风格互异：色板两两交集 ⊆{FFFFFF}、六位指纹差 ≥3、用色 Jaccard<0.5 | 全过（gov↔psych 指纹差 5：标题字体/圆角/签名构件/渐变件/安全区） |
| E | 30 | 算术诚实：KPI 推算值上页、趋势 24 点重算、柱/条宽重算、扇形角 ±0.05°、漏斗宽=公式、转化/占比文本=重算、降序、占比和 100.0 | 全过（模板做不到的，生成器做到了） |
| F | 15 | 跨页跨风格：同页三风格数字多重集相等（剥离页眉页脚区 y∈[130,700]）、合计三处一致 | 全过 |
| G | 9 | 台账契约：快照 tried=10/runs=10/前轮=sites 个人主页/prev updated=23:35；**写回幂等式**（三风格各恰好 1 条、tried/runs 总长=快照+1、used_styles 总长=快照+3、末三条与快照 this_round_styles 逐字相同） | 全过；初版写成「未见于台账」会在写回后自毁，见 §8-8 |
| H | 33 | 模板血统 15（index=磁盘 33、引用零缺失、诚实度 5 项、spec 冲突 3 项、SKILL.md 0 提及）+ 结构常量承继 18 | 全过 |
| I | 60 | PPTX×3 风格：导出/页数/零位图/a:t==text 逐页/pt==px×0.75 逐页/gradFill 签名/blur=0/EMU 落幅/原生形状>0 | 全过（§6） |
| J | 11 | 预览件×3 + styles.html（18 页/3 风格声明与盘上一致、链接目标存在） | 全过 |
| K | 3 | 479KB<50MB、无 node_modules/.tmp 混入、单页 SVG≤20KB（最大 9,571B） | 全过 |

## 6. PPTX 原生导出实测（I 组）

三风格各 6 页 → `pptx/echoisle-2025-{govblue,psych,pixel}.pptx`（51,795 / 52,037 / 51,746 B）。`export_pptx.py` 显式页序（文件名无 `02_toc/02_chapter` 撞序，documented=sorted(glob) 本轮与显式一致，I4 记录该对照）。

| 测量 | 结果 |
|---|---|
| media / `<a:blip>` / `<p:pic>` | **全部 0** —— 图表（矩形/圆点/折线/弧路径/梯形）没有一个被光栅化 |
| `<a:t>` run 数 == SVG `<text>` 数 | 逐页相等（gov 34/27/22/19/29/17，psych 33/26/…，pixel 32/25/…）→ 每个数字双击可编辑 |
| 字号 | 逐页 pt 集合 == px×0.75 | 
| `<p:sp>` | 每页 26–67；pixel 每页恰 +2（双霓虹线） |
| `<a:custGeom>` | 34/文件 —— donut 扇形弧与 funnel 梯形都以自定义几何存活 |
| `<a:gradFill>` | gov=6、psych=6（每页 1 个签名渐变条）、pixel=0（I7 签名断言） |
| **`<a:blur>`** | **0/3 风格** —— **feGaussianBlur 滤镜在导出中被整体丢弃**：pixel 规范自述「filter 通常被 PPT 忽略」由此首次实测证实；霓虹辉光只存在于 SVG/预览侧 |
| `<a:alpha>` | gov 0 / psych 18 / pixel 30 —— `fill-opacity` 正确转 alpha（stop-opacity 不算） |
| EMU | 全部落在幅面内（max 11,715,750 ≤ 12,192,000；pixel 辉光滤镜区未把包围盒撑出幅面） |

## 7. 缺陷与发现（按严重度）

1. **🔴 charts 模板的样例数据不诚实（donut 角度 / funnel 宽度），且现有校验思路（加总=360°、单调递减）无法发现**——只有「路径端点反推几何 vs 声明文本」的交叉验证能抓出来。任何「照模板改改数字」的用法都会静默继承假图。本轮的对策：模板只承继**骨架常量**，数值几何 100% 现算（TPL + E 组）。
2. **🟠 SKILL.md 与 charts 资产完全脱钩**（正文 0 提及，frontmatter 却宣传「30+ charts」；charts/README 自称「优先读 charts_index.json」）。好消息：charts_index.json 与磁盘**精确一致**（与 layouts_index 的 20≠13 相反）——该技能的索引不是都坏，是 SKILL.md 没接上任何好的那部分。
3. **🟠 模板与三风格规范三方互斥**：6/6 模板用 feGaussianBlur、funnel 用 `<marker>`、line/funnel 用裸 `opacity=` ——全部踩在 design_spec 的硬约束上。即「图表模板」与「风格模板」是两套没有对过账的资产，移植时滤镜/marker 要手动拆除（A3/A4 断言模板违禁命中 0）。
4. **🟠 PPTX 导出丢一切滤镜**（实测 I 组）：对暗色霓虹风格，「导出后仍等价」不成立，SVG 预览才是所见即所得。技能文档该说法（pixel spec §IX note）可信但正文未推广。
5. **🟡 模板色板与 layouts 色板交集为 0**：想「风格一致」必须做两级换色（`themes.series` 槽位化），模板的 Material 五色（2196F3/4CAF50/FF9800/9C27B0/95A5A6）在 13 个风格规范里一个都不存在。
6. **🟡 `kpi_cards.svg` 自称「CRAP 优化版」，结构其实对齐**（偏移全 40px）——但它注释写「统一间距 40px」而卡片右缘 660+560=1220，与左卡对称性依赖画布 1280−1220=60——文档没写，容易记成 640（本轮就记错，§8-1）。
7. **🟢 亮点：本轮首次做到「产物每个数字都有出处」**——22:00 的手工柱图靠事后 F 组自证，本轮几何在生成时就由公式产生，E 组只是复核 + 反向否决模板。生成器 + 独立重算的组合可移植给前几轮 React/Vue 轮的图表。
8. **🟢 三风格指纹法在「规范驱动」任务上比手写风格更稳**：七位指纹（bg 暗/字体族/圆角/签名构件/渐变件/滤镜/安全区）全由 spec 差异天然拉开，D2 一次通过，无需临场发明。

## 8. 本轮我自己踩的坑（8 条）

1. **kpi 卡 x=660 记成 640**：凭 22:00 阅读余像写进 TPL；模板审计（card_rects）揭穿后修正重生成。教训：骨架常量必须由审计脚本从模板现读，不能手抄（已把「读盘反推互查」从内容层扩展到结构层）。
2. **`float(rect.get("x"))` 崩**：模板背景 `<rect width height>` 无 x —— 遍历 SVG 属性必先把 None 挡掉。
3. **funnel 审计正则 `阶段\d: .*?([\d,]+) \(([\d.]+)%\)` 0 命中**：模板注释里计数在 `1. 潜在客户: 10,000 (100%)` 行、阶段行没有数字；改用 `(\d[\d,]*)\s*\(([\d.]+)%\)` 全文扫。同类：hbar 的 `[^—]+` 会吃换行导致 8 个百分比只匹出 1 个，须 `[^—\n]`。
4. **安全区断言首跑 4 红**：trend 图例把「合计 3,258」塞进 legend 文本冲出 x1=1220；ranking 最大值条（867.6px）右端标签溢出。修法：图例去数字（合计本就在脚注公式里）、标签溢出时翻进条内右对齐（pixel 条内用深色字，其余白字）。**这正是 A6 该有的作用，不是误报。**
5. **I10 阈值拍脑袋 sp≥50**：漏斗页天然只有 26 个形状，属检查器 bug 不是产物 bug——改为「每页>0 且密集页≥40」。
6. **`ink_dark={"pixel":3}` 写成 int 索引 TypeError**：字典值要放 set。以及一次性 `echo ====` 再次踩 zsh =cmd 展开（历史环境注记在案，脚本里改用 `echo ==XXX`）。
7. **生成器小坑两处**：`T()` 在缺 font-family 时把字面量 `{F_PLACEHOLDER}` 吐进 SVG（应改为缺省就不写该属性）；`header()` 用 `P.body[1:]` 切掉了背景 `<rect>`（应返回整个 body）。
8. **G5/G6 写成「本轮风格/组合未见于台账」是一次性断言**：台账写回后它们必然翻转成失败，复现文档就自毁。已改为**幂等式**（各恰好 1 条 + `tried`/`runs` 总长 = 快照+1、`used_styles` 总长 = 快照+3、末三条与快照 `this_round_styles` 逐字相同），这样写回前后跑 `check.py` 都是 353/353。台账类断言一律写成「快照 + 增量 == 现值」，别写成「现值里没有」。

## 9. 浏览器实测（受限，按惯例）

面板 `visibilityState=hidden`、viewport 0×0（实测回显 `vis hidden w=0`），`take_screenshot` 不可用 → 无像素级复核。完成项：`preview/govblue.html` 6 页 6 SVG、首页 data-on 正确；body 计算底色 gov `rgb(232,232,232)`、pixel `rgb(10,12,16)`；pixel 页 `text[filter]` 存在（辉光挂在 DOM 上）；控制台 0 报错。横向溢出未验（innerWidth=0 假通过已知坑）；静态防线：页面只有固定 viewBox SVG，`max-width:1320px` 容器 + `svg{width:100%}`。超时两次（合并表达式 / navigate 后首读），按「动作与读取拆两次 + 连读取第二次」既有规程处置。

## 10. 未验项

- PowerPoint/Keynote 真机打开（本机无 Office，只验到 OOXML 层）。
- `use_compat_mode`、转场、备注页语义（22:00 遗留，仍无差异证据）。
- 其余 27 张 charts 模板（radar/heatmap/sankey/gantt/…）——本轮用了 6 张 + 审计了 index 全量。
- 模板样例数据不诚实是否**全部 33 张**如此（已测 6：2 雷 4 诚实，未测 27 张待横筛，见下轮建议）。

## 11. 收尾清单

- `.tmp/pylibs`（32MB）与 `.tmp/pipcache` 已删，`.tmp` 现为空；本轮无 node_modules / dist / 构建缓存（纯 Python，依赖 `~/.qoder-cn/skills` 的 svg_to_pptx 只 import 不写入——技能目录 `find -newer` 零命中）。
- artifacts 只留可直接打开产物：`preview/*.html`、`styles.html`、`svg/**`、`pptx/*.pptx`；**全部脚本保留**（generate/audit/check/export/build_preview + template-audit.json + export-result.json + ledger-snapshot.json），故无需向本文档转录被删代码。
- 场景目录 479KB ≪ 50MB；复现文档 = 本文件（`reports/20260926-00-ppt-generator-charts.md`）。

## 12. 复用姿势与下轮建议

**复用清单（图表类汇报件的正确打开方式）**：① 先跑 `template_audit.py` 再决定哪些模板可信，donut/funnel 类「声明 vs 绘制」交叉验证必须做；② 骨架承 TPL 常量、几何 100% 现算；③ 模板色板整体弃用走 series 槽位；④ marker/filter/裸 opacity 三件套在移植期清零；⑤ 需要霓虹/辉光的风格，交付物按 SVG/PNG 走，PPTX 会丢滤镜；⑥ 漏斗宽度用「基线+比例」编码时必须把公式印在页面上。
**下轮候选**：★ ppt-generator × 其余 27 张模板横筛诚实度（用同一把审计尺子，不产页面也可）；★ ppt-generator × 中文商务提案（government_red/medical_university/ai_ops/consultant/dark_warm/科技蓝商务 6 个未用风格在手，charts 已趟通）；charts_index 的 bestFor/avoidFor 决策表试用（选图正确性首次可断言）；`svg_quality_checker.py` 黑盒（22:00 遗留）；其余排队的 ★（sites-building × 多页站点、vercel × 真 Next.js、色板式子回植历史轮横检、graphic-gif、ascii-project-dashboard）继续候跑。

—— 报告完毕。所有数字来自 `scripts/check.py`（353/353）、`scripts/template-audit.json`、`scripts/export-result.json` 的机器输出。
