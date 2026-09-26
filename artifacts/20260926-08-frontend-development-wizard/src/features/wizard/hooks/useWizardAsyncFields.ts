import { useCallback, useRef, useState } from 'react';
import { useAsyncCheck } from '~features/bootstrap/hooks/useBootstrapQuery';
import { initialAsyncMap } from '../helpers/payload';
import type { AsyncField, AsyncMap } from '../helpers/payload';
import { ASYNC_ERROR_TEXT } from '../helpers/asyncText';

/**
 * Async field validation with a monotonic token per field.
 *
 * The trap this exists for: the mock server resolves `fast` (60ms) sooner than an earlier
 * `slow` (900ms) request, so a naive implementation lets the *older* keystroke decide the
 * final verdict. `latestRef` is the only thing that can tell a stale response apart, and
 * `staleDropped` is the counter group F reads to prove the guard fired rather than that the
 * test merely happened to be lucky.
 */

export interface AsyncMetrics {
  requests: number;
  applied: number;
  staleDropped: number;
  errorWrites: number;
  errorClears: number;
}

export const asyncMetrics: AsyncMetrics = { requests: 0, applied: 0, staleDropped: 0, errorWrites: 0, errorClears: 0 };

export function resetAsyncMetrics(): void {
  asyncMetrics.requests = 0;
  asyncMetrics.applied = 0;
  asyncMetrics.staleDropped = 0;
  asyncMetrics.errorWrites = 0;
  asyncMetrics.errorClears = 0;
}

type SetError = (field: AsyncField, message: string) => void;
type ClearError = (field: AsyncField) => void;

export function useWizardAsyncFields(setError: SetError, clearErrors: ClearError) {
  const check = useAsyncCheck();
  const [map, setMap] = useState<AsyncMap>(initialAsyncMap);
  const latestRef = useRef<Record<AsyncField, number>>({ subdomain: 0, contactEmail: 0 });
  const mapRef = useRef<AsyncMap>(map);
  mapRef.current = map;

  const requestCheck = useCallback(
    async (field: AsyncField, value: string): Promise<void> => {
      const trimmed = value.trim();
      const token = (latestRef.current[field] += 1);
      asyncMetrics.requests += 1;
      if (trimmed === '') {
        setMap((prev) => ({ ...prev, [field]: { verdict: 'idle', forValue: '', token } }));
        asyncMetrics.errorClears += 1;
        clearErrors(field);
        return;
      }
      setMap((prev) => ({ ...prev, [field]: { verdict: 'checking', forValue: trimmed, token } }));
      const res = field === 'subdomain' ? await check.subdomain(trimmed) : await check.email(trimmed);
      const isStale = latestRef.current[field] !== token;
      if (isStale) {
        asyncMetrics.staleDropped += 1;
        return;
      }
      asyncMetrics.applied += 1;
      setMap((prev) => ({ ...prev, [field]: { verdict: res.verdict, forValue: trimmed, token } }));
      if (res.verdict === 'available') {
        asyncMetrics.errorClears += 1;
        clearErrors(field);
      } else {
        asyncMetrics.errorWrites += 1;
        setError(field, ASYNC_ERROR_TEXT[res.verdict] ?? '校验未通过');
      }
    },
    [check, setError, clearErrors],
  );

  return { asyncMap: map, asyncMapRef: mapRef, requestCheck };
}
