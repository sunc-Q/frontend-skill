package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 灌入一个自洽的健身工作室数据集：
// 14 天课表（今天前 3 天 = 已开课，今天起 = 待开课）、48 名会员、按容量分布的预约，
// 以及少量候补、取消、未到，保证看板上的占座率/未到率/收入不是全 0 的假数。
// 固定随机种子，重复执行得到同一份数据。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260925))
	utc := now.UTC()
	day0 := time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)

	classes := []domain.Class{
		{Code: "strength_base", Name: "杠铃基础力量", Category: domain.CatStrength, Coach: "陈昊", CoachLevel: domain.LevelSenior, DurationMin: 55, Intensity: 4, Capacity: 14, PriceCents: 12900, Active: true},
		{Code: "deadlift_hd", Name: "硬拉突破课", Category: domain.CatStrength, Coach: "周成", CoachLevel: domain.LevelMaster, DurationMin: 70, Intensity: 5, Capacity: 10, PriceCents: 19900, Active: true},
		{Code: "pilates_mat", Name: "垫上普拉提", Category: domain.CatStrength, Coach: "林薇", CoachLevel: domain.LevelMaster, DurationMin: 50, Intensity: 3, Capacity: 12, PriceCents: 11900, Active: true},
		{Code: "yoga_flow", Name: "流瑜伽晨课", Category: domain.CatYoga, Coach: "林薇", CoachLevel: domain.LevelMaster, DurationMin: 60, Intensity: 2, Capacity: 16, PriceCents: 9900, Active: true},
		{Code: "yoga_restore", Name: "修复阴瑜伽", Category: domain.CatYoga, Coach: "沈柔", CoachLevel: domain.LevelJunior, DurationMin: 75, Intensity: 1, Capacity: 12, PriceCents: 9900, Active: true},
		{Code: "cycling_power", Name: "功率耐力单车", Category: domain.CatCycling, Coach: "阿凯", CoachLevel: domain.LevelJunior, DurationMin: 45, Intensity: 4, Capacity: 20, PriceCents: 8900, Active: true},
		{Code: "cardio_hiit", Name: "HIIT 燃脂循环", Category: domain.CatCardio, Coach: "苏梨", CoachLevel: domain.LevelSenior, DurationMin: 40, Intensity: 5, Capacity: 18, PriceCents: 10900, Active: true},
		{Code: "boxing_tech", Name: "搏击技术课", Category: domain.CatBoxing, Coach: "苏梨", CoachLevel: domain.LevelSenior, DurationMin: 60, Intensity: 4, Capacity: 12, PriceCents: 13900, Active: true},
		{Code: "recovery_stretch", Name: "拉伸放松", Category: domain.CatRecovery, Coach: "周成", CoachLevel: domain.LevelMaster, DurationMin: 30, Intensity: 1, Capacity: 20, PriceCents: 6900, Active: true},
		{Code: "legacy_aerobic", Name: "旧版有氧团课（已停开）", Category: domain.CatCardio, Coach: "阿凯", CoachLevel: domain.LevelJunior, DurationMin: 45, Intensity: 3, Capacity: 15, PriceCents: 7900, Active: false},
	}
	for i := range classes {
		classes[i].CreatedAt = day0.AddDate(0, -8, 0)
		if err := r.db.WithContext(ctx).Create(&classes[i]).Error; err != nil {
			return fmt.Errorf("写入课程失败: %w", err)
		}
	}

	// ---- 会员 ----
	given := []string{"赵岩", "孙妮", "李锐", "周雨桐", "吴磊", "郑晓", "王枫", "冯静", "陈立", "褚阳",
		"卫岚", "蒋博", "沈墨", "杨帆", "朱琳", "秦朗", "尤佳", "许飞", "何靖", "吕芳",
		"施明", "张伟", "曹雪", "田野", "严峰", "华磊", "金鑫", "魏东", "陶乐", "姜恒",
		"戚然", "范可", "涂强", "姚远", "贺川", "彭悦", "鲁宁", "俞航", "任双", "霍林",
		"郭富", "梅雨", "董浩", "梁思", "谢俞", "邹衡", "熊伟", "柏舟"}
	cardMix := []string{
		domain.CardAnnual, domain.CardAnnual,
		domain.CardQuarterly, domain.CardQuarterly, domain.CardQuarterly,
		domain.CardMonthly, domain.CardMonthly, domain.CardMonthly, domain.CardMonthly,
		domain.CardTenSession, domain.CardTenSession, domain.CardTenSession, domain.CardTenSession, domain.CardTenSession,
		domain.CardTrial,
	}
	sourcePool := []string{"app", "front_desk", "coach", "phone"}

	members := make([]domain.Member, 0, len(given))
	for i, name := range given {
		card := cardMix[rnd.Intn(len(cardMix))]
		validDays := map[string]int{
			domain.CardTrial: 7, domain.CardTenSession: 180, domain.CardMonthly: 30,
			domain.CardQuarterly: 90, domain.CardAnnual: 365,
		}[card]
		joined := day0.AddDate(0, 0, -(7 + rnd.Intn(400)))
		expiry := joined.AddDate(0, 0, validDays)
		// 六成会员在窗口内仍然有效；到期的保留 active=false 以便看到「停卡」样本。
		active := true
		if expiry.Before(day0) {
			expiry = day0.AddDate(0, 0, 20+rnd.Intn(160))
		}
		if rnd.Intn(100) < 8 {
			active = false
		}
		credits := 0
		if card == domain.CardTenSession {
			credits = 1 + rnd.Intn(9)
		} else if card == domain.CardTrial {
			credits = 1
		}
		members = append(members, domain.Member{
			Name: name,
			// 手机号刻意做成规范化的 11 位（1 开头），便于「按手机号预约」的接口演示。
			Phone:     fmt.Sprintf("138%08d", 20260001+i),
			CardType:  card,
			Credits:   credits,
			Visits:    rnd.Intn(60),
			JoinedAt:  joined,
			ExpiresAt: expiry,
			Active:    active,
		})
	}
	if err := r.db.WithContext(ctx).CreateInBatches(&members, 50).Error; err != nil {
		return fmt.Errorf("写入会员失败: %w", err)
	}

	// ---- 课表：今天前 3 天 .. 今天后 10 天 ----
	// 每天固定几个时段，按星期几决定开哪几门，量级自洽（工作日晚上最满）。
	type slot struct {
		hour, min int
		room      string
		codes     []string
	}
	slots := []slot{
		{7, 0, "A 厅", []string{"yoga_flow", "recovery_stretch"}},
		{9, 30, "B 厅", []string{"pilates_mat", "yoga_restore"}},
		{12, 15, "A 厅", []string{"cardio_hiit", "cycling_power"}},
		{18, 30, "A 厅", []string{"strength_base", "boxing_tech", "cycling_power"}},
		{19, 45, "B 厅", []string{"deadlift_hd", "pilates_mat", "cardio_hiit"}},
		{21, 0, "B 厅", []string{"yoga_restore", "recovery_stretch"}},
	}
	classByID := map[string]int64{}
	capByClass := map[int64]int{}
	for _, c := range classes {
		classByID[c.Code] = c.ID
		capByClass[c.ID] = c.Capacity
	}

	var sessions []domain.Session
	for d := -3; d <= 10; d++ {
		day := day0.AddDate(0, 0, d)
		weekday := int(day.Weekday())
		for si, sl := range slots {
			// 周一早课与周末晚上课人流差异：按星期几挑课，保证不是每天一模一样。
			pick := sl.codes[(si+weekday)%len(sl.codes)]
			if weekday == 0 || weekday == 6 {
				pick = sl.codes[(si+3)%len(sl.codes)]
			}
			start := time.Date(day.Year(), day.Month(), day.Day(), sl.hour, sl.min, 0, 0, time.UTC)
			status := domain.SessionOpen
			if start.Before(utc) {
				status = domain.SessionClosed
			}
			note := ""
			if d >= -3 && rnd.Intn(60) == 0 {
				status = domain.SessionCanceled
				note = "教练临时有事，已通知会员改期"
			}
			sessions = append(sessions, domain.Session{
				ClassID: classByID[pick], StartAt: start, Room: sl.room,
				Status: status, Note: note, CreatedAt: day0.AddDate(0, 0, d-6),
			})
		}
	}
	if err := r.db.WithContext(ctx).CreateInBatches(&sessions, 100).Error; err != nil {
		return fmt.Errorf("写入课节失败: %w", err)
	}

	// ---- 预约 ----
	eligible := make([]int64, 0, len(members))
	for _, m := range members {
		if m.Active {
			eligible = append(eligible, m.ID)
		}
	}
	seen := map[[2]int64]bool{}
	var bookings []domain.Booking
	for _, s := range sessions {
		if s.Status == domain.SessionCanceled {
			continue
		}
		cap := capByClass[s.ClassID]
		past := s.StartAt.Before(utc)
		hourFactor := 1.0
		switch s.StartAt.Hour() {
		case 7:
			hourFactor = 0.72
		case 12:
			hourFactor = 0.6
		case 18, 19:
			hourFactor = 1.0
		case 21:
			hourFactor = 0.8
		}
		wd := int(s.StartAt.Weekday())
		if wd == 0 || wd == 6 {
			hourFactor *= 0.85
		}
		// 越临近的课填充越高：明天的课常常满座并产生候补，远期的课还剩不少空位。
		daysOut := int(s.StartAt.Sub(utc).Hours() / 24)
		if !past {
			switch {
			case daysOut <= 1:
				hourFactor *= 1.18
			case daysOut <= 3:
				hourFactor *= 0.95
			default:
				hourFactor *= 0.78
			}
		}
		target := int(float64(cap) * hourFactor * (0.88 + rnd.Float64()*0.34))
		if target > cap {
			target = cap
		}
		confirmed := 0
		for i := 0; i < target; i++ {
			mid := eligible[rnd.Intn(len(eligible))]
			key := [2]int64{s.ID, mid}
			if seen[key] {
				continue
			}
			seen[key] = true
			status := domain.BookingConfirmed
			if past && rnd.Intn(100) < 9 {
				status = domain.BookingNoShow
			}
			created := s.StartAt.AddDate(0, 0, -(1 + rnd.Intn(5)))
			bookings = append(bookings, domain.Booking{
				SessionID: s.ID, MemberID: mid, Status: status,
				Source: sourcePool[rnd.Intn(len(sourcePool))], CreatedAt: created,
			})
			if status == domain.BookingConfirmed {
				confirmed++
			}
		}
		// 已取消的散座：每节课偶尔几笔 canceled，体现真实前台操作。
		if rnd.Intn(100) < 35 {
			mid := eligible[rnd.Intn(len(eligible))]
			key := [2]int64{s.ID, mid}
			if !seen[key] {
				seen[key] = true
				bookings = append(bookings, domain.Booking{
					SessionID: s.ID, MemberID: mid, Status: domain.BookingCanceled,
					Source:    sourcePool[rnd.Intn(len(sourcePool))],
					CreatedAt: s.StartAt.AddDate(0, 0, -2),
				})
			}
		}
		// 满座的未来课挂 1-3 个候补。
		if !past && confirmed >= cap && s.Status == domain.SessionOpen {
			n := 1 + rnd.Intn(3)
			for i := 0; i < n; i++ {
				mid := eligible[rnd.Intn(len(eligible))]
				key := [2]int64{s.ID, mid}
				if seen[key] {
					continue
				}
				seen[key] = true
				bookings = append(bookings, domain.Booking{
					SessionID: s.ID, MemberID: mid, Status: domain.BookingWaitlist,
					Source:    sourcePool[rnd.Intn(len(sourcePool))],
					CreatedAt: s.StartAt.AddDate(0, 0, -1),
				})
			}
		}
	}
	if err := r.db.WithContext(ctx).CreateInBatches(&bookings, 200).Error; err != nil {
		return fmt.Errorf("写入预约失败: %w", err)
	}
	return nil
}

func (r *Repo) HasData(ctx context.Context) (bool, error) {
	var n int64
	err := r.db.WithContext(ctx).Table("sessions").Count(&n).Error
	return n > 0, err
}
