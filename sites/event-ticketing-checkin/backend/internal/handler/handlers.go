package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"etk/internal/domain"
	"etk/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

// MaxBodyBytes 是所有写接口请求体的硬上限（字节）。
// 中间件另按 Content-Length 先拦一道，堵住「谎报长度」与「不声明长度」两条路。
const MaxBodyBytes = 16 * 1024

type envelope[T any] struct {
	Items    []T    `json:"items"`
	Total    int64  `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Sort     string `json:"sort"`
	Dir      string `json:"dir"`
	ServedAt string `json:"served_at"`
}

func newEnvelope[T any](items []T, total int64, page, size int, sort, dir string) envelope[T] {
	if items == nil {
		items = []T{}
	}
	return envelope[T]{
		Items: items, Total: total, Page: page, PageSize: size, Sort: sort, Dir: dir,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func (h *Handler) Stats(c *gin.Context) {
	days := domain.ParseDays(c.Request.URL.Query())
	s, err := h.svc.Stats(c.Request.Context(), days)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) Events(c *gin.Context) {
	q := domain.ParseEventQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Events(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, newEnvelope(rows, total, q.Page, q.PageSize, q.Sort, q.Dir))
}

// Detail：场次本体 + 票档实时口径（含现价与余量）。
func (h *Handler) Detail(c *gin.Context) {
	row, types, err := h.svc.Detail(c.Request.Context(), c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"event": row, "ticket_types": types})
}

func (h *Handler) Orders(c *gin.Context) {
	q := domain.ParseOrderQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Orders(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, newEnvelope(rows, total, q.Page, q.PageSize, q.Sort, q.Dir))
}

func (h *Handler) Tickets(c *gin.Context) {
	q := domain.ParseTicketQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Tickets(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, newEnvelope(rows, total, q.Page, q.PageSize, q.Sort, q.Dir))
}

func (h *Handler) Ticket(c *gin.Context) {
	row, err := h.svc.TicketByCode(c.Request.Context(), c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": row})
}

func (h *Handler) CreateEvent(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	var in domain.CreateEventInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	e, err := h.svc.CreateEvent(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"event": e, "message": "场次已建好，处于待开票"})
}

type statusInput struct {
	Action string `json:"action"`
}

func (h *Handler) EventStatus(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	code := strings.TrimSpace(c.Param("code"))
	if !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "场次编号非法"})
		return
	}
	var in statusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	e, msg, err := h.svc.SetStatus(c.Request.Context(), code, in.Action)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"event": e, "message": msg})
}

func (h *Handler) Sale(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	var in domain.SaleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	order, tickets, err := h.svc.Sale(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if tickets == nil {
		tickets = []domain.Ticket{}
	}
	c.JSON(http.StatusCreated, gin.H{
		"order": order, "tickets": tickets,
		"message": "出票成功，票券已进台账",
	})
}

// CheckIn 是闸口唯一的写入口：一票一入，任何裁决不过都不写库。
func (h *Handler) CheckIn(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	code := strings.TrimSpace(c.Param("code"))
	var in domain.CheckinInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	ticket, msg, err := h.svc.CheckIn(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": ticket, "message": msg})
}

func (h *Handler) Refund(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	code := strings.TrimSpace(c.Param("code"))
	if !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_order_code", Message: "订单编号非法"})
		return
	}
	var in domain.RefundInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	order, refundCent, err := h.svc.Refund(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"order": order, "refunded_cent": refundCent,
		"message": "退票完成，票面已退、服务费留存",
	})
}
