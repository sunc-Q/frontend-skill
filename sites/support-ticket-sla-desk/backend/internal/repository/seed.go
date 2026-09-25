package repository

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

// ---- 时间线段与静态字典 ----

// seg 是一条时间线段：work 计入 SLA 时效（bd 个工作分钟），
// pause 是按挂钟长度造的已完成挂起，pause_open 是直到「现在」仍在途的挂起。
type seg struct {
	kind string
	bd   int64
	wall int64
	msg  string
}

const (
	segWork      = "work"
	segPause     = "pause"
	segPauseOpen = "pause_open"
)

// ---- 静态字典（确定性，无随机） ----

var titlePool = map[string][]string{
	"网络与专线":  {"专线频繁丢包，交易下单超时", "分支办公室 VPN 反复掉线", "出口带宽夜间跑满导致备份失败", "跨机房访问延迟从 3ms 涨到 90ms", "BGP 邻居抖动，部分路由不可达"},
	"主机与虚拟化": {"生产应用节点无故重启", "虚拟化平台快照占用存储告急", "扩容节点后系统未识别新磁盘", "宿主机 CPU 就绪队列长期偏高"},
	"备份与恢复":  {"数据库全量备份连续三日未产出", "异地副本同步滞后超过 24 小时", "恢复演练校验和不一致"},
	"监控告警":   {"告警风暴：同一故障触发两百余条短信", "监控系统自身采集中断", "磁盘阈值告警未按静默规则收敛"},
	"应用故障":   {"结算页面提交后白屏", "对账文件生成任务卡在初始化", "移动端扫码接口返回 502", "报表导出超时，大表尤其明显", "消息推送延迟约十五分钟"},
	"使用咨询":   {"新同事开通子账号的操作指引", "接口限流规则与配额如何申请", "批量导入模板字段含义咨询"},
	"变更申请":   {"申请在维护窗口调整负载均衡算法", "升级应用运行环境到长期支持版本", "申请开放只读副本的连接白名单"},
	"数据库":    {"主库慢查询堆积导致连接池耗尽", "从库复制中断需人工补齐缺口", "索引变更后执行计划回退", "表空间增长异常需清理历史分区"},
	"账号与权限":  {"离职同事的运维账号未及时禁用", "堡垒机二次验证频繁失效", "临时提权审批流未生效"},
	"安全事件":   {"疑似撞库登录告警，来源集中在境外", "防护规则误伤正常业务请求", "发现过期证书仍在被调用"},
}

var descPool = []string{
	"客户侧已提供近三小时的应用日志与抓包文件，业务影响面为下单与结算链路。",
	"该问题上周出现过一次，客户运维要求给出根因而非重启处置。",
	"值班已初步排除公网因素，怀疑与客户内部交换机固件版本相关。",
	"客户生产环境不允许远程直连，需通过驻场代提方式操作并留痕。",
	"影响客户大促活动，客户要求两小时内给出阶段性结论。",
	"已同步告知客户可先切换到备用链路临时缓解。",
}

var agentPool = []struct {
	name, team, title, skills string
	cap                       int
}{
	{"沈亦舟", "基础设施组", "网络工程师", "BGP/OSPF·华为·H3C", 2400},
	{"柳承志", "基础设施组", "系统工程师", "Linux·KVM·块存储", 2400},
	{"扁晓菡", "基础设施组", "备份工程师", "备份软件·对象存储·演练", 1920},
	{"康宁", "应用支持组", "应用运维", "Java·Nginx·容器", 2400},
	{"裴守拙", "应用支持组", "应用运维", "前端·CDN·灰度发布", 1920},
	{"宗卿云", "应用支持组", "值班工程师", "工单分诊·一线处置", 2880},
	{"游景明", "数据与中间件组", "数据库工程师", "MySQL·PostgreSQL·主从", 2400},
	{"车语彤", "数据与中间件组", "中间件工程师", "消息队列·缓存", 1920},
	{"缪清和", "安全与合规组", "安全工程师", "防护规则·态势感知·应急响应", 2400},
	{"宿明轩", "安全与合规组", "身份治理工程师", "堡垒机·统一认证·审计", 1440},
	{"哈千羽", "平台值班组", "监控工程师", "指标采集·告警治理", 2400},
	{"全叙", "平台值班组", "夜班值班", "7×24 值守·升级处置", 2880},
}

var customerPool = []struct {
	name, industry string
}{
	{"汇金通支付", "支付清算"}, {"青麦科技", "工具软件"}, {"恒基置业", "不动产"}, {"南岭制药", "医药制造"},
	{"拾光传媒", "广告传媒"}, {"渤海冷链", "物流运输"}, {"星拱数据", "数据服务"}, {"川流能源", "能源"},
	{"木铎教育", "在线教育"}, {"天蚕纺织", "制造"}, {"瑞福堂连锁", "零售连锁"}, {"云栖医疗", "互联网医疗"},
	{"华锦证券", "证券"}, {"锐驰汽配", "汽车零件"}, {"牧禾食品", "食品"}, {"澄星半导体", "半导体"},
	{"同泰保险", "保险"}, {"泛舟旅游", "文旅"}, {"绿盟环保", "环保工程"}, {"锦鲤电商", "电商"},
	{"泽润水务", "公用事业"}, {"瀚盛钢铁", "钢铁"}, {"明烛照明", "制造"}, {"麦田农服", "农业科技"},
	{"凌川航空地服", "航空地服"}, {"安和地产", "不动产"}, {"白鹭出行", "出行平台"}, {"鼎铭建工", "建筑施工"},
	{"素问中医", "医疗"}, {"海钠新材", "新材料"}, {"雾松物流", "物流"}, {"长青游乐", "文娱"},
	{"汇通担保", "金融"}, {"沐野户外", "零售"}, {"锐声电子", "消费电子"}, {"泽兰生物", "生物医药"},
	{"途远租赁", "租赁服务"}, {"望舒照明", "制造"}, {"麦积文旅", "文旅"}, {"澄江港务", "港口物流"},
}

var surnames = []string{"赵", "钱", "孙", "李", "周", "吴", "郑", "王", "冯", "陈", "褚", "卫", "蒋", "沈", "韩", "杨"}

var teamAgents = map[string][]int{} // team → agentPool 下标

func init() {
	for i, a := range agentPool {
		teamAgents[a.team] = append(teamAgents[a.team], i)
	}
}

// ---- 时间与随机的小工具 ----

func minuteAlign(t time.Time) time.Time {
	l := t.In(domain.FieldTZ)
	return time.Date(l.Year(), l.Month(), l.Day(), l.Hour(), l.Minute(), 0, 0, domain.FieldTZ).UTC()
}

func dayStartField(t time.Time) time.Time {
	l := t.In(domain.FieldTZ)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, domain.FieldTZ)
}

func minutesBefore(now time.Time, m int64) time.Time {
	return minuteAlign(now.Add(-time.Duration(m) * time.Minute))
}

// createdForBusinessAge 反查「距今恰好 want 个工作分钟」的进单时刻。
// bm(created→now) 随 created 变早而单调不减，二分即可命中；
// 由于每分钟最多增加 1，命中点上的取值必然等于 want（非工作时段内的空隙保证相等）。
func createdForBusinessAge(now time.Time, want int64) time.Time {
	if want <= 0 {
		return minuteAlign(now)
	}
	lo, hi := int64(0), int64(180*24*60)
	for lo < hi {
		mid := (lo + hi) / 2
		if domain.BusinessMinutesBetween(minutesBefore(now, mid), now) >= want {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return minutesBefore(now, lo)
}

func pickSeverity(rnd *rand.Rand) string {
	switch x := rnd.Intn(100); {
	case x < 12:
		return domain.SevS1
	case x < 40:
		return domain.SevS2
	case x < 76:
		return domain.SevS3
	default:
		return domain.SevS4
	}
}

func pickCategory(rnd *rand.Rand) string {
	return domain.Categories[rnd.Intn(len(domain.Categories))]
}

func pickChannel(rnd *rand.Rand) string {
	switch x := rnd.Intn(100); {
	case x < 34:
		return "工单门户"
	case x < 52:
		return "电话"
	case x < 66:
		return "邮件"
	case x < 80:
		return "企业微信"
	case x < 92:
		return "监控告警"
	default:
		return "驻场代提"
	}
}

type builtTicket struct {
	t    domain.Ticket
	evs  []domain.TicketEvent
	open bool
}

// Seed 灌入一套口径自洽的服务台数据：整批写入在一个事务里，
// 结尾的分支覆盖自检任何一条不满足就直接回滚，
// 避免「造了很多数据却从没出现超时单」这类哑种子（第 4 轮的教训）。
func (r *Repo) Seed(ctx context.Context, now time.Time) error {
	var n int64
	if err := r.db.WithContext(ctx).Model(&domain.Ticket{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	rnd := rand.New(rand.NewSource(20260926))

	customers := buildCustomers(now, rnd)
	agents := buildAgents(now)
	policies := domain.DefaultPolicies()
	idx := map[string]*domain.SlaPolicy{}
	for i := range policies {
		idx[policies[i].Tier+"|"+policies[i].Severity] = &policies[i]
	}
	usedOpenTitle := map[string]bool{}
	daySeq := map[string]int{}
	built := make([]builtTicket, 0, 340)

	// 历史单：已结束（关单/已解决待验收/取消）
	for len(built) < 252 {
		c := &customers[rnd.Intn(len(customers))]
		age := int64(3*24*60) + int64(rnd.Intn(53*24*60))
		created := minuteAlign(now.Add(-time.Duration(age) * time.Minute))
		if rnd.Intn(10) < 3 { // 三成凌晨/下班后进单，考验「非工作时段不计时」
			created = minuteAlign(dayStartField(created).Add(time.Duration(18*60+rnd.Intn(11*60)) * time.Minute))
		}
		if created.After(now) || !created.Before(now) {
			continue
		}
		b := buildHistoric(rnd, created, now, c, agents, idx, usedOpenTitle)
		if b == nil {
			continue
		}
		built = append(built, *b)
	}
	// 在办单：按桶精确定制，保证每个业务分支都有样本
	liveKinds := []string{"breached", "breached", "at_risk", "at_risk", "normal", "normal", "normal",
		"paused", "paused", "new", "new", "canceled", "today"}
	for i := 0; i < 96; i++ {
		kind := liveKinds[i%len(liveKinds)]
		c := &customers[rnd.Intn(len(customers))]
		b := buildLive(rnd, kind, now, c, agents, idx, usedOpenTitle)
		if b == nil {
			continue
		}
		built = append(built, *b)
	}
	sort.SliceStable(built, func(i, j int) bool { return built[i].t.CreatedAt.Before(built[j].t.CreatedAt) })

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&customers).Error; err != nil {
			return fmt.Errorf("写入客户失败: %w", err)
		}
		if err := tx.Create(&agents).Error; err != nil {
			return fmt.Errorf("写入工程师失败: %w", err)
		}
		if err := tx.Create(&policies).Error; err != nil {
			return fmt.Errorf("写入 SLA 策略失败: %w", err)
		}
		for i := range built {
			b := &built[i]
			key := b.t.CreatedAt.In(domain.FieldTZ).Format("20060102")
			daySeq[key]++
			b.t.Code = fmt.Sprintf("TK-%s-%04d", key, daySeq[key])
			if err := tx.Create(&b.t).Error; err != nil {
				return fmt.Errorf("写入工单 %s 失败: %w", b.t.Code, err)
			}
			for j := range b.evs {
				b.evs[j].TicketID = b.t.ID
			}
			if err := tx.Create(&b.evs).Error; err != nil {
				return fmt.Errorf("写入工单 %s 时间线失败: %w", b.t.Code, err)
			}
		}
		return assertSeedCoverage(tx, now)
	})
}

func buildCustomers(now time.Time, rnd *rand.Rand) []domain.Customer {
	tiers := []string{domain.TierPlatinum, domain.TierGold, domain.TierGold, domain.TierSilver, domain.TierBronze}
	out := make([]domain.Customer, 0, len(customerPool))
	for i, c := range customerPool {
		tier := domain.TierBronze
		switch {
		case i < 6:
			tier = domain.TierPlatinum
		case i < 16:
			tier = domain.TierGold
		case i < 30:
			tier = domain.TierSilver
		}
		if i >= 30 && i%7 == 0 {
			tier = tiers[3]
		}
		joined := now.AddDate(-1, 0, 0).AddDate(0, -(i % 11), -((i * 13) % 28))
		phone := fmt.Sprintf("138%08d", 260000+i*137)
		out = append(out, domain.Customer{
			ID:   int64(i + 1),
			Code: fmt.Sprintf("CU-%04d", 1001+i), Name: c.name, Tier: tier, Industry: c.industry,
			ContactName: surnames[i%len(surnames)] + "工", ContactPhone: phone,
			Seats: 20 + (i*17)%480, Active: i != 33 && i != 40-1, JoinedAt: minuteAlign(joined),
		})
	}
	return out
}

func buildAgents(now time.Time) []domain.Agent {
	out := make([]domain.Agent, 0, len(agentPool))
	for i, a := range agentPool {
		out = append(out, domain.Agent{
			ID:   int64(i + 1),
			Code: fmt.Sprintf("AG-%02d", i+1), Name: a.name, Team: a.team, Title: a.title,
			Skills: a.skills, Active: i != 11, CapacityBd: a.cap,
			JoinedAt: minuteAlign(now.AddDate(-2, 0, 0).AddDate(0, -i, 0)),
		})
	}
	return out
}

// ---- 历史单（已走完生命周期） ----

func buildHistoric(rnd *rand.Rand, created, now time.Time, c *domain.Customer,
	agents []domain.Agent, idx map[string]*domain.SlaPolicy, used map[string]bool) *builtTicket {

	sev := pickSeverity(rnd)
	pol := idx[c.Tier+"|"+sev]
	if pol == nil {
		return nil
	}
	category := pickCategory(rnd)
	target := int64(pol.ResolveMin)
	respTarget := int64(pol.ResponseMin)

	avail := domain.BusinessMinutesBetween(created, now) - 30
	if avail < 8 {
		return nil
	}
	breach := rnd.Intn(100) < 24
	want := int64(float64(target) * (0.25 + rnd.Float64()*0.6))
	if breach {
		want = int64(float64(target) * (1.15 + rnd.Float64()*1.1))
	}
	if want > avail {
		want = avail
		breach = false
	}
	if want < 6 {
		return nil
	}

	respBd := int64(1 + rnd.Intn(int(max64(respTarget, 3))))
	if rnd.Intn(100) < 9 {
		respBd = respTarget + int64(1+rnd.Intn(int(max64(respTarget, 5))))
	}
	if respBd > want {
		respBd = want / 2
	}

	// 分段：处理段 + 若干次挂起。挂起按挂钟长度造（下班/周末/假期里挂几天很常见）。
	var segs []seg
	segs = append(segs, seg{kind: segWork, bd: respBd, msg: "首次响应"})
	rest := want - respBd
	pauses := 0
	switch {
	case rnd.Intn(100) < 20:
		pauses = 2
	case rnd.Intn(100) < 40:
		pauses = 1
	}
	for p := 0; p < pauses && rest > 12; p++ {
		workBit := int64(4 + rnd.Intn(int(max64(rest/2, 8))))
		if workBit >= rest {
			workBit = rest / 2
		}
		segs = append(segs, seg{kind: segWork, bd: workBit, msg: "排查与处置"})
		rest -= workBit
		wall := []int64{45, 120, 6 * 60, 26 * 60, 50 * 60, 96 * 60}[rnd.Intn(6)]
		segs = append(segs, seg{kind: segPause, wall: wall,
			msg: domain.PauseReasons[rnd.Intn(len(domain.PauseReasons))]})
	}
	segs = append(segs, seg{kind: segWork, bd: rest, msg: "排查与处置"})

	t, evs, ok := assemble(rnd, created, now, c, agents, pol, sev, category, segs, used, false)
	if !ok {
		return nil
	}
	return &builtTicket{t: t, evs: evs}
}

// ---- 在办单（按桶定制，保证分支覆盖） ----

func buildLive(rnd *rand.Rand, kind string, now time.Time, c *domain.Customer,
	agents []domain.Agent, idx map[string]*domain.SlaPolicy, used map[string]bool) *builtTicket {

	sev := pickSeverity(rnd)
	if kind == "breached" && rnd.Intn(100) < 55 {
		sev = domain.SevS1 // 超时重灾区集中在高等级
	}
	pol := idx[c.Tier+"|"+sev]
	if pol == nil {
		return nil
	}
	target := int64(pol.ResolveMin)
	category := pickCategory(rnd)

	switch kind {
	case "breached":
		want := target + int64(20+rnd.Intn(int(max64(target, 60))))
		return assembleLive(rnd, now, c, agents, pol, sev, category, want, false, used)
	case "at_risk":
		window := int64(domain.AtRiskWindow())
		want := target - int64(5+rnd.Intn(int(max64(window, 10))))
		if want < 1 {
			want = 1
		}
		return assembleLive(rnd, now, c, agents, pol, sev, category, want, false, used)
	case "normal":
		want := int64(float64(target) * (0.12 + rnd.Float64()*0.55))
		if want < 1 {
			want = 1
		}
		return assembleLive(rnd, now, c, agents, pol, sev, category, want, false, used)
	case "paused":
		want := int64(float64(target) * (0.18 + rnd.Float64()*0.6))
		if want < 2 {
			want = 2
		}
		return assembleLive(rnd, now, c, agents, pol, sev, category, want, true, used)
	case "new":
		want := int64(2 + rnd.Intn(int(max64(int64(pol.ResponseMin)*3, 40))))
		return assembleNew(rnd, now, c, agents, pol, sev, category, want, used)
	case "canceled":
		return assembleCanceled(rnd, now, c, agents, pol, sev, category, used)
	case "today":
		// 本轮真实运行时刻是周六凌晨（前一天还是中秋），这类单「零计时」是对日历口径的活体检验
		created := minuteAlign(now.Add(-time.Duration(10+rnd.Intn(300)) * time.Minute))
		return assembleNew(rnd, now, c, agents, pol, sev, category, 0, used, created)
	}
	return nil
}

func assembleNew(rnd *rand.Rand, now time.Time, c *domain.Customer, agents []domain.Agent,
	pol *domain.SlaPolicy, sev, category string, want int64, used map[string]bool, createdOpt ...time.Time) *builtTicket {

	created := createdForBusinessAge(now, want)
	if len(createdOpt) > 0 {
		created = createdOpt[0]
	}
	title := uniqueTitle(rnd, category, c.ID, used)
	t := baseTicket(rnd, created, c, pol, sev, category, title)
	t.Status = domain.StNew
	evs := []domain.TicketEvent{{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: c.ContactName, ActorRole: "客户",
		Note: "通过" + t.Channel + "提交", At: created,
	}}
	if want > 0 && rnd.Intn(100) < 45 { // 部分已派单但未开始处理
		ag := chooseAgent(agents, category, rnd)
		assignAt := domain.AdvanceBusiness(created, int64(1+rnd.Intn(int(max64(int64(pol.ResponseMin), 12)))))
		if assignAt.Before(now) {
			t.AgentID = &ag.ID
			t.FirstResponse = &assignAt
			t.ResponseBd = domain.BusinessMinutesBetween(created, assignAt)
			met := t.ResponseBd <= int64(pol.ResponseMin)
			t.MetResponse = &met
			t.Status = domain.StAssigned
			t.ReassignCount = 0
			evs = append(evs, domain.TicketEvent{
				Kind: domain.EvAssigned, FromStatus: domain.StNew, ToStatus: domain.StAssigned,
				Actor: ag.Name, ActorRole: "值班主管", Note: "按技能组自动分派", At: assignAt,
			})
		}
	}
	return &builtTicket{t: t, evs: evs, open: true}
}

func assembleCanceled(rnd *rand.Rand, now time.Time, c *domain.Customer, agents []domain.Agent,
	pol *domain.SlaPolicy, sev, category string, used map[string]bool) *builtTicket {

	want := int64(3 + rnd.Intn(int(max64(int64(pol.ResolveMin)/3, 30))))
	created := createdForBusinessAge(now, want)
	title := uniqueTitle(rnd, category, c.ID, used)
	t := baseTicket(rnd, created, c, pol, sev, category, title)
	evs := []domain.TicketEvent{{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: c.ContactName, ActorRole: "客户",
		Note: "通过" + t.Channel + "提交", At: created,
	}}
	cancelAt := domain.AdvanceBusiness(created, want)
	if !cancelAt.Before(now) {
		return nil
	}
	why := []string{"客户自行恢复，确认无需处理", "重复提单，合并到既有工单", "客户取消变更计划", "误报：监控阈值抖动"}[rnd.Intn(4)]
	t.Status = domain.StCanceled
	t.CanceledAt = &cancelAt
	t.Team = domain.TeamForCategory(category)
	met := false
	t.MetResponse = &met
	evs = append(evs, domain.TicketEvent{
		Kind: domain.EvStatus, FromStatus: domain.StNew, ToStatus: domain.StCanceled,
		Actor: "宗卿云", ActorRole: "值班工程师", Note: why, At: cancelAt,
	})
	return &builtTicket{t: t, evs: evs, open: false}
}

func assembleLive(rnd *rand.Rand, now time.Time, c *domain.Customer, agents []domain.Agent,
	pol *domain.SlaPolicy, sev, category string, want int64, withPause bool, used map[string]bool) *builtTicket {

	respTarget := int64(pol.ResponseMin)
	respBd := int64(1 + rnd.Intn(int(max64(respTarget, 8))))
	if respBd > want/2 {
		respBd = want / 2
	}

	// 在途挂起的停表分钟必须先从「现在」往回锚定，再反推进单时刻：
	// bm(created→now) = want + pausedLive 且 bm(created→挂起点) = want，
	// 由加法性与 Advance 的互逆性质，工单「已用时效」精确落在 want 上。
	pausedLive := int64(0)
	pauseAnchor := now
	if withPause {
		wall := []int64{60, 3 * 60, 9 * 60, 26 * 60, 60 * 60, 120 * 60}[rnd.Intn(6)]
		pauseAnchor = minuteAlign(now.Add(-time.Duration(wall) * time.Minute))
		pausedLive = domain.BusinessMinutesBetween(pauseAnchor, now)
		if pausedLive <= 0 {
			pausedLive = 1
			pauseAnchor = now.Add(-90 * time.Minute)
		}
	}
	created := createdForBusinessAge(now, want+pausedLive)
	if domain.BusinessMinutesBetween(created, now) != want+pausedLive {
		return nil
	}

	segs := []seg{{kind: segWork, bd: respBd, msg: "首次响应"}}
	if rest := want - respBd; rest > 0 {
		segs = append(segs, seg{kind: segWork, bd: rest, msg: "排查与处置"})
	}
	if withPause {
		segs = append(segs, seg{kind: segPauseOpen,
			msg: domain.PauseReasons[rnd.Intn(len(domain.PauseReasons))]})
	}
	t, evs, ok := assemble(rnd, created, now, c, agents, pol, sev, category, segs, used, true)
	if !ok {
		return nil
	}
	return &builtTicket{t: t, evs: evs, open: true}
}

// assemble 把「线段脚本」翻译成形参一致的时间线，并填好所有时效账字段。
// 关键性质：时间线是 [created, end] 的连续划分，所以
// bm(created→end) = Σ工作段 + Σ停表段，恒等式由构造保证、由自检复核。
// assemble 把「线段脚本」翻译成形参一致的时间线，并填好所有时效账字段。
// 关键性质：时间线是 [created, end] 的连续划分，所以
// bm(created→end) = Σ工作段 + Σ停表段，恒等式由构造保证、由结尾的自检复核。
func assemble(rnd *rand.Rand, created, now time.Time, c *domain.Customer, agents []domain.Agent,
	pol *domain.SlaPolicy, sev, category string, segs []seg, used map[string]bool, forceOpen bool) (domain.Ticket, []domain.TicketEvent, bool) {

	target := int64(pol.ResolveMin)
	respTarget := int64(pol.ResponseMin)
	team := domain.TeamForCategory(category)

	title := pickTitle(rnd, category)
	if forceOpen {
		title = uniqueTitle(rnd, category, c.ID, used)
	}
	t := baseTicket(rnd, created, c, pol, sev, category, title)
	evs := []domain.TicketEvent{{
		Kind: domain.EvCreated, ToStatus: domain.StNew, Actor: c.ContactName, ActorRole: "客户",
		Note: "通过" + t.Channel + "提交：" + truncate(title, 40), At: created,
	}}

	cur := created
	status := domain.StNew
	elapsed := int64(0)
	pausedBd := int64(0)
	assigned := false
	var agentRef *int64

	for _, s := range segs {
		switch s.kind {
		case segWork:
			if s.bd <= 0 {
				continue
			}
			next := domain.AdvanceBusiness(cur, s.bd)
			if next.After(now) {
				return t, evs, false // 超出「现在」的历史不可回放，直接弃用这条种子
			}
			elapsed += s.bd
			if !assigned {
				ag := chooseAgent(agents, category, rnd)
				agentRef = &ag.ID
				t.AgentID = agentRef
				t.FirstResponse = &next
				t.ResponseBd = domain.BusinessMinutesBetween(created, next)
				met := t.ResponseBd <= respTarget
				t.MetResponse = &met
				from := status
				status = domain.StAssigned
				evs = append(evs, domain.TicketEvent{
					Kind: domain.EvAssigned, FromStatus: from, ToStatus: status,
					Actor: ag.Name, ActorRole: "值班主管", Note: s.msg, At: next,
				})
				assigned = true
				cur = next
				continue
			}
			from := status
			status = domain.StWorking
			evs = append(evs, domain.TicketEvent{
				Kind: domain.EvStatus, FromStatus: from, ToStatus: status,
				Actor: agentName(agents, agentRef), ActorRole: "工程师", Note: s.msg, At: next,
			})
			cur = next
		case segPause:
			start := cur
			endAt := start.Add(time.Duration(s.wall) * time.Minute)
			if endAt.After(now) {
				endAt = minuteAlign(now.Add(-20 * time.Minute))
			}
			if !endAt.After(start) {
				continue
			}
			pausedBd += domain.BusinessMinutesBetween(start, endAt)
			from := status
			evs = append(evs,
				domain.TicketEvent{Kind: domain.EvPaused, FromStatus: from, ToStatus: domain.StPending,
					Actor: agentName(agents, agentRef), ActorRole: "工程师", Note: s.msg, At: start},
				domain.TicketEvent{Kind: domain.EvResumed, FromStatus: domain.StPending, ToStatus: domain.StWorking,
					Actor: c.ContactName, ActorRole: "客户", Note: "客户回复并放行后续操作", At: endAt},
			)
			status = domain.StWorking
			cur = endAt
		case segPauseOpen:
			from := status
			ps := cur
			evs = append(evs, domain.TicketEvent{
				Kind: domain.EvPaused, FromStatus: from, ToStatus: domain.StPending,
				Actor: agentName(agents, agentRef), ActorRole: "工程师", Note: s.msg, At: ps,
			})
			t.PausedSince = &ps
			t.PauseReason = s.msg
			status = domain.StPending
		}
	}

	if elapsed <= 0 || !assigned {
		return t, evs, false
	}
	t.PausedBd = pausedBd
	t.ResolveBd = elapsed
	t.Team = team
	t.Status = status
	t.UpdatedAt = minuteAlign(now)

	if forceOpen {
		// 在办单：存量的 resolve_due_at 只反映「已闭合的停表」，
		// 在途停表的顺延由 ComputeClock 实时算出，恢复时再落库。
		t.ResolveDueAt = domain.AdvanceBusiness(created, target+pausedBd)
		return t, evs, true
	}

	// 已解决 → 关单（客户验收），或直接停在待验收
	met := elapsed <= target
	t.MetResolve = &met
	t.ResolveDueAt = domain.AdvanceBusiness(created, target+pausedBd)
	evs = append(evs, domain.TicketEvent{
		Kind: domain.EvStatus, FromStatus: status, ToStatus: domain.StResolved,
		Actor: agentName(agents, agentRef), ActorRole: "工程师",
		Note: resolutionNote(category, met), At: cur,
	})
	resolvedAt := cur
	t.ResolvedAt = &resolvedAt
	t.Status = domain.StResolved
	if !met {
		escalateAt := domain.AdvanceBusiness(created, target+1)
		if escalateAt.Before(now) && escalateAt.After(created) {
			evs = append(evs, domain.TicketEvent{
				Kind: domain.EvEscalate, FromStatus: domain.StWorking, ToStatus: domain.StWorking,
				Actor: "服务台值班经理", ActorRole: "系统",
				Note: "解决时效到期未闭环，自动升级并通知客户接口人", At: escalateAt,
			})
		}
	}
	if rnd.Intn(100) < 78 {
		vb := int64(5 + rnd.Intn(150))
		closedAt := domain.AdvanceBusiness(cur, vb)
		if closedAt.Before(now) {
			t.ClosedAt = &closedAt
			t.Status = domain.StClosed
			evs = append(evs, domain.TicketEvent{
				Kind: domain.EvStatus, FromStatus: domain.StResolved, ToStatus: domain.StClosed,
				Actor: c.ContactName, ActorRole: "客户", Note: "客户确认恢复，满意度评价已回收", At: closedAt,
			})
		}
	}
	return t, evs, true
}

func pausedOpenIndex(evs []domain.TicketEvent) int {
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].Kind == domain.EvPaused {
			// 只有没被 resumed 闭合的暂停才算在途
			closed := false
			for j := i + 1; j < len(evs); j++ {
				if evs[j].Kind == domain.EvResumed {
					closed = true
					break
				}
			}
			if !closed {
				return i
			}
			return -1
		}
	}
	return -1
}

func baseTicket(rnd *rand.Rand, created time.Time, c *domain.Customer, pol *domain.SlaPolicy,
	sev, category, title string) domain.Ticket {

	return domain.Ticket{
		Title: title, Description: descPool[rnd.Intn(len(descPool))],
		CustomerID: c.ID, Category: category, Channel: pickChannel(rnd),
		Severity: sev, Priority: domain.Prioritize(sev, c.Tier),
		Status: domain.StNew, CreatedAt: created, UpdatedAt: created,
		ResponseTarget: pol.ResponseMin, ResolveTarget: pol.ResolveMin,
		RespDueAt:    domain.AdvanceBusiness(created, int64(pol.ResponseMin)),
		ResolveDueAt: domain.AdvanceBusiness(created, int64(pol.ResolveMin)),
		Team:         domain.TeamForCategory(category),
	}
}

func pickTitle(rnd *rand.Rand, category string) string {
	pool := titlePool[category]
	if len(pool) == 0 {
		return "运维服务请求"
	}
	return pool[rnd.Intn(len(pool))]
}

// uniqueTitle 保证「同一客户的同名在办单」只有一张：库上有部分唯一索引兜底，
// 种子必须自己先做到不撞，否则整批回滚。
func uniqueTitle(rnd *rand.Rand, category string, customerID int64, used map[string]bool) string {
	for i := 0; i < 12; i++ {
		title := pickTitle(rnd, category)
		key := fmt.Sprintf("%d|%s", customerID, title)
		if !used[key] {
			used[key] = true
			return title
		}
	}
	title := fmt.Sprintf("%s（第 %d 次复现）", pickTitle(rnd, category), rnd.Intn(9)+2)
	used[fmt.Sprintf("%d|%s", customerID, title)] = true
	return title
}

func chooseAgent(agents []domain.Agent, category string, rnd *rand.Rand) domain.Agent {
	team := domain.TeamForCategory(category)
	cands := make([]domain.Agent, 0, 4)
	for _, a := range agents {
		if a.Team == team && a.Active {
			cands = append(cands, a)
		}
	}
	if len(cands) == 0 {
		for _, a := range agents {
			if a.Active {
				cands = append(cands, a)
			}
		}
	}
	if len(cands) == 0 {
		return agents[0]
	}
	return cands[rnd.Intn(len(cands))]
}

func agentName(agents []domain.Agent, id *int64) string {
	if id == nil {
		return "服务台"
	}
	for _, a := range agents {
		if a.ID == *id {
			return a.Name
		}
	}
	return "服务台"
}

func resolutionNote(category string, met bool) string {
	tail := "已闭环并向客户交付处置说明"
	if !met {
		tail = "超出合同时效，已提交超时根因分析"
	}
	switch category {
	case "数据库":
		return "重建索引并回滚异常统计信息，慢查询恢复基线，" + tail
	case "网络与专线":
		return "切换备用链路并协调运营商整改光衰，丢包归零，" + tail
	case "安全事件":
		return "封禁来源地址段并完成取证，无数据外泄迹象，" + tail
	case "账号与权限":
		return "回收异常账号权限并补齐审批留痕，" + tail
	case "监控告警":
		return "收敛告警规则并加入静默窗口，风暴止住，" + tail
	default:
		return "完成处置并回归验证通过，" + tail
	}
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// assertSeedCoverage 是种子自检：跑在同一个事务里，覆盖不足就让整批写入回滚。
func assertSeedCoverage(tx *gorm.DB, now time.Time) error {
	var raw []rawRow
	if err := tx.Table("tickets AS t").
		Select(rowSelect).
		Joins("JOIN customers c ON c.id = t.customer_id").
		Joins("LEFT JOIN agents a ON a.id = t.agent_id").
		Limit(5000).Order("t.created_at asc").Scan(&raw).Error; err != nil {
		return err
	}
	var events []domain.TicketEvent
	if err := tx.Order("at asc, id asc").Limit(50000).Find(&events).Error; err != nil {
		return err
	}
	evByTicket := map[int64][]domain.TicketEvent{}
	for _, e := range events {
		evByTicket[e.TicketID] = append(evByTicket[e.TicketID], e)
	}

	counts := map[string]int{}
	identityBad, timelineBad, resolveBdBad, dueBad := 0, 0, 0, 0
	phonesLeak := 0
	for i := range raw {
		t := &raw[i].Ticket
		counts[t.Status]++
		counts["sev:"+t.Severity]++
		counts["prio:"+t.Priority]++
		counts["tier:"+raw[i].Tier]++
		if t.PausedBd > 0 || t.PausedSince != nil {
			counts["paused_ever"]++
		}
		if domain.IsWorkingDay(t.CreatedAt) == false {
			counts["created_offday"]++
		}
		if k := t.CreatedAt.In(domain.FieldTZ).Format("2006-01-02"); k == "2026-09-27" || k == "2026-10-10" {
			counts["created_makeup"]++
		}
		if k := t.ResolveDueAt.In(domain.FieldTZ).Format("2006-01-02"); k >= "2026-09-27" {
			counts["due_from_makeup"]++
		}
		if k := t.CreatedAt.In(domain.FieldTZ).Format("2006-01-02"); k == "2026-09-25" || k >= "2026-10-01" {
			counts["created_holiday"]++
		}
		cs := domain.ComputeClock(t, now)
		if !cs.ClockIdentity {
			identityBad++
		}
		if cs.Finished && t.Status != domain.StCanceled {
			if t.ResolveBd != cs.ElapsedBd {
				resolveBdBad++
			}
		}
		if t.PausedSince == nil && !t.ResolveDueAt.IsZero() &&
			!t.ResolveDueAt.Equal(domain.AdvanceBusiness(t.CreatedAt, int64(t.ResolveTarget)+t.PausedBd)) {
			dueBad++
		}
		if got := domain.BusinessMinutesOfSpans(domain.PauseSpansFromEvents(evByTicket[t.ID], now)); got != t.PausedBd+livePauseFromEvents(t, evByTicket[t.ID], now) {
			timelineBad++
		}
	}
	// 出口隐私自检：明文手机号不得出现在任何行视图里（结构上由 json:"-" 保证，这里断言行数）
	for i := range raw {
		if raw[i].ContactPhoneRaw == "" {
			phonesLeak++
		}
	}

	if len(raw) < 300 {
		return fmt.Errorf("种子工单数 %d，少于 300", len(raw))
	}
	if len(events) < len(raw) {
		return fmt.Errorf("时间线事件数 %d 少于工单数 %d", len(events), len(raw))
	}
	if identityBad+resolveBdBad+dueBad > 0 {
		return fmt.Errorf("时间账自检失败：往返恒等式 %d 破、解决账不符 %d、到期点不符 %d",
			identityBad, resolveBdBad, dueBad)
	}
	if timelineBad > 0 {
		return fmt.Errorf("时间线复算与停表账不符的工单 %d 张", timelineBad)
	}
	for _, s := range domain.AllStatuses {
		if counts[s] == 0 {
			return fmt.Errorf("状态 %s 零覆盖（种子必须覆盖全部 7 态）", s)
		}
	}
	for _, s := range domain.Severities {
		if counts["sev:"+s] == 0 {
			return fmt.Errorf("严重级 %s 零覆盖", s)
		}
	}
	for _, p := range []string{"P1", "P2", "P3", "P4"} {
		if counts["prio:"+p] == 0 {
			return fmt.Errorf("优先级 %s 零覆盖", p)
		}
	}
	for _, tr := range domain.Tiers {
		if counts["tier:"+tr] == 0 {
			return fmt.Errorf("合同等级 %s 零覆盖", tr)
		}
	}
	if counts["paused_ever"] < 20 {
		return fmt.Errorf("停表分支覆盖不足：%d", counts["paused_ever"])
	}
	if counts["created_offday"] < 30 {
		return fmt.Errorf("非工作时段进单覆盖不足：%d", counts["created_offday"])
	}
	// 调休上班日的覆盖要按日期说话：如果那天还没到，历史里**不可能**有当天进单的工单
	// （本轮运行日 2026-09-26，最近的调休日是 09-27），此时改为要求有在办单的
	// 到期点跨过该调休日 —— AdvanceBusiness 的「周末但上班」分支照样被线上数据检验。
	firstMakeup := domain.MakeupList()[0]
	if domain.DateKey(now) >= firstMakeup {
		if counts["created_makeup"] < 1 {
			return fmt.Errorf("缺调休上班日的样本")
		}
	} else if counts["due_from_makeup"] < 1 {
		return fmt.Errorf("没有工单的到期点落在调休日 %s 之后，调休分支缺线上样本", firstMakeup)
	}
	return nil
}

func livePauseFromEvents(t *domain.Ticket, evs []domain.TicketEvent, now time.Time) int64 {
	if t.PausedSince == nil {
		return 0
	}
	return domain.BusinessMinutesBetween(*t.PausedSince, now)
}
