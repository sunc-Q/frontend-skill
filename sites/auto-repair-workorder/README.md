# 铁砧汽修 · 工单与配件台（auto-repair-workorder）

Go/Gin + SQLite 后端、Vite + React + TS 前端的业务网站样例。一台社区汽修店的工位：开单、定项、领料、质检、结算、提车，全程挂着配件批次账。同一套页面渲染成三种互斥视觉风格。

## 场景与角色

铁砧汽修只有四个工位、一个配件货架。店长一天要盯的是「哪辆车在厂里待得太久」和「货架上那批刹车片还能不能按先入先出用掉」。

| 角色 | 关心的事 | 落在哪个模块 |
| --- | --- | --- |
| 服务顾问 | 开单（车牌/车型/客户/里程/故障描述 + 优先级）、按状态机把车往下推、作废并写明原因 | 开单表单 + 详情右栏状态推进 |
| 技师 | 给在制单加工时行（作业 + 等级 + 分钟）与领料行（编码 + 件数），FIFO 自动挑批次 | 详情右栏明细表单 + 批次侧栏「出库此件」 |
| 库管 | 到货入库建批次（成本、供应商、效期）、盯低库存与呆滞批次、看每条流水挂在谁的单上 | 到货入库表单 + 配件目录与批次表 |
| 店长 | 在厂车辆、超承诺、当日产值、工时/配件分成、毛利、库存金额、账实是否相符 | 流通指标（KPI + 趋势 + 类别结构）+ 页脚自检面板 |

业务口径（唯一算法在 `internal/domain/models.go`，前端与统计层都不另算一套）：

- **配件七类**：`engine` / `brake` / `filter` / `electrical` / `suspension` / `consumable` / `transmission`。只有 `consumable`（油液耗材）是 `Fragile`——入库必须能记有效期，建议周转 540 天；结构件无保质期。
- **工时费**：`LaborRates`（分/小时）初级 18000、中级 26000、大师 38000；`LaborAmount = roundHalfUp(分钟 × 费率 / 60)`。例：中级 90 分钟 = ¥390.00；初级 60 + 30 分钟 = ¥180 + ¥90 = ¥270.00（每行独立取整，不做整单一次性取整）。
- **承诺交车**：加急 6 小时、保客回厂 12 小时、普通 30 小时；`promised_at` 开单即定，`promise_overdue` 与「在厂时长」是接口派生字段。
- **八态机**（`woNext`，不在表内的目标一律 409）：
  `received → {diagnosed, cancelled}`；`diagnosed → {awaiting_parts, repairing, qc, cancelled}`；`awaiting_parts → {repairing, cancelled}`；`repairing → {qc, cancelled}`；`qc → {settled}`；`settled → {picked_up}`；`picked_up` / `cancelled` 为终态。
- **明细锁定**：`LinesEditable = {received, diagnosed, awaiting_parts, repairing}`。质检之后账目锁定（加行 409），因为 `qc → settled` 会把总额快照进工单，结算后再改行就让已开票金额对不上。
- **作废即退料**：`ReturnStock` 与 `LinesEditable` 同集合——出库的料在结算前没收过钱，作废时按**原批次原量**回库（写 `return` 流水并把 `qty_remaining` 加回去）；结算之后状态机本身不允许作废。
- **FIFO 纯函数**：`PlanIssue(lots, qty)` 按 `received_at`、再按 `lot_no` 排序依次扣批次，返回扣减计划 + 成本 + 缺口件数；缺口非零即整单事务回滚（`part_short`），绝不会出一半料。
- **账目恒等式**：`grand_total = labor_total + parts_total`，且等于明细行金额之和；配件行金额 == 数量 × 挂牌价；在库 == Σ批次剩余 == Σ流水增量。三条都在 `/api/stats` 里自检（`identity_issues` / `stock_issues` / `amount_invariant_ok` / `lot_overflow`），前端页脚原样显示「通过 / 未通过」。
- **隐私**：客户手机号只落库不外传，列表/详情给 `phone_masked`（`138****7764`），`CustomerPhone` 的 json tag 是 `-`。

## 数据模型

五张表。真实 DDL 由 GORM `AutoMigrate` 产出（另加 5 个手写复合索引与 1 个 CHECK 触发器）：

```sql
CREATE TABLE `parts` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`name` text,`brand` text,
  `category` text,`unit` text,`list_price_cents` integer,`reorder_point` integer,
  `shelf_location` text,`status` text,`created_at` datetime);
CREATE UNIQUE INDEX `idx_parts_code` ON `parts`(`code`);
CREATE INDEX `idx_parts_category` ON `parts`(`category`);
CREATE INDEX `idx_parts_status` ON `parts`(`status`);

CREATE TABLE `stock_lots` (`id` integer PRIMARY KEY AUTOINCREMENT,`part_code` text,`lot_no` text,
  `qty_received` integer,`qty_remaining` integer,`unit_cost_cents` integer,`supplier` text,
  `received_at` datetime,`expires_at` datetime);
CREATE UNIQUE INDEX `idx_stock_lots_lot_no` ON `stock_lots`(`lot_no`);
CREATE INDEX `idx_stock_lots_part_code` ON `stock_lots`(`part_code`);
CREATE INDEX `idx_stock_lots_received_at` ON `stock_lots`(`received_at`);

CREATE TABLE `work_orders` (`id` integer PRIMARY KEY AUTOINCREMENT,`wo_no` text,`plate_no` text,
  `model` text,`customer_name` text,`customer_phone` text,`mileage_km` integer,`symptom` text,
  `status` text,`priority` text,`technician` text,`opened_at` datetime,`promised_at` datetime,
  `settled_at` datetime,`closed_at` datetime,`cancel_reason` text,
  `labor_total_cents` integer,`parts_total_cents` integer,`grand_total_cents` integer,`updated_at` datetime);
CREATE UNIQUE INDEX `idx_work_orders_wo_no` ON `work_orders`(`wo_no`);
CREATE INDEX `idx_work_orders_plate_no` ON `work_orders`(`plate_no`);
CREATE INDEX `idx_work_orders_status` ON `work_orders`(`status`);
CREATE INDEX `idx_work_orders_priority` ON `work_orders`(`priority`);
CREATE INDEX `idx_work_orders_opened_at` ON `work_orders`(`opened_at`);

CREATE TABLE `work_order_lines` (`id` integer PRIMARY KEY AUTOINCREMENT,`work_order_id` integer,
  `kind` text,`operation` text,`grade` text,`duration_min` integer,`part_code` text,`qty` integer,
  `unit_cost_cents` integer,`cost_cents` integer,`unit_price_cents` integer,`amount_cents` integer,
  `note` text,`created_at` datetime);
CREATE INDEX `idx_work_order_lines_work_order_id` ON `work_order_lines`(`work_order_id`);
CREATE INDEX `idx_work_order_lines_kind` ON `work_order_lines`(`kind`);
CREATE INDEX `idx_work_order_lines_part_code` ON `work_order_lines`(`part_code`);

CREATE TABLE `stock_moves` (`id` integer PRIMARY KEY AUTOINCREMENT,`part_code` text,`lot_no` text,
  `kind` text,`qty_delta` integer,`unit_cost_cents` integer,`wo_no` text,`note` text,`occurred_at` datetime);
CREATE INDEX `idx_stock_moves_part_code` ON `stock_moves`(`part_code`);
CREATE INDEX `idx_stock_moves_lot_no` ON `stock_moves`(`lot_no`);
CREATE INDEX `idx_stock_moves_kind` ON `stock_moves`(`kind`);
CREATE INDEX `idx_stock_moves_wo_no` ON `stock_moves`(`wo_no`);
CREATE INDEX `idx_stock_moves_occurred_at` ON `stock_moves`(`occurred_at`);

-- 手写追加（repository 里 Exec）
CREATE INDEX idx_lots_part_recv  ON stock_lots (part_code, received_at);   -- FIFO 取批次的驱动索引
CREATE INDEX idx_moves_part_time ON stock_moves (part_code, occurred_at);
CREATE INDEX idx_moves_wo        ON stock_moves (wo_no);
CREATE INDEX idx_lines_order_kind ON work_order_lines (work_order_id, kind);
CREATE INDEX idx_orders_status_open ON work_orders (status, opened_at);
CREATE TRIGGER trg_lot_remaining_nonneg BEFORE UPDATE OF qty_remaining ON stock_lots
  FOR EACH ROW WHEN NEW.qty_remaining < 0 OR NEW.qty_remaining > NEW.qty_received
  BEGIN SELECT RAISE(ABORT, 'qty_remaining out of range'); END;
```

枚举：`work_orders.status` 八态见上；`priority ∈ {urgent, normal, warranty}`；`work_order_lines.kind ∈ {labor, part}`；`stock_moves.kind ∈ {receipt, issue, return, scrap}`；`parts.status ∈ {active, disabled}`。
`parts` 表**没有** `on_hand` 列——在库永远是批次的求和派生值，杜绝「库存字段和批次表各说各话」。

种子数据（全后端自洽，前端零硬编码）：31 种配件 / 73 个批次 / 124 张工单 / 461 条明细行 / 385 条流水；工单覆盖全部八态（含 3 张接车、2 张检测定项、2 张待料、3 张在修、2 张质检、2 张已结算、76 张已提车、34 张已作废带退料流水），近 14 日趋势里每天都有开单与结算。种子灌数走的是与线上写路径同一组 `domain` 函数。

## 接口清单

读接口无鉴权（车间大屏要看），4 个写接口全部挂在 `/api/admin` 下过 `AdminAuth(ADMIN_TOKEN)`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活探针，返回 UTC 时间 |
| GET | `/api/stats?days=3..30` | 31 个键：20 项标量口径（在厂/超承诺/当日开单与出库/产值与工时配件分成/毛利/库存金额/低库存…）+ `by_status`/`by_category`/`trend`/`top_parts` 四个结构 + 7 项自检（`stock_issues`/`stock_invariant_ok`/`amount_invariant_ok`/`lot_overflow`/`checked_orders`/`identity_issues`/`identity_violations`） |
| GET | `/api/work-orders` | 工单列表；筛选 `status`（含 `open`/`all`）、`priority`、`q`（车牌/客户/工单号/症状）；排序白名单 `opened,promised,updated,no,plate,status,priority,total,tech,id`；`page/page_size`，`page_size` 上限 100（默认 20） |
| GET | `/api/work-orders/:no` | 详情：`order`（含派生 `next_statuses`/`wait_minutes`/`promise_overdue`/在厂时长）+ `lines` + `moves` |
| GET | `/api/parts` | 配件目录（含 `on_hand`/`stock_value_cents`/`avg_cost_cents`/`lot_count`）；筛选 `category`、`stock`（`low`/`out`）、`q`；排序白名单 `code,name,category,price,onhand,value,lot,cost,id` |
| GET | `/api/parts/:code` | 单件档案：`part` + 在架批次（FIFO 序）+ 相关流水 |
| POST | `/api/admin/work-orders` | 开单 `{plate_no,model,customer_name,phone,mileage_km,symptom,priority,technician}` → 201，回 `wo_no` 与承诺时间 |
| POST | `/api/admin/work-orders/:no/transition` | 推进 `{to,reason}`；作废必须带 `reason` |
| POST | `/api/admin/work-orders/:no/lines` | 加行 `{kind,operation,grade,duration_min}` 或 `{kind:"part",part_code,qty,note}`；FIFO 扣批次并写流水，同事务 |
| POST | `/api/admin/receipts` | 到货入库 `{part_code,lot_no,qty,unit_cost_cents,supplier,expires_on}` → 建批次 + 写 `receipt` 流水 |

中间件：`gin.Recovery` + CORS（仅放行本地来源，方法 `GET, POST, OPTIONS`）+ 安全响应头 + `limitBody(64KiB)` + `requestTimeout(8s)`。`NoRoute` 对 `/api/*` 返回 JSON 404，其余走 `filepath.Clean` 规范化的 SPA 静态回退（`STATIC_DIR`，默认 `./web/dist`），目录穿越被 Clean 挡死。

鉴权三层（fail-closed）：服务端未配 `ADMIN_TOKEN` → 503 `server_misconfigured`（绝不因期望值为空而放行）；缺 `Authorization`、只有 `Bearer ` 前缀、方案不是 Bearer、裸令牌无前缀、空头 → 401 `unauthorized`；令牌不符（含正确前缀子串）→ 403 `forbidden`。`Bearer` 方案名按 RFC 7235 大小写不敏感，比对用 `subtle.ConstantTimeCompare`。

输入校验：所有写接口一律 `ShouldBindJSON`，字段错误按 `fields: {字段: 文案}` 回 400 供前端逐框回显；自由文本走 `domain.SafeText`（必填、限长，且拒绝引号/反引号/尖括号/分号/反斜杠/与号与控制字符——进了库就会在列表、检索、工单打印里变成注入或畸形展示，长度合规不代表内容安全）；车牌 ≤12、客户 ≤32、症状 ≤160、作废原因 ≤64、编码 ≤16、批次号 ≤20。对外错误只经 `domain.AppError{Code,Message,Err}` → `AbortWithError`，响应体只有 `{code, message}`，不回显 `err.Error()`、SQL、驱动名、goroutine 栈或源码路径。

## 重建与运行

```bash
# 依赖镜像（本机已验证）
go env -w GOPROXY=https://goproxy.cn,direct          # 或 export GOFLAGS=-mod=mod
cd web && npm i --registry=https://registry.npmmirror.com   # npx 在本机不可达，一律走 ./node_modules/.bin

# 样式派生（改了 tokens-*.css 或 base.css 之后必须重跑）
python3 scripts/derive-themes.py                     # → web/src/styles/theme-*.css

# 前端构建
cd web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build

# 后端：Go 1.x + gin + glebarez/sqlite（纯 Go，无 CGO）
cd ../backend && go build -o /tmp/arw-build/api ./cmd/api
ADMIN_TOKEN=<本地演示令牌> DB_PATH=/tmp/arw-run/api.db PORT=18401 GIN_MODE=release \
  STATIC_DIR=../web/dist /tmp/arw-build/api                 # 起主实例
env -u ADMIN_TOKEN DB_PATH=/tmp/arw-run/api2.db PORT=18402 \
  STATIC_DIR=../web/dist /tmp/arw-build/api                 # 起「未配令牌」实例（503 断言用）
```

配置全部走环境/命令行：`-db`（等价 `DB_PATH`，默认 `./data/app.db`）、`-addr`（等价 `PORT`，默认 `:8080`）、`ADMIN_TOKEN`、`STATIC_DIR`、`GIN_MODE=release`。DSN 固定拼 `_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)`，并 `SetMaxOpenConns(1)`（SQLite 单写者），`db`/`-wal`/`-shm` 三个文件一律压到 0600。

端口约定：`:18401` 带令牌主实例、`:18402` 不带令牌、`:18411` 取证用的 dist 静态托管、`:18412` 单文件 preview 的 http 托管（`file://` 的 `Origin: null` 会被 CORS 明确拒绝，拿不到接口）。

```bash
# 三种风格的单文件预览版（把 dist 的 JS/CSS 内联进去）
node scripts/inline-preview.mjs web http://127.0.0.1:18411/api   # → preview/{garage-plate,couture,tarot}.html
node scripts/serve-static.mjs preview 18412 http://127.0.0.1:18411/api
```

> 注意：仓库里现成的 `preview/*.html` 已把 API 基址烤成 `http://127.0.0.1:18411/api`。换端口就先按上面两条重新生成。

## 校验（全部要求末行为 0 失败）

```bash
cd backend && gofmt -l . && go vet ./... && go test -count=1 ./...
#   30 个 Test 函数：domain_test.go 11 / repo_test.go 12 / server_test.go 7；8 处 []struct 表、14 个 range 用例循环
ADMIN_TOKEN=<本地演示令牌> bash scripts/run-smoke.sh
#   自动起双实例 + 全新 /tmp 库 → scripts/api-smoke.sh：16 节、末行 pass=338 fail=0
node scripts/style-shoot.mjs 'http://127.0.0.1:18411/?theme={theme}' evidence/probe-dist.json /tmp/arw-shot
python3 scripts/style-diff.py evidence/probe-dist.json              # 末行「失败项：0」
BASE=http://127.0.0.1:18411 ADMIN_TOKEN=<令牌> node scripts/ui-check.mjs   # 真浏览器点全流程，末行 pass=153 fail=0
BASE=http://127.0.0.1:18412 PAGE='http://127.0.0.1:18412/{theme}.html' ADMIN_TOKEN=<令牌> \
  node scripts/ui-check.mjs                                        # 单文件预览版同样 153/0
```

脚本清单（留在 `scripts/` 里可独立复跑）：

- `api-smoke.sh`：真端口 + 真 curl。⓪ 样本一律从接口反查（`?status=settled` 之类服务端筛选，不在「第一页 100 条」里猜）；① 安全响应头与 `/api` JSON 404；② 统计口径、`days` 夹逼、恒等式；③/③b 排序白名单、分页、状态与优先级筛选、LIKE 通配符、注入与超长、脱敏形状；④/④b 详情账目自洽（总额 == 工时+配件 == Σ行金额、配件行 == 数量×挂牌价、工时行 == 分钟×费率）与批次流水对账；⑤ 库存口径与停用件；⑥ 鉴权矩阵 503/401/403；⑦~⑩b 四个写接口的校验顺序、承诺时长、工时口径、缺件回滚、锁定、批次唯一性、跃迁表、作废退料；⑪/⑪b 写后恒等式复验与错误面（SQL/驱动/栈字样一律 grep 不得命中）。必需样本缺失即 `exit 1`，绝不带病跑后半串。
- `run-smoke.sh`：写型冒烟不可在同一库重放，所以每轮起全新 `/tmp/arw-smoke` 库；「不带令牌的实例」必须 `env -u ADMIN_TOKEN` 显式摘掉环境变量，否则令牌顺着进程环境漏过去，503 断言会变成真的写库成功。
- `ui-check.mjs`：playwright-core + 系统 Chrome，三主题各跑 10 节真实交互（主题落地与 token 门控 → 缺字段逐框回显 → 开单 → 加工时行 → 检索配件点「出库此件」→ 状态推到终态并核对锁定/快照 → 第二张单出库后作废核对退料回库 → 到货入库自动生成批次号 → 页脚自检 → 三主题互异而结算金额一致）。末行 `pass=153 fail=0`（dist 与 preview 两种托管各一遍）。
- `style-shoot.mjs` + `style-diff.py`：双指标取证——互斥性（每对 ≥3 项计算样式不同）与同构性（行数/KPI 数/徽标数/批次行数/标签页数/内联脚本与样式表数/外链数必须全等），并断言三主题 console 为空。
- `derive-themes.py`：拼 `theme-*.css`（顺序 **令牌 → 结构层 → 气质补丁**），缺 token 或 `base.css` 里混入色值直接失败退出。

`evidence/` 存最近一次的实测：三份 computedStyle 探针 JSON（dist / preview / 两套 UI 回归）+ 三主题整页截图。

## 三风格宣言（同一 DOM + 同一 JS，只换 CSS）

结构层 `web/src/styles/base.css` 377 处 `var(--token)` 引用、**零个**十六进制或 `rgb()` 字面量；三套 token 文件各 84 个变量，`derive-themes.py` 断言三套全部覆盖后才产出 `theme-*.css`（前端以 `?raw` 引入，运行时按 `?theme=` > `window.__THEME__` > `localStorage` 选主题）。

1. **机车搪瓷牌照风 `garage-plate`** —— 整页是一块冲压搪瓷牌照：牌蓝底、白釉面板、反光黄压字，所有标签大写、宽字距，边界是粗白釉线加四角铆钉（`border` + 径向渐变铆点），KPI 卡带硬阴影 `0 6px 0` 像凸起的釉面。它主张：工位上的东西都要经得起戴手套看一眼。
2. **高定时装屋排版 `couture`** —— 象牙纸底、发丝线（`0.5px`）、大面积留白；极细高对比衬线标题 + 全大写宽字距脚注标签；**没有阴影、没有圆角**，只有线。它主张：一张裁缝量体单，工单是给客户量出来的。
3. **塔罗神谕卡牌风 `tarot`** —— 午夜紫底、金线双框、拱形圆角（`border-radius` 上大下小），斜体衬线牌名，页面上撒一层星点（多层径向渐变背景），行与行以金线分隔，KPI 卡 `rotate` 微倾像摊开的牌。它主张：修什么、换什么，都是牌面已经写好的谶语。

实测（70 项 `getComputedStyle`，dist 与单文件 preview 两种托管结论相同）：`garage-plate` vs `couture` **47** 项互异、`couture` vs `tarot` **44** 项、`garage-plate` vs `tarot` **49** 项（差异落在字体族、前景/底色、边框宽度与样式、圆角、阴影、字距、transform、渐变层数）；同时三主题 `rowCount=63`、`kpiCount=12`、`badgeCount=55`、`lotCount=3`、`tabCount=3`、`inlineScripts=0`、`inlineStyles=1`、`external=[]` 全等，首行文本与首个 KPI 值逐字相同，console 错误为 0。也就是说：**换的只有 CSS，页面内容与结构一行都没动，也没有引任何外部资源。**

## 坑（本轮踩过）

- **`[[ "$b" == *"\"$field\"" ]]` 少一个尾部的 `*`**：bash 的 `==` 是整串模式匹配，不是「包含」。24 行字段校验断言全部静默假通过/假失败，`bash -n` 还不报错。写「响应里含某键」必须两头都带 `*`。
- **嵌套引号的请求体不能内联进 `$( )`**：`chk "…" "409" "$(status_of "$(req POST … "{\"…\"}")")"` 会被吞掉引号，后端只收到畸形 JSON，等到的是 400「请求体无法解析」而不是 409。先把 payload 落成变量、响应落成变量，再断言。
- **别在「第一页 100 条」里挑样本**：种子有 124 张单，默认排序下 `settled`/`cancelled` 整页可能都不露脸，取到空 `wo_no` 后，后面拼出来的 URL 变成 `/api/work-orders/`，Gin 301 到 `/api/work-orders`，于是断言拿到的「响应体」是 `<a href="/api/work-orders">Moved Permanently</a>`，一串 10 个失败全指向同一个上游空值。改成服务端筛选 `?status=settled&page_size=5`，并在样本缺失时立刻 `exit 1`。
- **带 `?` 的 URL 在 zsh 里要加引号**：`curl -s http://…/api/stats?days=14` 会被当成 glob 直接 `no matches found`，`node -e` 同理。
- **`fill` 紧跟 `click` 会提交前一帧状态**：React 受控输入的 `onChange` 落 state 是异步的，同一 tick 内点提交，提交出去的是空值。表单动作前先 `settle()`（等一帧）再断言。
- **同一类竞态在「读」这一侧更隐蔽，而且是重复跑才暴露**：详情区写完要重新拉接口才刷新，读太快拿到的是上一帧——本轮连跑三遍才抓到两种假红：① 开单后 `factWait('工单号','WO-')` 用「含 WO-」当条件，而上一单的工单号本来就含 WO-，于是立刻返回旧值（期望 …0029、拿到 …0008）；② 出库后马上读流水表，拿到的是占位文案「库存流水 正在读取…」。修法统一：**等待条件必须用目标值本身**（`factWait('工单号', no)`），并给套件加一个 `poll(read, test)`，凡看新值的断言先轮询到位；`isDisabled()` 这类返回 Promise 的读数要 `async () => String(await …)`，写成 `String(…)` 会得到 `[object Promise]`，条件永远不成立、只留一次 15 秒超时。冒烟套件因此在同一库上连跑三次全绿（`pass=153 fail=0`）才算数。
- **前端真缺陷两处（是 UI 套件抓出来的，不是测试写错）**：
  1. 侧栏点批次预填 `prefillCode` 后，输入框显示的是 `draft.partCode === '' ? prefillCode : draft.partCode`，提交时却读 `draft.partCode`——「看得见编码、提交报编码非法」。改成显示与提交读同一个 `codeValue`。
  2. 自动批次号 `LOT-<编码>-<时间戳%100000>` 会顶破后端 20 位上限。改成 `LOT-` + 编码尾 10 位 + `-` + 4 位时间戳，最长 19 位。
- **`.shell` 是透明的**：三主题探针如果量 `.shell` 的背景色会得到三套全等的 `rgba(0,0,0,0)`，误判成「风格没生效」。量 `body` 与 `topbar` 才拿得住底色。
- **`derive-themes.py` 的拼接顺序有语义**：气质补丁必须排在结构层之后才能覆盖同名属性；写在前面会被 `base.css` 以同特异性后置覆盖，等于白写，而且不报错。
- **工具输出会把 `YYYY/MM/DD` 里的 `/` 渲染成 `-`**：本轮再次遇到，别据此改代码。要判定实际字节用 `python3 -c "import binascii;print(binascii.hexlify(s.encode()))"`（这个 python3 没有 `str.hex()`）。
- **写型冒烟不可重放**：领了料不还、状态推到底，同一库第二轮的库存与状态断言必然变误报——永远用 `run-smoke.sh`。
