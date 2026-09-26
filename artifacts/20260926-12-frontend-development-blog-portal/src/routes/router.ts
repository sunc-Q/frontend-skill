import type { ComponentType, LazyExoticComponent } from 'react';
import type { QueryClient } from '@tanstack/react-query';

/**
 * The skill's routing clause is `createFileRoute('/path/')({ component, loader })` from TanStack
 * Router plus `routes/{feature}/index.tsx` folders. `createFileRoute` needs the router's codegen
 * plugin to write routeTree.gen.ts, and a browser-history router cannot run in a single-file
 * artifact opened over file://. So: the folder layout, the lazy component, the loader-with-crumb
 * shape and the params object are all kept; only the codegen call is replaced by this descriptor.
 */
export interface RouteCtx {
  queryClient: QueryClient;
  hash: string;
  params: Record<string, string>;
}

export interface RouteSpec {
  /** hash pattern, e.g. '/post/:slug' */
  pattern: string;
  crumb: string;
  /** which nav entry is current — the shell is rendered by App, outside the route boundary */
  layoutId: 'home' | 'post' | 'archive' | 'about';
  loader?: (ctx: RouteCtx) => Promise<unknown>;
  component: LazyExoticComponent<ComponentType<{ slug?: string }>>;
}

const toRegex = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/:[a-zA-Z0-9_]+/g, (m) => `(?<${m.slice(1)}>[^/]+)`)}$`);

export interface Match {
  spec: RouteSpec;
  params: Record<string, string>;
}

/** Most literal characters in the pattern wins, so '/post/featured' would beat '/post/:slug'. */
export function matchRoute(routes: RouteSpec[], hash: string): Match {
  const path = normalise(hash);
  let best: Match | null = null;
  for (const spec of routes) {
    const m = toRegex(spec.pattern).exec(path);
    if (m === null) continue;
    const literal = spec.pattern.split(':')[0]?.length ?? 0;
    if (best === null || literal > (best.spec.pattern.split(':')[0]?.length ?? 0)) {
      best = { spec, params: { ...(m.groups ?? {}) } };
    }
  }
  return best ?? { spec: routes[0] as RouteSpec, params: {} };
}

export function normalise(hash: string): string {
  const raw = hash.replace(/^#/, '');
  if (raw === '' || raw === '/') return '/';
  return raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
}
