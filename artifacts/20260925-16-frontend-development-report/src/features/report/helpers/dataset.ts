import type {
  ChannelRow,
  DailyPoint,
  Insight,
  Kpi,
  PageRow,
  PeriodKey,
  PeriodOption,
  ReportPayload,
} from '../types';

/**
 * 本地确定性样例数据（fixture）：页面上明确标注「示例数据」，不代表任何真实站点统计。
 *
 * 一致性约束（避免报表自身互相矛盾）：
 * 1. 每日指标只由日期决定，所以「上一个等长区间」就是更早的一批日期，环比可核对；
 * 2. 渠道访客之和 == 区间 UV 之和，渠道浏览量之和 == 区间 PV 之和（最大余数法精确配平）；
 * 3. 渠道跳出率与转化率由各渠道的相对差异乘以整体系数反推，使加权结果等于日序列的均值 / 合计。
 */

export const END_ISO = '2026-09-25';

export const PERIODS: PeriodOption[] = [
  { key: '30d', label: '近 30 天', days: 30 },
  { key: '90d', label: '近 90 天', days: 90 },
  { key: 'ytd', label: '今年以来', days: 268 },
];

const DAY = 86400000;
const SEED = 20260925;
/** 站点上线日：把增长曲线锚定到绝对日期，使不同区间对同一天给出相同数值 */
const START_TS = Date.UTC(2025, 2, 1);
const END_TS = Date.parse(END_ISO + 'T00:00:00Z');
const TOTAL_DAYS = Math.round((END_TS - START_TS) / DAY);

const CHANNELS: ReadonlyArray<readonly [string, string, number, number, number]> = [
  // key, 名称, 访客权重, 跳出率基准, 转化率基准
  ['search', '搜索引擎', 0.38, 0.42, 0.011],
  ['direct', '直接访问', 0.21, 0.28, 0.019],
  ['social', '社交平台', 0.19, 0.57, 0.005],
  ['link', '外链推荐', 0.14, 0.36, 0.016],
  ['newsletter', '邮件通讯', 0.08, 0.19, 0.034],
];

const WORK_WEIGHTS = [1, 0.72, 0.55, 0.44, 0.31, 0.22];
const WORK_TITLES = [
  '潮汐阅读器 · 离线优先的 RSS 客户端',
  '墨记 · 本地优先的笔记工具',
  'Go 网关性能实验记录',
  '小程序账单洞察报告',
  'Nimbus 订阅看板设计稿',
  '开源：sqlite-backup',
];
const NOTE_TITLES = ['为什么我把博客重写成静态站', '用 Gin 写一个足够小的后台', 'SQLite 做本地分析库的三个月'];

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sum(list: number[]): number {
  return list.reduce((acc: number, n: number) => acc + n, 0);
}

function avg(list: number[]): number {
  return list.length ? sum(list) / list.length : 0;
}

function isoOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function optionOf(period: PeriodKey): PeriodOption | undefined {
  return PERIODS.find((p: PeriodOption): boolean => p.key === period);
}

function daysOf(period: PeriodKey): number {
  const option = optionOf(period);
  return option ? option.days : 30;
}

/** 按最大余数法把浮点权重配平成整数，且总和精确等于 total */
function apportion(weights: number[], total: number): number[] {
  const wsum = sum(weights) || 1;
  const raw = weights.map((w: number): number => (w / wsum) * total);
  const floors = raw.map((v: number): number => Math.floor(v));
  let left = total - sum(floors);
  const order = raw
    .map((v: number, i: number) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const o of order) {
    if (left <= 0) break;
    const cell = floors[o.i];
    if (cell !== undefined) floors[o.i] = cell + 1;
    left -= 1;
  }
  return floors;
}

function dayValue(ts: number): DailyPoint {
  const index = Math.round((ts - START_TS) / DAY);
  const weekday = new Date(ts).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const rnd = mulberry32(SEED + Math.floor(ts / DAY));
  const growth = 0.55 + (index / (TOTAL_DAYS || 1)) * 0.85;
  const rel = index % 11;
  // 每 11 天一次发布，带来连续两天的峰值，让趋势图有可读结构
  const spike = rel === 3 ? 1.9 : rel === 4 ? 1.35 : 1;
  const base = 168 * (weekend ? 0.72 : 1) * growth * spike * (0.86 + rnd() * 0.3);
  const pv = Math.max(12, Math.round(base));
  const uv = Math.max(8, Math.round(pv * (0.52 + rnd() * 0.1)));
  return {
    date: isoOf(ts),
    pv,
    uv,
    work: Math.round(pv * (0.24 + rnd() * 0.12)),
    dwell: Math.round(88 + rnd() * 46 + (weekend ? -6 : 6)),
    bounce: 0.3 + rnd() * 0.2 + (weekend ? 0.05 : 0),
    contact: Math.round(uv * (0.006 + rnd() * 0.006)),
  };
}

function buildDays(period: PeriodKey, offsetPeriods: number): DailyPoint[] {
  const days = daysOf(period);
  const from = END_TS - (days - 1 + offsetPeriods * days) * DAY;
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i++) out.push(dayValue(from + i * DAY));
  return out;
}

function buildChannels(days: DailyPoint[], prevDays: DailyPoint[]): ChannelRow[] {
  const rnd = mulberry32(SEED + 7);
  const visitors = apportion(
    CHANNELS.map((c): number => c[2] * (0.9 + rnd() * 0.2)),
    sum(days.map((d: DailyPoint): number => d.uv)),
  );
  const pvs = apportion(
    CHANNELS.map((c): number => c[2] * (1.35 + rnd() * 0.9)),
    sum(days.map((d: DailyPoint): number => d.pv)),
  );
  const prevs = apportion(
    CHANNELS.map((c): number => c[2] * (0.8 + rnd() * 0.36)),
    sum(prevDays.map((d: DailyPoint): number => d.uv)),
  );
  const totalVisitors = sum(visitors) || 1;
  // 渠道的跳出率与转化率由日合计反推：整体均值随区间变化，渠道只保留相对差异
  const overallBounce = avg(days.map((d: DailyPoint): number => d.bounce));
  const baseBounce = sum(CHANNELS.map((c, i): number => c[3] * (visitors[i] ?? 0))) / totalVisitors;
  const bounceMul = baseBounce ? overallBounce / baseBounce : 1;
  const totalContacts = sum(days.map((d: DailyPoint): number => d.contact));
  const baseContacts = sum(CHANNELS.map((c, i): number => c[4] * (visitors[i] ?? 0))) || 1;
  const convMul = totalContacts / baseContacts;
  return CHANNELS.map((c, i): ChannelRow => ({
    key: c[0],
    name: c[1],
    visitors: visitors[i] ?? 0,
    pv: pvs[i] ?? 0,
    bounce: Math.min(0.95, Math.max(0.03, c[3] * bounceMul)),
    conversion: Math.max(0.001, c[4] * convMul),
    prevVisitors: prevs[i] ?? 0,
  }));
}

function sparkOf(days: DailyPoint[], pick: (d: DailyPoint) => number, buckets: number): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(days.length / buckets));
  for (let i = 0; i < buckets; i++) {
    const slice = days.slice(i * size, i * size + size);
    out.push(slice.length ? avg(slice.map(pick)) : 0);
  }
  return out;
}

function buildPages(days: DailyPoint[]): PageRow[] {
  const pv = sum(days.map((d: DailyPoint): number => d.pv));
  const rnd = mulberry32(SEED + 13);
  const rows: PageRow[] = [
    {
      path: '/',
      title: '首页',
      views: Math.round(pv * 0.21),
      dwell: 46 + Math.round(rnd() * 20),
      exits: Math.round(pv * 0.11),
    },
  ];
  WORK_TITLES.forEach((title: string, i: number): void => {
    const weight = WORK_WEIGHTS[i] ?? 0.1;
    rows.push({
      path: `/works/${i + 1}`,
      title,
      views: Math.round(pv * 0.055 * weight),
      dwell: 120 + Math.round(rnd() * 210),
      exits: Math.round(pv * 0.012 * weight),
    });
  });
  NOTE_TITLES.forEach((title: string, i: number): void => {
    rows.push({
      path: `/notes/${i + 1}`,
      title,
      views: Math.round(pv * (0.026 - i * 0.006)),
      dwell: 150 + Math.round(rnd() * 240),
      exits: Math.round(pv * 0.006),
    });
  });
  rows.push({
    path: '/about',
    title: '关于我',
    views: Math.round(pv * 0.042),
    dwell: 62 + Math.round(rnd() * 24),
    exits: Math.round(pv * 0.021),
  });
  return rows.sort((a: PageRow, b: PageRow): number => b.views - a.views);
}

interface KpiSpec {
  key: string;
  label: string;
  unit: Kpi['unit'];
  goodWhenUp: boolean;
  note: string;
  /** 区间聚合值 */
  aggregate: (days: DailyPoint[]) => number;
  /** 迷你趋势图使用的单日值，与聚合口径同一量纲 */
  daily: (d: DailyPoint) => number;
}

const KPI_SPECS: ReadonlyArray<KpiSpec> = [
  {
    key: 'pv',
    label: '页面浏览量',
    unit: 'count',
    goodWhenUp: true,
    note: '区间合计',
    aggregate: (days: DailyPoint[]): number => sum(days.map((d: DailyPoint): number => d.pv)),
    daily: (d: DailyPoint): number => d.pv,
  },
  {
    key: 'uv',
    label: '独立访客',
    unit: 'count',
    goodWhenUp: true,
    note: '按设备去重，等于渠道访客合计',
    aggregate: (days: DailyPoint[]): number => sum(days.map((d: DailyPoint): number => d.uv)),
    daily: (d: DailyPoint): number => d.uv,
  },
  {
    key: 'dwell',
    label: '平均停留',
    unit: 'duration',
    goodWhenUp: true,
    note: '各日均值',
    aggregate: (days: DailyPoint[]): number => avg(days.map((d: DailyPoint): number => d.dwell)),
    daily: (d: DailyPoint): number => d.dwell,
  },
  {
    key: 'bounce',
    label: '跳出率',
    unit: 'percent',
    goodWhenUp: false,
    note: '等于渠道加权跳出率',
    aggregate: (days: DailyPoint[]): number => avg(days.map((d: DailyPoint): number => d.bounce)) * 100,
    daily: (d: DailyPoint): number => d.bounce * 100,
  },
  {
    key: 'perVisit',
    label: '人均浏览页数',
    unit: 'pages',
    goodWhenUp: true,
    note: '区间 PV 合计 / UV 合计',
    aggregate: (days: DailyPoint[]): number =>
      sum(days.map((d: DailyPoint): number => d.pv)) / (sum(days.map((d: DailyPoint): number => d.uv)) || 1),
    daily: (d: DailyPoint): number => d.pv / (d.uv || 1),
  },
  {
    key: 'work',
    label: '作品页浏览',
    unit: 'count',
    goodWhenUp: true,
    note: '/works 路径合计',
    aggregate: (days: DailyPoint[]): number => sum(days.map((d: DailyPoint): number => d.work)),
    daily: (d: DailyPoint): number => d.work,
  },
  {
    key: 'contact',
    label: '联系表单提交',
    unit: 'count',
    goodWhenUp: true,
    note: '等于渠道转化之和',
    aggregate: (days: DailyPoint[]): number => sum(days.map((d: DailyPoint): number => d.contact)),
    daily: (d: DailyPoint): number => d.contact,
  },
];

function buildKpis(days: DailyPoint[], prev: DailyPoint[], buckets: number): Kpi[] {
  return KPI_SPECS.map((spec): Kpi => ({
    key: spec.key,
    label: spec.label,
    value: spec.aggregate(days),
    prev: spec.aggregate(prev),
    unit: spec.unit,
    goodWhenUp: spec.goodWhenUp,
    spark: sparkOf(days, spec.daily, buckets),
    note: spec.note,
  }));
}

function channelOf(channels: ChannelRow[], key: string): ChannelRow | undefined {
  return channels.find((c: ChannelRow): boolean => c.key === key);
}

function percentOf(row: ChannelRow | undefined, pick: (r: ChannelRow) => number, digits = 1): string {
  if (!row) return '—';
  return (pick(row) * 100).toFixed(digits) + '%';
}

function buildInsights(days: DailyPoint[], channels: ChannelRow[], pages: PageRow[]): Insight[] {
  const empty: DailyPoint = { date: END_ISO, pv: 0, uv: 0, work: 0, dwell: 0, bounce: 0, contact: 0 };
  const meanPv = avg(days.map((d: DailyPoint): number => d.pv));
  const best = days.reduce((a: DailyPoint, b: DailyPoint): DailyPoint => (b.pv > a.pv ? b : a), days[0] ?? empty);
  const worst = days.reduce((a: DailyPoint, b: DailyPoint): DailyPoint => (b.pv < a.pv ? b : a), days[0] ?? empty);
  const ranked = [...channels].sort(
    (a: ChannelRow, b: ChannelRow): number =>
      b.visitors / (b.prevVisitors || 1) - a.visitors / (a.prevVisitors || 1),
  );
  const fastest = ranked[0];
  const topWork = pages.find((p: PageRow): boolean => p.path.startsWith('/works'));
  const search = channelOf(channels, 'search');
  const social = channelOf(channels, 'social');
  const newsletter = channelOf(channels, 'newsletter');
  const total = sum(channels.map((c: ChannelRow): number => c.visitors)) || 1;
  const bounceOf = (r: ChannelRow): number => r.bounce;
  const convOf = (r: ChannelRow): number => r.conversion;
  const peakLift = meanPv ? Math.round((best.pv / meanPv - 1) * 100) : 0;
  return [
    {
      id: 'publish-spike',
      tone: 'win',
      title: `发布日带来 ${peakLift}% 的峰值`,
      body: `${best.date} 单日 ${best.pv} 次浏览，是区间均值（${Math.round(meanPv)}）的 ${(best.pv / (meanPv || 1)).toFixed(2)} 倍。作品与长文在同一周内发布时，二次访问明显增加。`,
    },
    {
      id: 'channel-mix',
      tone: 'watch',
      title: `${fastest ? fastest.name : '直接访问'} 增速最快，${social ? social.name : '社交平台'} 跳出最高`,
      body: `搜索引擎带来 ${search ? ((search.visitors / total) * 100).toFixed(0) : '—'}% 的访客，跳出率 ${percentOf(search, bounceOf, 0)}；${social ? social.name : '社交平台'} 跳出率 ${percentOf(social, bounceOf, 0)} 为全渠道最高。${newsletter ? newsletter.name : '邮件通讯'} 人数最少，但咨询转化 ${percentOf(newsletter, convOf)} 最好。`,
    },
    {
      id: 'work-entry',
      tone: 'win',
      title: `${topWork ? topWork.title : '作品页'} 是最深的阅读入口`,
      body: `浏览最多的作品详情页平均停留 ${topWork ? topWork.dwell : 0} 秒，高于全站均值，说明访客看完首页后会继续深入作品。建议首页首屏直接暴露两个作品入口做对照。`,
    },
    {
      id: 'weekend-dip',
      tone: 'risk',
      title: '周末流量塌陷',
      body: `区间最低日为 ${worst.date}（${worst.pv} 次浏览）。周末访客更少且跳出率更高，长文更适合工作日发布；也可以在周末安排轻量更新维持回访习惯。`,
    },
  ];
}

function labelOf(period: PeriodKey, offset: number): string {
  const days = daysOf(period);
  const from = END_TS - (days - 1 + offset * days) * DAY;
  const to = END_TS - offset * days * DAY;
  return `${isoOf(from)} 至 ${isoOf(to)}`;
}

export function buildReport(period: PeriodKey): ReportPayload {
  const days = buildDays(period, 0);
  const prevDays = buildDays(period, 1);
  const channels = buildChannels(days, prevDays);
  const pages = buildPages(days);
  const totalPv = sum(days.map((d: DailyPoint): number => d.pv));
  const pagePv = sum(pages.map((p: PageRow): number => p.views));
  const option = optionOf(period);

  return {
    period,
    periodLabel: option ? option.label : period,
    siteName: '苏晨 · 个人站',
    siteUrl: 'sunchen.dev',
    generatedAt: END_ISO,
    compareLabel: labelOf(period, 1),
    days,
    kpis: buildKpis(days, prevDays, Math.min(12, days.length)),
    channels,
    pages,
    pageCoverage: totalPv ? pagePv / totalPv : 0,
    insights: buildInsights(days, channels, pages),
  };
}
