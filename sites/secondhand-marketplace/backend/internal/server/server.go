package server

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"flea/internal/handler"
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
		api.GET("/categories", h.Categories)
		api.GET("/metrics", h.Metrics)
		api.GET("/listings", h.Listings)
		api.GET("/listings/:code", h.Detail)
		api.GET("/deals", h.Deals)
		admin := api.Group("/admin", bodySizeLimit(handler.MaxBodyBytes), handler.AdminAuth(adminToken))
		{
			admin.POST("/listings", h.CreateListing)
			admin.POST("/listings/:code/offers", h.PlaceOffer)
			admin.POST("/deals/:no/decide", h.Decide)
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
		// style 需要 'unsafe-inline'：三风格是同一份 JS 在运行时把当前主题 CSS 注进 <style>。
		// script 只允许同源，内联脚本一律不给活路（单文件预览是离线产物，不经这个头）。
		h.Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "+
				"object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		c.Next()
	}
}

// corsLocalhost 只放行本机 http 来源（预览/断言常用另一个端口打开静态产物）。
// 不接受 Origin: null（file:// 与各沙箱页共用该值，放行等于对所有本地程序开门）。
// 主机名必须「精确等于」loopback 名或 IP：前缀匹配会放行 http://127.0.0.1.evil.example。
func corsLocalhost() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin == "" {
			c.Next()
			return
		}
		if isLoopbackOrigin(origin) {
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

func isLoopbackOrigin(origin string) bool {
	if origin == "null" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	h := u.Hostname() // 已剥掉端口与 IPv6 方括号
	if h == "localhost" || h == "::1" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// bodySizeLimit 同时堵两条路：谎报 Content-Length（这里拦）与不声明长度（下游 MaxBytesReader 拦）。
func bodySizeLimit(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > n {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"code": "body_too_large", "message": "请求体超出上限",
			})
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
