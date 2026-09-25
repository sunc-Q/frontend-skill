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
2026-09-25 19:13 | fitness-studio-booking（城市健身工作室排课与预约看板） | 新粗野主义 / 日式留白 / 莫兰迪色块 | sites/fitness-studio-booking/{backend,web,scripts} | sites/fitness-studio-booking/{web/dist,preview} | 成功：4 表 7 接口（占座+建档两个 Bearer 写），容量/查重/满座转候补/次卡扣次全在一个事务里判定（SetMaxOpenConns(1)+txlock immediate 保证不超卖）；种子 10 课程/48 会员/84 课节/±7 天窗口 654 笔预约、满座率 65.7%、含真实满座课与候补样本；go build/vet/test 全绿，scripts/api-smoke.sh 逐接口断言全过（401/401/403/400×4/201/409×5/404×4 + days/page_size/sort/date 收敛回显）；未配 ADMIN_TOKEN 的实例单独实测 503 fail-closed；库文件 chmod 0600（存手机号）；三风格同 DOM 同 JS，getComputedStyle 8 类两两互异、各 8 卡 44 行、零外链；并在页面内用可访问性快照取证完成一次真实占座（11/12→12/12，名单新增 赵岩/13820260001）。场景 1.5M，LAB 4.0M，df 可用 20,264,548KB。坑：①改完种子后 curl 仍拿到旧数据——上一轮自己的进程占着端口使新实例静默退出，且旧进程握着已 rm 的 db inode，restart 必须按 PID+命令行核对后 kill 并确认监听为 0；②by_coach 把一名教练裂成两行，根因是种子给同名教练配了两个级别，修数据优于 SQL 折叠；③evaluate_script 里凡带 await 或触发重渲染必 15s 超时（脚本其实已执行），改成「动作/读取分离 + take_snapshot 取证」；④zsh nomatch 会让 rm -f x.db* 中断整条 && 链；⑤扣次门槛原在 insert 后靠回滚，已移到 insert 前。遗留：bookings 缺 (session_id,member_id) 复合唯一索引，放开多连接前必须补（已记 state.backlog）。
