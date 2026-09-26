package domain

import "sort"

// QuoteOf 是全网唯一计价入口：线上下单、报价试算、种子灌数三处共用，
// 统计层绝不第二次算价，因此「运费+燃油+保价+附加 == 总额」是结构性恒等式。
//
// 口径（写死在此处，README 同段复述）：
//  1. 体积重(克) = 体积(cm³) × 1000 ÷ 抛比，向上取整；
//  2. 计费重 = max(实际重, 体积重) 后向上进位到 500g 一档；
//  3. 运费 = 首重价 + 续重档数 × 每 500g 单价，再与单票最低运费取大；
//  4. 燃油 = 运费 × 燃油率（四舍五入到分）；
//  5. 保价 = 声明价值 × 0.3%（四舍五入），有申报时最低 2 元；
//  6. 附加费按优先级逐条仲裁，合计封顶运费的 80%，截断时置 Capped；
//  7. 总额 = 运费 + 燃油 + 保价 + 附加费。
func QuoteOf(in QuoteInput) *Quote {
	q := &Quote{Items: []SurchargeItem{}}
	divisor := int64(DefaultVolDivisor)
	firstKg := int64(1)
	var fuelPct int64
	if in.Lane != nil {
		if in.Lane.VolDivisor > 0 {
			divisor = int64(in.Lane.VolDivisor)
		}
		if in.Lane.FirstKg > 0 {
			firstKg = int64(in.Lane.FirstKg)
		}
		fuelPct = int64(in.Lane.FuelPct)
	}

	q.VolumetricGrams = ceilDiv(in.VolumeCm3*1000, divisor)
	chargeable := in.WeightGrams
	if q.VolumetricGrams > chargeable {
		chargeable = q.VolumetricGrams
	}
	q.ChargeableGrams = ceilTo(chargeable, ChargeStepGrams)

	if in.Lane != nil {
		q.FreightCents = in.Lane.FirstCents
		units := q.ChargeableGrams - firstKg*1000
		if units < 0 {
			units = 0
		}
		q.ContinueUnits = ceilDiv(units, ChargeStepGrams)
		q.FreightCents += q.ContinueUnits * in.Lane.HalfKgCents
		if q.FreightCents < in.Lane.MinCents {
			q.FreightCents = in.Lane.MinCents
		}
	}

	q.FuelCents = roundHalfUp(q.FreightCents*fuelPct, 100)

	if in.DeclaredCents > 0 {
		ins := roundHalfUp(in.DeclaredCents*InsuranceBasisPoints, 10_000)
		if ins < InsuranceMinCents {
			ins = InsuranceMinCents
		}
		q.InsuranceCents = ins
	}

	q.SurchargeCents, q.Items, q.Capped = applySurcharges(in, q.FreightCents)
	q.TotalCents = q.FreightCents + q.FuelCents + q.InsuranceCents + q.SurchargeCents
	return q
}

// applySurcharges 只做「规则 → 金额」的仲裁，不碰数据库。
// 规则本身已在调用侧按 priority asc, code asc 排好序（确定性优先于 map 顺序）。
func applySurcharges(in QuoteInput, freight int64) (int64, []SurchargeItem, bool) {
	items := []SurchargeItem{}
	var sum int64
	for _, r := range in.Rules {
		if !r.Active {
			continue
		}
		cents, hit := ruleAmount(r, in, freight)
		if !hit || cents <= 0 {
			continue
		}
		sum += cents
		items = append(items, SurchargeItem{Code: r.Code, Name: r.Name, Cents: cents})
	}
	capCents := roundHalfUp(freight*SurchargeCapPct, 100)
	capped := false
	if sum > capCents {
		sum, capped = capCents, true
	}
	return sum, items, capped
}

func ruleAmount(r SurchargeRule, in QuoteInput, freight int64) (int64, bool) {
	switch r.Kind {
	case KindRemotePct:
		if in.Lane == nil || !in.Lane.RemoteArea {
			return 0, false
		}
		cents := roundHalfUp(freight*int64(r.RatePct), 100)
		if cents < r.MinCents {
			cents = r.MinCents
		}
		return cents, true
	case KindHeavyPiece:
		if r.ThresholdG <= 0 || in.HeaviestG < r.ThresholdG {
			return 0, false
		}
		return r.AmountCents, true
	case KindFragileFlat:
		if !in.Fragile {
			return 0, false
		}
		return r.AmountCents, true
	case KindLongHaul:
		if in.Lane == nil || r.ThresholdKm <= 0 || in.Lane.DistanceKm < r.ThresholdKm {
			return 0, false
		}
		return r.AmountCents, true
	}
	return 0, false
}

// SortRulesActive 把启用规则排成确定性顺序（优先级 → 标识）。
func SortRulesActive(rules []SurchargeRule) []SurchargeRule {
	out := make([]SurchargeRule, 0, len(rules))
	for _, r := range rules {
		if r.Active {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Priority != out[j].Priority {
			return out[i].Priority < out[j].Priority
		}
		return out[i].Code < out[j].Code
	})
	return out
}

func ceilDiv(a, b int64) int64 {
	if b <= 0 || a <= 0 {
		return 0
	}
	return (a + b - 1) / b
}

func ceilTo(v, step int64) int64 {
	if v <= 0 {
		return 0
	}
	return ceilDiv(v, step) * step
}

// roundHalfUp 计算 num/den 并四舍五入（纯整型，避免浮点误差）。
func roundHalfUp(num, den int64) int64 {
	if den <= 0 {
		return 0
	}
	if num < 0 {
		return -roundHalfUp(-num, den)
	}
	return (num + den/2) / den
}

// RoundHalfUpInt 暴露给仓储层做单件平均等派生计算。
func RoundHalfUpInt(num, den int64) int64 { return roundHalfUp(num, den) }
