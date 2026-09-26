# 复现文档 · sites:sites-building × 邮件型订阅落地页

- 轮次：2026-09-26 11:00（第 19 轮，系统时钟 11:24，编号按台账时间）
- 场景：**新**「邮件型订阅落地页」（next_candidates 排队项兑现）
- skill：`sites:sites-building`（Qoder 内置插件 qoder.sites，Simple site 静态路径，第 7 次使用）
  - SKILL.md 路径：`/Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building/SKILL.md`
  - 无上游公开链接（随 Qoder 分发）；零安装、零网络、零构建。

## 1. 本轮的验证问题

该技能最著名的条款是「“Polished”不授权额外的路由、表单、搜索、分享、鉴权、持久化」——它前六轮跑的都是内容/数据页面，表单从来不是主角。**本轮把「订阅表单」立为页面核心功能本身，正面问：反膨胀条款与「Build the requested experience itself」条款在此相遇时，技能给多少支撑、边界画在哪里。**

裁决（本轮定式，可复用）：**表单是否被授权，看它是不是「被请求的体验本体」**。订阅落地页的订阅表单 = requested experience itself → 合法，且按 working-surface 话术放第一分区首屏；而「记住已订阅地址」的持久化没有进入任何请求 → 不做，重复订阅防护用会话内闭包数组实现（F 组断言页面零 localStorage/fetch/XHR/WebSocket/indexedDB）。技能另一条「A requested live integration must not silently become a fixture」不冲突：没有真实投递被请求，且页面三处显式声明演示态（demo-note、成功文案「演示状态：未真实发送」、页脚「示例站点…均为虚构」）。

## 2. 虚构产品与事实源

「离线信号 OFFLINE SIGNAL」——关于不需要网络的技术的周报。事实基线（三页逐字节相同）：
- 订阅者 3,842 人；每周四 07:00（UTC+8）发出；一键退订。
- 最新一期 **#47 · 2026-09-17 · 不需要 WiFi 的笔记**；往期 #46…#42 = 09-10 / 09-03 / 08-27 / 08-20 / 08-13（逐级 −7 天）。
- 页脚：第 1 期始于 **2025-10-30** · 至今共 47 期（E 组用 Date UTC 现算：latest − 46×7d == footStart，全部 6 期 getUTCDay()==4）。
  设计期手稿曾把最新期写成 2026-09-20（不是周四）且「始于」按 46 周硬推——**先算了再写**，并把这条推导固化成 E 组 7 条断言。
- 读者来信 3 条、FAQ 3 条（会收到什么/频率/退订）。零位图（全 CSS 装饰）→ 零外链无需白名单。

## 3. 三个风格（与 used_styles 57 项历史零撞车）

| id | 名称 | 主张 | 签名构件 |
|---|---|---|---|
| airmail | 航空信封 airmail | 牛皮纸底+红蓝斜纹信边+圆形邮戳 | masthead::before/::after `repeating-linear-gradient(45deg)` 四段纹；`.mark` 2px 圆框 rotate(-7deg)；`.subscribe` 虚线信封盖；h2 small-caps；Courier 编号 |
| botanical-plate | 植物图鉴图版 botanical-plate | 米白图版卡+发丝规约+拉丁题注 | 每 section 独立图版卡（1px 描边+2px 圆角）；h2::before 生成「图版·/标本·/注解·」；3px double 上下规约；✦ 前缀；题名 small-caps 字距 0.4em |
| seventies-funk | 七十年代放克 seventies-funk | 芥末橙棕条纹+大圆角+硬投影 | masthead 四段横向色带；胶囊徽标(999px)；标题 rotate(-2deg)+3px 硬 text-shadow；按钮 4px 硬投影 + :active 位移；h2 上同心拱 ::before；details[open] 底色反转 |

11 维指纹两两差异 ≥7（检查器打印全表）；三套 :root 色板**两两零交集**（含各自的「白」：#f7f0df / #faf9f2 / #fbf0cd，无共享值）。

## 4. 构建与调用方式

```
src/body.html  src/app.js  src/base.css  src/skins/{airmail,botanical,funk}.css
      └─ scripts/build.mjs ─→ airmail.html botanical.html funk.html styles.html
                              scripts/check.mjs ─→ 170 断言 + check-result.json
```
- 零依赖：`node scripts/build.mjs && node scripts/check.mjs` 即完整复现（无 npm install）。
- 结构层（base.css）零字面颜色（A 组断言）；皮肤层唯一 hex 在 :root（B 组断言）。
- 内联纪律：build.mjs 用数组 join 拼模板（不做 String.replace 注入，规避 $' 自我复制坑）；`</script` 唯一转义点。
- styles.html 的三张卡片字节数由 build.mjs **同一轮构建现读打印**，check I 组再独立解析比对——数字不可能说谎，除非两者同时坏。

## 5. 断言组（170 条，写回前全绿；写回后 G 组切「已写回」分支复跑）

- A 自包含与同构 ×18：单 `<style>`/单内联 `<script>`、零 link/src、内联脚本==src/app.js 逐字节、三页 body 区逐字节相同、脚本逐字节相同、结构层零 hex。
- B 视觉主张 ×37：hex 只在 :root ×3、色板零交集 ×3、**Node 端 WCAG 对比度 ×21**（ink/paper≥7、mark/deep/ok 对 bg 与 paper≥4.5、btnInk/btnBg≥4.5，函数从 :root 解析并 resolve `var()` 引用链）、指纹差异≥5 ×3。
- C 无障碍与结构 ×57：零重复 id、4 个脚本钩子 id 恰好一次、label for / type=email / autocomplete / inputmode / role=status / aria-live / lang / viewport / description、6 section 全部 aria-labelledby、details==8。
- D 表单行为 ×27（vm 桩 DOM，零 jsdom 零 node_modules）：空→error+aria-invalid；格式错→error；mailinator/tempmail→拒绝；`" X@Example.COM "`→小写归一成功+清输入+文案含「演示/未真实发送」；重复→info；第二地址→可续订。
- E 事实一致 ×28：周四节拍、期号连续、7 天步进、首期日期回推、期数 47、订阅数格式、三页事实逐字节相等。
- F 反膨胀张力 ×20：零网络/存储 API、单 form 无 action、三处演示声明、subscribe 是 main 第一分区。
- G 台账契约 ×4：幂等式（快照+增量==现值，写回前走 baseline 分支）——快照见 `scripts/ledger-snapshot.json`（开工时 tried=18, runs=18, used_styles=57, env_notes=121）。
- H 溢出静态 ×12：repeat() 必配 minmax(0、无 ≥500px 固定宽、零 nowrap、input min-width:0。
- I 入口 ×7：三链存在、入口打印字节==文件实际字节（当场抓住一次构建后漂移）。

## 6. 真浏览器复核（面板 hidden/0×0，无截图）

file:// 直开，getComputedStyle 短调用（每次 ≤3 属性）：
- airmail：body `rgb(231,220,192)`=#e7dcc0 ✓；`.mark` `50%`+rotate(-7°) matrix+边框 `rgb(38,73,126)` ✓；`.masthead::before` backgroundImage = 45° 红/纸/蓝 repeating 纹 ✓。
- botanical：body `rgb(239,238,227)` ✓；h2 字体链 Palatino ✓；details=8、3,842、每周四文本在页 ✓。
- funk：body `rgb(241,221,162)`=#f1dda2 ✓；`.mark` 胶囊 65535px + 底 `rgb(138,63,32)`（--accent2 解析生效）✓；transform matrix ✓。
- 控制台零消息。
- **读数滞后现象第 N 次复现**：导航后首读返回前一页值，同表达式连读第二次取真值；「导航后立刻放纯 DOM 读」也会 15s 超时、随后重试即成——沿「连读两次取第二」纪律执行。
- 交互（提交表单）不在浏览器做：面板 hidden 下事件驱动不可靠（17:00 已定分工），行为证据全走 D 组 vm 桩。
- 真实视口横向溢出未目视（rotate 元素仅 .mark 与 .title，均内联块+max-width 兜底；记为未验项）。

## 7. 缺陷与坑

产物侧真实缺陷 1：日期事实链自相矛盾（2026-09-20 非周四 + 首期硬推）——写码前用 Node 现算修好，E 组断言把该推导永久钉住。
检查器侧假失败 2（历轮模式复现）：
1. `<title>[^<]{6}<` 把「≥6」写成精确 6 → 三页恒假失败；
2. 场景去重关键词「订阅」撞上 15:00 轮「订阅收入看板」→ comboUntried 假失败。**去重断言的关键词必须用历史全文不含的组合词**（改用「邮件型订阅」）。
台账幂等第 4 例：`comboUntried` 初版写成单向「未见于 tried」，写回那一刻必然翻转（写回后 172/173 红一条）→ 改为分支式「写回前=未见于台账 / 写回后=该组合连同三风格逐字在台账」。凡是引用「本轮之前状态」的断言，都必须显式写两个分支，不存在只在一侧成立的写法。
装置侧 1：vm 桩的 `form.reset()` 最初清的是 form.value（不存在），D 组「成功后清空」断言靠它差点误判产物——**桩自身语义要单独冒烟，产物断言不能建在桩的假动作上**。
其他经验：:root 里 `--btn-bg: var(--accent2)` 这类 var 引用必须被色板解析器 resolve，否则对比度断言按 fallback 色算出与实际渲染不同的值（funk 实测捕获）。

## 8. 结论

**留用（第 7 次，全实验室唯一 7/7 通过率技能；表单核心场景首次通过）。** 该技能在表单密集场景的支撑结构：授权来源=「requested experience itself + working surface」，边界来源=反膨胀条款（不授权持久化/鉴权），两者不互斥且本轮都有断言化配方。产物继续维持单页 ~11-12KB 量级（vs 同族 React 路线 245-720KB），收尾成本≈0（本轮零 node_modules、零 dist、未起 http.server）。对比度可以从 :root 静态算——这条配方值得移植回 23:00/04:00/06:00 等纯 CSS 轮横检。

## 9. 产物清单

`artifacts/20260926-11-sites-building-newsletter/`（112KB）：
airmail.html 11,354B · botanical.html 11,572B · funk.html 11,792B · styles.html（构建后现读，I 组断言核对）· src/{body.html,app.js,base.css,skins/×3} · scripts/{build.mjs,check.mjs,ledger-snapshot.json,check-result.json 170 条逐条}。
校验脚本全部在盘未删 → 无需转录。清理记录见 state.json runs[18]。
