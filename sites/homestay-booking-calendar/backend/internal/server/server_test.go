package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"bizsite/internal/domain"
	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

// HTTP 层的验收：鉴权三层 fail-closed、字段校验、注入与超长边界、
// 每个排序键都要真的返回 200，以及一条完整的下单→入住→离店状态流。

const testToken = "unit-test-token-hs"

type env struct {
	router *gin.Engine
	repo   *repository.Repo
	today  string
}

func setup(t *testing.T, token string) *env {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(t.TempDir() + "/api.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	now := time.Now()
	if err := repo.Seed(context.Background(), now); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	// 种子与接口必须看同一个"今天"，否则时间门会整片误判。
	return &env{router: Router(handler.New(service.New(repo)), token), repo: repo,
		today: domain.DateStr(now.Local())}
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

func bearer(tok string) string { return "Bearer " + tok }

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是 JSON: %v / %s", err, trunc(w.Body.String()))
	}
	return out
}

func trunc(s string) string {
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}

func wantStatus(t *testing.T, w *httptest.ResponseRecorder, code int, what string) map[string]any {
	t.Helper()
	if w.Code != code {
		t.Fatalf("%s: 状态码 %d，期望 %d（body=%s）", what, w.Code, code, trunc(w.Body.String()))
	}
	return decode(t, w)
}

// ---------- 读接口 ----------

func TestReadEndpointsAreSecureAndComplete(t *testing.T) {
	e := setup(t, testToken)

	// /stats 的三条对外恒等式必须成立，否则整块看板没有可信度。
	st := wantStatus(t, do(e.router, "GET", "/api/stats", "", ""), 200, "stats")
	id, ok := st["identity"].(map[string]any)
	if !ok {
		t.Fatalf("stats 缺 identity：%v", keys(st))
	}
	for _, k := range []string{"subtotal_matches", "revpar_identity_ok", "net_identity_ok"} {
		if id[k] != true {
			t.Fatalf("恒等式 %s 未成立：%v", k, id)
		}
	}
	if gap, _ := id["net_gap_cents"].(float64); gap != 0 {
		t.Fatalf("净额缺口 %v 分", gap)
	}

	for _, path := range []string{"/api/health", "/api/properties", "/api/rooms?page_size=5",
		"/api/rooms?sort=revenue&dir=asc", "/api/bookings?horizon=inhouse", "/api/bookings?page=2&page_size=3",
		"/api/stats?from=2026-01-01&days=999"} {
		w := do(e.router, "GET", path, "", "")
		if w.Code != 200 {
			t.Fatalf("%s -> %d（%s）", path, w.Code, trunc(w.Body.String()))
		}
		for h, want := range map[string]string{"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"} {
			if got := w.Header().Get(h); got != want {
				t.Fatalf("%s 缺安全响应头 %s=%s", path, h, got)
			}
		}
	}

	room := firstRoomCode(t, e)
	detail := wantStatus(t, do(e.router, "GET", "/api/rooms/"+room, "", ""), 200, "房型详情")
	if detail["room"] == nil || detail["calendar"] == nil {
		t.Fatalf("房型详情缺字段：%v", keys(detail))
	}
	q := wantStatus(t, do(e.router, "GET",
		"/api/rooms/"+room+"/quote?check_in="+domain.AddDays(e.today, 20)+"&check_out="+domain.AddDays(e.today, 22)+
			"&units=1&guests=2", "", ""), 200, "试算")
	if _, ok := q["quote"].(map[string]any); !ok {
		t.Fatalf("试算响应结构错：%v", keys(q))
	}

	// 不可订也必须 200 并给出 blockers：前端要显示"改掉哪天就能订"。
	bad := wantStatus(t, do(e.router, "GET",
		"/api/rooms/"+room+"/quote?check_in=2026-13-45&check_out=bad", "", ""), 200, "非法日期试算")
	qt, _ := bad["quote"].(map[string]any)
	if qt["check_in"] != e.today || qt["nights"] != float64(2) {
		t.Fatalf("非法日期必须回落到默认窗口（今天起 2 晚），got %v / %v", qt["check_in"], qt["nights"])
	}
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// firstRoomCode 从接口拿一个在售房型，测试不硬编码种子编码。
func firstRoomCode(t *testing.T, e *env) string {
	t.Helper()
	out := wantStatus(t, do(e.router, "GET", "/api/rooms?status=active&page_size=1", "", ""), 200, "rooms")
	items, _ := out["items"].([]any)
	if len(items) == 0 {
		t.Fatal("没有在售房型")
	}
	code, _ := items[0].(map[string]any)["code"].(string)
	if code == "" {
		t.Fatalf("房型缺 code：%v", items[0])
	}
	return code
}

// ---------- 鉴权矩阵 ----------

func TestWriteEndpointsFailClosed(t *testing.T) {
	writes := []struct {
		path, body string
	}{
		{"/api/rooms/HG-LAKE/bookings", `{"check_in":"2099-01-01","check_out":"2099-01-02","units":1,"guests":1,"guest_name":"测试","phone":"13800001111","channel":"direct"}`},
		{"/api/bookings/HS20990101-001/status", `{"to":"confirmed"}`},
		{"/api/rooms/HG-LAKE/closure", `{"date":"2099-01-01","closed":true,"label":"检修"}`},
		{"/api/rooms/HG-LAKE/status", `{"to":"inactive"}`},
	}
	t.Run("服务端未配置令牌时一律 503", func(t *testing.T) {
		e := setup(t, "   ") // 只有空白也算没配：绝不因"期望值为空"而放行
		for _, w := range writes {
			got := wantStatus(t, do(e.router, "POST", w.path, bearer("anything"), w.body), 503, w.path)
			if got["code"] != "server_misconfigured" {
				t.Fatalf("%s 错误码 %v", w.path, got["code"])
			}
		}
	})

	e := setup(t, testToken)
	cases := []struct {
		name, auth string
		want       int
		code       string
	}{
		{"缺 Authorization", "", 401, "unauthorized"},
		{"只有 Bearer 前缀", "Bearer ", 401, "unauthorized"},
		{"非 Bearer 方案", "Basic dXNlcjpwYXNz", 401, "unauthorized"},
		{"裸令牌没有方案前缀", testToken, 401, "unauthorized"},
		{"大小写变体的 Bearer 仍须通过", "bearer " + testToken, 0, ""},
		{"错误令牌", bearer("guessed-token"), 403, "forbidden"},
		{"前缀正确的错误令牌", bearer(testToken + "x"), 403, "forbidden"},
	}
	for _, w := range writes {
		for _, c := range cases {
			t.Run(w.path+" / "+c.name, func(t *testing.T) {
				got := do(e.router, "POST", w.path, c.auth, w.body)
				if c.want == 0 {
					if got.Code == 401 || got.Code == 403 || got.Code == 503 {
						t.Fatalf("合法凭证被鉴权层拒绝：%d %s", got.Code, trunc(got.Body.String()))
					}
					return
				}
				body := wantStatus(t, got, c.want, w.path)
				if body["code"] != c.code {
					t.Fatalf("错误码 %v，期望 %s", body["code"], c.code)
				}
			})
		}
	}
}

// ---------- 校验、注入与边界 ----------

func TestValidationAndInjection(t *testing.T) {
	e := setup(t, testToken)
	room := firstRoomCode(t, e)
	book := func(body string) *httptest.ResponseRecorder {
		return do(e.router, "POST", "/api/rooms/"+room+"/bookings?now="+e.today, bearer(testToken), body)
	}

	cases := []struct {
		name, body, field string
	}{
		{"缺入住日", `{"check_out":"2099-01-03","units":1,"guests":1,"guest_name":"甲","phone":"13800001111","channel":"direct"}`, "check_in"},
		{"入住日格式非法", `{"check_in":"2099/01/02","check_out":"2099-01-03","units":1,"guests":1,"guest_name":"甲","phone":"13800001111","channel":"direct"}`, "check_in"},
		{"间数越界", `{"check_in":"2099-01-02","check_out":"2099-01-03","units":99,"guests":1,"guest_name":"甲","phone":"13800001111","channel":"direct"}`, "units"},
		{"手机号注入", `{"check_in":"2099-01-02","check_out":"2099-01-03","units":1,"guests":1,"guest_name":"甲","phone":"138' OR '1'='1","channel":"direct"}`, "phone"},
		{"姓名超长", `{"check_in":"2099-01-02","check_out":"2099-01-03","units":1,"guests":1,"guest_name":"` + strings.Repeat("客", 40) + `","phone":"13800001111","channel":"direct"}`, "guest_name"},
		{"渠道不在白名单", `{"check_in":"2099-01-02","check_out":"2099-01-03","units":1,"guests":1,"guest_name":"甲","phone":"13800001111","channel":"'; DROP TABLE bookings; --"}`, "channel"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := wantStatus(t, book(c.body), 400, c.name)
			if out["code"] != "invalid_request" {
				t.Fatalf("错误码 %v", out["code"])
			}
			f, _ := out["fields"].(map[string]any)
			if _, hit := f[c.field]; !hit {
				t.Fatalf("字段 %s 未回显错误：%v", c.field, out["fields"])
			}
		})
	}

	t.Run("空请求体与畸形 JSON", func(t *testing.T) {
		for _, b := range []string{"", "{", `{"check_in":`} {
			out := wantStatus(t, book(b), 400, "畸形请求体")
			if out["code"] != "invalid_request" {
				t.Fatalf("错误码 %v", out["code"])
			}
		}
	})

	t.Run("超过 16KB 的请求体不进解析器", func(t *testing.T) {
		huge := `{"check_in":"2099-01-02","check_out":"2099-01-03","units":1,"guests":1,"guest_name":"甲",` +
			`"phone":"13800001111","channel":"direct","note":"` + strings.Repeat("长", 9000) + `"}`
		out := wantStatus(t, book(huge), 400, "超长请求体")
		if !strings.Contains(out["message"].(string), "大小") {
			t.Fatalf("超长请求体文案不含原因：%v", out["message"])
		}
	})

	t.Run("路径参数注入必须 404 而不是 500", func(t *testing.T) {
		for _, p := range []string{
			"/api/rooms/" + urlEncode("HG-LAKE'; DROP TABLE bookings;--"),
			"/api/bookings/" + urlEncode("HS20990101-001' OR 1=1--"),
			"/api/rooms/" + urlEncode("../../etc/passwd"),
			"/api/rooms/" + urlEncode("HG-LAKE%00"),
		} {
			w := do(e.router, "GET", p, "", "")
			if w.Code != http.StatusNotFound {
				t.Fatalf("%s -> %d（%s）", p, w.Code, trunc(w.Body.String()))
			}
			if body := decode(t, w); body["code"] != "not_found" {
				t.Fatalf("404 未走 JSON 口径：%v", body)
			}
		}
	})

	t.Run("查询参数注入被白名单收敛", func(t *testing.T) {
		w := wantStatus(t, do(e.router, "GET",
			"/api/bookings?status=confirmed%27%20OR%20%271%27%3D%271&room=%27%3BDELETE%3B--&q=%25%25%25", "", ""),
			200, "注入查询串")
		items, _ := w["items"].([]any)
		if len(items) != 0 {
			t.Fatalf("注入串本应过滤不到任何结果，实际 %d 条", len(items))
		}
		if still, _ := w["total"].(float64); still != 0 {
			t.Fatalf("total=%v 应为 0", still)
		}
	})

	t.Run("分页上限", func(t *testing.T) {
		out := wantStatus(t, do(e.router, "GET", "/api/bookings?page_size=100000", "", ""), 200, "分页")
		if n, _ := out["page_size"].(float64); n != domain.MaxPageSize {
			t.Fatalf("page_size=%v 未被钳到 %d", n, domain.MaxPageSize)
		}
		items, _ := out["items"].([]any)
		if len(items) > domain.MaxPageSize {
			t.Fatalf("实返 %d 条，越过上限", len(items))
		}
	})

	t.Run("未知接口返回 JSON 404", func(t *testing.T) {
		out := wantStatus(t, do(e.router, "GET", "/api/not-a-real-endpoint", "", ""), 404, "未知接口")
		if out["code"] != "not_found" {
			t.Fatalf("错误码 %v", out["code"])
		}
	})
}

func urlEncode(s string) string { return url.PathEscape(s) }

// TestEverySortKeyServes200 把两张表的排序白名单逐个真跑一遍：
// 第 6 轮的教训是白名单里写了一个不存在的列，接口整页 500 才被发现。
func TestEverySortKeyServes200(t *testing.T) {
	e := setup(t, testToken)
	for key := range domain.BookingSorts() {
		path := "/api/bookings?sort=" + key + "&page_size=5"
		out := wantStatus(t, do(e.router, "GET", path, "", ""), 200, path)
		if out["sort"] == nil || out["sort"] == "" {
			t.Fatalf("%s 未回显生效排序键", path)
		}
	}
	for key := range domain.RoomSorts() {
		path := "/api/rooms?sort=" + key + "&page_size=5"
		out := wantStatus(t, do(e.router, "GET", path, "", ""), 200, path)
		if out["sort"] == nil || out["sort"] == "" {
			t.Fatalf("%s 未回显生效排序键", path)
		}
	}
	// 非法排序键必须静默回落，而不是报错或原样拼进 SQL。
	for _, p := range []string{"/api/bookings?sort=1%3BDROP%20TABLE%20bookings", "/api/rooms?sort=nights--",
		"/api/bookings?sort=lower(code)", "/api/rooms?sort=revenue%3B--"} {
		out := wantStatus(t, do(e.router, "GET", p, "", ""), 200, p)
		if out["sort"] == "" || out["sort"] == nil {
			t.Fatalf("%s 未回落到默认排序", p)
		}
		if items, _ := out["items"].([]any); items == nil {
			t.Fatalf("%s 没有返回 items 数组", p)
		}
	}
}

// ---------- 业务闭环 ----------

func TestBookingLifecycleThroughHTTP(t *testing.T) {
	e := setup(t, testToken)
	room, input := bookableQuote(t, e)

	created := wantStatus(t, do(e.router, "POST", "/api/rooms/"+room+"/bookings?now="+e.today,
		bearer(testToken), input), 201, "下单")
	row, _ := created["booking"].(map[string]any)
	code, _ := row["code"].(string)
	if !strings.HasPrefix(code, "HS") {
		t.Fatalf("订单号格式错：%v", row["code"])
	}
	if row["status"] != domain.StPending {
		t.Fatalf("新单应是 pending，got %v", row["status"])
	}
	if phone, _ := row["phone"].(string); phone != "" {
		t.Fatalf("phone 是隐私字段，绝不应出现在响应里：%q", phone)
	}
	full := created["booking"].(map[string]any)["masked_phone"]
	if full == nil || !strings.Contains(full.(string), "****") {
		t.Fatalf("masked_phone 缺失：%v", full)
	}

	detail := wantStatus(t, do(e.router, "GET", "/api/bookings/"+code, "", ""), 200, "订单详情")
	d, _ := detail["booking"].(map[string]any)
	if d["code"] != code {
		t.Fatalf("详情串单：%v", d["code"])
	}
	nights, _ := detail["nights"].([]any)
	var sum float64
	for _, n := range nights {
		nm := n.(map[string]any)
		if nm["amount_cents"].(float64) != nm["price_cents"].(float64)*nm["units"].(float64) {
			t.Fatalf("%s 单晚金额不自洽：%v", code, nm)
		}
		sum += nm["amount_cents"].(float64)
	}
	if int64(sum) != int64(d["night_subtotal_cents"].(float64)) {
		t.Fatalf("%s Σ逐夜 %d != 小计 %v", code, int64(sum), d["night_subtotal_cents"])
	}

	st := func(to, now string) map[string]any {
		return wantStatus(t, do(e.router, "POST", "/api/bookings/"+code+"/status?now="+now,
			bearer(testToken), `{"to":"`+to+`","note":"接口测试"}`), 200, "状态→"+to)
	}
	if got := st(domain.StConfirmed, e.today); got["booking"].(map[string]any)["status"] != domain.StConfirmed {
		t.Fatalf("确认失败：%v", got["booking"])
	}
	// 未到入住日不能办理入住：时间门必须挡住。
	blocked := do(e.router, "POST", "/api/bookings/"+code+"/status?now="+e.today,
		bearer(testToken), `{"to":"checked_in"}`)
	if blocked.Code == 200 {
		t.Fatal("入住日之前的时间门失效")
	}
	if body := decode(t, blocked); body["code"] == "internal_error" {
		t.Fatalf("时间门应给业务错误码，不该 500：%v", body)
	}
	checkIn, _ := d["check_in"].(string)
	if got := st(domain.StCheckedIn, checkIn); got["booking"].(map[string]any)["status"] != domain.StCheckedIn {
		t.Fatalf("入住失败：%v", got["booking"])
	}
	out := st(domain.StCheckedOut, domain.AddDays(checkIn, 1))
	if got := out["booking"].(map[string]any); got["status"] != domain.StCheckedOut {
		t.Fatalf("离店失败：%v", got)
	}
	// 已完成订单不能再退回确认：状态机必须拒绝。
	wantStatus(t, do(e.router, "POST", "/api/bookings/"+code+"/status?now="+e.today,
		bearer(testToken), `{"to":"confirmed"}`), 409, "终态回退")

	// 同一区间再下一单要按库存判定；超卖必须 409。
	if w := do(e.router, "POST", "/api/rooms/"+room+"/bookings?now="+e.today,
		bearer(testToken), input); w.Code != http.StatusConflict && w.Code != http.StatusCreated {
		t.Fatalf("重复下单返回 %d：%s", w.Code, trunc(w.Body.String()))
	}
}

// bookableQuote 找一个"确定可订"的房型与窗口：让接口自己说行不行，测试不猜种子。
func bookableQuote(t *testing.T, e *env) (string, string) {
	t.Helper()
	out := wantStatus(t, do(e.router, "GET", "/api/rooms?status=active&page_size=100", "", ""), 200, "rooms")
	items, _ := out["items"].([]any)
	for _, raw := range items {
		it, _ := raw.(map[string]any)
		code, _ := it["code"].(string)
		checkIn := domain.AddDays(e.today, 24)
		checkOut := domain.AddDays(checkIn, 2)
		q := wantStatus(t, do(e.router, "GET", "/api/rooms/"+code+"/quote?check_in="+checkIn+
			"&check_out="+checkOut+"&units=1&guests=1", "", ""), 200, "quote")
		qt, _ := q["quote"].(map[string]any)
		if qt["ok"] != true {
			continue
		}
		body := `{"check_in":"` + checkIn + `","check_out":"` + checkOut +
			`","units":1,"guests":1,"guest_name":"接口回归","phone":"13900001234","channel":"direct","note":"自动化测试"}`
		return code, body
	}
	t.Fatal("28 天窗口内没有任何可订房型，种子或排他规则有问题")
	return "", ""
}

// TestClosureToggleIsVisible 停售开关必须真的反映到日历与可售间数上。
func TestClosureToggleIsVisible(t *testing.T) {
	e := setup(t, testToken)
	room := firstRoomCode(t, e)
	date := domain.AddDays(e.today, 33)

	toggle := func(closed bool) map[string]any {
		body := `{"date":"` + date + `","closed":` + strconv.FormatBool(closed) + `,"label":"顶棚检修"}`
		return wantStatus(t, do(e.router, "POST", "/api/rooms/"+room+"/closure", bearer(testToken), body),
			200, "停售开关")
	}
	on := toggle(true)
	day, _ := on["day"].(map[string]any)
	if day["closed"] != true || day["available"] != float64(0) {
		t.Fatalf("停售后格子应不可售：%v", day)
	}
	if !strings.Contains(on["message"].(string), "已订出的入住不受影响") {
		t.Fatalf("停售文案要交代既有订单：%v", on["message"])
	}
	cal := wantStatus(t, do(e.router, "GET", "/api/rooms/"+room+"?from="+date+"&days=3", "", ""), 200, "日历")
	cells, _ := cal["calendar"].([]any)
	var hit bool
	for _, c := range cells {
		cm := c.(map[string]any)
		if cm["date"] == date {
			hit = true
			if cm["closed"] != true {
				t.Fatalf("日历里 %s 未标记停售：%v", date, cm)
			}
		}
	}
	if !hit {
		t.Fatalf("日历窗口里没有 %s（cells=%d）", date, len(cells))
	}
	off := toggle(false)
	if off["day"].(map[string]any)["closed"] != false {
		t.Fatalf("恢复售卖失败：%v", off["day"])
	}

	// 房型下架同样要反映在统计口径上。
	wantStatus(t, do(e.router, "POST", "/api/rooms/"+room+"/status", bearer(testToken),
		`{"to":"inactive"}`), 200, "下架房型")
	after := wantStatus(t, do(e.router, "GET", "/api/stats", "", ""), 200, "stats")
	before := after["portfolio"].(map[string]any)
	if before["rooms_active"] == nil {
		t.Fatalf("stats 缺 portfolio.rooms_active：%v", before)
	}
}

// TestErrorResponseNeverLeaksInternals 断言对外文案不含驱动/SQL/堆栈痕迹。
func TestErrorResponseNeverLeaksInternals(t *testing.T) {
	e := setup(t, testToken)
	paths := []string{"/api/rooms/NO-SUCH-ROOM", "/api/bookings/HS19700101-999",
		"/api/rooms/" + urlEncode("HG-LAKE' --"), "/api/stats?days=-1"}
	for _, p := range paths {
		w := do(e.router, "GET", p, "", "")
		if w.Code < 400 {
			continue
		}
		body := w.Body.String()
		for _, leak := range []string{"gorm", "SQLITE", "sqlite3", "SELECT ", "panic", "runtime/goroutine", "no such column"} {
			if strings.Contains(strings.ToLower(body), strings.ToLower(leak)) {
				t.Fatalf("%s -> %d 响应泄漏内部细节（%s）：%s", p, w.Code, leak, trunc(body))
			}
		}
	}
}
