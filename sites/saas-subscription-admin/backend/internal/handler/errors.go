package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"saassub/internal/domain"
)

type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
	TraceID string            `json:"trace_id,omitempty"`
}

// AbortWithError 是唯一的错误出口：AppError 的 Message 可对外，
// 其它任何 error（含 GORM/驱动细节）一律降级为通用 500，绝不回显 err.Error()。
func AbortWithError(c *gin.Context, err error) {
	var ae *domain.AppError
	if errors.As(err, &ae) {
		c.AbortWithStatusJSON(ae.HTTPCode, errorBody{Code: ae.Code, Message: ae.Message, Fields: ae.Fields})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.AbortWithStatusJSON(http.StatusNotFound, errorBody{Code: "not_found", Message: "资源不存在"})
		return
	}
	c.AbortWithStatusJSON(http.StatusInternalServerError, errorBody{
		Code: "internal_error", Message: "服务内部错误，请稍后重试",
	})
}
