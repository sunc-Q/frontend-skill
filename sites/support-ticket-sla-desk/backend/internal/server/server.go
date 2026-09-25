package server

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/handler"
)

// Router 组装 HTTP 层。写接口全部过 AdminAuth（单个 ADMIN_TOKEN 的 Bearer 校验）。
func Router(h *handler.Handler, adminToken string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), corsLocalhost(), securityHeaders(), requestTimeout(8*time.Second))
	r.GET("/api/health", h.Health)

	api := r.Group("/api")
	{
		api.GET("/meta", h.Meta)
		api.GET("/stats", h.Stats)
		api.GET("/tickets", h.List)
		api.GET("/tickets/:code", h.Detail)
		api.GET("/agents", h.Agents)
		api.GET("/customers", h.Customers)
		api.GET("/sla/policies", h.Policies)

		w := api.Group("", handler.AdminAuth(adminToken), maxBody(64<<10))
		{
			w.POST("/tickets", h.CreateTicket)
			w.PATCH("/tickets/:code/status", h.ChangeStatus)
			w.POST("/tickets/:code/pause", h.Pause)
			w.POST("/tickets/:code/resume", h.Resume)
			w.POST("/tickets/:code/assign", h.Assign)
			w.POST("/sla/policies", h.UpsertPolicy)
		}
	}
	mountStatic(r, staticDir())
	return r
}

// maxBody 给写接口设请求体上限：超限在解析阶段就报错，不落到数据库层。
func maxBody(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, n)
		}
		c.Next()
	}
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
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
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
