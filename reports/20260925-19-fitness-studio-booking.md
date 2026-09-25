# 运行纪要 20260925-19 · 城市健身工作室排课与预约

- 时间：2026-09-25 18:20 → 19:13（+08:00）
- 场景：城市健身工作室排课与预约看板（slug `fitness-studio-booking`）— `used_scenarios` 里没有，`next_candidates` 中的「健身俱乐部预约」被本轮消费
- 风格：新粗野主义 `brutal` / 日式留白 `washi` / 莫兰迪色块 `morandi`（三者均在 `next_style_candidates` 且未进 `used_styles`；与上一轮的瑞士网格/Win95/暗色霓虹互斥）
- 代码：`sites/fitness-studio-booking/{backend,web,scripts}`；复制自 `templates/go-gin-react/`（未从零脚手架）
- 产物：`sites/fitness-studio-booking/web/dist/`（单入口 292,259B / gzip 84.5KB）+ `preview/{brutal,washi,morandi}.html`（292,831 / 292,826 / 292,833B）
- 体量：场景目录 1.5M（目标 <5M）；清理中间产物后 LAB 4.0M，提交后终值 4.7M（其中 `.git` 2.1M）；df 开工 20,275,132 KB → 收工 20,291,584 KB（约 19.4GiB，全程未足）

## 做了什么

1. **后端**（Go 1.27 + Gin 1.12 + GORM + 纯 Go `glebarez/sqlite`）：4 张表（classes / sessions / members / bookings），
   7 个端点（5 读 + 2 个 Bearer 写：占座、建档发卡）。金额整数分、时间全 UTC。
   确定性种子：10 门课程（含 1 门已停开）/ 48 名会员 / 14 天 × 6 时段 = 84 节课 / 按「容量 × 星期 × 时段 × 临近度」生成预约
   （±7 天窗口实测 654 笔：612 确认 · 3 候补 · 16 取消 · 23 未到，满座率 65.7%）。
   满座率、到课收入、未到率、分类/教练/每日/卡种聚合全部在服务端 SQL 里算完，前端不做二次计算。
2. **业务规则落在一个事务里**：容量判定 → 同课节查重 → 满座时按 `allow_waitlist` 决定 409 还是转候补 →
   次卡（trial / ten_session）只对 confirmed 扣次、候补不扣 → 已开课/已取消/停卡/过期卡一律拒绝。
   `SetMaxOpenConns(1)` + `_pragma=txlock(immediate)` 让写事务天然串行，不会超卖。
3. **前端**（Vite 8 + React 19 + TS 严格模式含 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`）：
   单页看板，8 张 KPI + 课表（8 个筛选器、5 列可排序、分页）+ 分类满座率 / 每日到课 / 教练负载 + 课节详情（出场名单、占座表单）+ 会员建档表单。
   **三风格共用同一份 DOM 与同一份 JS**，三份 CSS 以 `?raw` 打进包，按 `<html data-theme>` 注入 `<style>`，切换不重新加载。
4. **安全基线**：写接口 Bearer fail-closed（未配令牌 503 / 缺头或缺前缀 401 / 令牌错 403，`ConstantTimeCompare`）；
   对外错误只走 `domain.AppError`，测试断言响应体不含 `SQLITE/gorm/constraint/no such table//Users/`；
   排序列白名单、`LIKE` 转义 + `ESCAPE '\'`、教练名/日期/手机号字符集闸门、`page_size≤100`、`days≤14`、搜索 rune 截 64；
   静态托管目录穿越防护 + 安全响应头 + CORS 只放行 localhost；**库文件显式 `chmod 0600`**（存会员手机号，属个人信息）。

## 验证结果

| 项 | 结果 |
| --- | --- |
| `go build/vet ./...` | 干净 |
| `go test ./...` | domain / repository / server 三包全绿（表驱动：字段校验、query 收敛含注入与 400 字超长、鉴权矩阵、种子自洽、满座→候补、查重、扣次、事务回滚、分页收敛、倒序生效、目录穿越、不外泄内部串） |
| `scripts/api-smoke.sh` 逐接口 curl | 读接口 5 个 200 且数字与库一致；`days=999/page_size=5000/sort=s.id;DROP TABLE/date=2026-13-45` 全部被收敛（回显 `sort=s.start_at from=今天 page_size=100 days=14`）；`/api/nope` 404；`/api/sessions/1 OR 1=1` 400 |
| 写接口矩阵 | 401/401/403/400(注入手机号)/400(400 字姓名)/400(卡种越界)；建档 201（次卡默认 180 天）→ 同手机号 409；预约 201（座位 11/12→12/12，`credit_used=true`）→ 重复 409 `duplicate_booking` → 满座 409 `session_full` → 带 `allow_waitlist` 变 `waitlist` → 0 次卡 409 `no_credits` → 已开课 409 `session_not_open` → 未注册手机号 404 |
| fail-closed 独立实测 | 另起未设 `ADMIN_TOKEN` 的实例（:8090），写接口 503 `server_misconfigured` |
| `tsc --noEmit` / `vite build` | 零错误；单入口 292KB（gzip 84.5KB） |
| 三风格 `getComputedStyle` | 底色/字体栈/间隙/圆角/上边框/阴影/字距/大小写 8 类两两互异（表见场景 README §6）；三页均 8 卡 44 行、满座率同为 65.8% → 差异只来自 CSS；**外链 0** |
| UI 写路径（可访问性快照取证） | `morandi.html` 内填令牌 → 点「修复阴瑜伽 21:00」→ 填手机号 → 提交：表单「操作已完成」、名单 11→12 人并出现 `赵岩/13820260001/年卡/已确认/前台/11:06 UTC`、该行变 `12/12`、表单标题提示已满座；服务端 `/api/sessions/24` 查到同一笔。另一行 `硬拉突破课 10/10 候补 2 人` 说明候补态由真实数据渲染 |

## 卡点与坑（重要）

1. **改完种子代码后 curl 到的还是旧数据**：新起的服务因端口被上一轮自己的进程占着而静默退出，
   旧进程又握着一个已被 `rm` 的 db 句柄（inode 还在）。教训：**每轮 restart 必须 `lsof -iTCP:<port> -sTCP:LISTEN -t` → `ps -o command= -p <pid>` 核对命令行 → kill → 再确认监听数为 0 → 才 curl**，
   并把启动日志（`listening on ...`）当哨兵。
2. **`by_coach` 把同一名教练裂成两行**（林薇 同时挂 master 与 junior）：根因在种子给一个教练名配了两个级别。
   选择修数据（一名教练一个级别，多出的那门课换成另一名教练）而不是在 SQL 里折叠，语义更真、看板更好读。
3. **`evaluate_script` 里凡是有 `await`（fetch 或 sleep）或触发 React 重渲染的脚本，几乎必 15s 超时**——但脚本实际已执行完。
   可行套路：把「动作」和「读取」拆成两次调用，动作那次允许超时，读取用 `take_snapshot`（可访问性树）而不是拼大对象。
4. **zsh 的 `nomatch` 会让 `rm -f foo.db*` 在文件不存在时直接中断整条 `&&` 链**，看起来像"命令没生效"。跨平台脚本里给这类清理显式列文件名或 `setopt no_nomatch`。
5. 扣次门槛原来写在 `tx.Create` 之后靠回滚兜底（结果对但语义脏、白占自增 ID），已移到插入前判定。
6. `bookings` 没有 `(session_id, member_id)` 复合唯一索引，查重目前依赖事务内 SELECT + 单写者。要放开多连接必须先补索引——已记在 README §8 与 next 待办。
7. 清理：`web/node_modules`（64M）、`backend/api`（38M）、`.tmp/`、`/tmp` 本轮草稿（`api-probe`、`probe.db*`）全部删除；
   进程按 PID + 命令行核对后 kill（:8080、:8090、:8092、:8099 四个都是本轮起的），收工 `lsof` 无残留监听；未清任何全局共享缓存。

## 下一轮建议

- 场景池剩余：跨境电商商品详情+购物车 / 在线课程平台 / 餐饮外卖门店 / 医院门诊排班与挂号 / 物流运单跟踪 / 房产租赁管理 / 招聘 ATS / 图书馆馆藏与借阅 / 充电桩车队运营。
- 风格池剩余：暖纸编辑排版 / 蒸汽波 / 包豪斯原色 / 终端绿字 CRT / 苹果玻璃拟态 / 孟菲斯几何 / 报章密排 / 高对比荧光运动风 / 等距轴测工业风 / 手账纸质拼贴 / 航空仪表盘 / 乐高积木块面。
- 值得回补到 `templates/` 的通用件：`os.Chmod(db, 0o600)`（个人信息库）、schedule 响应回显收敛后的 `sort/from/days/page_size`。
