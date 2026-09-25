# 工作流水账 · 有趣 Skill 快速验证（每 30 分钟）

格式：`时间 | skill | 来源 | 跑的是什么小任务 | 产物路径 | 效果结论`
只追加，不改历史行。

---

2026-09-25 17:23 | drafter（技术图表生成，v1.0.0，publisher yofine） | Qoder 官方扩展市场 official79532076，经 install_extension 安装到 ~/.qoder-cn/skills/drafter/ | 用 Flat Engineering Blueprint 风格把**本任务自身的三实验室定时流水线**画成一页图：3 条 cron 时间槽（:00 前端 / :20 业务 / :05+:35 本任务）+ 10 步单轮执行流 + 安全闸门 6 条 + 文件化记忆台账 5 项 + 去重契约 3 条 + 分支隔离与推送约束。内容全取自本轮真实读到的 state.json 与任务规约 | demos/20260925-1723-drafter/skill-lab-pipeline-blueprint.html（15KB 单文件，零 JS 零外链，双击可开）+ output.log（3 轮断言原文） | **留用**。安全闸门直接通过（纯提示词/样式规范，无脚本无网络无写盘）；风格约束具体到 CSS 变量级 + 禁止清单级，产物确实像工程图纸而不是又一个营销落地页；禁 CDN 写进 Critical Requirements → 天然自包含，适合无人值守。局限：不含数据→图形映射，数据可视化仍需另配图表技能。踩坑：(1) 先试 diagram-drawing(official_EbWhzKaL) 被 EXTENSION_SKILL_FRONTMATTER_INVALID 拒装——市场里 origin:skillatlas/modelscope 未精选条目包体本身不合法，优先挑带 OfficialSelection 标签的；(2) **本 skill 自己的示例 CSS 有缺陷**：`repeat(6,1fr)` 因 `1fr`=`minmax(auto,1fr)` 被 min-content 顶住，六步流程条实测 72/63/71/45/45/97px 不等宽，恰好违反它自己第 5 条「必须严格对齐」，须手写 `minmax(0,1fr)`——只有跑产物 + 计算样式断言才暴露得出来；(3) 本任务 Full Access 下 install_extension **不触发**用户确认闸门（与兄弟实验室 auto 模式结论相反），但 installRef 约 60 秒过期，必须现搜现装；(4) search_extensions 对多词短语返回 0 条，单个英文词根才有结果；(5) .gitignore 的 `*.log` 会吃掉要求留档的 demos/**/output.log，已加反选例外。验证法（下轮沿用）：IDE 面板 viewport=0×0 时，用 `position:fixed;left:-99999px;width:1200px` 离屏容器 + 720/860/1024/1280/1600 宽度扫描做确定性布局断言，比只看计算样式更强。磁盘可用 20.0 GiB；demos 本轮 20KB；零残留进程与监听。
