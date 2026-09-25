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
2026-09-25 19:20 | 收工审计补丁（承接上一行 fitness-studio-booking） | - | - | - | 修正前一行体量数值：清理中间产物后 LAB 4.0M，记录回写提交后终值 4.7M（其中 .git 2.1M），场景目录 1.5M；df 开工 20,275,132KB → 主提交收工 20,291,584KB → 本补丁时 20,294,196KB（约 19.4GiB，全程未触发 1.5GiB 熔断，两次读数差属 git objects 正常增长）；git status 干净、无本轮遗留监听进程；远端 go-gin_react 推进链 53153f4..ed47eba..7a26d2f..8b0e49c，未 --force、未跳 hook、未碰 main。
2026-09-25 19:44 | cross-border-commerce（跨境电商商品详情 + 多目的国到手价购物车） | 暖纸编辑排版 / 蒸汽波 / 终端绿字 CRT | sites/cross-border-commerce/{backend,web,scripts} | sites/cross-border-commerce/{web/dist,preview} | 成功：3 表 8 接口（1 个 Bearer 写），核心口径是「一份购物车 × 五个目的国到手价」——货值/首重+500g 向上取整续重运费/关税/免邮线全部后端美分整型折算，前端只格式化（JPY 0 位小数），接口层保证 goods+freight+duty=total 恒等式；固定种子 20260925 生成 18 SKU(17 在架/2 零库存)/每 SKU 3-8 条评价/购物车 3 行 605g；go build/vet/test 全绿（15 个表驱动测试函数、3 包），scripts/api-smoke.sh 全过（加购→覆盖→qty=0 移出→409×3→404→400×2→收敛回 3 行矩阵、鉴权 401/403/201/409 + 独立实例实测 503 fail-closed、9 项字段非法逐字段回显、上新后 total=19）；三风格单文件 preview（各 ~284.5KB）实机各 22 表行 / 3 购物车行、getComputedStyle 6 类两两互异（字体族/底色/圆角 0|999px|0+double/字距/text-transform/边框）、零外链；UI 内真实加购 CB-OU-0023×4（6→10 件、605→785g）后移除并用 curl 取证还原；US 车 9294+749+743=10786 手算吻合。场景 1.4M、LAB 6.7M（含 .git 2.2M），df 收工 20,273,788KB（开工未单独留值，上轮末次 20,294,196KB），全程未触发 1.5GiB 熔断。推送 go-gin_react：fetch + rebase（up-to-date 无改写）后普通推送 3743462..bf6cb06（43 文件），未 --force、未跳 hook、未碰 main；收尾 git status 干净、8080/8092 监听为 0。坑：①GORM 把 Sold30/LeadMin 映射成 sold30/lead_min，与 JSON 的 sold_30/lead_min_days 不符直接 no such column，必须显式 gorm:"column:..."（含聚合视图结构体）；②SQLite 空表 SUM 返回 NULL，聚合全改 COALESCE(SUM(),0)；③SKU 只校验长度会放行注入串，被表驱动测试逼出字符白名单（改代码不放宽测试）；④冒烟写脏了运行库（total 19），必须 kill→删 app.db*→同 token 重启回到 18 之后再生成 preview，否则交付物带脏数据。遗留：税则/价卡写死在 domain.Regions（加目的国要改代码）、cart_items 无归属维度（已记 state.backlog）。
