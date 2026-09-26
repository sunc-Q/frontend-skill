import { renderCounts, resetRenderCounts } from './counter';
import { arm } from './ablation';
import { reqLog, resetReqLog } from './transport';
import { DEFAULT_PREFS, PREFS_KEY, PREFS_VERSION, loadPrefs, sanitize, savePrefs } from './prefs';
import { POSTS_KEY, insightsKey, postKey, postsKey } from '~features/posts/api/queryKeys';
import { POST_COUNT, TODAY_DAY, corpus, dayToMonth, featuredSlug, formatDate, relatedTo } from '@/lib/facts';
import { STYLES, STYLE_IDS, structuralCss, styleCss } from '@/lib/style/registry';
import { buildArchive } from '~features/archive/helpers/archiveModel';
import { filterRows, highlight, hotThreshold, parseBody, prevNext, sortRows, sumMinutes, sumViews, tagCountsOf, toView } from '~features/posts/helpers/listModel';
import { wireRows } from '~features/posts/api/postsApi';

/**
 * Read-only window for the verification scripts. Nothing in the product path imports this file's
 * return value, so deleting `installBridge()` leaves the UI byte-for-byte as before.
 *
 * It deliberately does NOT reference the insights panel: a static import there would fold the
 * lazy chunk back into the entry bundle and quietly destroy the thing group L measures.
 */
export interface FdBridge {
  version: string;
  arm: typeof arm;
  facts: {
    postCount: number;
    todayDay: number;
    corpus: typeof corpus;
    wireRows: () => ReturnType<typeof wireRows>;
    featuredSlug: () => string;
    relatedTo: typeof relatedTo;
    dayToMonth: typeof dayToMonth;
    formatDate: typeof formatDate;
  };
  model: {
    filterRows: typeof filterRows;
    sortRows: typeof sortRows;
    hotThreshold: typeof hotThreshold;
    toView: typeof toView;
    tagCountsOf: typeof tagCountsOf;
    sumViews: typeof sumViews;
    sumMinutes: typeof sumMinutes;
    prevNext: typeof prevNext;
    parseBody: typeof parseBody;
    highlight: typeof highlight;
    buildArchive: typeof buildArchive;
  };
  prefs: {
    key: string;
    version: number;
    defaults: typeof DEFAULT_PREFS;
    sanitize: typeof sanitize;
    load: typeof loadPrefs;
    save: typeof savePrefs;
  };
  keys: {
    posts: typeof POSTS_KEY;
    postsKey: typeof postsKey;
    insightsKey: typeof insightsKey;
    postKey: typeof postKey;
  };
  style: { ids: typeof STYLE_IDS; styles: typeof STYLES; css: typeof styleCss; structural: string };
  reqLog: typeof reqLog;
  resetReqLog: typeof resetReqLog;
  renderCounts: typeof renderCounts;
  resetRenderCounts: typeof resetRenderCounts;
}

export function installBridge(): void {
  const bridge: FdBridge = {
    version: '20260926-12',
    arm,
    facts: {
      postCount: POST_COUNT,
      todayDay: TODAY_DAY,
      corpus,
      wireRows,
      featuredSlug,
      relatedTo,
      dayToMonth,
      formatDate,
    },
    model: {
      filterRows,
      sortRows,
      hotThreshold,
      toView,
      tagCountsOf,
      sumViews,
      sumMinutes,
      prevNext,
      parseBody,
      highlight,
      buildArchive,
    },
    prefs: {
      key: PREFS_KEY,
      version: PREFS_VERSION,
      defaults: DEFAULT_PREFS,
      sanitize,
      load: loadPrefs,
      save: savePrefs,
    },
    keys: { posts: POSTS_KEY, postsKey, insightsKey, postKey },
    style: { ids: STYLE_IDS, styles: STYLES, css: styleCss, structural: structuralCss },
    reqLog,
    resetReqLog,
    renderCounts,
    resetRenderCounts,
  };
  (window as unknown as { __fdBridge: FdBridge }).__fdBridge = bridge;
}
