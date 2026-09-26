# 第21轮 · terminal-session-replay（终端会话录制与重放）

- 时间：2026-09-26 15:35–16:00 (+08:00)
- 技能：`terminal-session-replay` v1.0.0，author「skill-factory」
- 来源：Qoder 官方扩展市场 `official_SFz4lDum`（publisher `-`，tags `终端录制/会话回放/开发工具/origin:skillatlas`）
  - `_meta.json` 指向上游：`github.com/openclaw/skills` commit `b4541ea35f4d2e42524b64d506161acd1d5fd9b8`，owner `derick001`
- 获取方式（用户已对本任务文本授权自动安装）：
  1. `search_extensions({kinds:["skill"], query:"terminal"})` —— 单个短词，长短语 0 命中
  2. `install_extension({installRef})`，installRef 约 60 秒过期，现搜现装
  3. 落地 `~/.qoder-cn/skills/terminal-session-replay/`（市场装只进全局目录，无法指定路径）
- 包内文件：`SKILL.md`(4,098B) `README.md`(1,492B) `_meta.json`(301B) `scripts/main.py`(约 19KB)
  —— **实现层真在包里**，这次市场镜像没丢 scripts/。

## 它自称干什么

「录制、重放、导出终端会话，用于调试、写文档、分享给同事」；把自己描述成给标准
`script` 命令「包一层更简单的接口 + 额外功能」。子命令 record / replay / export /
list / info / delete / help；会话以 `<name>.typescript` + `<name>.timing` +
`<name>.meta.json` 三件套存在 `~/.terminal-sessions/`。

## 本轮跑的小任务

按它的设计意图走完整链路：**录一段真实终端会话 → 用技能自己的 CLI 管理 → 导出成文档 →
在浏览器里按时序回放**。会话内容是一串无害的 shell 命令（pwd / ls / date / wc / printf /
sort 一个 heredoc / echo done），12 行输入、每行配一个人为停顿（`pace.txt`）。

产物目录：`demos/20260926-1535-terminal-session-replay/`

| 文件 | 是什么 |
| --- | --- |
| `replay.html` (10,135B) | **肉眼可见的主产物**：单文件终端回放器，深色终端外壳 + 播放/暂停/重启 + 1×/2×/4× 变速 + 进度条点击跳转 + 16 行事件表（点某行即 seek 到该时刻）。录制数据与全部 timing 内联，`file://` 双击即用、零外链。 |
| `deploy-run.typescript` (2,153B) | 真实 pty 抓到的原始终端字节流 |
| `deploy-run.timing` (192B / 16 行) | util-linux 格式 `<delay> <byte_count>`，逐读事件 |
| `deploy-run.meta.json` | 技能 record() 的元数据 schema（标题/描述/标签/命令） |
| `SESSION.md` (2,452B) | 技能 `export` 子命令真实产出的 markdown 文档 |
| `transcript-raw.log` (7.7KB) | 技能全部子命令的逐条真实输出 + 退出码 |
| `output.log` | 39 条断言，39 PASS / 0 FAIL |
| `browser-check.log` | 浏览器回读证据（隐藏标签页下的实测） |
| `record_pty.py` / `build_player.py` / `run-transcript.py` / `verify.py` / `run.sh` / `feed.txt` / `pace.txt` | 最小复现链 |

一键复现：`sh demos/20260926-1535-terminal-session-replay/run.sh`（约 20 秒，全程留在 LAB 内）。

## 安全闸门

`main.py` 通读一遍：零网络、零 token/凭据读取、`subprocess` 只调 `script`/`scriptreplay`/`cat`、
输入校验拒了 `/`、`\`、`..`、控制字符（`../escape` 实测被 `Invalid session name` 挡下）。

**一个必须注意的点**：会话库路径硬编码 `Path.home()/".terminal-sessions"`，CLI **没有任何参数能改**。
本轮第一次调用就忘了改环境，脚本当场在真实 `~/.terminal-sessions/` 建目录并写了一个文件——
立刻核对（目录 mtime 就是那一秒、里面只有我刚写的那个文件）后删掉。**结论：跑这个技能必须先
`HOME=<LAB内沙箱>`**，run.sh 和 verify.py 都强制这一点。

## 踩的坑 / 技能的真实缺陷

1. **record 在 macOS 上根本跑不起来（致命）**。它拼的是
   `script --quiet --timing <timing> <typescript>` —— 纯 util-linux 语法。macOS 的 BSD `script`
   实测只有 `usage: script [-adkpqr] [-t time] [file [command ...]]`，直接
   `script: illegal option -- -`。SKILL.md 的 "Limitations" 却写着
   "Requires `script` command (available on Linux/macOS…)"、Installation Notes 又说
   "typically pre-installed on Linux and macOS" —— 对**它自己那种调用方式**是错的。
   本轮因此只能自己用 `pty.fork()` 录，绕开它的 record。
2. **replay 也跑不起来**：依赖 `scriptreplay`，macOS 上没有这个二进制
   （`'scriptreplay' command not found. Install it via your package manager.`）。
   也就是说它主打的两个功能在本机全废，只有 `--no-timing`（内部走 `cat`）那条退路能用。
   浏览器播放器就是补这个洞。
3. **所有错误路径都 `exit 0`**。record/replay 失败时它打印 `{"status":"error", ...}` 但
   `main()` 不看结果直接返回，进程码 0。`record x && next` 这种 shell 链、以及 CI，都会把它当成功。
   实测 11 个子命令退出码全 0（含 4 个明确的失败场景）。
4. **`get_session_duration()` 读错字段 → 导出的文档在撒谎**。timing 是逐事件**增量**，
   总时长应当 `sum(delays)`；它取的是**最后一行的第一个字段**：
   `real 11.21s` vs `skill 1.254s`，差 **8.9 倍**，`export` 出来的 markdown 头部赫然写着
   `**Duration:** 1.3 seconds`。这条被断言 E5 专门钉住（断言的是「bug 仍在」，技能一旦修好它会变红）。
   同一个字段没法同时满足 `scriptreplay` 和「时长」两种语义，所以这不是口径之争而是实现错。
5. **带点号的会话名会撞车**：`validate_session_name()` 允许 `.`，但 `get_session_paths()` 用
   `Path.with_suffix('.typescript')`，会把最后一个点号后的部分整个吃掉——
   `v1.2` 和 `v1` 都解析到 `v1.typescript`。两个不同会话静默共用同一份录制。实测
   `collision(v1.2, v1) = True`。
6. **我自己的坑（p 到工具链）**：`pty` 录制脚本收尾时 `os.waitpid()` 永久阻塞——交互模式 `/bin/sh`
   按 POSIX **忽略 SIGHUP**，第一版发完 `exit` 就再也等不到回收，进程挂了 2 分钟才用 `sample` 定位到
   `__wait4`。修成 `WNOHANG` 轮询 + `SIGTERM → SIGKILL` 兜底后 7 秒干净退出。
   另外第一版把人为停顿删了，12 条命令挤在 0.70 秒里，回放等于闪屏——补 `pace.txt` 后 11.2 秒。
7. **隐藏标签页里 `requestAnimationFrame` 完全不触发**（`document.hidden === true`，`shown` 停在 0，
   按钮却已经翻成 "Pause"）。本任务的浏览器面板恒为隐藏，所以「看起来能播」的产物在这儿等于不能播。
   加了 `document.hidden` 下的 `setInterval(step)` 兜底（`step()` 读墙钟，两个驱动同时跑无害），
   之后隐藏态实测自动播到第 9 个事件。
8. `evaluate_script` 在这个页面上会**间歇性 15 秒超时**（回放循环每 tick 重写 `#screen`），
   单个取值 `getComputedStyle(...)` 连试三次红两次，而节点计数稳定。拆成「一次一个值 + 允许重试」才拿到全部证据。

## 效果结论：**不推荐（本机）**

理由一句话：**它在 macOS 上唯一能跑的路径是 `replay --no-timing`（也就是 `cat`）**——record 和
带时序的 replay 这两个招牌功能全挂，还能把会话库写到你家目录里、把错误全报成退出码 0、
导出的文档时长差 9 倍。产物好看，是本轮自己写 pty 录制 + 播放器换来的，不是技能给的。

值得留的部分（可复制到我自己的工具链，不是留用技能本身）：
`<name>.typescript` + `<name>.timing` 这对 util-linux 格式确实是通用「终端录像」载体，
一次录制 → 文本导出 + 浏览器回放 + 事件表 seek 三种产物；`record_pty.py`（真实 pty 采集 +
SIGTERM/SIGKILL 兜底回收）和 `build_player.py`（内联 timing 的单文件回放器）可以直接搬去下一轮做
「命令行操作教程」类产物。**若日后要真用这个技能，前提是 Linux（util-linux）环境。**

## 附带副作用与处置

`sys.path.insert(...) + import main` 会在**全局技能目录**里落一个 `scripts/__pycache__/main.cpython-314.pyc`
（技能文件本身是 0600 只读装的，写入照样成功），本轮已删掉它并在 `run.sh` 顶部加
`export PYTHONDONTWRITEBYTECODE=1`；`skills/terminal-session-replay/` 快照随之回到 4 个文件、
`chmod -R a-w`（manifest 的 `read_only` 由 `os.access` 实测，为 true）。

## 下一轮可接的线索

- 同仓库 `openclaw/skills` 里同类「CLI 包装器」技能很多，**共同风险是市场只搬 SKILL.md、
  装进来才发现实现层缺失或平台锁死**——本轮反过来：实现层齐、平台锁死。选这类技能时，
  先看它 `subprocess` 里拼的命令在 darwin 上存不存在，再决定跑不跑。
- 产物类型缺口仍在：`.mp4` 视频、`.ics` 日历、字体。`majiayu000-infographic-generator-p5`
  （vis-network JSON → 交互式 p5 信息图）仍是 next_candidates 第一条。
- `record_pty.py` 已经能录任意脚本化终端会话，`build_player.py` 已能把它变成可分享页面：
  下轮若做「CLI 教程 / 安装过程留档」类产物可直接复用这条管线（不占新技能轮次）。
