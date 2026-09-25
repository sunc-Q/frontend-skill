package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"libdesk/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}

func MaskPhone(p string) string {
	r := []rune(p)
	if len(r) < 7 {
		return ""
	}
	return string(r[:3]) + "****" + string(r[len(r)-4:])
}

// ---- 馆藏 ----

const itemSelect = `i.*, COALESCE(cc.total_copies,0) AS total_copies,
	COALESCE(cc.available_copies,0) AS available_copies,
	COALESCE(cc.on_loan_copies,0) AS on_loan_copies`

// itemCounts 必须先按 item_id 聚合成子查询再 LEFT JOIN：
// 直接多表 LEFT JOIN 会让 COUNT 与 SUM 互相放大。
func (r *Repo) ListItems(ctx context.Context, q domain.ListQuery) ([]domain.ItemRow, int64, error) {
	counts := `(SELECT item_id, COUNT(*) AS total_copies,
		SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available_copies,
		SUM(CASE WHEN status = 'on_loan' THEN 1 ELSE 0 END) AS on_loan_copies
		FROM copies GROUP BY item_id)`
	base := r.db.WithContext(ctx).Table("items AS i").
		Joins("LEFT JOIN " + counts + " AS cc ON cc.item_id = i.id")

	if q.Category != "" {
		base = base.Where("i.category = ?", q.Category)
	}
	switch q.Status {
	case "available":
		base = base.Where("COALESCE(cc.available_copies,0) > 0")
	case "on_loan":
		base = base.Where("COALESCE(cc.on_loan_copies,0) > 0")
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(i.title LIKE ? ESCAPE '\\' OR i.author LIKE ? ESCAPE '\\' OR i.code LIKE ? ESCAPE '\\')", like, like, like)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.ItemRow
	err := base.Select(itemSelect).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", i.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

func (r *Repo) ItemByCode(ctx context.Context, code string) (*domain.ItemRow, error) {
	var row domain.ItemRow
	err := r.db.WithContext(ctx).Table("items AS i").
		Joins("LEFT JOIN (SELECT item_id, COUNT(*) AS total_copies, SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available_copies, SUM(CASE WHEN status = 'on_loan' THEN 1 ELSE 0 END) AS on_loan_copies FROM copies GROUP BY item_id) AS cc ON cc.item_id = i.id").
		Select(itemSelect).Where("i.code = ?", code).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

const copySelect = `c.*, i.code AS item_code, i.title AS item_title,
	m.card_no AS borrower_card, m.name AS borrower_name, l.due_at AS due_at`

func (r *Repo) CopiesOfItem(ctx context.Context, itemID int64) ([]domain.CopyRow, error) {
	var out []domain.CopyRow
	err := r.db.WithContext(ctx).Table("copies AS c").
		Select(copySelect).
		Joins("JOIN items i ON i.id = c.item_id").
		Joins("LEFT JOIN loans l ON l.copy_id = c.id AND l.status = 'active'").
		Joins("LEFT JOIN members m ON m.id = l.member_id").
		Where("c.item_id = ?", itemID).
		Order("c.barcode ASC").Scan(&out).Error
	return out, err
}

// ---- 借还 ----

const loanSelect = `l.*, m.card_no AS member_card, m.name AS member_name,
	m.member_type AS member_type, m.status AS member_status,
	i.code AS item_code, i.title AS item_title, i.category AS item_category,
	c.barcode AS copy_barcode, c.location AS copy_location`

func (r *Repo) listLoans(db *gorm.DB, q domain.ListQuery) (*gorm.DB, error) {
	base := db.Table("loans AS l").
		Joins("JOIN members m ON m.id = l.member_id").
		Joins("JOIN copies c ON c.id = l.copy_id").
		Joins("JOIN items i ON i.id = c.item_id")
	if q.Status == "overdue" {
		base = base.Where("l.status = ? AND l.due_at < ?", domain.LoanActive, time.Now().UTC())
	} else if q.Status != "" {
		base = base.Where("l.status = ?", q.Status)
	}
	if q.Category != "" {
		base = base.Where("i.category = ?", q.Category)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(m.name LIKE ? ESCAPE '\\' OR m.card_no LIKE ? ESCAPE '\\' OR i.title LIKE ? ESCAPE '\\' OR c.barcode LIKE ? ESCAPE '\\')",
			like, like, like, like)
	}
	return base, nil
}

func (r *Repo) ListLoans(ctx context.Context, q domain.ListQuery) ([]domain.LoanRow, int64, error) {
	base, err := r.listLoans(r.db.WithContext(ctx), q)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []domain.LoanRow
	err = base.Select(loanSelect).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", l.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

func (r *Repo) Loan(ctx context.Context, id int64) (*domain.LoanRow, error) {
	var row domain.LoanRow
	err := r.db.WithContext(ctx).Table("loans AS l").
		Select(loanSelect).
		Joins("JOIN members m ON m.id = l.member_id").
		Joins("JOIN copies c ON c.id = l.copy_id").
		Joins("JOIN items i ON i.id = c.item_id").
		Where("l.id = ?", id).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

func (r *Repo) MemberByCard(ctx context.Context, card string) (*domain.MemberDetail, error) {
	var m domain.MemberDetail
	err := r.db.WithContext(ctx).Where("card_no = ?", card).First(&m.Member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	db := r.db.WithContext(ctx)
	if err := db.Raw(`SELECT COUNT(*) FROM loans WHERE member_id = ? AND status = 'active'`, m.ID).Scan(&m.ActiveLoans).Error; err != nil {
		return nil, err
	}
	if err := db.Raw(`SELECT COUNT(*) FROM loans WHERE member_id = ? AND status = 'active' AND due_at < ?`, m.ID, time.Now().UTC()).Scan(&m.OverdueLoans).Error; err != nil {
		return nil, err
	}
	if err := db.Raw(`SELECT COALESCE(SUM(fine_cents),0) FROM loans WHERE member_id = ? AND status = 'returned' AND fine_paid = 0`, m.ID).Scan(&m.OutstandingFine).Error; err != nil {
		return nil, err
	}
	m.Quota = domain.MemberQuota(m.MemberType)
	m.PhoneMasked = MaskPhone(m.Phone)
	return &m, nil
}

func (r *Repo) LoansOfMember(ctx context.Context, memberID int64, limit int) ([]domain.LoanRow, error) {
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	var out []domain.LoanRow
	err := r.db.WithContext(ctx).Table("loans AS l").
		Select(loanSelect).
		Joins("JOIN members m ON m.id = l.member_id").
		Joins("JOIN copies c ON c.id = l.copy_id").
		Joins("JOIN items i ON i.id = c.item_id").
		Where("l.member_id = ?", memberID).
		Order("l.borrowed_at DESC").Limit(limit).Scan(&out).Error
	return out, err
}

// CopyByBarcode 返回副本 + 所属书目（借出主键校验用）。
func (r *Repo) CopyByBarcode(ctx context.Context, barcode string) (*domain.CopyRow, error) {
	var row domain.CopyRow
	err := r.db.WithContext(ctx).Table("copies AS c").
		Select(copySelect).
		Joins("JOIN items i ON i.id = c.item_id").
		Joins("LEFT JOIN loans l ON l.copy_id = c.id AND l.status = 'active'").
		Joins("LEFT JOIN members m ON m.id = l.member_id").
		Where("c.barcode = ?", barcode).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

// ---- 流通事务（单写者：闭包内一切查询必须走 tx） ----

// Borrow 在一个事务里完成：副本在架 → 会员可用 → 配额/欠费门槛 → 写在架状态与借阅行。
func (r *Repo) Borrow(ctx context.Context, copyID, memberID int64, category string, now time.Time) (*domain.Loan, error) {
	var loan domain.Loan
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var c domain.Copy
		if err := tx.First(&c, copyID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if c.Status != domain.CopyAvailable {
			return domain.New("copy_unavailable", "该副本当前不在架，无法借出", 409)
		}
		var m domain.Member
		if err := tx.First(&m, memberID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		var active int64
		if err := tx.Model(&domain.Loan{}).Where("member_id = ? AND status = ?", m.ID, domain.LoanActive).
			Count(&active).Error; err != nil {
			return err
		}
		if active >= int64(domain.MemberQuota(m.MemberType)) {
			return domain.New("quota_exceeded", "在借数量已达该证别上限", 409)
		}
		var outstanding int64
		if err := tx.Model(&domain.Loan{}).
			Where("member_id = ? AND status = ? AND fine_paid = 0", m.ID, domain.LoanReturned).
			Select("COALESCE(SUM(fine_cents),0)").Scan(&outstanding).Error; err != nil {
			return err
		}
		if outstanding > domain.FineGateCents {
			return domain.New("fine_gate", "未缴逾期费已超过停借额度，请先缴费", 409)
		}
		var onLoan int64
		if err := tx.Model(&domain.Loan{}).Where("copy_id = ? AND status = ?", c.ID, domain.LoanActive).
			Count(&onLoan).Error; err != nil {
			return err
		}
		if onLoan > 0 {
			return domain.New("copy_unavailable", "该副本已被借出", 409)
		}
		rule := domain.CatRules[category]
		loan = domain.Loan{
			CopyID: c.ID, MemberID: m.ID, Status: domain.LoanActive,
			BorrowedAt: now, DueAt: now.AddDate(0, 0, rule.LoanDays),
		}
		if err := tx.Create(&loan).Error; err != nil {
			return err
		}
		return tx.Model(&domain.Copy{}).Where("id = ?", c.ID).
			Update("status", domain.CopyOnLoan).Error
	})
	if err != nil {
		return nil, err
	}
	return &loan, nil
}

// Return 结算逾期费（快照不回溯：归还后 FineCents 固定），并把副本恢复在架。
func (r *Repo) Return(ctx context.Context, loanID int64, paid bool, now time.Time) (*domain.Loan, int64, error) {
	var loan domain.Loan
	var fine int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var l domain.Loan
		if err := tx.First(&l, loanID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if l.Status != domain.LoanActive {
			return domain.New("invalid_state", "该借阅记录已归还", 409)
		}
		var c domain.Copy
		if err := tx.First(&c, l.CopyID).Error; err != nil {
			return err
		}
		var i domain.Item
		if err := tx.First(&i, c.ItemID).Error; err != nil {
			return err
		}
		overdue := domain.OverdueDays(l.DueAt, now)
		fine = domain.FineFor(overdue, i.Category)
		updates := map[string]any{
			"status":      domain.LoanReturned,
			"returned_at": now,
			"fine_cents":  fine,
			"fine_paid":   fine == 0 || paid,
		}
		if err := tx.Model(&domain.Loan{}).Where("id = ?", l.ID).Updates(updates).Error; err != nil {
			return err
		}
		if err := tx.Model(&domain.Copy{}).Where("id = ?", c.ID).
			Update("status", domain.CopyAvailable).Error; err != nil {
			return err
		}
		l.Status = domain.LoanReturned
		l.ReturnedAt = &now
		l.FineCents = fine
		l.FinePaid = fine == 0 || paid
		loan = l
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	return &loan, fine, nil
}

// Renew 续借：未逾期且次数未用尽，到期日按书别续借天数顺延。
func (r *Repo) Renew(ctx context.Context, loanID int64, now time.Time) (*domain.Loan, error) {
	var loan domain.Loan
	var newDue time.Time
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var l domain.Loan
		if err := tx.First(&l, loanID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		if l.Status != domain.LoanActive {
			return domain.New("invalid_state", "已归还的借阅不能续借", 409)
		}
		// 逾期优先于次数用尽：逾期是硬门槛，先告诉馆员「先归还并缴费」，
		// 否则一条续借用尽的逾期单只会得到「次数已用尽」这条没用的答复。
		if domain.OverdueDays(l.DueAt, now) > 0 {
			return domain.New("overdue_no_renew", "已逾期，请先归还并缴清逾期费", 409)
		}
		if l.RenewCount >= domain.MaxRenewals {
			return domain.New("renew_exhausted", "续借次数已用尽", 409)
		}
		var c domain.Copy
		if err := tx.First(&c, l.CopyID).Error; err != nil {
			return err
		}
		var i domain.Item
		if err := tx.First(&i, c.ItemID).Error; err != nil {
			return err
		}
		rule := domain.CatRules[i.Category]
		newDue = l.DueAt.AddDate(0, 0, rule.RenewDays)
		updates := map[string]any{"due_at": newDue, "renew_count": l.RenewCount + 1}
		if err := tx.Model(&domain.Loan{}).Where("id = ?", l.ID).Updates(updates).Error; err != nil {
			return err
		}
		l.DueAt = newDue
		l.RenewCount++
		loan = l
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &loan, nil
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("items").Count(&n).Error
	return n > 0, err
}
