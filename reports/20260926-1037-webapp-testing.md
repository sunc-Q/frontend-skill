# 第 11 轮 · webapp-testing（本地 Web 应用测试工具包，anthropics/skills）

- 时间：2026-09-26 10:37–10:50 +08:00（独立会话，三实验室之外的每 30 分钟 skill 演示流水线第 11 轮）
- 技能：`webapp-testing` — "Toolkit for interacting with and testing local web applications using Playwright.
  Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs."
- 来源：**来源②本地已有** — `git@github.com:anthropics/skills.git`，第 3 轮 shallow+sparse clone 到
  `LAB/.skills/anthropic-skills/skills/webapp-testing/`。本轮技能包**零下载、零安装、未碰全局技能目录**。
- 获取命令（复现来源用，本轮不需要重跑）：
  `git clone --depth 1 --filter=blob:none --sparse git@github.com:anthropics/skills.git LAB/.skills/anthropic-skills`
  → `cd LAB/.skills/anthropic-skills && git sparse-checkout disable`

## 为什么选它
它是台账 `next_candidates[0]`，也是前 10 轮里**第一个自带真实实现层脚本**的技能
（`scripts/with_server.py` 105 行 + `examples/` 3 个 Python 样例），而前几轮的规范型技能反复命中同一个缺陷：
市场镜像只搬 SKILL.md、丢 scripts/references（第 6 轮 4 个文件全缺、第 10 轮包内仅 1 个文件）。
本轮正好反过来：有脚本，那就把脚本本身当被测对象之一。

## 安全闸门（执行前读全文）
`with_server.py` 105 行已通读：`subprocess.Popen(shell=True)` 启动**我自己给的**服务器命令、
`socket.create_connection(('localhost', port))` 轮询就绪、`subprocess.run(args.command)` 跑我的脚本、
`finally` 里只 terminate/kill **它自己 spawn 的那几个 PID**。零网络外发、零文件写入、不读凭据、不碰全局配置。
examples/*.py 共 105 行，全是 `page.goto/screenshot/console` 示例。→ 通过。
运行期副作用被限制在：127.0.0.1:8137/8138 两个只读静态服务（serve LAB 内的目录）+ headless Chrome，收尾全部回收。

## 本轮跑的小任务（贴合它的设计意图）
用它自己的流程对**第 3 轮 algorithmic-art 产物** `demos/20260925-1810-algorithmic-art/art-index.html`
做一次端到端回归 —— 这是该产物 11 轮以来第一次**经 HTTP 服务**被打开（此前都是 file://）。

按其 SKILL.md 的决策树与「reconnaissance-then-action」：
1. `with_server.py` 起服务（先单服务跑 golden，后**双服务**同时供 golden + 变异体，验证它宣传的 multi-server 能力）；
2. 侦察 DOM：现场发现 5 个 range / 3 个 color / 1 个 number / 6 个 button，**断言里不写死任何默认值**（reset 断言用的就是这份现场快照）；
3. 采集 console / pageerror / 全部请求；
4. 真交互：点按钮、派发真实 `input`/`change` 事件（不直接调页面函数）、`expect_download`；
5. 断言读**画布像素统计**（240×240 降采样后 ink / 通道和 / 唯一色 / 强红 / 强蓝五元组），不看缩略图；
6. **双变异自证**（沿用第 10 轮确立的验收范式）：造两个坏副本，确认断言真的会红。

## 结果：golden 15 PASS / 1 FAIL（36.5 秒），两个变异体各自把故障局限在正确的断言上

| 断言 | golden | mutant_seed | mutant_wiring |
|---|---|---|---|
| G1 HTTP 200 + 标题 | PASS | PASS | PASS |
| G4 控件现场发现（5/3/1/6） | PASS | PASS | PASS |
| G5 canvas 1200×1200 且非空白（ink 17557） | PASS | PASS | PASS |
| G7 同种子 regenerate 两次全等 | PASS | PASS | **PASS（关键：未被牵连）** |
| G8 nextSeed 改变画面 + 输入框 | PASS | **FAIL** | PASS |
| G9 previousSeed 精确复原 | PASS | **FAIL** | PASS |
| G10 非法种子回滚不伤画面 | PASS | **FAIL（级联）** | PASS |
| G11a/b 滑杆接线（perLane、passes 40→220 墨量 2212→9218） | PASS | PASS | **FAIL ×2** |
| G12 color1=#ff0000 强红像素 0→36 | PASS | PASS | PASS（updateColor 未变异） |
| G14 cadence 0 vs 1 画面不同 | PASS | PASS | **FAIL（两态同哈希）** |
| G13 resetParameters 复原 9 项默认 | PASS | PASS | PASS |
| G15 downloadPNG → 真 1200×1200 PNG 落盘 2,023,119B | PASS | PASS | PASS |
| G2 零未捕获 pageerror / G6 请求全同源 | PASS / PASS | PASS / PASS | PASS / PASS |
| **G3 零 console error** | **FAIL** | FAIL | FAIL |

变异体（`build_mutants.py`，锚点计数≠1 即拒绝构建；只写进 gitignored 的 `.tmp/serve/`，**golden 产物一字节未改**）：
- `mutant_seed`：`params.seed = params.seed + 1;` → `+ 0;` ⇒ G8/G9 红，符合预期；G10 是**级联**（种子已漂到 20260924，回滚断言的期望值不再成立）——诚实记录：一条变异可以带出相邻断言的连锁失败，判故障范围时要看方向而非只数红条数。
- `mutant_wiring`：从 `updateParam` 里删掉 `initializeSystem();` ⇒ G11a/G11b/G14 三条接线断言同时红，而 **G7/G8/G9 三条仍绿**（regenerate/种子按钮各自仍会重绘）。这正是「结构变异」想要的定位性。
- 截图层面的铁证：golden 的 `02-color1-red.png`(82592a41…) ≠ `03-cadence0.png`(2200f418…)，
  而 mutant_wiring 的两张 **sha256 完全相同** ⇒ cadence 拖动了但画面根本没重绘。见 `shots/`、`shots-mutant-wiring/`。

## 唯一 FAIL 是一条真缺陷（且此前 10 轮任何方法都看不到）
`G3` 报 `Failed to load resource: 404`。**http.server 自己的访问日志**给出决定性证据：
```
"GET /art-index.html HTTP/1.1" 200 -
code 404, message File not found
"GET /favicon.ico HTTP/1.1" 404 -
```
即：产物没有 `<link rel="icon">`，一旦被**HTTP 服务**（而不是 file://）打开，浏览器就去请求 `/favicon.ico` 并吃 404。
- **一行修复已 A/B 验证**：加 `<link rel="icon" href="data:,">` 的副本 ⇒ console_errors=0、服务端零 404；未加 ⇒ 1 条 404。
  本轮**不改第 3 轮产物**（越界），修复建议留在报告里。
- **触发条件是下载导航，不是页面加载**：负对照 `probe_favicon.py` 只加载不下载 ⇒ 两个目录都 0 error；
  一旦点 `downloadPNG()`（A/B 脚本里点了）404 必现。
- **方法学增量（写进台账）**：`page.on('request')` / `page.on('response')` **看不见浏览器发起的 favicon 取回**
  ——本轮 16 条请求事件里只有 1 条文档请求，`>=400` 响应 0 条，同源断言 G6 因此是「假绿的风险」。
  任何「零外链 / 网络卫生」类断言，只要产物被 HTTP 服务，就必须**同时看服务端访问日志**，不能只信 Playwright。

## 环境增量（最重要的三条）
1. **Python Playwright 路线在本机打通**：`python3 -m pip install --target LAB/.tmp/pylibs --no-cache-dir
   --index-url https://mirrors.aliyun.com/pypi/simple playwright` → playwright 1.63.0（+greenlet/pyee）**6.1 秒装完**，
   再 `chromium.launch(headless=True, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')`
   —— **完全不需要 `playwright install` 下载浏览器**（CDN 被 TLS 重置这条长期限制被绕开）。
   ⇒ 此前判定「依赖 pip 的技能先当作不可用」的候选（canvas-design / slack-gif-creator / pdf-* 全家桶 / 本技能）**重新变为可选**。
2. `page.fill()` 对 `input[type=number]` 直接抛 `Cannot type text into input[type=number]` → 只能用
   `el.value = ...` + `dispatch_event('change')`（顺带证明：给 number 输入框塞 `abc` 后浏览器读回的 `.value` 是空串，
   页面自己的 `parseInt` 守卫把它回滚成 20260925，画面 sig 不变 ⇒ G10 是有效的守卫测试而非无效断言）。
3. JS 箭头函数**解构实参必须加括号**：`([id, v]) => {}`，写成 `[id, v] => {}` 时 `page.evaluate` 抛
   `Malformed arrow function parameter list`（本轮第一次运行整轮中断于此，第 4 条断言之后才暴露）。

## 技能本身的评价
- **它自称干什么**：本地 Web 应用的 Playwright 交互/测试/截图/日志。
- **兑现程度**：`--help` 黑盒用法照抄即跑通；单服务与**双服务**（`--server … --port … --server … --port …`）都可靠，
  就绪轮询真的挡在命令之前，`finally` 清理经 `lsof` 复核干净（8137/8138 无残留监听）。
  决策树 + 「先 networkidle 再侦察」+ 三个 examples 是**能直接照抄的最小路径**，不是空话。
- **缺陷 / 代价**：
  (1) 100% 绑定 **Python** Playwright，`scripts/` 里没有任何 Node 降级路径；
  (2) `examples/` 三个样例（34/39/32 行）都只用 `file://` 或单页最小场景，
      **没有一个示范 console/网络卫生断言**，也没示范截图对比与像素断言——本轮的 16 条断言全是我补的实现层；
  (3) `with_server.py` 把服务器 stdout/stderr 接成 `PIPE` 且**从不读取**：http.server 的访问日志（本轮恰恰靠它定位 404）
      被吞掉了。要拿到它，只能像本轮一样另起服务自留日志，或改脚本 —— 这是技能脚本本身的一个可改进点；
  (4) 无自带 checker/报告器：产物格式（通过/失败汇总、断言清单）完全靠调用方设计。
- **结论：留用（推荐）**。理由：它是本流水线第一个「脚本拿来就能用」的技能，`with_server.py` 值得直接吸收进后续任何
  需要「起本地服务再验」的轮次（例如候选清单里的 golang-gin-api / pm-dashboard），且它把 Python 生态的门打开后，
  依赖 pip 的候选一下子全活了。它不是「零实现层」——**是前 10 轮里实现层最实在的一个**。

## 复现步骤（从零重建产物）
```sh
LAB=/Users/apple/Documents/workProject/试验/skill演示场
cd "$LAB"
# 0) 依赖（6 秒，全在 gitignored 的 .tmp/pylibs 内，收尾删除）
python3 -m pip install --target .tmp/pylibs --no-cache-dir \
  --index-url https://mirrors.aliyun.com/pypi/simple playwright
export PYTHONPATH=$PWD/.tmp/pylibs
# 1) 造两个变异副本（锚点数≠1 会直接拒绝；golden 只读）
python3 demos/20260926-1037-webapp-testing/build_mutants.py
# 2) 双服务 + 三套断言（golden / mutant_seed / mutant_wiring），约 2 分钟
python3 .skills/anthropic-skills/skills/webapp-testing/scripts/with_server.py \
  --server "python3 -m http.server 8137 --bind 127.0.0.1 --directory demos/20260925-1810-algorithmic-art" --port 8137 \
  --server "python3 -m http.server 8138 --bind 127.0.0.1 --directory .tmp/serve" --port 8138 \
  --timeout 25 -- sh demos/20260926-1037-webapp-testing/run_all.sh
# 3) favicon 404 的 A/B 与负对照
python3 demos/20260926-1037-webapp-testing/ab_favicon_fix.py
python3 demos/20260926-1037-webapp-testing/probe_favicon.py
```
（`run_all.sh` 里三个 suite 的输出已在 `output.log`；产物目录已按第 6 步清理，只留可直接打开的 PNG 与日志。）

## 产物（demos/20260926-1037-webapp-testing/，4.1MB < 5MB 限）
- `download-golden.png` — **2,023,119B / 1200×1200 真 PNG**，由页面自己的 `downloadPNG()` 经 Playwright 捕获落盘，
  双击即看。sha256 `9740465f90cd…66e7513`（四次独立运行同一摘要 ⇒ reset 后画面文件级可复现）。
- `shots/01..04.png` — golden 的 4 张画布元素截图（baseline / color1-red / cadence0 / cadence1）
- `shots-mutant-wiring/01,03.png` — 变异体的截图铁证：01 与 03 **与 golden 的对应文件同哈希**，而 02→03 在该变异下不变 ⇒ cadence 失灵
- `output.log` — 三套 16 断言原文 + 服务端访问日志证据 + A/B + 哈希对照 + 7 个 PNG 的逐块 CRC32 完整性复核
- `e2e_art.py` / `build_mutants.py` / `run_all.sh` / `ab_favicon_fix.py` / `probe_favicon.py` / `verify_artifacts.py` — 最小复现脚本（verify 零依赖，pip 删完仍能自证）
- `result-*.json` ×3 — 逐断言机读结果（含现场发现的 defaults 快照）
- `favicon404-access.txt` / `access-ab-plain.txt` / `access-ab-fixed.txt` — 404 定位与修复验证的服务端原始日志（后缀必须 .txt：.gitignore 的 `*.log` 只放行 `demos/**/output.log`）

## 踩的坑（除上文三条环境增量外）
1. **第一次运行在第 4 条断言后整轮崩**（箭头函数解构），而 `with_server.py` 的 `finally` 仍把服务停干净了 ——
   反向证明了它的清理承诺；但也因此**日志尾部才是 traceback**，grep 断言行时别被「Starting server」那段的顺序误导。
2. 判「变异体该红哪几条」要**按按钮/函数级**而不是按断言号：`updateParam` 被砍不会影响 `updateColor`，
   所以 G12 在 mutant_wiring 里 PASS 是**正确行为**，不是漏报。
3. 断言的期望值一律从**侦察快照**取（G13 复原的 9 项默认全部现场读自 DOM），否则换一台机器/换默认参数就会假 FAIL。
4. 元素截图（`locator(...).screenshot()`）比全页截图小得多且不含侧栏噪声，是做「同哈希 ⇒ 未重绘」比对的合适粒度；
   但注意它量的是**显示尺寸**（本轮实测 620×621 px 的 CSS 盒，canvas 原始 1200×1200），不是 canvas 原始分辨率——
   原始分辨率由 G15 的下载 PNG 覆盖（1200×1200）。两者互补，都要留。
5. `.tmp/serve` 与 `.tmp/pylibs` 都被 .gitignore 排除；变异体**不入库**，靠 `build_mutants.py` 现造（锚点自证）。
   另踩一次 .gitignore 的 `*.log`：三份服务端证据日志差点被挡在库外（`!demos/**/output.log` 只放行 output.log），
   已改名 `.txt` 入库，`ab_favicon_fix.py` 同步改写出文件名。
6. 收尾用**零依赖**的 `verify_artifacts.py` 复核 7 个 PNG：PNG 签名 + IHDR 尺寸 + **逐块 CRC32** + IEND，
   再加 4 条跨运行事实断言（golden 02≠03 / mutant 03==golden 02 / 两者 01 相同 / 下载摘要匹配）—— 全 PASS。
   pip 依赖删掉之后仍能自证，这一层值得后续任何出图轮次照抄。
