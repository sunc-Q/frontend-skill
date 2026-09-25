import type { TierId } from './pricing';

export interface FeatureRow {
  readonly key: string;
  readonly group: '收集' | '整理' | '协作' | '安全与运维';
  readonly label: string;
  readonly hint: string;
  readonly values: Readonly<Record<TierId, string | boolean>>;
  /** 该行是否为「有差异行」：三档取值不完全一致。用于「只看差异」过滤。 */
  readonly differs: boolean;
}

function row(
  key: string,
  group: FeatureRow['group'],
  label: string,
  hint: string,
  seed: string | boolean,
  grove: string | boolean,
  canopy: string | boolean,
): FeatureRow {
  return {
    key,
    group,
    label,
    hint,
    values: { seed, grove, canopy },
    differs: !(seed === grove && grove === canopy),
  };
}

export const FEATURE_ROWS: readonly FeatureRow[] = [
  row('boards', '收集', '公开看板', '对外展示的反馈板数量', '1 个', '无限', '无限'),
  row('intake', '收集', '网页片段收集', '在任意网页框选一段文字回传', true, true, true),
  row('email', '收集', '邮件转反馈', '发到 board@mail 自动建单', true, true, true),
  row('api-intake', '收集', 'API 建单配额', '每分钟调用上限', '20 次', '200 次', '600 次'),
  row('attachments', '收集', '附件容量', '截图与录屏占用', '1 GB', '20 GB', '50 GB'),
  row('dedupe', '整理', '重复反馈合并', '相似描述自动归为一条', false, true, true),
  row('tags', '整理', '标签与智能分类', '按模块/主题自动打标', '5 个标签', '无限', '无限'),
  row('search', '整理', '全文检索', '含客户原话与内部备注', '近 30 天', '全量', '全量'),
  row('roadmap', '协作', '公开路线图', '对客户可见的规划页', true, true, true),
  row('voting', '协作', '客户投票', '按票数排序需求', true, true, true),
  row('seats', '协作', '团队席位', '可邀请的内部成员', '3 席', '按购买量', '按购买量'),
  row('comments', '协作', '内部备注与 @ 提及', '只对客户不可见', false, true, true),
  row('roles', '安全与运维', '角色权限', '看板级读写控制', false, false, true),
  row('sso', '安全与运维', 'SSO / SAML', '企业身份源登录', false, false, '已含'),
  row('audit', '安全与运维', '审计日志', '操作留痕与导出', false, false, '已含 90 天'),
  row('retention', '安全与运维', '数据保留策略', '删除与归档规则', false, '1 年', '自定义'),
  row('sla', '安全与运维', '响应时效', '工作时间内首响', '社区', '1 个工作日', '4 小时'),
];

export const FEATURE_GROUPS: readonly FeatureRow['group'][] = ['收集', '整理', '协作', '安全与运维'];

export const ROW_BY_KEY: ReadonlyMap<string, FeatureRow> = new Map(FEATURE_ROWS.map((r) => [r.key, r]));

export interface Faq {
  readonly key: string;
  readonly q: string;
  readonly a: string;
  readonly popularity: number;
}

/** popularity 用于「按热度排序」，演示 toSorted 不可变排序。 */
export const FAQS: readonly Faq[] = [
  {
    key: 'seat-change',
    q: '中途加人或者有人离职，账单会变吗？',
    a: '会。席位按当天实际人数折算，加人只补剩余天数的钱，减人在下一个账期抵扣，不会重开账单周期。',
    popularity: 96,
  },
  {
    key: 'annual-switch',
    q: '月付能改成年付吗？',
    a: '可以，随时在「账单」页切换。切换后当月未使用的余额会折成对应席位月数顺延，不要求重新付款。',
    popularity: 81,
  },
  {
    key: 'free-seats',
    q: '苗木档的 3 个席位算的是谁？',
    a: '只算能登录后台的内部成员。提交反馈的客户、投票客户、以及只读路线图的访客都不占席位。',
    popularity: 74,
  },
  {
    key: 'trial',
    q: '林木档可以先试 14 天吗？',
    a: '可以，不需要信用卡。试用期内可邀请的席位与实际一致，到期未付费则自动降级为苗木，数据保留 90 天。',
    popularity: 62,
  },
  {
    key: 'invoice',
    q: '能开增值税专用发票吗？',
    a: '可以。年付订单支持专票与对公转账；冠层档默认提供季度合并发票和合同主体盖章件。',
    popularity: 45,
  },
  {
    key: 'migration',
    q: '从别的反馈工具迁过来要多久？',
    a: '我们用 CSV / API 导入历史反馈与投票，2 万条以内通常一个工作小时内完成，导入不会额外计费。',
    popularity: 27,
  },
];

export const SUPPORT_CONTACTS: readonly string[] = ['sales@songta.example', '400-820-0000（工作日 9:00-19:00）'];

export const FOOTER_COLUMNS: readonly { title: string; items: readonly string[] }[] = [
  { title: '产品', items: ['反馈看板', '公开路线图', '智能合并', 'API 与 Webhook'] },
  { title: '资源', items: ['实施手册', '迁移指南', '状态页', '更新日志'] },
  { title: '公司', items: ['关于松塔', '安全与合规', '招聘', '联系销售'] },
];
