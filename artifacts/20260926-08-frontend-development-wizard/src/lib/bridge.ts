import {
  ADDONS,
  ALL_FIELDS,
  BOOTSTRAP,
  BRAND,
  CURRENCY,
  DEFAULT_VALUES,
  DRAFT_KEY,
  DRAFT_VERSION,
  OPTIONS,
  PLANS,
  PLAN_RANK,
  SAMPLE_VALUES,
  STEPS,
  STEP_FIELDS,
  USCC_CHARS,
  USCC_PREFIX17,
  USCC_VALID,
  USCC_WEIGHTS,
  addonOf,
  planOf,
  usccCheckChar,
  usccValid,
} from './facts';
import { requestLog, resetRequestLog } from './apiClient';
import { ARM_NAME, MEMO_ARM, meter, renderCounts, resetRenders, totalRenders } from './ablation';
import { STYLES, STYLE_IDS, paletteOf, styleCss } from './style/registry';
import { clearDraft, draftRaw, loadDraft, saveDraft } from './draft';
import { wizardApi } from '~features/wizard/api/wizardApi';
import {
  allIssues,
  firstIssue,
  issuesForStep,
  stepValid,
  wizardSchema,
} from '~features/wizard/helpers/wizardSchema';
import { annualSaving, clampSeats, halfUpCents, priceLines, quote, quoteDirect, rateOf, toCents } from '~features/wizard/helpers/pricing';
import { ASYNC_FIELDS, allowedKeys, asyncBlockers, buildPayload, submitToken } from '~features/wizard/helpers/payload';
import { FIELDS, FIELD_LABEL, fieldByName, optionFieldsFrom } from '~features/wizard/helpers/fields';
import { asyncMetrics, resetAsyncMetrics } from '~features/wizard/hooks/useWizardAsyncFields';

/** Everything a checker needs to re-derive a number without reading the source twice. */
function factsBundle() {
  return {
    brand: BRAND,
    steps: STEPS,
    stepFields: STEP_FIELDS,
    allFields: ALL_FIELDS,
    plans: PLANS,
    addons: ADDONS,
    planRank: PLAN_RANK,
    currency: CURRENCY,
    options: OPTIONS,
    bootstrap: BOOTSTRAP,
    defaults: DEFAULT_VALUES,
    sample: SAMPLE_VALUES,
    draftKey: DRAFT_KEY,
    draftVersion: DRAFT_VERSION,
    uscc: { chars: USCC_CHARS, prefix17: USCC_PREFIX17, valid: USCC_VALID, weights: USCC_WEIGHTS },
    styles: STYLES,
    styleIds: STYLE_IDS,
    fieldLabels: FIELD_LABEL,
    fields: FIELDS.map((f) => ({ name: f.name, kind: f.kind, label: f.label })),
    asyncFields: ASYNC_FIELDS,
  };
}

export interface FdBridge {
  version: string;
  facts: ReturnType<typeof factsBundle>;
  api: {
    requestLog: typeof requestLog;
    resetRequestLog: typeof resetRequestLog;
    wizard: typeof wizardApi;
  };
  draft: {
    load: typeof loadDraft;
    save: typeof saveDraft;
    clear: typeof clearDraft;
    raw: typeof draftRaw;
  };
  pricing: {
    quote: typeof quote;
    quoteDirect: typeof quoteDirect;
    priceLines: typeof priceLines;
    halfUpCents: typeof halfUpCents;
    clampSeats: typeof clampSeats;
    annualSaving: typeof annualSaving;
    rateOf: typeof rateOf;
    toCents: typeof toCents;
  };
  validation: {
    schema: typeof wizardSchema;
    allIssues: typeof allIssues;
    issuesForStep: typeof issuesForStep;
    stepValid: typeof stepValid;
    firstIssue: typeof firstIssue;
  };
  payload: {
    build: typeof buildPayload;
    allowedKeys: typeof allowedKeys;
    blockers: typeof asyncBlockers;
    token: typeof submitToken;
  };
  lookup: {
    planOf: typeof planOf;
    addonOf: typeof addonOf;
    fieldByName: typeof fieldByName;
    optionFieldsFrom: typeof optionFieldsFrom;
    usccCheckChar: typeof usccCheckChar;
    usccValid: typeof usccValid;
  };
  style: { paletteOf: typeof paletteOf; styleCss: typeof styleCss };
  ablation: {
    memoArm: typeof MEMO_ARM;
    armName: typeof ARM_NAME;
    meter: typeof meter;
    counts: typeof renderCounts;
    total: typeof totalRenders;
    reset: typeof resetRenders;
  };
  asyncMetrics: typeof asyncMetrics;
  resetAsyncMetrics: typeof resetAsyncMetrics;
}

/**
 * Read-only window for the verification scripts. No product behaviour depends on it, so
 * deleting installBridge() leaves the UI working exactly as before.
 */
export function installBridge(): void {
  const bridge: FdBridge = {
    version: '20260926-08',
    facts: factsBundle(),
    api: { requestLog, resetRequestLog, wizard: wizardApi },
    draft: { load: loadDraft, save: saveDraft, clear: clearDraft, raw: draftRaw },
    pricing: {
      quote,
      quoteDirect,
      priceLines,
      halfUpCents,
      clampSeats,
      annualSaving,
      rateOf,
      toCents,
    },
    validation: {
      schema: wizardSchema,
      allIssues,
      issuesForStep,
      stepValid,
      firstIssue,
    },
    payload: {
      build: buildPayload,
      allowedKeys,
      blockers: asyncBlockers,
      token: submitToken,
    },
    lookup: { planOf, addonOf, fieldByName, optionFieldsFrom, usccCheckChar, usccValid },
    style: { paletteOf, styleCss },
    ablation: {
      memoArm: MEMO_ARM,
      armName: ARM_NAME,
      meter,
      counts: renderCounts,
      total: totalRenders,
      reset: resetRenders,
    },
    asyncMetrics,
    resetAsyncMetrics,
  };
  (window as unknown as { __fdBridge: FdBridge }).__fdBridge = bridge;
}
