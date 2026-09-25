package domain

import (
	"strings"
	"testing"
)

func validInput() PlaceOrderInput {
	return PlaceOrderInput{
		Recipient: "王小川",
		Phone:     "13800001234",
		ZoneCode:  "near",
		Address:   "锦绣路 88 号花生唐小区 3 栋 2 单元 1205",
		Note:      "不要葱",
		Items:     []OrderItemInput{{Code: "HOT-012", Qty: 2}, {Code: "STP-034", Qty: 2}},
	}
}

func TestPlaceOrderInputValidate(t *testing.T) {
	longNote := strings.Repeat("加辣", 300)
	cases := []struct {
		name     string
		mutate   func(in *PlaceOrderInput)
		wantOK   bool
		wantKeys []string
	}{
		{"合法输入", func(in *PlaceOrderInput) {}, true, nil},
		{"手机号非 1 开头", func(in *PlaceOrderInput) { in.Phone = "23800001234" }, false, []string{"phone"}},
		{"手机号含字母", func(in *PlaceOrderInput) { in.Phone = "138000a1234" }, false, []string{"phone"}},
		{"手机号带注入片段", func(in *PlaceOrderInput) { in.Phone = "138'; DROP--" }, false, []string{"phone"}},
		{"菜品编码含引号", func(in *PlaceOrderInput) { in.Items[0].Code = `HOT"012` }, false, []string{"items[0].code"}},
		{"菜品编码含空格与分号", func(in *PlaceOrderInput) { in.Items[0].Code = "HOT 012;" }, false, []string{"items[0].code"}},
		{"菜品编码超长", func(in *PlaceOrderInput) { in.Items[0].Code = strings.Repeat("A", 33) }, false, []string{"items[0].code"}},
		{"重复菜品行", func(in *PlaceOrderInput) {
			in.Items = append(in.Items, OrderItemInput{Code: "HOT-012", Qty: 1})
		}, false, []string{"items[2].code"}},
		{"数量越界 0", func(in *PlaceOrderInput) { in.Items[1].Qty = 0 }, false, []string{"items[1].qty"}},
		{"数量越界 21", func(in *PlaceOrderInput) { in.Items[1].Qty = 21 }, false, []string{"items[1].qty"}},
		{"菜品行 0 条", func(in *PlaceOrderInput) { in.Items = nil }, false, []string{"items"}},
		{"菜品行 9 条", func(in *PlaceOrderInput) {
			for i := 0; i < 8; i++ {
				in.Items = append(in.Items, OrderItemInput{Code: "DST-051", Qty: 1})
			}
		}, false, []string{"items"}},
		{"地址过短", func(in *PlaceOrderInput) { in.Address = "1号" }, false, []string{"address"}},
		{"区域编码非法字符", func(in *PlaceOrderInput) { in.ZoneCode = "ne ar%" }, false, []string{"zone"}},
		{"备注超长", func(in *PlaceOrderInput) { in.Note = longNote }, false, []string{"note"}},
		{"姓名为空", func(in *PlaceOrderInput) { in.Recipient = "" }, false, []string{"recipient"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := validInput()
			tc.mutate(&in)
			errs, ok := in.Validate()
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want=%v errs=%v", ok, tc.wantOK, errs)
			}
			if !tc.wantOK {
				for _, k := range tc.wantKeys {
					if _, has := errs[k]; !has {
						t.Fatalf("期望字段 %q 报错，实际 errs=%v", k, errs)
					}
				}
			}
		})
	}
}

func TestStatusMachineMatrix(t *testing.T) {
	all := []string{OrderPlaced, OrderCooking, OrderReady, OrderDelivering, OrderDelivered, OrderCancelled}
	allowed := map[string][]string{
		OrderPlaced:     {OrderCooking, OrderCancelled},
		OrderCooking:    {OrderReady, OrderCancelled},
		OrderReady:      {OrderDelivering},
		OrderDelivering: {OrderDelivered},
		OrderDelivered:  nil,
		OrderCancelled:  nil,
	}
	for _, from := range all {
		for _, to := range all {
			want := false
			for _, a := range allowed[from] {
				if a == to {
					want = true
				}
			}
			if got := CanAdvance(from, to); got != want {
				t.Errorf("CanAdvance(%s,%s)=%v want=%v", from, to, got, want)
			}
		}
	}
}

func TestMaskPhoneAndCodes(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"13800001234", "138****1234"},
		{"1380000123", "***********"},
		{"", "***********"},
	}
	for _, tc := range cases {
		if got := MaskPhone(tc.in); got != tc.want {
			t.Errorf("MaskPhone(%q)=%q want=%q", tc.in, got, tc.want)
		}
	}
	if ValidCode(`HOT-012' OR 1=1--`) {
		t.Error("注入串不应通过 ValidCode")
	}
	if !ValidCode("z_1-A") {
		t.Error("合法编码被拒")
	}
	if ValidStatus("cooke") {
		t.Error("非法状态被接受")
	}
}
