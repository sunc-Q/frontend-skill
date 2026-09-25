# 驻场 SLA 值班台 · Field Support / Business-Minute Ledger

场景 slug：`support-ticket-sla-desk`　技术基线：Go + Gin + SQLite（glebarez 纯 Go 驱动）+ Vite + React + TS strict
一套页面 / 三种前端风格：`ledger`（冷灰账簿）、`picture`（儿童绘本）、`corporate`（深色企业台）

---

## 1. 场景与角色

一家给企业客户做**驻场 IT 运维**的服务商。合同里写着「 platinum 级 P1 故障 8 小时内响应、2 个工作日内解决，
超时按小时赔钱」。值班主管每天早上打开的就是这个台子。

它和「普通工单系统」的差别，也是这个场景值得做的地方：**这里的时钟不是挂钟**。

- 客户周六下午提的单，SLA 不从周六下午开始烧——周末、法定假日、下班时段一律不计时；
- 但「等客户回传日志」「等原厂发货」这段时间要**停表**，一旦恢复就接着烧，且必须能倒查是谁在哪一刻按下的停表；
- 调休上班的周日（2026-09-27、2026-10-10）算工作日，尽管它是周日。

所以本项目的核心承诺是一句可审计的话：**任何一个数字都能被拆成一条自洽的加法算式**。
详情页显示的分解式、时间线复算出的停表累计、列表页的剩余时长，全部出自后端同一个计算函数
（`domain.ComputeClock` / `LedgerFor`），不存在「前端再算一遍」的第二个真相。

角色：

| 角色 | 关心什么 | 对应界面 |
| --- | --- | --- |
| 值班主管 | 哪些单快超时了、谁手上压了多少、要不要派单 | 时效队列 + 页签 + 工程师负载 |
| 一线工程师 | 我这单还剩多少**工作分钟**、该不该停表 | 详情 + 推进/停表/恢复 |
| 客户成功 / 商务 | 达标率、赔付风险、合同策略是否被改 | KPI + 合同矩阵 + 时效审计 |
| 审计 | 每一次状态跃迁、每一次停表恢复的原始记录 | 时间线 + 分解式 + 恒等式 |

工作日历（Asia/Shanghai，UTC+8，无夏令时）：工作日窗口 `09:00–12:00` + `13:00–18:00` = **480 工作分钟/日**；
假日 `2026-09-25`、`2026-10-01..03`；调休上班 `2026-09-27`（周日）、`2026-10-10`（周六）。

---

## 2. 数据模型

5 张表，GORM `AutoMigrate` 建表。字段上的 `json:"-"`、`uniqueIndex` 都写在注释里，别改。

```sql
-- customers：客户与合同等级；明文手机号绝不出接口
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,            -- C0001
  name TEXT, tier TEXT,        -- platinum/gold/silver/bronze（索引）
  industry TEXT, contact_name TEXT,
  contact_phone TEXT,          -- struct tag: json:"-"，任何接口都不带它；工单行只出 masked_phone
  seats INTEGER, active INTEGER,-- 索引
  joined_at DATETIME
);

-- agents：工程师；capacity_bd_minutes = 每周可投入的工作分钟
CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE, name TEXT, team TEXT, title TEXT, skills TEXT,
  active INTEGER,              -- 离职置 0，不删行（历史工单要能追溯到人）
  capacity_bd_minutes INTEGER, joined_at DATETIME
);

-- sla_policies：合同等级 × 严重度 → 目标时长（工作分钟）
CREATE TABLE sla_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT, severity TEXT,    -- UNIQUE(tier, severity) 复合索引 idx_tier_sev
  response_min INTEGER, resolve_min INTEGER,
  description TEXT, updated_by TEXT, updated_at DATETIME
);

-- tickets：工单 + SLA 快照 + 时间账
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,            -- TK-20260916-0005
  title TEXT, description TEXT,
  customer_id INTEGER,         -- 索引
  agent_id INTEGER,            -- 索引，可空（未派单）
  team TEXT, category TEXT, channel TEXT,
  severity TEXT, priority TEXT, status TEXT,  -- 各自索引
  created_at DATETIME,         -- 索引
  first_response_at DATETIME, resolved_at DATETIME,
  closed_at DATETIME, canceled_at DATETIME,
  -- 时效快照：改策略不回溯在办单，所以目标值与到期点都落库
  response_target_bd INTEGER, resolve_target_bd INTEGER,
  resp_due_at DATETIME, resolve_due_at DATETIME,  -- resolve_due_at 索引
  reassign_count INTEGER, reopen_count INTEGER,
  -- 时间账：停表只存「已结账」的累计 + 一个进行中起点，不存区间表
  paused_since DATETIME,       -- 索引；非空即处于停表态
  pause_reason TEXT, paused_bd_minutes INTEGER,
  response_bd_minutes INTEGER, resolve_bd_minutes INTEGER,
  met_response INTEGER, met_resolve INTEGER,     -- 可空 bool：没解决就还没有结论
  updated_at DATETIME
);
```

-- ticket_events：状态机跃迁的原始账，时间线与停表复算的唯一来源
CREATE TABLE ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER,           -- 索引
  kind TEXT,                   -- created/assigned/status/paused/resumed/note/escalated（索引）
  from_status TEXT, to_status TEXT,
  actor TEXT, actor_role TEXT, note TEXT,
  at DATETIME                  -- 索引
);
```

连接与并发（`internal/repository/db.go`）：

```go
// 纯 Go 驱动，无需 CGO；DSN 四个 pragma 缺一不可（WAL / busy_timeout / 外键 / 写事务立即取锁）
dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)"
db.DB().SetMaxOpenConns(1)   // 单写者：事务闭包内必须用 tx，不能用 db，否则自锁
```

库文件（含 WAL/SHM）在首次写入后统一 `os.Chmod` 压到 0600——库里存了客户联系人手机号。
同名在办单去重靠一条**部分唯一索引**（GORM tag 表达不了 WHERE）：

```sql
CREATE UNIQUE INDEX idx_tickets_title_dedupe ON tickets (customer_id, title)
  WHERE status IN ('new','assigned','in_progress','pending_customer');
```

### 状态机

7 个状态：`new`（待受理）→ `assigned`（已派单）→ `in_progress`（处理中）→ `pending_customer`（等客户，**唯一停表态**）
→ `resolved`（已解决）→ `closed`（已关单）；`canceled`（已取消）可从多数状态进入。

- 只有 `pending_customer` 停表；`assigned/in_progress` 都算「已首响」。
- `resolved → in_progress` 记一次 reopen，上限 `MaxReopen = 2`，超过返回 409。
- 每次跃迁写一条 `ticket_events`；离开停表态写 `resumed`（**不另写 status 事件**，否则一次动作两条记录）。

### 四条对外恒等式

详情页把它们逐条算给审计看（`clock_identity_ok`）：

1. `挂钟分钟 = 非工作分钟 + 工作分钟`
2. `工作分钟 = 停表分钟 + 计时中分钟`
3. `bd(created → due) = 目标工作分钟 + 停表工作分钟`
4. `时间线复算的停表累计 = 落库的 paused_bd_minutes`

---

## 3. 接口清单

读（8 个，全部免鉴权，全部有上限）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 现场时间 / 今天是否上班 / 下一工作窗口 / `minutes_per_day` |
| GET | `/api/meta` | **前端所有字典与阈值的唯一来源**：7 状态（含中文 label）、4 tier、4 priority、停表原因、技能组、排序项、页签项、策略上下界、`minutes_per_day`、`field_utc_offset_min` |
| GET | `/api/stats` | 8 个 KPI、14 天趋势、工程师负载、合同矩阵、时效审计 4 项、工作日历快照 |
| GET | `/api/tickets` | 列表：关键词 / 状态 / 级别 / 严重度 / 技能组 / 页签 / 排序 / 分页，`page_size` 上限 100 |
| GET | `/api/tickets/:code` | 详情 + 分解式 + 恒等式 + 完整 ledger + 时间线 |
| GET | `/api/agents` | 工程师（含负载） |
| GET | `/api/customers` | 客户：**完全不带电话字段**；脱敏后的 `masked_phone` 只出现在工单行上 |
| GET | `/api/sla/policies` | 策略矩阵 |

写（6 个，**全部要 `Authorization: Bearer $ADMIN_TOKEN`**）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/tickets` | 建单：校验客户/严重度/类别，快照当时的策略目标值，算出到期点 |
| PATCH | `/api/tickets/:code/status` | 推进状态（含 reopen 计数、resolved 时结算 `resolve_bd`） |
| POST | `/api/tickets/:code/pause` | 停表，`reason` 必填，否则 400 |
| POST | `/api/tickets/:code/resume` | 恢复计时，结账 `paused_bd_minutes` |
| POST | `/api/tickets/:code/assign` | 派单（写 `assigned` 事件，from=跃迁前状态） |
| POST | `/api/sla/policies` | upsert 策略；**不回溯在办工单** |

鉴权三层（`internal/handler/auth.go`）：服务端 `ADMIN_TOKEN` 未设置 → **503**（绝不因「期望值为空」而放行）；
`Authorization` 缺失或非 `Bearer <token>` 形式 → **401**；令牌不匹配 → **403**。
比对用 `subtle.ConstantTimeCompare`，不引入 JWT。
错误一律走 `domain.AppError{Code, Message, Err}`，**对外只回 `code` + 中文 `message`，绝不回显 `err.Error()`**。

---

## 4. 从零跑起来

```bash
export LAB="/Users/apple/Documents/workProject/试验/业务网站实验室/sites/support-ticket-sla-desk"
```

### 4.1 后端

```bash
cd "$LAB/backend"
export GOPROXY=https://goproxy.cn,direct
export ADMIN_TOKEN='换成你自己的随机串'      # 不设则写接口 503，只读演示也能跑
export PORT=8091
go build -o /tmp/sla-desk-api ./cmd/api
/tmp/sla-desk-api -addr :8091 -db /tmp/sla-desk.db     # -seed=true 是默认，空库自动灌示例数据
```

冒烟：

```bash
curl -s localhost:8091/api/health | head -c 200; echo
curl -s 'localhost:8091/api/tickets?page_size=2' | head -c 300; echo
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8091/api/tickets \
     -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}'
# 期望 400（缺字段）；不带令牌 → 401
```

示例数据规模：38 家客户 / 12 名工程师 / 12 条策略（4 tier × 3 严重度）/ 252 张历史单 + 96 张在办单。

### 4.2 前端

```bash
cd "$LAB/web"
npm install --registry=https://registry.npmmirror.com   # 必须带 registry，直连 npmjs 会被 TLS 重置
./node_modules/.bin/tsc --noEmit                        # 不要用 npx
./node_modules/.bin/vite build                          # → dist/
cd "$LAB" && node scripts/inline-preview.mjs web http://127.0.0.1:8091/api
# → preview/{ledger,picture,corporate}.html 三个单文件页，JS/CSS 全内联，零外链
```

开发模式：`./node_modules/.bin/vite --port 5173`。
注意 `vite.config.ts` 里的 `/api` 代理默认指向 `http://127.0.0.1:8080`，
用开发服务器联调时后端要起在 8080（`-addr :8080`），或者把那行改成 8091。

### 4.3 验证（本目录 `scripts/`）

```bash
cd "$LAB"
# ① 后端：编译 + 静态检查 + 测试（domain / repository / server 三层，含注入与超长输入、401/403、字段校验的表驱动用例）
(cd backend && go build ./... && go vet ./... && go test ./...)

# ② 逐接口冒烟：真端口 + 真 curl，覆盖读接口/隐私/鉴权三层(401·403·503)/状态机/快照不回溯/恒等式
#    需要两个实例：一个带令牌，一个不带（验 503 分支）
ADMIN_TOKEN="$TOKEN" BASE=http://127.0.0.1:8091 NO_TOKEN_BASE=http://127.0.0.1:8093 \
  bash scripts/api-smoke.sh

# ③ 三风格计算样式取证：真无头 Chrome（系统 Chrome + playwright-core）逐主题采 getComputedStyle
node scripts/serve-static.mjs preview 18262 http://127.0.0.1:8091/api &
node scripts/style-shoot.mjs 'http://127.0.0.1:18262/{theme}.html' /tmp/probe.json /tmp/shot-
python3 scripts/style-diff.py /tmp/probe.json   # 互斥性 ≥3 项/对 + 同构性 12 字段全等 + 零外链

# ④ 真浏览器交互回归（会写库，只对着本地实例跑；令牌走环境变量，不进命令行历史）
UI_TOKEN="$ADMIN_TOKEN" node scripts/ui-check.mjs http://127.0.0.1:18262/ledger.html
kill %1

# ⑤ 样式令牌完整性：base.css 需要的 token 三套 tokens-*.css 必须都给全，且 base.css 零裸色值
python3 scripts/derive-themes.py
```

本轮结果：`go build/vet/test` 全绿；`tsc --noEmit` 0 错误；`api-smoke.sh` **112 项断言 0 失败**；
`ui-check.mjs` **21 项全过**；`style-diff` 失败项 0
（互斥性 50 / 57 / 57 项，同构性 12 字段三主题全等，外链 0，console 错误 0）；`derive-themes.py` 63 个 token 全覆盖。
原始取证数据留在 `evidence/style-probe.json`。

---

## 5. 三种风格的主张

**同一份 DOM、同一份 JS，只换一个 CSS。** 这不是口号而是可校验的约束：
`web/src/styles/base.css`（约 1250 行结构层，只用 `var(--token)`，**零裸色值**）
+ `tokens-<id>.css`（设计令牌 + 少量气质补丁），由 `scripts/derive-themes.py` 拼成 `theme-<id>.css`；
缺 token 或 base.css 里出现裸色值 → 脚本直接失败。组件里没有任何 `theme ===` 分支。

| 维度 | `ledger` 冷灰账簿 | `picture` 儿童绘本 | `corporate` 深色企业台 |
| --- | --- | --- | --- |
| 主张 | 像一张审计工作底稿：克制、密集、可核对 | 把「超时」讲得让值班新人也不害怕：圆、软、暖 | 像驻场 NOC 大屏：夜里开着不刺眼 |
| 底色 | 冷灰 `#eef0f3` 系 | 米黄纸 `#fdf6e3` 系 | 近黑蓝 `#0b1220` 系 |
| 字体 | 等宽为主，数字对齐 | 圆体标题 + 手写感 | 等宽，字距收紧 |
| 圆角 / 边框 | 直角、1px 实线、左侧色条 | 大圆角、虚线、贴纸式阴影 | 小圆角、发光描边 |
| 密度 | 高（表格行紧凑） | 中（留白多、字号大） | 高（暗底上靠亮度分层） |
| 危险色 | 深红细线 | 珊瑚红粗边 | 霓虹红 + 发光 |

取证双指标（`style-diff.py` 同时断言，缺一不可）：

- **互斥性**：每对主题 ≥3 项计算样式不同 —— 实测 50（corporate/ledger）、57（corporate/picture）、57（ledger/picture）；
- **同构性**：`kpiCount=8 / rowCount=12 / tabCount=6 / calCount=16 / loadCount=12 / matrixCount=4 / identCount=8 / dailyCount=14 / clockCount=6 / inlineStyles=1 / inlineScripts=3 / external=[]` 三主题全等。

---

## 6. 踩过的坑（复现时请照抄，别重新踩）

1. **`glebarez/sqlite` + `SetMaxOpenConns(1)`**：事务闭包里必须用 `tx`，写成 `r.db.xxx` 会去抢第二条连接然后自锁死。
2. **两套时间口径**：GORM 把 DATETIME 统一按 UTC 存取，所以**工单行的时间是 `…Z`**；
   而账本、时间线、`due_at`、`/api/health`、`/api/meta` 是后端自己 `.In(FieldTZ)` 格式化过的 **`+08:00` 串**。
   展示层必须把前者换算成后者，且换算要**与看报表那台机器的时区无关**：
   `format.ts` 用 `Date.parse` + `toISOString`（两者都只认 UTC）加 `/api/meta` 下发的 `field_utc_offset_min`，
   绝不用 `toLocaleString()`。曾经前端只做字符串截取，结果列表显示 08-01 21:49、详情显示 08-02 05:49，
   同一张单差 8 小时——`ui-check.mjs` 里那条「列表与详情的建单时刻一致」就是钉这个的。
3. **`String.replace` 的替换串里 `$'`、`$\``、`$&` 是特殊记号**，内联脚本时会把尾部内容自我复制；必须传 replacer 函数。
4. **Vite 的 ESM 产物在 `file://` 下不执行**（CORS），所以交付形态是内联后的单文件 HTML。
5. **IDE 内置浏览器面板是 0×0 隐藏视图**：`take_screenshot` 拿不到东西，只能用 `getComputedStyle` + 元素数量做断言，
   要真截图就得起系统 Chrome（本机 `playwright-core` + `/Applications/Google Chrome.app`，不下载浏览器内核）。
6. **`mcp__browser-use__evaluate_script` 返回值过长会超时且可能被二次 JSON 编码**：探针输出要精简，脚本里兼容 `raw.startswith('"')`。
7. **GitHub / jsDelivr / raw 的 HTTPS 被 TLS 重置**：只走 `git@github.com:` SSH；npm 用 `--registry=https://registry.npmmirror.com`；`GOPROXY=https://goproxy.cn,direct`。
8. **表驱动测试里的注入串**：`sort=` 里带裸 `'` 和空格会被 HTTP 层直接拒 400（这本身是对的），断言注入被安全处理时必须 `url.QueryEscape`；`?q=%` 同理要写成 `%25`。
9. **冻结时钟的测试**：`now` 钉在建单那一刻时，`wall_minutes > 0` 恒不成立；要证明「非工作日零计时」应断言**到期点**（周六建单必须顺延到调休上班日 2026-09-27 之后）。
10. **一次动作只写一条事件**：`Assign` 曾误用 `EvEscalate` 且 from/to 都取跃迁后的状态（时间线显示 `new → new`）；
    `applyStatus` 曾同时写 `status` 和 `resumed` 两条几乎相同的记录。两处都是被 `ui-check.mjs` 的真浏览器回归抓出来的，
    `go test` 抓不到——因为它断言的是接口字段而不是「人眼看到的时间线」。
11. **「超 超 1.4 日」**：已完成超时单的 `remaining_bd_minutes` 存的是正数，格式化函数又加了一次「超」前缀。
    统一走 `remainText(abs(remaining), breached)`。
12. **`derive-themes.py` 会把 CSS 注释里的 `var(--x)` 当成必需 token**：先 `strip_comments` 再比对。
13. **`style-diff.py` 读合并 JSON**（顶层 key 是主题名）时不能要求 `theme` 字段；判定条件要收紧成
    `"theme" not in o and "kpi" in o`。
14. **令牌不进命令行**：`UI_TOKEN=x node ... "$UI_TOKEN"` 在同一条命令里不会展开，而且会把密钥写进 shell 历史与 `ps`；
    `ui-check.mjs` 改成只读 `process.env.UI_TOKEN`。

---

## 7. 目录

```
backend/  cmd/api + internal/{domain,repository,service,handler,server}   # 分层，domain 不依赖任何外层
web/      src/{App,api,format,types,themes,useAsync}.tsx? + styles/        # 单页；三风格只有 CSS 不同
  dist/   vite build 产物
preview/  三个内联单文件页（可直接双击打开，需后端在 8091）
scripts/  api-smoke.sh / derive-themes.py / style-probe.js / style-shoot.mjs / style-diff.py / ui-check.mjs / inline-preview.mjs / serve-static.mjs
evidence/ style-probe.json —— 本轮三主题计算样式取证的原始数据
```
