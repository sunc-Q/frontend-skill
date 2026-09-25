package server

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"autoshop/internal/handler"
)

// Router 组装 HTTP 层。写接口全部挂在 /api/admin 下并过 AdminAuth。
func Router(h *handler.Handler, adminToken string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), corsLocalhost(), securityHeaders(), limitBody(64<<10), requestTimeout(8*time.Second))
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "time": time.Now().UTC().Format(time.RFC3339)})
	})

	api := r.Group("/api")
	{
		api.GET("/work-orders", h.Orders)
		api.GET("/work-orders/:no", h.OrderDetail)
		api.GET("/parts", h.Parts)
		api.GET("/parts/:code", h.PartDetail)
		api.GET("/stats", h.Stats)
		admin := api.Group("/admin", handler.AdminAuth(adminToken))
		{
			admin.POST("/work-orders", h.CreateOrder)
			admin.POST("/work-orders/:no/transition", h.Transition)
			admin.POST("/work-orders/:no/lines", h.AddLine)
			admin.POST("/receipts", h.AddReceipt)
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
		// 工单与库存都是「此刻为准」的账，任何中间缓存或回退缓存都会给出旧账，
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
		if origin != "" && localOrigin(origin) {
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

// localOrigin 必须解析出 URL 并比对主机名：前缀匹配会把 http://localhost.evil.com 放进来。
func localOrigin(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" {
		return false
	}
	switch u.Hostname() {
	case "127.0.0.1", "localhost", "::1", "[::1]":
		return true
	}
	return false
}

// limitBody 给写接口封顶请求体大小：字段本身有长度校验，但没有限流的
// MaxBytesReader 等于让对端用一个 1GB 的请求把内存打满，413 必须在解析前就给出。
func limitBody(max int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil && c.Request.ContentLength != 0 {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, max)
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
