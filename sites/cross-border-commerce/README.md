# 澜鲸全球购 · 跨境商品与购物车运营台（cross-border-commerce）

第 3 轮场景（2026-09-25）。Go/Gin + SQLite 后端，Vite + React + TS 前端，同一份 DOM/JS 出 **3 种风格**：
暖纸编辑排版（paper）、蒸汽波（vapor）、终端绿字 CRT（crt）。

## 1. 场景与角色

一家自营跨境电商店铺的「商品 + 购物车 + 到手价」经营台：

- **访客（买家侧）**：浏览商品货架（类目筛选 / 仅有货 / 关键字搜索 / 排序 / 分页），点开商品详情（星级分布、买条、物流时效），加购 / 覆盖数量 / 移出，并对比**五个目的国（US/DE/JP/AU/AE）的到手价**——货值、运费（首重+续重）、关税、免邮线全部由后端按固定税则折算，前端只做格式化。
- **运营（管理侧）**：在页脚用 `ADMIN_TOKEN` 的 Bearer 鉴权上新 SKU，逐字段回显 400/409 校验结果。

口径要点（唯一事实源在后端）：

- 金额一律 **美分整型**；本币展示 = 美分 × 汇率（JPY 无小数），换算只在格式化层做。
- 运费：≤500g 收首重，超出部分按 500g **向上取整**加档；商品总额达免邮线则运费为 0。
- 关税 = 货值 × 税率；`goods + freight + duty = total` 恒等式在接口层即被保证（冒烟脚本对五国逐一断言）。
- 下架商品留在购物车里可看但**不计价**；零库存行不产生行金额。

## 2. 目录结构

```
sites/cross-border-commerce/
├── backend/                 # Go/Gin + GORM + SQLite
│   ├── cmd/api/main.go      # env: DB_PATH / PORT / ADMIN_TOKEN / GIN_MODE；-seed 幂等灌数
│   └── internal/
│       ├── domain/          # 模型、税则、校验、查询解析、AppError
│       ├── repository/      # db.go(WAL DSN+AutoMigrate) repo.go seed.go
│       ├── service/         # 业务编排：详情聚合、购物车五国折算、鉴权前置校验
│       ├── handler/         # auth.go(401/403/503) errors.go(AppError→JSON) handlers.go
│       └── server/          # 路由、安全响应头、localhost CORS、SPA 静态挂载（防穿越）
├── web/                     # Vite + React 19 + TS strict（src/ + dist/ 产物）
│   └── src/styles/theme-{paper,vapor,crt}.css   # 三风格只换这里
├── preview/{paper,vapor,crt}.html               # 单文件内联版（file:// 可直开）
├── scripts/
│   ├── api-smoke.sh         # 接口冒烟：读接口统计 + 购物车矩阵 + 鉴权矩阵 + 注入边界
│   ├── inline-preview.mjs   # dist → 单文件 preview（下标切片注入，带 JS 完整性断言）
│   ├── serve-static.mjs     # 本机 http 托管 dist/ 并注入 __API_BASE__/__THEME__
│   └── style-probe.js       # 浏览器 getComputedStyle 三风格互异断言探针
└── README.md
```

## 3. 数据表（3 张）

`backend/internal/repository/db.go` 用 glebarez/sqlite（纯 Go，无 CGO）打开：
DSN `?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)`，文件 0600，`SetMaxOpenConns(1)` 单写者。

```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at datetime,
  sku TEXT UNIQUE NOT NULL,            -- size:32，唯一索引
  name TEXT, name_en TEXT,
  category TEXT, brand TEXT,           -- category 建索引
  price_cents INTEGER,                 -- 美分
  stock INTEGER, weight_g INTEGER,
  hs_code TEXT, origin TEXT,
  lead_min_days INTEGER, lead_max_days INTEGER,   -- GORM 默认会错映射成 lead_min/lead_max，必须显式 column tag
  sold_30 INTEGER,                     -- 同上：Go 字段 Sold30 默认映射 sold30，必须显式 column tag
  listed BOOLEAN,                       -- 建索引
  bullets TEXT                          -- 卖点，竖线 | 分隔
);
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,                  -- 外键（列表聚合用 LEFT JOIN，不依赖约束级联）
  author TEXT, country TEXT,
  rating INTEGER,                      -- 1-5
  body TEXT, verified BOOLEAN, posted_at DATETIME
);
CREATE TABLE cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER UNIQUE,           -- 一行一个 SKU，重复加购为覆盖
  qty INTEGER, added_at DATETIME
);
```

## 4. 接口清单

| 方法 | 路径 | 鉴权 | 入参 | 返回 |
|---|---|---|---|---|
| GET | `/api/health` | 无 | — | `{status,time}` |
| GET | `/api/meta` | 无 | — | `{categories,regions,stats}`，stats 为真实聚合（商品数/在架/类目/评价数/购物车行数与重量等） |
| GET | `/api/products` | 无 | `category`(白名单) `in_stock=1` `q`(≤64 rune，LIKE 转义) `sort`(price/rating/sold/stock/name/created/id 白名单) `dir` `page` `page_size`(≤60) | `{items,total,page,page_size,sort,category,served_at}`，行内含 `rating_avg/review_cnt` |
| GET | `/api/products/:sku` | 无 | — | `{product,stats,reviews}`（stats 含 1-5 星分布） |
| GET | `/api/products/:sku/reviews` | 无 | `page` `page_size`(≤50) | `{items,total,page,page_size}` |
| GET | `/api/cart` | 无 | `region`(US/DE/JP/AU/AE，缺省 US，大小写收敛) | `CartView{lines,item_qty,total_weight_g,region,totals[5],served_at}` |
| POST | `/api/cart/items?region=` | 无 | body `{sku,qty}`；qty=0 移出，超库存 409 `out_of_stock`，下架 409 `invalid_state`，SKU 不存在 404 | 同 `CartView`（加/删后回读） |
| POST | `/api/admin/products` | Bearer `ADMIN_TOKEN` | `CreateProductInput`（逐字段校验） | 201 新行；SKU 重复 409；缺/畸形令牌 401；令牌不符 403；服务端未设 token 503（fail-closed） |

错误统一 `domain.AppError` → `{code,message,fields?,request_id?}`，**绝不回显内部 err.Error()**。
前端地址：`window.__API_BASE__` 优先，否则 `/api`（同源）。

## 5. 从零重建

```bash
export DB_PATH=$PWD/backend/data/app.db PORT=8080
export ADMIN_TOKEN="$(openssl rand -hex 12)"      # 只放环境变量，不落盘不入 git

# 后端（Go 代理：export GOPROXY=https://goproxy.cn,direct）
cd backend && go build -o /tmp/novacart-api ./cmd/api \
  && go vet ./... && go test ./...
GIN_MODE=release /tmp/novacart-api               # 空库自动 seed（固定种子 20260925：18 SKU/17 在架/2 零库存/52+ 评价/购物车 3 行）

# 前端（本机 npm 走 npmmirror；禁 npx）
cd ../web && npm ci --registry=https://registry.npmmirror.com
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vite/bin/vite.js build       # dist/ 产物 base:'./'
cd .. && node scripts/inline-preview.mjs         # → preview/{paper,vapor,crt}.html

# 冒烟（TOKEN 从环境传入）
ADMIN_TOKEN=$ADMIN_TOKEN BASE=http://127.0.0.1:8080 bash scripts/api-smoke.sh
# 单文件预览需要接口数据时：起静态服务注入 API 基址
node scripts/serve-static.mjs web/dist 8092 http://127.0.0.1:8080/api
# 三风格断言：浏览器打开 preview/x.html?theme=x 后 evaluate scripts/style-probe.js
```

## 6. 三种风格（同 DOM/JS，只换 CSS）

| 主张 | 底色 | 字体 | 圆角 | 语言特征 |
|---|---|---|---|---|
| paper 暖纸编辑排版 | 米色纸感 `#f5efe3` | Georgia/宋衬线 | 0 | § 前缀小标题、2px 墨线分隔、下划线式输入框 |
| vapor 蒸汽波 | 紫夜渐变 | 圆体无衬线 | 22px/999px | 霓虹粉 `#ff71ce` × 青 `#01cdfe`、渐变文字 KPI、perspective 网格地平线、发光阴影 |
| crt 终端绿字 CRT | `#020a04` 黑 | 全等宽 | 0 + double 边框 | 荧光绿 `#35ff6e`、全大写字母间距、repeating-linear 扫描线、`[btn]` 方括号、OK/XX/!! 前缀徽标 |

实测（`getComputedStyle` 两两对照）字体族、底色、圆角、字距、大小写处理、边框 6 项互异；三页各渲染 22 表行 / 3 购物车行；**页面零外链**。

## 7. 本轮踩坑（复现前先读）

1. **GORM 列名**：`Sold30`→`sold30`、`LeadMin`→`lead_min`，与 JSON 口径 `sold_30`/`lead_min_days` 不一致，SQL 直接 `no such column`。凡此类字段必须显式 `gorm:"column:..."`。
2. **SQLite SUM 空表返回 NULL**：聚合列一律 `COALESCE(SUM(...),0)`，否则 Scan 进 int64 报错或归零语义混乱。
3. **SKU 字符白名单**：注入串（含 `"` `\` `;`）长度合规也会被放行，校验不能只查长度；`AddToCartInput.Validate` 需 `skuSafeChars` 白名单（代码修复而非放宽测试预期）。
4. **浏览器 evaluate_script**：任何触发 React 重渲染的 `await` 脚本必 15s 超时（但已执行）。做法：动作与读取分离，取证改用 `curl /api/cart` 或 `take_snapshot`。
5. Vite ESM 产物在 `file://` 不执行 → 用 `inline-preview.mjs` 下标切片内联成单文件（带 JS 完整性断言，不用正则）。
6. 冒烟脚本会往运行库新增 SKU（total 18→19）：验证后需 `rm backend/data/app.db*` 重启实例还原，再生成 preview。二进制编到 /tmp，别留在场景目录里。
7. 本机网络：GitHub 只能 SSH，npm 用 npmmirror，Go 用 goproxy.cn。
