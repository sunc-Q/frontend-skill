/**
 * Single source of truth for this round's ledger increment.
 *
 * scripts/check-node.mjs group I and the one-shot write-back both import this file, so what lands
 * in state/state.json and records/work-log.md is exactly what the idempotency lock asserts — a
 * re-run cannot add a second copy and a partial append is caught.
 */
export const ROUND_ID = '20260926-07-frontend-development-admin';

/** The queued phrase in the pre-write state.next_candidates that justified this topic pick. */
export const QUEUE_HINT = 'frontend-development × 管理后台';

export const TRIED = {
  skill: 'frontend-development（用户 2026-09-25 装入 ~/.qoder-cn/skills/，第 2 次使用）',
  scenario:
    '管理后台（虚构「Beacon 信标」短链服务运营后台，与 17:00 vercel-react-best-practices 轮**同场景跨 skill 正面对照**：dataset 事实源逐字段复刻=60 短链/5 密钥/8 事件/14 日趋势/stats 派生口径全部断言相等；功能面=总览 KPI+趋势+事件流 / 短链列表搜索防抖+筛选+三种排序+行展开+暂停+两步删除 / API 密钥打码显隐+吊销 / 服务设置 React Hook Form+Zod 校验+localStorage 持久化）',
  styles: ['软浮雕 neumorph', '1-bit 系统 bitmap', '监护仪荧光 phosphor'],
  time: '2026-09-26T07:00+08:00',
  reason: `台账 next_candidates 排队项「${QUEUE_HINT}（同场景换 skill，与 17:00 那轮正面对照）」；技能已在本地，无需安装与确认；沿用上一轮事实源与功能面使成本对照可控`,
  conclusion:
    '留用但**定位为规范补充，不单独承担多风格任务**。①契约无资产：SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 全部不存在（A 组把这件事变成可复跑的检查而不是抱怨），可用条款只剩一行摘要，约七成绑定 MUI/TanStack/React 具体写法。②真实增量：useSuspenseQuery + RouteGate 让 4 个分区各自取数，D 组实测每页恰好 1 个网络请求、3 个消费者共用 1 次 /links 请求（single-flight 可断言）；但同一条 Suspense 条款埋了本轮最贵的缺陷——技能只说「No Early Returns」，没说骨架取决于**最近的** Suspense 边界，内层 fallback="…" 静默赢过 360px 骨架，骨架整轮从未出现（H1b 抓到，删内层才修好）。③把最可疑条款做成消融：同一份产物加 ?control=early 渲染技能禁止的 if (loading) return <spinner/>，位移 749px vs 429px=1.7×、加载期占位 124px vs 444px——该条款是「减小」而非「防止」CLS，原文绝对化措辞不成立。④成本（对照 17:00 同场景，分母从上一轮产物现读=244,725B 内联 bundle，不抄报告）：单文件产物 720,722B=2.95×，gzip 223,845B；src 2,154 行/50 文件 vs 1,076 行/11 文件=2.00×/4.5×；多出的量主要是 MUI+TanStack 运行时，换来零自研组件与真实计算样式可断言。⑤懒加载条款需要两个构建才判得动：单文件预览把懒块并回首包（L4），证据构建 split 里四个分区 chunk 真实分离、路由级代码可延迟 29%（L1-L3），两构建总量差 <1%（L5）——分包只挪首包不减总量。⑥持久化必须跨载体测（M 组）：http:// 与 file:// 是两个 origin，「双击即开」的 file:// 一样能写 localStorage 且刷新后回填、dirty=0；但 mock 传输是进程内的，链接暂停态刷新即回到事实源，这条限制用断言写死（M5）而不是文档里略过。358 条断言全绿（node 117 / dom 174 / browser 67）',
  artifacts: `artifacts/${ROUND_ID}/`,
  report: `reports/${ROUND_ID}.md`,
};

/**
 * Written by the 补记 commit that lands right after the push: RUN.push must stay identical to
 * state.runs[-1].push, otherwise I2c (which deep-compares the last run against RUN) fails on re-run.
 */
export const PUSH_TEXT =
  '已提交并推送：git@github.com:sunc-Q/frontend-skill.git main 分支 4e10646..fbc7461（主体 commit fbc7461，76 files / 8,876 insertions；随后的 补记 commit 回填本字段与报告 §13 推送区间，同样走 ssh.github.com:443，known_hosts 写 LAB/.tmp/known_hosts 并随 .tmp 一并删除；命令与文件内无任何 token，提交身份用内联 -c，全局 git 配置未改动）';

export const RUN = {
  time: TRIED.time,
  skill: 'frontend-development（第 2 次，与 17:00 同场景正面对照轮）',
  scenario: '管理后台（Beacon 短链运营后台，复刻 17:00 轮同一份事实源与功能面）',
  result: 'success',
  assertions:
    '358 条全绿（check-node 117 + check-dom 174 + check-browser 67）；写回前 I 组台账锁按设计走「尚未写回」分支（5 条），写回后复跑切到「已追加」分支（15 条）闭合；清理后再跑 check-clean.mjs（18 条）复核目录形态；补记 后再跑 scripts/verify-ledger.mjs（11 条，不需要构建产物，是 I 组的清理后可用版）复核台账。累计 358 + 18 + 11 = 387 条',
  artifact_size:
    '2.39MB（check-clean C5 清理后现算，与构建期 J9 同口径；逐项字节与文件数见报告 §13）：三页单文件 721,194 / 721,199 / 721,194B，共用 IIFE bundle 720,722B / gzip 223,845B，index.html 对照入口由断言 JSON 生成；上限 50MB',
  cleanup:
    '删 node_modules 167MB + dist + dist-split + .tmp-check + 四个日志 + 三个 .dbg 探针 + smoke/probe 临时脚本（内容全部转写进报告 §10）；场景目录内零 node_modules/dist/.tmp-check/探针由 check-clean C1-C3 断言（I5 只断预览目录形态：恰好 3 个 HTML、无子目录，因为验证组本身需要 dist）；8157/8158 端口按 PID 核对命令行后释放；技能目录与 前端skill实验室 之外零写入；推送后 .tmp（含 known_hosts）整体删除',
  push: PUSH_TEXT,
};

/** Appended to state.environment_notes — every one of these cost real debugging time. */
export const ENV_NOTES = [
  '技能「契约无资产」的处置办法：frontend-development 的 SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 一个都不存在，用 A 组静态断言把这件事变成可复跑的检查（而不是文档里的一句抱怨）。只剩一行摘要的条款必须自己补可断言判据，否则「按技能做了」与「看起来按技能做了」无法区分',
  'jsdom 不做 CSS 级联：emotion 注入的单类规则会盖住自定义骨架规则，delta 色在 jsdom 里通过、在 Chromium getComputedStyle 里渲染成 muted，--fd-head-size/--fd-head-transform 一度是死 token。凡「组件库主题层 + 自研风格层」的断言只能在真浏览器里量；自研选择器统一加 [data-fd-style] 前缀抬权重',
  '只读校验桥（window.__fdBridge）不要顺手 import 业务模块：bridge 引了 settings 模块就把 zod 拖进首包（512→566kB，SettingsSection 96.8→43kB 说明分包被抵消）。校验用依赖必须是零成本的，判据放 node 侧而不是浏览器侧',
  'Suspense 条款的真实边界：技能说「No Early Returns / 用 useSuspenseQuery」，但骨架是否生效取决于**最近的** Suspense 边界。外层挂 360px 骨架、内层再包 <Suspense fallback="文字"> 时内层静默赢过外层，骨架整轮不出现。修法=断言里显式等 [data-skeleton]，别靠肉眼',
  'React.memo 死代码形态：memo 包在 default 导出上、调用方走具名导入等于没包。实现具名化（XImpl）再 export const X = React.memo(XImpl)，并用渲染次数类断言确认',
  'react-hook-form：reset(DEFAULT_SETTINGS) 会把默认值当作新基线从而清掉 isDirty，「有未保存修改」指示器就此说谎。要「恢复默认但不保存」必须逐字段 setValue(field, v, { shouldDirty: true })',
  '「零外链」这类主张要靠每页网络请求数=1 来断言，字符串扫描必然误报：打包产物里 emotion/stylis 源码含 "@import"、react-dom 含 fetch( 调用，静态扫描全判错；真实浏览器请求计数才是强证明',
  '消融装置优先于争论条款措辞：给同一份产物加 ?control=early 开关渲染被技能禁止的写法，「防 CLS」就变成 749px vs 429px 的可测差值。任何绝对化的渲染条款都该配一个同产物对照组',
  'MUI v7 + React 19 + TanStack Router 手写真机可跑（不需要 @tanstack/router-plugin 的 codegen）：createRootRoute/createRoute/createHashHistory 三条够用。SKILL.md 只演示 createFileRoute，照抄会卡在构建插件上',
  '@mui/icons-material 与 MUI v7 有 peer 冲突（npm ERESOLVE）；本场景改用字符图标即可，不要为一个图标包放宽依赖策略',
  '持久化要按载体测：预览产物宣传「双击即开」=file:// 载体，而全部浏览器断言原本跑在 http://，Chrome 里这是两个 origin。修法=对两种载体各跑一遍「写入→reload→回填」，并顺手把「mock 传输是进程内的、链接暂停态刷新即回事实源」写成断言（M5）而不是文档脚注——否则限制只存在于作者的诚实里，下一轮无人复查',
  '「懒加载」条款在单文件产物上不可判：必须并存一个保留 chunk 边界的证据构建（这里是 vite.split.config.ts），才能断言入口 chunk 不含懒块专属文案、路由级可延迟 29%、两构建总量差 <1%。只有一个单文件 bundle 时，这条技能条款无论怎么写都只是口头承诺',
  '验证脚本要按「清理后还能不能跑」分工：check-node 的 I 组台账锁需要 dist/、dist-split/、.tmp-check/（B6c/L/J 三组读它们），删完中间物必然红。所以台账还需要第二把只读 JSON/MD 的锁（scripts/verify-ledger.mjs，11 条）：它在清理与两次推送之后仍可复跑，V3 把 state.runs[-1] 与 round-facts 的 RUN 做全字段 deep-eq（连 补记 才填的 push/cleanup/artifact_size 都不豁免），比写回当时的 I2c 严一档。凡「只在某个时刻成立」的检查，都要配一张不需要现场环境的复查卡，否则收尾之后的改动等于无人复核',
  '手抄的数字不会自己复查：本报告初稿写「2.38MB / 72 个文件」，那是补齐收尾脚本之前的中间态读数，抄完就没再看；逐文件 stat 复算是 2,507,322B = 2.39MB / 74 个文件，与构建期 J9 写进 index.html 的读数一致。更糟的是我先给这 0.01MB 编了一个自洽解释（J9 早于 make-styles，少算 index.html 的 10,260B），代入旧数居然也能对上——但它被 index.html 里 J9 自己的输出直接证伪。自洽而错误的解释比明显的错误更贵，因为它让下一轮不再检查。规则：同一事实只留一处现算值、其余位置引用；无法现算的手抄值必须挂一条断言或标注「未核」',
];

/** One appended line for records/work-log.md: 时间 | skill | 场景 | 风格 | 产物路径 | 结论 */
export const WORK_LOG_LINE = `2026-09-26 07:00 | frontend-development（第 2 次使用，规范型技能，~/.qoder-cn/skills/） | 管理后台（虚构「Beacon 信标」短链服务运营后台，与 17:00 vercel-react-best-practices 轮**同场景跨 skill 正面对照**：dataset 事实源逐字段复刻=60 短链/5 密钥/8 事件/14 日趋势/stats 派生口径全部断言相等，E 组 13 条；功能面=总览 4KPI+14 日趋势+Top5+事件流 / 短链列表搜索防抖 350ms+状态筛选+三种排序+行展开+暂停+两步删除 / API 密钥打码显隐+吊销 / 服务设置 React Hook Form+Zod 校验+localStorage 持久化） | 软浮雕 neumorph（同底色双向相反符号阴影塑形+零描边+18px 圆角，正文对比度 8.44:1）/ 1-bit 系统 bitmap（1px 实线网格+零圆角零阴影+表头反白+等宽字，17.41:1）/ 监护仪荧光 phosphor（近黑青底+磷绿 text-shadow 发光+repeating-linear-gradient 扫描线+大号等宽读数，17.09:1）——三套手法实测互斥（D13）、七维指纹距离 ≥4（C 组） | artifacts/20260926-07-frontend-development-admin/（2.39MB，零中间物，逐项文件数与字节见报告 §13：index.html=三风格对照入口，页面所有数字由 .tmp-check/assertions-*.json 经 scripts/make-styles.mjs 生成、零手写；preview/admin-{neumorph,bitmap,phosphor}.html 各 721,19x B 单文件，双击即开，实测每页恰好 1 个网络请求；src 50 文件 2,154 行 + scripts 三组 checker + verify.sh 从零复现） | 358 条断言全绿（check-node 117 / check-dom 174 / check-browser 67），结论：**留用但定位为「规范补充」，不单独承担多风格任务**。①契约无资产——SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 一个都不存在，只剩一行行摘要，约七成条款绑定 MUI/TanStack/React；②把最可疑的「No Early Returns」做成同产物消融（?control=early 渲染被禁止的 if(loading) return <spinner/>）→ 位移 749px vs 429px=1.7×、加载期占位 124px vs 444px，条款只能读作「减小 CLS」不是「防止」；③同一条 Suspense 条款的真实缺陷：骨架是否生效取决于最近的 Suspense 边界，内层 fallback="…" 静默赢过 360px 骨架，骨架整轮从未出现（H1b 才抓到，删内层修复）——一行口号不含边界语义；④成本对照（分母从上一轮产物现读 244,725B，不抄报告的 243,433）：产物 2.95×（720,722B vs 244,725B，gzip 223,845B）、源码 2.00×（2,154 行/50 文件 vs 1,076/11），多出的量主要是 MUI+TanStack 运行时；⑤懒加载条款必须两个构建才判得动：单文件预览把懒块并回首包（L4），证据构建 split 四分区 chunk 真实分离、路由级可延迟 29%（L1-L3）、两构建总量差 <1%（L5）；⑥持久化跨载体实测（M 组）：http:// 与 file:// 是两个 origin，「双击即开」同样能写 localStorage 并在刷新后回填、dirty=0，但 mock 传输是进程内的，链接暂停态刷新即回事实源——这条限制写进断言（M5）而不是文档里略过；⑦踩坑另记 environment_notes 14 条（前 12 条构建期、后 2 条是清理与 补记 阶段撞出来的：验证脚本要按「清理后还能不能跑」分工、手抄数字不会自己复查；emotion 级联骗过 jsdom、bridge 误拖 zod 进首包 512→566kB、React.memo 死代码、RHF reset 清 isDirty、createFileRoute 需技能未提的 codegen 插件、@mui/icons-material 与 v7 ERESOLVE 用字符图标规避）；收尾删 node_modules 167MB+dist+dist-split+.tmp-check+日志+探针（内容转写进报告），产物目录内零中间物由 check-clean C1-C3 断言（I5 只断预览目录形态：恰好 3 个 HTML）`;
