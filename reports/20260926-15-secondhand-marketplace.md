# 第 13 轮 · 2026-09-26 15:40 — 旧货市集撮合台（secondhand-marketplace）

## 选题与去重

- 场景取自 `state.next_candidates` 的「二手交易平台撮合」，落地成**旧货市集的挂单—出价—拍板撮合台**：摊主摆一件旧货（挂牌价 + 保底价），买家反复改价竞争，运营替摊主拍板成交或拒绝，成交后挂单锁定。同一套页面三种互斥风格。
- 开工前核对 `used_scenarios` 12 项，无 `secondhand-marketplace`；`used_styles` 36 项与本轮三套（地铁线路图导视风 / 旧货手写价签风 / 黑胶唱片封套风）逐一比对无重合。收工已把候选里的「黑胶唱片封套」（与本轮同题）从 `next_style_candidates` 摘掉并补 3 个新名，避免下一轮换个字复用同一论点。
- 磁盘：开工 `df -k .` 可用 16,967,784KB≈16.2GiB（84% 已用），远高于 1.5GiB 熔断线；收工 16,544,172KB≈15.8GiB（复跑 Go 编译后略有波动，末次实测 16,809,264KB）。

## 交付

`sites/secondhand-marketplace/`：backend（`cmd/api` + `internal/{domain,repository,service,handler,server}`，16 个 .go）、web（7 个 .ts/.tsx + 3 份 `theme-*.css` 各约 675-681 行 + `web/dist/assets/app.js` 287,621B）、preview（三套单文件版各 ~288,220B）、scripts（9 个）、evidence（api-smoke / style-verify / render-probe 三份日志 + 三份计算样式快照 + 三张整页截图）、README 160 行。清理后场景目录 **3.6M / 58 文件**（软上限 5MB）。

**口径唯一算法在后端**，前端只渲染接口字段，页面里没有任何写死的业务数：

- 挂单四态机 `available → reserved → sold`，旁路 `withdrawn`；表外跃迁一律 409（`listing_sold` / `listing_reserved` / `listing_withdrawn`）。
- 出价五态 `pending / accepted / rejected / expired / outbid`，出价带 `floor_cent ≤ amount_cent ≤ asking_cent - 1`（顶价即 409 `above_asking`，低于保底即 `below_floor`，同买家改价须 ≥ `MinIncrementCent = 2000` 分＝¥20，否则 `increment_too_small`）。
- `OfferTTL = 24h`：有效期在**拍板时**才判定（`offer_expired`），过期同时把该单其余 pending 标 `expired`；`best_offer_cent` 不跟「最新出价」走，一律按「pending 且未过期」的 `MAX(amount_cent)` 重算，`is_best` / `rank`（`ROW_NUMBER()`）同理只在 live pending 上成立——这样「拒绝顶价后最优价自然回落」才是可断言的行为。
- 三条 GMV 恒等式由 `/api/metrics` 全表自检并以 `identity_ok` 发布、页脚原样回显：`sold + reserved == deals_total`、`gmv_cent == Σ by_category.gmv_cent`、`listings_total == Σ by_category.listings`。
- 安全口径：写接口单 `ADMIN_TOKEN` Bearer，未配置 → **503**（fail-closed），缺头 → 401，不匹配 → 403（`crypto/subtle`），Basic 不算数；两道请求体闸（中间件 Content-Length 413 + `MaxBytesReader`，上限 16KB）；CORS 只放行精确 loopback 源、`Origin: null` 一律拒；`q` 按 rune 截断 64 且 `escapeLike` 连 `%` 与 `_` 一起转义；`sort`/`dir` 只从白名单映射取列名；`page_size` 硬上限 100；非法 UTF-8（含裸 CESU-8 字节）400；错误统一 `domain.AppError{Code,Message,Err}`，对外不回显 `err.Error()`；卖家手机号性质字段无（本场景无个人信息列），新增 CSP 头。

种子：5 品类（各带参考价 `ref_cent`）/ 48 条挂单（四态齐备，前 14 条手写、专门钉住「恰等于保底价」「零出价」「只有过期 pending」「成交低于保底」等分支）/ 82 笔出价。库文件 `-rw-------`，DSN 带 `journal_mode(WAL)`、`busy_timeout(5000)`、`foreign_keys(1)`、`txlock(immediate)`，`SetMaxOpenConns(1)`。

## 校验结果

| 项 | 结果 |
| --- | --- |
| `go build ./...` / `go vet ./...` / `go test -count=1 ./...` | 全绿：`domain`、`repository`、`server` 三包（**23 个 Test**，表驱动覆盖字段校验 11 例、鉴权 503/401/403、状态机正反跃迁、注入与超长、CORS 矩阵、种子自洽、安全头/CSP） |
| `gofmt -l .` | 收工复跑时**发现 3 个文件不合格式**（seed.go 与两个 `_test.go` 的手写注释对齐），`gofmt -w` 后重跑 `go test -count=1 ./...` 仍全绿 |
| `tsc --noEmit` / `vite build` | 0 错 / `dist/assets/app.js` 287,621B（`cssCodeSplit:false`，三主题 CSS 以 `?raw` 打进同一份 JS） |
| `node scripts/api-smoke.mjs`（真 HTTP，双实例：给令牌 + 不给令牌） | **123 通过 / 0 失败**，A~H 八节：读端点与口径 → 详情 `is_best`/`rank` → 鉴权矩阵 → 建单（含 40KB→413、CESU-8→400、注入形卖家名 201 且原样存） → 出价状态机 → 拍板 → CORS 与安全头 → 全局泄露总扫（56 条 4xx 全部符合 `{code,message}` 契约，0 条泄露） |
| `node scripts/style-verify.mjs`（dist 与 preview 两种托管各一遍） | **失败项 0**：DOM 同构 `853713233/len6085` 三主题逐字节相等（两种托管还彼此相等，等于顺带验了内联打包不改结构）；39 项计算样式两两互斥 **36 / 31 / 31** 项 + 「同主题自比必须 0 差异」反证；71 个页面 class 在三份 CSS 里全覆盖；零外链；无 JS 异常与控制台报错 |
| `node scripts/render-probe.mjs`（真浏览器 ×3 主题） | **30 通过 / 0 失败**：`<img src=x onerror=alert(1)>` 留言与 `a' OR '1'='1` 卖家名都只成文本节点，`#root` 内 img/script/iframe/object/embed 计数全 0，单元格 `innerHTML` 是 `&lt;img …&gt;`；注入形卖家名按字面查到唯一一行；`performance` 资源条目全同源 |
| 截图 | `evidence/style-{transit,tag,vinyl}.png`（1440×2214 / 3694 / 2590，CDP `Page.captureScreenshot`） |

## 抓到的问题

1. **theme-tag / theme-vinyl 漏写 `.theme-text` 与 `.theme-icon .swatch` 规则**——元素掉回浏览器默认值。计算样式两两差异依然充足、肉眼看截图也不违和，只有「页面 71 个 class 必须在三份 CSS 里都命中」这条断言抓得到。补规则后重建。
2. **GORM 事务里 `return AppError` 会把同事务刚写的 `expired` 状态一起回滚**，库里永远留一笔翻不了身的僵尸 pending。改法：事务内只写状态并 `return nil`，出事务后再构造 409（`expiredID` 模式）。
3. **`best_offer_cent` 直接写新出价金额会变小**（挂单上可能已有更高 pending）→ 一律 `MAX(amount_cent)` over live pending 重算。
4. **品牌位曾按当前主题换 SVG 图形**，DOM 哈希当场不一致（6264/6252/6254）→ 色卡只用 `currentColor` 与 `fill`，图形分支与 theme 无关。
5. **取证侧**：`.table tbody tr` 没排除嵌在页面里的 `.table.mini`（详情报价表、成交板），搜出一行却量到 12 行，误判搜索失效；Gin 路由层对畸形路径吐纯文本 400，与处理器 JSON 契约必须分两层断言；`escapeLike` 若只转 `%`，搜 `_` 会把全表捞出（本轮实测命中 13/51 且全是真含下划线的行）。

## 环境与工具结论（已回写 `state.environment_notes`）

- **browser-use 面板本机反复 15s 超时**（页面本身没问题）。改成系统 Chrome `--headless=new` + 自研 60 行 CDP over WebSocket 客户端（Node 内置 `WebSocket`，零 npm 依赖）后三主题抓取约 3 秒；截图走 `Emulation.setDeviceMetricsOverride` + `Page.captureScreenshot`。**Chrome CLI 的 `--screenshot` 循环不可用**：同 user-data-dir 连开三个实例，第二个起卡死 >300s。
- `zsh` 通配无匹配（`rm -f /tmp/x.db*`）会中止整条链式命令，症状是「脚本没报错但服务根本没起」；清理要列精确文件名。
- React 受控输入的无头驱动：native value setter + `dispatchEvent(new Event('input',{bubbles:true}))`，直接赋 `el.value` 不进 state。
- 三风格靠运行时注 CSS → CSP 的 `style-src` 必须留 `'unsafe-inline'`，`script-src` 收紧到 `'self'` 后 SPA 仍正常，别顺手把 style 也收紧。

## 收工终值与推送

- `git status` 余 **3 项**，全是不属于本任务的未跟踪目录（见文末留痕）；本轮 4 条路径已在 **1d4fc5a**（61 文件 / +18,165 行）。
- 磁盘：LAB **109M**（`.git` 16M，其中非本任务的 `sites/recruitment-ats-pipeline` 占 65M 且含未清理的 node_modules，本轮未动）；场景目录 **3.6M / 58 文件**；`df -k .` 可用 16,836,236KB≈16.1GiB。
- 清理：`web/node_modules`（64M）、`/tmp/fleaprobe` 全树（三个库三件套 + 两个 chrome profile + 验证输出）、`/tmp/flealab/api`（38M 编译产物）、`/tmp/dbg.mjs` 全删，`ls /tmp | grep -i flea` 命中 **0**；:18080/:18081/:8080/:18193 四个监听按「端口 → PID → `ps -o command=` 核对命令行」确认后 kill，收工监听数 **0**；另有一个别的会话起的 `--headless=new --no-sandbox --virtual-time-budget=4000` Chrome，识别后未动。共享缓存（`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache`）一律未删，全程无 `go clean -cache/-testcache`。
- 收工复跑取证：`go build ./...` / `go vet ./...` / `go test -count=1 ./...` 三包全绿（23 Test）；`gofmt -l .` 首跑报 3 个文件（seed.go + 两个 `_test.go` 的手写注释对齐），`gofmt -w` 后重跑测试仍全绿；`style-verify` 在 dist 与 preview 两种托管上各复跑一遍，失败项 0（逐条原文已存 `evidence/style-verify.txt`）。
- 推送：`git ls-remote` 见远端 `go-gin_react` 已在 7b0c7f0（正是本地父提交）→ `git fetch origin go-gin_react` → `git rebase FETCH_HEAD` 返回 up to date（无改写、无冲突）→ `git push origin go-gin_react`，远端 **7b0c7f0..1d4fc5a**。提交身份用命令行内联 `-c user.name/-c user.email`（未改任何全局 git 配置），无 `--force`、无 `--no-verify`、未碰 `main`；staged diff 正则扫 secret/token 命中 0，`api-smoke.mjs` 用法注释里的示例令牌已改成 `$ADMIN_TOKEN` 占位。

## 留痕

`sites/` 下另有三个**不属于本任务**的未跟踪目录（`clinic-appointment-desk`、`charity-donation-progress`、`recruitment-ats-pipeline`，像中途停掉的并行实例，风格仍是早期轮次的）。本轮未提交、未删除、未改动，只在本条留痕；提交仅 `git add` 自己的路径，绝不 `git add -A`。
