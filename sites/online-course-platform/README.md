# 学阶公开课 · 在线课程平台与招生看板（online-course-platform）

第 4 轮场景（2026-09-25）。Go/Gin + SQLite 后端，Vite + React 19 + TS strict 前端，
同一份 DOM / 同一份 JS 出 **3 种风格**：包豪斯原色（bauhaus）、报章密排（newsprint）、
航空仪表盘（instrument）。

## 1. 场景与角色

一家成人技能培训机构的「课程目录 + 招生看板 + 运营动作」后台：

- **访客（潜在学员）**：按领域/难度/关键字筛选在售课程，看满座率与早鸟价，点开详情看章节大纲、
  免费试看标记与「最近报名（脱敏）」样本，然后在报名表单里占座。名额已满时按钮自动变成
  **「进入候补」**，并在提交前就明说「候补不扣费」。
- **运营（管理侧）**：页头填 `ADMIN_TOKEN`，走三个写接口——报名占座、记录学习进度（100% 自动结课）、
  课程上下架状态机。校验失败逐字段回显。

口径要点（唯一事实源在后端，前端只做格式化）：

- 金额一律**人民币分整型**；`实付 = 标价 − 立减` 是硬恒等式，接口层与冒烟脚本都断言。
- **早鸟价**：`now < early_deadline + 24h` 才生效，展示「早鸟剩 N 天」＋划线标价。
- **老学员 95 折**：该手机号历史**已生效报名**（active/completed）≥ 3 条时，立减 = 标价 × 5%。
- **容量与候补**：占座人次 = active + completed；`occupied < capacity` 才成交并扣费，
  否则写入 `waitlist` 且 `paid_cents = 0`。整个判定在**一个事务内重读课程行**完成，杜绝超卖。
- **报名状态机**：`active →(进度 100%) completed`；对 `waitlist / completed / dropped` 再推进度一律 409。
- **课程状态机**：`draft →(published，写 published_at)→ published →(archived)`，其余迁移 409。
- **隐私**：`Enrollment.Phone` 的 json tag 是 `-`，全链路只对外暴露 `masked_phone`（`138****0001`）。

## 2. 目录结构

```
sites/online-course-platform/
├── backend/                 # Go/Gin + GORM + glebarez/sqlite（纯 Go，无 CGO）
│   ├── cmd/api/main.go      # env: DB_PATH / PORT / ADMIN_TOKEN / GIN_MODE / STATIC_DIR；-seed 幂等灌数
│   └── internal/
│       ├── domain/          # models.go query.go errors.go + 测试
│       ├── repository/      # db.go(WAL DSN+AutoMigrate) repo.go seed.go stats.go
│       ├── service/         # 定价/席位/状态机编排，派生字段在 Go 侧算
│       ├── handler/         # auth.go(401/403/503) errors.go(AppError→JSON) handlers.go
│       └── server/          # 路由、安全响应头、仅 localhost CORS、SPA 静态挂载（防穿越）
├── web/                     # Vite + React + TS strict（src/ + dist/ 产物 289 KB）
│   └── src/styles/theme-{bauhaus,newsprint,instrument}.css   # 三风格只换这里
├── preview/{bauhaus,newsprint,instrument}.html               # 单文件内联版，双击即开（file://）
├── scripts/
│   ├── api-smoke.sh         # 42 条逐接口断言（读接口口径 / 鉴权矩阵 / 校验边界 / 业务流）
│   ├── inline-preview.mjs   # dist → 单文件 preview（下标切片注入 + JS 完整性断言）
│   ├── serve-static.mjs     # 本机 http 托管并注入 __API_BASE__ / __THEME__
│   └── style-probe.js       # 浏览器 getComputedStyle 三风格互异探针
└── README.md
```

## 3. 数据表（4 张）

DSN：`?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)`，
库文件 `0600`，`SetMaxOpenConns(1)`（单写者模型）。AutoMigrate：`Instructor / Course / Chapter / Enrollment`。

| 表 | 关键字段 | 索引与约束 |
| --- | --- | --- |
| `instructors` | `name(32) title(32) org(64) bio(255) joined_at` | 主键 |
| `courses` | `code title(96) domain level instructor_id price_cents early_price_cents early_deadline capacity hours status summary published_at` | `code` 唯一(32)；`domain/level/status` 各建索引 |
| `chapters` | `course_id seq title(96) duration_min free_preview` | `course_id` 索引；seq 用于排序，首章标 `free_preview` |
| `enrollments` | `course_id phone(11) learner_name(32) status progress_pct list_price discount paid_cents source enrolled_at` | **复合唯一 `idx_course_phone(course_id, phone)`**（退课再报返回 409）；`status`、`enrolled_at` 索引 |

看板数据不落库，全部现算：`CourseRow` 的 `chapter_count / occupied / waitlisted / effective_price / fill_ratio`
由一条 JOIN + 相关子查询读出，`effective_price / early_now / seats_left / fill_pct` 由 service 按当前时间补算
（`gorm:"-"`）。统计口径见 `repository/stats.go`：GMV 只含 `status IN ('active','completed')` 的实付，
领域汇总用「先按课聚合再按领域分组」的子查询，避免 LEFT JOIN 把容量翻倍。

种子（`-seed`，`rand.NewSource(20260925)` 可复现，`HasData` 幂等）：6 位讲师、16 门课
（13 在售 / 2 草稿 / 1 已归档，其中 8 门早鸟仍在生效）、93 个章节、**506 条报名**
（在读 266 / 已结课 138 / 候补 59 / 已退课 43；前 6 门可售课故意按 `capacity+15` 灌到满座并留候补，
12 个复用手机号制造老学员 95 折样本）。实测看板：GMV ¥115,297.15（= 506 条里实付之和，与 SQL 交叉校验一致）、
付费学员 404、整体满座率 65%、结课率 34.2%、老学员让利 ¥388.85。

## 4. 接口（8 个）

读（无鉴权）：

| 方法 路径 | 说明 |
| --- | --- |
| `GET /api/health` | `{ok:true}`，供冒烟与托管探活 |
| `GET /api/stats` | 看板：10 项指标 + `by_domain[]` + `monthly[]`，`window` 说明口径 |
| `GET /api/courses` | 列表。参数 `domain level status q sort dir page page_size early`；`page_size` 钳到 ≤100，`sort` 走列白名单（`code title price hours capacity occupied fill published`），`q` 做 `%_\` 转义 + rune 截断 64 |
| `GET /api/courses/{code}` | 详情：课程 + 讲师 + 大纲 + 最近 12 条**脱敏**报名。`code` 先过 `^[A-Za-z0-9_-]+$` 白名单，不合规直接 404 |
| `GET /api/instructors` | 讲师榜（衍生主讲数/在售数/学员数） |

写（`/api/admin/*`，`Authorization: Bearer $ADMIN_TOKEN`）：

| 方法 路径 | 说明 |
| --- | --- |
| `POST /api/admin/enrollments` | 报名/候补。201 返回脱敏行 + `message`；`{course_code,name,phone,source}` 逐字段校验（手机号 `^1[3-9]\d{9}$`、姓名 ≤32 rune、source ∈ official/referral/campus/ad）；不可售 409、重复报名 409 |
| `POST /api/admin/enrollments/{id}/progress` | `{progress_pct:0..100}`，100 自动结课；非 active 409 |
| `POST /api/admin/courses/{code}/status` | `{to:"published"\|"archived"}`，非法迁移 409 |

鉴权三态（`handler/auth.go`，常量时间比较）：服务端未配 `ADMIN_TOKEN` → **503 fail-closed**；
缺头或非 Bearer → 401；令牌不符 → 403。错误统一 `domain.AppError` → JSON `{error:{code,message,fields?}}`，
对外**绝不回显 `err.Error()`**。

## 5. 复现步骤

```bash
LAB=/Users/apple/Documents/workProject/试验/业务网站实验室
S=$LAB/sites/online-course-platform

# 1) 后端：编译 + 静态检查 + 单测（3 个表驱动测试文件，58 个用例）
cd $S/backend && go build ./... && go vet ./... && go test ./... -count=1
#   国内网络：export GOPROXY=https://goproxy.cn,direct

# 2) 起服务（二进制放 /tmp，避免 38 MB 撑大场景目录）
cd $S/backend && go build -o /tmp/ocs-api ./cmd/api
GIN_MODE=release ADMIN_TOKEN=dev-admin-token-2026 PORT=8093 \
  DB_PATH=/tmp/ocs-smoke.db /tmp/ocs-api -seed     # 前台跑，Ctrl-C 停

# 3) 接口冒烟（会写库，跑完必须重置库再生成 preview）
BASE=http://127.0.0.1:8093/api TOKEN=dev-admin-token-2026 bash $S/scripts/api-smoke.sh
#   期望末行：pass=42 fail=0

# 4) 前端：装依赖 + 类型检查 + 构建（禁用 npx，直接走 node_modules/.bin）
cd $S/web && npm ci --registry=https://registry.npmmirror.com
./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build

# 5) 单文件成品（JS/CSS 全内联，file:// 双击可开；--  数据仍需后端在跑）
cd $S && node scripts/inline-preview.mjs web http://127.0.0.1:8093/api
#   → preview/{bauhaus,newsprint,instrument}.html 各 281 KB

# 6) 本机 http 托管 preview（顺带注入 __API_BASE__，供浏览器断言用）
node scripts/serve-static.mjs preview 8092 http://127.0.0.1:8093/api
open http://127.0.0.1:8092/bauhaus.html
```

## 6. 三风格主张与实测断言

三套 CSS 由 `web/src/themes.tsx` 以 `?raw` 导入、注入同一个 `<style data-theme-css>`，
切换只改 `data-theme`——**DOM 与 JS 完全同一份**（实测三页 `rows=41 / kpis=10 / MRR ¥11.5万` 一致，
外链数 0，内联 `<script>` 3 个、`<style>` 1 个）。

| 主张 | bauhaus 包豪斯原色 | newsprint 报章密排 | instrument 航空仪表盘 |
| --- | --- | --- | --- |
| 底色 | 纸米 `#f4efe3` + 纯白面板 | 新闻纸 `#fffdf6` | 机身深灰 `rgb(12,16,19)` |
| 字体族（shell） | Futura / Avenir Next 无衬线，字重 900 | Songti SC / Noto Serif SC 衬线，12.5px 密排 | Avenir Next + 等宽读数 |
| KPI 卡 | `radius 0`、2px 实描边、硬投影 `3px 3px 0 #101014`、色块底 `rgb(242,183,5)` | 无底无描边无投影，靠 3px 双栏线分组 | `radius 50% 38%` 仪表形、内斜角 `inset` 多层投影 |
| 标签 | uppercase + 字距 1.4px | 无 uppercase、字距 1.4px | uppercase + 字距 **1.9px** |
| 数值主色 | 墨黑 `rgb(16,16,20)` 26px/900 | 报红 `rgb(163,34,27)` 20px/700 | 琥珀读数 + 光晕 text-shadow |
| 按钮 | 2px 描边、padding-top 7px | 1px 描边、padding-top 3px | 胶囊 `radius 999px` + 铆钉渐变 |
| 表头 | `rgb(243,241,231)` 实底 | 透明底 + 点状细分隔线 | 深色金属渐变 |
| 徽章 | 直角 + 字距 0.8px | 直角 + 字距 normal | 胶囊 + 单色等宽 |

两两互异项 ≥ 6（字体族、底色、圆角、阴影、字距、描边宽度、内边距、表头处理），
远超「至少 3 项」门槛；断言值即上表，来自浏览器 `getComputedStyle` 实读。

## 7. 本轮踩到并写回的坑

1. **SQLite 不能在同一 select 列表里引用别的别名**：`fill_ratio` 想用 `occupied` 别名 →
   `SQL logic error: no such column: occupied`，且只在 `CourseRowByCode`（报名路径）触发 500。
   改法：把占座数在 `fill_ratio` 里写成**重复的相关子查询**，别名只给外层用。
2. **领域汇总翻倍**：`SUM(e.paid_cents)` 与 `COUNT(chapter)` 在同一 LEFT JOIN 里互相放大；
   且 `payingFilter` 里的 `e.` 前缀与 JOIN 的别名冲突。改法：先按课聚合成子查询，再按领域分组。
3. **种子必须真造出满座课**：`targets[i] = capacity + 15` 才留得出 waitlist（预留余量对冲 10% 退课），
   否则「满座转候补」这条核心断言永远走不到 active 分支。
4. **`pct(part, whole)` 用 `int(part*100/whole + 0.5)` 会因浮点截断偏 1**，改成整数
   `int((part*100 + whole/2) / whole)`。
5. **冒烟脚本自身两个 harness 坑**（比业务 bug 更坑，因为会误报）：
   `jget` 里 `eval('d$1')` 展开成 `eval('d['x']')` → Python 语法错，必须写 `eval("d$1")`；
   `chk 名称 期望 "$(req ...; jget ...)"` 会把 `req` 打印的状态码和字段值拼成 `20014`，
   取字段前先 `>/dev/null` 吞掉 `req` 的 stdout。
6. **zsh `nomatch`**：`rm -f x.db*` 在无匹配时直接让整条 `&&` 链退出，服务根本没起（所有 curl 000）。
   重置库要显式列三个文件：`rm -f ocs-smoke.db ocs-smoke.db-wal ocs-smoke.db-shm`。
7. **浏览器探针**：带无限 CSS 动画的主题（instrument）下，一次 `evaluate_script` 里放 7 组
   `getComputedStyle` 会 15 s 超时（主线程被合成占住，脚本其实执行了）。改法：导航重载后**一次只取一小批**，
   并且函数体里不要出现 `'\n'` 字面量（经 MCP 传参会被解码成真换行 → `SyntaxError`），拼接用 `' | '`。
