import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * Debounced invocation (the skill's "debounced search 300-500ms" clause, applied to async
 * validators instead of a search box). Timers are cleared on unmount — group F asserts the
 * cleanup clause of the performance guide is actually honoured.
 */
export interface DebouncedRunner {
  run: (...args: string[]) => void;
  cancel: () => void;
  pendingCount: () => number;
  /** last scheduled-at stamp so the checks can measure the gap without guessing */
  lastScheduledAt: () => number;
}

export function useDebouncedCallback(fn: (value: string) => void, delayMs: number): DebouncedRunner {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(0);
  const scheduledAt = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const run = useCallback(
    (value: string) => {
      cancel();
      pending.current += 1;
      scheduledAt.current = Date.now();
      timer.current = setTimeout(() => {
        pending.current -= 1;
        timer.current = null;
        fnRef.current(value);
      }, delayMs);
    },
    [cancel, delayMs],
  );

  useEffect(() => cancel, [cancel]);

  return useMemo(
    () => ({ run, cancel, pendingCount: () => pending.current, lastScheduledAt: () => scheduledAt.current }),
    [run, cancel],
  );
}

export const ASYNC_DEBOUNCE_MS = 350;
