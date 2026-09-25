package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/service"
)

type Handler struct {
	svc      *service.Service
	adminSet bool
}

// New 组装 HTTP 处理器。adminSet 只用于 /health 的自述（不代表鉴权放行）。
func New(svc *service.Service, adminSet bool) *Handler { return &Handler{svc: svc, adminSet: adminSet} }

// 值班台的操作者身份：本场景没有登录态（写接口靠单个 ADMIN_TOKEN 把关），
// 事件里记录的是一个可核对的岗位名，而不是伪造的个人身份。
const deskActor = "值班台"

type listEnvelope struct {
	Items      []domain.TicketRow `json:"items"`
	Total      int64              `json:"total"`
	Page       int                `json:"page"`
	PageSize   int                `json:"page_size"`
	Sort       string             `json:"sort"`
	Dir        string             `json:"dir"`
	Only       string             `json:"only"`
	ServedAt   string             `json:"served_at"`
	NowField   string             `json:"now_field_time"`
	InSession  bool               `json:"now_in_session"`
	NextWindow string             `json:"next_window_at"`
	HasMore    bool               `json:"has_more"`
	FilterEcho map[string]string  `json:"filter_echo"`
}

func (h *Handler) Health(c *gin.Context) {
	now := h.svc.Now()
	c.JSON(http.StatusOK, gin.H{
		"status":          "ok",
		"time":            now.UTC().Format(time.RFC3339),
		"field_time":      now.In(domain.FieldTZ).Format(time.RFC3339),
		"today_field":     domain.DateKey(now),
		"working_day":     domain.IsWorkingDay(now),
		"day_reason":      domain.DayReason(now),
		"now_in_session":  !domain.NextSessionAt(now).After(now),
		"next_window_at":  domain.NextSessionAt(now).In(domain.FieldTZ).Format(time.RFC3339),
		"minutes_per_day": domain.MinutesPerDay,
		"session_windows": domain.SessionWindowLabels(),
		"admin_token_set": h.adminSet,
	})
}

func (h *Handler) List(c *gin.Context) {
	q := domain.ParseListQuery(c.Request.URL.Query())
	rows, total, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	if rows == nil {
		rows = []domain.TicketRow{}
	}
	now := h.svc.Now()
	c.JSON(http.StatusOK, listEnvelope{
		Items: rows, Total: total, Page: q.Page, PageSize: q.PageSize,
		Sort: domain.SortName(q.Sort), Dir: q.Dir, Only: q.Only,
		ServedAt:   now.UTC().Format(time.RFC3339),
		NowField:   now.In(domain.FieldTZ).Format(time.RFC3339),
		InSession:  !domain.NextSessionAt(now).After(now),
		NextWindow: domain.NextSessionAt(now).In(domain.FieldTZ).Format(time.RFC3339),
		HasMore:    int64(q.Page*q.PageSize) < total,
		FilterEcho: echoFilters(q),
	})
}

// echoFilters 把「实际生效」的筛选条件回显出去：非法值已被收敛，
// 页面据此告诉用户他的筛选有没有被接受，而不是静默忽略。
func echoFilters(q domain.ListQuery) map[string]string {
	out := map[string]string{"sort": domain.SortName(q.Sort), "dir": q.Dir}
	for k, v := range map[string]string{
		"status": q.Status, "severity": q.Severity, "priority": q.Priority,
		"tier": q.Tier, "team": q.Team, "agent": q.Agent,
		"customer": q.Customer, "q": q.Search, "only": q.Only,
	} {
		if v != "" {
			out[k] = v
		}
	}
	return out
}

func (h *Handler) Detail(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	d, err := h.svc.Detail(c.Request.Context(), code)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *Handler) Stats(c *gin.Context) {
	st, err := h.svc.Stats(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, st)
}

func (h *Handler) Agents(c *gin.Context) {
	out, err := h.svc.Agents(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": emptyIfNil(out), "total": len(out)})
}

func (h *Handler) Customers(c *gin.Context) {
	out, err := h.svc.Customers(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": emptyIfNil(out), "total": len(out)})
}

func (h *Handler) Policies(c *gin.Context) {
	out, err := h.svc.Policies(c.Request.Context())
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"items": emptyIfNil(out), "total": len(out),
		"tiers": domain.Tiers, "severities": domain.Severities,
		"note": "时效单位一律为工作分钟（business minutes），非挂钟分钟",
	})
}

// Meta 交回前端界面需要的全部字典与阈值。页面上没有任何一个硬编码的选项值，
// 字典改了（比如新增一个停表原因）前端不用重新构建。
func (h *Handler) Meta(c *gin.Context) {
	type opt struct {
		Value string `json:"value"`
		Label string `json:"label"`
	}
	statuses := make([]opt, 0, len(domain.AllStatuses))
	for _, s := range domain.AllStatuses {
		statuses = append(statuses, opt{s, domain.StatusLabel(s)})
	}
	tiers := make([]opt, 0, len(domain.Tiers))
	for _, t := range domain.Tiers {
		tiers = append(tiers, opt{t, domain.TierLabel(t)})
	}
	only := make([]opt, 0, len(domain.OnlyOptions))
	for _, o := range domain.OnlyOptions {
		only = append(only, opt{o, domain.OnlyLabels[o]})
	}
	now := h.svc.Now()
	c.JSON(http.StatusOK, gin.H{
		"statuses":             statuses,
		"tiers":                tiers,
		"severities":           domain.Severities,
		"priorities":           domain.Priorities,
		"only":                 only,
		"sorts":                domain.SortOptions,
		"categories":           domain.Categories,
		"channels":             domain.Channels,
		"pause_reasons":        domain.PauseReasons,
		"at_risk_window_bd":    domain.AtRiskWindow(),
		"max_reopen":           domain.MaxReopen,
		"max_page_size":        domain.MaxPageSize,
		"minutes_per_day":      domain.MinutesPerDay,
		"session_windows":      domain.SessionWindowLabels(),
		"field_zone":           domain.FieldTZ.String(),
		"field_utc_offset_min": domain.FieldOffsetMin,
		"next_window_at":       domain.NextSessionAt(now).In(domain.FieldTZ).Format(time.RFC3339),
		"policy_bounds":        gin.H{"response_min": []int{5, 1440}, "resolve_min": []int{30, 20160}},
		"unit_note":            "页面上一切「分钟」若标注 bd / 工作分钟，均为剔除夜间与节假日的时效分钟",
	})
}

func (h *Handler) CreateTicket(c *gin.Context) {
	var in domain.CreateTicketInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	row, err := h.svc.CreateTicket(c.Request.Context(), in, "")
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ticket": row, "message": "工单已受理，时效开始按工作分钟计"})
}

func (h *Handler) ChangeStatus(c *gin.Context) {
	var in domain.StatusInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	row, err := h.svc.ChangeStatus(c.Request.Context(), c.Param("code"), in, deskActor)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": row, "message": "已推进：" + domain.StatusLabel(row.Status)})
}

func (h *Handler) Pause(c *gin.Context) {
	var in domain.PauseInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	row, err := h.svc.Pause(c.Request.Context(), c.Param("code"), in, deskActor)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": row, "message": "已停表，时效暂停推进"})
}

func (h *Handler) Resume(c *gin.Context) {
	var in struct {
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		in.Note = ""
	}
	row, err := h.svc.Resume(c.Request.Context(), c.Param("code"), strings.TrimSpace(in.Note), deskActor)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": row, "message": "已恢复计时"})
}

func (h *Handler) Assign(c *gin.Context) {
	var in domain.AssignInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	row, err := h.svc.Assign(c.Request.Context(), c.Param("code"), in, deskActor)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ticket": row, "message": "派单已记录"})
}

func (h *Handler) UpsertPolicy(c *gin.Context) {
	var in domain.PolicyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		badRequest(c, "请求体无法解析或超出大小限制")
		return
	}
	p, created, err := h.svc.UpsertPolicy(c.Request.Context(), in, deskActor)
	if err != nil {
		AbortWithError(c, err)
		return
	}
	msg := "SLA 合同已更新：在办工单保持原时效快照"
	code := http.StatusOK
	if created {
		msg = "SLA 合同已新增：在办工单保持原时效快照"
		code = http.StatusCreated
	}
	c.JSON(code, gin.H{"policy": p, "created": created, "message": msg})
}

func badRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, errorBody{Code: "invalid_request", Message: msg})
}

func emptyIfNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
