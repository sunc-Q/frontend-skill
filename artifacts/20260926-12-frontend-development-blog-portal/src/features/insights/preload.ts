import type { ComponentType } from 'react';

/**
 * The one place that knows how the heavy panel is loaded, so `lazy()` and the pointer-enter
 * warm-up call the *same* function. Prefetching only the query would leave the panel waiting on
 * the module: with `loadInsightsPanel()` wired into the hover, the read and the chunk are both in
 * flight before the click (check-dom H35/H39 measures the click path). Over the split build the
 * module is a real network chunk, so warming it is half of the clause rather than polish.
 */
export function loadInsightsPanel(): Promise<{ default: ComponentType }> {
  return import('./components/InsightsPanel').then((m) => ({ default: m.InsightsPanel }));
}
