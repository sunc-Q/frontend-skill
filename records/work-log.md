# 工作日志 —— Go/Gin + React 业务网站多风格构建

> **本文档是「每小时业务网站构建」定时任务的跨运行唯一记忆。** 每一轮都在独立会话中运行，不继承任何历史对话，
> 因此：**开工第一件事读完本文件 + `state/state.json`；收工最后一件事追加本轮一行，并把代码与产物推到 `go-gin_react` 分支。**
>
> 行格式：`时间 | 场景(slug) | 3 风格 | 代码目录 | 产物目录 | 结论`
>
> 去重口径（硬约束，判定只依据记录，不凭印象）：
> - 场景是否做过 → `state.json.used_scenarios`（按 slug）；
> - 风格是否用过 → `state.json.used_styles`；
> - 环境与工具链的坑（网络、registry、磁盘）→ `state.json.environment_notes`，已记为不可用的路径不要重复探测。
>
> 历史行只追加、不修改。本轮即使什么都没构建（无新组合 / 磁盘不足 / 构建失败），也必须追加一行写明卡点，
> 否则下一轮无法判断这半小时发生过什么。

---
2026-09-25 18:20 | saas-subscription-admin（SaaS 订阅经营后台） | 瑞士网格 / 复古 Win95 / 暗色霓虹 cyber | sites/saas-subscription-admin/{backend,web,scripts} | sites/saas-subscription-admin/{web/dist,preview} | 成功：4 表 7 接口（2 个 Bearer 写接口）+ 确定性种子 126 订阅；go build/vet/test 全绿、逐接口 curl 全过（鉴权矩阵 503/401/403/400/201、409 状态机、续费后流水 6→7）；三风格单文件 preview 实机各渲染 23 行真数据、8 类 computedStyle 互异、零外链；场景 1.4M。坑：内联脚本用正则匹配脚本区会被 bundle 里的 `<\/script>` 截断（改为按下标切片+完整性断言）；evaluate_script 返回大对象易 15s 超时，需拆单表达式。模板 templates/go-gin-react 已固化，Go 源码按约定移入 backend/。
