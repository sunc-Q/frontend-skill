import { useEffect, useState } from 'react';

/** Skill clause: "Debounced search (300-500ms)" — 350ms sits inside the documented band. */
export const SEARCH_DEBOUNCE_MS = 350;

export function useDebouncedValue<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default useDebouncedValue;
