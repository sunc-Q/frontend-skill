import { useEffect, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SuspenseLoader } from '~components/SuspenseLoader/SuspenseLoader';
import { Layout } from '~components/Layout/Layout';
import { useRouteState } from '@/hooks/useRouteState';

/**
 * One route = one lazy component + one optional loader, and the loader runs in an effect keyed on
 * the hash. That is deliberate: the page below it reads the same key through `useSuspenseQuery`, so
 * a warm cache means zero extra requests (React Query de-dupes by key) and an unstable key means
 * one per render. Either way the number is countable, which is the whole point of group G.
 */
export function App(): ReactElement {
  const queryClient = useQueryClient();
  const { hash, match } = useRouteState();
  const { spec, params } = match;

  useEffect(() => {
    void spec.loader?.({ queryClient, hash, params }).catch(() => undefined);
  }, [hash, spec, params, queryClient]);

  return (
    <div data-testid="route-shell" data-crumb={spec.crumb} data-pattern={spec.pattern} data-params={JSON.stringify(params)}>
      {/*
        The shell is rendered *here*, not inside the route: its stats and footer come from the
        bundle, not from the read. A group-G measurement on a 1.8s origin showed what happens
        otherwise — the route-level fallback swallowed the header, nav and footer too (footTop
        jumped by 1066px when content landed). Chrome stays; only <main> suspends.
      */}
      <Layout routeId={spec.layoutId}>
        {/* Skill clause: no early-return spinners — the boundary reserves the space. */}
        <SuspenseLoader minHeight={520} label={`路由 ${spec.crumb}`}>
          <spec.component slug={params['slug']} />
        </SuspenseLoader>
      </Layout>
    </div>
  );
}

export default App;
