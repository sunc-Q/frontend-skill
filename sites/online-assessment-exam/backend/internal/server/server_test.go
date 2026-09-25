package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"bizsite/internal/domain"
	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

const (
	testToken = "unit-test-token"
	openPaper = "AS-2026-004"
)

var testNow = time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)

type env struct {
	router *gin.Engine
	repo   *repository.Repo
	dbPath string
}

func setup(t *testing.T, token string) *env {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dbPath := t.TempDir() + "/api.db"
	db, err := repository.Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), testNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	svc := service.New(repo)
	// 冻结时钟：开考窗口、限时作废与名次都必须是可预期的
	svc.SetClock(func() time.Time { return testNow })
	return &env{router: Router(handler.New(svc), token), repo: repo, dbPath: dbPath}
}

// rawRead 用第二条连接直接读库，只为取证（手机号/标准答案原文），
// 断言「这些值绝不出现在任何 HTTP 响应里」。
func rawRead(t *testing.T, path, sql string, out any) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("第二连接: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := db.Raw(sql).Scan(out).Error; err != nil {
		t.Fatalf("取证查询失败: %v", err)
	}
}

func do(r *gin.Engine, method, path, auth, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func bearer(tok string) string { return "Bearer " + tok }

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON: %v / %s", err, trunc(w.Body.String()))
	}
	return out
}

func trunc(s string) string {
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, code int, what string) map[string]any {
	t.Helper()
	if w.Code != code {
		t.Fatalf("%s: 状态码 %d，期望 %d（body=%s）", what, w.Code, code, trunc(w.Body.String()))
	}
	return decode(t, w)
}

// TestHealthAndUnknownRouteIsJSON 未匹配的 /api/* 必须是 JSON 404，
// 否则前端 JSON.parse 会直接抛错。
func TestHealthAndUnknownRouteIsJSON(t *testing.T) {
	e := setup(t, testToken)
	wantStatus(t, do(e.router, http.MethodGet, "/api/health", "", ""), 200, "health")
	w := do(e.router, http.MethodGet, "/api/nope", "", "")
	wantStatus(t, w, 404, "未知接口")
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "json") {
		t.Errorf("未知接口应返回 JSON，实际 Content-Type=%s", ct)
	}
	wantStatus(t, do(e.router, http.MethodGet, "/api/assessments/AS-9999-9999", "", ""), 404, "未知场次")
	// 安全响应头
	for _, h := range []string{"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"} {
		if w.Header().Get(h) == "" {
			t.Errorf("缺少安全响应头 %s", h)
		}
	}
}

// TestWriteAuthMatrix 覆盖三个写接口的 401 / 403 / 2xx 三层防线。
func TestWriteAuthMatrix(t *testing.T) {
	e := setup(t, testToken)
	r := e.router
	startBody := `{"name":"赵子墨","phone":"13800008888","channel":"web"}`
	cases := []struct {
		name, method, path, auth, body string
		want                           int
		wantCode                       string
	}{
		{"开考-无凭证", http.MethodPost, "/api/assessments/" + openPaper + "/attempts", "", startBody, 401, "unauthorized"},
		{"开考-非 Bearer 方案", http.MethodPost, "/api/assessments/" + openPaper + "/attempts", "Basic abc", startBody, 401, "unauthorized"},
		{"开考-只有前缀", http.MethodPost, "/api/assessments/" + openPaper + "/attempts", "Bearer ", startBody, 401, "unauthorized"},
		{"开考-错令牌", http.MethodPost, "/api/assessments/" + openPaper + "/attempts", bearer("wrong"), startBody, 403, "forbidden"},
		{"交卷-无凭证", http.MethodPost, "/api/attempts/AS-2026-001-0925-001/submit", "", `{"answers":[{"question_code":"X","picked":"A"}]}`, 401, "unauthorized"},
		{"交卷-错令牌", http.MethodPost, "/api/attempts/AS-2026-001-0925-001/submit", bearer("nope"), `{"answers":[]}`, 403, "forbidden"},
		{"改状态-无凭证", http.MethodPost, "/api/assessments/AS-2026-006/status", "", `{"to":"open"}`, 401, "unauthorized"},
		{"改状态-错令牌", http.MethodPost, "/api/assessments/AS-2026-006/status", bearer("x"), `{"to":"open"}`, 403, "forbidden"},
		{"开考-对令牌", http.MethodPost, "/api/assessments/" + openPaper + "/attempts", bearer(testToken), startBody, 201, ""},
		{"改状态-对令牌", http.MethodPost, "/api/assessments/AS-2026-006/status", bearer(testToken), `{"to":"open"}`, 200, ""},
		{"读接口不需要令牌", http.MethodGet, "/api/assessments", "", "", 200, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(r, tc.method, tc.path, tc.auth, tc.body)
			if w.Code != tc.want {
				t.Fatalf("%s %s -> %d，期望 %d（%s）", tc.method, tc.path, w.Code, tc.want, trunc(w.Body.String()))
			}
			if tc.wantCode != "" {
				if got, _ := decode(t, w)["code"].(string); got != tc.wantCode {
					t.Fatalf("错误码 %v，期望 %s", decode(t, w)["code"], tc.wantCode)
				}
			}
		})
	}
}

// TestWriteEndpointsFailClosedWithoutToken 服务端没配令牌时必须 503，绝不因「期望值为空」放行。
func TestWriteEndpointsFailClosedWithoutToken(t *testing.T) {
	e := setup(t, "")
	paths := []string{
		"/api/assessments/" + openPaper + "/attempts",
		"/api/attempts/AS-2026-001-0925-001/submit",
		"/api/assessments/AS-2026-006/status",
	}
	for _, p := range paths {
		w := do(e.router, http.MethodPost, p, bearer("anything"),
			`{"to":"open","name":"甲","phone":"13800009999","answers":[]}`)
		if w.Code != 503 {
			t.Errorf("POST %s -> %d，期望 503（%s）", p, w.Code, trunc(w.Body.String()))
		}
		if strings.Contains(w.Body.String(), "anything") {
			t.Error("503 响应回显了凭证")
		}
	}
	if w := do(e.router, http.MethodPost, paths[0], "", ""); w.Code != 503 {
		t.Errorf("无凭证也应 503，实际 %d", w.Code)
	}
	wantStatus(t, do(e.router, http.MethodGet, "/api/stats", "", ""), 200, "stats 仍可读")
}

// TestAttemptListEverySortColumnResolves 逐个排序键都必须返回 200：
// 名次来自排名子查询 sc（只有 id/rank_no 两列），一旦把 score 误写成 sc.score，
// 名单默认序会整页 500，而这类错误只在真实 SQL 规划时暴露。
func TestAttemptListEverySortColumnResolves(t *testing.T) {
	e := setup(t, testToken)
	cases := []struct{ key, dir string }{
		{"", "asc"}, {"", "desc"}, {"score", "desc"}, {"score", "asc"},
		{"rank", "asc"}, {"rank", "desc"}, {"elapsed", "asc"}, {"submitted", "desc"},
		{"started", "asc"}, {"candidate", "asc"}, {"status", "asc"}, {"id", "desc"},
		{"nomal_col", "asc"}, {";drop table attempts", "desc"},
	}
	for _, tc := range cases {
		path := "/api/assessments/" + openPaper + "/attempts?page_size=100"
		if tc.key != "" {
			path += "&sort=" + url.QueryEscape(tc.key)
		}
		if tc.dir != "" {
			path += "&dir=" + tc.dir
		}
		out := wantStatus(t, do(e.router, http.MethodGet, path, "", ""), 200, "名单排序 "+tc.key)
		items, _ := out["items"].([]any)
		if len(items) == 0 {
			t.Errorf("sort=%q dir=%q 返回空页", tc.key, tc.dir)
		}
		if tc.key == "score" || tc.key == "" {
			// 默认序就是 score desc：验证真的按分数排，而不是排完又被打乱
			prev := -1.0
			for _, raw := range items {
				it, _ := raw.(map[string]any)
				sc, _ := it["score"].(float64)
				if tc.dir == "desc" && sc > prev+1e-9 && prev >= 0 {
					t.Errorf("sort=score&dir=desc 非降序: %v 在 %v 之后", sc, prev)
				}
				prev = sc
			}
		}
	}
}

func TestAssessmentListFiltersAndClamps(t *testing.T) {
	e := setup(t, testToken)
	w := do(e.router, http.MethodGet, "/api/assessments?page_size=99999&page=0&sort=score%3B%20DROP&status=bogus&q=%25", "", "")
	out := wantStatus(t, w, 200, "列表")
	if got := fmt.Sprint(out["page_size"]); got != "100" {
		t.Errorf("page_size 未钳到 100，实际 %v", got)
	}
	if got := fmt.Sprint(out["page"]); got != "1" {
		t.Errorf("非法页码应收敛为 1，实际 %v", got)
	}
	if out["sort"] != "opens_at" {
		t.Errorf("非法排序字段应回落默认，实际 %v", out["sort"])
	}
	filters, _ := out["filters"].(map[string]any)
	if filters["status"] != "" {
		t.Errorf("非法 status 应被忽略，实际 %v", filters["status"])
	}
	if items, _ := out["items"].([]any); len(items) != 0 {
		t.Errorf("q=%% 已转义，不应命中任何行，实际 %d 行", len(items))
	}
	w = do(e.router, http.MethodGet, "/api/assessments?status=open&sort=attempts&dir=desc", "", "")
	out = wantStatus(t, w, 200, "open 列表")
	items, _ := out["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("status=open 应有 2 场，实际 %d", len(items))
	}
	if out["sort"] != "attempts" || out["dir"] != "desc" {
		t.Errorf("排序回显异常: %v/%v", out["sort"], out["dir"])
	}
	prev := 1 << 30
	for _, raw := range items {
		it, _ := raw.(map[string]any)
		if it["status"] != "open" {
			t.Errorf("过滤失效: %+v", it["status"])
		}
		if it["total_score"].(float64) != 100 {
			t.Errorf("满分应为 100，实际 %v", it["total_score"])
		}
		if it["attempts"].(float64) > float64(prev) {
			t.Error("attempts 降序失效")
		}
		prev = int(it["attempts"].(float64))
		if it["passed_count"].(float64) > it["attempts"].(float64) {
			t.Error("通过数大于作答数")
		}
		if it["question_no"].(float64) < 8 {
			t.Errorf("题数异常: %v", it["question_no"])
		}
	}
	if subj, _ := out["subjects"].([]any); len(subj) == 0 {
		t.Error("subjects 为空")
	}
	// 搜索命中与 kind 过滤
	out = wantStatus(t, do(e.router, http.MethodGet, "/api/assessments?q=%E6%95%B0%E6%8D%AE&kind=cert", "", ""), 200, "搜索")
	if items, _ := out["items"].([]any); len(items) != 1 {
		t.Errorf("搜「数据」+kind=cert 应命中 1 场，实际 %d", len(items))
	}
	// 越界页码不报错，只给空列表
	out = wantStatus(t, do(e.router, http.MethodGet, "/api/assessments?page=9999", "", ""), 200, "空页")
	if items, _ := out["items"].([]any); len(items) != 0 {
		t.Errorf("超界页应为空，实际 %d", len(items))
	}
}

// TestNoAnswerOrPhoneLeaks 本场景最关键的一条：所有读接口都不得出现
// 标准答案字段与手机号原文。
func TestNoAnswerOrPhoneLeaks(t *testing.T) {
	e := setup(t, testToken)
	var phones, answers []string
	rawRead(t, e.dbPath, `SELECT phone FROM attempts LIMIT 25`, &phones)
	rawRead(t, e.dbPath, `SELECT answer FROM questions WHERE answer <> ''`, &answers)
	if len(phones) == 0 || len(answers) == 0 {
		t.Fatal("取证样本为空")
	}
	paths := []string{
		"/api/stats",
		"/api/assessments",
		"/api/assessments/" + openPaper,
		"/api/assessments/" + openPaper + "/statistics",
		"/api/assessments/" + openPaper + "/attempts?page_size=100",
		"/api/assessments/AS-2026-001",
		"/api/assessments/AS-2026-001/attempts?page_size=100",
		"/api/assessments/AS-2026-003/statistics",
		"/api/assessments/AS-2026-006",
	}
	for _, p := range paths {
		w := do(e.router, http.MethodGet, p, "", "")
		body := w.Body.String()
		for _, leak := range []string{`"answer"`, `"phone"`, `"password"`, `|@|`, `"attempt_answers"`} {
			if strings.Contains(body, leak) {
				t.Errorf("%s 泄露了 %s", p, leak)
			}
		}
		// 卷面题必须给选项（考生要作答），但只能以数组形式出现；
		// 统计接口的载荷本就没有卷面结构，不参与该断言。
		if !strings.Contains(p, "/statistics") && strings.Contains(p, "/assessments/AS") &&
			strings.Contains(body, `"questions"`) && !strings.Contains(body, `"options":[`) {
			t.Errorf("%s 卷面缺选项数组", p)
		}
		for _, ph := range phones {
			if strings.Contains(body, ph) {
				t.Fatalf("%s 泄露手机号原文 %s", p, ph)
			}
		}
		// 长答案文本绝不允许出现在进行中场次的任何响应里；
		// 已收卷场次的题目分布按产品规则是公开内容，排除在外。
		published := strings.Contains(p, "AS-2026-001") || strings.Contains(p, "AS-2026-003")
		if !published {
			for _, an := range answers {
				// 短到 4 字符以内的答案（A/B/T/F）无法用子串判定，只查长答案
				if len([]rune(an)) > 4 && strings.Contains(body, an) {
					t.Fatalf("%s 疑似泄露长答案文本 %q", p, an)
				}
			}
		}
		if strings.Contains(body, "candidate_name") && !strings.Contains(body, "masked_phone") {
			t.Errorf("%s 出现考生却无脱敏手机号字段", p)
		}
	}
	// 进行中试卷的分布必须显式标注未公开，且不带任何选项分布明细
	openStats := wantStatus(t, do(e.router, http.MethodGet,
		"/api/assessments/"+openPaper+"/statistics", "", ""), 200, "进行中卷分布")
	for _, raw := range openStats["items"].([]any) {
		it, _ := raw.(map[string]any)
		if it["revealed"] != false {
			t.Errorf("进行中试卷的题目分布被公开: %+v", it)
		}
		if d, _ := it["distractors"].([]any); len(d) != 0 {
			t.Errorf("进行中试卷不应有选项分布: %+v", d)
		}
	}
	closedStats := wantStatus(t, do(e.router, http.MethodGet,
		"/api/assessments/AS-2026-003/statistics", "", ""), 200, "已收卷分布")
	revealedAny := false
	for _, raw := range closedStats["items"].([]any) {
		it, _ := raw.(map[string]any)
		if it["revealed"] == true {
			revealedAny = true
		}
	}
	if !revealedAny {
		t.Error("已收卷试卷应公布题目分布")
	}
}

func TestDetailAndStatisticsShape(t *testing.T) {
	e := setup(t, testToken)
	w := do(e.router, http.MethodGet, "/api/assessments/AS-2026-001", "", "")
	out := wantStatus(t, w, 200, "详情")
	asmt, _ := out["assessment"].(map[string]any)
	if asmt["code"] != "AS-2026-001" || asmt["total_score"].(float64) != 100 {
		t.Fatalf("详情头部异常: %+v", asmt)
	}
	qs, _ := out["questions"].([]any)
	if len(qs) < 8 {
		t.Fatalf("题量 %d", len(qs))
	}
	first, _ := qs[0].(map[string]any)
	if _, ok := first["options"].([]any); !ok {
		t.Errorf("卷面缺选项: %+v", first)
	}
	if first["order_no"].(float64) != 1 {
		t.Error("题序未从 1 开始")
	}
	w = do(e.router, http.MethodGet, "/api/assessments/AS-2026-001/statistics", "", "")
	out = wantStatus(t, w, 200, "统计")
	items, _ := out["items"].([]any)
	if len(items) != len(qs) {
		t.Errorf("题目统计 %d 行 != 题量 %d", len(items), len(qs))
	}
	st, _ := out["stats"].(map[string]any)
	if st["window"] != "单场已判分口径" {
		t.Errorf("口径标注异常: %v", st["window"])
	}
	if ok, _ := st["identity_ok"].(bool); !ok {
		t.Errorf("三分数恒等式体检未通过: %v 条违反", st["identity_violations"])
	}
	buckets, _ := st["buckets"].([]any)
	sum := int64(0)
	for _, b := range buckets {
		m, _ := b.(map[string]any)
		sum += int64(m["count"].(float64))
	}
	if sum != int64(st["graded"].(float64)) {
		t.Errorf("分布桶之和 %d != graded %v", sum, st["graded"])
	}
	// 全局 stats：桶之和 == graded，且 hardest 全是低正确率题
	st = wantStatus(t, do(e.router, http.MethodGet, "/api/stats", "", ""), 200, "全局统计")
	if st["assessments"].(float64) != 6 {
		t.Errorf("场次 %v", st["assessments"])
	}
	gb, _ := st["buckets"].([]any)
	gsum := int64(0)
	for _, b := range gb {
		m, _ := b.(map[string]any)
		gsum += int64(m["count"].(float64))
	}
	if gsum != int64(st["graded"].(float64)) {
		t.Errorf("全局分布桶之和 %d != graded %v", gsum, st["graded"])
	}
	if st["score_total"].(float64) != st["mechanical_total"].(float64)+st["half_credit_total"].(float64) {
		t.Error("全局三分数之和不闭合")
	}
	h, _ := st["hardest_items"].([]any)
	if len(h) == 0 {
		t.Fatal("缺最难五题")
	}
	lastAcc := -1.0
	for _, raw := range h {
		it, _ := raw.(map[string]any)
		acc := it["accuracy_pct"].(float64)
		if acc < lastAcc {
			t.Errorf("最难题未按正确率升序: %v after %v", acc, lastAcc)
		}
		lastAcc = acc
		if acc >= 85 {
			t.Errorf("最难题正确率 %.1f 过高", acc)
		}
	}
	if board, _ := st["top_board"].([]any); len(board) == 0 {
		t.Error("缺榜单")
	}
	// 未知场次收窄口径应 404
	if w := do(e.router, http.MethodGet, "/api/stats?assessment=AS-9999-9999", "", ""); w.Code != 404 {
		t.Errorf("stats?assessment 未知场次应 404，实际 %d", w.Code)
	}
}

func TestMalformedPathParamsAreBadRequest(t *testing.T) {
	e := setup(t, testToken)
	bad := []string{
		`/api/assessments/AS-2026-001'%20OR%20'1'='1`,
		`/api/assessments/AB`,
		`/api/assessments/%3Cscript%3E`,
		`/api/assessments/AS-2026-001%00`,
		`/api/attempts/1%20or%201=1`,
		`/api/attempts/short`,
	}
	for _, p := range bad {
		if w := do(e.router, http.MethodGet, p, "", ""); w.Code != 400 {
			t.Errorf("GET %s -> %d，期望 400（%s）", p, w.Code, trunc(w.Body.String()))
		}
	}
	// 路径穿越类编码：Gin 先规范化，落到 404（JSON）而不是 500 或读到文件
	for _, p := range []string{`/api/assessments/..%2f..%2fetc%2fpasswd`, `/api/assessments/%2e%2e/%2e%2e/etc/passwd`} {
		w := do(e.router, http.MethodGet, p, "", "")
		if w.Code != 400 && w.Code != 404 {
			t.Errorf("GET %s -> %d，期望 400/404（%s）", p, w.Code, trunc(w.Body.String()))
		}
		if strings.Contains(w.Body.String(), "root:") {
			t.Errorf("GET %s 读到了系统文件", p)
		}
	}
	// 写接口同样在路径参数层挡住
	for _, p := range []string{`/api/assessments/A'/status`, `/api/attempts/bad;no/submit`} {
		if w := do(e.router, http.MethodPost, p, bearer(testToken), `{"to":"open","answers":[]}`); w.Code != 400 {
			t.Errorf("POST %s -> %d，期望 400", p, w.Code)
		}
	}
}

func fullPaperBody(qs []domain.Question) string {
	parts := make([]string, 0, len(qs))
	for _, q := range qs {
		parts = append(parts, fmt.Sprintf(`{"question_code":%q,"picked":%q}`, q.Code, q.Answer))
	}
	return `{"answers":[` + strings.Join(parts, ",") + `]}`
}

// TestSubmitEndToEndFlow 走一遍真实考生路径：开考 → 校验矩阵 → 全对交卷 → 名次 → 回执。
func TestSubmitEndToEndFlow(t *testing.T) {
	e := setup(t, testToken)
	r := e.router
	ctx := context.Background()
	asmt, err := e.repo.AssessmentByCode(ctx, openPaper)
	if err != nil {
		t.Fatal(err)
	}
	qs, err := e.repo.Questions(ctx, asmt.ID)
	if err != nil {
		t.Fatal(err)
	}
	phone := "13712340000"
	w := do(r, http.MethodPost, "/api/assessments/"+openPaper+"/attempts", bearer(testToken),
		fmt.Sprintf(`{"name":"测试考生","phone":"%s","channel":"campus","unknown_field":1}`, phone))
	out := wantStatus(t, w, 201, "开考")
	at, _ := out["attempt"].(map[string]any)
	no, _ := at["attempt_no"].(string)
	if no == "" {
		t.Fatal("开考未返回编号")
	}
	if at["masked_phone"] != domain.MaskPhone(phone) {
		t.Errorf("开考响应手机号未脱敏: %v", at["masked_phone"])
	}
	if at["status"] != "ongoing" {
		t.Errorf("初始状态 %v", at["status"])
	}
	if got := out["total_score"]; got.(float64) != 100 {
		t.Errorf("卷面满分 %v", got)
	}
	if strings.Contains(w.Body.String(), phone) {
		t.Error("开考响应含手机号原文")
	}
	// 同一手机号重复开考 -> 409
	if w := do(r, http.MethodPost, "/api/assessments/"+openPaper+"/attempts", bearer(testToken),
		fmt.Sprintf(`{"name":"重复","phone":"%s","channel":"web"}`, phone)); w.Code != 409 {
		t.Errorf("重复开考应 409，实际 %d", w.Code)
	}
	// 开考字段校验矩阵：逐字段回显
	badStarts := []struct{ name, body, field string }{
		{"手机号非法", `{"name":"甲","phone":"23812345678"}`, "phone"},
		{"手机号注入", `{"name":"甲","phone":"1' OR '1'='1"}`, "phone"},
		{"姓名为空", `{"name":"  ","phone":"13712340001"}`, "name"},
		{"姓名超长", `{"name":"` + strings.Repeat("长", 33) + `","phone":"13712340001"}`, "name"},
		{"渠道非法", `{"name":"甲","phone":"13712340002","channel":"fax"}`, "channel"},
	}
	for _, tc := range badStarts {
		w := do(r, http.MethodPost, "/api/assessments/"+openPaper+"/attempts", bearer(testToken), tc.body)
		out := wantStatus(t, w, 400, tc.name)
		fields, _ := out["fields"].(map[string]any)
		if _, ok := fields[tc.field]; !ok {
			t.Errorf("%s 未逐字段回显: %v", tc.name, fields)
		}
	}
	// 交卷参数校验矩阵
	longPicked := strings.Repeat("A", 70)
	submitCases := []struct {
		name, body string
		want       int
		wantField  string
	}{
		{"空作答", `{"answers":[]}`, 400, "answers"},
		{"缺字段", `{}`, 400, "answers"},
		{"无法解析", `{`, 400, ""},
		{"超大请求体", `{"answers":[{"question_code":"AS-2026-004-Q01","picked":"` + strings.Repeat("A", 20000) + `"}]}`, 400, ""},
		{"题号注入", `{"answers":[{"question_code":"A' OR 1=1","picked":"A"}]}`, 400, "answers[0].question_code"},
		{"别场题号", `{"answers":[{"question_code":"AS-2026-001-Q01","picked":"A"}]}`, 400, "question_code"},
		{"超长作答", fmt.Sprintf(`{"answers":[{"question_code":"AS-2026-004-Q01","picked":%q}]}`, longPicked), 400, "answers[0].picked"},
		{"重复题号", `{"answers":[{"question_code":"AS-2026-004-Q01","picked":"A"},{"question_code":"AS-2026-004-Q01","picked":"B"}]}`, 400, "answers[1].question_code"},
	}
	for _, tc := range submitCases {
		w := do(r, http.MethodPost, "/api/attempts/"+no+"/submit", bearer(testToken), tc.body)
		if w.Code != tc.want {
			t.Errorf("%s -> %d，期望 %d（%s）", tc.name, w.Code, tc.want, trunc(w.Body.String()))
			continue
		}
		if tc.wantField != "" {
			fields, _ := decode(t, w)["fields"].(map[string]any)
			if _, ok := fields[tc.wantField]; !ok {
				t.Errorf("%s 未回显字段 %s，实际 %v", tc.name, tc.wantField, fields)
			}
		}
	}
	// 被拒绝的提交不得污染这份卷
	out = wantStatus(t, do(r, http.MethodGet, "/api/attempts/"+no, "", ""), 200, "回执（未交卷前）")
	if got := out["attempt"].(map[string]any)["status"]; got != "ongoing" {
		t.Fatalf("失败提交改动了状态: %v", got)
	}
	// 全对交卷：满分、通过、百分制 100
	body := fullPaperBody(qs)
	w = do(r, http.MethodPost, "/api/attempts/"+no+"/submit", bearer(testToken), body)
	out = wantStatus(t, w, 200, "交卷")
	res, _ := out["attempt"].(map[string]any)
	if res["score"].(float64) != 100 || res["mechanical_score"].(float64) != 100 || res["half_credit"].(float64) != 0 {
		t.Fatalf("全对判分异常: %+v", res)
	}
	if res["status"] != "graded" || res["passed"] != true || res["percent"].(float64) != 100 {
		t.Fatalf("判分结果异常: %+v", res)
	}
	items, _ := out["items"].([]any)
	if len(items) != len(qs) {
		t.Fatalf("回执 %d 行 != 题量 %d", len(items), len(qs))
	}
	for _, raw := range items {
		it, _ := raw.(map[string]any)
		if it["correct"] != true || it["awarded"].(float64) != it["max_score"].(float64) {
			t.Errorf("全对回执却有错行: %+v", it)
		}
		if _, ok := it["answer"]; ok {
			t.Error("回执泄露答案字段")
		}
	}
	// 重复交卷 409；未知编号 404
	if w := do(r, http.MethodPost, "/api/attempts/"+no+"/submit", bearer(testToken), body); w.Code != 409 {
		t.Errorf("重复交卷应 409，实际 %d", w.Code)
	}
	if w := do(r, http.MethodPost, "/api/attempts/AS-2026-004-9999-999/submit", bearer(testToken), body); w.Code != 404 {
		t.Errorf("未知编号应 404，实际 %d", w.Code)
	}
	// 满分卷必须排进本场第一，并出现在名单与榜单里
	out = wantStatus(t, do(r, http.MethodGet, "/api/assessments/"+openPaper+"/attempts?sort=rank&dir=asc&page_size=5", "", ""), 200, "名单")
	top := out["items"].([]any)[0].(map[string]any)
	if top["attempt_no"] != no || top["rank_no"].(float64) != 1 {
		t.Errorf("满分卷未排第一: %+v", top)
	}
	if top["masked_phone"] != domain.MaskPhone(phone) {
		t.Errorf("名单脱敏异常: %v", top["masked_phone"])
	}
	st := wantStatus(t, do(r, http.MethodGet, "/api/stats?assessment="+openPaper, "", ""), 200, "单场统计")
	if board := st["top_board"].([]any); board[0].(map[string]any)["attempt_no"] != no {
		t.Errorf("榜单第一不是刚交卷的满分卷: %+v", board[0])
	}
	// 漏选多选题 -> 产生半分且机械分/半分之和等于总分
	paper2, err := e.repo.AssessmentByCode(ctx, "AS-2026-005")
	if err != nil {
		t.Fatal(err)
	}
	qs2, err := e.repo.Questions(ctx, paper2.ID)
	if err != nil {
		t.Fatal(err)
	}
	w = do(r, http.MethodPost, "/api/assessments/AS-2026-005/attempts", bearer(testToken),
		`{"name":"漏选卷","phone":"13712340007"}`)
	no2 := wantStatus(t, w, 201, "开考2")["attempt"].(map[string]any)["attempt_no"].(string)
	parts := make([]string, 0, len(qs2))
	wantHalf := 0
	for _, q := range qs2 {
		picked := q.Answer
		if q.Type == domain.TypeMulti {
			ans := domain.NormalizePicked(q.Type, q.Answer)
			picked = string([]rune(ans)[:len(ans)-1])
			wantHalf += q.Score / 2
		}
		parts = append(parts, fmt.Sprintf(`{"question_code":%q,"picked":%q}`, q.Code, picked))
	}
	res = wantStatus(t, do(r, http.MethodPost, "/api/attempts/"+no2+"/submit", bearer(testToken),
		`{"answers":[`+strings.Join(parts, ",")+`]}`), 200, "漏选交卷")["attempt"].(map[string]any)
	if res["half_credit"].(float64) != float64(wantHalf) {
		t.Errorf("半分 %v，期望 %d", res["half_credit"], wantHalf)
	}
	if res["score"].(float64) != res["mechanical_score"].(float64)+res["half_credit"].(float64) {
		t.Errorf("三分数不闭合: %+v", res)
	}
	// 全部留空提交：不报错、得 0 分、判为未通过
	empty := make([]string, 0, len(qs2))
	for _, q := range qs2 {
		empty = append(empty, fmt.Sprintf(`{"question_code":%q,"picked":""}`, q.Code))
	}
	w = do(r, http.MethodPost, "/api/assessments/AS-2026-005/attempts", bearer(testToken),
		`{"name":"白卷","phone":"13712340008"}`)
	no3 := wantStatus(t, w, 201, "开考3")["attempt"].(map[string]any)["attempt_no"].(string)
	res = wantStatus(t, do(r, http.MethodPost, "/api/attempts/"+no3+"/submit", bearer(testToken),
		`{"answers":[`+strings.Join(empty, ",")+`]}`), 200, "白卷交卷")["attempt"].(map[string]any)
	if res["score"].(float64) != 0 || res["passed"] != false || res["status"] != "graded" {
		t.Errorf("白卷判分异常: %+v", res)
	}
}

// TestClosedPaperGuardsAndStateMachine 闭卷不许开考；场次状态机非法跳转 409。
func TestClosedPaperGuardsAndStateMachine(t *testing.T) {
	e := setup(t, testToken)
	r := e.router
	if w := do(r, http.MethodPost, "/api/assessments/AS-2026-001/attempts", bearer(testToken),
		`{"name":"迟到","phone":"13611110000"}`); w.Code != 409 {
		t.Errorf("闭卷场次开考应 409，实际 %d", w.Code)
	}
	out := wantStatus(t, do(r, http.MethodPost, "/api/assessments/AS-2026-001/attempts", bearer(testToken),
		`{"name":"迟到","phone":"13611110000"}`), 409, "闭卷")
	if out["code"] != "assessment_not_open" {
		t.Errorf("错误码 %v", out["code"])
	}
	if w := do(r, http.MethodPost, "/api/assessments/AS-2026-006/status", bearer(testToken), `{"to":"open"}`); w.Code != 200 {
		t.Errorf("草稿发布应 200，实际 %d", w.Code)
	}
	if w := do(r, http.MethodPost, "/api/assessments/AS-2026-006/status", bearer(testToken), `{"to":"open"}`); w.Code != 409 {
		t.Errorf("open->open 应 409，实际 %d", w.Code)
	}
	w := do(r, http.MethodPost, "/api/assessments/AS-2026-006/status", bearer(testToken), `{"to":"draft"}`)
	out = wantStatus(t, w, 400, "非法目标状态")
	if _, ok := out["fields"].(map[string]any)["to"]; !ok {
		t.Errorf("应回显 to 字段错误: %v", out)
	}
	if w := do(r, http.MethodPost, "/api/assessments/AS-2026-006/status", bearer(testToken), `{"to":"closed"}`); w.Code != 200 {
		t.Errorf("open->closed 应 200，实际 %d", w.Code)
	}
	if w := do(r, http.MethodPost, "/api/assessments/AS-2026-006/status", bearer(testToken), `{"to":"open"}`); w.Code != 409 {
		t.Errorf("closed 是终态，应 409，实际 %d", w.Code)
	}
	// 已闭卷的场次不许再开考
	if w := do(r, http.MethodPost, "/api/assessments/AS-2026-006/attempts", bearer(testToken),
		`{"name":"甲","phone":"13611110002"}`); w.Code != 409 {
		t.Errorf("closed 场次开考应 409，实际 %d", w.Code)
	}
}

func TestOptionsPreflightAllowsLocalhost(t *testing.T) {
	e := setup(t, testToken)
	req := httptest.NewRequest(http.MethodOptions, "/api/assessments", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5199")
	req.Header.Set("Access-Control-Request-Method", "POST")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("预检应 204，实际 %d", w.Code)
	}
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5199" {
		t.Errorf("未放行 localhost 来源: %q", got)
	}
	req2 := httptest.NewRequest(http.MethodOptions, "/api/assessments", nil)
	req2.Header.Set("Origin", "null") // file:// 的 Origin，绝不能放行
	w2 := httptest.NewRecorder()
	e.router.ServeHTTP(w2, req2)
	if w2.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("不应放行 Origin: null")
	}
}

func TestStaticServingIsSafe(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/index.html", []byte("<html><body>demo</body></html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("STATIC_DIR", dir)
	db, err := repository.Open(dir + "/s.db")
	if err != nil {
		t.Fatal(err)
	}
	r := Router(handler.New(service.New(repository.New(db))), testToken)
	if w := do(r, http.MethodGet, "/", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "demo") {
		t.Errorf("静态首页未命中: %d", w.Code)
	}
	if w := do(r, http.MethodGet, "/some/spa/route", "", ""); !strings.Contains(w.Body.String(), "demo") {
		t.Error("SPA 回退未生效")
	}
	for _, p := range []string{"/../" + strings.TrimPrefix(dir, "/") + "/s.db", "/assets/../../etc/passwd", "/api/health/../../etc/passwd"} {
		w := do(r, http.MethodGet, p, "", "")
		if strings.Contains(w.Body.String(), "root:") || strings.Contains(w.Body.String(), "SQLcipher") || w.Code == 500 {
			t.Errorf("目录穿越未被拦截: %s -> %d", p, w.Code)
		}
	}
	if w := do(r, http.MethodGet, "/api/whatever", "", ""); w.Code != 404 {
		t.Errorf("/api 下的未知路径应 404，实际 %d", w.Code)
	}
}
