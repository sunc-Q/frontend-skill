package handler

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const bearerPrefix = "Bearer "

// AdminAuth 只校验单个环境变量里的 Bearer 令牌：够用、不引入 JWT 复杂度。
// 三层防线：服务端没配令牌 → 503（绝不因为「期望值为空」而放行）；
// 缺少或格式不符的 Authorization → 401（凭证问题）；令牌不匹配 → 403。
func AdminAuth(token string) gin.HandlerFunc {
	expected := []byte(strings.TrimSpace(token))
	return func(c *gin.Context) {
		if len(expected) == 0 {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, errorBody{
				Code: "server_misconfigured", Message: "服务端未配置管理令牌",
			})
			return
		}
		got, ok := bearerToken(c.GetHeader("Authorization"))
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, errorBody{
				Code: "unauthorized", Message: "Authorization 需为 Bearer <token> 形式",
			})
			return
		}
		if subtle.ConstantTimeCompare([]byte(got), expected) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, errorBody{
				Code: "forbidden", Message: "管理令牌无效",
			})
			return
		}
		c.Next()
	}
}

// bearerToken 大小写不敏感地剥掉 Bearer 方案前缀；没有前缀或剥完为空即视为格式非法。
func bearerToken(raw string) (string, bool) {
	t := strings.TrimSpace(raw)
	if len(t) <= len(bearerPrefix) {
		return "", false
	}
	if !strings.EqualFold(t[:len(bearerPrefix)], bearerPrefix) {
		return "", false
	}
	got := strings.TrimSpace(t[len(bearerPrefix):])
	return got, got != ""
}
