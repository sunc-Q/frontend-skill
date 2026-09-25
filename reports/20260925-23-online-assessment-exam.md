# 20260925-23 · online-assessment-exam（知衡测评台 · 在线测评业务后台）

- **时间**：2026-09-25 22:30 ~ 23:50（+08:00）
- **轮次**：第 6 轮（前五轮：saas-subscription-admin / fitness-studio-booking / cross-border-commerce / online-course-platform / food-delivery-store）
- **结论**：**成功**。1 个新场景 × 3 个新风格全部产出并验证；4 表 10 接口（3 个 Bearer 写）；
  go build/vet/test 全绿（3 包 / 34 个测试函数 / 80 条用例）；api-smoke **pass=154 fail=0**；
  三风格单文件 preview 实机同构（各 10 KPI / 20 表行 / 3 主题按钮），computedStyle 两两 28~31/37 项互异、零外链；
  场景目录 1.7M。过程中冒烟测试抓到**一个真实的整页 500**（名单默认排序列指向子查询不存在的列），已修 + 补回归测试。

## 1. 去重与选型（只依据盘上记录）

- 开工前 `state.used_scenarios` = 5 个 slug，**无测评/考试类**；`next_candidates` 里也没有「在线测评」
  → 这是一个盘上记录未覆盖的新场景，符合「每轮挑全新业务场景」的口径（而不是从候选里挑第 6 个）。
- `state.used_styles` = 15 个风格名。本轮三选 **苹果玻璃拟态 / 构成主义海报 / 手账纸质拼贴**：
  前两个在 `next_style_candidates` 里，「构成主义海报」为新写；三者均未出现在 `used_styles`（逐一 grep 过），
  且互相风格语言完全不同（透明玻璃 vs 直角硬投影 vs 纸质虚线旋转）。
- 开工 `df -k .` 可用 **20,050,292KB ≈ 19.1GiB**，远高于 1.5GiB 熔断线 → 允许重活。
- 与五轮历史的差异化切口：**前几轮的核心口径分别是「价格折扣」（跨境电商、课程）与「容量/时间流水线」（健身排课、外卖出餐）**，
  本轮压在**判分与成绩口径的唯一性**上：
  判分引擎只有一个（`domain.GradeItem`），线上交卷与种子回放共用同一个函数，
  统计层**不做第二次判分**（区分度、得分率全部从已落库的 `attempt_answers` 聚合），
  并把 `score == mechanical + half_credit == Σ awarded` 作为接口体检字段实时对外公布 ——
  「两套口径漂移」是这类系统最典型的腐化方式，所以把它做成可断言的恒等式。

## 2. 后端（Go/Gin + SQLite）

分层 `cmd/api` + `internal/{domain,repository,service,handler,server}`；`github.com/glebarez/sqlite` 纯 Go 无 CGO；
DSN `journal_mode(WAL)&busy_timeout(5000)&foreign_keys(1)&txlock(immediate)`；`SetMaxOpenConns(1)` 单写者；
库文件与 `-wal/-shm` 落盘即 `chmod 0600`（存手机号原文）。

| 表 | 行数 | 要点 |
| --- | --- | --- |
| `assessments` | 6（3 closed / 2 open / 1 draft） | `code` 唯一 `AS-2026-00x`、`duration_min` 限时、`pass_score` 达线分、`opens_at/closes_at` 时间窗 |
| `questions` | 62 | 4 题型（single/multi/judge/blank），`options`/`answer` 带 `json:"-"`，每场满分刻意凑 100 |
| `attempts` | 181（167 graded / 4 ongoing / 10 invalid） | `attempt_no` 唯一、`score/mechanical/half_credit` 三分数列、`passed`、超时置 invalid |
| `attempt_answers` | 逐题判分留痕 | `picked/correct/awarded/max_score`，是区分度与成绩条的唯一数据源 |

AutoMigrate 之后补一条**部分唯一索引**（表达不了，必须手写）：
`CREATE UNIQUE INDEX idx_attempts_active_phone ON attempts(assessment_id, phone) WHERE status <> 'invalid'`
—— 一个手机号在同一场只能有一份有效作答，但**作废卷不占位**，因此超时作废后可以重考。

业务规则（全部后端判定）：

1. **判分**：single/judge 相等给满分；multi 全对满分、**漏选且不含错选项给半分**（`score/2`）、含任一错选项 0；
   blank rune 级 trim + 小写比较；`picked=''` 记 0 分但仍计入已答与分布。
2. **状态机**：`assessments: draft→open→closed`（closed 终态，非法跳转 409 `invalid_transition`）；
   `attempts: ongoing→graded|invalid`（重复交卷 409 `already_submitted`）。
3. **开考门**：非 open → 409 `assessment_not_open`；未到 `opens_at` → 409 `not_started`；过 `closes_at` → 409 `closed`；
   同手机号已有有效卷 → 409 `already_started`。交卷再校验 `started_at + duration_min + 120s` 宽限，超时自动 invalid。
4. **发号并发**：`attempt_no` 在事务内按「本场已有份数 + 1」生成，唯一冲突在同一事务内重算 ≤5 次后 409。
5. **隐私**：`Phone`/`Answer`/`Options` 原文 `json:"-"`；出口只有 `masked_phone`（`139****1111`）与
   `QuestionView`；**open 场次的题目区分度连干扰项分布都不给**（`ItemStat.Revealed=false`，`distractors` 键 `omitempty` 整个不存在），
   只有 closed 场次才公布分布。
6. 有一条 Go 测试把标准答案原文与手机号原文读出来，再逐个接口断言这些串**绝不出现在响应里**。

接口 10 个：`GET /api/health|stats|assessments|assessments/:code|assessments/:code/statistics|assessments/:code/attempts|attempts/:no`，
`POST /api/assessments/:code/attempts`、`POST /api/attempts/:no/submit`、`POST /api/assessments/:code/status`（后三个 Bearer）。
鉴权三层 fail-closed：服务端未配 `ADMIN_TOKEN` → 503（绝不因「期望值为空」放行）；缺失/非 Bearer 方案/只有前缀 → 401；
口令不符 → 403（`crypto/subtle` 常量时间比较）。对外**绝不回显 `err.Error()`**，错误体统一 `{code,message,fields?,trace_id?}`。

种子规模（`seedSource=20260925` 固定随机源，可复现）：6 场 / 62 题 / 181 份，
84 份达线、通过率 50.3%、平均得分率 59.9%，已判分总分 **10,006 = 机械分 9,560 + 漏选半分 446**，`identity_violations=0`。

## 3. 验证（流程走完，包括失败那一次）

- `go build ./... && go vet ./... && go test ./... -count=1` → 3 个测试包全 `ok`
  （domain 0.47s / repository 1.76s / server 1.79s），`-v` 复核 **RUN=80 / PASS=80 / FAIL=0**，34 个 Test 函数。
  表驱动重点：判分引擎全题型矩阵（含半分边界）、`NormalizePicked` 输入归一、字段校验矩阵、
  鉴权 503/401/403、状态机全对（合法/非法/重复）、注入串与 `page_size` 钳制、超 16KB 请求体 400、
  种子自洽（每场满分=100、恒等式、6 态覆盖）、**每个排序键都必须 200**（本轮新增，见下）。
- **真实 bug（已在盘上修复并留测试）**：`GET /api/assessments/:code/attempts` 对**所有场次**返回 500 ——
  名单默认排序配成 `attemptSorts["score"] = "sc.score"`，而排名子查询 `sc` 只 `SELECT id, rank_no`，
  SQLite 规划期 `no such column: sc.score`。改为 `a.score`（`backend/internal/domain/query.go`），
  并补 `TestAttemptListEverySortColumnResolves`（14 个排序键组合逐个断言 200，含非法键与注入串）。
  既有测试全绿却漏掉它，是因为它们都显式传了 `sort=rank`，恰好绕开默认分支 ——
  **教训：白名单 map 的值是裸 SQL 片段时，它引用的表别名必须由测试真实执行一遍；冒烟必须包含「不带任何参数的裸路径」用例。**
- `scripts/api-smoke.sh` 重写后在一次性实例上 **pass=154 fail=0**（6 节：读接口 / 卷面·区分度 / 名单·成绩条 /
  授权矩阵 / 开考·交卷 / 状态机）。要点：`call()` 支持 `RAW:` 前缀才能测非 Bearer 头（否则永远 403 测不到 401）；
  第 6 节会把 `AS-2026-006` 从 draft 真实迁移到 closed（终态），因此脚本加了**前置 ABORT 守卫**——
  检测到 P6 已不是 draft 就直接退出，要求换刚灌种子的临时库，避免第二次跑污染统计口径。
  期间修正 5 处「脚本期望错」而非产品错：`top_board=8`/`hardest_items=5`、P1 有 11 题（全局 62）、
  默认序回显 `score` 而非 `rank`、open 场次无 `distractors` 键（用 `.get()`）、
  `AS-2026-006` 有未来 `opens_at` 所以 `draft→open` 后开考正确返回 409 `not_started`（断言改成时间窗守卫）。
- `./node_modules/.bin/tsc --noEmit` 干净；`vite build` → `web/dist/assets/app.js` **328,766B**；
  `node scripts/inline-preview.mjs` → 三个单文件页 **329,337 / 329,329 / 329,333B**（JS/CSS 全内联，`file://` 双击可开）。
- **三风格实机取证**（本轮做成工具而不是肉眼比）：`scripts/style-probe.js` 在浏览器里返回 37 个计算属性 +
  结构不变量，`scripts/style-diff.py` 比较三份 JSON。结果：
  construct↔glass **31/37**、construct↔journal **30/37**、glass↔journal **28/37** 项互异（阈值 ≥3）；
  同时 `kpiCount=10`、`rowCount=20`、`swatches=3`、`external=[]` **三主题完全一致** →
  证明是同一份 DOM + 同一份 JS 只换 CSS（只断言「互异」会漏掉「偷偷复制三份组件」这种违规，所以两类指标都要）。
  三方完全相同的只有 4 个结构性属性（`label.fontStyle`、`head/input/badge.borderTopStyle`），符合预期。
- **页面零外链**：探针的 `external` 数组（`link[href]/script[src]/img[src]` 里匹配 `^https?:|^//`）三主题全为 `[]`。
- **UI 黄金路径**（一次性 `/tmp` 实例 + 只读 API，收工已删）：填令牌 → 选场次 → 开考（拿到 201 与 `attempt_no`）→
  作答 → 交卷（成绩条逐题 + 恒等式展示）→ 名单搜索过滤命中真实记录；全程数据来自接口，页面**无任何硬编码假数据**。

## 4. 清理与终值审计

- 删除：`web/node_modules`（64MB）、一次性编译产物 `/tmp/oae-smoke/api`（38MB）与全部 `/tmp/oae-*.db{,-wal,-shm}`/日志、
  `/tmp/oae-style`、`/tmp/{t1,t2,t3}.sh`、`/tmp/{x,y,r}.json`、`/tmp/oa-npm.log`、空的 `web/public/`。
- 杀进程：先 `lsof -iTCP -sTCP:LISTEN -nP` 列端口，再 `ps -o pid,lstart,command` 核对命令行确认全部是本轮
  `/tmp/oae-smoke/api` 或本场景 `scripts/serve-static.mjs`（18091-18098、8080、8123-8125，共 12 个）后才 kill；
  收工复测这些端口监听数 **0**。
- **未动**：`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache` 等共享缓存；全程没有 `go clean -cache/-testcache`。
- 终值：场景目录 **1.7M**（44 文件，上限 5MB）、LAB **13M**（含 `.git` 3.7M）、
  `df -k .` 收工可用 **19,838,948KB ≈ 18.9GiB**（开工 20,050,292KB，差值主要是一次性二进制+node_modules 已删但 git objects 增长，
  下一轮请以自己实测为准）；清理后复跑 `go build/vet/test` 仍全绿（证明删掉的都不是复现必需品）。
- `git status` 在提交前只剩本轮新增文件；推送只允许 `go-gin_react`（详见 work-log 末行）。

## 5. 与本轮相关的工具经验（已回写记忆）

- `evaluate_script` 返回值过长会 15s 超时（不是页面卡死）→ 探针刻意只取 37 个属性，且「动作」与「读取」拆两次调用；
  探针返回值可能被 MCP 二次编码成字符串 → `style-diff.py` 容忍「JSON 字符串里再套一层 JSON」。
- bash 里 `"$( ... "x" ... )"` 嵌套双引号会让 `"` 提前闭合（`bash -n` 不报、运行期才炸）→ 拆成顺序语句；
  python 断言表达式经 shell 注入后要统一加括号（`<=` 与 `|` 优先级差异会造成假绿）。
- zsh `rm -f app.db*` 在无匹配时 `no matches found` 直接中断 → 显式列文件名。
