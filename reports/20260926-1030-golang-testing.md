# 第 10 轮 · golang-testing（Go 测试模式技能）

- **时间**：2026-09-26 10:12 → 10:21（+08:00），实际用时约 9 分钟（含两次重跑 run.sh）
- **skill**：`golang-testing` v1.0.1，author "Joseph OBrien"，status: unpublished
- **来源**：**来源③本机已装**（`~/.qoder-cn/skills/golang-testing/SKILL.md`，427 行，9,963B）。**本轮零安装、零下载、零新增全局副作用**。
- **获取方式**：无需获取。`find` 核对包内文件 = 只有 SKILL.md 一个文件，无 `scripts/`、无 `references/` → 属纯提示词/规范型技能（与第 1 轮 drafter、第 8 轮 sec-audit-cn 同类）。

## 它自称干什么

> "Comprehensive Go testing patterns including table-driven tests, mocking, integration testing, benchmarks, and test organization."

SKILL.md 的十个章节：table-driven（基本式 + 带 error 用例式）、interface-based mocking（接口 + Func 字段型 mock + 用 mock 构造 service）、testify 断言、testcontainers 集成测试、TestMain 与 per-test setup（`t.Helper()` + cleanup 闭包）、benchmark（含 `b.Run` 子基准与 `RunParallel`）、httptest handler 测试、文件组织（`testdata/`、`//go:build integration`）、coverage（`go test -coverprofile` + `go tool cover -html`）、8 条 Best Practices。

## 本轮跑的小任务

贴合设计意图地取「给一个纯逻辑包做完整测试套件」这条主线，落一个**迷宫生成器**（比 Add/Divide 示例更能压出结构性断言，且产物肉眼可见）：

| 文件 | 作用 | 对应 SKILL.md 章节 |
|---|---|---|
| `maze.go` | 完全迷宫生成（迭代随机 DFS 回溯）+ BFS 求解 + 文本渲染。随机源抽成 `Rand` 接口，自带 LCG（不用 stdlib `math/rand`，保证跨 Go 版本/平台可复现） | 接口抽象（mock 的前提） |
| `maze_test.go` | 7 个测试函数 + 2 个基准：表驱动尺寸表、表驱动 error 表（`wantErr/errString` + `errors.Is`）、脚本化 mock（记录每次 `Intn(n)` 的 n 并断言范围与调用次数 19）、golden 文件（`-update` 机制 + `testdata/`）、完美迷宫性质（地板格数 = 2·cells−1、入口到出口**简单路径唯一**、所有地板可达）、Solve 路径连续性（步长恒为 1 且与 DFS 唯一路径等长）、`TestMain` 全局 setup、`t.Helper()`、`t.Parallel()` | 表驱动 / mock / fixtures / 组织 / best practices |
| `maze_integration_test.go` | `//go:build integration` 标签下的写盘-重读往返测试，`-short` 时 `t.Skip` | build tag + `-short` |
| `cmd/maze/main.go` | CLI：`-w -h -seed -solve -out` | — |
| `run.sh` | 一键复现 10 个验证环节 | coverage / bench 命令 |

## 产物

- `demos/20260926-1030-golang-testing/maze-solved.txt` —— **主可见产物**，24×12 格 / 49×25 网格 / seed 20260926 / 解路径 225 步，ASCII 迷宫带 `S`→`E` 的 `*` 解答线，任何编辑器双击即看。
- `.../maze-plain.txt` —— 同种子未解答版（对照）。
- `.../output.log`（9.9KB）—— 真实命令输出全量留档：`go version/env`、CLI 输出、边界错误原文与退出码、`go test -v -coverprofile` 逐测试 PASS、集成测试跑通 + `-short` SKIP 证据、`go tool cover -func` 逐函数覆盖率、基准 4 行数据、**两组变异测试（negative control）**、恢复后全绿、`gofmt -l` 空、`go vet` 两种标签均干净。
- `.../coverage.html`（12.6KB）—— `go tool cover -html` 产物，浏览器双击即开的逐行着色覆盖率报告。
- `.../testdata/*.golden.txt`（3 个）、`.../coverage.out`、`maze.go` / `maze_test.go` / `maze_integration_test.go` / `cmd/maze/main.go` / `go.mod` —— 最小复现集，整轮 92KB（限 5MB）。

## 验证结果

**PASS=29 / FAIL=4，且 4 条 FAIL 全部来自第 8a/8b 节故意制造的变异**（恢复后 `ok skilllab.dev/mazedemo`）。

覆盖率 73.3%（`Generate` / `Draw` / `Solve` 分别 100/100/96%，0% 只有 `main`，因为 CLI 未被测试引用——这是诚实的低值而不是刷出来的 100%）。基准：`size-8` 12.1µs/3.1KB → `size-32` 191µs/48.7KB → `size-128` 2.92ms/783KB（≈线性于格数×1.6 超线性，符合回溯栈+候选切片分配），`SolveParallel` 1.14ms/1.56MB。

**本轮最有价值的两条实证（变异测试）**：
- **8a 值变异**（把 LCG 乘数 1664525 改成 1664526）→ **只有 golden 测试失败**，`TestMazeIsPerfect`、`TestSolve_PathIsContiguous`、mock golden 全部照绿。结论：**结构性断言对「随机源换了」完全盲视**，golden 文件是唯一抓得住它的证据。
- **8b 结构变异**（删掉「打通两格之间门」那一行）→ `TestGenerate_Sizes`、`TestSolve_PathIsContiguous`、`TestMazeIsPerfect` **三条同时失败**。结论：这些断言不是摆设，能抓到真实语义破坏。
- 推论：一个 Go 测试套件只有「golden + 不变量」两层都在时才是可信的，任何一层单独跑都会给假通过。

**coverage.html 浏览器实测**（file:// + browser-use）：title `maze: Go Coverage Report`、2 个 `<pre>` 面板、下拉 2 项、72 个行 span（57 `cov8` 已覆盖 / 15 `cov0` 未覆盖）、`getComputedStyle().color` 实测 `rgb(192,0,0)` vs `rgb(44,212,149)` 确有区分。

## 效果结论：**留用（推荐）**

一句为什么：这是本流水线里少见的「**规范直接可证伪**」型技能——它给的每个模式（表驱动 + `wantErr/errString`、`Func` 字段型 mock、`TestMain`、`t.Helper()`、`//go:build integration`、`b.Run` 子基准、`-coverprofile` → `go tool cover -html`）照抄就能跑，且产物本身就是证据（真实 go test 日志 + 官方工具生成的可打开覆盖率页），零网络零依赖。**局限**：(1) 它是**纯知识技能，没有实现层**，没有任何可执行脚本或 checker，所以「跑它自带的闸门」这一环不存在，验证必须自己设计（本轮自建变异测试就是补这一层）；(2) 它推荐的 testify / testcontainers 在本环境要额外拉依赖（Go 模块走 goproxy.cn 可行，但 testcontainers 需 Docker，本机未探测），无人值守场景默认走 stdlib；(3) 它的 Best Practice 第 2 条 "One assertion per test" 与它自己的表示例（一个 `t.Run` 里断多条）自相矛盾——本轮按「一行为一测试、多断言可共存」执行。

## 踩的坑（供后续 Go 轮次复用）

1. **`countOpen` 用「数 Path 字节」近似「数格子」是错的**：迷宫网格是 (2H+1)×(2W+1)，格子之间的门同样是 `Path`，所以地板格数 = 2·cells−1，另外 `Draw` 会把 `S`/`E` 覆写在两格上 → 裸渲染的 `.` 数 = 2·cells−3。第一版四条表驱动断言因此集体 FAIL。（教训：**先画一遍 5×5 小图再写期望值**，别凭直觉。）
2. **`m.String()` 走的是 `Draw(nil)`**，因此它自带 S/E 标记，不是「未标记的裸网格」——想断言「渲染里没有解答标记」要数 `*` 而不是数字符种类。
3. **`sh run.sh` 里 `` go test -run `^$` `` 的反引号被 shell 当命令替换执行**了，结果 `-run` 参数为空 → 基准一节静默输出 `[no tests to run]`，差点以为基准没写。改 `-run '^NoTestsHere$'` 后 4 行基准正常出现。**POSIX sh 脚本里一律别用反引号做正则。**
4. **`go tool cover -html` 用文字颜色（`.cov0/.cov8 { color: … }`）而不是背景色**：第一次断言读 `backgroundColor` 得到两个 `rgba(0,0,0,0)`，误判成「CSS 没生效」。断言前先 `querySelectorAll('style')` 把规则原文抓出来，再决定读哪个属性。
5. **`LAB=$(cd ../../.. && pwd)` 少算了一层**（demo 目录是 `LAB/demos/<run>`，`../..` 才是 LAB）→ GOCACHE/GOPATH 与 CLI 二进制落到了工作区上级 `试验/.tmp/`（86MB + 2.6MB）。本轮已修正 run.sh 并删除这些**由本轮自己创建**的目录（核对过：`试验/.tmp` 只有 gocache 与 maze 两项、mtime 与本轮时刻一致）。**收尾 `ls` 上级目录确认没有误删他人文件。**
6. **`go vet ./...` 会连带编译 `_test.go`**，因此它同时是类型检查与测试可编译性检查；带 build tag 的集成测试要额外跑一次 `go vet -tags=integration ./...`，否则它永远是死代码（本轮真的跑了两遍）。
7. 环境：Go 1.27.1 在 `/Users/apple/.local/go/1.27.1/bin/go`；纯 stdlib 模块 **零网络**（GOPROXY 完全没用到）；GOCACHE 指到 `LAB/.tmp/gocache` 后首次编译 stdlib 也只花 1–2 秒，86MB 缓存全在 gitignored 目录，不污染 `~/Library/Caches/go-build`（全局那份**未动**）。
8. `evaluate_script` 的 15s 超时再次命中（一次遍历 cssRules、一次多字段探针）；拆成单一目的的小探针后全部返回。面板 viewport 0×0 → 只断言结构与计算样式，不声称看过像素。

## 复现步骤（从零）

```sh
cd demos/20260926-1030-golang-testing
sh run.sh            # 10 个环节全跑，GOCACHE/GOPATH 落在 LAB/.tmp，输出写进 output.log
# 只看测试与覆盖率：
LAB=$(cd ../.. && pwd) GOCACHE="$LAB/.tmp/gocache" go test -v -count=1 -cover ./...
# 重新生成 golden（改了随机源/生成器之后）：
go test -update -run 'Deterministic|MockFirst|MockLast' ./...
# 产物：
go build -o "$LAB/.tmp/maze" ./cmd/maze && "$LAB/.tmp/maze" -w 24 -h 12 -seed 20260926 -out maze-solved.txt
```
