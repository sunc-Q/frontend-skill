# golang-gin-api — 最小分层 REST 服务（用户 CRUD）

技能：`golang-gin-api` v1.0.5（作者 henriqueatila，本机已装：`~/.qoder-cn/skills/golang-gin-api/`，含 SKILL.md + 5 篇 references，零脚本）。
本轮按它自己的分层结构与中间件规范，跑一个「Users API」小任务：绑定校验 → 消毒 → 域错误映射 → 中间件链 → 优雅关闭。

## 结构（技能 SKILL.md 的 Project Structure 原样落地）

```
src/
├── cmd/api/main.go                  # 装配 + http.Server 超时组 + 优雅关闭
├── internal/domain/{user,errors}.go # DTO(binding tags) + AppError(status 由域决定) + sentinel
├── internal/repository/user_repo.go # 接口 + 内存实现（技能的 db 层用内存替身，避开 gorm 依赖）
├── internal/service/user_service.go # sha256 口令哈希、唯一邮箱、ErrNotFound/ErrConflict 包装
├── internal/handler/                # 薄 handler + validationErrors() + handleServiceError()
└── pkg/middleware/                  # CORS / SecurityHeaders / RequestID / Logger(slog) / Recovery / Timeout / APIKey
```

## 从零复现

```sh
LAB=/Users/apple/Documents/workProject/试验/skill演示场
export PATH=$HOME/.local/go/1.27.1/bin:$PATH          # go1.27.1
export GOMODCACHE=$LAB/.tmp/gomod-gin GOCACHE=$LAB/.tmp/gocache-gin   # 必须绝对路径，且写进 LAB 内
cd $LAB/demos/20260926-1340-golang-gin-api/src
GOPROXY=https://goproxy.cn,direct GOFLAGS=-mod=mod \
  go get github.com/gin-gonic/gin@latest github.com/gin-contrib/cors@latest github.com/google/uuid@latest
go build -o $LAB/.tmp/api-r17 ./cmd/api && go vet ./...   # 注意 -o 用绝对路径，见纪要「踩坑」
cd ..
BIN=$LAB/.tmp/api-r17 ./run-transcript.sh                 # 起服务→19 条断言→SIGTERM 验优雅关闭
./mutants.sh                                              # 两组变异反证
```

## 产物

- `output.log` — 真实转录：RUN A 19 条断言全绿（含 slog JSON 服务端日志），RUN B 两个变异体各只红 1 条 + 基线还原全绿
- `src/` — 可直接 `go build` 的源码（不含依赖，`go.sum` 在内）
- `run-transcript.sh` / `mutants.sh` — 复现脚本

断言覆盖：201 创建且 `password_hash` 永不序列化、400 带 field 级校验消息、`html.EscapeString` 消毒、409 邮箱冲突、`limit=200` 被 `max=100` 挡下、URI 参数 `uuid` 校验、404 由域层 AppError 决定状态码、保护路由 401/204、panic → JSON 500 且栈只在服务端日志、404 响应仍带全套 OWASP 头、`X-Request-ID` 复用、CORS 白名单接受 5173 拒绝 evil.example、slog 按状态码分级、SIGTERM → `srv.Shutdown` → exit 0 且端口释放。
