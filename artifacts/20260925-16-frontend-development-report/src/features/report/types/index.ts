export type PeriodKey = '30d' | '90d' | 'ytd';

export type KpiUnit = 'count' | 'duration' | 'percent' | 'pages';

export interface PeriodOption {
  key: PeriodKey;
  label: string;
  days: number;
}

export interface DailyPoint {
  /** ISO date, e.g. 2026-09-25 */
  date: string;
  pv: number;
  uv: number;
  /** 作品页浏览量，用于趋势图的次要序列 */
  work: number;
  /** 当日平均停留秒数 */
  dwell: number;
  /** 当日跳出率 0-1 */
  bounce: number;
  /** 当日联系表单提交次数 */
  contact: number;
}

export interface Kpi {
  key: string;
  label: string;
  /** 原始值：count 为次数，duration 为秒，percent 为 0-100，pages 为页/人 */
  value: number;
  prev: number;
  unit: KpiUnit;
  /** 指标上升是否为好事，决定涨跌配色语义 */
  goodWhenUp: boolean;
  spark: number[];
  note: string;
}

export interface ChannelRow {
  key: string;
  name: string;
  visitors: number;
  pv: number;
  /** 跳出率，0-1 */
  bounce: number;
  /** 联系表单转化率，0-1 */
  conversion: number;
  /** 上期访客，用于同比 */
  prevVisitors: number;
}

export interface PageRow {
  path: string;
  title: string;
  views: number;
  /** 平均停留秒数 */
  dwell: number;
  exits: number;
}

export type InsightTone = 'win' | 'watch' | 'risk';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  body: string;
}

export interface ReportPayload {
  period: PeriodKey;
  periodLabel: string;
  siteName: string;
  siteUrl: string;
  generatedAt: string;
  /** 上期区间标签，用于「较上期」口径说明 */
  compareLabel: string;
  days: DailyPoint[];
  kpis: Kpi[];
  channels: ChannelRow[];
  pages: PageRow[];
  /** 列出页面的浏览量之和占区间 PV 的比例，用来说明表格覆盖范围 */
  pageCoverage: number;
  insights: Insight[];
}

export type SortKey = 'name' | 'visitors' | 'pv' | 'bounce' | 'conversion';

export interface ChannelSort {
  key: SortKey;
  dir: 'asc' | 'desc';
}
