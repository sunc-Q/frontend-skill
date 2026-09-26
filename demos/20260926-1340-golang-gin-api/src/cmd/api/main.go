package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"demo/gin-users-api/internal/domain"
	"demo/gin-users-api/internal/handler"
	"demo/gin-users-api/internal/repository"
	"demo/gin-users-api/internal/service"
	"demo/gin-users-api/pkg/middleware"
	"github.com/gin-gonic/gin"
)

func main() {
	gin.SetMode(gin.ReleaseMode)
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	r := gin.New()
	r.SetTrustedProxies([]string{"127.0.0.1/32"})
	r.Use(middleware.CORS())
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.RequestID())
	r.Use(middleware.Logger(logger))
	r.Use(middleware.Recovery(logger))

	var (
		userRepo    = repository.NewMemoryRepository()
		userSvc     = service.NewUserService(userRepo)
		userHandler = handler.NewUserHandler(userSvc, logger)
	)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := r.Group("/api/v1")
	api.Use(middleware.Timeout(250 * time.Millisecond))
	{
		api.POST("/users", userHandler.Create)
		api.GET("/users", userHandler.List)
		api.GET("/users/:id", userHandler.GetByID)
		api.GET("/debug/slow", userHandler.Slow)
		api.GET("/debug/panic", userHandler.Panic)

		protected := api.Group("")
		protected.Use(middleware.APIKey(os.Getenv("API_KEY"), logger))
		{
			protected.DELETE("/users/:id", userHandler.Delete)
		}
	}

	srv := &http.Server{
		Addr:              "127.0.0.1:" + os.Getenv("PORT"),
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
	logger.Info("server stopped")
}

var _ = domain.ErrNotFound
