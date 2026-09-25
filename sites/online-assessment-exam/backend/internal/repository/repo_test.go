package repository

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

var testNow = time.Date(2026, 9, 25, 9, 0, 0, 0, time.UTC)

func newTestRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), testNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r
}

// TestSeedPapersAreWellFormed 断言每份卷满分恰为 100、题量与状态分布符合设计。
func TestSeedPapersAreWellFormed(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	var asmts []domain.Assessment
	if err := r.db.WithContext(ctx).Order("code asc").Find(&asmts).Error; err != nil {
		t.Fatal(err)
	}
	if len(asmts) != len(papers) {
		t.Fatalf("试卷数 %d，期望 %d", len(asmts), len(papers))
	}
	statusCount := map[string]int{}
	for _, a := range asmts {
		qs, err := r.Questions(ctx, a.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got := domain.TotalScore(qs); got != 100 {
			t.Errorf("%s 满分 %d，期望 100", a.Code, got)
		}
		if a.PassScore <= 0 || a.PassScore > 100 {
			t.Errorf("%s 通过线 %d 越界", a.Code, a.PassScore)
		}
		if len(qs) < 8 {
			t.Errorf("%s 题量 %d 少于 8", a.Code, len(qs))
		}
		for _, q := range qs {
			if q.Score <= 0 || q.Score > 20 {
				t.Errorf("%s 分值异常: %d", q.Code, q.Score)
			}
			if !strings.HasPrefix(q.Code, a.Code+"-Q") {
				t.Errorf("题号 %s 不以场次编码 %s 开头", q.Code, a.Code)
			}
			switch q.Type {
			case domain.TypeSingle, domain.TypeJudge, domain.TypeBlank:
				if len(domain.NormalizePicked(q.Type, q.Answer)) == 0 {
					t.Errorf("%s 缺标准答案", q.Code)
				}
			case domain.TypeMulti:
				n := domain.NormalizePicked(q.Type, q.Answer)
				if len(n) < 2 {
					t.Errorf("%s 多选题至少两个正确项，实际 %q", q.Code, q.Answer)
				}
			default:
				t.Errorf("%s 未知题型 %s", q.Code, q.Type)
			}
		}
		statusCount[a.Status]++
	}
	want := map[string]int{domain.AsmtClosed: 3, domain.AsmtOpen: 2, domain.AsmtDraft: 1}
	for k, v := range want {
		if statusCount[k] != v {
			t.Errorf("状态 %s 有 %d 场，期望 %d", k, statusCount[k], v)
		}
	}
}

// TestSeedIdentityAndCoverage 是种子的账目自洽性：三分数恒等式、状态计数、
// 以及「半分」「作废」「进行中」三个业务分支必须真的被造出来。
func TestSeedIdentityAndCoverage(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	var ats []domain.Attempt
	if err := r.db.WithContext(ctx).Find(&ats).Error; err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{"graded": 0, "ongoing": 0, "invalid": 0}
	half, passed, failed := 0, 0, 0
	for _, a := range ats {
		counts[a.Status]++
		if a.Score != a.Mechanical+a.HalfCredit {
			t.Fatalf("%s 三分数不闭合: %d != %d + %d", a.AttemptNo, a.Score, a.Mechanical, a.HalfCredit)
		}
		if a.Status == domain.AttemptGraded {
			if a.Passed != (a.Score >= r.passScore(a.AssessmentID)) {
				t.Errorf("%s 通过标记 %v 与通过线 %d 不符（得分 %d）",
					a.AttemptNo, a.Passed, r.passScore(a.AssessmentID), a.Score)
			}
			if a.Passed {
				passed++
			} else {
				failed++
			}
			if a.HalfCredit > 0 {
				half++
			}
			if a.Score > 100 || a.Score < 0 {
				t.Errorf("%s 得分越界 %d", a.AttemptNo, a.Score)
			}
		}
		if a.Status == domain.AttemptInvalid && (a.Score != 0 || a.Passed) {
			t.Errorf("作废卷 %s 应记 0 分且不记通过", a.AttemptNo)
		}
	}
	if counts["graded"] < 120 {
		t.Errorf("已判分 %d 份，样本太少", counts["graded"])
	}
	if counts["invalid"] == 0 || counts["ongoing"] == 0 {
		t.Errorf("作废/进行中分支未被种子覆盖: %v", counts)
	}
	if half == 0 {
		t.Error("没有任何漏选半分样本，HalfCredit 口径未被验证")
	}
	if passed == 0 || failed == 0 {
		t.Errorf("通过/未通过都要有样本: %d/%d", passed, failed)
	}
	// Σ awarded == Score 必须由明细行成立（不只信汇总列）
	var mismatch int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM attempts a
	  WHERE a.status = 'graded'
	    AND a.score <> COALESCE((SELECT SUM(aa.awarded) FROM attempt_answers aa WHERE aa.attempt_id = a.id), 0)`).
		Scan(&mismatch).Error; err != nil {
		t.Fatal(err)
	}
	if mismatch != 0 {
		t.Fatalf("%d 份卷的明细分之和汇总分不一致", mismatch)
	}
}

func (r *Repo) passScore(id int64) int {
	var a domain.Assessment
	if err := r.db.Where("id = ?", id).First(&a).Error; err != nil {
		return 0
	}
	return a.PassScore
}

// TestItemsMatchAttempts 校验明细行数 = 已判分份数 × 题数（每份卷都全量判分）。
func TestItemsMatchAttempts(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	var total int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM
	  (SELECT a.assessment_id AS aid, COUNT(DISTINCT a.id) AS graded,
	          (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.assessment_id) AS qn
	     FROM attempts a WHERE a.status = 'graded' GROUP BY a.assessment_id)`).Scan(&total).Error; err != nil {
		t.Log("子查询口径跳过:", err)
	}
	_ = total
	var bad []struct {
		Aid  int64 `gorm:"column:aid"`
		Gr   int64 `gorm:"column:gr"`
		Qn   int64 `gorm:"column:qn"`
		Rows int64 `gorm:"column:rows_no"`
	}
	sql := `SELECT a.assessment_id AS aid,
		       COUNT(DISTINCT a.id) AS gr,
		       (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.assessment_id) AS qn,
		       (SELECT COUNT(*) FROM attempt_answers aa JOIN attempts b ON b.id = aa.attempt_id
		          WHERE b.assessment_id = a.assessment_id AND a.status = 'graded') AS rows_no
		  FROM attempts a WHERE a.status = 'graded' GROUP BY a.assessment_id`
	if err := r.db.WithContext(ctx).Raw(sql).Scan(&bad).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range bad {
		if row.Gr*row.Qn != row.Rows {
			t.Errorf("场次 %d：明细 %d 行，应为 %d 份 × %d 题", row.Aid, row.Rows, row.Gr, row.Qn)
		}
	}
}

func TestStartAttemptGuards(t *testing.T) {
	cases := []struct {
		name     string
		code     string
		in       domain.StartAttemptInput
		wantCode string
	}{
		{"闭卷场次拒答", "AS-2026-001", domain.StartAttemptInput{Name: "赵", Phone: "13800000001", Channel: "web"}, "assessment_not_open"},
		{"草稿场次拒答", "AS-2026-006", domain.StartAttemptInput{Name: "赵", Phone: "13800000002", Channel: "web"}, "assessment_not_open"},
	}
	r := newTestRepo(t)
	ctx := context.Background()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, err := r.AssessmentByCode(ctx, tc.code)
			if err != nil {
				t.Fatal(err)
			}
			_, err = r.StartAttempt(ctx, a.ID, tc.in, testNow)
			var ae *domain.AppError
			if !errors.As(err, &ae) || ae.Code != tc.wantCode {
				t.Fatalf("期望 %s，实际 %v", tc.wantCode, err)
			}
		})
	}
	openA, err := r.AssessmentByCode(ctx, "AS-2026-004")
	if err != nil {
		t.Fatal(err)
	}
	future := testNow.Add(365 * 24 * time.Hour)
	if _, err := r.StartAttempt(ctx, openA.ID, domain.StartAttemptInput{
		Name: "孙", Phone: "13800000009", Channel: "web"}, future); err == nil {
		t.Fatal("闭卷时间之后仍允许开考")
	} else {
		var ae *domain.AppError
		if !errors.As(err, &ae) || ae.Code != "closed" {
			t.Fatalf("期望 closed，实际 %v", err)
		}
	}
}

// TestDuplicatePhoneIsGuardedByUniqueIndex 同时验证应用层查重和数据库部分唯一索引。
func TestDuplicatePhoneIsGuardedByUniqueIndex(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	a, err := r.AssessmentByCode(ctx, "AS-2026-005")
	if err != nil {
		t.Fatal(err)
	}
	in := domain.StartAttemptInput{Name: "周", Phone: "13700001111", Channel: "campus"}
	first, err := r.StartAttempt(ctx, a.ID, in, testNow)
	if err != nil {
		t.Fatalf("首次开考失败: %v", err)
	}
	if first.Status != domain.AttemptOngoing || first.Phone != in.Phone {
		t.Fatalf("开考返回异常: %+v", first)
	}
	if _, err := r.StartAttempt(ctx, a.ID, in, testNow); err == nil {
		t.Fatal("同手机号重复开考应被拒绝")
	} else {
		var ae *domain.AppError
		if !errors.As(err, &ae) || ae.Code != "already_started" {
			t.Fatalf("期望 already_started，实际 %v", err)
		}
	}
	// 绕过应用层直接写库，唯一索引仍然挡住（防并发/防脚本）
	if err := r.db.WithContext(ctx).Create(&domain.Attempt{
		AttemptNo: "HACK-001", AssessmentID: a.ID, CandidateName: "越权", Phone: in.Phone,
		Channel: "web", StartedAt: testNow, Status: domain.AttemptOngoing,
	}).Error; err == nil || !strings.Contains(strings.ToLower(err.Error()), "unique") {
		t.Fatalf("部分唯一索引未生效，实际: %v", err)
	}
	// 作废卷不占位：把首份改成 invalid 后同手机号可再考
	if err := r.db.WithContext(ctx).Model(&domain.Attempt{}).Where("id = ?", first.ID).
		Update("status", domain.AttemptInvalid).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := r.StartAttempt(ctx, a.ID, in, testNow); err != nil {
		t.Fatalf("作废后应允许重考，实际: %v", err)
	}
}

func TestSubmitGradingMatchesEngine(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	a, err := r.AssessmentByCode(ctx, "AS-2026-004")
	if err != nil {
		t.Fatal(err)
	}
	at, err := r.StartAttempt(ctx, a.ID, domain.StartAttemptInput{
		Name: "满分卷", Phone: "13600001234", Channel: "web"}, testNow)
	if err != nil {
		t.Fatal(err)
	}
	qs, err := r.Questions(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 故意漏选一题：多选题去掉最后一个正确项 -> 半分
	answers := make([]domain.AnswerInput, 0, len(qs))
	wantScore, wantMech, wantHalf := 0, 0, 0
	for i := range qs {
		q := &qs[i]
		picked := q.Answer
		if q.Type == domain.TypeMulti {
			ans := domain.NormalizePicked(q.Type, q.Answer)
			picked = string([]rune(ans)[:len(ans)-1])
		}
		awarded, correct := domain.GradeItem(q, picked)
		if correct {
			wantMech += awarded
		} else {
			wantHalf += awarded
		}
		wantScore += awarded
		answers = append(answers, domain.AnswerInput{QuestionCode: q.Code, Picked: picked})
	}
	got, gotAsmt, err := r.SubmitAttempt(ctx, at.AttemptNo, domain.SubmitInput{Answers: answers}, testNow.Add(5*time.Minute))
	if err != nil {
		t.Fatalf("交卷失败: %v", err)
	}
	if got.Score != wantScore || got.Mechanical != wantMech || got.HalfCredit != wantHalf {
		t.Fatalf("判分不符: got=%d/%d/%d want=%d/%d/%d", got.Score, got.Mechanical, got.HalfCredit, wantScore, wantMech, wantHalf)
	}
	if got.HalfCredit == 0 {
		t.Error("漏选多选题应产生半分")
	}
	if got.Status != domain.AttemptGraded {
		t.Errorf("状态 %s，期望 graded", got.Status)
	}
	if got.Passed != (wantScore >= gotAsmt.PassScore) {
		t.Errorf("通过标记错误: %d vs 线 %d", wantScore, gotAsmt.PassScore)
	}
	// 明细与汇总同源
	rows, err := r.AnswerRows(ctx, got.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(qs) {
		t.Fatalf("明细 %d 行，题目 %d 道", len(rows), len(qs))
	}
	sum := 0
	for _, row := range rows {
		sum += row.Awarded
		if row.Awarded > row.MaxScore {
			t.Errorf("%s 得分 %d 超满分 %d", row.QuestionCode, row.Awarded, row.MaxScore)
		}
	}
	if sum != got.Score {
		t.Fatalf("明细分之和 %d != 汇总 %d", sum, got.Score)
	}
	// 重复交卷 409
	if _, _, err := r.SubmitAttempt(ctx, at.AttemptNo, domain.SubmitInput{Answers: answers}, testNow); err == nil {
		t.Fatal("重复交卷应被拒绝")
	} else {
		var ae *domain.AppError
		if !errors.As(err, &ae) || ae.Code != "already_submitted" {
			t.Fatalf("期望 already_submitted，实际 %v", err)
		}
	}
}

func TestSubmitRejectsForeignQuestion(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	a, err := r.AssessmentByCode(ctx, "AS-2026-004")
	if err != nil {
		t.Fatal(err)
	}
	at, err := r.StartAttempt(ctx, a.ID, domain.StartAttemptInput{
		Name: "跨卷", Phone: "13500002222", Channel: "web"}, testNow)
	if err != nil {
		t.Fatal(err)
	}
	// 提交别场题号：既不得分也不能被接受
	_, _, err = r.SubmitAttempt(ctx, at.AttemptNo, domain.SubmitInput{Answers: []domain.AnswerInput{
		{QuestionCode: "AS-2026-001-Q01", Picked: "A"},
	}}, testNow)
	var ae *domain.AppError
	if !errors.As(err, &ae) || ae.HTTPCode != 400 {
		t.Fatalf("跨场题号应 400，实际 %v", err)
	}
	// 非法输入不应把这份卷写坏
	again, err := r.AttemptByNo(ctx, at.AttemptNo)
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != domain.AttemptOngoing {
		t.Fatalf("被拒绝的提交改动了状态: %s", again.Status)
	}
}

func TestSubmitTimesOutToInvalid(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	a, err := r.AssessmentByCode(ctx, "AS-2026-005")
	if err != nil {
		t.Fatal(err)
	}
	at, err := r.StartAttempt(ctx, a.ID, domain.StartAttemptInput{
		Name: "超时", Phone: "13500003333", Channel: "web"}, testNow)
	if err != nil {
		t.Fatal(err)
	}
	qs, _ := r.Questions(ctx, a.ID)
	all := make([]domain.AnswerInput, 0, len(qs))
	for i := range qs {
		all = append(all, domain.AnswerInput{QuestionCode: qs[i].Code, Picked: qs[i].Answer})
	}
	late := testNow.Add(time.Duration(a.DurationMin)*time.Minute + time.Duration(domain.AnswerGraceSec+30)*time.Second)
	got, _, err := r.SubmitAttempt(ctx, at.AttemptNo, domain.SubmitInput{Answers: all}, late)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.AttemptInvalid || got.Score != 0 || got.Passed {
		t.Fatalf("超时未按作废处理: %+v", got)
	}
	rows, _ := r.AnswerRows(ctx, got.ID)
	if len(rows) != 0 {
		t.Fatalf("作废卷不应写入判分明细，实际 %d 行", len(rows))
	}
}

// TestListAttemptsRankIsStable 名次必须与「分数优先、同分用时少优先」一致。
func TestListAttemptsRankIsStable(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	a, err := r.AssessmentByCode(ctx, "AS-2026-002")
	if err != nil {
		t.Fatal(err)
	}
	rankQuery := func(page, size int) domain.AttemptQuery {
		q := domain.ParseAttemptQuery(map[string][]string{
			"sort": {"rank"}, "dir": {"asc"}, "status": {"graded"},
			"page": {strconv.Itoa(page)}, "page_size": {strconv.Itoa(size)},
		})
		if q.SortKey() != "rank_no" {
			t.Fatalf("rank 排序未走白名单: %+v", q)
		}
		return q
	}
	rows, total, err := r.ListAttempts(ctx, a.ID, rankQuery(1, 50))
	if err != nil {
		t.Fatal(err)
	}
	if total == 0 || len(rows) == 0 {
		t.Fatalf("名单为空: total=%d", total)
	}
	for i := range rows {
		if rows[i].Phone != "" {
			t.Fatal("名单查询不应带出手机号原文")
		}
		if rows[i].Rank != i+1 {
			t.Fatalf("第 %d 行的名次是 %d，名次序列断裂", i+1, rows[i].Rank)
		}
		if i > 0 {
			prev := rows[i-1]
			if prev.Score < rows[i].Score {
				t.Fatalf("名次排序错误：%d 分排在 %d 分之前", prev.Score, rows[i].Score)
			}
			if prev.Score == rows[i].Score && prev.ElapsedSec > rows[i].ElapsedSec {
				t.Fatalf("同分未以用时少者优先: %d > %d", prev.ElapsedSec, rows[i].ElapsedSec)
			}
		}
	}
	// 分页不重叠
	p2, _, err := r.ListAttempts(ctx, a.ID, rankQuery(2, 10))
	if err != nil {
		t.Fatal(err)
	}
	if len(p2) > 0 && p2[0].Rank != 11 {
		t.Errorf("第二页首行名次 %d，期望 11", p2[0].Rank)
	}
}

func TestItemStatsMath(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	items, err := r.ItemStats(ctx, 0) // 0 = 全部场次
	if err != nil {
		t.Fatal(err)
	}
	if len(items) < 50 {
		t.Fatalf("题目统计只有 %d 行", len(items))
	}
	var answeredSum, correctSum int64
	for _, it := range items {
		if it.Answered < 0 || it.CorrectNo < 0 || it.CorrectNo > it.Answered {
			t.Fatalf("%s 计数越界: %+v", it.Code, it)
		}
		if it.AccuracyPct < 0 || it.AccuracyPct > 100 {
			t.Errorf("%s 正确率 %.1f 越界", it.Code, it.AccuracyPct)
		}
		if it.Awarded > it.Answered*int64(it.Score) {
			t.Errorf("%s 总得分 %d 超过 answered×满分=%d", it.Code, it.Awarded, it.Answered*int64(it.Score))
		}
		switch it.Difficulty {
		case "易", "中", "难", "空题":
		default:
			t.Errorf("%s 难度档异常 %q", it.Code, it.Difficulty)
		}
		if it.Answered == 0 && it.Difficulty != "空题" {
			t.Errorf("%s 零作答应为空题档", it.Code)
		}
		answeredSum += it.Answered
		correctSum += it.CorrectNo
		var dist int64
		for _, d := range it.Distractors {
			if d.Picked == "" {
				t.Errorf("%s 分布里出现未脱敏的空标签", it.Code)
			}
			dist += d.Count
		}
		if !it.Revealed && len(it.Distractors) != 0 {
			t.Errorf("%s 未闭卷却公布了作答分布", it.Code)
		}
		if it.Revealed && dist != it.Answered {
			t.Errorf("%s 选项分布之和 %d != answered %d", it.Code, dist, it.Answered)
		}
	}
	if answeredSum == 0 || correctSum == 0 {
		t.Fatalf("统计为空: %+v", items[:1])
	}
	// 与直接 SQL 对齐（防「同层别名/JOIN 放大」那类口径错误）
	var direct int64
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM attempt_answers aa
	  JOIN attempts a ON a.id = aa.attempt_id WHERE a.status = 'graded'`).Scan(&direct).Error; err != nil {
		t.Fatal(err)
	}
	if direct != answeredSum {
		t.Fatalf("明细行数 %d != 统计之和 %d", direct, answeredSum)
	}
}

func TestStatsAggregatesAreConsistent(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	st, err := r.Stats(ctx, 0, testNow)
	if err != nil {
		t.Fatal(err)
	}
	if st.Assessments != int64(len(papers)) {
		t.Errorf("场次数 %d", st.Assessments)
	}
	if st.Graded+st.Ongoing+st.Invalid != st.Attempts {
		t.Errorf("状态之和不等于总数: %+v", st)
	}
	if !st.IdentityOK || st.IdentityViolations != 0 {
		t.Errorf("三分数恒等式被违反: %d 条", st.IdentityViolations)
	}
	if st.ScoreSum != st.MechSum+st.HalfCreditSum {
		t.Errorf("全局汇总不闭合: %d != %d + %d", st.ScoreSum, st.MechSum, st.HalfCreditSum)
	}
	if st.PassRatePct < 0 || st.PassRatePct > 100 {
		t.Errorf("通过率 %.1f 越界", st.PassRatePct)
	}
	bucketSum := int64(0)
	for _, b := range st.Buckets {
		bucketSum += b.Count
	}
	if bucketSum != st.Graded {
		t.Errorf("分布桶之和 %d != 已判分 %d", bucketSum, st.Graded)
	}
	if len(st.Subjects) == 0 || len(st.Daily) == 0 || len(st.TopBoard) == 0 || len(st.Hardest) == 0 {
		t.Error("统计缺少分组数据")
	}
	if len(st.TopBoard) > 8 {
		t.Errorf("榜单长度 %d", len(st.TopBoard))
	}
	for i := range st.TopBoard {
		if st.TopBoard[i].Phone != "" {
			t.Error("榜单泄露手机号原文")
		}
		if st.TopBoard[i].Percent < 0 || st.TopBoard[i].Percent > 100 {
			t.Errorf("榜单百分制越界: %d", st.TopBoard[i].Percent)
		}
	}
	// 单场口径必须小于等于全局口径
	one, err := r.Stats(ctx, func() int64 {
		a, err := r.AssessmentByCode(ctx, "AS-2026-001")
		if err != nil {
			t.Fatal(err)
		}
		return a.ID
	}(), testNow)
	if err != nil {
		t.Fatal(err)
	}
	if one.Window != "单场已判分口径" {
		t.Errorf("单场口径未标注: %s", one.Window)
	}
	if one.Graded > st.Graded || one.Passed > st.Passed {
		t.Errorf("单场口径大于全局: %+v vs %+v", one, st)
	}
	if one.Assessments != 1 || one.Questions < 8 {
		t.Errorf("单场场次/题数异常: %+v", one)
	}
}

func TestSetAssessmentStatusTransitions(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	if _, err := r.SetAssessmentStatus(ctx, "AS-2026-006", domain.AsmtOpen); err != nil {
		t.Fatalf("草稿发布应成功: %v", err)
	}
	if _, err := r.SetAssessmentStatus(ctx, "AS-2026-006", domain.AsmtOpen); err == nil {
		t.Fatal("open->open 应 409")
	}
	if _, err := r.SetAssessmentStatus(ctx, "AS-2026-006", domain.AsmtDraft); err == nil {
		t.Fatal("不允许回退到 draft")
	}
	if a, err := r.SetAssessmentStatus(ctx, "AS-2026-006", domain.AsmtClosed); err != nil {
		t.Fatalf("open->closed 应成功: %v", err)
	} else if a.Status != domain.AsmtClosed {
		t.Fatalf("状态未更新: %s", a.Status)
	}
	if _, err := r.SetAssessmentStatus(ctx, "AS-2026-006", domain.AsmtOpen); err == nil {
		t.Fatal("closed 是终态")
	}
	if _, err := r.SetAssessmentStatus(ctx, "NOPE-9999", domain.AsmtOpen); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("未知场次应 404，实际 %v", err)
	}
}

func TestSeedingIsIdempotent(t *testing.T) {
	r := newTestRepo(t)
	before := int64(0)
	if err := r.db.WithContext(context.Background()).Model(&domain.Assessment{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.Seed(context.Background(), testNow.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	after := int64(0)
	if err := r.db.WithContext(context.Background()).Model(&domain.Assessment{}).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("重复灌种子改变了数据: %d -> %d", before, after)
	}
}

func TestRepoErrorsAreMappedToAppError(t *testing.T) {
	r := newTestRepo(t)
	ctx := context.Background()
	if _, err := r.AssessmentByCode(ctx, "AS-9999-9999"); !errors.Is(err, gorm.ErrRecordNotFound) && !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("未知场次应返回 not_found，实际 %v", err)
	}
	if _, err := r.AttemptByNo(ctx, "NOPE-0001"); err == nil {
		t.Fatal("未知作答编号应报错")
	}
}
