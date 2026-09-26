package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"etk/internal/domain"
	"etk/internal/handler"
	"etk/internal/repository"
	"etk/internal/server"
	"etk/internal/service"
)

const testToken = "etk-test-token-7f3a"

// app 是一套「真种子 + 真路由」的测试实例。go test 抓不到 HTTP 层的错，
// 所以鉴权矩阵、字段校验、状态机 409 全部在这里以真实请求的形式过一遍。
type app struct {
	srv    *httptest.Server
	db     *gorm.DB
	now    time.Time
	token  string
	closed bool
}

func newApp(t *testing.T, token string) *app {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(t.TempDir() + "/api.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := repository.New(db)
	now := time.Now().UTC().Truncate(time.Second).Add(-90 * time.Minute)
	if err := r.Seed(context.Background(), now); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	h := handler.New(service.New(r))
	srv := httptest.NewServer(server.Router(h, token))
	a := &app{srv: srv, db: db, now: now, token: token}
	t.Cleanup(a.Close)
	return a
}

func (a *app) Close() {
	if !a.closed {
		a.srv.Close()
		a.closed = true
	}
}

type reply struct {
	status int
	body   []byte
	head   http.Header
}

func (r reply) decode(t *testing.T) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(r.body, &out); err != nil {
		t.Fatalf("响应不是合法 JSON：%s（%v）", r.body, err)
	}
	return out
}

func (r reply) code(t *testing.T) string {
	t.Helper()
	v, ok := r.decode(t)["code"]
	if !ok {
		t.Fatalf("响应里没有 code 字段：%s", r.body)
	}
	s, _ := v.(string)
	return s
}

func (a *app) do(t *testing.T, method, path, token string, body any) reply {
	t.Helper()
	var rd io.Reader
	if body != nil {
		switch v := body.(type) {
		case []byte:
			rd = bytes.NewReader(v)
		case string:
			rd = strings.NewReader(v)
		default:
			b, err := json.Marshal(v)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			rd = bytes.NewReader(b)
		}
	}
	req, err := http.NewRequest(method, a.srv.URL+path, rd)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := a.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return reply{status: resp.StatusCode, body: b, head: resp.Header}
}

// raw 用于发「不合法 JSON 的裸字节」，例如裸 CESU-8 三字节。
func (a *app) rawWithHeader(t *testing.T, method, path string, header http.Header, body []byte) reply {
	t.Helper()
	req, err := http.NewRequest(method, a.srv.URL+path, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	for k, vs := range header {
		for _, v := range vs {
			req.Header.Set(k, v)
		}
	}
	resp, err := a.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return reply{status: resp.StatusCode, body: b, head: resp.Header}
}

func counts(t *testing.T, a *app) [3]int64 {
	t.Helper()
	var out [3]int64
	for i, tbl := range []string{"events", "orders", "tickets"} {
		var n int64
		if err := a.db.Table(tbl).Count(&n).Error; err != nil {
			t.Fatalf("%s: %v", tbl, err)
		}
		out[i] = n
	}
	return out
}

// ---- 鉴权矩阵 ----

// 负向用例一律打在「不存在的资源」上：万一鉴权漏了，也会变成 404 而不是真的写库，
// 这样这条测试失败时能立刻区分「鉴权失效」与「数据被污染」。
func TestAdminAuthMatrix(t *testing.T) {
	type probe struct {
		name   string
		path   string
		body   any
		wantOK int
	}
	probes := []probe{
		{"建场次", "/api/admin/events", domain.CreateEventInput{
			Code: "ET999999X", Title: "鉴权矩阵专用场次", Artist: "矩阵乐团", Category: "concert",
			Venue: "测试馆", City: "上海", Gates: "A,B",
			DoorsAt:        time.Now().UTC().Add(72 * time.Hour).Format(time.RFC3339),
			StartAt:        time.Now().UTC().Add(74 * time.Hour).Format(time.RFC3339),
			PresaleEnd:     time.Now().UTC().Add(70 * time.Hour).Format(time.RFC3339),
			RefundCutHours: 24,
		}, http.StatusCreated},
		{"改状态", "/api/admin/events/ET999999X/status", map[string]string{"action": "open"}, http.StatusNotFound},
		{"出票", "/api/admin/sales", domain.SaleInput{EventCode: "ET999999X", TypeCode: "TT999999X",
			Quantity: 1, Buyer: "auth_probe", Phone: "13800003333", Channel: "web"}, http.StatusNotFound},
		{"核销", "/api/admin/tickets/TK999999999/check-in", domain.CheckinInput{Gate: "A"}, http.StatusNotFound},
		{"退票", "/api/admin/orders/ET999999X001/refund", domain.RefundInput{Reason: "矩阵探测"}, http.StatusNotFound},
	}
	cases := []struct {
		name       string
		token      string // 服务端配置的令牌
		authHeader string // 空串表示不带 Authorization
		wantStatus int
		wantCode   string
		writes     bool // 该用例允许打到资源上（凭证正确）
	}{
		{"服务端未配令牌", "", "", http.StatusServiceUnavailable, "server_misconfigured", false},
		{"未带凭证", testToken, "", http.StatusUnauthorized, "unauthorized", false},
		{"非 Bearer 方案", testToken, "Basic dXNlcjpwdw==", http.StatusUnauthorized, "unauthorized", false},
		{"Bearer 后为空", testToken, "Bearer ", http.StatusUnauthorized, "unauthorized", false},
		{"只有 Bearer 一词", testToken, "Bearer", http.StatusUnauthorized, "unauthorized", false},
		{"令牌错误", testToken, "Bearer totally-wrong", http.StatusForbidden, "forbidden", false},
		{"令牌前后留空格", testToken, "Bearer  " + testToken + " ", http.StatusNotFound, "not_found", true},
		{"方案大小写不敏感", testToken, "bearer " + testToken, http.StatusNotFound, "not_found", true},
		{"错误令牌不改写数据", testToken, "Bearer " + testToken + "x", http.StatusForbidden, "forbidden", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, p := range probes {
				a := newApp(t, tc.token)
				before := counts(t, a)
				h := http.Header{"Content-Type": {"application/json"}}
				if tc.authHeader != "" {
					h.Set("Authorization", tc.authHeader)
				}
				r := a.rawWithHeader(t, http.MethodPost, p.path, h, jsonBytes(t, p.body))
				want, wantCode := tc.wantStatus, tc.wantCode
				if tc.writes {
					// 凭证正确时打到资源上：期望变成各接口自己的成功码 / 404。
					want, wantCode = p.wantOK, ""
				}
				if r.status != want {
					t.Fatalf("%s → %d %s，期望 %d", p.name, r.status, truncate(r.body), want)
				}
				if wantCode != "" && r.code(t) != wantCode {
					t.Fatalf("%s → code=%q，期望 %q", p.name, r.code(t), wantCode)
				}
				if !tc.writes {
					if after := counts(t, a); after != before {
						t.Fatalf("%s：鉴权失败却写进了库（%v → %v）", p.name, before, after)
					}
				}
			}
		})
	}
}

func jsonBytes(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("%v", err)
	}
	return b
}

// 空令牌实例连「带正确头」都不可能放行——这里显式验证 503 而不是 401，
// 因为放行条件写反（expected 为空时 Compare(空,空)==1）是真实发生过的缺陷。
func TestEmptyTokenFailsClosedEvenWithHeader(t *testing.T) {
	a := newApp(t, "")
	r := a.do(t, http.MethodPost, "/api/admin/sales", "", `{"event_code":"ETLIVE01"}`)
	if r.status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, 期望 503：%s", r.status, r.body)
	}
	// 即便客户端把 Authorization 猜对了也一样拦（值等于空令牌的期望）。
	r2 := a.do(t, http.MethodPost, "/api/admin/sales", " ", `{"event_code":"ETLIVE01"}`)
	if r2.status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, 期望 503", r2.status)
	}
}

// ---- 读接口契约 + 安全头 ----

func TestReadEndpoints(t *testing.T) {
	a := newApp(t, testToken)
	cases := []struct {
		path     string
		wantKey  string
		minItems float64
	}{
		{"/api/health", "status", -1},
		{"/api/stats", "identity_ok", -1},
		{"/api/events", "items", 8},
		{"/api/events/ETLIVE01", "event", -1},
		{"/api/orders", "items", 20},
		{"/api/tickets", "items", 20},
		{"/api/orders?page_size=3&sort=payable&dir=desc", "items", 3},
		{"/api/tickets?status=used&page_size=5", "items", 5},
		{"/api/events?status=on_sale&q=交响", "items", 1},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			r := a.do(t, http.MethodGet, tc.path, "", nil)
			if r.status != http.StatusOK {
				t.Fatalf("status = %d：%s", r.status, r.body)
			}
			if ct := r.head.Get("Content-Type"); !strings.Contains(ct, "application/json") {
				t.Fatalf("Content-Type = %q", ct)
			}
			body := r.decode(t)
			if _, ok := body[tc.wantKey]; !ok {
				t.Fatalf("响应缺少 %q：%s", tc.wantKey, r.body)
			}
			if tc.minItems >= 0 {
				items, ok := body["items"].([]any)
				if !ok {
					t.Fatalf("items 不是数组：%s", r.body)
				}
				if float64(len(items)) < tc.minItems {
					t.Fatalf("items = %d, 期望 >= %v", len(items), tc.minItems)
				}
			}
			// 安全头：接口数据一律禁缓存，且不得嗅探类型。
			for _, h := range []struct{ name, want string }{
				{"X-Content-Type-Options", "nosniff"},
				{"X-Frame-Options", "DENY"},
				{"Referrer-Policy", "no-referrer"},
			} {
				if got := r.head.Get(h.name); got != h.want {
					t.Fatalf("%s = %q, 期望 %q", h.name, got, h.want)
				}
			}
			csp := r.head.Get("Content-Security-Policy")
			if !strings.Contains(csp, "script-src 'self'") || strings.Contains(csp, "script-src 'self' 'unsafe-inline'") {
				t.Fatalf("CSP 允许了内联脚本：%q", csp)
			}
			if !strings.Contains(csp, "frame-ancestors 'none'") {
				t.Fatalf("CSP 缺 frame-ancestors：%q", csp)
			}
			if r.head.Get("Cache-Control") != "no-store" {
				t.Fatalf("接口未禁缓存：Cache-Control = %q", r.head.Get("Cache-Control"))
			}
		})
	}
}

// 分页上限：page_size 吹到天大也只能按服务端上限返回，绝不能把全表拖走。
func TestPaginationCeiling(t *testing.T) {
	a := newApp(t, testToken)
	r := a.do(t, http.MethodGet, "/api/tickets?page_size=100000", "", nil)
	if r.status != http.StatusOK {
		t.Fatalf("status = %d", r.status)
	}
	body := r.decode(t)
	size, _ := body["page_size"].(float64)
	if int(size) != domain.MaxPageSize {
		t.Fatalf("page_size = %v, 期望夹到 %d", body["page_size"], domain.MaxPageSize)
	}
	items, _ := body["items"].([]any)
	if len(items) > domain.MaxPageSize {
		t.Fatalf("返回 %d 条，超过上限", len(items))
	}
	// 非法分页参数不得 500，且回显的 sort/dir 只能是白名单值。
	allowed := map[string]bool{
		"doors": true, "start": true, "code": true, "status": true,
		"sold": true, "gross": true, "used": true, "quota": true, "id": true,
	}
	for _, q := range []string{"?page=0&page_size=0", "?page=-3", "?dir=sideways", "?sort=password", "?days=99999", "?q="} {
		rr := a.do(t, http.MethodGet, "/api/events"+q, "", nil)
		if rr.status != http.StatusOK {
			t.Fatalf("%s → %d：%s", q, rr.status, rr.body)
		}
		m := rr.decode(t)
		if s, _ := m["sort"].(string); !allowed[s] {
			t.Fatalf("%s 回显了白名单之外的 sort=%q", q, s)
		}
		if d, _ := m["dir"].(string); d != "asc" && d != "desc" {
			t.Fatalf("%s 回显了 dir=%q", q, d)
		}
	}
}

// ---- 字段校验 400 ----

func TestFieldValidation(t *testing.T) {
	a := newApp(t, testToken)
	validEvent := domain.CreateEventInput{
		Code: "et261111z", Title: "校验用场次", Artist: "测试乐团", Category: "livehouse",
		Venue: "南岸剧场", City: "上海", Gates: "A,B",
		DoorsAt:        a.now.Add(48 * time.Hour).Format(time.RFC3339),
		StartAt:        a.now.Add(50 * time.Hour).Format(time.RFC3339),
		PresaleEnd:     a.now.Add(40 * time.Hour).Format(time.RFC3339),
		RefundCutHours: 24,
	}
	cases := []struct {
		name     string
		path     string
		body     any
		wantCode string
		wantKys  []string
	}{
		{"建场次缺标题", "/api/admin/events", func() map[string]any {
			m := toMap(t, validEvent)
			delete(m, "title")
			return m
		}(), "invalid_request", []string{"title"}},
		{"编号含注入", "/api/admin/events", withField(t, validEvent, "code", `ET' OR '1`), "invalid_request", []string{"code"}},
		{"开门晚于开演", "/api/admin/events", withField(t, validEvent, "doors_at",
			a.now.Add(60*time.Hour).Format(time.RFC3339)), "invalid_request", []string{"doors_at"}},
		{"时间非 RFC3339", "/api/admin/events", withField(t, validEvent, "start_at", "2026/11/11 20:00"),
			"invalid_request", []string{"start_at"}},
		{"退款截止越界", "/api/admin/events", withField(t, validEvent, "refund_cutoff_hours", 9999),
			"invalid_request", []string{"refund_cutoff_hours"}},
		{"闸口为空", "/api/admin/events", withField(t, validEvent, "gates", ""), "invalid_request", []string{"gates"}},
		{"出票张数为零", "/api/admin/sales", domain.SaleInput{EventCode: "ETLIVE01", TypeCode: "TTLIVE011",
			Quantity: 0, Buyer: "qa_test", Phone: "13800001111", Channel: "web"}, "invalid_request", []string{"quantity"}},
		{"手机号 10 位", "/api/admin/sales", domain.SaleInput{EventCode: "ETLIVE01", TypeCode: "TTLIVE011",
			Quantity: 1, Buyer: "qa_test", Phone: "1380000111", Channel: "web"}, "invalid_request", []string{"phone"}},
		{"购票人带引号", "/api/admin/sales", domain.SaleInput{EventCode: "ETLIVE01", TypeCode: "TTLIVE011",
			Quantity: 1, Buyer: `a" OR "1"="1`, Phone: "13800001111", Channel: "web"}, "invalid_request", []string{"buyer"}},
		{"闸口超长", "/api/admin/tickets/TKLIVE0001/check-in", domain.CheckinInput{Gate: "GATE-TOO-LONG"},
			"invalid_request", []string{"gate"}},
		{"退票原因过短", "/api/admin/orders/ET261001A001/refund", domain.RefundInput{Reason: "x"},
			"invalid_request", []string{"reason"}},
		{"状态动作非法", "/api/admin/events/ETLIVE01/status", map[string]string{"action": "launch"},
			"invalid_request", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := a.do(t, http.MethodPost, tc.path, testToken, tc.body)
			if r.status != http.StatusBadRequest {
				t.Fatalf("status = %d：%s，期望 400", r.status, r.body)
			}
			if got := r.code(t); got != tc.wantCode {
				t.Fatalf("code = %s, 期望 %s", got, tc.wantCode)
			}
			m := r.decode(t)
			fields, _ := m["fields"].(map[string]any)
			for _, k := range tc.wantKys {
				if _, ok := fields[k]; !ok {
					t.Fatalf("fields 缺少 %q：%v", k, m["fields"])
				}
				if msg, _ := fields[k].(string); strings.TrimSpace(msg) == "" {
					t.Fatalf("fields[%q] 为空文案", k)
				}
			}
			// 对外文案里绝不得出现驱动/ORM 细节。
			for _, leak := range leakMarkers {
				if bytes.Contains(r.body, []byte(leak)) {
					t.Fatalf("400 响应泄露了实现细节 %q：%s", leak, r.body)
				}
			}
		})
	}
}

// JSON 解析失败、乱码、超长请求体都必须给出确定的 4xx，而不是 500 或挂断。
func TestMalformedAndOversizedBodies(t *testing.T) {
	a := newApp(t, testToken)
	cases := []struct {
		name       string
		path       string
		token      string
		body       []byte
		wantStatus int
		wantCode   string
		wantFields []string
	}{
		{"残缺 JSON", "/api/admin/sales", testToken, []byte(`{"event_code":`), http.StatusBadRequest, "invalid_request", nil},
		{"数组代替对象", "/api/admin/sales", testToken, []byte(`[1,2,3]`), http.StatusBadRequest, "invalid_request", nil},
		{"空 body", "/api/admin/sales", testToken, nil, http.StatusBadRequest, "invalid_request", nil},
		// 裸 CESU-8 三字节（代理对直接写成 UTF-8）会被 Go 解码成 U+FFFD，必须按字段拒掉。
		{"裸 CESU-8", "/api/admin/sales", testToken, []byte(`{"event_code":"ETLIVE01","type_code":"TTLIVE011",` +
			`"quantity":1,"buyer":"ab` + string([]byte{0xED, 0xA0, 0x80}) + `cd","phone":"13800001111","channel":"web"}`),
			http.StatusBadRequest, "invalid_request", []string{"buyer"}},
		{"裸 CESU-8 在建场次", "/api/admin/events", testToken, []byte(`{"code":"ET261231Z","title":"x` +
			string([]byte{0xED, 0xBF, 0xBD}) + `y"}`), http.StatusBadRequest, "invalid_request", []string{"title"}},
		{"类型不符", "/api/admin/sales", testToken, []byte(`{"quantity":"many","event_code":"ETLIVE01"}`),
			http.StatusBadRequest, "invalid_request", nil},
		{"超过 16KB", "/api/admin/sales", testToken, bytes.Repeat([]byte("a"), 20*1024),
			http.StatusRequestEntityTooLarge, "body_too_large", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := http.Header{"Content-Type": {"application/json"}}
			if tc.token != "" {
				h.Set("Authorization", "Bearer "+tc.token)
			}
			r := a.rawWithHeader(t, http.MethodPost, tc.path, h, tc.body)
			if r.status != tc.wantStatus {
				t.Fatalf("status = %d：%s，期望 %d", r.status, truncate(r.body), tc.wantStatus)
			}
			if tc.wantCode == "" {
				return
			}
			if got := r.code(t); got != tc.wantCode {
				t.Fatalf("code = %s, 期望 %s", got, tc.wantCode)
			}
			if len(tc.wantFields) == 0 {
				return
			}
			m := r.decode(t)
			fields, _ := m["fields"].(map[string]any)
			for _, f := range tc.wantFields {
				if _, ok := fields[f]; !ok {
					t.Fatalf("fields 缺 %q：%v", f, m["fields"])
				}
			}
		})
	}
	// 不声明 Content-Length 的大 body 也要被 MaxBytesReader 挡住。
	huge := []byte(`{"event_code":"ETLIVE01","type_code":"TTLIVE011","quantity":1,"buyer":"` +
		strings.Repeat("a", 40*1024) + `","phone":"13800001111","channel":"web"}`)
	req, err := http.NewRequest(http.MethodPost, a.srv.URL+"/api/admin/sales", bytes.NewReader(huge))
	if err != nil {
		t.Fatalf("%v", err)
	}
	req.ContentLength = -1
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testToken)
	resp, err := a.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("chunked 请求失败：%v", err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("未声明长度的大 body → %d %s", resp.StatusCode, truncate(b))
	}
}

var leakMarkers = []string{
	"sql", "SQL", "SQLITE", "sqlite3", "gorm", "GORM", "constraint", "no such table",
	"INSERT INTO", "SELECT ", "driver", "dial tcp", "runtime error", "goroutine",
}

// 所有对外 JSON 里都不得出现完整手机号，也不得出现底层错误串。
func TestNoPrivacyOrInternalsLeak(t *testing.T) {
	a := newApp(t, testToken)
	var phones []string
	if err := a.db.Raw("SELECT phone FROM orders").Scan(&phones).Error; err != nil || len(phones) < 20 {
		t.Fatalf("取种子手机号失败：%v（%d 个）", err, len(phones))
	}
	paths := []string{
		"/api/stats", "/api/events", "/api/events/ETLIVE01", "/api/orders?page_size=100",
		"/api/tickets?page_size=100", "/api/orders?status=refunded", "/api/tickets?status=used",
	}
	for _, p := range paths {
		r := a.do(t, http.MethodGet, p, "", nil)
		if r.status != http.StatusOK {
			t.Fatalf("%s → %d", p, r.status)
		}
		for _, ph := range phones {
			if bytes.Contains(r.body, []byte(ph)) {
				t.Fatalf("%s 泄露了完整手机号 %s", p, ph)
			}
		}
		if bytes.Contains(r.body, []byte(`"phone":`)) {
			t.Fatalf("%s 输出了 phone 字段", p)
		}
		for _, leak := range leakMarkers {
			if bytes.Contains(r.body, []byte(leak)) {
				t.Fatalf("%s 含实现细节 %q", p, leak)
			}
		}
	}
	// 写路径的成功响应同样过一遍。
	ok := a.do(t, http.MethodPost, "/api/admin/sales", testToken, domain.SaleInput{
		EventCode: "ET261001A", TypeCode: "TT261001A1", Quantity: 2,
		Buyer: "privacy_probe", Phone: "13900001234", Channel: "web",
	})
	if ok.status != http.StatusCreated {
		t.Fatalf("出票失败：%d %s", ok.status, ok.body)
	}
	if bytes.Contains(ok.body, []byte("13900001234")) || bytes.Contains(ok.body, []byte(`"phone":`)) {
		t.Fatalf("出票响应泄露手机号：%s", truncate(ok.body))
	}
	if !bytes.Contains(ok.body, []byte("139****1234")) {
		t.Fatalf("出票响应没有给出脱敏号：%s", truncate(ok.body))
	}
	// 脱敏号确实来自真号，而不是硬编码。
	var storedPhones []string
	if err := a.db.Raw("SELECT phone FROM orders WHERE buyer = ?", "privacy_probe").
		Scan(&storedPhones).Error; err != nil || len(storedPhones) != 1 {
		t.Fatalf("查不到刚落库的手机号：n=%d err=%v", len(storedPhones), err)
	}
	if storedPhones[0] != "13900001234" {
		t.Fatalf("落库手机号 = %q", storedPhones[0])
	}
}

// 内部错误（非 AppError）必须降级成通用 500，绝不把 err.Error() 抛给客户端。
func TestInternalErrorIsRedacted(t *testing.T) {
	a := newApp(t, testToken)
	// 直接删掉一张表，制造真实的驱动层错误（不是 AppError 能表达的）。
	if err := a.db.Exec("DROP TABLE ticket_types").Error; err != nil {
		t.Fatalf("%v", err)
	}
	for _, p := range []string{"/api/events/ETLIVE01", "/api/stats"} {
		r := a.do(t, http.MethodGet, p, "", nil)
		if r.status != http.StatusInternalServerError {
			t.Fatalf("%s → %d，期望 500", p, r.status)
		}
		m := r.decode(t)
		if m["code"] != "internal_error" || m["message"] != "服务内部错误，请稍后重试" {
			t.Fatalf("%s 响应体异常：%s", p, r.body)
		}
		for _, leak := range append(leakMarkers, "no such table") {
			if bytes.Contains(r.body, []byte(leak)) {
				t.Fatalf("500 响应泄露了 %q：%s", leak, r.body)
			}
		}
	}
}

// ---- 状态机与并发口径（409）----

func TestStateMachineConflicts(t *testing.T) {
	a := newApp(t, testToken)
	// 取一张进行中场次的有效票，走完整的「核销 → 再核销」闭环。
	var probes []struct {
		Code string
		Gate string
	}
	if err := a.db.Raw(`SELECT t.code AS code, e.gates AS gate FROM tickets t
		JOIN events e ON e.id = t.event_id
		WHERE e.code = 'ETLIVE01' AND t.status = 'valid' ORDER BY t.id LIMIT 1`).
		Scan(&probes).Error; err != nil || len(probes) != 1 {
		t.Fatalf("取进行中场次的有效票失败：n=%d err=%v", len(probes), err)
	}
	ticketCode := probes[0].Code
	gate := domain.GateList(probes[0].Gate)[0]
	// 一笔从未收钱的作废单 + 一笔已收钱的单，分别用来验「拒退」与「退成功」。
	var refundProbes []struct {
		Cancelled string
		Paid      string
	}
	if err := a.db.Raw(`SELECT
		(SELECT code FROM orders WHERE status = 'cancelled' ORDER BY id LIMIT 1) AS cancelled,
		(SELECT code FROM orders WHERE status = 'paid' AND event_id =
			(SELECT id FROM events WHERE code = 'ET261001A') ORDER BY id LIMIT 1) AS paid`).
		Scan(&refundProbes).Error; err != nil || len(refundProbes) != 1 ||
		refundProbes[0].Cancelled == "" || refundProbes[0].Paid == "" {
		t.Fatalf("取退票探针失败：%+v err=%v", refundProbes, err)
	}
	cancelledCode := refundProbes[0].Cancelled
	paidCode := refundProbes[0].Paid
	ok := a.do(t, http.MethodPost, "/api/admin/tickets/"+ticketCode+"/check-in", testToken,
		domain.CheckinInput{Gate: gate})
	if ok.status != http.StatusOK {
		t.Fatalf("首次核销失败：%d %s", ok.status, ok.body)
	}
	if got := ok.decode(t)["ticket"]; got == nil {
		t.Fatal("核销响应缺 ticket")
	}
	cases := []struct {
		name     string
		method   string
		path     string
		body     any
		wantCode string
	}{
		{"重复核销", http.MethodPost, "/api/admin/tickets/" + ticketCode + "/check-in",
			domain.CheckinInput{Gate: gate}, "already_used"},
		{"闸口不属于本场", http.MethodPost, "/api/admin/tickets/" + ticketCode + "/check-in",
			domain.CheckinInput{Gate: "Z9"}, "already_used"},
		{"不存在的票", http.MethodPost, "/api/admin/tickets/TKZZZZZZZZ/check-in",
			domain.CheckinInput{Gate: "A"}, "not_found"},
		{"未开票场次不能散场", http.MethodPost, "/api/admin/events/ET261020A/status",
			map[string]string{"action": "close"}, "conflict"},
		{"已散场不可再取消", http.MethodPost, "/api/admin/events/ET260920A/status",
			map[string]string{"action": "cancel"}, "conflict"},
		{"取消场次不可再开票", http.MethodPost, "/api/admin/events/ET260928C/status",
			map[string]string{"action": "open"}, "conflict"},
		{"场次不存在", http.MethodPost, "/api/admin/events/ETZZZZZZZ/status",
			map[string]string{"action": "open"}, "not_found"},
		{"草稿场次不可出票", http.MethodPost, "/api/admin/sales", domain.SaleInput{
			EventCode: "ET261020A", TypeCode: "TT261020A1", Quantity: 1,
			Buyer: "state_probe", Phone: "13800002222", Channel: "web"}, "conflict"},
		{"不存在的场次出票", http.MethodPost, "/api/admin/sales", domain.SaleInput{
			EventCode: "ETZZZZZZZ1", TypeCode: "TTZZZZZZZ1", Quantity: 1,
			Buyer: "state_probe", Phone: "13800002222", Channel: "web"}, "not_found"},
		{"退一笔从未收钱的单", http.MethodPost, "/api/admin/orders/" + cancelledCode + "/refund",
			domain.RefundInput{Reason: "这单没付过钱"}, "order_cancelled"},
		{"不存在的订单退票", http.MethodPost, "/api/admin/orders/ETZZZZZZZ001/refund",
			domain.RefundInput{Reason: "查无此单"}, "not_found"},
		{"编号非法的订单", http.MethodPost, `/api/admin/orders/ET';DROP/refund`,
			domain.RefundInput{Reason: "非法编号"}, "invalid_order_code"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := a.do(t, tc.method, tc.path, testToken, tc.body)
			if r.status != http.StatusConflict && r.status != http.StatusNotFound && r.status != http.StatusBadRequest {
				t.Fatalf("status = %d：%s", r.status, r.body)
			}
			if got := r.code(t); got != tc.wantCode {
				t.Fatalf("code = %s, 期望 %s（%s）", got, tc.wantCode, truncate(r.body))
			}
		})
	}
	// 正向退票链路：退款额只覆盖票面、服务费留存，且二次退票撞 409。
	first := a.do(t, http.MethodPost, "/api/admin/orders/"+paidCode+"/refund", testToken,
		domain.RefundInput{Reason: "行程变更，开演前退"})
	if first.status != http.StatusOK {
		t.Fatalf("退票 → %d %s", first.status, first.body)
	}
	fm := first.decode(t)
	order, _ := fm["order"].(map[string]any)
	subtotal, _ := order["subtotal_cent"].(float64)
	refunded, _ := fm["refunded_cent"].(float64)
	payable, _ := order["payable_cent"].(float64)
	fee, _ := order["fee_cent"].(float64)
	retained, _ := order["retained_cent"].(float64)
	if refunded != subtotal {
		t.Fatalf("退款 %v ≠ 票面小计 %v", refunded, subtotal)
	}
	if retained != fee || refunded+retained != payable {
		t.Fatalf("拆分不配平：退 %v + 留 %v ≠ 付 %v（服务费 %v）", refunded, retained, payable, fee)
	}
	if order["status"] != "refunded" {
		t.Fatalf("订单状态 = %v", order["status"])
	}
	if pm, _ := order["phone_masked"].(string); pm == "" {
		t.Fatalf("退票响应缺脱敏手机号：%s", truncate(first.body))
	}
	second := a.do(t, http.MethodPost, "/api/admin/orders/"+paidCode+"/refund", testToken,
		domain.RefundInput{Reason: "再退一次试试"})
	if second.status != http.StatusConflict || second.code(t) != "already_refunded" {
		t.Fatalf("二次退票 → %d %s", second.status, second.body)
	}
	// 建单 → 开票 → 散场的正向链路，验证状态机没有把合法路径也堵死。
	created := a.do(t, http.MethodPost, "/api/admin/events", testToken, domain.CreateEventInput{
		Code: "ET261224A", Title: "平安夜安可场", Artist: "城市合唱团", Category: "concert",
		Venue: "北岸音乐厅", City: "上海", Gates: "A,VIP",
		DoorsAt:        a.now.Add(72 * time.Hour).Format(time.RFC3339),
		StartAt:        a.now.Add(74 * time.Hour).Format(time.RFC3339),
		PresaleEnd:     a.now.Add(70 * time.Hour).Format(time.RFC3339),
		RefundCutHours: 24, Note: "状态机正向链路验证",
	})
	if created.status != http.StatusCreated {
		t.Fatalf("建场次 → %d %s", created.status, created.body)
	}
	if got, _ := created.decode(t)["event"].(map[string]any); got["status"] != "draft" {
		t.Fatalf("新场次状态 = %v, 期望 draft", got["status"])
	}
	dup := a.do(t, http.MethodPost, "/api/admin/events", testToken, domain.CreateEventInput{
		Code: "ET261224A", Title: "重复编号", Artist: "x y", Category: "concert",
		Venue: "北岸音乐厅", City: "上海", Gates: "A",
		DoorsAt:        a.now.Add(72 * time.Hour).Format(time.RFC3339),
		StartAt:        a.now.Add(74 * time.Hour).Format(time.RFC3339),
		PresaleEnd:     a.now.Add(70 * time.Hour).Format(time.RFC3339),
		RefundCutHours: 24,
	})
	if dup.status != http.StatusConflict || dup.code(t) != "conflict" {
		t.Fatalf("重复编号 → %d %s", dup.status, dup.body)
	}
	opened := a.do(t, http.MethodPost, "/api/admin/events/ET261224A/status", testToken,
		map[string]string{"action": "open"})
	if opened.status != http.StatusOK {
		t.Fatalf("开票 → %d %s", opened.status, opened.body)
	}
	closed := a.do(t, http.MethodPost, "/api/admin/events/et261224a/status", testToken,
		map[string]string{"action": "close"})
	if closed.status != http.StatusOK {
		t.Fatalf("小写编号散场 → %d %s", closed.status, closed.body)
	}
	if v, _ := closed.decode(t)["event"].(map[string]any); v["closed_at"] == nil {
		t.Fatal("散场未留下 closed_at")
	}
}

// ---- CORS 与路由 ----

func TestCORSAndRouting(t *testing.T) {
	a := newApp(t, testToken)
	cases := []struct {
		name   string
		origin string
		allow  bool
	}{
		{"本机来源", "http://localhost:5173", true},
		{"127.0.0.1", "http://127.0.0.1:8080", true},
		{"IPv6 回环", "http://[::1]:3000", true},
		{"前缀伪装", "http://localhost.evil.example", false},
		{"127.0.0.1 后缀伪装", "http://127.0.0.1.evil.example", false},
		{"null 来源", "null", false},
		{"https 非同源", "https://not-mine.example", false},
		{"非 http 方案", "file://localhost", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := http.Header{"Origin": {tc.origin}}
			r := a.rawWithHeader(t, http.MethodGet, "/api/events", h, nil)
			got := r.head.Get("Access-Control-Allow-Origin")
			if tc.allow && got != tc.origin {
				t.Fatalf("应放行 %q，得到 %q", tc.origin, got)
			}
			if !tc.allow && got != "" {
				t.Fatalf("应拒绝 %q，却放行 %q", tc.origin, got)
			}
			if tc.allow && r.head.Get("Vary") != "Origin" {
				t.Fatal("放行时未设 Vary: Origin，缓存会串来源")
			}
		})
	}
	// OPTIONS 预检不得进入业务处理。
	pre := a.rawWithHeader(t, http.MethodOptions, "/api/admin/sales",
		http.Header{"Origin": {"http://localhost:5173"}, "Access-Control-Request-Method": {"POST"}}, nil)
	if pre.status != http.StatusNoContent {
		t.Fatalf("预检 → %d", pre.status)
	}
	// /api 下未匹配的路径必须回 JSON 404，而不是把 index.html 发出去。
	for _, p := range []string{"/api/nope", "/api/admin/nope", "/api/events/ETLIVE01/extra"} {
		r := a.do(t, http.MethodGet, p, "", nil)
		if r.status != http.StatusNotFound || r.code(t) != "not_found" {
			t.Fatalf("%s → %d %s", p, r.status, truncate(r.body))
		}
	}
	// 静态目录不存在时，根路径回 JSON 提示而不是 500 / 目录穿越。
	for _, p := range []string{"/", "/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd"} {
		r := a.do(t, http.MethodGet, p, "", nil)
		if r.status == http.StatusOK && bytes.Contains(r.body, []byte("root:")) {
			t.Fatalf("目录穿越成功：%s", p)
		}
		if bytes.Contains(r.body, []byte("/etc/passwd")) {
			t.Fatalf("响应泄漏系统路径：%s", truncate(r.body))
		}
	}
}

// 统计接口必须自带对账结论，且 issues 永远是数组而非 null（前端直接 .length）。
func TestStatsIdentityContract(t *testing.T) {
	a := newApp(t, testToken)
	r := a.do(t, http.MethodGet, "/api/stats?days=7", "", nil)
	m := r.decode(t)
	if m["identity_ok"] != true {
		t.Fatalf("种子自检未通过：%v", m["identity_issues"])
	}
	issues, ok := m["identity_issues"].([]any)
	if !ok {
		t.Fatalf("identity_issues 不是数组：%T", m["identity_issues"])
	}
	if len(issues) != 0 {
		t.Fatalf("identity_issues 非空：%v", issues)
	}
	for _, k := range []string{"gross_cent", "net_cent", "fee_cent", "refund_cent", "retained_cent",
		"tickets_issued", "active_now", "daily", "by_channel", "identity_note"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("统计缺少 %q", k)
		}
	}
	days, _ := m["window"].(string)
	if !strings.Contains(days, "7") {
		t.Fatalf("window = %q", days)
	}
	// 金额恒等式：毛额 - 退款 == 净额。
	gross, _ := m["gross_cent"].(float64)
	net, _ := m["net_cent"].(float64)
	ref, _ := m["refund_cent"].(float64)
	if gross-ref != net {
		t.Fatalf("恒等式失败：%v - %v ≠ %v", gross, ref, net)
	}
	// 非法 days 不能 500，且窗口要回显夹取后的值。
	bad := a.do(t, http.MethodGet, "/api/stats?days=abc", "", nil)
	if bad.status != http.StatusOK {
		t.Fatalf("days=abc → %d", bad.status)
	}
}

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

// ---- 小工具 ----

func toMap(t *testing.T, v any) map[string]any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("%v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("%v", err)
	}
	return m
}

func withField(t *testing.T, v any, k string, val any) map[string]any {
	t.Helper()
	m := toMap(t, v)
	m[k] = val
	return m
}

func truncate(b []byte) string {
	s := string(b)
	if len(s) > 240 {
		return s[:240] + "…"
	}
	return s
}
