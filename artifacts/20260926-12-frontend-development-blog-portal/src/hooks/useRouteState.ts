import { useEffect, useMemo, useState } from 'react';
import { currentHash, routes } from '@/routes';
import { matchRoute, type Match } from '@/routes/router';

/**
 * `hashchange` is the only subscription the app needs, and it is removed in the cleanup — the
 * skill's "memory leak prevention (cleanup in useEffect)" clause, in a place where a leaked
 * listener would actually be observable (each navigation would re-run every loader twice).
 */
export function useRouteState(): { hash: string; match: Match } {
  const [hash, setHash] = useState<string>(() => currentHash());

  useEffect(() => {
    const onHashChange = (): void => setHash(currentHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const match = useMemo(() => matchRoute(routes, hash), [hash]);
  return { hash, match };
}
