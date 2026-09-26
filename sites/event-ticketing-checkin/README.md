# 灯塔票务 · 本地活动票务与核销台（event-ticketing-checkin）

第 14 轮业务网站实验室产物。Go + Gin + SQLite 后端、React + Vite + TS 前端，
同一个页面挂三套纯 CSS 风格。业务承重墙不是「能不能下单」，而是两条一旦破掉就出真事故的约束：

* **一票一入**——一张票在任意闸口只能核销一次，且只能在「开门 → 开演 + 迟到宽限」这个窗口内；
* **钱按分算、退款只退票面**——服务费留存，`实付 = 票面小计 + 服务费`、`退款 + 留存 = 实付` 必须处处配平。

## 场景与角色

一个本地演出厂牌的票务中台：8 场演出（音乐会 / 话剧 / 现场音乐 / 展览 / 亲子 / 电竞 六类）、
20 个票档、约 60 笔订单、150 张票，覆盖开售、检票、退票、散场、取消的完整生命周期。
同一套数据给四类人看：

| 角色 | 关心什么 | 界面上对应 |
| --- | --- | --- |
| 票务运营 | 哪个场次卖到什么成数、哪档售罄、早鸟还剩几小时 | 「经营总览」KPI + 「场次与票档」列表 |
| 售票员 / 现场 | 按场次 + 票档快速出一张票并给小票 | 「出票」页签（试算 → 提交 → 票券小票） |
| 闸口核验员 | 扫票号即裁决：能不能进、为什么不能进 | 「核销台」（查验小票 + 拒绝原因码 + 核销日志） |
| 客服 / 财务 | 这单能不能退、退了多少钱、留存多少、账对不对 | 「退票」+「台账」+ 对账恒等式卡 |

**核心不变量**（全部由后端保证，并在 `GET /api/stats` 里实时自检回显 `identity_ok` / `identity_issues[]`）：

1. `Σ 票档已售 = 在效票 + 已入场票`（配额占用与票面一致，退票必须归还配额）；
2. `未入场 + 已入场 + 已作废 = 出票总量`；
3. 每笔订单 `实付 = 票面小计 + 服务费`、`票面小计 = 单价 × 张数`、`服务费 = 单张服务费 × 张数`；
4. 已退订单 `退款 + 留存 = 实付`；
5. 不允许超卖（`sold_quantity ≤ quota`）；
6. 每笔已支付 / 已退订单的票数 = 购买张数；
7. 每张已入场票必须有闸口与时刻留痕；
8. 手机号入库格式必须合法（11 位、`1[3-9]` 号段）。

恒等式异常**不是请求错误**：接口仍返回 200，把问题写进 `identity_issues[]`（绝不返回 `null`），
让看板显示「对账异常」而不是白屏。

三张状态机（唯一解释处都在 `internal/domain`）：

```
场次  draft ──open──> on_sale ──close──> closed（终态）
          │             └──cancel──> cancelled（终态）
票档  open ⇄ paused（停售只拦新单，不动已售）
订单  pending ──pay──> paid ──refund──> refunded（终态）
          └──cancel──> cancelled（终态）
票券  valid ──check-in──> used（终态） / valid ──随单退票──> void（终态）
```

**判定顺序是契约的一部分**：核销先裁「窗口」（场次状态 → 入场时间 → 迟到宽限），
再裁「票态」（已入场 / 已作废）。所以一张作废票在还没开门的场次上返回的是 `doors_not_open`，
不是 `ticket_void`——`TicketVerdict` 在 `!v.Allowed` 时原样返回窗口裁决。
退票同理：`状态 → 票态（有人入场/已有作废）→ 退票截止时间`。

## 数据模型

4 张表，GORM `AutoMigrate` 建表（`internal/repository/db.go`）：

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `events` | `code`(uniq) `title` `artist` `category` `venue` `city` `gates` `doors_at` `start_at` `on_sale_at` `presale_end` `status` `refund_cutoff_hours` `note` `closed_at` | `gates` 是逗号分隔的闸门清单；时间为 UTC 文本 |
| `ticket_types` | `code`(uniq) `event_id` `name` `zone` `unit_cent` `service_cent` `early_bps` `quota` `sold_quantity` `seated` `status` | 金额一律整数「分」；`early_bps` 是早鸟立减万分比 |
| `orders` | `code`(uniq) `event_id` `type_id` `buyer` `phone` `channel` `quantity` + 金额快照 6 列 + `status` `paid_at` `refunded_at` `refund_reason` `last_four_digits` | `phone` 的 json tag 是 `"-"`，对外只有 `phone_masked` |
| `tickets` | `code`(uniq) `order_id` `event_id` `type_id` `seq` `seat_zone` `seat_row` `seat_no` `status` `issued_at` `used_at` `gate` | 一票一行，核销留痕在 `used_at` + `gate` |

真实 DDL（`sqlite3 <db> .schema` 原样输出）：

```sql
CREATE TABLE `events` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`title` text,`artist` text,
  `category` text,`venue` text,`city` text,`gates` text,`doors_at` datetime,`start_at` datetime,
  `on_sale_at` datetime,`presale_end` datetime,`status` text,`refund_cutoff_hours` integer,
  `note` text,`created_at` datetime,`closed_at` datetime);
CREATE UNIQUE INDEX `idx_events_code` ON `events`(`code`);
CREATE INDEX `idx_events_status` ON `events`(`status`);
CREATE INDEX `idx_events_category` ON `events`(`category`);

CREATE TABLE `ticket_types` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`event_id` integer,
  `name` text,`zone` text,`unit_cent` integer,`service_cent` integer,`early_bps` integer,
  `quota` integer,`sold_quantity` integer,`seated` numeric,`status` text);
CREATE UNIQUE INDEX `idx_ticket_types_code` ON `ticket_types`(`code`);
CREATE INDEX `idx_ticket_types_event_id` ON `ticket_types`(`event_id`);
CREATE INDEX `idx_ticket_types_status` ON `ticket_types`(`status`);
CREATE INDEX `idx_ticket_types_sold` ON `ticket_types`(`sold_quantity`);

CREATE TABLE `orders` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`event_id` integer,`type_id` integer,
  `buyer` text,`phone` text,`channel` text,`quantity` integer,`unit_cent` integer,`service_cent` integer,
  `discount_bps` integer,`subtotal_cent` integer,`fee_cent` integer,`payable_cent` integer,
  `retained_cent` integer,`refunded_cent` integer,`status` text,`created_at` datetime,`paid_at` datetime,
  `refunded_at` datetime,`refund_reason` text,`last_four_digits` text);
CREATE UNIQUE INDEX `idx_orders_code` ON `orders`(`code`);
CREATE INDEX `idx_orders_event_id` ON `orders`(`event_id`);
CREATE INDEX `idx_orders_type_id` ON `orders`(`type_id`);
CREATE INDEX `idx_orders_status` ON `orders`(`status`);
CREATE INDEX `idx_orders_channel` ON `orders`(`channel`);

CREATE TABLE `tickets` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`order_id` integer,
  `event_id` integer,`type_id` integer,`seq` integer,`seat_zone` text,`seat_row` text,`seat_no` text,
  `status` text,`issued_at` datetime,`used_at` datetime,`gate` text);
CREATE UNIQUE INDEX `idx_tickets_code` ON `tickets`(`code`);
CREATE INDEX `idx_tickets_order_id` ON `tickets`(`order_id`);
CREATE INDEX `idx_tickets_event_id` ON `tickets`(`event_id`);
CREATE INDEX `idx_tickets_type_id` ON `tickets`(`type_id`);
CREATE INDEX `idx_tickets_status` ON `tickets`(`status`);
```

种子数据（`internal/repository/seed.go`，仅当库为空时灌入，随机源固定 `20260926`）：
8 场演出（1 草稿 / 4 在售 / 2 已散场 / 1 取消）、20 个票档、约 60 笔订单与 150 张票，
覆盖上面三张状态机的每一条边。种子里每张票的状态、每次核销的闸口、每笔退款金额都是**调服务层同一套
判定函数**算出来的，所以灌完数据 `identity_ok` 就是 `true`。两条铁律写在文件头注释里：
所有落库时间一律 UTC；确定性种子必须对「当前墙钟」做边界检查（否则清晨跑批时「此刻开门」的场次会整段消失）。

## 接口清单

12 个端点：1 健康检查 + 6 读 + 5 写。写全部在 `/api/admin` 下，过 `bodySizeLimit(16 KiB)` + `AdminAuth`。

| 方法 | 路径 | 鉴权 | 入参 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 无 | — | `{status,time}`（UTC RFC3339） |
| GET | `/api/stats` | 无 | `days`（夹到 1-60，默认 14） | 汇总 + `daily[]` + `by_channel[]` + `active_now[]` + `identity_ok`/`identity_issues[]`/`identity_note` |
| GET | `/api/events` | 无 | `status` `category` `city` `q` `sort` `dir` `page` `page_size` | 信封 `{items,total,page,page_size,sort,dir,served_at}`，item 含聚合列 |
| GET | `/api/events/:code` | 无 | 编号 6-24 位白名单字符 | `{event,ticket_types[]}`（含 `now_unit_cent`：早鸟是否生效后的实价） |
| GET | `/api/orders` | 无 | `status` `event` `channel` `q` + 分页排序 | 信封，item 为 `OrderView`（含 `phone_masked`、`refundable`、`refund_why`） |
| GET | `/api/tickets` | 无 | `status` `event` `type` `q` + 分页排序 | 信封，item 为 `TicketView`（含 `gates[]`、`checkinable`、`checkin_why`） |
| GET | `/api/tickets/:code` | 无 | 票号 | `{ticket}` |
| POST | `/api/admin/events` | Bearer | `CreateEventInput` | 201 `{event,message}`，新场次一律落成 `draft` |
| POST | `/api/admin/events/:code/status` | Bearer | `{action: open\|close\|cancel}` | 200 `{event,message}`；非法跳转 409 |
| POST | `/api/admin/sales` | Bearer | `SaleInput`（`event_code` `type_code` `quantity` `buyer` `phone` `channel`） | 201 `{order,tickets[],message}` |
| POST | `/api/admin/tickets/:code/check-in` | Bearer | `{gate}` | 200 `{ticket,message}`；拒绝时 4xx + 原因码 |
| POST | `/api/admin/orders/:code/refund` | Bearer | `{reason}`（2-120 字） | 200 `{order,refunded_cent,message}` |

排序白名单（`internal/domain/query.go`）：`sort` 只可能是 map 的 key，进 `ORDER BY` 的只可能是
map 的 value（列名**不回显**给客户端，回显的是 key）。
`events`: `doors|start|code|status|sold|gross|used|quota|id`；
`orders`: `created|payable|qty|status|code|event|id`；`tickets`: `issued|used|code|status|seat|event|order|id`。
`dir` 只认 `asc`（大小写不敏感），其余一律 `desc`。`page_size` 上限 100，`page` 上限 100000，`q` 截到 48 个 rune。

裁决 / 错误码（前端 `VERDICT_LABEL` 与 domain 一一对应，未知码原样显示）：
`not_on_sale` `event_closed` `event_cancelled` `doors_not_open` `gate_shut` `gate_required` `gate_unknown`
`already_used` `ticket_void` `already_refunded` `order_cancelled` `partially_used` `partially_void`
`past_cutoff` `sold_out` `conflict` `not_found` `invalid_request` `invalid_code` `unauthorized`
`forbidden` `server_misconfigured` `body_too_large` `internal_error`。

## 安全与口径设计

* **鉴权三层、fail-closed**（`internal/handler/auth.go`）：服务端没配 `ADMIN_TOKEN` → 503
  `server_misconfigured`（绝不因「期望值为空」放行）；缺 `Authorization` 或非 `Bearer ` 前缀 → 401；
  令牌不匹配 → 403。比较用 `subtle.ConstantTimeCompare`，方案前缀大小写不敏感。
  只配一个环境变量，够用即可，不引入 JWT。
* **不泄露内部**：错误出口只有一处 `AbortWithError`。`domain.AppError{Code,Message,Err}` 的 `Message`
  可对外，其它任何 error（含 GORM / 驱动 / SQL 文本）一律降级成 `{internal_error,"服务内部错误，请稍后重试"}`，
  **绝不回显 `err.Error()`**；`ErrRecordNotFound` 单独映射成 404 `not_found`。
* **输入只在 `ShouldBind*` 之后校验**：入参一律 DTO + `domain.Validate()` 返回逐字段中文错误
  （`{code,message,fields{字段:原因}}`），跨字段约束也在这里（开演必须晚于开门、早鸟截止不得晚于开门、
  退票窗口 2-72 小时、闸口 1-8 个）。
* **隐私**：`orders.phone` 的 json tag 为 `"-"`，接口只出 `phone_masked`（`138****1111`）与 `last_four_digits`；
  `ValidPhone` 卡 11 位 + `1[3-9]` 号段（只校验「11 位纯数字」的话 `23800001111` 这种拨不通的号也能建单）。
  购票人 / 编号等字段走字符白名单（字母数字 `_` `-`），尖括号注入串根本进不了库。
* **SQL**：排序列白名单 + 占位符绑定；`q` 作为绑定参数传， `%` `_` 不做拼接；路径参数先过 `safeCode`。
* **HTTP 层**：`/api/*` 一律 `Cache-Control: no-store`；`X-Content-Type-Options: nosniff`、
  `X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`；
  CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
  （style 的 `unsafe-inline` 是三风格运行时注入的必需豁免，script 一步都不让）。
  请求体 16 KiB 上限（谎报 `Content-Length` 与不声明长度两条路分别由中间件和 `MaxBytesReader` 拦），
  单请求 8 秒 context 超时，`ReadHeaderTimeout` 5 秒。
* **CORS**：只放行**主机名精确等于** loopback 的 `http(s)` Origin（前缀匹配会放行 `http://127.0.0.1.evil.example`），
  且明确拒绝 `Origin: null`。
* **SQLite**：纯 Go 驱动 `glebarez/sqlite`（无 CGO），DSN
  `_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)`，
  `SetMaxOpenConns(1)` 单写者；库文件 0600，`Harden()` 在种子写入后再压一遍
  （`-wal`/`-shm` 只在首次写入后才出现，Open 里 chmod 会漏掉它们，而 WAL 里是完整数据页）。
* **钱**：整数分 + 万分比（`early_bps`、`sell_through_bp`），展示层才换算，`Number.isFinite` 兜底。
* **时区**：内部一律 UTC 存取与比较，展示也是 UTC 文本，避免同一份数据在不同机器上算出不同「剩余有效期」。

## 从零重建

前置：Go ≥ 1.27、Node ≥ 22（内置 `WebSocket`，取证脚本零依赖）、本机 Google Chrome（无头取证）。

```bash
LAB="/Users/apple/Documents/workProject/试验/业务网站实验室"
SITE="$LAB/sites/event-ticketing-checkin"
export GOMODCACHE="$HOME/go/pkg/mod" GOPROXY=https://goproxy.cn,direct GOTOOLCHAIN=local
# 只是本地一次性冒烟令牌；换成自己的随机值，别把它写进任何会提交的文件
export ADMIN_TOKEN='<自造随机串>'
export SITE_PORT=18907

# 1) 后端：建表 + 灌种子 + 起服务（STATIC_DIR 指向前端产物，页面与接口同源）
cd "$SITE/backend"
go build -o /tmp/etk-api ./cmd/api            # -o 用绝对路径：相对路径会写到别处导致跑到旧二进制
go vet ./... && go test -count=1 ./...        # domain / repository / server 三层
cd "$SITE"
rm -f /tmp/etk-rebuild.db /tmp/etk-rebuild.db-wal /tmp/etk-rebuild.db-shm
STATIC_DIR="$SITE/web/dist" nohup /tmp/etk-api -addr :$SITE_PORT -db /tmp/etk-rebuild.db \
  > /tmp/etk-api.log 2>&1 &                    # Bash 工具会回收后台进程，所以用 nohup
curl -s "http://127.0.0.1:$SITE_PORT/api/health"

# 2) 前端：npm 走镜像，装完构建（三套 CSS 以 ?raw 打进同一个 bundle）
cd "$SITE/web"
npm config set registry https://registry.npmmirror.com   # 或每条命令带 --registry=…
npm install --no-audit --no-fund
npx tsc --noEmit
npx vite build                                          # dist/assets/app.js ≈ 308 KB，单包无外链
node "$SITE/scripts/inline-preview.mjs" "$SITE/web" "http://127.0.0.1:$SITE_PORT/api"
                                                          # → preview/{velvet,nautical,typewriter}.html 单文件

# 3) 验证四组（全部对着真运行的实例，不 mock）
cd "$SITE"
ADMIN_TOKEN="$ADMIN_TOKEN" node scripts/api-smoke.mjs "http://127.0.0.1:$SITE_PORT" \
  "http://127.0.0.1:18908"                                # 第二个地址可选，见下
# fail-closed 探针用的第二个实例（故意不给 ADMIN_TOKEN）：
nohup env -u ADMIN_TOKEN /tmp/etk-api -addr :18908 -db /tmp/etk-noauth.db > /tmp/etk-noauth.log 2>&1 &
node scripts/render-probe.mjs "http://127.0.0.1:$SITE_PORT" "http://127.0.0.1:$SITE_PORT/api" velvet nautical typewriter
CDP_PORT=19821 node scripts/style-evidence.mjs "http://127.0.0.1:$SITE_PORT" evidence velvet nautical typewriter
# 单文件预览版也要过同一套断言（换 19822 端口避免撞上还在跑的会话）：
node scripts/serve-static.mjs "$SITE/preview" 18904 "http://127.0.0.1:$SITE_PORT/api" &
CDP_PORT=19822 node scripts/style-evidence.mjs 'http://127.0.0.1:18904/{theme}.html?theme={theme}' /tmp/etk-prev velvet nautical typewriter

# 4) 手工点验（curl 逐个端点）
curl -s "http://127.0.0.1:$SITE_PORT/api/stats?days=14" | head -c 400
curl -s "http://127.0.0.1:$SITE_PORT/api/events?status=on_sale&sort=sold&dir=desc&page_size=5"
curl -s -X POST "http://127.0.0.1:$SITE_PORT/api/admin/sales" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"event_code":"ET261010A","type_code":"TT261010A1","quantity":2,"buyer":"manual_check","phone":"13800001111","channel":"box"}'
curl -s -X POST "http://127.0.0.1:$SITE_PORT/api/admin/tickets/<上一步返回的票号>/check-in" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"gate":"A"}'
```

`preview/*.html` 是「双击就能看」的单文件交付物：JS 与 CSS 全部内联，Vite 的 ESM 产物在 `file://`
下不执行，所以内联版才真正可离线打开；接口地址由文件里的 `window.__API_BASE__` 兜底值决定，
后端不在时页面只显示错误条，不会白屏。

## 三个前端风格

**同一个 DOM、同一份 JS，只有 3 个 CSS 文件**（`web/src/styles/theme-{velvet,nautical,typewriter}.css`）。
组件里没有任何主题分支：`themes.tsx` 用 `?raw` 把三份 CSS 打进同一个 bundle，运行时按
「URL `?theme=` > `window.__THEME__` > localStorage」选一个，塞进 `<style id="etk-theme">` 并设
`documentElement.dataset.theme`，主题切换不改一个 class 之外的结构。
切换器是页面上三个色卡按钮（`.theme-btn`），也是唯一允许 `is-on` 移动的地方。

| 维度 | 丝绒影院售票亭 velvet | 航海图罗盘 nautical | 老式打字机稿件 typewriter |
| --- | --- | --- | --- |
| 主张 | 老电影院售票窗口：深红丝绒底 + 烫金描边，跑马灯灯泡沿 | 海图作业面：等深线 + 经纬网格 + 罗盘玫瑰，标注一律大写字距 | 机打稿件：米色纸、等宽铅字、回格线、页边红竖线 |
| 底色 | 暗酒红径向渐变（`#170709` 系） | 深蓝图纸（`rgb(6,34,49)`）+ 网格线 | 米纸（`rgb(239,233,220)`）+ 回格横纹 |
| 字体 | Georgia / 宋体 衬线 | Avenir Next / 苹方 无衬线 + `letter-spacing` | Courier New 全等宽 |
| 圆角 | 3px（金属描边感） | 14-20px（罗盘与气泡标注） | 0（铅字方角） |
| 表格头 | 烫金分隔线 | 大写 + 宽字距，图例样式 | 双下划线（复写纸感） |
| 装饰 | 灯泡跑马边框（`::before/::after` 径向点） | 罗盘玫瑰 `conic-gradient` + 等深线 | 页边红竖线 + 「CONFIDENTIAL COPY」印章位 |
| 尺寸基线 | 15px / 1180px 版心 | 15px / 1240px 版心 | 14px / 满宽纸面 |

三份 CSS 的**选择器集合完全一致**（76 个页面真实 class 每份都命中），
这是「换风格不换结构」的可验证版本，而不是「另一套页面」。

取证脚本 `scripts/style-evidence.mjs`（本机无头 Chrome + 自写 CDP，零依赖）逐主题、逐 6 个页签抓
`getComputedStyle` 快照并断言：

* DOM 同构（按标签 + class 序列取 `isoHash`，`is-on` 单独计数 `onCount` 比对）；
* 每页签渲染数据同构（行数 / KPI 值 / 首个票号 / 对账文案）；
* 零外链资源、无 `.err` 提示、主题 CSS 真的注入（velvet 12 298 B / nautical 13 551 B / typewriter 13 138 B）；
* **两两计算样式差异 ≥ 3**：实测 overview 页签上 velvet×nautical 31 项、velvet×typewriter 36 项、
  nautical×typewriter 37 项（背景、字体、字号、圆角、字距、边框、阴影都不同）；
* 同一主题自比必须 0 差异（反证计数器不是瞎报）；
* 页面用到的 76 个 class 在三份 CSS 里全部出现（漏写规则掉回浏览器默认值时，差异统计照样充足，所以要单独断言）。

快照与截图落在 `evidence/`（`probe-<theme>-<tab>.json` 18 份、`shot-<theme>.png` 3 份、
`class-universe.json`、以及四组验证日志 `verify-*.txt`）。

## 验证结果（本轮实跑）

| 组 | 命令 | 结果 |
| --- | --- | --- |
| 单元 / 集成 | `go vet ./... && go test -count=1 ./...` | domain / repository(2.3s) / server(11.2s) 全 ok |
| 前端静态 | `npx tsc --noEmit`（strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`） | 0 错误；`vite build` 单包 307.97 kB |
| 接口冒烟 | `node scripts/api-smoke.mjs <实例> <无令牌实例>` | **327 条断言，0 失败**（含鉴权 401/403/503 三层、注入与超长边界、售票→核销→退票→散场因果链、退款后配额回补、全量响应泄露扫描、写后对账仍全绿） |
| 渲染取证 | `node scripts/render-probe.mjs <SPA> <API> velvet nautical typewriter` | **42 条断言，0 失败**（现场造靶子 → 按编号/按购票人/按票号在 UI 里查得到 → 恶意文本 `innerHTML` 显示为 `&lt;img …&gt;`、`#root` 内 img/script/iframe/object/embed/onerror 属性全 0 → 资源全同源 → 无 JS 异常与控制台报错） |
| 三风格 | `node scripts/style-evidence.mjs`（SPA 与 preview 各一轮 × 3 主题 × 6 页签） | 45 条断言全 PASS，18 份探针快照一致 |

`evidence/verify-*.txt` 保留了三组的完整输出。

## 本轮踩坑（下轮别再踩）

1. **异步检索的断言必须等「过滤真的生效」**：核销页输入票号后 `lookup.data` 先返回 `null` 再落数据，
   第一版取证脚本「先查一次拿空 → 立刻再查一次拿到」→ 三个主题里两个假通过。改成等目标值本身
   （`rows.length===1 && 该行含靶子串`），并在两个连续采样一致后才读数。
2. **`is-on` 这类「当前选中」class 会让 DOM 指纹合理地移动**：主题按钮和页签各有一个 `is-on`，
   三主题的 `domHash` 永远对不上。方案是指纹里剔除 `is-on` 另计 `onCount` 单独断言，
   而不是把断言删掉。
3. **页面上同时挂着「列表表」和「详情票档表」两张 `.table`**：取证脚本用 `.table tbody tr` 计数会串台，
   必须锚定 `[...document.querySelectorAll('.table')][0]`。
4. **冒烟脚本的入参要从接口取，别猜种子**：新场次没有票档（票档只能来自种子），所以「现场出票」
   必须遍历 `GET /events?status=on_sale` + 详情里的 `ticket_types`，挑 `status==='open' && remaining>0`
   的那档。写死 `ETLIVE01` 会在 `refund_cutoff_hours=6` 的场次上撞 `past_cutoff`，看着像 bug。
5. **`doors_not_open` 与 `ticket_void` 的顺序**：一张刚退掉的票在没开门的场次上过闸，HTTP 上返回的是
   窗口裁决；`ticket_void` 那条分支由 go test 在窗口已开的场次上覆盖。冒烟断言要按这个契约写，
   而不是按「我以为先查票态」。
6. **鉴权探针打错实例**：`503`（未配令牌）与 `401`（缺 `Bearer`）只差一个 base 变量，
   复用主实例的 `post()` 会让 5 条 503 断言全变成 401。fail-closed 那段必须用自己的 fetch。
7. **真缺陷：`ValidPhone` 只校验「11 位纯数字」**，`23800001111`、`12800001111` 这类根本拨不通的号
   能建单入台账。已收紧为 `1[3-9]` 号段，并把 9 个用例（含 `138 0000 1111` 带空格）写进表驱动测试。
   校验文案同步改掉，否则用户按提示改了还被拒。
8. **JS 产物含未转义 `</script>` 就不能内联**：`inline-preview.mjs` 改成先按下标定位入口标签，
   并显式检查产物里有没有裸 `</script>`，宁可失败也不产出坏文件。

## 目录

```
backend/  cmd/api + internal/{domain,repository,service,handler,server}
web/      index.html + src/{App.tsx,api.ts,format.ts,themes.tsx,types.ts,useAsync.ts,styles/theme-*.css}
preview/  velvet.html / nautical.html / typewriter.html（单文件交付物）
evidence/ 18 份计算样式快照 + 3 张截图 + class 全集 + 四组验证日志
scripts/  api-smoke.mjs（327 断言）、render-probe.mjs（42 断言）、style-evidence.mjs + style-probe.js、
          inline-preview.mjs（单文件产物）、serve-static.mjs、headless.mjs + cdp-client.mjs（零依赖无头 CDP）
README.md 本文件
```
