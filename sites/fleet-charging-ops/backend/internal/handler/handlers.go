package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

// 所有列表接口的键名统一为 items/total/page/page_size（历史上因键名不统一造成整块 UI 空掉）。
type listEnvelope struct {
	Items    any    `json:"items"`
	Total    int64  `json:"total"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Sort     string `json:"sort"`
	Dir      string `json:"dir"`
	ServedAt string `json:"served_at"`
}

func (h *Handler) Piles(c *gin.Context) {
	piles, err := h.svc.Piles(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": piles, "total": len(piles)})
}

func (h *Handler) Vehicles(c *gin.Context) {
	all := c.Query("all") == "1"
	items, err := h.svc.Vehicles(c.Request.Context(), all)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

func (h *Handler) Tariffs(c *gin.Context) {
	all := c.Query("all") == "1"
	items, err := h.svc.Tariffs(c.Request.Context(), all)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

func (h *Handler) Stats(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	st, err := h.svc.Stats(c.Request.Context(), days)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (h *Handler) Quote(c *gin.Context) {
	p, errs, ok := domain.ParseQuoteQuery(c.Request.URL.Query())
	if !ok {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "参数校验未通过", Fields: errs})
		return
	}
	v, err := h.svc.QuoteOf(c.Request.Context(), p)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) Sessions(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Sessions(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.SessionRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.SortKey, Dir: q.Dir, ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) Session(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "会话编号需为 1-24 位字母、数字、- 或 _"})
		return
	}
	detail, err := h.svc.Session(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h *Handler) StartSession(c *gin.Context) {
	var in domain.StartSessionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.StartSession(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, detail)
}

func (h *Handler) Settle(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "会话编号非法"})
		return
	}
	var in domain.SettleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.Settle(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": detail, "message": "会话已结算"})
}

func (h *Handler) Fault(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "会话编号非法"})
		return
	}
	var in domain.FaultInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.MarkFault(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": detail, "message": "会话已登记故障"})
}

func (h *Handler) Abort(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "会话编号非法"})
		return
	}
	var in domain.AbortInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.Abort(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": detail, "message": "会话已弃单，费用作废"})
}

func (h *Handler) CreateTariff(c *gin.Context) {
	var in domain.CreateTariffInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	rule, err := h.svc.CreateTariff(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) ToggleTariff(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "规则 ID 非法"})
		return
	}
	rule, err := h.svc.ToggleTariff(c.Request.Context(), id)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) PileStatus(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "桩编号非法"})
		return
	}
	var in domain.PileStatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	pile, err := h.svc.SetPileStatus(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, pile)
}
