package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 生成一个自洽的 SaaS 订阅数据集：
// 9 个月增长曲线（2026-01..2026-09）、trial→付费漏斗、年付折扣、退订与欠款。
// 使用固定种子，重复执行结果一致。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260925))
	now = now.UTC().Truncate(24 * time.Hour)

	plans := []domain.Plan{
		{Code: "starter", Name: "入门版 Starter", PriceMonthly: 1900, PriceYearly: 19000, SeatQuota: 3, Active: true},
		{Code: "team", Name: "团队版 Team", PriceMonthly: 5900, PriceYearly: 59000, SeatQuota: 15, Active: true},
		{Code: "business", Name: "商业版 Business", PriceMonthly: 14900, PriceYearly: 149000, SeatQuota: 50, Active: true},
		{Code: "enterprise", Name: "企业版 Enterprise", PriceMonthly: 49900, PriceYearly: 499000, SeatQuota: 500, Active: true},
		{Code: "legacy_pro", Name: "旧版 Pro（已停售）", PriceMonthly: 3900, PriceYearly: 0, SeatQuota: 5, Active: false},
	}
	for i := range plans {
		plans[i].CreatedAt = now.AddDate(0, -12, 0)
		if err := r.db.WithContext(ctx).Create(&plans[i]).Error; err != nil {
			return fmt.Errorf("写入套餐失败: %w", err)
		}
	}
	planByID := map[string]int64{}
	for _, p := range plans {
		planByID[p.Code] = p.ID
	}

	// 每月新增订阅数量呈爬坡曲线
	perMonth := []int{4, 6, 9, 12, 15, 18, 22, 26, 14}
	weighted := []string{
		"starter", "starter", "starter", "starter",
		"team", "team", "team",
		"business", "business",
		"enterprise",
		"legacy_pro",
	}
	domains := []string{"acme.io", "northwind.dev", "lumina.co", "kdbank.cn", "orbi.tech",
		"harbor-labs.com", "mistral.ai", "yunchu.cn", "fabrik.io", "vertex9.dev"}
	sources := []string{"organic", "referral", "ads", "partner", "conference"}
	companies := []string{"旭创科技", "北岸数据", "澜图设计", "京鼎银行", "轨道实验室",
		"雾川传媒", "法布里工业", "顶锐软件", "海图物流", "星野医疗", "长风出行", "青梧教育"}

	var pays []domain.Payment
	emailSeq := 1
	seenEmail := map[string]bool{}
	companyMix := []string{"zh", "zh", "zh", "en", "mixed"}
	namePool := []string{"Nova", "Kite", "Atlas", "Meridian", "Quanta", "Ember", "Delta", "Onyx", "Cobalt", "Vireo"}

	for mi, count := range perMonth {
		startMonth := time.Date(now.Year(), now.Month()-time.Month(len(perMonth)-1-mi), 1, 0, 0, 0, 0, time.UTC)
		for i := 0; i < count; i++ {
			code := weighted[rnd.Intn(len(weighted))]
			plan := plans[0]
			for _, p := range plans {
				if p.Code == code {
					plan = p
				}
			}
			period := domain.PeriodMonthly
			if rnd.Intn(100) < 28 {
				period = domain.PeriodYearly
			}
			seats := 1 + rnd.Intn(plan.SeatQuota)
			if plan.Code == "enterprise" {
				seats = 40 + rnd.Intn(160)
			}
			mrr := mrrOf(&plan, period, seats)

			start := startMonth.AddDate(0, 0, rnd.Intn(26))
			if start.After(now) {
				start = now.AddDate(0, 0, -rnd.Intn(6))
			}

			// 状态：近月以 trialing/active 为主，早期月份有退订与欠款
			ageMonths := len(perMonth) - 1 - mi
			var status string
			switch {
			case ageMonths == 0 && rnd.Intn(100) < 45:
				status = domain.StatusTrialing
			case ageMonths >= 2 && rnd.Intn(100) < churnOdds(ageMonths):
				status = domain.StatusCanceled
			case rnd.Intn(100) < 7:
				status = domain.StatusPastDue
			default:
				status = domain.StatusActive
			}

			company := companies[rnd.Intn(len(companies))]
			switch companyMix[rnd.Intn(len(companyMix))] {
			case "en":
				company = namePool[rnd.Intn(len(namePool))] + " " + []string{"Systems", "Labs", "Group", "Works"}[rnd.Intn(4)]
			case "mixed":
				company = namePool[rnd.Intn(len(namePool))] + " " + companies[rnd.Intn(len(companies))]
			}
			domainName := domains[rnd.Intn(len(domains))]
			email := fmt.Sprintf("ops%03d@%s", emailSeq, domainName)
			for seenEmail[email] {
				email = fmt.Sprintf("ops%03dx%d@%s", emailSeq, rnd.Intn(99), domainName)
			}
			seenEmail[email] = true
			emailSeq++

			sub := domain.Subscriber{
				Email: email, Company: company, PlanID: plan.ID,
				Source: sources[rnd.Intn(len(sources))], JoinedAt: start,
			}
			if err := r.db.WithContext(ctx).Create(&sub).Error; err != nil {
				return fmt.Errorf("写入订阅方失败: %w", err)
			}

			s := domain.Subscription{
				SubscriberID: sub.ID, PlanID: plan.ID, Period: period,
				Status: status, Seats: seats, MRR: mrr, StartAt: start,
			}
			if status == domain.StatusTrialing {
				s.RenewAt = start.AddDate(0, 0, 14)
				if err := r.db.WithContext(ctx).Create(&s).Error; err != nil {
					return fmt.Errorf("写入订阅失败: %w", err)
				}
			} else {
				// 14 天试用后进入计费：逐期写支付流水，最后一期的下一期即续费日。
				perMonths := 1
				if period == domain.PeriodYearly {
					perMonths = 12
				}
				amount := plan.PriceMonthly * int64(seats)
				if period == domain.PeriodYearly {
					amount = plan.PriceYearly * int64(seats)
				}
				if status == domain.StatusCanceled {
					c := start.AddDate(0, 1+rnd.Intn(ageMonths+1), rnd.Intn(20))
					if c.After(now) {
						c = now.AddDate(0, 0, -2)
					}
					s.CanceledAt = &c
				}
				if err := r.db.WithContext(ctx).Create(&s).Error; err != nil {
					return fmt.Errorf("写入订阅失败: %w", err)
				}
				stopAt := now
				if s.CanceledAt != nil {
					stopAt = *s.CanceledAt
				}
				t := start.AddDate(0, 0, 14)
				last := time.Time{}
				for !t.After(stopAt) {
					pays = append(pays, domain.Payment{
						SubscriptionID: s.ID, Amount: amount, Period: period, PaidAt: t,
					})
					last = t
					t = addMonthsClamped(t, perMonths)
				}
				patch := map[string]any{"renew_at": t}
				if !last.IsZero() {
					patch["last_payment_at"] = last
				}
				if err := r.db.WithContext(ctx).Model(&domain.Subscription{}).
					Where("id = ?", s.ID).Updates(patch).Error; err != nil {
					return fmt.Errorf("回写订阅计费日程失败: %w", err)
				}
			}
		}
	}
	if err := r.db.WithContext(ctx).CreateInBatches(&pays, 200).Error; err != nil {
		return fmt.Errorf("写入支付流水失败: %w", err)
	}
	return nil
}

// addMonthsClamped 加 n 个月后若「日」被进位（1/31→2/3），回退到上一个月末，避免续费日漂移。
func addMonthsClamped(t time.Time, n int) time.Time {
	_, _, dayBefore := t.Date()
	out := t.AddDate(0, n, 0)
	if _, _, dayAfter := out.Date(); dayAfter < dayBefore {
		out = time.Date(out.Year(), out.Month(), 0, 0, 0, 0, 0, out.Location())
	}
	return out
}

func churnOdds(ageMonths int) int {
	base := 18 - ageMonths*2
	if base < 6 {
		base = 6
	}
	return base
}

// mrrOf：年付按 12 个月分摊（向下取整到分），与 plan.PriceYearly 的九折定价一致。
func mrrOf(p *domain.Plan, period string, seats int) int64 {
	if seats < 1 {
		seats = 1
	}
	if period == domain.PeriodYearly {
		return p.PriceYearly * int64(seats) / 12
	}
	return p.PriceMonthly * int64(seats)
}
