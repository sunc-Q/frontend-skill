package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/service"
)

type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

// 请求体上限：判分接口最多 100 条作答，16KB 足够；超上限直接 413，不进 JSON 解析器。
const maxBodyBytes = 16 << 10

func decodeJSON(c *gin.Context, target any) error {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxBodyBytes+1))
	if err != nil {
		return err
	}
	if len(body) > maxBodyBytes {
		return errBodyTooLarge
	}
	if len(body) == 0 {
		return errEmptyBody
	}
	return json.Unmarshal(body, target)
}

var (
	errBodyTooLarge = errors.New("body too large")
	errEmptyBody    = errors.New("empty body")
)

func badRequest(c *gin.Context, code, msg string) {
	c.JSON(http.StatusBadRequest, errorBody{Code: code, Message: msg})
}

// Stats 支持 ?assessment=CODE 收窄到单场口径。
func (h *Handler) Stats(c *gin.Context) {
	st, err := h.svc.Stats(c.Request.Context(), c.Query("assessment"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

type assessmentList struct {
	Items    []domain.AssessmentRow `json:"items"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
	Sort     string                 `json:"sort"`
	Dir      string                 `json:"dir"`
	Filters  gin.H                  `json:"filters"`
	Subjects []string               `json:"subjects"`
}

func (h *Handler) Assessments(c *gin.Context) {
	q := domain.ParseAssessmentQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Assessments(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.AssessmentRow{}
	}
	c.JSON(http.StatusOK, assessmentList{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.SortKey(), Dir: q.Dir,
		Filters:  gin.H{"status": q.Status, "subject": q.Subject, "kind": q.Kind, "q": q.Search},
		Subjects: h.svc.Subjects(c.Request.Context()),
	})
}

func (h *Handler) Detail(c *gin.Context) {
	code, err := service.AssessmentCode(c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	row, qs, err := h.svc.Detail(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assessment": row, "questions": qs})
}

// Statistics 是单场的题目区分度 + 分布 + 趋势，全部来自已判分明细。
func (h *Handler) Statistics(c *gin.Context) {
	code, err := service.AssessmentCode(c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	ctx := c.Request.Context()
	row, err := h.svc.AssessmentRow(ctx, code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	items, err := h.svc.ItemStats(ctx, code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	st, err := h.svc.Stats(ctx, code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assessment": row, "items": items, "stats": st})
}

type attemptList struct {
	Items    []domain.AttemptRow `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
	Sort     string              `json:"sort"`
	Dir      string              `json:"dir"`
	Filters  gin.H               `json:"filters"`
}

func (h *Handler) Attempts(c *gin.Context) {
	code, err := service.AssessmentCode(c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	q := domain.ParseAttemptQuery(c.Request.URL.Query())
	rows, total, err := h.svc.Attempts(c.Request.Context(), code, q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.AttemptRow{}
	}
	c.JSON(http.StatusOK, attemptList{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: q.SortKey(), Dir: q.Dir,
		Filters: gin.H{"status": q.Status, "channel": q.Channel, "passed": q.Passed},
	})
}

func (h *Handler) AttemptReceipt(c *gin.Context) {
	no, err := service.AttemptNo(c.Param("no"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	row, err := h.svc.Attempt(c.Request.Context(), no)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	items, err := h.svc.Receipt(c.Request.Context(), no)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"attempt": row, "items": items})
}

// StartAttempt 是考生侧写接口：本演示用单个 ADMIN_TOKEN 守住所有写口，
// 真实系统应换成考生会话，但 fail-closed 的层次不变。
func (h *Handler) StartAttempt(c *gin.Context) {
	code, err := service.AssessmentCode(c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	var in domain.StartAttemptInput
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "invalid_request", "请求体无法解析或超出大小限制")
		return
	}
	row, qs, total, err := h.svc.StartAttempt(c.Request.Context(), code, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"attempt": row, "questions": qs, "total_score": total})
}

func (h *Handler) Submit(c *gin.Context) {
	no, err := service.AttemptNo(c.Param("no"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	var in domain.SubmitInput
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "invalid_request", "请求体无法解析或超出大小限制")
		return
	}
	row, items, err := h.svc.Submit(c.Request.Context(), no, in)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"attempt": row, "items": items, "message": submitMessage(row)})
}

func submitMessage(row *domain.AttemptRow) string {
	switch row.Status {
	case domain.AttemptInvalid:
		return "超时作废，本场不记成绩"
	case domain.AttemptGraded:
		if row.Passed {
			return "已通过，成绩已计入名次"
		}
		return "未达通过线，成绩已计入名次"
	default:
		return "已受理"
	}
}

func (h *Handler) SetStatus(c *gin.Context) {
	code, err := service.AssessmentCode(c.Param("code"))
	if err != nil {
		AbortWithError(c, err)
		return
	}
	var in domain.AssessmentStatusInput
	if err := decodeJSON(c, &in); err != nil {
		badRequest(c, "invalid_request", "请求体无法解析或超出大小限制")
		return
	}
	if errs, ok := in.Validate(); !ok {
		AbortWithError(c, domain.Field("invalid_request", "参数校验未通过", errs))
		return
	}
	a, err := h.svc.SetStatus(c.Request.Context(), code, in.To)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assessment": a, "served_at": time.Now().UTC().Format(time.RFC3339)})
}
