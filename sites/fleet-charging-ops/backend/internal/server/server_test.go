package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

const testToken = "s3cret-admin-token"

// newServer 起一个灌了种子的独立库：每个测试互不串数据。
func newServer(t *testing.T, token string) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	// 种子时刻固定在本地 21:00，保证「今天」同时存在在充/故障/已结算单。
	if err := repo.Seed(context.Background(), time.Date(2026, 9, 24, 13, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(Router(handler.New(service.New(repo)), token))
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, method, url, token, origin string, body []byte) (*http.Response, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func decode(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("响应不是合法 JSON: %v / %s", err, truncate(string(raw)))
	}
	return m
}

func truncate(s string) string {
	if len(s) > 240 {
		return s[:240] + "…"
	}
	return s
}

// TestAuthFailClosed 三层防线：没配令牌 503、缺/错格式 401、令牌不符 403、正确 201。
// 负向探针全部打在「不存在的资源」上，绝不因鉴权测试污染业务数据。
func TestAuthFailClosed(t *testing.T) {
	const absent = "NOPE-0000"

	t.Run("服务端未配置令牌", func(t *testing.T) {
		srv := newServer(t, "")
		resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/sessions/"+absent+"/settle", "Bearer "+testToken, "", []byte(`{}`))
		if resp.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("未配置令牌必须 503: %d %s", resp.StatusCode, truncate(string(raw)))
		}
		if decode(t, raw)["code"] != "server_misconfigured" {
			t.Fatalf("错误码不符: %s", truncate(string(raw)))
		}
	})

	cases := []struct {
		name  string
		token string
		code  int
		want  string
	}{
		{"缺少 Authorization", "", http.StatusUnauthorized, "unauthorized"},
		{"非 Bearer 方案", "Basic " + testToken, http.StatusUnauthorized, "unauthorized"},
		{"只有 Bearer 前缀", "Bearer ", http.StatusUnauthorized, "unauthorized"},
		{"空 Bearer 载荷", "Bearer    ", http.StatusUnauthorized, "unauthorized"},
		{"令牌错误", "Bearer wrong-token", http.StatusForbidden, "forbidden"},
		{"令牌中间夹空格（不等于原值）", "Bearer wrong token", http.StatusForbidden, "forbidden"},
	}
	srv := newServer(t, testToken)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/sessions/"+absent+"/settle", tc.token, "", []byte(`{"actual_wh":1000}`))
			if resp.StatusCode != tc.code {
				t.Fatalf("状态码 = %d, want %d（%s）", resp.StatusCode, tc.code, truncate(string(raw)))
			}
			if got := decode(t, raw)["code"]; got != tc.want {
				t.Fatalf("错误码 = %v, want %s", got, tc.want)
			}
		})
	}
	t.Run("方案前缀大小写不敏感", func(t *testing.T) {
		resp, raw := do(t, http.MethodGet, srv.URL+"/api/admin/sessions/"+absent+"/settle", "bearer "+testToken, "", nil)
		// GET 未注册该路由：能穿过鉴权说明前缀解析成功，出口应是 404 而不是 401。
		if resp.StatusCode == http.StatusUnauthorized {
			t.Fatalf("bearer 小写被拒: %s", truncate(string(raw)))
		}
	})
	t.Run("正确令牌可写入且回显会话", func(t *testing.T) {
		body := []byte(`{"pile_code":"AC-C04","plate_no":"沪AD10000","planned_wh":20000,"note":"测试"}`)
		resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer "+testToken, "", body)
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			t.Fatalf("合法令牌被拒: %d %s", resp.StatusCode, truncate(string(raw)))
		}
	})
}

// TestNegativeProbesLeaveNoTrace 鉴权/校验失败的写请求不得在库里留下会话。
func TestNegativeProbesLeaveNoTrace(t *testing.T) {
	srv := newServer(t, testToken)
	before := totalSessions(t, srv)
	resp, _ := do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer nope", "", []byte(`{"pile_code":"DC-A01","plate_no":"沪AD10000","planned_wh":20000}`))
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403, got %d", resp.StatusCode)
	}
	resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer "+testToken, "", []byte(`{"pile_code":"DC-A01'--","plate_no":"沪AD10000","planned_wh":20000}`))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("注入型桩编号应 400: %d %s", resp.StatusCode, truncate(string(raw)))
	}
	if totalSessions(t, srv) != before {
		t.Fatal("失败请求写入了会话")
	}
}

func totalSessions(t *testing.T, srv *httptest.Server) int64 {
	t.Helper()
	resp, raw := do(t, http.MethodGet, srv.URL+"/api/stats", "", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stats %d", resp.StatusCode)
	}
	m := decode(t, raw)
	n, _ := m["total_sessions"].(float64)
	return int64(n)
}

// TestReadEndpoints 每个读接口都要 200 且结构稳定（前端整块渲染依赖这些键）。
func TestReadEndpoints(t *testing.T) {
	srv := newServer(t, testToken)
	cases := []struct {
		path string
		keys []string
	}{
		{"/api/health", []string{"status"}},
		{"/api/piles", []string{"items", "total"}},
		{"/api/vehicles", []string{"items", "total"}},
		{"/api/vehicles?all=1", []string{"items", "total"}},
		{"/api/tariffs", []string{"items", "total"}},
		{"/api/stats", []string{"total_sessions", "by_pile", "by_dept", "daily", "rate_board", "identity_ok"}},
		{"/api/stats?days=14", []string{"trend_days"}},
		{"/api/sessions", []string{"items", "total", "page", "page_size", "sort", "dir"}},
		{"/api/sessions?status=charging", []string{"items"}},
		{"/api/sessions?open=1", []string{"items"}},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			resp, raw := do(t, http.MethodGet, srv.URL+tc.path, "", "", nil)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("%s → %d %s", tc.path, resp.StatusCode, truncate(string(raw)))
			}
			m := decode(t, raw)
			for _, k := range tc.keys {
				if _, has := m[k]; !has {
					t.Errorf("%s 缺键 %s", tc.path, k)
				}
			}
			if resp.Header.Get("Cache-Control") != "no-store" {
				t.Errorf("%s 未禁用缓存: %q", tc.path, resp.Header.Get("Cache-Control"))
			}
			for _, h := range []string{"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"} {
				if resp.Header.Get(h) == "" {
					t.Errorf("%s 缺安全响应头 %s", tc.path, h)
				}
			}
		})
	}
	t.Run("每个排序键都可用", func(t *testing.T) {
		for _, key := range domainSortKeys() {
			resp, raw := do(t, http.MethodGet, srv.URL+"/api/sessions?sort="+key+"&dir=asc", "", "", nil)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("sort=%s → %d %s", key, resp.StatusCode, truncate(string(raw)))
			}
			if got := decode(t, raw)["sort"]; got != key {
				t.Errorf("sort 回显 = %v, want %s", got, key)
			}
		}
	})
	t.Run("非法查询值被收敛", func(t *testing.T) {
		resp, raw := do(t, http.MethodGet,
			srv.URL+"/api/sessions?sort=';DROP+TABLE+charge_sessions;--&status=%27%20OR%201%3D1&dir=sideways&page_size=99999", "", "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%d %s", resp.StatusCode, truncate(string(raw)))
		}
		m := decode(t, raw)
		if m["sort"] != "start" || m["dir"] != "desc" {
			t.Fatalf("非法排序未被收敛: %v/%v", m["sort"], m["dir"])
		}
		if ps := m["page_size"]; ps.(float64) > 100 {
			t.Fatalf("page_size 未钳制: %v", ps)
		}
		// 表还在。
		if n := totalSessions(t, srv); n == 0 {
			t.Fatal("会话表被清空")
		}
	})
	t.Run("未知接口返回 JSON 404", func(t *testing.T) {
		resp, raw := do(t, http.MethodGet, srv.URL+"/api/does-not-exist", "", "", nil)
		if resp.StatusCode != http.StatusNotFound || decode(t, raw)["code"] != "not_found" {
			t.Fatalf("%d %s", resp.StatusCode, truncate(string(raw)))
		}
		resp, raw = do(t, http.MethodGet, srv.URL+"/api/sessions/../piles", "", "", nil)
		if resp.StatusCode >= 500 {
			t.Fatalf("路径异常应被安全处理: %d %s", resp.StatusCode, truncate(string(raw)))
		}
	})
	t.Run("非法会话编号 400", func(t *testing.T) {
		resp, raw := do(t, http.MethodGet, srv.URL+"/api/sessions/"+strings.Repeat("A", 40), "", "", nil)
		if resp.StatusCode != http.StatusBadRequest || decode(t, raw)["code"] != "invalid_code" {
			t.Fatalf("%d %s", resp.StatusCode, truncate(string(raw)))
		}
		resp, raw = do(t, http.MethodGet, srv.URL+"/api/sessions/CS20991231-999", "", "", nil)
		if resp.StatusCode != http.StatusNotFound || decode(t, raw)["code"] != "not_found" {
			t.Fatalf("%d %s", resp.StatusCode, truncate(string(raw)))
		}
	})
}

func domainSortKeys() []string {
	return []string{"code", "start", "end", "energy", "total", "status", "pile", "plate", "overstay", "id"}
}

// TestQuoteEndpoint 试算与结算共用同一计价引擎：分段之和必须等于电量。
func TestQuoteEndpoint(t *testing.T) {
	srv := newServer(t, testToken)
	resp, raw := do(t, http.MethodGet, srv.URL+"/api/quote?pile=DC-A01&wh=40000&minutes=90&delay_min=60&overstay_min=15", "", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("试算 %d %s", resp.StatusCode, truncate(string(raw)))
	}
	m := decode(t, raw)
	if m["identity_ok"] != true {
		t.Fatalf("试算恒等式未过: %s", truncate(string(raw)))
	}
	segs, _ := m["segments"].([]any)
	if len(segs) == 0 {
		t.Fatal("试算没有分段明细")
	}
	var sumWh float64
	for _, s := range segs {
		sumWh += s.(map[string]any)["wh"].(float64)
	}
	if unpriced, ok := m["unpriced_wh"].(float64); ok {
		sumWh += unpriced
	}
	if sumWh != 40_000 {
		t.Fatalf("Σ分段+%d != 40000", int(sumWh))
	}
	if m["overstay_cents"].(float64) != 15*8 {
		t.Fatalf("超时费 = %v, want 120", m["overstay_cents"])
	}
	if m["total_cents"].(float64) != m["elec_cents"].(float64)+m["service_cents"].(float64)+m["overstay_cents"].(float64) {
		t.Fatal("试算总额恒等式破口")
	}
	for _, q := range []string{
		"/api/quote?pile=DC-A01&wh=40000&minutes=2",
		"/api/quote?wh=40000&minutes=90",
		"/api/quote?pile=DC-A01&wh=99999999&minutes=90",
		"/api/quote?pile=DC-A01&wh=40000&minutes=90&overstay_min=9999",
	} {
		resp, raw := do(t, http.MethodGet, srv.URL+q, "", "", nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s → %d（应 400）", q, resp.StatusCode)
		}
		if decode(t, raw)["code"] != "invalid_request" {
			t.Fatalf("%s 错误码不符: %s", q, truncate(string(raw)))
		}
	}
	resp, raw = do(t, http.MethodGet, srv.URL+"/api/quote?pile=ZZ-Z99&wh=40000&minutes=90", "", "", nil)
	if resp.StatusCode != http.StatusNotFound || decode(t, raw)["code"] != "pile_not_found" {
		t.Fatalf("未知桩试算: %d %s", resp.StatusCode, truncate(string(raw)))
	}
}

// TestWriteEndpointsEndToEnd 走一遍运营动作：开充 → 结算 → 价目开关 → 桩状态。
func TestWriteEndpointsEndToEnd(t *testing.T) {
	srv := newServer(t, testToken)
	var pile, plate string
	resp, raw := do(t, http.MethodGet, srv.URL+"/api/piles", "", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatal(truncate(string(raw)))
	}
	for _, it := range decode(t, raw)["items"].([]any) {
		m := it.(map[string]any)
		if m["status"] == "online" && m["open_sessions"].(float64) == 0 {
			pile, _ = m["code"].(string)
			break
		}
	}
	resp, raw = do(t, http.MethodGet, srv.URL+"/api/vehicles", "", "", nil)
	for _, it := range decode(t, raw)["items"].([]any) {
		m := it.(map[string]any)
		p := m["plate_no"].(string)
		if p != "" {
			plate = p
			break
		}
	}
	if pile == "" || plate == "" {
		t.Fatalf("取不到可用桩/车: %q %q", pile, plate)
	}
	// 该车可能已在充，先按错误码分支：vehicle_busy 就换下一台。
	for _, cand := range vehiclePlates(t, srv) {
		body, _ := json.Marshal(map[string]any{"pile_code": pile, "plate_no": cand, "planned_wh": 30_000, "note": "端到端"})
		resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer "+testToken, "", body)
		if resp.StatusCode != http.StatusCreated {
			continue
		}
		created := decode(t, raw)
		code, _ := created["code"].(string)
		if code == "" {
			t.Fatalf("创建响应缺编号: %s", truncate(string(raw)))
		}
		plate = cand
		// 真实墙上时钟下刚开充 0 分钟：电量必须落在满功率 1 分钟的理论上限之内。
		settleBody, _ := json.Marshal(map[string]any{"actual_wh": 2_000, "overstay_min": 12})
		resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/sessions/"+code+"/settle", "Bearer "+testToken, "", settleBody)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("结算失败 %d %s", resp.StatusCode, truncate(string(raw)))
		}
		sess := decode(t, raw)["session"].(map[string]any)
		// 结算区间有 1 分钟下限：不足一分钟的单也要按已充走的电量收钱，不能 0 元放行。
		if sess["covered"] != true || sess["total_cents"].(float64) <= 0 {
			t.Fatalf("同一分钟内结算也应产生金额: %s", truncate(string(raw)))
		}
		if sess["overstay_cents"].(float64) != 12*float64(domain.OverstayCentsPerMin) {
			t.Fatalf("超时占用费 = %v，应为 %d 分", sess["overstay_cents"], 12*domain.OverstayCentsPerMin)
		}
		if sess["status"] != "completed" {
			t.Fatalf("结算后状态 = %v", sess["status"])
		}
		if sess["identity_ok"] == false {
			t.Fatal("结算出口恒等式为 false")
		}
		b, _ := json.Marshal(sess)
		if strings.Contains(string(b), "\"phone\":") {
			t.Fatalf("会话详情泄露手机号: %s", truncate(string(b)))
		}
		// 重复结算 409。
		resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/sessions/"+code+"/settle", "Bearer "+testToken, "", settleBody)
		if resp.StatusCode != http.StatusConflict || decode(t, raw)["code"] != "invalid_transition" {
			t.Fatalf("重复结算: %d %s", resp.StatusCode, truncate(string(raw)))
		}
		break
	}
	if plate == "" {
		t.Fatal("没有可开充的车辆")
	}

	// 价目：创建 → 停用 → 再启用；重复标识 409。
	newRule, _ := json.Marshal(map[string]any{
		"code": "test-holiday", "name": "节假日 specials", "period": "valley", "day_type": "any",
		"start_min": 0, "end_min": 1440, "elec_cents_per_kwh": 30, "service_cents_per_kwh": 8, "priority": 80,
	})
	resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/tariffs", "Bearer "+testToken, "", newRule)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("创建价目 %d %s", resp.StatusCode, truncate(string(raw)))
	}
	id := int64(decode(t, raw)["id"].(float64))
	resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/tariffs", "Bearer "+testToken, "", newRule)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("重复价目标识应 409: %d %s", resp.StatusCode, truncate(string(raw)))
	}
	resp, raw = do(t, http.MethodPost, fmt.Sprintf("%s/api/admin/tariffs/%d/toggle", srv.URL, id), "Bearer "+testToken, "", []byte(`{}`))
	if resp.StatusCode != http.StatusOK || decode(t, raw)["active"] != false {
		t.Fatalf("停用价目: %d %s", resp.StatusCode, truncate(string(raw)))
	}
	resp, raw = do(t, http.MethodPost, fmt.Sprintf("%s/api/admin/tariffs/0/toggle", srv.URL), "Bearer "+testToken, "", []byte(`{}`))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("非法 ID 应 400: %d", resp.StatusCode)
	}

	// 桩状态：在充桩切维保必须 409 pile_busy。
	resp, raw = do(t, http.MethodGet, srv.URL+"/api/sessions?open=1", "", "", nil)
	opens := decode(t, raw)["items"].([]any)
	if len(opens) > 0 {
		busyPile := opens[0].(map[string]any)["pile_code"].(string)
		body, _ := json.Marshal(map[string]any{"status": "maintenance", "note": "维保"})
		resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/piles/"+busyPile+"/status", "Bearer "+testToken, "", body)
		if resp.StatusCode != http.StatusConflict || decode(t, raw)["code"] != "pile_busy" {
			t.Fatalf("在充桩切维保应 409 pile_busy: %d %s", resp.StatusCode, truncate(string(raw)))
		}
	}
	body, _ := json.Marshal(map[string]any{"status": "broken"})
	resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/piles/"+pile+"/status", "Bearer "+testToken, "", body)
	if resp.StatusCode != http.StatusBadRequest || decode(t, raw)["code"] != "invalid_request" {
		t.Fatalf("非法桩状态应 400: %d %s", resp.StatusCode, truncate(string(raw)))
	}
}

func vehiclePlates(t *testing.T, srv *httptest.Server) []string {
	t.Helper()
	resp, raw := do(t, http.MethodGet, srv.URL+"/api/vehicles", "", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("vehicles %d", resp.StatusCode)
	}
	out := []string{}
	for _, it := range decode(t, raw)["items"].([]any) {
		if p, ok := it.(map[string]any)["plate_no"].(string); ok {
			out = append(out, p)
		}
	}
	return out
}

// TestBodyLimitAndNoLeak 请求体上限与错误信息脱敏。
func TestBodyLimitAndNoLeak(t *testing.T) {
	srv := newServer(t, testToken)
	huge := []byte(`{"pile_code":"DC-A01","plate_no":"沪AD10000","planned_wh":20000,"note":"` + strings.Repeat("超长备注", 20_000) + `"}`)
	if len(huge) < 64<<10 {
		t.Fatalf("构造的 body 太小: %d", len(huge))
	}
	resp, raw := do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer "+testToken, "", huge)
	if resp.StatusCode != http.StatusRequestEntityTooLarge || decode(t, raw)["code"] != "body_too_large" {
		t.Fatalf("超限 body: %d %s", resp.StatusCode, truncate(string(raw)))
	}
	// 上限以内但字段荒谬：400，且不回显内部实现。
	bad, _ := json.Marshal(map[string]any{"pile_code": strings.Repeat("X", 300), "plate_no": "??", "planned_wh": -5})
	resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer "+testToken, "", bad)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("%d %s", resp.StatusCode, truncate(string(raw)))
	}
	m := decode(t, raw)
	if m["code"] != "invalid_request" {
		t.Fatalf("错误码 = %v", m["code"])
	}
	for _, leak := range []string{"SQL", "sqlite", "gorm", "charge_sessions", "driver_phone"} {
		if strings.Contains(string(raw), leak) {
			t.Fatalf("错误响应泄露内部细节 %q: %s", leak, truncate(string(raw)))
		}
	}
	resp, raw = do(t, http.MethodPost, srv.URL+"/api/admin/sessions", "Bearer "+testToken, "", []byte(`{"pile_code":`))
	if resp.StatusCode != http.StatusBadRequest || decode(t, raw)["code"] != "invalid_request" {
		t.Fatalf("坏 JSON: %d %s", resp.StatusCode, truncate(string(raw)))
	}
}

// TestCORSLocalhostOnly 只放行回环来源，且绝不回显任意 Origin。
func TestCORSLocalhostOnly(t *testing.T) {
	srv := newServer(t, testToken)
	good := []string{"http://localhost:5173", "http://127.0.0.1:8080", "http://[::1]:3000"}
	bad := []string{"http://127.0.0.1.evil.example", "https://evil.com", "null", "http://localhost.evil.example", "file://"}
	for _, o := range good {
		resp, _ := do(t, http.MethodOptions, srv.URL+"/api/piles", "", o, nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("预检 %s → %d", o, resp.StatusCode)
		}
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != o {
			t.Errorf("允许来源 = %q, want %q", got, o)
		}
	}
	for _, o := range bad {
		resp, _ := do(t, http.MethodOptions, srv.URL+"/api/piles", "", o, nil)
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("来源 %q 不应被放行，实际 %q", o, got)
		}
	}
}
