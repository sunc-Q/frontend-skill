# 20260925-22 · ppt-generator × 演示汇报页 · 第 9 轮复现文档

- 时段：2026-09-25 22:00（第 9 轮；台账前一行为 21:00）
- 技能：`ppt-generator`（`~/.qoder-cn/skills/ppt-generator/`，用户 19:06 装入，SVG→原生 DrawingML PPTX 生成器）
- 场景：**演示汇报页（新场景）** —— 5 页标准汇报稿（封面 / 提纲 / 章节页 / 内容页 / 结尾页），主题自指：把本实验室 8 轮台账做成一份汇报
- 风格：`exhibit`（咨询图表深底）/ `academic_defense`（论文答辩学术白）/ `smart_red`（红黑几何切角）—— 均为技能自带模板目录，与台账 24 个已用风格零重叠
- 判定：**留用（限定场景：需要 PPT/汇报稿时首选）**。产物质量高、规范可机检、导出真的是可编辑原生形状；但 SKILL.md 与磁盘资产不一致的地方最多（详见 §7）
- 断言：**184/184 全绿**（`scripts/check.py`，A–I 九组：A 结构 61 / B 零外链 15 / C 规范符合 15 / D 三风格互异 10 / E 跨稿数据一致 8 / F 几何与算术 17 / G 台账互查 13 / H PPTX 导出 29 / I 预览件 16）
- 产物：`artifacts/20260925-22-ppt-generator-deck/` 合计 **504KB**（限额 50MB）

---

## 1. 选题与去重依据

前一运行先读 `records/work-log.md`（8 行）与 `state/state.json`（tried=8 / runs=8 / used_styles=24 / skills_seen=15 / environment_notes=45 / next_candidates=12），快照落在 `scripts/ledger-snapshot.json`（显式快照，沿用上轮教训：**不可用「现值 − 本轮新增」反推运行前状态**）。

本机未试且可自主调用的技能剩 3 个：`ppt-generator`(19:06)、`graphic-gif`(19:37)、`ascii-project-dashboard`(17:36)。选 `ppt-generator` 的理由是它直接回应了前 8 轮反复记录的最大短板 ——「规范型技能不给视觉主张」（16:00 frontend-development「风格主张完全缺失」、17:00/18:00 vercel 无视觉条款、21:00 drafter 只有单风格主张）。ppt-generator 自带 **13 个模板目录**，每个含 `design_spec.md`（画布/安全区/色板/字级/页面结构/SVG 硬约束）+ 5 张参考 SVG，即「风格来自技能而不是临场发挥」的第一次真实检验。

「演示汇报页」是新场景：前 8 轮全为 Web 页面（落地页 / 仪表盘 / 报表 / 后台 / 定价 / 活动 / 架构说明）。

## 2. 环境与依赖（本轮新增事实）

- **pypi 镜像可达**：`https://mirrors.aliyun.com/pypi/simple/` HEAD 200 / 0.12s。这与台账里「GitHub HTTPS 被 TLS 重置」不冲突 —— 阿里系镜像通，GitHub 不通。因此本轮能把技能文档承诺的「SVG→PPTX」真正跑完，而不是只停在 SVG。
- 安装走隔离目录，不污染全局：
  ```bash
  cd 前端skill实验室
  python3 -m pip install --target .tmp/pylibs \
    --index-url https://mirrors.aliyun.com/pypi/simple/ \
    --cache-dir .tmp/pipprobe \
    python-pptx lxml Pillow
  # python-pptx 1.0.2 / lxml 6.1.3 / Pillow 12.3.0 / typing_extensions 4.16.0 / XlsxWriter 3.2.9
  ```
  运行脚本时 `PYTHONPATH=".../前端skill实验室/.tmp/pylibs" python3 scripts/export_pptx.py`。收尾时 `.tmp/`（32MB pylibs + 10MB wheel 缓存）已全部删除 —— 见 §11。
- `timeout` 命令 macOS 无（沿用已知事实），一律用工具级超时。
- `https://www.svgrepo.com/vectors/arrow-up/` HEAD → **HTTP 429 Too Many Requests**（0.64s）。TLS 层是通的（不像 GitHub），但该技能要下的 640 个图标必然撞限流，故未尝试下载（见 §7-6）。

## 3. 技能契约 vs 本轮实际流程

SKILL.md 规定 5 步交互流程（Step1 确认主题与**时长** → Step2 选风格编号 → Step3 确认提纲 → Step4 生成 → Step5 交付迭代），技术流 Phase1 读 spec → Phase2 写 SVG → Phase3 `svg_to_pptx` 转 PPTX。

无人值守下的偏离（都是被迫且已记录，勿在下轮误判为技能不稳定）：

1. Step1–Step3 的用户确认全部由本轮自行代决（时长取「20 分钟 → 15–18 页」档的下界，实际 3×5=15 页；风格取三个未用过的模板目录；提纲即 §4 的五页结构）。
2. Phase2 文档写死输出到 `/tmp/ppt_svgs/{style}/`；本轮改写进 `artifacts/.../svg/{style}/`，因为实验室契约要求产物落盘在场景目录内并可被 git 收录。
3. Phase3 文档的 `sys.path.insert(0, "~/.openclaw/workspace/skills/ppt-generator/ppt-master-assets/scripts")` **在本机不存在**（该路径是上游打包残留）。真实可用路径：
   ```python
   SKILL_SCRIPTS = Path.home() / ".qoder-cn/skills/ppt-generator/ppt-master-assets/scripts"
   sys.path.insert(0, str(SKILL_SCRIPTS))
   from svg_to_pptx import create_pptx_with_native_svg
   ```
   函数签名与文档给出的 kwargs 兼容：`create_pptx_with_native_svg(svg_files, output_path, canvas_format='ppt169', verbose=True, transition='fade', transition_duration=0.5, auto_advance=None, use_compat_mode=True, notes=None, enable_notes=True, use_native_shapes=False)`。`use_native_shapes=True` 是文档强调的必传项，实测确实决定「原生形状 vs 位图」——但见 §6 的补充：本轮三种模式下都没出现位图。

## 4. 产物清单（504KB）

| 路径 | 内容 | 字节 |
|---|---|---|
| `svg/exhibit/{01_cover,02_toc,02_chapter,03_content,04_ending}.svg` | exhibit 5 页 | 2,319 / 4,310 / 1,836 / 10,454 / 2,187 |
| `svg/academic_defense/…` 同名 5 页 | 学术白 5 页 | 2,308 / 4,718 / 1,791 / 11,607 / 2,352 |
| `svg/smart_red/…` 同名 5 页 | 红黑几何 5 页 | 2,200 / 3,714 / 1,782 / 11,351 / 1,779 |
| `pptx/{style}-{intended,documented}.pptx` | 6 份导出 | exhibit 45,999×2 · academic 45,664×2 · smart_red 46,025×2（合计 275,376） |
| `preview/{style}.html` | 双击即开的 5 页翻页预览（内联 SVG + 键盘/按钮导航，零外链） | 24,369 / 26,075 / 24,097 |
| `styles.html` | 三风格对照入口 + 结论摘要 | 3,066 |
| `scripts/{check.py,export_pptx.py,build_preview.py,ledger-snapshot.json,probe/pptx_probe.py}` | 校验与导出脚本**全部保留**（故无需转录进本文档） | 23,001 / 1,825 / 8,105 / 579 / 3,812 |

SVG 合计 64,708 字节（三套分别 20,906 / 22,576 / 20,626）。三套讲同一份数据，页面类型一一对应。

**deck 内容（三套完全一致，E/F/G 组就是查这个）**：KPI = 8 轮已试组合 / 4 个技能已完成横评（内置 1 + 本机自装 3）/ 1,203 条断言（有记录的 6 轮累计）/ 1.1MB 单场景产物峰值·限额 50MB；柱状图 = 16:00–21:00 六轮断言数 36,141,345,398,205,78；表格 = sites:sites-building 3 轮 / vercel-react-best-practices 4 / frontend-development 1 / drafter 1（限定场景），合计轮次 8，脚注说明 19:00 为双技能叠加轮故技能轮次相加为 9；来源行 = `state/state.json 与 records/work-log.md @ 2026-09-25 22:00 快照`。

## 5. 断言分组结果（184 条，全绿）

| 组 | 条数 | 覆盖 | 关键量化结果 |
|---|---|---|---|
| A | 61 | 15 页存在、viewBox 恰为 `0 0 1280 720`、XML 可解析、无违禁构件（foreignObject/clipPath/mask/`<style>`/class/textPath/marker/`<script>`/`<image>`/animate/`rgba(`/`<g opacity=`）、换行只用 tspan | 违禁构件命中 0；ET.fromstring 15/15 通过 |
| B | 15 | 零外链 | 每页 `src/href` 外部引用 0；`url(#top-gradient)` 属同文件内引用；唯一 URI 是 xmlns 命名空间声明，已从判定中剥离 |
| C | 15 | 逐风格规范符合度 | 色板全部可追溯（见 §7-5 的偏差量化）；最小字号 exhibit 12px / academic 12px / smart_red 14px（正文文本数 91/97/89）；透明度一律 fill-opacity；文本 x 全在安全区（exhibit/academic 40–1240、smart_red 60–1220） |
| D | 10 | 三风格互异 | 调色板 Jaccard：exhibit↔academic 0.04、exhibit↔smart_red 0.03、academic↔smart_red 0.14（共享仅 333333/666666/999999/FFFFFF）；5 页结构指纹（rect/text/line/circle/polygon/path/tspan 计数）三三互异，相同页 0；签名构件逐一在场：exhibit 每页渐变条+CONFIDENTIAL、academic 深蓝页眉+红左条、smart_red 封面 7 个三角/结尾 7 个 |
| E | 8 | 三套 deck 数据一致 | 5 个关键数字（8/4/1,203/1.1MB/50MB）三套都出现；6 个柱值标签三套都齐 |
| F | 17 | 图表与几何诚实性 | 1,203 == sum(36,141,345,398,205,78)；柱高与数值严格同序（exhibit 36→25px … 398→279px）；单一线性比例（exhibit 0.701、academic 0.752、smart_red 0.448 px/条，逐柱偏差 ≤0.6%）→ 无截断轴；6 柱共用同一基线（560/600/528）；按字形类别估算文本宽度后 15 页无一越出 1280 画布 |
| G | 13 | 台账互查（防自指数据造假） | 快照 tried=8/runs=8 == deck 的主张，且写回后 live=9/9、`tried[-1].skill==ppt-generator`、`runs[-1].time` 为 22:00（G1/G3 双向闭环：快照必须正好落后台账一轮，否则说明写回漏了或重复了）；前 8 轮去重后恰 4 个技能 = 内置 1（sites:）+ 本机自装 3（G2/G2b）；工作日志逐轮抽取的断言分项经计算得 36/141/345/398/205/78（17:00 是 39×3+24、18:00 是 284+61，图表值不是抄来的）；本轮 3 个风格名已带区分前缀记进 used_styles（24→27） |
| H | 29 | PPTX 导出结构 | 见 §6 |
| I | 16 | 可双击预览件 | 三个 HTML 各内嵌 5 张 1280×720 SVG 且仍可解析；零外链；5 个按钮 + 左右方向键处理；styles.html 的 9 个链接目标全部在盘上存在 |

运行方式（可复现）：
```bash
cd 前端skill实验室/artifacts/20260925-22-ppt-generator-deck
python3 scripts/check.py            # A–I，184 条，退出码 0
```

## 6. 原生 PPTX 导出实测（H 组，本轮最有价值的部分）

`scripts/export_pptx.py` 对三种风格各导出两份：**documented**（照 SKILL.md 的 `sorted(glob("*.svg"))`）与 **intended**（显式指定五页顺序），并故意让 `use_compat_mode` 取值不同（exhibit True / academic False / smart_red True）。用 `zipfile` 直接读 OOXML 部件做断言（`scripts/probe/pptx_probe.py` 是探索脚本，保留）。

| 断言 | 结果 |
|---|---|
| 幻灯片数 | 每份 5 页 ✓ |
| `ppt/media/` 部件 | **0**（三份 compatible-mode 组合都一样）→ 没有任何位图兜底 |
| `<p:pic>` / `<a:blip>` | 0；`<p:sp>` 分别 168（exhibit）/ 159（academic）/ 163（smart_red） |
| 文本保真 | SVG `<text>` 数 == PPTX `<a:t>` run 数：91/97/89 三套逐页相等 → 全部可双击编辑 |
| 字号换算 | 逐页 pt 集合 == px × 0.75，15/15 页精确 |
| 坐标换算 | 1px = 9525 EMU 精确（380px 三角 → `cx=3619500`）；67–79 个 `<a:off>+<a:ext>` 组合全部落在 12192000×6858000 内，越界 0 |
| 渐变 | exhibit 每页 1 个 `<linearGradient>`（`style="stop-color:#1E40AF"` 写法）→ 每页 1 个 `<a:gradFill>`，两个 `<a:gs pos>` 颜色与 `ang` 方向均正确保留 |
| 分组与透明度 | `<g stroke-opacity="0.3">` → `<p:grpSp>` + 子 `<p:sp>`，`0.3` → `<a:alpha val="30000"/>`；`chOff/chExt` 与 `off/ext` 一致 |
| 自由曲线 | smart_red 封面的闭合三点 `<path … Z>` → `Freeform` + `<a:custGeom><a:pathLst>` 三点 + `<a:close/>`，填充保留、`<a:ln><a:noFill/></a:ln>`；同页 16 个 sp 中 7 个是这种自由形 |
| 文本对齐 | `text-anchor="middle"|"end"` → `<a:pPr algn="ctr"|"r">`，逐页数量相等（注意属性名是 `algn` 不是 `al`，第一版断言就写错了） |
| 顺序缺陷 | **documented 版每套的第 2 页都是章节页（首个文本 run == "02"），intended 版第 2 页才是提纲页（AGENDA / 目 录 / 目录）** —— 缺陷见 §7-1 |
| 体积 | 同一批页面两种顺序导出的字节数完全相同（45,999 / 45,664 / 46,025），仅顺序不同 |

补充：`use_compat_mode=True/False` 在**本输入**下包内容无差异（都没写 media、部件数 56 一致）。该参数的实际效果本轮未能证伪，记为「未验项」（§10）。

## 7. 缺陷与发现（按严重度）

1. **🔴 页序缺陷：SKILL.md 的 `sorted(glob("*.svg"))` 会把 deck 排错。** 技能自己的标准文件名同时包含 `02_toc.svg` 与 `02_chapter.svg`（`layouts_index.json` 的 `meta.standardFiles` 就是这个顺序列表），按字符串排序 `chapter` < `toc`，于是**只要一份 deck 同时用到提纲页和章节页，第 2 页就错位**。三种风格 × 一次 = 3/3 复现（§6 表）。修法：显式传列表（本轮 `intended` 版即是），或把模板改名 `02a_/02b_`。这是纯文档层 bug，技能自己的资产互相矛盾，Agent 照文档写就会中。
2. **🟠 SKILL.md 的 `sys.path` 指向不存在的路径**（`~/.openclaw/workspace/skills/...`）。照抄文档第一行就 `ModuleNotFoundError`。真实路径 `~/.qoder-cn/skills/ppt-generator/ppt-master-assets/scripts`。
3. **🟠 模板索引与磁盘不符。** `layouts_index.json` 的 `meta.total=20`、列 20 个条目，磁盘只有 **13 个目录**：**10 个只列不存**（`mckinsey` `google_style` `anthropic` `中汽研_常规/商务/现代` `中国电建_常规/现代` `招商银行` `重庆大学`），**3 个只存不列**（`cloud_orange` `consultant` `dark_warm`）。其中 `cloud_orange` **只有 design_spec.md、0 张 SVG** —— 而它在 SKILL.md Step2 的风格菜单里排第 3。
4. **🟠 风格菜单与资产对不上。** SKILL.md 给 8 个选项，磁盘 13 个目录，**5 个可用却没进菜单**（`academic_defense` `government_blue` `government_red` `medical_university` `psychology_attachment`）。本轮三个风格里就有一个（`academic_defense`）不在菜单上 —— 若严格照 Step2 只让用户「回复编号」，这个模板永远不会被选到。
5. **🟡 design_spec.md 与自己模板的颜色不一致（可量化）。** 判定规则本轮写成「颜色必须属于 spec 色板 ∪ 该风格模板出现过的颜色」，结果 15 页全通过；但偏差真实存在：
   - `smart_red`：spec 主张的辅助橙 `#F0964D` 在 5 张模板里出现 **0 次**（本轮 deck 里主动用了 1 次，见结论行）；模板反向使用 **13 个 spec 未声明**的浅红/灰阶（`E86A76 E97983 F5A0A8 F8D0D3 FADCDE FDE8E9 FFC1C1 4A4A4A 555555 999999 CCCCCC EEEEEE FAFAFA`）。
   - `academic_defense`：spec 的 3 个功能色（`28A745 FFA500 17A2B8`）模板全未使用；模板用了 3 个未声明色（`002244 004080 CBD5E1`，本轮章节页的几何装饰正是取自模板）。
   - `exhibit`：spec 的正文色 `#111827` 模板未用；模板用了未声明的 `#D1D5DB`。
   照 spec 严格做会缺色，照模板做会超纲 —— 必须允许「spec ∪ 模板」两级色板，这是本轮定的可操作解法。
6. **🟡 「600+ icons」是清单不是资产。** `templates/icons/` 下只有 `README.md` `FULL_INDEX.md` `icons_index.json`（meta.total=640），**0 个 .svg 文件**；补全靠 `scripts/download_icons.py` 运行时抓 `svgrepo.com`，而 SKILL.md 正文一次都没提这个脚本。本机探测：TLS 通但 HEAD 直接 **429**。结论：图标能力在离线/限流环境不可用，且下载目标目录就是技能自身目录（会写技能目录，实验室约束下必须回避）。
7. **🟡 图表资产同样不在文档流程里。** `templates/charts/` 有 33 张图模板（bar/area/box_plot/bullet/butterfly…，与描述「30+ charts」相符），但 SKILL.md 的 Phase1 只读 layouts，正文从未提到 charts/ 与 `charts_index.json`。本轮柱状图是手工 `<rect>+<text>` 画的（因此 F3/F4/F5 那组「柱高—数值」断言才有意义：手工图必须自己保证不截断轴）。
8. **🟡 spec 的字号下限与模板自相矛盾。** exhibit `design_spec.md` 的 checklist 要求「文本可读（≥12px）」、字级表最低给 12px，但 exhibit 模板自身出现 **10px** 页脚。照模板抄就违约，照 spec 做就没参考件 —— 本轮按 spec 收严（10/11 → 12），并把模板的 10px 记为反例。`smart_red` 模板最小 14px（与 spec 的 Caption 14–16 相符），`academic_defense` 最小 12px（相符）。
9. **🟡 交互式流程与无人值守冲突。** Step1「时长必填」、Step2「回复编号」、Step3「确认后再生产」，三条都是硬等待；自动化调用必须整段跳过，跳过后技能没有任何「默认值」话术可依赖（时长→页数映射只有 4 档，没写「不知道时怎么办」）。
10. **🟢 技能自带一套 SKILL.md 未提的工程项目化流水线**：`scripts/` 下另有 `project_manager.py`、`finalize_svg.py`、`svg_quality_checker.py`、`batch_validate.py`、`svg_finalize/{flatten_tspan,embed_icons,crop_images}.py`、`image_backends/`、`error_helper.py`、`docs/svg-pipeline.md`。也就是说「官方推荐路径」只是最短路径，质量闸门其实存在但没接线到文档 —— 下轮值得把 `svg_quality_checker.py` 当黑盒试一遍（见 §12）。
11. **🟢 亮点（前 8 轮没有的）：这是第一个「视觉主张可机检且能双向兑现」的技能。** 它同时给出色板、字级、安全区、页面结构、签名构件与 SVG 硬约束，本轮把它全部转成 A/C/D 组共 86 条断言；同时 `svg_to_pptx` 的转换保真度高到可以拿 OOXML 当验收对象（§6 全绿）。相较 drafter（单风格主张、HTML 直进对话）与 vercel/frontend-development（无视觉条款），这是「让风格来自技能」第一次成立。

## 8. 本轮我自己踩的坑（8 条，全部已在盘上核对，不是回忆）

1. **正文数据写错：** KPI 最初写「6 个技能」，但前 8 轮台账里去重后只有 **4** 个（`sites:sites-building` 内置 1 + `frontend-development` / `vercel-react-best-practices` / `drafter` 自装 3）。改了 5 处（exhibit 封面/章节/提纲/内容 + academic 提纲），并把这条固化成 G2/G2b 断言（拆分叠加条目后必须 ==4）。
2. **凭印象「修 bug」两连（沿用 21:00 的教训，仍然复发）：** ① 以为 academic 内容页混进了 exhibit 色 —— 实际文件当时还没写；② 以为图表标签和卡片标题重叠 —— 按真实坐标查无重叠，那次 Edit 直接 0 命中。**规约：动手前先 grep/Read 盘上内容。**
3. **`BANNED_RE` 里放 `https?://` 造成 15 条假失败**：SVG 的 `xmlns="http://www.w3.org/2000/svg"` 必然命中。正确做法是先把 xmlns 声明剥掉再判「零外链」（20:00 轮已记过一次同类坑，这次是把「外链」和「违禁构件」两组混在一个 pattern 列表里，边界没划清）。
4. **`url(#top-gradient)` 被当成外链**：`f.strip("#")` 把开头的 `#` 也剥了，于是「本地片段」判定恒假。改成 `f.startswith("#")`。
5. **`text-anchor` 断言写成 `al="ctr"`**（DrawingML 属性名其实是 `algn`），且 `svg 数 >= pptx 数` 的宽松写法会把「完全没转换」也判成通过 → 改成逐值相等。
6. **图表断言第一版是假命题**：用「最高的 rect 是不是 398 那根」判定，结果抓到的最高 rect 是整页背景（720px）。改成「按数据标签的 x 找同列的柱 rect」配对之后，才得到真命题（柱高随值严格递增 + 单一比例 + 同基线）。顺带修了 `str(v) in got`（`got` 是 int 列表）导致 E2 恒假。
7. **G4 从工作日志抽分项时正则吃进两轮**：`(\d+)/\d+ 断言绿` 同时命中 20:00 的 205 和 21:00 的 78，于是「20:00 的分项」变成 `[205,78]` 求和 283 → 假失败。改 `[:1]` / `[-1:]` 切片并打印分项。
8. **子串命中 ≠ 位置错误**：第一版顺序断言用「slide2 是否包含章节页标题字符串」，而提纲页里本来就有那条目录项文字，导致恒不成立；改成比较 slide2 的**首个文本 run** 是不是章节页背景数字。

另：`build_preview.py` 第一版把「所有文本估算宽度之和」当「最长行宽」印进对照表 —— 5,144px 这种数一眼假，直接删列（单行宽度估算已由 check.py 的 F7 承担，且它按 start/middle/end 三种锚点分别算左右边界）。

## 9. 浏览器实测（部分完成）

`browser-use` 打开 `preview/exhibit.html`、`preview/smart_red.html`：`main` 下内联 `<svg>` 各 5 个；exhibit 页 `documentElement.scrollWidth=232 < innerWidth=641` → 无横向溢出；在 smart_red 页点第 4 个导航按钮后，`figure` 的 `data-on` 位图为 `00010`（只有第 4 页在显示）→ 翻页真的生效。

限制（与前几轮一致）：in-app Browser 面板 `visibilityState=hidden`、`viewport=0x0`，`take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE` → 本轮**没有像素级复核**。另实测 `evaluate_script` 里「点击 + 读状态」合并成一个函数会 15s 超时（页面其实已执行），拆成两次短调用即成功；`press_key` 之后紧跟一次读取也超时过一次 —— 记进环境注记。

## 10. 未验项（诚实记录）

- `use_compat_mode` 的真实语义（本轮三档都没产生差异，可能在含位图/滤镜的输入上才显现）。
- 转场（`transition='fade'`）、`enable_notes`/`notes` 参数是否写进 `notesSlide`：未检查 OOXML。
- 33 张 `charts/` 模板、`svg_quality_checker.py` 等未接入文档的脚本、图标下载链路。
- PowerPoint / Keynote 端实际打开效果（本机无 Office，只验到 OOXML 结构层）。
- 打印/PDF 导出、母版（`slideMaster`）里写了什么。

## 11. 收尾清单

- 删除 `.tmp/pylibs`（32MB）与 `.tmp/pipprobe`（10MB wheel 缓存）；本轮无 node_modules、无 dist、无构建缓存。
- `/tmp` 无本轮产生的日志；本轮未起任何 http.server（预览走 file://）。
- `artifacts/` 只留可直接打开的产物：`preview/*.html`、`styles.html`、`svg/**`、`pptx/*.pptx`，以及**全部保留**的 `scripts/`（因此不需要把校验脚本转录进本文档）。
- 场景目录 504KB ≪ 50MB；技能目录零写入（没有下载图标、没有生成 `__pycache__` 之外的改动）。
- 台账快照 `scripts/ledger-snapshot.json` 保留（运行前状态的可证伪记录）。

## 12. 复用姿势与下轮建议

- 适用：真需要交付 PPT 的场合（汇报、答辩、方案）——它是目前唯一能给出**可编辑原生形状 PPTX** 的技能；也适用「只要 SVG 页」的汇报配图，SVG 还能二次用。
- 不适用：本实验室主赛道（可交互 Web 页面）。它的产物是 `.pptx`，且没有任何交互/状态条款；「网页版预览」得自己补（本轮 build_preview.py 就是补的，属技能外工作）。
- 复用清单：① 页序必须显式传列表，别用 `sorted(glob)`；② 色板按「spec ∪ 模板」两级取；③ 字号按 spec 下限、不按模板下限；④ 需要图表先读 `templates/charts/` 而不是手画；⑤ 图标当不存在（离线不可靠）。
- 下轮可试：`ppt-generator × 图表密集分析页`（把 33 张 charts 模板真正用起来，验 SVG 模板→原生可编辑图表的距离）；`graphic-gif × 动效横幅`；`ascii-project-dashboard × 项目进度看板`。前 8 轮排队项（vercel × 真 Next.js 工程 / 部分依赖扇出、sites-building × 活动报名页零框架对照）仍在候选里。

—— 报告完毕。所有数字均来自 `python3 scripts/check.py` 的输出（184/184）与 `scripts/export_pptx.py` 的 JSON 打印。
