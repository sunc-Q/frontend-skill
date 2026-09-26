import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { matchRoute } from './routes/router';
import { wizardRoute } from './routes/wizard/index';
import { SnackbarProvider } from '@/hooks/useMuiSnackbar';
import { buildTheme } from '@/lib/style/theme';
import { injectStyleCss, readStyleId } from '@/lib/style/registry';
import { installBridge } from '@/lib/bridge';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';

const styleId = readStyleId();
injectStyleCss(styleId);
installBridge();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: false },
    mutations: { retry: false },
  },
});

const routes = [wizardRoute];
const route = matchRoute(routes, window.location.pathname === '/' ? '/wizard' : window.location.pathname);

const host = document.getElementById('root');

/**
 * StrictMode stays off on purpose: its double-invoke would double every entry in the request
 * log and the render counters, which is exactly what groups F and N measure.
 */
function mount(): void {
  if (host === null) {
    throw new Error('boot: #root missing — 应用未挂载');
  }
  createRoot(host).render(
    <ThemeProvider theme={buildTheme(styleId)}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <SnackbarProvider>
          {/* Skill clause: no early-return spinners — the boundary reserves the space. */}
          <SuspenseLoader minHeight={520} label={`路由 ${route.path}`}>
            <route.component />
          </SuspenseLoader>
        </SnackbarProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/**
 * The loader warms the bootstrap cache; it does NOT gate the first paint. Awaiting it here
 * looked harmless while the mock answered in 120ms, but against a slow origin (?api=1) it
 * meant ~2s of literally nothing on screen — no skeleton, no reserved height, no shell — and
 * no SuspenseLoader can fix a page that was never mounted. The query is still single-flight:
 * ensureQueryData and the page's useSuspenseQuery share one request.
 */
void route?.loader?.({ queryClient, hash: window.location.hash }).catch(() => undefined);
mount();
