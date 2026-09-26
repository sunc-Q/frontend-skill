# 第 11 轮 · 2026-09-26 08:30 — 云途运单 · 运单运营台（freight-waybill-tracking）

## 选题与去重

- 场景来自 `state.next_candidates` 里的「物流运单跟踪」，落地成**零担货运网点的运营台**：客户电话报单 → 现场称重量方按「实际重/体积重取大」计费 → 干线逐点扫码打卡 → 超时或异常挂起 → 退回不计营收。同一套页面三种互斥风格。
- 开工前核对：`used_scenarios` 10 项无 `freight-waybill-tracking`；`used_styles` 30 项与本轮三套（老式票证打孔风 / 指南烫金卡风 / 青瓷开片冰裂风）逐一比对，无相邻改名嫌疑，且与第 10 轮的「机车搪瓷牌照风」等无材质重合。
- 环境判定读盘：开工沿用上轮收工终值 18,551,596KB≈17.7GiB（本轮未再单独采样开工值），全程远高于 1.5GiB 熔断线；收工实测见文末。
- 去重后剩余空间：候选场景仍有「医院门诊排班与挂号」「招聘 ATS 流水线」等 10 项；风格候选已刷新一批未用名（见 `state.next_style_candidates`）。

## 交付

`sites/freight-waybill-tracking/`：backend 196K（`cmd/api` + `internal/{domain,repository,service,handler,server}`，18 个 .go）、web 628K（含 dist，9 个 .ts/.tsx + 7 份 CSS）、preview 1.0M（三套单文件版各 ~356KB）、scripts 100K（9 个）、evidence 692K（三张整页 JPG + 两份探针 JSON + 两份 style-diff + api-smoke/UI 日志）、README 1 份 192 行；清理后场景目录 **2.6M / 63 文件**（上限 5MB）。

口径唯一算法在 `internal/domain/quote.go` 的 `QuoteOf`，**试算 / 开单 / 种子三处共用**，统计层不再二次算价：

- `volumetric = ceil(体积cm³ × 1000 ÷ 抛比)`，抛比按线路档位（特快 6000 / 标快 8000 / 经济 12000）；`chargeable = ceilTo500(max(实际重, 体积重))`（`ChargeStepGrams = 500`）。
- `freight = 首重价 + 续重档数 × 每 500g 单价`，再与 `min_cents` 取大；`fuel = roundHalfUp(freight × fuel_pct)`（纯整型，不碰浮点）；`insurance = max(200, declared × 30/10000)`（未申报为 0）。
- 附加费四类 `remote_pct / heavy_piece / fragile_flat / long_haul_flat` 按 `priority,code` 升序逐条判定，合计**封顶运费+燃油的 80%**，截断时 `surcharge_capped = true` 留痕。
- 恒等式 `total == freight + fuel + insurance + surcharge` 随接口发布为 `identity_ok` / `identity_issues`，后端自检、前端页脚原样显示。

其余结构选择：八态机 `NextStatus` 表外目标一律 409（`delivered`/`returned` 终态，`exception` 可回在途/派件）；轨迹 `(waybill_id, seq)` 复合唯一索引 + 详情按 **seq 倒序**返回；单号 `FY<业务日YYYYMMDD>-<当日4位流水>` 在事务内计数生成；营收 `revenue_cents` 剔除已退回；`phone` 带 `json:"-"` 只出 `phone_masked`，搜索 `q` 转义后只 LIKE `w.code`/`w.shipper_name`。种子：9 条线路 / 150 张运单（八态全覆盖：delivered 115、exception 9、out_for_delivery 6、picked_up 6、in_transit 4、returned 4、arrived 3、booked 3）/ 1076 条轨迹 / 5 条附加费规则（4 类各 1，`heavy_piece` 2 条其中 1 条停用），全部由同一组 `domain` 函数生成。

## 校验结果

| 项 | 结果 |
| --- | --- |
| `gofmt -l .` / `go vet ./...` / `go test -count=1 ./...` | 空 / 0 / 三包全绿（**24 个 Test**：domain 8、repository 8、server 8；表驱动覆盖报价档位与进位、规则类型与停用、排序白名单、八态正反跃迁、两组字段校验、白名单与掩码、鉴权 503/401/403、注入与超长、路径穿越、请求体上限、CORS 矩阵、种子自洽与「轨迹不落在未来」） |
| `tsc --noEmit` / `vite build` | 0 错 / dist 355,707B（`cssCodeSplit:false`），三套 `theme-*.css` 由 `derive-themes.py` 拼装并断言 98 token 全覆盖、`base.css` 454 处 `var(--token)` 零裸色值 |
| `bash scripts/run-smoke.sh`（双实例全新 /tmp 库 → `api-smoke.sh` ⓪~⑩ 共 11 节） | **pass=253 fail=0**；`api.db`/`-shm`/`-wal` 实测 `-rw-------`；令牌不出现在日志（`grep -c "$TOKEN"` = 0） |
| `node scripts/style-shoot.mjs` + `python3 scripts/style-diff.py`（dist 与 preview 两份探针） | 两份均 **失败项：0**；72 项计算样式两两互斥 **54 / 52 / 49** 项，同构 `rowCount=31`、`kpiCount=12`、`badgeCount=17`、`trackCount=2`、`tabCount=3`、`inlineScripts=0`、`inlineStyles=1`、`external=[]`、console 错误 0 全等，首 KPI `¥1.55 万`、首徽标 `已揽收`、首轨迹与首行文本逐字相同 |
| `node scripts/ui-check.mjs`（10 节 × 3 主题） | dist 托管 **pass=93 fail=0**；修完读侧竞态后同一实例重跑仍 93/0 |

UI 里真实走完的闭环：切主题 → 表头排序并回写 `aria-sort` → 空令牌时开单按钮 `disabled` → 运费试算拿到「北京 → 哈尔滨 应收 ¥121.91」并核对体积重与续重档 → 非法试算回显 400 字段错误 → 连开两张真单（列表首行即新单、总额与快照逐字段一致）→ 揽收 → 干线 → 异常挂起（备注回显）→ 恢复 → 退回终态并核对锁定提示 → 新增规则/启停并核对徽标与下一单报价差值 → 服务端搜索 `%` 不被当通配符（0 命中）→ 全程零外部请求、控制台零报错。

## 本轮抓出的真缺陷（应用侧 6 处，全部已修）

1. **CORS 前缀匹配等于没匹配**：`strings.HasPrefix(host,"127.0.0.1")` 会让 `http://127.0.0.1.evil.example`（真实可达域名）拿到 `Access-Control-Allow-Origin`。改 `url.Parse` + 主机名精确比对（`localhost`/`127.0.0.1`/`::1`）+ `net.ParseIP(...).IsLoopback()`，绝不放行 `Origin: null`；Go 侧把 `http://localhost:5173.evil.example`、`//localhost:5173`、`http://evil.example/?o=http://localhost` 全列成必须拒绝。
2. **落库时间混了本地偏移，`ORDER BY` 变成字符串排序**：种子从 `time.Now()`（本机 +08:00）写库，而写路径用 `UTC()`，库里同时出现 `2026-09-26 07:47:48+08:00` 与 `2026-09-25 23:47:54+00:00`——同一瞬刻，字符串却分出先后，「最新下单」永远排在旧单后面。修法：**`Seed` 入口把 `now` 归一为 `.UTC()`**，并加断言 `booked_at NOT LIKE '%+00:00'` 计数为 0。这个坑只在带本地时区的机器上露头，Go 测试用固定 UTC 时刻反而测不到，是冒烟抓出来的。
3. **清晨跑种子会写出「未来」**：今天那一档按「CST 8~18 点」随机分布，而跑种子时才 CST 7 点。后果不止难看——新开的真单被未来历史单压在下面、异常/签收落在明天。两处补：`dayOffset==0` 时把 `booked_at` 压回 `[当日零点, now]`；轨迹链越过 `now` 就**按比例压缩**（`fitTrackWindow`，保序、留 1 分钟最小间距，签收时间随最后一条轨迹走，所以必须在 `Create` 之前算轨迹）。防复发测试 `TestSeedTimelineNeverInFuture`。
4. **排序回显把内部列名发出去了**（`"sort":"w.total_cents"`），等于替攻击者画库表。`ListQuery` 加 `SortKey`，只回显白名单键名，冒烟断言 `"sort":"w.` 不得命中。
5. **请求体上限缺位**：`TestBodySizeLimit` 原本只断言「状态码 <400 才算挂」，而畸形 JSON 本来也回 400——一个假绿了很久的用例。补 `maxBodyBytes(64<<10)`：声明了 `Content-Length` 直接 413 `body_too_large`，谎报长度的走 `MaxBytesReader` 落在 400 `invalid_request`，两条路径都断言响应里不出现 `request body too large` / `unexpected EOF` / `json:` / `gorm` / `SQLITE` 字样。
6. **表单默认值本身就是产品缺陷**：新增规则的 `heavy_piece` 门槛默认 5000 g，后端下限 10 000 g——照默认点「新增规则」必然 400。UI 套件把它抓了出来（先被误记成「脚本没等回执」）。

## 脚本侧教训（已回写 `state.environment_notes`）

- **详情里的 `events` 是 seq 倒序**（最新在前，Go 测试早写死了这个约定），冒烟却按直觉写 `events.-1`，于是「异常备注」「打卡类型」全指向最旧那条建单轨迹，一次 6 连红。取值一律 `events.0`，不变量断言同步改成「seq 严格递减且唯一、时间不倒流」。
- **冒烟入参要从接口反查，别猜常量**：`⓪` 节先按 `?status=`/`page_size` 筛出样本（线路码、运单号、规则 ID），拿不到就 `exit 1`；本轮靠它避开了「页里没有该状态样本 → URL 塌成空运单号 → Gin 301 → 断言读到 `Moved Permanently`」这条第 10 轮踩过的链。
- **`grep -c "access-control-allow-origin: http://[::1]:3000"` 恒为 0**：方括号被当字符类，本机 IPv6 放行用例永远「失败」。计数一律 `grep -F`。
- **bash 3.2.57（macOS 自带）撑不住三层 `$( )` 嵌套 + 内层引号**：`eq "…" "$(req GET "$(…)")"` 直接 `unexpected EOF while looking for matching '"'`，`bash -n` 还报不出来。所有嵌套调用先把响应/payload 落成变量再断言。
- **UI 提交回执要认「新节点」**：`useAction` 与试算台提交时会把 message 置空（节点卸载后重建），所以「等 `data-kind` 变成 ok」会从上一单的「操作已完成」上读到假绿。做法：提交前给旧 `.form-msg` 打 `data-ui-stale`，只等 `p.form-msg[data-kind=ok]:not([data-ui-stale])`。
- **UI 定位：整块 `hasText` 会被 `<option>` 文案污染**——找「固定额（分）」输入框时，`label.field` 里「计费方式」的下拉文本也含「固定额」，`first()` 选中一个没有 `<input>` 的 label，`fill` 干等 30 秒。改成只按 `.field-label` 自身文案定位。
- **`/api/waybills/`（空运单号）是 301 不是 404**：Gin 把它归一化重定向到 `/api/waybills`。断言要按「不进 handler、不 500」来写，而不是猜一个 404。
- **写接口返回 `{waybill, message}` 信封**，开单返回的却是详情本身：两条取值路径不同，忘了前缀就一路 `<nil>`。

## 遗留（写入 `state.backlog`）

- 单号当日流水靠 `code LIKE` 计数 + 冲突重试，`SetMaxOpenConns(1)` 串行化下安全；放开多连接或换 PG/MySQL 前必须改成序列表（`INSERT ... RETURNING`）或行锁。
- 轨迹链「按比例压缩到不超过 now」是种子侧兜底，真实系统应让扫描时间在写入时落库、由运维重放；否则历史单的时间跨度会被压缩失真。
- `/api/stats` 每次全表聚合（营收、准点率、14 天趋势），150 单量级无感；上万单需要物化日汇总表，口径对账任务同第 10 轮遗留。

## 清理与推送

- 删除：`web/node_modules`（64M）、`/tmp/fwt-ui`、`/tmp/fwt-smoke`、`/tmp/fwt-count` 及全部临时 db/png/json/log；`go build ./...` 未留二进制。保留：源码 + `web/dist/` + `preview/` + `scripts/` + `evidence/` + `README.md`。共享缓存（`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache`）未动，无 `go clean -cache/-testcache`。
- 进程：:18501（`/tmp/fwt-ui/api`）与 :18512（`node scripts/serve-static.mjs`）按端口→PID→`ps -o command=` 核对命令行后 kill（确认都是本轮自己起的），kill 后监听数 0；临时取证实例 :18531 同法清掉。
- 令牌：本地演示令牌存在 macOS 钥匙串（`security find-generic-password -s qoder-fwt-admin-token -w`），只用命令替换注入环境变量，命令行历史与文件、日志里均无明文（已 grep 验证 0 命中）。
- 推送：仅 `go-gin_react` 分支，SSH，提交身份用命令行内联 `-c user.name/-c user.email`（不改全局配置），无 `--force`、无 `--no-verify`、不碰 `main`。
- 一句话教训：**同一份数据在 SQLite 里既当时间又当字符串**——本轮最贵的一课是「所有入库时间必须归一 UTC」，而它只被真 HTTP 冒烟抓到，Go 测试因为用固定 UTC 时刻而全绿。
