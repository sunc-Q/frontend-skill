# 第 8 轮 · 驻场 SLA 值班台（support-ticket-sla-desk）

时间：2026-09-26 01:15 ~ 02:50（+08:00）
场景来源：`state.json.next_candidates` 里的「客服中心工单与 SLA」
三风格：冷灰账簿 `ledger` / 儿童绘本 `picture` / 深色企业台 `corporate`（均为 `used_styles` 未收录的新名字）
产物：`sites/support-ticket-sla-desk/`，清理后 **1.8 MB**（54 个文件）

## 一句话结论

**成功。** 5 表 / 8 读 + 6 写接口 / 1 页 × 3 风格全链路验证通过：
`go build·vet·test` 全绿，`tsc --noEmit` 0 错，`api-smoke.sh` **112 项断言 0 失败**，
`ui-check.mjs` **21 项真浏览器回归全过**，`style-diff.py` **失败项 0**（互斥 50/57/57、同构 12 字段全等、零外链、零 console 错误）。

## 这个场景挑的不是「CRUD」，是一个可审计的时钟

普通工单系统的 SLA 就是 `due = created + 8h`。驻场运维不行——合同写的是**工作分钟**：

- 周六下午进的单，SLA 不能从周六下午开始烧；午休 12:00–13:00 也不能烧；
- 但「等客户复现」「等厂商备件」要**停表**，恢复后接着烧，且要能倒查是谁在哪一刻按下的；
- 调休上班的周日（2026-09-27、2026-10-10）必须算工作日，尽管它是周日。

于是把「任何一个数字都能拆成一条自洽的加法算式」做成硬承诺：
`domain.ComputeClock` / `LedgerFor` 是唯一计算口，列表、详情、统计共用同一份分解式，
详情页把四条恒等式逐条摊给审计看（`clock_identity_ok` / `identity_timeline_ok` / `identity_wall_split_ok`）。
前端**不再算第二次时效**，只渲染后端下发的布尔位与字符串。

## 后端

- 分层：`cmd/api` + `internal/{domain,repository,service,handler,server}`；`domain` 不依赖任何外层。
- SQLite：`github.com/glebarez/sqlite`（纯 Go，无 CGO），DSN 四个 pragma
  （`journal_mode(WAL)` / `busy_timeout(5000)` / `foreign_keys(1)` / `txlock(immediate)`），
  `SetMaxOpenConns(1)` 单写者，库文件 `Chmod 0600`（存了客户联系人手机号）。
- 5 张表：`customers` / `agents` / `sla_policies` / `tickets` / `ticket_events`。
  工单侧存**时效快照**（`response_target_bd` / `resolve_target_bd` / `*_due_at`），改合同不回溯在办单；
  停表不存区间表，只存 `paused_bd_minutes`（已结账）+ `paused_since`（进行中），
  时间线 `ticket_events` 是复算的唯一来源；同名在办单靠**部分唯一索引**去重。
- 隐私：`ContactPhone json:"-"`，接口只出 `masked_phone`，且只在工单行上出；`/api/customers` 干脆不带电话字段。
- 鉴权：单个 `ADMIN_TOKEN` Bearer 头，三层 503（服务端未配，绝不放行）/ 401（缺或畸形）/ 403（不匹配），`subtle.ConstantTimeCompare`。
- 错误：一律 `domain.AppError{Code,Message,Err}`，对外只回 `code` + 中文 `message`，**绝不回显 `err.Error()`**。
- `/api/meta` 把前端所有字典与阈值收口到接口（7 状态含中文 label、4 tier、6 页签、10 排序项、停表原因、策略上下界、`minutes_per_day`、`field_utc_offset_min`），正面满足「数据必须来自接口」。

## 前端与三风格

Vite 8 + React 19 + TS strict（`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noUnusedLocals` / `verbatimModuleSyntax`）。
单页 1336 行：状态条时钟、8 KPI、6 页签、9 项筛选（带 `droppedFilters` 回显哪些条件被服务端收敛）、
10 列表格、详情账本 + 四条恒等式、时间线、侧栏（工作日历 16 格 / 工程师负载 / 合同矩阵 / 策略编辑 / 建单 / 时效审计 / 趋势）。

「只换 CSS」做成了可校验的工程约束，而不是口头承诺：

```
base.css（1255 行结构层，63 个 token，零裸色值）+ tokens-<id>.css
        └─ scripts/derive-themes.py 拼装 → theme-<id>.css
           缺 token 即失败；base.css 出现裸色值即失败
```

组件里没有任何 `theme ===` 分支；`style-diff.py` 同时断言**互斥性**（每对 ≥3 项计算样式不同，实测 50/57/57）
与**同构性**（12 个结构字段三主题全等），后者才是「同一份 DOM + 同一份 JS」的真正证据。

## 本轮抓到的两个真缺陷（都是真浏览器回归的功劳）

1. **时间线一次动作写两条 / from=to**：`Assign` 误用 `EvEscalate` 且 from、to 都取跃迁后的状态（显示 `new → new`）；
   `applyStatus` 在离开停表态时同时写 `status` 和 `resumed` 两条几乎相同的记录。
   → `closePause` 改为只结账不写事件，`resumed` 成为唯一那一跳。
   `go test` 抓不到：它断言的是接口字段，不是「人眼看到的时间线」。
2. **列表与详情差 8 小时**：GORM 统一按 UTC 存取，所以工单行的 `created_at` 是 `…Z`，
   而账本 / 时间线 / `due_at` 是后端 `.In(FieldTZ)` 格式化过的 `+08:00` 串；
   前端原来只做字符串截取，于是同一张单列表显示 08-01 21:49、详情显示 08-02 05:49。
   → `/api/meta` 下发 `field_utc_offset_min`，`format.ts` 用 `Date.parse` + `toISOString`（都与本机时区无关）
   做「UTC + 固定偏移」的确定性换算，绝不用 `toLocaleString()`；
   `ui-check.mjs` 加了一条「列表与详情的建单时刻一致」把它钉住。

另外，`api-smoke.sh` 第一版有 32 项失败，逐条查下来**全是脚本自己猜错了契约**（`customer` 不是 `customer_id`、
`status` 不是 `to`、停表原因必须来自字典、非法 `sort`/`only` 是回落而非 400、客户不存在是 404 不是 400、
写响应只回 TicketRow 没有 timeline），应用行为一律正确。修正后 112/0。
教训：**验证脚本里的入参形状要从接口取，不要硬编码**——脚本改成了先 `GET /api/customers` 拿 `code`、
`GET /api/meta` 拿 `pause_reasons[0]` 再发写请求。

## 复现命令

见 `sites/support-ticket-sla-desk/README.md` 第 4 节（含 `GOPROXY` / `--registry=https://registry.npmmirror.com` /
不用 npx / 端口 8091·18262·8093 / 两个实例验 503 分支）。

## 磁盘与清理

开工 `df -k .` 可用 19,337,756 KB（≈18.4 GiB），远高于 1.5 GiB 熔断线。
删除：`web/node_modules`（64 MB）、`/tmp/sla-desk-api` 编译产物、`/tmp/sla-{smoke,notok}.db{,-wal,-shm}`、
`/tmp/sla-*.log`、`/tmp/sla-probe*.json`、`/tmp/sla-shot-*.png`、临时令牌文件 `/tmp/sla-tok`。
未动全局共享缓存（`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache`），没有 `go clean -cache/-testcache`。
进程按端口找 PID 并逐个 `ps -o command=` 核对后才 kill：`:8091`、`:8093`、`:18262` 三个都是本轮自己起的，收工后监听数 0。
