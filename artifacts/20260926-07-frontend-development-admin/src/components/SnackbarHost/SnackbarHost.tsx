import { Alert, Snackbar } from '@mui/material';
import type { ReactNode } from 'react';
import { useMuiSnackbar } from '@/hooks/useMuiSnackbar';

export function SnackbarHost(): ReactNode {
  const { entries, dismiss } = useMuiSnackbar();
  const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return (
    <>
      <span data-fd-toast-count={String(entries.length)} hidden />
      <Snackbar
        open={last !== undefined}
        autoHideDuration={2600}
        onClose={(_e, reason) => {
          if (last !== undefined && (reason === 'timeout' || reason === 'clickaway')) dismiss(last.id);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={last?.severity ?? 'info'} variant="outlined" data-fd="toast">
          {last?.message ?? ''}
        </Alert>
      </Snackbar>
    </>
  );
}

export default SnackbarHost;
