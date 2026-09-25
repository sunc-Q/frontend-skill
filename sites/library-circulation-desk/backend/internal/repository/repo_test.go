package repository

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"libdesk/internal/domain"
)

var itemSortKeys = []string{"code", "title", "author", "year", "category", "added", "available", "total", "id"}
var loanSortKeys = []string{"due", "borrowed", "returned", "member", "item", "barcode", "fine", "renew", "status", "id"}

func itemQ(sortKey string) domain.ListQuery {
	return domain.ParseItemQuery(map[string][]string{"sort": {sortKey}})
}

func loanQ(sortKey string) domain.ListQuery {
	return domain.ParseLoanQuery(map[string][]string{"sort": {sortKey}})
}

func openSeeded(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	repo := New(db)
	if err := repo.Seed(context.Background(), time.Now()); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return repo
}

func TestSeedSelfCheck(t *testing.T) {
	repo := openSeeded(t)
	ctx := context.Background()

	stats, err := repo.Stats(ctx, 14)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if !stats.IdentityOK {
		t.Fatalf("种子破坏了恒等式: %v", stats.IdentityIssues)
	}
	if stats.TotalItems != 20 {
		t.Fatalf("书目数 %d != 20", stats.TotalItems)
	}
	if stats.TotalMembers != 26 || stats.SuspendedMembers != 2 {
		t.Fatalf("读者口径异常: total=%d suspended=%d", stats.TotalMembers, stats.SuspendedMembers)
	}
	if stats.ActiveLoans == 0 || stats.OverdueLoans < 7 {
		t.Fatalf("在借/逾期覆盖不足: active=%d overdue=%d", stats.ActiveLoans, stats.OverdueLoans)
	}
	if stats.OutstandingFine <= domain.FineGateCents {
		t.Fatalf("应存在超过停借门槛的欠费样本: %d", stats.OutstandingFine)
	}

	// 参考工具书零外借。
	item, err := repo.ItemByCode(ctx, "978-7-02-00018")
	if err != nil {
		t.Fatalf("辞源书目缺失: %v", err)
	}
	if item.Category != domain.CatReference {
		t.Fatalf("第 18 种应为参考书: %s", item.Category)
	}
	copies, err := repo.CopiesOfItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("copies: %v", err)
	}
	for _, c := range copies {
		if c.Status == domain.CopyOnLoan || c.BorrowerCard != "" {
			t.Fatalf("参考书副本被借出: %+v", c)
		}
	}

	// 副本在架状态与「是否存在在借单」必须互相刻画（一册有多条历史借阅，不能逐行比对）。
	var mismatch int64
	if err := repo.db.Raw(`SELECT
		(SELECT COUNT(*) FROM loans l JOIN copies c ON c.id = l.copy_id
			WHERE l.status='active' AND c.status != 'on_loan') +
		(SELECT COUNT(*) FROM copies c WHERE c.status='on_loan'
			AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.copy_id = c.id AND l.status='active'))`).Scan(&mismatch).Error; err != nil {
		t.Fatal(err)
	}
	if mismatch != 0 {
		t.Fatalf("借阅状态与副本状态不一致的行数: %d", mismatch)
	}

	// 已归还行的逾期费必须等于 FineFor(归还日口径)——快照口径唯一。
	type fin struct {
		ID   int64     `gorm:"column:id"`
		Fine int64     `gorm:"column:fine"`
		Due  time.Time `gorm:"column:due"`
		Ret  time.Time `gorm:"column:ret"`
		Cat  string    `gorm:"column:cat"`
	}
	var fins []fin
	if err := repo.db.Raw(`SELECT l.id AS id, l.fine_cents AS fine, l.due_at AS due, l.returned_at AS ret, i.category AS cat
		FROM loans l JOIN copies c ON c.id=l.copy_id JOIN items i ON i.id=c.item_id
		WHERE l.status='returned'`).Scan(&fins).Error; err != nil {
		t.Fatal(err)
	}
	if len(fins) == 0 {
		t.Fatal("种子没有已归还借阅")
	}
	for _, f := range fins {
		if want := domain.FineFor(domain.OverdueDays(f.Due, f.Ret), f.Cat); want != f.Fine {
			t.Fatalf("归还单 #%d 逾期费 %d 与口径值 %d 不符", f.ID, f.Fine, want)
		}
	}
}

// 第 6/7 轮血的教训：白名单里引用的表别名/列若不存在，只有把每个键真的执行一遍才能抓到。
func TestEveryListSortKeyResolves(t *testing.T) {
	repo := openSeeded(t)
	ctx := context.Background()
	for _, key := range itemSortKeys {
		for _, dir := range []string{"asc", "desc"} {
			q := itemQ(key)
			q.Dir = dir
			if _, _, err := repo.ListItems(ctx, q); err != nil {
				t.Fatalf("items sort=%s dir=%s 失败: %v", key, dir, err)
			}
		}
	}
	for _, key := range loanSortKeys {
		for _, dir := range []string{"asc", "desc"} {
			q := loanQ(key)
			q.Dir = dir
			if _, _, err := repo.ListLoans(ctx, q); err != nil {
				t.Fatalf("loans sort=%s dir=%s 失败: %v", key, dir, err)
			}
		}
	}
	// 每个过滤枚举也要真跑一遍
	for _, st := range []string{"", "available", "on_loan"} {
		q := itemQ("code")
		q.Status = st
		if _, _, err := repo.ListItems(ctx, q); err != nil {
			t.Fatalf("items status=%s 失败: %v", st, err)
		}
	}
	for _, st := range []string{"", "active", "returned", "overdue"} {
		q := loanQ("due")
		q.Status = st
		if _, _, err := repo.ListLoans(ctx, q); err != nil {
			t.Fatalf("loans status=%s 失败: %v", st, err)
		}
	}
}

func TestBorrowReturnRenewFlows(t *testing.T) {
	repo := openSeeded(t)
	ctx := context.Background()
	now := time.Now().UTC()

	rows, _, err := repo.ListItems(ctx, itemQ("code"))
	if err != nil {
		t.Fatal(err)
	}
	var target *domain.ItemRow
	for i := range rows {
		if rows[i].Category == domain.CatGeneral && rows[i].AvailableCopies > 0 {
			target = &rows[i]
			break
		}
	}
	if target == nil {
		t.Fatal("种子中没有可借的普通书")
	}
	copies, err := repo.CopiesOfItem(ctx, target.ID)
	if err != nil {
		t.Fatal(err)
	}
	var cp *domain.CopyRow
	for i := range copies {
		if copies[i].Status == domain.CopyAvailable {
			cp = &copies[i]
			break
		}
	}
	if cp == nil {
		t.Fatal("目标书目没有在架副本")
	}
	member, err := repo.MemberByCard(ctx, "R-2026-0001")
	if err != nil {
		t.Fatal(err)
	}

	loan, err := repo.Borrow(ctx, cp.ID, member.ID, target.Category, now)
	if err != nil {
		t.Fatalf("借出失败: %v", err)
	}
	after, err := repo.CopyByBarcode(ctx, cp.Barcode)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != domain.CopyOnLoan {
		t.Fatalf("借出后副本状态=%s", after.Status)
	}
	if after.BorrowerCard != member.CardNo {
		t.Fatalf("在借人未关联: %q", after.BorrowerCard)
	}

	if _, err := repo.Borrow(ctx, cp.ID, member.ID, target.Category, now); err == nil {
		t.Fatal("重复借出未被拒绝")
	}

	renewed, err := repo.Renew(ctx, loan.ID, now)
	if err != nil {
		t.Fatalf("续借失败: %v", err)
	}
	if !renewed.DueAt.Equal(loan.DueAt.AddDate(0, 0, domain.CatRules[domain.CatGeneral].RenewDays)) {
		t.Fatalf("续借顺延错误: %s -> %s", loan.DueAt, renewed.DueAt)
	}
	if _, err := repo.Renew(ctx, loan.ID, now.AddDate(0, 0, 60)); err == nil {
		t.Fatal("逾期后仍可续借")
	}
	// 第二次续借仍可用（MaxRenewals=2），第三次必须 409。
	renewed2, err := repo.Renew(ctx, loan.ID, now)
	if err != nil {
		t.Fatalf("第二次续借应成功: %v", err)
	}
	if _, err := repo.Renew(ctx, loan.ID, now); err == nil || !strings.Contains(err.Error(), "renew_exhausted") {
		t.Fatalf("第三次续借应 409 renew_exhausted: %v", err)
	}
	// 两个 409 门槛同时成立时，逾期优先报出：馆员拿到「先归还缴费」才有可操作性。
	overdueAndExhausted, err := repo.Renew(ctx, loan.ID, renewed2.DueAt.AddDate(0, 0, 3))
	if err == nil || !strings.Contains(err.Error(), "overdue_no_renew") {
		t.Fatalf("逾期且次数用尽应报 overdue_no_renew: %v (%v)", err, overdueAndExhausted)
	}

	// 归还：按最终应还日逾期 6 天，普通书 50 分/天 = 300 分，快照不回溯
	later := renewed2.DueAt.AddDate(0, 0, 6)
	ret, fine, err := repo.Return(ctx, loan.ID, false, later)
	if err != nil {
		t.Fatalf("归还失败: %v", err)
	}
	if fine != 300 || ret.FineCents != 300 || ret.FinePaid {
		t.Fatalf("归还计费错误: fine=%d paid=%v", fine, ret.FinePaid)
	}
	again, err := repo.CopyByBarcode(ctx, cp.Barcode)
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != domain.CopyAvailable {
		t.Fatalf("归还后副本状态=%s", again.Status)
	}
	if _, _, err := repo.Return(ctx, loan.ID, true, later.AddDate(0, 0, 30)); err == nil {
		t.Fatal("重复归还未被拒绝")
	}
	unchanged, err := repo.Loan(ctx, loan.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.FineCents != 300 {
		t.Fatalf("快照被回溯: %d", unchanged.FineCents)
	}
}

func TestQuotaAndFineGateBlocks(t *testing.T) {
	repo := openSeeded(t)
	ctx := context.Background()
	now := time.Now().UTC()

	// 学生证配额 5：从当前在借数继续借，直到触发 quota_exceeded。
	student, err := repo.MemberByCard(ctx, "R-2026-0006") // types[5%6]=student
	if err != nil {
		t.Fatal(err)
	}
	if student.Quota != 5 {
		t.Fatalf("示例读者应是学生证: %+v", student)
	}
	rows, _, err := repo.ListItems(ctx, itemQ("code"))
	if err != nil {
		t.Fatal(err)
	}
	tried, quotaHit := 0, false
outer:
	for _, it := range rows {
		if it.Category == domain.CatReference {
			continue
		}
		cps, err := repo.CopiesOfItem(ctx, it.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, cp := range cps {
			if cp.Status != domain.CopyAvailable {
				continue
			}
			tried++
			if tried > 60 {
				break outer
			}
			_, err := repo.Borrow(ctx, cp.ID, student.ID, it.Category, now)
			if err != nil {
				if strings.Contains(err.Error(), "quota_exceeded") {
					quotaHit = true
					break outer
				}
				continue
			}
		}
	}
	if !quotaHit {
		t.Fatal("连续借书未触发配额门槛")
	}
	final, err := repo.MemberByCard(ctx, "R-2026-0006")
	if err != nil {
		t.Fatal(err)
	}
	if final.ActiveLoans != int64(final.Quota) {
		t.Fatalf("配额触发时在借数应恰为上限: %d/%d", final.ActiveLoans, final.Quota)
	}

	// 欠费超门槛读者（R-2026-0008）借书必须 409 fine_gate。
	fineGate, err := repo.MemberByCard(ctx, "R-2026-0008")
	if err != nil {
		t.Fatal(err)
	}
	if fineGate.OutstandingFine <= domain.FineGateCents {
		t.Fatalf("示例欠费读者金额不足: %d", fineGate.OutstandingFine)
	}
	rows3, _, _ := repo.ListItems(ctx, itemQ("code"))
	for _, it := range rows3 {
		if it.Category == domain.CatReference || it.AvailableCopies == 0 {
			continue
		}
		cps, _ := repo.CopiesOfItem(ctx, it.ID)
		for _, cp := range cps {
			if cp.Status == domain.CopyAvailable {
				_, err := repo.Borrow(ctx, cp.ID, fineGate.ID, it.Category, now)
				if err == nil || !strings.Contains(err.Error(), "fine_gate") {
					t.Fatalf("欠费门槛未生效: %v", err)
				}
				return
			}
		}
	}
	t.Fatal("没有在架副本可测试欠费门槛")
}

func TestSearchEscapingAndPagination(t *testing.T) {
	repo := openSeeded(t)
	ctx := context.Background()

	q := itemQ("code")
	all, totalAll, err := repo.ListItems(ctx, q)
	if err != nil || totalAll == 0 || len(all) == 0 {
		t.Fatalf("无过滤列表异常: total=%d err=%v", totalAll, err)
	}
	q.Search = "%"
	if _, total, err := repo.ListItems(ctx, q); err != nil || total >= totalAll {
		t.Fatalf("通配符未被按字面量转义: total=%d err=%v", total, err)
	}

	inj := loanQ("member")
	inj.Search = `a' OR '1'='1`
	if _, total, err := repo.ListLoans(ctx, inj); err != nil || total != 0 {
		t.Fatalf("注入串应搜不到且无错: total=%d err=%v", total, err)
	}

	big := domain.ParseLoanQuery(map[string][]string{"sort": {"id"}, "page_size": {"100000"}})
	rows, _, err := repo.ListLoans(ctx, big)
	if err != nil || len(rows) > domain.MaxPageSize {
		t.Fatalf("分页上限失效: len=%d err=%v", len(rows), err)
	}
}

func TestPhoneMasked(t *testing.T) {
	repo := openSeeded(t)
	ctx := context.Background()
	m, err := repo.MemberByCard(ctx, "R-2026-0003")
	if err != nil {
		t.Fatal(err)
	}
	if m.Phone == "" {
		t.Fatal("种子手机号为空，测试无意义")
	}
	if !strings.Contains(m.PhoneMasked, "****") {
		t.Fatalf("脱敏格式异常: %q", m.PhoneMasked)
	}
	if strings.HasPrefix(m.PhoneMasked, m.Phone[:7]) {
		t.Fatalf("脱敏保留了过多前缀: %q", m.PhoneMasked)
	}
}
