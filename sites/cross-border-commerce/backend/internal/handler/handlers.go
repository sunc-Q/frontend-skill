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

type listEnvelope struct {
	Items    []domain.ProductRow `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Sort     string              `json:"sort"`
	Category string              `json:"category,omitempty"`
	ServedAt string              `json:"served_at"`
}

func (h *Handler) Meta(c *gin.Context) {
	stats, err := h.svc.Meta(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"categories": domain.Categories,
		"regions":    domain.Regions,
		"stats":      stats,
	})
}

func (h *Handler) List(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.ListProducts(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.ProductRow{}
	}
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.Sort, Category: q.Category,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) Detail(c *gin.Context) {
	sku := c.Param("sku")
	row, stats, reviews, err := h.svc.Detail(c.Request.Context(), sku)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"product": row, "stats": stats, "reviews": reviews})
}

func (h *Handler) Reviews(c *gin.Context) {
	sku := c.Param("sku")
	limit, _ := strconv.Atoi(c.Query("page_size"))
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	page, _ := strconv.Atoi(c.Query("page"))
	if page <= 0 {
		page = 1
	}
	rows, total, err := h.svc.Reviews(c.Request.Context(), sku, limit, (page-1)*limit)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": rows, "total": total, "page": page, "page_size": limit})
}

func (h *Handler) Cart(c *gin.Context) {
	view, err := h.svc.Cart(c.Request.Context(), c.Query("region"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

type addToCartBody struct {
	SKU string `json:"sku"`
	Qty int    `json:"qty"`
}

func (h *Handler) AddToCart(c *gin.Context) {
	var in addToCartBody
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	view, err := h.svc.AddToCart(c.Request.Context(), in.SKU, in.Qty, c.Query("region"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, view)
}

func (h *Handler) CreateProduct(c *gin.Context) {
	var in domain.CreateProductInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	p, err := h.svc.CreateProduct(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}
