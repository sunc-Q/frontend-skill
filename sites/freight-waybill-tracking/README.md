# 运单运营台 · 体积计费与路由轨迹（freight-waybill-tracking）

Go/Gin + SQLite 后端、Vite + React + TS 前端的业务网站样例。一条零担货运线路的日常：客户电话报单、按「实际重 / 体积重取大」计费、干线中转逐点打卡、超时与异常挂起、退回不计营收。同一套页面渲染成三种互斥视觉风格。

## 场景与角色

零担网点的运营台不是「订单列表」，而是一台秤 + 一张时刻表。定价错了整月白干，轨迹断了客服就查不到货。

| 角色 | 关心的事 | 落在哪个模块 |
| --- | --- | --- |
| 网点客服 | 开单（线路/寄件人/手机/件数/三围重量/声明价值/易碎）并当场拿到应收快照 | 页脚「新开运单」表单 + 台账 |
| 分拨扫码员 | 按状态机打卡推进，写网点与备注；发现异常就挂起并写明原因 | 详情右栏「登记轨迹」「上报异常」 |
| 计费专员 | 试算同参数是否同价、附加费按优先级仲裁并封顶、历史单快照不回溯 | 「运费试算台」+ 计费明细 + 规则表启停 |
| 站点经理 | 营收、泡货占比、准点率、异常率、退回（不记营收）、每条线路的营收结构 | 经营指标（KPI + 趋势 + 线路条 + 状态芯片） |

业务口径（唯一算法 `backend/internal/domain/quote.go` 的 `QuoteOf`，试算 / 开单 / 种子三处共用，统计层绝不二次算价）：

1. **体积重**（克）= 体积(cm³) × 1000 ÷ 抛比，向上取整。抛比按线路档位：特快 6000、标快 8000、经济 12000（缺省 8000）。
2. **计费重** = `ceilTo500( max(实际重, 体积重) )` —— 一律向上进位到 500 g 一档（`ChargeStepGrams = 500`）。
3. **运费** = 首重价 + 续重档数 × 每 500 g 单价，再与单票最低运费 `min_cents` 取大。
4. **燃油附加** = 运费 × 线路燃油率（整数百分比，`roundHalfUp` 四舍五入到分，纯整型不碰浮点）。
5. **保价** = 声明价值 × 0.3%（`InsuranceBasisPoints = 30`，万分之三），一旦申报最低 2 元（`InsuranceMinCents = 200`）；未申报则为 0。
6. **附加费仲裁**：`remote_pct`（偏远区按运费比例，带最低额）、`heavy_piece`（单件超重固定额）、`fragile_flat`（易碎加固固定额）、`long_haul_flat`（长途干线固定额）四类，按 `priority` 升序、同优先级按 code 升序逐条判定，命中即计入明细 `surcharge_items`；合计**封顶运费+燃油的 80%**（`SurchargeCapPct`），截断时 `surcharge_capped = true` 留痕。
7. **总额** = 运费 + 燃油 + 保价 + 附加费。这条恒等式随接口发布为 `identity_ok` / `identity_issues`，后端自检、前端原样显示。

其余口径：

- **八态机**（`domain.NextStatus`，表外目标一律 409 `invalid_transition`）：
  `booked → {picked_up, exception, returned}`；`picked_up → {in_transit, exception, returned}`；`in_transit → {arrived, exception, returned}`；`arrived → {out_for_delivery, exception, returned}`；`out_for_delivery → {delivered, exception, returned}`；`exception → {in_transit, out_for_delivery, returned}`；`delivered` / `returned` 为终态。异常不是黑洞：恢复即回到在途，签收与退回互斥。
- **轨迹不变量**：同单内 `seq` 连续且唯一（`CREATE UNIQUE INDEX idx_events_waybill_seq ON scan_events(waybill_id, seq)`），时间单调不倒流；`/api/waybills/:code` 的 `events` 按 **seq 倒序**返回（最新在前，前端与冒烟都按这个约定取值）。
- **单号**：`FY<业务日 YYYYMMDD>-<当日流水 4 位>`，流水在事务内按 `code LIKE 'FY%<日>-%'` 计数 +1，冲突重试；业务日是 **UTC+8 的日历日**（`businessDate` = `date(booked_at,'+8 hours')`），所以 `/api/health` 的 UTC 时间与页面上的「业务日」差 8 小时是预期，不是 bug。
- **营收口径**：`revenue_cents` **剔除已退回**（退回单运费另计），`delivered` 为准点判定基准（`delivered_at ≤ promised_at`），`on_time_pct` / `exception_pct` / `bulky_pct` 都在 `/api/stats` 里派生，前端不做二次算术。
- **隐私**：`phone` 字段 json tag 为 `-`，只出 `phone_masked`（`138****1234`）；搜索 `q` 转义 LIKE 通配符后只匹配 `w.code` 与 `w.shipper_name`，绝不 LIKE 手机号。

## 数据模型

四张表，DDL 由 GORM `AutoMigrate` 产出（另加 1 个手写复合唯一索引）：

```sql
CREATE TABLE `lanes` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`origin` text,`destination` text,
  `tier` text,`distance_km` integer,`first_kg` integer,`first_cents` integer,`half_kg_cents` integer,
  `min_cents` integer,`fuel_pct` integer,`vol_divisor` integer,`promise_days` integer,
  `remote_area` numeric,`active` numeric,`created_at` datetime);
CREATE UNIQUE INDEX `idx_lanes_code` ON `lanes`(`code`);
CREATE INDEX `idx_lanes_active` ON `lanes`(`active`);
CREATE INDEX `idx_lanes_tier` ON `lanes`(`tier`);

CREATE TABLE `surcharge_rules` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`name` text,`kind` text,
  `threshold_g` integer,`threshold_km` integer,`rate_pct` integer,`amount_cents` integer,
  `min_cents` integer,`priority` integer,`active` numeric,`created_at` datetime);
CREATE UNIQUE INDEX `idx_surcharge_rules_code` ON `surcharge_rules`(`code`);
CREATE INDEX `idx_surcharge_rules_active` ON `surcharge_rules`(`active`);
CREATE INDEX `idx_surcharge_rules_kind` ON `surcharge_rules`(`kind`);

CREATE TABLE `waybills` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`lane_id` integer,`status` text,
  `shipper_name` text,`phone` text,`piece_count` integer,`weight_grams` integer,`volume_cm3` integer,
  `heaviest_g` integer,`declared_cents` integer,`fragile` numeric,`remote_area` numeric,
  `volumetric_grams` integer,`chargeable_grams` integer,`freight_cents` integer,`fuel_cents` integer,
  `insurance_cents` integer,`surcharge_cents` integer,`total_cents` integer,`surcharge_detail` text,
  `surcharge_capped` numeric,`booked_at` datetime,`promised_at` datetime,`delivered_at` datetime,`updated_at` datetime);
CREATE UNIQUE INDEX `idx_waybills_code` ON `waybills`(`code`);
CREATE INDEX `idx_waybills_status` ON `waybills`(`status`);
CREATE INDEX `idx_waybills_lane_id` ON `waybills`(`lane_id`);

CREATE TABLE `scan_events` (`id` integer PRIMARY KEY AUTOINCREMENT,`waybill_id` integer,`seq` integer,
  `event_type` text,`node` text,`note` text,`occurred_at` datetime);
CREATE INDEX `idx_scan_events_waybill_id` ON `scan_events`(`waybill_id`);
-- 手写追加（repository/db.go）
CREATE UNIQUE INDEX idx_events_waybill_seq ON scan_events (waybill_id, seq);
```

枚举：`waybills.status` 八态见上；`lanes.tier ∈ {express, standard, economy}`；`surcharge_rules.kind ∈ {remote_pct, heavy_piece, fragile_flat, long_haul_flat}`；`scan_events.event_type ∈ {booked, picked_up, line, in_transit, arrived, out_for_delivery, delivered, exception, returned}`（`line` 是纯干线中转打卡，不改变状态）。

`waybills` 里的 `volumetric_grams / chargeable_grams / freight_cents / fuel_cents / insurance_cents / surcharge_cents / total_cents / surcharge_detail / surcharge_capped` 全是**下单时刻的报价快照**：调价、改规则、停用规则都不回溯历史单，这正是 `GET /api/quote` 与详情快照必须逐分相等的含义。

种子数据（`backend/internal/repository/seed.go`，固定随机源 `20260926`，重复灌库结果一致）：9 条线路（8 条在售 + 1 条停售，4 条偏远）/ 5 条附加费规则（4 启用 + 1 停用）/ 150 张运单（近 14 个自然日按 6→15 单爬坡，覆盖全部八态：已下单 3、已揽收 6、干线运输中 4、已到达分拨 3、派送中 6、已签收 115、异常挂起 9、已退回 4）/ 1076 条轨迹（含纯在途中转打卡）。泡货、按体积计费、附加费封顶、保价保底这些分支在种子里都真实存在，统计接口会直接把数量报出来。种子灌数走的是与线上下单同一个 `QuoteOf`。

时间线两条硬约束（本轮补的，`repo_test.go: TestSeedTimelineNeverInFuture` 盯着）：`waybills.booked_at/updated_at` 与 `scan_events.occurred_at` **不得晚于灌库时刻**，且**必须是 UTC 文本**（`NOT LIKE '%+00:00'` 计数为 0）。

## 接口清单

读接口无鉴权（网点大屏要看），5 个写接口全部挂在 `/api/admin` 下过 `AdminAuth(ADMIN_TOKEN)`，并额外套一层 64 KiB 请求体上限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活探针，返回 **UTC** 时间（RFC3339） |
| GET | `/api/lanes?all=1` | 线路档案（默认只给在售）；含首重/续重/最低运费/燃油率/抛比/时效/偏远标记 |
| GET | `/api/rules?all=1` | 附加费规则（默认只给启用），按 `priority, code` 排序 |
| GET | `/api/stats?days=3..30` | 31 个键：营收/运费/燃油/保价/附加五项金额、单量与计费重、泡货数与占比、异常数与占比、准点率、退回、今日开单与今日营收、`by_status`/`by_lane`/`daily`(14 天)/`identity_issues`/`identity_ok` |
| GET | `/api/quote` | 试算。`lane`、`weight_g`、`volume_cm3`、`heaviest_g`、`declared_cents`、`fragile`（`1/true/yes/on` 等价，大小写不敏感）；响应含 `items` 明细、`capped`、`identity_ok`、`volumetric_rule` 文字口径 |
| GET | `/api/waybills` | 台账列表。筛选 `status`（八态白名单）、`lane`、`tier`、`q`（单号/寄件人，服务端转义 LIKE）；排序白名单 `code,total,chargeable,weight,booked,promised,status,lane,pieces,id`（默认 `booked` 倒序，SQL 侧带 `w.id ASC` 兜底同序）；`page` / `page_size`（默认 20，上限 100）。响应信封 `{items,total,page,page_size,sort,dir,served_at}`，`sort` 回显**白名单键名**而非内部列名 |
| GET | `/api/waybills/:code` | 详情：运单档案 + 报价快照 + `phone_masked` + `next_statuses` + `events`（seq 倒序）+ 派生 `promise_overdue` |
| POST | `/api/admin/waybills` | 开单 `{lane_code,shipper_name,phone,piece_count,weight_grams,volume_cm3,heaviest_piece_g,declared_cents,fragile,node}` → 201，直接返回详情形状 |
| POST | `/api/admin/waybills/:code/advance` | 推进 `{to,node,note}` → `{waybill, message}`；`to=delivered` 同事务落 `delivered_at` |
| POST | `/api/admin/waybills/:code/exception` | 挂起 `{node,reason}` → `{waybill, message}`；轨迹备注写 `异常：<reason>` |
| POST | `/api/admin/rules` | 新增规则（9 个字段 + 按 kind 的差异化门槛）→ 201，回规则本身 |
| POST | `/api/admin/rules/:id/toggle` | 启停 → 回翻转后的规则；停用后立即不参与**新单**仲裁 |

中间件：`gin.Recovery` + CORS（只放行本机 http 来源）+ 安全响应头（`nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy: no-referrer` / `Permissions-Policy` / API `Cache-Control: no-store`）+ `requestTimeout(8s)`（服务端另配 `WriteTimeout: 10s`，必须**长于**中间件时限，否则 handler 已判超时连接还在收 body）+ 写接口 `maxBodyBytes(64<<10)`。`NoRoute` 对 `/api/*` 返回 JSON 404，其余走 `filepath.Clean` 规范化的 SPA 静态回退（`STATIC_DIR`，默认 `./web/dist`），深链刷新回落到 `index.html`。

鉴权三层（fail-closed，`handler.AdminAuth`）：

1. 服务端**没配** `ADMIN_TOKEN` → 503 `server_misconfigured`（绝不因为期望值是空串就放行空令牌）；
2. 缺 `Authorization`、只有 `Bearer ` 前缀、方案不是 Bearer、裸令牌无前缀 → 401 `unauthorized`；
3. 令牌不符（含「正确令牌的前缀子串」）→ 403 `forbidden`。方案名按 RFC 7235 大小写不敏感（`bearer xyz` 合法），比对用 `subtle.ConstantTimeCompare`。

输入校验：一律 `ShouldBindJSON` / query 白名单解析，字段错误按 `fields: {字段: 文案}` 回 400 供前端逐框回显。数值一律整型克/分并带区间：件数 1–200、重量 1–2 000 000 g、体积 0–20 000 000 cm³、声明价值 0–10 000 000 分、`heaviest_piece_g ≤ weight_grams`；规则按 kind 追加门槛（`heavy_piece` 不得低于 10 000 g、`long_haul_flat` 不得低于 100 km、比例型必须给费率或最低额、固定型必须给金额、优先级 1–99）。自由文本只限字符数（寄件人/网点/规则名 2–40、备注与原因 ≤120、`q` ≤40 且超长截断），不设字符黑名单：SQL 全走参数占位 + `ESCAPE '\'`，输出走 React 文本节点（无 `dangerouslySetInnerHTML`），注入面在传输层与渲染层各自封死。对外错误只经 `domain.AppError{Code,Message,Err}` → `AbortWithError`，响应体只有 `{code,message,fields}`，不回显 `err.Error()`、SQL、驱动名、栈或源码路径；GORM 的 `ErrRecordNotFound` 统一映射成 404 `not_found`。

## 重建与运行

```bash
# 依赖镜像（本机已验证；命令行与文件里都不出现任何令牌）
go env -w GOPROXY=https://goproxy.cn,direct
cd web && npm i --registry=https://registry.npmmirror.com    # npx 本机不可达，一律走 ./node_modules/.bin

# 改了 base.css 或 tokens-*.css 必须重派生（98 个 token，三套缺一即失败退出）
python3 scripts/derive-themes.py                            # → web/src/styles/theme-*.css

# 前端构建
cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build

# 后端：Go + gin + glebarez/sqlite（纯 Go，无 CGO）
cd ../backend && go build -o /tmp/fwt-build/api ./cmd/api
ADMIN_TOKEN=<本地演示令牌> GIN_MODE=release STATIC_DIR=../web/dist \
  /tmp/fwt-build/api -db /tmp/fwt-run/api.db -addr :18501        # 主实例
env -u ADMIN_TOKEN GIN_MODE=release STATIC_DIR=../web/dist \
  /tmp/fwt-build/api -db /tmp/fwt-run/api2.db -addr :18502       # 「未配令牌」实例（503 断言用）
```

配置全走命令行/环境：`-db`（默认 `./data/app.db`）、`-addr`（默认 `:8080`）、`ADMIN_TOKEN`、`STATIC_DIR`、`GIN_MODE`。DSN 固定 `_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)`，`SetMaxOpenConns(1)`（SQLite 单写者，事务闭包内一律用 `tx`），`db`/`-wal`/`-shm` 三件套在种子灌完后统一压到 **0600**（WAL 里是完整数据页，只压主文件等于没压）。

端口约定：`:18501` 带令牌主实例、`:18502` 不带令牌、`:18511` 冒烟/取证用的全新库实例、`:18512` 单文件 preview 的 http 托管（`file://` 的 `Origin: null` 会被 CORS 明确拒绝——那是刻意不放行，任何本地程序都能拿 null 冒充沙箱）。

```bash
node scripts/inline-preview.mjs web http://127.0.0.1:18511/api   # → preview/{ticket-stub,michelin-gilt,crackle-glaze}.html
node scripts/serve-static.mjs preview 18512 http://127.0.0.1:18511/api
```

> 仓库里现成的 `preview/*.html` 已把 API 基址烤成 `http://127.0.0.1:18501/api`。换端口就按上面两条重新生成。

## 校验（全部要求末行为 0 失败）

```bash
cd backend && gofmt -l . && go vet ./... && go test -count=1 ./...
#   24 个 Test 函数：domain 8 / repository 8 / server 8（字段校验、鉴权 503/401/403、
#   注入与超长、排序白名单逐键执行、脱敏不外泄、状态机全链路、规则仲裁、CORS 精确匹配、请求体上限）
ADMIN_TOKEN=<本地演示令牌> bash scripts/run-smoke.sh
#   自动起双实例 + 全新 /tmp 库 → scripts/api-smoke.sh：⓪~⑩ 共 11 节，末行 pass=253 fail=0
node scripts/style-shoot.mjs 'http://127.0.0.1:18511/?theme={theme}' evidence/probe-dist.json evidence/shot-
python3 scripts/style-diff.py evidence/probe-dist.json                 # 末行「失败项：0」
BASE=http://127.0.0.1:18511 PAGE='http://127.0.0.1:18511/?theme={theme}' ADMIN_TOKEN=<令牌> \
  node scripts/ui-check.mjs                                            # 末行 pass=93 fail=0（同一实例再跑一遍脏库仍 93/0）
```

脚本清单（都留在 `scripts/` 里可独立复跑）：

- `api-smoke.sh`：真端口 + 真 curl。⓪ 样本一律从接口反查（`?status=exception` 之类服务端筛选，不在「第一页 100 条」里猜），必需样本缺失立刻 `exit 1`；① 信封/分页夹逼/排序回显（含「回显里不得有内部列名」与逐键有序性）+ 种子时间线不越界；② 脱敏形状；③ 试算与快照**逐分相等** + 恒等式（shell 整数算术复算，不引用 Go 的结论）+ **独立 Python 复算**体积重/500g 进位/首重/续重/最低运费/燃油 + 泡货按体积计费 + 封顶 80% + 保价保底 + `fragile=1` 与 `fragile=true` 同价；④ 参数校验逐字段；⑤ 鉴权三层矩阵（含小写 `bearer`、错误令牌、无令牌实例 503）且**被拒时确实没写库**（比对前后 total）；⑥ 开单→五步推进全链路（seq 连续唯一、时间不倒流、终态 409）；⑦ 异常挂起/恢复/退回（备注前缀、重复异常 409、终态拒绝）；⑧ 规则校验/新建/启停，并用**同一参数的报价差值**证明「停用立即生效、启用立即回到报价」；⑨ 注入、LIKE 通配符转义（`q=%25` 必须 0 命中）、超长与畸形 body（含谎报 Content-Length）；⑩ 静态托管、安全响应头、CORS（含 `127.0.0.1.evil.example` 这类形似本机域名一律不给 ACAO）、404 形状与深链回落。
- `run-smoke.sh`：写型冒烟不可在同一库重放（推进到底、规则启停都会改变第二轮的期望），所以每轮起全新 `/tmp/fwt-smoke` 库；「未配令牌实例」用 `env -u ADMIN_TOKEN` 显式摘掉环境变量，否则令牌顺着进程环境漏过去，503 断言会变成一次真的写库。
- `ui-check.mjs`：playwright-core + 系统 Chrome，三主题各跑一遍真实交互（主题落地 → 排序 → 空令牌按钮禁用 → 试算成功/字段错误 → 连开两单 → 揽收→干线→异常挂起→恢复→退回终态并核对锁定 → 新增规则/启停并核对徽标与报价差值 → 服务端搜索与 `%` 转义 → 全程无外部请求、console 零报错）。末行 `pass=93 fail=0`。
- `style-shoot.mjs` + `style-diff.py`：双指标取证——互斥性（每对 ≥3 项 `getComputedStyle` 不同，实测 49–54 项）与同构性（行数/KPI 数/徽标数/轨迹数/标签页数/内联脚本与样式表数/外链数全等，且首 KPI、首徽标、首轨迹、首行文本逐字相同），并断言三主题 console 为空。dist 托管与单文件 preview 托管各跑一遍，结论相同。
- `derive-themes.py`：拼 `theme-*.css`（顺序 **令牌 → 结构层 → 气质补丁**），缺 token 或 `base.css` 里混入色值直接失败退出。
- `inline-preview.mjs` / `serve-static.mjs`：把 dist 压成单文件交付版；Vite 的 ESM 产物在 `file://` 下不执行，所以预览版内联 JS/CSS，并靠 `window.__API_BASE__ ||` 兜底（托管方注入值优先）。

`evidence/` 存本轮实测：两份 computedStyle 探针 JSON（dist / preview）、两份 style-diff 输出、一份 UI 回归日志、三主题整页截图。

## 三风格宣言（同一 DOM + 同一 JS，只换 CSS）

结构层 `web/src/styles/base.css` 454 处 `var(--token)` 引用、**零个**色值字面量；三套 token 文件各 98 个变量（含派生用的「气质补丁」段），`derive-themes.py` 断言三套全部覆盖后才产出 `theme-*.css`（1455 / 1461 / 1475 行，前端以 `?raw` 引入并在运行时注入 `<style>`，主题优先级 `?theme=` > `window.__THEME__` > `localStorage`）。

1. **老式票证打孔风 `ticket-stub`** —— 整页是一张夹在护照里的老登机牌：柴油纸底色、碳写复印的隔行深浅、左侧一列打孔、虚线撕口把「存根」与「正文」分开；数据一律打字机等宽，状态用章戳式斜置徽章盖上去。它主张：运单本来就是从复写纸里撕出来的那张。
2. **指南烫金卡风 `michelin-gilt`** —— 红色指南的封面被压进屏幕：深宝石绿卡底、四周烫金双线卡框、米金衬线大字距小字母排版，数字像鎏金钢印又高又细，分隔线永远是不到 1px 视重的金线。它主张：这条线路值多少钱，是一张可以被评级的卡。
3. **青瓷开片冰裂风 `crackle-glaze`** —— 整页是一块施了粉青釉的瓷板：釉面细密冰裂开片、边缘铁足厚边与柔和高光，宋体拉长行距安静排布，唯一的浓色是一线窑变赭，只用来标价格与异常。它主张：重量与时间都会被烧进釉里，不着急。

实测 72 项 `getComputedStyle`：`ticket-stub` vs `crackle-glaze` **54** 项互异、`ticket-stub` vs `michelin-gilt` **49** 项、`michelin-gilt` vs `crackle-glaze` **52** 项（差异落在字体族、前景/底色、渐变层数、边框宽度与样式、圆角、字距、`text-transform`、阴影、分隔线样式）；同时三主题 `rowCount=31`、`kpiCount=12`、`badgeCount=17`、`trackCount=2`、`tabCount=3`、`inlineScripts=0`、`inlineStyles=1`、`external=[]` 全等，首 KPI `¥1.55 万`、首徽标 `已揽收`、首轨迹与首行文本逐字相同。**换的只有 CSS，内容与结构一行没动，也没引任何外部资源。**

## 坑（本轮踩过）

- **CORS 用前缀匹配等于没匹配**：`strings.HasPrefix(host,"127.0.0.1")` 会让 `http://127.0.0.1.evil.example` 拿到 `Access-Control-Allow-Origin`——那是一个真实可达的域名。改成 `url.Parse` + 主机名精确比对（`localhost`/`127.0.0.1`/`::1`）+ `net.ParseIP(...).IsLoopback()`（顺带覆盖 127.0.0.0/8），并且绝不放行 `Origin: null`。Go 侧表驱动用例把 `http://localhost:5173.evil.example`、`//localhost:5173`、`http://evil.example/?o=http://localhost` 全列成必须拒绝。
- **`ORDER BY` 时间列在 SQLite 里是文本排序**：种子从 `time.Now()`（本机 +08:00）落库，而写路径用 `UTC()`，库里同时出现 `2026-09-26 07:47:48+08:00` 与 `2026-09-25 23:47:54+00:00` —— 同一瞬间，字符串却一个在另一个「后面」，`sort=booked&dir=desc` 的第一行于是永远是旧单。修法：**所有入库时间一律 `.UTC()`**（`Seed` 入口归一，调用方传什么都一样），并加断言 `booked_at NOT LIKE '%+00:00'` 计数为 0。这个坑只在带本地时区的机器上露头，Go 测试用固定 UTC 时刻反而测不到——是冒烟抓出来的。
- **清晨跑种子会写出「未来」**：今天那一档按「CST 8~18 点」随机分布，而现在才 CST 7 点。后果不止难看：新开的真单被未来历史单压在下面、异常/签收时间落在明天。两处补：`dayOffset==0` 时把 `booked_at` 压回 `[当日零点, now]`；轨迹链若越过 `now` 就**按比例压缩**（`fitTrackWindow`，保序、留 1 分钟最小间距、签收时间随最后一条轨迹走，因此必须在 `Create` 之前算轨迹）。注意 CST 日界那个「把时钟拨到 +8 再截断」的值只用来取 Y/M/D，拿它做时长减法会得出负数窗口——减法要用 `at(0,0,0)`。
- **详情里的 `events` 是 seq 倒序**（最新在前，Go 测试早就写死了这个约定），冒烟里却按直觉写了 `events.-1` —— 于是「异常备注」「打卡类型」全指向最旧那条建单轨迹，一次 6 连红。取值一律 `events.0`；不变量断言也跟着改成「seq 严格递减且唯一、时间不前进」。
- **`grep -c "access-control-allow-origin: http://[::1]:3000"` 恒为 0**：方括号被当字符类，本机 IPv6 放行用例永远「失败」。计数一律 `grep -F`。
- **请求体上限不能只靠字段校验**：`TestBodySizeLimit` 原来只断言「状态码 <400 才算挂」，而畸形 JSON 本来也回 400 —— 一个假绿了很久的用例。补 `maxBodyBytes(64<<10)`：声明了 `Content-Length` 直接 413 `body_too_large`，谎报长度的走 `MaxBytesReader` 落在 400 `invalid_request`；两条路径都断言响应里不出现 `request body too large` / `unexpected EOF` / `json:` / `gorm` / `SQLITE` 这些泄漏字样。
- **排序回显把内部列名发出去了**（`"sort":"w.total_cents"`）：等于替攻击者画库表。`ListQuery` 加 `SortKey`，只回显白名单键名，冒烟断言 `"sort":"w.` 不得命中。
- **bash 3.2.57（macOS 自带）撑不住三层 `$( )` 嵌套 + 内层引号**：`eq "…" "$(req GET "$(…)")"` 直接 `unexpected EOF while looking for matching '"'`，`bash -n` 还报不出来。所有嵌套调用先把响应/payload 落成变量再断言。
- **heredoc 里写字面 `\n` 当换行**：`lane = sys.argv[1]\nfk, fc, … = …` 进了 Python 就是语法错误，脚本 stdout 空、断言只报「期望 OK 实际空」。要换行就真换行。
- **UI 定位：整块 `hasText` 会被 `<option>` 文案污染**——找「固定额（分）」输入框时，`label.field` 里「计费方式」的下拉文本也含「固定额」，`first()` 选中了一个没有 `<input>` 的 label，`fill` 干等 30 秒。改成只按 `.field-label` 自身文案定位：`label.field:has(.field-label:has-text("固定额"))`。
- **UI 提交回执要认「新节点」**：`useAction` 与试算台都会在提交时把 message 置空（节点卸载后重建），所以「等 `data-kind` 变成 ok」会从上一单的「操作已完成」上读到假绿。做法：提交前给旧 `.form-msg` 打 `data-ui-stale`，只等 `p.form-msg[data-kind=ok]:not([data-ui-stale])`。
- **UI 读侧竞态**：点完「停用」立刻读徽标仍是「启用中」——列表刷新是一个新请求。凡看新值的断言都等**目标文案本身**（`span.badge:has-text("已停用")` 可见），并在跑完后把同一实例（脏库）再跑一遍：本轮第二遍同样 `93/0` 才算数。
- **表单默认值本身就是产品缺陷**：新增规则的 `heavy_piece` 门槛默认 5000 g，后端下限 10 000 g——照默认点「新增规则」必然 400。UI 套件把它抓了出来（先是被误记成「脚本没等回执」）。
- **写接口返回 `{waybill, message}` 信封**，开单返回的却是详情本身：冒烟里两条取值路径不同，忘了前缀就一路 `<nil>`。
- **`/api/waybills/`（空运单号）是 301**，Gin 把它归一化重定向到 `/api/waybills`，不是 404。断言要按「不进 handler、不 500」来写，而不是猜一个 404。
