package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

type orderEnvelope struct {
	Items    []domain.OrderRow `json:"items"`
	Total    int64             `json:"total"`
	Page     int               `json:"page"`
	PageSize int               `json:"page_size"`
	ServedAt string            `json:"served_at"`
}

func (h *Handler) Menu(c *gin.Context) {
	q := domain.ParseMenuQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Menu(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.MenuRow{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items": rows, "total": total, "page": q.Page, "page_size": q.PageSize,
		"categories": gin.H{"hot": "热菜", "cold": "凉菜", "staple": "主食", "soup": "汤羹", "dessert": "饮品甜点"},
	})
}

func (h *Handler) Zones(c *gin.Context) {
	zones, err := h.svc.Zones(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": zones, "total": len(zones)})
}

func (h *Handler) Stats(c *gin.Context) {
	s, err := h.svc.Stats(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) ListOrders(c *gin.Context) {
	q := domain.ParseOrderListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.ListOrders(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.OrderRow{}
	}
	c.JSON(http.StatusOK, orderEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "ID 非法"})
		return 0, false
	}
	return id, true
}

func (h *Handler) OrderDetail(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	row, items, err := h.svc.OrderDetail(c.Request.Context(), id)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": row, "items": items})
}

// PlaceOrder 是顾客端公开下单接口（外卖门店的下单入口本就是公开的），
// 所有金额与可用性均由后端重算，绝不信任前端传入的价格。
func (h *Handler) PlaceOrder(c *gin.Context) {
	var in domain.PlaceOrderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	row, items, err := h.svc.PlaceOrder(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": row, "items": items, "message": "下单成功，厨房已接单"})
}

func (h *Handler) AdvanceOrder(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var in domain.AdvanceStatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	row, items, err := h.svc.Advance(c.Request.Context(), id, in.To)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": row, "items": items, "message": "状态已推进"})
}

func (h *Handler) SetAvailability(c *gin.Context) {
	id, ok := parseID(c)
	if !ok {
		return
	}
	var in domain.AvailabilityInput
	if err := c.ShouldBindJSON(&in); err != nil || in.Available == nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "available 必填（true/false）"})
		return
	}
	d, err := h.svc.SetAvailability(c.Request.Context(), id, *in.Available)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}
