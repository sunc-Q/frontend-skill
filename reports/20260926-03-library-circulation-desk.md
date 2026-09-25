# 第 9 轮 · 2026-09-26 03:58 — 苍岚图书馆 · 流通工作台（library-circulation-desk）

## 选题与去重

- 场景来自 `state.next_candidates` 里的「图书馆馆藏与借阅」，落地为**单张流通台**的值班视角：借出登记 / 归还结算 / 续借 / 台账 / 读者查询 / 馆藏结构。
- 开工前核对：`used_scenarios` 8 项无 `library-circulation-desk`；`used_styles` 24 项与本轮三套（乐高积木块面 / Risograph 孔版印刷 / 解构主义拼版）做过子串比对，无相邻改名嫌疑。
- 环境判定读盘而非假设：`df -k` 开工可用 19,642,680KB≈18.7GiB，远高于 1.5GiB 熔断线。

## 交付

`sites/library-circulation-desk/`：backend 144K（`cmd/api` + `internal/{domain,repository,handler,server}`）、web 516K（含 dist）、preview 924K（三套单文件版）、scripts 92K（11 个）、evidence 40K、README 1 份；清理后场景目录 **1.7M**（上限 5MB）。

业务口径的唯一算法落在 `internal/domain`：`CatRules`（普通 28d/50分/封顶20元、大字本 42d/30分/12元、盒装 14d/100分/40元、参考工具书不外借）、`FineFor = min(天数×费率, 封顶)`、`FineGateCents=3000`、`MaxRenewals=2`、`MemberQuota`（8/12/5）。逾期费只在归还瞬间结算并写进 `loans.fine_cents`，之后不随时间重算——详情接口把 `fine_due`（实时预估）与 `fine_cents`（快照）并列返回，正是为了让「不回溯」这件事在响应体里可被断言。

隐私：`Member.Phone` 带 `json:"-"`，对外只有 `phone_masked`；不变量脚本对 35 类响应断言 `"phone"` 键绝不出现。

## 校验结果

| 项 | 结果 |
| --- | --- |
| `gofmt -l .` / `go vet ./...` / `go test -count=1 ./...` | 空 / 0 / 三包全绿（domain、repository、server 各含表驱动用例：字段校验、鉴权 401/403、注入与超长） |
| `tsc --noEmit` / `vite build` | 0 错 / dist 313KB |
| `scripts/run-smoke.sh`（双实例全新库 + `api-smoke.sh`） | **pass=212 fail=0**，0 条 FAIL |
| `scripts/check-read-invariants.py` | pass=18（另含 20 组排序键 × 双向扫描） |
| `scripts/style-diff.py evidence/style-probe.json` | **失败项：0**；互斥 53/50/47 项，同构 8 字段 + 文案取样全等，零外链、零 console 错误 |
| `scripts/ui-check.mjs` | **pass=19 fail=0**：真浏览器完成「填表 → 借出 201 → 检索选中 → 归还 → 快照核对」，并验证无令牌时写按钮禁用、切风格后业务 DOM 671 节点逐节点同构 |

## 本轮抓出的真缺陷（全部已修）

1. **`by_category` 的 `LEFT JOIN loans` 把复本数放大**：实测类别合计 237 册 vs 真实 40 册。改为复本数与在借数各自先聚合再回接书目；不变量脚本新增「类别合计 == total_copies」钉住它。
2. **趋势只覆盖有流水的日子**：`GROUP BY day` 的稀疏序列让「近两周」在空白天误导读者。改成按 `days` 生成连续日历、无数据填零。
3. **`identity_issues` 序列化成 `null`**：Go 的 nil slice 输出 `null`，前端 `map` 会炸 → 初始化 `[]string{}`。
4. **`-wal/-shm` 权限漏压**：`Open()` 里 chmod 时伴生文件还不存在（首次写入才出现），库文件 0600 而 WAL 仍是 0644 → 新增 `repository.Harden`，`Seed()` 之后再压一遍；`run-smoke.sh` 末尾把三件套权限打进日志（实测 `-rw-------`）。
5. **续借门槛顺序**：逾期 + 次数用尽同时成立时先报 `renew_exhausted`，馆员拿到的是没用的答复 → 逾期优先，并补一条 `repo_test` 钉住顺序。
6. **API 缺 `Cache-Control`**：借阅与读者数据被中间缓存会给出旧账 → `securityHeaders` 对 `/api/` 前缀统一 `no-store`。

## 脚本自身的坑（应用行为没错，是断言写错）

- **`bearer <tok>` 小写方案名是合法的**（RFC 7235，实现用 `EqualFold`）。第一版按 401 断言，结果这条"负向用例"真的借出去一本书，级联把 `copy_unavailable`、`fine_gate`、201 借出、续借顺延全部带偏。教训：**鉴权探针必须走不会写库的路径**——改用不存在的借阅单，404 才算穿过鉴权。
- **macOS 自带 bash 3.2 解析不了 `$( ... <<'PY' ... PY)`**：命令替换里的 heredoc 直接语法错误。所有 Python 逻辑落成真实脚本文件（`probe-samples.py` / `check-read-invariants.py` / `free-barcodes.py` / `list-active-loans.py`），顺带可单独复跑。
- **`body_of`/`status_of` 在 `set -u` 下不能同时被位置和管道调用**：`req … | body_of | jget …` 会因 `$1` 未绑定中断，改成 `if [[ $# -gt 0 ]]` 双形态。
- **写型冒烟不可重放**：借出去不还，同一库第二轮会「把在架借空而没借满配额」，学生证配额断言变误报（种子只有 7 册非参考书在架）。新增 `run-smoke.sh`：每轮起全新 /tmp 双实例（:18401 带令牌 / :18402 不带令牌做 503 断言），跑完按端口→PID→核对命令行才 kill；配额段落先归还该读者旧单、并在样本不足时明确指向 `run-smoke.sh` 而不是静默失败。
- **UI 断言不能拿文案总长当结构同构**：归还后重取数据会让数字位数变化（22030→22420 字符），而结构其实没变。改为「排除装饰 swatch 的标签+class 节点序列」+ 行/KPI/徽标计数。

## 三风格

`base.css`（1037 行，只允许 `var(--token)`）+ `tokens-{lego,riso,decon}.css`（各 84 个变量）由 `derive-themes.py` 拼装；缺 token 或 base 里漏出裸色值/`rgba(` 即失败——「只换 CSS」从口号变成构建期约束。派生顺序是 token 在前、base 在后，因此 token 文件里的气质补丁只能设 base 未设的属性（base 一律用 `background-color` 而非 `background` 简写，就是为此）。

## 遗留

- `decon` 风格下台账列宽偏挤（衬线字宽把「条码」列压成三行），是观感问题不是缺陷，未动结构层。
- 种子只有 7 册非参考书在架，配额类断言天然依赖干净库——已用 `run-smoke.sh` 收口，但下一轮若加新写接口，记得同时看种子饱和度。
