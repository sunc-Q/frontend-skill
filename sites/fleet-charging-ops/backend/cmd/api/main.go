package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/server"
	"bizsite/internal/service"
)

func main() {
	var (
		doSeed = flag.Bool("seed", true, "启动时若库为空则灌入示例数据")
		dbPath = flag.String("db", envOr("DB_PATH", "./data/app.db"), "SQLite 文件路径")
		addr   = flag.String("addr", ":"+envOr("PORT", "8080"), "监听地址")
	)
	flag.Parse()

	adminToken := strings.TrimSpace(os.Getenv("ADMIN_TOKEN"))
	if adminToken == "" {
		log.Println("[warn] ADMIN_TOKEN 未设置：所有管理端写接口将返回 503")
	}

	db, err := repository.Open(*dbPath)
	if err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}
	repo := repository.New(db)
	if *doSeed {
		if err := repo.Seed(context.Background(), time.Now()); err != nil {
			log.Fatalf("灌入示例数据失败: %v", err)
		}
	}
	// -wal / -shm 只在首次写入后才出现，所以权限压制必须发生在种子之后。
	if err := repository.Harden(*dbPath); err != nil {
		log.Fatalf("收紧库文件权限失败: %v", err)
	}

	if strings.TrimSpace(os.Getenv("GIN_MODE")) == "release" {
		gin.SetMode(gin.ReleaseMode)
	} else {
		gin.SetMode(gin.TestMode)
	}

	h := handler.New(service.New(repo))
	eng := server.Router(h, adminToken)
	srv := &http.Server{
		Addr:              *addr,
		Handler:           eng,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// 必须短于中间件里的 8s 请求时限：否则 handler 已判定超时，连接还在慢慢收 body。
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("listening on %s (db=%s, admin_token_set=%t)", *addr, *dbPath, adminToken != "")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务退出: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("优雅关闭超时: %v", err)
	}
	log.Println("已关闭")
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
