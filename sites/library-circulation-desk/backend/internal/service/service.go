package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"libdesk/internal/domain"
	"libdesk/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Items(ctx context.Context, q domain.ListQuery) ([]domain.ItemRow, int64, error) {
	return s.repo.ListItems(ctx, q)
}

func (s *Service) ItemDetail(ctx context.Context, code string) (*domain.ItemRow, []domain.CopyRow, error) {
	code = strings.TrimSpace(code)
	if !safeCode(code) {
		return nil, nil, domain.ErrNotFound
	}
	item, err := s.repo.ItemByCode(ctx, code)
	if err != nil {
		return nil, nil, err
	}
	copies, err := s.repo.CopiesOfItem(ctx, item.ID)
	if err != nil {
		return nil, nil, err
	}
	return item, copies, nil
}

func (s *Service) Loans(ctx context.Context, q domain.ListQuery) ([]domain.LoanRow, int64, error) {
	rows, total, err := s.repo.ListLoans(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	decorate(rows, s.now())
	return rows, total, nil
}

// LoanDetail 返回单条借阅（含逾期天数与当前应计罚金预估）。
func (s *Service) LoanDetail(ctx context.Context, id int64) (*domain.LoanRow, error) {
	row, err := s.repo.Loan(ctx, id)
	if err != nil {
		return nil, err
	}
	one := []domain.LoanRow{*row}
	decorate(one, s.now())
	row.OverdueDays = one[0].OverdueDays
	row.FineDue = one[0].FineDue
	return row, nil
}

func (s *Service) Member(ctx context.Context, card string) (*domain.MemberDetail, []domain.LoanRow, error) {
	card = strings.TrimSpace(card)
	if !safeCode(card) {
		return nil, nil, domain.ErrNotFound
	}
	m, err := s.repo.MemberByCard(ctx, card)
	if err != nil {
		return nil, nil, err
	}
	loans, err := s.repo.LoansOfMember(ctx, m.ID, 12)
	if err != nil {
		return nil, nil, err
	}
	decorate(loans, s.now())
	return m, loans, nil
}

func (s *Service) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	return s.repo.Stats(ctx, days)
}

// Borrow 借出：字段校验 → 副本/书目/读者状态 → 事务化写库。
func (s *Service) Borrow(ctx context.Context, in domain.BorrowInput) (*domain.LoanRow, error) {
	in.Barcode = strings.TrimSpace(in.Barcode)
	in.CardNo = strings.TrimSpace(in.CardNo)
	if !utf8.ValidString(in.Barcode) || !utf8.ValidString(in.CardNo) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	cp, err := s.repo.CopyByBarcode(ctx, in.Barcode)
	if err != nil {
		return nil, err
	}
	item, err := s.repo.ItemByCode(ctx, cp.ItemCode)
	if err != nil {
		return nil, err
	}
	if item.Category == domain.CatReference {
		return nil, domain.New("reference_only", "参考工具书仅限馆内阅览，不外借", 409)
	}
	m, err := s.repo.MemberByCard(ctx, in.CardNo)
	if err != nil {
		return nil, err
	}
	if m.Status != domain.MemberActive {
		return nil, domain.New("member_suspended", "读者证已挂失/停用，无法借出", 409)
	}
	loan, err := s.repo.Borrow(ctx, cp.ID, m.ID, item.Category, s.now())
	if err != nil {
		return nil, err
	}
	return s.LoanDetail(ctx, loan.ID)
}

// Return 归还：逾期费按 domain.FineFor 一次性结算并快照，之后不回溯。
func (s *Service) Return(ctx context.Context, loanID int64, paid bool) (*domain.LoanRow, int64, error) {
	cur, err := s.repo.Loan(ctx, loanID)
	if err != nil {
		return nil, 0, err
	}
	if cur.Status != domain.LoanActive {
		return nil, 0, domain.New("invalid_state", "该借阅记录已归还", 409)
	}
	if _, _, err := s.repo.Return(ctx, loanID, paid, s.now()); err != nil {
		return nil, 0, err
	}
	row, err := s.LoanDetail(ctx, loanID)
	if err != nil {
		return nil, 0, err
	}
	return row, row.FineCents, nil
}

// Renew 续借：仅未逾期的在借单，且次数未用尽。
func (s *Service) Renew(ctx context.Context, loanID int64) (*domain.LoanRow, error) {
	if _, err := s.repo.Renew(ctx, loanID, s.now()); err != nil {
		return nil, err
	}
	return s.LoanDetail(ctx, loanID)
}

// decorate 为在借单补算「当前逾期天数」与「按归还日口径的应计罚金」。
// 已归还行沿用结算快照，绝不重算——这是「快照不回溯」的对外承诺。
func decorate(rows []domain.LoanRow, now time.Time) {
	for i := range rows {
		if rows[i].Status != domain.LoanActive {
			rows[i].OverdueDays = 0
			rows[i].FineDue = rows[i].FineCents
			continue
		}
		od := domain.OverdueDays(rows[i].DueAt, now)
		rows[i].OverdueDays = od
		rows[i].FineDue = domain.FineFor(od, rows[i].ItemCategory)
	}
}

func safeCode(s string) bool {
	if s == "" || len(s) > 24 {
		return false
	}
	for _, r := range s {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_'
		if !ok {
			return false
		}
	}
	return true
}
