import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { installBridge } from '@/lib/bridge';
import { injectStyleCss } from '@/lib/style/registry';

injectStyleCss();
installBridge();

const queryClient = new QueryClient({
  defaultOptions: {
    // The corpus never changes during a session, so a remount must not re-read it.
    queries: { staleTime: Infinity, retry: false },
    mutations: { retry: false },
  },
});

const host = document.getElementById('root');

/**
 * StrictMode stays off on purpose: its double-invoke would double every entry in the request log
 * and in the render counters, which is exactly what groups G and N measure. The measurement would
 * still be internally consistent, but it would no longer be the number a real build ships.
 */
function mount(): void {
  if (host === null) {
    throw new Error('boot: #root 缺失 — 应用未挂载');
  }
  createRoot(host).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

mount();
