package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

const testToken = "unit-test-token"

func setup(t *testing.T) (*gin.Engine, *repository.Repo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(t.TempDir() + "/api.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return Router(handler.New(service.New(repo)), testToken), repo
}

func do(r *gin.Engine, method, path, token, body string) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAdminEndpointsAuthMatrix(t *testing.T) {
	r, _ := setup(t)
	cases := []struct {
		name   string
		token  string
		code   string
		want   int
		wantFn func(*testing.T, *httptest.ResponseRecorder)
	}{
		{"缺少 Authorization 头 → 401", "", "auth_missing_header", 401, func(t *testing.T, w *httptest.ResponseRecorder) {
			var b map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &b)
			if b["code"] != "unauthorized" {
				t.Errorf("code=%v", b["code"])
			}
		}},
		{"令牌错误 → 403", "Bearer wrong-wrong", "auth_wrong_token", 403, nil},
		{"缺少 Bearer 前缀 → 401", testToken, "auth_no_prefix", 401, nil},
		{"Bearer 大小写混用仍可通过", "BeArEr " + testToken, "auth_mixed_case", 201, nil},
		{"只有 Bearer 前缀没有令牌 → 401", "Bearer ", "auth_empty_token", 401, nil},
		{"伪造前缀变体 → 401", "Basic " + testToken, "auth_basic_scheme", 401, nil},
		{"正确令牌 → 201", "Bearer " + testToken, "auth_ok", 201, func(t *testing.T, w *httptest.ResponseRecorder) {
			var p domain.Plan
			if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
				t.Fatal(err)
			}
			if p.ID == 0 || p.Code != "auth_ok" {
				t.Errorf("响应套餐不正确：%+v", p)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"code":"` + tc.code + `","name":"增长版","price_monthly":2900,"price_yearly":29000,"seat_quota":10}`
			w := do(r, http.MethodPost, "/api/admin/plans", tc.token, body)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
			if tc.wantFn != nil {
				tc.wantFn(t, w)
			}
		})
	}
}

func TestAdminAuthFailsClosedWhenTokenUnset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(t.TempDir() + "/no-token.db")
	if err != nil {
		t.Fatal(err)
	}
	r := Router(handler.New(service.New(repository.New(db))), "")
	w := do(r, http.MethodPost, "/api/admin/plans", "Bearer anything", `{"code":"zz","name":"x"}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("未配置令牌时应 503，实得 %d（绝不能放行）", w.Code)
	}
}

func TestErrorResponsesNeverLeakInternalDetails(t *testing.T) {
	r, _ := setup(t)
	cases := []struct {
		name   string
		method string
		path   string
		token  string
		body   string
		want   int
	}{
		{"非法 JSON 请求体", http.MethodPost, "/api/admin/plans", "Bearer " + testToken, `{"code":`, 400},
		{"非数字订阅 ID", http.MethodGet, "/api/subscriptions/1%20OR%201%3D1", "", "", 400},
		{"不存在的订阅", http.MethodGet, "/api/subscriptions/424242", "", "", 404},
		{"不存在的接口", http.MethodGet, "/api/nope", "", "", 404},
		{"续费日期倒挂", http.MethodPost, "/api/admin/subscriptions/3/renew", "Bearer " + testToken,
			`{"amount":100,"period":"monthly","next_renew":"2000-01-01"}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(r, tc.method, tc.path, tc.token, tc.body)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
			body := w.Body.String()
			for _, leak := range []string{"SQLITE", "gorm", "no such table", "constraint", "runtime error", "/Users/", "context deadline"} {
				if strings.Contains(strings.ToLower(body), strings.ToLower(leak)) {
					t.Errorf("响应泄漏内部细节 %q：%s", leak, body)
				}
			}
			var b map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &b); err != nil {
				t.Fatalf("错误响应必须是 JSON：%s", body)
			}
			if _, ok := b["code"].(string); !ok {
				t.Errorf("错误响应缺少 code 字段：%s", body)
			}
		})
	}
}

func TestPublicReadEndpointsShape(t *testing.T) {
	r, _ := setup(t)

	w := do(r, http.MethodGet, "/api/subscriptions?page_size=3", "", "")
	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var list struct {
		Items    []domain.SubscriptionRow `json:"items"`
		Total    int64                    `json:"total"`
		PageSize int                      `json:"page_size"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != 3 || list.PageSize != 3 || list.Total < list.Items[0].ID {
		t.Fatalf("分页响应不正确：%+v", list)
	}
	for _, it := range list.Items {
		if it.Email == "" || it.PlanCode == "" {
			t.Errorf("列表未回填 JOIN 字段：%+v", it)
		}
	}

	w = do(r, http.MethodGet, "/api/metrics?months=6", "", "")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var m domain.Metrics
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Monthly) != 6 || m.ARR != m.MRR*12 {
		t.Fatalf("指标不正确：%d 个桶，ARR=%d MRR=%d", len(m.Monthly), m.ARR, m.MRR)
	}

	w = do(r, http.MethodGet, "/api/plans", "", "")
	var plans struct {
		Items []domain.Plan `json:"items"`
		Total int           `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &plans); err != nil {
		t.Fatal(err)
	}
	if plans.Total < 5 {
		t.Fatalf("套餐数=%d", plans.Total)
	}
}

func TestStaticMountRejectsPathTraversal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	pub := root + "/pub"
	if err := os.MkdirAll(pub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pub+"/index.html", []byte("<!doctype html><title>spa</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/secret.txt", []byte("TOP-SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("STATIC_DIR", pub)
	db, err := repository.Open(root + "/s.db")
	if err != nil {
		t.Fatal(err)
	}
	r := Router(handler.New(service.New(repository.New(db))), testToken)

	for _, path := range []string{"/../secret.txt", "/%2e%2e/secret.txt", "/./secret.txt", "/pub/../secret.txt"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if strings.Contains(w.Body.String(), "TOP-SECRET") {
			t.Errorf("%s 读到了静态目录之外的文件", path)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/some/spa/route", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "spa") {
		t.Errorf("SPA 回退失败：%d %s", w.Code, w.Body.String())
	}
}

func TestSecurityHeadersPresent(t *testing.T) {
	r, _ := setup(t)
	w := do(r, http.MethodGet, "/api/health", "", "")
	for h, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := w.Header().Get(h); got != want {
			t.Errorf("%s=%q want %q", h, got, want)
		}
	}
}
