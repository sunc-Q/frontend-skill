import { useCallback, useEffect, useState } from 'react';

/** Two-step confirmation: first click arms, second click within the window commits. */
export function useTwoStep(onCommit: () => void, windowMs = 3000): [() => void, boolean, () => void] {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), windowMs);
    return () => window.clearTimeout(timer);
  }, [armed, windowMs]);

  const click = useCallback(() => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onCommit();
  }, [armed, onCommit]);

  const cancel = useCallback(() => setArmed(false), []);
  return [click, armed, cancel];
}

export function actLabel(armed: boolean, verb: string): string {
  return armed ? `再点一次确认${verb}` : verb;
}

export default useTwoStep;
