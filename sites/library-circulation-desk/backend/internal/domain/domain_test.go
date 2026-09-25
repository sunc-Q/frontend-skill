package domain

import (
	"testing"
	"time"
)

func ts(s string) time.Time {
	t, err := time.Parse("2006-01-02T15:04:05Z", s)
	if err != nil {
		panic(err)
	}
	return t.UTC()
}

func TestOverdueDays(t *testing.T) {
	cases := []struct {
		name string
		due  string
		ref  string
		want int64
	}{
		{"同一天不算逾期", "2026-09-26T09:00:00Z", "2026-09-26T23:59:00Z", 0},
		{"早于应还", "2026-09-26T09:00:00Z", "2026-09-20T09:00:00Z", 0},
		{"逾期一天", "2026-09-26T09:00:00Z", "2026-09-27T08:00:00Z", 1},
		{"逾期五天", "2026-09-20T00:00:00Z", "2026-09-25T12:00:00Z", 5},
		{"跨月", "2026-08-30T00:00:00Z", "2026-09-02T00:00:00Z", 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := OverdueDays(ts(c.due), ts(c.ref)); got != c.want {
				t.Fatalf("OverdueDays(%s,%s)=%d want %d", c.due, c.ref, got, c.want)
			}
		})
	}
}

func TestFineFor(t *testing.T) {
	cases := []struct {
		name     string
		days     int64
		category string
		want     int64
	}{
		{"零天零费", 0, CatGeneral, 0},
		{"负天数按零", -3, CatGeneral, 0},
		{"普通书每天50分", 4, CatGeneral, 200},
		{"普通书封顶20元", 999, CatGeneral, 2000},
		{"大字本每天30分", 10, CatLarge, 300},
		{"大字本封顶12元", 999, CatLarge, 1200},
		{"盒装每天1元", 3, CatBoxed, 300},
		{"盒装封顶40元", 999, CatBoxed, 4000},
		{"参考书不外借恒为0", 10, CatReference, 0},
		{"未知类别按0", 10, "mystery", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := FineFor(c.days, c.category); got != c.want {
				t.Fatalf("FineFor(%d,%s)=%d want %d", c.days, c.category, got, c.want)
			}
		})
	}
}

func TestFineMonotonicAndCapped(t *testing.T) {
	for _, cat := range []string{CatGeneral, CatLarge, CatBoxed} {
		prev := int64(-1)
		for d := int64(0); d <= 200; d++ {
			f := FineFor(d, cat)
			if f < prev {
				t.Fatalf("%s 逾期费非单调: d=%d f=%d prev=%d", cat, d, f, prev)
			}
			if cap := CatRules[cat].FineCap; f > cap {
				t.Fatalf("%s 逾期费越过硬顶: d=%d f=%d cap=%d", cat, d, f, cap)
			}
			prev = f
		}
	}
}

func TestBorrowInputValidate(t *testing.T) {
	cases := []struct {
		name      string
		in        BorrowInput
		wantOK    bool
		wantField string
	}{
		{"正常", BorrowInput{Barcode: "BN-000012", CardNo: "R-2026-0003"}, true, ""},
		{"条码过短", BorrowInput{Barcode: "BN", CardNo: "R-2026-0003"}, false, "barcode"},
		{"条码含引号注入", BorrowInput{Barcode: `BN-1" OR 1=1--`, CardNo: "R-2026-0003"}, false, "barcode"},
		{"条码含反斜杠", BorrowInput{Barcode: `BN\-000012`, CardNo: "R-2026-0003"}, false, "barcode"},
		{"条码含空格", BorrowInput{Barcode: "BN 000012", CardNo: "R-2026-0003"}, false, "barcode"},
		{"证号含中文", BorrowInput{Barcode: "BN-000012", CardNo: "证-0001"}, false, "card_no"},
		{"证号超长", BorrowInput{Barcode: "BN-000012", CardNo: "R-2026-0003R-2026-0003R"}, false, "card_no"},
		{"双非法", BorrowInput{Barcode: "", CardNo: ""}, false, "barcode"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			errs, ok := c.in.Validate()
			if ok != c.wantOK {
				t.Fatalf("ok=%v want %v (errs=%v)", ok, c.wantOK, errs)
			}
			if !ok {
				if _, has := errs[c.wantField]; !has {
					t.Fatalf("期望字段 %s 报错，实际 %v", c.wantField, errs)
				}
			}
		})
	}
}

func TestMemberQuotaAndValidations(t *testing.T) {
	if MemberQuota(MemberStudent) != 5 || MemberQuota(MemberFamily) != 12 || MemberQuota(MemberStandard) != 8 {
		t.Fatal("证别配额口径变了")
	}
	if !ValidCategory(CatBoxed) || ValidCategory("dvd") {
		t.Fatal("ValidCategory 口径错")
	}
	if ValidMemberType("vip") || !ValidMemberType("family") {
		t.Fatal("ValidMemberType 口径错")
	}
	if !ValidMemberStatus(MemberSuspended) || ValidMemberStatus("banned") {
		t.Fatal("ValidMemberStatus 口径错")
	}
}

func TestParseLoanQueryWhitelists(t *testing.T) {
	q := ParseLoanQuery(map[string][]string{
		"status":    {"active' OR 1=1--"},
		"sort":      {"l.due_at; DROP TABLE loans"},
		"dir":       {"SIDEWAYS"},
		"page":      {"-5"},
		"page_size": {"100000"},
		"q":         {string(make([]rune, 300))},
	})
	if q.Status != "" {
		t.Fatalf("非法 status 应被丢弃: %q", q.Status)
	}
	if q.Sort != "l.due_at" {
		t.Fatalf("非法 sort 应回落到默认: %q", q.Sort)
	}
	if q.Dir != "asc" {
		t.Fatalf("非法 dir 应为 asc: %q", q.Dir)
	}
	if q.Page != 1 || q.PageSize != MaxPageSize {
		t.Fatalf("分页夹取失败: page=%d size=%d", q.Page, q.PageSize)
	}
	if len([]rune(q.Search)) > MaxQueryRunes {
		t.Fatalf("搜索串未截断: %d", len([]rune(q.Search)))
	}
	ok := ParseLoanQuery(map[string][]string{"status": {"overdue"}, "sort": {"fine"}, "dir": {"desc"}, "category": {"boxed_set"}})
	if ok.Status != "overdue" || ok.Sort != "l.fine_cents" || ok.Dir != "desc" || ok.Category != CatBoxed {
		t.Fatalf("合法参数被误杀: %+v", ok)
	}
}

func TestParseItemQueryFilters(t *testing.T) {
	q := ParseItemQuery(map[string][]string{"status": {"available"}, "sort": {"available"}, "category": {"general"}})
	if q.Sort != "available_copies" || q.Status != "available" || q.Category != CatGeneral {
		t.Fatalf("items 查询解析失败: %+v", q)
	}
	bad := ParseItemQuery(map[string][]string{"status": {"whatever"}, "category": {"dvd"}})
	if bad.Status != "" || bad.Category != "" {
		t.Fatalf("非法枚举应清空: %+v", bad)
	}
}

func TestReturnInputPaidDefault(t *testing.T) {
	yes := true
	if (ReturnInput{}).PaidOrDefault() {
		t.Fatal("空体默认不应视为已缴")
	}
	if !(ReturnInput{Paid: &yes}).PaidOrDefault() {
		t.Fatal("paid=true 应透传")
	}
}
