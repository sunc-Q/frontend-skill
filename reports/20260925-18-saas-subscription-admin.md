# 运行纪要 20260925-18 · SaaS 订阅经营后台

- 时间：2026-09-25 16:45 → 18:20（+08:00）
- 场景：SaaS 订阅经营后台（slug `saas-subscription-admin`）— 首轮，`used_scenarios` 为空
- 风格：瑞士网格 `swiss` / 复古 Win95 `win95` / 暗色霓虹 cyber `cyber`（三者均在风格池且未用过）
- 代码：`sites/saas-subscription-admin/{backend,web,scripts}`；模板：`templates/go-gin-react/`（首轮新建，后续复制）
- 产物：`sites/saas-subscription-admin/web/dist/`（284,134B 单入口）+ `preview/{swiss,win95,cyber}.html`（各 284,679B，互差 4 行）
- 体量：场景目录 1.4M（目标 <5M）；LAB 合计 2.7M；df 可用 20,466,968 KB（约 19.5GiB）

## 做了什么

1. **后端**（Go/Gin + GORM + 纯 Go SQLite）：4 张表（plans / subscribers / subscriptions / payments），
   7 个端点（5 读 + 2 管理写：建套餐、记续费），金额全用整数分，确定性种子 5 套餐 / 126 订阅 / 126 客户 / 9 个月流水。
   MRR、ARR、ARPU、流失率、试用转化率、按套餐构成、月度趋势全部在服务端 SQL 里算完，前端不做二次计算。
2. **前端**（Vite 8 + React 19 + TS 严格模式）：单页经营台，10 张 KPI、台账表（状态/套餐/搜索/排序/分页）、
   明细与回款流水、两个管理表单。**三风格同一份 DOM 与同一份 JS**，CSS 以 `?raw` 打进包、按 `data-theme` 注入 `<style>`。
3. **安全基线**：写接口 Bearer 校验 fail-closed（未配令牌 503 / 缺头 401 / 令牌错 403，常量时间比较）；
   对外错误只走 `domain.AppError`，测试断言响应体不含内部错误串；排序列白名单、`LIKE` 转义、`pageSize≤100`、搜索 rune 截断；
   静态托管带目录穿越防护；CORS 只放行 localhost 源并显式拒绝 `Origin: null`；请求超时用真实 `context.WithTimeout`。

## 验证结果

| 项 | 结果 |
| --- | --- |
| `go build/vet ./...` | 干净 |
| `go test ./...` | domain / repository / server 三包全绿（≥3 套表驱动：字段校验、鉴权矩阵、注入与越界边界、种子自洽、事务回滚、目录穿越） |
| 逐接口 curl | 只读 6 个 200；不存在 ID 404；`/api/nope` JSON 404；写接口 401/403/400(带 fields)/201；试用中记续费 409；合法续费 200 且 `renew_at` 推进、流水 6→7 |
| `tsc --noEmit` / `vite build` | 零错误；单入口 284KB（gzip 82KB） |
| 三风格 `getComputedStyle` | 底色/字体/圆角/边框/内边距/字号/字重/字距 8 类互异（数据见场景 README §6 表格），每页 10 卡 23 行真实接口数据，外链 0 |
| 零外链静态检查 | 三份文件 `src/href` 引用 0、`url(http…)` 0、`@import` 0、`data-theme` 唯一 |

## 卡点与坑（重要）

1. **单文件内联脚本写坏过**：压缩 bundle 里合法含 `<\/script>`，正则匹配脚本区导致 282KB 只写入 169KB，页面 `#root` 空白。
   改为按下标定位标签 + 切片拼接，并在写盘前断言整段 JS 完整且唯一。`$'` 自我复制文档的老坑同样适用（必须用 replacer 函数）。
2. `browser-use` 的 `evaluate_script` 反复 15s 超时，返回大对象尤其容易超时；拆成单表达式逐属性取。
3. 双击打开 preview 只有骨架、无数据：`Origin: null` 被 CORS 拒（有意为之）。看数据要 `serve-static.mjs` 起 localhost，或后端 `STATIC_DIR` 同源托管。
4. 本轮为验证临时把后端跑在 8090、静态在 8092/8093，收工前已按 PID + 命令行核对后 kill，`/tmp/tpl-verify` 已删，`node_modules`（64M）已删，未清任何全局缓存。
5. 布局修正：Go 源码从模板根目录移到 `backend/`，与 `sites/<slug>/backend` 的约定一致（模板同步）。

## 下一轮建议

- 直接 `rsync -a --exclude node_modules templates/go-gin-react/ sites/<新slug>/`，然后按 `templates/go-gin-react/README.md` 的 4 步改模块名 / 模型 / 种子 / 风格。
- 场景池优先：跨境电商商品详情+购物车、在线课程平台、健身俱乐部预约、医院门诊排班、物流运单跟踪。
- 风格池未用：暖纸编辑排版、新粗野主义、蒸汽波、日式留白、包豪斯原色、终端绿字 CRT、玻璃拟态、孟菲斯几何、报章密排、莫兰迪色块。
- 若下一轮要更强的写路径 UI 校验，可把 `style-probe.js` 扩成含表单提交的断言脚本；本轮是手工在页面上跑通的（填错→字段级报错且不落库，填对→列表出现新记录）。
