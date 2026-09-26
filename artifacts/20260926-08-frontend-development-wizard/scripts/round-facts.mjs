/**
 * Single source of truth for this round's ledger increment.
 *
 * scripts/check-node.mjs group I, scripts/verify-ledger.mjs and the one-shot write-back all import
 * this file, so what lands in state/state.json and records/work-log.md is exactly what the
 * idempotency lock asserts — a re-run cannot add a second copy and a partial append is caught.
 */
export const ROUND_ID = '20260926-08-frontend-development-wizard';

/** The queued phrase in the pre-write state.next_candidates that justified this topic pick. */
export const QUEUE_HINT = 'frontend-development × 表单密集场景';

export const TRIED = {
  skill: 'frontend-development（用户 2026-09-25 装入 ~/.qoder-cn/skills/，第 3 次使用）',
  scenario:
    '表单密集多步向导（虚构「潮汐社」手作订阅开店向导：4 步 22 字段 + 异步唯一性校验 + 草稿持久化 + 幂等提交。与 07:00 轮「管理后台里 3 字段设置表单」是**同一技能同一族的正面补测**——上一轮的 RHF reset 陷阱是撞上的，本轮按台账排队项专测表单密集面：步骤闸门 canTravel 只认「目标步之前每步都合法」、subdomain/email 双异步字段（350ms 防抖 + 单调令牌 + 六种拦法）、plan/seats/addons/billing/currency/accountType/invoiceType 联动分支（18 组分支组合的 payload 键集合断言）、报价用「行内累加 vs 闭式」双实现互校、草稿 version=3 信封与敌意输入逐项消毒、内容派生的幂等令牌）',
  styles: ['方格信笺 paper-grid', 'PCB 阻焊绿 pcb-green', '清水混凝土玫瑰金 concrete-rose'],
  time: '2026-09-26T08:00+08:00',
  reason: `台账 next_candidates 排队项「${QUEUE_HINT}（向导/多步校验）」（★ 优先项，且明写上一轮只有 3 字段表单、RHF 陷阱是意外撞上的，值得正面测一轮）；技能已在本地，无需安装与确认；三风格为本轮新造、与 used_styles 54 项历史零撞车`,
  conclusion:
    '留用，但**只当「写法清单」用，别当「正确性来源」用**：本轮它给的最有价值的一条（route loader 预取 + useSuspenseQuery 共用一次请求）同时埋了最贵的缺陷。①契约无资产第 3 次复跑确认未被修复：SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 共 10 个文件全部不存在（A1b），14 条一行摘要条款（A2b）必须自造判据才可证「按技能做了」。② loader 条款只说「预取」没说「别等它」：mount 里 await loader 在 mock（120ms）下完全无害，换到 ?api=1 慢源就变成约 2 秒**纯白屏**——页面从未挂载，任何 SuspenseLoader 都救不了（G 组逐帧采样抓到，改成 fire-and-forget 后 api 两级骨架 2159/1755ms、mock 300/0ms，G2「等待期零空窗」才成立）。③最可疑的 memo 条款做成双臂消融（同源码、只换 __FD_MEMO__）：一次击键两臂都重渲染 7 个叶子（N3，只看一次击键会误判「收益为 0」），30 次击键才分道 7 vs 210 次，墙钟 156 vs 314ms，且**被输入的那个字段也命中浅比较**（uncontrolled register，值不经过 props，N6b）——收益 ≈ 在场字段数 n 省 n-1，条款该写成「连续输入密集处才值得，且必须防住 props 真变时不跟上的旧界面」（N6d/N6e 反向控制）。④技能完全没提「字段级异步校验要参与步骤闸门」，这是表单密集场景最容易出事的地方：本轮自建六种拦法（未校验/校验中/占用/保留/失败/令牌与当前值不符=乱序回写，E13b）并用 H15a–H15e 走完闭环——包括「换回可用名后闸门重新打开」，拦的是当前结论而不是那次失败的历史。⑤三风格同一 DOM 是真的可断言的：三页 <script> 载荷逐字节相同（B2）、结构层零字面颜色（C5）、12 维指纹两两差异 ≥7 且分隔/阴影/字体手法实测互斥（D8–D12）；代价是两处只有 Chromium getComputedStyle 能看见的缺陷——paper-grid 次要文字 4.17:1 不达 AA（提到 5.29:1，底色连带调亮），以及签名层与结构层同权重时**源序**决定胜负，5px 模板边被结构层 border 简写静默重置为 1px。⑥成本（对照 07:00 同 skill 管理后台，分母从磁盘现读）：src 35 文件 3,516 行 vs 50/2,154=1.63× 行数（文件更少、每文件更厚），单文件产物 634,4xxB / bundle 633,905B / gzip 196,704B（后台轮 720,722B 的 0.88×）；懒加载条款仍需两个构建：证据构建入口 486,787B、懒块仅占 23.3%（L3b，表单页几乎没有可延迟的重量）、两构建总量差 <3%（L5）——这条款对本场景的收益上限就是 23%。⑦持久化与提交：草稿 version=3 信封在 http:// 与 file:// 两 origin 各自可写可读且互不相通（M1–M6），敌意草稿（非法步骤/类型不符/未知键）逐项消毒并回落第一步（M5）；幂等令牌由内容决定（E14），真浏览器里二次提交并入同一订单且回执号不变（K5/K5b）——本轮修掉的第三个缺陷就是「提交成功后草稿复活」。写回前 283 条全绿（node 101 / dom 112 / browser 70），写回后 I 组切到「已追加」分支复跑得 293 条，加清理后的 check-clean 20 条与 verify-ledger 12 条（收尾时又给两张卡各加一条：C9 无孤儿脚本、V12 候选确实入队），本轮累计 325 条',
  artifacts: `artifacts/${ROUND_ID}/`,
  report: `reports/${ROUND_ID}.md`,
};

/**
 * Written by the 补记 commit that lands right after the push: RUN.push must stay identical to
 * state.runs[-1].push, otherwise I2c (which deep-compares the last run against RUN) fails on re-run.
 */
export const PUSH_TEXT =
  '已提交并推送：git@github.com:sunc-Q/frontend-skill.git main 分支 c9e0541..4607391（主体 commit 46073913b27b70a449afed447ecaa543dceb16d4，67 files / 13,062 insertions：产物目录 64 个文件 + 报告 + state.json + work-log 末行；随后的 补记 commit 回填本字段、报告 §13 推送区间与 §14 排队项，同样走 ssh.github.com:443，known_hosts 写 LAB/.tmp/known_hosts 并随 .tmp 整体删除；命令与文件内无任何 token，提交身份用内联 -c user.name/user.email，全局 git 配置未改动）';

export const RUN = {
  time: TRIED.time,
  skill: 'frontend-development（第 3 次，表单密集多步向导，补测 07:00 轮自报的薄弱面）',
  scenario: '表单密集多步向导（潮汐社开店向导：4 步 22 字段 + 双异步校验 + 草稿 + 幂等提交）',
  result: 'success',
  assertions:
    '写回前 283 条全绿（check-node 101 + check-dom 112 + check-browser 70，bash scripts/verify.sh 退出码 0）；写回后 I 组台账锁从「尚未写回」6 条切到「已追加」16 条，复跑 check-node 得 111 → 全链 293 条；清理后再跑 check-clean.mjs 20 条复核目录形态（收尾时新增 C9「无孤儿脚本」，抓出 verify.sh 少点了 ledger-refill.mjs 这张卡）；补记后再跑 scripts/verify-ledger.mjs 12 条（不需要构建产物）复核台账（新增 V12「报告 §14 承诺排队的候选真的在队里」）。本轮累计 293 + 20 + 12 = 325 条',
  artifact_size:
    '2.31MB / 64 个文件（遍历本目录全部文件现算，上限 50MB，与 check-clean C5 同口径）。字节数**不在这里硬抄**：本文件自己也参与统计，抄进台账就永远差一点——C5 每次运行都现打印真实值，最后一行读数见报告 §13；上一轮「报告写 2.38MB、实测 2.39MB」就是这么来的。逐项（preview / scripts / src / package-lock / evidence / 配置与 styles.html）与构建期 J6 的 2.34MB / 72 个文件口径差都写在报告 §13。三页单文件 634,448 / 634,465 / 634,487B（合计 1,903,400B），共用 IIFE bundle 633,905B / gzip 196,704B，消融臂 633,927B（差 22B），styles.html 对照入口 13,701B（数字全部由断言 JSON 生成），src 35 文件 3,516 行，scripts 13 个 .mjs/.sh 共 2,602 行（构建期 J8 读数 2,686 行，含当时的临时探针），evidence/ 三份断言原文读数 61,034B',
  cleanup:
    '删 node_modules 159MB + dist + dist-plain + dist-split + .tmp-check + 5 个 .tmp-probe/.tmp-smoke 探针 + .tmp-dom.txt + 3 个 .tmp-facts 转储（探针全文转写进报告 §10，断言读数留在 evidence/ 而不是删掉）；目录形态由 check-clean C1-C3 断言（C1 新增 dist-plain 一项，C2 现在把 .tmp-* 一律算残留，C6 改为要求 styles.html 而不是 index.html——本轮三套构建都以 src/main.tsx 为 Vite 入口，根目录不需要 HTML 入口，生成页若占用 index.html 会让 verify.sh 第二跑就没入口）；8157 端口由 check-browser 自起自关；技能目录与 前端skill实验室 之外零写入；推送后 LAB/.tmp（含 known_hosts）整体删除',
  push: PUSH_TEXT,
};

/** Appended to state.environment_notes — every one of these cost real debugging time. */
export const ENV_NOTES = [
  '断言对象是「一个窗口期」时，采样器必须活在窗口里：check-dom 的 boot() 以「等到 .fd-app 出现」结束，而整个页面挂在路由级 Suspense 上，于是「数据未达时的首屏形态」在 boot 返回那一刻已经关闭，F5 三连红。修法=在 boot 内部逐帧记录 early 计数与宿主节点引用，导出给断言用；同一条也解释了为什么「不空屏」这类主张在 jsdom 里必须由窗口内的帧序列来证，而不是由最终 DOM 来证',
  'route loader「预取」条款缺了后半句：技能说 loader 预取 + useSuspenseQuery 共用一次请求（成立，F2 断言 bootstrap 恰好 1 次），但没警告「mount 若 await loader，慢接口下首帧之前是纯白屏」。mock 120ms 时零症状，?api=1 2.2s 时才现形——SuspenseLoader 救不了从未挂载的页面。预取一律 fire-and-forget，边界负责等待',
  '同权重选择器的胜负由源序决定，而 jsdom 完全看不见：签名层 [data-fd-style=x] .fd-panel 与结构层 [data-fd-style] .fd-panel 权重相同，把签名放前面时结构层的 border 简写把 5px 模板边静默重置成 1px，只有 Chromium getComputedStyle 报出来（D7b）。规则：令牌块 → 结构层 → 签名层，签名永远最后；凡「换皮肤」主张都要在真浏览器里量一个签名专属属性',
  'WCAG AA 会反过来改设计：paper-grid 的次要文字 4.17:1 不达标，加深 muted 又破坏「轻」的观感，最后是同时提亮 bg/paper 才同时满足正文与次要两档。颜色令牌不是 14 个独立旋钮，改一个要重算整组对比度，且这套数字只能在真浏览器里算',
  'playwright 逐帧采样器有两个预算陷阱：(1) 帧数上限（260 帧）会在慢接口回答之前耗尽，导致所有 api 读数变成 0——预算要用时间而不是帧数；(2) 采样窗口若从页面加载算起，会把挂载前的帧当成位移，本轮曾因此量出 909px 的假位移。修法=窗口以目标宿主节点（如 [data-min-height="176"]）出现为锚',
  '渲染计数类断言与 React.StrictMode 互斥：双提交让每个字段计数器翻倍，N 组所有阈值全废。本产物在 main.tsx 里显式关掉 StrictMode 并注明是哪一组依赖这个决定——否则下一轮有人「为了规范」把它加回来，得到的是一堆看起来像回归的红',
  '消融臂的 DOM 等价比较要连「臂名作为可见文本」一起去掉：两臂唯一差异本是 data-arm 属性，但面板还把臂名打印成正文，于是 N1 因 1 字节差异失败并被误读成实现不等价。归一化清单要按「什么差异是合法的」写，而不是按属性白名单写',
  '「闸门重新打开」类断言必须走完真实路径：被拦下的那次点击停在第 1 步，测试若假设一次点击就到第 4 步，量到的是 STEP 2/4 而不是产品缺陷（H15e 首跑即如此）。凡是「条件解除后前进」的断言，都从当前停留位置逐点击重走',
  '同一份源码的两个构建（__FD_MEMO__ 真假）做消融，比读技能措辞便宜得多：字节只差 22B（633,905 vs 633,927），却把「memo 到底值不值」变成 7 vs 210 次、156 vs 314ms 的可测命题，还能顺手做反向控制（blur 后两臂 DOM 一致，证明 memo 没冻住界面）。任何绝对化的性能条款都该配这样一个同产物对照组',
  '复现文档必须点名每一张卡，包括跑不了的卡：本轮 verify.sh 的「清理后复跑」卡里漏了收尾时新加的 ledger-refill.mjs，于是照文档重建的人拿不到 artifact_size / cleanup / push 三个字段，只能手改 state.json——而 verify-ledger V3 是逐字段 deep-eq，手改必然打架。修法是 check-clean 新增 C9「无孤儿脚本」：每个留在 scripts/ 的脚本要么被 verify.sh 点名（步骤或注释卡都算），要么被别的脚本 import，否则红。凡是「只在某个时刻成立」的卡，都要在文档里写明它什么时候成立',
  '体积口径要连着单位一起写：check-clean C5 用 bytes/1024² 却打印成「MB」，所以 2,421,258B 打印为 2.31MB，十进制其实是 2.42MB。更麻烦的是**字节数包含统计脚本自己所在目录里的 round-facts.mjs**：字段里硬抄字节，改一次文案就过期（本轮同一数字为追自己的改动重测四次）。定规则：台账字段只写「2.31MB / 64 个文件 + 由 C5 现打印」，字节与逐项拆分只留在产物目录外的报告里，并注明「写完本节后再未改动 artifacts/ 内任何文件」',
];

/**
 * Queued for future rounds (report §14). ledger-refill.mjs appends only the ones not already in
 * state.next_candidates, so re-running it cannot enqueue a topic twice. §14 item 1 is deliberately
 * absent: the pre-write ledger already carries that exact candidate (index 2 of the snapshot), so
 * re-adding it would be a duplicate, not a plan.
 */
export const NEXT_CANDIDATES = [
  '★ frontend-development × 路由与代码分割密集场景（多页站点/门户）：08:00 向导轮量到「可延迟重量占比」只有 23.3%（L3b），这是表单场景的特征而不是「懒加载」条款的；换到路由密集场景才知道它是否名副其实，判据沿用同一对构建（单文件预览 vs split 证据构建，断言两构建总量差与首包差）',
  'vercel-react-best-practices × 表单密集多步向导：复测「字段级异步校验必须参与步骤闸门」的可发现性 —— 07:00 与 08:00 两轮里没有任何一个技能提到这条，而它正是表单密集场景最容易出事的地方（08:00 轮自建六种拦法 + H15a–H15e 闭环）。换一个技能、同一场景，看它是自带给出的判据还是同样需要自建',
];

/** One appended line for records/work-log.md: 时间 | skill | 场景 | 风格 | 产物路径 | 结论 */
export const WORK_LOG_LINE = `2026-09-26 08:00 | frontend-development（第 3 次使用，规范型技能，~/.qoder-cn/skills/） | 表单密集多步向导（虚构「潮汐社」手作订阅开店向导，**正面补测 07:00 轮自报的薄弱面**：那轮只有 3 字段设置表单、RHF 陷阱是撞上的。功能面=4 步 22 字段（字段并集=22 且互不重叠、无孤儿字段，E11）+ 步骤闸门 canTravel 只认「目标步之前每步都合法」+ 回退永远开放（E12b）+ subdomain/email 双异步唯一性校验（350ms 防抖、单调令牌、乱序回写自成一拦，E13b）+ 18 组分支联动的 payload 键集合断言（旧分支凭证不泄漏，E15）+ 报价双实现互校（行内累加 vs 闭式，E1）+ 草稿 version=3 信封与敌意输入逐项消毒（E16b/M5）+ 内容派生幂等令牌（E14）+ hash 深链 #step=review 被闸门冷启动钳制） | 方格信笺 paper-grid（5mm 正交细网+衬线标题原大小写+2px 虚线焦点框+零阴影，正文 11.37:1／次要 5.29:1）/ PCB 阻焊绿 pcb-green（深绿阻焊底亮度<0.06+45° 斜向丝网纹+全等宽丝印字+发光滑环，13.62:1／6.54:1）/ 清水混凝土玫瑰金 concrete-rose（现浇灰底+圆点对拉孔+5px 粗描边+6px 硬位移阴影+衬线数字，9.12:1／5.36:1）——三套分隔/阴影/字体手法浏览器实测互斥（D9/D10/D11/D12）、12 维指纹两两差异 ≥7（D8）、三页 <script> 载荷逐字节相同（B2）、结构层零字面颜色（C5） | artifacts/20260926-08-frontend-development-wizard/（2.31MB / 64 个文件，零中间物；字节不在此硬抄——本文件自己也参与统计，现算值由 check-clean C5 每次运行打印，逐项拆分见报告 §13；preview/wizard-{paper-grid,pcb-green,concrete-rose}.html 各 634,44x B 单文件、双击即开、每页恰好 1 次 bootstrap 请求且静态载体零网络；src 35 文件 3,516 行 + scripts 13 个校验与台账脚本 2,602 行 + verify.sh 从零复现；styles.html 三风格对照入口的全部数字由 .tmp-check/assertions-*.json 经 scripts/make-styles.mjs 生成、零手写，断言原文读数留 evidence/ 三份 JSON 61,034B） | 写回前 283 条断言全绿（check-node 101 / check-dom 112 / check-browser 70），写回后 I 组切「已追加」分支（6→16 条）复跑 293 条，清理后 check-clean 20（收尾新增 C9 无孤儿脚本，抓出 verify.sh 漏点 ledger-refill.mjs）+ verify-ledger 12（收尾新增 V12 候选确实入队），本轮累计 325 条；结论：**留用，但只当「写法清单」用，别当「正确性来源」用**。①契约无资产第 3 次复跑确认未被修复——SKILL.md 引用的 resources/*.md 与 ../../vite.config.ts 共 10 个文件全不存在（A1b），14 条一行摘要条款必须自造判据（A2b）；②本轮最贵缺陷来自技能最有价值的那条：loader 预取 + useSuspenseQuery 共用一次请求确实成立（F2=1 次），但 mount 若 await loader，慢接口下首帧前约 2 秒纯白屏、页面从未挂载所以任何 SuspenseLoader 都救不了——G 组逐帧采样抓到，改 fire-and-forget 后 api 两级骨架 2159/1755ms、mock 300/0ms；③memo 条款双臂消融（同源码只换 __FD_MEMO__，字节差 22B）：一次击键两臂同样重渲染 7 个叶子（只看一次击键会误判收益为 0），30 击才分道 7 vs 210 次、墙钟 156 vs 314ms，被输入字段也命中浅比较（uncontrolled register），收益 ≈ n 个字段省 n-1 个，且配了 blur 反向控制证明没冻住界面；④技能只字未提「字段级异步校验必须参与步骤闸门」——表单密集场景最容易出事处，本轮自建六种拦法并 H15a–H15e 闭环（含换回可用名后闸门重新打开：拦的是当前结论不是失败历史）；⑤两处只有真浏览器能看见的缺陷：muted 4.17:1 不达 AA（连带提亮底色到 5.29:1）、签名层与结构层同权重时源序定胜负导致 5px 模板边被 border 简写静默重置为 1px；修掉的第三个缺陷=提交成功后草稿复活；⑥成本对照 07:00 后台轮（分母磁盘现读）：src 1.63× 行数但文件更少（3,516/35 vs 2,154/50），产物 633,905B / gzip 196,704B = 后台的 0.88×；懒加载条款仍需证据构建才判得动，而本场景可延迟重量上限只有 23.3%（L3b）、两构建总量差 <3%（L5）；⑦踩坑另记 environment_notes 11 条（前 9 条构建期；后 2 条是收尾与 补记 阶段撞出来的：复现文档必须点名每一张卡（含跑不了的清理后卡，否则下一轮只能手改 JSON 去和 deep-eq 打架）、体积字节不要在自引用的字段里硬抄）；收尾删 node_modules/dist*/dist-plain/.tmp-check 与全部探针（内容转写进报告），目录形态由 check-clean 断言`;
