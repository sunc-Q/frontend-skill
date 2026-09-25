package handler

import (
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"libdesk/internal/domain"
	"libdesk/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

type listEnvelope struct {
	Items    any    `json:"items"`
	Total    int64  `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	ServedAt string `json:"served_at"`
}

func (h *Handler) Items(c *gin.Context) {
	q := domain.ParseItemQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Items(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.ItemRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) ItemDetail(c *gin.Context) {
	code := c.Param("code")
	if !utf8.ValidString(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "书目编码非法"})
		return
	}
	item, copies, err := h.svc.ItemDetail(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"item": item, "copies": copies})
}

func (h *Handler) Loans(c *gin.Context) {
	q := domain.ParseLoanQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Loans(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.LoanRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) LoanDetail(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "借阅 ID 非法"})
		return
	}
	row, err := h.svc.LoanDetail(c.Request.Context(), id)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"loan": row})
}

func (h *Handler) Member(c *gin.Context) {
	card := c.Param("card")
	detail, loans, err := h.svc.Member(c.Request.Context(), card)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if loans == nil {
		loans = []domain.LoanRow{}
	}
	c.JSON(http.StatusOK, gin.H{"member": detail, "loans": loans})
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

func (h *Handler) Borrow(c *gin.Context) {
	var in domain.BorrowInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	row, err := h.svc.Borrow(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"loan": row, "message": "借出成功"})
}

type loanIDParam struct {
	LoanID int64 `uri:"id"`
}

func (h *Handler) Return(c *gin.Context) {
	var p loanIDParam
	if err := c.ShouldBindUri(&p); err != nil || p.LoanID <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "借阅 ID 非法"})
		return
	}
	var in domain.ReturnInput
	_ = c.ShouldBindJSON(&in) // 允许空体；paid 缺省为 false
	row, fine, err := h.svc.Return(c.Request.Context(), p.LoanID, in.PaidOrDefault())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"loan": row, "fine_cents": fine, "message": "归还已入账"})
}

func (h *Handler) Renew(c *gin.Context) {
	var p loanIDParam
	if err := c.ShouldBindUri(&p); err != nil || p.LoanID <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "借阅 ID 非法"})
		return
	}
	row, err := h.svc.Renew(c.Request.Context(), p.LoanID)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"loan": row, "message": "续借成功，应还日已顺延"})
}
