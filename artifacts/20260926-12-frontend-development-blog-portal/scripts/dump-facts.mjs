import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const entryFile = path.join(root, 'scripts', '.facts-entry.mjs');
const bundleFile = path.join(root, 'scripts', '.facts.mjs');

/**
 * The mock origin, the Node checker and the browser all read the same numbers, so none of them may
 * carry a hand-written copy of the corpus: a divergent fixture would silently invalidate every
 * cross-check. This module is imported as a small bundle so Node can read the app's TypeScript.
 */
const ENTRY = `
export { HIATUS, POST_INDEX, TAG_LABEL, TODAY_DAY, DAY0_UTC, POST_COUNT, corpus, dayToMonth, dayToYear, featuredSlug, formatDate, relatedTo } from '${path.join(src, 'lib/facts.ts')}';
export { wireRows } from '${path.join(src, 'features/posts/api/postsApi.ts')}';
export { insightsBuild } from '${path.join(src, 'features/insights/api/insightsApi.ts')}';
export { buildArchive } from '${path.join(src, 'features/archive/helpers/archiveModel.ts')}';
export { filterRows, highlight, hotThreshold, parseBody, prevNext, relatedRows, sortRows, sumMinutes, sumViews, tagCountsOf, toView } from '${path.join(src, 'features/posts/helpers/listModel.ts')}';
export { STYLES, STYLE_IDS, skinCssFor, structuralCss, styleCss } from '${path.join(src, 'lib/style/registry.ts')}';
export { DEFAULT_PREFS, PREFS_KEY, PREFS_VERSION, sanitize } from '${path.join(src, 'lib/prefs.ts')}';
`;

export async function loadFacts() {
  writeFileSync(entryFile, ENTRY, 'utf8');
  await build({
    entryPoints: [entryFile],
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return import(`${bundleFile}?v=${Date.now()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const f = await loadFacts();
  console.log(
    JSON.stringify({
      posts: f.corpus.stats.posts,
      views: f.corpus.stats.views,
      months: f.corpus.stats.months,
      spanMonths: f.corpus.stats.spanMonths,
      longestGap: f.corpus.stats.longestGap,
      streak: f.corpus.stats.streak,
      tags: f.corpus.stats.tags,
      median: f.corpus.stats.medianMinutes,
      avg: f.corpus.stats.avgViews,
      featured: f.featuredSlug(),
      wireRows: f.wireRows().length,
      insightsYears: f.insightsBuild().years.length,
      archiveYears: f.buildArchive(f.wireRows()).length,
      skins: f.STYLE_IDS,
    }),
  );
}
