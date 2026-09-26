import { z } from 'zod';
import { ADDONS, OPTIONS, PLAN_RANK, PLANS, usccValid } from '@/lib/facts';
import { charCount } from '@/lib/format';
import type { AddonId, PlanId, WizardValues } from '~types/index';

/**
 * One zod schema drives everything: the step gate, the per-field messages, the
 * completeness list and the submit payload. `values` is the single shape shared by the
 * form defaultValues, the draft envelope and this inference (no parallel hand-written
 * interface is allowed to drift from it).
 */

const phone = /^1[3-9]\d{9}$/;
const subdomainRe = /^[a-z][a-z0-9-]{1,18}[a-z0-9]$/;
const idLast4Re = /^(\d{4}|\d{3}[xX])$/;

const inOptions = (list: { value: string }[], v: string): boolean => list.some((o) => o.value === v);
const planIds = PLANS.map((p) => p.id) as [PlanId, ...PlanId[]];
const addonIds = ADDONS.map((a) => a.id) as [AddonId, ...AddonId[]];

export const wizardSchema = z
  .object({
    storeName: z
      .string()
      .trim()
      .min(2, '店名至少 2 个字')
      .max(24, '店名最多 24 个字'),
    subdomain: z
      .string()
      .trim()
      .regex(subdomainRe, '3-20 位小写字母、数字或连字符，首字符须为字母、尾字符不可为连字符'),
    tagline: z
      .string()
      .trim()
      .min(4, '简介至少 4 个字')
      .max(120, '简介太长了')
      .refine((v) => charCount(v) <= 40, '简介不超过 40 字'),
    category: z.string().refine((v) => inOptions(OPTIONS.category, v), '请选择主营品类'),
    timezone: z.string().refine((v) => inOptions(OPTIONS.timezone, v), '请选择时区'),
    notify: z.enum(['email', 'phone', 'both']),
    supportPhone: z.string().trim(),
    plan: z.enum(planIds),
    seats: z.number(),
    addons: z.array(z.enum(addonIds)),
    billing: z.enum(['monthly', 'annual']),
    currency: z.enum(['CNY', 'USD']),
    accountType: z.enum(['personal', 'enterprise']),
    realName: z.string().trim(),
    idLast4: z.string().trim(),
    companyName: z.string().trim(),
    uscc: z.string().trim(),
    contactEmail: z.string().trim(),
    invoiceType: z.enum(['none', 'normal', 'special']),
    taxTitle: z.string().trim(),
    taxNo: z.string().trim(),
    agree: z.boolean(),
  })
  .superRefine((v, ctx) => {
    /* --- 条件必填：通知方式含电话时，客服电话必须有且合法 --- */
    if (v.notify !== 'email') {
      if (v.supportPhone === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['supportPhone'], message: '启用电话通知后必须填写客服电话' });
      } else if (!phone.test(v.supportPhone)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['supportPhone'], message: '客服电话应为 11 位手机号' });
      }
    } else if (v.supportPhone !== '' && !phone.test(v.supportPhone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['supportPhone'], message: '客服电话应为 11 位手机号' });
    }

    /* --- 席位范围随套餐变化（改套餐后必须重新钳制） --- */
    const plan = PLANS.find((p) => p.id === v.plan);
    if (plan !== undefined) {
      if (!Number.isInteger(v.seats)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seats'], message: '席位必须是整数' });
      } else if (v.seats < plan.seatMin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['seats'],
          message: `${plan.name} 至少 ${plan.seatMin} 个席位`,
        });
      } else if (v.seats > plan.seatMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['seats'],
          message: `${plan.name} 最多 ${plan.seatMax} 个席位`,
        });
      }
    }

    /* --- 模块依赖与套餐门槛 --- */
    const picked = new Set(v.addons);
    for (const a of ADDONS) {
      if (!picked.has(a.id)) continue;
      if (a.requires !== undefined && !picked.has(a.requires)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addons'],
          message: `「${a.name}」需要先启用「${ADDONS.find((x) => x.id === a.requires)?.name ?? a.requires}」`,
        });
      }
      if (a.minPlan !== undefined && (PLAN_RANK[v.plan] ?? 0) < (PLAN_RANK[a.minPlan] ?? 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['addons'],
          message: `「${a.name}」仅 ${PLANS.find((p) => p.id === a.minPlan)?.name} 及以上套餐可选`,
        });
      }
    }

    /* --- 账户类型分支 --- */
    if (v.accountType === 'personal') {
      if (v.realName === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['realName'], message: '个人收款需填写实名' });
      } else if (charCount(v.realName) < 2 || charCount(v.realName) > 6) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['realName'], message: '实名应为 2-6 个字' });
      }
      if (!idLast4Re.test(v.idLast4)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['idLast4'], message: '请填写证件号后 4 位（末位可为 X）' });
      }
    } else {
      if (charCount(v.companyName) < 6) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['companyName'], message: '企业名称至少 6 个字' });
      }
      if (!usccValid(v.uscc)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['uscc'], message: '统一社会信用代码校验位不正确' });
      }
    }

    /* --- 邮箱 --- */
    if (v.contactEmail === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactEmail'], message: '请填写联系邮箱' });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contactEmail)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contactEmail'], message: '邮箱格式不正确' });
    }

    /* --- 发票分支：专票只能开给企业，且抬头/税号必须与资质一致 --- */
    if (v.invoiceType !== 'none') {
      if (v.taxTitle === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taxTitle'], message: '开票必须填写抬头' });
      }
      if (v.taxNo === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taxNo'], message: '开票必须填写税号' });
      }
      if (v.invoiceType === 'special' && v.accountType !== 'enterprise') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['invoiceType'],
          message: '增值税专用发票只开放给企业认证账户',
        });
      }
      if (v.accountType === 'enterprise' && v.taxNo !== '' && v.uscc !== '' && v.taxNo !== v.uscc) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['taxNo'], message: '开票税号应与统一社会信用代码一致' });
      }
    }

    if (v.agree !== true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['agree'], message: '请勾选服务协议' });
    }
  });

export type WizardFormValues = z.infer<typeof wizardSchema>;

/** keep `WizardValues` and the inferred schema type from drifting apart (assertion A13) */
export const TYPES_AGREE: true = ((): true => {
  const a: WizardValues = null as unknown as WizardFormValues;
  const b: WizardFormValues = null as unknown as WizardValues;
  void a;
  void b;
  return true;
})();

export type FieldName = keyof WizardValues;

export interface IssueLite {
  path: string;
  message: string;
}

/** pure, RHF-free validation: the gate and the completeness list are derived from this */
export function allIssues(values: WizardValues): IssueLite[] {
  const parsed = wizardSchema.safeParse(values);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function issuesForStep(values: WizardValues, fields: FieldName[]): IssueLite[] {
  const set = new Set(fields as string[]);
  return allIssues(values).filter((i) => set.has(i.path));
}

export function stepValid(values: WizardValues, fields: FieldName[]): boolean {
  return issuesForStep(values, fields).length === 0;
}

export function firstIssue(values: WizardValues, field: FieldName): string | undefined {
  return allIssues(values).find((i) => i.path === field)?.message;
}
