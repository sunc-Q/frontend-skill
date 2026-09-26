# 车队充电运营台 · 分时计价与占桩调度（fleet-charging-ops）

第 12 轮业务网站实验室产物。Go + Gin + SQLite 后端、React + Vite + TS 前端，
同一个页面挂三套纯 CSS 风格。业务核心不是「增删改查」，而是**一台桩同一时刻只能服务一车**
这条物理约束，以及**分时电价拆段计价**这个必须处处一致的口径。

## 场景与角色

快递/冷链/通勤车队的场站运营人员，管 12 台桩（直流快充 160/180/120 kW + 交流慢充 7 kW）、
18 台车（17 台在册），每天上百次开充。三类人看同一张表：

| 角色 | 关心什么 | 界面上对应 |
| --- | --- | --- |
| 场站值班 | 哪台桩被占着、谁在充、有没有故障挂起赖着不走 | 桩位矩阵 + 「只看未关闭」筛选 |
| 车队调度 | 本队车今天充了多少度、花在峰段还是谷段 | 车队汇总 + 峰平谷拆分 + 趋势条 |
| 财务/老板 | 电费、服务费、超时占用费三笔账能不能对上 | KPI 卡组 + 会话详情的分时拆分单据 |

**核心业务不变量**（全部由后端保证并在 `/api/stats` 里实时自检回显）：

1. 一桩同时最多一条未关闭会话（`charging` / `faulted`），一车同理 —— 部分唯一索引兜底；
2. `Σ分段瓦时 + 未定价瓦时 = 实际电量`、`峰+平+谷+未定价 = 实际电量`；
3. `总额 = 电费 + 服务费 + 超时占用费`；
4. 已结算单的金额是**快照**，之后改价目表绝不回溯历史单；
5. 弃单（`aborted`）清空电量与金额，但保留行做审计痕迹。

状态机只有一张表（`domain.SessionNext`）：

```
charging ──settle──> completed（终态）
    │  ──fault──> faulted ──settle──> completed
                     └──abort──> aborted（终态）
```

## 数据模型

4 张表，全部由 GORM 建表 + 手写两条部分唯一索引（`repository/db.go`）：

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `piles` | `code`(uniq) `station` `bay` `type` `power_kw` `status` | `status ∈ online/maintenance/offline` |
| `vehicles` | `plate_no`(uniq) `dept` `battery_kwh` `driver_name` `driver_phone` `card_no`(uniq) `active` | 手机号列 `json:"-"`，只出掩码 |
| `tariff_rules` | `code`(uniq) `period` `day_type` `start_min` `end_min` `elec_cents_per_kwh` `service_cents_per_kwh` `rule_priority` `active` | `start_min > end_min` 即跨零点窗口 |
| `charge_sessions` | `code`(uniq) `pile_id` `vehicle_id` `status` `start_at` `end_at` `planned_wh` `actual_wh` + 结算快照 9 列 | 快照列全部由 `ComputeBill` 产出 |

```sql
-- 这两条索引是整个设计的承重墙：应用层的「先查再插」在高并发下会双开，
-- 只有部分唯一索引能让第二个开充请求直接撞约束返回 pile_occupied。
CREATE UNIQUE INDEX idx_pile_open    ON charge_sessions (pile_id)    WHERE status IN ('charging','faulted');
CREATE UNIQUE INDEX idx_vehicle_open ON charge_sessions (vehicle_id) WHERE status IN ('charging','faulted');
```

种子数据（`repository/seed.go`，只在库为空时灌入）：12 桩（含 1 检修 1 离线）、
18 车（含 1 退役）、10 条价目规则（工作日六段含跨零点低谷 + 周末三段）、
近 14 天 153 单会话（149 已结算 / 2 在充 / 1 故障挂起 / 1 已弃单，合计 13,557 kWh、营收 ¥16,462.49）。
**种子里每一单的电费/服务费/拆段都是调 `domain.ComputeBill` 算出来的**，不是手写常数，
所以灌完数据 `/api/stats` 的恒等式自检就是 `identity_ok: true`。

## 接口清单

15 个端点：1 健康检查 + 7 读 + 7 写（写全部在 `/api/admin` 组，走 `maxBodyBytes(64KiB)` + Bearer）。

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | 存活探针，同样 `no-store` |
| GET | `/api/piles` | 无 | 桩列表 + 未关闭会话数、累计电量 |
| GET | `/api/vehicles?all=1` | 无 | 车列表，只出 `phone_masked` |
| GET | `/api/tariffs?all=1` | 无 | 价目规则，`all=1` 才含停用 |
| GET | `/api/stats?days=14` | 无 | 唯一聚合出口，含 5 条恒等式自检结论 |
| GET | `/api/quote?pile=&wh=&minutes=&delay_min=&overstay_min=` | 无 | 试算，与结算共用 `ComputeBill` |
| GET | `/api/sessions?status=&pile=&plate=&dept=&q=&open=&sort=&dir=&page=&page_size=` | 无 | 台账，白名单排序 + 夹住分页 |
| GET | `/api/sessions/:code` | 无 | 单条详情 + 结算当时的价目窗口回显 |
| POST | `/api/admin/sessions` | Bearer | 开充（桩/车占用互斥） |
| POST | `/api/admin/sessions/:code/settle` | Bearer | 结算：功率上限复核 → 事务内拆段落快照 |
| POST | `/api/admin/sessions/:code/fault` | Bearer | 登记故障挂起（仍占桩） |
| POST | `/api/admin/sessions/:code/abort` | Bearer | 弃单作废（清空金额，留审计） |
| POST | `/api/admin/tariffs` | Bearer | 新增分时规则 |
| POST | `/api/admin/tariffs/:id/toggle` | Bearer | 启停规则（立即影响后续报价，不回溯历史） |
| POST | `/api/admin/piles/:code/status` | Bearer | 切桩状态（有未关闭会话时 `pile_busy` 409） |

安全口径：`ADMIN_TOKEN` 未配置时全部写接口 **503 fail-closed**（不是放行）；令牌常量时间比较，
`Bearer` 大小写不敏感并 `TrimSpace`；错误只出 `domain.AppError` 的 `{code,message,fields}`，
任何情况下不把 `err.Error()` 透给客户端；CORS 只放行 `127.0.0.1`/`localhost`/`[::1]`；
`/api/*` 全量 `Cache-Control: no-store`；未匹配的 `/api/*` 返回 JSON 404；
静态托管用 `filepath.Clean` 后校验前缀，杜绝目录穿越；整请求 8s 超时。

计价口径（`domain.ComputeBill`，README 与代码注释同段）：
时间轴按本地日（UTC+8）分钟边界切 run；同分钟多规则命中按 `priority` 升序、`code` 升序取第一条；
电量按各 run 时长占比整型分摊，余数按「余数降序 → run 序号升序」补齐；
分段电费 = `round_half_up(瓦时 × 电价分 ÷ 1000)`；无规则覆盖的分钟计 `unpriced`（电量参与分摊、金额为零）；
超时占用费 = `min(overstay_min, 360) × 8 分/分钟`。

## 重建与运行

```bash
cd sites/fleet-charging-ops

# 依赖镜像（命令行与文件里都不出现任何令牌；令牌从环境注入）
export GOPROXY=https://goproxy.cn,direct
export npm_registry=https://registry.npmmirror.com

# ---- 后端（Go 1.27+，纯 Go SQLite 驱动，无需 CGO）----
cd backend && go build -o /tmp/fco/api ./cmd/api && go vet ./... && go test ./... -cover
#   coverage: domain 75.3% / repository 82.1% / server 80.4%
#   24 个 Test 函数：domain 11 / repository 6 / server 7
#   （字段校验矩阵、鉴权 503/401/403、注入与超长、排序白名单逐键执行、
#    脱敏不外泄、状态机全链路、规则仲裁、CORS 精确匹配、请求体上限）

# ---- 前端 ----
cd ../web
npm install --registry=https://registry.npmmirror.com   # 约 64MB
./node_modules/.bin/tsc --noEmit                        # 严格模式，不用 npx
./node_modules/.bin/vite build                          # 产物 web/dist（单 bundle 354,720 B）

# 改了 base.css 或 tokens-*.css 必须重派生（98 个 token，三套缺一即失败退出）
python3 ../scripts/derive-themes.py

# ---- 起服务（端口 18501；库自动灌种子，文件压 0600）----
cd ..
ADMIN_TOKEN=<本地演示令牌> GIN_MODE=release STATIC_DIR="$PWD/web/dist" \
  /tmp/fco/api -db ./data/app.db -addr :18501
# 打开 http://127.0.0.1:18501/ ，在顶栏「管理令牌」里填同一个令牌才能写

# ---- 单文件预览（离线双击可开，走 http://127.0.0.1:18501/api 真接口）----
node scripts/inline-preview.mjs web http://127.0.0.1:18501/api
node scripts/serve-static.mjs preview 18509 http://127.0.0.1:18501/api   # 校验用托管
```

## 校验（全部要求末行 0 失败）

```bash
# ① 逐接口冒烟：自动起双实例（:18501 带令牌 / :18502 摘掉令牌）+ 全新 /tmp 库
ADMIN_TOKEN=<本地演示令牌> bash scripts/run-smoke.sh
#   scripts/api-smoke.sh ⓪~⑩ 共 11 节，末行 pass=266 fail=0
#   其中 ③ 用一段独立的 Python 复算实现逐分核对 ComputeBill（三种时长/电量/超时组合 + 峰谷仲裁）

# ② 三风格计算样式取证（真无头 Chrome，需要 playwright-core）
#    后端只出接口、不托管前端，所以页面由 scripts/serve-static.mjs 托管并注入 __API_BASE__/__THEME__；
#    注意 serve-static 没有 SPA 回退，dist 那份必须写 /index.html?theme=，写 / 会拿到 "not found"
node scripts/serve-static.mjs web/dist 18512 http://127.0.0.1:18501/api &
node scripts/serve-static.mjs preview 18513 &
PW_PATH=<path>/playwright-core node scripts/style-shoot.mjs 'http://127.0.0.1:18512/index.html?theme={theme}' /tmp/fco-probe-dist.json /tmp/fco-shot-
python3 scripts/style-diff.py /tmp/fco-probe-dist.json      # 末行「失败项：0」
#   单文件版再做一遍：URL 换成 'http://127.0.0.1:18513/{theme}.html'（preview 里的 API 基址已烤成 :18501）

# ③ UI 真操作回归：三套风格各完整点一遍
PW_PATH=<path>/playwright-core BASE=http://127.0.0.1:18501 ADMIN_TOKEN=<本地演示令牌> \
  node scripts/ui-check.mjs                            # 末行 pass=186 fail=0
```

`style-diff.py` 是双指标：**互斥性**（71 项计算样式里每对主题 ≥3 项不同，实测 55/53/48）
与**同构性**（行数、KPI 数、徽标数、条形数、主题按钮数、内联脚本/样式数、外链列表三主题全等，
且首屏文本三主题全等且非空）。只量一边会出现「三个不同页面」或「三套 CSS 其实没区别」这两种作弊。

`ui-check.mjs` 跑的是真链路：试算 → 开充 → 故障挂起 → 补结算 → 终态锁死 → 弃单释放桩车 →
新增 priority=1 全天规则看报价被接管 → 停用后逐分回到基线 → 搜索（含 `%` 通配符转义、备注不入搜索）→
在充桩切维保被 `pile_busy` 拒绝 → 空闲桩切维保再切回在线。同一实例连跑两轮（第二轮库已脏）都是 0 失败。

## 三风格宣言（同一 DOM + 同一 JS，只换 CSS）

结构层 `base.css` 里**一个字的颜色都不许出现**（派生脚本报错拦截），所有配色走 98 个 CSS 变量；
每套风格只有一个 `tokens-<id>.css` 变量表 + 一段「气质补丁」。三套都取自 `next_style_candidates`：

| id | 中文名 | 气质 | 实测计算样式特征 |
| --- | --- | --- | --- |
| `flight-board` | 机场航班信息板风 | 翻牌式深炭黑底、琥珀灯号、全大写窄体 | 标题 `DIN Condensed` 34px/字距 2.04px/`uppercase`；KPI 圆角 2px + 顶部 4px 实线 + 双层硬阴影；表头琥珀色 `#ffb020`；徽标虚线上边框 |
| `watch-dial` | 机械腕表表盘剖视风 | 米白漆面、同心刻度圈、蓝钢指针 | 标题 `Didot` 38px/字距 5.32px；KPI 圆角 999px + 1px 细线 + 双内描边；标签斜体；条形 8px 圆头；背景带 `repeating-conic-gradient` 同心纹理 |
| `botanical-plate` | 植物标本图鉴版画风 | 泛黄图鉴纸、铜版蚀刻线、墨绿与赭石双色 | 正文即衬体 `Iowan Old Style`；KPI 圆角 0px + 顶部 1px **虚线**；徽标无圆角虚线框；`--border-bottom-strong: 3px double`；页面外框点线 + 轻微倾斜补丁 |

两两对比（71 项计算样式中不同的项数）：`flight-board`↔`watch-dial` 48、
`flight-board`↔`botanical-plate` 55、`watch-dial`↔`botanical-plate` 53。

## 坑（本轮踩过）

1. **不足一分钟的结算会把 1.2 kWh 算成 0 元**（真产品缺陷，api-smoke 抓到）。`Settle` 把
   `Start: s.StartAt, End: now` 直接喂进引擎，墙钟差 <60s 时 `int(End.Sub(Start).Seconds()) == 0`
   落进 `ComputeBill` 的零时长分支——全部电量记 `unpriced`、金额为零，而 `IdentityOK` 因为
   「0 段之和 = 0」还假性通过。修法是在 `repository.Settle` 里把**计价区间**抬到 1 分钟下限
   （`end_at` 仍写真实瞬刻），与服务层那条「满功率 60 秒」的功率上限口径对齐。
   教训：恒等式在退化区间上会自我证明，必须单独断言「一分钟内结算也要出账」。
2. **`shouldBindJSON` 会把 `\ud800` 修成 U+FFFD**，所以「发一个孤立代理对转义」根本测不到
   `utf8.ValidString`；真正的对抗输入是裸字节（U+D800 的 CESU-8：`í `）。
3. **`input` 上的 `min/max` 会挡在浏览器层**：给试算台填 99,999,999 Wh，`form submit` 事件
   压根不触发，界面既不出错误回执也不发请求。测「后端字段回显」得挑 `min/max` 管不住的那条
   ——结算电量 600,000 Wh 合法越过量程，被后端物理上限复核拒掉。
4. **同一轮里给三套风格各建一条 priority=1 的全天价规则，后两套的「停用后回落」断言必然假失败**：
   第一套留下的规则把第二套停用后的报价接管了，总价一模一样。断言基线必须在**建规则之前**取，
   跑完把这条规则停用掉。
5. **换风格会改 DOM 节点数**——色卡 `Swatch` 是每套主题各自的 svg 图形。同构性断言只数
   结构层（`closest('svg') === null`），否则抓到的是图形差异而不是结构漂移。
6. macOS 自带 bash 3.2 会把 `$(urlq "$(…)")` 三层嵌套解析错；zsh 的 `nomatch` 会让
   `rm x.db*` 直接中断整条 `&&` 链；`python3` 的 `strptime` 不吃小数秒，用 `fromisoformat`。
7. **`serve-static.mjs` 没有 SPA 回退**：`GET /` 会 `readFile(目录)` 失败并回 `not found`，
   所以取证 URL 必须写全 `/index.html?theme=…`。另外本场景后端**不托管前端**（无 `STATIC_DIR`
   分支），页面只能靠这个静态服务器起；用工具后台跑命令时记得 `nohup`，否则服务在下一条命令
   开始前就被回收，症状是 playwright 干等 `.bar-fill` 超时，看着像前端 bug。

## 交付证据（`evidence/`）

`api-smoke.txt`（⓪~⑩ 全量日志，末行 `pass=266 fail=0`，末尾附库三件套 0600 权限）、
`style-diff.txt`（dist 与 preview 两份判定的完整输出，两份均「失败项：0」）、
`style-probe-{dist,preview}.json`（71 项计算样式 + 结构/内容不变量原始读数）、
`style-{flight-board,watch-dial,botanical-plate}.jpg`（三套风格整页截图，720px 宽）。
截图与 `style-diff.txt` 来自**另起的一次独立播种实例**（`/tmp` 临时库，取证后已删），
所以金额与上文引用的交付库种子统计（¥16,462.49）会有小幅差异——结构、行数、恒等式与
三主题逐字相同的那份首行文本才是这两份证据要证明的东西。
