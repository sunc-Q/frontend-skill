package domain

import "testing"

// lane 是计价表驱动用例的统一底稿：北京→上海特快，首 1kg 15 元，每 500g 2.6 元，
// 最低运费 18 元，燃油 8%，抛比 6000。
func testLane() *Lane {
	return &Lane{
		Code: "BJ-SH", Origin: "北京", Destination: "上海", Tier: TierExpress,
		DistanceKm: 1318, FirstKg: 1, FirstCents: 1500, HalfKgCents: 260,
		MinCents: 1800, FuelPct: 8, VolDivisor: 6000, PromiseDays: 1,
	}
}

func fragileRule(cents int64) SurchargeRule {
	return SurchargeRule{Code: "fragile-pack", Name: "易碎加固包装费", Kind: KindFragileFlat, AmountCents: cents, Priority: 30, Active: true}
}

func TestQuoteOfPricing(t *testing.T) {
	cases := []struct {
		name                  string
		in                    QuoteInput
		wantVolumetric        int64
		wantChargeable        int64
		wantContinueUnits     int64
		wantFreight, wantFuel int64
		wantInsurance         int64
		wantSurcharge         int64
		wantTotal             int64
		wantCapped            bool
	}{
		{
			name: "轻件触发最低运费",
			in: QuoteInput{Lane: testLane(), WeightGrams: 300, VolumeCm3: 900, HeaviestG: 300,
				DeclaredCents: 0, Fragile: false},
			wantVolumetric: 150, wantChargeable: 500, wantContinueUnits: 0,
			wantFreight: 1800, wantFuel: 144, wantInsurance: 0, wantSurcharge: 0, wantTotal: 1944,
		},
		{
			name: "500g 边界：恰好整档不进位",
			in: QuoteInput{Lane: testLane(), WeightGrams: 2500, VolumeCm3: 1000, HeaviestG: 1000,
				DeclaredCents: 0, Fragile: false},
			wantVolumetric: 167, wantChargeable: 2500, wantContinueUnits: 3,
			wantFreight: 1500 + 3*260, wantFuel: 182, wantInsurance: 0, wantSurcharge: 0, wantTotal: 2462,
		},
		{
			name: "501g 向上进位一档",
			in: QuoteInput{Lane: testLane(), WeightGrams: 2501, VolumeCm3: 1000, HeaviestG: 1000,
				DeclaredCents: 0, Fragile: false},
			wantVolumetric: 167, wantChargeable: 3000, wantContinueUnits: 4,
			wantFreight: 2540, wantFuel: 203, wantInsurance: 0, wantSurcharge: 0, wantTotal: 2743,
		},
		{
			name: "体积重压过实际重（泡货按体积计费）",
			in: QuoteInput{Lane: testLane(), WeightGrams: 1000, VolumeCm3: 60000, HeaviestG: 500,
				DeclaredCents: 0, Fragile: false},
			wantVolumetric: 10000, wantChargeable: 10000, wantContinueUnits: 18,
			wantFreight: 6180, wantFuel: 494, wantInsurance: 0, wantSurcharge: 0, wantTotal: 6674,
		},
		{
			name: "保价按比例且有 2 元最低",
			in: QuoteInput{Lane: testLane(), WeightGrams: 1000, VolumeCm3: 1000, HeaviestG: 500,
				DeclaredCents: 100_00, Fragile: false},
			wantVolumetric: 167, wantChargeable: 1000, wantContinueUnits: 0,
			wantFreight: 1800, wantFuel: 144, wantInsurance: 200, wantSurcharge: 0, wantTotal: 2144,
		},
		{
			name: "易碎附加费正常叠加",
			in: QuoteInput{Lane: testLane(), Rules: []SurchargeRule{fragileRule(1000)}, WeightGrams: 5000,
				VolumeCm3: 1000, HeaviestG: 2000, DeclaredCents: 0, Fragile: true},
			wantVolumetric: 167, wantChargeable: 5000, wantContinueUnits: 8,
			wantFreight: 3580, wantFuel: 286, wantInsurance: 0, wantSurcharge: 1000, wantTotal: 4866,
		},
		{
			name: "附加费封顶在运费 80% 并留痕",
			in: QuoteInput{Lane: testLane(), Rules: []SurchargeRule{fragileRule(6000), fragileRule(6000)},
				WeightGrams: 5000, VolumeCm3: 1000, HeaviestG: 2000, DeclaredCents: 0, Fragile: true},
			wantVolumetric: 167, wantChargeable: 5000, wantContinueUnits: 8,
			wantFreight: 3580, wantFuel: 286, wantInsurance: 0,
			wantSurcharge: roundHalfUp(3580*SurchargeCapPct, 100), wantTotal: 3580 + 286 + 2864, wantCapped: true,
		},
		{
			name: "无线路时走默认抛比且不崩",
			in: QuoteInput{WeightGrams: 4000, VolumeCm3: 8000, HeaviestG: 1000,
				DeclaredCents: 0, Fragile: false},
			wantVolumetric: 1000, wantChargeable: 4000, wantContinueUnits: 0,
			wantFreight: 0, wantFuel: 0, wantInsurance: 0, wantSurcharge: 0, wantTotal: 0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := QuoteOf(tc.in)
			if q.VolumetricGrams != tc.wantVolumetric {
				t.Errorf("体积重 = %d, 期望 %d", q.VolumetricGrams, tc.wantVolumetric)
			}
			if q.ChargeableGrams != tc.wantChargeable {
				t.Errorf("计费重 = %d, 期望 %d", q.ChargeableGrams, tc.wantChargeable)
			}
			if q.ContinueUnits != tc.wantContinueUnits {
				t.Errorf("续重档数 = %d, 期望 %d", q.ContinueUnits, tc.wantContinueUnits)
			}
			if q.FreightCents != tc.wantFreight {
				t.Errorf("运费 = %d, 期望 %d", q.FreightCents, tc.wantFreight)
			}
			if q.FuelCents != tc.wantFuel {
				t.Errorf("燃油 = %d, 期望 %d", q.FuelCents, tc.wantFuel)
			}
			if q.InsuranceCents != tc.wantInsurance {
				t.Errorf("保价 = %d, 期望 %d", q.InsuranceCents, tc.wantInsurance)
			}
			if q.SurchargeCents != tc.wantSurcharge {
				t.Errorf("附加费 = %d, 期望 %d", q.SurchargeCents, tc.wantSurcharge)
			}
			if q.Capped != tc.wantCapped {
				t.Errorf("截断标记 = %v, 期望 %v", q.Capped, tc.wantCapped)
			}
			if q.TotalCents != tc.wantTotal {
				t.Errorf("总额 = %d, 期望 %d", q.TotalCents, tc.wantTotal)
			}
			if q.TotalCents != q.FreightCents+q.FuelCents+q.InsuranceCents+q.SurchargeCents {
				t.Errorf("恒等式破口：total=%d ≠ 四段之和", q.TotalCents)
			}
		})
	}
}

func TestRuleKindsAndInactivity(t *testing.T) {
	remote := SurchargeRule{Code: "remote-svc", Kind: KindRemotePct, RatePct: 15, MinCents: 800, Priority: 10, Active: true}
	heavy := SurchargeRule{Code: "heavy-single", Kind: KindHeavyPiece, ThresholdG: 30000, AmountCents: 1500, Priority: 20, Active: true}
	longHaul := SurchargeRule{Code: "long-haul", Kind: KindLongHaul, ThresholdKm: 2000, AmountCents: 1200, Priority: 40, Active: true}
	paused := fragileRule(1000)
	paused.Active = false

	cases := []struct {
		name          string
		lane          *Lane
		rules         []SurchargeRule
		heaviest      int64
		fragile       bool
		wantSurcharge int64
		wantItems     int
	}{
		{"非偏远线路不收偏远费", testLane(), []SurchargeRule{remote}, 0, false, 0, 0},
		{"偏远线路按 15% 且有最低 8 元", func() *Lane { l := testLane(); l.RemoteArea = true; return l }(),
			[]SurchargeRule{remote}, 0, false, 800, 1},
		{"单件达重要收超重费", testLane(), []SurchargeRule{heavy}, 30000, false, 1500, 1},
		{"单件未达门槛不收", testLane(), []SurchargeRule{heavy}, 29999, false, 0, 0},
		{"里程达门槛收长途费", testLane(), []SurchargeRule{longHaul}, 0, false, 0, 0},
		{"停用规则不参与仲裁", testLane(), []SurchargeRule{paused}, 0, true, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := QuoteOf(QuoteInput{Lane: tc.lane, Rules: SortRulesActive(tc.rules),
				WeightGrams: 5000, VolumeCm3: 1000, HeaviestG: tc.heaviest, Fragile: tc.fragile})
			if q.SurchargeCents != tc.wantSurcharge {
				t.Errorf("附加费 = %d, 期望 %d", q.SurchargeCents, tc.wantSurcharge)
			}
			if len(q.Items) != tc.wantItems {
				t.Errorf("条目数 = %d, 期望 %d", len(q.Items), tc.wantItems)
			}
		})
	}
}

func TestSortRulesActiveOrder(t *testing.T) {
	rules := []SurchargeRule{
		{Code: "z-second", Priority: 20, Active: true},
		{Code: "a-same", Priority: 20, Active: true},
		{Code: "first", Priority: 10, Active: true},
		{Code: "off", Priority: 1, Active: false},
	}
	got := SortRulesActive(rules)
	want := []string{"first", "a-same", "z-second"}
	if len(got) != len(want) {
		t.Fatalf("只应保留启用规则，得到 %d 条", len(got))
	}
	for i, code := range want {
		if got[i].Code != code {
			t.Errorf("第 %d 位 = %s, 期望 %s（优先级升序、同级按标识）", i, got[i].Code, code)
		}
	}
}

func TestStateMachineTransitions(t *testing.T) {
	all := []string{StBooked, StPickedUp, StInTransit, StArrived, StOutForDelivery, StDelivered, StException, StReturned}
	cases := []struct {
		from, to string
		want     bool
	}{
		{StBooked, StPickedUp, true},
		{StBooked, StDelivered, false},
		{StPickedUp, StInTransit, true},
		{StInTransit, StOutForDelivery, false},
		{StOutForDelivery, StDelivered, true},
		{StException, StInTransit, true},
		{StException, StReturned, true},
		{StDelivered, StException, false},
		{StDelivered, StBooked, false},
		{StReturned, StPickedUp, false},
		{StBooked, StBooked, false},
		{StBooked, "flying", false},
	}
	for _, tc := range cases {
		if got := CanAdvance(tc.from, tc.to); got != tc.want {
			t.Errorf("CanAdvance(%s→%s) = %v, 期望 %v", tc.from, tc.to, got, tc.want)
		}
	}
	// 表自身闭合：every 状态的每个出口都必须是合法状态名。
	for from, outs := range NextStatus {
		if !ValidStatus(from) {
			t.Errorf("跃迁表键 %s 不是合法状态", from)
		}
		for _, to := range outs {
			if !ValidStatus(to) {
				t.Errorf("%s 的出口 %s 不是合法状态", from, to)
			}
		}
	}
	// 终态不得有出口。
	for _, term := range []string{StDelivered, StReturned} {
		if len(NextStatus[term]) != 0 {
			t.Errorf("终态 %s 不应有出口", term)
		}
	}
	// 所有非终态都必须能进异常，否则异常上报有死角。
	for _, s := range all {
		if s == StDelivered || s == StReturned || s == StException {
			continue
		}
		if !CanAdvance(s, StException) {
			t.Errorf("%s 无法登记异常", s)
		}
	}
}

func TestInputValidation(t *testing.T) {
	base := CreateWaybillInput{
		LaneCode: "BJ-SH", ShipperName: "青禾食品", Phone: "13800001111",
		PieceCount: 2, WeightGrams: 5000, VolumeCm3: 40000, HeaviestG: 3000,
		DeclaredCents: 100000, Node: "上海分拨中心",
	}
	okCases := []struct {
		name   string
		mutate func(in *CreateWaybillInput)
	}{
		{"完整合法输入", func(*CreateWaybillInput) {}},
		{"网点留空走默认", func(in *CreateWaybillInput) { in.Node = "" }},
		{"零申报", func(in *CreateWaybillInput) { in.DeclaredCents = 0 }},
	}
	for _, tc := range okCases {
		t.Run(tc.name, func(t *testing.T) {
			in := base
			tc.mutate(&in)
			if _, ok := in.Validate(); !ok {
				t.Errorf("应通过校验")
			}
		})
	}

	badCases := []struct {
		name    string
		mutate  func(in *CreateWaybillInput)
		wantKey string
	}{
		{"注入串线路码", func(in *CreateWaybillInput) { in.LaneCode = "BJ-SH'; DROP" }, "lane_code"},
		{"超长线路码", func(in *CreateWaybillInput) { in.LaneCode = string(make([]byte, 25)) }, "lane_code"},
		{"一位数手机号", func(in *CreateWaybillInput) { in.Phone = "1380000111" }, "phone"},
		{"非 1 开头号码", func(in *CreateWaybillInput) { in.Phone = "23800001111" }, "phone"},
		{"件数为 0", func(in *CreateWaybillInput) { in.PieceCount = 0 }, "piece_count"},
		{"件数超上限", func(in *CreateWaybillInput) { in.PieceCount = 201 }, "piece_count"},
		{"零克重", func(in *CreateWaybillInput) { in.WeightGrams = 0 }, "weight_grams"},
		{"超上限克重", func(in *CreateWaybillInput) { in.WeightGrams = MaxWeightGrams + 1 }, "weight_grams"},
		{"最重单件超过总重", func(in *CreateWaybillInput) { in.HeaviestG = in.WeightGrams + 1 }, "heaviest_piece_g"},
		{"负体积", func(in *CreateWaybillInput) { in.VolumeCm3 = -1 }, "volume_cm3"},
		{"申报超上限", func(in *CreateWaybillInput) { in.DeclaredCents = MaxDeclaredCents + 1 }, "declared_cents"},
		{"寄件人 1 字符", func(in *CreateWaybillInput) { in.ShipperName = "甲" }, "shipper_name"},
		{"网点 41 字符", func(in *CreateWaybillInput) {
			in.Node = string([]rune("网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点网点"))
		}, "node"},
	}
	for _, tc := range badCases {
		t.Run(tc.name, func(t *testing.T) {
			in := base
			tc.mutate(&in)
			errs, ok := in.Validate()
			if ok {
				t.Fatalf("应被拒绝")
			}
			if _, has := errs[tc.wantKey]; !has {
				t.Errorf("错误应落在 %s，实际 %v", tc.wantKey, errs)
			}
		})
	}
}

func TestRuleInputValidation(t *testing.T) {
	base := CreateRuleInput{Code: "night-svc", Name: "夜间取件费", Kind: KindFragileFlat, AmountCents: 500, Priority: 50}
	cases := []struct {
		name    string
		mutate  func(in *CreateRuleInput)
		wantErr bool
		key     string
	}{
		{"合法固定额", func(*CreateRuleInput) {}, false, ""},
		{"未知 kind", func(in *CreateRuleInput) { in.Kind = "percent_of_moon" }, true, "kind"},
		{"易碎型缺固定额", func(in *CreateRuleInput) { in.AmountCents = 0 }, true, "amount_cents"},
		{"超重门槛低于 10kg", func(in *CreateRuleInput) { in.Kind = KindHeavyPiece; in.ThresholdG = 9999; in.AmountCents = 100 }, true, "threshold_g"},
		{"偏远型费率与最低额全空", func(in *CreateRuleInput) { in.Kind = KindRemotePct; in.RatePct = 0; in.MinCents = 0 }, true, "rate_pct"},
		{"优先级 0", func(in *CreateRuleInput) { in.Priority = 0 }, true, "priority"},
		{"里程门槛越界", func(in *CreateRuleInput) { in.ThresholdKm = 10001 }, true, "threshold_km"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := base
			tc.mutate(&in)
			errs, ok := in.Validate()
			if ok == tc.wantErr {
				t.Fatalf("wantErr=%v got errs=%v", tc.wantErr, errs)
			}
			if tc.wantErr {
				if _, has := errs[tc.key]; !has {
					t.Errorf("错误应落在 %s，实际 %v", tc.key, errs)
				}
			}
		})
	}
}

func TestAllowlistsAndMask(t *testing.T) {
	codeCases := []struct {
		in   string
		want bool
	}{
		{"BJ-SH", true}, {"ab_9-Z", true}, {"", false},
		{"BJ SH", false}, {"';DROP", false}, {"BJ-SH%27", false}, {"北京", false},
	}
	for _, tc := range codeCases {
		if got := CodeAllowed(tc.in); got != tc.want {
			t.Errorf("CodeAllowed(%q) = %v", tc.in, got)
		}
	}
	mobileCases := []struct {
		in   string
		want bool
	}{
		{"13800001111", true}, {"14812345678", true},
		{"12800001111", false}, {"1380000111", false}, {"138000011112", false},
		{"1380000111a", false}, {"", false},
	}
	for _, tc := range mobileCases {
		if got := MobileAllowed(tc.in); got != tc.want {
			t.Errorf("MobileAllowed(%q) = %v", tc.in, got)
		}
	}
	if got := MaskPhone("13800001111"); got != "138****1111" {
		t.Errorf("MaskPhone = %s", got)
	}
	if got := MaskPhone("138"); got != "未登记" {
		t.Errorf("非 11 位应显示未登记，得到 %s", got)
	}
}

func TestRoundHalfUp(t *testing.T) {
	cases := []struct {
		num, den, want int64
	}{
		{150 * 8, 100, 12}, {149 * 8, 100, 12}, {100, 3, 33}, {101, 3, 34},
		{0, 100, 0}, {5, 10, 1}, {-150, 100, -2}, {100, 0, 0},
	}
	for _, tc := range cases {
		if got := RoundHalfUpInt(tc.num, tc.den); got != tc.want {
			t.Errorf("RoundHalfUp(%d,%d) = %d, 期望 %d", tc.num, tc.den, got, tc.want)
		}
	}
}
