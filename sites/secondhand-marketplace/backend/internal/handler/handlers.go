package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"flea/internal/domain"
	"flea/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

// MaxBodyBytes：写接口请求体上限，防放大攻击。
// MaxBodyBytes：所有写接口请求体的硬上限（字节）。服务端另有中间件按 Content-Length 先拦一道。
const MaxBodyBytes = 16 * 1024

type listingEnvelope struct {
	Items    []domain.ListingRow `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Sort     string              `json:"sort"`
	Dir      string              `json:"dir"`
	ServedAt string              `json:"served_at"`
}

type offerEnvelope struct {
	Items    []domain.OfferView `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
	Sort     string             `json:"sort"`
	Dir      string             `json:"dir"`
	ServedAt string             `json:"served_at"`
}

func (h *Handler) Categories(c *gin.Context) {
	cats, err := h.svc.Categories(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": cats, "total": len(cats)})
}

func (h *Handler) Metrics(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	m, err := h.svc.Metrics(c.Request.Context(), days)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) Listings(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Listings(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.ListingRow{}
	}
	c.JSON(http.StatusOK, listingEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.Sort, Dir: q.Dir, ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) Deals(c *gin.Context) {
	q := domain.ParseOfferQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Deals(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.OfferView{}
	}
	c.JSON(http.StatusOK, offerEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.Sort, Dir: q.Dir, ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// Detail 走挂单编号（人类可读、可分享），不是自增 ID。
func (h *Handler) Detail(c *gin.Context) {
	code := c.Param("code")
	row, offers, err := h.svc.Detail(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"listing": row, "offers": offers})
}

func (h *Handler) CreateListing(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	var in domain.CreateListingInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	l, err := h.svc.CreateListing(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"listing": l, "message": "挂单已上架"})
}

type offerParam struct {
	Code string `uri:"code"`
}

func (h *Handler) PlaceOffer(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	var p offerParam
	if err := c.ShouldBindUri(&p); err != nil || !domain.CodeAllowed(strings.TrimSpace(p.Code)) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_code", Message: "挂单编号非法"})
		return
	}
	var in domain.PlaceOfferInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	off, err := h.svc.PlaceOffer(c.Request.Context(), p.Code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"offer": off, "message": "出价已挂单"})
}

type decideInput struct {
	Action string `json:"action"`
}

// Decide：卖家对一笔出价做「确认成交」或「拒绝」。
// 合并成一个端点而不是两个，是为了让 action 成为可校验字段（非法值 400），
// 也避免前端各调一个接口导致状态机两条路径漂移。
func (h *Handler) Decide(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxBodyBytes)
	dealNo := strings.TrimSpace(c.Param("no"))
	if !domain.CodeAllowed(dealNo) {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_deal_no", Message: "出价单号非法"})
		return
	}
	var in decideInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	switch strings.ToLower(strings.TrimSpace(in.Action)) {
	case "accept":
		row, msg, err := h.svc.Decide(c.Request.Context(), dealNo, true)
		if err != nil {
			AbortWithError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"listing": row, "deal_no": dealNo, "message": msg})
	case "reject":
		row, msg, err := h.svc.Decide(c.Request.Context(), dealNo, false)
		if err != nil {
			AbortWithError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"listing": row, "deal_no": dealNo, "message": msg})
	default:
		c.JSON(http.StatusBadRequest, errorBody{
			Code: "invalid_request", Message: "action 只能是 accept 或 reject",
			Fields: map[string]string{"action": "action 只能是 accept 或 reject"},
		})
	}
}
