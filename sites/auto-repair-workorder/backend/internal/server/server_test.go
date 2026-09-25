package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"autoshop/internal/domain"
	"autoshop/internal/handler"
	"autoshop/internal/repository"
	"autoshop/internal/server"
	"autoshop/internal/service"
)

const testToken = "smoke-admin-token"

func newServer(t *testing.T, adminToken string) *httptest.Server {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("打开数据库失败: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(t.Context(), time.Now().UTC()); err != nil {
		t.Fatalf("灌种子失败: %v", err)
	}
	srv := httptest.NewServer(server.Router(handler.New(service.New(repo)), adminToken))
	t.Cleanup(srv.Close)
	return srv
}

type reply struct {
	status int
	body   string
	header http.Header
}

func (r reply) json(t *testing.T) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(r.body), &m); err != nil {
		t.Fatalf("响应不是 JSON（%d）：%s", r.status, r.clip())
	}
	return m
}

func (r reply) clip() string {
	if len(r.body) > 200 {
		return r.body[:200] + "…"
	}
	return r.body
}

func call(t *testing.T, method, url string, body any, auth string) reply {
	t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("序列化请求体失败: %v", err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatalf("构造请求失败: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("读响应失败: %v", err)
	}
	return reply{status: resp.StatusCode, body: string(data), header: resp.Header}
}

// rawCall 发任意字节，用来测坏 JSON 与超限请求体。
func rawCall(t *testing.T, method, url string, body []byte, auth string) reply {
	t.Helper()
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("构造请求失败: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return reply{status: resp.StatusCode, body: string(data), header: resp.Header}
}

func orderInput() domain.CreateOrderInput {
	return domain.CreateOrderInput{
		PlateNo: "沪A·12345", Model: "测试车 1.5T", CustomerName: "张三", Phone: "13800001111",
		MileageKm: 12000, Symptom: "冷启动异响", Priority: domain.PriorityNormal, Technician: "顾问甲",
	}
}

// ---------- 鉴权矩阵 ----------

func TestAdminAuthMatrix(t *testing.T) {
	body := domain.ReceiptInput{
		PartCode: "FL-OIL-01", LotNo: "LOT-AUTH-1", Qty: 5, UnitCostCents: 3000, Supplier: "测试供应商",
	}

	// 服务端没配令牌：必须 503，绝不能因为「期望值为空」就把 Bearer 空串当成合法凭证。
	misCfg := newServer(t, "")
	for _, ep := range []struct{ method, path string }{
		{http.MethodPost, "/api/admin/work-orders"},
		{http.MethodPost, "/api/admin/receipts"},
		{http.MethodPost, "/api/admin/work-orders/WO-1/transition"},
		{http.MethodPost, "/api/admin/work-orders/WO-1/lines"},
	} {
		r := call(t, ep.method, misCfg.URL+ep.path, body, "Bearer "+testToken)
		if r.status != http.StatusServiceUnavailable {
			t.Errorf("未配置令牌时 %s 得 %d，期望 503：%s", ep.path, r.status, r.clip())
			continue
		}
		if code := r.json(t)["code"]; code != "server_misconfigured" {
			t.Errorf("未配置令牌时 %s 错误码 %v", ep.path, code)
		}
	}

	srv := newServer(t, testToken)
	for _, tc := range []struct {
		name, auth string
		want       int
		wantCode   string
	}{
		{"缺失 Authorization", "", http.StatusUnauthorized, "unauthorized"},
		{"只有 Bearer 前缀", "Bearer ", http.StatusUnauthorized, "unauthorized"},
		{"方案不是 Bearer", "Basic " + testToken, http.StatusUnauthorized, "unauthorized"},
		{"裸令牌无前缀", testToken, http.StatusUnauthorized, "unauthorized"},
		{"空 Authorization 头", "Bearer   ", http.StatusUnauthorized, "unauthorized"},
		{"令牌不匹配", "Bearer wrong-token", http.StatusForbidden, "forbidden"},
		{"令牌前缀子串", "Bearer " + testToken + "x", http.StatusForbidden, "forbidden"},
		{"令牌正确", "Bearer " + testToken, http.StatusCreated, ""},
	} {
		r := call(t, http.MethodPost, srv.URL+"/api/admin/receipts", body, tc.auth)
		if r.status != tc.want {
			t.Errorf("%s：得 %d 期望 %d，响应 %s", tc.name, r.status, tc.want, r.clip())
			continue
		}
		if tc.wantCode != "" {
			if code := r.json(t)["code"]; code != tc.wantCode {
				t.Errorf("%s：错误码 %v，期望 %s", tc.name, code, tc.wantCode)
			}
		}
	}

	// 读接口不需要令牌，且写接口不能被 GET 绕过。
	if r := call(t, http.MethodGet, srv.URL+"/api/stats?days=7", nil, ""); r.status != http.StatusOK {
		t.Errorf("读接口应放行，得 %d：%s", r.status, r.clip())
	}
	if r := call(t, http.MethodGet, srv.URL+"/api/admin/receipts", nil, ""); r.status != http.StatusNotFound {
		t.Errorf("GET /api/admin/receipts 应 404，得 %d", r.status)
	}
}

// ---------- CORS 与安全响应头 ----------

func TestCorsAndSecurityHeaders(t *testing.T) {
	srv := newServer(t, testToken)
	for _, tc := range []struct {
		origin string
		allow  bool
	}{
		{"http://127.0.0.1:5173", true},
		{"http://localhost:3000", true},
		{"http://localhost.evil.com", false},
		{"http://127.0.0.1.evil.com", false},
		{"https://evil.com", false},
		{"null", false},
	} {
		req, err := http.NewRequest(http.MethodOptions, srv.URL+"/api/work-orders", nil)
		if err != nil {
			t.Fatalf("构造预检失败: %v", err)
		}
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("预检失败: %v", err)
		}
		resp.Body.Close()
		got := resp.Header.Get("Access-Control-Allow-Origin")
		if tc.allow && got != tc.origin {
			t.Errorf("本机来源 %s 未放行：ACAO=%q", tc.origin, got)
		}
		if !tc.allow && got != "" {
			t.Errorf("外部来源 %s 被放行：ACAO=%q", tc.origin, got)
		}
	}

	r := call(t, http.MethodGet, srv.URL+"/api/parts", nil, "")
	for _, h := range []string{"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"} {
		if r.header.Get(h) == "" {
			t.Errorf("缺少安全响应头 %s", h)
		}
	}
	if got := r.header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("API 应 no-store，得 %q", got)
	}
}

// ---------- 读接口 ----------

func TestReadEndpointsServeSeededData(t *testing.T) {
	srv := newServer(t, testToken)

	r := call(t, http.MethodGet, srv.URL+"/api/health", nil, "")
	if r.status != http.StatusOK || r.json(t)["status"] != "ok" {
		t.Fatalf("健康检查异常：%d %s", r.status, r.clip())
	}

	for _, path := range []string{"/api/work-orders", "/api/parts"} {
		r := call(t, http.MethodGet, srv.URL+path, nil, "")
		if r.status != http.StatusOK {
			t.Fatalf("%s 得 %d：%s", path, r.status, r.clip())
		}
		m := r.json(t)
		items, ok := m["items"].([]any)
		if !ok {
			t.Fatalf("%s 响应缺 items 数组：%s", path, r.clip())
		}
		if len(items) == 0 || m["total"].(float64) == 0 {
			t.Errorf("%s 返回空列表，种子没生效？", path)
		}
		if float64(len(items)) > m["total"].(float64) {
			t.Errorf("%s 页内条数 %d 超过 total %v", path, len(items), m["total"])
		}
	}

	// 过滤与搜索条件必须真的可用：这两条都是本仓踩过的 SQL 拼接回归点。
	for _, q := range []string{"status=open", "status=awaiting_parts", "priority=urgent", "q=%",
		"sort=no&dir=desc", "page=2&page_size=5"} {
		r := call(t, http.MethodGet, srv.URL+"/api/work-orders?"+q, nil, "")
		if r.status != http.StatusOK {
			t.Errorf("?%s 得 %d：%s", q, r.status, r.clip())
			continue
		}
		if _, ok := r.json(t)["items"].([]any); !ok {
			t.Errorf("?%s 响应缺 items", q)
		}
	}
	for _, q := range []string{"category=filter", "stock=low", "stock=out", "status=discontinued",
		"q=%", "sort=onhand&dir=desc", "page_size=99999"} {
		r := call(t, http.MethodGet, srv.URL+"/api/parts?"+q, nil, "")
		if r.status != http.StatusOK {
			t.Errorf("parts?%s 得 %d：%s", q, r.status, r.clip())
		}
	}

	// 搜索框里的注入串：必须走 LIKE 转义（200 + 0 命中），而不是变成 SQL 语法错误。
	for _, inj := range []string{"'; DROP TABLE work_orders;--", "' OR '1'='1", `%_\"`, "OPEN OR 1=1"} {
		v := url.Values{"q": {inj}}
		r := call(t, http.MethodGet, srv.URL+"/api/work-orders?"+v.Encode(), nil, "")
		if r.status != http.StatusOK {
			t.Errorf("工单搜索 %q 得 %d：%s", inj, r.status, r.clip())
		} else if n := len(r.json(t)["items"].([]any)); n != 0 {
			t.Errorf("注入串 %q 命中 %d 行", inj, n)
		}
		if r := call(t, http.MethodGet, srv.URL+"/api/parts?"+v.Encode(), nil, ""); r.status != http.StatusOK {
			t.Errorf("配件搜索 %q 得 %d：%s", inj, r.status, r.clip())
		}
	}

	// page_size 必须被夹到上限内。
	r = call(t, http.MethodGet, srv.URL+"/api/parts?page_size=99999", nil, "")
	if ps := r.json(t)["page_size"].(float64); ps > domain.MaxPageSize {
		t.Errorf("page_size=%v 未被夹到 %d 以内", ps, domain.MaxPageSize)
	}

	// 工单详情：脱敏、派生字段、明细与流水齐备，且全响应找不到 11 位原始手机号。
	list := call(t, http.MethodGet, srv.URL+"/api/work-orders?status=open&page_size=1&sort=id", nil, "")
	items := list.json(t)["items"].([]any)
	if len(items) == 0 {
		t.Fatal("在制列表为空，种子没有可点的工单")
	}
	head := items[0].(map[string]any)
	no, _ := head["wo_no"].(string)
	d := call(t, http.MethodGet, srv.URL+"/api/work-orders/"+no, nil, "")
	if d.status != http.StatusOK {
		t.Fatalf("详情失败：%d %s", d.status, d.clip())
	}
	detail := d.json(t)
	if _, ok := detail["lines"].([]any); !ok {
		t.Errorf("详情缺 lines：%s", d.clip())
	}
	if _, ok := detail["moves"].([]any); !ok {
		t.Errorf("详情缺 moves：%s", d.clip())
	}
	od := detail["order"].(map[string]any)
	if ns, ok := od["next_statuses"].([]any); !ok || len(ns) == 0 {
		t.Errorf("在制工单详情应带 next_statuses：%v", od)
	}
	if _, ok := od["customer_phone"]; ok {
		t.Error("详情泄漏了 customer_phone 字段")
	}
	if ph, _ := od["phone_masked"].(string); !strings.Contains(ph, "****") {
		t.Errorf("详情手机号未脱敏：%v", od["phone_masked"])
	}

	pd := call(t, http.MethodGet, srv.URL+"/api/parts/FL-OIL-01", nil, "")
	if pd.status != http.StatusOK {
		t.Fatalf("配件详情失败：%d %s", pd.status, pd.clip())
	}
	if _, ok := pd.json(t)["lots"].([]any); !ok {
		t.Errorf("配件详情缺 lots：%s", pd.clip())
	}

	// 不存在的资源与未匹配的 API 路径统一 JSON 404，绝不能是 500 或 Gin 的纯文本。
	for _, path := range []string{"/api/work-orders/WO-NOPE", "/api/parts/NO-PE", "/api/nope",
		"/api/work-orders/" + strings.Repeat("A", 60), "/api/parts/FL-OIL-01/extra"} {
		r := call(t, http.MethodGet, srv.URL+path, nil, "")
		if r.status != http.StatusNotFound {
			t.Errorf("%s 得 %d，期望 404：%s", path, r.status, r.clip())
			continue
		}
		if code := r.json(t)["code"]; code != "not_found" {
			t.Errorf("%s 错误码 %v，期望 not_found", path, code)
		}
	}

	// 统计必须把不变量对外公布且为绿。
	s := call(t, http.MethodGet, srv.URL+"/api/stats?days=30", nil, "")
	if s.status != http.StatusOK {
		t.Fatalf("统计失败：%d %s", s.status, s.clip())
	}
	st := s.json(t)
	for _, k := range []string{"stock_invariant_ok", "amount_invariant_ok"} {
		if st[k] != true {
			t.Errorf("%s 不为 true：%v", k, st[k])
		}
	}
	if v := st["identity_violations"].(float64); v != 0 {
		t.Errorf("identity_violations=%v，issues=%v", v, st["identity_issues"])
	}
	if trend, ok := st["trend"].([]any); !ok || len(trend) != 30 {
		t.Errorf("trend 点数不对，期望 30：%v", st["trend"])
	}
	if v, ok := st["promise_late"].(float64); !ok || v == 0 {
		t.Errorf("种子里应有逾期样本，实得 %v", st["promise_late"])
	}
}

// ---------- 写接口：字段校验 / 注入 / 超长 ----------

func TestWriteEndpointValidation(t *testing.T) {
	srv := newServer(t, testToken)
	auth := "Bearer " + testToken

	r := call(t, http.MethodPost, srv.URL+"/api/admin/work-orders", orderInput(), auth)
	if r.status != http.StatusCreated {
		t.Fatalf("合法建单得 %d：%s", r.status, r.clip())
	}
	created := r.json(t)["order"].(map[string]any)
	if created["phone_masked"] != "138****1111" {
		t.Errorf("建单响应手机号未脱敏：%v", created["phone_masked"])
	}
	if created["status"] != domain.WOReceived {
		t.Errorf("新单状态 %v", created["status"])
	}
	woNo, _ := created["wo_no"].(string)
	if !strings.HasPrefix(woNo, "WO-"+time.Now().UTC().Format("20060102")+"-") {
		t.Errorf("工单号形态异常：%q", woNo)
	}

	for _, tc := range []struct {
		name  string
		mut   func(*domain.CreateOrderInput)
		field string
	}{
		{"缺车牌", func(in *domain.CreateOrderInput) { in.PlateNo = "" }, "plate_no"},
		{"注入型车牌", func(in *domain.CreateOrderInput) { in.PlateNo = "沪A'; DROP TABLE work_orders;--" }, "plate_no"},
		{"XSS 型车型", func(in *domain.CreateOrderInput) { in.Model = "<script>alert(1)</script>" }, "model"},
		{"手机号非 11 位", func(in *domain.CreateOrderInput) { in.Phone = "1380000" }, "phone"},
		{"负里程", func(in *domain.CreateOrderInput) { in.MileageKm = -5 }, "mileage_km"},
		{"空白故障描述", func(in *domain.CreateOrderInput) { in.Symptom = "   " }, "symptom"},
		{"非法优先级", func(in *domain.CreateOrderInput) { in.Priority = "asap" }, "priority"},
		{"超长技师名", func(in *domain.CreateOrderInput) { in.Technician = strings.Repeat("顾", 60) }, "technician"},
		{"超长故障描述", func(in *domain.CreateOrderInput) { in.Symptom = strings.Repeat("异", 300) }, "symptom"},
	} {
		in := orderInput()
		tc.mut(&in)
		r := call(t, http.MethodPost, srv.URL+"/api/admin/work-orders", in, auth)
		if r.status != http.StatusBadRequest {
			t.Errorf("%s：得 %d 期望 400：%s", tc.name, r.status, r.clip())
			continue
		}
		m := r.json(t)
		if m["code"] != "invalid_request" {
			t.Errorf("%s：错误码 %v", tc.name, m["code"])
		}
		fields, ok := m["fields"].(map[string]any)
		if !ok || fields[tc.field] == nil {
			t.Errorf("%s：fields 缺 %q：%v", tc.name, tc.field, m["fields"])
		}
	}

	// 原始手机号绝不能从任何读接口回显。
	for _, u := range []string{"/api/work-orders?q=13800001111", "/api/work-orders/" + woNo, "/api/stats"} {
		if r := call(t, http.MethodGet, srv.URL+u, nil, ""); strings.Contains(r.body, "13800001111") {
			t.Errorf("%s 回显了原始手机号", u)
		}
	}

	// 坏 JSON 与超限请求体：都必须是干净的 JSON 错误，不能 500、不能回显驱动细节。
	r = rawCall(t, http.MethodPost, srv.URL+"/api/admin/work-orders", []byte(`{"plate_no":"沪A·1"`), auth)
	if r.status != http.StatusBadRequest {
		t.Errorf("坏 JSON 得 %d：%s", r.status, r.clip())
	}
	if r.json(t)["code"] != "invalid_request" {
		t.Errorf("坏 JSON 错误码异常：%s", r.clip())
	}
	r = rawCall(t, http.MethodPost, srv.URL+"/api/admin/work-orders",
		[]byte(`{"plate_no":"沪A·1","symptom":"`+strings.Repeat("A", 200_000)+`"}`), auth)
	if r.status != http.StatusRequestEntityTooLarge {
		t.Errorf("超限请求体得 %d，期望 413：%s", r.status, r.clip())
	}
	if code := r.json(t)["code"]; code != "body_too_large" {
		t.Errorf("超限请求体错误码 %v", code)
	}

	// 建单成功后库里必须真的能查到，且列表里也找得回。
	if r := call(t, http.MethodGet, srv.URL+"/api/work-orders/"+woNo, nil, ""); r.status != http.StatusOK {
		t.Errorf("刚建的单读不回：%d %s", r.status, r.clip())
	}
}

func TestLineAndReceiptEndpoints(t *testing.T) {
	srv := newServer(t, testToken)
	auth := "Bearer " + testToken

	created := call(t, http.MethodPost, srv.URL+"/api/admin/work-orders", orderInput(), auth)
	woNo := created.json(t)["order"].(map[string]any)["wo_no"].(string)
	linesURL := srv.URL + "/api/admin/work-orders/" + woNo + "/lines"

	// 工单号非法（含注入字符）必须是 404，不是 500。
	for _, bad := range []string{"'; DROP", strings.Repeat("X", 40), "WO-NOPE"} {
		r := call(t, http.MethodPost, srv.URL+"/api/admin/work-orders/"+bad+"/lines",
			domain.AddLineInput{Kind: domain.LineLabor, Operation: "试工", Grade: domain.GradeMiddle, DurationMin: 30}, auth)
		if r.status != http.StatusNotFound {
			t.Errorf("非法工单号 %q 得 %d，期望 404：%s", bad, r.status, r.clip())
		}
	}

	for _, tc := range []struct {
		name string
		in   domain.AddLineInput
	}{
		{"未知行类型", domain.AddLineInput{Kind: "extra", Qty: 1}},
		{"工时缺项目", domain.AddLineInput{Kind: domain.LineLabor, Grade: domain.GradeMiddle, DurationMin: 30}},
		{"非法等级", domain.AddLineInput{Kind: domain.LineLabor, Operation: "换机油", Grade: "grandmaster", DurationMin: 30}},
		{"工时越界", domain.AddLineInput{Kind: domain.LineLabor, Operation: "换机油", Grade: domain.GradeMiddle, DurationMin: 99999}},
		{"注入型配件码", domain.AddLineInput{Kind: domain.LinePart, PartCode: "FL-OIL-01' OR '1'='1", Qty: 1}},
		{"数量为零", domain.AddLineInput{Kind: domain.LinePart, PartCode: "FL-OIL-01", Qty: 0}},
	} {
		r := call(t, http.MethodPost, linesURL, tc.in, auth)
		if r.status != http.StatusBadRequest {
			t.Errorf("%s：得 %d 期望 400：%s", tc.name, r.status, r.clip())
		}
	}

	// 缺件必须整单回滚并给出 409。
	r := call(t, http.MethodPost, linesURL, domain.AddLineInput{
		Kind: domain.LinePart, PartCode: "FL-OIL-01", Qty: 999, Note: "不可能的量",
	}, auth)
	if r.status != http.StatusConflict {
		t.Errorf("缺件得 %d 期望 409：%s", r.status, r.clip())
	}
	if code := r.json(t)["code"]; code != "insufficient_stock" {
		t.Errorf("缺件错误码 %v", code)
	}

	r = call(t, http.MethodPost, linesURL, domain.AddLineInput{
		Kind: domain.LineLabor, Operation: "更换机油机滤", Grade: domain.GradeMiddle, DurationMin: 90,
	}, auth)
	if r.status != http.StatusCreated {
		t.Fatalf("加工时行得 %d：%s", r.status, r.clip())
	}
	line := r.json(t)["line"].(map[string]any)
	if want := domain.LaborAmount(90, domain.GradeMiddle); line["amount_cents"].(float64) != float64(want) {
		t.Errorf("工时行金额 %v != 算尺 %d", line["amount_cents"], want)
	}
	r = call(t, http.MethodPost, linesURL, domain.AddLineInput{
		Kind: domain.LinePart, PartCode: "FL-OIL-01", Qty: 2, Note: "机滤两只",
	}, auth)
	if r.status != http.StatusCreated {
		t.Fatalf("出库行得 %d：%s", r.status, r.clip())
	}

	// 入库：合法批次建批 + 重复批次号 409 + 停用件 409 + 不存在件 404。
	ok := call(t, http.MethodPost, srv.URL+"/api/admin/receipts", domain.ReceiptInput{
		PartCode: "FL-OIL-01", LotNo: "LOT-SMOKE-1", Qty: 40, UnitCostCents: 3100, Supplier: "测试供应商",
	}, auth)
	if ok.status != http.StatusCreated {
		t.Fatalf("合法入库得 %d：%s", ok.status, ok.clip())
	}
	lot := ok.json(t)["lot"].(map[string]any)
	if lot["lot_no"] != "LOT-SMOKE-1" || lot["qty_remaining"].(float64) != 40 {
		t.Errorf("入库批次回显异常：%v", lot)
	}
	dup := call(t, http.MethodPost, srv.URL+"/api/admin/receipts", domain.ReceiptInput{
		PartCode: "FL-OIL-01", LotNo: "LOT-SMOKE-1", Qty: 5, UnitCostCents: 3100, Supplier: "测试供应商",
	}, auth)
	if dup.status != http.StatusConflict {
		t.Errorf("重复批次号得 %d 期望 409：%s", dup.status, dup.clip())
	}
	for _, tc := range []struct {
		name string
		in   domain.ReceiptInput
		want int
		code string
	}{
		{"有效期格式错", domain.ReceiptInput{PartCode: "FL-OIL-01", LotNo: "LOT-SMOKE-2", Qty: 5,
			UnitCostCents: 3100, Supplier: "测试供应商", ExpiresOn: "2028/01/01"}, http.StatusBadRequest, "invalid_request"},
		{"件不存在", domain.ReceiptInput{PartCode: "NO-PE", LotNo: "LOT-SMOKE-3", Qty: 5,
			UnitCostCents: 3100, Supplier: "测试供应商"}, http.StatusNotFound, "not_found"},
		{"批次号注入", domain.ReceiptInput{PartCode: "FL-OIL-01", LotNo: "LOT'; DROP--", Qty: 5,
			UnitCostCents: 3100, Supplier: "测试供应商"}, http.StatusBadRequest, "invalid_request"},
	} {
		r := call(t, http.MethodPost, srv.URL+"/api/admin/receipts", tc.in, auth)
		if r.status != tc.want {
			t.Errorf("%s：得 %d 期望 %d：%s", tc.name, r.status, tc.want, r.clip())
			continue
		}
		if code := r.json(t)["code"]; code != tc.code {
			t.Errorf("%s：错误码 %v 期望 %s", tc.name, code, tc.code)
		}
	}
}

func TestTransitionFlowAndLocks(t *testing.T) {
	srv := newServer(t, testToken)
	auth := "Bearer " + testToken
	created := call(t, http.MethodPost, srv.URL+"/api/admin/work-orders", orderInput(), auth)
	woNo := created.json(t)["order"].(map[string]any)["wo_no"].(string)
	tURL := srv.URL + "/api/admin/work-orders/" + woNo + "/transition"
	linesURL := srv.URL + "/api/admin/work-orders/" + woNo + "/lines"

	// 非法目标状态：400（不在状态机内）；合法但不可达：409。
	r := call(t, http.MethodPost, tURL, domain.TransitionInput{To: "reopened"}, auth)
	if r.status != http.StatusBadRequest {
		t.Errorf("未知状态得 %d 期望 400：%s", r.status, r.clip())
	}
	r = call(t, http.MethodPost, tURL, domain.TransitionInput{To: domain.WOSettled}, auth)
	if r.status != http.StatusConflict {
		t.Errorf("非法跃迁得 %d 期望 409：%s", r.status, r.clip())
	}
	if code := r.json(t)["code"]; code != "invalid_transition" {
		t.Errorf("非法跃迁错误码 %v", code)
	}
	// 没有工时就想质检：状态机允许 diagnosed→qc，但 received→qc 先被状态机挡下。
	r = call(t, http.MethodPost, tURL, domain.TransitionInput{To: domain.WOQc}, auth)
	if r.status != http.StatusConflict {
		t.Errorf("接车直接质检应 409，得 %d：%s", r.status, r.clip())
	}

	for _, to := range []string{domain.WODiagnosed, domain.WORepairing, domain.WOQc} {
		if to == domain.WOQc {
			// 质检前必须有工时行，否则 no_labor。
			r = call(t, http.MethodPost, tURL, domain.TransitionInput{To: to}, auth)
			if r.status != http.StatusConflict || r.json(t)["code"] != "no_labor" {
				t.Fatalf("无工时质检得 %d %s，期望 409 no_labor", r.status, r.clip())
			}
			if rr := call(t, http.MethodPost, linesURL, domain.AddLineInput{
				Kind: domain.LineLabor, Operation: "检查刹车片", Grade: domain.GradeJunior, DurationMin: 45,
			}, auth); rr.status != http.StatusCreated {
				t.Fatalf("加工时行得 %d：%s", rr.status, rr.clip())
			}
		}
		r = call(t, http.MethodPost, tURL, domain.TransitionInput{To: to}, auth)
		if r.status != http.StatusOK {
			t.Fatalf("推进到 %s 得 %d：%s", to, r.status, r.clip())
		}
		if got := r.json(t)["order"].(map[string]any)["status"]; got != to {
			t.Errorf("跃迁后状态 %v，期望 %s", got, to)
		}
	}

	// 质检之后明细锁定。
	r = call(t, http.MethodPost, linesURL, domain.AddLineInput{
		Kind: domain.LineLabor, Operation: "补加行", Grade: domain.GradeMiddle, DurationMin: 30,
	}, auth)
	if r.status != http.StatusConflict || r.json(t)["code"] != "lines_locked" {
		t.Errorf("质检后加行应 409 lines_locked，得 %d %s", r.status, r.clip())
	}

	// 结算：金额快照必须等于工时 + 配件，且对外公布的恒等式仍为绿。
	r = call(t, http.MethodPost, tURL, domain.TransitionInput{To: domain.WOSettled}, auth)
	if r.status != http.StatusOK {
		t.Fatalf("结算得 %d：%s", r.status, r.clip())
	}
	od := r.json(t)["order"].(map[string]any)
	labor, parts, grand := od["labor_total_cents"].(float64), od["parts_total_cents"].(float64), od["grand_total_cents"].(float64)
	if labor+parts != grand {
		t.Errorf("结算快照 %v+%v != %v", labor, parts, grand)
	}
	if grand != float64(domain.LaborAmount(45, domain.GradeJunior)) {
		t.Errorf("结算总额 %v != 工时算尺 %d", grand, domain.LaborAmount(45, domain.GradeJunior))
	}
	st := call(t, http.MethodGet, srv.URL+"/api/stats", nil, "").json(t)
	if st["amount_invariant_ok"] != true || st["stock_invariant_ok"] != true {
		t.Errorf("跃迁后不变量被破坏：%v", st["identity_issues"])
	}

	// 结算后作废必须被状态机挡住（钱已经收了）。
	r = call(t, http.MethodPost, tURL, domain.TransitionInput{To: domain.WOCancelled, Reason: "反悔"}, auth)
	if r.status != http.StatusConflict {
		t.Errorf("结算后作废应 409，得 %d：%s", r.status, r.clip())
	}
}

// TestErrorBodiesNeverLeakInternals 是所有负向用例的共同底线：
// 任何 4xx/5xx 的响应体里都不能出现驱动/SQL/Gin 的原始报错文本。
func TestErrorBodiesNeverLeakInternals(t *testing.T) {
	srv := newServer(t, testToken)
	auth := "Bearer " + testToken
	for _, u := range []string{
		"/api/work-orders/WO-NOPE", "/api/parts/NO-PE", "/api/nope",
		"/api/work-orders?" + url.Values{"q": {"'; DROP TABLE parts;--"}}.Encode(), "/api/stats?days=abc",
	} {
		if r := call(t, http.MethodGet, srv.URL+u, nil, ""); r.status >= 500 {
			t.Errorf("%s 打成 %d：%s", u, r.status, r.clip())
		}
	}
	probes := []struct{ method, path, auth string }{
		{http.MethodPost, "/api/admin/work-orders", "Bearer nope"},
		{http.MethodPost, "/api/admin/work-orders", auth},
		{http.MethodGet, "/api/admin/work-orders", auth},
		{http.MethodPost, "/api/admin/receipts", ""},
	}
	for _, p := range probes {
		body := any(map[string]any{"plate_no": "沪A·1"})
		if p.path == "/api/admin/receipts" {
			body = domain.ReceiptInput{PartCode: "FL-OIL-01"}
		}
		r := call(t, p.method, srv.URL+p.path, body, p.auth)
		for _, leak := range []string{"SQL logic", "near \"", "GORM", "gorm", "no such column",
			"panic", "runtime error", "err:", "Error 1"} {
			if strings.Contains(r.body, leak) {
				t.Errorf("%s %s 泄漏了内部报错 %q：%s", p.method, p.path, leak, r.clip())
			}
		}
		if r.status >= 400 && r.json(t)["message"] == "" {
			t.Errorf("%s %s 的错误响应没有 message", p.method, p.path)
		}
	}
}
