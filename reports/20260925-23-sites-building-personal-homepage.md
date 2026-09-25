# 2026-09-25 23:00 轮 · sites:sites-building × 个人主页 × 3 风格

> 本轮是实验室第 10 轮。开工前台账：`tried=9 / runs=9 / skills_seen=16 / used_styles=27 / environment_notes=51 / next_candidates=21`（逐字段快照见 `artifacts/20260925-23-sites-building-personal-homepage/scripts/ledger-snapshot.json`，报告与断言里引用的规模数字一律以该快照为准，不得用「现值减本轮新增」反推）。

## 1. 本轮概要

| 项 | 值 |
| --- | --- |
| skill | `sites:sites-building`（Qoder 内置插件 `qoder.sites`，第 3 次使用，首次单独承担「个人主页」） |
| 场景 | 个人主页 / 作品集首页（新场景，前 9 轮分别是落地页·仪表盘·数据报表·管理后台·定价页·活动报名页·架构说明页·演示汇报页） |
| 三种风格 | A 和纸浮世绘 ukiyo / B 深空星图 astro / C 像素掌机 pixel-console（三者均未出现在开工前的 `used_styles`，本轮新增 3 条） |
| 路径 | SKILL.md 的 **Simple site** 分支：单路由、无持久数据、无上传、无鉴权、无外部服务 → 纯 HTML/CSS/JS，「Plain HTML/CSS/JavaScript may be enough」 |
| 产物 | 3 个自包含单文件页 + 1 个对照入口 + 2 个零依赖校验脚本 + 1 份台账快照，场景目录 **80KB**（6 个文件） |
| 断言 | `check.mjs` 219/219 + `interact.mjs` 24/24 = **243 条全绿**（初跑 207/212，5 项失败全部为真实缺陷或断言自身缺陷，见 §6） |
| 依赖 | **零**：无 node_modules、无 dist、无 pip 包、无构建、无 CDN、无位图资产、未起 http.server（file:// 直开） |
| 结论 | **留用**。个人主页/作品集这类内容型单页，该技能是当前最优解：比同属「个人向」的 18:00 React 落地页小 **约 17 倍**（14.3–15.9KB vs 255KB），且第一轮就把可访问性与「反功能膨胀」变成了可判定断言 |

## 2. 技能来源与调用方式

- 磁盘路径：`/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/`
  - `SKILL.md` 16.6KB（120 行）+ `references/` 8 篇（`environment` `static-site` `visual-design` `user-profile` `database` `functions` `storage` `database-migration`）+ `assets/` `templates/` `scripts/`
- 调用方式（两种都可用，本轮用后者以拿到原文条款）：
  1. 说「给 X 做一个网站/页面」，插件的 system reminder 会要求先 `Skill(sites:sites-building)`；
  2. 直接 `Skill(skill="sites:sites-building", args="…纯静态单文件、本地双击可预览、不部署")`。
- 本轮**未调用任何 `mcp__plugin_sites_qoder_sites__*` 工具**、未创建 `.站点名称.qoder.site` 描述符：SKILL.md §1 明确「local preview alone requires no cloud resources」，且 §Site lifecycle ownership 要求被委托方不得另起站点，所以实验室目录只当作普通静态工程使用。
- 与另两轮的关系：14:00（落地页）、15:00（仪表盘）是同一 Simple site 路径；19:00（定价页）是与 `vercel-react-best-practices` 叠加。本轮是**第一次把技能里的「反功能膨胀」条款单独提成断言组**。

## 3. 场景内容（三页共享同一份事实）

虚构人物 `柯屿 / KE YU`，独立开发者，杭州，2019 年至今。三页讲的**必须是同一组事实**，只有设计主张不同：

- 五件作品：`潮汐 TideNote`(2025, 离线优先笔记, 22h/周, 内测) · `汉字谱 Typeface Atlas`(2024, 137 套中文字体检索) · `光斑 Lumen`(2024, 长曝光计算) · `字节盒 Bytebox`(2023, CLI/Go 纯文本习惯追踪) · `漫游 Roamer`(2022, 小程序步行路线)
- 四则随记（2025-08-14 / 2025-05-02 / 2024-11-19 / 2024-06-07）与标题
- 近况三格：手上（潮汐同步层、《设计的观念》118/320、Rust）· 本站（近 30 天 2,418 次、最常被点开=汉字谱、托管=一台小机器）· 桌面以外（长曝光摄影、绕城 60km 骑行、中浅焙手冲）
- 联系方式：`hey@keyu.example`（RFC 2606 保留域，**故意不可送达**）+ 每页一个「复制」按钮
- 全页明确标注虚构演示（见 §5 G 组）

## 4. 三种设计主张（以及它们如何各自重排页面）

| 维度 | A 和纸浮世绘 | B 深空星图 | C 像素掌机 |
| --- | --- | --- | --- |
| 色板 | 和纸三层 `#f4ede2/#ece2d3/#e2d5c2` + 墨 `#2a2521` + 朱 `#b8342a` + 绀 `#3a5a78` + 关键线 `#c9b99f`（8 色） | 虚空 `#070b16` + 面板 `#0b1220` + 金 `#c9a24a` + 青 `#6fd3e0` + 暖红 `#ff7a6b` + 纸墨 `#e2e6ee/#949db1`（7 色） | 外壳 `#d9d6cd/#c3bfb3` + 框 `#3a3b3c` + 屏四绿阶 `#9bbc0f/#8bac0f/#306230/#0f380f` + 一红 `#e53d2a`（8 色） |
| 排版手法 | `writing-mode: vertical-rl` 竖排名牌与假名小节标；纸筋纹理用两道极淡 `repeating-linear-gradient` | CSS `radial-gradient(1px 1px …)` 星点背景 + 内联 SVG 连线星图（五个节点=五件作品）；数字全部等宽 + `tabular-nums` | 注塑点阵 `radial-gradient` 外壳纹理；姓名反白块；4px 硬边 + **实心偏移色块**代替阴影 |
| 作品结构 | `<ul>` 年份引札行（三列栅格，末行补下划线） | `<table>` 星表：编号/名称/形态/首发/亮度/状态，含 `<caption>` 与 `<th scope>` | `<article class="cart">` 卡带网格，`每格≈5h` 的方格仪表 |
| 深度 | 纸色分层 + 1px 墨线（**零阴影**） | hairline 金线 + 字号对比（暗底上阴影不可见） | `box-shadow:6px 6px 0 <实色>`（无模糊半径） |
| 交互 | 复制邮箱（唯一控件） | 复制地址（唯一控件） | `A · 复制`（唯一控件）+ 方向键式页内导航 |
| 字节 | 13,705B | 15,914B | 14,329B |

三者两两之间：色板零交集，且 `grid-template-columns / font-family / border-radius / 是否用 table / 是否用竖排 / 是否用方格仪表` 七项指纹中至少 3 项不同 —— 这正是技能「A new direction should change more than accent colors」的可判定版本（见 §5 B 组）。

## 5. 条款 → 断言映射（可复用的核心方法）

`scripts/check.mjs`（15,036B，零依赖，`node scripts/check.mjs`）九组 219 条；`scripts/interact.mjs`（3,288B）24 条。

| 组 | 技能原文出处 | 断言 | 判定 |
| --- | --- | --- | --- |
| A 自包含 | 「Use HTML/CSS/SVG for UI geometry…」「Plain static files need no invented build step」 | 无带 src/href 的 link/img、无外部 script、无 `url(http…)`/`url(data:image)`、无 @import、无多媒体容器；**剥掉 xmlns 后正文零 `http(s)://`**；单 `<style>`；单页 <40KB | 27 条全绿。注：本轮**没有 React bundle**，所以历轮那条「w3.org/react.dev 白名单」不再需要——零位图策略让外链断言第一次天然成立 |
| B 一个连贯视觉主张 | 「choose one concise visual thesis… A new direction should change more than accent colors」 | ①色板封闭：页内出现的**任何十六进制色必须属于该页声明的色板**（越界即失败）②签名手法在场（竖排 / 星点+table / 实心偏移块且零圆角）③三对风格指纹差异 ≥3 项 ④色板两两零交集 | 15 条全绿。「色板封闭」是本实验室第一次把「风格一致性」写成机器可判的式子，成本 6 行代码，值得移植回前几轮做横检 |
| C 排版底线 | 「body text around 16px or larger… reserve smaller type for secondary metadata… relative sizing」 | body ≥16px、全站无 <12px、行高 ≥1.5、保留 `-webkit-text-size-adjust:100%`、rem 出现 ≥10 次 | 15 条（**初跑 astro 失败 4 处**：11.5px 的 `th`/`.tag`/`.btn`/`.tcell h3` 与 10px 的星图 SVG 标注 → 全部上提到 12px 后转绿） |
| D 可访问性与键盘 | 「accessible labels, keyboard behavior and meaningful focus states」「metadata」 | `:focus-visible` 在场、skip link、header/main/footer 地标、`<time datetime>`、真实 title+description、viewport、每个内联 SVG 要么 `aria-hidden` 要么 `role=img`+`aria-label`、按钮有 `type` 与可读文本、表格有 caption+scope、媒体查询、`prefers-reduced-motion` 或本就无动效、几何不用位图 | 35 条全绿 |
| E 内容事实一致 | 「Build the requested experience itself」「Do not present fixtures as real」 | 三页共享事实逐项在场（人名/拉丁名/邮箱/五件作品 10 个名字/四则日志日期与标题/访问数/起始年）；mailto 与复制常量同源；**C 页方格格数 = round(每周小时/5)** 且上限 5 | 71 条全绿。派生值不硬编码这条来自 ascii 技能的「硬编码百分比」教训，本轮提前防住 |
| F 反功能膨胀 | 「"Polished" does not authorize extra routes, forms, search, sharing, authentication, persistence」「Add navigation only when the requested experience has multiple views」 | 零 `<form>`、零 `input/select/textarea`、零 `localStorage/sessionStorage/indexedDB/cookie`、零 `fetch/XHR/WebSocket/sendBeacon`、至多 1 个按钮、唯一 h1、id 不重复；内联脚本 `vm.Script` 语法有效且无 `document.write`/`innerHTML=` | 27 条全绿。**这是历轮第一次把这组条款当断言**：它正是让产物从 255KB 掉到 15KB 的原因 |
| G 示例数据显式标注 | 「Label local sample data clearly」 | 每页含「虚构/演示」声明、邮箱标注「示例邮箱，不可送达」、数值区标注演示数据、且无「已上线 N 万」式过度声称 | 12 条全绿 |
| H 溢出防线（静态部分） | 「Check mobile and desktop layout… no unintended horizontal overflow」 | 所有 `repeat()` 栅格必须 `minmax(0,…)`；无 ≥500px 固定宽度；容器有 `max-width`；`white-space:nowrap` 预算 ≤6 | 12 条全绿（真实视口下的溢出仍未验，见 §8） |
| I 对照入口 | — | `styles.html` 存在且链到三页、不用 iframe（保持 file:// 可用） | 5 条全绿 |

`interact.mjs` 用 `vm` + 30 行桩 DOM（`getElementById`/`addEventListener`/`setTimeout`/`navigator.clipboard`）跑三页内联脚本，验证唯一交互的两条分支：无 clipboard API → 回退文案含「手动/请」并安排复原定时器；有 clipboard → 「已复制」；定时器执行后回到**从 HTML 里读出的初始文案**（不是写死的字符串）；24 条全绿。

## 6. 本轮抓到并修掉的缺陷

1. 🟡 **astro 字号滑到 11.5px/10px**（4 处）：技能只说「更小的字号留给次要元数据」，写码时很容易把表格列头、标签、按钮都划成「元数据」。修：全部上提 12px，靠 `letter-spacing` 与等宽字维持「数据感」。**教训**：这类底线必须写成断言（C 组 `no-tiny`），不能靠条款措辞。
2. 🟡 **C 页方格仪表与自订规则不自洽**：`字节盒 1h/周` 画了 1 格，而图例写「格数=每周投入」；按 `round(h/5)` 应为 0 格。修：改为 0 格 + 图例改成可验的「每格≈5 小时（四舍五入）」，并加 `pixel-gauge-math` 断言。**这是本轮唯一一处「页面功能正常但数据说谎」**，与技能「不要把 fixture 呈现成真实结果」同源。
3. 🟢 **校验脚本自身的两个错**：①断言把「本页没有 SVG」判成失败（`svgs.length>0 && …`），已改为只在存在 SVG 时要求标注，另加 `pixel-geometry` 断言承认「纯 CSS 几何同样合规」；②我在 astro 色板清单里误列了 `#3a3b3c`（那是 C 页的边框色），导致「色板两两零交集」假失败。**这类「检查器 bug 伪装成内容缺陷」是历轮反复出现的模式，本轮又多一例。**
4. 🟢 ukiyo 首稿 `:root` 里留了一行无效声明 `measure:16px;`、astro 留了一行 `--dim:#93a;` 半截色值（后者会让色板封闭断言失败）——都是「先写占位再改」的残留，靠 B/C 组断言抓出。

## 7. 复现步骤（从零重建这三页）

```bash
LAB="/Users/apple/Documents/workProject/试验/前端skill实验室"
D="$LAB/artifacts/20260925-23-sites-building-personal-homepage"

# 1) 加载技能条款（二选一）
#    a. Skill(skill="sites:sites-building", args="纯静态单文件、本地双击可预览、不部署")
#    b. 直接读 SKILL.md + references/visual-design.md：
sed -n '1,120p' "/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/SKILL.md"
# 2) 定事实清单（§3）：五件作品/四则日志/近况三格/邮箱 hey@keyu.example，先写死一份，三页只改设计不改数据
# 3) 逐页手写单文件 HTML（无构建）：
#    ukiyo/index.html        —— 色板 8 色；竖排名牌；引札式 <ul>；零阴影
#    astro/index.html        —— 色板 7 色；radial-gradient 星点；<table> 星表 + caption + th scope
#    pixel-console/index.html —— 四色绿阶屏；4px 硬边；box-shadow 6px 6px 0 实色；卡带网格
#    每页只放：1 个 <style>、至多 1 个 <button>、1 段内联 <script>（复制邮箱，两条分支）
# 4) 跑断言（零依赖，任一失败即退出码 1）
node "$D/scripts/check.mjs"      # 期望：219 通过 / 0 失败
node "$D/scripts/interact.mjs"   # 期望：24 通过 / 0 失败
# 5) 浏览器复核（面板 hidden 时只能读计算样式，每次 ≤3 个属性，且见 §9 的滞后坑）
open "$D/ukiyo/index.html"       # 或 file:// 直开后读 body.fontSize / backgroundColor / 条目数
```

关键参数：三页 `body{font-size:17px;line-height:1.7~1.8}`；断言里的硬阈值 = 单页 <40KB、`rem ≥10`、`font-size ≥12px`、`nowrap ≤6`、色板白名单 8/7/8 色（`scripts/check.mjs` 的 `PALETTES`）。改风格时先改 `PALETTES`，断言即成为该风格的「色板合约」，任何越界色都会被抓。

## 8. 未验项（诚实清单）

1. **真实视口下的移动/桌面布局与横向溢出**：IDE 内置浏览器面板仍 `visibilityState=hidden`、`innerWidth=0`，`take_screenshot` 会报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`。本轮只能做 H 组静态防线 + 计算样式读取，「无横向溢出」记为未验。
2. **`:focus-visible` 的实际观感、hover 位移（卡带 `transform:translate(2px,2px)`）**：需要事件与像素，未做。
3. **复制按钮在真实浏览器里的 clipboard 行为**：`file://` origin 下 `navigator.clipboard` 多半不可用，本轮用 vm 桩验证了两条分支的代码路径，未验证真机粘贴结果。
4. **技能 Capability 路径全链路**（Functions/Database/Storage/user-profile/Agent）：个人主页用不到，本轮零涉及。`references/static-site.md`（SPA 路由与静态导出）也仍未验——那是台账里既有的候选「sites:sites-building × 多页站点」。
5. **`assets/static/index.html` 起步模板**：技能说「只作 starting point」，本轮按「不要拿 starter 当交付」直接从零手写，未评估该模板质量。

## 9. 环境增量（新记进台账）

- 🟠 **`evaluate_script` 在某次调用 15s 超时之后，下一次调用会先返回上一次「已执行但没回传」的结果 —— 读数滞后一格**。本轮连续命中：导航到 astro 后读 body 背景色，拿回的是 ukiyo 的 `rgb(244,237,226)`；再读一次才拿到 astro 真实的 `rgb(7,11,22)`；pixel 页第一次读又返回上一支表达式的值。**对策：面板 hidden 时，任何计算样式读取得「同表达式连读两次取第二次」，或先跑一次已知答案的探针调用。** 这与历轮记的「动作与读取必须拆两次」是不同的现象，别混为一谈。
- 🟢 **零位图 = 零外链断言自动成立**：前几轮在 React 产物上做「零外链」必须白名单 `w3.org`（xmlns）与 `react.dev`（错误码文案）。本轮按技能「几何用 HTML/CSS/SVG」的要求全用内联 SVG/CSS，A 组第一次不需要任何白名单。**这条策略本身可以移植给其他轮。**
- 🟢 本轮再次确认：`node scripts/*.mjs` 零依赖即可覆盖「静态 + 交互」两层验证，产物 80KB、无 node_modules、无 /tmp 残留、未起服务器 —— 与 21:00（drafter，零构建）一起构成「低成本轮」的两条已验证路径。

## 10. 结论与横向对比

| 轮次 | skill | 场景 | 依赖 | 构建 | 单页体积 | 交互验证手段 |
| --- | --- | --- | --- | --- | --- | --- |
| 18:00 | vercel-react | 落地页（同为个人向内容页） | node_modules 102MB | Vite 双构建 | ~255KB | jsdom |
| 21:00 | drafter | 架构说明页 | 无 | 无 | 15–17KB | 静态断言 |
| 22:00 | ppt-generator | 演示汇报页 | pypi 隔离包 42MB | SVG→PPTX 脚本 | 60KB×6 | 静态断言 + zipfile 读 PPTX |
| **23:00** | **sites-building** | **个人主页** | **无** | **无** | **13.7–15.9KB** | **vm 桩 DOM + 浏览器计算样式** |

**留用（第 3 次通过，且是「内容型单页」首选）。** 判定理由：①它的条款是**可判定**的（本轮 219 条静态断言里有 104 条（B 15 + C 15 + D 35 + F 27 + G 12）能逐条回指到 SKILL.md 的具体句子）；②它的「反功能膨胀」条款是**唯一能把产物做小**的约束，和 vercel 系列「鼓励更多工程」的取向恰好相反——**同场景叠加时要先决定听谁的**（对照 19:00 轮的先例：先解控制流冲突再叠加）；③零构建让它成为最适合无人值守定时的技能之一。

局限：①它给的是**设计纪律**而不是设计素材——没有色板库、没有组件、没有图模板（这点与 ppt-generator 相反），三种风格全靠现写，因此「换风格」的成本比 ppt-generator 高（本轮三页手写合计 37,928 字符）；②`references/` 的重心在 Capability 路径：五篇（database 17,144B + functions 13,101B + database-migration 8,478B + storage 7,282B + user-profile 4,524B = 50,529B），而 Simple site 路径实际只用得到 visual-design.md 4,181B + static-site.md 4,678B = 8,859B；③技能默认**不做浏览器 QA**（「Browser screenshots, DOM inspection and interaction QA require a user request」），与实验室「复核产物」的硬要求相冲，本轮的解法是「浏览器只读不需要事件的计算样式 + 交互走 vm 桩」，已写进 §9 供后续轮直接复用。

## 11. 下一轮候选（已写回 `next_candidates`）

1. ★ `sites:sites-building` × 多页站点（`references/static-site.md` + SPA 路由条款至今未验，Simple site 分支已验三轮）
2. ★ 把 B 组「色板封闭 + 指纹差异 ≥3」配方移植回 14:00/16:00/17:00 的历史产物做横检：验证那几轮的「三风格」是否真的只换了配色
3. `sites:sites-building × 活动报名页`（与 20:00 React 轮同场景零框架对照，本轮 15KB vs 该轮 265KB 的差距已可作为成本基线）
4. 三技能叠加（sites-building 定形 + vercel 定码 + drafter 定图）：验 F 组「不许加分包以外的功能」与 vercel「鼓励分包/懒加载」是否互斥
5. `ppt-generator × 图表密集分析页`（33 张 charts 模板仍未用）；`graphic-gif × 动效横幅`（需 Playwright + Chromium，落盘与预览策略未定）；`ascii-project-dashboard × 项目进度看板`（本轮读过其 SKILL.md：**产物是 Markdown/文本表格，不产出可双击打开的页面**，与实验室「artifacts 只留可直接打开预览的页面产物」硬约束冲突 → 若要做须先决定「包一层 HTML 外壳」算不算该技能的产物，见 §12）
6. `vercel-react-best-practices × 真 Next.js 工程`（server-* 剩余 3 条 RSC 专属条款仍只有 Next.js 能验）

## 12. 顺手排除的一个候选（省一轮探测）

本轮开工前评估 `ascii-project-dashboard`（`~/.qoder-cn/skills/`，用户 17:36 装入，SKILL.md 7.8KB 单文件）。它的 `applyTo` 是 `**/*plan*,**/*roadmap*,**/*tracker*,**/*dashboard*`，全文只规定 `▓░` 十格进度条、Markdown 表格、`●──○` 时间线与 emoji 状态位，**没有任何 HTML/CSS/页面产物要求**，其卖点恰是「no rendering / works in any editor, terminal, email, Slack」。结论：它不是「前端页面构建 skill」，硬套会退化成我自己写 HTML 外壳（验证的就不是它了）。**本轮不动用它，直接记入 `skills_seen` 以免后续重复探测。** 顺带记两个可移植点：它的「不得硬编码百分比，必须从计数算出」正是本轮 E 组 `pixel-gauge-math` 的灵感来源；它的 emoji 状态位在纯文本里可读、在暗底页面上不可控，所以实验室若要用状态位，仍应回到 CSS/SVG。
