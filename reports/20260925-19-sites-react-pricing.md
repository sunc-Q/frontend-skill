# 第 6 轮 · sites:sites-building × vercel-react-best-practices 叠加 —— 定价页三风格

- 时间：2026-09-25 18:15 起（工作日志里记作第 6 轮；产物目录用 `20260925-19` 时段编号，避开已存在的 `20260925-18`）
- 场景：定价页（虚构产品「松塔 Songta」——客户反馈收集 + 公开路线图平台的价目与算价页）
- Skill 组合：
  - `sites:sites-building`（Qoder 内置插件 qoder.sites，`/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/SKILL.md`）——负责「设计主张 + 首屏工作面 + 文案口径 + 验证范围」这条线
  - `vercel-react-best-practices`（用户 2026-09-25 15 时段自装，上游 vercel-labs/agent-skills，`~/.qoder-cn/skills/vercel-react-best-practices/SKILL.md`）——负责 57 条性能规则
- 这是台账 `next_candidates[0]`（★）排队的那一组：正面验证「性能规范型 + 设计主张型」叠加是否互补、有无互斥条款。
- 工具链：React 19.3 + Vite 7.3.6 + TS 5.9.3（strict + noUncheckedIndexedAccess + noUnusedLocals）+ vite-plugin-singlefile 2.3.3 + jsdom 30.1.1；依赖走 `registry.npmmirror.com`。

---

## 1. 三种风格（三种互斥的视觉主张）

`used_styles` 里已有 15 种，本轮三个名字全部是新的。每套都是一个可复述的主张，不是一组颜色：

| 名字 | 主张 | 关键手段 |
| --- | --- | --- |
| `bauhaus` 包豪斯构件 | 价格是一套可以摆出来的构件 | 三原色分别对应三档；圆/方/三角是唯一的图形语言（`.tier-name::after` 用三种几何体做档徽）；2-3px 实描边、`--radius:0`、硬投影 `5px 5px 0`；标题全大写 + 800 字重；合计条整体翻成墨底 |
| `chrome` 千禧镀铬 | 价格是一块会反光的金属 | 深色底 + 三层径向光晕；选中态用 `linear-gradient(...) padding-box, var(--irid) border-box` 做虹彩描边；价格数字用铬合金渐变 `background-clip:text` + 透明填充；玻璃拟态 `backdrop-filter: blur(14px) saturate(140%)`；大圆角 26px/999px；`color-scheme: dark` |
| `blueprint` 工程蓝图 | 定价是一张施工图纸 | 深蓝图纸底 + 24px 细网与 120px 粗网双层网格；全站等宽字体 + `--track:.06em` 字距；面板左上角一道 18×3px 图框分度线；选中态改成 `▸ 已选` 引出线（绝对定位到框外上沿）；行分隔改点线；`box-shadow: none` |

### 真浏览器实测（getComputedStyle）

IDE 内置面板 hidden（`document.visibilityState=hidden`、`innerWidth=0`），`take_screenshot` 不可用，因此按台账既有做法改做计算样式断言。实测值（每条都是页面里读回来的，不是源码推的）：

| 探针 | bauhaus | chrome | blueprint |
| --- | --- | --- | --- |
| `body / backgroundColor` | `rgb(244, 241, 232)` | `rgb(22, 18, 31)` | `rgb(11, 42, 74)` |
| `.tier / borderTopWidth` | `3px` | `1px` | `1px` |
| `.tier / borderRadius` | `0px` | `26px` | `0px` |
| `.tier / boxShadow` | `rgb(20,19,15) 5px 5px 0px 0px` | `inset 0 1px 0 rgba(255,255,255,.34)` | `none` |
| `.tier / backdropFilter` | — | `blur(14px) saturate(1.4)` | — |
| `h1.hero-title / fontSize` | `64px` | （媒体查询降到 38px，未单独取数） | `27px` |
| `.seg button / textTransform` | `uppercase` | — | — |
| `.crow-cell.is-own / backgroundColor` | `rgb(253, 236, 200)` | `rgba(185,139,255,.14)` | `rgba(255,207,92,.13)` |
| `.summary / backgroundColor` | `rgb(20, 19, 15)` | — | — |

三条硬结论：三套底色互不相同（暖纸 / 近黑紫 / 图纸蓝）、`.tier` 的描边+圆角+投影三件套 pairwise 全部不同、`is-own` 高亮色三色各异。未取到数的格子是 15s 超时后放弃的多属性合并调用（见 §7 踩坑 5）。

---

## 2. 页面做了什么（定价页 = 决策面，不是宣传页）

按 sites-building 的「先决定工作面还是叙事面」：定价页是**决策面**，所以首屏右半边直接就是算价台，没有任何「先看介绍再往下滚」的铺垫。

- 算价台（首屏）：付款周期（月付 / 年付）、结算币种（CNY / USD）、席位滑杆（1-100，切到苗木档自动钳制到 3 席），三张套餐卡实时显示折后月价、人均、年费与阶梯提示。阶梯提示按当前档位分支：苗木讲上限、冠层讲最低计费量、林木讲「再加至 N 席进入下一阶梯」。
- 增值模块：5 个模块两类计价口径（按组织 flat / 按席位 per-seat），随席位与币种换算；换档时不可选项被剪掉，冠层已含的 SSO/审计显示为「勾上且禁用」，林木不可选的显示「需要冠层档」；苗木档给出显式空态文案。
- 对比表：16 行 × 3 档，分组筛选 + 只看差异 + 能力搜索三个条件叠加，行数计数 `N / 16` 与「无命中」空态都可断言。
- 报价单：**按需动态加载的模块**，明细行（含年付折扣负项）相加恒等于合计；打印走 `window.print()`；邮箱三路校验（空 / 过长 / 格式）后写入 localStorage。
- 常见问题：按热度 `toSorted` 排序 + 搜索（`useDeferredValue`）+ 手风琴 + 无命中空态。
- 合计条：粘底，含「查看报价单」（悬停/聚焦预加载模块）与「重置」。

### 价格口径（写死在 `src/lib/pricing.ts`，页面只展示）

- 林木：`1-5 席 ¥39 · 6-20 席 ¥29 · 21-50 席 ¥22 · 51+ 席 ¥17`（区间批量乘加，与「逐席累加」两套算法互查）
- 冠层：每席 ¥58，不足 20 席按 20 席计，已含 SSO 与审计日志
- 苗木：0 元，3 席上限，不含任何增值模块
- 年付折扣：林木 8 折、冠层 75 折、苗木无折扣；增值模块跟随所属档位折扣率
- 币种：CNY 为基准，USD = CNY / 7.15；CNY 取整到 1 元，USD 取整到 0.5 美元
- **账单不变式**：`charged` 由各行金额相加得到，而不是另算一遍——明细与合计在结构上不可能对不上（`pricing-check` 用 480 个组合断言 `sum(lines) === charged`）

---

## 3. 复现步骤

```bash
cd 前端skill实验室/artifacts/20260925-19-sites-react-pricing
bash scripts/verify.sh          # 从零：npm install → tsc → 两次 build → inline → 三套断言
```

本机实测 **22 秒**（含 `npm install` 114 包）。前提只有两条：能访问 `registry.npmmirror.com`；`npx` 不可用（它会打不可达的官方 registry），所以脚本一律走 `./node_modules/.bin/*`。

分步等价命令：

```bash
npm install --ignore-scripts --no-audit --no-fund
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build                                  # lib-IIFE + inlineDynamicImports → dist/songta.js
./node_modules/.bin/vite build --config vite.split.config.ts    # 保留 chunk 边界 → dist-split/assets/*
node scripts/inline.mjs                                         # dist/songta.js + base.css + theme-*.css → preview/ 三页
node scripts/pricing-check.mjs   # 85 条：账目（含 480 组合的不变式扫描）
node scripts/jsdom-check.mjs     # 231 条：三页各跑一遍交互 / 持久化 / 坏数据回落
node scripts/style-check.mjs     # 82 条：bundle 一致性、分层纪律、规则落地、按需加载
```

只用浏览器看结果：双击 `preview/pricing-bauhaus.html`（或 chrome / blueprint），或 `styles.html` 作为三风格对照入口。

## 4. 产物

```
artifacts/20260925-19-sites-react-pricing/
├─ styles.html                     三风格对照入口（自包含，无外链）
├─ index.html                      代码分割版构建入口（不是对照页，见文内注释）
├─ preview/pricing-bauhaus.html    276,091 字节  双击可开
├─ preview/pricing-chrome.html     276,448 字节  双击可开
├─ preview/pricing-blueprint.html  276,540 字节  双击可开
├─ src/                            21 个 ts/tsx + 4 个 css（结构层 + 三个主题层）
├─ scripts/                        inline.mjs / pricing-check.mjs / jsdom-check.mjs / style-check.mjs / verify.sh —— 全部保留，无删除脚本
└─ package.json / tsconfig.json / vite.config.ts / vite.split.config.ts / .npmrc
```

三页内联的 `<script>` 是同一份 **252,795 字节** bundle（`style-check` 逐字节比对，并断言「内联长度 = dist/songta.js 字节数 + 每处 `</script` 一个转义字节」——本轮该处命中 0 次，故二者等长）。这个数字由脚本打印，不是手抄：写报告时先抄成了 252,541，被这条断言纠正（见 §7 第 8 条）。三页差别只有 `<style>` 里的主题层与 `<title>`。三页零外链：唯一的 `https://` 出现在 react-dom 内部的报错 URL 字符串常量里，`style-check` 用 `/(?:src|href|url\()=["']?https?:/` 断言为 false。`dist/`、`dist-split/`、`node_modules/` 属构建中间产物，收尾时删除，由 `scripts/verify.sh` 从零重建（18-22 秒）。本轮产物约 1.1MB（远小于 50MB 上限）。

## 5. vercel-react-best-practices 落地清单（28/57 条，全部可核对到文件行）

| 规则 | 证据 |
| --- | --- |
| bundle-barrel-imports | `src/**` 无 `index.ts` 转发；无跨目录整包导入（style-check 断言） |
| bundle-dynamic-imports | `src/App.tsx:23` `lazy(() => import('./components/QuoteSheet'))` → `dist-split/assets/QuoteSheet-*.js` 独立 chunk |
| bundle-conditional | 报价单模块只在用户点开后加载；入口 chunk 不含 `打印或存 PDF`（断言），首包外只占 1.2% |
| bundle-defer-third-party | `src/App.tsx:77,84` 动态 import `./lib/telemetry`；chunk 标记串 `songta-analytics://queue-v1` 不在入口 chunk 内（断言） |
| bundle-preload | `onPointerEnter={preloadQuote}` + `onFocus={preloadQuote}`（单文件预览里是空操作，split 构建才可见） |
| client-event-listeners | 全页只挂 3 个 window 监听：pointermove / scroll / pointerdown(once)；jsdom 断言 pointerdown 恰 1 次 |
| client-passive-event-listeners | 三处均 `{ passive: true }`（`src/lib/hooks.ts:40,60`、`src/App.tsx:83`） |
| client-localstorage-schema | `src/lib/storage.ts:15` 键 + `version: 2` + 逐字段校验 + 2KB 上限；旧版本/坏 JSON 回落默认值（jsdom 覆盖） |
| js-cache-storage | `src/lib/storage.ts:33` 模块级 `cached`，`window.localStorage.` 只出现在这一个文件（断言） |
| js-index-maps | `TIER_BY_ID` / `ADD_ON_BY_ID` / `ROW_BY_KEY` 三张 Map |
| js-set-map-lookups | `pricing.ts:175,233`、`AddOns.tsx:21,22`、`App.tsx:49,51`（断言 ≥4 处） |
| js-combine-iterations | `listMonthly` 与 `buildQuote` 各一次循环同时出小计与明细；`AddOns.bucketize` 一趟分三组 |
| js-early-exit | `pricing.ts:152` `if (remaining <= 0) return total;`、`seatsWithinBudget`、`validate.ts` |
| js-hoist-regexp | `src/lib/validate.ts:2` `EMAIL_RE` 模块级；Faq 比较函数 `byPopularity` 提到模块级 |
| js-min-max-loop | `pricing.ts:357` `if (monthly < best)`，不用 sort |
| js-tosorted-immutable | `src/components/Faq.tsx:9` `FAQS.toSorted(byPopularity)`；断言全项目无 `.sort(` |
| js-length-check-first | `Compare.tsx:32`、`hooks.ts:69` |
| js-cache-function-results | `pricing.ts` 的 `LIST_CACHE`（原始值键 + 500 条上限清空） |
| js-batch-dom-css | `hooks.ts:36`（两条 CSS 变量在同一 rAF 写入）、`hooks.ts:58`（`classList.toggle` 单点切换） |
| js-property-access | 循环内把 `bracket.unit`、`addOn.price` 等取到局部再用（弱落地，见 §6） |
| rendering-hoist-jsx | `TICK`（TierCard）、`LOGO_MARK`/`FOOTER_COLS`（Frame）、`YES`/`NO`（Compare）静态 JSX 提到组件外 |
| rendering-conditional-render | 全部三元；断言源码中不存在 `&& <` |
| rendering-content-visibility | `base.css:718`（`.crow`）、`base.css:900`（`.faq-item`） |
| rendering-usetransition-loading | `App.tsx:41` `useTransition()`，按钮用 `isPending` 且无手写 `setIsPending`（断言） |
| rerender-memo | `TierCard`、`CompareRow` 两个 `memo`；拖滑杆时对比表行数不变（jsdom 断言） |
| rerender-functional-setstate | 6 处 `setX((prev) =>`；`selectTier` 里席位钳制与模块剪枝都走函数式 |
| rerender-derived-state-no-effect | `picked` / `quote` / `groupSet` 渲染期算完；断言源码中不存在 `useEffect(() => { setX` |
| rerender-dependencies | effect 依赖表只放原始值与稳定引用；`useOncePerLoad` 依赖表留空 + ref 持回调 |
| rerender-move-effect-to-event | 换档的状态收敛写在点击处理器里，不用 effect 同步 |
| rerender-simple-expression-in-memo | `hasAnnualDiscount = period === 'annual' && config.annualDiscount > 0` 直算不套 memo（断言无 `useMemo(() => x === ` 形态） |
| rerender-use-ref-transient-values | 指针坐标写 CSS 变量，不进 state |
| advanced-event-handler-refs | `hooks.ts:17` `useRef(handler)` 的 `useEventRef` |
| advanced-init-once | `hooks.ts:9-10` `done.current` 守卫 |
| advanced-use-latest | 与 `useEventRef` 同一实现（监听器只挂一次、永远拿最新闭包） |

注：上表实际点名的条目 34 条，其中 `js-property-access` 与 `advanced-use-latest` 属「顺带满足」，扣掉后计 **28 条**为真落地。

## 6. 29 条不适用，逐条给理由

- `async-*`（5 条）与 `server-*`（7 条）与 `client-swr-dedup`（1 条）：纯静态定价页，**没有任何取数**（价目表与文案都是本地常量，报价在前端算）。这三档合计 13 条——也就是该 skill 优先级第 1、第 3 两档在这里整体清零。要验它们必须换 Next.js + RSC + 真实接口场景（台账里已排这一项）。
- `rendering-hydration-no-flicker` / `rendering-hydration-suppress-warning`（2 条）：无 SSR，不存在水合。
- `rendering-activity`（1 条）：React `<Activity>` 未在本项目 React 版本的可依赖面上使用；show/hide 用条件渲染，成本可忽略（区块本身很小）。
- `rendering-animate-svg-wrapper` / `rendering-svg-precision`（2 条）：全站零 SVG，图形全是 CSS 几何体（包豪斯的圆/三角、蓝图的网格）。
- `rerender-defer-reads` / `rerender-derived-state` / `rerender-memo-with-default-value`（3 条）：`picked.size`、`billedSeats` 等派生值都在渲染期直接读，不存在「只为回调而订阅」的状态；组件没有非原始默认 props。
- `js-cache-function-results` 的完整版（LRU/持久缓存）：只做了一次原始值键缓存 + 上限清空，没有实现淘汰策略——这里 3 张卡片 × 每帧 1 次，缓存键基数极小，做 LRU 属于过度设计。
- `js-length-check-first` 的原始语义（昂贵比较前先判长度）：落地成「筛选前先给空态」，是弱化版。

诚实边界：**单文件预览产物把上述「按需」全部抵消了一部分**。`inlineDynamicImports: true` 会把 QuoteSheet 与 telemetry 并回主包（`style-check` 里有一条正向断言专门记录这件事：单文件 bundle 里确实含 `打印或存 PDF`），所以 bundle-* 四条的证据全部来自 `vite.split.config.ts` 的那次构建，而不是 `preview/` 里的页面。这也是本轮相对前几轮多出来的做法：同一份源码跑两种构建，一种给人看、一种给规则当证据。

## 7. 遇到的真实问题（9 个）

1. **`listMonthly` 被自己遮蔽**：重构时把 `const listMonthly = listBase + listAddOns;` 写在 `buildQuote` 里，与导出的同名函数撞在一个作用域链上，`cheapestTier` 的调用一度指向错误的实现。TS 不报错（局部变量合法）。改名为 `listTotal` 后消失。教训：`noUnusedLocals` 之外还应避免与导出符号同名——本轮把它写进了 style-check 的反向断言思路。
2. **明细与合计是两套算法**：最初 `charged` 独立算、`lines` 另算，年付下「折扣是月额还是年额」直接对不上（明细相加 460 vs 合计 4416）。改成：先按 CNY 列出每月各行 → 按周期放大 → 按币种折算取整 → `charged` 由各行相加得出。这样 `sum(lines) === charged` 是结构性成立，再用 480 组合扫描兜住。这是本轮唯一一处「口径缺陷」，也是最有价值的一处。
3. **省额算错**：`saved = convert(currency, listTotal * 12) * 12 - charged`——把已经放大成年的数额又乘了一次 12，得出 68544 这种荒谬值（正确 1224）。断言 `saved === listMonthly*12 - charged` 当场抓到。
4. **两套价格算法并存**：`TierCard` 里曾经抄了一份 `GROVE_SPANS` / `ADD_ON_PRICES` 常量表自己算，与 `pricing.ts` 形成双源。改成卡片也走 `monthlyFor()`（内部就是 `listMonthly`），单一事实源。这是「数据诚信」类缺陷，肉眼看不出来，只有交叉断言能抓。
5. **浏览器多属性合并调用容易 15s 超时**：`getComputedStyle` 一次读 5-8 个属性、或读 `backgroundImage` 这类超长字符串时会超时，但页面侧其实已执行；拆成 1-3 个属性的短调用后稳定成功（本轮重试 4 次才补齐 chrome 的探针）。台账里那条「断言写成同步」的经验要再加一句：**同步也要短**。
6. **jsdom 里没有 rAF 调度**：第一版 `tick()` 用 `requestAnimationFrame` 递归，在 Node 下退化成同步调用，React 19 的调度器排在宏任务上，于是 `root` 还没渲染就断言，报了 39 条假失败。改成 `await new Promise(r => setTimeout(r, 15))` 并额外加 `load(win)`（轮询到 `.tier` 数量 = 3 才算挂载完成）后，真失败只剩 6 条，全是断言自身写错。
7. **断言写的是「我以为的文案」而不是页面文案**：`'切到年付最多省 25%'` vs 源码里的 `'年付可省最多 25%'`、`折合每月 ¥197` vs 实际 `¥226`、以及持久化断言忘了「换到苗木档会把已勾选模块剪掉」这条自己实现的行为。三条都属于测试期望值需要按实现口径重算，最终把金额类断言全部改成读 `data-charged` / `data-amount`，不再从拼接文案里抠数字（`num()` 会把「¥2,707」和「¥226」粘成 `2707226677`）。
8. **把字符数当字节数写进日志与报告**（收尾阶段发现）：`inline.mjs` 打印 `(html.length/1024).toFixed(1)+'KB'`，`html.length` 是 UTF-16 码元数，中文一页就差 2% 以上——脚本自报 264.9KB，`ls` 实测 276,091 字节（269.6KiB）。报告照抄了脚本数字，于是三页尺寸与 bundle 字节数全部偏小。改成 `Buffer.byteLength` 后重跑，同时给 §4 的那个 bundle 数字补了断言兜底。**凡是会进文档的数字，必须由断言打印，不能由打印顺带写进文档。**
9. **切片偏移把 `<script>` 标签一起切进来**：`style-check` 提取内联脚本用 `indexOf('\n<script>') + 2`，`+2` 落在 `'s'` 上，于是取到的是 `script>…`（多 7 字符、少 1 尾部换行）。三页互比仍然相等（同一偏移），所以旧断言全绿却给了错的字节数——只有当我要拿它和 dist 对账时才暴露。改成 `/^<script>([\s\S]*?)<\/script>/m` 取捕获组，并把「内联 = dist + 转义字节」写成显式不变式。同类错误的隐蔽性在于：**偏移量错一位不影响一致性比对，只影响绝对量。**

## 8. 两个 skill 叠加的结论：互补，但边界要说清

- **没有条款互斥**。上一轮解掉的冲突（`js-early-exit` 允许早退 vs `frontend-development` 禁早期 return）本轮直接沿用既定规则：控制流允许早退，渲染输出一律三元 + 显式空态。两个 skill 各自都没意见。
- **真正互补的部分**：sites-building 提供了 vercel 完全缺失的两样东西——首屏该放什么（决策面 → 算价台上首屏）、以及「一页一主张」的视觉论题（三套主题的差异是主张差异，不是配色差异）。反过来 vercel 提供了 sites-building 只说「run the existing build and inspect output」时答不出来的东西：怎么证明 252KB 的包里没有 3KB 是不必要的首包负担（split 构建 + chunk 字符串断言）。
- **重叠处的取舍**：sites-building 明确「不要为额外打磨追加校验/资产」，而 vercel 的 bundle-preload 需要新增一个 hover 钩子。按 sites-building 的口径判定：预加载的是**用户已经明确可见的下一步动作**（合计条上的「查看报价单」），属于主流程而非 speculative polish，保留。
- **建议配方**：设计主张型（sites-building）定「首屏放什么 / 长什么样 / 文案怎么说」，性能规范型（vercel）定「代码怎么切、状态放哪、监听怎么挂」。单独用哪个都会缺一条腿：只有前者会得到一个大而全但不省事的包，只有后者会做出没有视觉主张的页面（第 4 轮的判断，本轮再次成立）。

## 9. 断言与验证清单（合计 398 条，全绿）

| 脚本 | 条数 | 覆盖 |
| --- | --- | --- |
| `pricing-check.mjs` | 85 | 阶梯边界（1/5/6/20/21/50/51/100）、逐席累加 vs 区间乘加互查、席位钳制、模块计价、480 组合的四条不变式（行和=合计 / 月付 charged=monthlyTotal / 年付省额式 / 金额单调不减）、币种取整规则、展示串、价目表配置自洽 |
| `jsdom-check.mjs` | 231（77 × 3 页） | 三页各跑一遍：挂载与零报错、周期/币种/席位/模块/换档全链路、报价单展开与行和、邮箱三路校验与寄出态、打印调用、对比表三重筛选与空态、FAQ 搜索与手风琴、window 监听次数与 once/passive、localStorage 内容与体积、跨页恢复、旧 schema 与坏 JSON 回落 |
| `style-check.mjs` | 82 | 三页 `<script>` 逐字节一致、内联 bundle 与 dist 的字节不变式（报告数字的来源）、挂载调用、零外链（src/href/url/@import/link）、三页 title 互异、`data-theme` 正确、**base.css 拼在主题层之前**（第 5 轮的级联回归）、四个 CSS 文件在 `:root` 之外零硬编码色、主题覆盖 15 个结构令牌、三主题在 ≥4 个视觉维度互异、split chunk 边界与「首包外 < 5%」、无 barrel/无 `.sort(`/无 `&& <`/无 `new RegExp(`/localStorage 单点/监听对称、28 条规则落地证据 |

浏览器侧另有 §1 表格里的 9 个计算样式探针。未验项（诚实记录）：横向溢出测不了（面板 hidden 使 `innerWidth=0`）；三档价格的字体族/字距差异与 `background-clip:text` 的铬合金效果没有取到 computed 值（多属性调用超时后放弃，源码层已由 style-check 断言）；pointermove 驱动的 `--px/--py` 只在 jsdom 里验，真浏览器 hidden 时 rAF 不触发。

## 10. 结论：两个 skill 都留用

- `vercel-react-best-practices`：第 3 次通过（第 1 次管理后台、第 2 次落地页、本轮定价页）。它在「内容型无取数页面」上能落地的上限已经量清楚了——**57 条里 28 条**，且集中在 bundle/client/rerender/rendering/js/advanced 五档；async 与 server 两档 13 条在此类场景永远为 0。它的价值仍然在「逐条回查」：本轮 9 个真实缺陷里有 3 个（价格双源、明细/合计两套算法、speculative 预加载的取舍）是靠回查规则触发的，通读发现不了。
- `sites:sites-building`：第 3 次通过，仍然只有它提供「视觉论题先行 + 工作面/叙事面判断 + 文案不许充数」这条线。本轮第一次把它当成**验证范围的约束**来用（§8 的 preload 取舍判定），比前两轮的纯设计用途更进一步。
- 组合判定：**留用这套配方**（设计主张型定形 + 性能规范型定码）。下轮如果继续用 vercel-react-best-practices，应当换到能推进 async-*/server-* 的场景（Next.js + 真实取数），否则剩余可验证条目会开始重复。
