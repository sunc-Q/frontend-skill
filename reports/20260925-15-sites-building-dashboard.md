# 验证记录 · 2026-09-25 15 时段

| 项 | 值 |
|---|---|
| Skill | `sites:sites-building`（Qoder 内置插件 qoder.sites，Simple site 静态路径） |
| Skill 位置 | `/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/` |
| 场景 | 仪表盘（订阅收入看板，working surface） |
| 三种风格 | 深色密集分析 / 报纸排版 / 复古终端 |
| 产物目录 | `artifacts/20260925-15-sites-building-dashboard/`（100KB / 4 文件） |
| 结论 | **留用**（第 2 次通过）。同一 skill 在「可交互工作台面」上同样走得通；本轮把它「先给一句视觉主张、再贯穿全篇」的要求做了更狠的验证——同一 DOM 与同一份 JS 换三套 CSS，三种风格都成立 |
| 云端操作 | 无。未调用任何 Sites MCP 工具，未生成 `.站点名称.qoder.site` |

## 1. 发现过程与选题

- Web 搜索 / GitHub / skills.sh：**仍不可达**（`curl` 到 `raw.githubusercontent.com`、`www.skills.sh` 均 `Recv failure: Connection reset by peer`）。
- 扩展市场（关键词 `dashboard`）：命中 9 个仪表盘方向技能（`realtime-dashboard`、`dicklesworthstone-kpi-dashboard-template`、`diegosouzapw-aibi-dashboards`、`pm-dashboard` 等），**全部 `installed:false`**，而 `install_extension` 的 schema 写明「writes local files and requires user confirmation」→ 无人值守运行不得安装，与用户「装技能须逐项确认」的偏好一致。
- Gitee 技能仓库：32 个包，无前端页面构建类（14 时段已确认，未重复查询）。
- **新变量**：本轮运行期间 `~/.qoder-cn/skills/` 下由用户陆续装入了 `frontend-development`、`golang-gin-api`、`vercel-react-best-practices`、`Golang-Backend-Development`。其中 `frontend-development`（React 18 / Vue 3 / Svelte 5 / Angular 多框架组件与页面开发）是**下一个时段的最佳候选**——它是真正的页面构建技能且已本地可读，不再受安装确认限制。
- 因此本时段选题落在台账已排队的 `sites:sites-building × 仪表盘`（与 14 时段的「落地页」是不同场景，不构成重复）。

## 2. 调用方式

```text
Skill(skill="sites:sites-building", args="本地静态仪表盘验证：同一数据集三种风格，仅本地预览不发布")
```
调用前已读 `references/environment.md`、`references/visual-design.md`、`references/static-site.md`（14 时段读过，本轮直接复用，符合该 skill「相关源码与配置未变则复用成功结果」的要求）。

## 3. 场景做法：为什么这次不是「落地页换了个主题」

SKILL.md 对仪表盘有明确硬要求：**「Build the requested experience itself, not a page advertising it. A dashboard opens on its data and controls」**，并要求「working surface 在第一屏就给出核心控件与可用结果」。因此三页都不是宣传页，而是打开即用的看板：

- 第一屏即含：吸顶筛选条（时间范围 7天/30天/90天/12个月 分段控件 + 区域下拉）+ 4 个 KPI 卡（MRR / 新增订阅 / 月流失率 / ARPU，各带环比与迷你走势图）。
- 数据：种子 20260925 的确定性随机样本，365 天 × 4 区域 × 4 套餐 = 5,840 行，运行时生成，页面里不落数据文件。
- 交互全部真实生效：时间范围与区域会重算所有面板；折线支持指针悬停读数（MRR/活跃订阅/本期新增/本期流失）；交易表支持 6 列排序 + 关键词搜索 + 空状态提示。
- 口径诚实性：示例数据在顶栏与页脚两处标注「示例数据 · 非真实后端结果」，符合 skill「不得把 fixture 冒充真实结果」的要求。

三种风格只替换 `<style>` 与文案副标题，**DOM 结构与整段 `<script>` 逐字节相同**（生成脚本会断言 `script identical: true`）：

| 风格 | 目录 | 视觉主张 |
|---|---|---|
| 深色密集分析 | `dark-analytics/` | 深蓝灰底 `#0a0f1a` + 青/靛状态色、13px 密集字号、等宽数字对齐、渐变面积图、悬停读数条 |
| 报纸排版 | `newsprint/` | 米白纸面 `#f3eee2`、Georgia/宋体衬线、small-caps 栏目标题、`3px double` 栏规、卡片去底框改横向分隔线、条形改 45° 网纹、折线去填充用黑墨 |
| 复古终端 | `retro-terminal/` | 近黑底 + 荧光绿 `#33ff99` 等宽字符、`body::after` 扫描线层、KPI 数字尾随闪烁 `▍` 光标、折线 `drop-shadow` 发光、方框式分段控件 |

## 4. 复现步骤（从零重建）

```bash
ROOT="/Users/apple/Documents/workProject/试验/前端skill实验室/artifacts/20260925-15-sites-building-dashboard"
mkdir -p "$ROOT"/{dark-analytics,newsprint,retro-terminal}
# 1) 手写 $ROOT/dark-analytics/index.html：结构 + 交互 + 深色 CSS（唯一需要人写的部分）
# 2) 另两种风格：只替换 <style> 块、<title>、meta description、副标题与页脚互链
#    （本轮用一个临时 node 脚本完成替换，并断言 <script> 与源文件逐字节一致；脚本属中间产物，已删除）
# 3) 校验：见下
node -e 'const fs=require("fs"),vm=require("vm");const s=fs.readFileSync("dark-analytics/index.html","utf8");new vm.Script(s.match(/<script>([\s\S]*?)<\/script>/)[1])'
cd "$(dirname "$ROOT")" && python3 -m http.server 8767 --bind 127.0.0.1 &   # 记下 PID
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8767/20260925-15-sites-building-dashboard/{,dark-analytics/,newsprint/,retro-terminal/}
kill <PID>   # 先 ps -p <PID> -o command= 核对是自己起的
```

注意：服务器要**以 `artifacts/` 为根**启动，页脚里指向上一轮产物的跨运行相对链接才能解析（以单次运行目录为根时该链接会 404）。

## 5. 实测结果

| 检查 | 结果 |
|---|---|
| 内联 JS 语法（node vm） | 首版**失败**（见 §6 问题 1），修复后三页全 OK |
| HTTP | 4 个路径全 200；`/nope.html` 404（未误配 SPA 回退） |
| 外部资源引用 | 0（无 CDN/字体/图片外链，离线可开） |
| 交互（深色版全量） | 30d→7d：新增 483→114、月流失 4.5%→4.6%；12m：新增 4,572、交易提示「近 365 天 · 共 108 笔」；区域=华北 12m：MRR ¥59,388、25 笔；金额列两次点击后 `aria-sort=ascending` 且序列 ¥117→¥234→¥387；搜索 `zzz不存在` → 空状态文案正确；悬停读数随指针移动 |
| 交互（换肤后复测） | 复古终端版点 90d：KPI 变为 1,389 / 5.1%，提示「近 90 天 · 共 31 笔」，`aria-pressed=true` —— 证明逻辑与皮肤解耦 |
| 计算样式断言 | 报纸版：Georgia 衬线 / 纸面底色 / `3px double` 栏规 / `small-caps` 栏目标题 / 卡片透明无边 / 黑墨折线；终端版：等宽字体 / `#05080a` 底 / 文字 `text-shadow` 发光 / 折线 `drop-shadow` / `body::after` 扫描线 z=9 / `.kpi .v::after` 内容 `▍` 且 `animation:blink` / 条形 `repeating-linear-gradient` |
| 横向溢出 | 三页 `scrollWidth - innerWidth = 0`（窄视口 511px） |
| 控制台 | 无报错 |
| 体积 | 单页 30–31KB，本场景合计 100KB（上限 50MB） |

## 6. 遇到的问题

1. **JS 语法错误导致整页空白，而控制台不报**：写了 `array.filter(function (v, idx, a) => ...)` 这种 `function` 与 `=>` 混用的非法语法。页面表现为「所有面板都不渲染」，`list_console_messages` 却是空的，一开始误判为选择器问题。**根因靠 `new vm.Script(scriptBody)` 一行定位**。教训：SKILL.md 简单站路径第 3 步「检查 JavaScript 语法」不是可选项，本次跳过后被浏览器空白反噬——应先跑语法检查再开浏览器。
2. **数据口径失真（自查发现）**：「期间流失率」= 区间流失量 ÷ 平均在册量，在 12 个月窗口下算出 **111.8%**。改为固定 30 天口径的「月流失率」（`churn/(avgSubs*days)*30`），并同步修区域表；同时把日流失率从 0.12%–0.5% 降到 0.06%–0.24%，使月度值落在 4%–5% 的合理区间。现各窗口稳定在 4.4%–5.1%。
3. **筛选一致性问题（自查发现）**：交易表原本固定取最近 30 天，切到 7 天窗口时 KPI 与表格口径不一致。改为随时间范围过滤，并把「近 N 天 · 共 M 笔」写进卡片标题旁的提示，避免误读。
4. **测试脚本自身的假阳性**：先设搜索词、再切区域时，区域视图返回 0 笔——因为 `render()` 复用了上一次的 `S.q`。这不是缺陷（正是「筛选叠加」的正确行为），但差点被记成 bug。跨控件的断言要按「用户操作顺序」设计。
5. **截图不可用**：`take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`（IDE 内置浏览器面板未可见，`visibilityState=hidden`）。无人值守运行不应擅自改动 IDE 界面，故本轮**没有像素级视觉复核**，改用计算样式 + 结构断言替代（见 §5）。风险点：细微的对齐/留白问题本轮可能漏检。
6. **跨运行相对链接**：以单次运行目录为服务器根时，指向上一轮产物的 `../20260925-14-.../index.html` 返回 404（`http.server` 禁止上跳）。改为以 `artifacts/` 为根启动即正常；直接双击文件（`file://`）也正常。

## 7. 结论

**继续留用 `sites:sites-building`。** 依据：

- 两类主要前端交付（叙事型落地页 / 工作型仪表盘）在同一 skill 下都走通了 Simple site 静态路径，且都不需要构建工具与云资源，收尾成本为零（本轮全部中间产物 = 一个临时 node 脚本 + 两个临时 CSS 片段 + 一个日志，均已删除）。
- 它的两条约束在仪表盘场景里被证明有实际价值：① 「做产品本身而不是宣传它的页面」直接决定了首屏放控件与数据而非 hero；② 「fixture 必须标明」促使顶栏与页脚双处标注示例数据，并在自查中揪出了 >100% 的失真口径。
- 「一句视觉主张贯穿全篇」的要求，在「同 DOM 换三套 CSS」这种极端复用下仍然成立——三种风格靠排版、色板、边框语言、动效与纹理区分，没有互相污染，说明该 skill 的风格约束是可执行的，不是口号。
- 局限：① 默认不做浏览器视觉复核，而定时无人值守环境里 IDE 截图还可能不可用，视觉质量只能靠计算样式近似保证；② 该 skill 面向「一个持续演进的原始项目」，实验室这种「一次一份独立产物」的用法需要每次显式声明 local-only，否则会滑向 `sites-hosting` 的云准备流程。

**下一时段建议**：改试 `frontend-development`（本轮新出现于 `~/.qoder-cn/skills/`，已本地可读、无需安装），场景选「数据报表」或「管理后台」，与 `sites-building` 形成跨 skill 对照；`sites-building` 保留给「个人主页 / 定价页 / 活动营销页」等叙事型场景排队。
