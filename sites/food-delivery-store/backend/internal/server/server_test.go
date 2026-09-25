package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/server"
	"bizsite/internal/service"
)

const testToken = "s3cret-admin-token"

func newTestServer(t *testing.T, token string) *httptest.Server {
	t.Helper()
	db, err := repository.Open(t.TempDir() + "/api.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), time.Now()); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	h := handler.New(service.New(repo))
	srv := httptest.NewServer(server.Router(h, token))
	t.Cleanup(srv.Close)
	return srv
}

func do(t *testing.T, method, url, token string, body any) (*http.Response, []byte) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := reqURL(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer res.Body.Close()
	all, _ := io.ReadAll(res.Body)
	return res, all
}

func reqURL(req *http.Request) (*http.Response, error) {
	c := &http.Client{Timeout: 5 * time.Second}
	return c.Do(req)
}

func decode(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("响应不是 JSON: %s", strings.TrimSpace(string(b)))
	}
	return m
}

func TestAdminAuthMatrix(t *testing.T) {
	srv := newTestServer(t, testToken)
	body := map[string]string{"to": "cooking"}
	cases := []struct {
		name  string
		token string
		want  int
	}{
		{"缺少 Authorization → 401", "", http.StatusUnauthorized},
		{"令牌错误 → 403", "wrong-token", http.StatusForbidden},
		{"令牌正确 → 200", testToken, http.StatusOK},
	}
	var placedID int64
	{
		res, b := do(t, http.MethodGet, srv.URL+"/api/orders?status=placed&page_size=1", "", nil)
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode)
		}
		items := decode(t, b)["items"].([]any)
		placedID = int64(items[0].(map[string]any)["id"].(float64))
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, b := do(t, http.MethodPost, srv.URL+"/api/orders", tc.token, nil)
			_ = res
			_ = b
			res, b = do(t, http.MethodPost,
				srv.URL+"/api/admin/orders/"+itoa(placedID)+"/status", tc.token, body)
			if res.StatusCode != tc.want {
				t.Fatalf("status=%d want=%d body=%s", res.StatusCode, tc.want, b)
			}
		})
		if tc.want == http.StatusOK {
			break // 正确令牌会把状态推进，后续用例换个新单再测
		}
	}
}

func TestAdminTokenNotConfiguredReturns503(t *testing.T) {
	srv := newTestServer(t, "")
	res, b := do(t, http.MethodPost, srv.URL+"/api/admin/orders/1/status", "anything",
		map[string]string{"to": "cooking"})
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("未配置 ADMIN_TOKEN 应 fail-closed 503，实际 %d %s", res.StatusCode, b)
	}
}

func goodOrder() map[string]any {
	return map[string]any{
		"recipient": "测试顾客",
		"phone":     "13900001111",
		"zone":      "near",
		"address":   "天府大道 500 号 1 栋 1 单元 101",
		"note":      "多加辣",
		"items":     []map[string]any{{"code": "HOT-011", "qty": 1}, {"code": "STP-034", "qty": 2}},
	}
}

func TestPublicPlaceOrder(t *testing.T) {
	srv := newTestServer(t, testToken)

	t.Run("合法下单 → 201 且金额恒等式与脱敏成立", func(t *testing.T) {
		res, b := do(t, http.MethodPost, srv.URL+"/api/orders", "", goodOrder())
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("status=%d body=%s", res.StatusCode, b)
		}
		m := decode(t, b)
		o := m["order"].(map[string]any)
		sub := int64(o["subtotal_cents"].(float64))
		fee := int64(o["delivery_fee_cents"].(float64))
		total := int64(o["total_cents"].(float64))
		if total != sub+fee {
			t.Fatalf("恒等式破裂 %d != %d + %d", total, sub, fee)
		}
		if sub != 2800+600 || fee != 0 || total != 3400 {
			t.Fatalf("金额算错: sub=%d fee=%d total=%d", sub, fee, total)
		}
		if o["masked_phone"] != "139****1111" {
			t.Fatalf("脱敏失败: %v", o["masked_phone"])
		}
		if strings.Contains(string(b), "13900001111") {
			t.Fatal("响应泄露了原始手机号")
		}
		if o["status"] != "placed" {
			t.Fatalf("新单状态应为 placed，实际 %v", o["status"])
		}
	})

	cases := []struct {
		name   string
		mutate func(map[string]any)
		want   int
		code   string
	}{
		{"未达起送价 → 409", func(m map[string]any) {
			m["items"] = []map[string]any{{"code": "STP-034", "qty": 2}}
		}, http.StatusConflict, "below_min_order"},
		{"售罄菜品 → 409", func(m map[string]any) {
			m["items"] = []map[string]any{{"code": "HOT-020", "qty": 1}, {"code": "STP-034", "qty": 2}}
		}, http.StatusConflict, "dish_unavailable"},
		{"菜品不存在 → 404", func(m map[string]any) {
			m["items"] = []map[string]any{{"code": "HOT-999", "qty": 1}, {"code": "STP-034", "qty": 2}}
		}, http.StatusNotFound, "dish_not_found"},
		{"停用区域 → 400", func(m map[string]any) { m["zone"] = "campus" }, http.StatusBadRequest, "zone_inactive"},
		{"区域不存在 → 400", func(m map[string]any) { m["zone"] = "mars" }, http.StatusBadRequest, "invalid_request"},
		{"地址含脚本片段 → 400", func(m map[string]any) {
			m["address"] = "天府大道<script>alert(1)</script>1 号 1 单元"
		}, http.StatusBadRequest, "invalid_request"},
		{"姓名含 SQL 注入 → 400", func(m map[string]any) {
			m["recipient"] = "张三'; DROP TABLE orders;--"
		}, http.StatusBadRequest, "invalid_request"},
		{"手机号超长注入 → 400", func(m map[string]any) {
			m["phone"] = "138000011111111 OR 1=1"
		}, http.StatusBadRequest, "invalid_request"},
		{"备注超长 → 400", func(m map[string]any) {
			m["note"] = strings.Repeat("辣", 300)
		}, http.StatusBadRequest, "invalid_request"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := goodOrder()
			tc.mutate(in)
			res, b := do(t, http.MethodPost, srv.URL+"/api/orders", "", in)
			if res.StatusCode != tc.want {
				t.Fatalf("status=%d want=%d body=%s", res.StatusCode, tc.want, b)
			}
			m := decode(t, b)
			if m["code"] != tc.code {
				t.Fatalf("code=%v want=%v", m["code"], tc.code)
			}
		})
	}
}

func TestOrderStateMachineEndToEnd(t *testing.T) {
	srv := newTestServer(t, testToken)
	res, b := do(t, http.MethodPost, srv.URL+"/api/orders", "", goodOrder())
	if res.StatusCode != http.StatusCreated {
		t.Fatal(res.StatusCode, string(b))
	}
	id := int64(decode(t, b)["order"].(map[string]any)["id"].(float64))
	path := srv.URL + "/api/admin/orders/" + itoa(id) + "/status"

	advance := func(to string) int {
		res, _ := do(t, http.MethodPost, path, testToken, map[string]string{"to": to})
		return res.StatusCode
	}
	// 跳级与倒序一律 409；顺流程全绿
	if got := advance("delivered"); got != http.StatusConflict {
		t.Fatalf("placed→delivered 应 409，实际 %d", got)
	}
	for _, to := range []string{"cooking", "ready", "delivering", "delivered"} {
		if got := advance(to); got != http.StatusOK {
			t.Fatalf("推进到 %s 应 200，实际 %d", to, got)
		}
	}
	if got := advance("cooking"); got != http.StatusConflict {
		t.Fatalf("delivered 为终态，应 409，实际 %d", got)
	}
}

func TestReadEndpointsAndClamps(t *testing.T) {
	srv := newTestServer(t, testToken)

	t.Run("菜单全量 26 / 在售 23", func(t *testing.T) {
		_, b := do(t, http.MethodGet, srv.URL+"/api/menu?page_size=100", "", nil)
		if m := decode(t, b); m["total"].(float64) != 26 {
			t.Fatalf("total=%v", m["total"])
		}
		_, b = do(t, http.MethodGet, srv.URL+"/api/menu?available=1&page_size=100", "", nil)
		if m := decode(t, b); m["total"].(float64) != 23 {
			t.Fatalf("available total=%v", m["total"])
		}
	})

	t.Run("page_size 超限被钳制为 100", func(t *testing.T) {
		_, b := do(t, http.MethodGet, srv.URL+"/api/orders?page_size=99999", "", nil)
		if m := decode(t, b); m["page_size"].(float64) != 100 {
			t.Fatalf("page_size=%v want 100", m["page_size"])
		}
	})

	t.Run("status 过滤口径纯净", func(t *testing.T) {
		_, b := do(t, http.MethodGet, srv.URL+"/api/orders?status=cooking&page_size=100", "", nil)
		for _, it := range decode(t, b)["items"].([]any) {
			if o := it.(map[string]any); o["status"] != "cooking" {
				t.Fatalf("混入其它状态: %v", o["status"])
			}
			if strings.Contains(mustJSON(it), `"1390000`) || strings.Contains(mustJSON(it), `"phone"`) {
				t.Fatal("列表不应出现 phone 字段")
			}
		}
	})

	t.Run("非法 sort 收敛为默认排序且仍是 JSON", func(t *testing.T) {
		res, b := do(t, http.MethodGet, srv.URL+"/api/orders?sort=id;DROP+TABLE--&dir=asc", "", nil)
		if res.StatusCode != 200 {
			t.Fatal(res.StatusCode, string(b))
		}
		decode(t, b)
	})

	t.Run("未匹配 API 返回 JSON 404", func(t *testing.T) {
		res, b := do(t, http.MethodGet, srv.URL+"/api/nope", "", nil)
		if res.StatusCode != http.StatusNotFound || decode(t, b)["code"] != "not_found" {
			t.Fatalf("%d %s", res.StatusCode, b)
		}
	})

	t.Run("zones 只返回启用区域", func(t *testing.T) {
		_, b := do(t, http.MethodGet, srv.URL+"/api/zones", "", nil)
		m := decode(t, b)
		if m["total"].(float64) != 4 {
			t.Fatalf("zones=%v", m["total"])
		}
	})

	t.Run("stats 恒等式", func(t *testing.T) {
		_, b := do(t, http.MethodGet, srv.URL+"/api/stats", "", nil)
		m := decode(t, b)
		var sum int64
		for _, v := range m["by_status"].(map[string]any) {
			sum += int64(v.(float64))
		}
		if sum != int64(m["orders_total"].(float64)) {
			t.Fatalf("by_status 之和 %d != orders_total %v", sum, m["orders_total"])
		}
	})
}

func TestAdminAvailability(t *testing.T) {
	srv := newTestServer(t, testToken)
	_, b := do(t, http.MethodGet, srv.URL+"/api/menu?q=烧肥肠", "", nil)
	items := decode(t, b)["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("命中 %d 条", len(items))
	}
	id := int64(items[0].(map[string]any)["id"].(float64))
	path := srv.URL + "/api/admin/dishes/" + itoa(id) + "/availability"

	res, _ := do(t, http.MethodPost, path, "", map[string]any{"available": true})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无 token 应 401，实际 %d", res.StatusCode)
	}
	res, b = do(t, http.MethodPost, path, testToken, map[string]any{"available": true})
	if res.StatusCode != http.StatusOK || decode(t, b)["available"] != true {
		t.Fatalf("恢复在售失败: %d %s", res.StatusCode, b)
	}
	res, b = do(t, http.MethodPost, path, testToken, map[string]any{})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("available 缺失应 400，实际 %d %s", res.StatusCode, b)
	}
	// 复原：改回售罄，不影响其它用例
	if _, b = do(t, http.MethodPost, path, testToken, map[string]any{"available": false}); len(b) == 0 {
		t.Fatal("empty body")
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
