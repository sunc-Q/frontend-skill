import { checkEmail, checkSubdomain, submitWizard, serverAudit } from '@/lib/apiClient';
import type { SubmitBody } from '@/lib/apiClient';
import type { SubdomainVerdict } from '@/lib/apiClient';
import type { SubmitResponse } from '~types/index';

/**
 * API service layer (`features/{feature}/api/{feature}Api.ts` per the skill's feature
 * checklist). Route format is `/wizard/...`, never `/api/wizard/...`.
 */

export const WIZARD_ROUTES = {
  subdomain: '/wizard/check-subdomain',
  email: '/wizard/check-email',
  submit: '/wizard/submit',
  audit: '/wizard/audit',
} as const;

export const wizardApi = {
  checkSubdomain: (value: string): Promise<SubdomainVerdict> => checkSubdomain(value),
  checkEmail: (value: string): Promise<SubdomainVerdict> => checkEmail(value),
  submit: (body: SubmitBody): Promise<SubmitResponse> => submitWizard(body) as Promise<SubmitResponse>,
  audit: (payload: Record<string, unknown>): Promise<string[]> => serverAudit(payload),
};

export type { SubdomainVerdict, SubmitBody };
