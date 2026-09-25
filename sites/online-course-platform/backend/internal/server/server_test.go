package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

const testToken = "smoke-token-2026"

func newTestServer(t *testing.T, token string) *httptest.Server {
	t.Helper()
	now := time.Date(2026, 9, 25, 8, 0, 0, 0, time.UTC)
	db, err := repository.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	eng := Router(handler.New(service.New(repo)), token)
	srv := httptest.NewServer(eng)
	t.Cleanup(srv.Close)
	return srv
}

type httpResult struct {
	status int
	body   map[string]any
	raw    string
}

func do(t *testing.T, method, url, token string, body any) httpResult {
	t.Helper()
	var rdr *bytes.Reader
	if body == nil {
		rdr = bytes.NewReader(nil)
	} else {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	buf := new(bytes.Buffer)
	buf.ReadFrom(res.Body)
	raw := buf.String()
	var m map[string]any
	_ = json.Unmarshal([]byte(raw), &m)
	return httpResult{status: res.StatusCode, body: m, raw: raw}
}

func mustField(t *testing.T, r httpResult, path string) any {
	t.Helper()
	cur := r.body
	for i, p := range strings.Split(path, ".") {
		v, ok := cur[p]
		if !ok {
			t.Fatalf("响应缺少 %s（第 %d 段），body=%s", path, i, r.raw)
		}
		if i == len(strings.Split(path, "."))-1 {
			return v
		}
		cur, ok = v.(map[string]any)
		if !ok {
			t.Fatalf("%s 中途不是对象", path)
		}
	}
	return nil
}

func TestReadEndpoints(t *testing.T) {
	srv := newTestServer(t, testToken)

	if got := do(t, "GET", srv.URL+"/api/health", "", nil); got.status != 200 {
		t.Fatalf("health = %d", got.status)
	}
	stats := do(t, "GET", srv.URL+"/api/stats", "", nil)
	if stats.status != 200 {
		t.Fatalf("stats = %d: %s", stats.status, stats.raw)
	}
	if stats.body["published_courses"].(float64) != 13 {
		t.Errorf("在售课程 = %v, want 13", stats.body["published_courses"])
	}

	list := do(t, "GET", srv.URL+"/api/courses?page_size=5&sort=fill&dir=desc", "", nil)
	if list.status != 200 {
		t.Fatalf("courses = %d", list.status)
	}
	if list.body["page_size"].(float64) != 5 {
		t.Errorf("page_size 回显 = %v", list.body["page_size"])
	}
	items, _ := list.body["items"].([]any)
	if len(items) != 5 {
		t.Fatalf("items = %d, want 5", len(items))
	}
	// 排序收敛：fill 降序，第一项必须满座。
	first := items[0].(map[string]any)
	if first["fill_pct"].(float64) < 100 {
		t.Errorf("fill desc 首位 fill_pct = %v，应 ≥100", first["fill_pct"])
	}
	// page_size 上限钳制。
	clamped := do(t, "GET", srv.URL+"/api/courses?page_size=100000", "", nil)
	if clamped.body["page_size"].(float64) != 100 {
		t.Errorf("page_size 未被钳制: %v", clamped.body["page_size"])
	}

	detail := do(t, "GET", srv.URL+"/api/courses/DS-101", "", nil)
	if detail.status != 200 {
		t.Fatalf("detail = %d: %s", detail.status, detail.raw)
	}
	if strings.Contains(detail.raw, "\"phone\"") {
		t.Error("详情响应泄漏原始 phone 字段")
	}
	// 手机号必须全部脱敏。
	if strings.Contains(detail.raw, "13800000") || strings.Contains(detail.raw, "1392026") {
		t.Errorf("详情响应含未脱敏手机号片段")
	}

	bad := do(t, "GET", srv.URL+"/api/courses/"+`DS'; DROP`, "", nil)
	if bad.status != 404 {
		t.Errorf("注入型 code 应 404，实得 %d", bad.status)
	}
	if miss := do(t, "GET", srv.URL+"/api/nope", "", nil); miss.status != 404 || miss.body["code"] != "not_found" {
		t.Errorf("未知 /api/* 应返回 JSON 404，实得 %d %s", miss.status, miss.raw)
	}
	inst := do(t, "GET", srv.URL+"/api/instructors", "", nil)
	if inst.status != 200 || inst.body["total"].(float64) != 6 {
		t.Errorf("instructors = %d/%v", inst.status, inst.body["total"])
	}
}

func TestAdminAuthMatrix(t *testing.T) {
	srv := newTestServer(t, testToken)
	url := srv.URL + "/api/admin/enrollments"
	body := map[string]any{"course_code": "FE-120", "name": "鉴权样本", "phone": "13700009001", "source": "official"}

	cases := []struct {
		name   string
		header string // 传给 do 的 token（空=不带 Authorization 头）
		want   int
	}{
		{"无 Authorization → 401", "", 401},
		{"错误令牌 → 403", "wrong-token", 403},
		{"正确令牌 → 201", testToken, 201},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := do(t, "POST", url, tc.header, body)
			if got.status != tc.want {
				t.Fatalf("status = %d, want %d: %s", got.status, tc.want, got.raw)
			}
		})
	}
	// 非 Bearer 方案（Basic）→ 401。
	req, _ := http.NewRequest("POST", url, bytes.NewReader(nil))
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Errorf("Basic 方案应 401，实得 %d", res.StatusCode)
	}

	// fail-closed：服务端没配令牌时，写接口一律 503，绝不放行。
	noTok := newTestServer(t, "")
	got := do(t, "POST", noTok.URL+"/api/admin/enrollments", testToken, body)
	if got.status != 503 {
		t.Errorf("未配置 ADMIN_TOKEN 应 503，实得 %d", got.status)
	}
}

func TestEnrollValidationAndFlow(t *testing.T) {
	srv := newTestServer(t, testToken)
	url := srv.URL + "/api/admin/enrollments"

	badCases := []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"手机号非法", map[string]any{"course_code": "FE-120", "name": "边界样本", "phone": "23800000000", "source": "official"}, "phone"},
		{"手机号超长注入", map[string]any{"course_code": "FE-120", "name": "边界样本", "phone": "13800000000 OR 1=1--", "source": "official"}, "phone"},
		{"姓名超长", map[string]any{"course_code": "FE-120", "name": strings.Repeat("赵", 40), "phone": "13700009101", "source": "official"}, "name"},
		{"课程标识非法字符", map[string]any{"course_code": "FE 120'\"", "name": "边界样本", "phone": "13700009102", "source": "official"}, "course_code"},
		{"渠道非法", map[string]any{"course_code": "FE-120", "name": "边界样本", "phone": "13700009103", "source": "%$&*"}, "source"},
	}
	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			got := do(t, "POST", url, testToken, tc.body)
			if got.status != 400 {
				t.Fatalf("status = %d, want 400: %s", got.status, got.raw)
			}
			fields, _ := got.body["fields"].(map[string]any)
			if _, has := fields[tc.field]; !has {
				t.Errorf("应回显 %s 的字段错误，实得 %v", tc.field, fields)
			}
		})
	}

	// 正常报名 → 201，价格恒等式与脱敏。
	good := do(t, "POST", url, testToken, map[string]any{
		"course_code": "FE-260", "name": "流水学员", "phone": "13700009201", "source": "referral",
	})
	if good.status != 201 {
		t.Fatalf("报名应 201: %s", good.raw)
	}
	enr, _ := mustField(t, good, "enrollment").(map[string]any)
	list := enr["list_price"].(float64)
	disc := enr["discount"].(float64)
	paid := enr["paid_cents"].(float64)
	if paid != list-disc {
		t.Errorf("价格恒等式不成立: %v != %v-%v", paid, list, disc)
	}
	if !strings.HasPrefix(enr["masked_phone"].(string), "137****") {
		t.Errorf("masked_phone = %v", enr["masked_phone"])
	}

	// 重复报名 → 409。
	dup := do(t, "POST", url, testToken, map[string]any{
		"course_code": "FE-260", "name": "流水学员", "phone": "13700009201", "source": "referral",
	})
	if dup.status != 409 {
		t.Errorf("重复报名应 409，实得 %d: %s", dup.status, dup.raw)
	}

	// 满座课程 → 候补且不扣费。
	full := do(t, "POST", url, testToken, map[string]any{
		"course_code": "DS-101", "name": "候补样本", "phone": "13700009202", "source": "campus",
	})
	if full.status != 201 {
		t.Fatalf("候补应 201 入账: %s", full.raw)
	}
	fe, _ := mustField(t, full, "enrollment").(map[string]any)
	if fe["status"] != "waitlist" || fe["paid_cents"].(float64) != 0 {
		t.Errorf("候补判定错误: status=%v paid=%v", fe["status"], fe["paid_cents"])
	}

	// 进度接口状态机：给刚报名的学员推 100 → completed；再推 → 409。
	id := int64(fe["id"].(float64))
	waitProg := do(t, "POST", fmt.Sprintf("%s/api/admin/enrollments/%d/progress", srv.URL, id),
		testToken, map[string]any{"progress_pct": 50})
	if waitProg.status != 409 {
		t.Errorf("候补学员推进度应 409，实得 %d", waitProg.status)
	}

	// 用 active 学员验证推进到 100 自动结课。
	act := do(t, "POST", url, testToken, map[string]any{
		"course_code": "DV-210", "name": "结课样本", "phone": "13700009203", "source": "official",
	})
	ae, _ := mustField(t, act, "enrollment").(map[string]any)
	aid := int64(ae["id"].(float64))
	done := do(t, "POST", fmt.Sprintf("%s/api/admin/enrollments/%d/progress", srv.URL, aid),
		testToken, map[string]any{"progress_pct": 100})
	if done.status != 200 || mustField(t, done, "enrollment.status") != "completed" {
		t.Errorf("100%% 应自动结课: %s", done.raw)
	}
	again := do(t, "POST", fmt.Sprintf("%s/api/admin/enrollments/%d/progress", srv.URL, aid),
		testToken, map[string]any{"progress_pct": 50})
	if again.status != 409 {
		t.Errorf("结课后推进度应 409，实得 %d", again.status)
	}
	oob := do(t, "POST", fmt.Sprintf("%s/api/admin/enrollments/%d/progress", srv.URL, aid),
		testToken, map[string]any{"progress_pct": 101})
	if oob.status != 400 {
		t.Errorf("101 应 400，实得 %d", oob.status)
	}
	if bad := do(t, "POST", srv.URL+"/api/admin/enrollments/not-a-number/progress",
		testToken, map[string]any{"progress_pct": 50}); bad.status != 400 {
		t.Errorf("非法报名 ID 应 400，实得 %d", bad.status)
	}
}

func TestCourseStatusEndpoint(t *testing.T) {
	srv := newTestServer(t, testToken)
	base := srv.URL + "/api/admin/courses/"

	ok := do(t, "POST", base+"SEC-310/status", testToken, map[string]any{"to": "published"})
	if ok.status != 200 || mustField(t, ok, "course.status") != "published" {
		t.Fatalf("草稿上架失败: %d %s", ok.status, ok.raw)
	}
	same := do(t, "POST", base+"SEC-310/status", testToken, map[string]any{"to": "published"})
	if same.status != 409 {
		t.Errorf("重复上架应 409，实得 %d", same.status)
	}
	badTo := do(t, "POST", base+"SEC-310/status", testToken, map[string]any{"to": "draft"})
	if badTo.status != 400 {
		t.Errorf("to=draft 应 400，实得 %d", badTo.status)
	}
	miss := do(t, "POST", base+"NO-SUCH-CODE/status", testToken, map[string]any{"to": "published"})
	if miss.status != 404 {
		t.Errorf("不存在课程应 404，实得 %d", miss.status)
	}
	noauth := do(t, "POST", base+"AI-380/status", "", map[string]any{"to": "archived"})
	if noauth.status != 401 {
		t.Errorf("无令牌应 401，实得 %d", noauth.status)
	}
}

func TestSecurityHeadersAndStatic(t *testing.T) {
	srv := newTestServer(t, testToken)
	res, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	for k, want := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := res.Header.Get(k); got != want {
			t.Errorf("响应头 %s = %q, want %q", k, got, want)
		}
	}
	// STATIC_DIR 未配置时 NoRoute 走 JSON 404 而不是纯文本。
	page, err := http.Get(srv.URL + "/some/spa/route")
	if err != nil {
		t.Fatal(err)
	}
	defer page.Body.Close()
	if page.StatusCode != 404 && page.StatusCode != 200 {
		t.Errorf("SPA 路径状态码异常: %d", page.StatusCode)
	}
}
