package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"flea/internal/domain"
	"flea/internal/handler"
	"flea/internal/repository"
	"flea/internal/service"
)

const testToken = "unit-test-token"

func setup(t *testing.T, token string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(t.TempDir() + "/api.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), time.Now().UTC().Add(-2*time.Hour)); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return Router(handler.New(service.New(repo)), token)
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

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON：%q err=%v", w.Body.String(), err)
	}
	return out
}

// 鉴权矩阵：未配置令牌 503（fail-closed）；缺头/非 Bearer/只有前缀 401；令牌错 403。
// 关键：这些探针一律打在「不存在的资源」上，绝不真的写库。
func TestAdminAuthMatrix(t *testing.T) {
	cases := []struct {
		name  string
		token string
		auth  string
		want  int
		code  string
	}{
		{"服务端未配令牌 → 503", "", "Bearer " + testToken, 503, "server_misconfigured"},
		{"缺 Authorization → 401", testToken, "", 401, "unauthorized"},
		{"非 Bearer 方案 → 401", testToken, "RAW:Basic zz", 401, "unauthorized"},
		{"只有前缀没有令牌 → 401", testToken, "Bearer ", 401, "unauthorized"},
		{"令牌错误 → 403", testToken, "Bearer nope", 403, "forbidden"},
		{"方案名小写仍合法（RFC 7235）", testToken, "bearer " + testToken, 404, "not_found"},
		{"正确令牌穿透到业务层", testToken, "Bearer " + testToken, 404, "not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := setup(t, tc.token)
			auth := tc.auth
			if strings.HasPrefix(auth, "RAW:") {
				auth = strings.TrimPrefix(auth, "RAW:")
			}
			w := do(r, http.MethodPost, "/api/admin/listings/FS-9999/offers", auth,
				`{"buyer":"probe_one","amount_cent":100000}`)
			if w.Code != tc.want {
				t.Fatalf("状态码=%d 期望 %d，body=%s", w.Code, tc.want, w.Body.String())
			}
			if got := decode(t, w)["code"]; got != tc.code {
				t.Fatalf("code=%v 期望 %s", got, tc.code)
			}
		})
	}
}

// 未配置令牌时写接口必须整层关死（不是「期望值为空所以放行」）。
func TestWriteEndpointsFailClosedWithoutToken(t *testing.T) {
	r := setup(t, "")
	paths := []struct{ method, path, body string }{
		{http.MethodPost, "/api/admin/listings", `{"code":"FS-NEW-1","title":"新挂单测试用","category":"book","seller":"tester","asking_cent":10000,"floor_cent":9000,"condition":"good","area":"徐汇"}`},
		{http.MethodPost, "/api/admin/listings/FS-1001/offers", `{"buyer":"tester","amount_cent":100000}`},
		{http.MethodPost, "/api/admin/deals/FL-260926-001/decide", `{"action":"accept"}`},
	}
	for _, p := range paths {
		w := do(r, p.method, p.path, "Bearer anything", p.body)
		if w.Code != 503 {
			t.Errorf("%s %s 应 503，实得 %d：%s", p.method, p.path, w.Code, w.Body.String())
		}
	}
}

func TestFieldValidationAndInjection(t *testing.T) {
	r := setup(t, testToken)
	auth := "Bearer " + testToken
	cases := []struct {
		name     string
		path     string
		body     string
		want     int
		wantCode string
		wantKeys []string
	}{
		{"编号太短", "/api/admin/listings", `{"code":"FS","title":"四个字的标题","category":"book","seller":"a","asking_cent":10000,"floor_cent":9000,"condition":"good","area":"徐汇"}`, 400, "invalid_request", []string{"code"}},
		{"编号含注入字符（长度合规也要拒）", "/api/admin/listings", `{"code":"FS\";DROP--","title":"四个字的标题啊","category":"book","seller":"ab","asking_cent":10000,"floor_cent":9000,"condition":"good","area":"徐汇"}`, 400, "invalid_request", []string{"code"}},
		{"保底高于挂牌", "/api/admin/listings", `{"code":"FS-OK-1","title":"四个字的标题啊","category":"book","seller":"ab","asking_cent":10000,"floor_cent":20000,"condition":"good","area":"徐汇"}`, 400, "invalid_request", []string{"floor_cent"}},
		{"成色枚举非法", "/api/admin/listings", `{"code":"FS-OK-2","title":"四个字的标题啊","category":"book","seller":"ab","asking_cent":10000,"floor_cent":9000,"condition":"mint","area":"徐汇"}`, 400, "invalid_request", []string{"condition"}},
		{"品类不存在", "/api/admin/listings", `{"code":"FS-OK-3","title":"四个字的标题啊","category":"books;DROP","seller":"ab","asking_cent":10000,"floor_cent":9000,"condition":"good","area":"徐汇"}`, 400, "invalid_request", []string{"category"}},
		{"出价低于保底 → 409", "/api/admin/listings/FS-1002/offers", `{"buyer":"probe_a","amount_cent":100}`, 409, "below_floor", nil},
		{"买家名含中文 → 400", "/api/admin/listings/FS-1002/offers", `{"buyer":"阿坏","amount_cent":9900000}`, 400, "invalid_request", []string{"buyer"}},
		{"action 非法 → 400", "/api/admin/deals/FL-1/decide", `{"action":"delete"}`, 400, "invalid_request", []string{"action"}},
		{"畸形 JSON → 400 且不回显解析细节", "/api/admin/listings", `{"code":`, 400, "invalid_request", nil},
		{"裸 CESU-8 字节 → 400", "/api/admin/listings", "{\"code\":\"FS-CE-1\",\"title\":\"\xed\xa0\x80 四个字的标题\",\"category\":\"book\",\"seller\":\"ab\",\"asking_cent\":10000,\"floor_cent\":9000,\"condition\":\"good\",\"area\":\"徐汇\"}", 400, "invalid_request", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(r, http.MethodPost, tc.path, auth, tc.body)
			if w.Code != tc.want {
				t.Fatalf("状态码=%d 期望 %d：%s", w.Code, tc.want, w.Body.String())
			}
			got := decode(t, w)
			if got["code"] != tc.wantCode {
				t.Fatalf("code=%v 期望 %s", got["code"], tc.wantCode)
			}
			fields, _ := got["fields"].(map[string]any)
			for _, k := range tc.wantKeys {
				if _, has := fields[k]; !has {
					t.Errorf("缺少字段错误项 %q，实得 %v", k, fields)
				}
			}
			// 对外绝不回显驱动/解析细节
			low := strings.ToLower(w.Body.String())
			for _, leak := range []string{"gorm", "sqlite", "sql:", "invalid character", "unexpected end of json"} {
				if strings.Contains(low, leak) {
					t.Errorf("响应泄漏内部细节 %q：%s", leak, w.Body.String())
				}
			}
		})
	}
}

func TestHappyPathWriteAndRead(t *testing.T) {
	r := setup(t, testToken)
	auth := "Bearer " + testToken

	// 上架一条新挂单
	body := `{"code":"FS-9001","title":"手工测试挂单 · 老式台灯","category":"book","seller":"tester","asking_cent":20000,"floor_cent":15000,"condition":"good","area":"徐汇·田林"}`
	w := do(r, http.MethodPost, "/api/admin/listings", auth, body)
	if w.Code != 201 {
		t.Fatalf("上架应 201，实得 %d：%s", w.Code, w.Body.String())
	}
	created := decode(t, w)["listing"].(map[string]any)
	if created["status"] != "available" {
		t.Errorf("新挂单状态=%v", created["status"])
	}
	// 编号重复 → 409
	w2 := do(r, http.MethodPost, "/api/admin/listings", auth, body)
	if w2.Code != 409 {
		t.Errorf("重复编号应 409，实得 %d", w2.Code)
	}

	// 出价两笔，第二笔更高
	p1 := do(r, http.MethodPost, "/api/admin/listings/FS-9001/offers", auth,
		`{"buyer":"probe_x","amount_cent":16000,"message":"先出一版"}`)
	if p1.Code != 201 {
		t.Fatalf("第一笔出价应 201，实得 %d：%s", p1.Code, p1.Body.String())
	}
	dealA := decode(t, p1)["offer"].(map[string]any)["deal_no"].(string)
	p2 := do(r, http.MethodPost, "/api/admin/listings/FS-9001/offers", auth,
		`{"buyer":"probe_y","amount_cent":18000}`)
	if p2.Code != 201 {
		t.Fatalf("第二笔出价应 201，实得 %d：%s", p2.Code, p2.Body.String())
	}
	// 确认成交必须落在「当前仍在拍的那笔」上：第二笔更高，第一笔已被标成 outbid。
	dealB := decode(t, p2)["offer"].(map[string]any)["deal_no"].(string)

	// 详情里能看到两笔、最优价标在第二笔上
	d := decode(t, do(r, http.MethodGet, "/api/listings/FS-9001", "", ""))
	offers := d["offers"].([]any)
	if len(offers) != 2 {
		t.Fatalf("详情应有 2 笔出价，实得 %d", len(offers))
	}
	row := d["listing"].(map[string]any)
	if row["best_offer_cent"].(float64) != 18000 {
		t.Errorf("最优价=%v 期望 18000", row["best_offer_cent"])
	}
	if row["asking_ref_pct"].(float64) <= 0 {
		t.Errorf("溢价指数缺失：%v", row["asking_ref_pct"])
	}
	var bestCount int
	for _, o := range offers {
		om := o.(map[string]any)
		if om["is_best"] == true {
			bestCount++
			if om["amount_cent"].(float64) != 18000 {
				t.Errorf("is_best 落在错误出价上：%v", om["amount_cent"])
			}
		}
	}
	if bestCount != 1 {
		t.Errorf("is_best 笔数=%d 期望 1", bestCount)
	}

	// 确认成交：挂单转 reserved，另一笔被顶
	acc := do(r, http.MethodPost, "/api/admin/deals/"+dealB+"/decide", auth, `{"action":"accept"}`)
	if acc.Code != 200 {
		t.Fatalf("确认应 200，实得 %d：%s", acc.Code, acc.Body.String())
	}
	if stale := do(r, http.MethodPost, "/api/admin/deals/"+dealA+"/decide", auth, `{"action":"accept"}`); stale.Code != 409 {
		t.Errorf("已被顶掉的出价再确认应 409，实得 %d：%s", stale.Code, stale.Body.String())
	}
	if decode(t, acc)["listing"].(map[string]any)["status"] != "reserved" {
		t.Error("确认后挂单未转 reserved")
	}
	after := decode(t, do(r, http.MethodGet, "/api/listings/FS-9001", "", ""))["offers"].([]any)
	counts := map[string]int{}
	for _, o := range after {
		counts[o.(map[string]any)["status"].(string)]++
	}
	if counts["accepted"] != 1 {
		t.Errorf("成交笔数=%d", counts["accepted"])
	}
	if counts["outbid"] != 1 {
		t.Errorf("另一笔未标记被顶：%v", counts)
	}
	// 挂单转 reserved 后不再接受出价
	blocked := do(r, http.MethodPost, "/api/admin/listings/FS-9001/offers", auth,
		`{"buyer":"probe_z","amount_cent":19000}`)
	if blocked.Code != 409 {
		t.Errorf("约定后出价应 409，实得 %d", blocked.Code)
	}
}

func TestListEndpointsEnvelopeAndPagination(t *testing.T) {
	r := setup(t, testToken)
	// 不带任何 query 的裸路径必须可用（默认分支）
	cases := []struct {
		path string
		key  string
	}{
		{"/api/listings", "items"},
		{"/api/deals", "items"},
		{"/api/categories", "items"},
	}
	for _, tc := range cases {
		w := do(r, http.MethodGet, tc.path, "", "")
		if w.Code != 200 {
			t.Fatalf("%s 应 200，实得 %d：%s", tc.path, w.Code, w.Body.String())
		}
		body := decode(t, w)
		items, ok := body[tc.key].([]any)
		if !ok {
			t.Fatalf("%s 缺 %s 键：%s", tc.path, tc.key, w.Body.String())
		}
		if len(items) == 0 {
			t.Fatalf("%s 返回空集", tc.path)
		}
		if tc.path != "/api/categories" {
			if body["total"].(float64) < float64(len(items)) {
				t.Errorf("%s total 与 items 不一致", tc.path)
			}
		}
	}
	// limit 上限：page_size=10000 也只能拿回 100 条
	w := do(r, http.MethodGet, "/api/listings?page_size=10000", "", "")
	body := decode(t, w)
	if n := len(body["items"].([]any)); n > 100 || n == 0 {
		t.Errorf("page_size 未夹紧：%d", n)
	}
	if int(body["page_size"].(float64)) > 100 {
		t.Errorf("回显 page_size 越界：%v", body["page_size"])
	}
	// 筛选真的生效
	w2 := do(r, http.MethodGet, "/api/listings?status=sold&page_size=100", "", "")
	for _, it := range decode(t, w2)["items"].([]any) {
		if it.(map[string]any)["status"] != "sold" {
			t.Fatalf("status 筛选失效：%v", it)
		}
	}
	w3 := do(r, http.MethodGet, "/api/deals?status=pending&page_size=100", "", "")
	for _, it := range decode(t, w3)["items"].([]any) {
		if it.(map[string]any)["status"] != "pending" {
			t.Fatalf("deals 状态筛选失效：%v", it)
		}
	}
	// metrics 窗口夹紧与对账字段
	m := decode(t, do(r, http.MethodGet, "/api/metrics?days=999", "", ""))
	if m["identity_ok"] != true {
		t.Errorf("对账未通过：%v", m["identity_note"])
	}
	if n := len(m["daily"].([]any)); n < 3 || n > 30 {
		t.Errorf("days=999 应被夹紧，实得 %d 桶", n)
	}
	if int(m["listings_total"].(float64)) <= 0 {
		t.Error("listings_total 缺失")
	}
}

// 未匹配的 /api/* 必须回 JSON（否则前端 JSON 解析直接抛错）。
func TestUnknownApiPathsReturnJSON(t *testing.T) {
	r := setup(t, testToken)
	cases := []struct{ method, path string }{
		{http.MethodGet, "/api/nope"},
		{http.MethodGet, "/api/listings/"},
		{http.MethodGet, "/api/listings/FS-9999"},
		{http.MethodPost, "/api/admin/nope"},
	}
	for _, tc := range cases {
		w := do(r, tc.method, tc.path, "", "")
		if w.Code >= 500 {
			t.Fatalf("%s %s 打到 5xx：%d", tc.method, tc.path, w.Code)
		}
		// 301（Gin 路径归一化）允许，其余必须是 JSON
		if w.Code != 301 {
			if got := decode(t, w)["code"]; got == nil {
				t.Fatalf("%s %s 响应无 code 字段：%s", tc.method, tc.path, w.Body.String())
			}
		}
	}
}

// 请求体上限：谎报 Content-Length 与不声明长度两条路都要堵。
func TestBodySizeLimits(t *testing.T) {
	r := setup(t, testToken)
	auth := "Bearer " + testToken
	huge := `{"buyer":"probe_big","amount_cent":100000,"message":"` + strings.Repeat("刀", 6000) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/listings/FS-1005/offers", bytes.NewBufferString(huge))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", auth)
	req.ContentLength = 1 << 20 // 谎报一个超限长度
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("谎报 Content-Length 应 413，实得 %d：%s", w.Code, w.Body.String())
	}
	if decode(t, w)["code"] != "body_too_large" {
		t.Errorf("413 响应码不对：%s", w.Body.String())
	}
	// 不声明长度：由 MaxBytesReader 拦下，必须是 4xx 且不外泄内部报错
	req2 := httptest.NewRequest(http.MethodPost, "/api/admin/listings/FS-1005/offers", bytes.NewBufferString(huge))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("Authorization", auth)
	req2.ContentLength = -1
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code < 400 || w2.Code >= 500 {
		t.Errorf("未声明长度的超大请求体应 4xx，实得 %d", w2.Code)
	}
	low := strings.ToLower(w2.Body.String())
	for _, leak := range []string{"request body too large", "unexpected eof", "json:", "gorm", "sqlite"} {
		if strings.Contains(low, leak) {
			t.Errorf("响应泄漏内部细节 %q：%s", leak, w2.Body.String())
		}
	}
}

func TestCOROnlyAllowsExactLoopback(t *testing.T) {
	r := setup(t, testToken)
	cases := []struct {
		origin string
		allow  bool
	}{
		{"http://localhost:5173", true},
		{"http://127.0.0.1:8080", true},
		{"http://127.0.0.2:8080", true},
		{"http://[::1]:3000", true},
		{"http://127.0.0.1.evil.example", false},
		{"http://localhost.attacker.test", false},
		{"http://localhost:5173.evil.example", false},
		{"null", false},
		{"https://example.com", false},
		{"//localhost", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodOptions, "/api/listings", nil)
		req.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		got := w.Header().Get("Access-Control-Allow-Origin")
		if tc.allow && got != tc.origin {
			t.Errorf("Origin %s 应放行，实得 %q", tc.origin, got)
		}
		if !tc.allow && got != "" {
			t.Errorf("Origin %s 不应放行，实得 %q", tc.origin, got)
		}
	}
}

func TestHealthAndSecurityHeaders(t *testing.T) {
	r := setup(t, testToken)
	w := do(r, http.MethodGet, "/api/health", "", "")
	if w.Code != 200 {
		t.Fatalf("health=%d", w.Code)
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("缺 X-Content-Type-Options")
	}
	if w.Header().Get("X-Frame-Options") != "DENY" {
		t.Error("缺 X-Frame-Options")
	}
	if w.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Error("缺 Referrer-Policy")
	}
	// CSP：脚本只允许同源（三风格靠 style-src 'unsafe-inline' 注入运行时换的 CSS）。
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self'") || !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("CSP 不完整：%q", csp)
	}
	// 静态目录不存在时（测试环境）根路径应回 JSON 404 而不是纯文本
	root := do(r, http.MethodGet, "/", "", "")
	if root.Code != 404 {
		t.Errorf("无静态产物时根路径应 404，实得 %d", root.Code)
	}
	if !strings.Contains(root.Body.String(), "not_found") {
		t.Errorf("根路径响应应为 JSON：%s", root.Body.String())
	}
}

// 领域错误必须映射成稳定 code，且不同分支的 401/403/503 不混用。
func TestDomainErrorMapping(t *testing.T) {
	r := setup(t, testToken)
	w := do(r, http.MethodGet, "/api/listings/%27%3B%20DROP%3B--", "", "")
	if w.Code != 404 && w.Code != 400 {
		t.Errorf("非法编号应 400/404，实得 %d：%s", w.Code, w.Body.String())
	}
	if !domain.ValidListingStatus("sold; DROP") {
		return
	}
	t.Fatal("枚举校验被放宽")
}
