package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

const testToken = "unit-test-admin-token"

func newTestServer(t *testing.T, adminToken string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)
	path := t.TempDir() + "/app.db"
	db, err := repository.Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	ctx := context.Background()
	now := time.Date(2026, 9, 26, 6, 0, 0, 0, time.UTC)
	if err := repo.Seed(ctx, now); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	// dist 不存在时 mountStatic 会自动退化为纯 JSON 404，不需要为此造前端产物。
	t.Setenv("STATIC_DIR", path+".no-such-dist")
	return Router(handler.New(service.New(repo)), adminToken)
}

func do(t *testing.T, r *gin.Engine, method, target, auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON: %v / %s", err, rec.Body.String())
	}
	return out
}

func TestAdminAuthMatrix(t *testing.T) {
	cases := []struct {
		name       string
		token      string // 服务端配置值
		auth       string // 请求头
		wantStatus int
		wantCode   string
	}{
		{"服务端未配令牌一律 503（绝不放行）", "", "Bearer whatever", http.StatusServiceUnavailable, "server_misconfigured"},
		{"服务端令牌为空格也视为未配置", "   ", "Bearer whatever", http.StatusServiceUnavailable, "server_misconfigured"},
		{"缺少 Authorization → 401", testToken, "", http.StatusUnauthorized, "unauthorized"},
		{"裸令牌无前缀 → 401", testToken, testToken, http.StatusUnauthorized, "unauthorized"},
		{"错误方案 Basic → 401", testToken, "Basic abc", http.StatusUnauthorized, "unauthorized"},
		{"Bearer 后为空 → 401", testToken, "Bearer ", http.StatusUnauthorized, "unauthorized"},
		{"只有 Bearer 一词 → 401", testToken, "Bearer", http.StatusUnauthorized, "unauthorized"},
		{"令牌不符 → 403", testToken, "Bearer wrong-token", http.StatusForbidden, "forbidden"},
		{"前缀大小写不敏感（RFC 7235）→ 201", testToken, "bearer " + testToken, http.StatusCreated, ""},
		{"正确令牌 → 201", testToken, "Bearer " + testToken, http.StatusCreated, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newTestServer(t, tc.token)
			body := `{"lane_code":"BJ-SH","shipper_name":"鉴权用例","phone":"13600003333",` +
				`"piece_count":1,"weight_grams":1200,"volume_cm3":4000,"heaviest_piece_g":1200}`
			rec := do(t, r, http.MethodPost, "/api/admin/waybills", tc.auth, body)
			if rec.Code != tc.wantStatus {
				t.Fatalf("状态 = %d, 期望 %d（%s）", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantCode != "" {
				got := decode(t, rec)
				if got["code"] != tc.wantCode {
					t.Errorf("错误码 = %v, 期望 %s", got["code"], tc.wantCode)
				}
				// 401/403/503 属凭证问题，绝不能写出任何数据形状字段。
				if _, has := got["code"]; !has {
					t.Errorf("错误响应缺 code")
				}
			}
			// 被拒的写请求必须真的没落库。
			if tc.wantStatus != http.StatusCreated {
				l := do(t, r, http.MethodGet, "/api/waybills?q=鉴权用例", "", "")
				if decode(t, l)["total"].(float64) != 0 {
					t.Errorf("鉴权失败的请求仍然创建了运单")
				}
			}
		})
	}
}

func TestReadOnlyEndpoints(t *testing.T) {
	r := newTestServer(t, testToken)

	cases := []struct {
		name   string
		target string
		check  func(t *testing.T, body map[string]any)
	}{
		{"健康检查免鉴权且带 UTC 时间", "/api/health", func(t *testing.T, b map[string]any) {
			if b["status"] != "ok" {
				t.Errorf("status = %v", b["status"])
			}
			if _, err := time.Parse(time.RFC3339, b["time"].(string)); err != nil {
				t.Errorf("time 非 RFC3339: %v", b["time"])
			}
		}},
		{"线路默认只给在售", "/api/lanes", func(t *testing.T, b map[string]any) {
			items := b["items"].([]any)
			if len(items) == 0 {
				t.Fatal("线路为空")
			}
			for _, it := range items {
				if it.(map[string]any)["active"] != true {
					t.Errorf("默认列表混入停售线路")
				}
			}
			if int(b["total"].(float64)) != len(items) {
				t.Errorf("total 与 items 数不符")
			}
		}},
		{"线路 all=1 含停售", "/api/lanes?all=1", func(t *testing.T, b map[string]any) {
			items := b["items"].([]any)
			if len(items) <= 8 {
				t.Errorf("all=1 应多于默认列表，得到 %d", len(items))
			}
			off := 0
			for _, it := range items {
				if it.(map[string]any)["active"] == false {
					off++
				}
			}
			if off == 0 {
				t.Errorf("种子没有停售线路，覆盖不到 lane_offline 分支")
			}
		}},
		{"规则列表", "/api/rules", func(t *testing.T, b map[string]any) {
			if len(b["items"].([]any)) == 0 {
				t.Fatal("规则为空")
			}
		}},
		{"统计对外公布恒等式自检", "/api/stats?days=14", func(t *testing.T, b map[string]any) {
			if b["identity_ok"] != true {
				t.Errorf("identity_ok = false, issues = %v", b["identity_issues"])
			}
			if b["today"] != "2026-09-26" {
				t.Errorf("today = %v（应为 UTC+8 业务日）", b["today"])
			}
			if len(b["by_lane"].([]any)) == 0 {
				t.Errorf("by_lane 为空")
			}
		}},
		{"统计窗口越界被夹住", "/api/stats?days=999", func(t *testing.T, b map[string]any) {
			if b["trend_days"].(float64) != 30 {
				t.Errorf("trend_days = %v, 期望夹到 30", b["trend_days"])
			}
		}},
		{"列表统一 items 键并带分页元数据", "/api/waybills?page_size=5", func(t *testing.T, b map[string]any) {
			if _, has := b["items"]; !has {
				t.Fatal("缺 items 键")
			}
			if len(b["items"].([]any)) != 5 {
				t.Errorf("items = %d 行", len(b["items"].([]any)))
			}
			if b["page_size"].(float64) != 5 {
				t.Errorf("page_size = %v", b["page_size"])
			}
		}},
		{"报价试算含体积口径说明", "/api/quote?lane=BJ-SH&weight_g=5200&volume_cm3=48000", func(t *testing.T, b map[string]any) {
			if b["identity_ok"] != true {
				t.Errorf("报价恒等式未通过: %v", b)
			}
			if b["volumetric_grams"].(float64) != 8000 {
				t.Errorf("体积重 = %v, 期望 8000（48000×1000÷6000）", b["volumetric_grams"])
			}
			if b["volumetric_rule"] == "" {
				t.Errorf("缺口径说明")
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, r, http.MethodGet, tc.target, "", "")
			if rec.Code != http.StatusOK {
				t.Fatalf("状态 = %d, body=%s", rec.Code, rec.Body.String())
			}
			tc.check(t, decode(t, rec))
		})
	}
}

func TestReadHeadersAnd404Shape(t *testing.T) {
	r := newTestServer(t, testToken)
	rec := do(t, r, http.MethodGet, "/api/lanes", "", "")
	for h, want := range map[string]string{
		"Cache-Control":          "no-store",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "no-referrer",
	} {
		if got := rec.Header().Get(h); got != want {
			t.Errorf("%s = %q, 期望 %q", h, got, want)
		}
	}
	// /api 下未匹配路径必须是 JSON 404，而不是 Gin 的纯文本。
	bad := do(t, r, http.MethodGet, "/api/does-not-exist", "", "")
	if bad.Code != http.StatusNotFound {
		t.Errorf("状态 = %d", bad.Code)
	}
	if got := decode(t, bad)["code"]; got != "not_found" {
		t.Errorf("404 code = %v", got)
	}
	if !strings.Contains(bad.Header().Get("Content-Type"), "application/json") {
		t.Errorf("404 Content-Type = %s", bad.Header().Get("Content-Type"))
	}
}

func TestWriteEndpointsEndToEnd(t *testing.T) {
	r := newTestServer(t, testToken)
	auth := "Bearer " + testToken

	// 建单 → 推进 → 异常 → 详情，全链路走真接口。
	rec := do(t, r, http.MethodPost, "/api/admin/waybills", auth,
		`{"lane_code":"SH-XA","shipper_name":"端到端测试","phone":"13500004444","piece_count":2,`+
			`"weight_grams":5200,"volume_cm3":48000,"heaviest_piece_g":3000,"declared_cents":80000,"fragile":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("建单状态 = %d, body=%s", rec.Code, rec.Body.String())
	}
	created := decode(t, rec)
	code, _ := created["code"].(string)
	if code == "" {
		t.Fatalf("响应未带回运单号: %v", created)
	}
	if created["phone"] != nil {
		t.Errorf("响应不应含 phone 字段")
	}
	if created["phone_masked"] != "135****4444" {
		t.Errorf("脱敏手机号 = %v", created["phone_masked"])
	}
	total := created["total_cents"].(float64)
	if total != created["freight_cents"].(float64)+created["fuel_cents"].(float64)+
		created["insurance_cents"].(float64)+created["surcharge_cents"].(float64) {
		t.Errorf("对外总额不自洽: %v", created)
	}

	adv := do(t, r, http.MethodPost, "/api/admin/waybills/"+code+"/advance", auth,
		`{"to":"picked_up","node":"上海分拨中心","note":"已揽收"}`)
	if adv.Code != http.StatusOK {
		t.Fatalf("推进状态 = %d, body=%s", adv.Code, adv.Body.String())
	}
	if decode(t, adv)["waybill"].(map[string]any)["status"] != "picked_up" {
		t.Errorf("推进后状态不符")
	}

	// 跳级 → 409，且错误体只有 code/message。
	bad := do(t, r, http.MethodPost, "/api/admin/waybills/"+code+"/advance", auth,
		`{"to":"delivered","node":"西安派送点","note":"跳级"}`)
	if bad.Code != http.StatusConflict {
		t.Errorf("非法跃迁状态 = %d", bad.Code)
	}
	if decode(t, bad)["code"] != "invalid_transition" {
		t.Errorf("非法跃迁错误码 = %v", decode(t, bad)["code"])
	}

	exc := do(t, r, http.MethodPost, "/api/admin/waybills/"+code+"/exception", auth,
		`{"node":"西安中转场","reason":"收件地址不详"}`)
	if exc.Code != http.StatusOK {
		t.Fatalf("异常上报状态 = %d %s", exc.Code, exc.Body.String())
	}
	twice := do(t, r, http.MethodPost, "/api/admin/waybills/"+code+"/exception", auth,
		`{"node":"西安中转场","reason":"重复上报"}`)
	if twice.Code != http.StatusConflict || decode(t, twice)["code"] != "already_exception" {
		t.Errorf("重复异常 = %d %v", twice.Code, decode(t, twice)["code"])
	}

	det := do(t, r, http.MethodGet, "/api/waybills/"+code, "", "")
	events := decode(t, det)["events"].([]any)
	if len(events) != 3 {
		t.Errorf("事件数 = %d, 期望 3（下单/揽收/异常）", len(events))
	}
	if events[0].(map[string]any)["seq"].(float64) != 3 {
		t.Errorf("详情事件应按 seq 倒序")
	}

	// 规则：创建 → 重复 409 → 启停。
	createdRule := do(t, r, http.MethodPost, "/api/admin/rules", auth,
		`{"code":"e2e-fee","name":"端到端附加费","kind":"fragile_flat","amount_cents":300,"priority":70}`)
	if createdRule.Code != http.StatusCreated {
		t.Fatalf("建规则状态 = %d %s", createdRule.Code, createdRule.Body.String())
	}
	id := int64(decode(t, createdRule)["id"].(float64))
	dup := do(t, r, http.MethodPost, "/api/admin/rules", auth,
		`{"code":"e2e-fee","name":"重复","kind":"fragile_flat","amount_cents":1,"priority":71}`)
	if dup.Code != http.StatusConflict || decode(t, dup)["code"] != "conflict" {
		t.Errorf("重复规则 = %d %v", dup.Code, decode(t, dup)["code"])
	}
	tog := do(t, r, http.MethodPost, "/api/admin/rules/"+strconv.FormatInt(id, 10)+"/toggle", auth, "")
	if tog.Code != http.StatusOK || decode(t, tog)["active"] != false {
		t.Errorf("启停结果 = %d %v", tog.Code, tog.Body.String())
	}
	missing := do(t, r, http.MethodPost, "/api/admin/rules/999999/toggle", auth, "")
	if missing.Code != http.StatusNotFound {
		t.Errorf("不存在规则状态 = %d", missing.Code)
	}
	// 停售线路必须拒绝开单（409 lane_offline）。
	off := do(t, r, http.MethodPost, "/api/admin/waybills", auth,
		`{"lane_code":"NB-XN","shipper_name":"停售线路","phone":"13500004444","piece_count":1,`+
			`"weight_grams":1000,"volume_cm3":1000,"heaviest_piece_g":1000}`)
	if off.Code != http.StatusConflict || decode(t, off)["code"] != "lane_offline" {
		t.Errorf("停售线路 = %d %v", off.Code, decode(t, off)["code"])
	}
}

func TestBadInputAndInjectionAtHTTPBoundary(t *testing.T) {
	r := newTestServer(t, testToken)
	auth := "Bearer " + testToken

	cases := []struct {
		name       string
		method     string
		target     string
		body       string
		wantStatus int
		wantCode   string
		wantField  string
	}{
		{"建单缺字段", http.MethodPost, "/api/admin/waybills", `{"lane_code":"BJ-SH"}`,
			http.StatusBadRequest, "invalid_request", "shipper_name"},
		{"手机号注入", http.MethodPost, "/api/admin/waybills",
			`{"lane_code":"BJ-SH","shipper_name":"注入测试","phone":"1' OR '1'='1","piece_count":1,` +
				`"weight_grams":1000,"volume_cm3":1000,"heaviest_piece_g":1000}`,
			http.StatusBadRequest, "invalid_request", "phone"},
		{"单号里带引号与分号", http.MethodGet, "/api/waybills/FY2026%27%3BDROP", "",
			http.StatusBadRequest, "invalid_code", ""},
		{"单号里带空格", http.MethodGet, "/api/waybills/FY%202026%2001", "",
			http.StatusBadRequest, "invalid_code", ""},
		{"未知线路", http.MethodGet, "/api/quote?lane=ZZ-ZZ&weight_g=1000", "",
			http.StatusNotFound, "lane_not_found", ""},
		{"报价缺重量", http.MethodGet, "/api/quote?lane=BJ-SH", "",
			http.StatusBadRequest, "invalid_request", "weight_g"},
		{"报价超上限", http.MethodGet, "/api/quote?lane=BJ-SH&weight_g=99999999999", "",
			http.StatusBadRequest, "invalid_request", "weight_g"},
		{"最重大于总重", http.MethodGet, "/api/quote?lane=BJ-SH&weight_g=1000&heaviest_g=2000", "",
			http.StatusBadRequest, "invalid_request", "heaviest_g"},
		{"规则 kind 非法", http.MethodPost, "/api/admin/rules",
			`{"code":"bad-kind","name":"坏规则","kind":"mystery","amount_cents":1,"priority":5}`,
			http.StatusBadRequest, "invalid_request", "kind"},
		{"空请求体", http.MethodPost, "/api/admin/waybills", ``,
			http.StatusBadRequest, "invalid_request", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(t, r, tc.method, tc.target, auth, tc.body)
			if rec.Code != tc.wantStatus {
				t.Fatalf("状态 = %d, 期望 %d, body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			b := decode(t, rec)
			if b["code"] != tc.wantCode {
				t.Errorf("code = %v, 期望 %s", b["code"], tc.wantCode)
			}
			if tc.wantField != "" {
				fields, ok := b["fields"].(map[string]any)
				if !ok {
					t.Fatalf("无 fields: %v", b)
				}
				if _, has := fields[tc.wantField]; !has {
					t.Errorf("fields 应含 %s，实际 %v", tc.wantField, fields)
				}
			}
			// 绝不回显内部错误细节。
			raw := rec.Body.String()
			for _, leak := range []string{"gorm", "SQLite", "no such", "runtime error", "context deadline"} {
				if strings.Contains(strings.ToLower(raw), strings.ToLower(leak)) {
					t.Errorf("响应泄漏内部细节 %q: %s", leak, raw)
				}
			}
		})
	}

	// 超大请求体（16KB 恶意字段）必须被拒而不是写库。
	huge := `{"lane_code":"BJ-SH","shipper_name":"` + strings.Repeat("长", 9000) +
		`","phone":"13500004444","piece_count":1,"weight_grams":1000,"volume_cm3":1000,"heaviest_piece_g":1000}`
	rec := do(t, r, http.MethodPost, "/api/admin/waybills", auth, huge)
	if rec.Code == http.StatusCreated {
		t.Errorf("超长字段被接受了")
	}

	// 列表参数越界只夹取不报错。
	q := do(t, r, http.MethodGet, "/api/waybills?page_size=99999&sort=1;DROP&status=flying", "", "")
	if q.Code != http.StatusOK {
		t.Fatalf("状态 = %d", q.Code)
	}
	if b := decode(t, q); b["page_size"].(float64) > 100 {
		t.Errorf("page_size = %v 未被夹住", b["page_size"])
	}
}

// TestPathTraversalRejected 编码后的穿越序列绝不能碰到文件系统：
// Gin 在路由前就把 %2F 还原成 /，落到 NoRoute 或 400，两种都算安全。
func TestPathTraversalRejected(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	r := newTestServer(t, testToken)
	for _, target := range []string{
		"/api/waybills/FY2026%2F%2E%2E%2Fetc%2Fpasswd",
		"/../backend/cmd/api/main.go",
		"/static/../../etc/passwd",
	} {
		rec := do(t, r, http.MethodGet, target, "", "")
		if rec.Code == http.StatusOK {
			t.Errorf("%s 返回了 200", target)
		}
		if strings.Contains(rec.Body.String(), "root:") {
			t.Errorf("%s 读出了系统文件内容", target)
		}
	}
}

func TestBodySizeLimit(t *testing.T) {
	r := newTestServer(t, testToken)
	huge := `{"lane_code":"BJ-SH","shipper_name":"` + strings.Repeat("a", 2_000_000) + `"}`
	before := decode(t, do(t, r, http.MethodGet, "/api/waybills?page_size=1", "", ""))["total"]

	t.Run("声明了 Content-Length 走 413", func(t *testing.T) {
		rec := do(t, r, http.MethodPost, "/api/admin/waybills", "Bearer "+testToken, huge)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("应 413，实际 %d / %s", rec.Code, rec.Body.String())
		}
		chkLeakFree(t, rec)
	})

	// 骗人地说 body 很短（抹掉 Content-Length 走分块）也必须拦下：
	// 只信 Content-Length 等于让攻击者用一个头绕过上限。
	t.Run("谎报长度走 MaxBytesReader", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/admin/waybills", strings.NewReader(huge))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+testToken)
		req.ContentLength = -1
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("应 400（解析失败），实际 %d / %s", rec.Code, rec.Body.String())
		}
		if code := decode(t, rec)["code"]; code != "invalid_request" {
			t.Fatalf("应回 invalid_request，实际 %v", code)
		}
		chkLeakFree(t, rec)
	})

	after := decode(t, do(t, r, http.MethodGet, "/api/waybills?page_size=1", "", ""))["total"]
	if after != before {
		t.Errorf("被拒的写请求仍然落库了：%v → %v", before, after)
	}
	ok := do(t, r, http.MethodGet, "/api/health", "", "")
	if ok.Code != http.StatusOK {
		t.Errorf("超大请求后服务不可用: %d", ok.Code)
	}
}

// chkLeakFree 确认错误响应里没有把 net/http / 驱动的原始文案透出去。
func chkLeakFree(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	for _, leak := range []string{"request body too large", "unexpected EOF", "json:", "gorm", "SQLITE"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leak) {
			t.Errorf("错误响应泄露内部信息 %q：%s", leak, rec.Body.String())
		}
	}
}

func TestCORSOnlyLocalhost(t *testing.T) {
	r := newTestServer(t, testToken)
	cases := []struct {
		origin string
		want   bool
	}{
		{"http://127.0.0.1:18501", true},
		{"http://localhost:5173", true},
		{"http://LOCALHOST:5173", true}, // 主机名大小写不敏感
		{"http://[::1]:3000", true},
		{"http://127.2.3.4:8080", true}, // 127.0.0.0/8 全段只在本机可达
		{"https://evil.example", false},
		// 前缀匹配会把「看起来像本机」的公网域名放进来，这些是这条规则的反例。
		{"http://127.0.0.1.evil.example", false},
		{"http://localhost.evil.example/", false},
		{"http://evil.example/?o=http://localhost", false},
		{"http://8.8.8.8", false},
		{"http://0.0.0.0:5173", false},
		{"//localhost:5173", false}, // 无方案名：url.Parse 会把 // 当网络位置而绕过判定
		{"http://localhost:5173.evil.example", false},
		{"null", false}, // file:// 打开的页面共用 null，放行等于对所有本地程序开门
		{"", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodGet, "/api/lanes", nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		got := rec.Header().Get("Access-Control-Allow-Origin")
		if tc.want && got != tc.origin {
			t.Errorf("Origin=%s 应放行, 得到 %q", tc.origin, got)
		}
		if !tc.want && got != "" {
			t.Errorf("Origin=%s 不应放行, 得到 %q", tc.origin, got)
		}
	}
	// OPTIONS 预检
	req := httptest.NewRequest(http.MethodOptions, "/api/admin/waybills", nil)
	req.Header.Set("Origin", "http://127.0.0.1:18401")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("预检状态 = %d", rec.Code)
	}
}
