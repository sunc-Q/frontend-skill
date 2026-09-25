import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './routes/router';
import { SnackbarProvider } from '@/hooks/useMuiSnackbar';
import { buildTheme } from '@/lib/style/theme';
import { injectStyleCss, readStyleId } from '@/lib/style/registry';
import { installBridge } from '@/lib/bridge';

const styleId = readStyleId();
injectStyleCss(styleId);
installBridge();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: false },
    mutations: { retry: false },
  },
});

const host = document.getElementById('root');
if (host === null) {
  throw new Error('boot: #root missing — 应用未挂载');
}

// StrictMode is left off on purpose: its double-invoke would double every entry in the
// request log the checks read to prove single-flight caching.
createRoot(host).render(
  <ThemeProvider theme={buildTheme(styleId)}>
    <CssBaseline />
    <QueryClientProvider client={queryClient}>
      <SnackbarProvider>
        <RouterProvider router={router} />
      </SnackbarProvider>
    </QueryClientProvider>
  </ThemeProvider>,
);
