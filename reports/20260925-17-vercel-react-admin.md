# 2026-09-25 17:00 · vercel-react-best-practices × 管理后台

- **Skill**：`vercel-react-best-practices`（Vercel 官方 React/Next.js 性能规范，57 条规则 / 8 个优先级类别）
- **本机路径**：`/Users/apple/.qoder-cn/skills/vercel-react-best-practices/SKILL.md`（用户 2026-09-25 15 时段装入，非内置、非本轮安装）
- **上游来源**：https://github.com/vercel-labs/agent-skills （`vercel-react-best-practices`）；规则前缀索引见 SKILL.md 表格
- **场景**：管理后台 —— 虚构产品「Beacon 信标」短链服务的运营后台，四个分区：总览（4 KPI + 14 日趋势 + Top5 + 事件流）/ 短链管理（60 行表格 + 搜索 + 状态筛选 + 三向排序 + 行展开 + 停用切换 + 两步删除）/ API 密钥（脱敏显示 + 明文切换 + 复制 + 吊销）/ 服务设置（表单校验 + 脏值标记 + localStorage 持久化）
- **技术栈**：React 19.3 + Vite 7.3.6 + TS 5.9.3（strict + noUncheckedIndexedAccess + noUnusedLocals）+ vite-plugin-singlefile 2.3.3

## 三种风格

同一份 IIFE bundle（三页 **243,433 字节逐字节相同**）只换 CSS：结构层 `base.css` 全走 CSS 变量，主题层只改变量与少量同特异性覆盖。

| 风格 | 主张 | 关键变量（实测 getComputedStyle + CSSOM 断言） |
| --- | --- | --- |
| `business` 商务白 | 浅色企业风：深藏青侧栏 + 白面板 + 蓝强调，圆角 6px，KPI 标签大写 | bg `#eef1f6` / accent `#2563eb` / radius 6px / kpi 26px / Segoe UI+PingFang SC / caps uppercase |
| `mono` 单色暗 | 零彩色终端感：全站等宽字体、**直角 radius 0**、字距 0.14–0.16em、状态只靠字重与符号 | bg `#0d0d0d` / accent `#e8e8e8`（=前景色，无彩色）/ kpi 30px / ui-monospace / 顶栏 lowercase / spark opacity 0.75 |
| `win95` 95 桌面 | 复古系统风：灰底 + **斜角凹凸边框双套色**（面板凸起、输入框凹陷）+ 蓝渐变标题条 + 淡黄气泡提示 | bg `#c0c0c0` / accent `#000080` / radius 0 / kpi 22px / Tahoma / caps **none** / 面板 border 上左 `#fff`、下右 `#404040` + box-shadow `#808080`，`.btn:active` 内外色翻转 |

三主题 bg / accent / font / radius / kpi 字号 / 字距 / toast 底色 **全部互不相同**（`scripts/style-check.mjs` 24 条断言）。

## 产物

```
artifacts/20260925-17-vercel-react-best-practices-admin/   合计 980KB
├── index.html                     三风格对照入口（相对链接，file:// 可直接跳转）
├── preview/admin-{business,mono,win95}.html   248KB × 3，双击即用、零外链
├── src/                            92KB 源码（App + 4 sections + shared + dataset + storage + 4 CSS）
├── scripts/{inline,jsdom-check,style-check}.mjs + verify.sh   校验与重建脚本
├── package.json / tsconfig.json / vite.config.ts / .npmrc / package-lock.json
```

## 从零重建

```bash
cd artifacts/20260925-17-vercel-react-best-practices-admin
bash scripts/verify.sh        # 33s：npm install → tsc --noEmit → vite build → inline → 39×3 + 24 断言
```

已实测：删掉 `node_modules` 与 `dist` 后从零跑 `verify.sh` 全绿。`.npmrc` 固定 `registry.npmmirror.com`（官方 registry 与 GitHub 在本机不可达）。

三步手动重建：`vite build`（lib-IIFE，`fileName: () => 'beacon.js'`，`inlineDynamicImports: true`）→ `node scripts/inline.mjs`（读 `dist/beacon.js` + `base.css` + `theme-*.css`，每页拼成单个 `<style>` 与两个 `<script>`：bundle 与 `BeaconAdmin.mount(document.getElementById('root'))`）→ 直接双击 `preview/*.html`。

## 应用的规则（可核对到文件）

| 规则 | 落点 |
| --- | --- |
| `js-index-maps` | `Links.tsx` ownerCounts：Map 替代每行 O(n) 查找 |
| `js-combine-iterations` | `Links.tsx` visible：一次循环完成状态筛选 + 关键词匹配，不链式 filter |
| `js-tosorted-immutable` | 排序用 `toSorted`，不改 `state.rows` 原数组 |
| `js-min-max-loop` | `Sparkline`/`BarChart14`/`buildDataset` 求极值用遍历不用 sort |
| `js-hoist-regexp` / `rendering-hoist-jsx` | `format.ts` 的 `Intl.NumberFormat` 模块级；`shared.tsx` 的 `NAV_ITEMS`/`ICON_PATHS`/`THEME_META` 常量提到模块级 |
| `client-localstorage-schema` + `js-cache-storage` | `storage.ts`：键带 `.v1` 版本号，`readOnce()` 只读一次并缓存，file:// 抛错时静默降级为内存态 |
| `rerender-functional-setstate` | `linksReducer`/`keysReducer` + `useCallback` 的 `pushToast`，回调不闭包读旧 state |
| `rerender-transitions` | `useDeferredValue` 做搜索降级渲染，工具栏出现「正在过滤…」stale 提示 |
| `rerender-memo` / `rerender-dependencies` | `visible`/`top5`/`ownerCounts`/`unused` 全 useMemo，依赖只给原始值 |
| `rerender-lazy-state-init` | `useState(() => loadSettings())`、脏值快照 `useState(() => ({ ...form }))` |
| `rendering-conditional-render` | 全站三元而非 `&&`（`{pending !== 0 ? … : null}`） |
| `advanced-event-handler-refs` | `useTwoStep` 用 `confirmRef` 持有最新 `onConfirm`，避免定时器捕获陈旧闭包 |
| `bundle-barrel-imports` | 无 barrel，全部深路径 import |
| `rendering-hydration-no-flicker` | 主题由构建期写进 `<html data-theme>`，无客户端切类导致的闪烁 |

**不适用**（须诚实标注，否则等于假装遵守）：`async-*`、`server-*`、`client-swr-dedup` 全部依赖 Next.js / API 路由 / SWR，本轮是纯静态单文件产物；`bundle-dynamic-imports` 的 `next/dynamic` 同理。

## 遇到的问题与修复

1. **页面静默空白，`typeof BeaconAdmin === 'undefined'`，控制台零报错。**
   根因：Vite `build.lib` 的 IIFE 产物**不会自动注入 `process.env.NODE_ENV` 替换**（该 define 只在普通 browser build 生效），React/react-dom 是 CJS 双构建产物，676KB bundle 里留着 dev/prod 两个分支和裸 `process` 引用，浏览器顶层 `ReferenceError: process is not defined` 直接让 IIFE 失败。
   修法：`vite.config.ts` 加 `define: { 'process.env.NODE_ENV': '"production"' }`。副产品：**bundle 676KB → 245KB（gzip 206KB → 78KB）**，三页 744KB。
   定位手段：`node -e "vm.runInContext(script)"` 用桩 DOM 跑内联脚本，第一次报错 `process is not defined`——浏览器看不出来。
2. **第一版预览全白**：`inline.mjs` 模板只贴了 bundle，漏掉 `BeaconAdmin.mount(...)` 调用（lib-IIFE 只定义全局，不会自挂载）。补第二个 `<script>`。
3. **CSS 级联顺序错**（真实缺陷，只有浏览器计算样式暴露）：`inline.mjs` 把主题 CSS 放在 `base.css` 之前，`.kpi`/`.avatar` 等同特异性规则被 base 反向覆盖——mono 的 `radius:0`、2px 左边框、win95 的整套斜角边框**全部失效**（实测 `borderTopLeftRadius: 50%`、`border-left 1px`）。改为 base 在前、theme 在后，并在 `style-check.mjs` 加「拼接顺序」回归断言（三页各一条）。
4. **违反 skill 自身精神的写法**：`useTwoStep` 最初把 `setTimeout` 和 `onConfirm()` 写进 `setPending((cur) => …)` 里。state updater 必须是纯函数（React 可能重复调用），副作用移到事件处理器 + `confirmRef`，并用 `data-pending` 属性把状态变成可断言的 DOM 事实。
5. **误判过程（重要环境教训）**：修完 4 之后在 browser-use 里点删除仍看不到变化，一度以为 React 没提交。实际是**IDE 内置浏览器面板 hidden（`document.visibilityState === 'hidden'`、`innerWidth === 0`）时，evaluate_script 里 dispatchEvent 触发的 React 更新不会 flush 到 DOM**，而且 `take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`。同一份产物在 jsdom（`pretendToBeVisual: true`）里 39 条交互断言全通过——**结论：本轮起，交互验证一律走 jsdom，浏览器只做计算样式复核。**
6. TS 严格模式暴露的 3 个真错：`lib: ES2022` 不支持 `toSorted`（改 ES2023）；React 19 下 `StrictMode` 不能从 `react-dom/client` 导入（只能从 `react`）；`THEME_META[THEME]` 索引访问在 `noUncheckedIndexedAccess` 下可能 undefined。
7. **Skill 包本身不完整**：SKILL.md 让人「读 `rules/async-parallel.md` 等单条规则」并引用 `AGENTS.md` 全文，但本机安装目录**只有 SKILL.md 一个文件**，`rules/` 与 `AGENTS.md` 均不存在 → 57 条规则只有一行摘要可用，例证代码与反例无从查。
8. **与 frontend-development 直接冲突**（跨 skill 组合的关键发现）：上轮 `frontend-development` 明令「避免早期 return，用单一返回点」，本轮 `js-early-exit` 明令「尽早 return」。同一份代码不可能同时满足。本轮按 vercel（性能规范主场）处理，`linksReducer` 与过滤循环均用 early return。**结论：两个规范型 skill 叠加前必须先解冲突，不能让 agent 自行择一。**

## 结论：留用（第 1 次通过）

- 该 skill 是**可判定**的：57 条里有 13 条能在纯 React+Vite 静态产物上直接落地并被代码核对，其余绑定 Next.js/RSC/SWR，须在报告里显式标注不适用而非静默忽略——这是它比 `frontend-development` 更工程化的地方（后者约七成条款绑定 MUI/TanStack）。
- 它是**纯性能规范、零视觉主张**：三风格仍完全靠自定 CSS 变量体系，与上轮结论一致，不能单独承担「多风格」任务。
- 校验成本被低估：本轮 4 个缺陷里 2 个（CSS 级联、静默空白）**只有真实浏览器计算样式或 vm 桩执行才能发现**，jsdom 的 `getComputedStyle` 不做样式层叠（实测返回 `rgba(0,0,0,0)`），因此 CSS 只能用 CSSOM 读自定义属性断言。
- 下时段候选：本 skill × 落地页（检验它在内容型页面上是否只剩 `bundle-*` 可用）；或 `vercel-react-best-practices` + `sites:sites-building` 叠加，验证「性能规范 + 设计规范」组合是否互补无冲突。
