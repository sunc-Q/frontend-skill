# 第 14 轮 · 2026-09-26 17:45 — 灯塔票务 · 本地活动票务与核销台（event-ticketing-checkin）

## 选题与去重

- 场景是本轮现想的**本地演出票务 + 现场核销**：一个小型 Livehouse 厂牌卖一个场次的票，前台要出票、闸口要验票、临时取消要退票。业务承重墙不是「增删改查」，而是两条容易被偷懒掉换顺序的判定优先级——**核销必须先裁入场窗口再裁票态**（场次已取消/未到开门时，一张已入场的票也不该拿到 `already_used`），**退票必须先裁订单态→票态→截止时刻**（有人已入场就不能整单退）。同一套页面三种互斥风格。
- 开工前核对 `state.json`：`used_scenarios` 13 项（`saas-subscription-admin` … `secondhand-marketplace`），无 `event-ticketing-checkin`；`used_styles` 39 项与本轮三套（丝绒影院售票亭 / 航海图罗盘 / 老式打字机稿件）逐一比对无重合，三者原封在 `next_style_candidates` 里预置，本轮用掉后已从候选摘除（余 13 个）。
- 磁盘：开工 `df -k .` 可用 **15,150,064KB≈14.4GiB**（85% 已用），高于 1.5GiB 熔断线，允许重构建；收工 15,145,244KB≈14.4GiB。

## 交付

`sites/event-ticketing-checkin/`：backend（Go module `etk`，`cmd/api` + `internal/{domain,repository,service,handler,server}`，16 个 .go / 3 个 _test.go）、web（7 个 .ts/.tsx + 3 份 `theme-*.css` 共 2,487 行 + `web/dist/assets/app.js` 307,974B）、preview（三套单文件版 308,576 / 308,578 / 308,586B）、scripts（9 个）、evidence（18 份计算样式快照 + 3 张整页截图 + class 全集 + 4 份验证日志）、README 24K。清理后场景目录 **3.0M / 75 文件**（软上限 5MB）。

**口径唯一算法在后端**，前端只渲染接口字段，页面里没有一处写死的业务数：

- 4 张表：`events`（8 态字段：开门/开演/迟到宽限/预售截止/退票截止/状态…）、`ticket_types`（配额与 `sold_quantity`，条件 UPDATE 扣减）、`orders`（金额拆分 `subtotal+fee=payable`、退款拆分 `refunded+retained=payable` 快照）、`tickets`（票面由订单派生，`valid/used/void` + 入场闸口与时刻留痕）。
- 三张状态机：场次 `draft → on_sale → closed`（旁路 `cancelled`，终态不可回）、票档 `open ↔ paused`、订单 `pending → paid → refunded`（旁路 `cancelled`）。表外跃迁一律 409。
- 核销裁决 `TicketVerdict`：**窗口层**（`event_cancelled` / `not_on_sale` / `event_closed` / `doors_not_open` / `gate_shut`）先出，未通过就直接返回，**票态层**（`already_used` / `ticket_void`）后判；闸口另有一层 `gate_required` / `gate_unknown`。
- 退票裁决 `RefundVerdict`：`already_refunded` / `order_cancelled` → `partially_used` / `partially_void`（票面一旦动过就不整单退）→ `past_cutoff`。退票只退票面、服务费留存（`retained_cent`），退款额与留存额都是接口算的，前端只回显。
- 早鸟立减按**万分比**（`early_bird_bps`）+ 预售截止时刻判定，全链路整型（分、万分比），杜绝浮点漂移；`sold_out`（配额不足）在事务内条件扣减失败时返回。
- 8 条恒等式由 `/api/stats` 全表自检并以 `identity_ok` / `identity_issues[]` 发布、页脚原样回显：Σ配额占用 = valid+used 票数、票态覆盖全量、每单金额拆分配平、退款+留存=实付、无超卖、票数=购买张数、已入场票有闸口与时刻、手机号格式。
- 安全口径：5 个写接口挂在单个 `ADMIN_TOKEN` Bearer 后面，未配置 → **503 `server_misconfigured`**（fail-closed，读接口不受影响），缺头/非 Bearer → 401，不匹配 → 403（`crypto/subtle.ConstantTimeCompare`，scheme 大小写不敏感）；请求体 16KB 两道闸（中间件 Content-Length + `MaxBytesReader`）；CORS 只放行精确 loopback 源、`Origin: null` 一律拒；`q` 按 rune 截断并转义 `%`/`_`；`sort`/`dir` 只取白名单映射且**不回显列名**；`page_size` 硬上限 100；错误统一 `domain.AppError{Code,Message,Err}`，对外绝不回显 `err.Error()`；`/api/*` 一律 `no-store`；CSP `script-src 'self'`（三风格靠 `?raw` 运行时注 CSS，故 `style-src` 保留 `'unsafe-inline'`）。

种子（随机源固定 `20260926`，仅空库灌入）：8 场演出（1 草稿 / 4 在售 / 2 已散场 / 1 取消）、20 个票档、约 60 笔订单、150 张票，覆盖三张状态机的每条边。**种子里每张票的状态、每次核销的闸口、每笔退款金额都是调服务层同一套判定函数算出来的**，所以灌完数据 `identity_ok` 就是 `true`。两条铁律写在文件头注释：所有落库时间一律 UTC；确定性种子必须对当前墙钟做边界检查（否则清晨跑批时「此刻开门」的场次会整段消失）。库文件三件套 `-rw-------`，`Harden()` 在种子写入后再压一遍；DSN `journal_mode(WAL)&busy_timeout(5000)&foreign_keys(1)&txlock(immediate)` + `SetMaxOpenConns(1)`。

## 接口清单（12 个）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 无 | 存活探针，同样 `no-store` |
| GET | `/api/stats?days=14` | 无 | 唯一聚合出口 + 8 条恒等式自检结论 |
| GET | `/api/events?status=&q=&sort=&dir=&page=&page_size=` | 无 | 场次列表（含票档概要、倒计时口径字段） |
| GET | `/api/events/:code` | 无 | 场次详情 + `ticket_types[]` |
| GET | `/api/orders?status=&event=&q=&…` | 无 | 订单台账（手机号只出掩码） |
| GET | `/api/tickets?status=&event=&gate=&q=&…` | 无 | 票面台账 |
| GET | `/api/tickets/:code` | 无 | 单票详情（闸口验票前的读侧） |
| POST | `/api/admin/events` | Bearer | 新建场次（含 6 个时刻字段校验） |
| POST | `/api/admin/events/:code/status` | Bearer | `{action: open\|close\|cancel}` 状态机 |
| POST | `/api/admin/sales` | Bearer | 出票：扣配额 → 建单 → 派生票面，单事务 |
| POST | `/api/admin/tickets/:code/check-in` | Bearer | 核销：裁决表原样回显，拒绝也回 200+verdict |
| POST | `/api/admin/orders/:code/refund` | Bearer | 退票：票面退、服务费留存 |

## 校验结果

| 项 | 结果 |
| --- | --- |
| `gofmt -l .` / `go build ./...` / `go vet ./...` | 全空 / 全绿（收工复跑再确认一次） |
| `go test -count=1 ./...` | 三包全 ok：`domain` 0.37s / `repository` 2.37s / `server` 10.97s（**31 个 Test**，表驱动覆盖字段校验、鉴权 401/403/503、注入与超长、状态机正反跃迁、核销与退票裁决优先级、种子自洽与恒等式） |
| `npx tsc --noEmit`（strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`） | 0 错误 |
| `npx vite build` | `dist/assets/app.js` 307,974B（`cssCodeSplit:false`，三份主题 CSS 以 `?raw` 打进同一份 JS） |
| `node scripts/api-smoke.mjs <实例> <无令牌实例>`（真 HTTP，双实例） | **327 通过 / 0 失败**，九节：读端点与字典 → 参数夹取与排序白名单 → 鉴权矩阵（含 Basic 不算数、`RAW:` 前缀） → 建场次/开售 → 售票（含 40KB→413、注入串、非法 UTF-8） → 核销裁决全分支 → 退票与配额回补 → 无令牌第二实例的 503 段 → 全量响应泄露总扫 + 写后对账仍 `identity_ok` |
| `node scripts/render-probe.mjs <SPA> <API> velvet nautical typewriter`（真浏览器 ×3 主题） | **42 通过 / 0 失败**：现场用 admin 接口造一个带恶意自由文本的靶子场次 → 出票 → 在 UI 里按编号/按购票人/按票号各查到唯一一行 → `<img src=x onerror=alert(1)>` 的 `innerHTML` 是 `&lt;img …&gt;` 纯文本、`#root` 内 img/script/iframe/object/embed/onerror 属性计数全 0 → 资源条目全同源 → 无 JS 异常与控制台报错 |
| `node scripts/style-evidence.mjs`（dist 托管与 preview 单文件托管各一遍 × 3 主题 × 6 页签） | 45 项断言全 PASS：两两计算样式互异 **31 / 36 / 37** 项（底色、字体族、字号、圆角、字距、边框、阴影）+「同主题自比必须 0 差异」反证；页面用到的 **76 个 class 三份 CSS 全覆盖**；三份主题结构字段（行/卡/页签/徽标/内联 style/外链）逐字节同构；零外链、零 console 报错 |
| 截图 | `evidence/shot-{velvet,nautical,typewriter}.png`（CDP `Page.captureScreenshot`，整页） |

`evidence/verify-{api-smoke,render,style-spa,style-preview}.txt` 保留三组完整输出，`probe-<theme>-<tab>.json` 18 份是原始计算样式快照。

## 三套风格论点

| | 丝绒影院售票亭 velvet | 航海图罗盘 nautical | 老式打字机稿件 typewriter |
| --- | --- | --- | --- |
| 论点 | 深红丝绒 + 烫金描边 + 灯泡跑马边框，把「买票」当成一件有仪式感的事 | 海图蓝底 + 经纬网格 + 罗盘玫瑰，把「场次」当航线来读 | 机械打字 + 等宽铅字 + 回格线与色带印痕，把台账当稿件 |
| 底色 | 酒红/暗金 | 海图蓝/纸白 | 灰白纸张/黑墨 |
| 字体族 | 衬线（含中文衬线回退） | 无衬线 + 数字等宽 | 全等宽 |
| 圆角/边框 | 大圆角 + 双线描边 | 直角 + 网格分隔线 | 直角 + 虚线色带 |
| 表头 | 金字居中 | 蓝底白字左对齐 | 下划线 + 打字机字距 |
| 装饰 | 跑马灯泡、票券撕口 | 罗盘玫瑰、等深线 | 回格线、色带印痕 |
| 源文件 | 811 行 / 注入后 12,298 字符 | 834 行 / 13,551 字符 | 842 行 / 13,138 字符 |

三者是**同一份 `App.tsx`（1,226 行）+ 同一份 JS**，只有这三份 CSS 不同；切换靠 `themes.tsx` 把选中的 CSS 文本注入 `<style id="etk-theme">` 并写 `documentElement.dataset.theme`，优先级 `?theme=` > `window.__THEME__` > localStorage。

## 抓到的问题与坑

1. **校验代码与它的错误文案不同源**：`domain.ValidPhone` 只判「11 位数字」，`query.go` 的字段回显却承诺「1 开头（次位 3-9）」——用户照文案理解到的规则比实现严。补校验为 `1[3-9]`，并给表驱动用例钉住（不松文案）。
2. **跨轮复用的取证脚本必须按本轮契约重写**：`render-probe.mjs` 是从第 13 轮继承的，选择器 `#f-q`、`.detail-main`、`/tmp/fleaprobe`、handoff JSON 全是旧契约，第一次跑满屏 null，症状完全像前端坏了。
3. **注入靶子放错字段**：购票人白名单只收字母数字与 `-_`，`<img src=x onerror=alert(1)>` 被 400 挡在门外——那是校验生效，不是取证成功。载荷改放场次名称/场馆/备注这类真正接受自由文本的列，其余字段给合规 ASCII。
4. **`tickets` 元素是对象**：取 code 写成元素本身 → `[object Object]` → 404 + 两条 console noise 假失败。冒烟入参要从接口取字段、别猜形状。
5. **异步筛选的列表断言**：「存在含目标值的行」在 React 还没重渲染时立刻通过（读的是上一份数据）。改成 `settledOn`：**恰好 1 行且该行含目标值**；同一页面还挂着第二张 `.table`（票档详情子表），探针必须限定 `[...document.querySelectorAll('.table')][0]`。
6. **fail-closed 段打到主实例**：503 断言用了绑 `base` 的 fetch 闭包，请求带着「无 Authorization」打到有令牌实例 → 401；期望码还写成没实现的 `admin_disabled`。改成该节自带 `npost`/`nget` + 以 domain 常量为源的 `server_misconfigured`。
7. **误改后回滚**：认定 `App.tsx` 把 `tickets` 对象直接渲染并动手改，随后发现上游 `setCreated({tickets: res.tickets.map(t => t.code)})` 已归一为字符串。改代码前先读调用点。
8. **工具侧**：本轮 Bash 工具多次返回 `Tool execution failed: [unknown]`（同一命令重试即成功），node-repl MCP 兜底查过一次监听表；`zsh` 通配无匹配（`rm -f prev*`）会中止整条链式命令，清理一律列精确文件名。

## 从零复现

完整命令在 `sites/event-ticketing-checkin/README.md` 的「从零重建」一节（含 npm registry、GOPROXY、`ADMIN_TOKEN` 占位符、`nohup` 起服务、四条验证命令与可选的无令牌第二实例）。要点：

```bash
# 后端（Go 1.27，纯 Go 驱动无需 CGO；-o 用绝对路径，别在旧二进制上验证）
cd sites/event-ticketing-checkin/backend
GOMODCACHE="$HOME/go/pkg/mod" GOPROXY=https://goproxy.cn,direct go build -o /tmp/etk-api ./cmd/api
export ADMIN_TOKEN='<自造随机串>'   # 只经环境变量注入，绝不写进文件
nohup /tmp/etk-api -seed -db /tmp/etk.db -addr 127.0.0.1:8080 >/tmp/etk.log 2>&1 &

# 前端（registry 必须 npmmirror）
cd ../web && npm i --registry=https://registry.npmmirror.com
npx tsc --noEmit && npx vite build && node ../scripts/inline-preview.mjs

# 四条验证
cd .. && ADMIN_TOKEN=… node scripts/api-smoke.mjs http://127.0.0.1:8080 http://127.0.0.1:8081
ADMIN_TOKEN=… node scripts/render-probe.mjs http://127.0.0.1:8080 http://127.0.0.1:8080 velvet nautical typewriter
node scripts/style-evidence.mjs          # dist 与 preview 两种托管
```

## 收工终值与推送

- 清理：`web/node_modules`、`evidence/chrome-profile`、`/tmp` 下本轮全部临时目录与产物（二进制、库三件套、日志、探针、截图）删除，编译产物不留在场景目录；共享缓存（`~/Library/Caches/go-build`、`~/go/pkg/mod`、`~/.npm/_cacache`）一律未删，全程无 `go clean -cache/-testcache`。
- 进程：本轮端口 `:18901-:18904`、`:18907`、`:18908` 与 CDP `:19833-:19862`，逐个「端口 → PID → `ps -o command=` 核对命令行」后 kill；收工 `lsof -iTCP -sTCP:LISTEN -nP` 无本轮残留，也没有遗留的 headless Chrome。
- 记录回写：`state.json`（`used_scenarios` 14、`used_styles` 42、`tried` 14、`runs` 第 14 条 `20260926-17`、`environment_notes` 6 条、`backlog` 5 条、`next_style_candidates` 摘掉本轮三名）、`records/work-log.md` 追加第 14 轮一行、本报告。
- 磁盘：LAB **112M**（`.git` 约 16M）；场景目录 **3.0M / 75 文件**；`df -k .` 可用 15,145,244KB≈14.4GiB（85% 已用）。
- 推送：结果见紧随其后的收工审计提交与 `state.json.runs[13].push`（本行写于推送之前）。

## 留痕

`sites/` 下另有三个**不属于本任务**的未跟踪目录（`clinic-appointment-desk`、`charity-donation-progress`、`recruitment-ats-pipeline` 65M 含未清理 node_modules），像中途停掉的并行实例。本轮未提交、未删除、未改动，只在此留痕；提交只 `git add` 自己的路径，绝不 `git add -A`。
