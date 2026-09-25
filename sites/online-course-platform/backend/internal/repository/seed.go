package repository

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"bizsite/internal/domain"
)

// Seed 生成一个自洽的「学阶公开课」数据集：6 位讲师、16 门课（13 在售 / 2 草稿 / 1 已下线）、
// 每课 4-8 章、约 120 条报名（含满座候补、老学员折扣、自动结课样本）。
// 使用固定种子 20260925，重复执行结果一致；价格与折扣的口径和 service 完全相同。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	has, err := r.HasData(ctx)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260925))
	day := now.UTC().Truncate(24 * time.Hour)

	instructors := []domain.Instructor{
		{Name: "沈砚秋", Title: "首席讲师", Org: "前云图数据平台负责人", Bio: "十二年数据仓库与实时计算经验，带过三个从零到一的数据团队。", JoinedAt: day.AddDate(-3, 0, 0)},
		{Name: "顾聿", Title: "特邀讲师", Org: "拾光设计工作室主理人", Bio: "服务过四十余个品牌焕新项目，擅长把设计系统讲成工程语言。", JoinedAt: day.AddDate(-2, 0, 0)},
		{Name: "白鹿汀", Title: "首席讲师", Org: "机器学习方向博士", Bio: "研究方向为时序预测与异常检测，两篇 KDD 一作。", JoinedAt: day.AddDate(-2, -4, 0)},
		{Name: "韩朔", Title: "实战导师", Org: "独立开发者", Bio: "上线过六款盈利独立产品，专注一个人也能跑得动的工程实践。", JoinedAt: day.AddDate(-1, 0, 0)},
		{Name: "温叙白", Title: "特邀讲师", Org: "某头部券商前产品总监", Bio: "从 0 搭建过千万级用户的财富管理产品线。", JoinedAt: day.AddDate(-1, -2, 0)},
		{Name: "卢星野", Title: "实战导师", Org: "安全咨询顾问", Bio: "攻防演练红队常客，讲安全只讲打穿过的和补上的。", JoinedAt: day.AddDate(-1, -5, 0)},
	}
	for i := range instructors {
		if err := r.db.WithContext(ctx).Create(&instructors[i]).Error; err != nil {
			return fmt.Errorf("写入讲师失败: %w", err)
		}
	}

	type courseSpec struct {
		code, title, domain, level, summary string
		instr                               int
		price, early                        int64
		cap, hours                          int
		status                              string
		earlyOffsetDays                     int // 早鸟截止 = day + N（N<0 即已截止）
	}
	specs := []courseSpec{
		{"DS-101", "数据思维入门：从报表到决策", "数据分析", "入门", "不写代码也能听懂的数据方法论，用 20 个真实报表案例讲清「先问对问题再看数」。", 0, 19900, 14900, 60, 12, domain.CoursePublished, 9},
		{"DS-240", "SQL 进阶与查询调优", "数据分析", "进阶", "从执行计划到窗口函数，把「能跑」的 SQL 改写成「跑得快」的 SQL。", 0, 29900, 24900, 45, 18, domain.CoursePublished, -14},
		{"DS-360", "实时数仓实战：Flink 流水线", "数据分析", "高级", "端到端搭建一条分钟级到秒级的实时链路，含踩坑清单与容量估算。", 0, 59900, 49900, 25, 26, domain.CoursePublished, 3},
		{"AI-110", "机器学习直觉课：模型在学什么", "人工智能", "入门", "只用图形与比喻讲清偏差方差、梯度下降与过拟合，课前无需数学。", 2, 24900, 19900, 80, 14, domain.CoursePublished, 21},
		{"AI-250", "时序预测与异常检测", "人工智能", "进阶", "从 ARIMA 到 Transformer 的取舍，配一套可复用的监控基线代码。", 2, 39900, 33900, 40, 20, domain.CoursePublished, -7},
		{"AI-380", "大模型应用工程：RAG 落地", "人工智能", "高级", "检索增强生成的全链路：切分、召回、重排、评测与成本控制。", 2, 69900, 59900, 30, 24, domain.CoursePublished, 5},
		{"FE-120", "现代前端基础三件套实战", "前端开发", "入门", "HTML/CSS/JS 以三个可交付小项目驱动，结课即有三个在线作品。", 3, 19900, 15900, 70, 16, domain.CoursePublished, 12},
		{"FE-260", "React 状态管理与架构", "前端开发", "进阶", "从 useState 到状态外置的演进路线，讲清每一层抽象买到了什么。", 3, 34900, 28900, 50, 18, domain.CoursePublished, -2},
		{"FE-390", "前端性能与可观测性", "前端开发", "高级", "指标先行：把 LCP/INP 优化做成有曲线的工程，而不是玄学清单。", 3, 54900, 46900, 25, 20, domain.CoursePublished, 16},
		{"DV-210", "设计系统从规范到组件库", "视觉设计", "进阶", "Token、组件、文档三位一体，让设计与工程说同一套话。", 1, 32900, 26900, 45, 16, domain.CoursePublished, 7},
		{"DV-330", "品牌视觉工作坊：从策略到落地", "视觉设计", "高级", "带一个真实品牌走完焕新全流程，结课有可展示的案例初稿。", 1, 49900, 42900, 20, 22, domain.CoursePublished, -20},
		{"PM-130", "产品经理的第一课：需求从哪来", "产品管理", "入门", "访谈、数据与直觉的三角验证，附 12 份脱敏需求文档精读。", 4, 22900, 17900, 90, 12, domain.CoursePublished, 18},
		{"PM-270", "增长实验设计与数据复盘", "产品管理", "进阶", "从假设登记册到实验报告，让增长摆脱「拍脑袋 A/B」。", 4, 39900, 33900, 40, 18, domain.CoursePublished, -5},
		{"SEC-310", "Web 安全攻防实务（草稿）", "安全工程", "高级", "以 OWASP Top 10 为纲的攻防对照实验，正在录制与终审中。", 5, 59900, 52900, 30, 24, domain.CourseDraft, 30},
		{"SEC-220", "个人信息保护合规速览（草稿）", "安全工程", "入门", "合规红线与豁免场景清单化，正在补充最新细则案例。", 5, 15900, 12900, 60, 8, domain.CourseDraft, 45},
		{"DS-090", "Excel 透视表特训营（已下线）", "数据分析", "入门", "2025 年三期特训营，内容已并入 DS-101 并停止招生。", 0, 9900, 7900, 100, 6, domain.CourseArchived, -90},
	}

	courses := make([]domain.Course, 0, len(specs))
	for i, sp := range specs {
		c := domain.Course{
			Code: sp.code, Title: sp.title, Domain: sp.domain, Level: sp.level,
			InstructorID: instructors[sp.instr].ID,
			PriceCents:   sp.price, EarlyPriceCents: sp.early,
			Capacity: sp.cap, Hours: sp.hours, Status: sp.status, Summary: sp.summary,
			CreatedAt: day.AddDate(0, -8, 0),
		}
		if sp.status != domain.CourseDraft {
			d := day.AddDate(0, -6+i, 0)
			c.PublishedAt = &d
		}
		deadline := day.AddDate(0, 0, sp.earlyOffsetDays)
		c.EarlyDeadline = &deadline
		if err := r.db.WithContext(ctx).Create(&c).Error; err != nil {
			return fmt.Errorf("写入课程失败: %w", err)
		}
		courses = append(courses, c)
	}

	chapterPools := map[string][]string{
		"数据分析": {"数据从哪来：埋点与业务库", "口径对齐：同名不同义", "窗口函数实战", "执行计划怎么读", "分层建模：从贴源到集市", "实时与离线的边界", "指标体系设计", "数据质量监控"},
		"人工智能": {"一个模型的一生", "特征工程的手艺", "梯度下降的几何", "过拟合与正则化", "评估指标的陷阱", "序列模型专论", "异常检测基线", "服务化与监控"},
		"前端开发": {"语义化结构与可访问性", "布局演进：文档流到网格", "状态的最小表达", "组件边界与复用", "数据获取与缓存", "渲染性能剖析", "测试策略分层", "构建产物与体积"},
		"视觉设计": {"视觉层级与信息密度", "网格与基线", "色彩系统与对比度", "字体排印基础", "组件文档怎么写", "设计评审的流程", "品牌策略拆解", "落地与验收"},
		"产品管理": {"需求访谈的正确姿势", "机会树与优先级", "原型与验证成本", "实验设计入门", "指标选型", "复盘的结构", "路线图沟通", "跨团队协作"},
		"安全工程": {"威胁建模第一步", "注入与转义", "认证与会话", "最小权限实践", "日志与取证线索", "合规红线清单", "攻防演练复盘", "修复的优先级"},
	}
	for _, c := range courses {
		pool := chapterPools[c.Domain]
		n := 4 + rnd.Intn(len(pool)-3)
		used := rnd.Perm(len(pool))[:n]
		var totalMin int
		for si, idx := range used {
			dur := 25 + rnd.Intn(40)
			totalMin += dur
			ch := domain.Chapter{
				CourseID: c.ID, Seq: si + 1,
				Title:       fmt.Sprintf("%02d %s", si+1, pool[idx]),
				DurationMin: dur, FreePreview: si == 0,
			}
			if err := r.db.WithContext(ctx).Create(&ch).Error; err != nil {
				return fmt.Errorf("写入章节失败: %w", err)
			}
		}
		hours := totalMin / 60
		if hours != c.Hours {
			if err := r.db.WithContext(ctx).Model(&domain.Course{}).Where("id = ?", c.ID).
				Update("hours", hours).Error; err != nil {
				return fmt.Errorf("回写课时失败: %w", err)
			}
			c.Hours = hours
		}
	}

	// 报名：以在售课程为对象，前 6 门课刻意做成满座以产生候补样本。
	learnerNames := []string{"赵岩", "钱思远", "孙念卿", "李云帆", "周至", "吴桐雨", "郑维桢", "王砚之", "冯焦", "陈慕青",
		"褚立仁", "卫英哲", "蒋迟", "沈知微", "韩牧", "杨照", "朱允", "秦朗", "尤溪", "许岑",
		"何晏", "吕青禾", "施南", "张若澜", "孔翔", "曹沐", "严整", "华一诺", "金叙", "魏风",
		"陶然", "姜晚", "戚凌", "邹牧之", "喻宸", "柏舟", "窦清", "章未", "苏见山", "潘静翕"}
	sources := []string{"official", "official", "official", "referral", "campus", "ad"}

	// 20% 的报名来自「老学员」手机号池，触发 95 折。
	repeatPool := make([]string, 0, 12)
	for i := 0; i < 12; i++ {
		repeatPool = append(repeatPool, fmt.Sprintf("138%08d", 20260001+i))
	}
	phoneSeq := int64(0)
	nextPhone := func() string {
		phoneSeq++
		return fmt.Sprintf("139%08d", 20261000+phoneSeq)
	}
	seen := map[string]map[int64]bool{} // phone -> courseIDs
	paidCount := map[string]int64{}     // 已生效报名数，决定老学员折扣

	sellable := make([]domain.Course, 0, len(courses))
	for _, c := range courses {
		if c.Status == domain.CoursePublished {
			sellable = append(sellable, c)
		}
	}
	// 前 6 门在售课按「容量 + 上浮量」投放报名，确保出现满座与候补样本；
	// 其余课程按固定目标量投放。上浮 8 条用于对冲约 10% 的随机退课不占座。
	targets := make([]int, len(sellable))
	for i, c := range sellable {
		if i < 6 {
			targets[i] = c.Capacity + 15 // 上浮量对冲约 10% 随机退课不占座
		} else {
			targets[i] = 9 + (i*7)%23 // 16..31 之间的稳定曲线
		}
	}
	monthly := day.AddDate(0, -5, 0)

	for ci, c := range sellable {
		want := targets[ci%len(targets)]
		inserted := 0
		for attempt := 0; attempt < want*3 && inserted < want; attempt++ {
			phone := nextPhone()
			nameIdx := rnd.Intn(len(learnerNames))
			if rnd.Intn(100) < 20 && len(repeatPool) > 0 {
				phone = repeatPool[rnd.Intn(len(repeatPool))]
				nameIdx = nameIdx % 12
			}
			if seen[phone] == nil {
				seen[phone] = map[int64]bool{}
			}
			if seen[phone][c.ID] {
				continue
			}
			seen[phone][c.ID] = true

			enrolled := monthly.AddDate(0, rnd.Intn(5), rnd.Intn(26))
			if enrolled.After(day) {
				enrolled = day.AddDate(0, 0, -rnd.Intn(3))
			}
			list := effectivePriceAt(&c, enrolled)
			discount := int64(0)
			if paidCount[phone] >= 3 {
				discount = list * 5 / 100
			}
			e := domain.Enrollment{
				CourseID: c.ID, LearnerName: learnerNames[nameIdx], Phone: phone,
				Source: sources[rnd.Intn(len(sources))], EnrolledAt: enrolled,
				ListPrice: list, Discount: discount, PaidCents: list - discount,
				Status: domain.EnrollActive,
			}
			var occupied int64
			if err := r.db.WithContext(ctx).Model(&domain.Enrollment{}).
				Where("course_id = ? AND status IN ?", c.ID, []string{domain.EnrollActive, domain.EnrollCompleted}).
				Count(&occupied).Error; err != nil {
				return err
			}
			switch {
			case occupied >= int64(c.Capacity):
				e.Status = domain.EnrollWaitlist
				e.Discount = 0
				e.PaidCents = 0
			case rnd.Intn(100) < 10:
				e.Status = domain.EnrollDropped
				e.Discount = 0
				e.PaidCents = 0
			case rnd.Intn(100) < 34:
				e.Status = domain.EnrollCompleted
				e.ProgressPct = 100
			default:
				e.ProgressPct = rnd.Intn(95)
			}
			if e.Status == domain.EnrollActive || e.Status == domain.EnrollCompleted {
				paidCount[phone]++
			}
			if err := r.db.WithContext(ctx).Create(&e).Error; err != nil {
				return fmt.Errorf("写入报名失败: %w", err)
			}
			inserted++
		}
	}
	return nil
}

// effectivePriceAt 与 service 的定价规则一致：早鸟截止之前（含当日 23:59 UTC 前）用早鸟价。
func effectivePriceAt(c *domain.Course, at time.Time) int64 {
	if c.EarlyDeadline != nil && at.Before(c.EarlyDeadline.Add(24*time.Hour)) && c.EarlyPriceCents > 0 {
		return c.EarlyPriceCents
	}
	return c.PriceCents
}
