# 知衡测评台 · 在线测评业务后台（online-assessment-exam）

第 6 轮业务网站实验室产物。场景：**一个面向企业/培训机构的在线测评业务后台**——教研组出卷发布、考生限时作答、
后端唯一判分引擎落成绩、教务看台账与区分度、审计核对成绩口径。

技术基线：Go 1.27 + Gin 1.12 + GORM 1.31 + 纯 Go SQLite 驱动（`glebarez/sqlite`，无 CGO）；
前端 Vite 8.3.1 + React 19.3 + TypeScript 5.9.3（strict）。
**同一份 DOM、同一份 JS，三套 CSS 主题**（`data-theme` 切换），页面零外链。

## 1. 角色与业务闭环

| 角色 | 能做什么 | 走哪些接口 |
| --- | --- | --- |
| 教研组（管理员） | 发布/收卷、开考放行 | `POST /api/assessments/:code/status` |
| 考生 | 限时取卷作答、交卷拿成绩条 | `POST .../attempts`、`POST /api/attempts/:no/submit` |
| 教务 / HR | 场次台账、名单、名次、通过率 | `GET /api/assessments*`、`GET .../attempts` |
| 审计 | 三分数恒等式体检、题目区分度 | `GET /api/stats`、`GET .../statistics` |

业务口径上刻意保留的三条「真实感」约束：

1. **名次只在同场已判分集合里有意义**——跨场次分数不可直接比，所以榜单先各自换算百分制再排（`top_board`），
   场内名次（`rank_no`）另算，两者语义不同，页面上分开呈现。
2. **作答分布只对已收卷（closed）场次公布**。把「哪个错误选项最多人挑」摊给还没交卷的人看等于泄题，
   所以 `ItemStat.revealed=false` 时 `distractors` 直接不下发。
3. **超时不是 0 分而是作废**：`duration_min + 120s` 之外交卷 → `status=invalid`，不占名次、不记成绩，
   但同手机号可以重考（部分唯一索引 `WHERE status <> 'invalid'` 放行）。

## 2. 数据模型

四张表，GORM `AutoMigrate` 建表后补一条部分唯一索引（AutoMigrate 表达不了）：

```sql
CREATE TABLE `assessments` (`id` integer PRIMARY KEY AUTOINCREMENT,`code` text,`title` text,`subject` text,
  `kind` text,`duration_min` integer,`pass_score` integer,`status` text,`opens_at` datetime,
  `closes_at` datetime,`intro` text,`created_at` datetime);
CREATE TABLE `questions` (`id` integer PRIMARY KEY AUTOINCREMENT,`assessment_id` integer,`code` text,
  `order_no` integer,`type` text,`stem` text,`options` text,`answer` text,`score` integer);
CREATE TABLE `attempts` (`id` integer PRIMARY KEY AUTOINCREMENT,`attempt_no` text,`assessment_id` integer,
  `candidate_name` text,`phone` text,`channel` text,`started_at` datetime,`submitted_at` datetime,
  `elapsed_sec` integer,`status` text,`score` integer,`mechanical` integer,`half_credit` integer,
  `passed` numeric,`reason` text,`graded_at` datetime);
CREATE TABLE `attempt_answers` (`id` integer PRIMARY KEY AUTOINCREMENT,`attempt_id` integer,`question_id` integer,
  `question_code` text,`picked` text,`correct` integer,`awarded` integer,`max_score` integer);

CREATE UNIQUE INDEX `idx_assessments_code` ON `assessments`(`code`);
CREATE UNIQUE INDEX `idx_questions_code` ON `questions`(`code`);
CREATE UNIQUE INDEX `idx_attempts_attempt_no` ON `attempts`(`attempt_no`);
CREATE INDEX `idx_attempts_assessment_id` ON `attempts`(`assessment_id`);
-- 一个手机号在同一场只能有一份「有效」作答；作废卷不占位，允许重考
CREATE UNIQUE INDEX idx_attempts_active_phone ON attempts(assessment_id, phone) WHERE status <> 'invalid';
```

状态机（唯一真源 `domain.CanMoveAssessment`）：

```
assessments: draft → open → closed（终态，非法跳转 409 invalid_transition）
attempts   : ongoing → graded | invalid（交卷一次性，重复提交 409 already_submitted）
```

### 判分引擎（后端唯一一处，种子与线上共用）

| 题型 | 判定 | 得分 |
| --- | --- | --- |
| single / judge | 选项字母相等；判断题 `t/true/对/1` → `T` | 满分或 0 |
| multi | 全对＝满分；**漏选且不含错选项＝半分**；含任一错选项＝0 | `score` / `score/2` / 0 |
| blank | rune 级 trim + 小写后比较 | 满分或 0 |
| 未作答 | `picked=''` | 0，但仍计入 `answered` 与分布 |

由此恒等式天然成立，并作为接口体检字段实时公布：

```
attempts.score == attempts.mechanical + attempts.half_credit == Σ attempt_answers.awarded
→ /api/stats: {"identity_ok": true, "identity_violations": 0}
```

统计层**绝不做第二次判分**：题目区分度、得分率全部从 `attempt_answers` 聚合而来，
即「线上判分引擎写下的事实」，避免两套口径漂移。

### 隐私边界

* `Attempt.Phone` 带 `json:"-"`，原文不出仓储层；出口一律 `masked_phone`（`139****1111`）。
* `Question.Answer` / `Options` 原始列同为 `json:"-"`，对外只有 `QuestionView{code,order_no,type,stem,options,score}`。
* 有一条 Go 测试把「标准答案原文」和「手机号原文」直接读出来，再逐个接口断言这些串**绝不出现**在响应里。

## 3. 接口清单

读接口无需鉴权；写接口全部过 `AdminAuth`（`Authorization: Bearer $ADMIN_TOKEN`）。

| 方法 | 路径 | 鉴权 | 参数 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | — | — | `{status,time}` |
| GET | `/api/stats` | — | `?assessment=CODE`（省略=全局） | `Stats`（含 `identity_ok/buckets/subjects/daily/hardest_items/top_board`） |
| GET | `/api/assessments` | — | `status,subject,kind,q,sort,dir,page,page_size` | `{items,total,page,page_size,sort,dir,filters,subjects}` |
| GET | `/api/assessments/:code` | — | — | `{assessment,questions}` |
| GET | `/api/assessments/:code/statistics` | — | — | `{assessment,items,stats}` |
| GET | `/api/assessments/:code/attempts` | — | `status,channel,passed,sort,dir,page,page_size` | `{items,total,page,page_size,sort,dir,filters}` |
| GET | `/api/attempts/:no` | — | — | `{attempt,items}`（成绩条逐题） |
| POST | `/api/assessments/:code/attempts` | ✅ | body `{name,phone,channel}` | 201 `{attempt,questions,total_score}` |
| POST | `/api/attempts/:no/submit` | ✅ | body `{answers:[{question_code,picked}]}` | `{attempt,items,message}` |
| POST | `/api/assessments/:code/status` | ✅ | body `{to}` | `{assessment,served_at}` |

排序白名单：场次 `code,title,opens_at,closes_at,attempts,passed,avg,total_score,id`；
名单 `score,elapsed,started,submitted,rank,candidate,status,id`。未命中即回落默认并**在响应里回显实际生效列**。

错误体统一 `{code,message,fields?,trace_id?}`；写入口参数校验失败返回 400 且 `fields` 点名到具体字段
（如 `answers[3].question_code`）。对外**绝不回显 `err.Error()`**，内部错误只给「服务内部错误，请稍后重试」。

## 4. 安全与健壮性设计（本轮实测过）

* **鉴权三层 fail-closed**：服务端未配 `ADMIN_TOKEN` → 503（绝不因「期望值为空」放行）；
  缺 / 非 `Bearer` 方案 / 只有前缀 → 401；令牌不符 → 403（`crypto/subtle` 常量时间比较）。
* **SQL 注入**：排序列与枚举走白名单 map；搜索串 `escapeLike` 转义 `% _ \` 并配 `ESCAPE '\'`；
  `:code` / `:no` 走字符白名单（`[^A-Za-z0-9_-]` 直接 400）；`page`/`page_size` 数值钳位（上限 100，页码上限 10 万）；
  搜索串按 rune 截断到 48；`q='; DROP TABLE attempts;`、`q=' OR 1=1--`、`..%2f..%2fetc%2fpasswd` 均实测无效果。
* **请求体**：`io.LimitReader` 16KB，超限/空体/类型不符一律 400，不进 JSON 解析器；`answers` 上限 100 条、
  单题作答 64 rune、重复题码点名报错。
* **SQLite 单写者**：`SetMaxOpenConns(1)` + DSN `txlock(immediate)` + `journal_mode(WAL)` + `busy_timeout(5000)`
  + `foreign_keys(1)`；事务内只用 `tx`，`db` 文件与 `-wal/-shm` 落盘即 `chmod 0600`。
* **并发发号**：`attempt_no` 在事务内按「本场已有份数 + 1」生成，冲突最多重算 5 次后 409。
* **静态托管**：`STATIC_DIR` 命中文件发文件，否则回 `index.html`；路径先 `filepath.Clean("/"+path)` 再判前缀，
  `/api/*` 未匹配一律走 `json404`，避免 Gin 纯文本 404 打断前端 `JSON.parse`。
* **CORS**：只放行 localhost/127.0.x 私域，`Allowed-Headers` 含 `Authorization`；另加 `securityHeaders()`
  与 8s `requestTimeout`。

## 5. 从零重建

```bash
# 变量（本机 zsh）
LAB="/Users/apple/Documents/workProject/试验/业务网站实验室"
SITE="$LAB/sites/online-assessment-exam"
export GOPROXY=https://goproxy.cn,direct           # 直连 golang.org 会超时
NPM_REGISTRY=https://registry.npmmirror.com        # npm 官方源在本机不通

# 1) 后端：编译 + 静态检查 + 单测（80 个用例，含 34 个 Test 函数）
cd "$SITE/backend"
go build ./... && go vet ./... && go test ./... -count=1

# 2) 起服务（-seed 灌一次种子，重复启动不会覆盖已有数据）
ADMIN_TOKEN=demo-admin-token go run ./cmd/api -db /tmp/oae.db -addr 127.0.0.1:8080
curl -s localhost:8080/api/stats | head -c 200

# 3) 逐接口冒烟（154 项断言：状态码 / 口径 / 授权矩阵 / 注入与超量边界）
#    ⚠️ 必须跑在刚灌完种子的临时库上：脚本第 6 节会把 AS-2026-006 从 draft 真实迁移到 closed（终态）
rm -f /tmp/oae-smoke.db && \
  (ADMIN_TOKEN=smoke-token go run ./cmd/api -db /tmp/oae-smoke.db -addr 127.0.0.1:18091 &) && \
  (ADMIN_TOKEN=      go run ./cmd/api -db /tmp/oae-nt.db    -addr 127.0.0.1:18092 &)
cd "$SITE" && BASE=http://127.0.0.1:18091/api TOKEN=smoke-token \
  NO_TOKEN_BASE=http://127.0.0.1:18092/api bash scripts/api-smoke.sh

# 4) 前端：装依赖 + 类型检查 + 构建（禁用 npx，直接走本地 bin）
cd "$SITE/web"
npm install --registry=$NPM_REGISTRY
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build            # 产物 web/dist/{index.html,assets/app.js}

# 5) 单文件预览（JS/CSS 全部内联，file:// 双击可开，默认打 http://127.0.0.1:8080/api）
cd "$SITE" && node scripts/inline-preview.mjs web http://127.0.0.1:8080/api

# 6) 三风格计算样式断言（探针在浏览器里跑，比较交给脚本）
node scripts/serve-static.mjs preview 8125 http://127.0.0.1:8080/api
#   → 逐个打开 http://127.0.0.1:8125/{glass,construct,journal}.html
#   → 用 browser-use evaluate_script 执行 scripts/style-probe.js，把三份 JSON 落盘后：
python3 scripts/style-diff.py probe-glass.json probe-construct.json probe-journal.json
```

## 6. 三种风格（同一 DOM、同一 JS，只有 CSS 不同）

| 主题 | 主张 | 关键手法 |
| --- | --- | --- |
| `glass` 苹果玻璃拟态 | 系统级克制的控制台：信息密度高但呼吸感足，靠**透明度层级**区分卡片/表头/输入 | 渐变网底 + `backdrop-filter: saturate(1.8) blur(18px)`、`--radius:22px` / `--pill:999px`、1px 白描边、大柔影、强调色 `#0a7cff`、SF 系字体栈 |
| `construct` 构成主义海报 | 把台账当宣传海报排：**直角、粗黑边、硬投影**，零圆角零模糊 | 红 `#d0221c` / 墨 `#17130f` / 米 `#efe7d8` 三色 + 斜纹底、`6px 6px 0` 硬投影、`border:3px solid`、标题 `uppercase` + `letter-spacing:.2em`、Impact/Haettenschweiler 数字塔 |
| `journal` 手账纸质拼贴 | 教务手写记录本：允许**不精确**，用不完美传达「人记的」 | 米黄格纸底、`2px dashed` 虚线框、和纸胶带 `::before`、卡片 ±0.2~1° 旋转、楷体/手书字族（Xingkai/Hannotate）、荧光笔 `linear-gradient(transparent 55%, …)` 高亮、内阴影选中行 |

三套 CSS 各约 1100–1300 行，全部自带完整规则（不做 `@import` 叠加），`data-theme` 一个属性决定生效者。
`.kpi` / `.table th` / `.btn` / `.input` / `.badge` 等钩子类三套都实现了。

**实测互斥性**（`scripts/style-diff.py`，比较 37 个计算属性）：

| 对比 | 不同属性数 | 采样差异 |
| --- | --- | --- |
| construct vs glass | **31 / 37** | 圆角 0px↔22px、`backdrop-filter` none↔saturate+blur、列间距 3px↔12px、字距 2px↔0.92px |
| construct vs journal | **30 / 37** | 表头 `uppercase`↔`none`、表头字号 10px↔15px、边框 none↔solid、标题字族 Impact↔楷体 |
| glass vs journal | **28 / 37** | 按钮边框 solid↔**dashed**、圆角 999px↔12px、值字族 SF↔Xingkai、柔影↔双层纸影 |

三方完全相同的只有 4 个结构性属性（`label.fontStyle`、`head/input/badge.borderTopStyle`），符合预期；
同时 `kpiCount=10`、`rowCount=20`、主题按钮 `swatches=3`、`external=[]` 三主题完全一致
——**证明是同一份 DOM/JS，只换了 CSS**。

## 7. 数据规模（后端种子，`seedSource=20260925` 固定随机源，可复现）

6 场测评 / 62 道题 / 181 份作答（167 已判分、4 进行中、10 超时作废）/ 84 份达线，
通过率 50.3%、平均得分率 59.9%，已判分总分 10,006 = 机械分 9,560 + 漏选半分 446，`identity_violations=0`。
每场满分刻意都是 100（`seedAll` 会校验，不为 100 直接报错退出），百分制排行才有意义。
前端页面**不硬编码任何假数据**，所有数字来自上表接口的真实查询。

## 8. 本轮踩坑与结论

1. **默认排序能把整页打成 500**（真 bug，冒烟测试抓到）：名单默认序配成 `sc.score`，而排名子查询 `sc` 只
   `SELECT id, rank_no` —— SQLite 规划期就 `no such column`。已改为 `a.score`，并补
   `TestAttemptListEverySortColumnResolves`：逐个排序键（含非法键）都必须 200。
   教训：**白名单 map 的值是裸 SQL 片段时，它引用的别名必须由测试真实跑一遍**，看代码看不出来。
2. `go test` 全绿≠接口可用：既有测试都显式传 `sort=rank`，恰好绕开了默认序。冒烟脚本必须包含
   「不带任何参数的裸路径」用例，才能覆盖默认分支。
3. 三风格断言要区分两类指标：**互斥性**（每对 ≥3 项不同）与**同构性**（`kpiCount/rowCount/swatches` 必须完全相同）。
   只看前者会漏掉「偷偷复制了三份组件」这种违规。
4. 工具坑（已回写全局记忆）：
   * `Write` 对只做过局部 `Read` 的文件会拒绝覆盖 → 先 `rm -f` 再 Write。
   * zsh 下 `rm -f app.db*` 在无匹配时直接 `no matches found` 中断脚本 → 显式列文件名。
   * `bash -n` 不报但运行期炸的坑：`"$(... echo True")"` 里嵌套双引号会让 `"` 提前闭合；
     以及 python 表达式经 `sys.argv` 注入后 `<=` 与 `|` 的优先级差异 —— 断言表达式统一加括号。
   * browser-use `evaluate_script` 返回值过长会 15s 超时（不是页面卡死）：探针刻意限制在 37 个属性，
     且「动作」与「读取」必须拆成两次调用。
5. `ItemStat.distractors` 在 open 场次是 `omitempty` → 键**整个不存在**，前端与断言都得用 `.get()`，
   否则 `KeyError` 会伪装成「分布没隐藏成功」。

## 9. 目录

```
backend/   cmd/api + internal/{domain,repository,service,handler,server}（34 个 Test 函数 / 80 个用例）
web/       src/{App.tsx,api.ts,types.ts,format.ts,themes.tsx,useAsync.ts} + styles/theme-{glass,construct,journal}.css
web/dist/  vite 产物（index.html + assets/app.js，单包、零外链）
preview/   {glass,construct,journal}.html —— 各自内联全部 JS/CSS 的单文件成品
scripts/   api-smoke.sh（154 项断言）· inline-preview.mjs · serve-static.mjs · style-probe.js · style-diff.py
```
