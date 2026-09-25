package domain

import (
	"strings"
	"testing"
)

func TestEnrollInputValidate(t *testing.T) {
	cases := []struct {
		name     string
		in       EnrollInput
		wantOK   bool
		wantKeys []string
	}{
		{"合法报名", EnrollInput{CourseCode: "DS-101", Name: "赵岩岩", Phone: "13800000001", Source: "official"}, true, nil},
		{"手机号第二位为 2", EnrollInput{CourseCode: "DS-101", Name: "赵岩岩", Phone: "12800000001", Source: "official"}, false, []string{"phone"}},
		{"手机号含非数字", EnrollInput{CourseCode: "DS-101", Name: "赵岩岩", Phone: "1380000000a", Source: "official"}, false, []string{"phone"}},
		{"手机号注入串", EnrollInput{CourseCode: "DS-101", Name: "赵岩岩", Phone: "138'; DROP--", Source: "official"}, false, []string{"phone"}},
		{"姓名 1 字符", EnrollInput{CourseCode: "DS-101", Name: "赵", Phone: "13800000001", Source: "official"}, false, []string{"name"}},
		{"姓名超长", EnrollInput{CourseCode: "DS-101", Name: strings.Repeat("赵", 33), Phone: "13800000001", Source: "official"}, false, []string{"name"}},
		{"课程标识含引号", EnrollInput{CourseCode: "DS-101\"", Name: "赵岩岩", Phone: "13800000001", Source: "official"}, false, []string{"course_code"}},
		{"课程标识含空格分号", EnrollInput{CourseCode: "DS 101;--", Name: "赵岩岩", Phone: "13800000001", Source: "official"}, false, []string{"course_code"}},
		{"非法渠道", EnrollInput{CourseCode: "DS-101", Name: "赵岩岩", Phone: "13800000001", Source: "hacked'}, ("}, false, []string{"source"}},
		{"多字段同时非法", EnrollInput{CourseCode: "x", Name: "", Phone: "1", Source: ""}, false, []string{"course_code", "name", "phone", "source"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (errs=%v)", ok, tc.wantOK, errs)
			}
			if !tc.wantOK {
				for _, k := range tc.wantKeys {
					if _, has := errs[k]; !has {
						t.Errorf("缺少字段 %s 的错误回显，实得 %v", k, errs)
					}
				}
			}
			if ok && len(errs) != 0 {
				t.Errorf("校验通过但 errs 非空: %v", errs)
			}
		})
	}
}

func TestProgressAndStatusValidate(t *testing.T) {
	p101 := 101
	pNeg := -1
	p50 := 50
	cases := []struct {
		name     string
		in       ProgressInput
		wantOK   bool
		wantKeys []string
	}{
		{"正常 50", ProgressInput{ProgressPct: &p50}, true, nil},
		{"越界 101", ProgressInput{ProgressPct: &p101}, false, []string{"progress_pct"}},
		{"负数", ProgressInput{ProgressPct: &pNeg}, false, []string{"progress_pct"}},
		{"缺字段", ProgressInput{}, false, []string{"progress_pct"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			errs, ok := tc.in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			for _, k := range tc.wantKeys {
				if _, has := errs[k]; !has {
					t.Errorf("缺少字段 %s 的错误回显", k)
				}
			}
		})
	}

	st := []struct {
		in     CourseStatusInput
		wantOK bool
	}{
		{CourseStatusInput{To: "published"}, true},
		{CourseStatusInput{To: "archived"}, true},
		{CourseStatusInput{To: "draft"}, false},
		{CourseStatusInput{To: ""}, false},
		{CourseStatusInput{To: "DROP TABLE"}, false},
	}
	for _, tc := range st {
		if _, ok := tc.in.Validate(); ok != tc.wantOK {
			t.Errorf("to=%q ok=%v want %v", tc.in.To, ok, tc.wantOK)
		}
	}
}

func TestParseCourseListQueryConverges(t *testing.T) {
	cases := []struct {
		name   string
		values map[string][]string
		check  func(*testing.T, CourseListQuery)
	}{
		{"默认排序白名单外回退", map[string][]string{"sort": {"sleeves'; DROP"}}, func(t *testing.T, q CourseListQuery) {
			if q.Sort != courseSortColumns["fill"] {
				t.Errorf("sort = %q，应回退到默认 fill", q.Sort)
			}
		}},
		{"合法 sort 命中白名单", map[string][]string{"sort": {"price"}, "dir": {"ASC"}}, func(t *testing.T, q CourseListQuery) {
			if q.Sort != "effective_price" || q.Dir != "asc" {
				t.Errorf("sort/dir = %q/%q", q.Sort, q.Dir)
			}
		}},
		{"page_size 钳到上限", map[string][]string{"page_size": {"100000"}}, func(t *testing.T, q CourseListQuery) {
			if q.PageSize != MaxPageSize {
				t.Errorf("page_size = %d, want %d", q.PageSize, MaxPageSize)
			}
		}},
		{"非法 status 回退在售", map[string][]string{"status": {"garbage"}}, func(t *testing.T, q CourseListQuery) {
			if q.Status != CoursePublished {
				t.Errorf("status = %q, want published", q.Status)
			}
		}},
		{"非法 level 直接丢弃", map[string][]string{"level": {"地狱"}}, func(t *testing.T, q CourseListQuery) {
			if q.Level != "" {
				t.Errorf("level = %q, want 空", q.Level)
			}
		}},
		{"超长搜索串截断", map[string][]string{"q": {strings.Repeat("数", 200)}}, func(t *testing.T, q CourseListQuery) {
			if len([]rune(q.Search)) != MaxQueryRunes {
				t.Errorf("q 长度 = %d, want %d", len([]rune(q.Search)), MaxQueryRunes)
			}
		}},
		{"page 巨值钳制", map[string][]string{"page": {"999999999"}}, func(t *testing.T, q CourseListQuery) {
			if q.Page != 100_000 {
				t.Errorf("page = %d", q.Page)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := ParseCourseListQuery(tc.values)
			tc.check(t, q)
		})
	}
}

func TestMaskPhone(t *testing.T) {
	cases := []struct{ in, want string }{
		{"13800000001", "138****0001"},
		{"139", "****"},
		{"", "****"},
	}
	for _, tc := range cases {
		if got := MaskPhone(tc.in); got != tc.want {
			t.Errorf("MaskPhone(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestValidCourseCode(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"DS-101", true},
		{"AI_380", true},
		{"DS 101", false},
		{`DS"101`, false},
		{"DS-101;DROP", false},
		{"x", false},
		{strings.Repeat("a", 33), false},
	}
	for _, tc := range cases {
		if got := ValidCourseCode(tc.in); got != tc.want {
			t.Errorf("ValidCourseCode(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
