package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"saassub/internal/domain"
	"saassub/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

type listEnvelope struct {
	Items    []domain.SubscriptionRow `json:"items"`
	Total    int64                    `json:"total"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
	Sort     string                   `json:"sort"`
	ServedAt string                   `json:"served_at"`
}

func (h *Handler) Plans(c *gin.Context) {
	plans, err := h.svc.Plans(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": plans, "total": len(plans)})
}

func (h *Handler) Metrics(c *gin.Context) {
	months, _ := strconv.Atoi(c.Query("months"))
	m, err := h.svc.Metrics(c.Request.Context(), months)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) List(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.SubscriptionRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) Detail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "订阅 ID 非法"})
		return
	}
	row, pays, err := h.svc.Detail(c.Request.Context(), id)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscription": row, "payments": pays})
}

func (h *Handler) CreatePlan(c *gin.Context) {
	var in domain.CreatePlanInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	p, err := h.svc.CreatePlan(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}

type renewParam struct {
	SubscriptionID int64 `uri:"id"`
}

func (h *Handler) Renew(c *gin.Context) {
	var p renewParam
	if err := c.ShouldBindUri(&p); err != nil || p.SubscriptionID <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "订阅 ID 非法"})
		return
	}
	var in domain.RenewInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	row, err := h.svc.Renew(c.Request.Context(), p.SubscriptionID, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscription": row, "message": "续费已入账"})
}
