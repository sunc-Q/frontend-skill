package repository

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

// Seed 在库为空时灌入一整套自洽的业务数据。
//
// 关键约束：**逐夜价格由 domain.BuildQuote 计算，与线上试算/下单走同一个函数**，
// 种子绝不自己算第二遍价（否则统计口径与接口口径必然漂移）。
// 冲突判定用"已播种入住"的完整台账（不看状态），因此历史里不可能出现同房型同房晚的鬼故事重叠。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	var n int64
	if err := r.db.WithContext(ctx).Model(&domain.Booking{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	today := domain.DateStr(now.Local())
	rng := rand.New(rand.NewSource(20260926))

	props := seedProperties()
	rooms := seedRooms()
	caldays := seedRates(today)

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&props).Error; err != nil {
			return fmt.Errorf("播种门店失败: %w", err)
		}
		if err := tx.Create(&rooms).Error; err != nil {
			return fmt.Errorf("播种房型失败: %w", err)
		}
		if err := tx.Create(&caldays).Error; err != nil {
			return fmt.Errorf("播种日历失败: %w", err)
		}
		cal := map[string]domain.RateDay{}
		for _, x := range caldays {
			cal[x.Scope+"|"+x.RefCode+"|"+x.Date] = x
		}
		propBy := map[string]domain.Property{}
		for _, p := range props {
			propBy[p.Code] = p
		}
		return seedBookings(ctx, tx, rng, today, rooms, propBy, cal)
	})
	return err
}

// seedProperties 是四家门店：入住/退房时间、清洁缓冲与周末连住政策各不相同，
// 这样同一条规则在四家门店的判定结果才有对比意义。
func seedProperties() []domain.Property {
	return []domain.Property{
		{Code: "MH-LG", Name: "云栖山舍·揽谷", Region: "莫干山·庾村", Intro: "竹林坡地上的三栋老宅改造，主打大落地窗与山谷晨雾",
			CheckInAt: "15:00", CheckOutAt: "12:00", CleanBufferDays: 1, MinStayWeekend: 2, Rating: 4872},
		{Code: "MH-XJ", Name: "云栖山舍·溪界", Region: "莫干山·劳岭", Intro: "临溪独栋，带戏水浅滩与户外汤池，夏季满房率高",
			CheckInAt: "15:00", CheckOutAt: "11:30", CleanBufferDays: 1, MinStayWeekend: 2, Rating: 4795},
		{Code: "MH-GS", Name: "云栖山舍·观星", Region: "松阳·陈家寨", Intro: "海拔 780 米的石屋聚落，光污染低，观星主题",
			CheckInAt: "14:30", CheckOutAt: "12:00", CleanBufferDays: 2, MinStayWeekend: 2, Rating: 4918},
		{Code: "MH-HG", Name: "云栖山舍·湖光", Region: "千岛湖·界首", Intro: "面湖两层民宿，含皮划艇与环湖骑行，亲子客群为主",
			CheckInAt: "15:00", CheckOutAt: "12:00", CleanBufferDays: 1, MinStayWeekend: 1, Rating: 4660},
	}
}

// seedRooms 是房型台账。Units 刻意做成 1~4 的分布：1 间的房型用来制造"满房"格子。
func seedRooms() []domain.RoomType {
	return []domain.RoomType{
		{Code: "LG-DELUXE", PropertyCode: "MH-LG", Name: "竹景大床房", Beds: "1.8m 大床 ×1", Capacity: 2, Units: 4,
			BasePriceCents: 88000, WeekendPct: 25, HolidayPct: 55, CleanFeeCents: 12000, Breakfast: true,
			Scene: "竹林·山景", Amenities: "地暖,投影,浴缸,露台", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 1},
		{Code: "LG-SUITE", PropertyCode: "MH-LG", Name: "揽谷套房", Beds: "1.8m 大床 ×1 + 1.2m 沙发床 ×1", Capacity: 3, Units: 2,
			BasePriceCents: 148000, WeekendPct: 20, HolidayPct: 50, CleanFeeCents: 16000, Breakfast: true,
			Scene: "山谷全景·转角窗", Amenities: "地暖,投影,浴缸,壁炉,露台", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 2},
		{Code: "LG-FAMILY", PropertyCode: "MH-LG", Name: "亲子双床房", Beds: "1.2m 双床 ×2", Capacity: 4, Units: 3,
			BasePriceCents: 108000, WeekendPct: 30, HolidayPct: 60, CleanFeeCents: 14000, Breakfast: true,
			Scene: "竹林·儿童区", Amenities: "帐篷,绘本,浴盆,温奶器", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 3},
		{Code: "LG-TREE", PropertyCode: "MH-LG", Name: "树屋·独栋", Beds: "1.8m 大床 ×1 + 阁楼榻榻米", Capacity: 3, Units: 1,
			BasePriceCents: 198000, WeekendPct: 25, HolidayPct: 60, CleanFeeCents: 20000, Breakfast: true,
			Scene: "树冠层·独栋", Amenities: "天窗观星,浴缸,小厨房", Status: domain.RoomActive, MinStayDefault: 2, SortOrder: 4},

		{Code: "XJ-CREEK", PropertyCode: "MH-XJ", Name: "听溪大床房", Beds: "1.8m 大床 ×1", Capacity: 2, Units: 4,
			BasePriceCents: 78000, WeekendPct: 28, HolidayPct: 58, CleanFeeCents: 11000, Breakfast: true,
			Scene: "临溪·水声", Amenities: "地暖,投影,阳台", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 5},
		{Code: "XJ-POOL", PropertyCode: "MH-XJ", Name: "汤池独栋", Beds: "2m 大床 ×1 + 1.2m 双床 ×1", Capacity: 4, Units: 2,
			BasePriceCents: 168000, WeekendPct: 25, HolidayPct: 65, CleanFeeCents: 18000, Breakfast: true,
			Scene: "独栋·私汤", Amenities: "户外汤池,烧烤炉,小院", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 6},
		{Code: "XJ-TWIN", PropertyCode: "MH-XJ", Name: "溪畔双床房", Beds: "1.2m 双床 ×2", Capacity: 3, Units: 3,
			BasePriceCents: 88000, WeekendPct: 28, HolidayPct: 55, CleanFeeCents: 12000, Breakfast: false,
			Scene: "临溪·山景", Amenities: "地暖,投影,阳台", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 7},

		{Code: "GS-STARGAZE", PropertyCode: "MH-GS", Name: "观星石屋", Beds: "1.8m 大床 ×1 + 阁楼地台", Capacity: 3, Units: 3,
			BasePriceCents: 118000, WeekendPct: 30, HolidayPct: 60, CleanFeeCents: 15000, Breakfast: true,
			Scene: "崖边·星空", Amenities: "电动星空顶,望远镜,火塘", Status: domain.RoomActive, MinStayDefault: 2, SortOrder: 8},
		{Code: "GS-CLIFF", PropertyCode: "MH-GS", Name: "悬崖独栋", Beds: "2m 大床 ×1", Capacity: 2, Units: 1,
			BasePriceCents: 238000, WeekendPct: 22, HolidayPct: 55, CleanFeeCents: 24000, Breakfast: true,
			Scene: "崖边·独栋·无边泡池", Amenities: "无边泡池,壁炉,私厨早餐", Status: domain.RoomActive, MinStayDefault: 2, SortOrder: 9},
		{Code: "GS-TERRACE", PropertyCode: "MH-GS", Name: "层台地景房", Beds: "1.5m 大床 ×1 + 1.2m 双床 ×1", Capacity: 4, Units: 2,
			BasePriceCents: 98000, WeekendPct: 30, HolidayPct: 58, CleanFeeCents: 13000, Breakfast: false,
			Scene: "台地·梯田景", Amenities: "地暖,投影,大露台", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 10},

		{Code: "HG-LAKE", PropertyCode: "MH-HG", Name: "湖景大床房", Beds: "1.8m 大床 ×1", Capacity: 2, Units: 5,
			BasePriceCents: 68000, WeekendPct: 35, HolidayPct: 62, CleanFeeCents: 10000, Breakfast: true,
			Scene: "面湖·一线湖景", Amenities: "飘窗,投影,阳台", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 11},
		{Code: "HG-KAYAK", PropertyCode: "MH-HG", Name: "皮划艇亲子房", Beds: "1.8m 大床 ×1 + 1.2m 上下铺", Capacity: 4, Units: 3,
			BasePriceCents: 118000, WeekendPct: 32, HolidayPct: 60, CleanFeeCents: 15000, Breakfast: true,
			Scene: "面湖·含皮划艇", Amenities: "皮划艇 2 次,儿童帐篷,浴袍", Status: domain.RoomActive, MinStayDefault: 1, SortOrder: 12},
		{Code: "HG-LOFT", PropertyCode: "MH-HG", Name: "整栋湖景小楼", Beds: "1.8m 大床 ×2 + 1.2m 双床 ×2", Capacity: 8, Units: 1,
			BasePriceCents: 268000, WeekendPct: 18, HolidayPct: 45, CleanFeeCents: 28000, Breakfast: true,
			Scene: "整栋·包场", Amenities: "私厨,桌游,烧烤,含 6 份早餐", Status: domain.RoomActive, MinStayDefault: 2, SortOrder: 13},
		{Code: "LG-OLD", PropertyCode: "MH-LG", Name: "旧仓库改造房（整修中）", Beds: "1.8m 大床 ×1", Capacity: 2, Units: 2,
			BasePriceCents: 0, WeekendPct: 0, HolidayPct: 0, CleanFeeCents: 0, Breakfast: false,
			Scene: "暂缓出售", Amenities: "2026 年整体改造", Status: domain.RoomInactive, MinStayDefault: 1, SortOrder: 14},
	}
}

// seedRates 造日历覆盖项：绝对日期的节假日（中秋/国庆/元旦）+ 相对今天的包场与特价，
// 保证无论哪一天跑，未来窗口里一定同时存在 平日/周末/节假日/停售/特价 五类格子。
func seedRates(today string) []domain.RateDay {
	out := []domain.RateDay{
		{Date: "2026-09-25", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 50, Label: "中秋假期"},
		{Date: "2026-09-26", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 50, Label: "中秋假期"},
		{Date: "2026-09-27", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 50, Label: "中秋假期"},
		{Date: "2026-10-01", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 68, Label: "国庆假期"},
		{Date: "2026-10-02", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 68, Label: "国庆假期"},
		{Date: "2026-10-03", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 68, Label: "国庆假期"},
		{Date: "2026-10-04", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 68, Label: "国庆假期"},
		{Date: "2026-10-05", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 60, Label: "国庆假期"},
		{Date: "2026-10-06", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 60, Label: "国庆假期"},
		{Date: "2026-10-07", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 55, Label: "国庆假期"},
		{Date: "2026-12-31", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 90, Label: "跨年夜"},
		{Date: "2027-01-01", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 80, Label: "元旦"},
		{Date: "2027-01-02", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 60, Label: "元旦"},
		{Date: "2027-01-03", Scope: domain.ScopeGlobal, Kind: domain.KindHoliday, HolidayPct: 45, Label: "元旦"},
	}
	// 相对今天的事件：让任何一天跑都能在看板上看到停售与特价。
	out = append(out,
		domain.RateDay{Date: domain.AddDays(today, 9), Scope: domain.ScopeProperty, RefCode: "MH-XJ",
			Kind: domain.KindClosed, Label: "整院包场·企业团建"},
		domain.RateDay{Date: domain.AddDays(today, 10), Scope: domain.ScopeProperty, RefCode: "MH-XJ",
			Kind: domain.KindClosed, Label: "整院包场·企业团建"},
		domain.RateDay{Date: domain.AddDays(today, 6), Scope: domain.ScopeRoom, RefCode: "HG-LAKE",
			Kind: domain.KindPromo, PriceCents: 52000, Label: "平日限时立减"},
		domain.RateDay{Date: domain.AddDays(today, 7), Scope: domain.ScopeRoom, RefCode: "HG-LAKE",
			Kind: domain.KindPromo, PriceCents: 52000, Label: "平日限时立减"},
		domain.RateDay{Date: domain.AddDays(today, 16), Scope: domain.ScopeRoom, RefCode: "GS-STARGAZE",
			Kind: domain.KindClosed, Label: "星空顶检修"},
		domain.RateDay{Date: domain.AddDays(today, 17), Scope: domain.ScopeRoom, RefCode: "GS-STARGAZE",
			Kind: domain.KindClosed, Label: "星空顶检修"},
		domain.RateDay{Date: domain.AddDays(today, 21), Scope: domain.ScopeRoom, RefCode: "LG-TREE",
			Kind: domain.KindPromo, PriceCents: 168000, Label: "树屋开放日"},
	)
	return out
}

// ---------- 订单播种 ----------

var guestNames = []string{
	"陈嘉禾", "林知远", "周慕云", "徐清和", "沈砚舟", "赵岩", "孙半夏", "钱与白",
	"吴晚舟", "郑清越", "王一汀", "冯落梅", "褚云礼", "卫斯理", "蒋书南", "沈聿",
	"韩念一", "杨渡", "朱允", "秦松月", "尤立", "许诺", "何晏", "吕青禾",
	"施南野", "张见川", "孔维桢", "曹休", "严笑", "华灼", "金叙", "魏野",
}

var notePool = []string{
	"", "", "", "带两只柯基，需要可养宠的院子", "蜜月出行，希望准备香槟", "周一远程办公，需要稳定网络",
	"老人同行，尽量低楼层", "预计 21:00 后到店", "需要加一张婴儿床", "公司团建，需开具专票",
	"想要观星天气好的房间", "素食早餐 2 份", "周年纪念日，麻烦布置", "",
}

type roomRef struct {
	rt   domain.RoomType
	prop domain.Property
}

// seedBookings 按时间顺序尝试候选入住，只有 domain.BuildQuote 判定通过才落库。
// 这样种子数据天然满足"库存不超卖、缓冲不破例、停售日不成交"三条硬约束。
func seedBookings(ctx context.Context, tx *gorm.DB, rng *rand.Rand, today string,
	rooms []domain.RoomType, propBy map[string]domain.Property, cal map[string]domain.RateDay) error {

	refs := make([]roomRef, 0, len(rooms))
	for _, rt := range rooms {
		p, ok := propBy[rt.PropertyCode]
		if !ok {
			continue
		}
		refs = append(refs, roomRef{rt: rt, prop: p})
	}
	var ledger []domain.Stay
	seq := 0
	created := 0
	attempts := 0
	rejected := 0

	// try 与线上共用 domain.BuildQuote，只把「今天」平移到入住日：
	// 种子要造历史订单，而判定里的时间门写的是"入住日不能早于今天"，
	// 传 checkIn 当 today 等于让引擎回到当初下单那一刻的视角，其余规则一字不改。
	try := func(ref roomRef, checkIn string, nights, units, guests int, channel string) error {
		attempts++
		checkOut := domain.AddDays(checkIn, nights)
		q := domain.BuildQuote(ref.rt, ref.prop, cal, domain.QuoteInput{
			CheckIn: checkIn, CheckOut: checkOut, Units: units, Guests: guests,
		}, checkIn, ledger)
		if !q.Ok {
			rejected++
			return nil
		}
		seq++
		guest := guestNames[(seq*7)%len(guestNames)]
		phone := fmt.Sprintf("138%08d", 26000000+seq*137)
		status, refund := seedStatus(rng, today, checkIn, checkOut, q)
		createdDate := domain.AddDays(checkIn, -(2 + seq%11))
		code := fmt.Sprintf("HS%s-%03d", strings.ReplaceAll(createdDate, "-", ""), seq)
		b := &domain.Booking{
			Code: code, RoomCode: ref.rt.Code, PropertyCode: ref.rt.PropertyCode,
			GuestName: guest, Phone: phone, CheckIn: checkIn, CheckOut: checkOut,
			Units: units, Guests: guests, Channel: channel, Status: status,
			NightSubtotalCents: q.NightSubtotal, CleanFeeCents: q.CleanFeeCents, TotalCents: q.TotalCents,
			RefundCents: refund, Nights: q.Nights, AvgNightPriceCents: q.AvgNightCents,
			Note:      notePool[seq%len(notePool)],
			CreatedAt: domain.MustDate(createdDate).Add(time.Duration(9+rng.Intn(12)) * time.Hour),
			UpdatedAt: domain.MustDate(createdDate).Add(time.Duration(36+rng.Intn(48)) * time.Hour),
		}
		nightRows := make([]domain.BookingNight, 0, len(q.NightsDetail))
		for _, n := range q.NightsDetail {
			nightRows = append(nightRows, domain.BookingNight{
				Date: n.Date, Kind: n.Kind, Label: n.Label, PriceCents: n.PriceCents,
				Units: n.Units, AmountCents: n.AmountCents,
			})
		}
		if err := tx.Create(b).Error; err != nil {
			return fmt.Errorf("播种订单失败: %w", err)
		}
		for i := range nightRows {
			nightRows[i].BookingID = b.ID
			nightRows[i].BookingCode = b.Code
		}
		if err := tx.Create(&nightRows).Error; err != nil {
			return fmt.Errorf("播种逐夜明细失败: %w", err)
		}
		ledger = append(ledger, domain.Stay{
			Code: b.Code, RoomCode: b.RoomCode, CheckIn: b.CheckIn, CheckOut: b.CheckOut, Units: b.Units, Status: b.Status,
		})
		created++
		return nil
	}

	channels := domain.Channels()

	// 1) 历史：过去 45 天，每天 2~4 笔，入住日在 [今天-45, 今天-1]
	for i := 45; i >= 1; i-- {
		checkIn := domain.AddDays(today, -i)
		n := 5 + rng.Intn(5)
		if domain.IsWeekendNight(checkIn) {
			n += 4 // 周末是民宿的主战场，密度必须刻意拉高，否则日历全是空房
		}
		for k := 0; k < n; k++ {
			ref := refs[rng.Intn(len(refs))]
			if ref.rt.Status != domain.RoomActive {
				continue
			}
			nights := 1 + rng.Intn(3)
			units := 1
			if rng.Intn(6) == 0 && ref.rt.Units >= 2 {
				units = 2
			}
			guests := 1 + rng.Intn(ref.rt.Capacity*units)
			if err := try(ref, checkIn, nights, units, guests, channels[(i*5+k)%len(channels)]); err != nil {
				return err
			}
		}
	}

	// 2) 今天在店：让"今日到店/今日离店/在住"三个面板都有真实内容
	for _, p := range []struct {
		checkIn string
		nights  int
		refCode string
		channel string
	}{
		{checkIn: today, nights: 2, refCode: "LG-DELUXE", channel: domain.ChDirect},
		{checkIn: today, nights: 3, refCode: "XJ-CREEK", channel: domain.ChCtrip},
		{checkIn: domain.AddDays(today, -2), nights: 2, refCode: "HG-LAKE", channel: domain.ChMeituan},
		{checkIn: domain.AddDays(today, -1), nights: 1, refCode: "GS-STARGAZE", channel: domain.ChWalkIn},
		{checkIn: domain.AddDays(today, -3), nights: 3, refCode: "LG-FAMILY", channel: domain.ChAirbnb},
		{checkIn: domain.AddDays(today, -1), nights: 2, refCode: "XJ-POOL", channel: domain.ChDirect},
	} {
		ref := findRoom(refs, p.refCode)
		if ref == nil {
			continue
		}
		if err := try(*ref, p.checkIn, p.nights, 1, ref.rt.Capacity, p.channel); err != nil {
			return err
		}
	}

	// 3) 未来：接下来 30 天，每天 2~5 笔（旺季前置预订）
	for i := 0; i < 30; i++ {
		checkIn := domain.AddDays(today, i)
		n := 4 + rng.Intn(5)
		if domain.IsWeekendNight(checkIn) {
			n += 4
		}
		for k := 0; k < n; k++ {
			ref := refs[rng.Intn(len(refs))]
			if ref.rt.Status != domain.RoomActive {
				continue
			}
			nights := 1 + rng.Intn(3)
			if domain.IsWeekendNight(checkIn) && ref.prop.MinStayWeekend > nights {
				nights = ref.prop.MinStayWeekend
			}
			units := 1 + rng.Intn(2)
			if units > ref.rt.Units {
				units = ref.rt.Units
			}
			guests := 1 + rng.Intn(ref.rt.Capacity*units)
			ch := channels[(i*3+k)%len(channels)]
			if err := try(ref, checkIn, nights, units, guests, ch); err != nil {
				return err
			}
		}
	}

	// 4) 定向造满房：Units=1 的房型连订 3 晚，保证日历里出现 Available=0 的格子。
	//    （第 4 轮的教训：随机目标数全部低于容量 → 满房分支永远走不到）
	for _, code := range []string{"LG-TREE", "GS-CLIFF", "HG-LOFT"} {
		ref := findRoom(refs, code)
		if ref == nil {
			continue
		}
		done := 0
		for i := 11; i < 27 && done < 1; i++ {
			checkIn := domain.AddDays(today, i)
			before := created
			if err := try(*ref, checkIn, 3, 1, ref.rt.Capacity, domain.ChDirect); err != nil {
				return err
			}
			if created > before {
				done++
			}
		}
	}
	// 5) 定向造整院停售窗口前后的相邻单（验证缓冲与停售的边界表现）
	if ref := findRoom(refs, "XJ-CREEK"); ref != nil {
		for _, off := range []int{7, 12} {
			_ = try(*ref, domain.AddDays(today, off), 2, 1, 2, domain.ChReferrer)
		}
	}
	// 6) 定向造特价成交：促销日历没人订就等于没有"特价 ADR"这一格。
	//    促销日是运营方主动挂出来的，真实世界里必然带来订单，所以逐条兜一单。
	for _, rd := range cal {
		if rd.Scope != domain.ScopeRoom || rd.Kind != domain.KindPromo {
			continue
		}
		if ref := findRoom(refs, rd.RefCode); ref != nil {
			_ = try(*ref, rd.Date, 2, 1, ref.rt.Capacity, domain.ChMeituan)
		}
	}

	if created < 180 {
		return fmt.Errorf("播种订单过少（%d），种子分支覆盖失效", created)
	}
	var promoNights int64
	if err := tx.Model(&domain.BookingNight{}).Where("kind = ?", domain.KindPromo).
		Count(&promoNights).Error; err != nil {
		return err
	}
	if promoNights == 0 {
		return fmt.Errorf("种子没有任何特价成交，特价档价格分支未被覆盖")
	}
	return nil
}

func findRoom(refs []roomRef, code string) *roomRef {
	for i := range refs {
		if refs[i].rt.Code == code {
			return &refs[i]
		}
	}
	return nil
}

// seedStatus 按"入住/离店相对今天的位置"决定终态，并保证每种状态都出现。
func seedStatus(rng *rand.Rand, today, checkIn, checkOut string, q *domain.QuoteResult) (string, int64) {
	toIn := domain.DaysBetween(today, checkIn)
	toOut := domain.DaysBetween(today, checkOut)
	d := rng.Intn(100)
	switch {
	case toOut == 0: // 离店日就是今天：上午还在店里，面板要能看到"今日退房"
		switch {
		case d < 78:
			return domain.StCheckedIn, 0
		case d < 90:
			return domain.StConfirmed, 0
		default:
			return domain.StNoShow, 0
		}
	case toOut < 0: // 已离店
		switch {
		case d < 84:
			return domain.StCheckedOut, 0
		case d < 94:
			return domain.StCancelled, refundNow(q, today, checkIn)
		default:
			return domain.StNoShow, 0
		}
	case toIn <= 0: // 在住
		switch {
		case d < 80:
			return domain.StCheckedIn, 0
		case d < 92:
			return domain.StNoShow, 0
		default:
			return domain.StCancelled, refundNow(q, today, checkIn)
		}
	case toIn <= 4: // 临近入住
		switch {
		case d < 58:
			return domain.StConfirmed, 0
		case d < 84:
			return domain.StPending, 0
		default:
			return domain.StCancelled, refundNow(q, today, checkIn)
		}
	default: // 远期
		switch {
		case d < 62:
			return domain.StConfirmed, 0
		case d < 88:
			return domain.StPending, 0
		default:
			return domain.StCancelled, refundNow(q, today, checkIn)
		}
	}
}

func refundNow(q *domain.QuoteResult, today, checkIn string) int64 {
	b := &domain.Booking{CheckIn: checkIn, Status: domain.StConfirmed, TotalCents: q.TotalCents, CleanFeeCents: q.CleanFeeCents}
	ref, _ := domain.RefundFor(b, today)
	return ref
}
