import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadPrefs, savePrefs } from '@/lib/prefs';
import type { Density, Prefs, SortId, TagId } from '~types/post';

export interface PrefsApi {
  prefs: Prefs;
  starred: Set<string>;
  setSort: (s: SortId) => void;
  setDensity: (d: Density) => void;
  setTag: (t: TagId | 'all') => void;
  toggleStar: (slug: string) => void;
  clearStars: () => void;
}

/**
 * Preferences are the only thing this site persists, and the two callbacks the rows receive
 * (`toggleStar`) have to stay referentially stable — otherwise the memoised row in
 * features/posts/components/PostRow.tsx re-renders on every keystroke and the skill's
 * "React.memo" clause buys nothing. Hence the functional updater and the empty dep list.
 */
export function usePrefs(): PrefsApi {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const setSort = useCallback((sort: SortId): void => setPrefs((p) => ({ ...p, sort })), []);
  const setDensity = useCallback((density: Density): void => setPrefs((p) => ({ ...p, density })), []);
  const setTag = useCallback((tag: TagId | 'all'): void => setPrefs((p) => ({ ...p, tag })), []);
  const toggleStar = useCallback(
    (slug: string): void =>
      setPrefs((p) => ({
        ...p,
        starred: p.starred.includes(slug) ? p.starred.filter((s) => s !== slug) : [...p.starred, slug].slice(-60),
      })),
    [],
  );
  const clearStars = useCallback((): void => setPrefs((p) => ({ ...p, starred: [] })), []);

  const starred = useMemo(() => new Set(prefs.starred), [prefs.starred]);

  return { prefs, starred, setSort, setDensity, setTag, toggleStar, clearStars };
}

export default usePrefs;
