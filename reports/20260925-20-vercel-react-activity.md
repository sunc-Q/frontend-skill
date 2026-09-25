# 验证记录 · 2026-09-25 20 时段

| 项 | 值 |
|---|---|
| Skill | `vercel-react-best-practices`（~/.qoder-cn/skills/ 用户自装，上游 vercel-labs/agent-skills；第 4 次使用） |
| Skill 位置 | `/Users/apple/.qoder-cn/skills/vercel-react-best-practices/SKILL.md` |
| 场景 | **活动营销/报名页**（虚构「星屿·声浪岛音乐节」：hero 倒计时+3 KPI+开票进度 / 12 艺人阵容（投票+双排序）/ 25 场日程（分舞台+公告延后取）/ 报名表单（三档票+VIP 分支校验+乐观更新+回滚）/ 纪念票根 SVG（点击才加载）；React 19 + Vite 7.3.6 + TS 5.9 strict+noUncheckedIndexedAccess + 零依赖 node:http mock API + jsdom） |
| 三种风格 | 装饰艺术 deco / 蒸汽波 vapor / 孔版印刷 riso |
| 产物目录 | `artifacts/20260925-20-vercel-react-activity/`（1.0MB） |
| 结论 | **留用（第 4 次通过），本轮是该 skill 关键补全轮**：优先级第 1 档 async-* 5 条从「三轮 0 落地」变 4/5 落地且全部有服务端时序证据；server-* 用零依赖 mock 服务端适配落地 4 条；client-swr-dedup 手写等价物端到端可测。205 条断言全绿（35 时序 + 130 DOM + 40 风格/bundle） |

## 1. 选题依据

`state.json` next_candidates 首项（★）：「vercel-react-best-practices × 需要真实取数的场景（Vite SPA + mock 服务端 + async-* 攻坚）——它的优先级第 1 档 async-* 5 条至今 0 落地，纯静态产物永远验不到；这是该 skill 剩余价值的最大一块」。17:00/18:00 两轮都判 async-*/server-* 不适用，19:00 只补了 bundle-*。本轮正面攻坚：造一个**必须取数**的场景（活动页：阵容/日程/余票/公告都要从接口来）+ 一个**零依赖 mock 服务端**（`server/mock-api.mjs`，node:http，带延迟表与 hrtime 事件日志）。

风格避开台账已用 18 种，选装饰艺术/蒸汽波/孔版印刷三种印刷-亚文化向。

## 2. 方法：让 async-* 从「不可见」变「可断言」

异步优化最大的验证难点是「快」没有证据。本轮把证据拆成三层：

1. **传输层抽象**（`src/lib/api.ts` 的 `Transport` 接口）：同一份组件代码，file:// 双击打开走 `createFixtureTransport()`（带延迟表的本地数据源），http:// 打开走 `createHttpTransport(baseUrl)`。**两条路径共享全部上层逻辑**，所以 fixture 页的 jsdom 行为断言与真 HTTP 的时序断言验证的是同一个代码库。
2. **资源层**：`Resource<T> = {key, promise, data, error, subscribe, patch, settle, invalidate}` + `loadResource` 键注册表 + `useSyncExternalStore` hook + throw-promise-for-Suspense。这是 client-swr-dedup 的手写等价物，也让「3 个消费者 1 次到达」「hero 与报名共享 /api/summary」可数（transport 的 `reqLog` 在 `src/main.tsx` 挂到 `window.__reqs` 供 jsdom 计数）。
3. **服务端事件日志**（mock API）：每条请求按 `process.hrtime` 记到达时刻，断言直接打在时间窗口上——这是 async-parallel 唯一可信的证明方式。

## 3. 规则落地清单（本轮增量，对照 SKILL.md 一行摘要）

### async-*（前一轮为止 0/5 → 本轮 4/5）

| 规则 | 落地 | 证据（async-check / jsdom-check） |
|---|---|---|
| `async-parallel` | `bootstrap(t)` 一个 tick 内发起 summary+schedule+lineup；不 await | 服务端三请求到达窗口 <60ms，总墙钟 410ms（串行下界 740ms）；`GET /api/notices`、`/api/tickets/vip` 首屏**零请求** |
| `async-defer-await` | VIP 校验只在选中 vip 档时请求；公告只在点开 tab 时请求 | vipMax=154ms 且首屏不出现；`countReq('/api/notices')===0` 直到点击「查看公告」 |
| `async-api-routes`（start early, await late） | `/api/home` handler 先起三个上游 promise 再 await | 三上游启动窗口 <10ms、墙钟 <600ms（home=404ms） |
| `async-suspense-boundaries` | App 用 4 个**独立** Suspense（Hero/Lineup/Schedule/Register）+ 各自 skeleton，边区不嵌套共享 | jsdom 三主题下逐段填充：慢的 lineup（400ms 延迟档）挂骨架时，summary/schedule 已出内容；schedule 完成后 lineup 仍在骨架 |
| `async-dependencies` | 未落地：场景数据图没有「部分依赖扇出」形态（各资源只依赖设备令牌这一同步值）。为它再造数据形态属于凑题，记录不适用 |

### server-*（RSC 部分不可适配，其余用 mock 服务端等价落地）

- `server-cache-react` → **single-flight**：`/api/home` inflight Map，并发两请求实测上游只构建 1 次 + join 1 次。
- `server-cache-lru` → LRU(cap 4, TTL 2000ms)：过期后 miss、窗口内 hit 不再触达上游，均有日志断言。
- `server-after-nonblocking` → 响应写回后才 `setImmediate` 计浏览量：断言 6 条 after 事件时刻 ≥ `respondedH`，且 vip 请求墙钟不含计数工作（<200ms）。
- `server-auth-actions` → 设备令牌（`dt-` 前缀）：无令牌 401、`dt-blocked` 403、合法令牌才落单。
- 不适用：`server-serialization`、`server-dedup-props`、`server-parallel-fetching`（RSC 组件树专属）、`server-cache-react` 的 `React.cache()` 本体（需 RSC 运行时）。**结论不变：server-* 要真正吃透仍须 Next.js 工程。**

### bundle-*（延续 19:00 的双构建法）

- `bundle-dynamic-imports`：`vite.split.config.ts` 产物里 poster/analytics 是独立 chunk，**首包 249,271B，按需 chunk 合计 1,321B（占首包 0.5%）**；「按需 chunk 不含首屏文案」+「首包不含 poster 实现独有串（`width="640"`、`等 12 组`）」双向字符串断言。
- `bundle-conditional`：VIP 文案接口与票根实现都只在对应交互后加载。
- `bundle-defer-third-party`：`track()` 先入队，`requestIdleCallback` 后才动态 `import('./analytics')`。
- `bundle-preload`：票根卡 hover 时才预加载 chunk。
- `bundle-barrel-imports`：全程深路径 import。

### client-* / rendering / rerender / js

`client-swr-dedup`（手写：注册表 + 5s TTL inflight 合并，3 消费者 1 到达）、`client-passive-event-listeners`（滚动监听 passive）、`client-localstorage-schema`（`soundisle.prefs.v1` 带版本 + sanitize：voted 白名单正则 `/^a\d\d$/`、tier 枚举白名单）。
`rendering-content-visibility`（日程列表）、`rendering-hoist-jsx`（Frame 的 SVG 纹章、正则常量提升到模块层）、`rendering-conditional-render`（一律三元）。
`rerender-memo`（ArtistCard）、`rerender-transitions`（useTransition 切排序）、`rerender-lazy-state-init`（tier 初值从 prefs 懒初始化）、`rerender-functional-setstate`（投票 +1）、`rerender-dependencies`。
乐观更新可证性：patch 先行、settle 用服务端快照、错误回滚——fixture 延迟 60ms > jsdom 轮询窗口 45ms，所以「+1 在服务端确认前已显示」是硬证据而非巧合；风控姓名路径断言回滚到快照。

## 4. 三种风格

同一份 bundle 逐字节相同（style-check 不变式：内联体 === `dist 文本.replace(/<\/script/gi,'<\\/script')` 的逐字节相等，而非计数比较，见 §6.3），只换 CSS 主题层；`base.css` 纯结构（去 `:root` 后零十六进制色，断言把关），hex 全部收进各主题 `:root`。

| 风格 | 招牌特征（互斥断言） |
|---|---|
| 装饰艺术 deco | `repeating-conic-gradient` 放射纹章 + `3px double` 双线描边 + 金黑衬线大字 |
| 蒸汽波 vapor | `perspective()` 网格地平线 + 希腊字 ΑΕΡ + `text-shadow: 2px 2px 0` 霓虹双色 |
| 孔版印刷 riso | 半调网点 `radial-gradient(var(--dot-ink)` + 双色错位套印 + `6px 6px 0` 硬偏移阴影 |

真浏览器复核（本次面板可见，getComputedStyle 短调用）：deco 墨绿底 `rgb(14,20,17)`+奶油字、vapor 品红霓虹影 `rgb(255,113,206) 2px 2px 0`、riso 纸面卡 `rgb(247,242,228)`+双色 3px 硬影——三页 h1 同为「把整个秋天调成同一种音量」而风格互不混淆。

## 5. 复现步骤

```bash
cd artifacts/20260925-20-vercel-react-activity
bash scripts/verify.sh
# npm install（.npmrc 走 npmmirror）→ tsc --noEmit → 双构建 → inline 三页
# → 后台起 server/mock-api.mjs(127.0.0.1:8141) → 依次跑三套断言
```

预期末行：`async-check 通过 35 项 / 失败 0 项`、`jsdom-check 通过 130 项 / 失败 0 项`、`style-check 通过 40 项 / 失败 0 项`、`verify: 全部通过`。

产物（node_modules/dist/dist-split/.tmp 均已按任务规范删除，verify.sh 可从零重建）：

- `preview/activity-{deco,vapor,riso}.html`：265,274 / 265,610 / 266,379 字节，合计 797,263 字节，双击即开（file:// 走 fixture 数据源）。
- `styles.html`：三风格对照入口。
- 全部校验脚本保留在 `scripts/`，未删（故无需转录进本文档）。

## 6. 本轮踩的坑与修复

**应用/服务端缺陷（写码时抓出）**
1. mock 服务端 `lruSet` 存裸值而 `lruGet` 按 `{at,value}` 解构 → 命中缓存时返回 undefined → `JSON.stringify(undefined)` 得空串 → async-check `SyntaxError: Unexpected end of JSON input`。LRU「看起来在工作」，只有命中路径炸。
2. `GET /api/lineup`、`/api/notices` 服务端包了 `{ok,...}` 而客户端按裸数组消费 → 统一返回裸值。**约定：mock 的响应形态以客户端类型为准。**
3. Hero/Register 两个 Suspense 边界最初缺失：数据一到 error/resolve 就整个 root 崩——补 per-section skeleton + 独立边界。
4. Schedule 渲染体内残留一句无条件 `loadResource('notices')`，会把「延后取数」变成挂载即取——defer 证明全部失效且页面照常工作。删掉后才测出「公告 tab 点击前零请求」。**教训：defer-await 类优化必须有请求计数断言兜底，肉眼看不出来。**

**测试装置坑（jsdom / Node）**
5. Node 22 脚本无法 import 无扩展名 `.ts`：async-check 里用 esbuild 把 `src/lib/api.ts`（无 React 依赖）预打包成 `.tmp/api.mjs` 再 import。
6. file:// origin 下 jsdom 的 `localStorage` 抛 DOMException → beforeParse 里 defineProperty 注入 Map shim（顺带成为「种子二次访问」的注入口，riso 套件预置 voted a02 + tier full）。
7. 倒计时 `setInterval` 让 jsdom 进程永不退出 → 每套件结束 `win.close()`。
8. **固定 sleep 在负载下全部漂移**（20ms 定时器实际几百 ms 才到），首轮 jsdom 超 180s 未过：整套重写为条件轮询 `waitFor(fn, 8000)`（4ms 步进）；「乐观更新先于服务端确认」的证明改用 45ms 上限轮询，卡在 fixture 60ms 响应窗口之前，断言方向变硬。
9. 用 python `str.replace` 给测试脚本打补丁，引号风格不匹配 → **静默 no-op**，测试却照跑，产生一批无法解释的 flaky。此后补丁一律用 Edit 工具并回读确认。
10. transport 层 5s inflight TTL 缓存反噬断言：去重段读回旧值（票数 12483 而非 12486、计数 0 而非 1）→ 需要新鲜读时用新建 transport 或裸 fetch。顺带认识到：**stale 读数本身就是去重生效的证据**，两套断言分开写。
11. fixture transport 最初不写 `reqLog` → `countReq` 恒 0，「零请求」断言全部假通过。补同步 push 后断言才有意义。**计数器的写入点要先于一切计数断言被验证。**

**断言自身缺陷（style-check 首跑 5 失败，全在断言侧不在产物侧）**
12. 「内联转义点数 === dist 中 `</script` 出现次数」不成立：react-dom 自带**已转义**字面量 `<\/script`，产物里有 1 个 `<\/script` 却 0 个 `</script` 可匹配。改为最强形式：内联体与 `bundleJs.replace(/<\/script/gi, …)` **逐字节相等**（不变式升级为整体比对，还顺带证明了 inline.mjs 与检查器用的是同一转义）。
13. 「无 http(s) 外链」误报：bundle 里合法含 w3.org 命名空间串（SVG/MathML/xlink 的 xmlns 值，浏览器不请求）与 react.dev 错误码文案。改为白名单数据串 + 保留**标签级**断言（link/img/script 带 src/href 即失败）作为真正的零外链约束。
14. 「首包不含 buildPoster」误报：主包里留着 1 个 `buildPoster` 标识符（动态 import 的绑定名）和「纪念票根」（Poster 外壳组件本就在首屏）。改用只可能出现在 poster.ts 实现里的独有串（`width="640"`、`等 12 组`）做「首包无实现 + chunk 有实现」双向断言。**minify 会保留导入绑定名——「不含符号名」不是「不含实现」。**
15. 环境类：macOS 无 `timeout`（用工具级超时）；zsh 里 `echo ===` 触发 `=cmd` 展开报错（echo 参数一律加引号）。

## 7. 结论

- **vercel-react-best-practices：留用（第 4 次）。** 本轮把该 skill 最虚的部分变实：async-* 从连续三轮「判不适用」到 4/5 落地且以服务端时间窗口为证据；server-* 在无 Next.js 的前提下用等价物吃到 4 条（single-flight/LRU/after/auth）；client-swr-dedup 的手写等价物给出「注册表去重 + TTL 合并」可移植代码。剩余未吃透部分边界清晰：RSC 专属 3 条 + async-dependencies——前者需要 Next.js 工程，后者需要「部分依赖扇出」数据形态，都不是本 skill 缺陷而是场景配额。
- **方法沉淀**：异步类规则的验证配方 = 传输层抽象（同一代码跑 fixture 与真 HTTP 两世界）+ 请求日志（客户端计数 + 服务端 hrtime 到达窗口）+ 延迟表（把快慢差做进数据里）。条件轮询全面取代固定 sleep；乐观更新证明要设计「确认延迟 > 轮询上限」的时间窗。
- 205/205 断言绿；三页单文件 797KB 双击可用、零外链；产物 1.0MB ≪ 50MB；node_modules 102MB、dist、dist-split、.tmp、安装日志已清理，8141 mock 服务按 PID 核对命令行后 kill、端口确认释放。
