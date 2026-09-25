# 第 10 轮 · 2026-09-26 06:32 — 铁砧汽修 · 工单与配件台（auto-repair-workorder）

## 选题与去重

- 场景来自 `state.next_candidates` 里的「汽车维修工单与配件库存」，落地为**一家四工位社区汽修店的日常台**：开单 → 检测定项 → 领料 → 质检 → 结算 → 提车，配件按批次记成本、按 FIFO 出库、作废按原批次原量退料。
- 开工前核对：`used_scenarios` 9 项无 `auto-repair-workorder`；`used_styles` 27 项与本轮三套（机车搪瓷牌照风 / 高定时装屋排版 / 塔罗神谕卡牌风）逐一比对，无相邻改名嫌疑（前三轮已用掉的「乐高积木块面 / Risograph 孔版印刷 / 解构主义拼版」等均不重叠）。
- 环境判定读盘而非假设：`df -k` 开工可用 18,687,840KB≈17.8GiB，远高于 1.5GiB 熔断线。
- 去重后剩余空间：候选场景仍有「医院门诊排班与挂号」「物流运单跟踪」「招聘 ATS 流水线」等 11 项；风格候选已刷新一批未用名（见 `state.next_style_candidates`）。

## 交付

`sites/auto-repair-workorder/`：backend 228K（`cmd/api` + `internal/{domain,repository,service,handler,server}`）、web 592K（含 dist）、preview 1.0M（三套单文件版）、scripts 108K（9 个）、evidence 2.1M（三张整页截图 + 四份探针 JSON）、README 1 份；清理后场景目录 **4.0M / 59 文件**（上限 5MB）。

口径唯一算法在 `internal/domain/models.go`：

- `CatRules` 七类，只有 `consumable` 是 `Fragile`（必须能记效期，建议周转 540 天）。
- `LaborRates` 18000/26000/38000 分每小时，`LaborAmount = roundHalfUp(分钟 × 费率 / 60)`——**每行独立取整**，结算与统计不再二次取整。
- `PromiseHours` 加急 6h / 保客回厂 12h / 普通 30h；`promise_overdue` 与「在厂时长」是接口派生字段。
- `woNext` 八态唯一跃迁表，表外目标一律 409；`LinesEditable = ReturnStock = {received, diagnosed, awaiting_parts, repairing}`，即**质检之后账目锁定**、结算之后不允许作废（状态机本身已挡）。
- `PlanIssue(lots, qty)` 纯函数：按 `received_at`、再按 `lot_no` 依次扣批次，返回计划 + 成本 + 缺口；缺口非零整事务回滚 `part_short`，绝不出一半料。
- 三条恒等式（总额 == 工时+配件 == Σ行金额、配件行 == 数量×挂牌价、在库 == Σ批次剩余 == Σ流水增量）由 `/api/stats` 自检（`identity_issues`/`stock_issues`/`amount_invariant_ok`/`lot_overflow`），前端页脚原样显示。

隐私与结构选择：`WorkOrder.CustomerPhone` 带 `json:"-"`，对外只有 `phone_masked`；**`parts` 表刻意不放 `on_hand` 列**，在库永远是批次表派生值，从根上消除「库存字段与批次表各说各话」。种子 31 件配件 / 73 批次 / 124 单 / 461 行 / 385 流水，八态全覆盖（含 34 张带退料的作废单），全部经同一组 `domain` 函数生成。

## 校验结果

| 项 | 结果 |
| --- | --- |
| `gofmt -l .` / `go vet ./...` / `go test -count=1 ./...` | 空 / 0 / 三包全绿（30 个 Test：domain 11、repository 12、server 7；8 处 `[]struct` 表 + 14 个用例循环，覆盖字段校验、鉴权 503/401/403、注入与超长、FIFO 计划、跃迁表、退料、恒等式） |
| `tsc --noEmit` / `vite build` | 0 错 / dist 产出，三套 `theme-*.css` 由 `derive-themes.py` 拼装并断言 84 token 全覆盖、`base.css` 零裸色值 |
| `scripts/run-smoke.sh`（双实例全新库 → `api-smoke.sh` 16 节） | **pass=338 fail=0**；`api.db`/`-shm`/`-wal` 实测 `-rw-------` |
| `scripts/style-diff.py`（dist 与 preview 两份探针） | 两份均 **失败项：0**；互斥 47 / 44 / 49 项（70 项计算样式），同构 `rowCount=63`、`kpiCount=12`、`badgeCount=55`、`lotCount=3`、`tabCount=3`、`inlineScripts=0`、`inlineStyles=1`、`external=[]` 全等，console 错误 0 |
| `scripts/ui-check.mjs`（10 节 × 3 主题） | dist 托管 **pass=153 fail=0**；单文件 preview 托管 **pass=153 fail=0**；修掉竞态后同一实例连跑 3 遍仍 153/0 |

UI 里真实走完的闭环：开加急单（承诺 +6h）→ 90 分钟中级工时行 ¥390.00 → 检索配件点批次「出库此件」2 件（接口侧在库 −2、本单流水出现 `-2 / 出库`）→ 状态一路推到已提车（结算快照 == 390 + 2×挂牌价，质检后加行按钮禁用且提示「质检之后明细锁定」）→ 第二张单出库 3 件后作废（退料 +3、库存回到领料前、作废原因回显）→ 到货入库 5 件（批次号留空自动生成，在库 +5）→ 页脚自检面板「通过」。

## 本轮抓出的真缺陷（应用侧 2 处，全部已修）

1. **预填值只是显示的 value，不是 state**：点批次「出库此件」会把配件编码预填进表单，但提交读的是 `draft.partCode`（仍为空）——现场表现为「输入框明明写着 FL-OIL-01，提交却报编码非法」。改为显示与提交读同一个 `codeValue`（`App.tsx` 的 `ReceiptForm`）。
2. **自动批次号会顶破后端 20 位上限**：`LOT-<编码>-<时间戳%100000>` 在长编码下达到 22–24 位，入库返回 400。改为 `LOT-` + 编码尾 10 位 + `-` + 4 位时间戳，最长 19 位。

## 脚本侧教训（已回写 `state.environment_notes`）

- **`[[ "$b" == *"\"$field\"" ]]` 少尾部 `*` 是静默失效**：bash 的 `==` 是整串模式匹配，24 行字段校验断言因此假通过，`bash -n` 一声不响。判「响应含某键」两头都要 `*`，并先单独验证一次模式本身。
- **嵌套引号的 payload 不能内联进 `$( )`**：`$(status_of "$(req POST … "{\"…\"}")")` 引号被吞，后端只收到畸形 JSON，等到的是 400「请求体无法解析」而不是想要的 409。payload 与响应各自先落变量。
- **样本要服务端筛选，缺样本要硬退出**：种子 124 张单，在「第一页 100 条」里挑 `settled`/`cancelled` 会挑空 → URL 塌成 `/api/work-orders/` → Gin 301 → 断言读到 `<a href="…">Moved Permanently</a>`，一条空值污染十条断言。改成 `?status=settled&page_size=5`，并在样本缺失时 `exit 1`。
- **UI 读侧竞态只有重复跑才暴露**：首轮脏库连跑抓到两类假红——`factWait('工单号','WO-')` 的等待条件用「含 WO-」（上一单本来就含，立刻返回旧值），以及出库后马上读流水表拿到占位文案「库存流水 正在读取…」。规则：**等待条件必须用目标值本身**，套件统一加 `poll(read, test)`。另注意 `locator.isDisabled()` 返回 Promise，写成 `String(…isDisabled())` 得到 `[object Promise]`，条件永不成立、只留一次超时。
- **探针别量透明容器**：`.shell` 背景画在 `body`/`.topbar` 上，量 `.shell` 三套主题全等 `rgba(0,0,0,0)`，误判「风格没生效」。
- **派生 CSS 的拼接顺序有语义**：`derive-themes.py` 必须「令牌 → 结构层 → 气质补丁」，补丁写在前面会被 `base.css` 以同特异性后置覆盖，等于白写且不报错。
- **`/` 被渲染成 `-`** 的显示层怪癖本轮再次复现（页面文案与断言输出都受影响），判字节用 `binascii.hexlify`（本机 python3 无 `str.hex()`）；带 `?` 的 URL 在 zsh 里必须加引号。

## 遗留（写入 `state.backlog`）

- 在库/库存金额/批次成本全部实时聚合派生，读放大随批次数线性增长；上量需物化列或增量维护，并配「派生值 vs 聚合值」对账任务（目前只有 `/api/stats` 的 `stock_issues` 自检）。
- FIFO 扣批靠 `SetMaxOpenConns(1)` 串行化 + 触发器兜底非负；放开多连接前必须改成 `UPDATE … WHERE qty_remaining >= ?` 的乐观条件或显式事务锁。

## 清理与推送

- 删除：`web/node_modules`、`/tmp/arw-build`、`/tmp/arw-doc`、`/tmp/arw-v2`、`/tmp/arw-pv`、`/tmp/arw-recheck*`、`/tmp/arw-f*` 及全部临时 png/json/log。保留：源码 + `web/dist/` + `preview/` + `scripts/` + `evidence/` + `README.md`。共享缓存（`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache`）未动，无 `go clean -cache/-testcache`。
- 进程：:18477 / :18478 / :18411（`/tmp/arw-build/api`）与 :18412（`node scripts/serve-static.mjs`）按端口→PID→`ps -o command=` 核对命令行后 kill，全部本轮自己起的；kill 后监听数 0。
- 推送：仅 `go-gin_react` 分支，SSH，提交身份用命令行内联 `-c user.name/-c user.email`（不改全局配置），无 `--force`、无 `--no-verify`、不碰 `main`，命令行与文件内均无令牌。
