# 旧货市集撮合台（secondhand-marketplace）

Go/Gin + SQLite 后端、Vite + React + 严格 TS 前端的业务网站样例。一个城市旧货市集的线上撮合台：摊主挂二手货、买家留言出价、摊主拍板约定当面交付。同一套页面渲染成三种互斥视觉风格。

## 场景与角色

市集没有仓库、没有物流，只有「挂单」和「出价」两本账。摊主真正要盯的是三件事：**谁的出价最高且还在有效期内**、**我这个价相对行情是贵了还是便宜了**、**哪些单子挂太久没人问**。

| 角色 | 关心的事 | 落在哪个模块 |
| --- | --- | --- |
| 摊主（卖家） | 上架挂单（品类/标题/成色/自提区域/挂牌价/保底价）、看某单的出价队列、确认成交或拒绝、下架 | 右侧「上新挂单」表单 + 详情面板出价表 + 确认/拒绝按钮 |
| 买家 | 按关键词/品类/成色/状态挑货、看行情溢价指数、在保底价与挂牌价之间出价并留言 | 筛选条 + 主表 + 详情面板「代客出价」表单 |
| 市集运营 | 盯在拍队列（谁该被回复）、盯过期未清理的僵尸 pending、盯成交率与 GMV 结构 | 「出价台」面板（status 切片 + 排序）+ KPI + 品类行情板 |
| 记账/审计 | 成交笔数与「已售出 + 待交付」是否相符、GMV 是否等于各品类之和 | `/api/metrics` 的 `identity_ok` / `identity_note`，页脚原样显示 |

### 业务口径（唯一算法在后端，前端不另算一套）

- **5 个品类**：`photo` 摄影器材（参考价 ¥4200）、`bike` 自行车与配件（¥2350）、`audio` 音响耳机（¥1480）、`keyboard` 机械键盘（¥620）、`book` 旧书与杂志（¥86）。参考价即该品类近 30 天成交中位价，用于算溢价。
- **挂牌溢价指数** `asking_ref_pct = round((asking_cent - ref_cent) / ref_cent × 100)`：正数是「比行情贵」，负数是捡漏。挂单时按品类快照 `ref_cent`，之后品类参考价变动不影响历史单。
- **四态挂单机**：`available → {reserved, withdrawn}`；`reserved → {sold, available}`（当面交付完成转 `sold`，谈崩退回 `available`）；`sold` / `withdrawn` 终态。只有 `available` 能收新出价。
- **五态出价机**：`pending → {accepted, rejected, outbid, expired}`，一笔挂单最多一条 `accepted`（再确认 409 `already_accepted`）。
- **加价阶梯**：`MinIncrementCent = 2000`（¥20）。同一买家若自己的 pending 仍是当前最高，改价必须至少加到 `自己的最高价 + ¥20`，否则 409 `increment_too_small`。
- **出价区间**：必须 `floor_cent ≤ amount ≤ asking_cent - 1`。低于保底 409 `below_floor`；等于或高于挂牌价 409 `above_asking`（该直接拍下，不算议价）。
- **有效期**：`OfferTTL = 24h`。`best_offer_cent` 只在「当前仍有效（pending 且未过期）」的出价上取 MAX；过期出价在拍板时被判定并落库为 `expired`。
- **GMV 口径**：只统计 `accepted` 的成交额；恒等式 `Sold + Reserved == Deals`、`GmvCent == Σ by_category.gmv_cent`、`Σ by_category.listings == ListingsTotal`（第三条是「挂单数不被成交 JOIN 放大」的哨兵）。
- **成交即锁单**：`accept` 成功后挂单转 `reserved`、`best_offer_cent` 锁定为成交额，同单其它 pending 一律按「先过期、后被顶」清理，且该单不再收新出价（409 `listing_reserved`）。

## 数据模型

三张表，`AutoMigrate` 产出的真实 DDL（另有 5 个挂单索引、4 个出价索引）：

```sql
CREATE TABLE `categories` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`name_zh` text,
  `unit` text,`ref_cent` integer,`item_kind` text);
CREATE UNIQUE INDEX `idx_categories_code` ON `categories`(`code`);

CREATE TABLE `listings` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`title` text,
  `category_id` integer,`seller` text,`asking_cent` integer,`floor_cent` integer,`ref_cent` integer,
  `condition` text,`area` text,`status` text,`views` integer,`best_offer_cent` integer,
  `posted_at` datetime,`sold_at` datetime);
CREATE UNIQUE INDEX `idx_listings_code` ON `listings`(`code`);
CREATE INDEX `idx_listings_category_id` ON `listings`(`category_id`);
CREATE INDEX `idx_listings_condition` ON `listings`(`condition`);
CREATE INDEX `idx_listings_status` ON `listings`(`status`);
CREATE INDEX `idx_listings_posted_at` ON `listings`(`posted_at`);
CREATE INDEX `idx_listings_best_offer_cent` ON `listings`(`best_offer_cent`);

CREATE TABLE `offers` (`id` integer PRIMARY KEY AUTOINCREMENT,`listing_id` integer,`deal_no` text,
  `buyer` text,`amount_cent` integer,`message` text,`status` text,`placed_at` datetime,
  `expires_at` datetime,`decided_at` datetime);
CREATE UNIQUE INDEX `idx_offers_deal_no` ON `offers`(`deal_no`);
CREATE INDEX `idx_offers_listing_id` ON `offers`(`listing_id`);
CREATE INDEX `idx_offers_status` ON `offers`(`status`);
CREATE INDEX `idx_offers_placed_at` ON `offers`(`placed_at`);
```

金额一律「分」整型；时间一律 UTC。读取视图（`ListingRow` / `OfferView`）用一次聚合子查询取回展示字段，避免 JOIN 放大：`category_code`、`category_name`、`offer_count`、`pending_count`、`asking_ref_pct`、`best_over_floor`；出价侧 `listing_code`、`title`、`asking_cent`、`floor_cent`、`listing_status`、`is_best`、`over_floor`、`rank`（同单内按金额降序顺位，窗口函数 `ROW_NUMBER()` 算）。

种子数据（`internal/repository/seed.go`，`-seed=true` 且库为空时灌入）：5 品类 + **48 条挂单**（四态齐备，其中 `FS-1003` 零出价、`FS-1004` 只有过期 pending、`FS-1006` reserved、`FS-1008` sold、`FS-1010` withdrawn——专门留给状态机断言）+ 82 笔出价。前 14 条挂单是手写标题与价格，其余按下标公式派生，保证可复现。

## 接口清单

读接口全开放；写接口挂在 `/api/admin` 下，经 `bodySizeLimit(16KB)` + `AdminAuth`。鉴权是单令牌 Bearer：未配置 `ADMIN_TOKEN` → **503**（fail-closed）；缺头 → 401；不匹配 → 403（`crypto/subtle` 常量时间比较）。

| 方法 | 路径 | 鉴权 | 参数 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | 无 | — | `{status,time}` |
| GET | `/api/categories` | 无 | — | `{items[],total}` |
| GET | `/api/metrics` | 无 | `days`（<3→7，>30→30） | `Metrics`：状态分布、在拍/成交/GMV、`daily[]`、`by_category[]`、`identity_ok` |
| GET | `/api/listings` | 无 | `q`（标题/编号/卖家，rune 截断 64）、`status`、`category`、`condition`、`sort∈{posted,asking,best,offers,views,code,status,id}`、`dir∈{asc,desc}`、`page`、`page_size≤100` | `{items[],total,page,page_size,sort,dir,served_at}` |
| GET | `/api/listings/:code` | 无 | 编号（大小写不敏感） | `{listing,offers[]}`，未知编号 404 |
| GET | `/api/deals` | 无 | 同上（`sort∈{placed,amount,expires,deal,status,id}`）；**不带 status 时只给 pending** | `{items[],total,...}` |
| POST | `/api/admin/listings` | Bearer | `code,title,category,seller,asking_cent,floor_cent,condition,area` | 201 `{listing,message}`；字段错 400 `{code,message,fields}`；重号 409 |
| POST | `/api/admin/listings/:code/offers` | Bearer | `buyer,amount_cent,message` | 201 `{offer,message}`；状态机 409（`below_floor`/`above_asking`/`increment_too_small`/`listing_sold`/`listing_withdrawn`/`listing_reserved`）；未知单 404 |
| POST | `/api/admin/deals/:no/decide` | Bearer | `action∈{accept,reject}` | 200 `{listing,message}`（accept）；400 非法 action；409 `already_accepted`/`offer_not_pending`/`offer_expired`；404 |

错误出口只有一个：`handler.AbortWithError`。`domain.AppError{Code,Message,Err,HTTPCode,Fields}` 可对外；其它任何 error（含 GORM/驱动文本）一律降级成 500 `{code:"internal_error",message:"服务内部错误，请稍后重试"}`，**绝不回显 `err.Error()`**。

## 从零复现

```bash
export LAB="/Users/apple/Documents/workProject/试验/业务网站实验室/sites/secondhand-marketplace"
cd "$LAB"

# 1) 后端：纯 Go SQLite 驱动，不需要 CGO
cd backend
export GOPROXY=https://goproxy.cn,direct
export GOMODCACHE=/tmp/flea-gomod          # 别污染 ~/go/pkg/mod 之外的共享缓存
go build -o /tmp/flea-api ./cmd/api
ADMIN_TOKEN='把这段换成你自己的随机串' DB_PATH=/tmp/flea/data.db /tmp/flea-api -addr :8080
# 想同时验证「未配令牌 → 503」，再起一个不给 ADMIN_TOKEN 的同构实例：
DB_PATH=/tmp/flea-noauth.db /tmp/flea-api -addr :8081

# 2) 前端（npx 在本机不可用，一律走 ./node_modules/.bin/）
cd "$LAB/web"
export npm_config_registry=https://registry.npmmirror.com
npm ci                      # 或 npm install
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build          # 产物 web/dist/
cd "$LAB"

# 3）三风格单文件预览（Vite 的 ESM 产物在 file:// 下不执行，必须内联成单文件）
node scripts/inline-preview.mjs web http://127.0.0.1:8080/api   # → preview/{transit,tag,vinyl}.html

# 4）取证脚本（全部只读断言，除 api-smoke 会真写数据）
node scripts/api-smoke.mjs http://127.0.0.1:8080/api '<同一个 ADMIN_TOKEN>' http://127.0.0.1:8081/api
node scripts/style-verify.mjs http://127.0.0.1:8080 /tmp/flea-probe transit tag vinyl
node scripts/render-probe.mjs http://127.0.0.1:8080 /tmp/flea-probe/smoke-target.json transit tag vinyl
# 单文件预览版：node scripts/serve-static.mjs preview 18193 http://127.0.0.1:8080/api
#   再 node scripts/style-verify.mjs 'http://127.0.0.1:18193/{theme}.html?theme={theme}' /tmp/flea-probe-pv transit tag vinyl
```

`preview/*.html` 里烤死的 API 基址是 `http://127.0.0.1:8080/api`，双击打开前先把后端起在 8080（它是同一个 React 应用，数据全部走真接口，不含假数据）。

## 三种风格（同一份 DOM + 同一份 JS，只换 CSS）

三份样式表各约 670 行，选择器集合完全相同，只在取值上分道扬镳：`web/src/styles/theme-{transit,tag,vinyl}.css`。

| | 地铁线路图导视风 `transit` | 旧货手写价签风 `tag` | 黑胶唱片封套风 `vinyl` |
| --- | --- | --- | --- |
| 论点 | 把撮合台当「线路图」读：网格底纹 + 线路色带 + 站牌式表头，信息密度优先 | 把挂单当「摊上手写纸签」：牛皮纸底 + 手写体数字 + 图钉与麻绳，故意歪斜 | 把市集当「唱片店」：暗色大色块封套 + 粗体展示字 + 唱片刻纹圆角 |
| 页面底色 | `rgb(238,241,245)` 冷灰蓝网格 | `rgb(217,185,138)` 牛皮纸 | `rgb(27,23,35)` 近黑紫 |
| 数字字体 | PingFang SC 26px/800 | Bradley Hand / Segoe Print 手写 31px | Futura / Avenir Next Condensed 30px 粗体 |
| 卡片 | 白底 6px 圆角 + 1px 实线描边 | 无底色（透明）+ 纸签阴影与图钉点 | 透明底 + 封套色块，圆角 8px 唱片刻纹 |
| 表头 | `rgb(16,24,32)` 站牌黑 + 1.6px 字距 + 大写 | `rgb(195,154,99)` 麻绳棕 | `rgb(22,18,28)` 暗槽 + 荧光黄强调 |
| 徽章 | 线路黄 `rgb(240,165,0)` 胶囊 | 纸签米白 `rgb(247,226,192)` | 复古金 `rgb(232,179,58)` |
| 引言左边线 | 4px solid（线路色带） | 无边框（改纸签底纹） | 无边框（改封套色块） |

断言口径（`scripts/style-verify.mjs`，用本机 Chrome 无头 + 自研极简 CDP 客户端，零 npm 依赖）：

1. **DOM 同构**：`#root *` 的 `tagName.classList` 序列哈希在三主题下必须逐字节相等（SPA 版与单文件预览版都是 `853713233/len6085`——同一份源码、两种托管，哈希也一致，等于多验了一层「内联打包没改动结构」）。
2. **渲染数据同构**：行数 / KPI 数 / 筹码数 / 首行编号 / KPI 数值三主题一致。
3. **两两差异 ≥3**：39 项计算样式属性里，transit×tag 差 36 项、transit×vinyl 31 项、tag×vinyl 31 项；并含「同主题自比必须 0 差异」的反证，防止计数器自己瞎报。
4. **CSS 全覆盖**：页面真实用到的 71 个 class，必须在三份 CSS 里都出现过（防「某风格漏写规则，元素掉回浏览器默认」）。
5. **零外链 + 无 JS 异常**：`link/script/img` 无跨源地址，`performance` 资源条目全同源，无 console error / 异常 / CSP 拒绝。

## 验证结论（本轮实际跑过的）

| 层次 | 命令 | 结果 |
| --- | --- | --- |
| Go | `gofmt -l . && go build ./... && go vet ./... && go test -count=1 ./...` | 全绿；`internal/domain`、`internal/repository`（10 个表驱动测试）、`internal/server`（10 个 HTTP 测试）；收工复跑时发现 3 个文件（seed.go、两个 `_test.go`）因手写对齐不合 gofmt，`gofmt -w` 后 `go test -count=1` 重跑仍全绿 |
| 类型/构建 | `tsc --noEmit` + `vite build` | 0 错误；产物 `dist/assets/app.js` 287.6 kB |
| 真接口 | `node scripts/api-smoke.mjs` | **123 条断言全通过**：6 个读端点 + 3 个写端点、鉴权矩阵（401/403/503/Basic 不算数）、状态机 409 全分支、字段校验（11 个边界用例）、分页封顶、排序白名单、LIKE 转义、413 体积闸、CORS 精确 loopback、CSP/安全头、109 条响应无一条泄露 SQL/Go 内部串 |
| 三风格 | `node scripts/style-verify.mjs` | SPA 版与 `preview/` 单文件版各跑一遍，5 组断言全通过（逐条原文见 `evidence/style-verify.txt`，计算样式快照见 `evidence/probe-<theme>.json`，肉眼对照见 `evidence/style-<theme>.png`） |
| 渲染安全 | `node scripts/render-probe.mjs` | **30 条断言全通过**（三主题各 10 条）：接口数据真进 DOM；`<img src=x onerror=alert(1)>` 留言与 `a' OR '1'='1` 卖家名都只以文本节点出现，`#root` 内 img/script/iframe/object/embed 计数全 0，单元格 `innerHTML` 是 `&lt;img …&gt;` |

## 踩过的坑与结论

- **GORM 事务里 return error 会连状态修正一起回滚**。`AcceptOffer` 发现出价过期时要先把 `expired` 落库再报错；写在事务内 → 事务回滚 → 库里永远留一笔翻不了身的僵尸 pending。改法：事务内只写状态并 `return nil`，出事务后再构造 409。
- **单写者连接（`SetMaxOpenConns(1)` + `txlock=immediate`）下，事务闭包内所有读写必须走 `tx`**。用 `r.db` 会抢同一条被事务独占的连接，直接死锁。
- **SQLite 的 `datetime` 是文本**：`posted_at > '2026-09-26 03:25:03'` 与带 `+00:00` 后缀的整串比较会假命中「未来挂单」。跨日比较一律 `SUBSTR(col,1,19)`；把 datetime 列扫进 Go `string` 会得到 RFC3339，断言时扫进 `time.Time` 再格式化。
- **`best_offer_cent` 不能直接写新出价**：新单可能低于挂单上早已存在的更高 pending，按新单写会把最优价改小。一律 `MAX(amount_cent)` over「pending 且未过期」重算；`is_best`/`rank` 也只在同单全体出价上算得准（`OfferByDeal` 因此复用 `OffersForListing`）。
- **顶价语义会毁掉「回落样本」**：先高出价会把低的标成 `outbid`，之后拒绝高价时最优价就无从回落。测试要先低后高，并断言中间态；拒绝场景反过来先高后低。
- **换风格只换 CSS 的承诺最容易被内联图形破坏**：品牌位曾按当前主题换 SVG 图形，DOM 哈希当场不一致（6264/6252/6254）。色卡只用 `currentColor` 与 `fill`，图形分支与 theme 无关。
- **`?raw` 注入 CSS 需要 `style-src 'unsafe-inline'`**：CSP 收紧到 `script-src 'self'` 时脚本仍能同源加载，但主题样式会被拒。三风格的注入方式决定了 CSP 的写法，不是随便抄一份。
- **Go 路由层会先于框架拒绝畸形路径**：`/api/listings/..%2F..%2Fbackend` 拿到的是纯文本 400（`invalid URL path`），不是我们的 JSON 错误体。断言要分层：路由层拒绝 ≠ 处理器契约，两者都必须无泄露。
- **取证脚本别用 IDE 浏览器面板**：本机 browser-use 面板反复 15s 超时（页面本身没问题）。改成 `--headless=new` + 自己写的 60 行 CDP over WebSocket 客户端（Node 内置 `WebSocket`，零依赖）后，三主题抓取一次约 3 秒。
- **冒烟入参一律从接口取**：出价金额、保底价、编号若写死，种子数据一动就假失败或假通过。`sandboxListing` 造零出价靶子、金额从靶子字段推导，才是可复跑的断言。
- **`escapeLike` 必须连 `_` 一起转义**：只转 `%` 的话，搜索 `_` 会当「任意单字符」把几乎全表捞出来。本轮实测命中数 = 真含下划线的卖家名数（13/51），说明转义生效。
- **前端接口的 `page_size` 与后端上限不是一回事**：后端 `MaxPageSize=100` 是硬闸，前端默认 12 只是体验选择；`page_size=0/abc/负数` 都要回落默认而不是 500。
