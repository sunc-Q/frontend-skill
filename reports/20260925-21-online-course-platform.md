# 20260925-21 · online-course-platform（学阶公开课 · 在线课程平台与招生看板）

- **时间**：2026-09-25 19:52 ~ 20:57（+08:00）
- **轮次**：第 4 轮（前三轮：saas-subscription-admin / fitness-studio-booking / cross-border-commerce）
- **结论**：**成功**。1 个新场景 × 3 个新风格全部产出并验证；4 表 8 接口；go build/vet/test 全绿（3 包 58 个用例）；api-smoke 42 条断言全过；三风格单文件实机互异、零外链；场景目录 1.4M。

## 1. 场景去重与选型

`used_scenarios` 无 online-course-platform（它一直在 `next_candidates` 首位）；`used_styles` 无
包豪斯原色 / 报章密排 / 航空仪表盘（三者均在 `next_style_candidates`）。开工磁盘读数：本轮是上一轮
收工后继续的会话，未单独留开工值（上一轮末次 20,273,788KB），清理前实测 20,094,272KB、清理后
20,201,368KB ≈ 19.3GiB，全程远高于 1.5GiB 熔断线。

业务切口：**成人培训机构的招生侧**，与前三轮「订阅计费 / 课节预约 / 跨境购物车」都不同——核心矛盾是
**价格判定 + 席位容量**：早鸟价按截止日、老学员 95 折按历史生效报名数、满座自动转候补且不扣费，
四个规则全部要在后端一个事务里同时判完，且 `实付 = 标价 − 立减` 必须是恒等式。看板口径（GMV 只含已生效
报名的实付、满座率 = 占座人次 ÷ 在售容量、结课率）都是能被 SQL 交叉校验的真聚合。

## 2. 后端（Go/Gin + SQLite，8 接口 / 4 表）

分层 `cmd/api` + `internal/{domain,repository,service,handler,server}`，glebarez/sqlite 纯 Go 无 CGO，
DSN 带 WAL/busy_timeout/foreign_keys/txlock(immediate)，`SetMaxOpenConns(1)`，库文件 0600。

| 接口 | 说明 |
|---|---|
| GET `/api/health` | 探活 |
| GET `/api/stats` | 10 项看板指标 + `by_domain[]` + `monthly[]` + `window` 口径声明 |
| GET `/api/courses` | 列表：领域/难度/状态/早鸟/搜索/排序/分页，回显规范化后的查询参数 |
| GET `/api/courses/{code}` | 详情：课程 + 讲师 + 大纲 + 最近 12 条**脱敏**报名 |
| GET `/api/instructors` | 讲师榜（主讲数 / 在售数 / 学员数派生） |
| POST `/api/admin/enrollments` | Bearer 报名占座，201（active 扣费 / waitlist 零扣费 + message） |
| POST `/api/admin/enrollments/{id}/progress` | Bearer 进度，100% 自动结课 |
| POST `/api/admin/courses/{code}/status` | Bearer 状态机 draft→published→archived |

表：`instructors`(6) / `courses`(16：13 在售 / 2 草稿 / 1 归档，`code` 唯一，8 门早鸟在跑) /
`chapters`(93，首章 `free_preview`) / `enrollments`(**506**：在读 266 / 结课 138 / 候补 59 / 退课 43，
**复合唯一 `idx_course_phone(course_id, phone)`** —— 退课再报返回 409，记录是终身上籍凭证)。
种子固定种子 20260925、`HasData` 幂等，前 6 门可售课按 `capacity+15` 灌到满座以留出候补样本，
12 个复用手机号触发老学员 95 折。实测看板：GMV ¥115,297.15（与 `SUM(paid_cents)` 交叉校验相等）、
付费学员 404、整体满座率 65%、结课率 34.2%、老学员让利 ¥388.85。

安全实现：`domain.AppError` 统一映射，对外绝不回显 `err.Error()`；`Phone` 的 json tag 为 `-`，
全链路只出 `masked_phone`；手机号 `^1[3-9]\d{9}$`、课程 code `^[A-Za-z0-9_-]+$`、source 枚举白名单
（校验不过逐字段 400 回显）；LIKE 转义 `%_\`；搜索 rune 截断 64；`page_size` 钳 ≤100；排序列白名单
（非法 sort 静默收敛并在响应里回显真实列）；`crypto/subtle` 常量时间比令牌；未配 `ADMIN_TOKEN` → 503
fail-closed；localhost-only CORS；`STATIC_DIR` 分支挂 `NoRoute(json404)` + 静态防穿越。

**测试（3 包 58 个用例，全表驱动）**：
`domain_test.go`（EnrollInput 10 例含注入串、进度/状态校验、ParseCourseListQuery 7 例收敛、MaskPhone、
ValidCourseCode）；`repo_test.go`（种子形状 6/16/≥60 章/≥100 报名 + 无超卖 + 只有满座课才有候补、
报名事务矩阵 active/候补/草稿课 409 + 重复 409 + 价格恒等式、进度状态机 5 例、课程状态机 5 例、
stats 四条恒等式含 ByDomain GMV 之和 = 总 GMV、列表过滤含 `q=%` 转义 ≤2 命中）；
`server_test.go`（读接口形状与 published=13 / page_size 回显钳制 / fill 降序首行 ≥100% / 详情无 raw phone /
注入 code 404 / 未知 api JSON 404 / instructors=6，鉴权矩阵 401·403·201·Basic→401·空 token 实例→503，
报名业务流 5 项非法 + 201 恒等式 + 脱敏前缀 + 重复 409 + 候补零扣费 + 候补推进度 409 + 100%→completed→再 409 +
101→400，课程状态端点，安全响应头与静态）。
`go build ./... && go vet ./... && go test ./... -count=1` → 3 包 ok（0.351s / 3.983s / 2.292s）。

## 3. 前端（Vite + React 19 + TS strict，三风格同 DOM/同 JS）

`npm ci --registry=npmmirror`（24 包）→ `tsc --noEmit` 一次通过 → `vite build` 单包 289,089B（gzip 84.48KB）。
页面（`App.tsx` 全量重写）：topbar（品牌 学阶公开课 + 三风格切换 + 管理令牌框）、状态行（数据快照时间 + 口径声明，
来自 `/api/stats.window`）、10 张 KPI（全部读 stats，前端零硬编码）、课程目录表（领域/难度/每页/早鸟/搜索 +
分页 + 可点列排序，现价列内联「早鸟剩 N 天」徽标与划线标价、席位列 occupied/capacity + 候补 N、满座率条）、
侧栏领域 GMV 条形 + 月度报名走势表 + 讲师榜、详情区（事实 dl / 大纲表带免费标 / 最近报名表带进度条与「立减」「候补未扣费」）、
报名表单（满座时按钮文案自动变「进入候补」并预先说明不扣费）、页脚两个运营表单（进度默认填最近一条、状态机提示）。

三风格 CSS（同 DOM 同 JS，只换文件）：
- `theme-bauhaus.css`（682 行，包豪斯原色：纸米底 `#f4efe3` + 纯白面板、3px 墨描边、**0 圆角**、
  硬投影 `6px 6px 0`（KPI 卡 `3px 3px 0`）、红 `#e33d24`/蓝 `#1f4fd8`/黄 `#f2b705` 三原色块、
  Futura 系 900 字标题、uppercase + 字距 1.4px 标签、斑马 `#fbf9f2` 行、黄底选中行）
- `theme-newsprint.css`（634 行，报章密排：学阶日报 masthead、Songti/Noto Serif 衬线 12.5px 高信息密度、
  3px double 栏线 + 点状细行分隔、「编者按」lede 前缀、详情事实 `columns:2`、无投影、报红 `#a3221b`、
  选中行内嵌红条 inset）
- `theme-instrument.css`（699 行，航空仪表盘：`#141a1f` 深色金属渐变、inset bevel 投影、**圆角 12px / 999px 胶囊**、
  琥珀 `#ffb000` + 青 `#43d9e8` + 等宽读数带 text-shadow 光晕、KPI 卡切成仪表形状 `radius 50% 38%`、
  小节标题青色 uppercase + 琥珀指示灯 ●）

## 4. 验证记录

1. **接口冒烟** `scripts/api-smoke.sh`（42 条 `chk`，BASE/TOKEN 走环境变量，脚本头注明会写库）→ **pass=42 fail=0**：
   读接口口径（published=13、GMV>0、fill 降序首行 ≥100%、page_size=99999 回显钳成 100、非法 sort 收敛 200、
   `early=1` 全部 `early_now`、`q=%` 转义后命中 **0** 条、详情 12 条全脱敏且无 raw phone、注入 code 404、
   `/api/nope` JSON 404、instructors=6）+ 鉴权矩阵（无 token 401、错 token 403）+ 校验边界（坏手机号 400 并回显
   `phone` 字段、姓名 40 rune 400、source `%$&` 400、进度 101 400）+ 业务流（201 且价格恒等、重复 409、
   DS-101 满座 → 201 `waitlist 0`、推进度 200、100% → `completed`、结课后 409、SEC-310 上架 200、重复上架 409、
   published 变 14、AI-380 归档 200、非法 `to=draft` 400）。
2. **数据纯净**：冒烟写脏库后，按 PID+命令行核对 kill 实例 → 显式删三个 db 文件 → 同 token `-seed` 重启 →
   再生成 preview（避免把测试脏数据交付出去）。
3. **三风格实机**：`inline-preview.mjs` 出 `preview/{bauhaus,newsprint,instrument}.html`（各 289,647/289,648/289,653B，
   下标切片注入 + JS 完整且唯一断言），`serve-static.mjs` 托管 8092 注入 `__API_BASE__`；browser-use 逐页
   `getComputedStyle` 实读：三页 **DOM 完全同构**（`rows=41`、`kpis=10`、首卡读数都是真实 GMV 缩写 `¥11.5万`），
   **外链 0**（`link[href]/script[src]/img[src]` 命中 0，只有 3 个内联 `<script>` + 1 个 `<style>`）。
   两两互异 ≥6 项：字体族（Futura / Songti 衬线 / Avenir Next）、shell 与 body 底色（米 / 新闻纸白 / `rgb(12,16,19)` 深）、
   KPI 圆角（0 / 0 / **50% 38%**）、KPI 阴影（`3px 3px 0` 硬投影 / none / 三层 inset bevel）、KPI 底色（`rgb(242,183,5)` /
   transparent / 渐变）、标签字距（1.4 / 1.4 / **1.9px**）与 text-transform（uppercase / none / uppercase）、
   数值主色（墨黑 26px·900 / 报红 20px·700 / 琥珀光晕）、按钮描边（2px / 1px / 999px 胶囊）与 padding（7px / 3px）、
   表头底色（实底 / 透明 / 金属渐变）、徽标字距（0.8px / normal / 胶囊）。
4. **可访问性快照取证**（instrument 页 take_snapshot）：10 张 KPI 全真值（¥11.5万 / 13 / 404 / 65% / 138 / 59 /
   ¥389 / 43 / 34.2% / 16）、目录 12 行含 DS-101 `60/60 候补4 100%`、详情大纲 5 章首章「免费」、
   最近报名 12 行手机号全部 `139****1050` 形态、报名表单文案「名额已满，提交将进入候补队列且不扣费」+ 按钮「进入候补」、
   运营表单默认目标「#48 冯焦 139****1050 · 在读」与「DS-101 · 状态机：draft→published→archived，其余迁移 409」。
   侧栏领域 GMV：人工智能 ¥4.7万(41.0%) / 数据分析 ¥3.3万(28.3%) / 前端开发 ¥1.6万 / 视觉设计 ¥1.0万 / 产品管理 ¥9.5k。

## 5. 本轮新踩的坑（已回写 state.environment_notes 与场景 README）

1. **SQLite 同一条 select 列表里不能引用别的别名**：`fill_ratio` 复用 `occupied` 别名 →
   `no such column: occupied`，且只在 `CourseRowByCode`（报名路径）炸成 500，列表接口反而正常——
   必须把子查询重复写一遍，别名只给外层用。
2. **汇总翻倍**：`ByDomain` 在同一 LEFT JOIN 里同时 `SUM(e.paid_cents)` 与 `COUNT(chapter)` 互相放大，
   且 `payingFilter` 的 `e.` 前缀与 JOIN 别名冲突；改成「先按课聚合的子查询，再按领域分组」。
3. **种子要真造出满座课**，否则「满座转候补」这条核心分支永远走不到（首轮全部 active，测试直接抓到）。
4. **`pct()` 用 `int(part*100/whole + 0.5)`** 会因浮点截断偏 1 → 改整数 `int((part*100 + whole/2) / whole)`。
5. **冒烟脚本自身的 harness 坑会伪装成业务 bug**：`jget` 里 `eval('d$1')` 展开成 `eval('d['x']')` 是 Python
   语法错（必须 `eval("d$1")`）；`chk 名 期望 "$(req ...; jget ...)"` 把 `req` 打印的状态码和字段值拼成
   `20014`——取字段前先 `>/dev/null` 吞掉 `req` 的 stdout。
6. **带无限 CSS 动画的主题会让 browser-use 卡**：一次 `evaluate_script` 里放 7 组 `getComputedStyle` 在
   instrument 页 15s 超时（重载页面后一次只取一小批即可）；且函数体里的 `'\n'` 字面量经 MCP 传参会被解码成
   真换行 → `SyntaxError`，拼接分隔符要用 `' | '`。
7. zsh nomatch 再次复现：`rm -f /tmp/x.db*` 无匹配时中断整条 `&&` 链，服务根本没起（curl 全 000），
   重置库必须显式列 `.db` / `-wal` / `-shm` 三个文件。

## 6. 交付物与体量

`sites/online-course-platform/`：`backend/`(136K，16 个 .go 含 3 个测试文件) · `web/`(436K，src + dist 289KB) ·
`preview/`(852K，3 × 289.6KB) · `scripts/`(20K，4 个) · `README.md`(复现文档)。场景目录 **1.4M**（上限 5M，硬顶 40M），
LAB 收工 8.2M（含 .git）。二进制（38MB）建在 `/tmp` 并已删除，node_modules 已删，`/tmp/ocs-*`、`/tmp/smoke.body` 已清，
8092/8093/8099 监听数 0。

## 7. 遗留（写入 state.backlog）

- `enrollments` 的查重依赖「事务内 SELECT + 单写者」，虽有 `idx_course_phone` 复合唯一兜底，但 `dropped`
  记录永久占位导致「退课后不能重报」是产品决策而非技术限制，需要时得改成部分唯一索引。
- 早鸟/老学员折扣规则写死在 `service`（`>=3` 条历史、5%、截止 +24h），没有可配置的促销活动表。
- 看板全为「全量历史口径」，`/api/stats` 有 `window` 字段但尚不支持按时间区间过滤。
