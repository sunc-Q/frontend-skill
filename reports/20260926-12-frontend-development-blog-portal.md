# 20260926-12 · frontend-development × 博客内容门户（路由与代码分割密集场景）

第 21 轮（每小时前端 skill 实验室）。开始时间 2026-09-26 12:00 +08:00，本轮从台账 `next_candidates[45]`
取队首 ★ 项：

> ★ frontend-development × 路由与代码分割密集场景（多页站点/门户）：08:00 向导轮量到「可延迟重量占比」
> 只有 23.3%（L3b），这是表单场景的特征而不是「懒加载」条款的；换到路由密集场景才知道它是否名副其实。

一句话结论：**留用，但本轮把它从「写法清单」升级成「必须自带消融的清单」**——路由与分割最密集的
场景里可延迟重量占比只有 9.4%（比表单场景还低），三条绝对化性能条款的实测价值相差两个数量级，
而本轮最贵的缺陷出在条款没说的地方（Suspense 边界挂在哪一层）。299 条断言全绿（写回后又拆出 I8a/I8b，121→123）。

---

## 1. 技能与来源

| 项 | 值 |
| --- | --- |
| 技能名 | `frontend-development` |
| 来源 | 本地 `~/.qoder-cn/skills/frontend-development/`（用户 2026-09-25 装入，第 4 次使用：07:00 管理后台、08:00 表单向导、16:00（前一日）React 分支） |
| 本体 | `SKILL.md` 30,694 B 在盘 / 30,628 字符，`metadata.json` 同目录 |
| 声明的资源文件 | 11 个（`resources/component-patterns.md`、`resources/data-fetching.md`、`resources/file-organization.md`、`resources/styling.md`、`resources/routing.md`、`resources/loading-and-error-states.md`、`resources/performance.md`、`resources/typescript.md`、`resources/common-patterns.md`、`resources/complete-examples.md` 与 `../../vite.config.ts`） |
| 本机实有 | **0 个**（A1d/A1e：11/11 缺失；A1f：连它用来声明别名的 `../../vite.config.ts` 都不存在） |
| 框架面 | React 18+/19（Suspense、hooks、TanStack Query）为主，另含 Vue 3 / Svelte 5 / Angular 章节 |
| 本轮用到 | React 19.2 + @tanstack/react-query 5.90 + TypeScript 5.9（strict）+ Vite 7.2；**故意不用 MUI**（样式全部走 CSS 自定义属性，见 §3 与 §11⑦） |

调用方式：本轮不需要「调用」技能做生成——技能没有可执行入口，它是**读给 Agent 的条款集**。
本轮的做法是把 `SKILL.md` 的每一条可机检条款抄成判据（`scripts/check-node.mjs` A 组 15 条），
先按条款写实现，再用消融构建给三条绝对化主张单独定价（§8）。

## 2. 场景与选题依据

**场景**：虚构私人站点「灰度通讯 GRAYSCALE」，记录发布、观测与故障复盘。选它的理由是它是实验室里
第一个**「分割点密度」被推到最高**的形态：

| 分割点 | 内容 | 首屏是否需要 |
| --- | --- | --- |
| 路由 `#/`（最新） | 列表 + 检索 + 排序 + 密度 + 标签筛选 + 收藏 + 本期最热 | 是 |
| 路由 `#/post/:slug`（正文） | 正文小节 / 代码高亮 / 引用 / 相关阅读 / 上下篇 | 否 |
| 路由 `#/archive`（归档） | 6 年 × 月三级索引 + 每月最快一篇 | 否 |
| 路由 `#/about`（关于） | 口径自述（月份数、断更、连续更新） | 否 |
| 懒组件 `InsightsPanel` | 全站读数柱图（近 8 个月表 + 6 年图，同一份数两种聚合轴） | 否（悬停预取、点开才挂） |

功能面：240 篇虚构文章（`src/lib/facts.ts` 一份语料，Node 与浏览器经同一个 esbuild 桥读同一份，
E 组 37 条做同源对账）、350 ms 防抖检索、三向排序、两档密度、标签筛选、version=3 收藏信封、
hash 深链与浏览器后退、`file://` 双击可玩。

**为什么不选别的**：台账里 ★ 项还有 6 条，但 build-game / graphic-gif / ppt-generator 那几条属于
其它技能且已有各自排队位；本轮必须消费的是 `tried` 里 frontend-development 唯一未覆盖的形态
（07:00 后台 = 表格密集，08:00 向导 = 表单密集，本场景 = 路由与分割密集），并且它正面回答排队项
留下的那个数字问题。

## 3. 三种风格（同一 DOM，只换令牌）

三页共用**同一份构建产物**（B2：`<script>` 载荷是同一段 307,155 字符 = 310,329 B），差异只来自
`<html data-fd-style="…">` 与注册表里的一个令牌对象：

| | 等高线战术图 topo-tactical | 黏土定格动画 clay-stop | 黑胶唱片架 vinyl-crate |
| --- | --- | --- | --- |
| 底色 | `#d9d5c0` 卡其 | `#f3e7d8` 奶油陶土 | `#191310` 近黑棕 |
| 分隔手法 | `ruled-grid`（0°/90° 正交细网 `repeating-linear-gradient`） | `offset-shadow`（8px 硬偏移投影） | `cut-groove`（1px 刻纹凹槽 + 内描边） |
| 热帖标记 | `left-bar`（行首 4px `#b4452a` 色条） | `badge-lift`（标签 rotate(-3°) + 反白 `#d94f6b`） | `label-invert`（标签整块换 `#c8502f` 底） |
| 圆角 / 描边 | 0px / 1px | 26px / 2.5px | 2px / 1px |
| 字族 | 系统无衬线 + 等宽数字 | Arial Rounded / Chalkboard | Avenir Next Condensed / Impact + 等宽数字 |
| 标题 | uppercase / 26px | none / 30px | uppercase / 28px |
| 行高（舒适 / 紧凑） | 66 / 40 | 78 / 52 | 72 / 44 |
| 正文 / 次要对比度（Node 令牌预测） | 10.44:1 / 5.68:1 | 11.1:1 / 5.73:1 | 15.04:1 / 5.5:1 |
| 正文 / 次要对比度（Chromium 实测） | 10.44:1 / **4.83:1** | 11.1:1 / 4.96:1 | 15.04:1 / 5.99:1 |

三风格互斥性是实测不是声明：

- C2 结构层 CSS 零颜色字面量；C3 每套皮肤块内颜色 100% 来自自己的色板（13/13、12/12、12/12）；
  C4 两两色板零交集。
- C5 十四维令牌指纹两两差异：topo×clay 14、topo×vinyl 8、clay×vinyl 14（阈值 ≥7）。
- D8 十二维**计算样式**（真浏览器 getComputedStyle）两两差异：12/12、7/12、12/12。
- D9/D9b/D10/D11/D12 分隔手法、热帖手法、阴影手法三三互斥，行高与底色两两不同。
- D1 行高令牌真的画出那一行（66px vs 令牌 66px，改 `.row{height:100%}` 之前这里是假通过，见 §7①）。

## 4. 从零复现

```bash
cd 前端skill实验室/artifacts/20260926-12-frontend-development-blog-portal
bash scripts/verify.sh
```

等价的分步（`verify.sh` 就是这个顺序）：

```bash
npm install --no-audit --no-fund            # .npmrc 已指向 npmmirror（本机 npm 直连慢）
./node_modules/.bin/tsc --noEmit            # strict + noUncheckedIndexedAccess + verbatimModuleSyntax
./node_modules/.bin/vite build                                          # dist/            主臂
FD_ARM=nomemo      ./node_modules/.bin/vite build -c vite.ablation.config.ts   # dist-nomemo/
FD_ARM=novirtual   ./node_modules/.bin/vite build -c vite.ablation.config.ts   # dist-novirtual/
FD_ARM=unstablekey ./node_modules/.bin/vite build -c vite.ablation.config.ts   # dist-unstablekey/
./node_modules/.bin/vite build -c vite.split.config.ts                  # dist-split/  真 chunk 图（ES）
node scripts/build-inline.mjs      # preview/portal-*.html + arm-*.html + split-host.html + meta.json
node scripts/dump-facts.mjs        # scripts/.facts.mjs：Node 与浏览器共用的事实源桥
node scripts/check-node.mjs        # 123 条
node scripts/check-dom.mjs         #  88 条
node scripts/check-browser.mjs     #  88 条（用 ~/Library/Caches/ms-playwright 里的本机 Chromium）
node scripts/make-styles.mjs       # styles.html，数字全部来自 .tmp-check/assertions-*.json
```

清理后与收尾（这两条不能和上面同跑，故写在 `verify.sh` 的注释里）：

```bash
node scripts/check-clean.mjs       # 目录形态复查（构建中间物必须已删）
node scripts/verify-ledger.mjs     # 台账复查卡，只读 JSON/MD，任何时候可跑
```

环境依赖：Node 24（本轮实测 v24.18.0）、macOS、本机 Chromium（playwright-core 不自带下载）。
零网络依赖：产物不引用任何外链（B5、D0b），mock origin 是本机 `server/mock-api.mjs`。

## 5. 产物清单与相对路径

```
styles.html                        三风格对照入口（21,567B；全部数字由脚本生成，零手写）
preview/portal-topo-tactical.html  311,053B  交付页：双击即开
preview/portal-clay-stop.html      311,051B  交付页
preview/portal-vinyl-crate.html    311,045B  交付页
preview/arm-nomemo.html            310,756B  消融臂宿主：关掉 React.memo 行组件
preview/arm-novirtual.html         310,738B  消融臂宿主：关掉虚拟滚动
preview/arm-unstablekey.html       310,756B  消融臂宿主：queryKey 每渲染新建（点开永远不会画出行）
preview/split-host.html                      证据构建宿主（ES module + /dist-split/ + ?api=1），需 http://
src/                               44 个 .ts/.tsx，2,648 行（J1，与 wc -l 同口径）：features/{posts,archive,about,insights}
                                   + components/{Layout,SuspenseLoader,VirtualList} + routes/ + lib/
scripts/                           13 个 .mjs + verify.sh 共 14 件，2,490 行：三组 checker + 台账四件套 + 生成器
server/mock-api.mjs                104 行：逐路径可调延迟 + 服务端到达日志（G 组的第二份账）
.npmrc / package.json / package-lock.json / tsconfig.json / vite{,.ablation,.split}.config.ts
```

体积与「目录里不许有中间物」由 `check-clean.mjs` 现算并断言（C1 禁列清单、C5 ≤50 MB 并打印实测
MB、C3a/b/c 点名 7 个 HTML 各自的角色）。本轮不在任何地方硬抄目录字节——`round-facts` 的工作日志
字段自己也参与统计，抄死就会自相矛盾。

## 6. 断言套件结构（为什么分三组）

| 组 | 脚本 | 条数 | 只在这里能验的东西 |
| --- | --- | --- | --- |
| A 条款 / B 自包含 / C 令牌 / E 事实源 / L 分包证据 / J 成本 / I 台账锁 | `check-node.mjs` | 123 | 静态契约、字节不变式、chunk 图、跨轮分母、写回幂等 |
| F 首屏 / H 交互全链路 / N 四臂消融 | `check-dom.mjs` | 88 | jsdom 里的真实组件树：取数次数、防抖、深链、渲染计数（四臂在同一进程里各跑一遍） |
| D 计算样式 / G 真 HTTP 台账 / K 真实交互 / M 双载体 | `check-browser.mjs` | 88 | jsdom 给不了的三样：`getComputedStyle`、真布局（滚动/行高/溢出）、真网络 |

分工的理由是**每一层都有自己量不到的东西**：jsdom 无布局（K 组必须真浏览器）、Node 无渲染
（L 组只能读 chunk）、浏览器没有计数器（N 组的渲染次数只能从 `src/lib/counter.ts` 在 DOM 侧读）。
所以同一件事被刻意量两遍并互相回扣：DOM 行数在 jsdom（N1/N13）与 Chromium（K1/K2b）各量一次、
对比度在 Node 令牌层（C8）与浏览器计算样式（D5/D5b）各算一次、取数次数在客户端请求列表与服务端
到达日志各记一次（G1/G8g）。

## 7. 本轮抓到并修掉的 5 个真缺陷

① **行高令牌没有画出那一行**（D1 假通过）。令牌声明 66/78/72 px，实际 `.row` 按内容渲染成
46/50/65 px；D1/K4 读的是外层 `.vrow` 槽位，所以一直是绿的。修法：`.row { height: 100% }`，
让断言量的与被测的落在同一个元素上。**教训**：断言「令牌兑现」时，必须确认读到的那个盒
就是令牌该管的那个盒。

② **topo-tactical 次要文字不达 WCAG AA**（只有真浏览器抓得到）。Node 侧按 `--c-bg` 算得 5.68:1，
而文字实际画在 `--c-paper` 上，量出来 4.2:1。修：`muted: '#565a46'` → 实测 4.83:1。**教训**：
页面有「底色 + 卡片色」两层时，对比度断言必须显式写出分母令牌。

③ **Suspense 边界挂错层**（本轮最贵，见 §9）。`<Layout>` 写在路由组件内部时，路由级 fallback 把
站名、导航、全站统计、页脚一起吞掉，1.8 s 慢接口下整页只剩一个占位、页脚位移 1,066 px。
修：把 `Layout` 提到 `App.tsx` 里、边界之外（`src/App.tsx`），只让 `<main>` 挂起。

④ **证据构建与 mock origin 双双 404**（G 组首跑全红）。Vite 的相对 base 让 `/preview/split-host.html`
把 chunk 解析到 `/preview/dist-split/…`；同一台 origin 里 `/api/*` 全 404，因为路径键用 `slice(4)`
剪掉 `/api` 时留下前导斜杠。修：`base: '/dist-split/'` 绝对化、`slice('/api/'.length)`。

⑤ **校验脚本自己把字符数当字节数**（A1b/B2/N10 三处 `${x.length}B`）。同一份产物里中文文案让
两者差 3,174（307,155 字符 = 310,329 字节）。修：三处改成显式单位（字符数与 `Buffer.byteLength`
分别打印），B4 的字节不变式本来就用 `Buffer.byteLength`，所以它一直是自洽的。

另有 8 处「检查器自身假绿/假红」记录在 §12 与台账 `environment_notes`，其中最重要的两条：
选择器少写一个右括号（`'[data-testid="result-count"'`）在 `waitForFunction(...).catch(()=>undefined)`
里只会稳定返回 false，把条件等待退化成固定 sleep 而测试照过；逐帧位移统计把「元素尚未挂载」的
帧读成 0，凭空造出 20 px / 101 px 的 chrome 位移。

## 8. 三条绝对化条款的消融实测（本轮真正的产出）

四臂是**同一份源码**的四次构建，只换编译期常量 `__FD_ARM__`（`src/lib/ablation.ts` 读它）：

| 臂 | 关掉的主张 | bundle（字符数，四臂全同） | 实测代价 |
| --- | --- | --- | --- |
| 主臂 | —— | 307,155 | 基线：DOM 11 行、3 击键 row 渲染 10 次、取数 1 次 |
| `novirtual` | 虚拟滚动 | 307,155 | **DOM 行数 240**（主臂 11），省下的 229 个节点行 |
| `nomemo` | React.memo 行组件 | 307,155 | **3 击键 row 渲染 54 次**（主臂 10），每击键 18 次 vs 3.33 次 = 5.4× |
| `unstablekey` | queryKey 稳定引用 | 307,155 | **1.5 s 窗口 44 次读**（主臂 1）；**首屏从未完成、至今零行** |

关键读法（每条都配了「不然这只是什么都没发生」的反控制）：

- N4b：三次击键确实改过列表（`main:11→10`、`novirtual:240→10`、`unstablekey:0→0`）——否则「行渲染
  10 次」可以是「什么都没渲染」。
- N6：两臂的**列表容器**渲染次数相同（5 vs 5），证明 memo 省的确实只在行这一层，不是整个列表被重建。
- N9c：三臂里只有 `unstablekey` 从未完成首屏（另三条 `mounted:true`）。**这是本轮唯一「坏掉」而不是
  「变慢」的消融**：另外两条只是把常量换小，这一条把功能换没了。
- 真 HTTP 复核（G9，1.8 s 慢接口的 split 宿主）：稳定臂 1 次读、不稳定臂 16 次（2 s 窗口 16:1），
  且不稳定臂 `rows=0`。窗口计数依赖机器时序，两次跑分别读到 44 与 89——**量级（数十倍）稳定，
  具体数不稳定**，所以断言写成 `>5×` 而不是等值。
- 真实像素复核（K1/K2/K2b/K4）：视口 558 px / 内容 15,840 px / 11 行；滚到 `top=2400` 后窗口
  `32:49`，与用真实 `clientHeight/scrollTop` 复算的区间逐字相等；密度切换 66 px → 40 px 后同
  视口从 `0:14` 变 `56:78`。

**排队项的答案（L3b）**：入口 chunk 282,817 B ÷ 全部 chunk 312,157 B，可延迟部分 29,340 B = **9.4%**，
比 08:00 表单场景自报的 23.3% **更低**。也就是说「懒加载」条款的收益上限跟场景里有几个分割点
几乎无关——React + React Query 运行时占了九成多且无法延迟。这条判据现在有两个落盘点
（08:00 只有报告文本、本轮 JSON 与 styles.html 都有），可以当跨轮基线用。J8 把它写成断言
（9.4% < 30%）专门防「路由密集所以懒加载收益更高」这个直觉。

## 9. 本轮的结构性发现：Suspense 边界挂在哪一层

技能原文（`### ⏳ Loading & Error States`）说的是「用 Suspense 包住懒组件」「不要 early return
转圈」，没说**边界挂哪一层**。两种挂法在快接口下看起来一模一样，在 1.8 s 慢接口下差 1,066 px：

| | 边界包住「路由组件 + Layout」（改前） | 边界只包住 `<main>`（改后） |
| --- | --- | --- |
| 等待期 masthead 位置 | 消失（被 fallback 吞掉） | 0 px 位移（G8d） |
| 等待期全站统计块 | 消失 | 一直在场，高度 65 px（G8f） |
| 等待期页脚 | 位移 1,066 px（G8d3，改造前实测） | 位移 386 px |
| 占位真实高度 | —— | 520 px × 109 帧，全程无空窗帧（G8/G8b/G8c） |
| 服务端收到 | —— | 1 次 `/api/posts`（G8g，loader 与组件共用一次读） |

改后残余的 386 px 没有被断言掉，而是如实报成一条数：G8d2 断言「预留带 ≥ 内容高度的一半，且
残余位移 = 内容高度 − 预留高度」（520 px 预留 vs 907 px 实际内容 → 386 px）。**固定高度占位
挡不住全部 CLS，只能挡住一半以上**——这是技能完全没提的量化事实。

## 10. 已删除的探针脚本（全文转写，按要求留档）

本轮删掉 2 个一次性探针 + 1 个冒烟脚本。它们的作用都已在正式 checker 里固化（K 组、G 组、E 组），
留在目录里只会误导复现，故删除并把内容转写如下。

**`scripts/tmp-diag.mjs`**（诊断「split ES 宿主页为什么不画行」——最终定位到 §7④ 的 base 与
`/api/` 前缀两个 404）：

```js
/* one-off diagnostic: why does the split ES-module host page not paint rows? */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startMockApi } from '../server/mock-api.mjs';

const PORT = 8199;
const srv = await startMockApi({ port: PORT, latency: { '/posts': 120, '/insights': 240 } });
const execPath = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const browser = await chromium.launch({ executablePath: existsSync(execPath) ? execPath : undefined, headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[console:${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url()); });
await page.goto(`${srv.origin}/preview/split-host.html?api=1`, { waitUntil: 'load' });
await page.waitForTimeout(4000);
console.log('html len =', (await page.content()).length);
console.log('body start =', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
await browser.close();
await srv.close();
```

**`scripts/probe-corpus.mjs`**（首轮建语料时对 `src/lib/facts.ts` 的独立读数，用来确认「总量 =
逐项求和」不是自证；现已由 `dump-facts.mjs` 的正式桥 + E 组 37 条断言取代）：

```js
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
const entry = 'src/lib/facts.ts';
const out = 'scripts/.facts.bundle.mjs';
execFileSync('./node_modules/.bin/esbuild', [entry, '--bundle', '--format=esm', `--outfile=${out}`, '--alias:~types=./src/types', '--log-level=warning'], { stdio: 'inherit' });
const mod = await import(`../${out}`);
const { corpus, featuredSlug, TODAY_DAY } = mod;
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
console.log(JSON.stringify({
  posts: corpus.posts.length,
  views: corpus.stats.views,
  viewsRecompute: sum(corpus.posts, p => p.views),
  tagSum: sum(corpus.byTag, t => t.count),
  monthSum: sum(corpus.byMonth, m => m.count),
  months: corpus.stats.months,
  streak: corpus.stats.streak,
  median: corpus.stats.medianMinutes,
  avg: corpus.stats.avgViews,
  featured: featuredSlug(),
  featuredViews: corpus.posts.find(p => p.slug === featuredSlug()).views,
  first: corpus.posts[0].slug, last: corpus.posts.at(-1).slug,
  firstDay: corpus.posts[0].day, lastDay: corpus.posts.at(-1).day, TODAY_DAY,
  dayCheck: (Date.UTC(2026, 8, 26) - Date.UTC(2021, 0, 1)) / 86400000,
}, null, 1));
unlinkSync(out);
```

**`.smoke.mjs`**（最早的内联冒烟：确认 `dist/assets/main.js` 在 jsdom 里能挂出列表并只发一次请求；
现由 `check-dom.mjs` F 组 16 条完全取代）：

```js
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const bundle = readFileSync('dist/assets/main.js','utf8');
const vc = new VirtualConsole();
const msgs=[]; vc.on('jsdomError',e=>msgs.push('jsdomError '+e.message+'\n'+(e.stack||'').split('\n').slice(0,6).join('\n'))); vc.on('error',m=>msgs.push('error '+m));
const dom = new JSDOM(`<!doctype html><html lang="zh-CN" data-fd-style="clay-stop"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>`, { runScripts:'outside-only', pretendToBeVisual:true, url:'https://t.test/portal-topo.html', virtualConsole: vc });
dom.window.eval(bundle);
await new Promise(r=>setTimeout(r,700));
const d = dom.window.document;
console.log('rows in DOM:', d.querySelectorAll('[data-testid="row"]').length);
console.log('vport window:', d.querySelector('[data-testid="rows"]')?.getAttribute('data-window'));
console.log('result-count:', d.querySelector('[data-testid="result-count"]')?.textContent);
console.log('hero:', d.querySelector('[data-testid="hero-meta"]')?.textContent);
console.log('crumb:', d.querySelector('[data-testid="route-shell"]')?.dataset.crumb);
console.log('arm:', JSON.stringify(dom.window.__fdBridge?.arm));
console.log('reqs:', JSON.stringify(dom.window.__fdBridge?.reqLog()));
console.log('counts:', JSON.stringify(dom.window.__fdBridge?.renderCounts()));
console.log('style tag len:', d.getElementById('fd-style-css')?.textContent.length);
console.log('msgs:', msgs.slice(0,3).join('\n---\n'));
dom.window.close();
```

## 11. 与技能条款的逐条对账（哪些值得留下）

`SKILL.md` 的一行摘要条款里，本产物能机检的 15 条（A2c）逐条落地情况：

| 条款（原文摘要） | 判据 | 实测 |
| --- | --- | --- |
| 特性目录 `features/{api,components,hooks,helpers,types}` | A1 | 4 个特性全部齐备 |
| 每个特性有 `index.ts` 公共出口 | A2 | 4/4 |
| 服务层命名 `api/{feature}Api.ts` | A3 | `postsApi.ts` / `insightsApi.ts` |
| 路由目录 + 组件 `lazy()` | A4 | 4 条路由各自 `routes/{feature}/index.tsx` + lazy |
| 别名 `@/ ~types ~components ~features` 实际在用 | A5 | 全部在用（注意：技能声明别名所在的 `vite.config.ts` 本身不存在，A1f） |
| `useSuspenseQuery` 是取数主形态 | A6 | 是；且与 loader 共用同一个键 |
| 禁止「加载中早退」 | A7 + F3/F6 | 产物零处 `if (isLoading) return <Spinner/>`；首屏挂载即有行 |
| 懒边界必须有 Suspense 包裹 | A8 + **G8** | 3 处（路由壳 / 列表 / 面板）——但**边界挂哪一层技能没说**，见 §9 |
| 传给子组件的 handler 用 `useCallback` | A9 | `onStar` 等全部包 |
| `filter/sort/map` 类计算用 `useMemo` | A10 | 列表 7 个 memo 计算 |
| 搜索防抖 300–500 ms | A11 + H1–H4 + K3 | 350 ms；真键盘输入下「落地前读数仍是全量 → 收敛到模型复算的 10 篇」 |
| `React.memo` 行组件 | A12 + **N3/N4/N7** | 值 5.4× 行渲染（§8） |
| 订阅/定时器同文件配对清理 | A13 | `addEventListener↔removeEventListener`、`setTimeout↔clearTimeout` 全配对 |
| 显式返回类型、零隐式 any | A14 + tsc strict | `tsc --noEmit` 在 `verify.sh` 里把关 |
| 类型集中 `types/` 且 `import type` | A15 | 是（`verbatimModuleSyntax` 强制） |
| 样式：三皮肤要求令牌层换色（而非 `sx` prop） | A2d + C 组 | 无 MUI；C2 结构层零 hex |

技能**没提**而本场景必须有、于是本轮自建的判据（这是它目前最大的缺口）：

1. Suspense 边界的层级（§9）——决定等待期整页是否还可读；
2. 固定占位的残余位移（G8d2）——只能挡一半以上，不是防住 CLS；
3. 预取与点击的共用（G3/G3b/G4、H35/H36/H39e）——`onPointerEnter` 预取之后点开必须零新增读；
4. 敌意持久化输入的**有界**消毒（M4b：5,000 项星单截到 60 条 = 1,097 B 落盘）——技能只说「校验输入」；
5. 路由间缓存存活与后退语义（G6c/H34/K5c）。

## 12. 结论：是否留用

**留用，第 4 次通过；但从「写法清单」降级为「必须配消融才能引用的清单」。**

值得留下的部分：目录与命名契约（A1–A5）、禁 early-return（A7 + F3/F6/G8f 三处独立兑现）、
`useSuspenseQuery` + loader 同键（G1/G5/H24：客户端与服务端两份账各证一次）、防抖区间与
`useMemo/useCallback`（H1/K3）。这七条本轮没有一条反例。

必须打折扣的部分：三条性能主张被写成同等语气，实测价值差两个数量级（§8）——虚拟滚动值 229 个
DOM 节点行、memo 值 5.4× 行渲染、queryKey 稳定不是「更快」而是**没有它首屏根本不会完成**。
按原文照做的 Agent 会把三者当成同一种「优化建议」，从而在只能做一件事时选错。

结构性缺口：技能不说 Suspense 边界挂哪一层（§9），不说固定占位挡不住全部位移（G8d2），
不说预取必须与点击共用同一次读（H39e 要自建才能判）。

契约缺陷（第 4 次复跑确认仍未修）：`SKILL.md` 引用的 11 个资源文件 100% 缺失，连声明别名的
`../../vite.config.ts` 也不存在——技能本体只剩一行行摘要，约七成条款绑定 MUI/TanStack-Router
（A2b 实测：这些专属标记在本产物中零命中，即它们未落地而非落地后被删）。

成本：单页 311,053 B / bundle 310,329 B = 08:00 向导轮（633,905 B）的 **0.49×**、07:00 后台轮
（720,722 B）的 **0.43×**；src 44 文件 2,648 行。**路由数翻倍并没有让产物变贵**，因为贵的是运行时。
分母全部从磁盘现读（J3 直接读上一轮目录的字节与文件数），不抄报告。

## 13. 台账写回与推送（本轮收尾）

顺序（每一步都有卡，不许手改 JSON）：

```bash
node scripts/ledger-snapshot.mjs     # 写回前快照：tried=20 runs=20 styles=60 env=128 seen=19 log=32
node scripts/check-node.mjs          # I 组对着快照断言「本轮尚未写入」
FD_LEDGER_UPDATED="$(date +%Y-%m-%dT%H:00+08:00)" \
  FD_SEEN_STATUS='frontend-development（第 4 次使用…本轮产出 9.4% 与三臂消融两个可引用基线）' \
  node scripts/ledger-apply.mjs      # 一次性写回；已存在即拒绝二跑
node scripts/check-node.mjs          # I 组切「已追加」分支复跑
rm -rf node_modules dist dist-nomemo dist-novirtual dist-unstablekey dist-split .tmp-check .npm-install.log .smoke.mjs scripts/.facts*.mjs
node scripts/check-clean.mjs         # 清理后目录形态卡
node scripts/ledger-refill.mjs       # 补记 artifact_size / cleanup / push / work-log 末行 + 新候选与清理期踩坑
node scripts/verify-ledger.mjs       # V1–V12
```

推送：`git@github.com:sunc-Q/frontend-skill.git`（`origin/main`）。本机 `github.com` 的 HTTPS 会被
TLS 层重置，只走 SSH；`known_hosts` 写入 gitignored 的 `LAB/.tmp`（`StrictHostKeyChecking=accept-new`），
收尾后连目录一起删除。提交身份用 `git -c user.name=… -c user.email=…` 逐次注入，不改任何全局配置，
命令与文件里不出现任何 token。

写回后复跑 I 组时 2 条失败，两条都是**校验脚本自身的错**，不是台账的错，改的是卡不是数据：

- `I8 写回后 work-log 行数 = 快照 + 1` → 实际 `32 → 34`。原因是并行的「仓库结构调整」任务在快照之后往
  work-log 追加了一行非轮次记录（`2026-09-26 14:15 |（非轮次·仓库结构调整）`）。台账契约是
  **append-only + 本轮一行**，从来不是「除了我没人能写日志」，所以把断言换成两半：
  `I8a` 快照前 `snap.logLines` 行的前缀 sha1 逐字节不变（历史没被改写），`I8b` 快照之后以本轮
  `WORK_LOG_LINE` 行首（时间 + 技能名）为键的自有行恰好 1 个且位于末行。
  `verify-ledger.mjs` 的 `V7/V8` 同一条 +1 假设一并改：`V7` 前缀哈希 + 自有行数，`V8` 拿自有行而非「末行」
  与 `WORK_LOG_LINE` 比字节——这样并行任务即使本轮收尾之后再插一行，也不会把「本轮写回正确」判成失败。
  （附带教训：识别自有行不能 substring 匹配产物目录名，那条 14:15 的行里也提到了
  `artifacts/20260926-12-…`，最初版本因此误判成 2 行；改用行首前缀才唯一。）
- `I10 三风格名与全台账零字面撞车` → 自撞：写回成功后 `state.used_styles` 已经包含本轮自己那 3 项。
  基准集应该是「写回前的历史」，改为 `state.used_styles.filter(s => !TRIED.styles.includes(s))`，
  并顺手断言过滤掉的正好是 3 项（等于偷偷复查了 I5 的 +3）。

改完 123/123、88/88、88/88 全绿，`styles.html` 重新生成（21,567B，299 条断言转写）。
顺手把 `J1` 的行数口径改成与 `wc -l` 一致（`split('\n')` 每文件多算行尾空串行：2,692 → 2,648，44 个文件各差 1），
并让 `check-clean` 的 C5 在**通过时也无条件打印**实测体积——台账的 `artifact_size` 说「取数于 C5」，
一张只在失败时开口的卡不能当数据源。

清理实读（两次连跑，第二次只因我改了 `round-facts` 里描述体积的那行文案而变动，正是该文件自己警告的自指）：

```
C5 实测体积：2,285,809B / 2.18MB / 76 个文件   ← 写下 artifact_size 那一次
C5 实测体积：2,286,020B / 2.18MB / 76 个文件   ← 改完该文案之后（+211B，目录 123MB → 2.18MB）
check-clean: 30/30 assertions passed
```

- 写回区间：`62070f4..8ba7a5b`（主体 commit `8ba7a5b`：产物目录 76 件 + 本报告 + `state.json` +
  work-log 末行 + `skills/MANIFEST.json`、`skills/README.md` 经 `node scripts/gen-skills-manifest.mjs`
  再生——本轮 `frontend-development` 的 `used_in_rounds` 追加 `2026-09-26 12:00`，`台账_tried_total`
  20→21；数字全部脚本现读，未手抄）
- 补记区间：`8ba7a5b..PLACEHOLDER_PUSH_REFILL`（补记 commit 由 `scripts/ledger-refill.mjs` 触发，
  回填 `artifact_size` / `cleanup` / `push` 三格 + 3 条清理期踩坑 + 6 条下一轮候选；它的哈希只能由
  第三次「区间定稿」提交写出，这也是本轮留下该机制的自证：**任何指向自身的读数都必须晚于自身产生**）

## 14. 下一轮候选（已排入台账）

1. ★ 把 G8 的「Suspense 边界层级」式子（逐帧量 chrome：masthead/stats top 位移必须为 0，且占位
   高度与内容高度之差 == 页脚位移）移植回 07:00 后台轮、08:00 向导轮与 16:00 Vue 分支——那几轮
   同样把页头页脚写在路由组件内部，当时只量了「骨架是否出现」，从未量「骨架之外还有什么」。
2. ★ 「可延迟重量占比」跨场景曲线补第三点并修分母：本轮 9.4%（已落盘）/ 08:00 的 23.3%（只在报告
   文本里）——先重跑 07:00、08:00 两轮的 check-node 让 L3b 落盘，再加「单页重图表」或「无限滚动」
   场景，检验这条指标究竟随什么变化。
3. ★ 消融实验要按「功能失效 / 性能退化」分档：把这条分档回打 07:00 轮 `?control=early`（位移 1.7×）
   与 08:00 轮 `__FD_MEMO__`（30 击 7 vs 210）两组旧数据，重述结论档次。
4. 虚拟滚动的另一半：行高不定（富文本摘要折行数不同、图片延迟加载）时技能是否给出任何可判写法。
5. ★ 把 M4b 的「有界消毒」口径（5,000 项 → 60 条）移植回 06:00 活动页 prefs 与 20:00 报名页票根：
   历轮只验过非法 JSON 与非法枚举，从未验「形状合法但规模超大」的输入。
6. 三皮肤行高（66/78/72）会让同一视口下的窗口行数与「本页共 N 篇」口径随皮肤变化——这个判断题
   交给 vercel-react-best-practices × 表单向导轮（原候选 46）交叉复核，看另一个技能是否自带裁决。
