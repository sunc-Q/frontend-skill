package handler

import (
	"errors"
	"log/slog"
	"net/http"

	"demo/gin-users-api/internal/domain"
	"github.com/gin-gonic/gin"
)

func handleServiceError(c *gin.Context, err error, logger *slog.Logger) {
	var appErr *domain.AppError
	if errors.As(err, &appErr) {
		if appErr.Code >= 500 {
			logger.ErrorContext(c.Request.Context(), "service error",
				"error", appErr.Unwrap(), "path", c.FullPath())
		}
		c.JSON(appErr.Code, gin.H{"error": appErr.Message})
		return
	}
	logger.ErrorContext(c.Request.Context(), "unexpected error",
		"error", err, "path", c.FullPath())
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
}
