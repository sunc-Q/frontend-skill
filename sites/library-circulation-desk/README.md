# 苍岚图书馆 · 流通工作台（library-circulation-desk）

Go/Gin + SQLite 后端、Vite + React + TS 前端的业务网站样例。同一套页面渲染成三种互斥视觉风格。

## 场景与角色

苍岚图书馆是一个社区分馆，只有一张流通台。值班馆员一天要处理四类事：

| 角色 | 关心的事 | 落在哪个模块 |
| --- | --- | --- |
| 值班馆员 | 借出登记（扫条码 + 输证号，门槛要当场拦住）、办理归还（逾期费当场结算并留档） | 流通台 / 借阅台账 + 详情面板 |
| 馆长 | 今天借了多少、还有多少册在架、逾期未缴累计多少、库存恒等式是否成立 | 流通指标（KPI + 自检徽标） |
| 采编馆员 | 书目与复本：每种书几册、哪册在架哪册在借、按类别的馆藏结构 | 馆藏目录 + 复本与在借人 |
| 前台查询 | 某位读者现在借了什么、欠多少、配额还剩几册（手机号只给脱敏值） | 读者查询 |

业务口径（唯一算法在 `internal/domain`，前后端都不另算一套）：

- 借期与费率随书别：普通书 28 天 / 50 分每天 / 单册封顶 20 元；大字本 42 天 / 30 分 / 12 元；盒装 14 天 / 100 分 / 40 元；参考工具书不外借。
- 续借：最多 2 次，按书别续借天数（14/21/7）顺延应还日；逾期或次数用尽即拒。
- 逾期费 = `min(逾期天数 × 每天费率, 单册封顶)`，**只在归还瞬间结算一次**并写进 `loans.fine_cents`，之后不再随时间重算（快照不回溯）。
- 未缴逾期费累计 ≥ 30 元即停借（`FineGateCents`）。
- 配额随证别：普通 8 册 / 家庭 12 册 / 学生 5 册。

## 数据模型

四张表，副本状态与借阅状态互为镜像（恒等式在 `/api/stats` 里自检）。真实 DDL 由 GORM `AutoMigrate` 产出：

```sql
CREATE TABLE `items` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`title` text,`author` text,
  `publisher` text,`pub_year` integer,`category` text,`loan_days` integer,`added_at` datetime);
CREATE UNIQUE INDEX `idx_items_code` ON `items`(`code`);
CREATE INDEX `idx_items_category` ON `items`(`category`);

CREATE TABLE `copies` (`id` integer PRIMARY KEY AUTOINCREMENT,`item_id` integer,`barcode` text,
  `location` text,`condition` text,`status` text,`acquired_at` datetime);
CREATE UNIQUE INDEX `idx_copies_barcode` ON `copies`(`barcode`);
CREATE INDEX `idx_copies_item_id` ON `copies`(`item_id`);
CREATE INDEX `idx_copies_status` ON `copies`(`status`);

CREATE TABLE `members` (`id` integer PRIMARY KEY AUTOINCREMENT,`card_no` text,`name` text,`phone` text,
  `member_type` text,`status` text,`joined_at` datetime,`suspended_at` datetime);
CREATE UNIQUE INDEX `idx_members_card_no` ON `members`(`card_no`);
CREATE INDEX `idx_members_status` ON `members`(`status`);

CREATE TABLE `loans` (`id` integer PRIMARY KEY AUTOINCREMENT,`copy_id` integer,`member_id` integer,
  `status` text,`borrowed_at` datetime,`due_at` datetime,`returned_at` datetime,
  `renew_count` integer,`fine_cents` integer,`fine_paid` numeric);
CREATE INDEX `idx_loans_copy_id` ON `loans`(`copy_id`);
CREATE INDEX `idx_loans_member_id` ON `loans`(`member_id`);
CREATE INDEX `idx_loans_status` ON `loans`(`status`);
CREATE INDEX `idx_loans_due_at` ON `loans`(`due_at`);
```

枚举：`copies.status ∈ {available, on_loan, missing, retired}`；`loans.status ∈ {active, returned}`（逾期是 `active && due_at < now` 的派生态，不单独存一行）；`members.status ∈ {active, suspended}`。

种子数据：20 种书目 / 40 册复本 / 12 位读者 / 220+ 条历史借阅（含 13 条逾期在借、若干已产生逾期费的归还单）。

## 接口清单

读接口无鉴权（这是给馆内大屏看的公开口径），写接口全部经 `AdminAuth(ADMIN_TOKEN)`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 存活探针，返回 UTC 时间 |
| GET | `/api/stats?days=3..30` | KPI、连续日历趋势、类别馆藏结构、恒等式自检 |
| GET | `/api/items` | 书目分页；筛选 `q/category/status`；排序 `code,title,author,year,category,added,available,total,id`；`page_size ≤ 100` |
| GET | `/api/items/:code` | 书目详情 + 全部复本（含在借人） |
| GET | `/api/loans` | 借阅台账；筛选 `status/category/q`（跨表检索读者/证号/书名/条码）；排序 `due,borrowed,returned,member,item,barcode,fine,renew,status,id` |
| GET | `/api/loans/:id` | 借阅详情：`fine_due`（未还时的实时预估）与 `fine_cents`（归还快照）并列给出 |
| GET | `/api/members/:card` | 读者档案：配额、在借/逾期数、未缴欠费、最近借阅；手机号只回 `phone_masked` |
| POST | `/api/admin/borrow` | 借出 `{barcode, card_no}` → 201 |
| POST | `/api/admin/loans/:id/renew` | 续借，应还日顺延 |
| POST | `/api/admin/loans/:id/return` | 归还 `{paid}` → 结算并冻结逾期费快照 |

鉴权三层（写接口）：服务端未配 `ADMIN_TOKEN` → 503 `server_misconfigured`（fail-closed，绝不因期望值为空而放行）；缺 `Authorization` 或非 `Bearer <token>` 形式 → 401；令牌不符 → 403（`subtle.ConstantTimeCompare`，`Bearer` 方案名按 RFC 7235 大小写不敏感）。

对外错误只走 `domain.AppError` → `AbortWithError`，响应体只有 `{code, message}`，不回显 `err.Error()`、SQL、goroutine 栈或源码路径。

## 重建与运行

```bash
# 依赖镜像（本机已验证可用）
go env -w GOPROXY=https://goproxy.cn,direct     # 或 export GOFLAGS=-mod=mod
cd web && npm i --registry=https://registry.npmmirror.com   # npx 在本机不可用，下面一律走 ./node_modules/.bin

# 后端：Go 1.x + gin + glebarez/sqlite（纯 Go，无需 CGO）
cd ../backend && go build -o /tmp/lcd-build/api ./cmd/api
ADMIN_TOKEN=<本地演示令牌，只走环境> STATIC_DIR=../web/dist \
  /tmp/lcd-build/api -db /tmp/lcd-run/api.db -addr :18401      # 不带 ADMIN_TOKEN 即 503 实例

# 前端
cd ../web && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build
cd .. && node scripts/inline-preview.mjs web http://127.0.0.1:18401/api   # → preview/{lego,riso,decon}.html
node scripts/serve-static.mjs preview 18409 http://127.0.0.1:18401/api    # 单文件预览版的 http 托管（file:// 拿不到接口）
```

端口约定：`:18401` 带令牌主实例、`:18402` 不带令牌（503 断言）、`:18409` 静态预览。

## 校验（全部要求 exit 0）

```bash
cd backend && gofmt -l . && go vet ./... && go test -count=1 ./...
ADMIN_TOKEN=<本地演示令牌> bash scripts/run-smoke.sh   # 在全新种子库上起双实例跑 api-smoke.sh，末行 pass=212 fail=0
node scripts/style-shoot.mjs 'http://127.0.0.1:18401/?theme={theme}' evidence/style-probe.json /tmp/lcd-shot-
python3 scripts/style-diff.py evidence/style-probe.json              # 末行「失败项：0」
BASE=http://127.0.0.1:18401 PAGE=http://127.0.0.1:18409/lego.html \
  ADMIN_TOKEN=… BARCODE=… CARD=… node scripts/ui-check.mjs           # 末行 pass=19 fail=0
```

- `scripts/probe-samples.py`：测试样本一律从接口反查（条码/证号/借阅 ID），不许猜；输出可 `eval` 的 `KEY="value"`。
- `scripts/check-read-invariants.py`：只读不变量取证——排序白名单 20 组合 × 双向、逾期单 `fine_due == min(天数×费率, 封顶)`、归还单快照二次读取相等、`by_category` 合计 == `total_copies`、35 类响应里绝不出现裸 `phone` 键。
- `scripts/api-smoke.sh`：真监听端口 + 真 curl，覆盖鉴权三层、状态机非法跃迁、注入与超长边界、写后恒等式复验。样本枯竭时（同一库反复写跑）提示改用 `run-smoke.sh`。
- `scripts/ui-check.mjs`：真浏览器点一遍「借出 → 归还」，并核对接口侧的在借数、复本状态、归还快照。

`evidence/` 存最近一次的实测输出。

## 三风格宣言（同一 DOM + 同一 JS，只换 CSS）

结构层 `web/src/styles/base.css` 只允许出现 `var(--token)`，一个具体颜色都不写；三套 token 文件各 84 个变量，由 `scripts/derive-themes.py` 拼成 `theme-*.css`——缺一个 token 或 base.css 里漏了个硬编码颜色，脚本直接失败。

1. **乐高积木块面 `lego`** —— 浅灰底板上的原色颗粒。3px 纯黑轮廓 + `0 6px 0` 硬底阴影把每块面板顶成一块砖，KPI 卡顶面用径向渐变打「凸点」；圆角 14px，按钮是可按下去的。它主张：工作台是拼搭出来的，每块信息都有厚度。
2. **Risograph 孔版印刷 `riso`** —— 奶油纸底 + 荧光粉叠湖蓝。所有边框 2px 实线、分隔线改虚线，阴影是「套色错位」的偏移色块，标题带轻微 `rotate(-1.2deg)` 与文字错影。它主张：这是油印机压出来的馆内通告，颜色天生对不齐。
3. **解构主义拼版 `decon`** —— 深灰纸片上的酸性荧光绿。衬线标题压无衬线正文，标签小写斜体，区块边界被撕开（`border-left` + 负 `margin-left` 让标题越出栏），复本行随机 `rotate(±0.6deg)`。它主张：目录不是整齐的，是被翻旧了的。

`getComputedStyle` 实测：两两之间 47–53 项互异（字体族、底色、边框宽度/样式/颜色、圆角、阴影、字距、transform、渐变），同时行数/KPI 数/徽标数/内联样式表数/外链数三主题全等，零外链、零 console 错误。

## 坑（都踩过）

- **`LEFT JOIN loans` 会把复本数放大**：类别汇总里 `COUNT(c.id)` 按历史借阅成倍膨胀（实测 237 vs 真实 40）。复本数与在借数必须各自先聚合再回接书目。
- **趋势图不能只画有流水的日子**：`GROUP BY day` 出来的稀疏序列会让「近两周」在空白天误导读者，必须按 `days` 生成连续日历再填零。
- **`identity_issues` 要序列化成 `[]` 而不是 `null`**：前端 `map` 会炸；Go 里 `nil` slice 输出 `null`，初始化成 `[]string{}`。
- **SQLite 的 `-wal/-shm` 要到首次写入才出现**：只在 `Open()` 里 chmod 会漏掉它们，`Seed()` 之后必须再压一遍 0600（见 `repository.Harden`）。
- **逾期优先于「续借次数用尽」**：两个 409 门槛同时成立时先报 `overdue_no_renew`，否则一条逾期单只会得到「次数已用尽」这种没用的答复。
- **`Bearer` 方案名大小写不敏感**：`bearer <tok>` 是合法的（RFC 7235），实现用 `strings.EqualFold`。冒烟脚本一开始按 401 断言，结果真的借出去一本书，把后面一整串断言全带偏——鉴权探针要用不会写库的路径（不存在的借阅单 → 404 才算穿过鉴权）。
- **bash 3.2（macOS 自带）解析不了 `$( ... <<'PY' ... PY)`**：双引号里的命令替换套 heredoc 直接语法错。把 Python 落成真实脚本文件，既绕过解析问题又能单独复跑。
- **`body_of`/`status_of` 要同时支持位置参数和管道**：`req … | body_of | jget …` 写法在 `set -u` 下会因 `$1` 未绑定而中断。
- **写型冒烟不可重放**：借出去不还，同一库第二轮就会「把在架借空而没借满配额」，配额断言变误报。所以有 `run-smoke.sh` 每轮起全新 /tmp 库。
- **`preview/*.html` 双击打不开数据**：`file://` 的 `Origin: null` 被 CORS 明确拒绝（放行等于对所有本地程序开门），要用 `serve-static.mjs` 在同机 http 下打开。
