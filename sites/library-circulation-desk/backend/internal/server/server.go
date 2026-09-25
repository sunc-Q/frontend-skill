package server

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"libdesk/internal/handler"
)

// Router 组装 HTTP 层。写接口全部挂在 /api/admin 下并过 AdminAuth。
func Router(h *handler.Handler, adminToken string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), corsLocalhost(), securityHeaders(), requestTimeout(8*time.Second))
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "time": time.Now().UTC().Format(time.RFC3339)})
	})

	api := r.Group("/api")
	{
		api.GET("/items", h.Items)
		api.GET("/items/:code", h.ItemDetail)
		api.GET("/loans", h.Loans)
		api.GET("/loans/:id", h.LoanDetail)
		api.GET("/members/:card", h.Member)
		api.GET("/stats", h.Stats)
		admin := api.Group("/admin", handler.AdminAuth(adminToken))
		{
			admin.POST("/borrow", h.Borrow)
			admin.POST("/loans/:id/return", h.Return)
			admin.POST("/loans/:id/renew", h.Renew)
		}
	}
	mountStatic(r, staticDir())
	return r
}

func staticDir() string {
	if v := strings.TrimSpace(os.Getenv("STATIC_DIR")); v != "" {
		return v
	}
	return "./web/dist"
}

// json404 保证 /api/* 未匹配的路径也返回 JSON，而不是 Gin 的纯文本 404。
func json404(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "接口不存在"})
}

// mountStatic 提供 SPA 单页：命中文件就发文件，否则回 index.html。
// 路径一律用 filepath.Clean 规范化后再判断，禁止目录穿越。
func mountStatic(r *gin.Engine, dir string) {
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		r.NoRoute(json404)
		return
	}
	r.NoRoute(func(c *gin.Context) {
		p := filepath.Clean("/" + c.Request.URL.Path)
		if strings.HasPrefix(p, "/api/") {
			json404(c)
			return
		}
		file := filepath.Join(dir, p)
		if st, err := os.Stat(file); err == nil && !st.IsDir() {
			c.File(file)
			return
		}
		index := filepath.Join(dir, "index.html")
		if _, err := os.Stat(index); err == nil {
			c.Header("Cache-Control", "no-cache")
			c.File(index)
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"code": "not_found", "message": "前端产物不存在，请先构建 web/"})
	})
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		// 借阅记录与读者信息都是「此刻为准」的数据，中间缓存或回退缓存都会给出旧账，
		// 因此接口一律 no-store；静态产物另有一套带指纹的缓存策略。
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		c.Next()
	}
}

// corsLocalhost 只放行本机 http 来源（预览/断言常用另一个端口打开静态产物）。
// 不接受 Origin: null（file:// 与各沙箱页共用该值，放行等于对所有本地程序开门）；
// 单文件预览版要拿数据请用 scripts/serve-static.mjs 在同机 http 下打开，或直接跑后端托管 dist/。
func corsLocalhost() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" {
			c.Next()
			return
		}
		host := origin
		if i := strings.Index(origin, "://"); i >= 0 {
			host = origin[i+3:]
		}
		if strings.HasPrefix(host, "127.0.0.1") || strings.HasPrefix(host, "localhost") ||
			strings.HasPrefix(host, "[::1]") {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Writer.Header().Set("Access-Control-Max-Age", "600")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// requestTimeout 给每个请求的 context 加截止时限，下游 DB 查询会尊重它。
func requestTimeout(d time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), d)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
