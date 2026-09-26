package middleware

import (
	"crypto/subtle"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

// APIKey is the custom middleware template from references/middleware.md:
// pre-handler check, short-circuit with AbortWithStatusJSON, post-handler log.
func APIKey(expected string, logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		val := c.GetHeader("X-Api-Key")
		if val == "" || subtle.ConstantTimeCompare([]byte(val), []byte(expected)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
		status := c.Writer.Status()
		logger.InfoContext(c.Request.Context(), "protected request",
			"status", status, "path", c.FullPath(), "request_id", c.GetString(RequestIDKey))
	}
}
