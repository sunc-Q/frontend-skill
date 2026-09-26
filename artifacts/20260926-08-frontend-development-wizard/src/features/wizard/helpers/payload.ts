import type { AsyncFieldState, WizardValues } from '~types/index';
import { quote } from './pricing';

/**
 * The submit payload. Branch fields that the current branch cannot show must not be able to
 * leak into it — switching 企业 → 个人 leaves companyName/uscc in the form state (they are
 * registered once so the draft round-trips), so the strip below is the only thing between a
 * stale credential and the server. buildPayload is also what the review step prints.
 */

export const ASYNC_FIELDS = ['subdomain', 'contactEmail'] as const;
export type AsyncField = (typeof ASYNC_FIELDS)[number];
export type AsyncMap = Record<AsyncField, AsyncFieldState>;

export const initialAsyncMap = (): AsyncMap => ({
  subdomain: { verdict: 'idle', forValue: '', token: 0 },
  contactEmail: { verdict: 'idle', forValue: '', token: 0 },
});

export interface Blocker {
  field: AsyncField;
  reason: string;
}

/** pending / taken / reserved / error all mean "do not submit", independent of setError */
export function asyncBlockers(map: AsyncMap, values: WizardValues): Blocker[] {
  const out: Blocker[] = [];
  for (const field of ASYNC_FIELDS) {
    const st = map[field];
    const value = String(values[field] ?? '');
    if (value === '' || st.forValue !== value) {
      out.push({ field, reason: `${field} 尚未校验` });
      continue;
    }
    if (st.verdict === 'checking') out.push({ field, reason: `${field} 校验中` });
    if (st.verdict === 'taken') out.push({ field, reason: `${field} 已被占用` });
    if (st.verdict === 'reserved') out.push({ field, reason: `${field} 为保留名` });
    if (st.verdict === 'error') out.push({ field, reason: `${field} 校验失败，请重试` });
  }
  return out;
}

/** deterministic over content: the same data twice is the same token, one edit changes it */
export function submitToken(values: WizardValues): string {
  const q = quote(values);
  return [
    values.subdomain,
    values.plan,
    values.seats,
    values.billing,
    values.currency,
    values.accountType,
    values.invoiceType,
    [...values.addons].sort().join('+'),
    String(q.periodTotal),
  ].join('|');
}

export function buildPayload(values: WizardValues): Record<string, unknown> {
  const q = quote(values);
  const payload: Record<string, unknown> = {
    storeName: values.storeName.trim(),
    subdomain: values.subdomain.trim(),
    host: `${values.subdomain.trim()}.tideside.example`,
    tagline: values.tagline.trim(),
    category: values.category,
    timezone: values.timezone,
    notify: values.notify,
    plan: values.plan,
    seats: values.seats,
    addons: [...values.addons].sort(),
    billing: values.billing,
    currency: values.currency,
    periodTotal: q.periodTotal,
    display: q.display,
    lineCount: q.lines.length,
    accountType: values.accountType,
    contactEmail: values.contactEmail.trim().toLowerCase(),
    invoiceType: values.invoiceType,
    agree: values.agree,
  };
  if (values.notify !== 'email') payload.supportPhone = values.supportPhone.trim();
  if (values.accountType === 'personal') {
    payload.realName = values.realName.trim();
    payload.idLast4 = values.idLast4.trim();
  } else {
    payload.companyName = values.companyName.trim();
    payload.uscc = values.uscc.trim().toUpperCase();
  }
  if (values.invoiceType !== 'none') {
    payload.taxTitle = values.taxTitle.trim();
    payload.taxNo = values.taxNo.trim().toUpperCase();
  }
  return payload;
}

/** the keys each branch is allowed to carry — asserted for all four branch combinations */
export function allowedKeys(values: WizardValues): string[] {
  const base = [
    'storeName',
    'subdomain',
    'host',
    'tagline',
    'category',
    'timezone',
    'notify',
    'plan',
    'seats',
    'addons',
    'billing',
    'currency',
    'periodTotal',
    'display',
    'lineCount',
    'accountType',
    'contactEmail',
    'invoiceType',
    'agree',
  ];
  if (values.notify !== 'email') base.push('supportPhone');
  return base.concat(values.accountType === 'personal' ? ['realName', 'idLast4'] : ['companyName', 'uscc']).concat(
    values.invoiceType === 'none' ? [] : ['taxTitle', 'taxNo'],
  );
}
