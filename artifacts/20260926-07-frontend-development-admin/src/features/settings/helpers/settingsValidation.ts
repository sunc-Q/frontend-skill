import { z } from 'zod';
import type { Settings } from '~types/index';

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export const settingsSchema = z.object({
  serviceName: z
    .string()
    .trim()
    .min(1, { message: '服务名称不能为空' })
    .max(30, { message: '服务名称不得超过 30 字' }),
  defaultDomain: z.string().regex(DOMAIN_RE, { message: '请填写合法域名（小写字母、数字、点、横线）' }),
  weeklyDigest: z.boolean(),
  slowLinkAlert: z.boolean(),
  pageSize: z
    .number({ message: '每页条数须为 5–50 的整数' })
    .int({ message: '每页条数须为 5–50 的整数' })
    .min(5, { message: '每页条数须为 5–50 的整数' })
    .max(50, { message: '每页条数须为 5–50 的整数' }),
});

export type SettingsField = keyof Settings;

/**
 * Second-path oracle for the checks: the error text RHF renders must equal what this
 * function returns for the same draft, which is how a resolver/field-name drift gets caught.
 */
export function validateSettings(draft: Settings): Partial<Record<SettingsField, string>> {
  const parsed = settingsSchema.safeParse(draft);
  if (parsed.success) return {};
  const out: Partial<Record<SettingsField, string>> = {};
  for (const issue of parsed.error.issues) {
    const raw = issue.path[0];
    if (typeof raw !== 'string') continue;
    const key = raw as SettingsField;
    if (out[key] === undefined) out[key] = issue.message;
  }
  return out;
}
