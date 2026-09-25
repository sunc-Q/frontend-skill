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

type scheduleEnvelope struct {
	Items    []domain.SessionRow `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Sort     string              `json:"sort"`
	From     string              `json:"from"`
	Days     int                 `json:"days"`
	ServedAt string              `json:"served_at"`
}

func (h *Handler) Stats(c *gin.Context) {
	span, _ := strconv.Atoi(c.Query("days"))
	st, err := h.svc.Stats(c.Request.Context(), span)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (h *Handler) Schedule(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Schedule(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.SessionRow{}
	}
	c.JSON(http.StatusOK, scheduleEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort:     q.Sort,
		From:     h.svc.ScheduleFrom(q).Format("2006-01-02"),
		Days:     q.Days,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) Detail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "课节 ID 非法"})
		return
	}
	d, err := h.svc.Detail(c.Request.Context(), id)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *Handler) Classes(c *gin.Context) {
	items, err := h.svc.Classes(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

type bookParam struct {
	SessionID int64 `uri:"id"`
}

// Book 是前台/店长用的写接口：容量、查重、扣次全在后端事务里判定。
func (h *Handler) Book(c *gin.Context) {
	var p bookParam
	if err := c.ShouldBindUri(&p); err != nil || p.SessionID <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "课节 ID 非法"})
		return
	}
	var in domain.CreateBookingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	res, err := h.svc.Book(c.Request.Context(), p.SessionID, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	row, err := h.svc.Detail(c.Request.Context(), p.SessionID)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	msg := "预约成功，已确认占座"
	if res.Status == domain.BookingWaitlist {
		msg = "本节课已满，已放入候补队列"
	}
	c.JSON(http.StatusCreated, gin.H{
		"booking": res.Booking, "session": row, "credit_used": res.CreditUsed,
		"message": msg,
	})
}

func (h *Handler) CreateMember(c *gin.Context) {
	var in domain.CreateMemberInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	m, err := h.svc.CreateMember(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, m)
}
