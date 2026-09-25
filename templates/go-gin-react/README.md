# 模板：go-gin-react（后端 Go/Gin + SQLite / 前端 Vite+React，三风格同 DOM）

业务网站实验室的可复用骨架。每一轮从本目录 `rsync -a --exclude node_modules 模板/ sites/<slug>/` 起步。

## 结构

```
backend/  cmd/api + internal/{domain,repository,service,handler,server}（含 *_test.go）
web/      src/{App.tsx,api.ts,themes.tsx,useAsync.ts,types.ts,format.ts,styles/theme-*.css}
scripts/  inline-preview.mjs（单文件成品）· serve-static.mjs（校验用静态托管）· style-probe.js（getComputedStyle 探针）
```

## 换场景时要动的地方

1. `cd backend && sed -i '' 's|^module bizsite$|module <短名>|; s|"bizsite/internal/|"<短名>/internal/|g' $(grep -rl 'bizsite/internal/' --include='*.go' .) go.mod`
2. `internal/domain/models.go` 换实体、`repository/seed.go` 换数据、`repository/metrics.go` 换口径、`server.go` 换路由、`handler/` 换端点。
3. `web/src/App.tsx` 换页面骨架；`themes.tsx` 的 `THEMES` 与 `styles/theme-*.css` 换风格；
   **三风格必须保持同一 DOM 与同一 JS**：新风格从 `theme-swiss.css` 用字面量替换派生，替换命中不了就报错退出，别手写两份。
4. `scripts/inline-preview.mjs` 里的 `THEMES` 列表同步改。

## 已固化的硬约束（别在派生时丢掉）

- SQLite：`github.com/glebarez/sqlite`（纯 Go 无 CGO）、DSN 带 WAL/busy_timeout/foreign_keys pragma、`SetMaxOpenConns(1)`、库文件 0600。
- 请求绑定只用 `ShouldBind*`；对外错误只走 `domain.AppError` → `handler.AbortWithError`，**绝不回显 `err.Error()`**。
- 写接口 `AdminAuth(ADMIN_TOKEN)`：未配令牌 503（fail-closed）、缺/畸形 Bearer 401、令牌不符 403（常量时间比较）。
- 列表接口：排序列白名单映射、`pageSize` 上限、搜索串 rune 截断、`LIKE` 转义 `%_\`。
- `STATIC_DIR` 分支必须 `r.NoRoute(json404)`，否则未匹配的 `/api/*` 会回纯文本 404 打断前端解析。
- 前端 strict TS：`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`。
- 校验必须跑：`go build/vet/test ./...`、`./node_modules/.bin/tsc --noEmit`、`./node_modules/.bin/vite build`、逐接口 curl、三风格 `getComputedStyle` 断言、preview 零外链静态检查。
