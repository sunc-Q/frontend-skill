export { insightsApi } from './api/insightsApi';
export { useInsightsData, usePreloadInsights } from './hooks/useInsights';
export type { InsightsPayload } from './types';

/**
 * `InsightsPanel` is intentionally NOT re-exported here.
 *
 * The skill's feature checklist ends with "Export public API from feature index.ts", and the
 * obvious reading is "export the component too". Doing that would let any consumer reach the chart
 * module through the barrel with a plain static import, which folds it back into the entry chunk
 * and silently cancels the lazy boundary the route relies on. Group L measures that boundary, so
 * the panel is imported by its own path at exactly one call site: routes/post/index.tsx.
 */
