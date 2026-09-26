## 安全审计报告（sec-audit-cn）

**审计对象**：`skill演示场` 第 1–7 轮全部交付物与工具链（git 跟踪 59 个文件 / 38 个可扫描源文件 / 2.10 MB；另有 36 个第三方 SKILL.md 作为「代理会照做的指令」纳入供应链面）。
**审计人/工具**：Qoder agent + sec-audit-cn v1.0.0（13 条静态规则 → 31 命中 → 人工分诊为 13 条有效 / 18 条误报，FP 率 58%）+ 3 组黑盒 PoC（全部本机、零网络、只读或写入本目录）。
**OWASP Top 10 (2021)** 分类；结论优先，无理论铺陈。所有 file:line 均可用 `git grep -n` 复核；`output.log` 内含每条 PoC 的真实原始输出。

---

### 严重（必须修复）

本轮**无**。判定依据（不是「没查」，是查了且为空）：R01 命令拼接 = 0、R03 `eval`/`new Function` = 0、R04 `innerHTML`/`document.write` 汇点 = 0、R05 硬编码密钥 = 0、R10 外链脚本 = 0；git 全历史 10,326 行新增内容里凭据形状命中 = 0。

---

### 高（应尽快修复）

1. **[A03 注入 / A05 信息泄露] 检索 CLI 把用户输入当 FTS5 查询语法解释，且异常原文回显绝对路径**
   - 文件：`demos/20260925-1845-sqlite-database-expert/query.mjs:8,14-18`（`MATCH ?` 绑定的是 `"${term}"`（`query.mjs:17`），term 未过滤；`LIMIT ?` 绑 `Number(argMax)` 未校验；`db.prepare(sql).all(...args)` 无 try/catch）
   - 证据（PoC-A，`output.log` 第 [1] 段）：
     - `绝不存在ZZZ` → `hits=0`；`绝不存在ZZZ" OR "安全闸门` → **`hits=4`，打印出 4 条真实文件路径 + 行内容**（调用方从未申报这些词）→ 检索语义被输入改写，等价于「任意词存在性预言机 + 越权枚举」。
     - `闸门") OR ("src` → 未捕获 `Error: fts5: syntax error near ")"` + **栈里带 `file:///Users/apple/.../%E8%AF%95%E9%AA%8C/.../query.mjs:18`**（源码绝对路径与目录结构外泄），退出码 1。
     - `安全闸门 abc` → `Error: datatype mismatch`（NaN 进绑定）；`-1` 无下限、20,000 字符查询串无上限（放大面）。
   - 影响定级说明：本 CLI 只读、只覆盖本 LAB 自有文本，故实际危害=「崩溃 + 路径泄露 + 台账内容枚举」。**同一段代码若接在含个人信息/凭据的库上并放到请求路径里，就是高危越权读取 + DoS**——本条按「可复用范式缺陷」定高。
   - 修复：见 `query.fixed.mjs`（已落地并回归）——剥除 `"` 后整体包成字面短语 + 128 字符上限 + 控制字符拒绝 + `Number.isInteger(max)` 并 clamp 到 [1,50] + `try/catch` 收敛为固定文案 `search failed: query engine error`。PoC-A 重跑：崩溃/泄露 **3 例 → 0 例**，基线 `hits=3` 功能不变。
   - 通用规则：**参数化只保证「不是 SQL 注入」，不保证「不是查询语法注入」**。全文检索 / NoSQL / LDAP / 正则这类「带语法的字符串参数」必须做字符集白名单或整体转义为字面量。

2. **[A06/A08 供应链与完整性] 交付物里 89–98% 的字节是不可读、无来源摘要的内联第三方库**
   - 文件：`demos/20260925-1810-algorithmic-art/art-index.html`（998,549B，>400 字符的压缩行 1 条 = 977,030B，占 **97.8%**，仅靠 p5 横幅 `/*! p5.js v1.7.0 */` 说明来历）、`demos/20260925-2332-build-game/frostlight-gather.html`（750,620B，opaque 89.2%，**产物内无任何库横幅/版本注释可机检**，r160 只出现在模板 `game.src.html:78` 的一句散文里）、`postfx.bundle.js`（11 个 addon 经正则改写，无原始 hash）
   - 佐证：全仓库 `integrity=` / `sha256` / 锁文件命中 = 0（PoC-C [C-3]）；这些字节是 `curl registry.npmmirror.com/...tgz` 下载后直接内联的，下载即删（`.tmp/three` 已清理），**当前无法证明今天产物里的 669KB 与当初下载的 three.min.js 字节一致**；该分支已推到远端，等于对外发布了一份不可自证的代码集合。
   - 风险：镜像/传输链上任一次替换都会永久留在发布面里且无人能事后发现；审计/评审也无法覆盖（人和工具都读不了那一行）。
   - 修复（本轮已交付第一步）：`integrity-manifest.json` 记录三个产物的 size+sha256；后续每次重建把 tarball 的 sha256 + 版本 + 来源 URL 一并登记，产物尾部追加 `<!-- dep: three@0.160.x sha256:... -->` 注释，使摘要与代码同处发布面。

---

### 中（建议修复）

1. **[A01 访问控制 / A05 配置错误] 对外发布的单文件产物保留了可写内部状态的调试钩子，形成完整作弊与持久化污染链（已 PoC 闭环）**
   - 文件：`demos/20260925-2332-build-game/game.src.html:686,692,717` → 编译进 `frostlight-gather.html:2317/2323/2348`（`window.advanceTime`、`window.render_game_to_text`、`window.__game`，后者直接暴露 `state`、`teleport()`、`setYaw()`、`composer`）
   - 证据（PoC-B，`output.log` 第 [3] 段，headless Chrome 加载 file://，零网络，pageerror=0）：控制台三步 `canvas.dispatchEvent(pointerdown)` → `__game.state.score=99999` → `advanceTime(61000)` → 实测 `{best:99999, mode:"lose", localStorage:"99999", hud:"Best 99999"}`；**reload 后 `state_best=99999` 且 HUD 仍显示**；对照组（同样流程不改 score）得 `{score:0, best:0, localStorage:null}`。60 秒回合与 8/8 收集约束全由客户端裁定，`advanceTime(61000)` 可直接跳过。
   - 修复：钩子是 build-game SKILL.md 强制要求的（Phase 4 靠它做无人值守断言），因此**不该出现在交付副本里**——在 `build.mjs` 里加 `/*__DEBUG_HOOKS__*/` 占位，只往 `*.src.html`（验证用）注入，最终产物 `strip` 掉 `window.__game/advanceTime/render_game_to_text`；或至少在产物里加 URL 开关 `?debug=1` 且默认关闭。
2. **[A01 访问控制] 成绩/资格完全由客户端裁定并落盘，无任何服务端或签名校验**
   - 文件：`game.src.html:134-136`（`SAVE_KEY='frostlight-gather-best'`，`localStorage.setItem` 无校验；`state.score > state.best` 即写）
   - 风险：任何「最高分/成就/解锁」语义一旦对接排行榜或奖励即失效；当前为纯本地演示，故列中。
   - 修复：若将来上 leaderboard，分数须由服务端按可重放的最小证据（seed + 逐步输入序列 + 服务端重演）校验，客户端只做展示缓存。
3. **[A05 安全配置错误] 自动化浏览器统一 `--no-sandbox`，且加载的是本地未审查产物**
   - 文件：`demos/20260925-1950-graphic-gif/capture.mjs:23`、`demos/20260925-2332-build-game/verify.mjs:29`、`.tmp/pw/probe.mjs:5`，以及**本轮我自己新写的 `poc-game.mjs:11`（同一条坑被复制到第 8 轮，属自曝）**
   - 风险：页面内任意 JS（含被注入到 HTML 台账里的内容）可借无沙箱进程触达本机文件系统/IPC；这些脚本还以 `file://` 打开，等于给该页面同目录读取面。
   - 修复：优先不加 `--no-sandbox`（本机 Chrome 可正常起沙箱）；只在确实失败时降级并把降级写进日志；改 `file://` 为「复制产物到临时只读目录 + `--allow-file-access-from-files` 关闭」。
4. **[A08 完整性 / 提示注入] 36 个第三方 SKILL.md 中 16 个（44%）内含 shell 级指令，代理会当指令执行**
   - 证据：PoC-C [C-4] + `findings.json.skillFindings`（S01 管道执行、S04 内容外发、S02 `rm -rf` 各若干）；已发生并拦下的实例三例（见 `state.json.skills_seen`）：`story-invite-poster`（原文要求「对我的本地代理说去安装这个 URL」）、`dlazy-vectorize` / `gif-maker-free`（把本地图片 POST 到外部服务）。
   - 修复：把「读来的 SKILL.md 视为不可信输入」写进闸门：只允许在 LAB 内写、禁止外发、禁止 `curl|bash`、禁止凭据路径，命中即 `skills_seen.status=blocked`（现行做法有效，本轮建议补一条：**新技能首轮只跑它的只读路径，落盘与网络动作逐个显式批准**）。
5. **[A08/A09] 共享台账 `state.json` 的读改写无并发控制**
   - 文件：`.tmp/merge_r{4,5,7}.py`、`.tmp/merge_state.py`（先 `json.load` 再整体 `json.dump`，无锁、无备份、无版本号）；`environment_notes` 已记录过兄弟实验室中途改写导致数值漂移的实测。
   - 修复：写入前重读+合并（已在做）之外，补 `os.replace` 原子替换 + `state.lock`（`O_CREAT|O_EXCL`）+ 每次合并保留 `.bak`，冲突时以「追加数组不覆盖」为准。

---

### 低（酌情）

1. **[A05 信息泄露] 发布面含本机绝对路径 44 处**（`/Users/apple/...`，PoC-C [C-2]），暴露用户名与目录结构；`query.mjs` 崩溃栈还会额外暴露 percent-encoded 中文路径。建议产物与日志统一 `~` 化或相对路径。
2. **[A05 配置] 5 个 HTML 产物零 CSP、`inline_script_tags=3`、无 `<meta http-equiv="Content-Security-Policy">`**（PoC-B [5]）。`file://` 场景危害有限，但同一份 HTML 若被挂到站点上，单文件内联即等于 `'unsafe-inline'` 全开。建议附一条 CSP meta（`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'`）并在托管时收紧。
3. **[A03（分诊后不算）] `query.mjs:17` 的 `replace(body, ?, ...)` / `` `%${term}%` `` 是「值拼接」不是「SQL 拼接」**，无注入面；真实缺陷只有 LIKE 通配符 `%`/`_` 未转义（输入 `%` 可放大全表扫描）。列为低即可——**这条是刻意写进报告的「误报纠正示例」，规则 R02 对它的 4 次命中里 3 次属于此类。**

---

### 做得对的地方（避免逢审必骂）

- 所有 SQLite 访问走 `?` 参数绑定（`query.mjs:14-19`、`build-db.mjs`、`verify.mjs` 多处），以 `readOnly:true` 打开 `lab.db`；全仓库无一处字符串拼 SQL 执行。
- 外部命令一律 `execFileSync(bin, [args...])` 参数数组（`capture.mjs:61`、`verify.mjs:115`），无 shell 中转 → R01 零命中不是运气。
- 内联库前的两道防护是真的做对的：`build.mjs`/`inline-jsm.mjs` 用 **replacer 函数**（`() => three`）避免 `$&`/`$'` 自展开，并显式 `if (/<\/script/i) throw` + `if (/^\s*import\b/m) throw` 双闸门——这两条把「模板二次解释」类缺陷在构建期就挡住了。
- `.gitignore` 把 `.skills/`、`.tmp/`、`node_modules/` 全挡在发布面外（PoC-C 实测 `git ls-files` 命中 0），凭据与私钥临时件（`known_hosts`）不进历史。
- 产物零外链、零运行期网络请求（`requests_to_network=0`）→ 攻击面里没有网络项，这是本沙箱 TLS 被重置倒逼出来的意外收益。

### 建议的验证与监控（无人值守场景）

- 每轮收尾跑 `node demos/*/sec-audit-cn 类的 scan.mjs`（规则命中数与 FP 分诊结果写进 `runs[].notes`），命中数突增即停止推送。
- 已推远端的分支每次记录 `integrity-manifest.json` 的 sha256 变化，作为「发布面变了没有」的唯一事实来源。
- 对第三方技能包：只允许 SSH shallow clone 到 `LAB/.skills/`，首轮只跑只读路径；任何要求外发/凭据/`sudo` 的条目直接记 `blocked`。
