package repository

import (
	"context"
	"strconv"
	"time"

	"libdesk/internal/domain"
)

// Stats 汇总口径全部来自 items/copies/members/loans 四张表，前端不做二次计算。
// 三条恒等式在接口层显式回验：
//  1. on_loan_copies == active_loans（副本状态与借阅状态一一对应）；
//  2. outstanding_fine == Σ(已归还且未缴的 fine_cents)（欠费与借阅账同源）；
//  3. available + on_loan + missing + retired == total_copies（库存守恒）。
func (r *Repo) Stats(ctx context.Context, days int) (*domain.Stats, error) {
	if days < 3 {
		days = 3
	}
	if days > 30 {
		days = 30
	}
	db := r.db.WithContext(ctx)
	scan := func(dest any, sql string, args ...any) error {
		return db.Raw(sql, args...).Scan(dest).Error
	}
	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	dayStart := now.UTC().Truncate(24 * time.Hour)

	s := &domain.Stats{GeneratedAt: now, Today: today, Window: "近 " + strconv.Itoa(days) + " 天借还趋势（全量口径的库存与欠费为当前时点）"}

	if err := scan(&s.TotalItems, `SELECT COUNT(*) FROM items`); err != nil {
		return nil, err
	}
	if err := scan(&s.TotalMembers, `SELECT COUNT(*) FROM members`); err != nil {
		return nil, err
	}
	if err := scan(&s.ActiveMembers, `SELECT COUNT(*) FROM members WHERE status = 'active'`); err != nil {
		return nil, err
	}
	if err := scan(&s.SuspendedMembers, `SELECT COUNT(*) FROM members WHERE status = 'suspended'`); err != nil {
		return nil, err
	}

	if err := scan(&s.TotalCopies, `SELECT COUNT(*) FROM copies`); err != nil {
		return nil, err
	}
	type copyKV struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var copyStatuses []copyKV
	if err := scan(&copyStatuses, `SELECT status AS k, COUNT(*) AS v FROM copies GROUP BY status`); err != nil {
		return nil, err
	}
	var sumByStatus int64
	for _, c := range copyStatuses {
		sumByStatus += c.V
		switch c.K {
		case domain.CopyAvailable:
			s.AvailableCopies = c.V
		case domain.CopyOnLoan:
			s.OnLoanCopies = c.V
		}
	}

	type loanKV struct {
		K string `gorm:"column:k"`
		V int64  `gorm:"column:v"`
	}
	var loanStatuses []loanKV
	if err := scan(&loanStatuses, `SELECT status AS k, COUNT(*) AS v FROM loans GROUP BY status`); err != nil {
		return nil, err
	}
	for _, l := range loanStatuses {
		switch l.K {
		case domain.LoanActive:
			s.ActiveLoans = l.V
		case domain.LoanReturned:
			s.ReturnedLoans = l.V
		}
	}
	if err := scan(&s.OverdueLoans, `SELECT COUNT(*) FROM loans WHERE status = 'active' AND due_at < ?`, now); err != nil {
		return nil, err
	}
	if err := scan(&s.OutstandingFine, `SELECT COALESCE(SUM(fine_cents),0) FROM loans WHERE status = 'returned' AND fine_paid = 0`); err != nil {
		return nil, err
	}
	if err := scan(&s.CollectedFine, `SELECT COALESCE(SUM(fine_cents),0) FROM loans WHERE status = 'returned' AND fine_paid = 1`); err != nil {
		return nil, err
	}
	if err := scan(&s.BorrowToday, `SELECT COUNT(*) FROM loans WHERE borrowed_at >= ?`, dayStart); err != nil {
		return nil, err
	}
	if err := scan(&s.ReturnToday, `SELECT COUNT(*) FROM loans WHERE returned_at IS NOT NULL AND returned_at >= ?`, dayStart); err != nil {
		return nil, err
	}

	type dayCount struct {
		Day string `gorm:"column:day"`
		N   int64  `gorm:"column:n"`
	}
	borrowDay := map[string]int64{}
	returnDay := map[string]int64{}
	var borrows []dayCount
	if err := scan(&borrows, `SELECT strftime('%Y-%m-%d', borrowed_at) AS day, COUNT(*) AS n
		FROM loans WHERE borrowed_at >= ? GROUP BY day`, dayStart.Add(-time.Duration(days-1)*24*time.Hour)); err != nil {
		return nil, err
	}
	var returns []dayCount
	if err := scan(&returns, `SELECT strftime('%Y-%m-%d', returned_at) AS day, COUNT(*) AS n
		FROM loans WHERE returned_at IS NOT NULL AND returned_at >= ? GROUP BY day`,
		dayStart.Add(-time.Duration(days-1)*24*time.Hour)); err != nil {
		return nil, err
	}
	for _, b := range borrows {
		borrowDay[b.Day] = b.N
	}
	for _, b := range returns {
		returnDay[b.Day] = b.N
	}
	// 连续日历：没有流水的日子也要占一格，否则「近两周」会在稀疏处误导读者。
	s.Trend = make([]domain.TrendPoint, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := dayStart.Add(-time.Duration(i) * 24 * time.Hour).Format("2006-01-02")
		s.Trend = append(s.Trend, domain.TrendPoint{Day: d, Borrow: borrowDay[d], Return: returnDay[d]})
	}

	// 类别汇总：复本数与在借数各自先聚合再回接书目，
	// 直接 LEFT JOIN loans 会按历史借阅把复本数放大。
	if err := scan(&s.ByCategory, `SELECT i.category AS category,
		COUNT(*) AS items,
		COALESCE(SUM(c.cnt),0) AS copies,
		COALESCE(SUM(a.cnt),0) AS active_loans
		FROM items i
		LEFT JOIN (SELECT item_id, COUNT(*) AS cnt FROM copies GROUP BY item_id) c ON c.item_id = i.id
		LEFT JOIN (SELECT cp.item_id, COUNT(*) AS cnt FROM loans l
			JOIN copies cp ON cp.id = l.copy_id WHERE l.status = 'active' GROUP BY cp.item_id) a ON a.item_id = i.id
		GROUP BY i.category ORDER BY i.category`); err != nil {
		return nil, err
	}

	s.IdentityIssues = []string{}
	if s.OnLoanCopies != s.ActiveLoans {
		s.IdentityIssues = append(s.IdentityIssues, "on_loan_copies != active_loans")
	}
	var realOutstanding int64
	if err := scan(&realOutstanding, `SELECT COALESCE(SUM(fine_cents),0) FROM loans WHERE status = 'returned' AND fine_paid = 0`); err != nil {
		return nil, err
	}
	if realOutstanding != s.OutstandingFine {
		s.IdentityIssues = append(s.IdentityIssues, "outstanding_fine != sum(unpaid loan fines)")
	}
	if sumByStatus != s.TotalCopies {
		s.IdentityIssues = append(s.IdentityIssues, "copies by status != total_copies")
	}
	var lostActive int64
	if err := scan(&lostActive, `SELECT COUNT(*) FROM loans l
		JOIN copies c ON c.id = l.copy_id
		WHERE l.status = 'active' AND c.status != 'on_loan'`); err != nil {
		return nil, err
	}
	if lostActive > 0 {
		s.IdentityIssues = append(s.IdentityIssues, "active loans whose copy is not marked on_loan")
	}
	var orphanOnLoan int64
	if err := scan(&orphanOnLoan, `SELECT COUNT(*) FROM copies c WHERE c.status = 'on_loan'
		AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.status = 'active')`); err != nil {
		return nil, err
	}
	if orphanOnLoan > 0 {
		s.IdentityIssues = append(s.IdentityIssues, "on_loan copies without an active loan")
	}
	s.IdentityOK = len(s.IdentityIssues) == 0
	return s, nil
}
