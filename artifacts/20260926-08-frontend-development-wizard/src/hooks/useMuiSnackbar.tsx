import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';

/**
 * Notification channel mandated by the skill ("Use useMuiSnackbar … NEVER react-toastify").
 * Group A greps the dependency graph for any other toast library.
 */

interface SnackbarApi {
  push: (message: string, severity?: SnackbarSeverity) => void;
}
export type SnackbarSeverity = 'success' | 'error' | 'warning' | 'info';

interface SnackState {
  message: string;
  severity: SnackbarSeverity;
  /** monotonic so repeating the same text still re-shows */
  seq: number;
}

const noop: SnackbarApi = { push: () => undefined };
const SnackbarContext = createContext<SnackbarApi>(noop);
const HostContext = createContext<SnackState | null>(null);

export function useMuiSnackbar(): SnackbarApi {
  return useContext(SnackbarContext);
}

export const SnackbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snack, setSnack] = useState<SnackState | null>(null);

  const push = useCallback((message: string, severity: SnackbarSeverity = 'info') => {
    setSnack((prev) => ({ message, severity, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const api = useMemo<SnackbarApi>(() => ({ push }), [push]);
  const close = useCallback((_e?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setSnack(null);
  }, []);

  return (
    <SnackbarContext.Provider value={api}>
      <HostContext.Provider value={snack}>
        {children}
        <Snackbar
          open={snack !== null}
          autoHideDuration={3200}
          onClose={close}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={snack?.severity ?? 'info'} variant="filled" data-seq={snack?.seq}>
            {snack?.message ?? ''}
          </Alert>
        </Snackbar>
      </HostContext.Provider>
    </SnackbarContext.Provider>
  );
};

export const useLatestSnack = (): SnackState | null => useContext(HostContext);

export default SnackbarProvider;
