# 第 12 轮 · 2026-09-26 12:10 — 绿驰车队充电运营台（fleet-charging-ops）

## 选题与去重

- 场景直接取自 `state.next_candidates[3]`「充电桩车队运营」，落地成**封闭场站的充电运营台**：12 台桩（直流 160/180/120 kW + 交流 7 kW）× 18 辆车 × 分时价目 → 开充/故障挂起/结算/弃单四态机 → 按分钟切价、跨零点低谷、超占费 → 14 天趋势与桩位矩阵。同一套页面三种互斥风格。
- 开工前核对：`used_scenarios` 11 项无 `fleet-charging-ops`；`used_styles` 33 项与本轮三套（机场航班信息板风 / 机械腕表表盘剖视风 / 植物标本图鉴版画风）逐一比对无重合，三套均取自 `next_style_candidates` 预置名（第 9、16、17 位），无「换名重用旧风格」嫌疑。
- 磁盘：开工 `df -k .` 可用 ≈17.8 GiB（82% 已用），远高于 1.5 GiB 熔断线。
- ⚠️ 并发观察：`sites/` 下另有 **两个未纳入 git 的场景目录**（`clinic-appointment-desk` 08:36、`charity-donation-progress` 09:33），二者 `themes.tsx` 仍是第 11 轮的 `ticket-stub / michelin-gilt / crackle-glaze`，无 README、无 dist/preview——像是**中途停掉的并行实例**。本轮**没有**提交、也没有删除它们（不是我的产物），只在此留痕：若那两个会话恢复，必须先重读 `state.json`（它们的风格名已在 `used_styles` 里，属于重复选题）。

## 交付

`sites/fleet-charging-ops/`：backend 208K（`cmd/api` + `internal/{domain,repository,service,handler,server}`，19 个 .go / 3 个 _test.go）、web 628K（含 dist 354,728B，7 个 .ts/.tsx + `base.css` 1,264 行 + 3 组 tokens/theme CSS）、preview 1.0M（三套单文件版各 ~355,300B）、scripts 124K（9 个）、evidence 880K（api-smoke 全量日志 + style-diff 两份判定 + 三张整页 JPG + 两份探针 JSON）、README 1 份；清理后场景目录 **2.8M / 62 文件**（上限 5MB）。

计价口径唯一算法在 `internal/domain/bill.go` 的 `ComputeBill`，**试算 / 结算 / 种子三处共用**：

- 分钟步进切段（`BizOffsetHours = 8`，业务日 = UTC+8），窗口支持跨零点（`23:00-07:00`），规则按 `priority, code` 仲裁；
- 电量按整数 Wh 用**最大余数法**分摊到各段，保证 `Σseg_wh + unpriced_wh == actual_wh` 严格成立（不是浮点近似）；
- `amount = round_half_up(wh × 分/度 ÷ 1000)`，超占费 `min(n, 360) × 8 分`；
- 三条恒等式随接口发布：`Σseg + unpriced == actual`、`peak+flat+valley+unpriced == actual`、`total == elec + service + overstay`，由仓库层 `checkIdentities` 全表自检 → `/api/stats.identity_ok`，前端页脚原样显示。

结构选择：`charging → completed | faulted`，`faulted → completed | aborted`；**两个部分唯一索引** `idx_pile_open` / `idx_vehicle_open`（`WHERE status IN ('charging','faulted')`）在库层挡住「一台桩/一辆车两个在充」，不靠应用层查重；DSN 带 `txlock(immediate)` + `SetMaxOpenConns(1)`，`Harden()` 在播种后再 chmod `db/-wal/-shm` 为 0600；`Vehicle.Phone` 带 `json:"-"` 只出 `phone_masked`，搜索 `q` 转义 LIKE 后只覆盖 `code/plate_no/driver_name/station`，**备注不参与搜索**。种子 12 桩 / 18 车 / 10 条价目 / 153 单（149 结算 · 2 在充 · 1 故障 · 1 弃单，13,557 kWh、¥16,462.49），全部由同一组 `domain` 函数生成。

## 校验结果

| 项 | 结果 |
| --- | --- |
| `gofmt -l .` / `go vet ./...` / `go test -count=1 ./...` | 空 / 0 / 三包全绿（**24 个 Test**：domain 11、repository 6、server 7；覆盖率 domain 75.3% / repository 82.1% / server 80.4%。表驱动覆盖：切段与跨零点、最大余数分摊与进位、超占封顶、四态正反跃迁、两组字段校验、排序白名单、鉴权 503/401/403、注入与超长、路径穿越、请求体上限、CORS 矩阵、种子自洽与「不存在非 UTC 时间」） |
| `tsc --noEmit` / `vite build` | 0 错 / dist 354,728B（`cssCodeSplit:false`），三套 `theme-*.css` 由 `derive-themes.py` 从 `base.css + tokens-<id>.css` 拼装并断言 98 个 token 全覆盖、`base.css` 零裸色值 |
| `bash scripts/run-smoke.sh`（双实例全新 /tmp 库 → `api-smoke.sh` ⓪~⑩ 共 11 节） | **pass=266 fail=0**；含一份**独立 Python 重算的 `ComputeBill`** 与接口逐字段对账；`api.db`/`-shm`/`-wal` 实测 `-rw-------`；日志内令牌 0 命中 |
| `node scripts/style-shoot.mjs` + `python3 scripts/style-diff.py`（dist 与 preview 两份探针） | 两份均 **失败项：0**；71 项计算样式两两互斥 **55 / 53 / 48** 项；同构 `rowCount=40`、`kpiCount=14`、`badgeCount=51`、`trackCount=28`、`tabCount=3`、`inlineScripts` 各自全等（dist=2 / preview=3）、`inlineStyles=1`、`external=[]`、console 错误 0；内容取样三主题逐字相同（首 KPI `¥1.63 万`、首徽标 `已结算`、首行 `CS20260926-004 DC-A03 沪AD10548 通勤班线 已结算 29.7 kWh ¥52.31 …`） |
| `node scripts/ui-check.mjs`（10 节 × 3 主题） | **pass=186 fail=0**，新鲜库与脏实例各跑一轮均 186/0 |

UI 里真实走完的闭环：切主题并核对 DOM 形状不变 → 表头排序 → 空令牌时写按钮 `disabled` → 分时试算（UI 金额 == 接口金额、超占 == 分钟×8、`Σ段 + 未定价 == 电量`）→ 非法输入被原生 `rangeOverflow` 挡在提交前 → 开充 → 故障挂起 → 600,000 Wh 超功率上限结算被 400 拒并回显 `actual_wh` 字段 → 结算（页脚恒等式 + 「一分钟内结算也出账」`total_cents > 0`）→ 终态锁定 → 弃单路径（金额清零、桩位释放、原因进备注）→ 新建价目规则/启停并核对基线报价回到原值 → 服务端搜索 `%` 不被当通配符、备注不可搜、车牌精确命中 → 桩位占用守卫与状态往返。

## 本轮抓出的真缺陷（应用侧 3 处，全部已修）

1. **同一分钟内结算出账 ¥0（最贵的一条）**：`Settle` 用真实墙钟区间喂引擎，`elapsedSec < 60s` 落进零时长分支 → 已充走的电量全记成 `unpriced_wh`、金额 0 元放行。**三条恒等式在这个退化区间上全部成立**（`Σseg(0) + actual == actual`），所以接口自检、Go 测试、页面页脚全都一片绿——恒等式在退化输入上会自我证明。修法：仓库层把**计价区间下限抬到 1 分钟**（`billEnd = max(now, start+1min)`），`end_at` 仍写真实瞬刻，与服务层 60s 功率上限口径对齐；补 `TestSettleMatchesEngineAndAborts/同一分钟内结算` 子用例（断 `total>0`、`elec>0`、`unpriced==0`、`Σseg==1200`、`end_at` 未被改写）。
2. **一条既有 Go 测试把 bug 写成了期望**：`server_test.go` 里原本断言「8 毫秒后结算 → `total_cents == 0`」，改代码时它先红了。这类「绿色的错误断言」必须连同根因一起改，不能靠放宽测试或删断言过关——本轮改成断 `covered==true && total>0`，并注明为什么。
3. **对抗输入被 Go 的 JSON 解码器「修好」**：`\ud800`（孤立代理对）经 `encoding/json` 会被替换成 U+FFFD 后正常入库，冒烟原本拿它当非法 UTF-8 断 400，实际拿到 201。真正的非法输入是**裸 CESU-8 字节序列**（`\xed\xa0\x80`），改发裸字节后 400 通过；转义写法降级为「不报 5xx」保留。

另有两处**跨轮复用的生成器残留文案**（自动记忆里的老坑复发）：`base.css` 两条注释仍写「运单详情」「附加费、线路特征」，`domain/models.go` 的 `Dept` 注释仍写「线路队（快递/冷链/通勤…）」。都改了——注释不会报错，但下一轮读到它的人会以为数据模型还是运单。

## 脚本侧教训（已回写 `state.environment_notes`）

- **`<input type=number max=600000>` 会在提交前就把表单整个挡住**：浏览器判定校验失败 → 不触发 submit → 既没有请求也没有 `.form-msg`，UI 用例干等 30 秒超时。「非法输入」这类用例要么断原生 `validity.rangeOverflow`，要么把服务端字段回显的证据挪到能真正发请求的那条探针上（本轮挪到 600,000 Wh 结算）。
- **DOM 同构断言必须排除每主题一枚的装饰 SVG**：三套 `Swatch` 的子节点数天然不同（翻牌 5 / 表盘 5 / 叶片 4 但路径不同），整页形状序列因此差 1 个节点（1251 vs 1250）误报「换风格动了 DOM」。口径：`closest('svg') === null` 过滤后再比。
- **多主题共库跑写操作用例，基线要在动手前取**：每套主题都新建一条 `priority=1` 的全天规则且**留着启用**，第二套主题的「停用后报价回到原规则」基线已经被第一套劫持（10000 → 10000 假绿，实际比的是自己）。改法：建规则前先取 `baseQuote`，断 `offQuote == baseQuote`（总额 + 命中规则码序列），并在用例末尾把规则停掉。
- **UI 套件首跑全绿不算数**：本轮 186/186 之后在同一实例再跑一轮才确认没有读侧竞态（第 10 轮的老雷）。等待条件一律用目标值本身。
- **后台进程会被 Bash 工具回收**：`cmd &` 在工具返回后即死，取证服务必须 `nohup`；否则下一次 `style-shoot` 打到的是「已退出的端口」，症状是 `.bar-fill` 超时，看起来像前端 bug。
- **playwright-core 这次没有可借用的现成副本**（第 7 轮记的 `skill演示场/.tmp/pw2` 路径已不存在）：`npm i playwright-core --registry=https://registry.npmmirror.com` 装到 `/tmp/fco-pw`（13MB，2 秒），用 `PW_PATH` 指过去，不进仓库。

## 遗留（写入 `state.backlog`）

- 会话号 `CS<业务日YYYYMMDD>-<当日3位流水>` 靠事务内 `code LIKE` 计数生成，安全前提是 `SetMaxOpenConns(1)` 单写者；放开多连接或换 PG/MySQL 前必须改序列表或行锁（与第 11 轮同类）。
- 价目规则的生效日类型（工作日/周末）与六段窗口写死在 `seed.go`，没有「规则变更审计」与历史价目快照：改价后**已结算会话的 `segments_json` 是当时快照**（这点是对的），但运营无法回答「上周三这一度电按哪版价目算的」。
- `/api/stats` 每次全表聚合（14 天趋势 + 桩位矩阵 + 三条恒等式自检），153 单无感；上万单需要日汇总表 + 对账任务（第 10/11 轮同类遗留）。
- 超占费单价 `OverstayCentsPerMin = 8` 与封顶 360 分钟是 `domain` 常量，没有按桩型/时段差异化的超占策略表。

## 清理与推送

- 删除：`web/node_modules`（64M）、`/tmp/fco-verify`、`/tmp/fco-smoke`、`/tmp/fco-count`、`/tmp/fco-style`、`/tmp/fco-pw`、`/tmp/fco-ev` 及全部临时 db/png/json/log；`go build` 的 38MB 二进制只落在 /tmp，场景目录内无编译产物。保留：源码 + `web/dist/` + `preview/` + `scripts/` + `evidence/` + `README.md`。共享缓存（`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache`）未动，无 `go clean -cache/-testcache`。
- 进程：:18501 / :18502 / :18509 / :18512 与收工时新发现的 :18099（`/tmp/fco-api -db /tmp/fco-seed/app.db`，一个已被删库的孤儿实例）逐个按 `lsof -t` → `ps -o command=` 核对命令行，确认都是本轮自己起的才 kill；kill 后 `lsof` 监听数 0。**未碰任何不属于本任务的进程。**
- 令牌：`ADMIN_TOKEN` 全程只由 `openssl rand -hex 8` 生成后经环境变量注入（`env -u ADMIN_TOKEN` 显式摘掉来测 fail-closed 的 503），命令行历史、仓库文件、evidence 日志里均 0 命中。
- 磁盘：收工 `df -k .` 可用 17,809,256KB≈17.0GiB；LAB 35M（`.git` 11M）、场景 2.8M / 62 文件。
- 一句话教训：**别只让恒等式在正常输入上成立**——本轮的 0 元结算满足了全部三条对账式，Go 测试甚至把它写成了期望。真正兜住它的是「同一分钟内开充立刻结算」这条从业务直觉出发的边界用例，以及「UI 套件必须在脏实例上重跑一遍」的规矩。
