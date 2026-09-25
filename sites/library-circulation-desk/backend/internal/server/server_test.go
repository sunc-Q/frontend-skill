package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"libdesk/internal/domain"
	"libdesk/internal/handler"
	"libdesk/internal/repository"
	"libdesk/internal/service"
)

const testToken = "srv-test-token"

func newServer(t *testing.T, token string) *httptest.Server {
	t.Helper()
	db, err := repository.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), time.Now()); err != nil {
		t.Fatalf("seed: %v", err)
	}
	eng := Router(handler.New(service.New(repo)), token)
	srv := httptest.NewServer(eng)
	t.Cleanup(srv.Close)
	return srv
}

func get(t *testing.T, url string) (*http.Response, []byte) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, body
}

func post(t *testing.T, url, token, body string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		if strings.HasPrefix(token, "RAW:") {
			req.Header.Set("Authorization", token[4:])
		} else {
			req.Header.Set("Authorization", "Bearer "+token)
		}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, b
}

func decode(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		trimmed := body
		if len(trimmed) > 160 {
			trimmed = trimmed[:160]
		}
		t.Fatalf("响应不是合法 JSON: %v (%s)", err, strings.TrimSpace(string(trimmed)))
	}
	return m
}

// 裸路径（不带任何 query）必须 200 且列表键统一为 items——第 6/7 轮的回归重点。
func TestBarePathsReturnItems(t *testing.T) {
	srv := newServer(t, testToken)
	for _, path := range []string{"/api/items", "/api/loans"} {
		resp, body := get(t, srv.URL+path)
		if resp.StatusCode != 200 {
			t.Fatalf("%s 状态码 %d", path, resp.StatusCode)
		}
		m := decode(t, body)
		items, ok := m["items"].([]any)
		if !ok || len(items) == 0 {
			t.Fatalf("%s 缺少非空 items 键 (total=%v)", path, m["total"])
		}
		if ps, _ := m["page_size"].(float64); ps > domain.MaxPageSize {
			t.Fatalf("%s page_size 越界 %v", path, ps)
		}
	}
	resp, body := get(t, srv.URL+"/api/stats")
	if resp.StatusCode != 200 {
		t.Fatalf("stats 状态码 %d", resp.StatusCode)
	}
	m := decode(t, body)
	if m["identity_ok"] != true {
		t.Fatalf("stats 恒等式破裂: %v", m["identity_issues"])
	}
	if m["today"] == nil || m["today"] == "" {
		t.Fatal("stats 缺少 today 口径")
	}
	// 每个排序键与过滤枚举裸跑一遍（走 HTTP，防止只测仓储层漏掉 handler 分支）
	for _, key := range []string{"code", "title", "author", "year", "category", "added", "available", "total", "id"} {
		for _, dir := range []string{"asc", "desc"} {
			resp, body := get(t, srv.URL+"/api/items?sort="+key+"&dir="+dir)
			if resp.StatusCode != 200 {
				t.Fatalf("items sort=%s dir=%s → %d: %s", key, dir, resp.StatusCode, body)
			}
		}
	}
	for _, key := range []string{"due", "borrowed", "returned", "member", "item", "barcode", "fine", "renew", "status", "id"} {
		for _, dir := range []string{"asc", "desc"} {
			resp, body := get(t, srv.URL+"/api/loans?sort="+key+"&dir="+dir)
			if resp.StatusCode != 200 {
				t.Fatalf("loans sort=%s dir=%s → %d: %s", key, dir, resp.StatusCode, body)
			}
		}
	}
	for _, st := range []string{"active", "returned", "overdue"} {
		resp, body := get(t, srv.URL+"/api/loans?status="+st)
		if resp.StatusCode != 200 {
			t.Fatalf("loans status=%s → %d: %s", st, resp.StatusCode, body)
		}
	}
}

func TestAuthMatrix(t *testing.T) {
	// 未配置 ADMIN_TOKEN：写接口一律 503（fail-closed），绝不放行。
	srvNo := newServer(t, "")
	resp, body := post(t, srvNo.URL+"/api/admin/borrow", "anything", `{"barcode":"BN-000009","card_no":"R-2026-0001"}`)
	if resp.StatusCode != 503 {
		t.Fatalf("无 token 服务端应 503: %d %s", resp.StatusCode, body)
	}

	srv := newServer(t, testToken)
	// 借出→归还需要一个必然在架的副本：先读 stats 不保证，改为遍历 items 找。
	barcode := firstAvailableCopy(t, srv, domain.CatGeneral)
	cases := []struct {
		name  string
		token string
		want  int
		code  string
	}{
		{"缺 Authorization", "", 401, "unauthorized"},
		{"非 Bearer 方案", "RAW:Basic zz", 401, "unauthorized"},
		{"只有前缀", "RAW:Bearer ", 401, "unauthorized"},
		{"错误令牌", "wrong-token", 403, "forbidden"},
		{"正确令牌", testToken, 201, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			resp, body := post(t, srv.URL+"/api/admin/borrow", c.token,
				`{"barcode":"`+barcode+`","card_no":"R-2026-0004"}`)
			if resp.StatusCode != c.want {
				t.Fatalf("状态码 %d want %d body=%s", resp.StatusCode, c.want, body)
			}
			if c.code != "" {
				m := decode(t, body)
				if m["code"] != c.code {
					t.Fatalf("错误码 %v want %s", m["code"], c.code)
				}
			}
		})
	}
}

// firstAvailableCopy 从指定类别里找第一册在架副本条码。
func firstAvailableCopy(t *testing.T, srv *httptest.Server, category string) string {
	t.Helper()
	resp, body := get(t, srv.URL+"/api/items?category="+category+"&page_size=100")
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	items := decode(t, body)["items"].([]any)
	if len(items) == 0 {
		t.Fatal("类别 " + category + " 无书目")
	}
	for _, it := range items {
		code, _ := it.(map[string]any)["code"].(string)
		dResp, dBody := get(t, srv.URL+"/api/items/"+code)
		if dResp.StatusCode != 200 {
			continue
		}
		copies := decode(t, dBody)["copies"]
		if copies == nil {
			continue
		}
		for _, c := range copies.([]any) {
			cm := c.(map[string]any)
			if cm["status"] == "available" {
				return cm["barcode"].(string)
			}
		}
	}
	t.Fatal("找不到在架副本")
	return ""
}

func TestHappyPathBorrowRenewReturn(t *testing.T) {
	srv := newServer(t, testToken)
	barcode := firstAvailableCopy(t, srv, domain.CatGeneral)

	resp, body := post(t, srv.URL+"/api/admin/borrow", testToken,
		`{"barcode":"`+barcode+`","card_no":"R-2026-0002"}`)
	if resp.StatusCode != 201 {
		t.Fatalf("借出 %d: %s", resp.StatusCode, body)
	}
	loan := decode(t, body)["loan"].(map[string]any)
	id := int64(loan["id"].(float64))
	if loan["status"] != "active" {
		t.Fatalf("状态 %v", loan["status"])
	}
	if _, has := loan["member_card"]; !has {
		t.Fatalf("借出响应缺 member_card: %v", loan)
	}

	url := srv.URL + "/api/admin/loans/" + strconv.FormatInt(id, 10)

	// 二次借同一副本 → 409
	resp, _ = post(t, srv.URL+"/api/admin/borrow", testToken,
		`{"barcode":"`+barcode+`","card_no":"R-2026-0002"}`)
	if resp.StatusCode != 409 {
		t.Fatalf("重复借出应 409: %d", resp.StatusCode)
	}

	// 新借出单可续借 2 次（MaxRenewals），第 3 次 409 renew_exhausted
	for i := 0; i < domain.MaxRenewals; i++ {
		resp, body = post(t, url+"/renew", testToken, `{}`)
		if resp.StatusCode != 200 {
			t.Fatalf("第 %d 次续借 %d: %s", i+1, resp.StatusCode, body)
		}
	}
	resp, body = post(t, url+"/renew", testToken, `{}`)
	if resp.StatusCode != 409 || !strings.Contains(string(body), "renew_exhausted") {
		t.Fatalf("续借用尽应 409 renew_exhausted: %d %s", resp.StatusCode, body)
	}

	// 归还未逾期 → fine 0
	resp, body = post(t, url+"/return", testToken, `{"paid":false}`)
	if resp.StatusCode != 200 {
		t.Fatalf("归还 %d: %s", resp.StatusCode, body)
	}
	rm := decode(t, body)
	if rm["loan"].(map[string]any)["status"] != "returned" {
		t.Fatalf("归还后状态异常: %v", rm)
	}
	if rm["fine_cents"].(float64) != 0 {
		t.Fatalf("未逾期不应计费: %v", rm["fine_cents"])
	}
	resp, _ = post(t, url+"/return", testToken, `{}`)
	if resp.StatusCode != 409 {
		t.Fatalf("重复归还应 409: %d", resp.StatusCode)
	}

	// 归还后副本回到在架，stats 恒等式仍成立
	resp, body = get(t, srv.URL+"/api/stats")
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	m := decode(t, body)
	if m["identity_ok"] != true {
		t.Fatalf("借还闭环后恒等式破裂: %v", m["identity_issues"])
	}
}

// 边界：注入串、超长体、停用读者、参考书、非法 ID、路径穿越——全部安全拒绝，不 500、不回显内部错误。
func TestBoundaryAndInjection(t *testing.T) {
	srv := newServer(t, testToken)

	resp, body := post(t, srv.URL+"/api/admin/borrow", testToken,
		`{"barcode":"BN-1\\" OR 1=1--","card_no":"R-2026-0001"}`)
	if resp.StatusCode != 400 {
		t.Fatalf("注入条码应 400: %d %s", resp.StatusCode, body)
	}
	if bytes.Contains(body, []byte("sqlite")) || bytes.Contains(body, []byte("SELECT")) {
		t.Fatalf("响应泄露内部错误: %s", body)
	}

	huge := `{"barcode":"` + strings.Repeat("A", 70000) + `","card_no":"R-2026-0001"}`
	resp, _ = post(t, srv.URL+"/api/admin/borrow", testToken, huge)
	if resp.StatusCode != 400 {
		t.Fatalf("超长条码应 400: %d", resp.StatusCode)
	}

	resp, _ = post(t, srv.URL+"/api/admin/borrow", testToken,
		`{"barcode":"BN-000009","card_no":"R-2026-0014"}`) // 停用读者
	if resp.StatusCode != 409 {
		t.Fatalf("停用读者应 409: %d", resp.StatusCode)
	}

	// 参考工具书不外借
	refBarcode := firstAvailableCopy(t, srv, domain.CatReference)
	resp, body = post(t, srv.URL+"/api/admin/borrow", testToken,
		`{"barcode":"`+refBarcode+`","card_no":"R-2026-0001"}`)
	if resp.StatusCode != 409 || !strings.Contains(string(body), "reference_only") {
		t.Fatalf("参考书应 409 reference_only: %d %s", resp.StatusCode, body)
	}

	// 欠费超门槛读者被停借
	gateBody := decode(t, mustGet(t, srv, "/api/members/R-2026-0008"))
	gm := gateBody["member"].(map[string]any)
	if of, _ := gm["outstanding_fine"].(float64); of <= float64(domain.FineGateCents) {
		t.Fatalf("种子未造出超门槛欠费: %v", gm["outstanding_fine"])
	}
	resp, body = post(t, srv.URL+"/api/admin/borrow", testToken,
		`{"barcode":"`+firstAvailableCopy(t, srv, domain.CatGeneral)+`","card_no":"R-2026-0008"}`)
	if resp.StatusCode != 409 || !strings.Contains(string(body), "fine_gate") {
		t.Fatalf("欠费门槛未生效: %d %s", resp.StatusCode, body)
	}

	resp, _ = get(t, srv.URL+"/api/loans/999999")
	if resp.StatusCode != 404 {
		t.Fatalf("不存在的借阅应 404: %d", resp.StatusCode)
	}
	resp, _ = get(t, srv.URL+"/api/loans/abc")
	if resp.StatusCode != 400 {
		t.Fatalf("非法借阅 ID 应 400: %d", resp.StatusCode)
	}
	for _, evil := range []string{"..%2F..%2Fetc%2Fpasswd", "%2e%2e/", "a/../b"} {
		resp, _ = get(t, srv.URL+"/api/items/"+evil)
		if resp.StatusCode == 500 {
			t.Fatalf("路径穿越 %s 导致 500", evil)
		}
	}
	resp, _ = get(t, srv.URL+"/api/members/R-2026-9999")
	if resp.StatusCode != 404 {
		t.Fatalf("不存在读者应 404: %d", resp.StatusCode)
	}
}

func mustGet(t *testing.T, srv *httptest.Server, path string) []byte {
	t.Helper()
	resp, body := get(t, srv.URL+path)
	if resp.StatusCode != 200 {
		t.Fatalf("GET %s → %d: %s", path, resp.StatusCode, body)
	}
	return body
}

// 隐私：任何接口 JSON 都不得出现 phone 字段。
func TestNoRawPhoneAnywhere(t *testing.T) {
	srv := newServer(t, testToken)
	for _, path := range []string{
		"/api/members/R-2026-0001", "/api/loans?status=active&page_size=100",
		"/api/items?page_size=100", "/api/stats",
	} {
		body := mustGet(t, srv, path)
		if bytes.Contains(body, []byte(`"phone"`)) {
			t.Fatalf("%s 泄露 phone 字段", path)
		}
	}
	// 读者详情必须给出脱敏值
	m := decode(t, mustGet(t, srv, "/api/members/R-2026-0001"))["member"].(map[string]any)
	if pm, _ := m["phone_masked"].(string); !strings.Contains(pm, "****") {
		t.Fatalf("缺少脱敏手机号: %v", m["phone_masked"])
	}
}

// CORS：拒绝 Origin: null（file://），放行 127.0.0.1。
func TestCorsPolicy(t *testing.T) {
	srv := newServer(t, testToken)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/items", nil)
	req.Header.Set("Origin", "null")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("Origin: null 不应被放行")
	}

	req2, _ := http.NewRequest(http.MethodOptions, srv.URL+"/api/admin/borrow", nil)
	req2.Header.Set("Origin", "http://127.0.0.1:18299")
	req2.Header.Set("Access-Control-Request-Method", "POST")
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 204 || resp2.Header.Get("Access-Control-Allow-Origin") == "" {
		t.Fatalf("localhost 预检应 204 + 放行: %d", resp2.StatusCode)
	}
}
