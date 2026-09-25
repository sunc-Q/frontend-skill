package domain

import (
	"testing"
)

func TestCreateMemberInputValidate(t *testing.T) {
	cases := []struct {
		name    string
		in      CreateMemberInput
		wantOK  bool
		wantKey string
	}{
		{"正常年卡", CreateMemberInput{Name: "赵岩", Phone: "13800000001", CardType: CardAnnual}, true, ""},
		{"姓名为空", CreateMemberInput{Name: "", Phone: "13800000001", CardType: CardMonthly}, false, "name"},
		{"姓名超长 300 字", CreateMemberInput{Name: longRunes(300), Phone: "13800000001", CardType: CardMonthly}, false, "name"},
		{"手机号含分号注入", CreateMemberInput{Name: "陈立", Phone: "1380000'; DROP TABLE members;--", CardType: CardMonthly}, false, "phone"},
		{"手机号过短", CreateMemberInput{Name: "陈立", Phone: "138", CardType: CardMonthly}, false, "phone"},
		{"手机号超长 40 位", CreateMemberInput{Name: "陈立", Phone: longDigits(40), CardType: CardMonthly}, false, "phone"},
		{"手机号含换行", CreateMemberInput{Name: "陈立", Phone: "1380000000\n1", CardType: CardMonthly}, false, "phone"},
		{"卡种非法", CreateMemberInput{Name: "陈立", Phone: "13800000001", CardType: "lifetime"}, false, "card_type"},
		{"次卡次数越界", CreateMemberInput{Name: "陈立", Phone: "13800000001", CardType: CardTenSession, Credits: 9999}, false, "credits"},
		{"有效期越界", CreateMemberInput{Name: "陈立", Phone: "13800000001", CardType: CardMonthly, DaysValid: 999999}, false, "days_valid"},
		{"带 +86 与国际连字符合法", CreateMemberInput{Name: "林薇", Phone: "+86-138-0000-0001", CardType: CardTrial}, true, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v errs=%v", ok, tc.wantOK, errs)
			}
			if tc.wantOK {
				return
			}
			if _, has := errs[tc.wantKey]; !has {
				t.Errorf("字段 %q 应报错，实得 %v", tc.wantKey, errs)
			}
		})
	}
}

func TestCreateBookingInputValidate(t *testing.T) {
	cases := []struct {
		name    string
		in      CreateBookingInput
		wantOK  bool
		wantKey string
	}{
		{"按会员 ID", CreateBookingInput{MemberID: 7}, true, ""},
		{"按手机号", CreateBookingInput{Phone: "13800000001", Source: "app"}, true, ""},
		{"两者都缺", CreateBookingInput{}, false, "member_id"},
		{"负 ID", CreateBookingInput{MemberID: -3}, false, "member_id"},
		{"手机号超长", CreateBookingInput{Phone: longDigits(30)}, false, "phone"},
		{"来源不在白名单", CreateBookingInput{MemberID: 1, Source: "sms' OR 1=1--"}, false, "source"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v", ok, tc.wantOK)
			}
			if tc.wantOK {
				return
			}
			if _, has := errs[tc.wantKey]; !has {
				t.Errorf("字段 %q 应报错，实得 %v", tc.wantKey, errs)
			}
		})
	}
}

func TestParseListQueryConvergesUntrustedInput(t *testing.T) {
	cases := []struct {
		name  string
		query map[string][]string
		check func(*testing.T, ListQuery)
	}{
		{
			"排序字段走白名单，注入列名被丢弃",
			map[string][]string{"sort": {"start_at; DROP TABLE sessions"}},
			func(t *testing.T, q ListQuery) {
				if q.Sort != "s.start_at" {
					t.Errorf("Sort=%q 未被收敛回默认值", q.Sort)
				}
			},
		},
		{
			"合法排序映射到带表前缀的列",
			map[string][]string{"sort": {"booked"}, "dir": {"DESC"}},
			func(t *testing.T, q ListQuery) {
				if q.Sort != "confirmed" || q.Dir != "desc" {
					t.Errorf("sort=%q dir=%q", q.Sort, q.Dir)
				}
			},
		},
		{
			"分页上限 100",
			map[string][]string{"page_size": {"99999"}},
			func(t *testing.T, q ListQuery) {
				if q.PageSize != MaxPageSize {
					t.Errorf("page_size=%d，应被压到 %d", q.PageSize, MaxPageSize)
				}
			},
		},
		{
			"窗口天数上限",
			map[string][]string{"days": {"9999"}},
			func(t *testing.T, q ListQuery) {
				if q.Days != ScheduleHoriz {
					t.Errorf("days=%d，应被压到 %d", q.Days, ScheduleHoriz)
				}
			},
		},
		{
			"搜索串按字符数截断",
			map[string][]string{"q": {longRunes(500)}},
			func(t *testing.T, q ListQuery) {
				if len([]rune(q.Search)) != MaxQueryRunes {
					t.Errorf("q 长度=%d，应截断到 %d", len([]rune(q.Search)), MaxQueryRunes)
				}
			},
		},
		{
			"非法分类被忽略",
			map[string][]string{"category": {"zumba'--"}},
			func(t *testing.T, q ListQuery) {
				if q.Category != "" {
					t.Errorf("category=%q 应被丢弃", q.Category)
				}
			},
		},
		{
			"教练名里的引号与空格被拒",
			map[string][]string{"coach": {"林薇' OR '1'='1"}},
			func(t *testing.T, q ListQuery) {
				if q.Coach != "" {
					t.Errorf("coach=%q 应被丢弃", q.Coach)
				}
			},
		},
		{
			"合法中文教练名保留",
			map[string][]string{"coach": {"林薇"}},
			func(t *testing.T, q ListQuery) {
				if q.Coach != "林薇" {
					t.Errorf("coach=%q", q.Coach)
				}
			},
		},
		{
			"日期格式严格",
			map[string][]string{"date": {"2026-13-45;select"}},
			func(t *testing.T, q ListQuery) {
				if q.From != "" {
					t.Errorf("from=%q 应被丢弃", q.From)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.check(t, ParseListQuery(tc.query))
		})
	}
}

func TestSessionRowOccupancyPct(t *testing.T) {
	cases := []struct {
		name string
		row  SessionRow
		want float64
	}{
		{"正常满座", SessionRow{Capacity: 10, Confirmed: 10}, 100},
		{"零容量不出 NaN", SessionRow{Capacity: 0, Confirmed: 3}, 0},
		{"超座被夹到 100", SessionRow{Capacity: 10, Confirmed: 14}, 100},
		{"半座", SessionRow{Capacity: 20, Confirmed: 5}, 25},
	}
	for _, tc := range cases {
		if got := tc.row.OccupancyPct(); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

func longRunes(n int) string {
	out := make([]rune, n)
	for i := range out {
		out[i] = '超'
	}
	return string(out)
}

func longDigits(n int) string {
	out := make([]byte, n)
	for i := range out {
		out[i] = '7'
	}
	return string(out)
}
