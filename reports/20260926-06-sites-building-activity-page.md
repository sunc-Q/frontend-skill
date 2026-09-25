# 验证记录 · 2026-09-26 06 时段

| 项 | 值 |
|---|---|
| Skill | `sites:sites-building`（Qoder 内置插件 qoder.sites，Simple site 静态路径；**第 4 次使用**，第 3 次单独承担页面） |
| Skill 位置 | `/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/SKILL.md` |
| 场景 | **活动营销/报名页**（虚构「星屿·声浪岛音乐节」：hero 倒计时+3 KPI+开票进度 / 12 组阵容（投票乐观更新+双排序）/ 25 场日程（Map 单循环分舞台+日期∩舞台双筛+空态）/ 观众公告（点开才取数、再点走缓存）/ 报名表单（三档票+VIP 分支延后取数+校验+乐观落单+风控回滚+提交锁）/ 纪念票根 SVG（点击才生成）/ 本机偏好持久化与 sanitize） |
| 三种风格 | 剪纸层叠 papercut / 票据存根 ticket-stub / 等距轴测 isometric |
| 产物目录 | `artifacts/20260926-06-sites-building-activity/`（308KB，三页 52.1–53.7KB 单文件，双击即开） |
| 断言 | check.mjs **239 条**（写回前 239/245，6 条为 G 组台账幂等锁，写回后闭合）+ visual.mjs **90 条**真浏览器断言 = **329 条** |
| 结论 | **留用（第 4 次通过）。本轮的价值不在"能不能做"，而在给出实验室第一条同场景跨 skill 的成本-能力曲线：体积 5.01× 更省、源码行数 1.03× 几乎相同，但失去 4 类 React 专属保证（分段 Suspense、真分包、跨模块 single-flight、并发过渡）与服务端时序证据强度** |

## 1. 选题依据

`state.json.next_candidates` 里排了 4 次的同一条：「sites:sites-building × 活动报名页（与 20:00 轮同场景零框架对照：同一张活动页，内置技能单文件 vs React+mock 服务端的成本/能力差）」。★ 首选项（build-game 手绘参考图、口径移植横检）本轮不动，因为它们是"横检类"任务、不产出新场景页面，而这条对照是实验室目前唯一缺的**同场景双实现**样本。

对照严格受控：`src/content.js` 逐字段复制自 20:00 轮 `src/lib/content.ts`（12 艺人 / 25 场次 / 4 公告 / 3 票档 / 同一 signedCount=12,483、capacity=18,000），`src/svc.js` 复刻 mock 服务端的风控规则（姓名含「风控」→409、qty>余票→409、同人二次投票→409、VIP left=min(46,余票)），连 `soundisle.prefs.v1` 的 schema 与 `/^a\d\d$/` 白名单正则都一致。

风格避开台账已用 48 种，选三种印刷/立体向：剪纸层叠、票据存根、等距轴测。

## 2. 技能条款怎么用（Simple site 路径）

SKILL.md 的 Simple-site 五步（§3）逐条落地：

1. **一次成型**：一 HTML 模板 + 一结构层 CSS + 三份主题层 + 一份 vanilla 脚本；无框架、无构建器（`build.mjs` 只做占位符拼接）。
2. **替换 starter 文案与 metadata**：`<title>`/`description` 全为页面真实内容；未用的 starter 文件一个没生成。
3. **检查入口、资源引用、JS 语法**：`node --check src/app.js` + A 组「零外链（标签级）」+「无 http(s) 资源引用（属性/CSS 出现处）」；plain static 不造构建步骤。
4. **只修真实失败，不做投机打磨**：见 §5，修了 3 个真缺陷后停手，未追加"再美化一轮"。
5. **交付**：本地预览（file:// 直开），不做 hosted 交付（任务规范限定本地产物）。

技能自带的「不做浏览器 QA（需用户请求）」与实验室「必须复核产物」的冲突，沿用 23:00 轮定下的分工：**浏览器只跑不需要事件驱动的检查 + 真像素截图，交互一律走 jsdom**（本轮 jsdom 239 条，chromium 90 条）。

## 3. 三种风格（全部由 C 组指纹三式 + 真浏览器计算样式双重证明）

同一份 DOM 与逐字节相同的 `<script>`（B7 不变式：剥掉主题层后三页逐字节相同；脚本三页逐字节相同），只换 CSS 主题层。结构层 `base.css` 零 hex（分层未失效断言把关），色板全部收在主题 `:root`。

| 风格 | 主张 | 招牌特征（互斥断言） | 帧统计（全帧跨步采样，n≈4.4–4.7 万点） |
|---|---|---|---|
| 剪纸层叠 papercut | 暖米纸 + 番茄红/芥末黄/苔绿的厚剪纸条 | 圆角 ≥20px、双层硬偏移影 `0 7px 0 + 0 14px 0 -3px`、`thead` 移出屏外把日程打散成剪纸条目、序号是苔绿圆片、进度条斜纹带 | mean 232.3 / σ 45.2 / span 209.2 / mid 11.3% |
| 票据存根 ticket-stub | 整页就是一张可撕车票 | 三族字体全等宽、圆角 0、**零阴影**（层次全靠线宽与底色差）、分区下沿 `radial-gradient` 齿孔撕口、日程严格表格（thead 可见 + 斑马纹）、状态框是双线骑缝章、进度条是打孔色带 | mean 219.4 / σ 30.8 / span 211.1 / mid 3.4% |
| 等距轴测 isometric | 深空底上立起的斜切面板 | Georgia 斜体标题、`writing-mode: vertical-rl` 竖排舞台标签、`skewY(-2deg)` 面板 + `perspective(760px) rotateX(11deg)` 压台、霓虹发光 `0 0 18px` 影、整页等距网格底纹 | mean 33.4 / σ 24.6 / span 213.4 / mid 16.2%（暗底主张兑现） |

七指纹两两差异 ≥3 项（`scripts/fingerprints.json` 落盘），三套色板两两零交集，明暗口径与主张一致（isometric mean<90，另两页 >180 一侧）。

## 4. 复现步骤

```bash
cd artifacts/20260926-06-sites-building-activity
bash scripts/verify.sh      # build → 必要时把 jsdom 装到 ../../.tmp/jsdom（npmmirror）→ 239 条断言
node scripts/visual.mjs     # 真 chromium：3 风格 × 桌面 1280/手机 390 截图 + 90 条计算样式/溢出/帧统计断言
```

`visual.mjs` 另需 `playwright-core` + `pngjs`（本机 chromium 缓存 `~/Library/Caches/ms-playwright/chromium-1148`，脚本用 `ls -d` 自动定位；装法与 jsdom 同处：`cd LAB/.tmp/jsdom && npm i playwright-core pngjs --silent`，registry 走 npmmirror）。截图 PNG 属中间产物，收尾按任务规范删除，帧统计留在 `scripts/frame-stats.json`。

预期末行：`check: 全部通过`（写回台账后 G 组 6 条闭合）、`视觉断言：通过 90 / 失败 0`。

产物：

- `preview/activity-{papercut,ticket,isometric}.html` —— 52,118 / 53,745 / 53,192 字节（剪纸日程行收紧后），零外链零依赖，双击即开。
- `preview/styles.html` —— 三风格对照入口。
- `src/` —— page.html（结构模板）+ base.css（结构层）+ 三主题 + content.js/svc.js/app.js；`build.mjs` 按 `/*__BASE__*/ /*__THEME__*/ /*__APP__*/` 三占位符拼装（替换一律 replacer 函数，避开历轮 `$&` 展开自复制坑）。
- `scripts/{check.mjs,visual.mjs,verify.sh,ledger-snapshot.json,cost-comparison.json,fingerprints.json}` —— 全部保留，无一次性脚本需转录。

## 5. 本轮抓出的真实缺陷（产物侧，非断言侧）

1. **重复 id `#schedule` 把整个分区抹掉**。`<section id="schedule">` 与内层 `<div id="schedule">` 重号，`getElementById` 返回文档序第一个（section），于是 `renderSchedule()` 开头的 `scheduleWrap.textContent = ''` 清空的是整个日程区（含 `#sched-count`），boot 的 `.then()` 在 `slot('sched-count').textContent = …` 处抛 TypeError，页面后半永远不填充。jsdom 里表现为"进程直接退出"，第一眼像测试装置问题，实际是产物缺陷。防线已固化成 A 组三条断言：**零重复 id**、**每个 `slot()` 目标在文档里恰好出现一次**、`slot()` 引用面 ≥30。
2. **票档偏好恢复成 VIP 时不触发前区取数**。延后取数（defer）只写在 `pickTier` 事件处理器里，二次访问从 localStorage 恢复 `tier:'vip'` 时没人调用它 → `#vip-box` 解除 hidden 却是空框。修：抽出 `ensureVip()`，boot 与 pickTier 都调；B8 配断言「恢复票档会补取前区库存（恰好 1 次）」。这是"defer 优化"在零框架下的独有失效面——React 轮靠 Suspense 天然覆盖。
3. **`rotateX(11deg)` 使日程表在 1280 视口横向溢出 7px**。透视变换让近端（下沿）比 100% 更宽，`width:100%` 的表溢出容器。jsdom 永远查不出（innerWidth=0，历轮坑 #18/#66），只有真浏览器溢出断言抓到。修：表宽收到 94% 并写明原因。

## 6. 断言侧缺陷（检查器 bug 伪装成产物 bug，本轮 5 处）

1. **关键词断言没剥注释**：`/innerHTML/.test(app.js)` 命中了文件头纪律注释里的「不用 innerHTML」→ 假失败。历轮坑 #69 的同族，本轮补 `stripComments()`。
2. **「看得见」只判 width/height**：papercut 把 `thead` 用 `position:absolute; left:-9999px` 移出屏外，`getBoundingClientRect()` 的 width/height 仍 >0 → 误判"表头可见"。修：加 `r.left > -1 && r.top > -1`。
3. **把风格主张本身判死**：对三页统一断言"有阴影"，而 ticket 的主张正是「零阴影」→ 改为按 `EXPECT_SHADOW` 分页断言。同理明暗口径按主张分页（历轮 H/contrast 移植结论 #81 的又一次应验：口径不能跨媒介/跨主张统一）。
4. **栅格解析断言的 regex 形态不全**：计算后的 `gridTemplateColumns` 是 `245.5px 245.5px …`，我按 `repeat|minmax|[\d., ]+` 判，漏了带 `px` 的解析形态 → 三页全假失败。修：判「不含 var(/repeat(/minmax(」+「含 px」。
5. **期望值口算**：`satRows` 用 `/'sat',/g` 数场次，把 `EVENT.days` 里的 `key: 'sat'` 也数进去 → 期望 12 实际 11（页面是对的）。修：正则限定 `'sat', *(main|isle|lounge)`。另 B8 期望串写成 `a02,a99`，而 a99 不在 12 组阵容里（sanitize 保留它但不该出现卡片）→ 改为从数据源现读真实 id 集合再推期望。

## 7. 同场景跨 skill 成本-能力对照（本轮的主要产出）

体积/行数为现读磁盘（D 组，`scripts/cost-comparison.json`）：

| 指标 | 本轮 sites-building（零框架） | 20:00 vercel-react-best-practices | 比 |
|---|---|---|---|
| 三页单文件总字节 | 159,055 B | 797,263 B | **5.01×** |
| 源码行数（含 HTML/CSS vs 仅 .ts/.tsx） | 1,298 | 1,332 | 1.03× |
| 构建步骤 | 无（node 拼字符串） | Vite 双构建 + esbuild 预打包 + inline 脚本 | — |
| 收尾成本 | 场景目录内零 node_modules | 曾需删 102MB node_modules | — |
| 断言数 | 329 | 205 | — |

**功能面等价**（本轮全部落地且有 DOM 证据）：倒计时双时钟（`svc.serverNow()` 单一口径，不用本地 `Date.now()`）、3 KPI、开票进度（已出+余票==容量 自证）、投票乐观 +1 与服务端确认后一致、二次投票被 409 拒后回滚、双排序复排不重建（`stats.cardsBuilt` 恒 12，100 次排序只移动节点）、Map 单循环分组（一次筛选的循环数 ≤25）、日期∩舞台双筛 + 空态、公告点开才取且再点走缓存（请求数恒 1）、VIP 分支延后取数、姓名/手机号校验先于请求（0 请求）、风控 409 回滚（KPI 双指标还原）、提交锁（连点 2 次只发 1 次）、票档与投票持久化 + 非法 id sanitize、票根按需生成（点击前 SVG 数 0，点击后条码 28 格、单号入图）。

**失去的 4 类 React 专属保证**（诚实记账，不是缺陷而是能力边界）：

1. **分段 Suspense/骨架**：本轮一次 `boot()` 聚合取数后统一 paint，慢资源不会只挂自己那段骨架；React 轮有 4 个独立边界并断言了"慢的 lineup 挂骨架时 schedule 已出内容"。
2. **真代码分包**：零框架下"按需"只能退化为**惰性执行**（点击才 `buildPoster`），字节仍在同一文件里；React 轮 split 构建实测按需 chunk 只占首包 0.5%。`bundle-dynamic-imports / bundle-conditional / bundle-preload` 三条在 Simple site 路径上**不可适配**，只能验"惰性渲染"这个弱化命题。
3. **跨模块 single-flight / TTL 去重**：本轮缓存是模块内变量 `noticesLoaded`，只有 1 个消费者，"3 消费者 1 请求"这类证明做不出来。
4. **并发过渡（useTransition）**：排序切换是同步 DOM 移动，12 卡下无感，但列表放大后没有可中断渲染兜底（本轮未测，不声称）。

**证明强度差**：React 轮的 async-* 断言打在**服务端 hrtime 到达窗口**上；本轮 svc 在页内，`setTimeout` 延迟档在负载下漂移（历轮坑 #28），所以本轮只断言**请求次数与先后**，不断言墙钟并行性。结论：`async-parallel` 这类"快"的证明必须有进程外服务端，内置技能的静态路径给不了。

## 8. 结论与留用判断

- **sites:sites-building 留用（第 4 次）**。它的 Simple site 路径在"内容型/交互型单页"上性价比最高：5.01× 体积优势、零构建、收尾成本近零、产物双击即开，且交互复杂度（乐观更新+回滚+延后取数+持久化 schema）已经能承载——本轮 329 条断言里 239 条是行为断言，不是样式断言。
- **它的天花板清晰**：需要真取数时序、真分包、多消费者去重、并发渲染时，必须换 React/Vite 路线（20:00 轮）。因此后续排题原则不变：**同场景双实现的对照做一轮就够了，不要为省字节而牺牲要验的条款**。
- 内置技能文档层面本轮新增可复用法：`Simple site` 与 `Capability site` 的分岔判据（"无持久数据/无上传/无鉴权/无外部服务"）确实能覆盖实验室多数场景；SKILL.md 对"结构层/皮肤层分离""零外链"没有条款，这两条是实验室自加的纪律。
- 待办移植（写进 next_candidates）：①本轮「零重复 id + slot 目标唯一」两条式子可回查 04:00 多页站点与 23:00 个人主页历史产物（低成本回归）；②「透视/斜切变换导致横向溢出」应进历轮视觉复核清单——skew/perspective 类风格只在真浏览器可测。
