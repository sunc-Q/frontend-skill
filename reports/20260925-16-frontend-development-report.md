# 验证记录 · 2026-09-25 16 时段

| 项 | 值 |
|---|---|
| Skill | `frontend-development`（用户本机技能，非内置插件） |
| Skill 位置 | `/Users/apple/.qoder-cn/skills/frontend-development/SKILL.md`（+ `resources/*.md` 10 篇） |
| Skill 来源 | 用户在 2026-09-25 15 时段前后自行装入；无公开链接可核对（GitHub raw / skills.sh 本机不可达） |
| 场景 | 数据报表（个人站「流量与作品表现」月报：KPI + 趋势 + 渠道 + 页面明细 + 洞察） |
| 技术栈 | Vite 8.3.1 + Vue 3.5（`<script setup lang="ts">`）+ Pinia 3 + TypeScript 5.9 strict |
| 三种风格 | 暖纸数据新闻 editorial / 冷灰对账单 statement / 暗色霓虹 cyber |
| 产物目录 | `artifacts/20260925-16-frontend-development-report/`（552KB / 37 文件） |
| 结论 | **留用**（该 skill 第 1 次通过）。它是「规范型」技能：给的是结构约定与检查清单，不给视觉方向；在真实框架工具链下这些约定全部可直接落地，且与 Vue 3 章节自洽。视觉三风格仍要靠人自己定主张 |
| 云端操作 | 无 Sites MCP 调用；产物已推送到 `git@github.com:sunc-Q/frontend-skill.git`（见 §7） |

## 1. 选题过程

- Web 搜索 / skills.sh / raw.githubusercontent.com：**仍不可达**（连接被 TLS 层重置，三次复测一致）。
- 扩展市场：本轮未再申请安装（`install_extension` 强制用户确认，无人值守不得触发）。
- 本机 `~/.qoder-cn/skills/` 已可读：`frontend-development`、`vercel-react-best-practices`、`golang-gin-api`、`nodejs-best-practices`、`SQLite-Database-Expert` 等。
- 台账 `next_candidates` 首项即 `frontend-development × 数据报表`，且与前两轮的 `sites:sites-building` 构成**跨 skill 对照**（不同 skill、不同场景），故本时段执行它。三种风格与已用过的 6 种（瑞士极简/玻璃极光/新粗野主义/深色密集分析/报纸排版/复古终端）不重复。

## 2. 调用方式

```text
Skill(skill="frontend-development")
```
调用后按 SKILL.md 的分支取用：本任务为 Vue 3，因此 React 专属条款（`React.FC`、`useSuspenseQuery`、MUI `sx`、`~features` 别名、`SuspenseLoader`、`useMuiSnackbar`、MUI v7 `Grid size`）**不适用**，只取「通用原则 + Vue 3 章节」。这一点是本 skill 最大的可读性问题：见 §6。

## 3. 该 skill 主张了什么，逐条对照实现

| SKILL.md 的主张 | 本场景落地位置 | 是否可执行 |
|---|---|---|
| `features/{api,components,hooks,helpers,types}/` + `index.ts` 公共出口 | `src/features/report/…`（api/components/helpers/stores/types + index.ts） | ✅ 直接可用 |
| 按领域分组，`components/` 只放真正复用的东西 | 9 个组件全部是报表专属，未建 `src/components/` | ✅ |
| TypeScript strict、禁止 `any`、显式返回类型 | `tsconfig.json` strict + `noUncheckedIndexedAccess` + `noUnusedLocals`；所有函数写显式返回类型（正是这条让 vue-tsc 报出 12 处真实缺陷） | ✅ 价值最高的一条 |
| 组件结构：Props → Hooks → Handlers → Render → 默认导出 | 全部组件同构 | ✅ |
| `defineProps<Props>()` / typed emits / Composition API / `<script setup>` | Vue 3 章节原文要求，`ChannelTable.vue` 用 `defineEmits<{ sort: [key: SortKey] }>()` | ✅ |
| `shallowRef` 存大数据 | `reportStore.ts` 里 `shallowRef<ReportPayload \| null>` | ✅ |
| 搜索防抖 300–500ms | `FilterBar.vue` 350ms + Enter 立即生效 + Esc 清空 | ✅ |
| 不要用「loading 早期 return」，保持布局稳定 | `ReportView.vue` 用骨架块（`.rp-skel`）而不是 `if (loading) return` | ✅（该条写在 React 章节，原则本身框架无关） |
| 样式超 100 行拆独立文件 | 主题 CSS 独立成 4 个文件（base + 3 主题） | ✅ 类比执行 |
| 生命周期清理，防内存泄漏 | `TrendChart.vue` 的 mousemove 走组件内 `onMounted/onUnmounted` | ✅ |
| MUI / TanStack / `apiClient` axios / 导入别名 `~features` | ❌ 全部缺失对应依赖 | 需替换成本栈等价物 |

**它没有主张的东西**（也是本场景真正难的部分）：视觉风格、配色、字体、信息层级、报表口径。SKILL.md 唯一的视觉指引是「Theme access: `theme.palette.primary.main`」这类绑定 MUI 的句子。→ 结论：这是**规范型 skill**，与 `sites:sites-building`（**设计主张型 skill**，强制先写一句视觉主张）互补，不能互相替代。

## 4. 三种风格怎么做

共享同一套组件与同一个 store，只有入口 HTML 的 `class="theme-*"` 与主题 CSS 不同；`cssCodeSplit:false` 让三主题合成一份 21KB CSS。每主题 = 一套令牌 + 少量结构性覆写：

| 风格 | 入口 | 视觉主张 | 结构性差异（不止换色） |
|---|---|---|---|
| A 暖纸数据新闻 | `editorial.html` | 把月报当长文读：纸白、衬线大标题、细分隔线 | 双线分隔、KPI 卡顶部 3px 实边、洞察卡去底色、正文宽度节奏优先 |
| B 冷灰对账单 | `statement.html` | 财务对账单：冷灰底、等宽数字、密排 | KPI 变成「点线引导」账簿行（label····value）、表格斑马线、`@page A4` 打印规则 |
| C 暗色霓虹 | `cyber.html` | 示波器/赛博终端：深空底 + 网格 | 标题 `background-clip:text` 渐变、卡片 `backdrop-filter` 玻璃 + `drop-shadow` 发光折线、胶囊分段控件 |

实测（`getComputedStyle`，因浏览器面板 hidden 无法截图）：

| 断言项 | A | B | C |
|---|---|---|---|
| body 背景 | `rgb(246,239,228)` | `rgb(242,243,245)` | `rgb(8,10,18)` |
| `h1` 字号/字重 | 34px/700 | 38px/700 | 30px + `background-clip:text` |
| KPI 卡 | `border-top:3px`、圆角 2px | `border-top:3px`、圆角 0 | 圆角 16px、外发光 shadow |
| 数据 | PV 均为 `7,196`（近 30 天） | 同 | 同 |

同一份数据、三种互不混淆的版面 → 风格与组件确实可分离。

## 5. 数据诚信（本场景的隐性重点）

`helpers/dataset.ts` 是本地确定性 fixture（页面明标「示例数据」），但**口径必须自洽**，否则报表本身就在说谎。做法：

- 种子 `20260925` + `mulberry32`，且**按日期锚定**取值：跨区间（30d/90d/ytd）同一天的数值完全相同。
- `apportion()` 用最大余数法把渠道访客/浏览量/上期访客**配平到日合计**：渠道访客合计 == KPI 独立访客；渠道 PV 合计 == KPI PV。
- 渠道跳出率、转化率不是随机数，而由日总量**反推系数**（`overallBounce/baseBounce`、`totalContacts/baseContacts`），保证加权后等于全站 KPI。
- 比值型 KPI（人均浏览页数）用 `aggregate(days) = ΣPV/ΣUV`（ratio-of-sums），不是「每日比值的平均」。
- 表格另给 `pageCoverage`（本表覆盖 49.0% 的 PV），不假装「所有页面」。
- 校验：`node --experimental-strip-types` 直接 import 该 .ts，跑 36 项断言（三区间天数、跨表合计一致、跳出率区间合理、上期区间不与本期重叠、涨跌幅 <400% 等）→ **全部 PASS**；浏览器侧再交叉核对：KPI 独立访客 `4,119` == 渠道访客合计、KPI PV `7,196` == 渠道 PV 合计、KPI 跳出率 `40.6%` == 加权跳出率。

## 6. 遇到的问题与修复

| # | 问题 | 处理 |
|---|---|---|
| 1 | SKILL.md 约 70% 篇幅绑定 MUI + TanStack + `~features` 别名，Vue 3 段落只有 60 行、无目录/路由/报表相关约定 | 按「通用原则 + Vue 章节」执行，React 条款逐条判为不适用；建议该 skill 拆出 `resources/vue-*.md` 或在主题指南里标注框架归属 |
| 2 | 「No Early Returns / Suspense / Snackbar」等规则写在 React 专属小节，但其实是框架无关原则 | 迁移为骨架块方案，未照搬 React API |
| 3 | `npx vite build` 在实验室根目录跑：解析不到依赖 | 依赖装在产物目录内，用 `./node_modules/.bin/vite` 绝对路径调用（同时避免 npx 去不可达的 registry 拉包） |
| 4 | `npm install` 走 `registry.npmjs.org` 不可达 | 用可达的 `registry.npmmirror.com`（19M / 3s 装完 vue+pinia，8s 装完 vite+vue-tsc+typescript） |
| 5 | 严格 TS 报 12 处真实缺陷：`days[0]`/`channels[0]`/`ranked[0]` 可能 undefined（`noUncheckedIndexedAccess`）、TS6133 未使用变量、TS2305 默认导出误用、vite.config 里 `__dirname`/`node:path` 类型缺失 | 逐一修复：`?? 空值` 兜底 + `channelOf()` 取值、改 named export、`import.meta.dirname` 并把 vite.config 排除出 include；`vue-tsc --noEmit` 全绿 |
| 6 | 模板内直接 `window.print()` 在 Vue 编译期不可用 | 提取局部 `print()` 函数 |
| 7 | `.rp-bar` 类名被「工具条」和「表格占比条」共用，样式互相污染 | 表格改 `.rp-share` / `.rp-share__text` |
| 8 | 首版 fixture 的 dwell/bounce/contact 与 sparkline 来自无关随机数，渠道合计 ≠ UV 合计，人均页算是「均值之比」 | 重写 dataset（见 §5），Node 侧 36 项断言清零矛盾 |
| 9 | `dist/` 是 ES Module 产物，双击 `file://` 打不开（脚本被 CORS 阻断），与前两轮「可直接双击」的产物习惯不一致 | 增加 `vite.single.config.ts`：按主题单独构建 + `inlineDynamicImports`，再由脚本把 JS/CSS 内联成 `preview/*.html`（114KB/页，双击即用） |
| 10 | 内联时页面静默不渲染（`#app` 空、控制台无报错、title 未被 try/catch 改写） | 根因是 `String.replace` 的替换串里 `$'` 特殊含义：JS 内含 `$` 片段导致文档被自我复制。**必须用 replacer 函数** `html.replace('</body>', () => tag)`。另：`<script type="module">` 在 `file://` 不执行，改成普通内联脚本并移到 `</body>` 前（放 head 会在 `#app` 存在前执行） |
| 11 | browser-use `take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`（visibilityState=hidden） | 全程用 `getComputedStyle` + `innerText` 断言替代像素复核 |
| 12 | 带 `await` 的 `evaluate_script` 多次 15s 超时（页面侧其实已执行完） | 断言脚本一律写成同步、分两次调用（先触发交互，下一次读结果） |

## 7. 产物上传（本轮新增要求）

`https://github.com/sunc-Q/frontend-skill.git` 的 HTTPS 端点在本机被 TLS 重置（`curl (35)` / `git ls-remote https://…` 同错），改走 SSH 成功：`ssh.github.com:443` + 本地 7897 代理，`ssh -T git@github.com` 认证为 `sunc-Q`，远端为空仓库。仓库根设在 `前端skill实验室/`（不越界改动实验室以外的文件），`.gitignore` 排除 `node_modules/`、`.tmp/`、`*.log`。提交内容：三轮 `artifacts/` + `reports/` + `records/work-log.md` + `state/state.json`。命令中不出现任何 token。

## 8. 复现步骤

```bash
cd 前端skill实验室/artifacts/20260925-16-frontend-development-report

# 1) 依赖（默认 registry 指向 npmmirror 才可离线装成功）
npm install vue pinia && npm install -D vite @vitejs/plugin-vue vue-tsc typescript

# 2) 类型检查 / 构建
npx vue-tsc --noEmit                 # 期望：0 错误
npx vite build                       # 多入口 → dist/{editorial,statement,cyber}.html（需 http 服务器预览）

# 3) 单文件双击版（本轮 preview/ 的来源）
for t in editorial statement cyber; do THEME=$t npx vite build --config vite.single.config.ts; done
#    再用 node 脚本把 .single/<t>/page.{js,css} 内联进 preview/<t>.html
#    注意：拼接时 html.replace('</body>', () => tag) 必须用函数形式，否则 $' 会自我复制文档

# 4) 数据口径断言
node --experimental-strip-types /path/to/check-consistency.mjs   # 期望：36 PASS / 全部通过

# 5) 预览
open preview/statement.html          # 或 python3 -m http.server 8000 --directory .
```

`check-consistency.mjs` 全文（临时脚本，收尾时删除，故附在文档里）：

```js
import { buildReport } from '../artifacts/20260925-16-frontend-development-report/src/features/report/helpers/dataset.ts';

const sum = (l) => l.reduce((a, b) => a + b, 0);
let fails = 0;
const ok = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!cond) fails++; };

for (const period of ['30d', '90d', 'ytd']) {
  const r = buildReport(period);
  const kpi = Object.fromEntries(r.kpis.map(k => [k.key, k]));
  const uv = sum(r.days.map(d => d.uv));
  const pv = sum(r.days.map(d => d.pv));
  const contact = sum(r.days.map(d => d.contact));
  const chV = sum(r.channels.map(c => c.visitors));
  const chPv = sum(r.channels.map(c => c.pv));
  const wBounce = sum(r.channels.map(c => c.bounce * c.visitors)) / chV;
  const dayBounce = sum(r.days.map(d => d.bounce)) / r.days.length;
  const convTotal = Math.round(sum(r.channels.map(c => c.visitors * c.conversion)));

  ok(`${period} 天数`, r.days.length === (period === '30d' ? 30 : period === '90d' ? 90 : 268), `${r.days.length}`);
  ok(`${period} UV 合计一致`, kpi.uv.value === uv && chV === uv, `kpi=${kpi.uv.value} days=${uv} channels=${chV}`);
  ok(`${period} PV 合计一致`, kpi.pv.value === pv && chPv === pv, `kpi=${kpi.pv.value} days=${pv} channels=${chPv}`);
  ok(`${period} 联系数一致`, kpi.contact.value === contact && contact === convTotal, `kpi=${kpi.contact.value} days=${contact} conv=${convTotal}`);
  ok(`${period} 跳出率一致`, Math.abs(wBounce - dayBounce) < 0.001 && Math.abs(kpi.bounce.value / 100 - dayBounce) < 0.001, `weighted=${(wBounce*100).toFixed(2)}% daily=${(dayBounce*100).toFixed(2)}% kpi=${kpi.bounce.value.toFixed(2)}%`);
  ok(`${period} 跳出率区间合理`, r.days.every(d => d.bounce > 0.15 && d.bounce < 0.8) && r.channels.every(c => c.bounce > 0.1 && c.bounce < 0.9));
  ok(`${period} 人均页数=总PV/总UV`, Math.abs(kpi.perVisit.value - pv / uv) < 1e-9, `${kpi.perVisit.value.toFixed(3)} vs ${(pv/uv).toFixed(3)}`);
  ok(`${period} 平均停留 60-160s`, kpi.dwell.value > 60 && kpi.dwell.value < 160, `${kpi.dwell.value.toFixed(1)}s`);
  ok(`${period} 上期不重叠`, r.compareLabel.split(' 至 ')[1] < r.days[0].date, r.compareLabel + ' | ' + r.days[0].date);
  ok(`${period} 页面覆盖 < 100%`, r.pageCoverage > 0.3 && r.pageCoverage < 0.75, `${(r.pageCoverage*100).toFixed(1)}%`);
  ok(`${period} 每渠道访客>0 且转化<8%`, r.channels.every(c => c.visitors > 0 && c.conversion > 0 && c.conversion < 0.08), r.channels.map(c=>(c.conversion*100).toFixed(2)+'%').join(' '));
  ok(`${period} 涨跌幅度 |d|<400%`, r.kpis.every(k => k.prev > 0 && Math.abs(k.value / k.prev - 1) < 4), r.kpis.map(k => ((k.value/k.prev-1)*100).toFixed(1)+'%').join(' '));
}
const a = buildReport('30d'), b = buildReport('90d');
const shared = b.days.slice(-30);
ok('跨区间同一日数值一致', a.days.every((d, i) => d.pv === shared[i].pv && d.uv === shared[i].uv && d.date === shared[i].date));
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
```

## 9. 结论与留用判断

- **留用 `frontend-development`**：在「必须写成可维护的真框架代码」这件事上给的是有效约束，不是空话。strict TS 那一条在本次直接产出 12 处真实修复；`features/` 目录约定让换后端时只需要改 `api/reportApi.ts` 一个文件。
- **不适合单独用来做「三种风格」**：它不提供视觉判断，风格仍需自己定主张并逐主题做结构性覆写。后续把 `frontend-development × 管理后台` 与 `vercel-react-best-practices` 组合验证「规范型 skill 叠加」，视觉主张继续由人或 `sites:sites-building` 提供。
- 与内置 `sites:sites-building` 的横向差异已明确：后者产出零依赖单文件、约束在视觉与产品表达；前者产出真工程、约束在代码结构与类型。两者不是替代关系。
- 磁盘：产物 552KB（3 个 114KB 双击版 + 128KB 源码 + 配置），远低于 50MB 上限；`node_modules`（75MB）、`dist/`、`.single/`、服务日志与 `.tmp` 临时脚本已在收尾时删除。
