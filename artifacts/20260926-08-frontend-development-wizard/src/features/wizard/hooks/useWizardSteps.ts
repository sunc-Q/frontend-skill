import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STEPS } from '@/lib/facts';
import type { StepId } from '~types/index';

/**
 * Step travel rules for the wizard. The only forward door is "every step before the target
 * is valid"; backwards is always open so a user can fix an early field without paying the
 * gate again. `canTravel` is exported pure so check-node can exercise the rule table
 * without a DOM.
 */

export const STEP_ORDER: StepId[] = STEPS.map((s) => s.id);

export const stepIndex = (id: StepId): number => Math.max(0, STEP_ORDER.indexOf(id));

export type ValidityMap = Partial<Record<StepId, boolean>>;

export function canTravel(target: StepId, validity: ValidityMap): boolean {
  const to = stepIndex(target);
  if (to === 0) return true;
  for (const id of STEP_ORDER.slice(0, to)) if (validity[id] !== true) return false;
  return true;
}

export function readStepFromHash(hash: string): StepId | null {
  const m = /^#?step=([a-z]+)$/.exec(hash);
  const id = m?.[1];
  return id !== undefined && (STEP_ORDER as string[]).includes(id) ? (id as StepId) : null;
}

export function nextStep(from: StepId): StepId {
  return STEP_ORDER[Math.min(STEP_ORDER.length - 1, stepIndex(from) + 1)] as StepId;
}

export function prevStep(from: StepId): StepId {
  return STEP_ORDER[Math.max(0, stepIndex(from) - 1)] as StepId;
}

export function useWizardSteps(initial: StepId, validity: ValidityMap) {
  const hashStep = readStepFromHash(window.location.hash);
  const [step, setStepState] = useState<StepId>(hashStep ?? initial);
  const [visited, setVisited] = useState<StepId[]>([hashStep ?? initial]);

  const setStep = useCallback((id: StepId) => {
    setStepState(id);
    setVisited((prev) => (prev.includes(id) ? prev : [...prev, id]));
    try {
      window.history.replaceState(null, '', `#step=${id}`);
    } catch {
      /* some embeds block history writes; the step state itself is authoritative */
    }
  }, []);

  const travel = useCallback(
    (target: StepId): boolean => {
      if (stepIndex(target) <= stepIndex(step)) {
        setStep(target);
        return true;
      }
      if (!canTravel(target, validity)) return false;
      setStep(target);
      return true;
    },
    [setStep, step, validity],
  );
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const stepRef = useRef(step);
  stepRef.current = step;

  /* A hand-typed or shared `#step=review` URL must not open a door the gate keeps shut.
     Validity is only known after the first render, so the clamp runs once, as an effect. */
  const clamped = useRef(false);
  useEffect(() => {
    if (clamped.current) return;
    clamped.current = true;
    if (hashStep === null || canTravel(hashStep, validity)) return;
    const furthest = STEP_ORDER.filter((id) => canTravel(id, validity)).pop() ?? 'identity';
    setStep(furthest);
  }, [hashStep, setStep, validity]);

  useEffect(() => {
    const onHash = () => {
      const fromHash = readStepFromHash(window.location.hash);
      if (fromHash === null) return;
      /* refused forward travel rewrites the hash back to where the gate actually allows us */
      if (!travelRef.current(fromHash)) setStep(stepRef.current);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [setStep]);

  const next = useCallback(() => {
    const target = nextStep(step);
    return travel(target);
  }, [step, travel]);

  const back = useCallback(() => {
    travel(prevStep(step));
    return true;
  }, [step, travel]);

  const reachable = useMemo(
    () => Object.fromEntries(STEP_ORDER.map((id) => [id, stepIndex(id) <= stepIndex(step) || canTravel(id, validity)])) as Record<StepId, boolean>,
    [step, validity],
  );

  return { step, setStep, travel, next, back, visited, reachable };
}
