# 山宿云房 · 民宿房态日历经营台（homestay-booking-calendar）

第 7 轮业务网站：**Go/Gin + SQLite 后端** + **Vite/React 前端**，同一份页面出 **3 套视觉风格**。
场景是山野民宿连锁的房态与经营台账——店长早上打开看一眼：今天谁到店、哪间房空着、
这一晚卖的是平日价还是国庆价、停售的格子要不要恢复。

- 后端：`backend/`（`cmd/api` + `internal/{domain,repository,service,handler,server}`，Go module 名 `bizsite`）
- 前端：`web/`（源码 + `web/dist/` 构建产物）
- 成品：`preview/{skeuo,iso,acid}.html`（JS/CSS 全内联的单文件版）
- 脚本：`scripts/`（派生风格、内联、静态托管、接口冒烟、计算样式取证，全部保留可复跑）

---

## 1. 场景与角色

| 角色 | 关心什么 | 落在哪个界面区块 |
|---|---|---|
| 店长（读） | 今日到店/在住/退房、入住率、ADR/OCC/RevPAR、实收净额 | 顶部 6 张 KPI 卡 + 未来 N 天负载条 |
| 前台（读+写） | 房态日历逐日价格与占房、试算、下单、办理入住/退房/取消 | 房态日历 + 右侧试算与下单 + 订单详情 |
| 运营（读） | 渠道构成、门店组合、房型排行、订单检索与排序 | 订单台账 + 右侧三张排行卡 |
| 管理员（写） | 停售/恢复、房型上下架、状态机推进 | 日历格选中后的 4 个写按钮（需 `ADMIN_TOKEN`） |

业务口径（本轮的"真业务感"来源，全部在后端算，前端只渲染）：

- **区间半开**：`[check_in, check_out)`，离店日不计夜。
- **五级优先价**（从高到低）：房型特价日 > 房型停售 > 整院停售 > 全局节假日倍率 > 周末倍率 > 平日基准价。
- **清洁缓冲**：退房后该房型 `clean_buffer_days` 天内不可复住（`domain.BuildQuote` 的 blocker 之一）。
- **周末最少住**：周五/周六夜要求连住 ≥ `min_stay_weekend` 晚。
- **库存排他**：同一房型同一晚的占房数（`pending/confirmed/checked_in` 三类合计）不得超过 `units`。
- **三条恒等式**（页面右下角"恒等式体检"实时展示，接口里也回布尔位）：
  `Σ逐夜金额 == 房费小计`、`总额 == 房费小计 + 清洁费`、`实收 == 成交额 + 取消单总额 − 退款`；
  另有 `RevPAR ≈ ADR × OCC`（容差按整除漂移给）。
- **单一算价引擎**：种子灌数和线上下单都调 `domain.BuildQuote`，统计层从不第二次算价。

## 2. 数据模型（5 张表，GORM AutoMigrate）

```
properties      门店/院：code(uniq) name region intro check_in_at check_out_at
                clean_buffer_days min_stay_weekend rating(千分制)
room_types      房型：code(uniq) property_code name beds capacity units
                base_price_cents weekend_pct holiday_pct clean_fee_cents
                breakfast scene amenities status(active|inactive) min_stay_default sort_order
rate_days       逐日日历覆盖项：(date, scope, ref_code) 复合唯一
                scope = global|property|room；kind = holiday|promo|closed；holiday_pct / price_cents / label
bookings        订单：code(uniq HSyyyymmdd-nnn) room_code property_code guest_name
                phone(20, 带 json:"-" 永不外显) check_in check_out units guests
                channel status(pending|confirmed|checked_in|checked_out|cancelled|no_show)
                night_subtotal_cents clean_fee_cents total_cents refund_cents avg_night_price_cents nights note
booking_nights  逐夜留痕：booking_id booking_code date kind label price_cents units amount_cents
```

补建索引（`repository/db.go`，AutoMigrate 只建单列）：

```sql
CREATE INDEX IF NOT EXISTS idx_bookings_room_range ON bookings(room_code, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_nights_date        ON booking_nights(date, units);
```

种子（`repository/seed.go`，启动时库为空则灌入）：4 家门店 / 14 个房型 / ≥180 份订单（自检断言下限），
覆盖 4 类价格档（平日/周末/节假日/特价）、6 种订单状态、退款单、整院包场停售与单房型停售。
种子是**回放真实引擎**：造单时调 `BuildQuote`，所以逐夜金额与线上试算同源。

## 3. 接口清单（全部 JSON，前缀 `/api`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | — | 存活探针（UTC 时间，注意与"今天"不同日） |
| GET | `/api/stats?days=28` | — | 6 张 KPI + 历史/未来窗口 + 负载条 + 三条恒等式布尔位 |
| GET | `/api/properties?from=&days=` | — | 门店列表（含每店房型），键名 `items` |
| GET | `/api/rooms?property=&status=&breakfast=&q=&sort=&dir=&page=&page_size=` | — | 房型列表 + 窗口指标，排序双白名单 |
| GET | `/api/rooms/:code?days=28` | — | 单房型逐日日历（`calendar[]`：价格/占房/停售/种类） |
| GET | `/api/rooms/:code/quote?check_in=&check_out=&units=&guests=` | — | 试算：逐夜拆价 + `blockers[]` 不可订原因 |
| GET | `/api/bookings?horizon=&status=&channel=&q=&sort=&dir=&page=&page_size=` | — | 订单台账（手机号只回掩码） |
| GET | `/api/bookings/:code` | — | 订单详情 + 逐夜 |
| POST | `/api/rooms/:code/bookings` | `ADMIN_TOKEN` | 下单（事务内二次校验库存/缓冲/停售，冲突 409） |
| POST | `/api/bookings/:code/status` | `ADMIN_TOKEN` | 状态机推进（非法迁移 409、时间门 409） |
| POST | `/api/rooms/:code/closure` | `ADMIN_TOKEN` | 停售/恢复（写 `rate_days`） |
| POST | `/api/rooms/:code/status` | `ADMIN_TOKEN` | 房型上下架 |

安全约定（`internal/server/server.go` + `internal/handler`）：

- 写接口三层 fail-closed：未配 `ADMIN_TOKEN` → **503**；缺/畸形 Bearer → **401**；令牌不符 → **403**（`crypto/subtle` 常量时间比较）。
- 请求体上限 16KB（`io.LimitReader`），超限直接 400 不进 JSON 解析器。
- 路径参数先过 `domain.IsCode` 白名单，非法编码 404，**绝不拼进 SQL**；订单号还要求 `HS` 前缀。
- 搜索串 rune 截断（≤32）+ `LIKE ? ESCAPE '\'` 转义 `%_\`；排序列走 `domain.BookingSorts/RoomSorts` 白名单映射。
- 对外错误只经 `domain.AppError` → 统一映射，**绝不回显 `err.Error()`**；`phone`/`avg_night_price_cents` 带 `json:"-"`。
- CORS 只放行 `http://127.0.0.1|localhost|[::1]` 来源，**不接受 `Origin: null`**（见 §6 坑 5）。
- `STATIC_DIR` 分支下 `r.NoRoute(json404)`，保证未匹配的 `/api/*` 仍回 JSON 而不是纯文本。

## 4. 从零复现

```bash
cd sites/homestay-booking-calendar

# ① 后端（Go 1.27；纯 Go SQLite 驱动，无需 CGO）
cd backend
export GOPROXY=https://goproxy.cn,direct
go build ./... && go vet ./... && go test ./...
ADMIN_TOKEN=demo-admin-token-hs \
  STATIC_DIR="$PWD/../web/dist" \
  go run ./cmd/api -db /tmp/hs-run.db -addr :18261
#   库文件不存在会自动建表并灌种子；-db 也可用环境变量 DB_PATH，端口可用 PORT
#   注意：这个库是临时演示库，冒烟脚本会真的往里写单/停售

# ② 前端（npm 走 npmmirror；npx 在本机不可达，一律用 ./node_modules/.bin/xxx）
cd ../web
npm config set registry https://registry.npmmirror.com   # 或每条命令带 --registry=...
npm install
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build                            # -> dist/（单入口，CSS 内联进 JS）

# ③ 单文件成品（三风格各一个 HTML，JS/CSS 全内联）
cd ..
node scripts/inline-preview.mjs web http://127.0.0.1:18261/api   # -> preview/{skeuo,iso,acid}.html

# ④ 校验（本轮全绿：接口 63 项断言 0 失败；三风格 37~41 项计算样式不同、结构全等）
ADMIN_TOKEN=demo-admin-token-hs SMOKE_DB=/tmp/hs-run.db \
  bash scripts/api-smoke.sh http://127.0.0.1:18261
node scripts/serve-static.mjs preview 18262 http://127.0.0.1:18261/api &
node scripts/style-shoot.mjs 'http://127.0.0.1:18262/{theme}.html' /tmp/probe.json /tmp/shot-
python3 scripts/style-diff.py /tmp/probe.json
```

打开 `http://127.0.0.1:18261/?theme=skeuo|iso|acid` 看后端托管版，
或 `http://127.0.0.1:18262/acid.html` 看单文件版（原因见 §6 坑 5）。

## 5. 三风格：同一份 DOM + 同一份 JS，只换 CSS

`web/src/themes.tsx` 用 `?raw` 把三套 CSS 读成字符串，切主题只是换 `<style>` 内容——
`App.tsx` 里没有任何 `theme ===` 分支控制结构。三套 CSS 由 `scripts/derive-themes.py`
从模板的 `theme-swiss.css` **字面量替换派生**：token 层换皮（`:root` 变量）+ 末尾追加本风格专属规则，
替换命中不了就报错退出，杜绝"手写两份 CSS 然后跑偏"。

| 计算样式探针（1280×1200 无头 Chrome 实测） | 拟物工艺台历 skeuo | 等距轴测工业风 iso | 酸性夜场海报 acid |
|---|---|---|---|
| 标签字体 | Avenir Next（衬线大字） | JetBrains Mono | Courier New |
| 标签字号/字距 | 11px / 1.76px | 10px / 1.6px | 12px / 2.88px |
| 标签处理 | none / normal | uppercase | uppercase / **italic** |
| KPI 数值字号/字重 | 38px / 700 | 32px / 500 | 52px / 400 |
| KPI 圆角 | 14px | 0px | 0px |
| KPI 上边框 | 1px solid | 1px solid | 2px solid |
| KPI 阴影 | 内高光 `inset 0 1px`（凸起纸面） | `5px 5px 0`（挤出体） | `8px 8px 0`（荧光错位块） |
| KPI 内边距 | 22px | 18px | 28px |
| 表头底色 | 透明（靠分隔线） | rgb(10,28,49) 深蓝纸 | rgb(16,13,20) 近黑 |
| 按钮圆角 | 999px（缝线胶囊） | 2px（直角金属） | 999px（荧光描边） |
| 日历格圆角 | 10px | 0px | 6px |
| 栅格间距 | 18px / 18px | 10px / 10px | 20px / 20px |
| 日历行轨道宽 | 58px | 58px | 58px | ← 结构量，三风格必须一致
| 日历格数 / 订单行数 | 364 / 30 | 364 / 30 | 364 / 30 | ← 同上

判定结果（`scripts/style-diff.py` 对 61 个计算属性逐对比对）：

```
① 互斥性：acid vs iso 39 项不同；acid vs skeuo 41 项；iso vs skeuo 37 项   （门槛 ≥3）
② 同构性：kpiCount/rowCount/calCellCount/rowCountCal/inlineStyles/external 三主题全等
          external = []（零外链），consoleErrors 三主题全空
```

风格命名说明：`used_styles` 里已有"蓝图工程制图"（第 6 轮），本轮第二套初稿也叫"等距工业蓝图"，
虽然实现完全不同（轴测挤出体 vs 平面制图），但为免"换个名字重用旧风格"的嫌疑，
统一改名 **等距轴测工业风**，并把 CSS 注释里残留的"蓝图纸"字样一并换成"轴测网格"。

## 6. 本轮踩到的坑（下一轮别再踩）

1. **`/` 在工具回显里会被渲染成 `-`**。日期 `2026-09-26` 与 `2026/09/26` 在 Bash/Read 输出里长得一样，
   改错/改对都看不出来。断言斜杠内容要用 `od -c` 或先把 `/` 换成标记串，别用眼睛比。
2. **周末最少住把"正向用例"打挂了**。`BuildQuote` 的 3 个 blocker 反例改成落在周一/周二夜才通过——
   造测试日期要先算它是周几。
3. **种子必须有特价成交**。促销日历没人下单 → "特价档"在统计里是空的，仓库层覆盖断言
   （`booking_nights.kind` 必须含 promo）直接失败。解决：种子末尾按 `rate_days` 定向造 promo 订单。
4. **`httptest.NewRequest` 遇到 URL 里的裸空格直接 panic**（`invalid method`）。
   注入类用例一律 `url.PathEscape`/`%20` 编码后再发。
5. **`file://` 打开单文件预览拿不到数据**，这是**故意的**：`file://` 的 `Origin: null`，
   而后端 CORS 只放行 127.0.0.1/localhost。放行 `null` 等于对所有本地程序开门。
   所以预览版要在同机 http 下看：`node scripts/serve-static.mjs preview 18262 http://127.0.0.1:18261/api`。
6. **JSON 数字在 Go `map[string]any` 里是 `float64`**，断言 `day["available"] != 0` 永远为真。
   要比 `float64(0)`。
7. **冒烟脚本截断响应体会伪造"断言失败"**：`head -c 400` 把深层键切掉，三条恒等式全"缺键"。
   改成 `head -c 200000`，展示时才 `cut160`；取字段用 python JSON path（`jget`），
   别用贪婪 `sed`——`items[0].code` 这种键 sed 会取错。
8. **`/api/rooms` 的列表键名是 `items`，但 `/api/properties` 曾回 `properties`**，
   前端按 `items` 读 → 页面顶部"0 家门店"、门店筛选与门店组合卡全空。
   教训：**同一份 API 的列表键名必须统一**，且校验不能只看状态码 200，要断言键名与条数
   （冒烟脚本已加 `pick_room` + 键名断言）。
9. **种子房型名混进了英文残片**（`layered 台地房`）。截图取证能看到、接口断言看不到——
   所以 `style-shoot.mjs` 的截图不是装饰，是数据质检的一部分。
10. **模板 CSS 的固定栏数会撑破新页面**：`.form-row` 是 5 栏网格（两个日期框各占 1/5 必然溢出）、
    `.kpi-*` 是 `<span>` 但基线排一行会让 52px 大数字压住说明文字、`.cal-name` 定宽 168px 会溢到相邻格子下。
    修法统一放在派生脚本的 `SHARED` 段（三风格共用一条规则），不改 DOM。
11. **不给 favicon 链接，浏览器必然自动请求 `/favicon.ico` 并挨一个 404**，
    会被取证脚本记成"页面有控制台错误"。`index.html` 里加 `<link rel="icon" href="data:," />`
    （`data:` 不算外链，零外链断言仍成立）。

## 7. 结论

- 后端分层 + 单一算价引擎的组合让"业务口径"变得可测：仓库层测试直接对种子数据断言
  金额恒等式、零超卖、缓冲/停售合规，比页面截图可靠得多。
- "三风格只换 CSS"在 token 层派生下成本很低（61 个计算属性里 37~41 项两两不同），
  但**共用结构层必须显式维护**（`SHARED` 段），否则模板遗留的固定栏数会在每个主题里各崩一次。
- 下一轮值得试的场景（`state.json.next_candidates`）：宠物医院门诊排班、二手车评估上架、
  冷链运输调度台、图书馆特色馆藏借阅。风格池剩余可用名见 `state.json`。
