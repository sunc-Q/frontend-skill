# SaaS 订阅经营台（saas-subscription-admin）

> 业务网站实验室 · 第 1 轮产物。Go/Gin + SQLite 后端，React/Vite 前端，**同一套 DOM 与 JS、三套 CSS** 的三种视觉风格。
> 本目录既是可运行代码，也是复现文档；`preview/*.html` 是零外链的单文件成品页。

## 1. 场景与角色

一家 B2B SaaS 公司的**订阅经营后台**：增长/续费负责人打开它，回答三个问题——
这个月 MRR 多少、钱从哪个套餐来、哪些订阅快要到期或已经掉款。

| 角色 | 能做什么 | 鉴权 |
| --- | --- | --- |
| 经营分析（只读） | 看 KPI、列表筛选/排序/搜索、看订阅明细与回款流水 | 无（只读接口不发令牌） |
| 订阅运营（写） | 新建套餐、给某个订阅记一笔续费并推进到期日 | `Authorization: Bearer $ADMIN_TOKEN` |

页面只有一张：`订阅经营台`。顶部 10 张 KPI 卡 + 月度趋势，中部订阅台账表（状态/套餐/搜索/排序/分页），
右侧套餐构成，底部明细抽屉（该订阅的回款流水）与两个管理表单（记续费、建套餐）。

## 2. 目录结构

```
backend/cmd/api/main.go               入口：flag/env、灌种子、优雅退出
backend/internal/domain/    models.go errors.go query.go domain_test.go   模型、AppError、不可信 query 收敛
backend/internal/repository/db.go repo.go metrics.go seed.go repo_test.go GORM 访问、聚合口径、确定性种子
backend/internal/service/   service.go        业务校验与冲突映射
backend/internal/handler/   handlers.go errors.go auth.go                 绑定/响应、Bearer 校验
backend/internal/server/    server.go server_test.go                      路由、安全头、CORS、静态托管、超时
web/src/            App.tsx api.ts themes.tsx useAsync.ts types.ts format.ts main.tsx
web/src/styles/     theme-swiss.css theme-win95.css theme-cyber.css  ← 三风格唯一差异
web/dist/           vite build 产物（已随交付保留）
preview/            swiss.html win95.html cyber.html ← 零外链单文件成品
scripts/            inline-preview.mjs serve-static.mjs style-probe.js
README.md
```

## 3. 数据模型

四张表，金额一律**整数分**，时间 UTC。GORM `AutoMigrate` 生成的真实 DDL（`sqlite3 .schema`）：

```sql
CREATE TABLE `plans` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`name` text,
  `price_monthly` integer,`price_yearly` integer,`seat_quota` integer,`active` numeric,`created_at` datetime);
CREATE UNIQUE INDEX `idx_plans_code` ON `plans`(`code`);
CREATE INDEX `idx_plans_active` ON `plans`(`active`);

CREATE TABLE `subscribers` (`id` integer PRIMARY KEY AUTOINCREMENT,`email` text,`company` text,
  `plan_id` integer,`source` text,`joined_at` datetime);
CREATE UNIQUE INDEX `idx_subscribers_email` ON `subscribers`(`email`);
CREATE INDEX `idx_subscribers_plan_id` ON `subscribers`(`plan_id`);

CREATE TABLE `subscriptions` (`id` integer PRIMARY KEY AUTOINCREMENT,`subscriber_id` integer,`plan_id` integer,
  `period` text,`status` text,`seats` integer,`mrr` integer,`start_at` datetime,`renew_at` datetime,
  `canceled_at` datetime,`last_payment_at` datetime);
-- 索引：subscriber_id / plan_id / status / period / renew_at

CREATE TABLE `payments` (`id` integer PRIMARY KEY AUTOINCREMENT,`subscription_id` integer,
  `amount` integer,`period` text,`paid_at` datetime);
CREATE INDEX `idx_payments_subscription_id` ON `payments`(`subscription_id`);
```

关系：`subscribers 1—1 subscriptions N—1 plans`，`subscriptions 1—N payments`。
种子数据确定性（固定随机源）：5 套餐 / 126 订阅 / 126 客户 / 9 个月账单流水，`-seed` 幂等（库非空即跳过）。

口径（`backend/internal/repository/metrics.go`，全部在服务端算完，前端不做二次计算）：

- `charging = status IN ('active','past_due')`；**MRR = Σ charging.mrr**，因此「按套餐 MRR 之和 == 总 MRR」恒成立（有测试守住）。
- `ARR = MRR × 12`；`ARPU = MRR / charging 订阅数`（分，四舍五入到分）。
- `churn_rate_pct = canceled / (active+past_due+canceled)`；`trial_conversion_pct = (总数-trialing) / 总数`。
- 月度趋势按 `payments.paid_at` 分桶，只回看 3–18 个月（越界自动收敛）。

## 4. 接口清单

| Method | Path | 鉴权 | 入参 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 无 | — | `{status,time}` |
| GET | `/api/plans` | 无 | — | `{items:[Plan],total}` |
| GET | `/api/metrics` | 无 | `months`（3–18，越界收敛） | `{total_subscribers,active_subs,trialing_subs,past_due_subs,canceled_subs,mrr,arr,arpu,churn_rate_pct,trial_conversion_pct,by_plan[],monthly[],generated_at}` |
| GET | `/api/subscriptions` | 无 | `page,pageSize(≤100),status,plan,q(≤64字),sort(mrr\|renew_at\|created\|seats\|company\|status\|id),dir(asc\|desc)` | `{items:[SubscriptionRow],total,page,page_size}` |
| GET | `/api/subscriptions/:id` | 无 | 路径 ID（非法→404 `invalid_id`） | `{subscription,payments[]}`（流水按 `paid_at` 倒序） |
| POST | `/api/admin/plans` | Bearer | `{code,name,price_monthly,price_yearly,seat_quota,active?}` | 201 `{message,plan}`；400 带 `fields`；409 `conflict` |
| POST | `/api/admin/subscriptions/:id/renew` | Bearer | `{amount(分),period(monthly\|yearly),next_renew:"YYYY-MM-DD"}` | 200 `{message,subscription}`；404；409 `invalid_state`（试用中） |

错误体统一：`{code,message,fields?}`。**内部错误只回 `{"code":"internal"}` 级别的泛化消息，绝不回显 `err.Error()`**
（`backend/internal/handler/errors.go`，有测试断言响应体不含内部字符串）。

安全基线：`ADMIN_TOKEN` 未配置 → 写接口一律 503（fail-closed，避免空令牌放行）；
Bearer 大小写不敏感、缺方案头/空令牌 → 401，令牌不符 → 403；常量时间比较；
排序字段白名单映射、`LIKE` 转义 `%_\`、`pageSize` 上限 100、搜索串按 rune 截断；
静态托管带 `filepath.Clean` 目录穿越防护；安全响应头 + `X-Frame-Options`/`Referrer-Policy` 等；CORS 只放行 `http://localhost:*` / `http://127.0.0.1:*`，**显式拒绝 `Origin: null`**。

## 5. 从零复现

```bash
cd sites/saas-subscription-admin

# 1) 后端（Go 1.23+；本机走 goproxy.cn，纯 Go 的 glebarez/sqlite，无需 CGO）
cd backend
export GOPROXY=https://goproxy.cn,direct
go build ./... && go vet ./... && go test ./...

# 2) 起服务：ADMIN_TOKEN 自己在本机 shell 里 export（不要写进文件/提交）
export ADMIN_TOKEN="$(openssl rand -hex 16)"     # 仅示例；换成你自己的值
DB_PATH=./data/app.db PORT=8080 GIN_MODE=release go run ./cmd/api -seed
# 等价：go run ./cmd/api -seed -db ./data/app.db -addr :8080
# 同源托管前端：STATIC_DIR=../web/dist go run ./cmd/api（这样连 file:// 的 CORS 限制都不涉及）

# 3) 前端（npm 必须走镜像；不要用 npx，直接调 node_modules/.bin）
cd ../web
npm install --registry=https://registry.npmmirror.com
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build                    # -> web/dist（单入口 app.js，cssCodeSplit:false）
node ../scripts/inline-preview.mjs "$PWD" http://127.0.0.1:8080/api   # -> ../preview/{swiss,win95,cyber}.html

# 4) 看成品：三种风格 = 三个单文件
node ../scripts/serve-static.mjs ../preview 8093 http://127.0.0.1:8080/api
open http://127.0.0.1:8093/swiss.html   # 或 win95.html / cyber.html

# 开发模式（Vite 代理 /api -> 127.0.0.1:8080）
./node_modules/.bin/vite --port 5173
```

环境变量：`DB_PATH`（默认 `./data/app.db`）、`PORT`（默认 8080）、`ADMIN_TOKEN`（写接口令牌，未设=写接口 503）、
`STATIC_DIR`（设为 `web/dist` 则同源托管前端）、`GIN_MODE`。数据库文件权限 0600，DSN 带
`_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)`，且 `SetMaxOpenConns(1)` 串行化写入。

## 6. 三种风格（同 DOM / 同 JS，只换 CSS）

主题通过 `?raw` 把三份 CSS 打进 JS，运行时按 `<html data-theme>` 注入一个 `<style data-theme-css>`；
**切换风格不重新加载、不改组件代码**。优先级：URL `?theme=` > `window.__THEME__`（宿主注入，preview 文件里已烘焙） > `localStorage`。

| 风格 | 主张 | 关键做法 |
| --- | --- | --- |
| `swiss` 瑞士网格 | 栅格即秩序：信息密度优先，黑白加一抹信号红 | Helvetica 栈、3px 粗边框、0 圆角、10px 大写字距标签、深色表头反白 |
| `win95` 复古 Win95 | 软件曾经是灰色的、有厚度的 | Tahoma/系统灰 `#c0c0c0`、2px 立体边、白面板 + 藏青数值、`Courier New` 数字、几乎为零的留白 |
| `cyber` 暗色霓虹 | 深夜值班室的驾驶舱 | `#07090f` 底、14px 大圆角 + 1px 冷青描边 + 双层外发光、40px 细字重数值、霓虹青 `#22e3c4` 信号色 |

实测 `getComputedStyle`（对交付目录 `preview/*.html`，浏览器真值，非 CSS 源码推测）：

| 探针 | swiss | win95 | cyber |
| --- | --- | --- | --- |
| `.shell` 底色 | `rgb(242,241,236)` | `rgb(192,192,192)` | `rgb(7,9,15)` |
| `.kpi` 底色 | `rgb(255,255,255)` | `rgb(255,255,255)` | `rgb(14,19,34)` |
| `.kpi` 圆角 | `0px` | `0px` | `14px` |
| `.kpi` 上边框 | `3px` | `2px` | `1px` |
| `.kpi` 内边距 | `16px` | `4px` | `22px` |
| `.kpi` 字体栈 | Helvetica Neue | Tahoma / MS Sans Serif | Avenir Next / Segoe UI |
| `.kpi-value` | 34px / 700 / `rgb(18,18,18)` / Helvetica | 22px / 700 / `rgb(0,0,128)` / Courier New | 40px / 400 / `rgb(34,227,196)` / Avenir |
| `.kpi-label` | 10px / uppercase / 字距 1.6px | 11px / none / 1.76px | 11px / uppercase / 1.76px |
| `table th` 底色 | `rgb(18,18,18)` | `rgb(192,192,192)` | `rgb(17,26,46)` |
| 渲染结果 | 10 卡 / 23 行 / **外链 0** | 10 卡 / 23 行 / 外链 0 | 10 卡 / 23 行 / 外链 0 |

字体、底色、间距、圆角、边框、字重、字距 7 类均至少两项互异，满足「≥3 项确实不同」。
`scripts/style-probe.js` 是探针源码，粘进浏览器控制台即可复测。

## 7. 校验记录（本轮实测）

- `go build/vet ./...` 干净；`go test ./...` 三个包全绿：
  `domain`（3 套表驱动：字段校验、query 收敛含注入与超长、状态枚举）、
  `repository`（种子自洽：126 订阅、无孤儿流水、`mrr == price×seats`、幂等、`LIKE` 转义、`pageSize` 上限、事务回滚）、
  `server`（鉴权矩阵 503/401/401/401/403/201、错误不外泄、只读接口形状、安全头、目录穿越与 SPA 兜底）。
- 实机 curl（后端 8090，本轮临时端口）：只读 6 个接口 200；不存在 ID 404；未匹配 `/api/nope` 走 JSON 404；
  写接口 无令牌 401 / 错令牌 403 / 非法体 400 带 `fields` / 合法 201；
  试用中订阅记续费 409 `invalid_state`；`next_renew` 传 `10/25/2026` → 400 精确指出该字段；
  合法续费 200 后 `renew_at` 推进到 `2026-10-25`，`payments` 由 6 笔增至 7 笔且新笔在倒序首位。
- 前端：`tsc --noEmit` 严格模式零错误，`vite build` 单入口 284KB（gzip 82KB），三份 preview 各 284,679 字节、互差仅 4 行、`data-theme` 唯一。
- UI 写路径：页面内建套餐——故意填错 → 两个字段级错误且不落库；填对 → 列表出现新套餐。

## 8. 坑与结论（下一轮别再踩）

1. **Vite 的 ESM 产物在 `file://` 下不执行**，所以交付必须是内联后的单文件。
2. **内联脚本不能用正则碰 JS 产物**：bundle 里合法含有 `<\/script>`，用 `replace(/<script>.*<\/script>/)` 会截断
   （本轮就是这么坏过一次：282KB 的包只写进去 169KB，页面 `#root` 空白）。
   正确做法：**按精确下标定位入口标签再切片拼接**，写盘后断言 `out.includes(js)` 且只出现一次；
   另外 `String.replace` 的替换串里 `$'` 会自我复制文档，必须用 replacer 函数（或干脆不用 replace）。
3. `Origin: null`（双击打开本地 HTML）被 CORS 拒，所以 **preview 页要数据必须经 `serve-static.mjs` 起 localhost 服务**，
   或者后端带 `STATIC_DIR=../web/dist` 同源托管；双击只能看到静态骨架。这是有意的安全取舍，不是 bug。
4. `STATIC_DIR` 未配置时 Gin 的默认 404 是纯文本，前端会当 JSON 解析炸掉 → 显式 `r.NoRoute(json404)`。
5. 种子必须先建订阅再写流水，否则 `subscription_id` 是假的（外键开着，靠自增计数器推算会漂移）。
6. 默认 `Sort` 要写**映射后的 SQL 列名**，写 map key 会让列表默认排序和 `ORDER BY` 对不上。
7. 本机网络：GitHub/jsDelivr HTTPS 被 TLS 重置，`npm` 必须 `--registry=https://registry.npmmirror.com`，Go 走 `goproxy.cn`；不要用 `npx`。
8. IDE 浏览器面板不可用（无截图），样式核对靠 `getComputedStyle` 探针；`evaluate_script` 偶发 15s 超时，**拆成短表达式**逐个取值比一次返回大对象稳。
