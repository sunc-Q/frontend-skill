import { DEFAULT_VALUES, DRAFT_KEY, DRAFT_VERSION, STEPS } from './facts';
import type { DraftEnvelope, StepId, WizardValues } from '~types/index';

/**
 * Draft persistence with a versioned envelope. Everything read back from localStorage is
 * treated as hostile input: unknown keys are dropped (and recorded), wrong types fall back
 * field-by-field, and a version mismatch starts from defaults instead of half-applying.
 */

const KNOWN = new Set(Object.keys(DEFAULT_VALUES) as (keyof WizardValues)[]);
const STEP_IDS = new Set(STEPS.map((s) => s.id));

export type DraftReason = 'none' | 'missing' | 'corrupt' | 'version' | 'restored';

export interface DraftResult {
  values: WizardValues;
  step: StepId;
  restored: boolean;
  reason: DraftReason;
  droppedKeys: string[];
  defaultedKeys: (keyof WizardValues)[];
  savedAt: string | null;
}

const store = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    /* file:// origins can throw on access — degrade to no persistence, never crash */
    return null;
  }
};

function coerce(key: keyof WizardValues, raw: unknown): { ok: boolean; value: unknown } {
  const want = DEFAULT_VALUES[key];
  if (Array.isArray(want)) {
    if (!Array.isArray(raw)) return { ok: false, value: want };
    const good = raw.filter((x) => typeof x === 'string') as string[];
    return { ok: true, value: good };
  }
  if (typeof want === 'number') {
    return typeof raw === 'number' && Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, value: want };
  }
  if (typeof want === 'boolean') {
    return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, value: want };
  }
  return typeof raw === 'string' ? { ok: true, value: raw } : { ok: false, value: want };
}

export function loadDraft(): DraftResult {
  const ls = store();
  const raw = ls === null ? null : ls.getItem(DRAFT_KEY);
  const base: DraftResult = {
    values: { ...DEFAULT_VALUES },
    step: 'identity',
    restored: false,
    reason: 'missing',
    droppedKeys: [],
    defaultedKeys: [],
    savedAt: null,
  };
  if (raw === null) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...base, reason: 'corrupt' };
  }
  const env = parsed as Partial<DraftEnvelope>;
  if (typeof env !== 'object' || env === null || typeof env.values !== 'object' || env.values === null) {
    return { ...base, reason: 'corrupt' };
  }
  if (env.version !== DRAFT_VERSION) return { ...base, reason: 'version' };

  const source = env.values as unknown as Record<string, unknown>;
  const values: WizardValues = { ...DEFAULT_VALUES };
  const droppedKeys: string[] = [];
  const defaultedKeys: (keyof WizardValues)[] = [];
  for (const [key, val] of Object.entries(source)) {
    if (!KNOWN.has(key as keyof WizardValues)) {
      droppedKeys.push(key);
      continue;
    }
    const { ok, value } = coerce(key as keyof WizardValues, val);
    if (ok) {
      (values as unknown as Record<string, unknown>)[key] = value;
    } else {
      defaultedKeys.push(key as keyof WizardValues);
    }
  }
  const step = STEP_IDS.has(env.step as StepId) ? (env.step as StepId) : 'identity';
  return { values, step, restored: true, reason: 'restored', droppedKeys, defaultedKeys, savedAt: env.savedAt ?? null };
}

export function saveDraft(values: WizardValues, step: StepId): DraftEnvelope {
  const env: DraftEnvelope = { version: DRAFT_VERSION, step, values, savedAt: new Date().toISOString() };
  const ls = store();
  if (ls !== null) {
    try {
      ls.setItem(DRAFT_KEY, JSON.stringify(env));
    } catch {
      /* quota / private mode: the wizard keeps working without persistence */
    }
  }
  return env;
}

export function clearDraft(): void {
  store()?.removeItem(DRAFT_KEY);
}

export function draftRaw(): string | null {
  return store()?.getItem(DRAFT_KEY) ?? null;
}
