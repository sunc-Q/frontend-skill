package handler

import (
	"encoding/json"
	"errors"
	"io"
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

// 请求体上限：下单最多几条备注与一位手机号，16KB 足够；超上限直接 400，不进 JSON 解析器。
const maxBodyBytes = 16 << 10

func decodeJSON(c *gin.Context, target any) error {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxBodyBytes+1))
	if err != nil {
		return err
	}
	if len(body) > maxBodyBytes {
		return errors.New("body too large")
	}
	if len(body) == 0 {
		return errors.New("empty body")
	}
	return json.Unmarshal(body, target)
}

func badRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: msg})
}

// roomCode 校验路径参数：非法编码直接 404，绝不把它拼进 SQL。
func roomCode(c *gin.Context) (string, bool) {
	code := strings.TrimSpace(c.Param("code"))
	if !domain.IsCode(code) {
		c.JSON(http.StatusNotFound, errorBody{Code: "not_found", Message: "房型编码不存在"})
		return "", false
	}
	return code, true
}

func bookingCode(c *gin.Context) (string, bool) {
	code := strings.TrimSpace(c.Param("code"))
	if !domain.IsCode(code) || !strings.HasPrefix(code, "HS") {
		c.JSON(http.StatusNotFound, errorBody{Code: "not_found", Message: "订单号不存在"})
		return "", false
	}
	return code, true
}

// window 收敛 ?days=：默认 28，最大 90。
func window(c *gin.Context, def int) (string, int) {
	today := service.Today()
	from := c.Query("from")
	days, _ := strconv.Atoi(c.Query("days"))
	return domain.DateRange(today, from, days, def)
}

func (h *Handler) Stats(c *gin.Context) {
	st, err := h.svc.TodayStats(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (h *Handler) Properties(c *gin.Context) {
	_, days := window(c, service.DefaultWindow())
	rows, err := h.svc.Properties(c.Request.Context(), service.Today(), days)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.PropertyRow{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items": rows,  // 与其它列表接口同键名，前端只认 items
		"today":      service.Today(),
		"window":     days,
	})
}

func (h *Handler) Rooms(c *gin.Context) {
	q := domain.ParseRoomQuery(c.Request.URL.Query())
	_, days := window(c, service.DefaultWindow())
	rows, total, err := h.svc.Rooms(c.Request.Context(), q, service.Today(), days)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.RoomRow{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items": rows, "total": total, "page": q.Page, "page_size": q.PageSize,
		"sort": q.SortKey(), "dir": q.Dir, "window": days, "today": service.Today(),
		"filters": gin.H{"property": q.Property, "status": q.Status, "breakfast": q.Breakfast},
	})
}

func (h *Handler) RoomDetail(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	from, days := window(c, service.DefaultWindow())
	card, cal, prop, err := h.svc.RoomDetail(c.Request.Context(), code, from, days, service.Today())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"room": card, "calendar": cal, "property": prop, "today": service.Today()})
}

// Quote 是只读试算：不可订也返回 200，由 blockers/ok 表达原因。
func (h *Handler) Quote(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	in := domain.QuoteInput{
		CheckIn:  strings.TrimSpace(c.Query("check_in")),
		CheckOut: strings.TrimSpace(c.Query("check_out")),
	}
	in.Units, _ = strconv.Atoi(c.Query("units"))
	in.Guests, _ = strconv.Atoi(c.Query("guests"))
	if !domain.ValidDate(in.CheckIn) {
		in.CheckIn = service.Today()
	}
	if !domain.ValidDate(in.CheckOut) {
		in.CheckOut = domain.AddDays(in.CheckIn, 2)
	}
	if in.Units < 0 {
		in.Units = 0
	}
	if in.Guests < 0 {
		in.Guests = 0
	}
	q, err := h.svc.Quote(c.Request.Context(), code, in, service.Today())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"quote": q, "today": service.Today()})
}

func (h *Handler) Bookings(c *gin.Context) {
	q := domain.ParseBookingQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Bookings(c.Request.Context(), q, service.Today())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.BookingRow{}
	}
	c.JSON(http.StatusOK, gin.H{
		"items": rows, "total": total, "page": q.Page, "page_size": q.PageSize,
		"sort": q.SortKey(), "dir": q.Dir, "today": service.Today(),
		"filters": gin.H{"status": q.Status, "property": q.Property, "channel": q.Channel,
			"room": q.Room, "horizon": q.Horizon, "q": q.Search},
	})
}

func (h *Handler) BookingDetail(c *gin.Context) {
	code, ok := bookingCode(c)
	if !ok {
		return
	}
	row, nights, err := h.svc.BookingDetail(c.Request.Context(), code, service.Today())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"booking": row, "nights": nights})
}

// ---------- 写接口（全部过 AdminAuth）----------

func (h *Handler) Book(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	var in domain.BookingInput
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	if errs, valid := in.Validate(); !valid {
		AbortWithError(c, domain.Field("invalid_request", "参数校验未通过", errs))
		return
	}
	now := time.Now()
	if v := strings.TrimSpace(c.Query("now")); domain.ValidDate(v) {
		now = domain.MustDate(v).Add(12 * time.Hour)
	}
	row, err := h.svc.Book(c.Request.Context(), code, in, now)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"booking": row, "message": "已生成待确认订单 " + row.Code})
}

func (h *Handler) SetBookingStatus(c *gin.Context) {
	code, ok := bookingCode(c)
	if !ok {
		return
	}
	var in domain.StatusInput
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	if errs, valid := in.Validate(); !valid {
		AbortWithError(c, domain.Field("invalid_request", "参数校验未通过", errs))
		return
	}
	now := time.Now()
	if v := strings.TrimSpace(c.Query("now")); domain.ValidDate(v) {
		now = domain.MustDate(v).Add(12 * time.Hour)
	}
	row, msg, err := h.svc.SetStatus(c.Request.Context(), code, in, now)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"booking": row, "message": msg})
}

func (h *Handler) ToggleClosure(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	var in domain.ClosureInput
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	if errs, valid := in.Validate(); !valid {
		AbortWithError(c, domain.Field("invalid_request", "参数校验未通过", errs))
		return
	}
	cell, err := h.svc.ToggleClosure(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"day": cell, "message": closureMessage(cell)})
}

func closureMessage(cell *domain.CalDay) string {
	if cell.Closed {
		return "该日已停售，已订出的入住不受影响"
	}
	return "该日已恢复售卖，可售 " + strconv.Itoa(cell.Available) + " 间"
}

func (h *Handler) SetRoomStatus(c *gin.Context) {
	code, ok := roomCode(c)
	if !ok {
		return
	}
	var in struct {
		To string `json:"to"`
	}
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	if !domain.ValidRoomStatus(in.To) {
		AbortWithError(c, domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"to": "只能是 active 或 inactive"}))
		return
	}
	n, err := h.svc.SetRoomStatus(c.Request.Context(), code, in.To)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"active_rooms": n, "message": "在售房型数已更新为 " + strconv.FormatInt(n, 10)})
}
