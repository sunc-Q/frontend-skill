package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

// totalScoreExpr 与 passedExpr 是共用的 SQL 片段（各自独立成表达式，
// 绝不引用同一条 select 里别的列别名 —— SQLite 不支持，见前几轮踩坑记录）。
const totalScoreExpr = `(SELECT COALESCE(SUM(q.score), 0) FROM questions q WHERE q.assessment_id = %s.id)`

func totalFor(alias string) string {
	return fmt.Sprintf(totalScoreExpr, alias)
}

// orderClause 把白名单列 + 方向拼成 ORDER BY。凡参与排序的列都来自 map 常量，
// 用户输入不可能进入这里。按名次排序时，进行中/作废（无名次）一律沉底。
func orderClause(col, dir string) string {
	ord := strings.ToUpper(dir)
	if ord != "DESC" {
		ord = "ASC"
	}
	if col == "sc.rank_no" {
		return "(sc.rank_no IS NULL) ASC, sc.rank_no " + ord + ", a.id ASC"
	}
	return col + " " + ord + ", a.id ASC"
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

// ---- 试卷 ----

func (r *Repo) AssessmentByCode(ctx context.Context, code string) (*domain.Assessment, error) {
	var a domain.Assessment
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repo) Questions(ctx context.Context, assessmentID int64) ([]domain.Question, error) {
	var out []domain.Question
	err := r.db.WithContext(ctx).Where("assessment_id = ?", assessmentID).
		Order("order_no asc").Find(&out).Error
	return out, err
}

var assessmentRowSelect = `a.*,
	COALESCE((SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id), 0) AS question_no,
	COALESCE(` + totalFor("a") + `, 0) AS total_score,
	(SELECT COUNT(*) FROM attempts t WHERE t.assessment_id = a.id) AS attempts,
	(SELECT COUNT(*) FROM attempts t WHERE t.assessment_id = a.id AND t.status = 'graded' AND t.passed = 1) AS passed_count,
	(SELECT COUNT(*) FROM attempts t WHERE t.assessment_id = a.id AND t.status = 'ongoing') AS ongoing_count,
	(SELECT COALESCE(MAX(t.score), 0) FROM attempts t WHERE t.assessment_id = a.id AND t.status = 'graded') AS best_score,
	(SELECT COALESCE(AVG(t.score * 100.0 / NULLIF(` + totalFor("a") + `, 0)), 0)
	   FROM attempts t WHERE t.assessment_id = a.id AND t.status = 'graded') AS avg_percent`

func (r *Repo) ListAssessments(ctx context.Context, q domain.AssessmentQuery) ([]domain.AssessmentRow, int64, error) {
	base := r.db.WithContext(ctx).Table("assessments AS a")
	if q.Status != "" {
		base = base.Where("a.status = ?", q.Status)
	}
	if q.Subject != "" {
		base = base.Where("a.subject = ?", q.Subject)
	}
	if q.Kind != "" {
		base = base.Where("a.kind = ?", q.Kind)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(a.title LIKE ? ESCAPE '\\' OR a.code LIKE ? ESCAPE '\\' OR a.intro LIKE ? ESCAPE '\\')", like, like, like)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.AssessmentRow
	err := base.Select(assessmentRowSelect).
		Order(orderClause(q.Sort, q.Dir)).
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

// Subjects 给出筛选用的高基数低基数集合（按场次数降序）。
func (r *Repo) Subjects(ctx context.Context) ([]string, error) {
	var rows []counter
	err := r.db.WithContext(ctx).Raw(`SELECT subject AS k, COUNT(*) AS c FROM assessments GROUP BY subject ORDER BY c DESC, subject ASC`).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.Key)
	}
	return out, nil
}

func (r *Repo) AssessmentRow(ctx context.Context, code string) (*domain.AssessmentRow, error) {
	var row domain.AssessmentRow
	err := r.db.WithContext(ctx).Table("assessments AS a").Select(assessmentRowSelect).
		Where("a.code = ?", code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

// ---- 作答 ----

var attemptRowSelect = `a.*, asm.code AS assessment_code, asm.title AS title, asm.subject AS subject,
	asm.pass_score AS pass_score, COALESCE(` + totalFor("asm") + `, 0) AS total_score,
	COALESCE(sc.rank_no, 0) AS rank_no`

// rankSub 只在「同一场已判分」里排名：分数高者在前，同分用得更少者在前。
func rankSub(assessmentID int64) string {
	return fmt.Sprintf(`(SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC, elapsed_sec ASC, id ASC) AS rank_no
	    FROM attempts WHERE assessment_id = %d AND status = 'graded')`, assessmentID)
}

// rankSubForNo 按作答编号定位场次后再排名（名次只在同场已判分集合里有意义）。
func rankSubForNo(no string) string {
	return fmt.Sprintf(`(SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC, elapsed_sec ASC, id ASC) AS rank_no
	    FROM attempts WHERE status = 'graded' AND assessment_id =
	      (SELECT assessment_id FROM attempts WHERE attempt_no = '%s'))`, escapeLiteral(no))
}

func escapeLiteral(s string) string { return strings.ReplaceAll(s, "'", "''") }

func (r *Repo) ListAttempts(ctx context.Context, assessmentID int64, q domain.AttemptQuery) ([]domain.AttemptRow, int64, error) {
	base := r.db.WithContext(ctx).Table("attempts AS a").
		Joins("JOIN assessments asm ON asm.id = a.assessment_id").
		Joins("LEFT JOIN "+rankSub(assessmentID)+" sc ON sc.id = a.id").
		Where("a.assessment_id = ?", assessmentID)
	if q.Status != "" {
		base = base.Where("a.status = ?", q.Status)
	}
	if q.Channel != "" {
		base = base.Where("a.channel = ?", q.Channel)
	}
	if q.Passed != "" {
		base = base.Where("a.passed = ?", q.Passed == "yes")
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.AttemptRow
	err := base.Select(attemptRowSelect).
		Order(orderClause(q.Sort, q.Dir)).
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	for i := range rows {
		rows[i].MaskedPhone = domain.MaskPhone(rows[i].Phone)
		rows[i].Phone = "" // 原文不出仓储层
	}
	return rows, total, err
}

func (r *Repo) AttemptByNo(ctx context.Context, no string) (*domain.Attempt, error) {
	var a domain.Attempt
	err := r.db.WithContext(ctx).Where("attempt_no = ?", no).First(&a).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (r *Repo) AttemptRowByNo(ctx context.Context, no string) (*domain.AttemptRow, error) {
	var row domain.AttemptRow
	err := r.db.WithContext(ctx).Table("attempts AS a").
		Select(attemptRowSelect).
		Joins("JOIN assessments asm ON asm.id = a.assessment_id").
		Joins("LEFT JOIN "+rankSubForNo(no)+" sc ON sc.id = a.id").
		Where("a.attempt_no = ?", no).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	// 名次只存在于同场已判分集合里，单独取一次，避免在上面这条语句里做窗口函数
	var rank int
	if row.Status == domain.AttemptGraded {
		rankErr := r.db.WithContext(ctx).Raw(
			`SELECT COUNT(*) + 1 FROM attempts
			  WHERE assessment_id = ? AND status = 'graded'
			    AND (score > ? OR (score = ? AND (elapsed_sec < ? OR (elapsed_sec = ? AND id < ?))))`,
			row.AssessmentID, row.Score, row.Score, row.ElapsedSec, row.ElapsedSec, row.ID,
		).Scan(&rank).Error
		if rankErr != nil {
			return nil, rankErr
		}
	}
	row.Rank = rank
	row.MaskedPhone = domain.MaskPhone(row.Phone)
	row.Phone = ""
	return &row, nil
}

func (r *Repo) AnswerRows(ctx context.Context, attemptID int64) ([]domain.AttemptAnswer, error) {
	var out []domain.AttemptAnswer
	err := r.db.WithContext(ctx).Where("attempt_id = ?", attemptID).Order("id asc").Find(&out).Error
	return out, err
}

// StartAttempt 在一个事务里完成：状态与窗口校验 → 同手机号查重 → 发号 → 建进行中记录。
// 单写者模型（SetMaxOpenConns(1)+txlock immediate）下闭包内一律用 tx，不得用 r.db。
func (r *Repo) StartAttempt(ctx context.Context, assessmentID int64, in domain.StartAttemptInput, now time.Time) (*domain.Attempt, error) {
	out := &domain.Attempt{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var a domain.Assessment
		if err := tx.Where("id = ?", assessmentID).First(&a).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if a.Status != domain.AsmtOpen {
			return domain.New("assessment_not_open", "该场测评当前不接受作答", 409)
		}
		if now.Before(a.OpensAt) {
			return domain.New("not_started", "本场测评尚未开考", 409)
		}
		if now.After(a.ClosesAt) {
			return domain.New("closed", "本场测评已闭卷", 409)
		}
		var dup int64
		if err := tx.Model(&domain.Attempt{}).
			Where("assessment_id = ? AND phone = ? AND status <> ?", assessmentID, in.Phone, domain.AttemptInvalid).
			Count(&dup).Error; err != nil {
			return err
		}
		if dup > 0 {
			return domain.New("already_started", "该手机号在本场已有作答记录", 409)
		}
		no, err := nextAttemptNo(tx, a.Code, now)
		if err != nil {
			return err
		}
		at := &domain.Attempt{
			AttemptNo: no, AssessmentID: a.ID, CandidateName: in.Name, Phone: in.Phone,
			Channel: in.Channel, StartedAt: now, Status: domain.AttemptOngoing, Reason: "作答中",
		}
		if err := tx.Create(at).Error; err != nil {
			return err
		}
		*out = *at
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// nextAttemptNo 在同一事务里按「本场已有份数 + 1」发号，最多重算 5 次。
func nextAttemptNo(tx *gorm.DB, code string, now time.Time) (string, error) {
	var n int64
	if err := tx.Model(&domain.Attempt{}).Where("assessment_id IN (SELECT id FROM assessments WHERE code = ?)", code).
		Count(&n).Error; err != nil {
		return "", err
	}
	for i := int64(0); i < 5; i++ {
		seq := n + 1 + i
		no := fmt.Sprintf("%s-%s-%03d", code, now.Format("0102"), seq)
		var exists int64
		if err := tx.Model(&domain.Attempt{}).Where("attempt_no = ?", no).Count(&exists).Error; err != nil {
			return "", err
		}
		if exists == 0 {
			return no, nil
		}
	}
	return "", domain.Wrap("conflict", "作答编号发号冲突，请重试", 409, errors.New("attempt_no exhausted"))
}

// SubmitAttempt 判分并落库：校验 → 超时作废 → 逐题判分 → 写明细 → 回写汇总三分。
// 交卷是一次性动作，已判分/已作废的记录再次提交返回 409。
func (r *Repo) SubmitAttempt(ctx context.Context, attemptNo string, in domain.SubmitInput, now time.Time) (*domain.Attempt, *domain.Assessment, error) {
	out := &domain.Attempt{}
	outAs := &domain.Assessment{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var at domain.Attempt
		if err := tx.Where("attempt_no = ?", attemptNo).First(&at).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if at.Status != domain.AttemptOngoing {
			return domain.New("already_submitted", "该份作答已提交，不能重复交卷", 409)
		}
		var a domain.Assessment
		if err := tx.Where("id = ?", at.AssessmentID).First(&a).Error; err != nil {
			return err
		}
		var qs []domain.Question
		if err := tx.Where("assessment_id = ?", a.ID).Order("order_no asc").Find(&qs).Error; err != nil {
			return err
		}
		byCode := make(map[string]*domain.Question, len(qs))
		for i := range qs {
			byCode[qs[i].Code] = &qs[i]
		}
		picked := make(map[int64]string, len(in.Answers))
		for _, an := range in.Answers {
			code := strings.TrimSpace(an.QuestionCode)
			q, ok := byCode[code]
			if !ok {
				return domain.Field("invalid_request", "参数校验未通过",
					map[string]string{"question_code": "题目 " + code + " 不属于本场测评"})
			}
			picked[q.ID] = an.Picked
		}
		elapsed := int(now.Sub(at.StartedAt).Seconds())
		if elapsed < 0 {
			elapsed = 0
		}
		at.ElapsedSec = elapsed
		at.SubmittedAt = &now

		limit := a.DurationMin*60 + domain.AnswerGraceSec
		if elapsed > limit {
			at.Status = domain.AttemptInvalid
			at.Reason = fmt.Sprintf("超过限时 %d 秒", limit)
			at.Score, at.Mechanical, at.HalfCredit, at.Passed = 0, 0, 0, false
		} else {
			mech, half, score := 0, 0, 0
			rows := make([]domain.AttemptAnswer, 0, len(qs))
			for i := range qs {
				q := &qs[i]
				awarded, correct := domain.GradeItem(q, picked[q.ID])
				if correct {
					mech += awarded
				} else {
					half += awarded
				}
				score += awarded
				rows = append(rows, domain.AttemptAnswer{
					AttemptID: at.ID, QuestionID: q.ID, QuestionCode: q.Code,
					Picked:  domain.NormalizePicked(q.Type, picked[q.ID]),
					Correct: boolInt(correct), Awarded: awarded, MaxScore: q.Score,
				})
			}
			at.Status = domain.AttemptGraded
			at.Reason = ""
			at.Mechanical, at.HalfCredit, at.Score = mech, half, score
			at.Passed = score >= a.PassScore
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		at.GradedAt = &now
		if err := tx.Model(&domain.Attempt{}).Where("id = ?", at.ID).Updates(map[string]any{
			"status": at.Status, "score": at.Score, "mechanical": at.Mechanical,
			"half_credit": at.HalfCredit, "passed": at.Passed, "reason": at.Reason,
			"elapsed_sec": at.ElapsedSec, "submitted_at": at.SubmittedAt, "graded_at": at.GradedAt,
		}).Error; err != nil {
			return err
		}
		*out = at
		*outAs = a
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return out, outAs, nil
}

// SetAssessmentStatus 走状态机：非法跳转 409。
func (r *Repo) SetAssessmentStatus(ctx context.Context, code, to string) (*domain.Assessment, error) {
	out := &domain.Assessment{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var a domain.Assessment
		if err := tx.Where("code = ?", code).First(&a).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if !domain.CanMoveAssessment(a.Status, to) {
			return domain.New("invalid_transition",
				fmt.Sprintf("不能从 %s 直接切到 %s", a.Status, to), 409)
		}
		if err := tx.Model(&domain.Assessment{}).Where("id = ?", a.ID).
			Update("status", to).Error; err != nil {
			return err
		}
		a.Status = to
		*out = a
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
