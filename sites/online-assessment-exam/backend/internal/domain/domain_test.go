package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func opts(items ...string) string { return "[" + strings.Join(items, "|@|") + "]" }

func marshalQuestion(q Question) (string, error) {
	b, err := json.Marshal(q)
	return string(b), err
}

func marshalView(v QuestionView) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func TestGradeItemAllTypes(t *testing.T) {
	cases := []struct {
		name        string
		q           Question
		picked      string
		wantAwarded int
		wantCorrect bool
	}{
		{"单选-正确", Question{Type: TypeSingle, Answer: "B", Score: 8, Options: opts("甲", "乙", "丙")}, "B", 8, true},
		{"单选-大小写与空格", Question{Type: TypeSingle, Answer: "B", Score: 8}, "  b  ", 8, true},
		{"单选-错误", Question{Type: TypeSingle, Answer: "B", Score: 8}, "C", 0, false},
		{"单选-未作答", Question{Type: TypeSingle, Answer: "B", Score: 8}, "", 0, false},
		{"判断-正确", Question{Type: TypeJudge, Answer: "T", Score: 10}, "正确", 10, true},
		{"判断-错误", Question{Type: TypeJudge, Answer: "T", Score: 10}, "F", 0, false},
		{"多选-全对", Question{Type: TypeMulti, Answer: "AC", Score: 12}, "A,C", 12, true},
		{"多选-乱序全对", Question{Type: TypeMulti, Answer: "AC", Score: 12}, "ca", 12, true},
		{"多选-只漏选得半分（向下取整）", Question{Type: TypeMulti, Answer: "ABD", Score: 15}, "AB", 7, false},
		{"多选-含错选不得分", Question{Type: TypeMulti, Answer: "AB", Score: 12}, "ABC", 0, false},
		{"多选-全错", Question{Type: TypeMulti, Answer: "AB", Score: 12}, "CD", 0, false},
		{"多选-重复字母只算一次", Question{Type: TypeMulti, Answer: "AB", Score: 12}, "AAA", 6, false},
		{"odd-奇数满分漏选截断", Question{Type: TypeMulti, Answer: "ABC", Score: 9}, "AB", 4, false},
		{"填空-忽略大小写与空格", Question{Type: TypeBlank, Answer: "0xFF", Score: 12}, " 0Xff ", 12, true},
		{"填空-答案写错", Question{Type: TypeBlank, Answer: "health", Score: 6}, "/api/metric", 0, false},
		{"填空-全角空格被去掉", Question{Type: TypeBlank, Answer: "nlogn", Score: 12}, "n log n", 12, true},
		{"标准答案缺失时不得分", Question{Type: TypeSingle, Answer: "", Score: 8}, "A", 0, false},
		{"注入串当选择不给分", Question{Type: TypeSingle, Answer: "B", Score: 8}, "'; DROP TABLE attempts; --", 0, false},
		{"多选注入串按含错选处理", Question{Type: TypeMulti, Answer: "AB", Score: 12}, "A;DELETE", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			awarded, correct := GradeItem(&tc.q, tc.picked)
			if awarded != tc.wantAwarded || correct != tc.wantCorrect {
				t.Fatalf("GradeItem(%q) = (%d,%v)，期望 (%d,%v)", tc.picked, awarded, correct, tc.wantAwarded, tc.wantCorrect)
			}
			if awarded > tc.q.Score {
				t.Fatalf("得分 %d 超过满分 %d", awarded, tc.q.Score)
			}
			if !correct && awarded == tc.q.Score && tc.q.Score > 0 {
				t.Fatalf("判为错误却拿了满分")
			}
		})
	}
}

func TestNormalizePicked(t *testing.T) {
	cases := []struct{ qType, raw, want string }{
		{TypeMulti, "c, a, b", "ABC"},
		{TypeMulti, "CA", "AC"},
		{TypeMulti, "1!2@#3", ""},
		{TypeSingle, "b", "B"},
		{TypeJudge, "正确", "T"},
		{TypeJudge, "不正确", "F"}, // 否定词优先，不能被「正确」抢先命中
		{TypeJudge, "√", "T"},
		{TypeJudge, "√√", "T"},
		{TypeSingle, "正确", ""}, // 单选不认文字，归一化成未作答
		{TypeJudge, "错误 F", "F"},
		{TypeBlank, "  Ab C ", "abc"},
		{TypeBlank, "　x　", "x"},
	}
	for _, tc := range cases {
		if got := NormalizePicked(tc.qType, tc.raw); got != tc.want {
			t.Errorf("NormalizePicked(%s,%q)=%q，期望 %q", tc.qType, tc.raw, got, tc.want)
		}
	}
}

func TestTotalScorePercentAndMask(t *testing.T) {
	qs := []Question{{Score: 40}, {Score: 35}, {Score: 25}}
	if got := TotalScore(qs); got != 100 {
		t.Fatalf("TotalScore=%d，期望 100", got)
	}
	pcases := []struct {
		score, total, want int
	}{
		{59, 100, 59}, {60, 100, 60}, {99, 100, 99}, {100, 100, 100},
		{7, 12, 58}, {1, 3, 33}, {0, 0, 0}, {5, 0, 0},
	}
	for _, tc := range pcases {
		if got := Percent(tc.score, tc.total); got != tc.want {
			t.Errorf("Percent(%d,%d)=%d，期望 %d", tc.score, tc.total, got, tc.want)
		}
	}
	mpcases := []struct{ in, want string }{
		{"13812345678", "138****5678"},
		{"", ""},
		{"1234567890123456", "****************"},
		{"138", "***"},
		{" 13812345678 ", "138****5678"},
	}
	for _, tc := range mpcases {
		if got := MaskPhone(tc.in); got != tc.want {
			t.Errorf("MaskPhone(%q)=%q，期望 %q", tc.in, got, tc.want)
		}
	}
}

func TestOptionListAndView(t *testing.T) {
	q := Question{Code: "X-Q01", Type: TypeSingle, Stem: "题干", Options: opts("甲", "乙"), Answer: "A", Score: 4}
	view := q.View()
	if len(view.Options) != 2 || view.Options[0] != "甲" {
		t.Fatalf("OptionList 解析错误: %+v", view.Options)
	}
	if view.Code != "X-Q01" || view.Score != 4 {
		t.Fatalf("View 字段丢失: %+v", view)
	}
	raw, err := marshalQuestion(q)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "甲") || strings.Contains(raw, `"answer"`) || strings.Contains(raw, `"options"`) {
		t.Fatalf("题目序列化泄露卷面/答案: %s", raw)
	}
	vraw, _ := marshalView(view)
	if strings.Contains(vraw, `"answer"`) {
		t.Fatalf("视图序列化泄露答案: %s", vraw)
	}
}

func TestAttemptInputValidation(t *testing.T) {
	cases := []struct {
		name       string
		in         StartAttemptInput
		wantOK     bool
		wantFields []string
	}{
		{"合法", StartAttemptInput{Name: "赵子墨", Phone: "13812345678", Channel: "web"}, true, nil},
		{"缺渠道按 web 处理", StartAttemptInput{Name: "李", Phone: "13900000000"}, true, nil},
		{"空姓名", StartAttemptInput{Name: "", Phone: "13812345678"}, false, []string{"name"}},
		{"超长姓名", StartAttemptInput{Name: strings.Repeat("长", 33), Phone: "13812345678"}, false, []string{"name"}},
		{"手机号少一位", StartAttemptInput{Name: "王", Phone: "1381234567"}, false, []string{"phone"}},
		{"手机号非数字", StartAttemptInput{Name: "王", Phone: "1381234567a"}, false, []string{"phone"}},
		{"手机号注入串", StartAttemptInput{Name: "王", Phone: "1' OR '1'='1"}, false, []string{"phone"}},
		{"未知渠道", StartAttemptInput{Name: "王", Phone: "13812345678", Channel: "sms"}, false, []string{"channel"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("Validate ok=%v，期望 %v（errs=%v）", ok, tc.wantOK, errs)
			}
			for _, f := range tc.wantFields {
				if _, hit := errs[f]; !hit {
					t.Errorf("期望 %s 报错，实际 %v", f, errs)
				}
			}
		})
	}
}

func TestSubmitInputValidation(t *testing.T) {
	long := strings.Repeat("A", 65)
	cases := []struct {
		name       string
		in         SubmitInput
		wantOK     bool
		wantFields []string
	}{
		{"合法", SubmitInput{Answers: []AnswerInput{{"Q1", "A"}, {"Q2", "BC"}}}, true, nil},
		{"空提交", SubmitInput{}, false, []string{"answers"}},
		{"未答题允许空串", SubmitInput{Answers: []AnswerInput{{"Q1", ""}}}, true, nil},
		{"重复题号", SubmitInput{Answers: []AnswerInput{{"Q1", "A"}, {"Q1", "B"}}}, false, []string{"answers[1].question_code"}},
		{"非法题号（注入）", SubmitInput{Answers: []AnswerInput{{"Q1'; DROP", "A"}}}, false, []string{"answers[0].question_code"}},
		{"超长作答", SubmitInput{Answers: []AnswerInput{{"Q1", long}}}, false, []string{"answers[0].picked"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("Validate ok=%v，期望 %v（errs=%v）", ok, tc.wantOK, errs)
			}
			for _, f := range tc.wantFields {
				if _, hit := errs[f]; !hit {
					t.Errorf("期望 %s 报错，实际 %v", f, errs)
				}
			}
		})
	}
}

func TestAssessmentStatusMachine(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{AsmtDraft, AsmtOpen, true},
		{AsmtOpen, AsmtClosed, true},
		{AsmtDraft, AsmtClosed, false},
		{AsmtOpen, AsmtDraft, false},
		{AsmtClosed, AsmtOpen, false},
		{AsmtClosed, AsmtClosed, false},
		{"weird", AsmtOpen, false},
	}
	for _, tc := range cases {
		if got := CanMoveAssessment(tc.from, tc.to); got != tc.want {
			t.Errorf("CanMoveAssessment(%s,%s)=%v，期望 %v", tc.from, tc.to, got, tc.want)
		}
	}
	in := AssessmentStatusInput{To: "reopen"}
	if _, ok := in.Validate(); ok {
		t.Fatal("非法目标状态应校验失败")
	}
}

func TestQueryParsingClamps(t *testing.T) {
	vals := map[string][]string{
		"page_size": {"99999"}, "page": {"-3"},
		"sort":   {"score; DROP TABLE attempts"},
		"dir":    {"DESC"},
		"q":      {strings.Repeat("很", 200)},
		"status": {"bogus"},
	}
	aq := ParseAssessmentQuery(vals)
	if aq.PageSize != MaxPageSize {
		t.Errorf("page_size 未钳到上限: %d", aq.PageSize)
	}
	if aq.Page != 1 {
		t.Errorf("非法页码应收敛为 1，实际 %d", aq.Page)
	}
	if aq.Sort != assessmentSorts["opens_at"] {
		t.Errorf("非法排序字段应回落到白名单默认值，实际 %q", aq.Sort)
	}
	if aq.Status != "" {
		t.Errorf("非法 status 应忽略，实际 %q", aq.Status)
	}
	if len([]rune(aq.Search)) != MaxQueryRunes {
		t.Errorf("搜索串未截断: %d", len([]rune(aq.Search)))
	}
	if aq.Dir != "desc" {
		t.Errorf("dir=%s", aq.Dir)
	}
	vals2 := map[string][]string{"sort": {"rank"}, "dir": {"asc"}, "passed": {"yes"}, "channel": {"campus"}, "status": {"graded"}}
	tq := ParseAttemptQuery(vals2)
	if tq.Sort != attemptSorts["rank"] || tq.Dir != "asc" || tq.Passed != "yes" || tq.Channel != "campus" || tq.Status != "graded" {
		t.Fatalf("名单参数解析异常: %+v", tq)
	}
	vals3 := map[string][]string{"sort": {"rank"}, "passed": {"maybe"}, "channel": {"'; --"}}
	tq3 := ParseAttemptQuery(vals3)
	if tq3.Passed != "" || tq3.Channel != "" {
		t.Fatalf("名单的枚举/渠道参数必须走白名单: %+v", tq3)
	}
	if tq.Offset() != 0 {
		t.Errorf("Offset=%d", tq.Offset())
	}
}
