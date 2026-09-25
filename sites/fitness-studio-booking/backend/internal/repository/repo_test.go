package repository

import (
	"context"
	"sort"
	"strings"
	"testing"
	"time"

	"bizsite/internal/domain"
)

// fixedNow 与 Seed 使用同一条时间轴：今天 12:00 UTC。
var fixedNow = time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)

func newRepo(t *testing.T) *Repo {
	t.Helper()
	db, err := Open(t.TempDir() + "/studio.db")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), fixedNow); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	return r
}

func TestSeedProducesCoherentData(t *testing.T) {
	r := newRepo(t)
	ctx := context.Background()

	q := domain.ListQuery{Page: 1, PageSize: 100, Sort: "s.start_at", Dir: "asc", Days: 14}
	rows, total, err := r.ListSessions(ctx, q, fixedNow.AddDate(0, 0, -3))
	if err != nil {
		t.Fatal(err)
	}
	if total < 60 || len(rows) == 0 {
		t.Fatalf("课节量级不自洽：total=%d rows=%d", total, len(rows))
	}
	for _, s := range rows {
		if s.ClassName == "" || s.Coach == "" || s.Category == "" {
			t.Fatalf("课表未回填课程信息：%+v", s)
		}
		if s.Capacity <= 0 {
			t.Fatalf("课节容量异常：%+v", s)
		}
		if s.Remaining != s.Capacity-s.Confirmed {
			t.Errorf("剩余座位算错：%+v", s)
		}
	}

	st, err := r.Stats(ctx, 7, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	if st.Confirmed == 0 || st.Members == 0 {
		t.Fatalf("指标接口拿到空数据：%+v", st)
	}
	if st.OccupancyPct < 0 || st.OccupancyPct > 100 {
		t.Errorf("占座率越界：%v", st.OccupancyPct)
	}
	if st.TotalBookings < st.Confirmed+st.Waitlist+st.Canceled+st.NoShow {
		t.Errorf("预约分类之和超过总数：%+v", st)
	}
	var sumSeats int64
	for _, d := range st.Days {
		sumSeats += d.Seats
	}
	if sumSeats != st.SeatTotal {
		t.Errorf("按天容量合计 %d 与总容量 %d 不一致", sumSeats, st.SeatTotal)
	}
}

func TestCreateBookingCapacityWaitlistAndDuplicate(t *testing.T) {
	ctx := context.Background()
	r := newRepo(t)

	// 找一个未来 open、尚有余位、且有空闲会员可填的课节
	target, available := pickTestTarget(t, r)

	allow := true
	used := map[int64]bool{}
	pick := func() int64 {
		for _, m := range available {
			if !used[m.ID] {
				used[m.ID] = true
				return m.ID
			}
		}
		t.Fatal("可用会员不足")
		return 0
	}

	// 填满到容量
	for i := 0; i < target.Remaining; i++ {
		res, err := r.CreateBooking(ctx, target.ID, domain.CreateBookingInput{MemberID: pick(), Source: "front_desk"}, fixedNow)
		if err != nil {
			t.Fatalf("第 %d 笔预约失败: %v", i, err)
		}
		if res.Status != domain.BookingConfirmed {
			t.Fatalf("未满座时不应进候补：%+v", res)
		}
	}

	t.Run("满座后不带 allow_waitlist → 409", func(t *testing.T) {
		_, err := r.CreateBooking(ctx, target.ID, domain.CreateBookingInput{MemberID: pick()}, fixedNow)
		var ae *domain.AppError
		if !asAppErr(err, &ae) {
			t.Fatalf("应返回 AppError，实得 %v", err)
		}
		if ae.Code != "session_full" || ae.HTTPCode != 409 {
			t.Errorf("code=%s http=%d", ae.Code, ae.HTTPCode)
		}
	})

	t.Run("满座后允许候补 → waitlist", func(t *testing.T) {
		res, err := r.CreateBooking(ctx, target.ID, domain.CreateBookingInput{MemberID: pick(), AllowWaitlist: &allow}, fixedNow)
		if err != nil {
			t.Fatal(err)
		}
		if res.Status != domain.BookingWaitlist {
			t.Errorf("status=%s，应为 waitlist", res.Status)
		}
	})

	t.Run("同一会员重复预约 → 409", func(t *testing.T) {
		first := pick()
		if _, err := r.CreateBooking(ctx, target.ID, domain.CreateBookingInput{MemberID: first, AllowWaitlist: &allow}, fixedNow); err != nil {
			t.Fatalf("首笔应成功: %v", err)
		}
		_, err := r.CreateBooking(ctx, target.ID, domain.CreateBookingInput{MemberID: first}, fixedNow)
		var ae *domain.AppError
		if !asAppErr(err, &ae) || ae.Code != "duplicate_booking" || ae.HTTPCode != 409 {
			t.Fatalf("应返回 duplicate_booking/409，实得 %v", err)
		}
	})

	t.Run("已开课的课节不能补约 → 409", func(t *testing.T) {
		rowsPast, _, err := r.ListSessions(ctx, domain.ListQuery{Page: 1, PageSize: 50, Sort: "s.start_at", Dir: "asc", Days: 3}, fixedNow.AddDate(0, 0, -3))
		if err != nil {
			t.Fatal(err)
		}
		var past *domain.SessionRow
		for i := range rowsPast {
			if rowsPast[i].Status == domain.SessionClosed && rowsPast[i].StartAt.Before(fixedNow) {
				past = &rowsPast[i]
				break
			}
		}
		if past == nil {
			t.Skip("种子窗口内没有已结课课节")
		}
		_, err = r.CreateBooking(ctx, past.ID, domain.CreateBookingInput{MemberID: pick()}, fixedNow)
		var ae *domain.AppError
		if !asAppErr(err, &ae) || ae.HTTPCode != 409 {
			t.Fatalf("已开课应 409，实得 %v", err)
		}
	})
}

func TestCreateBookingValidatesMemberAndCard(t *testing.T) {
	ctx := context.Background()
	r := newRepo(t)

	q := domain.ListQuery{Page: 1, PageSize: 30, Sort: "s.start_at", Dir: "asc", Days: 14, Status: domain.SessionOpen}
	rows, _, err := r.ListSessions(ctx, q, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	var future *domain.SessionRow
	for i := range rows {
		if rows[i].StartAt.After(fixedNow) {
			future = &rows[i]
			break
		}
	}
	if future == nil {
		t.Fatal("没有未来课节")
	}

	cases := []struct {
		name     string
		in       domain.CreateBookingInput
		wantCode string
		wantHTTP int
	}{
		{"不存在的会员 ID", domain.CreateBookingInput{MemberID: 999999}, "member_not_found", 404},
		{"未注册的手机号", domain.CreateBookingInput{Phone: "13800000000", Source: "app"}, "member_not_found", 404},
		{"不存在的课节", domain.CreateBookingInput{MemberID: 1}, "not_found", 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sid := future.ID
			if tc.name == "不存在的课节" {
				sid = 424242
			}
			_, err := r.CreateBooking(ctx, sid, tc.in, fixedNow)
			var ae *domain.AppError
			if !asAppErr(err, &ae) {
				t.Fatalf("应返回 AppError，实得 %v", err)
			}
			if ae.Code != tc.wantCode || ae.HTTPCode != tc.wantHTTP {
				t.Errorf("code=%s http=%d，期望 %s/%d", ae.Code, ae.HTTPCode, tc.wantCode, tc.wantHTTP)
			}
		})
	}
}

func TestCreateMemberUniquePhoneAndBoundary(t *testing.T) {
	ctx := context.Background()
	r := newRepo(t)

	m := &domain.Member{Name: "测试会员", Phone: "13900001111", CardType: domain.CardMonthly,
		JoinedAt: fixedNow, ExpiresAt: fixedNow.AddDate(0, 0, 30), Active: true}
	if err := r.CreateMember(ctx, m); err != nil {
		t.Fatalf("建档失败: %v", err)
	}
	if m.ID == 0 {
		t.Fatal("未回写 ID")
	}
	dup := &domain.Member{Name: "撞号", Phone: "13900001111", CardType: domain.CardTrial,
		JoinedAt: fixedNow, ExpiresAt: fixedNow.AddDate(0, 0, 7), Active: true}
	err := r.CreateMember(ctx, dup)
	var ae *domain.AppError
	if !asAppErr(err, &ae) || ae.HTTPCode != 409 {
		t.Fatalf("重复手机号应 409，实得 %v", err)
	}
	if strings.Contains(ae.Message, "unique") || strings.Contains(ae.Message, "constraint") {
		t.Errorf("对外文案泄漏数据库细节：%s", ae.Message)
	}
	if ae.Err != nil && !strings.Contains(strings.ToLower(ae.Err.Error()), "unique") {
		t.Errorf("内部错误应保留给日志：%v", ae.Err)
	}
}

func TestSearchEscapesLikeWildcards(t *testing.T) {
	ctx := context.Background()
	r := newRepo(t)

	// 「%」若未转义，会退化成匹配所有行；正确行为是一行都不命中。
	_, total, err := r.ListSessions(ctx, domain.ListQuery{
		Page: 1, PageSize: 20, Days: 14, Sort: "s.start_at", Dir: "asc", Search: "%",
	}, fixedNow.AddDate(0, 0, -3))
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 {
		t.Errorf("搜索 %% 命中 %d 行，LIKE 通配符未转义", total)
	}

	_, total, err = r.ListSessions(ctx, domain.ListQuery{
		Page: 1, PageSize: 20, Days: 14, Sort: "s.start_at", Dir: "asc", Search: "' OR 1=1 --",
	}, fixedNow.AddDate(0, 0, -3))
	if err != nil {
		t.Fatalf("注入串不应导致 SQL 出错: %v", err)
	}
	if total != 0 {
		t.Errorf("注入串命中 %d 行", total)
	}

	rows, total, err := r.ListSessions(ctx, domain.ListQuery{
		Page: 1, PageSize: 20, Days: 14, Sort: "s.start_at", Dir: "asc", Search: "瑜伽",
	}, fixedNow.AddDate(0, 0, -3))
	if err != nil {
		t.Fatal(err)
	}
	if total == 0 || len(rows) == 0 {
		t.Errorf("中文关键词应能命中课程，实得 total=%d", total)
	}
}

func TestRosterOrderingAndLimit(t *testing.T) {
	ctx := context.Background()
	r := newRepo(t)

	rows, _, err := r.ListSessions(ctx, domain.ListQuery{Page: 1, PageSize: 60, Days: 14,
		Sort: "s.start_at", Dir: "asc"}, fixedNow.AddDate(0, 0, -3))
	if err != nil {
		t.Fatal(err)
	}
	var sid int64
	for _, s := range rows {
		if s.Confirmed > 0 {
			sid = s.ID
			break
		}
	}
	if sid == 0 {
		t.Fatal("种子数据里没有已确认的课节")
	}
	roster, err := r.Roster(ctx, sid, 60)
	if err != nil {
		t.Fatal(err)
	}
	if len(roster) == 0 {
		t.Fatal("名单为空")
	}
	if roster[0].Status != domain.BookingConfirmed {
		t.Errorf("名单应以 confirmed 打头，实得 %s", roster[0].Status)
	}
	for _, e := range roster {
		if e.Name == "" || e.Phone == "" {
			t.Errorf("名单缺少会员信息：%+v", e)
		}
	}
	limited, err := r.Roster(ctx, sid, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(limited) > 1 {
		t.Errorf("limit 未生效：%d 行", len(limited))
	}
}

func TestStatsWindowClamped(t *testing.T) {
	ctx := context.Background()
	r := newRepo(t)
	cases := []struct {
		name string
		span int
		min  int64
	}{
		{"过小被抬到 3 天", 0, 1},
		{"正常 7 天", 7, 20},
		{"过大被压到 14 天", 9999, 20},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st, err := r.Stats(ctx, tc.span, fixedNow)
			if err != nil {
				t.Fatal(err)
			}
			if st.TotalSessions < tc.min {
				t.Errorf("窗口 %d 天只拿到 %d 节课", tc.span, st.TotalSessions)
			}
		})
	}
}

func asAppErr(err error, target **domain.AppError) bool {
	if err == nil {
		return false
	}
	if ae, ok := err.(*domain.AppError); ok {
		*target = ae
		return true
	}
	return false
}

// pickTestTarget 挑一节「未来 + 未满 + 有未被占用的会员可填」的课，
// 并把名字单里已存在的会员排除掉——否则测的就不是新增预约，而是查重整复。
func pickTestTarget(t *testing.T, r *Repo) (*domain.SessionRow, []domain.Member) {
	t.Helper()
	ctx := context.Background()
	members, err := r.ActiveMembers(ctx, 200)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) == 0 {
		t.Fatal("种子数据里没有可约课的会员")
	}
	rows, _, err := r.ListSessions(ctx, domain.ListQuery{
		Page: 1, PageSize: 100, Sort: "s.start_at", Dir: "asc", Days: 14, Status: domain.SessionOpen,
	}, fixedNow)
	if err != nil {
		t.Fatal(err)
	}
	cands := make([]domain.SessionRow, 0, len(rows))
	for _, s := range rows {
		if s.StartAt.After(fixedNow) && s.Remaining > 0 {
			cands = append(cands, s)
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].Remaining < cands[j].Remaining })
	for i := range cands {
		roster, err := r.Roster(ctx, cands[i].ID, 60)
		if err != nil {
			t.Fatal(err)
		}
		booked := map[int64]bool{}
		for _, e := range roster {
			if e.Status == domain.BookingConfirmed || e.Status == domain.BookingWaitlist {
				booked[e.MemberID] = true
			}
		}
		avail := make([]domain.Member, 0, len(members))
		for _, m := range members {
			if !booked[m.ID] {
				avail = append(avail, m)
			}
		}
		if len(avail) >= cands[i].Remaining {
			row := cands[i]
			return &row, avail
		}
	}
	t.Fatal("种子数据里找不到满足条件的测试课节")
	return nil, nil
}
