/**
 * Single source of truth for this round's ledger increment.
 *
 * scripts/check-node.mjs group I, scripts/verify-ledger.mjs, scripts/ledger-refill.mjs and the
 * one-shot write-back all import this file, so what lands in state/state.json and
 * records/work-log.md is exactly what the idempotency lock asserts — a re-run cannot add a second
 * copy and a partial append is caught. No number here is copied from a report: each one is the
 * printed/detail value of a named assertion, listed in the same order groups/checks.md reads it.
 */
export const ROUND_ID = '20260926-12-frontend-development-blog-portal';

/** The queued phrase in the pre-write state.next_candidates that justified this topic pick. */
export const QUEUE_HINT = 'frontend-development × 路由与代码分割密集场景';

export const TRIED = {
  skill: 'frontend-development（用户 2026-09-25 装入 ~/.qoder-cn/skills/，第 4 次使用）',
  scenario:
    '博客内容门户（虚构「灰度通讯 GRAYSCALE」发布/观测/故障复盘私站，排队项点名的「路由与代码分割密集场景」：4 条 hash 路由 + 1 个懒图表面板 = 5 个独立代码分割点，路由层用 RouteSpec 描述符 + loader 预取 + useSuspenseQuery 同键复用；240 篇虚构文章由 src/lib/facts.ts 一份语料推导，虚拟滚动列表 + 350ms 防抖检索 + 三向排序 + 密度切换 + 标签筛选 + 收藏持久化 + 归档按年/月索引 + 正文页相关文与上一篇/下一篇 + 读数面板按需取数）',
  styles: ['等高线战术图 topo-tactical', '黏土定格动画 clay-stop', '黑胶唱片架 vinyl-crate'],
  time: '2026-09-26T12:00+08:00',
  reason:
    '排队项 45 的原文问题：08:00 向导轮量到「可延迟重量占比」只有 23.3%，那是表单场景的特征还是懒加载条款的上限？换到路由与分割最密集的形态才知道这条条款是否名副其实，判据沿用同一对构建（单文件内联预览 vs dist-split 证据构建）。同时该技能三条绝对化条款（虚拟滚动处理大列表 / memo 化行组件 / queryKey 稳定引用）在 07:00、08:00 两轮都只被「用到」而从未被单独定价——本轮用四臂构建（同一份源码只换 __FD_ARM__）把它们各自值多少量出来。',
  conclusion:
    '留用，且本轮把它从「写法清单」升级为「必须自带消融的清单」。①排队问题有答案了：路由与分割最密集的场景可延迟重量占比只有 9.4%（L3b：入口 282,817B / 全部 chunk 312,157B，可延迟 29,340B），比 08:00 表单场景的 23.3% 还低——「懒加载」条款的收益上限从来不由场景的分割点数决定，因为 React 与 React Query 运行时占掉九成且无法延迟；这条判据现在有两个落盘点，可以当跨轮基线。②三臂消融（N 组，四臂字节完全相同 307,155/307,155/307,155/307,155）：虚拟滚动值 229 个 DOM 行（240→11，真实像素下 11 行/视口 558px/内容 15,840px）；memo 行组件值 5.4 倍渲染（3 次击键 10 次 vs 54 次，每击键 3.33 vs 18），且列表容器渲染两臂相同（5 vs 5）证明省的确实在行这一层；queryKey 不稳定是唯一「坏掉」而不是「变慢」的一臂——1.5s 窗口 89 次读（主臂 1 次）、真 HTTP 2s 窗口 16:1、至今从未画出任何一行，另外三臂只是变慢。技能原文三句话给的是同等语气，实测价值量级完全不同。③本轮最贵的结构缺陷不在技能条款里而在条款没说的地方：把 <Layout> 放在路由组件内部时，路由级 fallback 连站名、导航、全站统计、页脚一起吞掉，1.8s 慢接口下整页只剩占位、页脚位移 1,066px（G8d3）；把 chrome 提到边界之外后 masthead/stats 全程 0px 位移（G8d），残余 386px 被如实报成「固定预留 520px 对 907px 内容的欠挡」而不是被断言掉——技能只说「用 Suspense 包住懒组件」，没说边界挂在哪一层，而这一层决定的是整页可用性。④成本对照（分母现读盘）：单页 311,053B / bundle 310,329B = 08:00 向导轮的 0.49×、07:00 后台轮的 0.43×，src 44 文件 2,648 行（J1 与 wc -l 同口径）——路由数翻倍并没有让产物变贵，因为贵的东西是运行时。⑤技能契约第 4 次复跑仍无资产：SKILL.md 引用的 11 个资源文件（resources/*.md 与 ../../vite.config.ts）100% 缺失（A1c/A1e），连它声明别名所在的 vite.config.ts 都不存在（A1f），可机检的 15 条一行摘要条款全部由本轮自建判据兑现（A2c）。⑥三皮肤主张首次在真浏览器里逐条兑现：结构层零字面颜色（C2）、三页 <script> 载荷逐字节相同 307,155B（B2）、分隔手法 ruled-grid/offset-shadow/cut-groove 与热帖手法 left-bar/badge-lift/label-invert 实测互斥（D9/D9b）、行高令牌 66/78/72 真的画出对应像素（D1）、12 维计算样式指纹两两差异 7~12/12（D8）；一处只有真浏览器能抓的缺陷：topo muted 在 Node 侧按 bg 算得 5.68:1 而文字实际落在 paper 上、量出 4.2:1 不达 AA，令牌改深到 #565a46 后 4.83:1。⑦持久化跨载体（M 组，同一浏览器实例）：file:// 与 http:// 是两个 origin、同一个键互不相通且各自选中自己的皮肤；敌意输入有界——非 JSON 草稿回落默认并照常画行，5,000 项星单截到 60 条上限（落盘 1,097B）。⑧299 条断言全绿（写回后 I 组把 work-log 行数假设拆成 I8a/I8b，check-node 121→123 / check-dom 88 / check-browser 88）；踩坑 17 条另记 environment_notes；收尾删 node_modules 与五套 dist*/构建日志/探针，产物目录形态由 check-clean C1–C9 断言（C3a/b/c 点名 7 个 HTML 各自的角色：3 交付页 + 3 消融臂宿主 + 1 证据构建宿主）',
  artifacts: `artifacts/${ROUND_ID}/`,
  report: `reports/${ROUND_ID}.md`,
};

/** Filled with the write-back-time value; the 补记 commit rewrites it from disk. */
export const PUSH_TEXT =
  '已推送 origin/main（两次提交：首轮写回 + 补记；github.com HTTPS 被 TLS 重置，走 SSH，host key 写入 gitignored LAB/.tmp 后随清理删除）';

export const RUN = {
  time: TRIED.time,
  skill: 'frontend-development（第 4 次，博客内容门户 / 路由与代码分割密集场景）',
  scenario: '博客内容门户（4 路由 + 1 懒面板 / 240 篇 / 虚拟滚动 / 防抖检索 / 收藏持久化）',
  result: 'success',
  assertions:
    '299 条全绿（check-node 123：A 条款 / B 自包含不变式 / C 三皮肤令牌 / E 事实源同源 / L 分包证据 / J 成本对照 / I 台账锁；check-dom 88：F 首屏与 single-flight / H 交互全链路 / N 四臂消融；check-browser 88：D 计算样式与对比度 / G 真 HTTP+真 chunk 台账与逐帧位移 / K 真实滚动键盘点击 / M 双载体持久化）+ 清理后 check-clean 与 verify-ledger 两张复查卡',
  artifact_size:
    '2.18MB / 2,285,809B / 76 个文件（清理后现算，上限 50MB，口径同 check-clean C5——C5 现在无条件打印实测体积，绿了也打印，因为它就是本字段的取数处；构建期同一目录还压着 119MB node_modules + 五套 dist ~1.5MB，所以这个数字只在清理后成立）。逐项：preview 1,865,748B / 7 件（3 交付页 311,053 / 311,051 / 311,045 + 3 消融臂宿主 310,756 / 310,756 / 310,738 + 1 证据构建宿主 349）、scripts 201,418B / 16 件（13 个 .mjs + verify.sh + ledger-snapshot.json 与 build-inline-meta.json 两份证据 JSON）、src 103,596B / 44 件、根配置 110,616B（package-lock 83,204 + styles.html 21,567 + 三份 vite 配置与 tsconfig/package.json/.npmrc）、server/mock-api.mjs 4,431B。字节不硬抄：本文件自己也参与统计，改这行文案就会同时改掉目录读数，最后一次 C5 读数写在报告 §13，两处之差即自指证据',
  cleanup:
    '已执行：删 node_modules 119MB + 五套构建产物 dist / dist-nomemo / dist-novirtual / dist-unstablekey / dist-split（各 ~304KB）+ .tmp-check 76KB（299 条断言读数已经 scripts/make-styles.mjs 转写进 styles.html 与报告）+ .npm-install.log + .smoke.mjs 与 scripts/.facts{,-entry}.mjs（esbuild 桥临时件，probe-corpus.mjs 与 tmp-diag.mjs 两个探针全文转写进报告 §10）。目录 123MB → 2.18MB，三页与三臂宿主保持双击即开；技能目录与 前端skill实验室 之外零写入；LAB/.tmp（known_hosts）随推送收尾删除',
  push: PUSH_TEXT,
};

/**
 * ledger-apply pushes the first 14 (hit while building + while writing the report); the rest were
 * only discovered after the write-back, and ledger-refill appends exactly those (idempotent filter).
 */
export const ENV_NOTES = [
  'JSDoc 注释里出现 `*/`（本轮是路径 glob `dist*/`）会直接终止块注释并把后续内容当代码解析，报一个离真因很远位置的 SyntaxError；自查时 `node --check x.mjs | head` 的退出码是 head 的，永远为 0，会掩盖这条——要么不接管道，要么 `; echo exit=$?`',
  '「行高令牌到底有没有画出这一行」这类断言，必须先让被断言的元素真的承受该高度：本轮 .row 只有 100% 高度继承才生效，此前它按内容渲染成 46/50/65px，而 D1/K4 读的是 .vrow 槽位的 66/78/72px——断言全绿但量的不是画出来的那一行（改 .row{height:100%} 后 44 处计算样式探针才与令牌对得上）',
  'Node 侧按令牌算的 WCAG 对比度与浏览器量的不是同一对颜色：文字实际落在 --c-paper 上，而脚本按 --c-bg 算，topo muted 于是「预测 5.68:1、实测 4.2:1」——凡是页面有底色与卡片色两层，对比度断言必须显式写出分母是哪个令牌，否则 AA 会静默假通过',
  '证据构建（dist-split，ES 输出）在 /preview/split-host.html 下 404：Vite 的相对 base 让预载映射表把 chunk URL 解析到 /preview/，必须写绝对 base=「/dist-split/」；同一台 mock origin 里 /api/* 也全 404，因为路径键用 slice(4) 剪掉了「/api」四个字符而留下前导斜杠，应为 slice("/api/".length)',
  '选择器少写一个右括号（「[data-testid="result-count"」）在 `await page.waitForFunction(...).catch(()=>undefined)` 里永远不会抛错——它只会稳定返回 false，于是「条件等待」退化成一记固定 sleep，测试照常通过；写 wait 的条件时要另加一条「这个条件不成立时断言必须失败」的自检',
  '跨路由/跨标签的计数器必须先归零再量：G6 把上一页的 /api/post 读记进了归档页的台账（arrivals 未在导航前 reset），G9 的「稳定臂 1 次」被同一浏览器里仍在循环的不稳定页污染成 25 次——跑对照臂之前要 page.close() 上一页，光换 URL 不换 tab',
  '逐帧位移统计里，元素尚未挂载的帧必须是 null 并被过滤掉，不能当 0：本轮 driftOf 把挂载前的 null 帧读成 0，凭空造出 20px/101px 的「chrome 在动」，而真实位移是 0；同理「预留高度 == 内容高度」的等式因取整天然差 1px，要留 ±3 容差而不是把等式写死',
  '把多组测量收进同一个函数时，函数内部的 ctx.close() 会连带关掉调用方共享的 context：本轮 carrier() 从「每载体一个新 context」改成「同一浏览器实例跑两个载体」后，第二个载体直接被关掉；改共享时要顺手把资源释放移到调用方',
  '刷新（reload）会清掉挂在 window 上的临时值，凡是「刷新后回读某个下标」的判断必须把下标随参数重新传入，不能指望 page.evaluate 之间的全局状态存活',
  '「file:// 冷启动没有写过任何偏好」这个初始假设是错的：应用启动就会把默认信封落盘，于是 M1/M5 的 stored===null 断言必然失败。诚实的口径是「冷启动落盘的是默认信封（starred 为空）」而不是「什么都没写」，M1 的期望值随之改成「version=3 且 starred.length=0」',
  '同一份 DOM 里断言「第 N 行的按钮回到已收藏态」不能用全局选择器 + 固定下标：两个载体点的是不同行（第 1 行 vs 第 3 行），要按行下标取并回读 pressedRow 与自己传进去的下标比对，否则量的永远是别人的按钮',
  '直开 file:// 页面时 location.hash 是空串而不是「#/」，凡把「回到首页」写成 hash===「#/」 的断言在 http:// 下能过、在双击载体下必红；导航类断言要接受两个值（hash 为 #/ 或空串）并另断言行数>0，否则「空 hash 且空列表」也算通过',
  '生成型对照页（styles.html）里任何手打的汇总文案都会在数据变化后与新事实矛盾——结构校验（表格有 8 行、无 NaN）抓不到「语义过时」。本轮把每一格都改成从 .tmp-check/assertions-*.json 的 detail/printed 现取（连 version=3 信封的三个字段都用正则从落盘原文切片里读），只留断言 id 是手写的',
  '校验脚本自己也会撒谎：A1b/B2/N10 三条把 String.length 当字节数打上「B」，而同一份产物里有中文文案——载荷 307,155 字符实为 310,329 字节（B4 用 Buffer.byteLength 算的才是字节）。凡是断言里出现单位，单位必须由计算方式给出（byteLength/length 二选一写死在 id 文案里），否则报告与页面会把字符数当体积引用',
  '写回之后才复跑的 I 组暴露了两条只有「第二次运行」才能抓到的自反错误。① I8「work-log 行数 = 快照 + 1」被并行任务打败：仓库结构调整在快照之后追加了一行非轮次记录，32→34，而台账契约其实是 append-only + 本轮一行，不是「除了我没人能写日志」——改成 I8a（快照前缀 sha1 逐字节不变）+ I8b（快照之后以 WORK_LOG_LINE 行首「时间 | 技能」为键的自有行恰好 1 个且位于末行）；识别自有行不能 substring 匹配产物目录，那条 14:15 的行里也写了 artifacts/20260926-12-…，最初版本因此把 1 行判成 2 行。verify-ledger 的 V7/V8 同一条 +1 假设一起改，且 V8 拿「自有行」而不是「末行」比字节，否则并行任务在本轮收尾之后再插一行就会把正确的写回判成失败。② I10「三风格与全台账零字面撞车」在写回成功的瞬间变成自撞——state.used_styles 已经含本轮那 3 项，基准集要显式 filter 掉自己，顺手断言过滤条数 == 3 等于复跑一次 I5。教训：凡「相对整本台账」的去重/幂等断言，都必须先声明基准集是「写回前」还是「写回后」，只在一种状态下跑过的断言不算被验证过',
  '行数计数的口径也要写进断言 id：`content.split()` 按裸换行切分会在每个文件末尾多算一个空串行，J1 于是报 2,692 而读者用 wc -l 复核得到 2,648（44 个文件各差 1）。改成先 replace 掉行尾换行再计数，并把「与 wc -l 同口径」写进 id——和字符数当字节数同源，任何计数都得说清怎么数的',
  '清理会废掉自己的复跑能力：dump-facts 的 esbuild 桥依赖 node_modules，删完 node_modules 之后 check-node / check-dom / check-browser 三张卡都跑不动了（ERR_MODULE_NOT_FOUND），只剩 check-clean / verify-ledger / ledger-refill 三张只读卡。所以「写回后复跑 I 组」必须排在清理之前，写回后的新读数（299 条）要先经 make-styles 转写进 styles.html 与报告再删 .tmp-check；verify.sh 里两组卡的排序注释就是为这件事写的',
];

/** Report §排队: these are enqueued by ledger-refill.mjs (idempotent). */
export const NEXT_CANDIDATES = [
  '★ 把本轮 G8 的「Suspense 边界层级」式子（逐帧量 chrome：masthead/stats 的 top 位移必须为 0，且占位高度与内容高度之差 == 页脚位移）移植回 07:00 后台轮、08:00 向导轮与 16:00 Vue 分支产物：那几轮同样把页头/页脚写在路由组件内部，等待期整页外壳被 fallback 吞掉的缺陷很可能一直在，而它们当时只量了「骨架是否出现」、从未量「骨架之外还有什么」',
  '★ 「可延迟重量占比」跨场景曲线补第三个点并修分母：本轮 9.4%（L3b，已落盘）与 08:00 表单场景 23.3%（只在报告文本里、JSON 未留盘）——先重跑 07:00/08:00 两轮的 check-node 让 L3b 落盘，再加一个「单页重图表 / 无限滚动」场景，检验这条指标是否随「非运行时依赖的重量」而非随分割点数变化',
  '★ 消融实验要按「功能失效 / 性能退化」分档：本轮四臂里只有 unstablekey 从未画出一行（89 次读、真 HTTP 16:1），另两臂只是变慢；把这条分档口径回打 07:00 轮 ?control=early（位移 1.7×）与 08:00 轮 __FD_MEMO__（30 击 7 vs 210）两组旧数据，重述它们的结论档次——技能原文把三句话写成同等语气，实测价值量级不同',
  '虚拟滚动条款的另一半：本轮只有「等高行 + 视口窗口」，未测行高不定（富文本摘要折行数不同、图片延迟加载）时该技能是否给出任何可判的写法；配一个不定行高场景，测条款是否会退化成「按平均高度估算」并因此产生可量的位移',
  '★ 把 M4b 的「有界消毒」口径（5,000 项敌意星单截到 60 条、落盘 1,097B）移植回 06:00 活动页 prefs 与 20:00 报名页票根：历轮只验过非法 JSON 与非法枚举，从未验过「形状合法但规模超大」的输入，而那正是把浏览器渲染卡死的量级',
  '三皮肤行高（66/78/72px）会让同一视口下的窗口行数与「本页共 N 篇」的读数口径随皮肤变化——把这个「同一份数据在三种皮肤下读出不同统计口径」的判断题交给 vercel-react-best-practices × 表单向导轮（候选 46）交叉复核，看另一个技能是否自带裁决',
];

export const WORK_LOG_LINE = [
  '2026-09-26 12:00',
  'frontend-development（第 4 次使用，规范型技能，~/.qoder-cn/skills/）',
  '博客内容门户（虚构「灰度通讯 GRAYSCALE」发布/观测/故障复盘私站，**排队项点名的「路由与代码分割密集场景」**：4 条 hash 路由 + 1 个懒图表面板 = 5 个分割点，RouteSpec 描述符 + loader 预取与 useSuspenseQuery 同键复用；240 篇虚构文章全部由 src/lib/facts.ts 一份语料推导（E 组：Node 与浏览器经同一 esbuild 桥读数，页面上的阅读总数 = 独立复算值）；虚拟滚动列表 / 350ms 防抖检索 / 三向排序 / 密度切换 / 标签筛选 / 收藏持久化 / 归档年月索引 / 正文相关文与上下篇 / 读数面板按需取数）',
  '等高线战术图 topo-tactical（卡其底 + 正交细网 repeating-linear-gradient + 军械绿 + 标记红、全直角全大写等宽标签、行首 4px 热帖色条，正文 10.44:1／次要 4.83:1） / 黏土定格动画 clay-stop（奶油陶土底 + 26px 大圆角 + 2.5px 粗可可描边 + 8px 硬偏移投影、圆润字形、热帖徽章倾斜抬升，11.1:1／4.96:1） / 黑胶唱片架 vinyl-crate（近黑棕底 + 1px 刻纹凹槽 + 2px 圆角 + 内描边、压缩体字族、热帖标签整块反白，15.04:1／5.99:1）——三套分隔手法与三种热帖手法浏览器实测互斥（D9/D9b）、12 维计算样式指纹两两差异 7~12/12（D8）、三页 <script> 载荷逐字节相同 307,155B（B2）、结构层零字面颜色（C2）、行高令牌 66/78/72 真的画出对应像素（D1）',
  `artifacts/${ROUND_ID}/（体积字节不在此硬抄——本文件自己也参与统计，现算值由 check-clean C5 每次运行打印，逐项拆分见报告 §13；preview/portal-{topo-tactical,clay-stop,vinyl-crate}.html 各 311,0xx B 单文件、双击即开、每页零跨源请求（D0b），另有 3 个消融臂宿主 + 1 个 split 证据构建宿主 + styles.html 三风格对照入口；styles.html 的全部数字由 .tmp-check/assertions-*.json 经 scripts/make-styles.mjs 生成、零手写；src 44 文件 2,648 行（J1 与 wc -l 同口径） + scripts 14 个校验与台账脚本 + verify.sh 从零复现）`,
  '断言 299 条全绿（写回前 297，写回后 I 组拆出 I8a/I8b，check-node 121→123 / check-dom 88 / check-browser 88），结论：**留用，但本轮把它从「写法清单」升级成「必须自带消融的清单」**。①排队问题的答案：路由与分割最密集场景的可延迟重量占比只有 9.4%（L3b：入口 282,817B ÷ 全 chunk 312,157B，可延迟 29,340B），比 08:00 表单场景的 23.3% **更低**——「懒加载」条款的收益上限不由分割点数决定，因为 React+React Query 运行时占九成且无法延迟，这条判据现有两个落盘点可当跨轮基线；②四臂消融（同源码只换 __FD_ARM__，四臂 bundle 字节完全相同 307,155B）：虚拟滚动值 229 个 DOM 节点行（240→11，真实像素 11 行/视口 558px/内容 15,840px，滚动后窗口=真实 clientHeight/scrollTop 复算区间 32:49）、memo 行组件值 5.4 倍渲染（3 击 10 vs 54 次，每击 3.33 vs 18，两臂列表容器同为 5 次证明省的确在行这层），而 queryKey 不稳定是唯一「坏掉」而非「变慢」的一臂（1.5s 窗口 89 次读 vs 1、真 HTTP 16:1、至今从未画出一行）——技能原文三句同等语气的话，实测价值量级不同；③本轮最贵的缺陷不在条款里而在条款没说的地方：<Layout> 放在路由组件内部时被路由级 fallback 连站名/导航/统计/页脚一起吞掉，1.8s 慢接口下页脚位移 1,066px（G8d3），把 chrome 提到边界之外后 masthead/stats 全程 0px（G8d），残余 386px 如实报成「预留 520px 对 907px 内容的欠挡」而不是被断言掉——技能只说「用 Suspense 包住懒组件」，没说边界挂哪一层，而这一层决定整页可用性；④成本对照（分母磁盘现读）：单页 311,053B / bundle 310,329B = 08:00 向导轮 0.49×、07:00 后台轮 0.43×，src 44 文件 2,648 行（J1 与 wc -l 同口径）——路由数翻倍没让产物变贵，因为贵的是运行时；⑤契约第 4 次复跑仍无资产：SKILL.md 引用的 11 个资源文件 100% 缺失（A1c/A1e），连它声明别名所在的 ../../vite.config.ts 都不存在（A1f），可机检的 15 条一行摘要条款全部由本轮自建判据兑现（A2c）；⑥三皮肤主张首次在真浏览器逐条兑现（结构层零字面颜色 C2、三页 <script> 载荷逐字节相同 B2、分隔与热帖手法实测互斥 D9/D9b、12 维计算样式指纹差异 7~12/12 D8、行高令牌 66/78/72 真画出对应像素 D1），一处只有真浏览器抓得到的缺陷：topo muted 在 Node 侧按 --c-bg 算得 5.68:1 而文字实际落在 --c-paper 上、量出 4.2:1 不达 AA，令牌改深 #565a46 → 4.83:1；⑦持久化跨载体（M 组，同一浏览器实例）：file:// 与 http:// 两个 origin 同一个键互不相通、各自选中自己的皮肤，敌意输入有界——非 JSON 草稿回落默认并照常画行、5,000 项星单截到 60 条（落盘 1,097B）；⑧踩坑另记 environment_notes 17 条（注释里出现 `*/` 会终止块注释、.row 的 height:100% 之前 D1/K4 量的不是画出的那一行、令牌层对比度的分母要写死、split 构建的 base 与 mock 路径剪字符、少一个右括号的选择器在 catch 里只会退化成固定 sleep、跨页计数器要归零、未挂载帧不得当 0、共享 context 里的 ctx.close()、reload 会清掉 window 暂存、冷启动其实已经写了默认信封、按行下标回读 pressedRow、直开载体的 location.hash 是空串、生成型对照页里任何手打文案都会与新数据矛盾、校验脚本把 String.length 当字节数打上「B」、写回后复跑才暴露的两条自反断言：幂等卡假设「work-log 行数 = 快照 + 1」被并行任务的非轮次行打败（改成前缀哈希 + 按行首识别自有行），去重卡在写回成功后与自己撞车（基准集须排除本轮三项）、split 裸换行使行数比 wc -l 每文件多 1、清理删掉 node_modules 后 esbuild 桥三张卡再也跑不动（写回后复跑必须排在清理之前））；收尾删 node_modules 与五套 dist*/构建日志/探针（内容转写进报告），目录形态由 check-clean C1–C9 断言（C3a/b/c 点名 7 个 HTML 各自的角色：3 交付页 + 3 消融臂宿主 + 1 证据构建宿主）',
].join(' | ');