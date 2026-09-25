# 城市健身工作室 · 排课与预约看板（fitness-studio-booking）

> 业务网站实验室 · 第 2 轮产物。Go/Gin + SQLite 后端，React/Vite/TS 前端，
> **同一套 DOM 与 JS、三份 CSS** 的三种互不相同视觉风格。
> 本目录既是可运行代码，也是复现文档；`preview/*.html` 是零外链的单文件成品页。

## 1. 场景与角色

一家只有 600㎡、6 名教练的精品团课工作室。店长/前台每天早上打开它，回答三个问题——
**今天的课满不满、哪些课要开候补、哪位教练的课最挤**；会员来电话占座时，前台在同一页当场录进系统。

| 角色 | 能做什么 | 鉴权 |
| --- | --- | --- |
| 店长 / 分析（只读） | 看满座率、课表筛选/排序/搜索、看某节课的出场名单 | 无（只读接口不发令牌） |
| 前台（写） | 给会员占座（含满座转候补）、给新会员建档发卡 | `Authorization: Bearer $ADMIN_TOKEN` |

页面只有一张：`排课与预约看板`。顶部 8 张 KPI 卡（满座率/已确认/开放课节/候补/到课收入/未到率/有效会员/单课平均人数），
中部课表（起算日、天数、类别、教练、级别、状态、每页、搜索，9 列其中 5 列可排序、分页），
右侧分类满座率 + 每日到课 + 教练负载，底部课节详情（出场名单 + 占座表单）与会员建档表单。

**关键业务规则全在后端一个事务里**（不是前端算着玩）：
容量判定 → 查重（同一会员同一课节只能有一笔有效预约）→ 满座时按 `allow_waitlist` 决定 409 还是转候补 →
次卡（trial / ten_session）确认占座才扣一次，候补不扣 → 已开课/已取消/停卡/过期的卡一律拒绝。

## 2. 目录结构

```
backend/cmd/api/main.go                 入口：flag/env、灌种子、优雅退出
backend/internal/domain/   models.go errors.go query.go models_test.go   模型、AppError、不可信 query 收敛
backend/internal/repository/ db.go repo.go stats.go seed.go repo_test.go GORM 访问、事务化预约、聚合口径、确定性种子
backend/internal/service/  service.go                                   校验、默认值、冲突映射
backend/internal/handler/  handlers.go errors.go auth.go                绑定/响应、Bearer 校验
backend/internal/server/   server.go server_test.go                     路由、安全头、CORS、静态托管、超时
web/src/          App.tsx api.ts themes.tsx useAsync.ts types.ts format.ts main.tsx
web/src/styles/   theme-brutal.css theme-washi.css theme-morandi.css   ← 三风格唯一差异
web/dist/         vite build 产物（已随交付保留）
preview/          brutal.html washi.html morandi.html  ← 零外链单文件成品
scripts/          api-smoke.sh inline-preview.mjs serve-static.mjs style-probe.js
README.md
```

## 3. 数据模型

四张表，金额一律**整数分**，时间一律 UTC（看板不会因时区漂移）。
GORM `AutoMigrate` 生成的真实 DDL（`sqlite3 .schema` 原样输出）：

```sql
CREATE TABLE `classes` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`name` text,`category` text,
  `coach` text,`coach_level` text,`duration_min` integer,`intensity` integer,`capacity` integer,
  `price_cents` integer,`active` numeric,`created_at` datetime);
CREATE UNIQUE INDEX `idx_classes_code` ON `classes`(`code`);
CREATE INDEX `idx_classes_category` ON `classes`(`category`);
CREATE INDEX `idx_classes_coach_level` ON `classes`(`coach_level`);
CREATE INDEX `idx_classes_active` ON `classes`(`active`);

CREATE TABLE `sessions` (`id` integer PRIMARY KEY AUTOINCREMENT,`class_id` integer,`start_at` datetime,
  `room` text,`status` text,`note` text,`created_at` datetime);
CREATE INDEX `idx_sessions_class_id` ON `sessions`(`class_id`);
CREATE INDEX `idx_sessions_start_at` ON `sessions`(`start_at`);
CREATE INDEX `idx_sessions_status` ON `sessions`(`status`);

CREATE TABLE `members` (`id` integer PRIMARY KEY AUTOINCREMENT,`name` text,`phone` text,`card_type` text,
  `credits` integer,`visits` integer,`joined_at` datetime,`expires_at` datetime,`active` numeric);
CREATE UNIQUE INDEX `idx_members_phone` ON `members`(`phone`);
CREATE INDEX `idx_members_card_type` ON `members`(`card_type`);
CREATE INDEX `idx_members_active` ON `members`(`active`);

CREATE TABLE `bookings` (`id` integer PRIMARY KEY AUTOINCREMENT,`session_id` integer,`member_id` integer,
  `status` text,`source` text,`created_at` datetime);
CREATE INDEX `idx_bookings_member_id` ON `bookings`(`member_id`);
CREATE INDEX `idx_bookings_session_id` ON `bookings`(`session_id`);
CREATE INDEX `idx_bookings_status` ON `bookings`(`status`);
```

枚举：类别 `strength/cardio/yoga/cycling/boxing/recovery`；教练级别 `junior/senior/master`；
课节 `open/closed/canceled`；预约 `confirmed/waitlist/canceled/no_show`；卡种 `trial/ten_session/monthly/quarterly/annual`。
`confirmed + waitlist` 才算「这笔预约还活着」，但只有 `confirmed` 占硬容量。

种子数据确定性（`rand.NewSource(20260925)`，`-seed` 幂等，库非空即跳过）：
**10 门课程（9 门在售 + 1 门已停开）、48 名会员、14 天 × 6 时段 = 84 节课**，
预约按「容量 × 星期几系数 × 时段系数 × 临近度系数」生成，另加约 9% 的 `no_show`、35% 的取消、满座课 1–3 名候补。
本轮实测（±7 天窗口）：60 节课 / 932 座 / 654 笔预约（612 确认 · 3 候补 · 16 取消 · 23 未到）/ 满座率 65.7%。

口径全在 `backend/internal/repository/stats.go`，服务端一次算清，前端不做二次计算：

- `满座率 = Σconfirmed ÷ Σ(未取消课节容量)`；分母不含 canceled 课节，避免「取消一课」把指标砸绿。
- `到课收入`只统计**已开课**课节：`Σ confirmed × price_cents`；未来的课一分钱不算。
- `未到率 = no_show ÷ (confirmed + no_show)`，同样只在已开课范围内。
- 窗口 `days` 收敛到 3–14，`page_size` ≤ 100，课表向后最多看 14 天（防 `page_size × days` 扫穿库）。

## 4. 接口清单

| Method | Path | 鉴权 | 入参 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 无 | — | `{status,time}` |
| GET | `/api/stats` | 无 | `days`（3–14，越界收敛） | `{window,occupancy_pct,total_sessions,open_sessions,seat_total,total_bookings,confirmed_bookings,waitlist_bookings,canceled_bookings,no_show_bookings,members,active_members,revenue_cents,no_show_rate_pct,avg_confirmed_per_session,days[],by_category[],by_coach[],by_card[],generated_at}` |
| GET | `/api/schedule` | 无 | `date(YYYY-MM-DD)、days、category、coach、level、status、q(≤64字)、sort(start_at\|class\|coach\|booked\|remaining\|room\|id)、dir、page、page_size(≤100)` | `{items:[SessionRow],total,page,page_size,sort,from,days,served_at}`，`SessionRow` 含 `confirmed/waitlist/remaining/capacity` |
| GET | `/api/sessions/:id` | 无 | 路径 ID（非法 → 400 `invalid_id`） | `{session,roster[]}`（名单按确认→候补→其它排序，上限 60 行，空名单回 `[]`） |
| GET | `/api/classes` | 无 | — | `{items:[Class],total}`（只回在售） |
| POST | `/api/admin/sessions/:id/bookings` | Bearer | `{member_id \| phone,source?(app\|front_desk\|coach\|phone),allow_waitlist?}` | 201 `{booking,session(最新详情),credit_used,message}`；404 `member_not_found/session_not_found`；409 `duplicate_booking/session_full/session_not_open/session_started/no_credits/card_expired`；403 `member_inactive` |
| POST | `/api/admin/members` | Bearer | `{name(≤16字),phone,card_type,credits(0–500),days_valid(0–1095)?}` | 201 `Member`（按卡种自动给默认有效期）；400 带 `fields`；409 `conflict`（手机号已建档） |

错误体统一 `{code,message,fields?}`。**内部错误只回泛化消息，绝不回显 `err.Error()`**
（`backend/internal/handler/errors.go`；`server_test.go` 断言响应体不含 `SQLITE/gorm/constraint/no such table//Users/` 等内部串）。

安全基线：
- `ADMIN_TOKEN` 未配置 → 写接口一律 **503 fail-closed**（实测：`{"code":"server_misconfigured"}`），缺头/缺 `Bearer` 前缀/空令牌 → 401，令牌不符 → 403，比较用 `crypto/subtle.ConstantTimeCompare`。
- 排序列走白名单 map；`LIKE` 用 `escapeLike` + `LIKE ? ESCAPE '\'`；教练名/日期/手机号有字符集闸门（`' OR 1=1--` 直接 400）；搜索串按 rune 截断 64。
- 静态托管带目录穿越防护；安全响应头（`X-Content-Type-Options/nosniff`、`X-Frame-Options/DENY`、`Referrer-Policy/no-referrer`）；CORS 只放行 localhost/127.0.0.1；请求超时 8s。
- **库文件 0600**：SQLite 里存会员手机号（个人信息），`repository.Open` 建库后显式 `os.Chmod(path, 0o600)`，实测 `-rw-------`。
- 单写者：DSN `_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)` + `SetMaxOpenConns(1)`，预约事务因此天然串行，不会超卖。

## 5. 从零复现

```bash
cd sites/fitness-studio-booking

# 1) 后端（Go 1.27；本机走 goproxy.cn，纯 Go 的 glebarez/sqlite，无需 CGO）
cd backend
export GOPROXY=https://goproxy.cn,direct
go build ./... && go vet ./... && go test ./...

# 2) 起服务：ADMIN_TOKEN 只在自己本机 shell 里 export，绝不写进文件/提交
export ADMIN_TOKEN='换成你自己的随机值'
mkdir -p ../.tmp
go run ./cmd/api -seed -db ../.tmp/studio.db -addr :8080
# 等价：DB_PATH=... PORT=8080 GIN_MODE=release go run ./cmd/api
# 同源托管前端（免 CORS）：STATIC_DIR=../web/dist go run ./cmd/api -db ... 

# 3) 接口冒烟（覆盖 7 个端点 + 鉴权/校验矩阵，任一断言失败即非 0 退出）
API=http://127.0.0.1:8080 TOKEN="$ADMIN_TOKEN" bash ../scripts/api-smoke.sh

# 4) 前端（npm 必须走镜像；不要用 npx，直接调 node_modules/.bin）
cd ../web
npm install --registry=https://registry.npmmirror.com
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build                     # -> web/dist（单入口 app.js，cssCodeSplit:false）
node ../scripts/inline-preview.mjs "$PWD" http://127.0.0.1:8080/api   # -> ../preview/{brutal,washi,morandi}.html

# 5) 看成品：三种风格 = 三个单文件
node ../scripts/serve-static.mjs ../preview 8092 http://127.0.0.1:8080/api
open http://127.0.0.1:8092/brutal.html   # 或 washi.html / morandi.html

# 开发模式（Vite 代理 /api -> 127.0.0.1:8080）
./node_modules/.bin/vite --port 5173
```

环境变量与 flag：`-seed`（默认 true，库非空即跳过）、`-db`/`DB_PATH`（默认 `./data/app.db`）、`-addr`/`PORT`（默认 8080）、
`ADMIN_TOKEN`（写接口令牌，未设 = 写接口 503）、`STATIC_DIR`（设为 `web/dist` 则同源托管）、`GIN_MODE`。
本轮清理后 `web/node_modules`、`.tmp/`、编译产物均已删除，重跑第 4 步即可再生。

## 6. 三种风格（同 DOM / 同 JS，只换 CSS）

主题通过 `?raw` 把三份 CSS 打进 JS，运行时按 `<html data-theme>` 注入一个 `<style data-theme-css>`；
**切换风格不重新加载、不改组件代码**。优先级：URL `?theme=` > `window.__THEME__`（preview 文件已烘焙）> `localStorage`。

| 风格 | 主张 | 关键做法 |
| --- | --- | --- |
| `brutal` 新粗野主义 | 健身房的海报墙：力量感来自油墨和留不住的空白 | 亮黄底 `#ffe94d`、3–4px 硬黑边、`6px 6px 0` 错位实投影、0 圆角、Arial Black 巨型数值、900 大写标签、粉/绿信号色、条纹进度条 |
| `washi` 日式留白 | 把「课表」当和纸上的排版看：安静、克制、一条朱红 | 米白 `#f7f4ec`、1px 发丝线、明朝/宋体衬线、`--sp-5:140px` 大留白、0.2–0.42em 字距、weight 400–500、唯一强调色朱红 `#a8402c`、无阴影、进度条压成 2px 细线 |
| `morandi` 莫兰迪色块 | 高级灰的会员卡：不靠描边，靠色块与柔和投影分层 | `#eceae5` 底、鼠尾草绿/雾蓝/藕粉色块、无边框 + `0 12px 28px` 柔影、20px 大圆角、胶囊按钮与徽章、渐变进度条、PingFang 常规字重 |

实测 `getComputedStyle`（对交付的 `preview/*.html`，浏览器真值，非 CSS 源码推测）：

| 探针 | brutal | washi | morandi |
| --- | --- | --- | --- |
| `.shell` 底色 | `rgb(255,233,77)` | `rgb(247,244,236)` | `rgb(236,234,229)` |
| 字体栈 | Helvetica Bold / Arial Black | Hiragino Mincho / Songti（衬线） | PingFang SC（常规无衬线） |
| `.kpis` 间隙 | `4px` | `34px` | `14px` |
| `.kpi` 圆角 / 上边框 | `0px` / `3px` | `0px` / `1px` | `20px` / `0px` |
| `.kpi` 阴影 | `rgb(16,16,16) 4px 4px 0` | `none` | `rgba(78,74,68,.09) 0 6px 16px` |
| `.kpi-label` 字距 / 大小写 | `0.96px` / uppercase | `3.6px` / none | `0.26px` / none |
| `.kpi-value` | 44px / 900 / Arial Black | 40px / 400 / 明朝 | 34px / 600 / PingFang |
| `table th` | 深底 `rgb(16,16,16)` + 黄字 + uppercase | 透明底 + 灰字 + 2.88px 字距 | `rgba(74,72,68,.06)` 色块底 |
| `.badge` 圆角 | `0px`（900 大写） | `2px`（400，2.16px 字距） | `999px` 胶囊（500） |
| `.bar-fill` 高度 | `14px` 条纹 | `2px` 朱红细线 | `10px` 渐变胶囊 |
| 渲染结果 | 8 卡 / 44 行 / **外链 0** | 8 卡 / 44 行 / 外链 0 | 8 卡 / 44 行 / 外链 0 |

字体、底色、间距、圆角、边框、阴影、字距、大小写 8 类**两两互异**，远超「≥3 项确实不同」；
三行的 `rowCount=44`、`kpiCount=8`、`满座率 65.8%` 完全一致 → 证明差异只来自 CSS，DOM 与 JS 同源。

## 7. 校验记录（本轮实测）

- `go build ./... && go vet ./... && go test ./...` 全绿（3 个测试包）：
  `domain`（表驱动：手机号/姓名/卡种/次数字段校验、query 收敛含注入与 400 字超长、枚举与排序白名单）、
  `repository`（种子自洽、满座→候补、查重、扣次、事务回滚、`LIKE` 转义、`page_size` 上限）、
  `server`（鉴权矩阵 503/401/401/403/201、错误不外泄、分页与 days 收敛、倒序生效、静态目录穿越、安全头）。
- 实机 curl（`scripts/api-smoke.sh`，本轮 :8080）：读接口 5 个 200 且数字与库一致；
  `days=999 / page_size=5000 / sort=s.id;DROP TABLE / date=2026-13-45` 全部被**收敛**为
  `sort=s.start_at from=今天 page_size=100 days=14`（不是 500，也不是透传）；
  `/api/nope` JSON 404；`/api/sessions/1%20OR%201%3D1` 400。
- 写接口：无头 401 / 无前缀 401 / 错令牌 403 / 非法 JSON 400 / 注入手机号 400 / 400 字姓名 400 / 卡种越界 400；
  建档 201（次卡自动 180 天有效期）→ 同手机号 409 `conflict`；
  预约 201（`credit_used=true`，座位 11/12→12/12）→ 重复 409 `duplicate_booking` → 满座不带排队 409 `session_full`
  → 带 `allow_waitlist` 转 `waitlist` → 次卡余额 0 时 409 `no_credits` → 已开课 409 `session_not_open` → 未注册手机号 404。
- **fail-closed 单独实测**：另起一个未设 `ADMIN_TOKEN` 的实例（:8090），写接口返回 503 `server_misconfigured`。
- 前端：`tsc --noEmit`（strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）零错误；
  `vite build` 单入口 292KB（gzip 84.5KB）；三份 preview 各 ~285.7KB，互差仅 `data-theme` 与烘焙常量。
- **UI 写路径实测**：`morandi.html` 页面内填令牌 → 点「修复阴瑜伽 21:00」→ 填手机号 `13820260001` → 提交，
  可访问性快照显示表单「操作已完成」、名单从 11 人增至 12 人并出现 `赵岩 / 13820260001 / 年卡 / 已确认 / 前台 / 11:06 UTC`，
  课表该行座位变 `12/12`、表单标题变「（已满座，勾选候补才允许排队）」；服务端 `/api/sessions/24` 同样查到该笔。
  同页另一行 `硬拉突破课 10/10 候补 2 人` 证明候补态在真实数据里可见。

## 8. 坑与结论（下一轮别再踩）

1. **单文件内联不能碰正则**：bundle 里合法含 `<\/script>`，用正则匹配脚本区会截断产物；
   必须按精确下标定位入口标签再切片，写盘后断言 `out.includes(js)` 且只出现一次。
   `String.replace` 的替换串里 `$'`/`$&` 会自我复制文档 —— 一律用 replacer 函数（本轮 `index.html` 标题替换就因传了字符串而静默不生效）。
2. **Vite ESM 产物在 `file://` 下不执行**：preview 必须内联；且双击打开时 `Origin: null` 会被 CORS 拒 →
   取数据必须走 `serve-static.mjs`（localhost）或后端 `STATIC_DIR` 同源托管。这是有意的安全取舍。
3. **改了种子/建表代码后，必须确认 :8080 上跑的到底是哪个进程**：`lsof -nP -iTCP:8080 -sTCP:LISTEN -t` → `ps -o command= -p <pid>` 核对命令行后再 kill。
   本轮踩过：新实例因端口占用静默退出，curl 打到旧进程 + 已被 `rm` 的 db inode，看到的还是旧种子数据（教练重名歧义没消失）。
4. **`by_coach` 按 (教练, 级别) 分组会让同一个人裂成两行**：根因是种子里一名教练挂了两个级别。
   修数据（一名教练一个级别）比在 SQL 里折叠更对，也更符合真实工作室的常识。
5. **写接口的容量/查重/扣次必须同处一个事务**，靠 `SetMaxOpenConns(1)` + `txlock(immediate)` 天然串行；
   扣次门槛要在 `tx.Create` **之前**判定，否则失败靠回滚兜底（能跑对但语义脏、还会白占自增 ID）。
6. `bookings` 表没有 `(session_id, member_id)` 唯一索引，查重目前是事务内 `SELECT` + 单写者保证。
   真要放开多连接，必须先补复合唯一索引（`confirmed/waitlist` 用部分索引），否则并发会双双通过查重。
7. 越界查询参数**收敛**比 400 更合适（看板要能容错渲染），但必须把收敛后的值回给前端（`schedule` 响应带 `sort/from/days/page_size`），否则界面与数据会各说各话。
8. **browser-use 的 `evaluate_script` 一旦页面被 React 重渲染/有 pending 请求，就会 15s 超时（脚本其实已执行）**。
   对策：把「改状态的动作」和「读结果」拆成两次调用，读结果用 `take_snapshot`（可访问性树）而不是拼大对象；
   `async () => { await fetch... }` 这种写法在此面板基本必超时，别用。
9. 本机网络：GitHub/jsDelivr HTTPS 被 TLS 重置 → `npm --registry=https://registry.npmmirror.com`、Go 走 `goproxy.cn`、只用 `git@github.com:` SSH；不要 `npx`。
10. IDE 浏览器面板无截图 → 样式核对全部走 `getComputedStyle` 探针（`scripts/style-probe.js`）+ 可访问性快照。
