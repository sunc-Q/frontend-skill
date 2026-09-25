# 2026-09-25 17:37 · ascii-project-dashboard（ASCII 项目仪表板）

## 基本信息
- **Skill**：`ascii-project-dashboard`（中文名「ascii 项目仪表板」），publisher `fabioc-aloha`，v1.0.0，category Database & Analytics，tags 空（非 skillatlas/modelscope 镜像条目）
- **来源**：Qoder 官方扩展市场 `official_qzXG5ekf`，搜索词 `ascii`（`poster`/`diagram`/`visualization`/`audio`/`pdf`/`game`/`dashboard` 同时检索，见下）
- **获取方式（确切命令）**：
  1. `mcp__extension-market__search_extensions({query: "ascii"})`
  2. `mcp__extension-market__install_extension({installRef: "ext_bfb1ccf5-..."})` → `{"kind":"qoder.extensionMarket.installed","runtimeReady":true}`
  - installRef 约 60 秒过期（本轮 `ExpiresAt: 2026-09-25T09:46:03Z`），必须现搜现装
  - 落地路径：`~/.qoder-cn/skills/ascii-project-dashboard/SKILL.md`（唯一文件，7810 字节）

## 它自称干什么
Create and maintain ASCII visual dashboards for project tracking with parallel lane progress bars —— 用纯文本（`▓░` 进度条 + 状态 emoji + 时间线 `●○─`）做项目跟踪看板，宣称「零依赖、任何地方都能渲染、diff 友好、读屏友好」。

## 安全闸门
包内**只有 1 个 markdown 文件**，无脚本、无网络调用、无写盘指令、不读取凭据；唯一的「执行」是它给的 4 行 JS 计算式（`percentage=round(d/t*100)` 等）和「用 muscle script 保持一致」的建议（muscle 是它作者自己的外部工具，本机不存在，已忽略）。→ 直接通过，无需沙箱。

## 本轮跑的小任务
把它对着**本流水线自己的真实机读台账**开：读 3 个实验室的 `state/state.json`（只读）→ 现场算 4 条泳道 → 出 `dashboard.txt`：
- `📥 DISCOVER` = 三 lab `skills_seen` 里已定性（installed_used/blocked/needs_user_confirm/unreachable）/ 全部条目
- `🏗 BUILD` = `runs[].result=="success"` / 全部轮次
- `🧹 CLEANUP` = 有 `cleanup` 字段的轮次 / 全部轮次
- `🚀 DELIVER` = 有 `push` 字段的轮次 / 全部轮次

一次生成三种版式（Pattern A 横向泳道 / Pattern B 窄终端 / Pattern C 里程碑时间线）+ Summary 框 + 跨实验室 Task Backlog。数据是活的：跑的时候兄弟实验室刚好新增了一轮（17:00 槽位），看板立刻从 4 轮变 5 轮、DELIVER 从 50% 变 60%，正好证明「不硬编码」这条真起效。

## 产物
- `demos/20260925-1737-ascii-project-dashboard/dashboard.txt` ← 最终可见产物（52 行，2.8KB，任意终端/编辑器直接打开）
- `demos/20260925-1737-ascii-project-dashboard/dashboard-naive.txt` ← 对照组：完全按技能原文口径（`s.length` 补位）渲染
- `render-dashboard.js`（6.2KB）— 复现脚本；`verify.js`（5.0KB）— 独立复核脚本（自带一份显示宽度实现，不复用渲染器代码）
- `output.log`（6.6KB）— df/node 版本 + 渲染输出 + 产物全文 + 两版断言原文

## 复现步骤（从零重建）
```bash
cd /Users/apple/Documents/workProject/试验/skill演示场/demos/20260925-1737-ascii-project-dashboard
node render-dashboard.js      # 写 dashboard.txt + dashboard-naive.txt，并回显各泳道 d/t→pct→bar
node verify.js dashboard.txt        # 期望 10 PASS / 0 FAIL，exit 0
node verify.js dashboard-naive.txt  # 期望 7 PASS / 3 FAIL（对照组）
```

## 验证结果（原文见 output.log）
最终版 **10 PASS / 0 FAIL**：
- Pattern A 三行 × 4 泳道的列首全部落在分隔线段起点 2/24/46/68（列边界断言，逐行取「第 N 列上是什么字符」）
- 进度条恒 10 格、A/B 版式百分比一致、Summary 框每行显示宽度一致（框线闭合）、时间线仅 `●○─`、Backlog 图标限定 ✅🔄⬜🚫
- **产物百分比 == 从 3 个 state.json 独立反算值**（`artifact=21,100,100,60 recomputed=21,100,100,60`）→ 确认没手填
- 全文最宽 90 列

## 效果结论：**留用**
纯文本看板零依赖、零渲染、可直接进 git diff，`▓░`+状态图标的规格具体可执行，三种版式（宽屏/窄终端/时间线）覆盖实际场景，`Update Protocol` 与 `Anti-Patterns` 两节是真有用的约束（尤其「禁止硬编码百分比」——脚本一跑就自证）。适合无人值守轮次记账，比上一轮的 drafter 更贴近「台账可视化」这一刚需。

## 踩的坑（重要）
1. **技能原文的 `10 chars = 10 chars` 假设在中文/emoji 下直接崩**：它只在英文示例里成立。用它的口径（JS `s.length` 补位）跑中文泳道，实测 Pattern A 列首极差 26 列（`来源已定性/来源条目` 10 个汉字 = 20 显示列，但 `length` 只算 10），Summary 框线错位不闭合，行宽从 90 涨到 106 超出终端。对照组 `dashboard-naive.txt` 保留了这份坏产物，断言 7 PASS / 3 FAIL。**必须自带 wcwidth 近似（CJK/emoji=2 列，U+FE0F 零宽）再补位**，一行代码的事但没人替你做。
2. 它给的进度条规则里 `filledBlocks=Math.round(percentage/10)` 会把 60% 显示成 6 格、46% 显示成 5 格（四舍五入而非向下取整），TOTAL 条会比实际观感偏满一格——是它的选择，不算 bug，但要意识到条长按 round 而非 floor。
3. 它的 `Anti-Patterns` 说「别手改，用 muscle script 保持一致」，但 muscle 是作者的外部工具，市场包里没带脚本 —— 无人值守场景下等于**没有实现层**，一致性得自己写脚本兜（本轮 `render-dashboard.js` 就是这个兜底）。
4. 本任务在 Full Access 下 `install_extension` 依旧不弹确认（与兄弟实验室 auto 模式结论相反，再次确认）；`search_extensions` 仍是单英文词根才有结果。
5. `install_extension` 装到的是 `~/.qoder-cn/skills/`（全局技能库），规约要求第三方包放 `LAB/.skills/` —— 市场条目不暴露可 clone 仓库，无法走 SSH clone，只能接受全局安装并登记 `installed_by_this_task`。

## 清理
无 node_modules、无构建缓存、无临时二进制；未起任何本地服务（`lsof` 监听数与开工一致 = 7，全部属于其它任务）；本轮 demos 目录 32KB（≪5MB）；LAB 总体积见 state.json。唯一持久副作用＝装了 `~/.qoder-cn/skills/ascii-project-dashboard/`（留用，按规约不自动卸载）。
