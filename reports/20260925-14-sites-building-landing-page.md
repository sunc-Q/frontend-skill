# 验证记录 · 2026-09-25 14 时段

| 项 | 值 |
|---|---|
| Skill | `sites:sites-building`（Qoder Sites 插件内置技能，非市场安装） |
| Skill 位置 | `/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/` |
| 场景 | SaaS 产品落地页（虚构产品「墨记 Moji」——本地优先 Markdown 笔记工具） |
| 三种风格 | 瑞士极简 / 玻璃极光 / 新粗野主义 |
| 产物目录 | `artifacts/20260925-14-sites-building-landing-page/` |
| 结论 | **留用**。静态简单站路径体验良好，零依赖、零构建、产物 72KB；文档对「本地预览不需要云资源」的边界写得清楚 |
| 本次是否发布云端 | 否（任务显式要求仅本地预览，未调用任何 `prepare_site` / Sites MCP 工具） |

## 1. Skill 来源与发现过程

本轮为实验室首次运行，`state/state.json` 不存在，视为空台账。发现渠道与结果：

1. **Web 搜索**（`skills.sh` / GitHub 方向）：搜到 `ibelick/ui-skills`、`BuilderIO/agent-native`、`design-anti-slop` 等候选，但**本机 curl/WebFetch 访问 `raw.githubusercontent.com` 全部失败**（`curl: (35) Recv failure: Connection reset by peer`），无法取回技能正文 → 本轮不可用，记为环境限制。
2. **Qoder 扩展市场**（`mcp__extension-market__search_extensions`，关键词 `ui`）：命中 3 个前端方向技能——`ui-designer`、`diegosouzapw-ui-ux-pro-max-corsal2025`、`diegosouzapw-ui-ux-intelligence-expert`。但 `install_extension` 的 schema 明确写着「Installation writes local files and **requires user confirmation**」，与本任务「不修改实验室以外文件 + 全程不提问」两条约束冲突 → **本轮不安装**，留给后续经用户授权的运行。
3. **Gitee 技能仓库**（`giteesunc/agent-work-record` 的 `skill` 分支，`skill_ctl.py list`）：32 个技能包，**无前端页面构建类**，仅有 `article-rewriter`、爬虫、运维等。
4. **本机已装技能**：`find "/Applications/Qoder CN.app" -name SKILL.md` 枚举出全部内置技能，前端方向只有两个——`qoder.canvas/canvas` 与 `qoder.sites/sites-building`。
   - `canvas` 被排除：其文档规定「Do not create canvas files in the repository or workspace directory」，产物只渲染在 IDE Canvas 面板里，无法作为实验室要求「可打开预览的页面产物」落盘；且描述标注「Invoke only via slash command」。
   - `sites-building` 被选中：其 `references/environment.md` 明确「A new simple static site ... Plain HTML projects may use a separate `web/` output directory」「local preview alone requires no cloud resources」，完全满足本地落盘要求。

## 2. 调用方式

无需安装，插件已随 Qoder 内置。两种等效入口：

```text
# 入口 A（本次实际使用）：Skill 工具按名调用
Skill(skill="sites:sites-building", args="本地静态落地页验证：3 种风格页面，仅本地预览不发布")

# 入口 B：直接读文档
Read "/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/SKILL.md"
```

调用前按 SKILL.md 要求先读了三份参考文档：`references/environment.md`（环境与工具边界）、`references/visual-design.md`（视觉方向与图片规则）、`references/static-site.md`（静态输出与本地服务器）。技能自带的 `assets/static/index.html` 示例仅作为「静态站起步形态」参考，未复制其内容。

## 3. 三种风格的设计取向

同一份文案与版块结构（导航 / 首屏 + 指标 / 实时渲染演示 / 四能力 / 基准对比 / 试用反馈 / 三档价格 / 收尾 CTA / 页脚），只换视觉系统，以便横向比较 skill 产出质量。

| 风格 | 目录 | 关键手法 |
|---|---|---|
| 瑞士极简 | `swiss-minimal/` | 纯黑白 + 单一红点 `#e5342a`；1px 网格线分栏、3px 顶边、无圆角无阴影；Helvetica/Arial 正文配 `clamp(44px,7.2vw,92px)` 巨号左对齐标题；小号大字距 uppercase 标签 |
| 玻璃极光 | `glass-aurora/` | `#070b1c` 深蓝底 + 三团 `radial-gradient` 极光（紫/青/粉）；`backdrop-filter: blur(18px) saturate(140%)` 半透明卡片 + 内高光；22px 大圆角；标题渐变文字用 `background-clip:text`；胶囊吸顶导航 |
| 新粗野主义 | `neo-brutal/` | 酸性黄/青/粉撞色 + 点阵底纹；3px 黑描边、`6px 6px 0 #000` 硬偏移阴影；hover/active 位移反馈；跑马灯条（`prefers-reduced-motion` 下停转）、旋转贴纸、Arial Black 大写标题 |

## 4. 复现步骤（从零重建）

```bash
ROOT="/Users/apple/Documents/workProject/试验/前端skill实验室/artifacts/20260925-14-sites-building-landing-page"
mkdir -p "$ROOT"/{swiss-minimal,glass-aurora,neo-brutal}
# 4 个文件全部自包含：内联 CSS、内联 JS、内联 SVG 图标，零外部引用
# （已用 grep -E '(src|href)="(https?:)?//' 验证：无任何 CDN / 字体 / 图片外链）
```

1. 调用 `sites:sites-building`，先读 `references/environment.md`、`visual-design.md`、`static-site.md`。
2. 走 **Simple site** 路径（单页、无持久数据、无鉴权、无外部服务 → 纯 HTML/CSS/JS，不初始化 React starter，不建 `package.json`）。
3. 按 §3 的取向各写一个 `index.html`；三页共用同一段 Markdown 演示脚本（`esc()` 先转义再做行内替换，最后 `innerHTML` 写入，避免 XSS）。
4. 校验（本次实际执行）：
   ```bash
   node -e '...new (require("vm").Script)(scriptBlock)...'   # 三段内联 JS 语法通过
   cd "$ROOT" && python3 -m http.server 8765 --bind 127.0.0.1 &   # 记录 PID
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/{,swiss-minimal/,glass-aurora/,neo-brutal/}
   ```
   结果：4 个路径全 200，`/nope.html` 返回 404（未误配 SPA 回退）。
5. 浏览器抽查（本次额外做的，SKILL.md 默认只在用户要求时执行）：`browser-use` 逐页截图 + `list_console_messages`（无报错）+ `documentElement.scrollWidth === innerWidth`（无横向溢出，窄视口 511px 下三页均成立）。
6. 收尾：`kill <自建 PID>`（已核对 `ps -p` 命令行确认为本次 `python3 -m http.server 8765`），端口关闭。

## 5. 产物清单

```
artifacts/20260925-14-sites-building-landing-page/   共 72KB / 4 文件
├── index.html                    2.7KB   三风格导航目录
├── swiss-minimal/index.html     19.2KB
├── glass-aurora/index.html      21.8KB
└── neo-brutal/index.html        23.1KB
```

打开方式：直接双击 `index.html`，或 `python3 -m http.server` 后访问 `http://127.0.0.1:<port>/`。三页底部互相链接，可一键切换风格。

## 6. 遇到的问题

1. **外网技能源不可达**：GitHub raw 直连被重置，WebFetch 同样 `fetch failed`。→ 依赖外部落地技能的方向本轮受阻，需换网络或走市场安装。
2. **市场安装与「不提问」约束冲突**：`install_extension` 强制用户确认。→ 结论：自动化定时任务只能用**已内置**技能；市场技能要留给有人值守的运行。
3. **Markdown 渲染器真实缺陷（自查发现并修复）**：三个页面共用逻辑里 `esc()` 先把 `>` 转成 `&gt;`，之后 `/^>\s?/` 的引用行分支永远匹配不到，`> 引用行` 被当普通段落输出。修复＝分支正则与剥离都改用 `&gt;`；修复后用 Node + `vm` 桩 DOM 跑三页断言（标题/粗体/行内码/`[[链接]]`/有序列表/引用行 6 项）全部 PASS，并在浏览器 reload 后复核输出为带左边框的段落。
   - 教训：`browser-use` 只改 hash 的导航**不会重新加载页面**，首次复核读到的仍是旧脚本，必须 `reload(ignoreCache)`。
4. **玻璃拟态底纹过重**：`repeating-linear-gradient` 网格在深色底上呈明显横纹（截图可见），把 opacity 从 `.05` 降到 `.022`、间距 3px→4px 后恢复正常。
5. **`.sr-only` 缺定义**：新粗野主义表格用了带 `sr-only` 的 `<caption>`，初版未定义该类导致文字直接显示，已补工具类。

## 7. 结论与留用判断

**值得留用。** 理由：

- 该 skill 的「Simple site」分支非常适合定时批量产出：不催生 `node_modules`、不要求构建步骤、不碰云资源，收尾成本几乎为零（本次实验室目录 72KB，无任何中间文件）。
- 文档给的边界准确且可执行：本地预览不需要 `prepare_site`、静态站用 `web/` 输出目录、`spa:false` 时缺路径应返回 404——三条都在本次实测中得到印证。
- 它的「先定一句视觉主张并贯穿全篇」要求，对「同一场景三种差异明显风格」这类任务有直接帮助：约束的是设计一致性而非具体样式，因此同一结构能长出三种完全不同的页面。
- 需注意的边界：① 它默认**不做**浏览器截图/DOM 检查（只在用户要求时），定时任务若要自检质量需显式加一步；② 它假定存在一个「原始本地项目」目录并鼓励保留包管理/锁文件，实验室这种「一次一份产物」的用法要主动声明 local-only，否则容易滑向 `sites-hosting` 的云准备流程。

下一轮候选（未试，供后续时段选取）：`sites:sites-building` × 仪表盘场景（新粗野主义/深色数据密集/报纸排版）；经用户授权安装后试 `ui-ux-pro-max`（50 风格/21 调色板，适合风格横评）；`ui-designer`（从参考图反推设计系统）。
