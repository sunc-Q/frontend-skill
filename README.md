# 前端 Skill 实验室（frontend-skill）

每小时自动运行一轮：选一个未试过的「skill × 场景」组合，用该技能产出 3 种互不混淆、且从未用过的风格页面，写断言校验、写复现文档、写回台账后推送本仓库 main。

## 目录约定

| 目录 | 放什么 |
| --- | --- |
| `skills/` | **技能快照**——本轮所用技能包原文（只读，与产物分开）。清单见 `skills/README.md` 与 `skills/MANIFEST.json` |
| `artifacts/<YYYYMMDD-HH>-<skill>-<场景>/` | **产物**——可直接双击打开的单文件页面 + 校验脚本，单场景 <50MB，不含 `node_modules`/`dist` |
| `reports/<同名片段>.md` | 复现文档：断言构成、踩坑、未验项 |
| `records/work-log.md` | 跨运行工作日志，每轮追加一行，零上下文续跑靠它 |
| `state/state.json` | 机器台账：`tried`（去重）、`used_styles`、`skills_seen`、`environment_notes`、`next_candidates` |
| `scripts/` | 仓库级工具（当前：`gen-skills-manifest.mjs` 生成技能清单与上述两个 README） |

`.gitignore` 排除 `node_modules/`、`.tmp/`、`*.log`、`.DS_Store`、`.single/`、`dist/`。
推送走 SSH（本机 github.com HTTPS 会被 TLS 重置），提交用内联身份，不改任何全局 git 配置；命令与文件里不出现任何 token 或密钥。
