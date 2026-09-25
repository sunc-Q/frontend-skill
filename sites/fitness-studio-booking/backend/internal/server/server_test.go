package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
	if err := repo.Seed(context.Background(), time.Now().UTC()); err != nil {
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

var writeEndpoints = []struct {
	name string
	path string
	body string
}{
	{"预约写接口", "/api/admin/sessions/1/bookings", `{"member_id":1}`},
	{"会员建档写接口", "/api/admin/members", `{"name":"接口测试","phone":"13911112222","card_type":"monthly"}`},
}

// TestAdminEndpointsAuthMatrix 两个写接口共用同一条鉴权中间件，逐个跑一遍凭证矩阵。
func TestAdminEndpointsAuthMatrix(t *testing.T) {
	r, _ := setup(t)
	cases := []struct {
		name  string
		token string
		want  int
		code  string
	}{
		{"缺少 Authorization 头 → 401", "", 401, "unauthorized"},
		{"令牌错误 → 403", "Bearer wrong-wrong", 403, "forbidden"},
		{"缺少 Bearer 前缀 → 401", testToken, 401, "unauthorized"},
		{"只有 Bearer 前缀 → 401", "Bearer ", 401, "unauthorized"},
		{"伪造 Basic 方案 → 401", "Basic " + testToken, 401, "unauthorized"},
		{"Bearer 大小写混用仍可通过", "BeArEr " + testToken, 0, ""},
		{"正确令牌 → 非鉴权错误", "Bearer " + testToken, 0, ""},
	}
	for _, ep := range writeEndpoints {
		for _, tc := range cases {
			t.Run(ep.name+"/"+tc.name, func(t *testing.T) {
				w := do(r, http.MethodPost, ep.path, tc.token, ep.body)
				if tc.want != 0 {
					if w.Code != tc.want {
						t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
					}
					var b map[string]any
					_ = json.Unmarshal(w.Body.Bytes(), &b)
					if b["code"] != tc.code {
						t.Errorf("code=%v want %s", b["code"], tc.code)
					}
					return
				}
				// 令牌正确时绝不能是鉴权类状态码；业务状态（201/404/409）不在本用例关心范围。
				if w.Code == 401 || w.Code == 403 || w.Code == 503 {
					t.Fatalf("令牌正确却被拒：%d %s", w.Code, w.Body.String())
				}
			})
		}
	}
}

func TestAdminAuthFailsClosedWhenTokenUnset(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := repository.Open(t.TempDir() + "/no-token.db")
	if err != nil {
		t.Fatal(err)
	}
	r := Router(handler.New(service.New(repository.New(db))), "")
	for _, ep := range writeEndpoints {
		w := do(r, http.MethodPost, ep.path, "Bearer anything", ep.body)
		if w.Code != http.StatusServiceUnavailable {
			t.Errorf("%s：未配置令牌时应 503，实得 %d（绝不能放行）", ep.name, w.Code)
		}
	}
}

func TestBookingHappyPathThroughHTTP(t *testing.T) {
	r, repo := setup(t)
	ctx := context.Background()
	rows, _, err := repo.ListSessions(ctx, domain.ListQuery{
		Page: 1, PageSize: 100, Sort: "s.start_at", Dir: "asc", Days: 14, Status: domain.SessionOpen,
	}, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	members, err := repo.ActiveMembers(ctx, 200)
	if err != nil {
		t.Fatal(err)
	}
	var (
		sessionID int64
		memberID  int64
	)
	for _, s := range rows {
		if !s.StartAt.After(time.Now().UTC()) || s.Remaining <= 0 {
			continue
		}
		roster, err := repo.Roster(ctx, s.ID, 60)
		if err != nil {
			t.Fatal(err)
		}
		booked := map[int64]bool{}
		for _, e := range roster {
			booked[e.MemberID] = true
		}
		for _, m := range members {
			if !booked[m.ID] {
				sessionID, memberID = s.ID, m.ID
				break
			}
		}
		if sessionID != 0 {
			break
		}
	}
	if sessionID == 0 {
		t.Fatal("找不到可用于写路径的课节/会员")
	}

	before, err := repo.Session(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	w := do(r, http.MethodPost, fmt.Sprintf("/api/admin/sessions/%d/bookings", sessionID),
		"Bearer "+testToken, fmt.Sprintf(`{"member_id":%d,"source":"app"}`, memberID))
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		Booking domain.Booking       `json:"booking"`
		Session domain.SessionDetail `json:"session"`
		Message string               `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Booking.Status != domain.BookingConfirmed {
		t.Errorf("status=%s", out.Booking.Status)
	}
	if out.Session.Session.Confirmed != before.Confirmed+1 {
		t.Errorf("课节确认数没推进：before=%d after=%d", before.Confirmed, out.Session.Session.Confirmed)
	}

	// 同一会员再来一次 → 409
	w = do(r, http.MethodPost, fmt.Sprintf("/api/admin/sessions/%d/bookings", sessionID),
		"Bearer "+testToken, fmt.Sprintf(`{"member_id":%d}`, memberID))
	if w.Code != http.StatusConflict {
		t.Fatalf("重复预约应 409，实得 %d %s", w.Code, w.Body.String())
	}
}

func TestErrorResponsesNeverLeakInternalDetails(t *testing.T) {
	r, _ := setup(t)
	long := strings.Repeat("超", 400)
	cases := []struct {
		name   string
		method string
		path   string
		token  string
		body   string
		want   int
	}{
		{"非法 JSON 请求体", http.MethodPost, "/api/admin/members", "Bearer " + testToken, `{"name":`, 400},
		{"非数字课节 ID", http.MethodGet, "/api/sessions/1%20OR%201%3D1", "", "", 400},
		{"不存在的课节", http.MethodGet, "/api/sessions/424242", "", "", 404},
		{"不存在的接口", http.MethodGet, "/api/nope", "", "", 404},
		{"姓名超长", http.MethodPost, "/api/admin/members", "Bearer " + testToken,
			`{"name":"` + long + `","phone":"13911113333","card_type":"monthly"}`, 400},
		{"手机号注入串", http.MethodPost, "/api/admin/members", "Bearer " + testToken,
			`{"name":"陈立","phone":"139'; DROP TABLE members;--","card_type":"monthly"}`, 400},
		{"卡种非法", http.MethodPost, "/api/admin/members", "Bearer " + testToken,
			`{"name":"陈立","phone":"13911114444","card_type":"lifetime"}`, 400},
		{"预约来源非法", http.MethodPost, "/api/admin/sessions/1/bookings", "Bearer " + testToken,
			`{"member_id":1,"source":"sms' OR 1=1--"}`, 400},
		{"课节 ID 越界为负", http.MethodPost, "/api/admin/sessions/-5/bookings", "Bearer " + testToken,
			`{"member_id":1}`, 400},
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
		})
	}
}

func TestReadEndpointsShapeAndPaginationClamp(t *testing.T) {
	r, _ := setup(t)

	w := do(r, http.MethodGet, "/api/schedule?page_size=99999&days=99", "", "")
	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var list struct {
		Items    []domain.SessionRow `json:"items"`
		Total    int64               `json:"total"`
		PageSize int                 `json:"page_size"`
		Days     int                 `json:"days"`
		From     string              `json:"from"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.PageSize != domain.MaxPageSize {
		t.Errorf("page_size=%d，应被压到 %d", list.PageSize, domain.MaxPageSize)
	}
	if list.Days != domain.ScheduleHoriz {
		t.Errorf("days=%d，应被压到 %d", list.Days, domain.ScheduleHoriz)
	}
	if len(list.Items) == 0 {
		t.Fatal("课表为空")
	}
	for _, s := range list.Items {
		if s.ClassName == "" || s.Coach == "" || s.Room == "" {
			t.Errorf("课表未回填 JOIN 字段：%+v", s)
		}
	}

	w = do(r, http.MethodGet, "/api/schedule?category=yoga&sort=booked&dir=desc", "", "")
	var yoga struct {
		Items []domain.SessionRow `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &yoga); err != nil {
		t.Fatal(err)
	}
	for _, s := range yoga.Items {
		if s.Category != "yoga" {
			t.Errorf("分类过滤失效：%+v", s)
		}
	}
	if !sortedDesc(yoga.Items) {
		t.Errorf("sort=booked&dir=desc 未按确认数倒序：%v", yoga.Items)
	}

	w = do(r, http.MethodGet, "/api/stats?days=7", "", "")
	var st domain.Stats
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.OccupancyPct < 0 || st.OccupancyPct > 100 || st.Members == 0 || len(st.Days) == 0 {
		t.Fatalf("指标接口数据不正确：%+v", st)
	}

	w = do(r, http.MethodGet, "/api/classes", "", "")
	var cls struct {
		Items []domain.Class `json:"items"`
		Total int            `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &cls); err != nil {
		t.Fatal(err)
	}
	if cls.Total < 8 {
		t.Fatalf("课程数=%d", cls.Total)
	}
	for _, c := range cls.Items {
		if !c.Active {
			t.Errorf("课程列表应只含在售课程：%+v", c)
		}
	}
}

func sortedDesc(items []domain.SessionRow) bool {
	for i := 1; i < len(items); i++ {
		if items[i-1].Confirmed < items[i].Confirmed {
			return false
		}
	}
	return true
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
