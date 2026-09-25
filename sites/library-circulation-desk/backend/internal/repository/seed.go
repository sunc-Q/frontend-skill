package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"libdesk/internal/domain"
)

// Seed 生成一套自洽的图书馆流通数据集：
// 20 种书目 / 4 类别、40 册副本（含丢书与剔旧）、26 位读者、
// 近 120 天借还流水（在借 / 逾期未还 / 已还带欠费 / 已缴清 / 续借用尽 全覆盖）。
// 逾期费一律经 domain.FineFor 结算，因此 stats 恒等式对种子同样成立。
// 固定随机种子，重复执行结果一致。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260926))
	now = now.UTC().Truncate(24 * time.Hour).Add(9 * time.Hour)

	itemSpecs := []struct {
		Title, Author, Publisher string
		Year                     int
		Category                 string
		Copies                   int
	}{
		{"北平的冬天", "沈砚舟", "长明书局", 2021, domain.CatGeneral, 4},
		{"海图志", "澜川", "洋流出版社", 2019, domain.CatGeneral, 3},
		{"半册山河", "顾青禾", "长明书局", 2023, domain.CatGeneral, 3},
		{"雾港来信", "程晚照", "灯塔文艺", 2022, domain.CatGeneral, 2},
		{"夜航西飞的注脚", "阮一洲", "云阶書院", 2020, domain.CatGeneral, 2},
		{"灶台化学", "方糖研究所", "格物科普", 2024, domain.CatGeneral, 3},
		{"松间集", "陆俊声", "灯塔文艺", 2018, domain.CatGeneral, 2},
		{"城市水脉考", "市政研究院", "方舆出版社", 2017, domain.CatGeneral, 2},
		{"算法简史（插图本）", "姚心澄", "格物科普", 2023, domain.CatGeneral, 3},
		{"茶经校注", "陆羽 注 / 今石 校", "云阶書院", 2015, domain.CatGeneral, 1},
		{"大字版·昆虫记", "法布尔", "晨读出版社", 2022, domain.CatLarge, 3},
		{"大字版·唐诗三百首", "蘅塘退士", "晨读出版社", 2021, domain.CatLarge, 2},
		{"大字版·本草图说", "李时珍 图注", "方舆出版社", 2023, domain.CatLarge, 2},
		{"大字版·徐霞客游记", "徐霞客", "晨读出版社", 2020, domain.CatLarge, 1},
		{"布罗肯火山全集（盒装）", "厄休拉·雷", "星云盒装", 2019, domain.CatBoxed, 1},
		{"敦煌图集·特装盒装", "敦煌研究院", "方舆出版社", 2021, domain.CatBoxed, 1},
		{"航海六分仪手册（盒装）", "周北望", "洋流出版社", 2016, domain.CatBoxed, 1},
		{"辞源（修订本）", "商务团队", "云阶書院", 2014, domain.CatReference, 2},
		{"中国地名大辞典", "方舆出版社", "方舆出版社", 2012, domain.CatReference, 1},
		{"廿二史札记校证", "赵翼 撰 / 王 校", "云阶書院", 2010, domain.CatReference, 1},
	}

	var items []domain.Item
	var allCopies []domain.Copy
	locations := []string{"一层·A 区", "一层·B 区", "二层·借阅区", "二层·特藏柜", "三层·参考区"}
	itemSeq, copySeq := 1, 1
	for _, sp := range itemSpecs {
		item := domain.Item{
			Code:  fmt.Sprintf("978-7-02-%05d", itemSeq),
			Title: sp.Title, Author: sp.Author, Publisher: sp.Publisher,
			PubYear: sp.Year, Category: sp.Category,
			LoanDays: domain.CatRules[sp.Category].LoanDays,
			AddedAt:  now.AddDate(0, 0, -(120 + rnd.Intn(900))),
		}
		if err := r.db.WithContext(ctx).Create(&item).Error; err != nil {
			return fmt.Errorf("写入书目失败: %w", err)
		}
		items = append(items, item)
		for k := 0; k < sp.Copies; k++ {
			cp := domain.Copy{
				ItemID: item.ID, Barcode: fmt.Sprintf("BN-%06d", copySeq),
				Location:  locations[copySeq%len(locations)],
				Condition: "good", Status: domain.CopyAvailable,
				AcquiredAt: item.AddedAt,
			}
			switch {
			case sp.Category == domain.CatReference:
				cp.Condition = "worn"
			case copySeq%17 == 0:
				cp.Status = domain.CopyRetired
				cp.Condition = "damaged"
			case copySeq%13 == 0:
				cp.Status = domain.CopyMissing
			case copySeq%5 == 0:
				cp.Condition = "worn"
			}
			if err := r.db.WithContext(ctx).Create(&cp).Error; err != nil {
				return fmt.Errorf("写入副本失败: %w", err)
			}
			allCopies = append(allCopies, cp)
			copySeq++
		}
		itemSeq++
	}
	itemByID := map[int64]*domain.Item{}
	for k := range items {
		itemByID[items[k].ID] = &items[k]
	}

	names := []string{"林知遥", "沈佳树", "吴子晏", "郑惟勤", "孙绮", "周砚", "徐白露", "何斯岑",
		"曹牧之", "崔云舸", "章临川", "祁若寒", "应知野", "毕沅", "自由路", "党明轩",
		"石安澜", "关键", "屠宓", "游楚", "裴照", "竺可青", "左思齐", "李雾", "英硕", "苗以宁"}
	types := []string{domain.MemberStandard, domain.MemberStandard, domain.MemberStandard,
		domain.MemberFamily, domain.MemberStudent, domain.MemberStudent}
	var members []domain.Member
	for i, n := range names {
		m := domain.Member{
			CardNo:     fmt.Sprintf("R-2026-%04d", i+1),
			Name:       n,
			Phone:      fmt.Sprintf("138%08d", 10000000+i*7919),
			MemberType: types[i%len(types)],
			Status:     domain.MemberActive,
			JoinedAt:   now.AddDate(0, 0, -(30 + rnd.Intn(1200))),
		}
		if i == 13 || i == 21 {
			s := now.AddDate(0, 0, -18)
			m.Status = domain.MemberSuspended
			m.SuspendedAt = &s
		}
		if err := r.db.WithContext(ctx).Create(&m).Error; err != nil {
			return fmt.Errorf("写入读者失败: %w", err)
		}
		members = append(members, m)
	}

	// 借出池：可借副本（在架且非参考工具书）逐册循环消耗。
	var pool []domain.Copy
	for _, c := range allCopies {
		if c.Status != domain.CopyAvailable {
			continue
		}
		it := itemByID[c.ItemID]
		if it == nil || it.Category == domain.CatReference {
			continue
		}
		pool = append(pool, c)
	}

	activeByCopy := map[int64]bool{}
	activeByMember := map[int64]int{}
	var seedErr error
	// mode: normal | overdue_active（定向留逾期在借） | heavy_unpaid（定向造未缴高欠费，必然归还）
	addLoan := func(cp domain.Copy, m domain.Member, borrowed time.Time, mode string) {
		if seedErr != nil {
			return
		}
		item := itemByID[cp.ItemID]
		rule := domain.CatRules[item.Category]
		due := borrowed.AddDate(0, 0, rule.LoanDays)
		l := domain.Loan{CopyID: cp.ID, MemberID: m.ID, Status: domain.LoanActive, BorrowedAt: borrowed, DueAt: due}
		settle := func(late int) {
			returned := due.AddDate(0, 0, late)
			if returned.After(now) {
				returned = now.AddDate(0, 0, -1)
			}
			od := domain.OverdueDays(due, returned)
			l.Status = domain.LoanReturned
			l.ReturnedAt = &returned
			l.FineCents = domain.FineFor(od, item.Category)
			l.FinePaid = false
		}
		switch {
		case mode == "heavy_unpaid":
			settle(rule.LoanDays/2 + 10)
			l.RenewCount = 0
		case mode == "overdue_active":
			l.RenewCount = domain.MaxRenewals
		case mode == "hold_soon":
			// 临近应还且保持在借：两成已续借过一次。
			if rnd.Intn(100) < 20 {
				l.DueAt = due.AddDate(0, 0, rule.RenewDays)
				l.RenewCount = 1
			}
		case !due.Before(now):
			// 五成半提前归还（流转起来，避免库存全部压死）；否则未到期在借、三成续借过一次。
			returned := borrowed.AddDate(0, 0, 4+rnd.Intn(16))
			renewed := false
			if rnd.Intn(100) < 30 {
				l.DueAt = due.AddDate(0, 0, rule.RenewDays)
				l.RenewCount = 1
				renewed = true
			}
			if rnd.Intn(100) < 55 && returned.Before(now) {
				l.Status = domain.LoanReturned
				l.ReturnedAt = &returned
				l.FineCents = 0
				l.FinePaid = true
				_ = renewed
			}
		case rnd.Intn(100) < 93:
			late := 0
			if rnd.Intn(100) < 22 {
				late = 1 + rnd.Intn(14)
			}
			settle(late)
			if l.FineCents == 0 || rnd.Intn(100) < 55 {
				l.FinePaid = true
			}
			l.RenewCount = rnd.Intn(3)
		default:
			// 自然逾期未还。
			l.RenewCount = domain.MaxRenewals
		}
		if l.Status == domain.LoanActive {
			activeByCopy[cp.ID] = true
			activeByMember[m.ID]++
		}
		if err := r.db.WithContext(ctx).Create(&l).Error; err != nil {
			seedErr = fmt.Errorf("写入借阅失败: %w", err)
		}
	}

	// 定向欠费样本（先占住三册普通书，避免被随机阶段耗尽库存）：
	// 给 R-2026-0008 压三笔「已归还、长逾期、未缴费」，每笔 24 天 × 50 分 = 12 元，合计 36 元 > 停借门槛 30 元。
	fineGate := members[7]
	heavyDone := 0
	for idx := range pool {
		if heavyDone >= 3 {
			break
		}
		cp := pool[idx]
		it := itemByID[cp.ItemID]
		if it.Category != domain.CatGeneral {
			continue
		}
		addLoan(cp, fineGate, now.AddDate(0, 0, -100), "heavy_unpaid")
		heavyDone++
		if seedErr != nil {
			return seedErr
		}
	}
	if heavyDone < 3 {
		return fmt.Errorf("种子缺可支配普通书副本，欠费样本不足: %d", heavyDone)
	}

	memberTurn := 0
	day := now.AddDate(0, 0, -120)
	for !day.After(now.AddDate(0, 0, -1)) && seedErr == nil {
		count := 1 + rnd.Intn(4)
		if int(day.Day())%9 == 0 {
			count++
		}
		for k := 0; k < count; k++ {
			// 保留 12 册空闲头寸：给定向样本与「今日借出」留出库存，防止系统整体饱和。
			idle := 0
			for idx := range pool {
				if !activeByCopy[pool[idx].ID] {
					idle++
				}
			}
			if idle <= 22 {
				break
			}
			avail := -1
			start := rnd.Intn(len(pool))
			for n := 0; n < len(pool); n++ {
				idx := (start + n) % len(pool)
				if !activeByCopy[pool[idx].ID] {
					avail = idx
					break
				}
			}
			if avail < 0 {
				break
			}
			cp := pool[avail]
			memberTurn = (memberTurn + 1 + rnd.Intn(3)) % len(members)
			m := members[memberTurn]
			if m.Status != domain.MemberActive {
				continue
			}
			if activeByMember[m.ID] >= domain.MemberQuota(m.MemberType) {
				continue
			}
			borrowed := day.Add(time.Duration(9+rnd.Intn(9)) * time.Hour)
			addLoan(cp, m, borrowed, "normal")
		}
		day = day.AddDate(0, 0, 1)
		if seedErr != nil {
			return seedErr
		}
	}

	// 定向补齐「在借已逾期」×7 与「临近应还」×5，保证状态机分支全覆盖。
	madeOverdue, madeSoon, madeFresh := 0, 0, 0
	for idx := range pool {
		cp := pool[idx]
		if activeByCopy[cp.ID] {
			continue
		}
		rule := domain.CatRules[itemByID[cp.ItemID].Category]
		switch {
		case madeOverdue < 7:
			memberTurn = (memberTurn + 5) % len(members)
			m := members[memberTurn]
			if m.Status != domain.MemberActive || activeByMember[m.ID] >= domain.MemberQuota(m.MemberType) {
				continue
			}
			addLoan(cp, m, now.AddDate(0, 0, -(rule.LoanDays+3+madeOverdue*2)), "overdue_active")
			madeOverdue++
		case madeSoon < 5:
			memberTurn = (memberTurn + 3) % len(members)
			m := members[memberTurn]
			if m.Status != domain.MemberActive || activeByMember[m.ID] >= domain.MemberQuota(m.MemberType) {
				continue
			}
			addLoan(cp, m, now.AddDate(0, 0, -(rule.LoanDays-2)), "hold_soon")
			madeSoon++
		case madeFresh < 3:
			memberTurn = (memberTurn + 7) % len(members)
			m := members[memberTurn]
			if m.Status != domain.MemberActive || activeByMember[m.ID] >= domain.MemberQuota(m.MemberType) {
				continue
			}
			addLoan(cp, m, now.AddDate(0, 0, -1), "hold_soon")
			madeFresh++
		default:
		}
		if madeOverdue >= 7 && madeSoon >= 5 && madeFresh >= 3 {
			break
		}
	}
	if seedErr != nil {
		return seedErr
	}
	if madeOverdue < 7 || madeSoon < 5 || madeFresh < 3 {
		return fmt.Errorf("定向状态样本覆盖不足: overdue_active=%d soon=%d fresh=%d", madeOverdue, madeSoon, madeFresh)
	}

	for _, cp := range allCopies {
		if activeByCopy[cp.ID] && cp.Status != domain.CopyOnLoan {
			if err := r.db.WithContext(ctx).Model(&domain.Copy{}).Where("id = ?", cp.ID).
				Update("status", domain.CopyOnLoan).Error; err != nil {
				return fmt.Errorf("同步副本状态失败: %w", err)
			}
		}
	}
	return nil
}
