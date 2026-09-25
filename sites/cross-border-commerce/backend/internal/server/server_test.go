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

func TestAdminProductAuthMatrix(t *testing.T) {
	r, _ := setup(t)
	newBody := func(code string) string {
		return `{"sku":"` + code + `","name":"上新测试品","category":"消费电子","brand":"测试牌",` +
			`"price_cents":2999,"stock":10,"weight_g":200,"hs_code":"8517.62","origin":"中国·深圳",` +
			`"lead_min_days":1,"lead_max_days":3}`
	}
	cases := []struct {
		name   string
		token  string
		code   string
		want   int
		wantFn func(*testing.T, *httptest.ResponseRecorder)
	}{
		{"缺少 Authorization 头 → 401", "", "auth_missing", 401, func(t *testing.T, w *httptest.ResponseRecorder) {
			var b map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &b)
			if b["code"] != "unauthorized" {
				t.Errorf("code=%v", b["code"])
			}
		}},
		{"令牌错误 → 403", "Bearer wrong-wrong", "auth_wrong", 403, nil},
		{"缺少 Bearer 前缀 → 401", testToken, "auth_no_prefix", 401, nil},
		{"Bearer 大小写混用仍可通过", "BeArEr " + testToken, "auth_mixed_case", 201, nil},
		{"只有 Bearer 前缀没有令牌 → 401", "Bearer ", "auth_empty", 401, nil},
		{"Basic 方案 → 401", "Basic " + testToken, "auth_basic", 401, nil},
		{"正确令牌 → 201 且响应回显商品", "Bearer " + testToken, "auth_ok", 201, func(t *testing.T, w *httptest.ResponseRecorder) {
			var p domain.Product
			if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
				t.Fatal(err)
			}
			if p.ID == 0 || p.SKU != "auth_ok" || !p.Listed {
				t.Errorf("响应商品不正确：%+v", p)
			}
		}},
		{"重复 SKU → 409", "Bearer " + testToken, "auth_ok", 409, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := do(r, http.MethodPost, "/api/admin/products", tc.token, newBody(tc.code))
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
	w := do(r, http.MethodPost, "/api/admin/products", "Bearer anything", `{"sku":"zz","name":"x"}`)
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
		{"非法 JSON 请求体", http.MethodPost, "/api/admin/products", "Bearer " + testToken, `{"sku":`, 400},
		{"不存在的商品", http.MethodGet, "/api/products/CB-ZZZ-9999", "", "", 404},
		{"SQL 片段路径参数", http.MethodGet, "/api/products/1'%20OR%20'1'='1", "", "", 404},
		{"不存在的接口", http.MethodGet, "/api/nope", "", "", 404},
		{"加购数量越界", http.MethodPost, "/api/cart/items", "", `{"sku":"CB-EL-0001","qty":1000}`, 400},
		{"加购不存在 SKU", http.MethodPost, "/api/cart/items", "", `{"sku":"CB-NO-0000","qty":1}`, 404},
		{"加购零库存 409", http.MethodPost, "/api/cart/items", "", `{"sku":"CB-EL-0004","qty":1}`, 409},
		{"未知目的国", http.MethodGet, "/api/cart?region=XX", "", "", 400},
		{"上新字段全错", http.MethodPost, "/api/admin/products", "Bearer " + testToken,
			`{"sku":"ab","name":"灯","category":"军火","price_cents":0,"stock":-1,"weight_g":0,"hs_code":"x1","lead_min_days":5,"lead_max_days":2}`, 400},
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
			if tc.want == 400 && tc.name == "上新字段全错" {
				f, ok := b["fields"].(map[string]any)
				if !ok || len(f) < 5 {
					t.Errorf("应逐字段回显校验错误：%s", body)
				}
			}
		})
	}
}

func TestPublicEndpointsShape(t *testing.T) {
	r, _ := setup(t)

	w := do(r, http.MethodGet, "/api/products?page_size=3", "", "")
	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var list struct {
		Items    []domain.ProductRow `json:"items"`
		Total    int64               `json:"total"`
		PageSize int                 `json:"page_size"`
		Sort     string              `json:"sort"`
		ServedAt string              `json:"served_at"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != 3 || list.PageSize != 3 || list.Total != 18 {
		t.Fatalf("分页响应不正确：%+v", list)
	}
	// 默认按 30 天销量降序
	for i := 1; i < len(list.Items); i++ {
		if list.Items[i-1].Sold30 < list.Items[i].Sold30 {
			t.Fatalf("销量降序失效：%+v", list.Items)
		}
	}

	w = do(r, http.MethodGet, "/api/products/CB-HM-0011", "", "")
	var detail struct {
		Product domain.ProductRow    `json:"product"`
		Stats   domain.ReviewSummary `json:"stats"`
		Reviews []domain.Review      `json:"reviews"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Product.SKU != "CB-HM-0011" || detail.Stats.Count < 3 || len(detail.Reviews) == 0 {
		t.Fatalf("详情不正确：%s", w.Body.String())
	}
	if detail.Stats.Count != detail.Product.ReviewCnt {
		t.Fatalf("详情两路口径不一致：%d vs %d", detail.Stats.Count, detail.Product.ReviewCnt)
	}

	w = do(r, http.MethodGet, "/api/cart?region=jp", "", "")
	var cart domain.CartView
	if err := json.Unmarshal(w.Body.Bytes(), &cart); err != nil {
		t.Fatal(err)
	}
	if len(cart.Lines) != 3 || cart.Region != "JP" || len(cart.Totals) != len(domain.Regions) {
		t.Fatalf("购物车回显不正确：%s", w.Body.String())
	}
	// 总价 = 货值 + 运费 + 关税 恒等
	var goods int64
	for _, l := range cart.Lines {
		goods += l.LineCents
	}
	for _, tot := range cart.Totals {
		if tot.GoodsCents != goods {
			t.Fatalf("%s 货值不一致：%d vs %d", tot.Code, tot.GoodsCents, goods)
		}
		if tot.TotalCents != tot.GoodsCents+tot.FreightCents+tot.DutyCents {
			t.Fatalf("%s 总价恒等式破裂：%+v", tot.Code, tot)
		}
	}

	// 加购 → 行覆盖 → 移出，全程回显购物车
	w = do(r, http.MethodPost, "/api/cart/items", "", `{"sku":"CB-OU-0023","qty":2}`)
	if err := json.Unmarshal(w.Body.Bytes(), &cart); err != nil {
		t.Fatal(err)
	}
	if len(cart.Lines) != 4 {
		t.Fatalf("加购后应 4 行，实得 %d", len(cart.Lines))
	}
	w = do(r, http.MethodPost, "/api/cart/items", "", `{"sku":"CB-OU-0023","qty":0}`)
	if err := json.Unmarshal(w.Body.Bytes(), &cart); err != nil {
		t.Fatal(err)
	}
	if len(cart.Lines) != 3 {
		t.Fatalf("qty=0 应移除行，实得 %d", len(cart.Lines))
	}

	w = do(r, http.MethodGet, "/api/meta", "", "")
	var meta struct {
		Categories []string        `json:"categories"`
		Regions    []domain.Region `json:"regions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &meta); err != nil {
		t.Fatal(err)
	}
	if len(meta.Categories) != 5 || len(meta.Regions) != 5 {
		t.Fatalf("meta 不完整：%s", w.Body.String())
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
