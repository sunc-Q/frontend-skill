package domain

import (
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// 试卷状态机：draft -> open -> closed（closed 为终态，非法跳转一律 409）
const (
	AsmtDraft  = "draft"
	AsmtOpen   = "open"
	AsmtClosed = "closed"
)

// 题型
const (
	TypeSingle = "single"
	TypeMulti  = "multi"
	TypeJudge  = "judge"
	TypeBlank  = "blank"
)

// 作答状态机：ongoing -> graded | invalid
const (
	AttemptOngoing = "ongoing"
	AttemptGraded  = "graded"
	AttemptInvalid = "invalid"
)

// AnswerGraceSec 是「限时 + 网络宽限」之外的作废阈值：超过即整卷记 0 分并置 invalid。
const AnswerGraceSec = 120

const (
	KindPlacement = "placement"
	KindUnit      = "unit"
	KindMock      = "mock"
	KindCert      = "cert"
)

// Assessment 一场测评（卷面）。满分不落库，由题目分值相加得到，避免两处口径打架。
type Assessment struct {
	ID          int64     `gorm:"primaryKey" json:"id"`
	Code        string    `gorm:"uniqueIndex;size:32" json:"code"`
	Title       string    `gorm:"size:96" json:"title"`
	Subject     string    `gorm:"size:32;index" json:"subject"`
	Kind        string    `gorm:"size:16;index" json:"kind"`
	DurationMin int       `json:"duration_min"`
	PassScore   int       `json:"pass_score"`
	Status      string    `gorm:"size:16;index" json:"status"`
	OpensAt     time.Time `gorm:"index" json:"opens_at"`
	ClosesAt    time.Time `json:"closes_at"`
	Intro       string    `gorm:"size:255" json:"intro"`
	CreatedAt   time.Time `json:"created_at"`
}

// Question 一道题。Answer 用 json:"-" 封死：任何对外视图都不得出现标准答案，
// 只有判分引擎（进程内）能读到它。
type Question struct {
	ID           int64  `gorm:"primaryKey" json:"id"`
	AssessmentID int64  `gorm:"index" json:"assessment_id"`
	Code         string `gorm:"uniqueIndex;size:32" json:"code"`
	OrderNo      int    `json:"order_no"`
	Type         string `gorm:"size:16;index" json:"type"`
	Stem         string `gorm:"size:500" json:"stem"`
	Options      string `gorm:"size:1000" json:"-"`
	Answer       string `gorm:"size:64" json:"-"`
	Score        int    `json:"score"`
}

const (
	CorrectNo  = 0
	CorrectYes = 1
)

// Attempt 一次作答。三个分数字段构成接口层恒等式：
// Score == MechanicalScore + HalfCredit == Σ attempt_answers.Awarded。
type Attempt struct {
	ID            int64      `gorm:"primaryKey" json:"id"`
	AttemptNo     string     `gorm:"uniqueIndex;size:32" json:"attempt_no"`
	AssessmentID  int64      `gorm:"index" json:"assessment_id"`
	CandidateName string     `gorm:"size:64" json:"candidate_name"`
	Phone         string     `gorm:"size:32;index" json:"-"`
	Channel       string     `gorm:"size:16;index" json:"channel"`
	StartedAt     time.Time  `json:"started_at"`
	SubmittedAt   *time.Time `json:"submitted_at,omitempty"`
	ElapsedSec    int        `json:"elapsed_sec"`
	Status        string     `gorm:"size:16;index" json:"status"`
	Score         int        `json:"score"`
	Mechanical    int        `json:"mechanical_score"`
	HalfCredit    int        `json:"half_credit"`
	Passed        bool       `gorm:"index" json:"passed"`
	Reason        string     `gorm:"size:64" json:"reason,omitempty"`
	GradedAt      *time.Time `json:"graded_at,omitempty"`
}

// AttemptAnswer 逐题判分明细（成绩条与题目区分度的唯一数据源）。
type AttemptAnswer struct {
	ID           int64  `gorm:"primaryKey" json:"id"`
	AttemptID    int64  `gorm:"index" json:"attempt_id"`
	QuestionID   int64  `gorm:"index" json:"question_id"`
	QuestionCode string `gorm:"size:32;index" json:"question_code"`
	Picked       string `gorm:"size:64" json:"picked"`
	Correct      int    `json:"correct"`
	Awarded      int    `json:"awarded"`
	MaxScore     int    `json:"max_score"`
}

func (Assessment) TableName() string    { return "assessments" }
func (Question) TableName() string      { return "questions" }
func (Attempt) TableName() string       { return "attempts" }
func (AttemptAnswer) TableName() string { return "attempt_answers" }

// ---- 判分引擎（纯函数，domain 层可单测） ----

// NormalizePicked 把考生提交的作答归一化：
//   - single/judge：取第一个字母并转大写（A-J）
//   - multi：抽出所有字母，去重后按字典序拼成 "ACE"
//   - blank：转小写、去掉所有空白
func NormalizePicked(qType, raw string) string {
	s := strings.TrimSpace(raw)
	switch qType {
	case TypeMulti:
		seen := map[rune]bool{}
		var out []rune
		for _, r := range strings.ToUpper(s) {
			if r >= 'A' && r <= 'Z' && !seen[r] {
				seen[r] = true
				out = append(out, r)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
		return string(out)
	case TypeBlank:
		var b strings.Builder
		for _, r := range strings.ToLower(s) {
			if !isSpaceRune(r) {
				b.WriteRune(r)
			}
		}
		return b.String()
	case TypeJudge:
		// 判断题允许考生写「正确/错误」这类文字，先按语义映射，再退回字母。
		low := strings.ToLower(s)
		for _, w := range judgeFalseWords {
			if strings.Contains(low, w) {
				return "F"
			}
		}
		for _, w := range judgeTrueWords {
			if strings.Contains(low, w) {
				return "T"
			}
		}
		return firstLetter(s)
	default: // single
		return firstLetter(s)
	}
}

// judgeFalseWords 必须排在 judgeTrueWords 之前：「不正确」包含「正确」，
// 先匹配否定词才不会把否定判成肯定。
var (
	judgeFalseWords = []string{"错误", "不对", "不正确", "不是", "误", "否", "false", "×", "✗"}
	judgeTrueWords  = []string{"正确", "对", "是", "true", "√", "✓"}
)

func firstLetter(s string) string {
	for _, r := range strings.ToUpper(strings.TrimSpace(s)) {
		if r >= 'A' && r <= 'Z' {
			return string(r)
		}
	}
	return ""
}

func isSpaceRune(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\r', '　':
		return true
	}
	return false
}

// GradeItem 判定单题得分：
//   - 完全正确 -> 满分，correct=true
//   - 多选题「只漏选不含错选且非空」-> 满分向下取整的一半，correct=false
//   - 其余 -> 0 分，correct=false
//
// 漏选半分是成绩单上 HalfCredit 这一列的唯一来源，因此恒等式
// Score == Mechanical + HalfCredit 天然成立。
func GradeItem(q *Question, rawPicked string) (awarded int, correct bool) {
	picked := NormalizePicked(q.Type, rawPicked)
	answer := NormalizePicked(q.Type, q.Answer)
	if picked == "" || answer == "" {
		return 0, false
	}
	if picked == answer {
		return q.Score, true
	}
	if q.Type == TypeMulti {
		for _, r := range picked {
			if !strings.ContainsRune(answer, r) {
				return 0, false // 含错选项，不得分
			}
		}
		return q.Score / 2, false
	}
	return 0, false
}

// TotalScore 返回卷面满分（= 题目分值之和）。
func TotalScore(qs []Question) int {
	total := 0
	for i := range qs {
		total += qs[i].Score
	}
	return total
}

// Percent 把得分换算成百分制（四舍五入到整数）。
func Percent(score, total int) int {
	if total <= 0 {
		return 0
	}
	return int((float64(score)*100 + 0.5) / float64(total))
}

// OptionList 把 Options 的紧凑 JSON 数组还原成展示用文本。
func (q Question) OptionList() []string {
	parts := strings.Split(strings.Trim(q.Options, "[]"), "|@|")
	if len(parts) == 1 && parts[0] == "" {
		return nil
	}
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, strings.TrimSpace(p))
	}
	return out
}

// MaskPhone 只对外输出脱敏手机号；11 位之外的输入一律整体打码，绝不回显原文。
func MaskPhone(p string) string {
	r := []rune(strings.TrimSpace(p))
	if len(r) == 11 {
		return string(r[:3]) + "****" + string(r[7:])
	}
	if len(r) == 0 {
		return ""
	}
	return strings.Repeat("*", len(r))
}

// ---- 读取视图 ----

// AssessmentRow 是列表接口的行：卷面信息 + 题数/满分/作答数/通过数/平均分。
type AssessmentRow struct {
	Assessment
	QuestionNo   int     `gorm:"column:question_no" json:"question_no"`
	TotalScore   int     `gorm:"column:total_score" json:"total_score"`
	Attempts     int64   `gorm:"column:attempts" json:"attempts"`
	PassedCount  int64   `gorm:"column:passed_count" json:"passed_count"`
	AvgPercent   float64 `gorm:"column:avg_percent" json:"avg_percent"`
	BestScore    int     `gorm:"column:best_score" json:"best_score"`
	OngoingCount int64   `gorm:"column:ongoing_count" json:"ongoing_count"`
}

// AttemptRow 是名单/回执的行：作答 + 卷面口径 + 脱敏联系方式 + 名次。
type AttemptRow struct {
	Attempt
	MaskedPhone  string `gorm:"-" json:"masked_phone"`
	AssessmentNo string `gorm:"column:assessment_code" json:"assessment_code"`
	Title        string `gorm:"column:title" json:"title"`
	Subject      string `gorm:"column:subject" json:"subject"`
	TotalScore   int    `gorm:"column:total_score" json:"total_score"`
	PassScore    int    `gorm:"column:pass_score" json:"pass_score"`
	Percent      int    `gorm:"-" json:"percent"`
	Rank         int    `gorm:"column:rank_no" json:"rank_no"`
}

// QuestionView 是对外卷面试题：没有 Answer、没有 Options 原始串。
type QuestionView struct {
	Code    string   `json:"code"`
	OrderNo int      `json:"order_no"`
	Type    string   `json:"type"`
	Stem    string   `json:"stem"`
	Options []string `json:"options"`
	Score   int      `json:"score"`
}

func (q Question) View() QuestionView {
	return QuestionView{
		Code: q.Code, OrderNo: q.OrderNo, Type: q.Type,
		Stem: q.Stem, Options: q.OptionList(), Score: q.Score,
	}
}

// ItemStat 单题统计：正确率 + 区分度档位 + 选项分布。
type ItemStat struct {
	Code        string  `json:"code"`
	OrderNo     int     `json:"order_no"`
	Type        string  `json:"type"`
	Stem        string  `json:"stem"`
	Score       int     `json:"score"`
	Answered    int64   `json:"answered"`
	CorrectNo   int64   `json:"correct_count"`
	AccuracyPct float64 `json:"accuracy_pct"`
	Awarded     int64   `json:"awarded"`
	Difficulty  string  `json:"difficulty"` // 易 / 中 / 难 / 空题
	// Revealed=false 表示该题所属场次还没闭卷：只公布正确率，不公布作答分布（防泄题）。
	Revealed    bool         `json:"revealed"`
	Distractors []Distractor `json:"distractors,omitempty"`
}

type Distractor struct {
	Picked string `json:"picked"`
	Count  int64  `json:"count"`
}

// ScoreBucket 分数段（百分制）。
type ScoreBucket struct {
	Label string `json:"label"`
	From  int    `json:"from"`
	To    int    `json:"to"`
	Count int64  `json:"count"`
}

// DailyPoint 近 N 日作答趋势。
type DailyPoint struct {
	Day      string  `json:"day"`
	Attempts int64   `json:"attempts"`
	Passed   int64   `json:"passed"`
	AvgPct   float64 `json:"avg_percent"`
}

// SubjectRollup 按科目汇总。
type SubjectRollup struct {
	Subject  string  `gorm:"column:subject" json:"subject"`
	Attempts int64   `gorm:"column:attempts" json:"attempts"`
	Passed   int64   `gorm:"column:passed" json:"passed"`
	AvgPct   float64 `gorm:"column:avg_pct" json:"avg_percent"`
	PassPct  float64 `gorm:"column:pass_pct" json:"pass_pct"`
}

// Stats 是 /api/stats 的全量口径。
type Stats struct {
	Assessments       int64   `json:"assessments"`
	OpenAssessments   int64   `json:"open_assessments"`
	DraftAssessments  int64   `json:"draft_assessments"`
	ClosedAssessments int64   `json:"closed_assessments"`
	Questions         int64   `json:"questions"`
	Attempts          int64   `json:"attempts"`
	Graded            int64   `json:"graded"`
	Ongoing           int64   `json:"ongoing"`
	Invalid           int64   `json:"invalid"`
	Passed            int64   `json:"passed"`
	PassRatePct       float64 `json:"pass_rate_pct"`
	AvgPercent        float64 `json:"avg_percent"`
	HalfCreditSum     int64   `json:"half_credit_total"`
	ScoreSum          int64   `json:"score_total"`
	MechSum           int64   `json:"mechanical_total"`
	// IdentityOK 是三分数恒等式体检：Score 必须等于 Mechanical + HalfCredit。
	// 真出现违反项时翻成 false 并给出条数，而不是把口径悄悄修平。
	IdentityViolations int64           `json:"identity_violations"`
	IdentityOK         bool            `json:"identity_ok"`
	Buckets            []ScoreBucket   `json:"buckets"`
	Subjects           []SubjectRollup `json:"subjects"`
	Daily              []DailyPoint    `json:"daily"`
	Hardest            []ItemStat      `json:"hardest_items"`
	TopBoard           []AttemptRow    `json:"top_board"`
	GeneratedAt        time.Time       `json:"generated_at"`
	Window             string          `json:"window"`
}

// ReceiptItem 是成绩单上的一行（不含标准答案）。
type ReceiptItem struct {
	Code     string `json:"code"`
	OrderNo  int    `json:"order_no"`
	Type     string `json:"type"`
	Stem     string `json:"stem"`
	Picked   string `json:"picked"`
	Correct  bool   `json:"correct"`
	Awarded  int    `json:"awarded"`
	MaxScore int    `json:"max_score"`
}

// ---- 写入 DTO ----

type StartAttemptInput struct {
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	Channel string `json:"channel"`
}

type AnswerInput struct {
	QuestionCode string `json:"question_code"`
	Picked       string `json:"picked"`
}

type SubmitInput struct {
	Answers []AnswerInput `json:"answers"`
}

type AssessmentStatusInput struct {
	To string `json:"to"`
}

// codeAllowed 是标识符白名单：只允许字母数字与 - _，
// 引号/分号/反斜杠/空格一类的注入字符直接挡在 DTO 校验层。
func codeAllowed(s string) bool {
	for _, r := range s {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return false
		}
	}
	return true
}

func (in StartAttemptInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	n := utf8.RuneCountInString(in.Name)
	if n < 1 || n > 32 {
		errs["name"] = "姓名需为 1-32 个字符"
	}
	if !validPhone(in.Phone) {
		errs["phone"] = "手机号需为 11 位、以 1 开头的数字"
	}
	switch in.Channel {
	case "", "web", "campus", "partner":
	default:
		errs["channel"] = "channel 只能是 web / campus / partner"
	}
	return errs, len(errs) == 0
}

func validPhone(p string) bool {
	r := []rune(strings.TrimSpace(p))
	if len(r) != 11 || r[0] != '1' || r[1] < '3' || r[1] > '9' {
		return false
	}
	for _, d := range r {
		if d < '0' || d > '9' {
			return false
		}
	}
	return true
}

func (in SubmitInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	if len(in.Answers) == 0 {
		errs["answers"] = "至少提交一道题的作答"
	}
	if len(in.Answers) > 100 {
		errs["answers"] = "单次提交最多 100 条作答"
	}
	seen := map[string]bool{}
	for i, a := range in.Answers {
		code := strings.TrimSpace(a.QuestionCode)
		if code == "" || !codeAllowed(code) || len(code) > 32 {
			errs["answers["+strconv.Itoa(i)+"].question_code"] = "题目编码只允许字母、数字、- 与 _"
			continue
		}
		if seen[code] {
			errs["answers["+strconv.Itoa(i)+"].question_code"] = "同一道题重复提交"
			continue
		}
		seen[code] = true
		if utf8.RuneCountInString(a.Picked) > 64 {
			errs["answers["+strconv.Itoa(i)+"].picked"] = "单题作答内容不得超过 64 个字符"
		}
	}
	return errs, len(errs) == 0
}

func (in AssessmentStatusInput) Validate() (map[string]string, bool) {
	errs := map[string]string{}
	switch in.To {
	case AsmtOpen, AsmtClosed:
	default:
		errs["to"] = "to 只能是 open 或 closed"
	}
	return errs, len(errs) == 0
}

func ValidAssessmentStatus(s string) bool {
	return s == AsmtDraft || s == AsmtOpen || s == AsmtClosed
}

func ValidAttemptStatus(s string) bool {
	return s == AttemptOngoing || s == AttemptGraded || s == AttemptInvalid
}

// CanMoveAssessment 是试卷状态机的唯一真源。
func CanMoveAssessment(from, to string) bool {
	switch from {
	case AsmtDraft:
		return to == AsmtOpen
	case AsmtOpen:
		return to == AsmtClosed
	default:
		return false
	}
}
