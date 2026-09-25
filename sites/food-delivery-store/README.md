# 椒麻快送 · 灶台看板（food-delivery-store）

第 5 轮业务网站实验室产物：**Go/Gin + SQLite 后端 + React 前端**的一家外卖门店经营看板，
同一份 DOM、同一份 JS，只换 CSS 得到 **3 种互不相同的前端风格**。

- 场景：城市社区外卖快餐店「椒麻快送」——顾客下单（公开接口）＋ 店内出餐调度看板（管理员推进状态）＋ 菜单沽清控制。
- 数据：后端确定性种子（`internal/repository/seed.go`，随机源 20260925），页面不含任何硬编码假数据。
  26 道菜（23 在售 / 3 沽清）、5 个配送区域（4 启用 / 1 停用）、122 笔订单（当天 23 笔，覆盖全部 6 种状态）、458 条订单明细（合计 731 份，其中当天 93 条）。
  实测看板口径：历史 GMV ¥16,947.00、今日 GMV ¥3,470.00、客单价 ¥151.31、平均出餐 34 分钟、取消率 8.2%（10 笔）。
- 体量：场景目录 1.4 MB（源码 + `web/dist` + `preview` + `scripts`）。

## 数据模型（4 表）

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `dishes` | `code` 唯一、`price_cents`、`prep_min`、`available` | 菜单价全部用**美分整型**；`available=false` 即沽清，不可下单 |
| `zones` | `code` 唯一、`delivery_fee_cents`、`eta_min`、`active` | 配送费 0/3/5/8 元与区域时效；停用区域下单直接 400 |
| `orders` | `order_no` 唯一、`status`、`subtotal_cents`/`delivery_fee_cents`/`total_cents`、`prep_minutes`、`placed_at` | 状态机：`placed→cooking→ready→delivering→delivered`，`placed/cooking` 可 `cancelled` |
| `order_items` | `order_id`、`dish_code`、`dish_name`、`unit_price_cents`、`qty`、`line_cents` | 下单快照菜名与单价，改菜单不回溯历史单 |

服务端口径（前端只做格式化，不参与计算）：

- `total_cents = subtotal_cents + delivery_fee_cents`（恒等式在接口层与冒烟脚本双向断言）；
- `prep_minutes = Σ(prep_min × ⌈qty/2⌉)`（同菜并锅），预计送达 = `prep_minutes + zone.eta_min`；
- 单行 `line_cents = unit_price_cents × qty`，明细求和必须等于 `subtotal_cents`；
- 起送价按区域最低价校验（低于门槛 400）；
- 手机号入库保存、出参只给 `masked_phone`（`138****4514`），`Phone` 字段 `json:"-"` 永不外泄。

## 接口（9 个，含 3 个 `ADMIN_TOKEN` Bearer 写接口）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 存活探测 |
| GET | `/api/menu` | 公开 | 菜单 + 累计销量；`?category=&q=&sort=&order=&page=&page_size=` |
| GET | `/api/zones` | 公开 | 配送区域与运费 |
| GET | `/api/stats` | 公开 | 看板汇总：今日 GMV、订单数、客单价、平均出餐、状态分布、品类分布、热销 TOP6 |
| GET | `/api/orders` | 公开 | 订单列表；`?status=&q=&sort=placed\|total\|items\|status\|prep&id&page_size=`（`page_size` 上限 100，非法 `sort` 收敛回默认） |
| GET | `/api/orders/:id` | 公开 | 订单详情（含明细、区域时效） |
| POST | `/api/orders` | 公开 | 顾客下单，返回 201 与订单号；订单号唯一冲突时事务内重算序号重试 |
| POST | `/api/admin/orders/:id/status` | **Bearer** | 推进状态机；非法跳转 409、重复推进 409、未知订单 404 |
| POST | `/api/admin/dishes/:id/availability` | **Bearer** | 沽清/恢复；`available` 必填布尔 |

鉴权矩阵（未配 token 的实例 fail-closed）：`ADMIN_TOKEN` 缺失 → **503**；无/错 `Authorization` → **401**；
非 Bearer 或口令不匹配 → **403**；通过后才进入参数校验（字段级 400）。

安全基线：所有列表查询列名走白名单、`LIKE` 搜索转义 `%`/`_`/`\` 并显式 `ESCAPE '\'`、
`code` 仅允许 `[A-Za-z0-9_-]`、手机号 11 位且以 1 开头、地址文本拦截 `<` `>` 反引号 NUL CR LF `;` `--` `/*`、
`page_size` 钳制、错误统一 `domain.AppError` 映射（**绝不把 `err.Error()` 回显给客户端**）。
SQLite DSN 固定 `journal_mode(WAL)`、`busy_timeout(5000)`、`foreign_keys(1)`，`SetMaxOpenConns(1)` + `txlock=immediate`（单写者模型），
库文件权限 `0600`（存手机号）。CORS 只放行 `http(s)://localhost` / `127.0.0.1` 源。

## 从零复现

```bash
# 0) 环境：Go 1.27+；国内网络必须先走镜像，否则超时
export GOPROXY=https://goproxy.cn,direct

cd backend
# 1) 后端构建 + 静态检查 + 单测（3 包 14 个测试函数 / 50 条含子测试用例）
go build ./... && go vet ./... && go test ./... -count=1

# 2) 起服务（端口 8093；DB_PATH 换成任意可写路径即可，首轮自动播种）
ADMIN_TOKEN='smoke-token-fd-2026' DB_PATH=/tmp/fd-app.db PORT=8093 ./api &
#    （或 go run ./cmd/api，环境变量同上）

# 3) 逐接口冒烟：63 条断言，期望 pass=63 fail=0
BASE=http://127.0.0.1:8093/api TOKEN='smoke-token-fd-2026' bash ../scripts/api-smoke.sh

# 4) 前端：npm 只用 npmmirror；本机禁用 npx，一律走 ./node_modules/.bin
cd ../web
npm install --registry=https://registry.npmmirror.com
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build          # 产出 dist/assets/app.js（约 282 KB，CSS 不拆包）
node ../scripts/inline-preview.mjs      # 产出 ../preview/{memphis,sport,blueprint}.html 三个单文件页

# 5) 预览：Vite 构建产物在 file:// 下无法取数，必须用本地静态服务
STATIC_DIR=web/dist ADMIN_TOKEN='smoke-token-fd-2026' PORT=8093 ./backend/api &
node scripts/serve-static.mjs preview 8092 http://127.0.0.1:8093/api
# 浏览器打开 http://127.0.0.1:8092/memphis.html | sport.html | blueprint.html

# 6) 风格探针（可选，输出各主题 getComputedStyle 关键项）
node scripts/style-probe.js http://127.0.0.1:8092
```

预览生成前请确认运行库是干净种子（`GET /api/stats` 应为 `orders_total=122`、`dishes=26/23`），
否则冒烟脚本写入的试单会被固化进交付物。重置办法：按 PID+命令行确认后 kill，
再显式删除 `app.db` `app.db-wal` `app.db-shm`（**不要写 `x.db*`**，zsh nomatch 会中断整条 `&&` 链），
用同一 `ADMIN_TOKEN` 重启。

## 三种前端风格（同 DOM / 同 JS / 同数据）

| 风格 | 主张 | 关键手法 |
| --- | --- | --- |
| **孟菲斯几何**（memphis） | 80 年代 Memphis Group：糖果色块＋粗黑描边＋不对称圆角，热闹像门店贴纸墙 | `Trebuchet MS`；米底 `rgb(246,234,210)`；`3px solid #17171a` 硬描边＋`6px 6px 0` 实心投影；圆角混用 26/16/10px，按钮 `999px` 胶囊；粉 `#ff5d8f`/黄 `#ffd23f`/蓝 `#2f6df6` 撞色 |
| **高对比荧光运动风**（sport） | 球场记分牌：暗底＋荧光绿＋斜切字面，全大写、零圆角 | `'Arial Narrow', Impact` 斜体；`rgb(11,14,10)` 底；主色 `rgb(204,255,0)`；`transform: skewX(-10deg~12deg)` 反向扶正；`clip-path` 切角；`text-transform: uppercase`；`border-radius: 0` |
| **蓝图工程制图**（blueprint） | 晒图蓝底＋白线网格＋等宽字，把外卖单当施工图读 | `ui-monospace`；底 `rgb(14,58,95)` 叠 `background-size` 双层网格；`1px solid #5e93bd` 细线；`border-radius: 0`；标题带 `FIG.` 计数；下划线 `dashed`；`letter-spacing: 2~3px` |

三页均满足：零外链资源（`grep -E '(src|href)="https?://'` 计数 0），页面数据全部来自接口。

实机 `getComputedStyle` 取证（每页各跑一次，行/卡数量一致 → 同一 DOM）：

| 探针 | memphis | sport | blueprint |
| --- | --- | --- | --- |
| `body` 字体族 | `"Trebuchet MS", …` | `"Arial Narrow", Impact, …` | `ui-monospace, …` |
| `body` 背景色 | `rgb(246, 234, 210)` | `rgb(11, 14, 10)` | `rgb(14, 58, 95)` |
| `.kpi` 左上圆角 | `16px` | `0px` | `0px` |
| `.kpi` 左内边距（间距口径） | `20px` | `16px` | `14px` |
| `.kpi` 上边框宽度 | `3px` | `0px` | `0px` |
| `.section-title` 下边框样式 | `solid` | `solid` | `dashed` |
| `button` 圆角 | `999px` | `0px` | `0px` |
| 表格行数 / KPI 卡数 | 40 / 6 | 40 / 6 | 40 / 6 |

任意两两对比在字体族、背景色、圆角、内边距、边框上均有 ≥3 项互异（sport 与 blueprint 虽同为零圆角，
但字体族/底色/内边距/标题下边框样式四项不同）。

## 本轮踩到的坑

1. **单连接事务内绝不能用 `r.db`**：`SetMaxOpenConns(1)` 下，`PlaceOrder` 的事务里若用 `r.db` 查当日流水号，
   会去抢唯一那条已被事务占住的连接 → 测试包卡死 600s 超时（`FAIL bizsite/internal/repository 600.448s` + `connectionOpener` goroutine dump）。
   修法是事务体内一律用 `tx`。订单号冲突重试也放进同一个事务闭包内，最多 5 次。
2. **GORM 视图结构体必须显式列名**：菜单累计销量是子查询别名字段，沿用 round-3 教训用
   `MenuRow{ SoldTotal int64 gorm:"column:sold_total" }`；SQLite 同一 select 列表不能引用别的列别名，
   所以 `sold_total` 写成相关子查询而不是复用同层的 `available`。空表聚合统一 `COALESCE(SUM(...),0)`。
3. **种子必须真造出各分支**：6 种订单状态靠「当天 `i%9` 分配 + 历史日 `i%13==5` 取消」显式铺，
   并让 `repo_test` 断言 6 种状态全覆盖——否则看板某一列永远为空、状态机分支永远走不到。
4. **沽清别写反**：初版用 `Available` 默认 false 加一个空循环，等于全店沽清；改成 `soldOut` 白名单映射后取反赋值。
5. **冒烟脚本假阴性仍是脚本问题**：`jget` 里 `eval('d$1')` 会展开成 Python 语法错（改 `eval("d$1")`）、
   取字段前必须把 `req` 的 stdout 重定向掉，否则状态码和 JSON 拼成 `20014`；
   本轮两处 FAIL 分别是「断言把布尔值当金额」和「校验错了被推进过的订单」，都改脚本、不动业务代码。
6. **动画页的 evaluate_script 极不稳定**：主题页含无限 CSS 动画，一次调用放 3 个属性以上必 15s 超时，
   即便单属性也可能在刚导航完时超时。可靠节奏是：导航 → 先跑一个纯计数表达式「暖机」 →
   再逐次单属性取 `getComputedStyle`；点击类「动作」与取值的「读取」必须拆成两次调用，
   取值以 `take_snapshot` 无障碍树为准。
7. 中文路径下 `cd "…"` 形式的 Bash 命令会被转义破坏（`no such file or directory`），改用工具的 `dir_path` 参数。

## 已知遗留

- 配送费/时效写死在种子的 5 个区域里，加区域要改数据播种逻辑（无独立运费价卡表）。
- 起送价、`⌈qty/2⌉` 并锅系数是常量，没有活动/规则表可运营侧调整。
- `order_items` 只存 `dish_code` 快照，没有 `(order_id, dish_code)` 复合唯一约束（同菜拆两行的输入会被接受并合并计价）。
- 取消的订单永久占位：同一手机号可重复下单，没有幂等键；放开需要额外设计。
