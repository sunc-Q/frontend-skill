package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"autoshop/internal/domain"
	"autoshop/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

// bindJSON 是写接口唯一的请求体入口：解析失败一律 400，
// 但被 MaxBytesReader 截断的超大请求要单独给 413，前端才知道是「太大」而不是「字段写错」。
func bindJSON(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			c.JSON(http.StatusRequestEntityTooLarge, errorBody{Code: "body_too_large", Message: "请求体超过大小上限"})
			return false
		}
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return false
	}
	return true
}

type listEnvelope struct {
	Items    any    `json:"items"`
	Total    int64  `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	ServedAt string `json:"served_at"`
}

func (h *Handler) Orders(c *gin.Context) {
	q := domain.ParseOrderQuery(c.Request.URL.Query())
	rows, total, err := h.svc.ListOrders(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.OrderRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) OrderDetail(c *gin.Context) {
	no := c.Param("no")
	if !utf8.ValidString(no) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_no", Message: "工单号非法"})
		return
	}
	head, lines, moves, err := h.svc.OrderDetail(c.Request.Context(), no)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if lines == nil {
		lines = []domain.OrderLineRow{}
	}
	if moves == nil {
		moves = []domain.MoveRow{}
	}
	c.JSON(http.StatusOK, gin.H{"order": head, "lines": lines, "moves": moves})
}

func (h *Handler) Parts(c *gin.Context) {
	q := domain.ParsePartQuery(c.Request.URL.Query())
	rows, total, err := h.svc.ListParts(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.PartRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) PartDetail(c *gin.Context) {
	code := c.Param("code")
	if !utf8.ValidString(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "配件编码非法"})
		return
	}
	row, lots, moves, err := h.svc.PartDetail(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if lots == nil {
		lots = []domain.StockLot{}
	}
	if moves == nil {
		moves = []domain.MoveRow{}
	}
	c.JSON(http.StatusOK, gin.H{"part": row, "lots": lots, "moves": moves})
}

func (h *Handler) Stats(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	s, err := h.svc.Stats(c.Request.Context(), days)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) CreateOrder(c *gin.Context) {
	var in domain.CreateOrderInput
	if !bindJSON(c, &in) {
		return
	}
	head, err := h.svc.CreateOrder(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": head, "message": "工单已建立"})
}

func (h *Handler) Transition(c *gin.Context) {
	no := c.Param("no")
	var in domain.TransitionInput
	if !bindJSON(c, &in) {
		return
	}
	head, err := h.svc.Transition(c.Request.Context(), no, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": head, "message": "状态已推进至 " + head.Status})
}

func (h *Handler) AddLine(c *gin.Context) {
	no := c.Param("no")
	var in domain.AddLineInput
	if !bindJSON(c, &in) {
		return
	}
	head, line, err := h.svc.AddLine(c.Request.Context(), no, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": head, "line": line, "message": "明细已入账"})
}

func (h *Handler) AddReceipt(c *gin.Context) {
	var in domain.ReceiptInput
	if !bindJSON(c, &in) {
		return
	}
	row, lot, err := h.svc.AddReceipt(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"part": row, "lot": lot, "message": "批次已入库并记账",
	})
}
