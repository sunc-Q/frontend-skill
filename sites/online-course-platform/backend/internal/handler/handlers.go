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

type courseListEnvelope struct {
	Items    []domain.CourseRow `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
	Sort     string             `json:"sort"`
	Dir      string             `json:"dir"`
	Domain   string             `json:"domain"`
	Level    string             `json:"level"`
	Q        string             `json:"q"`
	ServedAt string             `json:"served_at"`
}

func (h *Handler) Courses(c *gin.Context) {
	q := domain.ParseCourseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.ListCourses(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.CourseRow{}
	}
	c.JSON(http.StatusOK, courseListEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.Sort, Dir: q.Dir, Domain: q.Domain, Level: q.Level, Q: q.Search,
		ServedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// courseCode 从路径参数取课程标识并做白名单校验，非法一律 404（不给注入探路）。
func courseCode(c *gin.Context) (string, bool) {
	code := strings.TrimSpace(c.Param("code"))
	if !domain.ValidCourseCode(code) {
		c.JSON(http.StatusNotFound, errorBody{Code: "not_found", Message: "课程不存在"})
		return "", false
	}
	return code, true
}

func (h *Handler) CourseDetail(c *gin.Context) {
	code, ok := courseCode(c)
	if !ok {
		return
	}
	d, err := h.svc.CourseDetailOf(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *Handler) Instructors(c *gin.Context) {
	list, err := h.svc.Instructors(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if list == nil {
		list = []domain.InstructorRow{}
	}
	c.JSON(http.StatusOK, gin.H{"items": list, "total": len(list)})
}

func (h *Handler) Stats(c *gin.Context) {
	s, err := h.svc.Stats(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) Enroll(c *gin.Context) {
	var in domain.EnrollInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	e, err := h.svc.Enroll(c.Request.Context(), in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"enrollment": toView(e), "message": enrollmentMessage(e)})
}

func (h *Handler) Progress(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_id", Message: "报名 ID 非法"})
		return
	}
	var in domain.ProgressInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	e, err := h.svc.Progress(c.Request.Context(), id, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"enrollment": toView(e), "message": "进度已更新"})
}

func (h *Handler) CourseStatus(c *gin.Context) {
	code, ok := courseCode(c)
	if !ok {
		return
	}
	var in domain.CourseStatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: "请求体无法解析"})
		return
	}
	updated, err := h.svc.ChangeCourseStatus(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"course": updated, "message": "课程状态已更新为 " + updated.Status})
}

func enrollmentMessage(e *domain.Enrollment) string {
	if e.Status == domain.EnrollWaitlist {
		return "名额已满，已进入候补队列（候补期间不扣费）"
	}
	return "报名成功，已开课学习"
}

// toView 把落库实体转成对外视图：手机号脱敏，raw phone 绝不出接口。
func toView(e *domain.Enrollment) domain.EnrollmentRow {
	return domain.EnrollmentRow{
		ID: e.ID, LearnerName: e.LearnerName, MaskedPhone: domain.MaskPhone(e.Phone),
		Status: e.Status, ProgressPct: e.ProgressPct,
		ListPrice: e.ListPrice, Discount: e.Discount, PaidCents: e.PaidCents,
		Source: e.Source, EnrolledAt: e.EnrolledAt,
	}
}
