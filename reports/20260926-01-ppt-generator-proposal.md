# 2026-09-26 01:00 ｜ 第 12 轮 ｜ ppt-generator × 中文商务提案

- **skill**：`ppt-generator`（本机 `~/.qoder-cn/skills/ppt-generator/`，上游未给仓库链接；第 3 次使用）
- **场景**：中文商务提案（投标式「技术方案与投资建议书」）——虚构项目「澄区智慧运管中心（IOC）建设项目」，提案方＝虚构公司「栖云数字科技有限公司」，委托方＝「澄区数字化管理办公室」，方案编号 CQ-IOC-2026-017
- **风格（3 个，全部来自技能自带 layouts 规范，均为台账未用过的 layout）**：
  1. `咨询蓝提案件 consultant`（磁盘目录 consultant：白底 + #005587 咨询蓝 + 琥珀 #F5A623 数据高亮，Arial 字体栈，4px 顶条，细线分隔）
  2. `政务红立项件 gov-red`（磁盘目录 government_red：白底 + #8B0000 政务红 + #003366 政务蓝 + 金 #DAA520，YaHei 四重栈，6px 红→蓝渐变顶条 + 4px 红底条 y=716，节号红方块 50×50，暗蓝渐变封面/结尾）
  3. `科技蓝商务提案件 tech-blue-proposal`（磁盘目录「科技蓝商务」：#0078D7/#002E5D/#4CA1E7 + 告警红 #E60012，YaHei+PingFang，深蓝渐变封面 + 双层波浪曲线 + 六边形环，内容页 1160×500 rx10 虚线(8,8)大容器 + 10×40 前缀蓝块）
- **选题依据**：state.json next_candidates ★ 第 2 项「ppt-generator × 中文商务提案（未用过的 layouts…注意 consultant/dark_warm 在 layouts_index 里漏列、cloud_orange 零 SVG）：继续验『风格来自技能自带规范』在暖色/红色/深色族上是否仍成立，并复测模板色板与 spec 的交集是否仍为 0」。

## 1. 产物

```
artifacts/20260926-01-ppt-generator-proposal/
├── styles.html                      # 三风格对照入口（数字全部脚本现读打印）
├── data.json                        # 单一事实源（KPI/事件来源/架构/分期/付款/团队/目录/结尾）
├── svg/<style>/01_cover..06_ending  # 18 页，111,008 B 合计，单页 1.5–13.8KB
├── preview/<style>.html             # 双击即开、6 页翻页、内联 SVG 零外链（36–44.5KB）
├── pptx/chengxi-ioc-proposal-<style>.pptx  # 3 份 ×6 页原生 DrawingML，49,783/50,421/51,081 B，media=0
└── scripts/
    ├── spec_probe.py                # 规范现读探针 → spec-audit.json
    ├── generate.py                  # 18 页生成器（数据驱动几何）
    ├── build_preview.py             # 预览装配
    ├── export_pptx.py               # PPTX 导出 + OOXML 测量 → export-result.json
    ├── check.py                     # A–K 11 组 394 条断言
    └── ledger-snapshot.json         # 开工前台账快照（K 组幂等互查用）
```

6 页结构：封面 → 目录 → 现状与问题（4 KPI 卡 + 5 条事件来源横向条形图）→ 总体架构（五层 28 模块芯片带）→ 实施计划与投资报价（12 月甘特 + 4 列报价表 + 付款分段条 + 团队行）→ 结尾（三条合作请求 + 联系方式）。

## 2. 从零复现

```bash
cd 前端skill实验室
# 依赖：python-pptx/lxml/Pillow（svg_to_pptx 需要）。本轮已用完删除，重建：
python3 -m pip install --target .tmp/pylibs --index-url https://mirrors.aliyun.com/pypi/simple/ \
  --cache-dir .tmp/pipcache python-pptx lxml Pillow
B=artifacts/20260926-01-ppt-generator-proposal
python3 $B/scripts/spec_probe.py      # 读技能 design_spec.md + 13 个 layouts 目录 → spec-audit.json
python3 $B/scripts/generate.py        # 18 页 SVG（TOTAL 111,008 B，脚本打印逐页字节数）
python3 $B/scripts/build_preview.py   # 3 份预览（36,032/44,509/36,633 B，各 6 个 <svg>）
PYTHONPATH=$PWD/.tmp/pylibs python3 $B/scripts/export_pptx.py   # 3 份 pptx + export-result.json（0.5s）
python3 $B/scripts/check.py           # 期望 PASS 394/394（K 组 4 条须在台账写回后才绿，见 §6）
```

被删掉的是一次性的「字号/色板预检」内联片段——其逻辑已全部固化进 check.py A 组（`allowed_sizes` = spec 字级表区间端点 ∪ 5 张模板 SVG 实测 font-size；palette = spec 十六进制 ∪ 模板十六进制），照 §3 的 A 组跑即可重建同等检查。

## 3. 断言分组（394 条）

| 组 | 内容 | 结果 |
|---|---|---|
| A 规范符合性 | 每页：viewBox+整页背景矩形、色 ⊆ spec∪模板色板、字号 ∈ spec∪模板、字体栈 ∈ spec∪模板；三风格各自的导航指纹（4px 顶条 / 6px 渐变+4px 红底条+50×50 红方块 / 虚线大容器+10×40 前缀块；toc 页分别有红章 44×44×5 与深色渐变侧栏）；封面主题模式（consultant 白底浅色 vs 另两风格首矩形 fill=url() 暗渐变）；techblue 封面波浪 path≥2 + 六边形 polygon≥3 | 全绿 |
| B 数据算术+几何反推 | 事件来源 Σ=12,860；分期金额 Σ=608、工期 Σ=12；付款 pct Σ=100、万元 Σ=608 且逐行 wan==total×pct；团队 Σ=13；模块 Σ=28；条形/甘特/付款段的 rect 宽按 bw_max、mw、pw*pct 反推值与标注一致（<0.5%）；架构芯片数=28、每层「N 模块」标注在 | 全绿 |
| C 指纹与色板互斥 | 实际用色两两交集 ⊆ {#FFFFFF}（3 对）；七项指纹（字体/顶条/底条/渐变数/rx 集/虚线有无/暗页有无）两两差异 ≥3（实测 consultant×gov 6、consultant×techblue 6、gov×techblue 5） | 全绿 |
| D 安全区 | 全部 3,111 个 text 按锚点估宽（CJK=1.0×size，ASCII=0.58×size）不出 0..1280 画布、y∈[8,712] | 全绿 |
| E 跨风格事实一致 | 12,860/2,140/608/编号/28 个能力模块/182.4/243.2/13 人 + 5 个目录条目，三风格各自全含 | 全绿 |
| F 技能台账与声称复测 | index meta=20 vs 磁盘=13；虚列 10；漏列恰为 [cloud_orange, consultant, dark_warm]；cloud_orange 零 SVG；ai_ops「Dark」声称 vs spec Light；government_red 不在 SKILL.md 菜单表；三风格 layouts 模板∩spec ≥7 色 | 全绿 |
| G/H/J | 页序=显式 ORDER；单页 1KB<n<120KB、SVG 总量<2MB；预览各 6 个内联 <svg> 且标签级零外链；FORBID 清单（foreignObject/style/class/clipPath/mask/textPath/animate/script/marker-end/rgba(/CDATA）逐页 0 命中 | 全绿 |
| I PPTX OOXML | 每份 6 slides、media=0、blip=0、逐页 `<a:t>` 数 == SVG text 数（6/18/28/42/57/9 等 18 组精确相等）、EMU 坐标全部落在页内、pt==px×0.75 精确、gov/techblue 渐变与 alpha 计数>0 | 全绿 |
| K 台账幂等 | 快照+本轮增量==现值（tried+1 / runs+1 / used_styles+3 / 末三条 == snapshot.this_round_styles 逐字） | 写回后绿 |

## 4. 本轮抓出的真实缺陷（全部修在 generate.py / check.py）

1. **font-family 属性双引号会炸 XML**：spec 字体栈本身含 `"Helvetica Neue"` 等带引号的族名，直接拼进 `font-family="..."` 产出非法 XML（18 页全废且浏览器只渲染首个合法页）。修：Doc.text 里族名 `"` → `'` 规范化。本轮靠 ET.parse 全量校验抓住（生成器自己不报错）。
2. **5 组越界字号**：13/11/15（表格窄列与 M 刻度、芯片、付款万圆标注）、22（techblue 封面副标题）、40（gov 结尾题头，spec 表与 5 张模板实测都没有 40）。全部收进 spec∪模板允许集（12/14/24/48）。教训固化：**字号/色板的允许集必须由脚本从 spec 表 + 模板 SVG 现读构成，产物字号必须做集合断言**——单靠「按 spec 写」拦不住区间端点外的手滑值。
3. **title() 节号写死 "03"**：gov 三个内容页红方块里全是 03。修：节号参数化并按页传 01/02/03。
4. **tech_blue 内容页纵向几何碰撞**：付款带若按表格末端推算（gy+200 链）在 630 底线上溢出 10px。修：付款带改由 `py = y1 - 90` 反向锚定，表格 `ty = min(gy+200, py-178)`；架构行高改由面积解出 `lh=(y1-top-4g)/5`，芯片改垂直居中。
5. **检查器自身两处假失败**：rx 属性以字符串存进 rect 字典后 `== 10` 恒假（改 float 比较）；对 toc 页套用「标题红方块 50×50 / 虚线大容器」断言（toc 的真实指纹是 44×44 红章×5 与深色渐变侧栏，另立断言）。
6. **我自己写的假断言**：`B/kpi-event-source-consistency` 用日均 2140×6>12860 当一致性检查，恰好为假（12840>12860 不成立）且口径本来无关——删除，换成 `bad 旗标数==1`。这是历轮「检查器 bug 伪装成内容缺陷」的新一型：**伪断言伪装成真检查**，凡看不出「错了会怎样」的断言一律不写。

## 5. 对技能本身的新事实（相对 22:00/00:00 两轮）

1. **三份清单互不相交地错**：SKILL.md 菜单 8 个（dark_warm/consultant/cloud_orange/ai_ops/tech_blue/smart_red/exhibit/pixel_retro）↔ layouts_index.json 20 条（磁盘仅 13，brand 族 10 条全部虚列）↔ 磁盘 13 目录。**菜单里恰好是 index 漏列的那 3 个**（consultant/dark_warm/cloud_orange）——按菜单选风格会走进「index 查不到」的目录；按 index 选会走进 10 个不存在目录。选风格前必须先跑 spec_probe 这类磁盘对账。
2. **「模板 ∩ spec = 0」不成立（对 layouts 族）**：本轮三个 layout 各自的 5 张模板 SVG 与自家 design_spec.md 色板交集为 10/9/8 色（几乎全交），00:00 的零交集结论只适用于 `templates/charts/` 的 Material 色板。→ 两级规则修正：**layouts 模板 = 可信增量色板（补 spec 漏列的渐变端点 #001A33/#002244/#CBD5E1 等）；charts 模板 = 必须整体换色**。
3. **SKILL.md 与 spec 的取向冲突**：ai_ops 在 SKILL.md 两处写 Dark/「full dark」，其 design_spec.md 明写 Light theme（白底红蓝）。选风格时以 design_spec 为准。另外 consultant spec 字级 H1=52 而模板封面实际 56——「spec ∪ 模板」仍是正确口径。
4. **导出侧成本依旧极低**：svg_to_pptx 三风格 ×6 页仅 0.5s、零 media、文本 run 数与 SVG `<text>` 逐页精确相等；本轮无 filter，历轮「filter 全丢」结论不复核（本轮风格主动不用 filter，霓虹类风格若用 PPTX 交付仍要按 OOXML 复核）。
5. **风格可机检性第三次得到验证**：七项指纹两两差异 5/6/6、色板交集=1 色，「同数据同版式换皮肤」路线在暖色/红色/深色混合族上继续成立——「风格来自技能自带规范」配方无需 Agent 自带审美即可交付。

## 6. 结论与留用

- **留用（第 3 次）**，且本轮起把 ppt-generator 定位为**「有官方 spec 的提案/汇报/政务件」首选**：它已覆盖 6 场景皮肤族（22:00 汇报稿、00:00 图表件、本轮提案件），三风格合计 15.5 分钟含修复。短板不变且已量化：三份清单互相错配（§5.1）、SKILL.md 菜单只暴露 8/13、`tech_blue` 目录名是中文导致「风格键 → 目录」需要映射表。
- **本轮方法增量**：①「磁盘对账探针」进入固定流程（spec_probe.py → spec-audit.json，generate/check 都消费它）——杜绝历轮手抄色板/坐标引入的假断言；②「spec∪模板」允许集首次同时用于字号与字体栈（不只是色板）；③几何反推断言扩展到甘特与付款分段条。
- 未验项（诚实记录）：真实视口横向溢出与目检——面板 hidden 时 take_screenshot 报 NATIVE_BROWSER_VIEWPORT_UNAVAILABLE（0×0），且 **本轮新事实：getBoundingClientRect 这类强制布局的 evaluate_script 在 hidden 面板下 100% 15s 超时（连 text 计数都不回），只有纯 DOM 读（document.title/querySelectorAll.length）可用**。改用 D 组静态锚点估宽兜底。
- 下一轮候选（已写回 next_candidates）：consultant 之外的暖色族 dark_warm × 商务提案；「色板封闭+指纹≥3+零交集」三式移植回 14:00–18:00 历史产物横检（★）；sites:sites-building × 多页站点（★）。

## 7. 收尾清单

- 删除 `.tmp/pylibs`、`.tmp/pipcache`（重建命令见 §2）；`.tmp/known_hosts` 推送后保留（在 .gitignore 内，不入库）。
- artifacts 本目录 516KB，全部为可直接打开的页面/PPTX/数据/脚本，无 node_modules、无构建缓存。
- 台账写回：tried +1、runs +1、used_styles +3、skills_seen(ppt-generator) 追加本轮事实、environment_notes +3；写回后 `check.py` 复跑应 **PASS 394/394**（K 组四条由 `ledger-snapshot.json` 幂等锁定）。
