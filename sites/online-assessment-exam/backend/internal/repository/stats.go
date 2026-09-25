package repository

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type counter struct {
	Key   string `gorm:"column:k"`
	Count int64  `gorm:"column:c"`
}

func countBy(ctx context.Context, db *gorm.DB, table, col string) (map[string]int64, error) {
	var rows []counter
	sql := fmt.Sprintf(`SELECT %s AS k, COUNT(*) AS c FROM %s GROUP BY %s`, col, table, col)
	if err := db.WithContext(ctx).Raw(sql).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Key] = r.Count
	}
	return out, nil
}

// itemAgg 是单题聚合： answered/correct/awarded 全部来自 attempt_answers，
// 也就是「线上判分引擎写下的事实」，统计层不做第二次判分。
type itemAgg struct {
	Code     string `gorm:"column:code"`
	Answered int64  `gorm:"column:answered"`
	Correct  int64  `gorm:"column:correct_no"`
	Awarded  int64  `gorm:"column:awarded"`
	Blank    int64  `gorm:"column:blank_no"`
}

func (r *Repo) ItemStats(ctx context.Context, assessmentID int64) ([]domain.ItemStat, error) {
	var qs []domain.Question
	qq := r.db.WithContext(ctx).Model(&domain.Question{})
	if assessmentID > 0 {
		qq = qq.Where("assessment_id = ?", assessmentID)
	}
	if err := qq.Order("assessment_id asc, order_no asc").Find(&qs).Error; err != nil {
		return nil, err
	}
	// 只有已闭卷的场次才公布作答分布：把「哪个错误选项最多人挑」摊给还没交卷的人看等于泄题。
	statusOf := map[int64]string{}
	var sts []struct {
		ID     int64  `gorm:"column:id"`
		Status string `gorm:"column:status"`
	}
	if err := r.db.WithContext(ctx).Raw(`SELECT id, status FROM assessments`).Scan(&sts).Error; err != nil {
		return nil, err
	}
	for _, row := range sts {
		statusOf[row.ID] = row.Status
	}
	var aggs []itemAgg
	err := r.db.WithContext(ctx).Raw(`
		SELECT aa.question_code AS code,
		       COUNT(*) AS answered,
		       COALESCE(SUM(aa.correct), 0) AS correct_no,
		       COALESCE(SUM(aa.awarded), 0) AS awarded,
		       COALESCE(SUM(CASE WHEN aa.picked = '' THEN 1 ELSE 0 END), 0) AS blank_no
		  FROM attempt_answers aa
		  JOIN attempts a ON a.id = aa.attempt_id
		 WHERE a.status = 'graded' AND (? = 0 OR a.assessment_id = ?)
		 GROUP BY aa.question_code`, assessmentID, assessmentID).Scan(&aggs).Error
	if err != nil {
		return nil, err
	}
	byCode := make(map[string]itemAgg, len(aggs))
	for _, g := range aggs {
		byCode[g.Code] = g
	}
	var distractors []struct {
		Code   string `gorm:"column:code"`
		Picked string `gorm:"column:picked"`
		Count  int64  `gorm:"column:c"`
	}
	err = r.db.WithContext(ctx).Raw(`
		SELECT aa.question_code AS code, aa.picked AS picked, COUNT(*) AS c
		  FROM attempt_answers aa
		  JOIN attempts a ON a.id = aa.attempt_id
		 WHERE a.status = 'graded' AND (? = 0 OR a.assessment_id = ?)
		 GROUP BY aa.question_code, aa.picked
		 ORDER BY code asc, c desc`, assessmentID, assessmentID).Scan(&distractors).Error
	if err != nil {
		return nil, err
	}
	distBy := map[string][]domain.Distractor{}
	for _, d := range distractors {
		label := d.Picked
		if label == "" {
			label = "未作答"
		}
		distBy[d.Code] = append(distBy[d.Code], domain.Distractor{Picked: label, Count: d.Count})
	}
	out := make([]domain.ItemStat, 0, len(qs))
	for _, q := range qs {
		g := byCode[q.Code]
		acc := 0.0
		if g.Answered > 0 {
			acc = float64(g.Correct) * 100 / float64(g.Answered)
		}
		revealed := statusOf[q.AssessmentID] == domain.AsmtClosed
		distractors := []domain.Distractor(nil)
		if revealed {
			distractors = distBy[q.Code]
		}
		out = append(out, domain.ItemStat{
			Code: q.Code, OrderNo: q.OrderNo, Type: q.Type, Stem: q.Stem, Score: q.Score,
			Answered: g.Answered, CorrectNo: g.Correct, AccuracyPct: round1(acc),
			Awarded: g.Awarded, Difficulty: difficultyOf(g.Answered, acc),
			Revealed: revealed, Distractors: distractors,
		})
	}
	return out, nil
}

// difficultyOf 难度档是事后从正确率算出来的：没有作答就不评难度。
func difficultyOf(answered int64, acc float64) string {
	switch {
	case answered == 0:
		return "空题"
	case acc >= 85:
		return "易"
	case acc >= 60:
		return "中"
	default:
		return "难"
	}
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

type pctRow struct {
	Percent float64 `gorm:"column:pct"`
	Passed  bool    `gorm:"column:passed"`
	Day     string  `gorm:"column:day"`
}

// gradedPercents 把已判分卷换算成百分制明细，分布桶在 Go 侧算，
// 免得在同一条 SQL 里既分组又引用别名（SQLite 会报 no such column）。
func (r *Repo) gradedPercents(ctx context.Context, assessmentID int64) ([]pctRow, error) {
	var out []pctRow
	q := r.db.WithContext(ctx).Raw(`
		SELECT a.score * 100.0 / NULLIF((SELECT COALESCE(SUM(qs.score),0) FROM questions qs WHERE qs.assessment_id = a.assessment_id), 0) AS pct,
		       a.passed AS passed,
		       substr(CAST(a.submitted_at AS TEXT), 1, 10) AS day
		  FROM attempts a
		 WHERE a.status = 'graded' AND (? = 0 OR a.assessment_id = ?)`, assessmentID, assessmentID)
	if err := q.Scan(&out).Error; err != nil {
		return nil, err
	}
	return out, nil
}

var bucketDefs = []struct {
	label    string
	from, to int
}{
	{"0-39", 0, 39}, {"40-59", 40, 59}, {"60-69", 60, 69},
	{"70-79", 70, 79}, {"80-89", 80, 89}, {"90-100", 90, 100},
}

func bucketize(rows []pctRow) ([]domain.ScoreBucket, int64) {
	sumPct := int64(0)
	buckets := make([]domain.ScoreBucket, 0, len(bucketDefs))
	counts := make([]int64, len(bucketDefs))
	for _, row := range rows {
		p := int(row.Percent)
		if p > 100 {
			p = 100
		}
		if p < 0 {
			p = 0
		}
		sumPct += int64(p)
		for i, b := range bucketDefs {
			if p >= b.from && p <= b.to {
				counts[i]++
				break
			}
		}
	}
	for i, b := range bucketDefs {
		buckets = append(buckets, domain.ScoreBucket{Label: b.label, From: b.from, To: b.to, Count: counts[i]})
	}
	return buckets, sumPct
}

// Stats 组装全局（assessmentID=0）或单场（>0）的成绩口径。
func (r *Repo) Stats(ctx context.Context, assessmentID int64, now time.Time) (*domain.Stats, error) {
	st := &domain.Stats{GeneratedAt: now, Window: "全历史已判分口径"}

	asmtCounts, err := countBy(ctx, r.db.WithContext(ctx), "assessments", "status")
	if err != nil {
		return nil, err
	}
	st.Assessments = asmtCounts[domain.AsmtDraft] + asmtCounts[domain.AsmtOpen] + asmtCounts[domain.AsmtClosed]
	st.DraftAssessments = asmtCounts[domain.AsmtDraft]
	st.OpenAssessments = asmtCounts[domain.AsmtOpen]
	st.ClosedAssessments = asmtCounts[domain.AsmtClosed]

	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM questions q
	  WHERE q.assessment_id IN (SELECT id FROM assessments)`).Scan(&st.Questions).Error; err != nil {
		return nil, err
	}
	if assessmentID > 0 {
		if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM questions WHERE assessment_id = ?`, assessmentID).
			Scan(&st.Questions).Error; err != nil {
			return nil, err
		}
		st.Window = "单场已判分口径"
		st.Assessments = 1
	}

	attemptCounts, err := countBy(ctx, r.db.WithContext(ctx), "attempts", "status")
	if err != nil {
		return nil, err
	}
	st.Ongoing = attemptCounts[domain.AttemptOngoing]
	st.Invalid = attemptCounts[domain.AttemptInvalid]
	st.Graded = attemptCounts[domain.AttemptGraded]
	st.Attempts = st.Ongoing + st.Invalid + st.Graded
	if assessmentID > 0 {
		var rows []counter
		err := r.db.WithContext(ctx).Raw(`SELECT status AS k, COUNT(*) AS c FROM attempts WHERE assessment_id = ? GROUP BY status`, assessmentID).Scan(&rows).Error
		if err != nil {
			return nil, err
		}
		st.Ongoing, st.Invalid, st.Graded, st.Attempts = 0, 0, 0, 0
		for _, row := range rows {
			switch row.Key {
			case domain.AttemptOngoing:
				st.Ongoing = row.Count
			case domain.AttemptInvalid:
				st.Invalid = row.Count
			case domain.AttemptGraded:
				st.Graded = row.Count
			}
		}
		st.Attempts = st.Ongoing + st.Invalid + st.Graded
	}
	if err := r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM attempts WHERE status = 'graded' AND passed = 1 AND (? = 0 OR assessment_id = ?)`, assessmentID, assessmentID).
		Scan(&st.Passed).Error; err != nil {
		return nil, err
	}
	if st.Graded > 0 {
		st.PassRatePct = round1(float64(st.Passed) * 100 / float64(st.Graded))
	}

	// 恒等式体检：Score 必须等于 Mechanic + Half（种子与线上一致才成立）
	var violations int64
	err = r.db.WithContext(ctx).Raw(`SELECT COUNT(*) FROM attempts
	  WHERE status IN ('graded','invalid') AND score <> mechanical + half_credit
	    AND (? = 0 OR assessment_id = ?)`, assessmentID, assessmentID).Scan(&violations).Error
	if err != nil {
		return nil, err
	}
	st.IdentityViolations = violations
	st.IdentityOK = violations == 0

	var sums struct {
		S int64 `gorm:"column:s"`
		M int64 `gorm:"column:m"`
		H int64 `gorm:"column:h"`
	}
	err = r.db.WithContext(ctx).Raw(`SELECT COALESCE(SUM(score),0) s, COALESCE(SUM(mechanical),0) m, COALESCE(SUM(half_credit),0) h
	  FROM attempts WHERE status = 'graded' AND (? = 0 OR assessment_id = ?)`, assessmentID, assessmentID).
		Scan(&sums).Error
	if err != nil {
		return nil, err
	}
	st.ScoreSum, st.MechSum, st.HalfCreditSum = sums.S, sums.M, sums.H

	pcts, err := r.gradedPercents(ctx, assessmentID)
	if err != nil {
		return nil, err
	}
	buckets, sumPct := bucketize(pcts)
	st.Buckets = buckets
	if len(pcts) > 0 {
		st.AvgPercent = round1(float64(sumPct) / float64(len(pcts)))
	}

	if assessmentID == 0 {
		if err := r.db.WithContext(ctx).Raw(`
			SELECT asm.subject AS subject,
			       COUNT(a.id) AS attempts,
			       COALESCE(SUM(CASE WHEN a.status = 'graded' AND a.passed = 1 THEN 1 ELSE 0 END), 0) AS passed,
			       COALESCE(AVG(CASE WHEN a.status = 'graded' THEN a.score * 100.0 / NULLIF(` + totalFor("asm") + `, 0) END), 0) AS avg_pct
			  FROM assessments asm
			  LEFT JOIN attempts a ON a.assessment_id = asm.id
			 GROUP BY asm.subject
			 ORDER BY attempts DESC, asm.subject ASC`).Scan(&st.Subjects).Error; err != nil {
			return nil, err
		}
		for i := range st.Subjects {
			s := &st.Subjects[i]
			if s.Attempts > 0 {
				s.PassPct = round1(float64(s.Passed) * 100 / float64(s.Attempts))
			}
		}
		st.Daily = dailyTrend(pcts, 14, now)
		items, err := r.ItemStats(ctx, 0)
		if err != nil {
			return nil, err
		}
		st.Hardest = hardest(items, 5)
	} else {
		st.Hardest = hardest(mustItems(r, ctx, assessmentID), 5)
		st.Daily = dailyTrend(pcts, 14, now)
	}
	board, err := r.topBoard(ctx, assessmentID, 8)
	if err != nil {
		return nil, err
	}
	st.TopBoard = board
	return st, nil
}

// topBoard 是「百分制」排行榜：跨场次分数不可直接比，所以先各自换算成百分制再排序，
// 同分者用时少者在前。这里的 Rank 是榜单序号，不是场内名次（场内名次见名单接口的 rank_no）。
func (r *Repo) topBoard(ctx context.Context, assessmentID int64, limit int) ([]domain.AttemptRow, error) {
	var rows []topRow
	err := r.db.WithContext(ctx).Raw(`
		SELECT a.*, asm.code AS assessment_code, asm.title AS title, asm.subject AS subject,
		       asm.pass_score AS pass_score, COALESCE(`+totalFor("asm")+`, 0) AS total_score,
		       a.score * 100.0 / NULLIF(COALESCE(`+totalFor("asm")+`, 0), 0) AS pct
		  FROM attempts a
		  JOIN assessments asm ON asm.id = a.assessment_id
		 WHERE a.status = 'graded' AND (? = 0 OR a.assessment_id = ?)
		 ORDER BY pct DESC, a.elapsed_sec ASC, a.id ASC
		 LIMIT ?`, assessmentID, assessmentID, limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.AttemptRow, 0, len(rows))
	for i := range rows {
		tr := rows[i]
		row := domain.AttemptRow{
			Attempt: tr.Attempt, MaskedPhone: domain.MaskPhone(tr.Phone),
			AssessmentNo: tr.AssessmentCode, Title: tr.Title, Subject: tr.Subject,
			TotalScore: tr.TotalScore, PassScore: tr.PassScore,
			Percent: int(tr.Pct + 0.5), Rank: i + 1,
		}
		row.Phone = "" // 出口只留脱敏值，原文不进入任何响应结构
		out = append(out, row)
	}
	return out, nil
}

type topRow struct {
	domain.Attempt
	AssessmentCode string  `gorm:"column:assessment_code"`
	Title          string  `gorm:"column:title"`
	Subject        string  `gorm:"column:subject"`
	PassScore      int     `gorm:"column:pass_score"`
	TotalScore     int     `gorm:"column:total_score"`
	Pct            float64 `gorm:"column:pct"`
}

func mustItems(r *Repo, ctx context.Context, id int64) []domain.ItemStat {
	items, err := r.ItemStats(ctx, id)
	if err != nil {
		return nil
	}
	return items
}

// dailyTrend 取最近 days 天的每日已判份数、通过数与平均分（百分制）。
func dailyTrend(rows []pctRow, days int, now time.Time) []domain.DailyPoint {
	today := now.UTC().Format("2006-01-02")
	byDay := map[string][]pctRow{}
	for _, r := range rows {
		byDay[r.Day] = append(byDay[r.Day], r)
	}
	out := make([]domain.DailyPoint, 0, days)
	loc := time.UTC
	for i := days - 1; i >= 0; i-- {
		day := now.In(loc).AddDate(0, 0, -i).Format("2006-01-02")
		if day > today {
			continue
		}
		p := domain.DailyPoint{Day: day}
		sum := 0
		for _, r := range byDay[day] {
			p.Attempts++
			if r.Passed {
				p.Passed++
			}
			sum += int(r.Percent)
		}
		if p.Attempts > 0 {
			p.AvgPct = round1(float64(sum) / float64(p.Attempts))
		}
		out = append(out, p)
	}
	return out
}

// hardest 从题目统计里挑最难若干题：只看在有效卷中出现 ≥15 次的题，避免小样本噪声。
func hardest(items []domain.ItemStat, n int) []domain.ItemStat {
	var pool []domain.ItemStat
	for _, it := range items {
		if it.Answered >= 15 {
			pool = append(pool, it)
		}
	}
	for i := 1; i < len(pool); i++ {
		for j := i; j > 0 && pool[j].AccuracyPct < pool[j-1].AccuracyPct; j-- {
			pool[j], pool[j-1] = pool[j-1], pool[j]
		}
	}
	if len(pool) > n {
		pool = pool[:n]
	}
	return pool
}
