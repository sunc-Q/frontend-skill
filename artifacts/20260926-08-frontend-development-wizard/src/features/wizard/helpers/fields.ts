import { OPTIONS } from '@/lib/facts';
import type { BootstrapPayload, OptionSpec, WizardValues } from '~types/index';
import type { FieldKind, FieldLeafProps } from '../components/FieldText';

/**
 * The field table. Labels, hints and widget kinds live here (not in JSX) so the UI, the
 * completeness list and the checks all read one list — 22 registered fields, and group A
 * asserts every entry appears in exactly one step.
 */

export interface FieldDescriptor {
  name: keyof WizardValues;
  label: string;
  kind: FieldKind;
  hint?: string;
  options?: readonly OptionSpec[];
  wide?: boolean;
  placeholder?: string;
}

/** labels are shared by the review table and the completeness list */
export const FIELD_LABEL: Record<keyof WizardValues, string> = {
  storeName: '店铺名称',
  subdomain: '子域名',
  tagline: '一句话简介',
  category: '主营品类',
  timezone: '营业时区',
  notify: '到货通知方式',
  supportPhone: '客服电话',
  plan: '订阅套餐',
  seats: '席位数',
  addons: '增值模块',
  billing: '结算周期',
  currency: '结算币种',
  accountType: '收款主体',
  realName: '收款人实名',
  idLast4: '证件号后四位',
  companyName: '企业名称',
  uscc: '统一社会信用代码',
  contactEmail: '联系邮箱',
  invoiceType: '发票类型',
  taxTitle: '开票抬头',
  taxNo: '开票税号',
  agree: '服务协议',
};

const CURRENCY_OPTIONS: readonly OptionSpec[] = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD（按 7.15 折算）' },
];

export const FIELDS: FieldDescriptor[] = [
  {
    name: 'storeName',
    label: FIELD_LABEL.storeName,
    kind: 'text',
    hint: '2-24 个字，会出现在分享卡片上',
    placeholder: '例如：南山陶舍',
  },
  {
    name: 'subdomain',
    label: FIELD_LABEL.subdomain,
    kind: 'text',
    hint: '3-20 位小写字母/数字/连字符，占用情况实时校验',
    placeholder: 'shop',
  },
  { name: 'tagline', label: FIELD_LABEL.tagline, kind: 'counter', hint: '不超过 40 字' },
  { name: 'category', label: FIELD_LABEL.category, kind: 'select', options: OPTIONS.category },
  { name: 'timezone', label: FIELD_LABEL.timezone, kind: 'select', options: OPTIONS.timezone },
  { name: 'notify', label: FIELD_LABEL.notify, kind: 'select', options: OPTIONS.notify },
  { name: 'supportPhone', label: FIELD_LABEL.supportPhone, kind: 'tel', hint: '启用电话通知后必填', wide: true },
  { name: 'currency', label: FIELD_LABEL.currency, kind: 'select', options: CURRENCY_OPTIONS },
  { name: 'realName', label: FIELD_LABEL.realName, kind: 'text', hint: '2-6 个字，与证件一致' },
  { name: 'idLast4', label: FIELD_LABEL.idLast4, kind: 'text', hint: '4 位数字，末位可为 X' },
  { name: 'companyName', label: FIELD_LABEL.companyName, kind: 'text', hint: '至少 6 个字' },
  {
    name: 'uscc',
    label: FIELD_LABEL.uscc,
    kind: 'text',
    hint: '18 位，含 mod 31 校验位',
    placeholder: '91310115MA1K3X7L0P',
    wide: true,
  },
  { name: 'contactEmail', label: FIELD_LABEL.contactEmail, kind: 'text', hint: '已注册邮箱会被拒绝' },
  { name: 'invoiceType', label: FIELD_LABEL.invoiceType, kind: 'select', options: OPTIONS.invoice },
  { name: 'taxTitle', label: FIELD_LABEL.taxTitle, kind: 'text', hint: '与营业执照一致' },
  { name: 'taxNo', label: FIELD_LABEL.taxNo, kind: 'text', hint: '企业账户须与信用代码相同' },
  { name: 'agree', label: FIELD_LABEL.agree, kind: 'switch', wide: true },
];

export const fieldByName = (name: keyof WizardValues): FieldDescriptor | undefined =>
  FIELDS.find((f) => f.name === name);

/** same descriptors, but with the option lists the server actually answered with */
export function optionFieldsFrom(p: BootstrapPayload, names: readonly (keyof WizardValues)[]): FieldDescriptor[] {
  const table: Partial<Record<keyof WizardValues, readonly OptionSpec[]>> = {
    category: p.categories,
    timezone: p.timezones,
    notify: p.notifyChannels,
    invoiceType: p.invoiceTypes,
  };
  return names.flatMap((n) => {
    const d = fieldByName(n);
    if (d === undefined) return [];
    return [{ ...d, options: table[n] ?? d.options ?? [] }];
  });
}

export const leafPropsFor = (d: FieldDescriptor): Omit<FieldLeafProps, 'reveal' | 'asyncText' | 'dirtyText' | 'countText'> => ({
  name: d.name,
  label: d.label,
  kind: d.kind,
  hint: d.hint ?? '',
  options: d.options,
  wide: d.wide ?? false,
  placeholder: d.placeholder ?? '',
});
