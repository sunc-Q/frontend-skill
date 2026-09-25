package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
	"bizsite/internal/handler"
	"bizsite/internal/repository"
	"bizsite/internal/service"
)

const testToken = "server-test-token"

// 与 repository 测试同一把固定时钟：2026-09-26 09:00（本地周六，前一天是中秋法定假日）。
var fixedNow = time.Date(2026, 9, 26, 1, 0, 0, 0, time.UTC)

type env struct {
	srv   *httptest.Server
	repo  *repository.Repo
	token string
}

func newEnv(t *testing.T, token string, seedAt time.Time) *env {
	t.Helper()
	db, err := repository.Open(path.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	repo := repository.New(db)
	if err := repo.Seed(context.Background(), seedAt); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	svc := service.NewAt(repo, func() time.Time { return seedAt })
	e := &env{repo: repo, token: token}
	e.srv = httptest.NewServer(Router(handler.New(svc, token != ""), token))
	t.Cleanup(e.srv.Close)
	return e
}

func (e *env) do(t *testing.T, method, p string, body any, auth string) (int, map[string]any, string) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		switch v := body.(type) {
		case string:
			rdr = strings.NewReader(v)
		default:
			b, err := json.Marshal(v)
			if err != nil {
				t.Fatalf("marshal body: %v", err)
			}
			rdr = bytes.NewReader(b)
		}
	}
	req, err := http.NewRequest(method, e.srv.URL+p, rdr)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("%s %s 不是 JSON：%s", method, p, truncate(string(raw)))
		}
	}
	return resp.StatusCode, out, string(raw)
}

func truncate(s string) string {
	if len(s) > 200 {
		return s[:200]
	}
	return s
}

func bearer(tok string) string { return "Bearer " + tok }

// TestReadEndpointsAndIdentities 覆盖全部读接口：状态码 + 关键口径 + 四条恒等式。
func TestReadEndpointsAndIdentities(t *testing.T) {
	e := newEnv(t, testToken, fixedNow)

	code, body, _ := e.do(t, "GET", "/api/health", nil, "")
	if code != 200 || body["status"] != "ok" {
		t.Fatalf("health：%d %v", code, body)
	}
	if body["today_field"] != "2026-09-26" {
		t.Errorf("health 的本地日期应为 2026-09-26（周六），实际 %v", body["today_field"])
	}
	if body["working_day"] != false {
		t.Error("2026-09-26 是周六且非调休，working_day 必须为 false")
	}

	// /api/meta：前端界面的全部选项来自这里，逐项核对数量与取值
	_, meta, metaRaw := e.do(t, "GET", "/api/meta", nil, "")
	if len(meta["statuses"].([]any)) != 7 || len(meta["tiers"].([]any)) != 4 {
		t.Errorf("meta 字典不完整：%s", truncate(metaRaw))
	}
	if meta["statuses"].([]any)[0].(map[string]any)["label"] != "待受理" {
		t.Error("meta.statuses 应带中文标签")
	}
	if int(meta["minutes_per_day"].(float64)) != domain.MinutesPerDay {
		t.Error("meta.minutes_per_day 与工作窗口口径不一致")
	}
	if len(meta["pause_reasons"].([]any)) == 0 || len(meta["categories"].([]any)) == 0 {
		t.Error("meta 缺停表原因或分类字典")
	}
	if len(meta["only"].([]any)) != len(domain.OnlyOptions) {
		t.Error("meta.only 与查询字典不同步")
	}
	// 展示层靠这个偏移做「UTC → 现场挂钟」的确定性换算，缺了就会整体错 8 小时
	if int(meta["field_utc_offset_min"].(float64)) != domain.FieldOffsetMin {
		t.Error("meta.field_utc_offset_min 与 FieldTZ 口径不一致")
	}

	code, body, raw := e.do(t, "GET", "/api/stats", nil, "")
	if code != 200 {
		t.Fatalf("stats：%d", code)
	}
	audit := body["audit"].(map[string]any)
	for _, k := range []string{"clock_identity_ok", "timeline_identity_ok", "wall_split_ok", "response_identity_ok"} {
		if audit[k] != true {
			t.Errorf("stats.audit.%s 应为 true：%s", k, truncate(raw))
		}
	}
	if body["by_status"].([]any)[0] == nil {
		t.Error("by_status 为空")
	}
	if len(body["daily"].([]any)) != 14 {
		t.Error("daily 应为 14 点")
	}

	code, body, _ = e.do(t, "GET", "/api/tickets?page_size=5", nil, "")
	if code != 200 {
		t.Fatalf("列表：%d", code)
	}
	items, ok := body["items"].([]any)
	if !ok || len(items) != 5 {
		t.Fatalf("列表必须用 items 信封且按 page_size 收敛：%v", body["items"])
	}
	if body["page_size"].(float64) != 5 {
		t.Error("page_size 未回显")
	}
	total := int64(body["total"].(float64))
	if total < 300 {
		t.Errorf("total=%d，种子覆盖不足", total)
	}

	// page_size 上限钳制 + 非法排序收敛 + 非法 dir 收敛
	_, body, _ = e.do(t, "GET", "/api/tickets?page_size=99999&sort=bogus&dir=asc", nil, "")
	if int64(body["page_size"].(float64)) != domain.MaxPageSize {
		t.Errorf("page_size 应钳到 %d，实际 %v", domain.MaxPageSize, body["page_size"])
	}
	if _, ok := body["filter_echo"]; !ok {
		t.Error("列表应回显生效的筛选条件")
	}
	if body["sort"].(string) != "due" {
		t.Errorf("非法 sort 应收敛到 due，实际 %v", body["sort"])
	}

	// 每个排序键 × 每个 only 页签都必须 200（第 6 轮的 500 事故就是这个盲区）
	for _, sortKey := range []string{"created", "due", "priority", "severity", "status",
		"customer", "agent", "code", "paused", "resolveBd", "'; DROP TABLE tickets;--", ""} {
		for _, only := range []string{"", "open", "breached", "at_risk", "paused", "responding", "bogus"} {
			q := "/api/tickets?page_size=3&sort=" + url.QueryEscape(sortKey)
			if only != "" {
				q += "&only=" + only
			}
			c, b, rawBody := e.do(t, "GET", q, nil, "")
			if c != 200 {
				t.Fatalf("sort=%q only=%q → %d：%s", sortKey, only, c, truncate(rawBody))
			}
			if len(b["items"].([]any)) > 3 {
				t.Fatalf("sort=%q only=%q 未按 page_size 收敛", sortKey, only)
			}
			for _, it := range b["items"].([]any) {
				row := it.(map[string]any)
				if row["clock_identity_ok"] != true {
					t.Errorf("sort=%q only=%q：%s 时间账不自洽", sortKey, only, row["code"])
				}
			}
		}
	}

	// LIKE 转义：q=% 不得当成通配符（URL 里必须编码成 %25，否则请求行本身非法）
	_, b, _ := e.do(t, "GET", "/api/tickets?q=%25", nil, "")
	if int64(b["total"].(float64)) != 0 {
		t.Error("q=% 应命中 0 行")
	}

	// 详情：账本 + 时间线
	code, body, raw = e.do(t, "GET", "/api/tickets?only=paused&page_size=1", nil, "")
	if code != 200 || len(body["items"].([]any)) == 0 {
		t.Fatalf("没有停表样本：%d %s", code, truncate(raw))
	}
	firstCode := body["items"].([]any)[0].(map[string]any)["code"].(string)
	code, body, raw = e.do(t, "GET", "/api/tickets/"+firstCode, nil, "")
	if code != 200 {
		t.Fatalf("详情：%d %s", code, truncate(raw))
	}
	tk := body["ticket"].(map[string]any)
	ledger := body["ledger"].(map[string]any)
	if tk["status"] != domain.StPending {
		t.Error("详情状态与列表不一致")
	}
	for _, k := range []string{"identity_clock_ok", "identity_wall_split_ok", "identity_timeline_ok"} {
		if ledger[k] != true {
			t.Errorf("详情账本 %s 为 false：%s", k, truncate(raw))
		}
	}
	if !strings.Contains(ledger["decomposition"].(string), " = ") {
		t.Error("分解式缺失")
	}
	if len(body["timeline"].([]any)) == 0 {
		t.Error("时间线为空")
	}
	// 时间口径不变式：实体行按 UTC 出（GORM 统一存 UTC），账本与时间线按现场挂钟出。
	// 前端靠 meta.field_utc_offset_min 把前者换算成后者，两边必须落在同一时刻上。
	created := tk["created_at"].(string)
	if !strings.HasSuffix(created, "Z") {
		t.Errorf("工单行的 created_at 应为 UTC（…Z），实际 %s", created)
	}
	ledCreated := ledger["created_at"].(string)
	if !strings.HasSuffix(ledCreated, "+08:00") {
		t.Errorf("账本的 created_at 应带现场偏移，实际 %s", ledCreated)
	}
	if a, err := time.Parse(time.RFC3339, created); err != nil {
		t.Errorf("无法解析 %s", created)
	} else if b, err := time.Parse(time.RFC3339, ledCreated); err != nil {
		t.Errorf("无法解析 %s", ledCreated)
	} else if !a.Equal(b) {
		t.Errorf("同一时刻的两种写法不相等：%s vs %s", created, ledCreated)
	}
	respBlk := body["response"].(map[string]any)
	if _, ok := respBlk["bd_minutes"]; !ok {
		t.Error("首响时效视图缺失")
	}

	// 隐私：明文手机号绝不出现在任何响应里
	for _, p := range []string{"/api/customers", "/api/agents", "/api/tickets?page_size=100", "/api/stats"} {
		_, _, raw := e.do(t, "GET", p, nil, "")
		if strings.Contains(raw, "\"contact_phone\"") {
			t.Errorf("%s 输出了 contact_phone 键", p)
		}
	}
	_, _, raw = e.do(t, "GET", "/api/customers", nil, "")
	var customers struct {
		Items []struct {
			ContactPhone string `json:"-"`
		} `json:"items"`
	}
	_ = json.Unmarshal([]byte(raw), &customers)
	if strings.Contains(raw, "contact_phone_raw") {
		t.Error("对外输出了内部字段名")
	}

	// 未知编号 / 非法编号 / 目录穿越
	if c, _, _ := e.do(t, "GET", "/api/tickets/TK-00000000-9999", nil, ""); c != 404 {
		t.Errorf("未知工单应 404，得到 %d", c)
	}
	if c, _, _ := e.do(t, "GET", "/api/tickets/"+pathEscape, nil, ""); c != 404 {
		t.Errorf("注入型编号应 404，得到 %d", c)
	}
	if c, body, _ := e.do(t, "GET", "/api/nope", nil, ""); c != 404 || body["code"] != "not_found" {
		t.Errorf("未匹配的 /api/* 必须回 JSON 404：%d", c)
	}

	// 策略表：16 行，等级×严重级
	code, body, _ = e.do(t, "GET", "/api/sla/policies", nil, "")
	if code != 200 || len(body["items"].([]any)) != 16 {
		t.Fatalf("策略表应为 16 行：%d %v", code, len(body["items"].([]any)))
	}
}

const pathEscape = "CU-1%27%20OR%20%271%27=%271"

// TestAuthMatrix 是鉴权三层：未配令牌 503（fail-closed）、缺/错格式 401、令牌不符 403。
func TestAuthMatrix(t *testing.T) {
	e := newEnv(t, testToken, fixedNow)
	payload := map[string]any{"title": "鉴权矩阵用例标题", "customer": "CU-1001", "severity": "S3"}
	cases := []struct {
		name string
		auth string
		want int
	}{
		{"缺 Authorization", "", 401},
		{"非 Bearer 方案", "Basic abc", 401},
		{"Bearer 空值", "Bearer ", 401},
		{"Bearer 极短令牌（格式合法但不匹配）", "Bearer a", 403},
		{"Bearer 错误令牌", bearer("wrong-token"), 403},
		{"Bearer 正确令牌", bearer(testToken), 201},
	}
	for _, c := range cases {
		code, body, _ := e.do(t, "POST", "/api/tickets", payload, c.auth)
		if code != c.want {
			t.Errorf("%s：期望 %d，得到 %d（%v）", c.name, c.want, code, body["code"])
		}
	}
	// 读接口不需要令牌
	if c, _, _ := e.do(t, "GET", "/api/tickets?page_size=1", nil, ""); c != 200 {
		t.Errorf("读接口不该要求令牌：%d", c)
	}

	// 独立实例：没配 ADMIN_TOKEN 时写接口必须 503，绝不因期望值为空而放行
	noTok := newEnv(t, "", fixedNow)
	code, body, _ := noTok.do(t, "POST", "/api/tickets", payload, bearer("anything"))
	if code != http.StatusServiceUnavailable || body["code"] != "server_misconfigured" {
		t.Errorf("未配置令牌应 503 server_misconfigured，得到 %d %v", code, body["code"])
	}
	code, _, _ = noTok.do(t, "GET", "/api/stats", nil, "")
	if code != 200 {
		t.Errorf("未配置令牌不该影响读接口：%d", code)
	}
}

// TestCreateValidationMatrix 逐字段回显 + 注入与超长边界。
func TestCreateValidationMatrix(t *testing.T) {
	e := newEnv(t, testToken, fixedNow)
	_, customers, _ := e.do(t, "GET", "/api/customers", nil, "")
	list := customers["items"].([]any)
	var active, inactive string
	for _, it := range list {
		c := it.(map[string]any)
		code := c["code"].(string)
		if c["active"] == true && active == "" {
			active = code
		}
		if c["active"] == false {
			inactive = code
		}
	}
	if active == "" || inactive == "" {
		t.Fatal("种子需同时有在用与停用客户")
	}

	base := map[string]any{"title": "校验矩阵基线单", "customer": active, "severity": "S2",
		"category": "数据库", "channel": "工单门户"}
	okCode, body, raw := e.do(t, "POST", "/api/tickets", base, bearer(testToken))
	if okCode != 201 {
		t.Fatalf("基线建单应 201：%d %s", okCode, truncate(raw))
	}
	tk := body["ticket"].(map[string]any)
	if tk["priority"] == nil || tk["resolve_target_bd"] == nil {
		t.Error("建单响应缺少优先级/时效快照")
	}
	if tk["due_at"] == "" || tk["due_at"].(string)[:10] < "2026-09-26" {
		t.Errorf("到期点应不早于建单日：%v", tk["due_at"])
	}

	cases := []struct {
		name   string
		patch  func(map[string]any)
		want   int
		codeW  string
		fieldW string
	}{
		{"标题过短", func(m map[string]any) { m["title"] = "太短" }, 400, "invalid_request", "title"},
		{"标题过长", func(m map[string]any) { m["title"] = strings.Repeat("长", 81) }, 400, "invalid_request", "title"},
		{"描述超长", func(m map[string]any) { m["description"] = strings.Repeat("描", 501) }, 400, "invalid_request", "description"},
		{"缺客户编号", func(m map[string]any) { m["customer"] = "" }, 400, "invalid_request", "customer"},
		{"客户编号注入", func(m map[string]any) { m["customer"] = "CU-1' OR '1'='1" }, 400, "invalid_request", "customer"},
		{"严重级非法", func(m map[string]any) { m["severity"] = "S9" }, 400, "invalid_request", "severity"},
		{"分类不在字典", func(m map[string]any) { m["category"] = "量子通信" }, 400, "invalid_request", "category"},
		{"渠道不在字典", func(m map[string]any) { m["channel"] = "信鸽" }, 400, "invalid_request", "channel"},
		{"工程师编号非法", func(m map[string]any) { m["agent"] = "AG/../etc" }, 400, "invalid_request", "agent"},
		{"客户不存在", func(m map[string]any) { m["customer"] = "CU-9999" }, 404, "customer_not_found", ""},
		{"客户已停用", func(m map[string]any) { m["customer"] = inactive }, 409, "customer_inactive", ""},
		{"同名在办单查重", func(m map[string]any) { m["title"] = "校验矩阵基线单" }, 409, "duplicate_open_ticket", ""},
	}
	for _, c := range cases {
		payload := map[string]any{}
		for k, v := range base {
			payload[k] = v
		}
		payload["title"] = payload["title"].(string) + "-变体"
		if c.name == "同名在办单查重" || c.name == "标题过短" || c.name == "标题过长" {
			// 这三个用例就是针对 title 的，保留各自期望值
		}
		c.patch(payload)
		code, body, raw := e.do(t, "POST", "/api/tickets", payload, bearer(testToken))
		if code != c.want {
			t.Errorf("%s：期望 %d 得到 %d：%s", c.name, c.want, code, truncate(raw))
			continue
		}
		if body["code"] != c.codeW {
			t.Errorf("%s：错误码期望 %q 得到 %v", c.name, c.codeW, body["code"])
		}
		if c.fieldW != "" {
			fields, _ := body["fields"].(map[string]any)
			if _, ok := fields[c.fieldW]; !ok {
				t.Errorf("%s：fields 应含 %q，实际 %v", c.name, c.fieldW, fields)
			}
		}
	}

	// 请求体大小上限：超限必须是 400，而不是把超长串塞进库
	oversize := map[string]any{"title": "超长请求体边界用例", "customer": active, "severity": "S2",
		"description": strings.Repeat("数", 40000)}
	if c, _, _ := e.do(t, "POST", "/api/tickets", oversize, bearer(testToken)); c != 400 {
		t.Errorf("超长请求体应 400，得到 %d", c)
	}
	if c, body, _ := e.do(t, "POST", "/api/tickets", "not-json", bearer(testToken)); c != 400 || body["code"] != "invalid_request" {
		t.Errorf("非 JSON 请求体应 400：%d", c)
	}
	// 非法 JSON 之后工单总数不应被污染
	_, stats, _ := e.do(t, "GET", "/api/stats", nil, "")
	if int64(stats["total"].(float64)) <= 300 {
		t.Error("统计总数异常")
	}
}

// TestStateMachineAndPauseClock 走通整条状态机，并检验停表确实让时效停住。
func TestStateMachineAndPauseClock(t *testing.T) {
	e := newEnv(t, testToken, fixedNow)
	_, customers, _ := e.do(t, "GET", "/api/customers", nil, "")
	customer := customers["items"].([]any)[0].(map[string]any)["code"].(string)
	_, agents, _ := e.do(t, "GET", "/api/agents", nil, "")
	agent := ""
	for _, it := range agents["items"].([]any) {
		a := it.(map[string]any)
		if a["active"] == true {
			agent = a["code"].(string)
			break
		}
	}
	if agent == "" {
		t.Fatal("没有在用工程师")
	}

	_, body, raw := e.do(t, "POST", "/api/tickets", map[string]any{
		"title": "状态机全流程工单", "customer": customer, "severity": "S1",
		"category": "安全事件", "channel": "监控告警"}, bearer(testToken))
	if body == nil {
		t.Fatalf("建单失败：%s", truncate(raw))
	}
	code := body["ticket"].(map[string]any)["code"].(string)
	st := func() (map[string]any, map[string]any) {
		_, b, _ := e.do(t, "GET", "/api/tickets/"+code, nil, "")
		return b["ticket"].(map[string]any), b["ledger"].(map[string]any)
	}

	// 未派单直接推进到「已派单」→ 409
	if c, b, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StAssigned}, bearer(testToken)); c != 409 || b["code"] != "agent_required" {
		t.Errorf("缺工程师推进应 409 agent_required：%d %v", c, b["code"])
	}
	// 非法跳转：new → resolved
	if c, b, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StResolved}, bearer(testToken)); c != 409 || b["code"] != "invalid_transition" {
		t.Errorf("new→resolved 应 409 invalid_transition：%d %v", c, b["code"])
	}
	// 重复状态
	if c, b, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StNew}, bearer(testToken)); c != 409 || b["code"] != "same_status" {
		t.Errorf("同状态推进应 409 same_status：%d %v", c, b["code"])
	}
	// 未知状态
	if c, _, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": "sleeping"}, bearer(testToken)); c != 400 {
		t.Errorf("未知状态应 400，得到 %d", c)
	}

	// 派单 → 处理中
	if c, _, _ := e.do(t, "POST", "/api/tickets/"+code+"/assign", map[string]any{"agent": agent}, bearer(testToken)); c != 200 {
		t.Fatalf("派单失败：%d", c)
	}
	row, _ := st()
	if row["status"] != domain.StAssigned || row["first_response_at"] == nil {
		t.Errorf("派单后应已首响：%v", row["status"])
	}
	// 时间线必须记的是「跃迁」而不是跃迁后的两个相同状态，否则这本账没法审计。
	_, tlBody, _ := e.do(t, "GET", "/api/tickets/"+code, nil, "")
	timeline := tlBody["timeline"].([]any)
	last := timeline[len(timeline)-1].(map[string]any)
	if last["kind"] != "assigned" || last["from_status"] != domain.StNew || last["to_status"] != domain.StAssigned {
		t.Errorf("派单事件应记为 new→assigned，实际 %v %v→%v", last["kind"], last["from_status"], last["to_status"])
	}
	if c, _, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StWorking}, bearer(testToken)); c != 200 {
		t.Fatalf("推进到处理中失败：%d", c)
	}

	// 停表：缺原因 400；字典外原因 400；正常 200
	if c, _, _ := e.do(t, "POST", "/api/tickets/"+code+"/pause", map[string]any{"note": "等客户"}, bearer(testToken)); c != 400 {
		t.Errorf("停表缺原因应 400，得到 %d", c)
	}
	if c, b, _ := e.do(t, "POST", "/api/tickets/"+code+"/pause", map[string]any{"reason": "等客户吃饭"}, bearer(testToken)); c != 400 || b["code"] != "invalid_request" {
		t.Errorf("停表原因不在字典应 400：%d", c)
	}
	if c, _, rawBody := e.do(t, "POST", "/api/tickets/"+code+"/pause", map[string]any{"reason": "等客户授权", "note": "变更需客户授权"}, bearer(testToken)); c != 200 {
		t.Fatalf("停表失败：%d %s", c, truncate(rawBody))
	}
	row, ledger := st()
	if row["status"] != domain.StPending || row["paused_since"] == nil {
		t.Errorf("停表后状态/起点不符：%v", row["status"])
	}
	if ledger["identity_clock_ok"] != true || ledger["identity_timeline_ok"] != true {
		t.Error("停表中的账本不自洽")
	}
	// 重复停表 → 409（状态机层面就是同状态推进）
	if c, b, _ := e.do(t, "POST", "/api/tickets/"+code+"/pause", map[string]any{"reason": "等客户复现"}, bearer(testToken)); c != 409 || b["code"] != "same_status" {
		t.Errorf("重复停表应 409 same_status：%d %v", c, b["code"])
	}
	// 恢复计时：回到停表前的状态，并把这段停表结算进账
	if c, _, _ := e.do(t, "POST", "/api/tickets/"+code+"/resume", map[string]any{"note": "客户已回复"}, bearer(testToken)); c != 200 {
		t.Fatalf("恢复计时失败：%d", c)
	}
	row, ledger = st()
	if row["status"] != domain.StWorking {
		t.Errorf("恢复后应回到停表前状态 in_progress，实际 %v", row["status"])
	}
	if row["paused_since"] != nil {
		t.Error("恢复计时后仍留着停表起点，账会一直挂空")
	}
	_, rb, _ := e.do(t, "GET", "/api/tickets/"+code, nil, "")
	rl := rb["timeline"].([]any)
	lastResume := rl[len(rl)-1].(map[string]any)
	if lastResume["kind"] != "resumed" || lastResume["to_status"] != domain.StWorking {
		t.Errorf("恢复事件应记为 →in_progress，实际 %v %v→%v",
			lastResume["kind"], lastResume["from_status"], lastResume["to_status"])
	}
	// 建单时刻落在周六非工作日：挂钟在走，工作分钟必须一步不动
	if row["elapsed_bd_minutes"].(float64) != 0 {
		t.Errorf("非工作日建的单此刻应零计时，实际 %v", row["elapsed_bd_minutes"])
	}
	if ledger["business_minutes"].(float64) != 0 {
		t.Errorf("非工作日的工作分钟应为 0，实际 %v", ledger["business_minutes"])
	}
	// 时钟冻在建单那一刻，挂钟差恒为 0；能证明「非工作日零计时」的是到期点：
	// 周六 09:00 起算的 SLA 必须整段跳过周末，落到调休上班日 2026-09-27 之后。
	if row["due_at"].(string) < "2026-09-27" {
		t.Errorf("周六建的单，到期点应顺延到调休周日之后，实际 %v", row["due_at"])
	}
	// 再停一次再恢复：两轮停表事件对必须都能被时间线复算
	if c, _, _ := e.do(t, "POST", "/api/tickets/"+code+"/pause", map[string]any{"reason": "等厂商备件"}, bearer(testToken)); c != 200 {
		t.Fatalf("二次停表失败：%d", c)
	}
	if c, b, _ := e.do(t, "POST", "/api/tickets/"+code+"/resume", map[string]any{}, bearer(testToken)); c != 200 {
		t.Fatalf("二次恢复失败：%d %v", c, b["code"])
	}
	_, ledger = st()
	if ledger["identity_timeline_ok"] != true || ledger["identity_clock_ok"] != true {
		t.Errorf("两轮停表后账本不自洽：%v", ledger)
	}
	if c, b, _ := e.do(t, "POST", "/api/tickets/"+code+"/resume", map[string]any{}, bearer(testToken)); c != 409 || b["code"] != "not_paused" {
		t.Errorf("未停表恢复应 409 not_paused：%d %v", c, b["code"])
	}

	// 解决 → 验收关单 → 终态不可回退
	if c, _, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StResolved, "note": "已恢复"}, bearer(testToken)); c != 200 {
		t.Fatalf("解决失败：%d", c)
	}
	row, ledger = st()
	if row["resolved_at"] == nil || row["resolve_bd_minutes"] == nil {
		t.Error("解决后缺少结算字段")
	}
	if ledger["identity_clock_ok"] != true {
		t.Error("结算后的账本不自洽")
	}
	if c, b, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StClosed}, bearer(testToken)); c != 200 || b["ticket"].(map[string]any)["status"] != domain.StClosed {
		t.Fatalf("关单失败：%d", c)
	}
	for _, to := range []string{domain.StWorking, domain.StResolved, domain.StClosed, domain.StCanceled} {
		c, b, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": to}, bearer(testToken))
		if c != 409 {
			t.Errorf("终态 closed 推进到 %s 应 409，得到 %d %v", to, c, b["code"])
		}
	}
	// 结清之后同名可以再提（部分唯一索引只覆盖在办状态）
	c2, b2, raw2 := e.do(t, "POST", "/api/tickets", map[string]any{
		"title": "状态机全流程工单", "customer": customer, "severity": "S1"}, bearer(testToken))
	if c2 != 201 {
		t.Errorf("结清后同名再提应 201：%d %v %s", c2, b2["code"], truncate(raw2))
	}
	// 未知工单
	if c, _, _ := e.do(t, "PATCH", "/api/tickets/TK-20260101-0001/status", map[string]any{"status": domain.StWorking}, bearer(testToken)); c != 404 {
		t.Errorf("未知工单应 404：%d", c)
	}
}

// TestReopenLimit 检验「客户验收不通过最多重开两次」。
func TestReopenLimit(t *testing.T) {
	e := newEnv(t, testToken, fixedNow)
	_, customers, _ := e.do(t, "GET", "/api/customers", nil, "")
	customer := customers["items"].([]any)[0].(map[string]any)["code"].(string)
	_, agents, _ := e.do(t, "GET", "/api/agents", nil, "")
	agent := agents["items"].([]any)[0].(map[string]any)["code"].(string)

	_, body, raw := e.do(t, "POST", "/api/tickets", map[string]any{
		"title": "重开次数上限用例", "customer": customer, "severity": "S3",
		"agent": agent}, bearer(testToken))
	if body == nil {
		t.Fatalf("建单失败：%s", truncate(raw))
	}
	code := body["ticket"].(map[string]any)["code"].(string)
	if c, _, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StWorking}, bearer(testToken)); c != 200 {
		t.Fatalf("进入处理中失败：%d", c)
	}
	for i := 1; i <= 3; i++ {
		c, b, _ := e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StResolved}, bearer(testToken))
		if c != 200 {
			t.Fatalf("第 %d 轮解决失败：%d %v", i, c, b["code"])
		}
		c, b, _ = e.do(t, "PATCH", "/api/tickets/"+code+"/status", map[string]any{"status": domain.StWorking, "note": "客户说没修好"}, bearer(testToken))
		if i <= 2 {
			if c != 200 {
				t.Errorf("第 %d 次重开应放行，得到 %d %v", i, c, b["code"])
			}
			continue
		}
		if c != 409 || b["code"] != "reopen_limit" {
			t.Errorf("第 3 次重开应 409 reopen_limit，得到 %d %v", c, b["code"])
		}
		// 重开被拒不能把状态改坏
		_, detail, _ := e.do(t, "GET", "/api/tickets/"+code, nil, "")
		tk := detail["ticket"].(map[string]any)
		if tk["status"] != domain.StResolved {
			t.Errorf("重开被拒后应停在已解决，实际 %v", tk["status"])
		}
		if tk["reopen_count"].(float64) != 2 {
			t.Errorf("重开计数应为 2，实际 %v", tk["reopen_count"])
		}
	}
}

// TestPolicyTableIsLive 证明策略是表而不是常量：改一行，新单立刻用新时效，在办单不回溯。
func TestPolicyTableIsLive(t *testing.T) {
	e := newEnv(t, testToken, fixedNow)
	_, customers, _ := e.do(t, "GET", "/api/customers", nil, "")
	var gold string
	for _, it := range customers["items"].([]any) {
		c := it.(map[string]any)
		if c["tier"] == domain.TierGold && c["active"] == true {
			gold = c["code"].(string)
			break
		}
	}
	if gold == "" {
		t.Fatal("缺少在用 gold 客户")
	}
	_, before, _ := e.do(t, "GET", "/api/tickets?customer="+gold+"&page_size=1", nil, "")
	_ = before

	// 基线策略：gold × S2
	_, body, _ := e.do(t, "POST", "/api/tickets", map[string]any{
		"title": "策略变更前建的单", "customer": gold, "severity": "S2"}, bearer(testToken))
	if body == nil {
		t.Fatal("基线建单失败")
	}
	baseline := body["ticket"].(map[string]any)
	oldTarget := baseline["resolve_target_bd"]

	c, p, _ := e.do(t, "GET", "/api/sla/policies", nil, "")
	if c != 200 {
		t.Fatalf("策略读失败：%d", c)
	}
	var goldS2 map[string]any
	for _, it := range p["items"].([]any) {
		x := it.(map[string]any)
		if x["tier"] == domain.TierGold && x["severity"] == "S2" {
			goldS2 = x
		}
	}
	if goldS2 == nil {
		t.Fatal("策略表缺 gold × S2")
	}

	newResolve := int(goldS2["resolve_min"].(float64)) + 300
	c, body, raw := e.do(t, "POST", "/api/sla/policies", map[string]any{
		"tier": domain.TierGold, "severity": "S2",
		"response_min": int(goldS2["response_min"].(float64)), "resolve_min": newResolve}, bearer(testToken))
	if c != 200 {
		t.Fatalf("策略更新应 200：%d %s", c, truncate(raw))
	}
	if body["created"] != false || body["policy"].(map[string]any)["resolve_min"].(float64) != float64(newResolve) {
		t.Errorf("策略更新回显不对：%v", body["created"])
	}

	_, after, _ := e.do(t, "POST", "/api/tickets", map[string]any{
		"title": "策略变更后建的单", "customer": gold, "severity": "S2"}, bearer(testToken))
	newTarget := after["ticket"].(map[string]any)["resolve_target_bd"]
	if newTarget.(float64) != float64(newResolve) {
		t.Errorf("新单应取新策略 %d，实际 %v", newResolve, newTarget)
	}
	_, oldRow, _ := e.do(t, "GET", "/api/tickets/"+baseline["code"].(string), nil, "")
	if oldRow["ticket"].(map[string]any)["resolve_target_bd"] != oldTarget {
		t.Error("在办工单的时效快照被合同变更回改了")
	}

	// 策略校验矩阵
	bad := []map[string]any{
		{"tier": "diamond", "severity": "S2", "response_min": 20, "resolve_min": 600},
		{"tier": domain.TierGold, "severity": "S9", "response_min": 20, "resolve_min": 600},
		{"tier": domain.TierGold, "severity": "S2", "response_min": 1, "resolve_min": 600},
		{"tier": domain.TierGold, "severity": "S2", "response_min": 20, "resolve_min": 10},
		{"tier": domain.TierGold, "severity": "S2", "response_min": 20, "resolve_min": 30000},
	}
	for i, b := range bad {
		c, body, _ := e.do(t, "POST", "/api/sla/policies", b, bearer(testToken))
		if c != 400 || body["code"] != "invalid_request" {
			t.Errorf("非法策略 %d 应 400：%d %v", i, c, body["code"])
		}
	}
	// 未知工单的写操作 404
	if c, _, _ := e.do(t, "POST", "/api/tickets/TK-19990101-0001/pause", map[string]any{"reason": "等客户复现"}, bearer(testToken)); c != 404 {
		t.Errorf("未知工单停表应 404：%d", c)
	}
}
