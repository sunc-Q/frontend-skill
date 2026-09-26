# skills/ —— 技能快照目录（与产物分开放）

本目录存放本实验室**用过的技能包的本机只读快照**，与 `artifacts/`（产物）、`reports/`（复现文档）分开。
放这里的目的：产物是「依据哪些条款做出来的」的证据，技能原文必须随仓库一起可核对，否则后续运行与读者只能靠台账转述。

- 共 7 个技能、321 个文件、2.37MB（已排除 `__pycache__`、`*.pyc`、`.DS_Store`）。
- **快照为只读**：实验室规程禁止修改本目录之外的技能源，技能迭代通过 Qoder 市场 / `skill-push`（Gitee `giteesunc/agent-work-record`）完成，不在这里改。
- 逐条机器可读清单见 `MANIFEST.json`（含每个技能被用于哪些轮次、文件数、字节数、SKILL.md sha1 前 12 位）。
- 本文件与 `MANIFEST.json` 由 `scripts/gen-skills-manifest.mjs` 现读磁盘生成，**数字不手抄**。

| 目录 | 版本 | 文件数 / 体积 | 用于轮次 | 本机源路径 |
| --- | --- | --- | --- | --- |
| `sites-building/` | — | 111 / 504KB | 7 | /Applications/Qoder CN.app/Contents/Resources/extensions/qoder.sites/cli/sites/skills/sites-building |
| `build-game/` | 1.2.0 | 9 / 193KB | 2 | ~/.qoder-cn/skills/build-game |
| `drafter/` | 1.0.0 | 2 / 6KB | 1 | ~/.qoder-cn/skills/drafter |
| `graphic-gif/` | 1.0.0 | 1 / 12KB | 1 | ~/.qoder-cn/skills/graphic-gif |
| `vercel-react-best-practices/` | — | 1 / 6KB | 4 | ~/.qoder-cn/skills/vercel-react-best-practices |
| `frontend-development/` | — | 2 / 32KB | 3 | ~/.qoder-cn/skills/frontend-development |
| `ppt-generator/` | 1.0.0 | 195 / 1671KB | 3 | ~/.qoder-cn/skills/ppt-generator |

## 重新同步某个技能

```sh
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '.DS_Store' \
  "<上表源路径>/" "skills/<目录名>/"
node scripts/gen-skills-manifest.mjs   # 重生成 MANIFEST.json 与本 README 的数字
```

新增一轮用了新技能：把它的源路径加进 `scripts/gen-skills-manifest.mjs` 的 `SOURCES`，再跑一次上面两条命令。

## 密钥纪律

快照入仓前由 `scripts/gen-skills-manifest.mjs` 逐个文件扫常见凭据形态（`sk-…` / `ghp_…` / `AKIA…` / PEM 私钥头 / Slack token），
本轮扫描结果：**0 命中**。
技能包内出现的 `api_key` / `token` 等字样均为**环境变量名**（如 ppt-generator 的图像后端脚本读 `os.environ`），不含真实值。
任何凭据一律不得进入本目录；命中即须先排除该文件再重新生成清单。
