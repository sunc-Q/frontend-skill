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

func (h *Handler) Lanes(c *gin.Context) {
	all := c.Query("all") == "1"
	lanes, err := h.svc.Lanes(c.Request.Context(), all)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": lanes, "total": len(lanes)})
}

func (h *Handler) Rules(c *gin.Context) {
	all := c.Query("all") == "1"
	rules, err := h.svc.Rules(c.Request.Context(), all)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": rules, "total": len(rules)})
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

func (h *Handler) Waybills(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Waybills(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.WaybillRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.SortKey, Dir: q.Dir, ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) Waybill(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "运单号需为 1-24 位字母、数字、- 或 _"})
		return
	}
	detail, err := h.svc.Waybill(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, detail)
}

func (h *Handler) CreateWaybill(c *gin.Context) {
	var in domain.CreateWaybillInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.CreateWaybill(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, detail)
}

func (h *Handler) Advance(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "运单号非法"})
		return
	}
	var in domain.AdvanceInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.Advance(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"waybill": detail, "message": "轨迹已登记"})
}

func (h *Handler) Exception(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" || len(code) > 24 || !domain.CodeAllowed(code) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "运单号非法"})
		return
	}
	var in domain.ExceptionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	detail, err := h.svc.ReportException(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"waybill": detail, "message": "运单已登记异常"})
}

func (h *Handler) CreateRule(c *gin.Context) {
	var in domain.CreateRuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	rule, err := h.svc.CreateRule(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func (h *Handler) ToggleRule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "规则 ID 非法"})
		return
	}
	rule, err := h.svc.ToggleRule(c.Request.Context(), id)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, rule)
}
