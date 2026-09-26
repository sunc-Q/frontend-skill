package handler

import (
	"html"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"demo/gin-users-api/internal/domain"
	"demo/gin-users-api/internal/service"
	"github.com/gin-gonic/gin"
)

type UserHandler struct {
	svc    service.UserService
	logger *slog.Logger
}

func NewUserHandler(svc service.UserService, logger *slog.Logger) *UserHandler {
	return &UserHandler{svc: svc, logger: logger}
}

func (h *UserHandler) Create(c *gin.Context) {
	var req domain.CreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "validation failed",
			"fields": validationErrors(err),
		})
		return
	}

	// sanitize after binding
	req.Name = html.EscapeString(strings.TrimSpace(req.Name))
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	user, err := h.svc.Create(c.Request.Context(), req)
	if err != nil {
		handleServiceError(c, err, h.logger)
		return
	}
	c.JSON(http.StatusCreated, user)
}

func (h *UserHandler) GetByID(c *gin.Context) {
	type uriParams struct {
		ID string `uri:"id" binding:"required,uuid"`
	}
	var p uriParams
	if err := c.ShouldBindUri(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "validation failed",
			"fields": validationErrors(err),
		})
		return
	}
	user, err := h.svc.GetByID(c.Request.Context(), p.ID)
	if err != nil {
		handleServiceError(c, err, h.logger)
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) List(c *gin.Context) {
	var q domain.ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "validation failed",
			"fields": validationErrors(err),
		})
		return
	}
	// Echo the page/limit actually used: a bound-but-absent query param leaves the
	// zero value in q, so normalising only inside the service would report page=0.
	if q.Page < 1 {
		q.Page = 1
	}
	if q.Limit < 1 {
		q.Limit = 20
	}

	users, total, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		handleServiceError(c, err, h.logger)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": users, "total": total, "page": q.Page, "limit": q.Limit})
}

func (h *UserHandler) Delete(c *gin.Context) {
	type uriParams struct {
		ID string `uri:"id" binding:"required,uuid"`
	}
	var p uriParams
	if err := c.ShouldBindUri(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "validation failed",
			"fields": validationErrors(err),
		})
		return
	}
	if err := h.svc.Delete(c.Request.Context(), p.ID); err != nil {
		handleServiceError(c, err, h.logger)
		return
	}
	c.Status(http.StatusNoContent)
}

// Panic demonstrates the custom Recovery middleware: JSON 500, no stack trace to the client.
func (h *UserHandler) Panic(c *gin.Context) {
	var boom []string
	_ = boom[3]
	c.JSON(http.StatusOK, gin.H{"unreachable": true})
}

// Slow proves the timeout middleware is cooperative: it respects c.Request.Context().
func (h *UserHandler) Slow(c *gin.Context) {
	select {
	case <-time.After(2 * time.Second):
		c.JSON(http.StatusOK, gin.H{"slept": true})
	case <-c.Request.Context().Done():
		h.logger.WarnContext(c.Request.Context(), "handler gave up on context", "err", c.Request.Context().Err())
		c.AbortWithStatus(http.StatusServiceUnavailable)
	}
}
