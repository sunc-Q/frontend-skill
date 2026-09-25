# 复现文档 — graphic-gif × 动效营销横幅（三风格 GIF）

- 轮次：2026-09-26 02:00（第 13 轮；系统时钟读作 01:04，按 21:00 轮先例以「目录名=台账时间」记 02:00）
- 产物目录：`artifacts/20260926-02-graphic-gif-banner/`
- 结论：**留用（限定场景：社媒/营销动图资产）**，条件式——技能是「契约无资产」，导出链路必须自带替代实现

## 1. 技能与来源

| 项 | 值 |
|---|---|
| 名称 | graphic-gif 1.0.0（author: OpenDirectory） |
| 本机路径 | `~/.qoder-cn/skills/graphic-gif/SKILL.md`（用户 2026-09-25 19:37 装入，**目录内仅此一个文件**） |
| 主张 | CSS @keyframes 动画 → Playwright 逐帧捕获 → GIF（默认路径 A）；路径 B 为 Kling 图生视频（需 KLING_API_KEY，本轮未验） |
| 上游链接 | SKILL.md 未写仓库地址；未联网溯源（GitHub HTTPS 被 TLS 重置是已记环境事实） |

**关键事实（本轮最大发现）**：SKILL.md 正文引用了 `references/animation-library.md`（6 种动画型完整规格）、`references/style-presets.md`（4 套风格 token 块）、`scripts/export-gif.sh`（导出脚本），**三者在本机安装中全部不存在**——与 vercel-react-best-practices（rules/*.md 缺失）同一失效模式：市场分发包只带 SKILL.md。动画型规格只能从 Step2/Step3 的表格里抠（timing function 逐型映射、typewriter steps 计数法、counter @property 模板、loop-scroll 复制规约都在正文里，算救得回来）；**风格 token 块正文只给三条线索**（terminal=扫描线 repeating-linear-gradient opacity .03、brutalist=4px 实描边、深色风格禁纯白 #fff），clean-slate/electric-burst 基本裸奔。本轮三套 :root token 全部按线索重建并在文件内注释标为「文档化偏离」。

## 2. 场景与三风格

场景：**动效营销横幅（GIF）**——虚构活动「发光跑 GLOW RUN · 第三季」城市夜跑社媒方图。规格三张一致：800×800 · 3.0s · 12fps · 36 帧 · 无限循环。同一事实源（`scripts/facts.json`）：2026-10-17 20:30 · 5.2KM · 已报 3264/名额 3500 · 剩 236 · 口号「城市入睡时，我们发光。」

| 风格（used_styles 名） | 技能 preset | animation type |  unforgettable detail |
|---|---|---|---|
| 云白板计数 clean-slate-gif | clean-slate（重建） | counter（@property --num 整数插值） | 数字冲到 3264 才停 + 4px 强调色横杠贯穿标题杠/进度条 |
| 磷绿终端打字 terminal-gif | terminal（重建） | typewriter steps(41,end) | 块光标呼吸 + 扫描线 + 四行结果逐行显现 |
| 黄黑硬框跑马灯 brutalist-gif | brutalist（重建） | loop-scroll（5 芯片×2 复制，0→-50%） | 城市路线从钉死的红色 5.2KM 印章背后流过 |

## 3. 调用/安装方式（本轮实际做法）

技能 Step1 是交互式 intake（缺 prompt 要问用户）——无人值守直接按默认值跳过：css-animated / 3.0s / 12fps / loop=true / 800×800 / balanced。
Step5 的 `bash [skill-root]/scripts/export-gif.sh` 不存在，**替代实现** = `scripts/capture-encode.mjs`：

1. 依赖装在 `LAB/.tmp/node_modules`（收尾即删）：`npm i --registry=https://registry.npmmirror.com playwright-core@1.48.2 gifenc pngjs`
2. 驱动**已缓存**的 chromium：`~/Library/Caches/ms-playwright/chromium-1148/.../Chromium.app`（HeadlessChrome 131，经 `executablePath` 指定，不下载浏览器）
3. `page.goto(file://…)` → `await document.fonts.ready` → `document.getAnimations().forEach(a=>a.pause())` → 每帧 `a.currentTime = i*(1000/fps)` → `page.screenshot({clip:800×800})` → pngjs 解码 → gifenc `quantize/applyPalette/writeFrame`
4. **gifenc 的 `delay` 单位是毫秒**（内部 `Math.round(delay/10)` 化厘秒），传厘秒会得到 1cs=100fps 的错片
5. 度量随产物落盘：`gif-metrics.json`（字节数/终帧值/字体加载数/逐帧亮度/首末帧差）+ `samples/` 每风格 3 张 PNG（首/中/末帧）

## 4. 复现步骤（从零重建）

```bash
cd 前端skill实验室
mkdir -p .tmp && cd .tmp && npm init -y
npm i --registry=https://registry.npmmirror.com playwright-core@1.48.2 gifenc pngjs && cd ..
S=artifacts/20260926-02-graphic-gif-banner
for s in clean-slate terminal brutalist; do
  node $S/scripts/capture-encode.mjs --html $S/${s}-gif/animation.html \
       --out $S/${s}-gif/animation.gif --samples $S/samples/${s}
done
node $S/scripts/check.mjs   # 台账写回后 155/155；写回前 F 组 6 条幂等锁必然翻转
```

## 5. 断言与结果

`scripts/check.mjs` **155 条**（写回台账后全绿；写回前 149/155，F 组 6 条为「快照+增量==现值」幂等锁）：

- **A 组 74 条 = 技能 Critical Rules 1-10 + Step4 Self-QA 清单整段转码**：body/.canvas 800×800+overflow hidden、无 animation-delay、每条 animation 简写含 forwards|both、每个 @keyframes 有 0% 起点、infinite 仅限 blink/scroll、:root 外无游离十六进制色、无占位符、外链仅字体 CDN（`<img src>`/外部 script 为零）、counter 三件套（@property syntax/initial-value/counter-reset+content）、typewriter 三重一致（steps(N)=data-text.length=ch 宽=data-tw）、loop-scroll 芯片数=2×data-items + translateX(0→-50%) + linear infinite、brutalist 4px 描边≥3、terminal 扫描线块内双要素、字重对比。
- **B 组 28 条 = GIF 字节结构**（自研块遍历解析器）：GIF89a、LSD 800×800、帧数=floor(3×12)=36、全帧延时 8cs、NETSCAPE loop=0、局部色板≤256、metrics.bytes=磁盘字节、单张<3MB、三张字节互异。
- **C 组 12 条 = 帧度量**：末帧 --num=3264、进度条 matrix(0.9326…)、打字末宽 590.4px=41×14.4（0.6em 字身）、FontFaceSet≥3 faces（webfont 真加载）、一次性动画首末帧差>1.5、brutalist 环缝≤1.35×帧步长（无缝）、亮度数组长度=36、styles.html 标注字节=实际字节。
- **D 组 10 条 = 三风格互异**：色板两两零交集、--bg 互异、字体族互异、type 互异、签名容器唯一。
- **E 组 29 条 = 事实一致**：3500-3264=236、3264/3500=0.9326、每页 9 项事实逐字命中、brutalist 含全部 5 打卡点、styles.html 事实表对账。
- **F 组 6 条 = 台账幂等锁**（见 §7 教训）；**G 组 4 条 = 磁盘纪律**。

浏览器复核（面板 hidden，纯 DOM 读，无截图）：styles.html 3 张 `<img>` 全部 `naturalWidth=800` 解码成功、控制台零消息；terminal/animation.html `getAnimations().length=6`、body 背景 rgb(11,18,12) 命中 token、控制台零消息。像素级复核由 samples 9 张 PNG 直读替代（本轮首次用「末帧 PNG 目视」抓到终值缺陷的修复效果）。

## 6. 缺陷与发现

**技能侧**
1. 🔴 **契约无资产**：references/ 两本 + scripts/export-gif.sh 全缺（§1）。导出脚本可以自己重造（本轮造了），但 style preset token 属「设计资产缺失」，三套色板是重建品不是技能品。
2. 🔴 **规则 6 与一次性动画天然冲突**：`帧数=floor(duration×fps)` 且禁采 t=duration ⇒ 线性一次性动画**最后一帧永远到不了终值**——首版 clean-slate 末帧停在 3173/3264（GIF 里目标数根本没出现过）。修法：把「到顶+保持」烘焙进 keyframes（`92%,100%{--num:3264}`），仍是一次性动画、不违反任何规则。typewriter 同理（41 字只打得完 40）。技能 Self-QA 的「loops cleanly」清单查不出这个，靠末帧 PNG + `final_state` 探针才抓得住。
3. 🟠 **GIF 厘秒粒度未提**：12fps→8cs→实际 12.5fps（提速 4.2%）。技能默认参数组合下每张片都比标称快，无人值守产物必须按字节实测（B 组已固化 `effective_fps=12.5` 断言）。
4. 🟠 **typewriter 的 ch 技术只对等宽字体成立**：`width:0→Nch` 在比例字体/CJK 下按「0」字宽截断，会把汉字切半。本轮用等宽 IBM Plex Mono 打拉丁命令行规避；技能未提此约束。
5. 🟡 **Step4 清单自相矛盾**：「weight contrast minimum 2:1 (e.g., 700 vs 400)」——700/400=1.75。按字面断言会把技能自己的示例判违规；本轮断言取示例口径（显示≥700 且辅助≤400）。
6. 🟡 **字体 CDN 硬要求 vs 实验室零外链纪律**：Critical Rule 3 把 Font CDN link 定为唯一合法外链，Step4 还要求「link 必须存在」。本轮分工：animation.html 保留 CDN link（技能品），对照入口 styles.html 零外链（实验品）；GIF 是位图，分发端天然自包含。
7. 🟢 **独有优点**：全实验室第一个「时间维度」技能；Critical Rules 1-10 + Self-QA 清单**几乎整段可机检**（A 组 74 条），Web Animations API 寻位规约（规则 5/6）是正确且可验证的——历轮「规范型技能回查有价值」的结论在这再次成立。

**我自己（检查器/实现坑，全部在盘核对）**
8. CSS 注释里写「无 animation-delay」被 A2 判违规 → 规则符合性必须在 `stripComments` 后的代码上跑（历轮「注释/数据串伪装成缺陷」模式新增一例：这次是**注释里的违规关键词**）。
9. 非贪婪正则抽 `@keyframes` 块遇嵌套 `{}` 截错（单行写法的块会吞掉后面整段）→ 改括号配平扫描 `balancedBlock`。
10. `0%:` 式正则匹配不到 `0%,4%{` 选择器组形态（冒号在整组之后）→ 起点判定改 `(0%|from)\s*[,{]`。
11. `scaleX` 取首个匹配抓到的是 0% 段的 `scaleX(0)` → 终值断言一律取 `matchAll().at(-1)`。
12. 首末帧差阈值 >3 把 terminal（2.49）打成假失败：深色大面积底稀释全帧均值 → 阈值 1.5 并注明口径。
13. GIF 解析第一版没跳图像数据子块 → `frames=0` 假失败；块遍历要区分 0x21 扩展（子块链）与 0x2C 图像（局部色板+LZW 最小码长字节+子块链）。
14. `createRequire` 的相对层级从 **mjs 文件本身**起算（file→scripts→场景→artifacts→LAB/.tmp 共 4 级），第一版按目录算差一级。
15. 真实内容缺陷 1 处：terminal 首版没有中文名「发光跑」，E 组逐字命中抓到（改 NAME 行 + DATE 行合并 COURSE）。
16. 重编码后字节漂移两次（1,242,667→1,242,577、458,953→461,291），styles.html 数字随之过期——C 组「文档数字=实际字节」断言当场抓住，验证了 19:00 轮定下的「凡进文档的数字必须由断言打印」在动图场景同样必要。

## 7. 台账契约

`scripts/ledger-snapshot.json` 记录开工前：tried 12 / runs 12 / used_styles 36 / skills_seen 17 / env_notes 67 / next_candidates 29。F 组按「快照+增量==现值」写幂等式（+1/+1/+3、末三条=本轮三风格名），写回前跑必红 6 条、写回后闭合——沿用 00:00 轮教训，绝不写「未见于台账」。

## 8. 未验项（诚实记录）

- ai-generated 路径（Kling API + ffmpeg 两段式）——需 KLING_API_KEY，未测；ffmpeg 本机在（`~/.local/bin/ffmpeg`），gifsicle 不在（技能 Step5 第 4 步「若可用」= 本机不可用，无优化 pass，产物仍达标）。
- 6 动画型只实测 3 种（counter/typewriter/loop-scroll，另 blink 属 pulse 族）；fade-in/slide-in 未独立成片。
- electric-burst 第 4 预设未做（3 风格已够配额且它与 terminal 同属深色族）。
- 真实显示尺寸下文字可读性（无截图目视，styles.html 缩略渲染 320px 宽下未复核）。
- 环缝目视（用 diff 度量替代：brutalist 环缝差 ≤1.35×帧步长）。

## 9. 收尾与体积

删除：`LAB/.tmp/`（node_modules 12MB + probe 装置）；无构建缓存、无 dist、未起 http.server。保留：3×animation.html（各 4-5KB，技能契约原样含 CDN link）、3×animation.gif（832,397 + 461,291 + 1,242,577 B = 2.5MB）、styles.html、samples/ 9 PNG、scripts/ 四件（capture-encode.mjs / check.mjs / facts.json / ledger-snapshot.json）+ 3×gif-metrics.json。场景目录 ≈ 3.1MB ≪ 50MB。技能目录零写入。

## 10. 判定

**留用（限定场景）**。要「会动的方图社媒资产」时这是本机唯一对口技能，且其规则可机检程度全实验室前三；但必须接受两个前提：①导出链路自带（复用本轮 capture-encode.mjs，playwright-core+缓存 chromium+gifenc 三件套 ~1 分钟装完）；②风格 token 自备（技能给不了）。下轮若再用：补 fade-in/slide-in 两型 + 把「终值缺陷」式子（末帧值==目标值）移植进其它一次性动画场景作硬断言。
