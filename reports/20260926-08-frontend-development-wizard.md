# 20260926-08 · frontend-development × 表单密集多步向导

- 轮次时间：2026-09-26 08:00（每小时自动轮，本轮为实验室第 19 轮）
- 场景目录：`artifacts/20260926-08-frontend-development-wizard/`
- 报告：本文件
- 一句话结论：**留用，但只当「写法清单」用，别当「正确性来源」用** —— 本轮最贵的缺陷恰恰来自它最有价值的那条条款。

---

## 1. 技能与来源

| 项 | 值 |
| --- | --- |
| 技能名 | `frontend-development` |
| 安装位置 | `~/.qoder-cn/skills/frontend-development/SKILL.md`（用户 2026-09-25 装入本地，**本实验室第 3 次使用**） |
| 来源链接 | 无。SKILL.md 全文零外链（grep `http` 无命中），frontmatter 只有 `name` / `description`，因此不存在「上游仓库」可核对 |
| 规模 | SKILL.md 30,628B，覆盖 React 18+ / Vue 3 / Svelte 5 / Angular 四框架 |
| 调用方式 | 自动触发（`description` 里的 keywords：React、hooks、Suspense、useSuspenseQuery、routing、bundle size…），也可 `/frontend-development` 手动调用 |
| 安装方式 | 无需安装：已在本地。本轮不新增任何技能、不改任何权限配置 |
| 资产缺口 | SKILL.md 引用的 `resources/*.md` 与 `../../vite.config.ts` **共 10 个文件在本机不存在**（断言 A1b/A2 每次复跑确认）。可用的只剩一行行摘要，本轮把其中 14 条写成可判据断言（A2b） |

**这条缺口本身就是结论的一部分**：一个技能如果只给摘要不给判据，「按技能做了」与「看起来按技能做了」无法区分。下面所有断言都是为它补上判据，而不是复述它的措辞。

---

## 2. 场景与选题依据

台账 `state/state.json` 的 `next_candidates` 里排着的 ★ 优先项：

> ★ frontend-development × 表单密集场景（向导/多步校验）：本轮只有 3 字段设置表单，RHF reset 清 isDirty 这类陷阱是意外撞上的，值得正面测一轮（多步 + 异步校验 + 字段级 dirty 追踪）

即 07:00 轮（同 skill × 管理后台）自报的薄弱面。查重：`tried` 里 `frontend-development` 已有「数据报表」「管理后台」两条，**没有表单密集/向导**；三个风格名与 `used_styles` 54 项历史零撞车。组合是新的。

产品设定：虚构「潮汐社」手作订阅店的开店向导。

| 步 | 字段数 | 关键机制 |
| --- | --- | --- |
| 1 站点身份 | 7 | storeName/subdomain/tagline + 服务端选项 3 个（category/timezone/notify）+ 分支必填 supportPhone；subdomain 走异步唯一性校验；选项区单独一条 Suspense 边界（176px） |
| 2 套餐与账务 | 5 | plan/seats/addons/billing/currency；席位区间随套餐钳制；addons 有前置依赖（多仓发货需库存同步、数据导出需 studio 及以上） |
| 3 主体与开票 | 7 | accountType 个人/企业分支：个人要 realName+idLast4，企业要 companyName+uscc；invoiceType=专用发票再拉出 taxTitle/taxNo；supportEmail 第二个异步校验 |
| 4 确认 | 3 | 复核 + 协议勾选 + 提交；金额为侧栏明细逐行加总与闭式公式双实现互校后的同一个数 |

四步字段并集 = 22 且互不重叠（E11），schema 的 22 键与字段表/标签表/示例值同集合（E11b）。

其余功能面：步骤闸门 `canTravel`（只认「目标步之前每步都合法」，回退永远开放）、`#step=` 深链与冷启动钳制、字段级 dirty chip、码点计数、`version=3` 草稿信封与敌意输入消毒、内容派生幂等令牌、提交后清草稿。

---

## 3. 三种风格（同一 DOM，只换令牌）

一份 `StyleTokens` 对象（`src/lib/style/registry.ts`）派生出 CSS 自定义属性、签名装饰块与 MUI 主题，因此「某个颜色只存在于一处」是可证的（C5：结构层零字面颜色）。

| 风格 id | 名称 | 手法 | 底色实测 / 圆角 / 描边 / 分隔 | 正文对比度 | 次要对比度 |
| --- | --- | --- | --- | --- | --- |
| `paper-grid` | 方格信笺 | 5mm 正交细网 + 墨蓝衬线标题（保留原大小写）+ 等宽小标签 + 2px 虚线焦点框，零阴影 | `rgb(242,239,230)` · 3px · 1px · ruled/无阴影 | 11.37:1 | 5.29:1 |
| `pcb-green` | PCB 阻焊绿 | 深绿阻焊底（亮度<0.06）+ 45° 斜向走线丝网纹 + 全等宽丝印大写 + 金色焊盘 + 发光滑环，零圆角 | `rgb(10,36,25)` · 0px · 1px · silk/无阴影 | 13.62:1 | 6.54:1 |
| `concrete-rose` | 清水混凝土玫瑰金 | 现浇灰面 + 圆点对拉孔 + 900 字重大写标题 + 玫瑰金衬线数字 + 5px 粗描边 + 6px 硬位移阴影 | `rgb(192,190,185)` · 0px · **5px** · dot/有阴影 | 9.12:1 | 5.36:1 |

互斥性是实测的，不是声明的：12 项计算样式指纹两两差异 ≥7（D8 三对全过）、三种分隔手法在 Chromium 里互不出现（D9）、阴影手法两无一有（D10）、数字字体并非三页同一（D11）、三页底色两两不同（D12）。同时三页 `<script>` 载荷**逐字节相同**（B2），运行时不因风格而复制。

---

## 4. 从零复现

```bash
cd "artifacts/20260926-08-frontend-development-wizard"
bash scripts/verify.sh          # 全绿需要 3–4 分钟，退出码 0
```

展开即（`scripts/verify.sh` 里就是这几条，全部用本地 `node_modules/.bin`，无 npm scripts）：

```bash
npm install --no-audit --no-fund            # .npmrc 指向 npmmirror，159MB / 约 200 包
./node_modules/.bin/tsc --noEmit            # strict + noUncheckedIndexedAccess + noUnusedLocals，源码零 : any
./node_modules/.bin/vite build                              # dist/        主臂 __FD_MEMO__=true
./node_modules/.bin/vite build -c vite.control.config.ts    # dist-plain/  消融臂 __FD_MEMO__=false（同一份源码）
./node_modules/.bin/vite build -c vite.split.config.ts      # dist-split/  证据构建，保留真实 chunk 边界
node scripts/build-inline.mjs               # preview/wizard-*.html + scripts/build-inline-meta.json
node scripts/check-node.mjs                 # 96 条 + I 组台账锁（写回前 5 条 / 写回后 15 条分支）
node scripts/check-dom.mjs                  # 112 条（jsdom）
node scripts/check-browser.mjs              # 70 条（本机 Chromium，playwright-core）
node scripts/make-styles.mjs                # styles.html：页面数字全部取自 .tmp-check/assertions-*.json
```

前置条件与坑（每条都对应一次真实调试）：

1. **三份构建产物都不可少**：`dist/` 是发出去的产物，`dist-plain/` 是 memo 消融臂，`dist-split/` 是「懒加载条款是否可判」的证据构建。check-node 的 B/L/J 三组直接读它们。
2. `define: { 'process.env.NODE_ENV': '"production"', __FD_MEMO__: true }` —— IIFE 格式 + React 若不给 NODE_ENV 会在运行时炸；`__FD_MEMO__` 是双臂唯一的差异开关。
3. `rollupOptions.input` 直接指向 `src/main.tsx`、`output.format: 'iife'` + `inlineDynamicImports: true`，**因此根目录没有 index.html**（Vite 不需要 HTML 入口）。上一轮把生成页写成 `index.html` 会让 `verify.sh` 第二跑就没入口，本轮改为 `styles.html`，`check-clean` C6 同步改了期望值。
4. `scripts/build-inline.mjs` 用函数式 replacer 注入 bundle（`String.replace` 的字符串形式会把 `$&` 当捕获组展开），并按 `</script` → `<\/script` 转义（本轮命中 0 次，但没命中不等于不需要）。
5. `check-browser.mjs` 需要 Chromium：`~/Library/Caches/ms-playwright/chromium-1148/...`，脚本里 `executablePath` 存在才传，否则回落 playwright 默认。它自带一个 http server（端口 8157）以便跑 `?api=1` 与 `file://` 两种载体。
6. 收尾后复跑：`rm -rf node_modules dist dist-plain dist-split .tmp-check .tmp-*` 之后只能跑 `node scripts/check-clean.mjs`（20 条）与 `node scripts/verify-ledger.mjs`（12 条），这两张卡不需要构建现场。收尾阶段各给它们加了一条（C9 / V12），原因见 §13。

---

## 5. 产物清单与相对路径

| 路径 | 说明 |
| --- | --- |
| `preview/wizard-paper-grid.html` | 634,448B 单文件，双击即开，零外链 |
| `preview/wizard-pcb-green.html` | 634,465B 同上 |
| `preview/wizard-concrete-rose.html` | 634,487B 同上 |
| `styles.html` | 13,701B 三风格对照入口；每个数字由 `.tmp-check/assertions-*.json` 经 `scripts/make-styles.mjs` 生成，零手写 |
| `src/` | 35 个 .ts/.tsx、3,516 行 |
| `scripts/` | 三组 checker + build-inline + make-styles + verify.sh + 台账四件套（snapshot/apply/refill/verify-ledger）+ check-clean + `_harness.mjs`，13 个 .mjs/.sh 共 2,602 行（这个数最后由 `cat scripts/*.mjs scripts/*.sh \| wc -l` 现算，见 §13 的自引用说明） |
| `evidence/assertions-{node,dom,browser}.json` | 293 条断言的原始读数（61,034B），报告与 styles.html 的数字都出自这里 |
| `vite.config.ts` / `vite.control.config.ts` / `vite.split.config.ts` / `tsconfig.json` / `package.json` / `package-lock.json` / `.npmrc` | 复现所需配置与锁文件 |

三种用法：`file://` 双击（静态 mock 传输，进程内）；`python3 -m http.server 8157` 后访问 `?api=1`（bootstrap 走真 fetch，能看到两级骨架）；页面右上角「载入示例」一键填完 22 字段可走到提交。

---

## 6. 断言套件结构（为什么分三组）

| 组 | 位置 | 内容 | 为什么只能在这跑 |
| --- | --- | --- | --- |
| A | check-node 21 条 | 技能条款逐条落成判据（含 A1b「契约无资产」本身） | 静态读源码与 SKILL.md |
| B | check-node 8 条 | 自包含：三页脚本载荷逐字节相同、零外链、无动态 import、同一事实源单处定义 | 读产物字节 |
| C | check-node 8 条 | 三风格主张：手法互不相同、12 维指纹距离 ≥5、结构层零字面颜色 | 读令牌层源码 |
| E | check-node 39 条 | 事实源同源与业务口径：报价双实现相遇、22 字段并集、18 组分支 payload 键集合、草稿四结局、延迟表非单调 | 纯函数，不需 DOM |
| J / L | check-node 12 + 7 条 | 成本现算（分母读上一轮产物）；分包证据构建 | 读磁盘 |
| I | check-node 5→15 条 | 台账幂等锁（写回前后两个分支） | 读 state.json + 快照 |
| F | check-dom 32 条 | 首屏窗口、single-flight、令牌块隔离、无重复 id、三风格同 DOM | jsdom 能看 DOM 序列 |
| H | check-dom 61 条 | 交互全链路：闸门、异步乱序回写、字段级 dirty、草稿恢复/清理、分支残留、幂等提交、深链钳制 | 需要真事件循环 |
| N | check-dom 19 条 | memo 双臂消融（渲染计数 + 墙钟） | 两臂字节与计数器 |
| D | check-browser 34 条 | 计算样式、WCAG 对比度、指纹互斥、1440px 无横向滚动 | jsdom 无级联无 layout |
| G | check-browser 16 条 | `?api=1` 逐帧采样：两级骨架时长、空窗帧、位移 | 需要真帧 |
| K | check-browser 6 条 | 真点击走完提交并拿回执、幂等重放 | 需要真事件 |
| M | check-browser 14 条 | `http://` 与 `file://` 两载体各跑一遍持久化 + 敌意草稿 | 需要两个 origin |

---

## 7. 本轮抓到并修掉的 4 个真缺陷

### 7.1 慢接口下首屏约 2 秒纯白屏（最贵）

`src/main.tsx` 原本 `await route.loader(...)` 再 `mount()`。mock 120ms 时零症状；`?api=1` 把 bootstrap 拖到 2.2s 时，白屏发生在**页面挂载之前**，`SuspenseLoader` 完全无从生效。逐帧探针（§10 的 `.tmp-probe5.mjs`）留下了当时唯一的可见证据：前 448ms 只有路由级 520px 骨架，`app=false`，且骨架出现之前有一段完全空白。

修法（`src/main.tsx:58`）：预取改 fire-and-forget，边界负责等待。

```tsx
void route?.loader?.({ queryClient, hash: window.location.hash }).catch(() => undefined);
mount();
```

技能原文「Route loader 预取 + useSuspenseQuery 共用一次请求」在修完后依然成立（F2：bootstrap 恰好 1 次请求），所以这条缺陷**不可能靠复读条款发现**，只能靠把延迟做出来再逐帧看。

### 7.2 异步校验结论不参与步骤闸门

技能完全没提这件事，而它正是表单密集场景最容易出事的地方：`subdomain` 显示「已被占用」时用户仍能进入评审步并提交。修法是让闸门读同一份异步结论（`WizardPage.tsx:80-93`，`asyncBlockers(map, values)` 进 `validity`），提交路径再读一次 ref 快照（`:156`）。判据有六种拦法（E13/E13b）：未校验、校验中、已占用、保留名、服务端失败、**令牌与当前值不符（乱序回写）**。

H15a–H15e 走完整闭环，其中 H15e 是本轮第二贵的一次测试自身缺陷：被拦下的点击停在第 1 步，断言却假设换回可用名后点一次就到第 4 步，量到 `STEP 2/4` 就报了 FAIL。修法是把「闸门重新打开」写成逐点击重走 1→2→3→4，并断言中途不再锁。

### 7.3 提交成功后草稿复活

提交成功只清了 React 状态，没清 localStorage（`WizardPage.tsx:172` / `:400` 补 `clearDraft()`）。M3–M5 与 K4 现在两头夹：K4 断言真浏览器里提交后 `localStorage` 为空，M5 断言敌意草稿逐项消毒后回落第 1 步并显示「丢弃」。

### 7.4 两处只有真浏览器能看见的样式缺陷

- **AA 对比度不达标**：`paper-grid` 次要文字 4.17:1（<4.5）。只加深 `muted` 会破坏「轻」的观感，最终 `bg/paper/paperAlt` 一起提亮，正文 11.37:1、次要 5.29:1 同时达标（`registry.ts:63`、`:129`）。颜色令牌不是 14 个独立旋钮。
- **同权重选择器的源序陷阱**：签名层 `[data-fd-style=concrete-rose] .fd-panel` 与结构层 `[data-fd-style] .fd-panel` 权重相同，签名块放前面时结构层的 `border:` 简写把 5px 模板边静默重置成 1px —— jsdom 完全看不出来，只有 `getComputedStyle` 报出 `bw=1px`。修法（`registry.ts:211`）：`return \`${tokens}\n${STRUCTURAL_CSS}\n${signature}\``，签名永远最后。D7b 现在专门断言这条边是 ≥3px。

---

## 8. 两条条款的消融实测（本轮真正的产出）

### 8.1 memo：一次击键看不出任何差别，30 次才分道

同一份源码两次构建，只差 `__FD_MEMO__`（字节 633,905 vs 633,927，差 22B）。jsdom 里给每个字段叶子挂渲染计数器：

| 指标 | memo 臂 | plain 臂 |
| --- | --- | --- |
| 一次击键的字段渲染次数（N2b） | 7 | 7 |
| 30 次击键 · 字符数不变（N5） | 7 | 210 |
| 30 次击键 · 长度逐次变化（N6） | 7 | 210 |
| 两种情形各 30 击的墙钟（N7） | 156 ms | 314 ms |
| 两臂归一化 DOM（N1） | 完全相同 | |
| blur 反向控制（N6d/N6e） | props 真变时立刻跟上，dirty chip 与 plain 臂一致 | |

三个可迁移的判断：

1. **只看一次击键会得出「memo 没用」的错误结论**（N3 明写了这条错误结论），因为第一次提交谁都省不下来。收益在连续输入上兑现，量级 ≈ 在场字段数 n 省掉 n−1 个。
2. **收益来自 uncontrolled register**：输入值根本不经过 props（N6b），所以连「被输入的那个字段」都命中浅比较 —— 这是条款原文没说的机制。
3. **省下的不是被冻住的旧界面**：必须配 blur 反向控制断言（N6d/N6e），否则一个「永远不重渲染」的实现同样能通过前六行。

技能原文只有一句「Use React.memo, useCallback, useMemo」，没有适用条件、没有量级、没有失效形态。补上判据之后这条才可用。

### 8.2 Suspense 占位：条款对，实现语义错

字段级 176px 边界在 mock 下**从未被采到**（G2b mock = 300/0ms：路由级 520 边界吃掉了整个等待期），只有把接口拖慢才出现（G2b api = 2159/1755ms）。也就是说「无早期 return + Suspense 预留空间」是否真的挡住了位移，取决于**最近的**边界是否覆盖了这段等待。位移实测：`?api=1` 下按钮 909→909px、占位下方说明文字 877→877px、占位高度 176px（G3/G3a/G3c），骨架总时长 mock 300ms vs api 3914ms（G6）。

这也是 07:00 轮那条「骨架取决于最近的 Suspense 边界」的复现与延伸：同一类语义缺口，两轮都在不同位置咬人。

---

## 9. 成本（磁盘现算，分母读上一轮产物，不抄报告）

| 指标 | 本轮（向导） | 07:00（同 skill × 管理后台） |
| --- | --- | --- |
| src 文件 / 行数 | 35 / 3,516 | 50 / 2,154（1.63× 行数，文件更少） |
| 单文件 bundle | 633,905B / gzip 196,704B | 720,722B / gzip 223,845B（0.88×） |
| 三页预览合计 | 1,903,400B | 2,163,587B |
| 场景目录体积 | 清理后 2.31MB / 64 个文件（构建期 J6 口径 2.34MB / 72 个，含 .tmp-check 断言 JSON，见 §13） | 2.39MB |
| 证据构建入口 / 全套 | 486,787 / 634,874B | — |
| 可延迟重量占比 | 23.3%（L3b） | 29% |
| 校验脚本行数 | 清理后 13 个 .mjs/.sh 共 2,602 行（构建期 J8 读数 2,686 行，含当时的临时探针；此后探针删除、新增 ledger-refill.mjs 与 check-clean 的 C9、verify.sh 的补记卡一行） | — |

表单密集场景的可延迟重量只有 23.3%（评审页 3.00kB + 回执 1.31kB），说明**「懒加载」条款在本场景的收益上限就摆在那里**；两构建总量差 <3%（L5）复现了上一轮的结论：分包只挪首包，不减总量。

---

## 10. 已删除的探针脚本（全文转写，按要求留档）

清理阶段删掉了下面 5 个临时脚本（它们只需要一次，且 check-clean C2 禁止 `.tmp-*` 残留）。内容照录，便于下一轮复现量测现场。

### `.tmp-probe.mjs` —— 两臂 DOM 首字节差异定位（N1 的前身）

```javascript
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const memo = readFileSync(path.join(ROOT, 'dist/assets/main.js'), 'utf8');
const plain = readFileSync(path.join(ROOT, 'dist-plain/assets/main.js'), 'utf8');

async function open(bundle) {
  const vc = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html lang="zh-CN" data-fd-style="paper-grid"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://tideside.test/wizard', virtualConsole: vc });
  const win = dom.window; const doc = win.document;
  win.eval(bundle);
  const wait = (fn, ms = 8000) => new Promise((res) => { const t0 = Date.now(); const tick = () => (fn() === true ? res(true) : Date.now() - t0 > ms ? res(false) : setTimeout(tick, 15)); tick(); });
  await wait(() => doc.querySelector('[data-field="storeName"]'));
  const el = doc.querySelector('[data-field="storeName"]');
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set.call(el, '潮');
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(() => win.__fdBridge.ablation.total('field:') >= 1);
  await new Promise((r) => setTimeout(r, 250));
  const html = doc.querySelector('#root').innerHTML.replace(/ class="[^"]*"/g, '').replace(/ style="[^"]*"/g, '')
    .replace(/ data-(fd-style|style|arm)="[^"]*"/g, '').replace(/\s+/g, ' ');
  win.close();
  return html;
}
const a = await open(memo); const b = await open(plain);
console.log('len', a.length, b.length, 'eq', a === b);
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  if (a[i] !== b[i]) {
    console.log('first diff at', i);
    console.log('memo :', JSON.stringify(a.slice(Math.max(0, i - 220), i + 120)));
    console.log('plain:', JSON.stringify(b.slice(Math.max(0, i - 220), i + 120)));
    break;
  }
}
```

结论：差异只有 1 字节，落在面板把臂名当正文打印出来的地方 —— 归一化函数因此增加 `.replace(/当前臂 (?:memo|plain) · /g, '')`。**「合法差异」要按语义列，不能按属性白名单列。**

### `.tmp-probe2.mjs` —— 击键渲染次数与墙钟的三次重复测量（N 组原型）

```javascript
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const memo = readFileSync(path.join(ROOT, 'dist/assets/main.js'), 'utf8');
const plain = readFileSync(path.join(ROOT, 'dist-plain/assets/main.js'), 'utf8');

async function run(bundle) {
  const dom = new JSDOM('<!doctype html><html lang="zh-CN" data-fd-style="paper-grid"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://tideside.test/wizard', virtualConsole: new VirtualConsole() });
  const win = dom.window; const doc = win.document;
  win.eval(bundle);
  const wait = (fn, ms = 8000) => new Promise((res) => { const t0 = Date.now(); const tick = () => (fn() === true ? res(true) : Date.now() - t0 > ms ? res(false) : setTimeout(tick, 15)); tick(); });
  await wait(() => doc.querySelector('[data-field="storeName"]'));
  win.__fdBridge.ablation.reset();
  const ms = win.eval(`(function(){
    var el = document.querySelector('[data-field="storeName"]');
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    var t0 = performance.now();
    for (var i = 0; i < 30; i++) { setter.call(el, '潮汐社' + i); el.dispatchEvent(new window.Event('input', { bubbles: true })); }
    return Math.round(performance.now() - t0);
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  const counts = win.__fdBridge.ablation.counts();
  const arm = win.__fdBridge.ablation.armName;
  const leaves = Object.keys(counts).filter((k) => k.startsWith('field:'));
  const total = win.__fdBridge.ablation.total('field:');
  win.close();
  return { arm, ms, total, leaves: leaves.length };
}
for (let i = 0; i < 3; i++) {
  const a = await run(memo); const b = await run(plain);
  console.log(`round ${i}: memo ${a.ms}ms renders=${a.total} (${a.leaves} leaves) | plain ${b.ms}ms renders=${b.total} (${b.leaves} leaves)`);
}
```

结论：三次重复稳定在 memo 7 次 / plain 210 次，墙钟 memo 明显更低。**同一份脏实例重复跑**才让人敢把数字写进断言。

### `.tmp-probe3.mjs` —— 真浏览器逐帧采样首版（暴露 909px 假位移）

```javascript
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8177, ORIGIN = `http://127.0.0.1:${PORT}`;
let fixture = null;
const server = createServer((req, res) => {
  const u = new URL(req.url ?? '/', ORIGIN);
  if (u.pathname === '/wizard/bootstrap') { setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(fixture ?? '{}'), 700); return; }
  const f = path.join(ROOT, (u.pathname === '/' ? '/preview/wizard-paper-grid.html' : u.pathname).replace(/^\/+/, ''));
  if (!existsSync(f)) { res.writeHead(404).end('x'); return; }
  res.writeHead(200, { 'content-type': path.extname(f) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const execPath = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const browser = await chromium.launch({ executablePath: existsSync(execPath) ? execPath : undefined, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const warm = await ctx.newPage();
await warm.goto(`${ORIGIN}/preview/wizard-paper-grid.html`, { waitUntil: 'load' });
await warm.waitForSelector('[data-role="meta-step"]');
fixture = await warm.evaluate(() => JSON.stringify(window.__fdBridge.facts.bootstrap));
console.log('host attr present?', await warm.evaluate(() => document.querySelector('[data-min-height]')?.outerHTML.slice(0, 90)));
await warm.close();
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__s = [];
  const tick = () => {
    const host = document.querySelector('[data-min-height="176"]');
    window.__s.push({ t: Math.round(performance.now()), host: host !== null,
      hostH: host === null ? null : Math.round(host.getBoundingClientRect().height),
      skel: document.querySelector('[data-testid="suspense-fallback"]') !== null,
      opts: document.querySelectorAll('[data-field="category"] option').length,
      sel: document.querySelector('[data-field="category"]') !== null });
    if (window.__s.length < 130) setTimeout(tick, 10);
  };
  tick();
});
await page.goto(`${ORIGIN}/preview/wizard-paper-grid.html?api=1`, { waitUntil: 'commit' });
await page.waitForFunction(() => document.querySelectorAll('[data-field="category"] option').length > 1, null, { timeout: 20000 });
await page.waitForTimeout(900);
const s = await page.evaluate(() => window.__s);
console.log(s.filter((_, i) => i % 4 === 0).map((x) => `${x.t}ms host=${x.host?1:0} h=${x.hostH ?? '-'} skel=${x.skel?1:0} opts=${x.opts} sel=${x.sel?1:0}`).join('\n'));
await browser.close(); server.close();
```

结论：fixture 从产物自己的 `window.__fdBridge.facts.bootstrap` 取（G0 断言的就是这件事：不抄第二份表）；700ms 延迟太短，页面挂载时数据已落地，字段级窗口只有一帧宽，「位移」全是噪声。

### `.tmp-probe5.mjs` —— 逐帧采样第二版（抓到 7.1 白屏缺陷的现场）

```javascript
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8181, ORIGIN = `http://127.0.0.1:${PORT}`;
let fixture = null, delay = 0;
const server = createServer((req, res) => {
  const u = new URL(req.url ?? '/', ORIGIN);
  if (u.pathname === '/wizard/bootstrap') {
    console.log('  >> origin got bootstrap, delay', delay);
    setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(fixture ?? '{}'), delay);
    return;
  }
  const f = path.join(ROOT, (u.pathname === '/' ? '/preview/wizard-paper-grid.html' : u.pathname).replace(/^\/+/, ''));
  if (!existsSync(f)) { res.writeHead(404).end('x'); return; }
  res.writeHead(200, { 'content-type': path.extname(f) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const exec = path.join(process.env.HOME ?? '', 'Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium');
const browser = await chromium.launch({ executablePath: existsSync(exec) ? exec : undefined, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const warm = await ctx.newPage();
await warm.goto(`${ORIGIN}/preview/wizard-paper-grid.html`, { waitUntil: 'load' });
await warm.waitForSelector('[data-role="meta-step"]');
fixture = await warm.evaluate(() => JSON.stringify(window.__fdBridge.facts.bootstrap));
await warm.close();
delay = 2200;
const page = await ctx.newPage();
page.on('request', (r) => console.log('   req', r.url().replace(ORIGIN, '')));
await page.addInitScript(() => {
  window.__s = [];
  const tick = () => {
    const host = document.querySelector('[data-min-height="176"]');
    const route = document.querySelector('[data-min-height="520"]');
    window.__s.push({ t: Math.round(performance.now()), host: host !== null,
      routeSkel: route !== null && route.querySelector('[data-testid="suspense-fallback"]') !== null,
      anySkel: document.querySelector('[data-testid="suspense-fallback"]') !== null,
      next: document.querySelector('[data-action="next"]') !== null,
      opts: document.querySelectorAll('[data-field="category"] option').length });
    if (performance.now() < 5000) setTimeout(tick, 8);
  };
  tick();
});
await page.goto(`${ORIGIN}/preview/wizard-paper-grid.html?api=1`, { waitUntil: 'commit' });
await page.waitForFunction(() => document.querySelectorAll('[data-field="category"] option').length > 1, null, { timeout: 20000 });
await page.waitForTimeout(500);
const s = await page.evaluate(() => window.__s);
console.log('frames', s.length);
console.log(s.filter((x, i) => i < 12 || i % 12 === 0).map((x) => `${x.t}ms host=${x.host ? 1 : 0} route=${x.routeSkel ? 1 : 0} skel=${x.anySkel ? 1 : 0} next=${x.next ? 1 : 0} opts=${x.opts}`).join('\n'));
await browser.close(); server.close();
```

两处关键改动都进了 `check-browser.mjs`：**采样预算用时间（`performance.now() < 5000`）而不是帧数**（260 帧上限会在 2.2s 接口回答之前耗尽，导致所有 api 读数变成 0），**窗口以目标宿主节点为锚**。`delay` 提到 2200ms 之后字段级骨架才第一次被采到。

### `.tmp-smoke.mjs` —— 内联产物能否在无模块系统下启动（F1 的前身）

```javascript
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
const html = readFileSync('preview/wizard-paper-grid.html', 'utf8');
const m = /^[ \t]*<script>([\s\S]*?)<\/script>/m.exec(html);
const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errs.push('console.error: ' + a.join(' ')));
const dom = new JSDOM(`<!doctype html><html data-fd-style="paper-grid"><body><div id="root"></div></body></html>`, {
  runScripts: 'outside-only', url: 'https://tideside.test/wizard', virtualConsole: vc, pretendToBeVisual: true,
});
const w = dom.window;
w.localStorage.setItem('probe', '1'); w.localStorage.clear();
try { w.eval(m[1]); } catch (e) { errs.push('eval: ' + e.message + '\n' + (e.stack||'').split('\n').slice(0,4).join('\n')); }
await new Promise((r) => setTimeout(r, 800));
const root = w.document.getElementById('root');
console.log('mountLen', root.innerHTML.length, 'bridge', typeof w.__fdBridge);
console.log('steps', [...w.document.querySelectorAll('.fd-rail-title')].map(n=>n.textContent).join('|'));
console.log('fields', [...w.document.querySelectorAll('[data-field]')].map(n=>n.getAttribute('data-field')).join(','));
console.log('reqLog', JSON.stringify(w.__fdBridge?.api.requestLog?.() ?? null));
console.log('ERRS', errs.slice(0, 6).join('\n---\n'));
w.close();
```

`.tmp-dom.txt` 是同一条 check-dom 中途失败时的输出片段（H15b/H15c 报「字段不在场」+ `type(null)` 崩溃），根因是断言在异步结论落地前就去找 subdomain 输入框；修法是等待条件改用目标值本身，也就是 §7.2 说的 H15 系列写法。

---

## 11. 与技能条款的逐条对账（哪些值得留下）

| 条款 | 落地 | 判定 |
| --- | --- | --- |
| 特性目录 + 四个导入别名 | A3/A3b/A4 | **值得**：本轮 35 文件全部按此结构，别名在三个 vite 配置里共享 |
| `useSuspenseQuery` + 路由 loader 预取 | F2（1 次请求）/ F5 / G 组 | **值得但必须补后半句**：预取不能 gate 首帧（§7.1） |
| 「No Early Returns」 | G5（慢 2.2s 期间标题/步骤条/草稿面板都在场） | **值得**，但语义要按「最近的边界」读（§8.2） |
| React.memo / useCallback / useMemo | N 组 19 条 | **条件成立**：只在连续输入上兑现，量级 ≈ n 省 n−1 |
| 防抖 300–500ms + 卸载取消 | A10 + 350ms 实现 | 值得，无异议 |
| 通知只用 MUI Snackbar、禁 react-toastify | A8 | 值得（依赖面确实小了） |
| 接口统一 `/api/...` 前缀 | A9 记为**偏离**：本产物用 `/wizard/...` | 场景决定，不改动 |
| 颜色一律走 `theme.palette` + `sx` | A15 记为**张力**：三风格共用一份 DOM 时颜色只能来自令牌层 | 多风格任务必须推翻原条款 |
| 分包懒加载 | L1–L5 | 条款本身正确，但本场景收益上限 23.3% |
| TS strict + 显式返回类型 | A12/A13 | 值得，成本极低 |
| `createFileRoute`（TanStack Router） | A4c 记为**不可执行**：需要技能未提供的 codegen 插件，本产物手写 RouteSpec 描述符替代 | 技能缺口 |

---

## 12. 结论：是否留用

**留用**，定位与前两轮一致：**规范补充 / 写法清单**，不是正确性来源。理由：

1. 它给的写法（特性目录、别名、Suspense 数据获取、Snackbar 收口、strict TS）落地成本极低且全部可断言，多风格共用一份 DOM 的产物能被它约束住。
2. 它的三处绝对化措辞都在真实测量里塌了或需要补条件：Suspense（取决于最近的边界）、memo（只在连续输入上兑现）、loader 预取（不得 gate 首帧）。这三条都是**同产物消融**才判得动的，读措辞永远读不出来。
3. 契约无资产（10 个缺失引用文件）连续三轮未修复。若下一轮仍不修复，该降级为「仅作关键词提示的目录」使用。

不适合让它单独承担的任务：任何需要「判据」的验收（它不提供判据）、任何多风格/主题化需求（它的样式条款与多风格互斥，见 A15）。

---

## 13. 台账写回与推送（本轮收尾）

- 写回前快照：`scripts/ledger-snapshot.json`（tried=18 runs=18 styles=54 env=110 seen=19 candidates=44 log=30，updated=2026-09-26T08:18+08:00）。快照本轮新增 `triedCombos`（每条历史 skill×场景的 sha1），因为 I1c 的查重需要「写回前已有哪些组合」，而快照本身只存哈希不存正文 —— 第一版漏了这个键，check-node 直接 `snap.tried.some is not a function` 崩在断言之前。
- 写回：`FD_LEDGER_UPDATED=… FD_SEEN_STATUS=… node scripts/ledger-apply.mjs`（一次性，重复执行会拒绝）。本轮同时修掉它的一个静默缺陷：消费排队项用的是 `startsWith(QUEUE_HINT)`，而台账的优先项一律以 `★ ` 开头，于是「已消费的排队项」根本没被出队（V11 会红）。改为 `includes` 并补一张复查卡。
- 补记：新增 `scripts/ledger-refill.mjs` —— 把只能在删掉构建中间物之后才知道的三个字段（artifact_size / cleanup / push）与本轮 TRIED / WORK_LOG_LINE 回灌进台账，写前逐一核对「末条确实属于本轮」，避免手写 JSON 与 `verify-ledger` V3 的全字段 deep-eq 打架。
- 断言总数：写回前 283（check-node 101 + check-dom 112 + check-browser 70，`bash scripts/verify.sh` 退出码 0），写回后 I 组从 6 条切到 16 条，复跑得 **293**；清理后 `check-clean` 20 条、`verify-ledger` 12 条 → 本轮累计 **325**。这两张卡在收尾时各长出一条，而且两条都抓到了真东西：
  - **C9「无孤儿脚本」**：每个 surviving 脚本必须被 `verify.sh` 的某张卡点名（可以是步骤，也可以是「跑在清理之后」那两张注释卡），否则算孤儿。它一跑就红 —— `verify.sh` 的台账卡里没有 `ledger-refill.mjs`，即「本轮新增的收尾卡不在复现文档里」，下一轮照着 `verify.sh` 重建就拿不到回灌字段，只能手改 JSON，而 `verify-ledger` V3 是逐字段 deep-eq，手改必然打架。`verify.sh` 补一行卡片后 20/20 绿。
  - **V12「候选确实入队」**：报告 §14 写了「已排入台账」，就得由台账自己的复查卡证明，而不是由作者的意图证明。同时它禁止重复排队（集合大小 = 长度）。
- 清理：删 `node_modules`（159MB）、`dist`、`dist-plain`、`dist-split`、`.tmp-check`、5 个 `.tmp-probe*` / `.tmp-smoke` 探针（内容转写进 §10）与 4 个转储文件。断言原文读数保留在 `evidence/`（三份 JSON，61,034B）。`check-clean` 本轮改了五处期望值：C1 增加 `dist-plain`、C2 把 `.tmp-*` 一律算残留、C6 改为要求 `styles.html`（见 §4 第 3 条）、C8 从上一轮抄来的 50 个源文件改成本轮的 35 个、新增 C9 —— 前四条里 C8 是复制脚手架留下的僵尸期望，靠复跑才发现。
- 体积与文件数（最后一次现算：64 个文件 / **2,422,797B**，写完本节后 `artifacts/` 内不再改动；本报告与 `records/`、`state/` 在统计范围之外）：preview 1,903,400B/3 · scripts 186,133B/15（13 个 .mjs/.sh = 2,602 行 + `build-inline-meta.json` + `ledger-snapshot.json`）· src 137,642B/35 · package-lock.json 116,226B/1 · evidence 61,034B/3 · 根配置与 `styles.html` 18,362B/7。
  - 单位口径要说清：`check-clean` C5 用 `bytes/1024²` 打印却写作「MB」，所以它打印的是 **2.31 MiB**，十进制是 2.42MB；上限 50MB 也按同一口径判。本轮把台账与本报告统一改写成「2.31MB / 64 个文件」并把字节数交给 C5 现打印，因为**这个字节数包含 round-facts.mjs 自己** —— 只要字段里硬抄字节，改文案就让它过期（上一轮「报告写 2.38MB、实测 2.39MB」正是手抄；本轮收尾阶段同一数字为了追自己的改动重测了四次）。
  - 构建期 J6 的 2.34MB / 72 个文件是另一口径（含 `.tmp-check/` 断言 JSON 与探针）。两者之差就是清理删掉的东西 —— 同一事实只留 C5 一处现算值，其余位置引用它并标注口径。
- 推送：走 `git@github.com:sunc-Q/frontend-skill.git` 的 main 分支（本机 github.com HTTPS 被 TLS 层重置），known_hosts 写在 `LAB/.tmp/` 并随 `.tmp` 删除；提交身份用内联 `-c user.name/user.email`，不改任何全局 git 配置；命令与文件里没有任何 token。区间：主体 commit `4607391`（67 files / 13,062 insertions = 产物目录 64 个文件 + 本报告 + `state.json` + work-log 末行），`c9e0541..4607391` 已推到 origin/main。补记 commit 的内容就是「`RUN.push` 回填 + `NEXT_CANDIDATES`/`ENV_NOTES` 追加 + 本节」，它的区间是 `4607391..<自己的 hash>` —— 正文不能包含自己的 hash，所以收尾后跑 `git log -1 --format=%H origin/main` 读回来的就是右端点；`state.runs[-1].push` 里写的是主体区间与这段说明，`verify-ledger` V10 只要求它已回填且含 `..`。

---

## 14. 下一轮候选

1. ~~★ 把本轮的「双臂同产物消融」配方移植回 16:00 Vue 轮与 17:00 vercel-react 轮的 memo / 稳定引用条款~~ —— **这条早已在台账排队**（写回前快照 `next_candidates[2]`：「frontend-development 其余绝对化条款的同产物消融：把本轮 ?control=early 配方移植到『memo 化行组件』『queryKey 常量化=稳定引用』两条，并回打 16:00 Vue 分支…」）。本轮实测把它从「想法」升级成「配方」（两臂字节差 22B、7 vs 210 次、blur 反向控制），但**不重复排入队列** —— 台账的查重契约对候选同样成立，重排一条等于把队列当记事本。
2. ★ frontend-development × 路由与代码分割密集场景（多页站点/门户）：本轮 23.3%（L3b）的收益上限是表单场景的特征，不是条款的；换场景才知道它是否名副其实。→ 已排入台账。
3. ★ vercel-react-best-practices × 表单密集多步向导：复测「字段级异步校验必须参与步骤闸门」的可发现性 —— 两轮下来没有任何一个技能提到过它。→ 已排入台账。

第 2、3 条由 `scripts/round-facts.mjs` 的 `NEXT_CANDIDATES` 导出、`ledger-refill.mjs` 幂等追加（已在队里就不加），并由 `verify-ledger` V12 反向核对「报告承诺排队的，队列里确实有；且队列无重复」。第 1 条故意不在 `NEXT_CANDIDATES` 里，理由见上。
