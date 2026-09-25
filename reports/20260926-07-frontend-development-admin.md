# 第 18 轮 · frontend-development × 管理后台（2026-09-26 07:00）

> 结论一句话：**留用，但定位必须降格为「规范补充」，不能单独承担多风格页面任务。**
> 358 条断言全绿（check-node 117 / check-dom 174 / check-browser 67），冷启动复现 97 秒；清理后再加 17 条目录形态锁。
> 本轮最大价值不是产出三个后台页面，而是把该技能最可疑的一条绝对化条款（"No Early Returns"）
> 变成了同一份产物上的可测消融：**位移 749px vs 429px = 1.7×，占位 124px vs 444px**——
> 它是「减小 CLS」，不是技能原文暗示的「防止 CLS」。

- 台账：`records/work-log.md` 末行（第 30 行，即第 18 轮）| `state/state.json`（tried 18 / runs 18 / used_styles 54 / environment_notes 108）
- 产物：`artifacts/20260926-07-frontend-development-admin/`（2.38MB，72 个文件，零中间物）
- 三风格：软浮雕 neumorph / 1-bit 系统 bitmap / 监护仪荧光 phosphor

---

## 1. 技能来源与调用方式

| 项 | 实测 |
| --- | --- |
| 安装位置 | `~/.qoder-cn/skills/frontend-development/`（用户 2026-09-25 15 时前后自行装入） |
| 内容 | 只有 `SKILL.md`（1,082 行 / 30,694B）+ `metadata.json`（2,174B） |
| 引用但缺失 | SKILL.md 里点了 10 个 `resources/*.md`（component-patterns / data-fetching / file-organization / loading-and-error-states / performance / routing-guide / styling-guide / typescript-standards / common-patterns / complete-examples），被引用共 32 次，**一个都不存在**；另引用 `../../vite.config.ts`，同样不存在 |
| 调用方式 | 直接 Read 全文 + 按 React 章节（第 73–469 行）执行；本环境该技能也在 Skill 工具可用列表内，两条路径读到的是同一份文本 |
| 技能自述框架面 | React 18+ / Vue 3 / Svelte 5 / Angular 四选一。本轮走 React 分支 |

**这就是「契约无资产」**：技能承诺的详细指南不在包内，能用的只有一行行摘要。A 组断言（22 条）的作用是把「我按技能做了」变成可复跑的检查，而不是文档里的一句话。

## 2. 场景与选题依据（去重证据）

选题不是临时决定，`state.json → next_candidates` 里排着原文：

> `frontend-development × 管理后台（同场景换 skill，与 17:00 那轮正面对照：同一后台谁给的条款更可落地）`

写回前 `tried` 有 17 条、`used_styles` 有 51 个，均不含本组合与这三个风格（I1 / I4b 断言在写回前后都成立）。

**刻意做成受控对照**：直接复刻 17:00 `vercel-react-best-practices` × 管理后台那一轮的事实源与功能面。
`src/lib/dataset.ts` 与上一轮 `src/data/dataset.ts` 由同一 PRNG 生成，E 组 13 条断言用 esbuild 把两份 TS 分别编译成 ESM 后逐字段比对：60 条短链、5 个密钥、8 条事件、14 日趋势序列、`stats` 全部派生值（含 ratio-of-sums 口径）完全相等。
于是「产物字节差」「源码行数差」才是同一功能面在不同技能下的真实差异，而不是两道不同题目的差异。

功能面（四个分区）：

- **总览**：4 个 KPI + 14 日柱状趋势 + Top5 + 事件流
- **短链管理**：搜索（350ms 防抖）+ 状态筛选 + 三种排序 + 行展开 + 暂停/启用 + 两步删除
- **API 密钥**：打码 / 显明文 / 复制 / 吊销
- **服务设置**：React Hook Form + Zod 校验、脏值标记、localStorage 持久化

技术栈：React 19.2 + Vite 7.3.6 + TS 5.9（strict / noUncheckedIndexedAccess / noUnusedLocals / verbatimModuleSyntax）+ MUI v7 + TanStack Query v5 + TanStack Router v1 + react-hook-form 7.88 + zod 3.25.76。依赖走 `registry.npmmirror.com`（`.npmrc`）。

## 3. 产物与预览方式

```
artifacts/20260926-07-frontend-development-admin/
├── index.html                     三风格对照入口（数字全部由断言 JSON 生成，见 §5 步骤 8）
├── preview/admin-{neumorph,bitmap,phosphor}.html   各 ~721KB 单文件，双击即开，零外链
├── src/                           50 个 .ts/.tsx，2,154 行
├── scripts/                       verify.sh + 三个 checker + build-inline + make-styles + round-facts + 台账锁
├── vite.config.ts                 IIFE 单文件构建（inlineDynamicImports）
├── vite.split.config.ts           ES 证据构建（保留真实 chunk 边界）
├── tsconfig.json / package.json / package-lock.json / .npmrc
```

三页 `<script>` 逐字节相同（B6，720,722B），差异只在外壳 `data-fd-style` 属性与注入的令牌层（外壳仅 672–677B）。
每页实测**恰好 1 个网络请求**（D0，真实 Chromium 计数）——「零外链」用请求计数证明，不用字符串扫描（见 §9 缺陷 #7）。

## 4. 三条技能主张的实测兑现情况

| 技能条款 | 落地形态 | 证据 | 判定 |
| --- | --- | --- | --- |
| "Use `useSuspenseQuery` as the primary data pattern" | 3 个查询 hook + `RouteGate` 包每个路由 | F2：3 个 `/links` 消费者只发 1 次请求（single-flight）；D0：每页 1 个请求 | **兑现**，但见缺陷 #5（骨架边界） |
| "No early returns for loading" | 产品代码零早退（A10），早退形态只存在于 `?control=early` 消融装置（A11） | G 组：位移 429px（骨架）vs 749px（早退）=1.7×；加载期占位 444px vs 124px；主区高 360px vs 224px | **部分成立**：措辞应读作「减小 CLS」，不是「防止」 |
| "Lazy load heavy components below the fold" | `React.lazy` 6 处（A12） | L 组：证据构建里 Overview/Links/Keys/Settings 四个分区 chunk 真实分离，入口 `main.js` 不含只属于懒块的界面文案（L2），路由级可延迟 29.0%（L3b），两构建总量差 <1%（L5） | **需要两个构建才可判**：单文件预览把懒块并回首包（L4），条款在单产物形态下不可证伪 |
| "React Hook Form with Zod validation" | `zodResolver` + `valueAsNumber` | H7 + 校验预言机（node 侧 schema 与渲染出的 helperText 逐字段相等）；K1 真点击提交写入 `pageSize=24` | 兑现 |
| "Import aliases (@/ ~types ~components ~features)" | 四别名实际使用 27/25/4/6 次，零三层以上相对回溯（A5） | A4/A5 | 兑现 |
| "MUI v7 Grid `size={{xs,sm,lg}}`" | 6 处新语法，0 处旧写法 | A7 | 兑现（技能正文未提 v7 破坏性变更，靠实测） |
| 未兑现/不适用 | Vue/Svelte/Angular 三章（本场景无关）；`resources/*` 全部无法执行 | A22：五段目录结构 settings 只有 3/5（无服务端查询、类型住在 `~types`） | 诚实标注 |

**跨 skill 成本对照（同一功能面、同一事实源）**

| 指标 | 本轮 frontend-development | 17:00 vercel-react-best-practices | 比 |
| --- | --- | --- | --- |
| 单文件内联 bundle | 720,722 B | 244,725 B（**从上一轮产物现读**，不抄其报告的 243,433） | 2.95× |
| gzip 后 | 223,845 B | — | — |
| src 文件数 / 行数 | 50 / 2,154 | 11 / 1,076 | 4.5× / 2.00× |
| 三页预览合计 | 2,163,587 B | 744,000 B 量级 | — |
| 断言条数 | 358 | 122（39×3 + 风格 24 量级） | — |

多出来的量主要是 MUI + TanStack 运行时。换来的是：零自研组件、真实计算样式可断言、single-flight 与分区级取数由库保证。
**结论不是「谁更好」**：17:00 那轮证明同一后台可以用 1/3 的体积做完；本轮证明技能给的库组合能把「风格是否真的生效」变成 getComputedStyle 层面的硬断言，代价是体积与两条库自带陷阱（emotion 级联、MUI v7 破坏性 API）。

## 5. 复现步骤

一键（冷启动，含 npm install）：

```bash
cd artifacts/20260926-07-frontend-development-admin
bash scripts/verify.sh        # real 97.25s（本机冷启动：npm install 194 包 4s + 两次构建 4.3s/4.1s + 三组 checker）
```

手工九步与各自产出（第 9 步在验证之后、收尾时才跑）：

| 步骤 | 命令 | 产出 / 判据 |
| --- | --- | --- |
| 1 | `npm install --no-audit --no-fund` | 194 个包（npmmirror） |
| 2 | `npx tsc --noEmit` | 零错误（strict + noUncheckedIndexedAccess + verbatimModuleSyntax） |
| 3 | `npx vite build` | `dist/assets/main.js` 720,722B（IIFE，`inlineDynamicImports`） |
| 4 | `npx vite build --config vite.split.config.ts` | `dist-split/assets/` 13 个 chunk（证据构建） |
| 5 | `node scripts/build-inline.mjs` | 三页预览 + `scripts/build-inline-meta.json`（bundleBytes / scriptEscapes / pages） |
| 6 | `node scripts/check-node.mjs` | A22 B30 C20 E13 J11 L6 I5（写回后 I=15）= 117 |
| 7 | `node scripts/check-dom.mjs` | F + H（三页各一遍交互全链路）= 174 |
| 8 | `node scripts/check-browser.mjs` | D G K M = 67；然后 `node scripts/make-styles.mjs` 生成 index.html |
| 9 | 收尾后 `rm -rf node_modules dist dist-split .tmp-check && node scripts/check-clean.mjs` | 17 条目录形态锁（无中间物、无探针残留、三页字节与 meta 一致、50 个源文件在位、≤50MB） |

消融对照怎么亲手看：

```bash
python3 -m http.server 8157      # 在产物目录里
# 骨架版：http://127.0.0.1:8157/preview/admin-neumorph.html
# 早退版：http://127.0.0.1:8157/preview/admin-neumorph.html?control=early
```

`?control=early` 不改一行构建产物，只改渲染路径（`src/lib/ablation.tsx` 的 `CONTROL_EARLY_RETURN`），所以两者差异是纯条款差异。

## 6. 三风格设计与实测

风格不是「换套颜色」，而是各自一条**互斥的分层手法**（D13 实测三页阴影手法集合互斥且含 `none`）：

| 风格 | 主张 | Chromium 计算样式指纹（D3b 现读） | 对比度 正文/次要/涨跌（D4b/D5b/D6b） |
| --- | --- | --- | --- |
| 软浮雕 neumorph | 同底色浮起：双向相反符号阴影塑形、零描边、18px 圆角、低饱和靛蓝强调 | `rgb(233,235,241)` · `rgb(59,66,82)` · r=18px · bw=0px · `…8px 8px 18px` | 8.44:1 · 4.02:1 · 4.76:1 |
| 1-bit 系统 bitmap | 两色位图界面：1px 实线网格、零圆角零阴影、状态靠反白与字符 | `rgb(247,245,239)` · `rgb(18,16,14)` · r=0px · bw=1px · `none` | 17.41:1 · 5.23:1 · 17.41:1 |
| 监护仪荧光 phosphor | 临床遥测屏：近黑青底 + 磷绿荧光 + 琥珀告警、发光描边、扫描线 | `rgb(5,11,14)` · `rgb(217,245,228)` · r=2px · bw=1px · `rgba(157,247,106,.06) 0 0 …` | 17.09:1 · 6.37:1 · 15.03:1 |

配套断言：

- **C 组 20 条**：色板封闭（每个字面量必须来自 token）、派生 alpha（rgba 通道必须映射到已声明 token 或中性黑白）、七维指纹距离 ≥4、五强调色两两不相交、结构代码零十六进制字面量（C4）。
- neumorph 首轮正文对比度只有 3.1:1，为此把 muted/primary/success/warning/danger 五档整体压暗（8.44:1 是修完的实测值）——软浮雕最常见的失败就是「浮雕好看但文字不合格」。
- 每个风格的名字/描述只写在 `src/lib/style/registry.ts` 的 token 对象里，`index.html` 由该模块生成（`make-styles.mjs` 读 `.tmp-check/registry.mjs`），杜绝文档与代码两套说法。

## 7. 断言总览

| 组 | 条数 | 判据 |
| --- | --- | --- |
| A 技能条款符合 | 22 | 静态扫 src：组件签名、五段目录、别名、`useSuspenseQuery`、Grid v7、防抖区间、零早退、memo 有效性、Snackbar 路径、queryKey 常量化、useCallback、strict、无 alert/confirm/prompt |
| B 自包含与三页一致性 | 30 | 三页 script 逐字节相同、= dist 产物、页面字节=脚本+外壳、每页 shell 200–700B、跨轮字节基线 |
| C 三风格主张 | 20 | 见 §6 |
| D 首屏/计算样式/对比度（浏览器） | 3 页 × 若干 | 每页 1 个网络请求、零跨域、三套手法互斥、两两 ≥6/8 属性不同 |
| E 与 17:00 轮事实源一致 | 13 | esbuild 双编译后逐字段 deep-eq；另含数据健全性（active+paused=total、clicks7d=Σseries14[7..]、uptime=均值、apiCalls30d=ΣsparkApi×4、时间戳落在锚定窗口） |
| F single-flight / 无早退 / 无重复 id | jsdom | 无 `[data-gate="early"]`、3 消费者 1 请求、复访不重发、零重复 id、零 React 警告 |
| G 早期返回消融 | 浏览器 | 见 §4 表格第 2 行 |
| H 交互全链路 | 174 的一部分 | 三页各跑一遍：KPI/趋势条/Top5/事件 vs 事实源、搜索防抖窗口、筛选计数、三排序单调、展开/收起、暂停+1 次 POST、两步删除+toast、密钥掩码正则、校验预言机相等、持久化与损坏 JSON 回退 |
| I 台账幂等锁 | 5（写回后 15） | 见 §11 |
| J 磁盘与成本 | 11 | 行数/字节比、gzip、场景目录体积 2.38MB ≤50MB |
| K 真实浏览器补验 | 3 | 真点击提交、剪贴板可用、复制 toast |
| L 懒加载证据构建 | 6 | 见 §4 表格第 3 行（入口字节随构建目录路径长度浮动 ~0.07%：`.tmp` 下 512,421B、产物目录下 512,763B；可延迟比例稳定在 29.0%） |
| M 持久化跨载体 | 12 | 见 §8 |

## 8. 持久化跨载体（M 组，本轮新增的第二块硬证据）

产物宣传「双击即开」= `file://` 载体，而此前所有浏览器断言跑在 `http://`。Chrome 里这是两个 origin，于是分开各测一遍「写入 → reload → 回填」：

| 载体 | 启动时 storage | 保存后 localStorage | reload 后表单 | 暂停态 reload |
| --- | --- | --- | --- | --- |
| `http://127.0.0.1:8157` | 空（0 项） | `{…"pageSize":24,"serviceName":"Beacon 载体探针"}` 逐字段一致 | pageSize=24 / serviceName 回填 / `data-dirty="0"` | 翻转为 active → **reload 后回到 paused** |
| `file://…/preview/admin-neumorph.html` | 空（0 项） | 同上 | 同上 | 同上 |

两条结论都写成了断言而不是文档脚注：

1. **M2/M3**：`file://` 同样能持久化并回填，且回填后 `isDirty=false`（不是把默认值伪装成已保存）。
2. **M5（限制如实记录）**：本轮 `apiClient` 是进程内传输（无后端），链接暂停/删除态**刷新即回到事实源**；只有设置真正落盘。要让它持久需要真后端——这条是场景限制，不是技能缺陷，但如果不写成断言，下一轮没人能复查到我有没有夸大「持久化」。

## 9. 缺陷与修复清单（本轮真实发生顺序）

| # | 症状 | 根因 | 修法 | 现在由谁盯着 |
| --- | --- | --- | --- | --- |
| 1 | 校验脚本读到的 bundle 里没有 `__fdBridge` | `dist/assets/main.js` 早于 `bridge.ts`/`main.tsx`（陈旧产物） | 重跑两套构建 | B7「内联脚本 = dist 产物」+ 断言里查特征字面量 |
| 2 | 冒烟脚本永远超时 | 等的选择器 `[data-fd="appbar"]` 在数据到达前就存在 | 改等 `[data-kpi]` | 探针已转写进 §10 |
| 3 | 首包 512→566kB，SettingsSection 分包被抵消 | 只读校验桥 `bridge.ts` 顺手 import 了 settings 模块，把 zod 拖进入口 | 桥不再 import 业务模块，校验预言机移到 node 侧 | L2（入口不得含懒块专属文案）+ A6 |
| 4 | 「用了 React.memo」但行组件仍整表重渲染 | memo 包在 default 导出上，调用方走具名导入 → 包了个寂寞 | `XImpl` + `export const X = React.memo(XImpl)` | A13 |
| 5 | **骨架整轮从未出现**（本轮最贵的缺陷） | 技能只说「No Early Returns」，没说骨架取决于**最近的 Suspense 边界**；路由里内层 `<Suspense fallback="…">` 静默赢过外层 360px `SuspenseLoader` | 删掉三个路由的内层 Suspense，settings 也用 SuspenseLoader | H1b（显式等 `[data-skeleton]`）+ F 组 + G 组采样 `skeleton:true` |
| 6 | A8/A7 断言被自己的注释和统计口径绊倒 | 注释里含 `'/api'`；`React.FC` 有裸写法 11 处；`<Grid size={{` 实为 6 处 | 断言改查 `'\/api\/'`，阈值按实测写并解释 | A7/A8 |
| 7 | 「零外链」字符串扫描误报 | 打包产物里 emotion/stylis 源码含 `"@import"`，react-dom 含 `fetch(` | 放弃静态扫描，改为真实浏览器**每页请求数=1** | D0 |
| 8 | E8 断言引用了不存在的 `stats.peakDay`；J2 只走了 `src/data`；J8 手抄 gzip 字节 | 期望值靠记忆 | 改读真实字段 + walk 上一轮 `src` 根 + `zlib.gzipSync().length` | E8/E8b–E8d、J2、J8 |
| 9 | jsdom 里点保存按钮没反应 | jsdom 不实现隐式表单提交 | 测试侧对 form 派发 `submit`；真实点击路径交给浏览器 K1 | F/H + K 组分工 |
| 10 | 「无 console error」被 `Not implemented: window.scrollTo` 刷屏 | jsdom 噪音 | `appMsgs()` 过滤噪音只留应用消息 | F 组 |
| 11 | H7e 期望数组写错 | JS 默认按 code-unit 排序，`'serviceName' < 'slowLinkAlert'` | 以 JS 实际排序为准，不按直觉 | H7e |
| 12 | delta 色在 jsdom 通过、真浏览器里渲染成 muted；`--fd-head-size`/`--fd-head-transform` 是死 token | emotion 注入的单类规则与我自研规则同特异性且更晚注入，**级联赢过骨架层**；jsdom 不做级联所以看不出来 | 骨架选择器统一加 `[data-fd-style]` 前缀抬特异性；补 h2 的 token 规则 | D 组全部（只有 Chromium getComputedStyle 能验） |
| 13 | D5 对比度测的是导航当前项（选中态） | 选择器没排激活项 | 改 `[data-active="0"]`，如实报出 4.02:1 | D5b |
| 14 | 表格属性探针全部拿到空值 | 探针跑在导航之前；h2 在别的分区 | 把 th 相关探针挪到列表页导航之后 | D 组 |
| 15 | `page.click('...:last-child')` 点错节点 | CSS `:last-child` 命中的不是导航项 | 改 `locator('[data-fd="nav"] a').nth(3)` | K/M 组 |
| 16 | G6 阈值是我拍脑袋定的 ≤120px | 无依据 | 改成相对量：早退占位 ≤ 骨架占位的一半 | G6 |
| 17 | M 组初版全线超时 | reload 后 hash 还在，等的却是 `[data-kpi]` | 改等路由无关的 `[data-fd="main"]` | M1 |
| 18 | 断言 JSON 没落盘（dump 挂不上） | 替换目标写成 `summary('node')`，实际是 `summary('check-node')` | 逐个 label 对齐 + browser 侧补 `.tmp-check` | `_harness.dumpResults` |
| 19 | `@mui/icons-material` 装不上 | 与 MUI v7 peer 冲突（ERESOLVE） | 本场景改字符图标，不放依赖 | 见 §12 候选 |
| 20 | `createFileRoute` 直接卡住 | 技能只演示需要 codegen 插件的写法 | 手写 `createRootRoute/createRoute/createHashHistory` | A 组未强制（技能该条款本身不可照抄，已在环境笔记记录） |

## 10. 探针与临时脚本转写（这些文件已随收尾删除）

以下四个（组）脚本在验证完成后删除，按台账约定把内容抄进本文档，保证「零上下文的下一次运行」能复原当时看到的东西。
其中 `probe-persistence.mjs` 的结论已升格为 `check-browser.mjs` 的 M 组（不再依赖本文档）；`smoke.mjs` 与三个 `.dbg` 是纯排障探针，未被断言取代，因此全文照录。

### 10.1 `scripts/smoke.mjs`（45 行，首个冒烟探针：产物是否真的挂载起来）

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? 'preview/admin-neumorph.html';
const html = readFileSync(path.join(root, file), 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/#/',
  beforeParse(win) {
    win.addEventListener('error', (e) => errors.push(String(e.message)));
  },
});
const win = dom.window;

async function waitFor(fn, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    try { if (fn()) return true; } catch { /* not ready */ }
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const ok = await waitFor(() => win.document.querySelector('[data-kpi]'));
console.log('mounted:', ok);
console.log('errors:', errors.slice(0, 6));
const bridge = win.__fdBridge;
console.log('bridge:', bridge ? Object.keys(bridge) : null);
console.log('navlinks:', [...win.document.querySelectorAll('[data-fd="nav"] a')].map((a) => `${a.getAttribute('href')}|${a.dataset.active}`).join(' '));
console.log('kpi:', JSON.stringify(win.document.querySelector('[data-kpi]')?.dataset ?? null), win.document.querySelectorAll('[data-kpi]').length);
console.log('bars:', win.document.querySelectorAll('[data-day]').length);
console.log('toplist:', win.document.querySelectorAll('[data-panel]').length);
console.log('events:', win.document.querySelectorAll('[data-event-kind]').length);
console.log('foot:', win.document.querySelector('[data-fd="crumb"]')?.textContent);
console.log('requestLog:', JSON.stringify(bridge?.requestLog?.() ?? null));
if (!ok) {
  console.log('BODY:', win.document.body.innerHTML.slice(0, 600));
}
dom.window.close();
```

它抓到的就是缺陷 #1（陈旧 bundle：`bridge: null`）与 #2（等待选择器错误导致 `mounted: false` 而页面其实正常）。

### 10.2 `.dbg.mjs`（39 行，验证「损坏 localStorage + 非法值」下的表单行为）

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
const ROOT = process.cwd();
const html = readFileSync(path.join(ROOT, 'preview/admin-neumorph.html'), 'utf8');
const msgs = [];
const vc = new VirtualConsole();
for (const ev of ['jsdomError','error','warn','log']) vc.on(ev, (m) => msgs.push(`${ev}: ${m && m.message ? m.message : String(m)}`.slice(0,200)));
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://beacon.test/', virtualConsole: vc,
  beforeParse(win){ win.localStorage.setItem('beacon.admin.settings.v1','{"pageSize":"lots","serviceName":42'); } });
const win = dom.window, doc = win.document;
const wait=(fn,ms=6000)=>new Promise(res=>{const t0=Date.now();const tick=()=>{let r=false;try{r=fn()===true}catch{};if(r)res(true);else if(Date.now()-t0>ms)res(false);else setTimeout(tick,15)};tick()});
const at=(s)=>doc.querySelector(s);
await wait(()=>at('[data-kpi]')!==null);
win.location.hash='#/settings';
await wait(()=>at('[data-fd="save"]')!==null);
console.log('corruptPageSize=', at('[data-field="pageSize"]').value);
const helper=(n)=>at(`[data-field="${n}"]`).closest('.MuiFormControl-root').querySelector('.MuiFormHelperText-root');
console.log('helpers:', ['serviceName','defaultDomain','pageSize'].map(n=>(helper(n)?.textContent ?? '∅')).join(' | '));
const type=(el,v)=>{const s=Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new win.Event('input',{bubbles:true}));};
type(at('[data-field="serviceName"]'),'');
type(at('[data-field="defaultDomain"]'),'NOT A DOMAIN');
type(at('[data-field="pageSize"]'),'99');
at('[data-fd="save"]').dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
await new Promise(r=>setTimeout(r,400));
console.log('after submit helpers:', ['serviceName','defaultDomain','pageSize'].map(n=>(helper(n)?.textContent ?? '∅')).join(' | '));
console.log('storage=', win.localStorage.getItem('beacon.admin.settings.v1'));
console.log('formPresent=', at('form')?.tagName, at('[role="form"]')?.tagName ?? '∅');
const form = at('[data-fd="save"]').closest('form');
console.log('closestForm=', form?.tagName ?? '∅');
form?.dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
await new Promise(r=>setTimeout(r,400));
console.log('after submit event helpers:', ['serviceName','defaultDomain','pageSize'].map(n=>(helper(n)?.textContent ?? '∅')).join(' | '));
console.log('storage2=', win.localStorage.getItem('beacon.admin.settings.v1'));
console.log('dirty=', at('[data-fd="dirty-flag"]').getAttribute('data-dirty'));
console.log('msgs=', JSON.stringify(msgs.slice(0,8)));
dom.window.close();
```

两个产出：损坏 JSON 下表单回退到默认值（H7f 的前身）；`click` 提交在 jsdom 里不触发 `submit`（缺陷 #9 的确证）。

### 10.3 `.dbg2.mjs`（23 行，确认落盘 JSON 的键集合与 `pageSize` 类型）

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const ROOT = process.cwd();
const html = readFileSync(path.join(ROOT, 'preview/admin-neumorph.html'), 'utf8');
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://beacon.test/' });
const win = dom.window, doc = win.document;
const at=(s)=>doc.querySelector(s);
const wait=(fn,ms=6000)=>new Promise(res=>{const t0=Date.now();const tick=()=>{let r=false;try{r=fn()===true}catch{};if(r)res(true);else if(Date.now()-t0>ms)res(false);else setTimeout(tick,15)};tick()});
await wait(()=>at('[data-kpi]')!==null);
win.location.hash='#/settings';
await wait(()=>at('[data-fd="save"]')!==null);
const type=(el,v)=>{Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new win.Event('input',{bubbles:true}));};
type(at('[data-field="pageSize"]'),'20');
at('[data-fd="save"]').closest('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
await wait(()=>win.localStorage.getItem('beacon.admin.settings.v1')!==null,2500);
const saved = JSON.parse(win.localStorage.getItem('beacon.admin.settings.v1') ?? '{}');
console.log('keys', JSON.stringify(Object.keys(saved).sort()));
console.log('pageSize type', typeof saved.pageSize, saved.pageSize);
console.log('deepEq', JSON.stringify(Object.keys(saved).sort()) === JSON.stringify(['defaultDomain','pageSize','slowLinkAlert','serviceName','weeklyDigest']));
dom.window.close();
```

产出：`valueAsNumber` 确实把 `pageSize` 落成 number（不是 `"20"`），键集合与 `Settings` 类型逐字段相同——这是 H7c/H7d 断言的原始依据。

### 10.4 `.dbg3.mjs`（35 行，非法 → 合法 两次提交的完整链路）

```js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const ROOT = process.cwd();
const html = readFileSync(path.join(ROOT, 'preview/admin-neumorph.html'), 'utf8');
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://beacon.test/' });
const win = dom.window, doc = win.document;
const at=(s)=>doc.querySelector(s);
const wait=(fn,ms=6000)=>new Promise(res=>{const t0=Date.now();const tick=()=>{let r=false;try{r=fn()===true}catch{};if(r)res(true);else if(Date.now()-t0>ms)res(false);else setTimeout(tick,15)};tick()});
await wait(()=>at('[data-kpi]')!==null);
win.location.hash='#/settings';
await wait(()=>at('[data-fd="save"]')!==null);
const type=(el,v)=>{Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new win.Event('input',{bubbles:true}));};
const sub=()=>at('[data-fd="save"]').closest('form').dispatchEvent(new win.Event('submit',{bubbles:true,cancelable:true}));
type(at('[data-field="serviceName"]'),'');
type(at('[data-field="defaultDomain"]'),'NOT A DOMAIN');
type(at('[data-field="pageSize"]'),'99');
sub();
await wait(()=>at('[data-field="serviceName"]').closest('.MuiFormControl-root').querySelector('.MuiFormHelperText-root').textContent.startsWith('服务名称不能为空'),2500);
console.log('storage after invalid:', win.localStorage.getItem('beacon.admin.settings.v1'));
type(at('[data-field="serviceName"]'),'Beacon 信标短链');
type(at('[data-field="defaultDomain"]'),'bcn.example');
type(at('[data-field="pageSize"]'),'20');
sub();
const wrote = await wait(()=>win.localStorage.getItem('beacon.admin.settings.v1')!==null,2500);
console.log('wrote?',wrote);
const raw = win.localStorage.getItem('beacon.admin.settings.v1');
console.log('raw:', raw);
const saved = JSON.parse(raw ?? '{}');
console.log('keys sorted:', JSON.stringify(Object.keys(saved).sort()));
console.log('pageSize:', typeof saved.pageSize, saved.pageSize);
console.log('dirty:', at('[data-fd="dirty-flag"]').getAttribute('data-dirty'));
dom.window.close();
```

产出（决定性）：非法提交时 `storage after invalid: null`——**校验发生在写盘之前**，这条后来固定为 H7 的「先校验后落盘」断言。

### 10.5 `scripts/probe-persistence.mjs`（116 行）→ 已升格为 M 组

探针结构：`node:http` 起本机服务（带 `file.startsWith(ROOT)` 越界防护）→ 同一 Chromium 分别打开 `http://127.0.0.1:8158/preview/admin-neumorph.html` 与 `file://…/preview/admin-neumorph.html` → 每边跑「读初始 storage → 设置页填 24/改名 → 点保存 → 读 localStorage → reload → 读回填 → 列表页点暂停 → 再 reload → 读状态」。
原始输出（两次载体逐字段相同，只有关键差异在最后一项）：

```json
[{ "label": "http://127.0.0.1", "storageBefore": {"ok": true, "len": 0},
   "stored": "{\"serviceName\":\"Beacon 探针站\",...,\"pageSize\":24}", "toast": "设置已保存",
   "afterReload": {"pageSize": "24", "serviceName": "Beacon 探针站", "dirty": "0"},
   "rowsAfterReload": "服务端共 60 条，当前视图 60 条",
   "statusBefore": "paused", "statusAfterToggle": "active", "statusAfterReload": "paused" },
 { "label": "file://", "storageBefore": {"ok": true, "len": 0}, "…": "与 http 侧逐字段相同" }]
```

## 11. 台账与幂等锁（I 组）

写回是**一次性脚本**（`scripts/ledger-apply.mjs`，随产物保留）：它只吃 `scripts/round-facts.mjs` 的导出，写回前必须先有 `scripts/ledger-snapshot.mjs` 生成的快照，且检测到本轮已在 `tried` 里就直接退出。读侧的锁是 check-node 的 I 组：

- 写回前（5 条）：`tried` 至多出现 1 次；四个长数组的历史前缀 SHA 未变；台账七个键与快照逐项相等；work-log 行数 = 快照行数。
- 写回后（15 条）：`tried` 末条 deep-eq `round-facts.TRIED`；`runs` 末条字段一致；`used_styles` = 快照 + 恰好 3 个且全表无重复；`environment_notes` = 快照 + 12 条无重复；work-log 行数 29→30、**前 29 行 SHA 未变**、末行逐字节等于 `WORK_LOG_LINE` 且切出 6 段；末行写到的产物目录与本报告文件真实存在；预览目录只含 3 个 HTML。产物目录的「无中间物」形态改由 `scripts/check-clean.mjs`（17 条）在删掉构建目录之后单独把关——它与本文档 §5 的验证步骤互斥（跑验证时 `dist/` 必须存在），放在同一组里只会自相矛盾。

因此「台账被写两次」「只写了一半」「work-log 被改写历史」三类事故都会在断言层暴露，而不是靠下次运行的人凭印象发现。

## 12. 判定与后续候选

**判定：留用（规范补充型），不单独承担多风格任务。**

- 它给的是可核对的写法约束（别名、目录五段、`useSuspenseQuery`、零早退、Snackbar/Hook 字面路径、Grid v7），A 组 22 条全部可复跑；
- 但它不含任何视觉主张，且「契约无资产」使得 32 处引用无法执行；约七成条款绑定 MUI/TanStack/React，换栈即失效；
- 绝对化措辞需要外部装置才能判：本轮的 `?control=early` 消融与 split 证据构建都是技能本身不提供的。

给后续轮次的候选（不扩大本轮范围，只排队）：

1. ★ 把「同产物消融」配方移植回 16:00 的 Vue 分支与历史 frontend-development 产物：技能里其余绝对化条款（如「memo 化行组件」「queryKey 常量化带来稳定引用」）同样只有做成对照组才可判。
2. ★ frontend-development × 表单密集场景（向导/多步校验）：本轮只有 3 字段设置表单，`reset` 清 dirty 这类 RHF 陷阱是意外撞上的，值得正面测一轮。
3. 用 M 组口径横检历轮「持久化」主张的产物（06:00 活动页 prefs、20:00 报名页票根）：它们大概率同样只在 http:// 载体上验过，`file://` 未测。
4. frontend-development + vercel-react-best-practices 叠加（同场景）：先解 `js-early-exit` vs「禁早期 return」冲突（18:00 已定规则：控制流可早退，渲染输出一律三元 + 显式空态），再用本轮的 `RouteGate` 消融装置验证解法是否真无冲突。

## 13. 收尾与推送

- 清理：删 `node_modules`（166MB）、`dist`、`dist-split`、`.tmp-check`、四个日志、三个 `.dbg` 探针、`smoke.mjs`、`probe-persistence.mjs`（内容全部在 §10）；`.tmp/fd-admin` 整目录随后删除。
- 场景目录：73 个文件、字节合计 2,501,085B = 2.39MB（check-clean C5 现算；工作目录口径 J9 = 2.38MB，差的是本轮多出的日志与探针被删掉），远低于 50MB 上限；目录内零 `node_modules`、零 `dist`、零 `.tmp-check`、零探针残留。
- 端口：8157 / 8158 由脚本内 `server.close()` 释放，收尾后按 PID 核对命令行确认无残留监听。
- 写入范围：只有 `前端skill实验室/` 下的 `artifacts/`、`reports/`、`records/`、`state/` 与本目录的 `.tmp/`；技能目录 `~/.qoder-cn/skills/frontend-development/` 只读未改。
- 推送：`git@github.com:sunc-Q/frontend-skill.git` main 分支（本机 github.com HTTPS 会被 TLS 层重置，只走 SSH），known_hosts 写在 `前端skill实验室/.tmp/known_hosts`；提交使用 `git -c user.name=… -c user.email=…` 内联身份，未改动任何全局 git 配置；命令与文件内容零 token/密钥。
- 推送结果：<PUSH_RESULT>
