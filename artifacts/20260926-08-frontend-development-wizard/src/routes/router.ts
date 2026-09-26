import type { ComponentType, LazyExoticComponent } from 'react';
import type { QueryClient } from '@tanstack/react-query';

/**
 * The skill's routing clause is `createFileRoute('/path/')({...})` from TanStack Router plus
 * `routes/{feature}/index.tsx` folders. `createFileRoute` needs the router's Vite plugin to
 * generate routeTree.gen.ts, which the skill does not ship and which cannot run in a
 * single-file artifact opened over file://. The folder layout, the lazy component and the
 * loader-with-crumb shape are kept; only the codegen call is replaced by this 12-line
 * descriptor so the route table stays reviewable.
 */
export interface RouteCtx {
  queryClient: QueryClient;
  hash: string;
}

export interface RouteSpec {
  path: string;
  crumb: string;
  /** Runs before the component mounts; the page then reads the same keys through useSuspenseQuery. */
  loader?: (ctx: RouteCtx) => Promise<unknown>;
  component: LazyExoticComponent<ComponentType>;
}

export function matchRoute(routes: RouteSpec[], pathname: string): RouteSpec {
  return routes.find((r) => r.path === pathname) ?? (routes[0] as RouteSpec);
}
