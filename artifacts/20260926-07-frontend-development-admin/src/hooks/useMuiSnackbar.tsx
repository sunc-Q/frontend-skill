import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface SnackbarEntry {
  id: number;
  message: string;
  severity: 'success' | 'error' | 'info';
}

export interface MuiSnackbarApi {
  enqueue: (message: string, severity?: SnackbarEntry['severity']) => void;
  entries: SnackbarEntry[];
  dismiss: (id: number) => void;
}

const EMPTY: MuiSnackbarApi = { enqueue: () => {}, entries: [], dismiss: () => {} };
const SnackbarContext = createContext<MuiSnackbarApi>(EMPTY);

/**
 * Skill clause: "Use useMuiSnackbar for user notifications" (import path `@/hooks/useMuiSnackbar`).
 * The hook itself is not shipped by the skill (resources/common-patterns.md is missing), so the
 * implementation below is reconstructed from the one-line rule: MUI Snackbar + Alert, no toast lib.
 */
export function useMuiSnackbar(): MuiSnackbarApi {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: ReactNode }): ReactNode {
  const [entries, setEntries] = useState<SnackbarEntry[]>([]);
  const seq = useRef(0);

  const enqueue = useCallback((message: string, severity: SnackbarEntry['severity'] = 'success') => {
    seq.current += 1;
    const entry: SnackbarEntry = { id: seq.current, message, severity };
    setEntries((cur) => (cur.some((e) => e.message === entry.message) ? cur : [...cur, entry].slice(-3)));
  }, []);

  const dismiss = useCallback((id: number) => {
    setEntries((cur) => cur.filter((e) => e.id !== id));
  }, []);

  const api = useMemo<MuiSnackbarApi>(() => ({ enqueue, entries, dismiss }), [enqueue, entries, dismiss]);
  return <SnackbarContext.Provider value={api}>{children}</SnackbarContext.Provider>;
}

export default useMuiSnackbar;
