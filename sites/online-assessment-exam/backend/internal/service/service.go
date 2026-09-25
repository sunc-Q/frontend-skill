package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"bizsite/internal/domain"
	"bizsite/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// SetClock 供测试注入固定时间。
func (s *Service) SetClock(f func() time.Time) { s.now = f }

// AssessmentCode 校验对外传入的场次编码：只允许字母数字与 - _，长度 4-32。
// 注入串（含引号、分号、空格）在这一层就变成 400，而不是打到 SQL 里拿 404。
func AssessmentCode(raw string) (string, error) {
	code := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(code)
	if n < 4 || n > 32 {
		return "", domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"code": "场次编码需为 4-32 个字符"})
	}
	for _, r := range code {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return "", domain.Field("invalid_request", "参数校验未通过",
				map[string]string{"code": "场次编码只允许字母、数字、- 与 _"})
		}
	}
	return code, nil
}

// AttemptNo 校验作答编号（形如 AS-2026-001-0925-003）。
func AttemptNo(raw string) (string, error) {
	no := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(no)
	if n < 6 || n > 48 {
		return "", domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"attempt_no": "作答编号需为 6-48 个字符"})
	}
	for _, r := range no {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return "", domain.Field("invalid_request", "参数校验未通过",
				map[string]string{"attempt_no": "作答编号只允许字母、数字、- 与 _"})
		}
	}
	return no, nil
}

func (s *Service) Stats(ctx context.Context, code string) (*domain.Stats, error) {
	id, err := s.resolveAssessment(ctx, code)
	if err != nil {
		if code == "" {
			return s.repo.Stats(ctx, 0, s.now())
		}
		return nil, err
	}
	return s.repo.Stats(ctx, id, s.now())
}

func (s *Service) resolveAssessment(ctx context.Context, code string) (int64, error) {
	if code == "" {
		return 0, nil
	}
	c, err := AssessmentCode(code)
	if err != nil {
		return 0, err
	}
	a, err := s.repo.AssessmentByCode(ctx, c)
	if err != nil {
		return 0, err
	}
	return a.ID, nil
}

// Subjects 失败时返回空列表：筛选项缺失不该让整个列表页报错。
func (s *Service) Subjects(ctx context.Context) []string {
	out, err := s.repo.Subjects(ctx)
	if err != nil || out == nil {
		return []string{}
	}
	return out
}

func (s *Service) AssessmentRow(ctx context.Context, code string) (*domain.AssessmentRow, error) {
	return s.repo.AssessmentRow(ctx, code)
}

func (s *Service) Assessments(ctx context.Context, q domain.AssessmentQuery) ([]domain.AssessmentRow, int64, error) {
	return s.repo.ListAssessments(ctx, q)
}

// Detail 返回卷面（不含任何标准答案）+ 题目视图 + 本场成绩口径。
func (s *Service) Detail(ctx context.Context, code string) (*domain.AssessmentRow, []domain.QuestionView, error) {
	row, err := s.repo.AssessmentRow(ctx, code)
	if err != nil {
		return nil, nil, err
	}
	qs, err := s.repo.Questions(ctx, row.ID)
	if err != nil {
		return nil, nil, err
	}
	views := make([]domain.QuestionView, 0, len(qs))
	for _, q := range qs {
		views = append(views, q.View())
	}
	return row, views, nil
}

// Paper 是给考生开考后用的题目清单（同样不含答案）。
func (s *Service) Paper(ctx context.Context, assessmentID int64) ([]domain.QuestionView, int, error) {
	qs, err := s.repo.Questions(ctx, assessmentID)
	if err != nil {
		return nil, 0, err
	}
	views := make([]domain.QuestionView, 0, len(qs))
	for _, q := range qs {
		views = append(views, q.View())
	}
	return views, domain.TotalScore(qs), nil
}

func (s *Service) ItemStats(ctx context.Context, code string) ([]domain.ItemStat, error) {
	id, err := s.resolveAssessment(ctx, code)
	if err != nil {
		return nil, err
	}
	// 是否公布逐选项分布由仓储按场次状态决定（未闭卷只给正确率），见 ItemStat.Revealed。
	return s.repo.ItemStats(ctx, id)
}

func (s *Service) Attempts(ctx context.Context, code string, q domain.AttemptQuery) ([]domain.AttemptRow, int64, error) {
	a, err := s.repo.AssessmentByCode(ctx, code)
	if err != nil {
		return nil, 0, err
	}
	rows, total, err := s.repo.ListAttempts(ctx, a.ID, q)
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		decorate(&rows[i])
	}
	return rows, total, nil
}

// decorate 只补百分制得分：手机号在仓储层就已脱敏（原文不越过仓储边界），
// 这里再算一次会把空串打码成空。
func decorate(row *domain.AttemptRow) {
	row.Percent = domain.Percent(row.Score, row.TotalScore)
}

func (s *Service) StartAttempt(ctx context.Context, code string, in domain.StartAttemptInput) (*domain.AttemptRow, []domain.QuestionView, int, error) {
	a, err := s.repo.AssessmentByCode(ctx, code)
	if err != nil {
		return nil, nil, 0, err
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Phone = strings.TrimSpace(in.Phone)
	in.Channel = strings.TrimSpace(in.Channel)
	if in.Channel == "" {
		in.Channel = "web"
	}
	if !utf8.ValidString(in.Name) {
		return nil, nil, 0, domain.Field("invalid_request", "参数校验未通过",
			map[string]string{"name": "姓名含非法字符"})
	}
	if errs, ok := in.Validate(); !ok {
		return nil, nil, 0, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	at, err := s.repo.StartAttempt(ctx, a.ID, in, s.now())
	if err != nil {
		return nil, nil, 0, err
	}
	qs, total := s.paperOf(ctx, a.ID)
	row := attemptRowFrom(at, a)
	return row, qs, total, nil
}

func (s *Service) paperOf(ctx context.Context, id int64) ([]domain.QuestionView, int) {
	qs, err := s.repo.Questions(ctx, id)
	if err != nil {
		return nil, 0
	}
	views := make([]domain.QuestionView, 0, len(qs))
	for _, q := range qs {
		views = append(views, q.View())
	}
	return views, domain.TotalScore(qs)
}

func attemptRowFrom(at *domain.Attempt, a *domain.Assessment) *domain.AttemptRow {
	row := &domain.AttemptRow{
		Attempt: *at, MaskedPhone: domain.MaskPhone(at.Phone),
		AssessmentNo: a.Code, Title: a.Title, Subject: a.Subject,
		PassScore: a.PassScore,
	}
	row.Phone = ""
	return row
}

// Submit 交卷判分，并给出逐题回执。
// 回执不含标准答案：开放中的场次公布答案等于给还没考的人泄题。
func (s *Service) Submit(ctx context.Context, no string, in domain.SubmitInput) (*domain.AttemptRow, []domain.ReceiptItem, error) {
	if errs, ok := in.Validate(); !ok {
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	at, a, err := s.repo.SubmitAttempt(ctx, no, in, s.now())
	if err != nil {
		return nil, nil, err
	}
	row := attemptRowFrom(at, a)
	row.TotalScore = totalScoreOf(qsOf(s, ctx, a.ID))
	_ = row.MaskedPhone != "" // 脱敏在 attemptRowFrom 里完成
	row.Percent = domain.Percent(at.Score, row.TotalScore)
	items, err := s.Receipt(ctx, no)
	if err != nil {
		return nil, nil, err
	}
	return row, items, nil
}

func qsOf(s *Service, ctx context.Context, id int64) []domain.Question {
	qs, err := s.repo.Questions(ctx, id)
	if err != nil {
		return nil
	}
	return qs
}

func totalScoreOf(qs []domain.Question) int { return domain.TotalScore(qs) }

// Receipt 是成绩单：逐题作答、得分与满分，不含答案。
func (s *Service) Receipt(ctx context.Context, no string) ([]domain.ReceiptItem, error) {
	row, err := s.repo.AttemptRowByNo(ctx, no)
	if err != nil {
		return nil, err
	}
	qs, err := s.repo.Questions(ctx, row.AssessmentID)
	if err != nil {
		return nil, err
	}
	answers, err := s.repo.AnswerRows(ctx, row.ID)
	if err != nil {
		return nil, err
	}
	byQ := make(map[int64]domain.AttemptAnswer, len(answers))
	for _, an := range answers {
		byQ[an.QuestionID] = an
	}
	items := make([]domain.ReceiptItem, 0, len(qs))
	for _, q := range qs {
		an, ok := byQ[q.ID]
		picked := ""
		correct := false
		awarded := 0
		if ok {
			picked = an.Picked
			correct = an.Correct == domain.CorrectYes
			awarded = an.Awarded
		}
		if !ok && row.Status == domain.AttemptInvalid {
			picked = "作废未判分"
		}
		items = append(items, domain.ReceiptItem{
			Code: q.Code, OrderNo: q.OrderNo, Type: q.Type, Stem: q.Stem,
			Picked: picked, Correct: correct, Awarded: awarded, MaxScore: q.Score,
		})
	}
	return items, nil
}

func (s *Service) Attempt(ctx context.Context, no string) (*domain.AttemptRow, error) {
	row, err := s.repo.AttemptRowByNo(ctx, no)
	if err != nil {
		return nil, err
	}
	decorate(row)
	return row, nil
}

func (s *Service) SetStatus(ctx context.Context, code, to string) (*domain.Assessment, error) {
	a, err := s.repo.SetAssessmentStatus(ctx, code, to)
	if err != nil {
		return nil, err
	}
	return a, nil
}
