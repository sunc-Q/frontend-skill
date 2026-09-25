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

// 种子是确定性的：随机源固定为 20260925，同一份代码跑出来的卷面、名单、
// 分数分布与统计口径完全一致，README 里写的数字才是可复现的数字。
const seedSource = 20260925

type qspec struct {
	typ     string
	stem    string
	options []string
	answer  string
	score   int
	// hardness 只用于造数据：0=人人都对，1=几乎没人会。它不落库，
	// 落库的「难度」是事后从正确率算出来的 ItemStat.Difficulty。
	hardness float64
}

type paper struct {
	code     string
	title    string
	subject  string
	kind     string
	duration int
	pass     int
	status   string
	opensAgo time.Duration // 距「现在」开卷多久
	closesIn time.Duration // 距「现在」闭卷多久（负数=已闭卷）
	intro    string
	qs       []qspec
}

func opts(items ...string) string {
	return "[" + strings.Join(items, "|@|") + "]"
}

// 每份卷的题干与答案分严格加总为 100，由 TestSeedTotals 断言。
var papers = []paper{
	{
		code: "AS-2026-001", title: "前端工程能力摸底测评", subject: "前端工程", kind: domain.KindPlacement,
		duration: 45, pass: 60, status: domain.AsmtClosed, opensAgo: 24 * 24 * time.Hour, closesIn: -6 * 24 * time.Hour,
		intro: "面向新入职工程师的入职前摸底，覆盖组件、构建与浏览器基础。",
		qs: []qspec{
			{"single", "React 中用于在函数组件里保存可变实例数据的 Hook 是？", []string{"useState", "useRef", "useMemo", "useReducer"}, "B", 8, 0.28},
			{"single", "CSS 中让元素相对最近定位祖先绝对定位的 position 取值是？", []string{"static", "relative", "absolute", "sticky"}, "C", 8, 0.22},
			{"single", "HTTP 状态码 429 表示的含义是？", []string{"请求语法错误", "未授权", "请求过多需限流", "资源已永久删除"}, "C", 8, 0.52},
			{"single", "关于 key 的作用，下列说法正确的是？", []string{"用于帮助 Diff 判断节点身份", "可以省略以提高性能", "只在类组件生效", "必须使用随机数"}, "A", 8, 0.34},
			{"single", "Vite 开发服务器启动快的主要原因是？", []string{"编译全部模块后缓存", "基于浏览器原生 ESM 按需转换", "使用 Webpack 分包", "跳过 Tree Shaking"}, "B", 8, 0.61},
			{"single", "下面哪个选择器优先级最高？", []string{"#app .btn", ".card .btn", "div.btn", "#app button"}, "A", 8, 0.55},
			{"multi", "哪些手段能实际减少首屏 JS 体积？", []string{"路由级动态 import", "把依赖打包成单一大 chunk", "按用到与否剔除死代码", "用 CDN 预连接替代压缩"}, "ABC", 10, 0.66},
			{"multi", "关于浏览器跨域，说法正确的有？", []string{"预检请求方法是 OPTIONS", "Access-Control-Allow-Origin 为 null 时仍会带上凭证", "简单请求不会触发预检", "同源策略只校验域名"}, "AC", 10, 0.73},
			{"judge", "aria-label 的作用是给辅助技术提供可读名称。", []string{"正确", "错误"}, "T", 8, 0.3},
			{"judge", "在 SQL 里给列起别名之后，同一条 SELECT 的其它表达式可以直接引用该别名。", []string{"正确", "错误"}, "F", 12, 0.68},
			{"blank", "把十进制 255 写成十六进制字面量（形如 0x…）。", nil, "0xff", 12, 0.42},
		},
	},
	{
		code: "AS-2026-002", title: "数据结构与算法单元测", subject: "计算机基础", kind: domain.KindUnit,
		duration: 60, pass: 60, status: domain.AsmtClosed, opensAgo: 19 * 24 * time.Hour, closesIn: -3 * 24 * time.Hour,
		intro: "第 4 单元：线性表、树与复杂度分析。允许使用草稿纸。",
		qs: []qspec{
			{"single", "在长度为 n 的有序数组里做二分查找的最坏时间复杂度是？", []string{"O(1)", "O(log n)", "O(n)", "O(n log n)"}, "B", 8, 0.24},
			{"single", "队列与栈的根本差别在于？", []string{"存储介质不同", "队列先进先出、栈后进先出", "队列只能存整数", "栈需要两个指针"}, "B", 8, 0.18},
			{"single", "哈希表发生冲突时，链地址法的平均查找长度主要取决于？", []string{"数组长度", "装填因子", "哈希函数位宽", "是否排序"}, "B", 8, 0.58},
			{"single", "小顶堆弹出堆顶之后，恢复堆序的调整代价是？", []string{"O(log n)", "O(1)", "O(n)", "O(n log n)"}, "A", 8, 0.49},
			{"single", "下列排序中稳定的是？", []string{"快速排序", "堆排序", "归并排序", "选择排序"}, "C", 8, 0.44},
			{"single", "图的邻接矩阵存储 n 个顶点所需空间是？", []string{"O(n)", "O(n+e)", "O(n²)", "O(e)"}, "C", 8, 0.36},
			{"multi", "关于递归改迭代，正确的有？", []string{"显式栈可以替代调用栈", "尾递归在支持的语言里可优化为循环", "所有递归都能无损改写为 O(1) 空间", "改迭代后一定更快"}, "AB", 12, 0.63},
			{"multi", "哪些结构能高效支持「取前 k 大」？", []string{"大小为 k 的小顶堆", "快速选择", "全量排序后取前 k", "散列表"}, "AB", 12, 0.7},
			{"judge", "归并排序在最坏情况下的时间复杂度仍为 O(n log n)。", []string{"正确", "错误"}, "T", 8, 0.4},
			{"judge", "B+ 树的叶子节点之间不互相链接。", []string{"正确", "错误"}, "F", 8, 0.66},
			{"blank", "快排的平均时间复杂度记作 O(…)，请填写括号内的表达式。", nil, "nlogn", 12, 0.52},
		},
	},
	{
		code: "AS-2026-003", title: "数据库设计与 SQL 认证考试", subject: "数据工程", kind: domain.KindCert,
		duration: 90, pass: 72, status: domain.AsmtClosed, opensAgo: 14 * 24 * time.Hour, closesIn: -1 * 24 * time.Hour,
		intro: "对外认证卷，72 分及格。题目含真实线上库的口径陷阱。",
		qs: []qspec{
			{"single", "第三范式要求消除的是？", []string{"部分函数依赖", "传递函数依赖", "重复行", "长事务"}, "B", 8, 0.46},
			{"single", "SQLite 默认的事务日志模式是？", []string{"DELETE", "WAL", "MEMORY", "OFF"}, "A", 8, 0.71},
			{"single", "下列哪种写法最可能导致索引失效？", []string{"WHERE a = ? AND b = ?", "WHERE upper(name) = ?", "ORDER BY id", "LIMIT 100"}, "B", 8, 0.41},
			{"single", "「同一事务内重复读得到相同结果」对应的隔离级别至少是？", []string{"读未提交", "读已提交", "可重复读", "无隔离"}, "C", 8, 0.5},
			{"single", "统计空表行数时 COUNT(*) 与 SUM(x) 的差别是？", []string{"都返回 0", "COUNT 返回 0，SUM 返回 NULL", "都返回 NULL", "报错"}, "B", 8, 0.55},
			{"single", "建立覆盖索引的主要收益是？", []string{"减少回表读取", "缩小磁盘文件", "保证唯一性", "免去事务"}, "A", 8, 0.44},
			{"multi", "关于外键约束，正确的有？", []string{"需要显式开启才在 SQLite 中生效", "可配 ON DELETE CASCADE", "会自动为子表建索引", "能替代应用层校验所有业务规则"}, "ABC", 10, 0.6},
			{"multi", "哪些做法能有效防住 SQL 注入？", []string{"参数化查询", "对标识符走白名单映射", "把引号替换成两个引号", "存储过程内部仍做字符串拼接"}, "AB", 10, 0.48},
			{"judge", "在一条 SELECT 的表达式列表里可以直接引用同一层定义的列别名。", []string{"正确", "错误"}, "F", 10, 0.64},
			{"judge", "WAL 模式允许读操作与写操作并发进行。", []string{"正确", "错误"}, "T", 8, 0.38},
			{"blank", "连接池限制「同时打开的连接数」的方法名里包含的英文名词是？（提示：MaxOpenCon…）", nil, "conns", 6, 0.74},
			{"multi", "适合用部分唯一索引表达的是？", []string{"仅对未取消订单唯一", "仅对状态非 invalid 的记录唯一", "对全部行唯一", "对 JSON 字段整体唯一"}, "AB", 8, 0.67},
		},
	},
	{
		code: "AS-2026-004", title: "研发安全意识月度测评", subject: "安全合规", kind: domain.KindMock,
		duration: 30, pass: 60, status: domain.AsmtOpen, opensAgo: 6 * 24 * time.Hour, closesIn: 4 * 24 * time.Hour,
		intro: "全员必修，60 分及格，未通过者需在闭卷前重考。",
		qs: []qspec{
			{"single", "CSRF 防御的核心手段是？", []string{"前端隐藏表单字段", "校验一次性令牌与 SameSite Cookie", "提高密码长度", "关闭日志"}, "B", 8, 0.35},
			{"single", "把密钥写进前端构建产物会导致？", []string{"构建变慢", "密钥等同于公开", "接口超时", "数据库锁表"}, "B", 8, 0.2},
			{"single", "下列哪个响应头能限制页面可加载的资源来源？", []string{"X-Content-Type-Options", "Content-Security-Policy", "Referrer-Policy", "Cache-Control"}, "B", 8, 0.33},
			{"single", "关于 BCrypt 的说法正确的是？", []string{"是可逆加密", "自带盐且可调计算成本", "只能加密短文本", "等价于 SHA-1"}, "B", 8, 0.5},
			{"multi", "手机号对外展示时应当？", []string{"整体哈希", "中间四位打码", "序列化时排除原文字段", "放进 URL 查询参数"}, "BC", 12, 0.42},
			{"multi", "哪些属于日志里不能出现的敏感内容？", []string{"用户令牌", "请求耗时", "身份证号", "错误堆栈中的连接串"}, "ACD", 12, 0.37},
			{"judge", "内网服务之间调用无需鉴权，因为外部访问不到。", []string{"正确", "错误"}, "F", 10, 0.29},
			{"judge", "对分页参数设置上限可以缓解拖库式全表扫描。", []string{"正确", "错误"}, "T", 12, 0.44},
			{"blank", "OWASP Top 10 里「失效的访问控制」编号是？（形如 A0N）", nil, "a01", 12, 0.69},
			{"judge", "常量时间比较可以削弱令牌校验的时序侧信道。", []string{"正确", "错误"}, "T", 10, 0.58},
		},
	},
	{
		code: "AS-2026-005", title: "云端运维基础摸底测", subject: "运维交付", kind: domain.KindPlacement,
		duration: 45, pass: 55, status: domain.AsmtOpen, opensAgo: 3 * 24 * time.Hour, closesIn: 7 * 24 * time.Hour,
		intro: "面试候选人自助作答，55 分及以上进入复试。",
		qs: []qspec{
			{"single", "Linux 里查看端口占用进程最常用的命令组合是？", []string{"ls -l", "lsof -iTCP -sTCP:LISTEN", "du -sh", "top -b"}, "B", 10, 0.31},
			{"single", "进程退出码 137 通常意味着？", []string{"命令不存在", "被 SIGKILL 终止（常见于 OOM）", "权限不足", "文件未找到"}, "B", 10, 0.6},
			{"single", "让服务在 SSH 断开后继续运行的合理做法是？", []string{"加大超时", "systemd 或 nohup 托管", "关掉日志", "换端口"}, "B", 10, 0.27},
			{"single", "磁盘 80% 已用时最该先检查的是？", []string{"CPU 频率", "可清理的构建缓存与日志", "网卡速率", "DNS 配置"}, "B", 10, 0.33},
			{"multi", "哪些属于健康检查该覆盖的维度？", []string{"进程存活", "依赖的数据库可连", "关键接口能返回 2xx", "代码风格"}, "ABC", 12, 0.4},
			{"multi", "关于灰度发布，正确的有？", []string{"可按流量比例放量", "需要可回滚的部署单元", "可以替代测试", "需要观察指标"}, "ABD", 12, 0.52},
			{"judge", "容器里的 1 号进程不响应信号时，优雅关闭会失效。", []string{"正确", "错误"}, "T", 10, 0.56},
			{"judge", "备份只要定期做了就一定能恢复。", []string{"正确", "错误"}, "F", 10, 0.24},
			{"blank", "HTTP 健康检查接口最常用的路径是 /api/…？", nil, "health", 8, 0.3},
			{"single", "日志结构化（JSON 化）的主要价值是？", []string{"省磁盘", "便于检索与聚合", "提高响应速度", "避免重启"}, "B", 8, 0.35},
		},
	},
	{
		code: "AS-2026-006", title: "AI 应用开发入门结课测", subject: "智能应用", kind: domain.KindUnit,
		duration: 40, pass: 60, status: domain.AsmtDraft, opensAgo: -2 * 24 * time.Hour, closesIn: 12 * 24 * time.Hour,
		intro: "结课卷（尚未发布，等待教研组终审）。",
		qs: []qspec{
			{"single", "把检索到的文档片段拼进提示词的做法通常叫？", []string{"微调", "检索增强生成", "蒸馏", "量化"}, "B", 12, 0.4},
			{"single", "上下文窗口超限后最稳妥的处理是？", []string{"截断无关历史并按需检索", "把请求拆成并发重试", "提高温度", "忽略错误"}, "A", 12, 0.45},
			{"multi", "评测提示词质量时常用的指标有？", []string{"任务完成率", "首 token 延迟", "人工评分一致性", "代码行数"}, "ABC", 14, 0.6},
			{"multi", "哪些属于把模型输出直接落库前的必要处理？", []string{"结构校验", "越权内容过滤", "长度上限", "把密钥写进提示词"}, "ABC", 14, 0.38},
			{"judge", "温度参数为 0 时两次调用必然完全一致，因此无需评测。", []string{"正确", "错误"}, "F", 14, 0.5},
			{"blank", "把用户问题改写成更适合检索的多个查询的常见技术简称是？", nil, "mqe", 10, 0.78},
			{"single", "向量检索里余弦相似度越接近 1 表示两段文本？", []string{"语义越相近", "长度越接近", "出现频次越高", "无关"}, "A", 12, 0.25},
			{"single", "为控制成本，最常用的批量推理落地手段是？", []string{"把请求排队后离线批处理", "提高重试次数", "关闭缓存", "加长提示词"}, "A", 12, 0.47},
		},
	},
}

func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	var n int64
	if err := r.db.WithContext(ctx).Model(&domain.Assessment{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil // 已灌过，绝不覆盖真实运行数据
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return seedAll(tx, now)
	})
}

func seedAll(tx *gorm.DB, now time.Time) error {
	rng := rand.New(rand.NewSource(seedSource))

	for pi := range papers {
		p := papers[pi]
		total := 0
		for _, q := range p.qs {
			total += q.score
		}
		if total != 100 {
			return fmt.Errorf("种子试卷 %s 满分 %d，应为 100", p.code, total)
		}
		opensAt := now.Add(-p.opensAgo)
		closesAt := now.Add(p.closesIn)
		as := &domain.Assessment{
			Code: p.code, Title: p.title, Subject: p.subject, Kind: p.kind,
			DurationMin: p.duration, PassScore: p.pass, Status: p.status,
			OpensAt: opensAt.UTC(), ClosesAt: closesAt.UTC(), Intro: p.intro,
			CreatedAt: now.Add(-30 * 24 * time.Hour).UTC(),
		}
		if err := tx.Create(as).Error; err != nil {
			return fmt.Errorf("建试卷 %s 失败: %w", p.code, err)
		}
		qs := make([]domain.Question, 0, len(p.qs))
		for qi, spec := range p.qs {
			optJSON := "[]"
			if len(spec.options) > 0 {
				optJSON = opts(spec.options...)
			}
			qs = append(qs, domain.Question{
				AssessmentID: as.ID,
				Code:         fmt.Sprintf("%s-Q%02d", p.code, qi+1),
				OrderNo:      qi + 1,
				Type:         spec.typ,
				Stem:         spec.stem,
				Options:      optJSON,
				Answer:       spec.answer,
				Score:        spec.score,
			})
		}
		if err := tx.Create(&qs).Error; err != nil {
			return fmt.Errorf("建题目失败: %w", err)
		}
		if p.status == domain.AsmtDraft {
			continue // 草稿卷不产生作答
		}
		if err := seedAttempts(tx, rng, now, as, qs, p); err != nil {
			return err
		}
	}
	return nil
}

var surnames = []string{
	"赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈",
	"褚", "卫", "蒋", "沈", "韩", "杨", "朱", "秦", "尤", "许",
	"何", "吕", "施", "张", "孔", "曹", "严", "华", "金", "魏",
}

var givens = []string{
	"子墨", "一鸣", "思远", "雨桐", "浩然", "嘉怡", "睿轩", "欣怡", "泽宇", "明轩",
	"亦然", "书瑶", "涵予", "沛宁", "允之", "长宁", "青禾", "砚舟", "未迟", "知微",
	"砚青", "慕安", "斯年", "望舒", "照野", "疏影", "启铭", "越泽", "竹清", "牧遥",
}

// seedAttempts 用「考生能力 × 题目难度」的伯努利模型造作答流水，
// 判分一律复用 domain.GradeItem —— 保证种子里的分数与线上判分口径完全同源。
func seedAttempts(tx *gorm.DB, rng *rand.Rand, now time.Time, as *domain.Assessment, qs []domain.Question, p paper) error {
	targets := map[string]int{
		"AS-2026-001": 58, "AS-2026-002": 44, "AS-2026-003": 33,
		"AS-2026-004": 27, "AS-2026-005": 19,
	}
	goal, ok := targets[p.code]
	if !ok {
		return fmt.Errorf("没有为 %s 配置目标作答数", p.code)
	}
	usedPhones := map[string]bool{}
	daySpan := int(now.Sub(as.OpensAt).Hours() / 24)
	if daySpan < 1 {
		daySpan = 1
	}
	for i := 0; i < goal; i++ {
		ability := rng.NormFloat64()*0.17 + []float64{0.42, 0.55, 0.63, 0.71, 0.8}[i%5]
		if ability < 0.12 {
			ability = 0.12
		}
		if ability > 0.97 {
			ability = 0.97
		}
		name := surnames[rng.Intn(len(surnames))] + givens[rng.Intn(len(givens))]
		phone := uniquePhone(rng, usedPhones)
		started := as.OpensAt.Add(time.Duration(1+rng.Intn(daySpan*24)) * time.Hour).UTC()
		if started.After(now) {
			started = now.Add(-time.Duration(1+rng.Intn(9)) * time.Hour).UTC()
		}
		elapsed := as.DurationMin*60 - rng.Intn(as.DurationMin*30)
		if elapsed < 90 {
			elapsed = 90 + rng.Intn(120)
		}
		limit := as.DurationMin*60 + domain.AnswerGraceSec
		channel := []string{"web", "web", "campus", "partner"}[rng.Intn(4)]
		status := domain.AttemptGraded
		reason := ""
		// 每场留少量超时作废卷（开放场再留几条进行中）
		switch {
		case i%19 == 7:
			status = domain.AttemptInvalid
			reason = "超时未提交"
			elapsed = limit + 60 + rng.Intn(900)
		case p.status == domain.AsmtOpen && i%13 == 5:
			status = domain.AttemptOngoing
			reason = "作答中"
			elapsed = as.DurationMin*30 + rng.Intn(as.DurationMin*25)
		}

		at := &domain.Attempt{
			AttemptNo:     fmt.Sprintf("%s-A%03d", p.code, i+1),
			AssessmentID:  as.ID,
			CandidateName: name,
			Phone:         phone,
			Channel:       channel,
			StartedAt:     started,
			ElapsedSec:    elapsed,
			Status:        status,
			Reason:        reason,
		}
		if status == domain.AttemptOngoing {
			if err := tx.Create(at).Error; err != nil {
				return err
			}
			continue
		}
		sub := started.Add(time.Duration(elapsed) * time.Second)
		if sub.After(now) {
			sub = now.UTC()
		}
		at.SubmittedAt = &sub
		at.GradedAt = &sub

		if status == domain.AttemptInvalid {
			// 作废卷不入库判分明细：Score=0 且 Σ awarded=0，恒等式照样成立
			if err := tx.Create(at).Error; err != nil {
				return err
			}
			continue
		}

		mech, half, score := 0, 0, 0
		answers := make([]domain.AttemptAnswer, 0, len(qs))
		for qi := range qs {
			q := &qs[qi]
			picked := simulatePicked(rng, q, specAt(p.qs, qi), ability)
			awarded, correct := domain.GradeItem(q, picked)
			if correct {
				mech += awarded
			} else {
				half += awarded
			}
			score += awarded
			answers = append(answers, domain.AttemptAnswer{
				QuestionCode: q.Code, QuestionID: q.ID, Picked: picked,
				Correct: boolInt(correct), Awarded: awarded, MaxScore: q.Score,
			})
		}
		at.Score, at.Mechanical, at.HalfCredit = score, mech, half
		at.Passed = score >= as.PassScore
		if err := tx.Create(at).Error; err != nil {
			return err
		}
		for ai := range answers {
			answers[ai].AttemptID = at.ID
		}
		if err := tx.Create(&answers).Error; err != nil {
			return err
		}
	}
	return nil
}

func specAt(specs []qspec, i int) qspec {
	if i < len(specs) {
		return specs[i]
	}
	return qspec{typ: domain.TypeSingle, hardness: 0.5}
}

func boolInt(b bool) int {
	if b {
		return domain.CorrectYes
	}
	return domain.CorrectNo
}

// simulatePicked 按能力与难度决定对错；答错时给出「像人」的错误作答：
// 多选题有一半概率只漏选（制造半分样本），其余题型随机挑一个错误项。
func simulatePicked(rng *rand.Rand, q *domain.Question, spec qspec, ability float64) string {
	pCorrect := ability - spec.hardness*0.75 + 0.32
	if pCorrect > 0.97 {
		pCorrect = 0.97
	}
	if pCorrect < 0.03 {
		pCorrect = 0.03
	}
	if rng.Float64() < pCorrect {
		return q.Answer
	}
	if q.Type == domain.TypeMulti {
		answer := domain.NormalizePicked(q.Type, q.Answer)
		if rng.Float64() < 0.5 && len(answer) > 1 {
			return string([]rune(answer)[:len(answer)-1]) // 只漏选 -> 半分
		}
		return wrongLetters(answer, rng)
	}
	if q.Type == domain.TypeBlank {
		return "" // 填空题答错=留空或写错，这里按未答处理
	}
	return wrongLetter(q, rng)
}

func wrongLetter(q *domain.Question, rng *rand.Rand) string {
	if q.Type == domain.TypeJudge {
		if domain.NormalizePicked(q.Type, q.Answer) == "T" {
			return "F"
		}
		return "T"
	}
	n := len(q.OptionList())
	if n == 0 {
		n = 2
	}
	for attempt := 0; attempt < 8; attempt++ {
		c := string(rune('A' + rng.Intn(n)))
		if c != domain.NormalizePicked(q.Type, q.Answer) {
			return c
		}
	}
	return "Z"
}

func wrongLetters(answer string, rng *rand.Rand) string {
	var b strings.Builder
	for _, r := range "ABCD" {
		if strings.ContainsRune(answer, r) {
			continue
		}
		if rng.Float64() < 0.5 {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "D"
	}
	return domain.NormalizePicked(domain.TypeMulti, b.String())
}

func uniquePhone(rng *rand.Rand, used map[string]bool) string {
	for i := 0; i < 500; i++ {
		p := fmt.Sprintf("138%04d%04d", rng.Intn(10000), rng.Intn(10000))
		if !used[p] {
			used[p] = true
			return p
		}
	}
	return fmt.Sprintf("139%08d", rng.Intn(100_000_000))
}
