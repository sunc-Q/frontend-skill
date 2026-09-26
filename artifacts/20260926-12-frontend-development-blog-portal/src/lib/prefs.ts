import { TAG_IDS } from '@/lib/facts';
import type { Density, Prefs, SortId, TagId } from '~types/post';

export const PREFS_KEY = 'grayscale.prefs';
export const PREFS_VERSION = 3;

const SORTS: SortId[] = ['recent', 'popular', 'quick'];
const DENSITIES: Density[] = ['comfortable', 'compact'];

export const DEFAULT_PREFS: Prefs = {
  version: PREFS_VERSION,
  sort: 'recent',
  density: 'comfortable',
  tag: 'all',
  starred: [],
};

function isTag(v: unknown): v is TagId {
  return typeof v === 'string' && (TAG_IDS as string[]).includes(v);
}

/**
 * A draft is attacker-controlled input: a hand-edited localStorage entry must not be able to
 * push the UI into a state the code never produces (negative lists, unknown tags, non-arrays).
 * Every field falls back independently, so one bad key does not erase the rest.
 */
export function sanitize(raw: unknown): Prefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS };
  const o = raw as Record<string, unknown>;
  const sort = SORTS.includes(o['sort'] as SortId) ? (o['sort'] as SortId) : DEFAULT_PREFS.sort;
  const density = DENSITIES.includes(o['density'] as Density) ? (o['density'] as Density) : DEFAULT_PREFS.density;
  const rawTag = o['tag'];
  const tag: TagId | 'all' = rawTag === 'all' || isTag(rawTag) ? rawTag : DEFAULT_PREFS.tag;
  const starredRaw = Array.isArray(o['starred']) ? o['starred'] : [];
  const starred = [...new Set(starredRaw.filter((s): s is string => typeof s === 'string' && /^p-\d{3}-[a-z]+$/.test(s)))].slice(0, 60);
  return { version: PREFS_VERSION, sort, density, tag, starred };
}

export function loadPrefs(storage: Storage | undefined = safeStorage()): Prefs {
  if (storage === undefined) return { ...DEFAULT_PREFS };
  const text = storage.getItem(PREFS_KEY);
  if (text === null) return { ...DEFAULT_PREFS };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_PREFS };
    if ((parsed as Record<string, unknown>)['version'] !== PREFS_VERSION) return { ...DEFAULT_PREFS };
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs, storage: Storage | undefined = safeStorage()): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, version: PREFS_VERSION }));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
