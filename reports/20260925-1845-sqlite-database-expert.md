# 第 4 轮 · SQLite-Database-Expert（数据库实验 / FTS5 全文检索）

- **时间**：2026-09-25 18:45 +08:00（约 18:35 开工 → 18:48 产物定稿，全程 ~13 分钟）
- **技能**：`SQLite-Database-Expert` v2.0.0，author "JARVIS AI Assistant"，risk_level HIGH，tags `[framework, database]`
- **来源**：**来源③本机已装** —— `/Users/apple/.qoder-cn/skills/SQLite-Database-Expert/SKILL.md`（963 行，本轮未安装任何技能、未联网获取任何包）
- **产物类型**：`.db` 二进制数据库 + 可执行检索 CLI + `output.log`（本轮刻意换类，前三轮分别是 HTML 图表 / 纯文本 ASCII 看板 / HTML 生成艺术）

## 它自称干什么

SQLite / libSQL / Turso 全栈数据库专家：SQL 注入防护（参数化查询）、FTS5 全文检索 + 触发器同步、迁移与回滚纪律、WAL 与批量写入性能、EXPLAIN QUERY PLAN 验证、边缘部署（Cloudflare/Vercel/Bun）。给的是 **Rust(rusqlite) / Python(sqlite3) / TypeScript(@libsql/client) 三套代码样板**，无脚本、无可执行实现层。

## 本轮跑的小任务

贴合它的设计意图（"Local data persistence" + "Full-Text Search" + "TDD 验证"）：**把本流水线自己的台账建成一个可全文检索的 SQLite 库**，然后用 14 条断言逐条检验它四张核心主张在本机是否成立。

- `runs` 表 ← `state/state.json` 的 `tried[] × runs[]`（3 行，按 time 关联）
- `notes` 表 ← `records/work-log.md` + `reports/*.md` 逐行入库（181 行，`src:lineno` 唯一）
- 两张 FTS5 外部内容表并列对照：`notes_u61`（技能默认 unicode61）与 `notes_tri`（`tokenize='trigram'`），各带 ai/ad/au 三个同步触发器
- `_migrations` 迁移表 + 两个 up/down 迁移（它的 Migration Discipline 主张）
- `query.mjs`：给词 → 自动按长度选 trigram / LIKE，bm25 排序 + `highlight()` 打标签，输出 `源文件:行号 + 片段`

## 复现步骤（从零重建）

```bash
LAB=/Users/apple/Documents/workProject/试验/skill演示场
cd $LAB/demos/20260925-1845-sqlite-database-expert
node build-db.mjs     # 删旧库 → 建表 → 跑迁移 → 灌台账 → 打印 journal_mode
node verify.mjs       # 14 项断言，同时写 verify-report.txt
node query.mjs "安全闸门" 3
node maintain.mjs     # PRAGMA optimize + VACUUM（§7.1 Pattern 5）
```

零依赖：只用 Node 内置 `node:sqlite`（本机 Node v22.23.2 → SQLite 3.51.3），无 npm 安装、无网络。

## 验证结果：14 断言 / 0 FAIL

| 主张 | 证据（真实数字） | 结论 |
| --- | --- | --- |
| §8 "LIKE for Search 是错误，该用 FTS5 MATCH" | `EXPLAIN QUERY PLAN`：LIKE → `SCAN notes`；MATCH → `SCAN notes_tri VIRTUAL TABLE INDEX 0:M1` | 成立（且首次拿到查询计划级证据，而非口头） |
| §4.4 FTS5 建表 + 触发器 | 删掉 `notes_ai` 后插一行：表里 1 行、索引 `MATCH=0`；`INSERT INTO notes_tri(notes_tri) VALUES('rebuild')` 后 `MATCH=1` | 成立，且证明了**触发器不是可选装饰**——漏一个就静默失同步 |
| §2.1/§4.2 参数化防注入 | `?` 绑定 `'; DROP TABLE runs; --` → 0 行、`runs` 表仍在；同串拼接执行（沙箱 :memory:）→ `sqlite_master` 里 `runs` 消失 | 成立，**且证明了这条规则不是 cargo-cult**（拼接真的会删表） |
| §2.2/§8 `PRAGMA foreign_keys = ON` | OFF 时孤儿 `run_id=424242` 插入成功；ON 时同一行 `FOREIGN KEY constraint failed` | 成立（默认 OFF 是 SQLite 的经典坑，技能确实把它列为常错项） |
| §7.1 P2 "逐行提交慢 100 倍" | 4000 行：逐语句 108.6ms vs 单事务 8.2ms = **13.2×** | **方向成立，倍数量级不成立**（node:sqlite 这里根本没有逐行 COMMIT 开关，100× 无从复现） |
| §4.1/§7.1 P1 WAL 持久 | 只读重开 `PRAGMA journal_mode` = `wal` | 成立（journal_mode 确实随文件持久） |
| §7.1 P5 VACUUM 调度 | `freelist_count=0`，299008 → 299008 字节 | 成立但本轮无事可做（库太新） |

## 最有价值的发现（技能没写、但踩中就会静默出错）

1. **unicode61 分词对中文是「整段一个 token」，不是"支持中文"**。技能 §4.4 建 FTS5 表时**完全没提 tokenizer**，默认 unicode61：
   - `'安全闸门'`：LIKE=4 行，unicode61 MATCH=**3** 行，漏的是 `reports/20260925-1723-drafter.md:17` 的 `## 安全闸门结论`（整串 `安全闸门结论` 是一个 token，前缀查不到）
   - `'p5'`：LIKE=13 MATCH=**12**，漏 `$LAB/.tmp/p5x`；`'ab'`：LIKE=21 MATCH=**0**
   - → 中文自由文本用默认分词会**静默漏检**（本轮台账里漏检率 1/4=25%），且返回 0 行时看起来像"确实没有"，比报错更危险。
2. **`tokenize='trigram'` 能补上，但它自己有新坑**：≥3 字符才可用（`'安全'` 两字词 trigram 直接 0 命中），且 trigram 是**子串匹配**（等价 LIKE），失去词边界与 bm25 的字段权重意义——本轮实测 `'安全闸门'` trigram=4 == LIKE=4。所以中文站要么双索引并行（本轮做法），要么外接 `simple`/ICU 分词。
3. **`highlight(t,…)`/`bm25(t)` 在 FTS5 里不吃表别名**：`FROM notes_tri t … highlight(t,0,…)` 直接 `no such column: t`，必须写真实表名。（普通表可以用别名，这是 FTS5 专属函数的坑，技能示例里恰好是 `d JOIN docs_fts` 用真名，无意中正确，但没说明原因。）
4. **`node:sqlite` 的参数绑定不接受"数组当单参"**：`stmt.all(['%x%'])` → `Unknown named parameter '0'`，必须 `all(...args)`。技能 §7 的 Python 样板 `(email, name)` 直觉一致，但 JS 侧写法不同，无人值守很容易照抄错。

## 包本身的两处文档-实现缺口（与第 1/2 轮同类问题）

- SKILL.md §0 强制要求 "Before implementing ANY database operation, you MUST read `references/advanced-patterns.md` / `references/security-examples.md`"，§5.3 也再次指向 `references/security-examples.md` —— **包里没有 references/ 目录，只有 SKILL.md 一个文件**。等于一半的"必读前置"是死链。（同第 2 轮 ascii-project-dashboard 缺 muscle script：规范指得到，实现层不在包里。）
- §1 声明 **Risk Level: MEDIUM**，但 frontmatter `risk_level: HIGH` —— 自相矛盾，机器读取（frontmatter）与人读正文不一致。
- 全部代码样板是 Rust / Python / TS-@libsql-client，**没有一处能直接跑在本机**（本机没有 better-sqlite3 / @libsql/client，也没有 pip；可用的是 sqlite3 CLI——但它无 FTS5）。真正落地的 `node:sqlite` 路线技能完全没提，属"知识型技能 + 技术栈代差"。

## 效果结论：**留用**

它是本实验室第一份"数据库工程纪律"清单，主张可证伪、且本轮 14/14 全被真实证据支持（包括把它夸大的"100×"缩回成"13×"）。留下来的不是它的代码样板（跑不了），而是三条已验证规则：**FTS5 必须显式选 tokenizer（中文一律 trigram 或双索引）／外部内容表必须配齐三个触发器／`foreign_keys` 每连接打开**。缺点也很实在：references 死链、risk_level 自相矛盾、实现层全是 Rust/Python/libSQL，本机要跑必须自己翻译成 node:sqlite。

## 踩的坑（下轮直接抄）

- **sqlite3 CLI 是 Android platform-tools 的精简构建**：`CREATE VIRTUAL TABLE … USING fts5` → `no such module: fts5`，`PRAGMA compile_options` 返回空。别再假设"有 sqlite3 就有 FTS5"。走 `node:sqlite`（Node 22.5+ 内置，自带 FTS5 + JSON1，仅报 ExperimentalWarning）。
- `new URL('./lab.db', import.meta.url).pathname` 在**中文工作目录**下给出 percent-encoded 路径 → ENOENT，必须 `fileURLToPath()`。（与第 2/3 轮"中文路径工具侧误报"同源，Bash 侧无此问题。）
- zsh 里 `rm -f a* b*` 只要**任一个 glob 不匹配就整体报 `no matches found` 并中断 `&&` 链**——本轮清理临时库时踩到，改成显式列文件名。
- Write 工具会把 JSON 里的 `\"` 落成裸 `"`，嵌在 JS 单引号串内可过、嵌在模板串内就语法错（本轮 2 次：`'rebuild'`、`` r."from" ``）。落 JS 文件时避免在模板串里用引号嵌套。

## 收尾

- demos 本轮 328KB（限 5MB）：`lab.db` 299KB + 4 个脚本 + `output.log`；未新增 node_modules、未编译二进制、未起任何服务（LISTEN 数 11，与开工一致）。
- 已删：`LAB/.tmp/{fk.db,fts-desync.db,bench.db}*`（安全实验的临时副本）、`lab.db-wal`/`lab.db-shm`（干净关闭后）、`verify-report.txt`（内容已在 output.log）、`probe.mjs`（其逻辑并入 verify.mjs）。
- 全局技能库未改动、全局缓存未动、除 LAB 外未修改任何文件。
