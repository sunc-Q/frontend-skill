import type {
  AddonId,
  AddonSpec,
  BootstrapPayload,
  OptionSpec,
  PlanId,
  PlanSpec,
  StepId,
  WizardValues,
} from '~types/index';

/**
 * The one fact source for all three styles. Nothing in the UI hardcodes a number that
 * is not derived from here (check group E recomputes every printed figure from it).
 */

export const BRAND = {
  zh: '潮汐社',
  latin: 'TIDESIDE',
  product: '手作订阅开站向导',
  year: 2026,
  supportMail: 'hey@tideside.example',
  helpLine: '400-0392-117',
};

export const STEPS: { id: StepId; no: number; title: string; hint: string; fields: (keyof WizardValues)[] }[] = [
  {
    id: 'identity',
    no: 1,
    title: '站点身份',
    hint: '店名、子域名与一句话简介，决定买家看到的第一眼',
    fields: ['storeName', 'subdomain', 'tagline', 'category', 'timezone', 'notify', 'supportPhone'],
  },
  { id: 'plan', no: 2, title: '方案与容量', hint: '套餐、席位与增值模块，费用实时汇总', fields: ['plan', 'seats', 'addons', 'billing', 'currency'] },
  {
    id: 'payment',
    no: 3,
    title: '收款与合规',
    hint: '实名/企业资质、发票与协议，按账户类型分支',
    fields: [
      'accountType',
      'realName',
      'idLast4',
      'companyName',
      'uscc',
      'contactEmail',
      'invoiceType',
      'taxTitle',
      'taxNo',
      'agree',
    ],
  },
  { id: 'review', no: 4, title: '预览与提交', hint: '完整性清单、金额复核与提交回执', fields: [] },
];

export const STEP_FIELDS: Record<StepId, (keyof WizardValues)[]> = STEPS.reduce(
  (acc, s) => ({ ...acc, [s.id]: s.fields }),
  {} as Record<StepId, (keyof WizardValues)[]>,
);

export const ALL_FIELDS: (keyof WizardValues)[] = STEPS.flatMap((s) => s.fields);

export const PLANS: PlanSpec[] = [
  {
    id: 'starter',
    name: '手作摊',
    latin: 'STARTER',
    perSeat: 39,
    platformFee: 0,
    seatMin: 1,
    seatMax: 50,
    annualDiscount: 0.15,
    quota: 500,
    blurb: '一个人也能开起来的摊子，日订单上限 500',
  },
  {
    id: 'studio',
    name: '工坊',
    latin: 'STUDIO',
    perSeat: 29,
    platformFee: 680,
    seatMin: 5,
    seatMax: 200,
    annualDiscount: 0.15,
    quota: 5000,
    blurb: '带学徒的小工坊，含多店铺与批发货',
  },
  {
    id: 'market',
    name: '集市',
    latin: 'MARKET',
    perSeat: 17,
    platformFee: 2680,
    seatMin: 20,
    seatMax: 500,
    annualDiscount: 0.25,
    quota: 50000,
    blurb: '区域集市规模，开放 API 与专属机房',
  },
];

export const planOf = (id: PlanId): PlanSpec =>
  PLANS.find((p) => p.id === id) ?? PLANS[0] as PlanSpec;

export const ADDONS: AddonSpec[] = [
  { id: 'stock', name: '库存同步', mode: 'org', price: 260, note: '与线下台账双向同步，每 5 分钟一次' },
  { id: 'points', name: '会员积分', mode: 'seat', price: 3, note: '按席位计价，积分抵扣与转赠' },
  { id: 'multisite', name: '多仓发货', mode: 'org', price: 480, note: '需先启用库存同步', requires: 'stock' },
  { id: 'receipt', name: '定制小票', mode: 'seat', price: 1.5, note: '按席位计价，手写字体小票模板' },
  {
    id: 'export',
    name: '数据导出',
    mode: 'org',
    price: 120,
    note: '工坊及以上可选',
    minPlan: 'studio',
  },
  { id: 'support', name: '优先客服', mode: 'seat', price: 6, note: '按席位计价，15 分钟首响' },
];

export const addonOf = (id: AddonId): AddonSpec =>
  ADDONS.find((a) => a.id === id) ?? ADDONS[0] as AddonSpec;

/** plan order used by the "minPlan" gate — index in this array is the tier rank */
export const PLAN_RANK: Record<PlanId, number> = { starter: 0, studio: 1, market: 2 };

export const CURRENCY: { id: 'CNY' | 'USD'; label: string; perSeatRate: number; symbol: string }[] = [
  { id: 'CNY', label: '人民币 CNY', perSeatRate: 1, symbol: '¥' },
  { id: 'USD', label: '美元 USD', perSeatRate: 7.15, symbol: '$' },
];

export const OPTIONS: Record<'category' | 'timezone' | 'notify' | 'invoice', OptionSpec[]> = {
  category: [
    { value: 'ceramics', label: '陶艺 / 陶瓷' },
    { value: 'wood', label: '木作 / 竹艺' },
    { value: 'textile', label: '织物 / 染整' },
    { value: 'paper', label: '纸品 / 装帧' },
    { value: 'metal', label: '金工 / 首饰' },
    { value: 'glass', label: '玻璃 / 灯工' },
  ],
  timezone: [
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai（东八区）' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo（东九区）' },
    { value: 'Europe/Berlin', label: 'Europe/Berlin（中欧）' },
    { value: 'America/Los_Angeles', label: 'America/Los_Angeles（太平洋）' },
  ],
  notify: [
    { value: 'email', label: '仅邮件通知' },
    { value: 'phone', label: '仅电话通知' },
    { value: 'both', label: '邮件 + 电话' },
  ],
  invoice: [
    { value: 'none', label: '不需要发票' },
    { value: 'normal', label: '增值税普通发票' },
    { value: 'special', label: '增值税专用发票' },
  ],
};

export const BOOTSTRAP: BootstrapPayload = {
  categories: OPTIONS.category,
  timezones: OPTIONS.timezone,
  notifyChannels: OPTIONS.notify,
  invoiceTypes: OPTIONS.invoice,
  takenSubdomains: ['shop', 'tideside', 'studio-one'],
  reservedSubdomains: ['api', 'www', 'mail'],
  takenEmails: [BRAND.supportMail, 'ops@tideside.example'],
  /* deliberately non-monotonic: a later keystroke can resolve before an earlier one */
  latencyMs: { default: 220, fast: 60, slow: 900, email: 300, submit: 240, bootstrap: 120 },
};

export const DEFAULT_VALUES: WizardValues = {
  storeName: '',
  subdomain: '',
  tagline: '',
  category: '',
  timezone: 'Asia/Shanghai',
  notify: 'email',
  supportPhone: '',
  plan: 'studio',
  seats: 12,
  addons: ['stock'],
  billing: 'monthly',
  currency: 'CNY',
  accountType: 'personal',
  realName: '',
  idLast4: '',
  companyName: '',
  uscc: '',
  contactEmail: '',
  invoiceType: 'none',
  taxTitle: '',
  taxNo: '',
  agree: false,
};

export const DRAFT_KEY = 'tideside.wizard.draft';
export const DRAFT_VERSION = 3;

/* ------------------------------------------------------------------ */
/* GB 32100-2015 统一社会信用代码 — 18 位，校验位 = 31 − (Σ Wi·Ci mod 31) */
/* 字符集排除 I O S V Z，所以正则必须写成 A-H J-N P-R T-U W X Y 六段；  */
/* 图省事的 T-W 会把 V 放进来（本文件第一版就踩了这个），故另加一次逐字符 */
/* indexOf 判定，两处任一失手都会被 E 组断言抓到。                       */
/* ------------------------------------------------------------------ */

export const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
export const USCC_PREFIX17 = '91310115MA1K3X7L0';

const pow3mod31 = (n: number): number => {
  let acc = 1;
  for (let i = 0; i < n; i += 1) acc = (acc * 3) % 31;
  return acc;
};

/** weights[i] = 3^i mod 31, i = 0..16 */
export const USCC_WEIGHTS: number[] = Array.from({ length: 17 }, (_, i) => pow3mod31(i));

export const usccValueOf = (ch: string): number => USCC_CHARS.indexOf(ch.toUpperCase());

/** independent second implementation (fixed table instead of repeated multiply) */
const USCC_WEIGHT_TABLE = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

export function usccCheckChar(first17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += usccValueOf(first17[i] as string) * (USCC_WEIGHTS[i] as number);
  const rest = 31 - (sum % 31);
  return USCC_CHARS[(rest === 31 ? 0 : rest) % 31] as string;
}

export function usccCheckCharTable(first17: string): string {
  const sum = [...first17].reduce((acc, ch, i) => acc + usccValueOf(ch) * (USCC_WEIGHT_TABLE[i] as number), 0);
  return USCC_CHARS[(31 - (sum % 31)) % 31] as string;
}

/** generated once, cross-checked against the second implementation (asserted in group E) */
export const USCC_VALID: string = USCC_PREFIX17 + usccCheckChar(USCC_PREFIX17);

export function usccValid(code: string): boolean {
  /* case-insensitive on purpose: buildPayload uppercases before sending, so a gate that only
     accepted uppercase would reject a code the payload would have shipped as valid */
  if (!/^[0-9A-HJ-NP-RT-UWXY]{18}$/i.test(code)) return false;
  const upper = code.toUpperCase();
  if ([...upper].some((ch) => usccValueOf(ch) < 0)) return false;
  return usccCheckChar(upper.slice(0, 17)) === upper[17];
}

/** A complete, valid submission used by the checks (and by 「载入示例」 in the UI). */
export const SAMPLE_VALUES: WizardValues = {
  ...DEFAULT_VALUES,
  storeName: '潮汐社 · 手作订阅',
  subdomain: 'chaoxi',
  tagline: '每月初寄一件在手的器物',
  category: 'ceramics',
  timezone: 'Asia/Shanghai',
  notify: 'both',
  supportPhone: '13900001174',
  plan: 'studio',
  seats: 14,
  addons: ['stock', 'points', 'multisite'],
  billing: 'annual',
  currency: 'CNY',
  accountType: 'enterprise',
  companyName: '潮汐手作文化传播有限公司',
  uscc: USCC_VALID,
  contactEmail: 'kefu@chaoxi.example',
  invoiceType: 'normal',
  taxTitle: '潮汐手作文化传播有限公司',
  taxNo: USCC_VALID,
  agree: true,
};

