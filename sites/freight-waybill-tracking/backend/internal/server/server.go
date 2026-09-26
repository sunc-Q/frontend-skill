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

	"bizsite/internal/handler"
)

// Router 组装 HTTP 层。写接口全部挂在 /api/admin 下并过 AdminAuth。
func Router(h *handler.Handler, adminToken string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), corsLocalhost(), securityHeaders(), requestTimeout(8*time.Second))
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "time": time.Now().UTC().Format(time.RFC3339)})
	})

	api := r.Group("/api")
	api.Use(noStore())
	{
		api.GET("/lanes", h.Lanes)
		api.GET("/rules", h.Rules)
		api.GET("/stats", h.Stats)
		api.GET("/quote", h.Quote)
		api.GET("/waybills", h.Waybills)
		api.GET("/waybills/:code", h.Waybill)
		admin := api.Group("/admin", maxBodyBytes(64<<10), handler.AdminAuth(adminToken))
		{
			admin.POST("/waybills", h.CreateWaybill)
			admin.POST("/waybills/:code/advance", h.Advance)
			admin.POST("/waybills/:code/exception", h.Exception)
			admin.POST("/rules", h.CreateRule)
			admin.POST("/rules/:id/toggle", h.ToggleRule)
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

// noStore 保证运营台读到的永远是最新账：接口响应一律禁缓存。
func noStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
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
		if localOrigin(origin) {
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

// localOrigin 严格判定 Origin 的主机名是否就是本机回环。
// 绝不能按前缀匹配：http://127.0.0.1.evil.example 也是攻击者可控的公网域名，
// 前缀放行等于把跨域读权限送给它。端口不看，因为回环地址上的任何端口都只在本机。
func localOrigin(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	switch strings.ToLower(u.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	// 127.0.0.0/8 整段都只在本机可达，一并认；其余（含公网 IP 与任何域名）一律拒。
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// maxBodyBytes 给写接口封顶请求体。字段校验也能拒掉超长值，但那时 Gin 已经把整个
// body 读进内存了——只靠校验等于让任何人用大 body 打内存，所以这里在读取环节就掐断。
// 超限后 json 解码报错，出口仍是统一的 invalid_request，绝不回显 net/http 的错误文案。
func maxBodyBytes(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > n {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"code": "body_too_large", "message": "请求体超出上限",
			})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, n)
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
