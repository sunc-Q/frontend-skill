package repository

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"bizsite/internal/domain"
)

func newSeededRepo(t *testing.T) (*Repo, time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 25, 8, 0, 0, 0, time.UTC)
	db, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	r := New(db)
	if err := r.Seed(context.Background(), now); err != nil {
		t.Fatalf("种子失败: %v", err)
	}
	return r, now
}

func TestSeedIdempotentAndShape(t *testing.T) {
	r, now := newSeededRepo(t)
	ctx := context.Background()

	type counts struct {
		table string
		want  int64
	}
	var n int64
	if err := r.db.Table("instructors").Count(&n).Error; err != nil || n != 6 {
		t.Fatalf("讲师数 = %d, want 6 (err=%v)", n, err)
	}
	if err := r.db.Table("courses").Count(&n).Error; err != nil || n != 16 {
		t.Fatalf("课程数 = %d, want 16 (err=%v)", n, err)
	}
	if err := r.db.Table("chapters").Count(&n).Error; err != nil || n < 60 {
		t.Fatalf("章节数 = %d, want >=60 (err=%v)", n, err)
	}
	var before int64
	if err := r.db.Table("enrollments").Count(&before).Error; err != nil || before < 100 {
		t.Fatalf("报名数 = %d, want >=100 (err=%v)", before, err)
	}
	// 再跑一次 Seed 不应翻倍。
	if err := r.Seed(ctx, now); err != nil {
		t.Fatalf("二次 Seed 报错: %v", err)
	}
	var after int64
	if err := r.db.Table("enrollments").Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Errorf("Seed 不幂等：报名数 %d → %d", before, after)
	}
	// 每门课的占座数不得超过容量；候补只出现在满座课上。
	var courses []domain.Course
	if err := r.db.Find(&courses).Error; err != nil {
		t.Fatal(err)
	}
	for _, c := range courses {
		var occ, wait int64
		r.db.Model(&domain.Enrollment{}).Where("course_id = ? AND status IN ?", c.ID,
			[]string{domain.EnrollActive, domain.EnrollCompleted}).Count(&occ)
		r.db.Model(&domain.Enrollment{}).Where("course_id = ? AND status = ?", c.ID, domain.EnrollWaitlist).Count(&wait)
		if occ > int64(c.Capacity) {
			t.Errorf("课程 %s 超卖：%d/%d", c.Code, occ, c.Capacity)
		}
		if wait > 0 && occ < int64(c.Capacity) {
			t.Errorf("课程 %s 有余位却存在候补 %d", c.Code, wait)
		}
	}
}

func TestEnrollTransactionMatrix(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name       string
		code       string
		phone      string
		wantStatus string
	}{
		{"有余位直接在读", "FE-390", "13700001001", domain.EnrollActive},
		{"满座课转候补", "DS-101", "13700001002", domain.EnrollWaitlist},
		{"草稿课报名失败", "SEC-310", "13700001003", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, now := newSeededRepo(t)
			var c domain.Course
			if err := r.db.Where("code = ?", tc.code).First(&c).Error; err != nil {
				t.Fatal(err)
			}
			e, err := r.Enroll(ctx, EnrollCmd{
				CourseID: c.ID, Name: "测试学员", Phone: tc.phone, Source: "official",
				ListPrice: 20000, Discount: 1000, Now: now,
			})
			if tc.wantStatus == "" {
				var ae *domain.AppError
				if !errors.As(err, &ae) || ae.HTTPCode != 409 {
					t.Fatalf("期望 409，实得 err=%v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("报名失败: %v", err)
			}
			if e.Status != tc.wantStatus {
				t.Fatalf("status = %s, want %s", e.Status, tc.wantStatus)
			}
			if e.Status == domain.EnrollActive && e.PaidCents != 19000 {
				t.Errorf("paid = %d, want 19000（list-discount 恒等式）", e.PaidCents)
			}
			if e.Status == domain.EnrollWaitlist && (e.PaidCents != 0 || e.Discount != 0) {
				t.Errorf("候补不应产生费用：paid=%d discount=%d", e.PaidCents, e.Discount)
			}
			// 同课程同手机号再报名：409（唯一索引 + 事务内查重双保险）。
			if _, err := r.Enroll(ctx, EnrollCmd{
				CourseID: c.ID, Name: "重复者", Phone: tc.phone, Source: "official",
				ListPrice: 20000, Now: now,
			}); err == nil {
				t.Fatal("重复报名应返回错误")
			} else {
				var ae *domain.AppError
				if !errors.As(err, &ae) || ae.HTTPCode != 409 {
					t.Errorf("重复报名错误码 = %v, want 409", err)
				}
			}
		})
	}
}

func TestAdvanceProgressStateMachine(t *testing.T) {
	ctx := context.Background()
	r, now := newSeededRepo(t)

	// 造三种状态的样本各一条。
	var activeCourse domain.Course
	if err := r.db.Where("code = ?", "PM-130").First(&activeCourse).Error; err != nil {
		t.Fatal(err)
	}
	mk := func(phone, status string, pct int) int64 {
		e := domain.Enrollment{
			CourseID: activeCourse.ID, LearnerName: "样本", Phone: phone, Status: status,
			ProgressPct: pct, ListPrice: 100, Source: "official", EnrolledAt: now,
		}
		if err := r.db.Create(&e).Error; err != nil {
			t.Fatal(err)
		}
		return e.ID
	}
	cases := []struct {
		name    string
		id      int64
		pct     int
		wantErr bool
		wantSt  string
		wantPct int
	}{
		{"在读推进到 60", mk("13700002001", domain.EnrollActive, 10), 60, false, domain.EnrollActive, 60},
		{"在读到 100 自动结课", mk("13700002002", domain.EnrollActive, 95), 100, false, domain.EnrollCompleted, 100},
		{"候补拒绝", mk("13700002003", domain.EnrollWaitlist, 0), 50, true, "", 0},
		{"结课后拒绝", mk("13700002004", domain.EnrollCompleted, 100), 50, true, "", 0},
		{"退课后拒绝", mk("13700002005", domain.EnrollDropped, 20), 50, true, "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e, err := r.AdvanceProgress(ctx, tc.id, tc.pct, now)
			if tc.wantErr {
				var ae *domain.AppError
				if !errors.As(err, &ae) || ae.HTTPCode != 409 {
					t.Fatalf("期望 409，实得 %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("推进失败: %v", err)
			}
			if e.Status != tc.wantSt || e.ProgressPct != tc.wantPct {
				t.Errorf("status/pct = %s/%d, want %s/%d", e.Status, e.ProgressPct, tc.wantSt, tc.wantPct)
			}
		})
	}
}

func TestChangeCourseStatusMatrix(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name    string
		code    string
		to      string
		wantErr bool
		want    string
	}{
		{"草稿上架", "SEC-310", domain.CoursePublished, false, domain.CoursePublished},
		{"上架再下线", "DS-090", domain.CourseArchived, true, ""}, // archived→archived 非法
		{"在售转下线", "AI-380", domain.CourseArchived, false, domain.CourseArchived},
		{"草稿直接归档不允许", "SEC-220", domain.CourseArchived, true, ""},
		{"重复上架不允许", "PM-130", domain.CoursePublished, true, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, now := newSeededRepo(t)
			c, err := r.ChangeCourseStatus(ctx, tc.code, tc.to, now)
			if tc.wantErr {
				var ae *domain.AppError
				if !errors.As(err, &ae) || ae.HTTPCode != 409 {
					t.Fatalf("期望 409，实得 %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("状态迁移失败: %v", err)
			}
			if c.Status != tc.want {
				t.Errorf("status = %s, want %s", c.Status, tc.want)
			}
			if tc.to == domain.CoursePublished && c.PublishedAt == nil {
				t.Error("上架应盖 published_at 时间戳")
			}
		})
	}
}

func TestStatsIdentities(t *testing.T) {
	r, now := newSeededRepo(t)
	ctx := context.Background()
	s, err := r.Stats(ctx, now)
	if err != nil {
		t.Fatalf("Stats 失败: %v", err)
	}
	if s.PayingLearners != s.ActiveLearners+s.CompletedCount {
		t.Errorf("在读+结课 != 付费学员：%d+%d != %d", s.ActiveLearners, s.CompletedCount, s.PayingLearners)
	}
	var sumGmv, sumDisc int64
	if err := r.db.Model(&domain.Enrollment{}).
		Where("status IN ?", []string{domain.EnrollActive, domain.EnrollCompleted}).
		Select("COALESCE(SUM(paid_cents),0)").Scan(&sumGmv).Error; err != nil {
		t.Fatal(err)
	}
	r.db.Model(&domain.Enrollment{}).
		Where("status IN ?", []string{domain.EnrollActive, domain.EnrollCompleted}).
		Select("COALESCE(SUM(discount),0)").Scan(&sumDisc)
	if s.GMVCents != sumGmv {
		t.Errorf("GMV 接口值 %d != SQL 直查 %d", s.GMVCents, sumGmv)
	}
	if s.DiscountTotal != sumDisc {
		t.Errorf("折扣合计 %d != SQL 直查 %d", s.DiscountTotal, sumDisc)
	}
	// 每门实付必须满足 paid = list - discount 且 >= 0。
	var enrs []domain.Enrollment
	r.db.Where("status IN ?", []string{domain.EnrollActive, domain.EnrollCompleted}).Find(&enrs)
	for _, e := range enrs {
		if e.PaidCents != e.ListPrice-e.Discount || e.PaidCents < 0 {
			t.Errorf("报名 %d 价格恒等式不成立: %d != %d-%d", e.ID, e.PaidCents, e.ListPrice, e.Discount)
		}
	}
	// 分域 rollup 的 gmv 之和必须等于总 GMV。
	var rollupSum int64
	for _, d := range s.ByDomain {
		rollupSum += d.GMVCents
	}
	if rollupSum != s.GMVCents {
		t.Errorf("分域 GMV 之和 %d != 总 GMV %d", rollupSum, s.GMVCents)
	}
	if len(s.Monthly) == 0 {
		t.Error("月度趋势为空")
	}
}

func TestListCoursesFilters(t *testing.T) {
	r, now := newSeededRepo(t)
	ctx := context.Background()

	// 默认只看在售。
	q := domain.ParseCourseListQuery(map[string][]string{})
	rows, total, err := r.ListCourses(ctx, q, now)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(rows)) > total || total == 0 {
		t.Fatalf("total=%d rows=%d", total, len(rows))
	}
	for _, row := range rows {
		if row.Status != domain.CoursePublished {
			t.Fatalf("默认列表混入非在售课程 %s(%s)", row.Code, row.Status)
		}
	}
	// 域过滤 + 搜索 LIKE 转义：`%` 不应命中全部。
	q2 := domain.ParseCourseListQuery(map[string][]string{"q": {"%"}})
	_, totalLike, err := r.ListCourses(ctx, q2, now)
	if err != nil {
		t.Fatal(err)
	}
	if totalLike > 2 {
		t.Errorf("未转义的 %% 命中了 %d 条，LIKE 逃逸", totalLike)
	}
	// 早鸟过滤。
	q3 := domain.ParseCourseListQuery(map[string][]string{"early": {"1"}, "page_size": {"100"}})
	earlyRows, _, err := r.ListCourses(ctx, q3, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range earlyRows {
		if row.EarlyDeadline == nil || !now.Before(row.EarlyDeadline.Add(24*time.Hour)) {
			t.Errorf("early=1 列表混入非早鸟课程 %s", row.Code)
		}
	}
}
