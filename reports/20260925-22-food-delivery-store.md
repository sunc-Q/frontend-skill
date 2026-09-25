# 20260925-22 · food-delivery-store（椒麻快送 · 灶台看板）

- **时间**：2026-09-25 21:05 ~ 22:05（+08:00）
- **轮次**：第 5 轮（前四轮：saas-subscription-admin / fitness-studio-booking / cross-border-commerce / online-course-platform）
- **结论**：**成功**。1 个新场景 × 3 个新风格全部产出并验证；4 表 9 接口（3 个 Bearer 写）；
  go build/vet/test 全绿（3 包 / 14 个测试函数 / 50 条含子测试用例）；api-smoke **pass=63 fail=0**；
  三风格单文件 preview 实机同构（各 40 表行 / 6 KPI）、computedStyle 两两 ≥3 项互异、零外链；场景目录 1.4M。

## 1. 去重与选型（只依据盘上记录）

- `state.used_scenarios` = 4 个 slug，**无餐饮外卖**；`next_candidates` 首位正是「餐饮外卖门店」→ 直接采用。
- `state.used_styles` = 12 个风格，本轮选的 **孟菲斯几何 / 高对比荧光运动风 / 蓝图工程制图** 三个均在
  `next_style_candidates` 且未出现在 `used_styles` → 全部是首次使用。
- 开工 `df -k .` 可用 **20,114,960KB ≈ 19.2GiB**，远高于 1.5GiB 熔断线 → 允许重构建。
- 与四轮历史的差异化切口：**这次的核心不是价格计算也不是容量分配，而是「时间流水线」**——
  一条订单要在 6 态状态机上被店内推进，看板的每一列就是一道工序；
  因此业务口径压在 `prep_minutes` 的并锅公式与 ETA 合成，而不是折扣/税则。

## 2. 后端（Go/Gin + SQLite）

分层 `cmd/api` + `internal/{domain,repository,service,handler,server}`；
`github.com/glebarez/sqlite` 纯 Go 无 CGO；DSN `journal_mode(WAL)&busy_timeout(5000)&foreign_keys(1)&txlock(immediate)`；
`SetMaxOpenConns(1)` 单写者；库文件 0600（存手机号）。

| 表 | 行数 | 要点 |
| --- | --- | --- |
| `dishes` | 26（23 在售 / 3 沽清） | 价格美分整型、`prep_min` 出餐分钟、`available` 沽清位、`code` 唯一 |
| `zones` | 5（4 启用 / 1 停用 campus） | `delivery_fee_cents` 0/300/500/800、`eta_min` 12/20/30/40、`min_order_cents` 2000~4500 |
| `orders` | 122（当天 23） | 状态机 6 态、`subtotal+delivery=total` 恒等、`prep_minutes`、`order_no` 唯一 `FD20260925-0001` |
| `order_items` | 458（合计 731 份，当天 93 条） | 菜名/单价快照，`line_cents = unit_price × qty` |

口径与规则（全部后端判定）：

1. **并锅出餐**：`prep_minutes = Σ(prep_min × ⌈qty/2⌉)`，`ETA = prep_minutes + zone.eta_min`；
2. **状态机**：`placed→cooking→ready→delivering→delivered`，仅 `placed/cooking` 可 `cancelled`；
   非法跳转与重复推进各回 409（`invalid_transition` / `already_in_state`），未知 id 404；
3. **下单校验链**：明细非空 → `code` 白名单 → 菜品存在且未沽清 → 区域存在且启用 → 起送价 → 手机号/地址文本规则，
   错误按字段键回显（`items[0].code` 形态）；
4. **订单号并发**：唯一冲突在**同一事务内**改序号重试（≤5 次），序号取自 `tx` 上的当日 `LIKE ... ESCAPE '\'` 计数；
5. **隐私**：`Phone json:"-"`，服务层唯一出口 `decorate()` 写 `masked_phone` 并清空原值，接口/页面只见 `138****4514`。

接口（9 个）：`GET /api/health|menu|zones|stats|orders|orders/:id`、`POST /api/orders`（公开下单）、
`POST /api/admin/orders/:id/status`、`POST /api/admin/dishes/:id/availability`（Bearer）。
鉴权矩阵 fail-closed：未配 `ADMIN_TOKEN` → 503；缺失/错格式 → 401；口令不符 → 403。

## 3. 验证

- `go build ./... && go vet ./... && go test ./... -count=1` → 3 个测试包全 `ok`（`domain 0.21s / repository 1.07s / server 1.50s`）。
  表驱动重点：17 例字段校验矩阵、6×6 状态机全矩阵、`MaskPhone/ValidCode` 边界、种子 122 行 + 6 态全覆盖 +
  明细求和 = `subtotal` 的 SQL 交叉校验、`StatsIdentities`、**订单号重复时事务内重生成**、鉴权矩阵、
  注入串/超长 q/`page_size` 钳制、沽清开关含「恢复后仍是沽清」还原。
- `./node_modules/.bin/tsc --noEmit` 干净；`vite build` → `web/dist/assets/app.js` **282,541B**；
  `scripts/inline-preview.mjs` → 三个单文件页 **283,090 / 283,095 / 283,097B**。
- `scripts/api-smoke.sh`（63 条断言）在 8093 实跑 **pass=63 fail=0**：读接口口径与收敛回显
  （`page_size=99999→100`、非法 `sort` 回默认、`q=%` 转义命中 0）、下单 201 → 详情一致 →
  全状态链路推进 → 非法/重复 409、鉴权 503/401/403/201、9 项字段非法逐字段回显、沽清开关往返、恒等式复算。
  **注意**：冒烟会写库，因此 preview 是在 kill → 显式删 `app.db{,-wal,-shm}` → 同 token 重启回到
  `orders_total=122 / dishes 26·23 / gmv 1694700` 之后才生成的；本轮收工又用只读实例复核了同一组数字（458 明细 / 731 份）。
- 三风格实机（`serve-static.mjs` 8092 → browser-use 单属性 getComputedStyle）：

| 探针 | memphis | sport | blueprint |
| --- | --- | --- | --- |
| body font-family | `"Trebuchet MS", …` | `"Arial Narrow", Impact, …` | `ui-monospace, …` |
| body background | `rgb(246, 234, 210)` | `rgb(11, 14, 10)` | `rgb(14, 58, 95)` |
| `.kpi` 左上圆角 | `16px` | `0px` | `0px` |
| `.kpi` padding-left | `20px` | `16px` | `14px` |
| `.kpi` 上边框宽 | `3px` | `0px` | `0px` |
| `.section-title` 下边框 | `solid` | `solid` | `dashed` |
| 表行 / KPI 卡 | 40 / 6 | 40 / 6 | 40 / 6 |

  任意两两对比均 ≥3 项互异（sport 与 blueprint 同为 0 圆角，但字体族/底色/内边距/标题下边框四项不同）。
  零外链：`grep -E '(src|href)="https?://'` 在三个 preview 里计数均为 **0**；
  sport 页 `take_snapshot` 进一步取证真数据渲染（今日 23 单、122 单、客单价 ¥151.31、明细 ¥178+¥5=¥183、
  脱敏 `138****4514`、13 页分页器、页脚被 CSS 转成全大写 → 证明只换 CSS 不改 DOM/JS）。

## 4. 卡点与修复

1. **单写者死锁（本轮最大坑）**：`PlaceOrder` 事务体内用 `r.db` 查当日流水号，去抢自己被事务占住的那唯一连接
   → `FAIL bizsite/internal/repository 600.448s` + `connectionOpener` goroutine dump。改成一律用 `tx` 后
   同一条测试 1 秒内通过。这条已升格为环境硬约束写进 `state.environment_notes`。
2. GORM 聚合视图：沿用第 3 轮教训，`MenuRow.SoldTotal` 显式 `gorm:"column:sold_total"` + 相关子查询
   （SQLite 同层不能引用别名，第 4 轮教训），空集用 `COALESCE`；品类订单数用 `COUNT(DISTINCT o.id)` 防 JOIN 放大。
3. 种子沽清写反（默认 false + 空循环 = 全店沽清）→ 换 `soldOut` 白名单取反。
4. 冒烟两处 FAIL 全是 harness 假阴性（布尔值当金额断言、校验了已被推进过的订单），改脚本不改业务代码。
5. browser-use：动画页导航后第一次 `getComputedStyle` 也会超时，靠「先跑一个纯计数表达式暖机 → 再单属性取值」稳定；
   点击类动作与取值必须拆两次。

## 5. 体量与收尾

- 场景目录 **1.4M**（< 5MB 目标）；LAB 收工 **10M**（含 `.git`）；
  `df -k .` 开工 20,114,960KB → 清理后 20,070,948KB ≈ 19.1GiB，全程未触发熔断；
  二进制一律建在 `/tmp`（38MB 级）并删除，`web/node_modules` 已删，共享缓存未动；
  `lsof` 复核 8092/8093/8097/8098/8099 **监听数为 0**（kill 前均按 PID + `ps -o command=` 核对身份）。
