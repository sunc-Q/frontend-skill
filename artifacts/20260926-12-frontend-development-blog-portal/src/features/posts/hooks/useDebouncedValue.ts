import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Skill clause: "Debounced search (300-500ms)". 350ms, same value the lab used in the
 * 16:00 / 07:00 / 08:00 rounds so the debounce group of the checks stays comparable.
 * The timer is cleared on unmount — the skill's "memory leak prevention" clause.
 */
export function useDebouncedValue<T>(value: T, delay = 350): [T, () => void] {
  const [settled, setSettled] = useState<T>(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setSettled(value);
  }, [value]);

  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setSettled(value);
    }, delay);
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [value, delay]);

  return [settled, flush];
}
